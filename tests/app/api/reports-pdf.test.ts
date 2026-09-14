import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { resetDb } from "../../helpers/resetDb";

vi.mock("@/lib/tenant", () => ({ requireCustomerId: vi.fn() }));

// The route's output is a PDF binary, so the summary figures can't be read back out of
// the response. Wrapping renderToBuffer lets the tests below assert on the props the
// route hands the document, while the real renderer still runs and produces a real PDF.
const renderedDocuments: { props: Record<string, unknown> }[] = [];
vi.mock("@react-pdf/renderer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@react-pdf/renderer")>();
  return {
    ...actual,
    renderToBuffer: vi.fn(async (element: { props: Record<string, unknown> }) => {
      renderedDocuments.push(element);
      return actual.renderToBuffer(element as never);
    }),
  };
});

import { requireCustomerId } from "@/lib/tenant";
import { computeDashboardSummary } from "@/lib/dashboard-summary";
import { GET } from "@/app/api/reports/[subscriptionId]/pdf/route";

describe("GET /api/reports/:subscriptionId/pdf", () => {
  beforeEach(resetDb);
  beforeEach(() => {
    renderedDocuments.length = 0;
  });

  it("returns a PDF for a subscription belonging to the current customer", async () => {
    const customer = await prisma.customer.create({
      data: { entraTenantId: "tenant-reports-1", name: "Acme" },
    });
    const subscription = await prisma.subscription.create({
      data: {
        customerId: customer.id,
        azureSubscriptionId: "sub-reports-1",
        displayName: "Prod",
      },
    });
    vi.mocked(requireCustomerId).mockResolvedValue(customer.id);

    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ subscriptionId: subscription.id }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    const buffer = Buffer.from(await response.arrayBuffer());
    expect(buffer.subarray(0, 4).toString()).toBe("%PDF");
  });

  it("returns 404 for a subscription belonging to another customer", async () => {
    const customer = await prisma.customer.create({
      data: { entraTenantId: "tenant-reports-2", name: "Other" },
    });
    const subscription = await prisma.subscription.create({
      data: {
        customerId: customer.id,
        azureSubscriptionId: "sub-reports-2",
        displayName: "Prod",
      },
    });
    vi.mocked(requireCustomerId).mockResolvedValue("some-other-customer-id");

    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ subscriptionId: subscription.id }),
    });

    expect(response.status).toBe(404);
  });

  it("counts a billed resource once (at its max saving) in the potential-savings total, matching the dashboard", async () => {
    const customer = await prisma.customer.create({
      data: { entraTenantId: "tenant-reports-dedup", name: "Acme" },
    });
    const subscription = await prisma.subscription.create({
      data: {
        customerId: customer.id,
        azureSubscriptionId: "sub-reports-dedup",
        displayName: "Prod",
      },
    });
    // One VM tripping two rules: 60 (delete it) or 25 (license it correctly) — not 85.
    await prisma.wasteFinding.createMany({
      data: [
        {
          subscriptionId: subscription.id,
          resourceId: "vm-dedup",
          billedResourceId: "vm-dedup",
          ruleType: "IDLE_VM",
          estimatedMonthlyCost: 60,
          estimatedMonthlySavings: 60,
        },
        {
          subscriptionId: subscription.id,
          resourceId: "vm-dedup",
          billedResourceId: "vm-dedup",
          ruleType: "VM_MISSING_HYBRID_BENEFIT",
          estimatedMonthlyCost: 60,
          estimatedMonthlySavings: 25,
        },
      ],
    });
    vi.mocked(requireCustomerId).mockResolvedValue(customer.id);

    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ subscriptionId: subscription.id }),
    });

    expect(response.status).toBe(200);
    expect(renderedDocuments).toHaveLength(1);
    expect(renderedDocuments[0].props.totalOpenSavings).toBe(60);

    const findings = await prisma.wasteFinding.findMany({
      where: { subscriptionId: subscription.id },
    });
    expect(computeDashboardSummary(findings).totalEstimatedMonthlySavings).toBe(60);
  });

  it("counts a billed resource once per month in the resolved-savings series and headline total", async () => {
    const customer = await prisma.customer.create({
      data: { entraTenantId: "tenant-reports-dedup-resolved", name: "Acme" },
    });
    const subscription = await prisma.subscription.create({
      data: {
        customerId: customer.id,
        azureSubscriptionId: "sub-reports-dedup-resolved",
        displayName: "Prod",
      },
    });
    await prisma.wasteFinding.createMany({
      data: [
        {
          subscriptionId: subscription.id,
          resourceId: "vm-resolved",
          billedResourceId: "vm-resolved",
          ruleType: "IDLE_VM",
          estimatedMonthlyCost: 60,
          estimatedMonthlySavings: 60,
          status: "RESOLVED",
          resolvedAt: new Date("2026-03-10"),
        },
        {
          subscriptionId: subscription.id,
          resourceId: "vm-resolved",
          billedResourceId: "vm-resolved",
          ruleType: "VM_MISSING_HYBRID_BENEFIT",
          estimatedMonthlyCost: 60,
          estimatedMonthlySavings: 25,
          status: "RESOLVED",
          resolvedAt: new Date("2026-03-12"),
        },
      ],
    });
    vi.mocked(requireCustomerId).mockResolvedValue(customer.id);

    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ subscriptionId: subscription.id }),
    });

    expect(response.status).toBe(200);
    expect(renderedDocuments[0].props.savingsResolvedByMonth).toEqual([
      { month: "2026-03", value: 60 },
    ]);
    expect(renderedDocuments[0].props.totalResolvedSavings).toBe(60);
  });

  it("renders a PDF for a subscription with exactly one month of resolved savings", async () => {
    const customer = await prisma.customer.create({
      data: { entraTenantId: "tenant-reports-one-month", name: "Acme" },
    });
    const subscription = await prisma.subscription.create({
      data: {
        customerId: customer.id,
        azureSubscriptionId: "sub-reports-one-month",
        displayName: "Prod",
      },
    });
    await prisma.wasteFinding.create({
      data: {
        subscriptionId: subscription.id,
        resourceId: "disk-one-month",
        billedResourceId: "disk-one-month",
        ruleType: "ORPHANED_DISK",
        estimatedMonthlyCost: 12,
        estimatedMonthlySavings: 12,
        status: "RESOLVED",
        resolvedAt: new Date("2026-04-05"),
      },
    });
    vi.mocked(requireCustomerId).mockResolvedValue(customer.id);

    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ subscriptionId: subscription.id }),
    });

    // A one-point series is exactly the case that used to draw a blank chart; the
    // document now plots a marker instead, and must still render.
    expect(response.status).toBe(200);
    expect(renderedDocuments[0].props.savingsResolvedByMonth).toEqual([
      { month: "2026-04", value: 12 },
    ]);
    const buffer = Buffer.from(await response.arrayBuffer());
    expect(buffer.subarray(0, 4).toString()).toBe("%PDF");
  });
});
