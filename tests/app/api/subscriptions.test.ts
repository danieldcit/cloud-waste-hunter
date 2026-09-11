import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { resetDb } from "../../helpers/resetDb";

vi.mock("@/lib/tenant", () => ({
  requireCustomerId: vi.fn(),
}));

import { requireCustomerId } from "@/lib/tenant";
import { GET, POST } from "@/app/api/subscriptions/route";

describe("/api/subscriptions", () => {
  beforeEach(resetDb);

  it("creates a PENDING subscription scoped to the current customer", async () => {
    const customer = await prisma.customer.create({
      data: { entraTenantId: "tenant-1", name: "Acme" },
    });
    vi.mocked(requireCustomerId).mockResolvedValue(customer.id);

    const request = new Request("http://localhost/api/subscriptions", {
      method: "POST",
      body: JSON.stringify({ azureSubscriptionId: "sub-1", displayName: "Acme Prod" }),
    });
    const response = await POST(request);
    expect(response.status).toBe(201);

    const created = await prisma.subscription.findUniqueOrThrow({
      where: { azureSubscriptionId: "sub-1" },
    });
    expect(created.customerId).toBe(customer.id);
    expect(created.status).toBe("PENDING");
  });

  it("rejects a POST missing required fields", async () => {
    vi.mocked(requireCustomerId).mockResolvedValue("customer-1");

    const request = new Request("http://localhost/api/subscriptions", {
      method: "POST",
      body: JSON.stringify({}),
    });
    const response = await POST(request);

    expect(response.status).toBe(400);
  });

  it("only lists subscriptions belonging to the current customer", async () => {
    const customerA = await prisma.customer.create({
      data: { entraTenantId: "tenant-a", name: "A" },
    });
    const customerB = await prisma.customer.create({
      data: { entraTenantId: "tenant-b", name: "B" },
    });
    await prisma.subscription.create({
      data: { customerId: customerA.id, azureSubscriptionId: "sub-a", displayName: "A sub" },
    });
    await prisma.subscription.create({
      data: { customerId: customerB.id, azureSubscriptionId: "sub-b", displayName: "B sub" },
    });

    vi.mocked(requireCustomerId).mockResolvedValue(customerA.id);

    const response = await GET();
    const body = (await response.json()) as { azureSubscriptionId: string }[];

    expect(body).toHaveLength(1);
    expect(body[0].azureSubscriptionId).toBe("sub-a");
  });
});
