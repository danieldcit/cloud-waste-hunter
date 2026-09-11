import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { resetDb } from "../helpers/resetDb";

describe("CostSnapshot model", () => {
  beforeEach(resetDb);

  it("creates a cost snapshot linked to a subscription", async () => {
    const customer = await prisma.customer.create({
      data: { entraTenantId: "tenant-cost-1", name: "Acme" },
    });
    const subscription = await prisma.subscription.create({
      data: { customerId: customer.id, azureSubscriptionId: "sub-cost-1", displayName: "Prod" },
    });

    const snapshot = await prisma.costSnapshot.create({
      data: {
        subscriptionId: subscription.id,
        monthToDateSpend: 123.45,
        projectedSpend: 456.78,
        dailyTrend: [{ date: "2026-09-01", cost: 10 }],
      },
    });

    expect(snapshot.subscriptionId).toBe(subscription.id);
    expect(snapshot.monthToDateSpend).toBe(123.45);
    expect(snapshot.dailyTrend).toEqual([{ date: "2026-09-01", cost: 10 }]);
  });

  it("creates a waste finding with the new IDLE_VM rule type", async () => {
    const customer = await prisma.customer.create({
      data: { entraTenantId: "tenant-cost-2", name: "Other" },
    });
    const subscription = await prisma.subscription.create({
      data: { customerId: customer.id, azureSubscriptionId: "sub-cost-2", displayName: "Dev" },
    });

    const finding = await prisma.wasteFinding.create({
      data: {
        subscriptionId: subscription.id,
        ruleType: "IDLE_VM",
        resourceId: "vm-idle-1",
        estimatedMonthlyCost: 42,
      },
    });

    expect(finding.ruleType).toBe("IDLE_VM");
  });
});
