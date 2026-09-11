import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { resetDb } from "../../helpers/resetDb";

vi.mock("@/lib/tenant", () => ({ requireCustomerId: vi.fn() }));
vi.mock("@/lib/azure/armFetch", () => ({ armFetch: vi.fn() }));
vi.mock("@/lib/scanner/runScan", () => ({ runScan: vi.fn().mockResolvedValue(undefined) }));

import { requireCustomerId } from "@/lib/tenant";
import { armFetch } from "@/lib/azure/armFetch";
import { runScan } from "@/lib/scanner/runScan";
import { POST } from "@/app/api/subscriptions/[id]/verify/route";

describe("POST /api/subscriptions/:id/verify", () => {
  beforeEach(resetDb);

  it("marks the subscription CONNECTED and triggers a scan when a delegation exists", async () => {
    const customer = await prisma.customer.create({
      data: { entraTenantId: "tenant-1", name: "Acme" },
    });
    const subscription = await prisma.subscription.create({
      data: { customerId: customer.id, azureSubscriptionId: "sub-1", displayName: "Prod" },
    });

    vi.mocked(requireCustomerId).mockResolvedValue(customer.id);
    vi.mocked(armFetch).mockResolvedValue({ value: [{ id: "assignment-1" }] });

    const response = await POST(new Request("http://localhost"), {
      params: Promise.resolve({ id: subscription.id }),
    });

    expect(response.status).toBe(200);
    const updated = await prisma.subscription.findUniqueOrThrow({ where: { id: subscription.id } });
    expect(updated.status).toBe("CONNECTED");
    expect(runScan).toHaveBeenCalledWith(subscription.id);
  });

  it("returns 409 when no delegation exists yet", async () => {
    const customer = await prisma.customer.create({
      data: { entraTenantId: "tenant-2", name: "Other" },
    });
    const subscription = await prisma.subscription.create({
      data: { customerId: customer.id, azureSubscriptionId: "sub-2", displayName: "Other" },
    });

    vi.mocked(requireCustomerId).mockResolvedValue(customer.id);
    vi.mocked(armFetch).mockResolvedValue({ value: [] });

    const response = await POST(new Request("http://localhost"), {
      params: Promise.resolve({ id: subscription.id }),
    });

    expect(response.status).toBe(409);
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

    vi.mocked(requireCustomerId).mockResolvedValue(customerA.id);

    const response = await POST(new Request("http://localhost"), {
      params: Promise.resolve({ id: subscriptionB.id }),
    });

    expect(response.status).toBe(404);
  });
});
