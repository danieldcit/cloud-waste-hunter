import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { resetDb } from "../../helpers/resetDb";

vi.mock("@/lib/tenant", () => ({ getOperatorCustomerId: vi.fn() }));
vi.mock("@/lib/azure/armFetch", () => ({ armFetch: vi.fn() }));
vi.mock("@/lib/scanner/runScan", () => ({ runScan: vi.fn().mockResolvedValue(undefined) }));

import { getOperatorCustomerId } from "@/lib/tenant";
import { armFetch } from "@/lib/azure/armFetch";
import { runScan } from "@/lib/scanner/runScan";
import { POST } from "@/app/api/subscriptions/[id]/verify/route";

describe("POST /api/subscriptions/:id/verify", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  beforeEach(resetDb);

  it("marks the subscription CONNECTED and triggers a scan when the Azure tenant matches", async () => {
    const customer = await prisma.customer.create({
      data: { entraTenantId: "tenant-1", name: "Acme" },
    });
    const subscription = await prisma.subscription.create({
      data: {
        customerId: customer.id,
        azureSubscriptionId: "sub-1",
        azureTenantId: "tenant-1",
        displayName: "Prod",
      },
    });

    vi.mocked(getOperatorCustomerId).mockResolvedValue(customer.id);
    vi.mocked(armFetch).mockResolvedValue({ tenantId: "tenant-1" });

    const response = await POST(new Request("http://localhost"), {
      params: Promise.resolve({ id: subscription.id }),
    });

    expect(response.status).toBe(200);
    const updated = await prisma.subscription.findUniqueOrThrow({ where: { id: subscription.id } });
    expect(updated.status).toBe("CONNECTED");
    expect(runScan).toHaveBeenCalledWith(subscription.id);
  });

  it("returns 403 and does not connect when the subscription's tenant does not match the customer's tenant", async () => {
    const customer = await prisma.customer.create({
      data: { entraTenantId: "tenant-3", name: "Mismatch" },
    });
    const subscription = await prisma.subscription.create({
      data: {
        customerId: customer.id,
        azureSubscriptionId: "sub-3",
        azureTenantId: "tenant-3",
        displayName: "Mismatch",
      },
    });

    vi.mocked(getOperatorCustomerId).mockResolvedValue(customer.id);
    vi.mocked(armFetch).mockResolvedValue({ tenantId: "attacker-tenant" });

    const response = await POST(new Request("http://localhost"), {
      params: Promise.resolve({ id: subscription.id }),
    });

    expect(response.status).toBe(403);
    const updated = await prisma.subscription.findUniqueOrThrow({ where: { id: subscription.id } });
    expect(updated.status).toBe("PENDING");
    expect(runScan).not.toHaveBeenCalled();
  });

  it("connects a managed client's subscription even though its placeholder entraTenantId never matches the real Azure tenantId", async () => {
    const operator = await prisma.customer.create({
      data: { entraTenantId: "tenant-operator", name: "Operator" },
    });
    const managedClient = await prisma.customer.create({
      data: {
        entraTenantId: `managed:${crypto.randomUUID()}`,
        name: "Managed Client",
        operatorCustomerId: operator.id,
      },
    });
    const subscription = await prisma.subscription.create({
      data: {
        customerId: managedClient.id,
        azureSubscriptionId: "sub-managed",
        azureTenantId: "real-azure-tenant-guid",
        displayName: "Managed Sub",
      },
    });

    vi.mocked(getOperatorCustomerId).mockResolvedValue(operator.id);
    vi.mocked(armFetch).mockResolvedValue({ tenantId: "real-azure-tenant-guid" });

    const response = await POST(new Request("http://localhost"), {
      params: Promise.resolve({ id: subscription.id }),
    });

    expect(response.status).toBe(200);
    const updated = await prisma.subscription.findUniqueOrThrow({ where: { id: subscription.id } });
    expect(updated.status).toBe("CONNECTED");
    expect(runScan).toHaveBeenCalledWith(subscription.id);
  });

  it("returns 404 for a subscription belonging to another customer", async () => {
    const customerA = await prisma.customer.create({
      data: { entraTenantId: "tenant-a", name: "A" },
    });
    const customerB = await prisma.customer.create({
      data: { entraTenantId: "tenant-b", name: "B" },
    });
    const subscriptionB = await prisma.subscription.create({
      data: { customerId: customerB.id, azureSubscriptionId: "sub-b", displayName: "B" },
    });

    vi.mocked(getOperatorCustomerId).mockResolvedValue(customerA.id);

    const response = await POST(new Request("http://localhost"), {
      params: Promise.resolve({ id: subscriptionB.id }),
    });

    expect(response.status).toBe(404);
  });
});
