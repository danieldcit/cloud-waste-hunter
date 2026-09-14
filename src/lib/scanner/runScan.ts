import type { WasteRuleType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { queryResourceGraph, type ResourceGraphRow } from "@/lib/azure/resourceGraph";
import { estimateMonthlyCost } from "@/lib/azure/costManagement";
import { estimateRetailMonthlyCost } from "@/lib/azure/retailPrices";
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
import { isSessionHost, underlyingVm } from "@/lib/waste-rules/avdSessionHosts";
import { estimateMonthlySavings } from "@/lib/waste-rules/savingsEstimate";
import { suggestVmSku } from "@/lib/waste-rules/vmSkuSuggestion";
import { suggestDiskTier } from "@/lib/waste-rules/diskTierSuggestion";
import { explainFinding, type FindingFacts } from "@/lib/ai/findingExplainer";
import type { WasteFindingCandidate } from "@/lib/waste-rules/types";

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
];

const COMBINED_QUERY = `
Resources
| where type in (${COMBINED_QUERY_TYPES.map((t) => `'${t}'`).join(", ")})
| extend powerState = tostring(properties.extended.instanceView.powerState.code)
| project id, type, subscriptionId, location, sku, properties, powerState
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

    const monthToDateSpend = mtdResult.status === "fulfilled" ? mtdResult.value : 0;
    const projectedSpend = forecastResult.status === "fulfilled" ? forecastResult.value : 0;
    const dailyTrend = trendResult.status === "fulfilled" ? trendResult.value : [];

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
      if (
        (candidate.ruleType === "IDLE_VM" || candidate.ruleType === "VMSS_IDLE_LOW_UTILIZATION") &&
        resource
      ) {
        try {
          // A VM's size/OS live at properties.hardwareProfile/storageProfile; a VMSS's live one
          // level deeper, under properties.virtualMachineProfile (same shape retailPrices.ts's
          // vmssVmSize/isWindowsVmss already read from). Branch on which rule fired.
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
          if (vmSize) {
            const suggestion = await suggestVmSku(
              resource,
              subscription.azureSubscriptionId,
              vmSize,
              estimatedMonthlyCost,
              storageProfile?.osDisk?.osType === "Windows",
            );
            if (suggestion) {
              suggestedActionSummary = `Redimensione para ${suggestion.skuName} — economia adicional estimada de $${suggestion.monthlySavings.toFixed(2)}/mês`;
            }
          }
        } catch (error) {
          console.error(`VM SKU suggestion failed for ${candidate.resourceId}`, error);
        }
      } else if (candidate.ruleType === "DISK_TIER_OVERSIZED" && resource) {
        try {
          const suggestion = await suggestDiskTier(resource);
          if (suggestion) {
            suggestedActionSummary = `Redimensione para ${suggestion.suggestedSizeGb} GiB — economia adicional estimada de $${suggestion.monthlySavings.toFixed(2)}/mês`;
          }
        } catch (error) {
          console.error(`Disk tier suggestion failed for ${candidate.resourceId}`, error);
        }
      } else if (candidate.ruleType === "DISK_PREMIUM_TIER_UNNECESSARY" && estimatedMonthlySavings != null) {
        suggestedActionSummary = `Troque para um disco Standard SSD equivalente — economia estimada de $${estimatedMonthlySavings.toFixed(2)}/mês`;
      }

      let tooltipExplanation: string | null = null;
      try {
        const facts: FindingFacts = {
          ruleLabel: candidate.ruleType,
          resourceId: candidate.resourceId,
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
