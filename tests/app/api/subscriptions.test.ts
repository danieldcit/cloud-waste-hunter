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
      body: JSON.stringify({
        azureSubscriptionId: "aaaaaaaa-1111-2222-3333-444444444444",
        displayName: "Acme Prod",
      }),
    });
    const response = await POST(request);
    expect(response.status).toBe(201);

    const created = await prisma.subscription.findUniqueOrThrow({
      where: { azureSubscriptionId: "aaaaaaaa-1111-2222-3333-444444444444" },
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

  it("rejects a POST with a malformed azureSubscriptionId", async () => {
    const customer = await prisma.customer.create({
      data: { entraTenantId: "tenant-malformed", name: "Malformed" },
    });
    vi.mocked(requireCustomerId).mockResolvedValue(customer.id);

    const request = new Request("http://localhost/api/subscriptions", {
      method: "POST",
      body: JSON.stringify({
        azureSubscriptionId: "not-a-guid",
        displayName: "Bad Sub",
      }),
    });
    const response = await POST(request);

    expect(response.status).toBe(400);

    const created = await prisma.subscription.findMany({
      where: { customerId: customer.id },
    });
    expect(created).toHaveLength(0);
  });

  it("returns 409, not a raw 500, when azureSubscriptionId already exists", async () => {
    const customer = await prisma.customer.create({
      data: { entraTenantId: "tenant-dup", name: "Dup" },
    });
    vi.mocked(requireCustomerId).mockResolvedValue(customer.id);

    const validGuid = "11111111-1111-1111-1111-111111111111";

    const firstRequest = new Request("http://localhost/api/subscriptions", {
      method: "POST",
      body: JSON.stringify({ azureSubscriptionId: validGuid, displayName: "First" }),
    });
    const firstResponse = await POST(firstRequest);
    expect(firstResponse.status).toBe(201);

    const secondRequest = new Request("http://localhost/api/subscriptions", {
      method: "POST",
      body: JSON.stringify({ azureSubscriptionId: validGuid, displayName: "Second" }),
    });
    const secondResponse = await POST(secondRequest);

    expect(secondResponse.status).toBe(409);
    const body = await secondResponse.json();
    expect(body.error).toBeTruthy();
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
