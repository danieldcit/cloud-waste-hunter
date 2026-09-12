import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { resetDb } from "../helpers/resetDb";

vi.mock("@/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(),
}));

import { auth } from "@/auth";
import { cookies } from "next/headers";
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
  beforeEach(async () => {
    await resetDb();
    vi.mocked(cookies).mockResolvedValue({
      get: vi.fn().mockReturnValue(undefined),
    } as never);
  });

  it("only returns findings belonging to the logged-in customer's subscriptions", async () => {
    const customerA = await seedCustomerWithFinding("findings-tenant-a", "disk-a");
    await seedCustomerWithFinding("findings-tenant-b", "disk-b");

    vi.mocked(auth).mockResolvedValue({
      customerId: customerA.id,
    } as never);

    const findings = await listFindingsForCurrentCustomer();

    expect(findings).toHaveLength(1);
    expect(findings[0].resourceId).toBe("disk-a");
  });

  it("throws when there is no authenticated session", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);

    await expect(listFindingsForCurrentCustomer()).rejects.toThrow();
  });
});
