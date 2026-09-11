import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { resetDb } from "../helpers/resetDb";

vi.mock("@/auth", () => ({
  auth: vi.fn(),
}));

import { auth } from "@/auth";
import { listFindingsForCurrentCustomer } from "@/lib/findings";

async function seedCustomerWithFinding(tenantId: string, resourceId: string) {
  const customer = await prisma.customer.create({
    data: { entraTenantId: tenantId, name: tenantId },
  });
  const subscription = await prisma.subscription.create({
    data: {
      customerId: customer.id,
      azureSubscriptionId: `${tenantId}-sub`,
      displayName: `${tenantId} sub`,
    },
  });
  await prisma.wasteFinding.create({
    data: {
      subscriptionId: subscription.id,
      ruleType: "ORPHANED_DISK",
      resourceId,
      estimatedMonthlyCost: 12.5,
    },
  });
  return customer;
}

describe("listFindingsForCurrentCustomer", () => {
  beforeEach(resetDb);

  it("only returns findings belonging to the logged-in customer's subscriptions", async () => {
    const customerA = await seedCustomerWithFinding("tenant-a", "disk-a");
    await seedCustomerWithFinding("tenant-b", "disk-b");

    vi.mocked(auth).mockResolvedValue({
      customerId: customerA.id,
    } as never);

    const findings = await listFindingsForCurrentCustomer();

    expect(findings).toHaveLength(1);
    expect(findings[0].resourceId).toBe("disk-a");
  });

  it("throws when there is no authenticated session", async () => {
    vi.mocked(auth).mockResolvedValue(null);

    await expect(listFindingsForCurrentCustomer()).rejects.toThrow();
  });
});
