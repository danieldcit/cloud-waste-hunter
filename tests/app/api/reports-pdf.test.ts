import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { resetDb } from "../../helpers/resetDb";

vi.mock("@/lib/tenant", () => ({ requireCustomerId: vi.fn() }));

import { requireCustomerId } from "@/lib/tenant";
import { GET } from "@/app/api/reports/[subscriptionId]/pdf/route";

describe("GET /api/reports/:subscriptionId/pdf", () => {
  beforeEach(resetDb);

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
});
