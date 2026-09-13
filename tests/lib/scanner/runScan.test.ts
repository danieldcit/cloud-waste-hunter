import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { resetDb } from "../../helpers/resetDb";

vi.mock("@/lib/azure/resourceGraph", () => ({
  queryResourceGraph: vi.fn(),
}));
vi.mock("@/lib/azure/costManagement", () => ({
  estimateMonthlyCost: vi.fn(),
}));
vi.mock("@/lib/azure/monitorMetrics", () => ({
  getAverageCpuPercent: vi.fn(),
  getHourlyCpuBelowThreshold: vi.fn(),
}));
vi.mock("@/lib/azure/subscriptionCost", () => ({
  getSubscriptionMonthToDateSpend: vi.fn(),
  getSubscriptionForecast: vi.fn(),
  getSubscriptionDailyCostTrend: vi.fn(),
}));
vi.mock("@/lib/azure/retailPrices", () => ({
  estimateRetailMonthlyCost: vi.fn(),
  estimateHybridBenefitMonthlySavings: vi.fn(),
  estimateLinuxByolMonthlySavings: vi.fn(),
  estimateVmssSpotMonthlySavings: vi.fn(),
}));
vi.mock("@/lib/azure/reservationCoverage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/azure/reservationCoverage")>();
  return {
    ...actual,
    findReservationRecommendation: vi.fn(),
    listReservationRecommendations: vi.fn(),
    estimateReservationCoverageMonthlySavings: vi.fn(),
  };
});

import { queryResourceGraph } from "@/lib/azure/resourceGraph";
import { estimateMonthlyCost } from "@/lib/azure/costManagement";
import { getAverageCpuPercent, getHourlyCpuBelowThreshold } from "@/lib/azure/monitorMetrics";
import {
  estimateRetailMonthlyCost,
  estimateHybridBenefitMonthlySavings,
  estimateLinuxByolMonthlySavings,
} from "@/lib/azure/retailPrices";
import {
  listReservationRecommendations,
  estimateReservationCoverageMonthlySavings,
} from "@/lib/azure/reservationCoverage";
import {
  getSubscriptionMonthToDateSpend,
  getSubscriptionForecast,
  getSubscriptionDailyCostTrend,
} from "@/lib/azure/subscriptionCost";
import { runScan } from "@/lib/scanner/runScan";

