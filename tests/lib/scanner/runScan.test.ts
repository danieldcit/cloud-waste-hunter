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
  getAverageDiskIops: vi.fn(),
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
  estimatePremiumDiskDowngradeMonthlySavings: vi.fn(),
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
vi.mock("@/lib/waste-rules/vmSkuSuggestion", () => ({
  suggestVmSku: vi.fn(),
}));
vi.mock("@/lib/waste-rules/diskTierSuggestion", () => ({
  suggestDiskTier: vi.fn(),
}));
vi.mock("@/lib/ai/findingExplainer", () => ({
  explainFinding: vi.fn(),
}));

import { queryResourceGraph } from "@/lib/azure/resourceGraph";
import { estimateMonthlyCost } from "@/lib/azure/costManagement";
import { getAverageCpuPercent, getHourlyCpuBelowThreshold, getAverageDiskIops } from "@/lib/azure/monitorMetrics";
import {
  estimateRetailMonthlyCost,
  estimateHybridBenefitMonthlySavings,
  estimateLinuxByolMonthlySavings,
  estimatePremiumDiskDowngradeMonthlySavings,
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
import { suggestVmSku } from "@/lib/waste-rules/vmSkuSuggestion";
import { suggestDiskTier } from "@/lib/waste-rules/diskTierSuggestion";
import { explainFinding } from "@/lib/ai/findingExplainer";
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

  it("includes the AVD category-3 resource types", async () => {
    const { COMBINED_QUERY_TYPES } = await import("@/lib/scanner/runScan");
    expect(COMBINED_QUERY_TYPES).toEqual(
      expect.arrayContaining([
        "microsoft.desktopvirtualization/hostpools",
        "microsoft.desktopvirtualization/hostpools/sessionhosts",
        "microsoft.desktopvirtualization/scalingplans",
      ]),
    );
  });

  it("includes the disk category-4 image resource types", async () => {
    const { COMBINED_QUERY_TYPES } = await import("@/lib/scanner/runScan");
    expect(COMBINED_QUERY_TYPES).toEqual(
      expect.arrayContaining([
        "microsoft.compute/images",
        "microsoft.compute/galleries/images/versions",
      ]),
    );
  });

  it("includes the FinOps categories 21-33 resource types", async () => {
    const { COMBINED_QUERY_TYPES } = await import("@/lib/scanner/runScan");
    expect(COMBINED_QUERY_TYPES).toEqual(
      expect.arrayContaining([
        "microsoft.devices/iothubs/devices/modules",
        "microsoft.datafactory/factories",
        "microsoft.databricks/workspaces",
        "microsoft.synapse/workspaces",
        "microsoft.fabric/capacities",
        "microsoft.streamanalytics/streamingjobs",
        "microsoft.eventhub/namespaces",
        "microsoft.servicebus/namespaces",
        "microsoft.storage/storageaccounts/queueservices/queues",
        "microsoft.cdn/profiles",
        "microsoft.apimanagement/service",
        "microsoft.logic/workflows",
        "microsoft.automation/automationaccounts",
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

  it("uses the previous cost snapshot for an anchored anomaly finding", async () => {
    const customer = await prisma.customer.create({
      data: { entraTenantId: "tenant-anomaly", name: "Anomaly" },
    });
    const subscription = await prisma.subscription.create({
      data: { customerId: customer.id, azureSubscriptionId: "sub-anomaly", displayName: "Prod" },
    });
    await prisma.costSnapshot.create({
      data: {
        subscriptionId: subscription.id,
        monthToDateSpend: 100,
        projectedSpend: 120,
        dailyTrend: [
          { date: "2026-09-01", cost: 10 },
          { date: "2026-09-02", cost: 11 },
          { date: "2026-09-03", cost: 30 },
        ],
      },
    });

    vi.mocked(queryResourceGraph).mockResolvedValue([
      {
        id: "vm-anomaly-anchor",
        type: "microsoft.compute/virtualmachines",
        subscriptionId: "sub-anomaly",
        properties: { hardwareProfile: { vmSize: "Standard_B2s" } },
        tags: { finopsAnomalyDetection: "true" },
      },
    ]);
    vi.mocked(estimateMonthlyCost).mockResolvedValue(25);

    await runScan(subscription.id);

    const finding = await prisma.wasteFinding.findFirstOrThrow({
      where: { subscriptionId: subscription.id, ruleType: "COST_ANOMALY_DETECTED" },
    });
    expect(finding).toMatchObject({
      resourceId: "vm-anomaly-anchor",
      metricObserved: 30 / 10.5,
      periodAnalyzedDays: 3,
      estimatedMonthlySavings: null,
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

  it("closes an OPEN finding whose resource/rule no longer appears in a later scan, marking it RESOLVED with resolvedAt set", async () => {
    const customer = await prisma.customer.create({
      data: { entraTenantId: "tenant-7", name: "Resolved" },
    });
    const subscription = await prisma.subscription.create({
      data: { customerId: customer.id, azureSubscriptionId: "sub-7", displayName: "Resolved" },
    });

    vi.mocked(queryResourceGraph).mockResolvedValue([
      {
        id: "disk-7",
        type: "microsoft.compute/disks",
        subscriptionId: "sub-7",
        properties: { diskState: "Unattached" },
      },
    ]);
    vi.mocked(estimateMonthlyCost).mockResolvedValue(9.99);
    await runScan(subscription.id);

    const finding = await prisma.wasteFinding.findFirstOrThrow({
      where: { subscriptionId: subscription.id, resourceId: "disk-7" },
    });
    expect(finding.status).toBe("OPEN");

    // disk-7 is gone, but the subscription still has resources (so visibility was not
    // lost) and no rule degraded — the only conditions under which auto-resolve fires.
    vi.mocked(queryResourceGraph).mockResolvedValue([
      {
        id: "disk-7-other",
        type: "microsoft.compute/disks",
        subscriptionId: "sub-7",
        properties: { diskState: "Unattached" },
      },
    ]);
    await runScan(subscription.id);

    const updatedFinding = await prisma.wasteFinding.findUniqueOrThrow({
      where: { id: finding.id },
    });
    expect(updatedFinding.status).toBe("RESOLVED");
    expect(updatedFinding.resolvedAt).not.toBeNull();
  });

  it("leaves an OPEN finding untouched when the rule that would have judged it degraded this scan", async () => {
    const customer = await prisma.customer.create({
      data: { entraTenantId: "tenant-degraded", name: "DegradedRule" },
    });
    const subscription = await prisma.subscription.create({
      data: {
        customerId: customer.id,
        azureSubscriptionId: "sub-degraded",
        displayName: "DegradedRule",
      },
    });

    vi.mocked(queryResourceGraph).mockResolvedValue([
      {
        id: "vm-degraded",
        type: "microsoft.compute/virtualmachines",
        subscriptionId: "sub-degraded",
        properties: {},
      },
    ]);
    vi.mocked(estimateMonthlyCost).mockResolvedValue(15);
    vi.mocked(getAverageCpuPercent).mockResolvedValue(1);
    vi.mocked(getSubscriptionMonthToDateSpend).mockResolvedValue(0);
    vi.mocked(getSubscriptionForecast).mockResolvedValue(0);
    vi.mocked(getSubscriptionDailyCostTrend).mockResolvedValue([]);

    await runScan(subscription.id);

    const finding = await prisma.wasteFinding.findFirstOrThrow({
      where: { subscriptionId: subscription.id, ruleType: "IDLE_VM" },
    });
    expect(finding.status).toBe("OPEN");

    // vm-degraded is gone from Resource Graph, and the idle-VM rule throws on the VM that
    // is still there — so the rule degrades to [] for the whole scan. Its silence about
    // vm-degraded is a symptom of the throttling, not evidence anyone fixed anything,
    // so the finding must stay OPEN.
    vi.mocked(queryResourceGraph).mockResolvedValue([
      {
        id: "vm-degraded-other",
        type: "microsoft.compute/virtualmachines",
        subscriptionId: "sub-degraded",
        properties: {},
      },
    ]);
    vi.mocked(getAverageCpuPercent).mockRejectedValue(new Error("Azure Monitor throttled"));

    await runScan(subscription.id);

    const updatedFinding = await prisma.wasteFinding.findUniqueOrThrow({
      where: { id: finding.id },
    });
    expect(updatedFinding.status).toBe("OPEN");
    expect(updatedFinding.resolvedAt).toBeNull();
  });

  it("resolves nothing when Resource Graph returns no resources at all (lost visibility, not a cleanup)", async () => {
    const customer = await prisma.customer.create({
      data: { entraTenantId: "tenant-novis", name: "NoVisibility" },
    });
    const subscription = await prisma.subscription.create({
      data: {
        customerId: customer.id,
        azureSubscriptionId: "sub-novis",
        displayName: "NoVisibility",
      },
    });

    vi.mocked(queryResourceGraph).mockResolvedValue([
      {
        id: "disk-novis-1",
        type: "microsoft.compute/disks",
        subscriptionId: "sub-novis",
        properties: { diskState: "Unattached" },
      },
      {
        id: "pip-novis-1",
        type: "microsoft.network/publicipaddresses",
        subscriptionId: "sub-novis",
        properties: {},
      },
    ]);
    vi.mocked(estimateMonthlyCost).mockResolvedValue(9.99);
    vi.mocked(getSubscriptionMonthToDateSpend).mockResolvedValue(0);
    vi.mocked(getSubscriptionForecast).mockResolvedValue(0);
    vi.mocked(getSubscriptionDailyCostTrend).mockResolvedValue([]);

    await runScan(subscription.id);

    const openBefore = await prisma.wasteFinding.findMany({
      where: { subscriptionId: subscription.id, status: "OPEN" },
    });
    expect(openBefore.length).toBeGreaterThan(0);

    // A lapsed Lighthouse delegation looks exactly like this: a successful query with
    // zero rows back. Nothing may be resolved on the strength of it.
    vi.mocked(queryResourceGraph).mockResolvedValue([]);
    await runScan(subscription.id);

    const findingsAfter = await prisma.wasteFinding.findMany({
      where: { subscriptionId: subscription.id },
    });
    expect(findingsAfter).toHaveLength(openBefore.length);
    expect(findingsAfter.every((f) => f.status === "OPEN")).toBe(true);
    expect(findingsAfter.every((f) => f.resolvedAt === null)).toBe(true);
  });

  it("does not touch a DISMISSED finding when its resource/rule no longer appears in a later scan", async () => {
    const customer = await prisma.customer.create({
      data: { entraTenantId: "tenant-8", name: "DismissedThenGone" },
    });
    const subscription = await prisma.subscription.create({
      data: { customerId: customer.id, azureSubscriptionId: "sub-8", displayName: "DismissedThenGone" },
    });

    vi.mocked(queryResourceGraph).mockResolvedValue([
      {
        id: "disk-8",
        type: "microsoft.compute/disks",
        subscriptionId: "sub-8",
        properties: { diskState: "Unattached" },
      },
    ]);
    vi.mocked(estimateMonthlyCost).mockResolvedValue(9.99);
    await runScan(subscription.id);

    const finding = await prisma.wasteFinding.findFirstOrThrow({
      where: { subscriptionId: subscription.id, resourceId: "disk-8" },
    });
    await prisma.wasteFinding.update({
      where: { id: finding.id },
      data: { status: "DISMISSED" },
    });

    vi.mocked(queryResourceGraph).mockResolvedValue([]);
    await runScan(subscription.id);

    const updatedFinding = await prisma.wasteFinding.findUniqueOrThrow({
      where: { id: finding.id },
    });
    expect(updatedFinding.status).toBe("DISMISSED");
    expect(updatedFinding.resolvedAt).toBeNull();
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

  it("persists suggestedActionSummary for an IDLE_VM finding when suggestVmSku returns a suggestion", async () => {
    const customer = await prisma.customer.create({ data: { entraTenantId: "tenant-tt-1", name: "Tooltips" } });
    const subscription = await prisma.subscription.create({
      data: { customerId: customer.id, azureSubscriptionId: "sub-tt-1", displayName: "Tooltips" },
    });

    vi.mocked(queryResourceGraph).mockResolvedValue([
      {
        id: "vm-tt-1",
        type: "microsoft.compute/virtualmachines",
        subscriptionId: "sub-tt-1",
        properties: { hardwareProfile: { vmSize: "Standard_D2s_v3" } },
      },
    ]);
    vi.mocked(estimateMonthlyCost).mockResolvedValue(100);
    vi.mocked(suggestVmSku).mockResolvedValue({ skuName: "Standard_B2ms", monthlySavings: 42 });
    vi.mocked(explainFinding).mockResolvedValue(null);

    await runScan(subscription.id);

    const finding = await prisma.wasteFinding.findFirstOrThrow({
      where: { subscriptionId: subscription.id, resourceId: "vm-tt-1", ruleType: "IDLE_VM" },
    });
    expect(finding.suggestedActionSummary).toContain(
      "reduza o consumo para Standard_B2ms (economia estimada de $42.00/mês) e desligue a VM/VMSS quando não houver carga.",
    );
  });

  it("keeps a single-sentence fallback suggestion when suggestVmSku returns null", async () => {
    const customer = await prisma.customer.create({ data: { entraTenantId: "tenant-tt-2", name: "Tooltips2" } });
    const subscription = await prisma.subscription.create({
      data: { customerId: customer.id, azureSubscriptionId: "sub-tt-2", displayName: "Tooltips2" },
    });

    vi.mocked(queryResourceGraph).mockResolvedValue([
      {
        id: "vm-tt-2",
        type: "microsoft.compute/virtualmachines",
        subscriptionId: "sub-tt-2",
        properties: { hardwareProfile: { vmSize: "Standard_D2s_v3" } },
      },
    ]);
    vi.mocked(estimateMonthlyCost).mockResolvedValue(100);
    vi.mocked(suggestVmSku).mockResolvedValue(null);
    vi.mocked(explainFinding).mockResolvedValue(null);

    await runScan(subscription.id);

    const finding = await prisma.wasteFinding.findFirstOrThrow({
      where: { subscriptionId: subscription.id, resourceId: "vm-tt-2", ruleType: "IDLE_VM" },
    });
    expect(finding.suggestedActionSummary).toContain(
      "reduza o consumo do recurso quando a carga permitir e desligue a VM/VMSS quando não houver carga.",
    );
  });

  it("persists tooltipExplanation for any rule when explainFinding returns text", async () => {
    const customer = await prisma.customer.create({ data: { entraTenantId: "tenant-tt-3", name: "Tooltips3" } });
    const subscription = await prisma.subscription.create({
      data: { customerId: customer.id, azureSubscriptionId: "sub-tt-3", displayName: "Tooltips3" },
    });

    vi.mocked(queryResourceGraph).mockResolvedValue([
      { id: "disk-tt-3", type: "microsoft.compute/disks", subscriptionId: "sub-tt-3", properties: { diskState: "Unattached" } },
    ]);
    vi.mocked(estimateMonthlyCost).mockResolvedValue(9.99);
    vi.mocked(explainFinding).mockResolvedValue("Este disco não está anexado a nenhuma VM.");

    await runScan(subscription.id);

    const finding = await prisma.wasteFinding.findFirstOrThrow({
      where: { subscriptionId: subscription.id, resourceId: "disk-tt-3", ruleType: "ORPHANED_DISK" },
    });
    expect(finding.tooltipExplanation).toBe("Este disco não está anexado a nenhuma VM.");
  });

  it("persists suggestedActionSummary for a VMSS_IDLE_LOW_UTILIZATION finding using the nested virtualMachineProfile shape", async () => {
    const customer = await prisma.customer.create({ data: { entraTenantId: "tenant-tt-4", name: "Tooltips4" } });
    const subscription = await prisma.subscription.create({
      data: { customerId: customer.id, azureSubscriptionId: "sub-tt-4", displayName: "Tooltips4" },
    });

    vi.mocked(queryResourceGraph).mockResolvedValue([
      {
        id: "vmss-tt-4",
        type: "microsoft.compute/virtualmachinescalesets",
        subscriptionId: "sub-tt-4",
        sku: { name: "Standard_D2s_v3", capacity: 2 },
        properties: {
          virtualMachineProfile: {
            hardwareProfile: { vmSize: "Standard_D2s_v3" },
            storageProfile: { osDisk: { osType: "Linux" } },
          },
        },
      },
    ]);
    vi.mocked(estimateMonthlyCost).mockResolvedValue(100);
    vi.mocked(getAverageCpuPercent).mockResolvedValue(2);
    vi.mocked(suggestVmSku).mockResolvedValue({ skuName: "Standard_B2ms", monthlySavings: 42 });
    vi.mocked(explainFinding).mockResolvedValue(null);

    await runScan(subscription.id);

    const finding = await prisma.wasteFinding.findFirstOrThrow({
      where: { subscriptionId: subscription.id, resourceId: "vmss-tt-4", ruleType: "VMSS_IDLE_LOW_UTILIZATION" },
    });
    expect(finding.suggestedActionSummary).toContain(
      "reduza o consumo para Standard_B2ms (economia estimada de $42.00/mês) e desligue a VM/VMSS quando não houver carga.",
    );
  });

  it("persists suggestedActionSummary for a DISK_TIER_OVERSIZED finding when suggestDiskTier returns a suggestion", async () => {
    const customer = await prisma.customer.create({ data: { entraTenantId: "tenant-tt-5", name: "Tooltips5" } });
    const subscription = await prisma.subscription.create({
      data: { customerId: customer.id, azureSubscriptionId: "sub-tt-5", displayName: "Tooltips5" },
    });

    vi.mocked(queryResourceGraph).mockResolvedValue([
      {
        id: "disk-tt-5",
        type: "microsoft.compute/disks",
        subscriptionId: "sub-tt-5",
        sku: { name: "Premium_LRS" },
        // diskSizeGB=1024 -> maxIops 5000, threshold 5000*0.2=1000; avgIops 600 trips
        // DISK_TIER_OVERSIZED (600 < 1000) but stays above DISK_PREMIUM_TIER_UNNECESSARY's flat
        // 500-IOPS threshold, so only DISK_TIER_OVERSIZED fires for this resource.
        properties: { diskState: "Attached", diskSizeGB: 1024 },
      },
    ]);
    vi.mocked(getAverageDiskIops).mockResolvedValue(600);
    vi.mocked(estimateMonthlyCost).mockResolvedValue(50);
    vi.mocked(suggestDiskTier).mockResolvedValue({ suggestedSizeGb: 128, monthlySavings: 30 });
    vi.mocked(explainFinding).mockResolvedValue(null);

    await runScan(subscription.id);

    const finding = await prisma.wasteFinding.findFirstOrThrow({
      where: { subscriptionId: subscription.id, resourceId: "disk-tt-5", ruleType: "DISK_TIER_OVERSIZED" },
    });
    expect(finding.suggestedActionSummary).toContain(
      "reduza o disco para 128 GiB (economia estimada de $30.00/mês) e exclua o disco quando ele não for mais necessário.",
    );
  });

  it("persists suggestedActionSummary for a DISK_PREMIUM_TIER_UNNECESSARY finding via the existing savings-estimation path", async () => {
    const customer = await prisma.customer.create({ data: { entraTenantId: "tenant-tt-6", name: "Tooltips6" } });
    const subscription = await prisma.subscription.create({
      data: { customerId: customer.id, azureSubscriptionId: "sub-tt-6", displayName: "Tooltips6" },
    });

    vi.mocked(queryResourceGraph).mockResolvedValue([
      {
        id: "disk-tt-6",
        type: "microsoft.compute/disks",
        subscriptionId: "sub-tt-6",
        sku: { name: "Premium_LRS" },
        // No diskSizeGB, so DISK_TIER_OVERSIZED skips this disk (sizeGb <= 0) — only
        // DISK_PREMIUM_TIER_UNNECESSARY fires (avgIops 50 < its flat 500-IOPS threshold).
        properties: { diskState: "Attached" },
      },
    ]);
    vi.mocked(getAverageDiskIops).mockResolvedValue(50);
    vi.mocked(estimateMonthlyCost).mockResolvedValue(40);
    vi.mocked(estimatePremiumDiskDowngradeMonthlySavings).mockResolvedValue(15);
    vi.mocked(explainFinding).mockResolvedValue(null);

    await runScan(subscription.id);

    const finding = await prisma.wasteFinding.findFirstOrThrow({
      where: { subscriptionId: subscription.id, resourceId: "disk-tt-6", ruleType: "DISK_PREMIUM_TIER_UNNECESSARY" },
    });
    expect(finding.suggestedActionSummary).toContain(
      "troque para um disco Standard SSD equivalente (economia estimada de $15.00/mês) e exclua o disco quando ele não for mais necessário.",
    );
    expect(suggestVmSku).not.toHaveBeenCalled();
    expect(suggestDiskTier).not.toHaveBeenCalled();
  });

  it("keeps a combined fallback sentence for a DISK_PREMIUM_V2_OVERSIZED finding even without a resize suggestion", async () => {
    const customer = await prisma.customer.create({ data: { entraTenantId: "tenant-tt-7", name: "Tooltips7" } });
    const subscription = await prisma.subscription.create({
      data: { customerId: customer.id, azureSubscriptionId: "sub-tt-7", displayName: "Tooltips7" },
    });

    vi.mocked(queryResourceGraph).mockResolvedValue([
      {
        id: "disk-tt-7",
        type: "microsoft.compute/disks",
        subscriptionId: "sub-tt-7",
        sku: { name: "PremiumV2_LRS" },
        // configuredIops 9000 > 3000-IOPS included baseline, and >= avgIops(100) * 3 -> triggers.
        properties: { diskState: "Attached", diskIOPSReadWrite: 9000 },
      },
    ]);
    vi.mocked(getAverageDiskIops).mockResolvedValue(100);
    vi.mocked(estimateMonthlyCost).mockResolvedValue(60);
    vi.mocked(explainFinding).mockResolvedValue(null);

    await runScan(subscription.id);

    const finding = await prisma.wasteFinding.findFirstOrThrow({
      where: { subscriptionId: subscription.id, resourceId: "disk-tt-7", ruleType: "DISK_PREMIUM_V2_OVERSIZED" },
    });
    expect(finding.suggestedActionSummary).toContain(
      "reduza o consumo do recurso quando a carga permitir e exclua o recurso quando ele não for mais necessário.",
    );
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

  it("persists an AVD_SESSION_HOST_LOW_UTILIZATION finding end to end", async () => {
    const customer = await prisma.customer.create({
      data: { entraTenantId: "tenant-avd-1", name: "Acme" },
    });
    const subscription = await prisma.subscription.create({
      data: { customerId: customer.id, azureSubscriptionId: "sub-avd-1", displayName: "Prod" },
    });

    vi.mocked(queryResourceGraph).mockResolvedValue([
      {
        id: "/subscriptions/sub-avd-1/hostPools/pool-1/sessionHosts/host-1.contoso.com",
        type: "microsoft.desktopvirtualization/hostpools/sessionhosts",
        subscriptionId: "sub-avd-1",
        properties: { sessions: 0, status: "Available" },
      },
    ]);
    vi.mocked(estimateMonthlyCost).mockResolvedValue(90);
    vi.mocked(getSubscriptionMonthToDateSpend).mockResolvedValue(0);
    vi.mocked(getSubscriptionForecast).mockResolvedValue(0);
    vi.mocked(getSubscriptionDailyCostTrend).mockResolvedValue([]);

    await runScan(subscription.id);

    const findings = await prisma.wasteFinding.findMany({
      where: { subscriptionId: subscription.id, ruleType: "AVD_SESSION_HOST_LOW_UTILIZATION" },
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      resourceId: "/subscriptions/sub-avd-1/hostPools/pool-1/sessionHosts/host-1.contoso.com",
      estimatedMonthlyCost: 90,
      estimatedMonthlySavings: 90,
    });
  });

  it("persists an AVD_SCALING_PLAN_MISSING finding for a Pooled host pool with no scaling plan", async () => {
    const customer = await prisma.customer.create({
      data: { entraTenantId: "tenant-avd-2", name: "Acme" },
    });
    const subscription = await prisma.subscription.create({
      data: { customerId: customer.id, azureSubscriptionId: "sub-avd-2", displayName: "Prod" },
    });

    vi.mocked(queryResourceGraph).mockResolvedValue([
      {
        id: "/subscriptions/sub-avd-2/hostPools/pool-2",
        type: "microsoft.desktopvirtualization/hostpools",
        subscriptionId: "sub-avd-2",
        properties: { hostPoolType: "Pooled", maxSessionLimit: 10 },
      },
    ]);
    vi.mocked(estimateMonthlyCost).mockResolvedValue(0);
    vi.mocked(estimateRetailMonthlyCost).mockResolvedValue(0);
    vi.mocked(getSubscriptionMonthToDateSpend).mockResolvedValue(0);
    vi.mocked(getSubscriptionForecast).mockResolvedValue(0);
    vi.mocked(getSubscriptionDailyCostTrend).mockResolvedValue([]);

    await runScan(subscription.id);

    const findings = await prisma.wasteFinding.findMany({
      where: { subscriptionId: subscription.id, ruleType: "AVD_SCALING_PLAN_MISSING" },
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].resourceId).toBe("/subscriptions/sub-avd-2/hostPools/pool-2");
    expect(findings[0].estimatedMonthlySavings).toBeNull();
  });

  it("prices an AVD session host finding against its underlying VM, not the (unbilled) session-host id", async () => {
    const customer = await prisma.customer.create({
      data: { entraTenantId: "tenant-avd-cost", name: "Acme" },
    });
    const subscription = await prisma.subscription.create({
      data: { customerId: customer.id, azureSubscriptionId: "sub-avd-cost", displayName: "Prod" },
    });

    const hostId =
      "/subscriptions/sub-avd-cost/hostPools/pool-cost/sessionHosts/host-1.contoso.com";
    const vmId = "/subscriptions/sub-avd-cost/virtualMachines/host-1";

    vi.mocked(queryResourceGraph).mockResolvedValue([
      {
        id: hostId,
        type: "microsoft.desktopvirtualization/hostpools/sessionhosts",
        subscriptionId: "sub-avd-cost",
        properties: { sessions: 0, status: "Available", resourceId: vmId },
      },
      {
        id: vmId,
        type: "microsoft.compute/virtualmachines",
        subscriptionId: "sub-avd-cost",
        properties: { hardwareProfile: { vmSize: "Standard_D2s_v5" } },
      },
    ]);
    // Nothing is billed under the session host's own id — this is what production returns.
    vi.mocked(estimateMonthlyCost).mockResolvedValue(0);
    vi.mocked(estimateRetailMonthlyCost).mockResolvedValue(75);
    vi.mocked(getSubscriptionMonthToDateSpend).mockResolvedValue(0);
    vi.mocked(getSubscriptionForecast).mockResolvedValue(0);
    vi.mocked(getSubscriptionDailyCostTrend).mockResolvedValue([]);

    await runScan(subscription.id);

    expect(estimateRetailMonthlyCost).toHaveBeenCalledWith(
      expect.objectContaining({ id: vmId, type: "microsoft.compute/virtualmachines" }),
    );

    const findings = await prisma.wasteFinding.findMany({
      where: {
        subscriptionId: subscription.id,
        ruleType: "AVD_SESSION_HOST_LOW_UTILIZATION",
      },
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      resourceId: hostId,
      billedResourceId: vmId,
      estimatedMonthlyCost: 75,
      estimatedMonthlySavings: 75,
    });
  });

  it("sets billedResourceId to the finding's own resourceId for a non-AVD candidate", async () => {
    const customer = await prisma.customer.create({
      data: { entraTenantId: "tenant-billed-plain", name: "Acme" },
    });
    const subscription = await prisma.subscription.create({
      data: { customerId: customer.id, azureSubscriptionId: "sub-billed-plain", displayName: "Prod" },
    });

    const diskId = "/subscriptions/sub-billed-plain/disks/disk-1";

    vi.mocked(queryResourceGraph).mockResolvedValue([
      {
        id: diskId,
        type: "microsoft.compute/disks",
        subscriptionId: "sub-billed-plain",
        properties: { diskState: "Unattached" },
      },
    ]);
    vi.mocked(estimateMonthlyCost).mockResolvedValue(10);
    vi.mocked(getSubscriptionMonthToDateSpend).mockResolvedValue(0);
    vi.mocked(getSubscriptionForecast).mockResolvedValue(0);
    vi.mocked(getSubscriptionDailyCostTrend).mockResolvedValue([]);

    await runScan(subscription.id);

    const findings = await prisma.wasteFinding.findMany({
      where: { subscriptionId: subscription.id, ruleType: "ORPHANED_DISK" },
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      resourceId: diskId,
      billedResourceId: diskId,
    });
  });

  it("persists a SNAPSHOT_ORPHANED_SOURCE finding end to end", async () => {
    const customer = await prisma.customer.create({
      data: { entraTenantId: "tenant-disk-1", name: "Acme" },
    });
    const subscription = await prisma.subscription.create({
      data: { customerId: customer.id, azureSubscriptionId: "sub-disk-1", displayName: "Prod" },
    });

    vi.mocked(queryResourceGraph).mockResolvedValue([
      {
        id: "/subscriptions/sub-disk-1/snapshots/snap-1",
        type: "microsoft.compute/snapshots",
        subscriptionId: "sub-disk-1",
        properties: {
          creationData: { sourceResourceId: "/subscriptions/sub-disk-1/disks/disk-removed" },
        },
      },
    ]);
    vi.mocked(estimateMonthlyCost).mockResolvedValue(4);
    vi.mocked(getSubscriptionMonthToDateSpend).mockResolvedValue(0);
    vi.mocked(getSubscriptionForecast).mockResolvedValue(0);
    vi.mocked(getSubscriptionDailyCostTrend).mockResolvedValue([]);

    await runScan(subscription.id);

    const findings = await prisma.wasteFinding.findMany({
      where: { subscriptionId: subscription.id, ruleType: "SNAPSHOT_ORPHANED_SOURCE" },
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      resourceId: "/subscriptions/sub-disk-1/snapshots/snap-1",
      estimatedMonthlyCost: 4,
      estimatedMonthlySavings: 4,
    });
  });

  it("persists a DISK_IDLE_LOW_UTILIZATION finding (async, IOPS-metric-backed) end to end", async () => {
    const customer = await prisma.customer.create({
      data: { entraTenantId: "tenant-disk-2", name: "Acme" },
    });
    const subscription = await prisma.subscription.create({
      data: { customerId: customer.id, azureSubscriptionId: "sub-disk-2", displayName: "Prod" },
    });

    vi.mocked(queryResourceGraph).mockResolvedValue([
      {
        id: "/subscriptions/sub-disk-2/disks/disk-1",
        type: "microsoft.compute/disks",
        subscriptionId: "sub-disk-2",
        properties: { diskState: "Attached" },
      },
    ]);
    vi.mocked(getAverageDiskIops).mockResolvedValue(0.1);
    vi.mocked(estimateMonthlyCost).mockResolvedValue(20);
    vi.mocked(getSubscriptionMonthToDateSpend).mockResolvedValue(0);
    vi.mocked(getSubscriptionForecast).mockResolvedValue(0);
    vi.mocked(getSubscriptionDailyCostTrend).mockResolvedValue([]);

    await runScan(subscription.id);

    const findings = await prisma.wasteFinding.findMany({
      where: { subscriptionId: subscription.id, ruleType: "DISK_IDLE_LOW_UTILIZATION" },
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      resourceId: "/subscriptions/sub-disk-2/disks/disk-1",
      savingsCategory: "HARD_SAVING",
      estimatedMonthlyCost: 20,
      estimatedMonthlySavings: 20,
    });
  });
});
