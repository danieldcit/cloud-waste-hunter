import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { resetDb } from "../../helpers/resetDb";

vi.mock("@/lib/azure/resourceGraph", () => ({
  queryResourceGraph: vi.fn(),
}));
vi.mock("@/lib/azure/costManagement", () => ({
  estimateMonthlyCost: vi.fn(),
}));

import { queryResourceGraph } from "@/lib/azure/resourceGraph";
import { estimateMonthlyCost } from "@/lib/azure/costManagement";
import { runScan } from "@/lib/scanner/runScan";

describe("runScan", () => {
  beforeEach(resetDb);

  it("persists resources and waste findings, and marks the scan SUCCEEDED", async () => {
    const customer = await prisma.customer.create({
      data: { entraTenantId: "tenant-1", name: "Acme" },
    });
    const subscription = await prisma.subscription.create({
      data: { customerId: customer.id, azureSubscriptionId: "sub-1", displayName: "Prod" },
    });

    vi.mocked(queryResourceGraph).mockResolvedValue([
      {
        id: "disk-1",
        type: "microsoft.compute/disks",
        subscriptionId: "sub-1",
        properties: { diskState: "Unattached" },
      },
    ]);
    vi.mocked(estimateMonthlyCost).mockResolvedValue(9.99);

    await runScan(subscription.id);

    const scanRun = await prisma.scanRun.findFirstOrThrow({
      where: { subscriptionId: subscription.id },
    });
    expect(scanRun.status).toBe("SUCCEEDED");

    const findings = await prisma.wasteFinding.findMany({
      where: { subscriptionId: subscription.id },
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      ruleType: "ORPHANED_DISK",
      resourceId: "disk-1",
      estimatedMonthlyCost: 9.99,
    });
  });

  it("marks the scan FAILED when Resource Graph throws", async () => {
    const customer = await prisma.customer.create({
      data: { entraTenantId: "tenant-2", name: "Other" },
    });
    const subscription = await prisma.subscription.create({
      data: { customerId: customer.id, azureSubscriptionId: "sub-2", displayName: "Other" },
    });

    vi.mocked(queryResourceGraph).mockRejectedValue(new Error("boom"));

    await expect(runScan(subscription.id)).rejects.toThrow("boom");

    const scanRun = await prisma.scanRun.findFirstOrThrow({
      where: { subscriptionId: subscription.id },
    });
    expect(scanRun.status).toBe("FAILED");
  });
});
