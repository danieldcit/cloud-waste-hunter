import type { WasteRuleType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { queryResourceGraph, type ResourceGraphRow } from "@/lib/azure/resourceGraph";
import { estimateMonthlyCost } from "@/lib/azure/costManagement";
import { estimateRetailMonthlyCost } from "@/lib/azure/retailPrices";
import { estimateVmSkuMonthlyCost } from "@/lib/azure/retailPrices";
import {
  getSubscriptionMonthToDateSpend,
  getSubscriptionForecast,
  getSubscriptionDailyCostTrend,
} from "@/lib/azure/subscriptionCost";
import { findOrphanedDisks } from "@/lib/waste-rules/orphanedDisks";
import { findUnassociatedPublicIps } from "@/lib/waste-rules/unassociatedPublicIps";
import { findOldSnapshots } from "@/lib/waste-rules/oldSnapshots";
import { findIdleVpnGateways } from "@/lib/waste-rules/idleVpnGateways";
import { findIdleVirtualMachines } from "@/lib/waste-rules/idleVirtualMachines";
import { findMissingHybridBenefit } from "@/lib/waste-rules/missingHybridBenefit";
import { findMissingLinuxByol } from "@/lib/waste-rules/missingLinuxByol";
import { findOutdatedVmSkus } from "@/lib/waste-rules/outdatedVmSku";
import { findStoppedVmsRetainingResources } from "@/lib/waste-rules/stoppedVmRetainingResources";
import { findVmssWithoutAutoscale } from "@/lib/waste-rules/vmssNoAutoscale";
import { findVmssWithHighMaxInstances } from "@/lib/waste-rules/vmssMaxInstancesHigh";
import { findVmssAutoscaleWithoutScaleIn } from "@/lib/waste-rules/vmssAutoscaleNoScaleIn";
import { findVmssScaleOutMetricInadequate } from "@/lib/waste-rules/vmssScaleOutMetricInadequate";
import { findVmssNonProdWithoutSchedule } from "@/lib/waste-rules/vmssNonProdNoSchedule";
import { findVmssIdleLowUtilization } from "@/lib/waste-rules/vmssIdleLowUtilization";
import { findOutdatedVmssSkus } from "@/lib/waste-rules/vmssOutdatedSku";
import { findVmssOutdatedModelInstances } from "@/lib/waste-rules/vmssOutdatedModelInstances";
import { findVmssSpotEligible } from "@/lib/waste-rules/vmssSpotEligible";
import { findVmssMissingSavingsPlanOrReservation } from "@/lib/waste-rules/vmssMissingSavingsPlanOrReservation";
import {
  findVmMissingCommitmentCoverage,
  findOrphanedNatGateways,
  findDevTestSpotEligible,
  findSchedulesRequiredButMissing,
  findArchitectureReviewCandidates,
  findAutomationExpiredResources,
  findCostAnomalyCandidates,
  findForecastActionableCandidates,
  findUnitEconomicsCandidates,
  findRoiPrioritizationCandidates,
  type CostSnapshotEvidence,
} from "@/lib/waste-rules/finops34To43";
import { findAvdSessionHostLowUtilization } from "@/lib/waste-rules/avdSessionHostLowUtilization";
import { findAvdHostPoolExcessHosts } from "@/lib/waste-rules/avdHostPoolExcessHosts";
import { findAvdHostPoolLowDensity } from "@/lib/waste-rules/avdHostPoolLowDensity";
import { findAvdSessionHostPremiumDiskUnused } from "@/lib/waste-rules/avdSessionHostPremiumDiskUnused";
import { findAvdScalingPlanMissing } from "@/lib/waste-rules/avdScalingPlanMissing";
import { findAvdScalingPlanDisabled } from "@/lib/waste-rules/avdScalingPlanDisabled";
import { findAvdHostRunningOutsideScalingWindow } from "@/lib/waste-rules/avdHostRunningOutsideScalingWindow";
import { findAvdPersonalHostUnused } from "@/lib/waste-rules/avdPersonalHostUnused";
import { findDiskIdleLowUtilization } from "@/lib/waste-rules/diskIdleLowUtilization";
import { findDiskPremiumTierUnnecessary } from "@/lib/waste-rules/diskPremiumTierUnnecessary";
import { findDiskPremiumV2Oversized } from "@/lib/waste-rules/diskPremiumV2Oversized";
import { findDiskTierOversized } from "@/lib/waste-rules/diskTierOversized";
import { findDiskNonProdPremium } from "@/lib/waste-rules/diskNonProdPremium";
import { findSnapshotOrphanedSource } from "@/lib/waste-rules/snapshotOrphanedSource";
import { findSnapshotExcessiveCount } from "@/lib/waste-rules/snapshotExcessiveCount";
import { findImageOrphaned } from "@/lib/waste-rules/imageOrphaned";
import { findGalleryImageVersionOld } from "@/lib/waste-rules/galleryImageVersionOld";
import {
  findAzureFilesPremiumOversized,
  findAzureFilesQuotaOversized,
  findAzureFilesProtectionExcessive,
  findAzureFilesUnusedShares,
  findAzureFilesOldHotTier,
  findAzureFilesCoolTierUnused,
  findAzureFilesDuplicated,
  findAzureFilesFslogixOversized,
  findAzureFilesAlternativeService,
} from "@/lib/waste-rules/azureFiles";
import {
  findStorageAccountsWithRecommendedRedundancy,
  findUnusedStorageAccounts,
} from "@/lib/waste-rules/storageComplementary";
import {
  findBackupVaultsUnused,
  findOrphanedBackupItems,
  findOldRecoveryPoints,
  findExcessiveBackupRetention,
} from "@/lib/waste-rules/backupRecovery";
import {
  findIdleAzureFirewalls,
  findExcessiveEgress,
} from "@/lib/waste-rules/networkAndEgress";
import {
  findOverprovisionedSqlDatabases,
  findOverprovisionedSqlManagedInstances,
  findOverprovisionedFlexibleDatabases,
  findLowUtilizationCosmosDb,
  findLowUtilizationRedisCaches,
} from "@/lib/waste-rules/dataServices";
import {
  findLowUtilizationAksClusters,
  findIdleContainerApps,
  findLowUtilizationAppServices,
  findLowUtilizationFunctions,
} from "@/lib/waste-rules/applicationServices";
import {
  findUnusedMonitorWorkspaces,
  findIdleIoTHubs,
} from "@/lib/waste-rules/monitorAndIot";
import {
  findIdleIoTEdgeResources,
  findIdleDataFactories,
  findIdleDatabricksWorkspaces,
  findIdleSynapseWorkspaces,
  findIdlePowerBiFabricResources,
  findIdleStreamAnalyticsJobs,
  findIdleEventHubs,
  findIdleServiceBusNamespaces,
  findIdleStorageQueues,
  findIdleCdnFrontDoorResources,
  findIdleApiManagementServices,
  findDisabledLogicApps,
  findIdleAutomationAccounts,
} from "@/lib/waste-rules/dataIntegrationServices";
import { isSessionHost, underlyingVm } from "@/lib/waste-rules/avdSessionHosts";
import {
  buildCombinedSuggestionSummary,
  estimateMonthlySavings,
} from "@/lib/waste-rules/savingsEstimate";
import { suggestVmSku } from "@/lib/waste-rules/vmSkuSuggestion";
import { suggestDiskTier } from "@/lib/waste-rules/diskTierSuggestion";
import { buildCatalogRecommendation } from "@/lib/waste-rules/catalogRecommendation";
import { explainFinding, type FindingFacts } from "@/lib/ai/findingExplainer";
import type { WasteFindingCandidate } from "@/lib/waste-rules/types";
import { translate } from "@/lib/i18n/dictionaries";

export const COMBINED_QUERY_TYPES = [
  "microsoft.compute/disks",
  "microsoft.network/publicipaddresses",
  "microsoft.compute/snapshots",
  "microsoft.network/vpngateways",
  "microsoft.network/virtualnetworkgateways",
  "microsoft.network/connections",
  "microsoft.compute/virtualmachines",
  "microsoft.compute/virtualmachinescalesets",
  "microsoft.compute/virtualmachinescalesets/virtualmachines",
  "microsoft.insights/autoscalesettings",
  "microsoft.desktopvirtualization/hostpools",
  "microsoft.desktopvirtualization/hostpools/sessionhosts",
  "microsoft.desktopvirtualization/scalingplans",
  "microsoft.compute/images",
  "microsoft.compute/galleries/images/versions",
  "microsoft.storage/storageaccounts",
  "microsoft.storage/storageaccounts/fileservices/shares",
  "microsoft.recoveryservices/vaults",
  "microsoft.recoveryservices/vaults/backupfabrics/protectioncontainers/protecteditems",
  "microsoft.recoveryservices/vaults/backuppolicies",
  "microsoft.network/azurefirewalls",
  "microsoft.network/natgateways",
  "microsoft.network/networkinterfaces",
  "microsoft.network/networksecuritygroups",
  "microsoft.network/applicationgateways",
  "microsoft.sql/servers/databases",
  "microsoft.sql/managedinstances",
  "microsoft.dbforpostgresql/flexibleservers",
  "microsoft.dbformysql/flexibleservers",
  "microsoft.documentdb/databaseaccounts",
  "microsoft.cache/redis",
  "microsoft.containerservice/managedclusters",
  "microsoft.app/containerapps",
  "microsoft.web/sites",
  "microsoft.operationalinsights/workspaces",
  "microsoft.devices/iothubs",
  "microsoft.devices/iothubs/devices/modules",
  "microsoft.devices/iothubs/edge",
  "microsoft.devices/iothubs/edgemodules",
  "microsoft.datafactory/factories",
  "microsoft.databricks/workspaces",
  "microsoft.synapse/workspaces",
  "microsoft.powerbi/workspaces",
  "microsoft.powerbi/capacities",
  "microsoft.powerbi/tenants/workspaces",
  "microsoft.fabric/capacities",
  "microsoft.streamanalytics/streamingjobs",
  "microsoft.eventhub/namespaces",
  "microsoft.eventhub/namespaces/eventhubs",
  "microsoft.servicebus/namespaces",
  "microsoft.storage/storageaccounts/queues",
  "microsoft.storage/storageaccounts/queueservices/queues",
  "microsoft.cdn/profiles",
  "microsoft.cdn/profiles/endpoints",
  "microsoft.cdn/profiles/afdendpoints",
  "microsoft.network/frontdoors",
  "microsoft.network/frontdoors/frontendendpoints",
  "microsoft.apimanagement/service",
  "microsoft.logic/workflows",
  "microsoft.automation/automationaccounts",
];

const COMBINED_QUERY = `
Resources
| where type in (${COMBINED_QUERY_TYPES.map((t) => `'${t}'`).join(", ")})
| extend powerState = tostring(properties.extended.instanceView.powerState.code)
| project id, type, subscriptionId, location, sku, tags, properties, powerState
`;

async function captureCostSnapshot(
  subscriptionRecordId: string,
  azureSubscriptionId: string,
): Promise<void> {
  try {
    const [mtdResult, forecastResult, trendResult] = await Promise.allSettled([
      getSubscriptionMonthToDateSpend(azureSubscriptionId),
      getSubscriptionForecast(azureSubscriptionId),
      getSubscriptionDailyCostTrend(azureSubscriptionId),
    ]);

    const monthToDateSpend =
      mtdResult.status === "fulfilled" && Number.isFinite(mtdResult.value)
        ? mtdResult.value
        : 0;
    const projectedSpend =
      forecastResult.status === "fulfilled" && Number.isFinite(forecastResult.value)
        ? forecastResult.value
        : 0;
    const dailyTrend =
      trendResult.status === "fulfilled" && Array.isArray(trendResult.value)
        ? trendResult.value
        : [];

    if (mtdResult.status === "rejected") {
      console.error(
        `Month-to-date spend fetch failed for subscription ${subscriptionRecordId}`,
        mtdResult.reason,
      );
    }
    if (forecastResult.status === "rejected") {
      console.error(
        `Forecast fetch failed for subscription ${subscriptionRecordId}`,
        forecastResult.reason,
      );
    }
    if (trendResult.status === "rejected") {
      console.error(
        `Daily cost trend fetch failed for subscription ${subscriptionRecordId}`,
        trendResult.reason,
      );
    }

    await prisma.costSnapshot.create({
      data: {
        subscriptionId: subscriptionRecordId,
        monthToDateSpend,
        projectedSpend,
        dailyTrend: dailyTrend as object,
      },
    });
  } catch (error) {
    console.error(
      `Cost snapshot capture failed for subscription ${subscriptionRecordId}; skipping this run`,
      error,
    );
  }
}

/**
 * AVD session hosts carry no billing of their own — Cost Management and the
 * retail-price catalog both price the underlying VM. Resolves the resource
 * that should actually be priced for cost/savings estimation, without
 * changing what resourceId a finding points at.
 */
function resolveCostResource(
  resource: ResourceGraphRow | undefined,
  resources: ResourceGraphRow[],
): ResourceGraphRow | undefined {
  if (resource && isSessionHost(resource)) {
    return underlyingVm(resource, resources) ?? resource;
  }
  return resource;
}

export async function runScan(subscriptionRecordId: string): Promise<void> {
  const subscription = await prisma.subscription.findUniqueOrThrow({
    where: { id: subscriptionRecordId },
  });

  const scanRun = await prisma.scanRun.create({
    data: { subscriptionId: subscription.id, status: "RUNNING" },
  });

  try {
    const resources = await queryResourceGraph(
      [subscription.azureSubscriptionId],
      COMBINED_QUERY,
    );

    await prisma.resource.deleteMany({
      where: { subscriptionId: subscription.id },
    });
    // VMSS instance child rows (can be thousands per large scale set) are never read back from
    // Postgres — only findVmssOutdatedModelInstances uses them, and it reads the in-memory
    // Resource Graph array below, not this audit table. Persisting them here is pure DB write
    // waste at scale, so they're excluded from this table only; `resources` itself is untouched.
    const persistedResources = resources.filter(
      (r) => r.type.toLowerCase() !== "microsoft.compute/virtualmachinescalesets/virtualmachines",
    );
    if (persistedResources.length > 0) {
      await prisma.resource.createMany({
        data: persistedResources.map((r) => ({
          subscriptionId: subscription.id,
          scanRunId: scanRun.id,
          resourceId: r.id,
          type: r.type,
          rawProperties: r.properties as object,
        })),
      });
    }

    // Rules that degraded to `[]` this scan because they threw. A degraded rule
    // produced no candidates for reasons that have nothing to do with the customer
    // fixing anything, so its findings must be excluded from auto-resolve below —
    // otherwise one throttled Azure Monitor call silently (and permanently, there is
    // no re-open path) marks every finding of that rule type RESOLVED, fabricating
    // "savings already realized" figures in the customer-facing PDF report.
    const degradedRuleTypes = new Set<WasteRuleType>();
    let previousCostSnapshot: CostSnapshotEvidence | undefined;
    try {
      const snapshot = await prisma.costSnapshot.findFirst({
        where: { subscriptionId: subscription.id },
        orderBy: { capturedAt: "desc" },
      });
      if (snapshot) {
        previousCostSnapshot = {
          capturedAt: snapshot.capturedAt,
          monthToDateSpend: snapshot.monthToDateSpend,
          projectedSpend: snapshot.projectedSpend,
          dailyTrend: snapshot.dailyTrend,
        };
      }
    } catch (error) {
      console.error(
        "Previous cost snapshot could not be loaded; snapshot-based FinOps rules will be skipped",
        error,
      );
    }

    let idleVmCandidates: WasteFindingCandidate[] = [];
    try {
      idleVmCandidates = await findIdleVirtualMachines(resources);
    } catch (error) {
      console.error(
        "Idle VM rule failed; treating as zero idle VMs for this scan",
        error,
      );
      degradedRuleTypes.add("IDLE_VM");
    }

    let idleVmssCandidates: WasteFindingCandidate[] = [];
    try {
      idleVmssCandidates = await findVmssIdleLowUtilization(resources);
    } catch (error) {
      console.error(
        "Idle VMSS rule failed; treating as zero idle VMSS for this scan",
        error,
      );
      degradedRuleTypes.add("VMSS_IDLE_LOW_UTILIZATION");
    }

    let missingReservationCandidates: WasteFindingCandidate[] = [];
    try {
      missingReservationCandidates = await findVmssMissingSavingsPlanOrReservation(resources);
    } catch (error) {
      console.error(
        "VMSS reservation-coverage rule failed; treating as zero findings for this scan",
        error,
      );
      degradedRuleTypes.add("VMSS_MISSING_SAVINGS_PLAN_OR_RESERVATION");
    }

    let vmCommitmentCandidates: WasteFindingCandidate[] = [];
    try {
      vmCommitmentCandidates = await findVmMissingCommitmentCoverage(resources);
    } catch (error) {
      console.error(
        "VM commitment-coverage rule failed; treating as zero findings for this scan",
        error,
      );
      degradedRuleTypes.add("VM_MISSING_COMMITMENT_COVERAGE");
    }

    let costAnomalyCandidates: WasteFindingCandidate[] = [];
    try {
      costAnomalyCandidates = findCostAnomalyCandidates(resources, previousCostSnapshot);
    } catch (error) {
      console.error("Cost anomaly rule failed; treating as zero findings for this scan", error);
      degradedRuleTypes.add("COST_ANOMALY_DETECTED");
    }

    let forecastActionableCandidates: WasteFindingCandidate[] = [];
    try {
      forecastActionableCandidates = findForecastActionableCandidates(
        resources,
        previousCostSnapshot,
      );
    } catch (error) {
      console.error(
        "Forecast actionable rule failed; treating as zero findings for this scan",
        error,
      );
      degradedRuleTypes.add("FORECAST_ACTIONABLE_FINDING");
    }

    let unitEconomicsCandidates: WasteFindingCandidate[] = [];
    try {
      unitEconomicsCandidates = findUnitEconomicsCandidates(resources);
    } catch (error) {
      console.error("Unit economics rule failed; treating as zero findings for this scan", error);
      degradedRuleTypes.add("UNIT_ECONOMICS_REVIEW");
    }

    let roiPrioritizationCandidates: WasteFindingCandidate[] = [];
    try {
      roiPrioritizationCandidates = findRoiPrioritizationCandidates(resources);
    } catch (error) {
      console.error(
        "ROI prioritization rule failed; treating as zero findings for this scan",
        error,
      );
      degradedRuleTypes.add("ROI_PRIORITIZATION");
    }

    let diskIdleCandidates: WasteFindingCandidate[] = [];
    try {
      diskIdleCandidates = await findDiskIdleLowUtilization(resources);
    } catch (error) {
      console.error(
        "Disk idle-utilization rule failed; treating as zero idle disks for this scan",
        error,
      );
      degradedRuleTypes.add("DISK_IDLE_LOW_UTILIZATION");
    }

    let diskPremiumTierCandidates: WasteFindingCandidate[] = [];
    try {
      diskPremiumTierCandidates = await findDiskPremiumTierUnnecessary(resources);
    } catch (error) {
      console.error(
        "Disk premium-tier-unnecessary rule failed; treating as zero findings for this scan",
        error,
      );
      degradedRuleTypes.add("DISK_PREMIUM_TIER_UNNECESSARY");
    }

    let diskPremiumV2Candidates: WasteFindingCandidate[] = [];
    try {
      diskPremiumV2Candidates = await findDiskPremiumV2Oversized(resources);
    } catch (error) {
      console.error(
        "Disk PremiumV2-oversized rule failed; treating as zero findings for this scan",
        error,
      );
      degradedRuleTypes.add("DISK_PREMIUM_V2_OVERSIZED");
    }

    let diskTierOversizedCandidates: WasteFindingCandidate[] = [];
    try {
      diskTierOversizedCandidates = await findDiskTierOversized(resources);
    } catch (error) {
      console.error(
        "Disk tier-oversized rule failed; treating as zero findings for this scan",
        error,
      );
      degradedRuleTypes.add("DISK_TIER_OVERSIZED");
    }

    const candidates: WasteFindingCandidate[] = [
      ...findOrphanedDisks(resources),
      ...findUnassociatedPublicIps(resources),
      ...findOldSnapshots(resources),
      ...findIdleVpnGateways(resources),
      ...idleVmCandidates,
      ...findMissingHybridBenefit(resources),
      ...findMissingLinuxByol(resources),
      ...findOutdatedVmSkus(resources),
      ...findStoppedVmsRetainingResources(resources),
      ...findVmssWithoutAutoscale(resources),
      ...findVmssWithHighMaxInstances(resources),
      ...findVmssAutoscaleWithoutScaleIn(resources),
      ...findVmssScaleOutMetricInadequate(resources),
      ...findVmssNonProdWithoutSchedule(resources),
      ...idleVmssCandidates,
      ...findOutdatedVmssSkus(resources),
      ...findVmssOutdatedModelInstances(resources),
      ...findVmssSpotEligible(resources),
      ...missingReservationCandidates,
      ...vmCommitmentCandidates,
      ...findOrphanedNatGateways(resources),
      ...findDevTestSpotEligible(resources),
      ...findSchedulesRequiredButMissing(resources),
      ...findArchitectureReviewCandidates(resources),
      ...findAutomationExpiredResources(resources),
      ...costAnomalyCandidates,
      ...forecastActionableCandidates,
      ...unitEconomicsCandidates,
      ...roiPrioritizationCandidates,
      ...findAvdSessionHostLowUtilization(resources),
      ...findAvdHostPoolExcessHosts(resources),
      ...findAvdHostPoolLowDensity(resources),
      ...findAvdSessionHostPremiumDiskUnused(resources),
      ...findAvdScalingPlanMissing(resources),
      ...findAvdScalingPlanDisabled(resources),
      ...findAvdHostRunningOutsideScalingWindow(resources),
      ...findAvdPersonalHostUnused(resources),
      ...diskIdleCandidates,
      ...diskPremiumTierCandidates,
      ...diskPremiumV2Candidates,
      ...diskTierOversizedCandidates,
      ...findDiskNonProdPremium(resources),
      ...findSnapshotOrphanedSource(resources),
      ...findSnapshotExcessiveCount(resources),
      ...findImageOrphaned(resources),
      ...findGalleryImageVersionOld(resources),
      ...findAzureFilesUnusedShares(resources),
      ...findAzureFilesPremiumOversized(resources),
      ...findAzureFilesQuotaOversized(resources),
      ...findAzureFilesProtectionExcessive(resources),
      ...findAzureFilesOldHotTier(resources),
      ...findAzureFilesCoolTierUnused(resources),
      ...findAzureFilesDuplicated(resources),
      ...findAzureFilesFslogixOversized(resources),
      ...findAzureFilesAlternativeService(resources),
      ...findUnusedStorageAccounts(resources),
      ...findStorageAccountsWithRecommendedRedundancy(resources),
      ...findBackupVaultsUnused(resources),
      ...findOrphanedBackupItems(resources),
      ...findOldRecoveryPoints(resources),
      ...findExcessiveBackupRetention(resources),
      ...findIdleAzureFirewalls(resources),
      ...findExcessiveEgress(resources),
      ...findOverprovisionedSqlDatabases(resources),
      ...findOverprovisionedSqlManagedInstances(resources),
      ...findOverprovisionedFlexibleDatabases(resources),
      ...findLowUtilizationCosmosDb(resources),
      ...findLowUtilizationRedisCaches(resources),
      ...findLowUtilizationAksClusters(resources),
      ...findIdleContainerApps(resources),
      ...findLowUtilizationAppServices(resources),
      ...findLowUtilizationFunctions(resources),
      ...findUnusedMonitorWorkspaces(resources),
      ...findIdleIoTHubs(resources),
      ...findIdleIoTEdgeResources(resources),
      ...findIdleDataFactories(resources),
      ...findIdleDatabricksWorkspaces(resources),
      ...findIdleSynapseWorkspaces(resources),
      ...findIdlePowerBiFabricResources(resources),
      ...findIdleStreamAnalyticsJobs(resources),
      ...findIdleEventHubs(resources),
      ...findIdleServiceBusNamespaces(resources),
      ...findIdleStorageQueues(resources),
      ...findIdleCdnFrontDoorResources(resources),
      ...findIdleApiManagementServices(resources),
      ...findDisabledLogicApps(resources),
      ...findIdleAutomationAccounts(resources),
    ];

    const resourceById = new Map<string, ResourceGraphRow>(
      resources.map((r) => [r.id, r]),
    );

    for (const candidate of candidates) {
      const resource = resourceById.get(candidate.resourceId);
      const costResource = resolveCostResource(resource, resources);

      let estimatedMonthlyCost = 0;
      try {
        estimatedMonthlyCost = await estimateMonthlyCost(
          subscription.azureSubscriptionId,
          costResource?.id ?? candidate.resourceId,
        );
      } catch (error) {
        console.error(
          `Cost estimation failed for resource ${candidate.resourceId} (rule ${candidate.ruleType}); falling back to retail price estimate`,
          error,
        );
      }

      if (estimatedMonthlyCost === 0 && costResource) {
        try {
          estimatedMonthlyCost = await estimateRetailMonthlyCost(costResource);
        } catch (error) {
          console.error(
            `Retail price fallback failed for resource ${candidate.resourceId} (rule ${candidate.ruleType}); using 0`,
            error,
          );
        }
      }
      if (estimatedMonthlyCost <= 0) {
        console.warn(
          `Skipping finding ${candidate.resourceId} (${candidate.ruleType}): no positive monthly cost was confirmed`,
        );
        continue;
      }
      let estimatedMonthlySavings: number | null = null;
      try {
        estimatedMonthlySavings = await estimateMonthlySavings(
          candidate,
          resource,
          estimatedMonthlyCost,
        );
      } catch (error) {
        console.error(
          `Savings estimation failed for resource ${candidate.resourceId} (rule ${candidate.ruleType}); leaving savings unknown`,
          error,
        );
      }

      let suggestedActionSummary: string | null = null;
      let alternativeName: string | undefined;
      let alternativeMonthlyCost: number | undefined;
      let alternativeMonthlySavings: number | undefined;
      try {
        const resourceTypeLower = resource?.type?.toLowerCase() ?? "";
        const isCompute =
          resourceTypeLower.includes("virtualmachine") ||
          resourceTypeLower.includes("virtualmachinescaleset");
        const isStorage =
          resourceTypeLower.includes("disk") ||
          resourceTypeLower.includes("snapshot") ||
          resourceTypeLower.includes("image") ||
          resourceTypeLower.includes("storageaccounts");

        const reductionActions: string[] = [];
        const complementaryActions: string[] = [];

        if (
          (candidate.ruleType === "IDLE_VM" || candidate.ruleType === "VMSS_IDLE_LOW_UTILIZATION") &&
          resource
        ) {
          const isVmss = candidate.ruleType === "VMSS_IDLE_LOW_UTILIZATION";
          const vmssProfile = resource.properties.virtualMachineProfile as
            | { hardwareProfile?: { vmSize?: string }; storageProfile?: { osDisk?: { osType?: string } } }
            | undefined;
          const hardwareProfile = isVmss
            ? vmssProfile?.hardwareProfile
            : (resource.properties.hardwareProfile as { vmSize?: string } | undefined);
          const storageProfile = isVmss
            ? vmssProfile?.storageProfile
            : (resource.properties.storageProfile as { osDisk?: { osType?: string } } | undefined);
          const vmSize = hardwareProfile?.vmSize;
          if (candidate.metricObserved != null) {
            candidate.metricSummary =
              `CPU: ${candidate.metricObserved.toFixed(2)}%; memória: não disponível no Azure Monitor para esta assinatura; IOPS: não disponível para a VM; throughput: não disponível para a VM`;
          }
          if (vmSize) {
            const suggestion = await suggestVmSku(
              resource,
              subscription.azureSubscriptionId,
              vmSize,
              storageProfile?.osDisk?.osType === "Windows",
            );
            if (suggestion) {
              alternativeName = suggestion.skuName;
              try {
                alternativeMonthlyCost = await estimateVmSkuMonthlyCost(
                  resource.location ?? "eastus",
                  suggestion.skuName,
                  storageProfile?.osDisk?.osType === "Windows",
                );
                const currentRetailCost = await estimateVmSkuMonthlyCost(
                  resource.location ?? "eastus",
                  vmSize,
                  storageProfile?.osDisk?.osType === "Windows",
                );
                if (currentRetailCost > alternativeMonthlyCost) {
                  alternativeMonthlySavings = currentRetailCost - alternativeMonthlyCost;
                }
              } catch (error) {
                console.error(`Azure VM alternative pricing failed for ${candidate.resourceId}`, error);
              }
              reductionActions.push(
                `reduza o consumo para ${suggestion.skuName} (economia estimada de $${suggestion.monthlySavings.toFixed(2)}/mês)`,
              );
            } else {
              reductionActions.push("reduza o consumo do recurso quando a carga permitir");
            }
          } else {
            reductionActions.push("reduza o consumo do recurso quando a carga permitir");
          }
          complementaryActions.push("desligue a VM/VMSS quando não houver carga");
        } else if (candidate.ruleType === "DISK_TIER_OVERSIZED" && resource) {
          const suggestion = await suggestDiskTier(resource);
          if (suggestion) {
            alternativeName = `disco de ${suggestion.suggestedSizeGb} GiB`;
            reductionActions.push(
              `reduza o disco para ${suggestion.suggestedSizeGb} GiB (economia estimada de $${suggestion.monthlySavings.toFixed(2)}/mês)`,
            );
          } else {
            reductionActions.push("reduza o consumo do disco quando a carga permitir");
          }
          complementaryActions.push("exclua o disco quando ele não for mais necessário");
        } else if (candidate.ruleType === "DISK_PREMIUM_TIER_UNNECESSARY") {
          if (estimatedMonthlySavings != null) {
            reductionActions.push(
              `troque para um disco Standard SSD equivalente (economia estimada de $${estimatedMonthlySavings.toFixed(2)}/mês)`,
            );
          } else {
            reductionActions.push("reduza o consumo do disco quando a carga permitir");
          }
          complementaryActions.push("exclua o disco quando ele não for mais necessário");
        } else if (candidate.ruleType === "COST_ANOMALY_DETECTED") {
          reductionActions.push("investigue a variação de custo com os dados do Cost Management antes de alterar recursos");
          complementaryActions.push("confirme a causa e aplique a correção somente após validar a carga");
        } else if (candidate.ruleType === "FORECAST_ACTIONABLE_FINDING") {
          reductionActions.push("revise os principais contribuintes do forecast e o orçamento aprovado");
          complementaryActions.push("ajuste o consumo apenas após confirmar o impacto operacional");
        } else if (candidate.ruleType === "UNIT_ECONOMICS_REVIEW") {
          reductionActions.push("revise o custo por unidade e a capacidade provisionada conforme a meta informada");
          complementaryActions.push("valide a métrica de negócio antes de redimensionar ou desligar o recurso");
        } else if (candidate.ruleType === "ROI_PRIORITIZATION") {
          reductionActions.push("priorize a iniciativa com base no ROI informado e na criticidade do workload");
          complementaryActions.push("confirme o custo de implementação antes de aprovar a mudança");
        } else if (candidate.ruleType === "AZURE_FILES_OLD_HOT_TIER" || candidate.ruleType === "AZURE_FILES_COOL_TIER_UNUSED") {
          reductionActions.push("mova os dados antigos para Cool, Cold ou Archive quando a política de acesso permitir");
          complementaryActions.push("exclua os dados que não forem mais necessários");
        } else if (candidate.ruleType === "AZURE_FILES_DUPLICATED") {
          reductionActions.push("mantenha uma única cópia validada e remova a duplicata após confirmação");
          complementaryActions.push("exclua o File Share duplicado quando ele não for mais necessário");
        } else if (candidate.ruleType === "AZURE_FILES_FSLOGIX_OVERSIZED") {
          reductionActions.push("reduza a quota do FSLogix para a capacidade realmente utilizada");
          complementaryActions.push("remova o share quando o perfil não tiver mais usuários");
        } else if (candidate.ruleType === "AZURE_FILES_ALTERNATIVE_SERVICE_CHEAPER") {
          reductionActions.push("avalie migrar os dados para Blob ou Managed Disk conforme o padrão de acesso");
          complementaryActions.push("exclua o File Share somente após validar a migração");
        } else if (
          candidate.ruleType === "AZURE_FILES_PREMIUM_OVERSIZED" ||
          candidate.ruleType === "AZURE_FILES_QUOTA_OVERSIZED"
        ) {
          reductionActions.push("reduza a quota ou o tier do File Share conforme o uso observado");
          complementaryActions.push("exclua o File Share quando ele não for mais necessário");
        } else if (candidate.ruleType === "AZURE_FILES_PROTECTION_EXCESSIVE") {
          reductionActions.push("reduza a retenção de backup, snapshot ou Soft Delete conforme a política");
          complementaryActions.push("exclua a proteção excedente quando não houver requisito de retenção");
        } else if (candidate.ruleType === "STORAGE_ACCOUNT_UNUSED") {
          reductionActions.push("confirme as dependências e remova o Storage Account explicitamente sem uso");
          complementaryActions.push("valide locks, diagnósticos e requisitos de recuperação antes da remoção");
        } else if (candidate.ruleType === "STORAGE_ACCOUNT_REDUNDANCY_MISMATCH") {
          reductionActions.push("avalie alterar o SKU ou a redundância para a recomendação explícita");
          complementaryActions.push("valide os requisitos de resiliência e o impacto operacional antes da mudança");
        } else if (candidate.ruleType === "BACKUP_VAULT_UNUSED") {
          reductionActions.push("reduza a retenção e a capacidade de proteção após confirmar que não há workloads dependentes");
          complementaryActions.push("exclua o Recovery Services Vault somente após validar que ele não é necessário");
        } else if (candidate.ruleType === "BACKUP_ORPHANED_ITEM") {
          reductionActions.push("reduza a retenção dos recovery points órfãos conforme a política de recuperação");
          complementaryActions.push("exclua o item de backup órfão após confirmar que o recurso de origem foi desativado");
        } else if (candidate.ruleType === "BACKUP_OLD_RECOVERY_POINT") {
          reductionActions.push("reduza a retenção e remova recovery points antigos conforme o RPO/RTO");
          complementaryActions.push("exclua os recovery points que não forem mais necessários");
        } else if (candidate.ruleType === "BACKUP_RETENTION_EXCESSIVE") {
          reductionActions.push("reduza o período de retenção para o mínimo compatível com a política de recuperação");
          complementaryActions.push("exclua backups excedentes após validar os requisitos de compliance");
        } else if (!isCompute && !isStorage) {
          reductionActions.push("reduza o consumo do recurso quando a carga permitir");
          complementaryActions.push("exclua ou isole o recurso quando ele não for mais necessário");
        } else if (isCompute) {
          reductionActions.push("reduza o consumo do recurso quando a carga permitir");
          complementaryActions.push("desligue a VM/VMSS quando não houver carga");
        } else {
          reductionActions.push("reduza o consumo do recurso quando a carga permitir");
          complementaryActions.push("exclua o recurso quando ele não for mais necessário");
        }

        suggestedActionSummary = buildCombinedSuggestionSummary({
          reductionActions,
          complementaryActions,
        });
        suggestedActionSummary = buildCatalogRecommendation({
          candidate,
          resource,
          currentCost: estimatedMonthlyCost,
          monthlySavings: estimatedMonthlySavings,
          alternativeName,
          alternativeMonthlyCost,
          alternativeMonthlySavings,
          existingActions: suggestedActionSummary,
        });
      } catch (error) {
        console.error(`Action summary generation failed for ${candidate.resourceId}`, error);
        suggestedActionSummary =
          resource?.type?.toLowerCase().includes("virtualmachine") ||
          resource?.type?.toLowerCase().includes("virtualmachinescaleset")
            ? "reduza o consumo do recurso quando a carga permitir e desligue a VM/VMSS quando não houver carga."
            : "reduza o consumo do recurso quando a carga permitir e exclua o recurso quando ele não for mais necessário.";
      }

      let tooltipExplanation: string | null = null;
      try {
        const facts: FindingFacts = {
          ruleLabel: translate("pt-BR", `rule.${candidate.ruleType}`),
          resourceId: candidate.resourceId,
          metricName: candidate.metricName ?? null,
          metricObserved: candidate.metricObserved ?? null,
          periodAnalyzedDays: candidate.periodAnalyzedDays ?? null,
          savingsCategory: candidate.savingsCategory ?? null,
          estimatedMonthlyCost,
          suggestedActionSummary,
        };
        tooltipExplanation = await explainFinding(facts);
      } catch (error) {
        console.error(`Finding explanation failed for ${candidate.resourceId}`, error);
      }

      await prisma.wasteFinding.upsert({
        where: {
          subscriptionId_resourceId_ruleType: {
            subscriptionId: subscription.id,
            resourceId: candidate.resourceId,
            ruleType: candidate.ruleType,
          },
        },
        create: {
          subscriptionId: subscription.id,
          resourceId: candidate.resourceId,
          billedResourceId: costResource?.id ?? candidate.resourceId,
          ruleType: candidate.ruleType,
          estimatedMonthlyCost,
          estimatedMonthlySavings,
          savingsCategory: candidate.savingsCategory,
          metricObserved: candidate.metricObserved,
          periodAnalyzedDays: candidate.periodAnalyzedDays,
          suggestedActionSummary,
          tooltipExplanation,
        },
        update: {
          billedResourceId: costResource?.id ?? candidate.resourceId,
          estimatedMonthlyCost,
          estimatedMonthlySavings,
          savingsCategory: candidate.savingsCategory,
          metricObserved: candidate.metricObserved,
          periodAnalyzedDays: candidate.periodAnalyzedDays,
          suggestedActionSummary,
          tooltipExplanation,
        },
      });
    }

    // Auto-resolve: an OPEN finding whose (resourceId, ruleType) no longer shows up in
    // this scan's candidates is assumed fixed. That inference is only sound when this
    // scan actually had visibility, so it is gated twice:
    //   1. An empty Resource Graph result is "we lost visibility" (a lapsed Lighthouse
    //      delegation, a throttled query), never "the customer deleted everything" —
    //      resolving on it would close out an entire subscription in one scan.
    //   2. A rule that threw tells us nothing about its own findings' validity, so its
    //      rule type is skipped entirely this scan and re-evaluated on the next one.
    const scanHadResourceVisibility = resources.length > 0;
    if (scanHadResourceVisibility) {
      const detectedKeys = new Set(candidates.map((c) => `${c.resourceId}::${c.ruleType}`));
      const openFindings = await prisma.wasteFinding.findMany({
        where: { subscriptionId: subscription.id, status: "OPEN" },
        select: { id: true, resourceId: true, ruleType: true },
      });
      const resolvedIds = openFindings
        .filter((f) => {
          const ruleRanSuccessfully = !degradedRuleTypes.has(f.ruleType);
          const stillDetected = detectedKeys.has(`${f.resourceId}::${f.ruleType}`);
          return ruleRanSuccessfully && !stillDetected;
        })
        .map((f) => f.id);
      if (resolvedIds.length > 0) {
        await prisma.wasteFinding.updateMany({
          where: { id: { in: resolvedIds } },
          data: { status: "RESOLVED", resolvedAt: new Date() },
        });
      }
    }

    await captureCostSnapshot(subscription.id, subscription.azureSubscriptionId);

    await prisma.scanRun.update({
      where: { id: scanRun.id },
      data: { status: "SUCCEEDED", finishedAt: new Date() },
    });
  } catch (error) {
    await prisma.scanRun.update({
      where: { id: scanRun.id },
      data: { status: "FAILED", finishedAt: new Date() },
    });
    throw error;
  }
}
