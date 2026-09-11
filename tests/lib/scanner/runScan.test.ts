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
  beforeEach(() => {
    vi.clearAllMocks();
  });
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

  it("calls estimateMonthlyCost once per candidate with the subscription and resource ids", async () => {
    const customer = await prisma.customer.create({
      data: { entraTenantId: "tenant-5", name: "CallArgs" },
    });
    const subscription = await prisma.subscription.create({
      data: { customerId: customer.id, azureSubscriptionId: "sub-5", displayName: "CallArgs" },
    });

    vi.mocked(queryResourceGraph).mockResolvedValue([
      {
        id: "disk-5",
        type: "microsoft.compute/disks",
        subscriptionId: "sub-5",
        properties: { diskState: "Unattached" },
      },
    ]);
    vi.mocked(estimateMonthlyCost).mockResolvedValue(9.99);

    await runScan(subscription.id);

    expect(estimateMonthlyCost).toHaveBeenCalledWith("sub-5", "disk-5");
    expect(estimateMonthlyCost).toHaveBeenCalledTimes(1);
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

  it("marks the scan FAILED when cost estimation throws", async () => {
    const customer = await prisma.customer.create({
      data: { entraTenantId: "tenant-3", name: "CostFails" },
    });
    const subscription = await prisma.subscription.create({
      data: { customerId: customer.id, azureSubscriptionId: "sub-3", displayName: "CostFails" },
    });

    vi.mocked(queryResourceGraph).mockResolvedValue([
      {
        id: "disk-3",
        type: "microsoft.compute/disks",
        subscriptionId: "sub-3",
        properties: { diskState: "Unattached" },
      },
    ]);
    vi.mocked(estimateMonthlyCost).mockRejectedValue(new Error("cost service unavailable"));

    await expect(runScan(subscription.id)).rejects.toThrow("cost service unavailable");

    const scanRun = await prisma.scanRun.findFirstOrThrow({
      where: { subscriptionId: subscription.id },
    });
    expect(scanRun.status).toBe("FAILED");
  });

  it("updates an existing waste finding in place on a re-scan instead of duplicating it", async () => {
    const customer = await prisma.customer.create({
      data: { entraTenantId: "tenant-4", name: "Rescan" },
    });
    const subscription = await prisma.subscription.create({
      data: { customerId: customer.id, azureSubscriptionId: "sub-4", displayName: "Rescan" },
    });

    const sameResource = [
      {
        id: "disk-4",
        type: "microsoft.compute/disks",
        subscriptionId: "sub-4",
        properties: { diskState: "Unattached" },
      },
    ];

    vi.mocked(queryResourceGraph).mockResolvedValue(sameResource);
    vi.mocked(estimateMonthlyCost).mockResolvedValue(9.99);
    await runScan(subscription.id);

    vi.mocked(queryResourceGraph).mockResolvedValue(sameResource);
    vi.mocked(estimateMonthlyCost).mockResolvedValue(15.0);
    await runScan(subscription.id);

    const findings = await prisma.wasteFinding.findMany({
      where: { subscriptionId: subscription.id },
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      ruleType: "ORPHANED_DISK",
      resourceId: "disk-4",
      estimatedMonthlyCost: 15.0,
    });
  });
});
