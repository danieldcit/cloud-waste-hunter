import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { resetDb } from "../../helpers/resetDb";

vi.mock("@/lib/tenant", () => ({ requireCustomerId: vi.fn() }));

import { requireCustomerId } from "@/lib/tenant";
import { POST } from "@/app/api/findings/[id]/dismiss/route";

async function seedFinding(tenantId: string, resourceId: string) {
  const customer = await prisma.customer.create({
    data: { entraTenantId: tenantId, name: tenantId },
  });
  const subscription = await prisma.subscription.create({
    data: { customerId: customer.id, azureSubscriptionId: `${tenantId}-sub`, displayName: tenantId },
  });
  const finding = await prisma.wasteFinding.create({
    data: {
      subscriptionId: subscription.id,
      ruleType: "ORPHANED_DISK",
      resourceId,
      estimatedMonthlyCost: 1,
    },
  });
  return { customer, finding };
}

describe("POST /api/findings/:id/dismiss", () => {
  beforeEach(resetDb);

  it("dismisses a finding belonging to the current customer", async () => {
    const { customer, finding } = await seedFinding("tenant-a", "disk-a");
    vi.mocked(requireCustomerId).mockResolvedValue(customer.id);

    const response = await POST(new Request("http://localhost"), {
      params: Promise.resolve({ id: finding.id }),
    });

    expect(response.status).toBe(200);
    const updated = await prisma.wasteFinding.findUniqueOrThrow({ where: { id: finding.id } });
    expect(updated.status).toBe("DISMISSED");
  });

  it("returns 404 for a finding belonging to another customer", async () => {
    const { finding } = await seedFinding("tenant-b", "disk-b");
    vi.mocked(requireCustomerId).mockResolvedValue("some-other-customer-id");

    const response = await POST(new Request("http://localhost"), {
      params: Promise.resolve({ id: finding.id }),
    });

    expect(response.status).toBe(404);
  });
});