describe("COMBINED_QUERY resource types", () => {
  it("includes the VMSS category-2 resource types", async () => {
    const { COMBINED_QUERY_TYPES } = await import("@/lib/scanner/runScan");
    expect(COMBINED_QUERY_TYPES).toEqual(
      expect.arrayContaining([
        "microsoft.compute/virtualmachinescalesets",
        "microsoft.compute/virtualmachinescalesets/virtualmachines",
        "microsoft.insights/autoscalesettings",
      ]),
    );
  });
});

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

  it("does not fail the whole scan when cost estimation throws for one candidate, and persists that finding with cost 0", async () => {
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
    vi.mocked(estimateMonthlyCost).mockRejectedValueOnce(new Error("cost service unavailable"));
    vi.mocked(estimateRetailMonthlyCost).mockResolvedValueOnce(0);

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
      resourceId: "disk-3",
      estimatedMonthlyCost: 0,
    });
  });

  it("falls back to a retail price estimate when Cost Management returns no data", async () => {
    const customer = await prisma.customer.create({
      data: { entraTenantId: "tenant-retail", name: "RetailFallback" },
    });
    const subscription = await prisma.subscription.create({
      data: { customerId: customer.id, azureSubscriptionId: "sub-retail", displayName: "RetailFallback" },
    });

    vi.mocked(queryResourceGraph).mockResolvedValue([
      {
        id: "disk-retail",
        type: "microsoft.compute/disks",
        subscriptionId: "sub-retail",
        location: "eastus",
        sku: { name: "Standard_LRS" },
        properties: { diskState: "Unattached", diskSizeGB: 32 },
      },
    ]);
    vi.mocked(estimateMonthlyCost).mockResolvedValueOnce(0);
    vi.mocked(estimateRetailMonthlyCost).mockResolvedValueOnce(1.536);

    await runScan(subscription.id);

    const findings = await prisma.wasteFinding.findMany({
      where: { subscriptionId: subscription.id },
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      ruleType: "ORPHANED_DISK",
      resourceId: "disk-retail",
      estimatedMonthlyCost: 1.536,
    });
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

  it("does not re-open a finding that was dismissed, on a later re-scan that re-detects the same resource", async () => {
    const customer = await prisma.customer.create({
      data: { entraTenantId: "tenant-6", name: "Dismissed" },
    });
    const subscription = await prisma.subscription.create({
      data: { customerId: customer.id, azureSubscriptionId: "sub-6", displayName: "Dismissed" },
    });

    const sameResource = [
      {
        id: "disk-6",
        type: "microsoft.compute/disks",
        subscriptionId: "sub-6",
        properties: { diskState: "Unattached" },
      },
    ];

    vi.mocked(queryResourceGraph).mockResolvedValue(sameResource);
    vi.mocked(estimateMonthlyCost).mockResolvedValue(9.99);
    await runScan(subscription.id);

    const finding = await prisma.wasteFinding.findFirstOrThrow({
      where: { subscriptionId: subscription.id, resourceId: "disk-6" },
    });
    await prisma.wasteFinding.update({
      where: { id: finding.id },
      data: { status: "DISMISSED" },
    });

    vi.mocked(queryResourceGraph).mockResolvedValue(sameResource);
    vi.mocked(estimateMonthlyCost).mockResolvedValue(9.99);
    await runScan(subscription.id);

    const updatedFinding = await prisma.wasteFinding.findUniqueOrThrow({
      where: { id: finding.id },
    });
    expect(updatedFinding.status).toBe("DISMISSED");
  });

  it("persists an IDLE_VM finding for an idle VM returned by Resource Graph", async () => {
    const customer = await prisma.customer.create({
      data: { entraTenantId: "tenant-vm-1", name: "Acme" },
    });
    const subscription = await prisma.subscription.create({
      data: { customerId: customer.id, azureSubscriptionId: "sub-vm-1", displayName: "Prod" },
    });

    vi.mocked(queryResourceGraph).mockResolvedValue([
      {
        id: "vm-idle-1",
        type: "microsoft.compute/virtualmachines",
        subscriptionId: "sub-vm-1",
        properties: {},
      },
    ]);
    vi.mocked(estimateMonthlyCost).mockResolvedValue(15);
    vi.mocked(getAverageCpuPercent).mockResolvedValue(1);
    vi.mocked(getSubscriptionMonthToDateSpend).mockResolvedValue(0);
    vi.mocked(getSubscriptionForecast).mockResolvedValue(0);
    vi.mocked(getSubscriptionDailyCostTrend).mockResolvedValue([]);

    await runScan(subscription.id);

    const findings = await prisma.wasteFinding.findMany({
      where: { subscriptionId: subscription.id },
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].ruleType).toBe("IDLE_VM");
  });

  it("does not fail the whole scan when the idle VM rule throws, and still persists other rules' findings", async () => {
    const customer = await prisma.customer.create({
      data: { entraTenantId: "tenant-vm-2", name: "IdleVmFails" },
    });
    const subscription = await prisma.subscription.create({
      data: {
        customerId: customer.id,
        azureSubscriptionId: "sub-vm-2",
        displayName: "IdleVmFails",
      },
    });

    vi.mocked(queryResourceGraph).mockResolvedValue([
      {
        id: "disk-vm-2",
        type: "microsoft.compute/disks",
        subscriptionId: "sub-vm-2",
        properties: { diskState: "Unattached" },
      },
      {
        id: "vm-idle-2",
        type: "microsoft.compute/virtualmachines",
        subscriptionId: "sub-vm-2",
        properties: {},
      },
    ]);
    vi.mocked(estimateMonthlyCost).mockResolvedValue(9.99);
    vi.mocked(getAverageCpuPercent).mockRejectedValue(
      new Error("Azure Monitor throttled"),
    );
    vi.mocked(getSubscriptionMonthToDateSpend).mockResolvedValue(0);
    vi.mocked(getSubscriptionForecast).mockResolvedValue(0);
    vi.mocked(getSubscriptionDailyCostTrend).mockResolvedValue([]);

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
      resourceId: "disk-vm-2",
    });
  });

  it("persists a CostSnapshot with the captured subscription-level cost data", async () => {
    const customer = await prisma.customer.create({
      data: { entraTenantId: "tenant-cs-1", name: "Acme" },
    });
    const subscription = await prisma.subscription.create({
      data: { customerId: customer.id, azureSubscriptionId: "sub-cs-1", displayName: "Prod" },
    });

    vi.mocked(queryResourceGraph).mockResolvedValue([]);
    vi.mocked(getSubscriptionMonthToDateSpend).mockResolvedValue(200);
    vi.mocked(getSubscriptionForecast).mockResolvedValue(500);
    vi.mocked(getSubscriptionDailyCostTrend).mockResolvedValue([{ date: "2026-09-01", cost: 10 }]);

    await runScan(subscription.id);

    const snapshots = await prisma.costSnapshot.findMany({
      where: { subscriptionId: subscription.id },
    });
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].monthToDateSpend).toBe(200);
    expect(snapshots[0].projectedSpend).toBe(500);
    expect(snapshots[0].dailyTrend).toEqual([{ date: "2026-09-01", cost: 10 }]);
  });

  it("still succeeds, persists findings, and captures a partial CostSnapshot when one of three cost-fetch calls fails", async () => {
    const customer = await prisma.customer.create({
      data: { entraTenantId: "tenant-cs-2", name: "Acme" },
    });
    const subscription = await prisma.subscription.create({
      data: { customerId: customer.id, azureSubscriptionId: "sub-cs-2", displayName: "Prod" },
    });

    vi.mocked(queryResourceGraph).mockResolvedValue([
      {
        id: "disk-cs-2",
        type: "microsoft.compute/disks",
        subscriptionId: "sub-cs-2",
        properties: { diskState: "Unattached" },
      },
    ]);
    vi.mocked(estimateMonthlyCost).mockResolvedValue(9);
    vi.mocked(getSubscriptionMonthToDateSpend).mockRejectedValue(new Error("rate limited"));
    vi.mocked(getSubscriptionForecast).mockResolvedValue(500);
    vi.mocked(getSubscriptionDailyCostTrend).mockResolvedValue([
      { date: "2026-09-01", cost: 10 },
    ]);

    await runScan(subscription.id);

    const scanRun = await prisma.scanRun.findFirstOrThrow({
      where: { subscriptionId: subscription.id },
    });
    expect(scanRun.status).toBe("SUCCEEDED");

    const findings = await prisma.wasteFinding.findMany({
      where: { subscriptionId: subscription.id },
    });
    expect(findings).toHaveLength(1);

    const snapshots = await prisma.costSnapshot.findMany({
      where: { subscriptionId: subscription.id },
    });
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].monthToDateSpend).toBe(0);
    expect(snapshots[0].projectedSpend).toBe(500);
    expect(snapshots[0].dailyTrend).toEqual([{ date: "2026-09-01", cost: 10 }]);
  });

  it("still creates a CostSnapshot row (with defaults) when all three cost-fetch calls fail, since prisma.costSnapshot.create itself does not throw", async () => {
    const customer = await prisma.customer.create({
      data: { entraTenantId: "tenant-cs-3", name: "Acme" },
    });
    const subscription = await prisma.subscription.create({
      data: { customerId: customer.id, azureSubscriptionId: "sub-cs-3", displayName: "Prod" },
    });

    vi.mocked(queryResourceGraph).mockResolvedValue([]);
    vi.mocked(getSubscriptionMonthToDateSpend).mockRejectedValue(new Error("rate limited"));
    vi.mocked(getSubscriptionForecast).mockRejectedValue(new Error("rate limited"));
    vi.mocked(getSubscriptionDailyCostTrend).mockRejectedValue(new Error("rate limited"));

    await runScan(subscription.id);

    const scanRun = await prisma.scanRun.findFirstOrThrow({
      where: { subscriptionId: subscription.id },
    });
    expect(scanRun.status).toBe("SUCCEEDED");

    const snapshots = await prisma.costSnapshot.findMany({
      where: { subscriptionId: subscription.id },
    });
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].monthToDateSpend).toBe(0);
    expect(snapshots[0].projectedSpend).toBe(0);
    expect(snapshots[0].dailyTrend).toEqual([]);
  });

  it("persists a VM_MISSING_HYBRID_BENEFIT finding with POTENTIAL_SAVING classification and a computed savings delta", async () => {
    const customer = await prisma.customer.create({
      data: { entraTenantId: "tenant-hb-1", name: "Acme" },
    });
    const subscription = await prisma.subscription.create({
      data: { customerId: customer.id, azureSubscriptionId: "sub-hb-1", displayName: "Prod" },
    });

    vi.mocked(queryResourceGraph).mockResolvedValue([
      {
        id: "vm-hb-1",
        type: "microsoft.compute/virtualmachines",
        subscriptionId: "sub-hb-1",
        properties: { storageProfile: { osDisk: { osType: "Windows" } } },
      },
    ]);
    vi.mocked(estimateMonthlyCost).mockResolvedValue(50);
    vi.mocked(getAverageCpuPercent).mockResolvedValue(50);
    vi.mocked(estimateHybridBenefitMonthlySavings).mockResolvedValue(20);
    vi.mocked(getSubscriptionMonthToDateSpend).mockResolvedValue(0);
    vi.mocked(getSubscriptionForecast).mockResolvedValue(0);
    vi.mocked(getSubscriptionDailyCostTrend).mockResolvedValue([]);

    await runScan(subscription.id);

    const findings = await prisma.wasteFinding.findMany({
      where: { subscriptionId: subscription.id },
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      ruleType: "VM_MISSING_HYBRID_BENEFIT",
      resourceId: "vm-hb-1",
      savingsCategory: "POTENTIAL_SAVING",
      estimatedMonthlyCost: 50,
      estimatedMonthlySavings: 20,
    });
  });

  it("persists a null estimatedMonthlySavings for VM_OUTDATED_SKU_GENERATION, since the saving can't be estimated yet", async () => {
    const customer = await prisma.customer.create({
      data: { entraTenantId: "tenant-sku-1", name: "Acme" },
    });
    const subscription = await prisma.subscription.create({
      data: { customerId: customer.id, azureSubscriptionId: "sub-sku-1", displayName: "Prod" },
    });

    vi.mocked(queryResourceGraph).mockResolvedValue([
      {
        id: "vm-sku-1",
        type: "microsoft.compute/virtualmachines",
        subscriptionId: "sub-sku-1",
        properties: { hardwareProfile: { vmSize: "Standard_A2" } },
      },
    ]);
    vi.mocked(estimateMonthlyCost).mockResolvedValue(30);
    vi.mocked(getAverageCpuPercent).mockResolvedValue(50);
    vi.mocked(getSubscriptionMonthToDateSpend).mockResolvedValue(0);
    vi.mocked(getSubscriptionForecast).mockResolvedValue(0);
    vi.mocked(getSubscriptionDailyCostTrend).mockResolvedValue([]);

    await runScan(subscription.id);

    const findings = await prisma.wasteFinding.findMany({
      where: { subscriptionId: subscription.id },
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      ruleType: "VM_OUTDATED_SKU_GENERATION",
      estimatedMonthlyCost: 30,
      estimatedMonthlySavings: null,
    });
  });

  it("persists a VM_STOPPED_RETAINING_RESOURCES finding for the disk of a deallocated VM", async () => {
    const customer = await prisma.customer.create({
      data: { entraTenantId: "tenant-stopped-1", name: "Acme" },
    });
    const subscription = await prisma.subscription.create({
      data: { customerId: customer.id, azureSubscriptionId: "sub-stopped-1", displayName: "Prod" },
    });

    vi.mocked(queryResourceGraph).mockResolvedValue([
      {
        id: "vm-stopped-1",
        type: "microsoft.compute/virtualmachines",
        subscriptionId: "sub-stopped-1",
        powerState: "PowerState/deallocated",
        properties: {
          storageProfile: {
            osDisk: { managedDisk: { id: "disk-stopped-1" } },
          },
        },
      },
    ]);
    vi.mocked(estimateMonthlyCost).mockResolvedValue(5);
    vi.mocked(getSubscriptionMonthToDateSpend).mockResolvedValue(0);
    vi.mocked(getSubscriptionForecast).mockResolvedValue(0);
    vi.mocked(getSubscriptionDailyCostTrend).mockResolvedValue([]);

    await runScan(subscription.id);

    const findings = await prisma.wasteFinding.findMany({
      where: { subscriptionId: subscription.id },
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      ruleType: "VM_STOPPED_RETAINING_RESOURCES",
      resourceId: "disk-stopped-1",
      savingsCategory: "POTENTIAL_SAVING",
    });
  });

  it("persists the CPU severity metadata on an IDLE_VM finding", async () => {
    const customer = await prisma.customer.create({
      data: { entraTenantId: "tenant-metric-1", name: "Acme" },
    });
    const subscription = await prisma.subscription.create({
      data: { customerId: customer.id, azureSubscriptionId: "sub-metric-1", displayName: "Prod" },
    });

    vi.mocked(queryResourceGraph).mockResolvedValue([
      {
        id: "vm-metric-1",
        type: "microsoft.compute/virtualmachines",
        subscriptionId: "sub-metric-1",
        properties: {},
      },
    ]);
    vi.mocked(estimateMonthlyCost).mockResolvedValue(15);
    vi.mocked(getAverageCpuPercent).mockResolvedValue(2);
    vi.mocked(getSubscriptionMonthToDateSpend).mockResolvedValue(0);
    vi.mocked(getSubscriptionForecast).mockResolvedValue(0);
    vi.mocked(getSubscriptionDailyCostTrend).mockResolvedValue([]);

    await runScan(subscription.id);

    const findings = await prisma.wasteFinding.findMany({
      where: { subscriptionId: subscription.id },
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      ruleType: "IDLE_VM",
      savingsCategory: "HARD_SAVING",
      metricObserved: 2,
      periodAnalyzedDays: 90,
    });
  });

  it("persists a VMSS_NO_AUTOSCALE finding for a VMSS with no autoscale settings", async () => {
    const customer = await prisma.customer.create({
      data: { entraTenantId: "tenant-vmss-1", name: "Acme" },
    });
    const subscription = await prisma.subscription.create({
      data: { customerId: customer.id, azureSubscriptionId: "sub-vmss-1", displayName: "Prod" },
    });

    vi.mocked(queryResourceGraph).mockResolvedValue([
      {
        id: "vmss-1",
        type: "microsoft.compute/virtualmachinescalesets",
        subscriptionId: "sub-vmss-1",
        sku: { name: "Standard_D2s_v5", capacity: 3 },
        properties: {},
      },
    ]);
    vi.mocked(estimateMonthlyCost).mockResolvedValue(90);
    vi.mocked(getAverageCpuPercent).mockResolvedValue(50);
    vi.mocked(getSubscriptionMonthToDateSpend).mockResolvedValue(0);
    vi.mocked(getSubscriptionForecast).mockResolvedValue(0);
    vi.mocked(getSubscriptionDailyCostTrend).mockResolvedValue([]);

    await runScan(subscription.id);

    const findings = await prisma.wasteFinding.findMany({
      where: { subscriptionId: subscription.id },
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      ruleType: "VMSS_NO_AUTOSCALE",
      resourceId: "vmss-1",
      savingsCategory: "POTENTIAL_SAVING",
      estimatedMonthlyCost: 90,
      estimatedMonthlySavings: null,
    });
  });

  it("persists a VMSS_IDLE_LOW_UTILIZATION finding using the aggregated VMSS-level CPU metric", async () => {
    const customer = await prisma.customer.create({
      data: { entraTenantId: "tenant-vmss-2", name: "Acme" },
    });
    const subscription = await prisma.subscription.create({
      data: { customerId: customer.id, azureSubscriptionId: "sub-vmss-2", displayName: "Prod" },
    });

    vi.mocked(queryResourceGraph).mockResolvedValue([
      {
        id: "vmss-2",
        type: "microsoft.compute/virtualmachinescalesets",
        subscriptionId: "sub-vmss-2",
        sku: { name: "Standard_D2s_v5", capacity: 2 },
        properties: {},
      },
    ]);
    vi.mocked(estimateMonthlyCost).mockResolvedValue(60);
    vi.mocked(getAverageCpuPercent).mockResolvedValue(2);
    vi.mocked(getSubscriptionMonthToDateSpend).mockResolvedValue(0);
    vi.mocked(getSubscriptionForecast).mockResolvedValue(0);
    vi.mocked(getSubscriptionDailyCostTrend).mockResolvedValue([]);

    await runScan(subscription.id);

    const findings = await prisma.wasteFinding.findMany({
      where: { subscriptionId: subscription.id, ruleType: "VMSS_IDLE_LOW_UTILIZATION" },
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      savingsCategory: "HARD_SAVING",
      metricObserved: 2,
      periodAnalyzedDays: 90,
      estimatedMonthlySavings: 60,
    });
  });

  it("persists a VMSS_NONPROD_NO_SCHEDULE finding with savings from the observed idle-hours fraction", async () => {
    const customer = await prisma.customer.create({
      data: { entraTenantId: "tenant-vmss-3", name: "Acme" },
    });
    const subscription = await prisma.subscription.create({
      data: { customerId: customer.id, azureSubscriptionId: "sub-vmss-3", displayName: "Prod" },
    });

    vi.mocked(queryResourceGraph).mockResolvedValue([
      {
        id: "vmss-dev-3",
        type: "microsoft.compute/virtualmachinescalesets",
        subscriptionId: "sub-vmss-3",
        sku: { name: "Standard_D2s_v5", capacity: 1 },
        properties: {},
      },
    ]);
    vi.mocked(estimateMonthlyCost).mockResolvedValue(100);
    vi.mocked(getAverageCpuPercent).mockResolvedValue(50);
    vi.mocked(getHourlyCpuBelowThreshold).mockResolvedValue(0.6);
    vi.mocked(getSubscriptionMonthToDateSpend).mockResolvedValue(0);
    vi.mocked(getSubscriptionForecast).mockResolvedValue(0);
    vi.mocked(getSubscriptionDailyCostTrend).mockResolvedValue([]);

    await runScan(subscription.id);

    const findings = await prisma.wasteFinding.findMany({
      where: { subscriptionId: subscription.id, ruleType: "VMSS_NONPROD_NO_SCHEDULE" },
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      estimatedMonthlyCost: 100,
      estimatedMonthlySavings: 60,
    });
  });

  it("persists a VMSS_MISSING_SAVINGS_PLAN_OR_RESERVATION finding using the reservation recommendation savings", async () => {
    const customer = await prisma.customer.create({
      data: { entraTenantId: "tenant-vmss-4", name: "Acme" },
    });
    const subscription = await prisma.subscription.create({
      data: { customerId: customer.id, azureSubscriptionId: "sub-vmss-4", displayName: "Prod" },
    });

    vi.mocked(queryResourceGraph).mockResolvedValue([
      {
        id: "vmss-4",
        type: "microsoft.compute/virtualmachinescalesets",
        subscriptionId: "sub-vmss-4",
        location: "eastus",
        sku: { name: "Standard_D2s_v5", capacity: 2 },
        properties: { virtualMachineProfile: { hardwareProfile: { vmSize: "Standard_D2s_v5" } } },
      },
    ]);
    vi.mocked(estimateMonthlyCost).mockResolvedValue(150);
    vi.mocked(getAverageCpuPercent).mockResolvedValue(50);
    vi.mocked(listReservationRecommendations).mockResolvedValue([
      {
        properties: {
          skuName: "Standard_D2s_v5",
          location: "eastus",
          recommendedQuantity: 1,
          netSavings: 45,
        },
      },
    ]);
    vi.mocked(estimateReservationCoverageMonthlySavings).mockResolvedValue(45);
    vi.mocked(getSubscriptionMonthToDateSpend).mockResolvedValue(0);
    vi.mocked(getSubscriptionForecast).mockResolvedValue(0);
    vi.mocked(getSubscriptionDailyCostTrend).mockResolvedValue([]);

    await runScan(subscription.id);

    const findings = await prisma.wasteFinding.findMany({
      where: {
        subscriptionId: subscription.id,
        ruleType: "VMSS_MISSING_SAVINGS_PLAN_OR_RESERVATION",
      },
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      resourceId: "vmss-4",
      estimatedMonthlyCost: 150,
      estimatedMonthlySavings: 45,
    });
  });

  it("excludes VMSS instance child rows from the persisted Resource table, while still using them in-memory for VMSS_OUTDATED_MODEL_INSTANCES", async () => {
    const customer = await prisma.customer.create({
      data: { entraTenantId: "tenant-vmss-instances", name: "Acme" },
    });
    const subscription = await prisma.subscription.create({
      data: {
        customerId: customer.id,
        azureSubscriptionId: "sub-vmss-instances",
        displayName: "Prod",
      },
    });

    vi.mocked(queryResourceGraph).mockResolvedValue([
      {
        id: "/subscriptions/sub-vmss-instances/vmss-instances-1",
        type: "microsoft.compute/virtualmachinescalesets",
        subscriptionId: "sub-vmss-instances",
        sku: { name: "Standard_D2s_v5", capacity: 1 },
        properties: {},
      },
      {
        id: "/subscriptions/sub-vmss-instances/vmss-instances-1/virtualMachines/0",
        type: "microsoft.compute/virtualmachinescalesets/virtualmachines",
        subscriptionId: "sub-vmss-instances",
        properties: { latestModelApplied: false },
      },
      {
        id: "/subscriptions/sub-vmss-instances/vmss-instances-1/virtualMachines/1",
        type: "Microsoft.Compute/virtualMachineScaleSets/virtualMachines",
        subscriptionId: "sub-vmss-instances",
        properties: { latestModelApplied: true },
      },
    ]);
    vi.mocked(estimateMonthlyCost).mockResolvedValue(10);
    vi.mocked(getAverageCpuPercent).mockResolvedValue(50);
    vi.mocked(getSubscriptionMonthToDateSpend).mockResolvedValue(0);
    vi.mocked(getSubscriptionForecast).mockResolvedValue(0);
    vi.mocked(getSubscriptionDailyCostTrend).mockResolvedValue([]);

    await runScan(subscription.id);

    const persistedResources = await prisma.resource.findMany({
      where: { subscriptionId: subscription.id },
    });
    expect(persistedResources).toHaveLength(1);
    expect(persistedResources[0].type.toLowerCase()).toBe(
      "microsoft.compute/virtualmachinescalesets",
    );

    const findings = await prisma.wasteFinding.findMany({
      where: { subscriptionId: subscription.id, ruleType: "VMSS_OUTDATED_MODEL_INSTANCES" },
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].resourceId).toBe("/subscriptions/sub-vmss-instances/vmss-instances-1");
  });

  it("does not fail the whole scan when the VMSS idle-utilization rule throws", async () => {
    const customer = await prisma.customer.create({
      data: { entraTenantId: "tenant-vmss-5", name: "Acme" },
    });
    const subscription = await prisma.subscription.create({
      data: { customerId: customer.id, azureSubscriptionId: "sub-vmss-5", displayName: "Prod" },
    });

    vi.mocked(queryResourceGraph).mockResolvedValue([
      {
        id: "disk-vmss-5",
        type: "microsoft.compute/disks",
        subscriptionId: "sub-vmss-5",
        properties: { diskState: "Unattached" },
      },
      {
        id: "vmss-5",
        type: "microsoft.compute/virtualmachinescalesets",
        subscriptionId: "sub-vmss-5",
        sku: { name: "Standard_D2s_v5", capacity: 1 },
        properties: {},
      },
    ]);
    vi.mocked(estimateMonthlyCost).mockResolvedValue(9.99);
    vi.mocked(getAverageCpuPercent).mockRejectedValue(new Error("Azure Monitor throttled"));
    vi.mocked(getSubscriptionMonthToDateSpend).mockResolvedValue(0);
    vi.mocked(getSubscriptionForecast).mockResolvedValue(0);
    vi.mocked(getSubscriptionDailyCostTrend).mockResolvedValue([]);

    await runScan(subscription.id);

    const scanRun = await prisma.scanRun.findFirstOrThrow({
      where: { subscriptionId: subscription.id },
    });
    expect(scanRun.status).toBe("SUCCEEDED");

    const findings = await prisma.wasteFinding.findMany({
      where: { subscriptionId: subscription.id },
    });
    // vmss-5 has no autoscale settings, so VMSS_NO_AUTOSCALE (a synchronous rule,
    // unaffected by the Monitor throttling) legitimately fires alongside ORPHANED_DISK.
    // The point of this test is that the throwing async idle-utilization rule does not
    // crash the scan and does not itself produce a VMSS_IDLE_LOW_UTILIZATION finding.
    expect(findings.map((f) => f.ruleType).sort()).toEqual(["ORPHANED_DISK", "VMSS_NO_AUTOSCALE"]);
    expect(findings.some((f) => f.ruleType === "VMSS_IDLE_LOW_UTILIZATION")).toBe(false);
  });
});
