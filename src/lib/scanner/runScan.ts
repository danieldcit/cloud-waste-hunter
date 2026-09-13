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
import { estimateMonthlySavings } from "@/lib/waste-rules/savingsEstimate";
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
    if (resources.length > 0) {
      await prisma.resource.createMany({
        data: resources.map((r) => ({
          subscriptionId: subscription.id,
          scanRunId: scanRun.id,
          resourceId: r.id,
          type: r.type,
          rawProperties: r.properties as object,
        })),
      });
    }

    let idleVmCandidates: WasteFindingCandidate[] = [];
    try {
      idleVmCandidates = await findIdleVirtualMachines(resources);
    } catch (error) {
      console.error(
        "Idle VM rule failed; treating as zero idle VMs for this scan",
        error,
      );
    }

    let idleVmssCandidates: WasteFindingCandidate[] = [];
    try {
      idleVmssCandidates = await findVmssIdleLowUtilization(resources);
    } catch (error) {
      console.error(
        "Idle VMSS rule failed; treating as zero idle VMSS for this scan",
        error,
      );
    }

    let missingReservationCandidates: WasteFindingCandidate[] = [];
    try {
      missingReservationCandidates = await findVmssMissingSavingsPlanOrReservation(resources);
    } catch (error) {
      console.error(
        "VMSS reservation-coverage rule failed; treating as zero findings for this scan",
        error,
      );
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
    ];

    const resourceById = new Map<string, ResourceGraphRow>(
      resources.map((r) => [r.id, r]),
    );

    for (const candidate of candidates) {
      let estimatedMonthlyCost = 0;
      try {
        estimatedMonthlyCost = await estimateMonthlyCost(
          subscription.azureSubscriptionId,
          candidate.resourceId,
        );
      } catch (error) {
        console.error(
          `Cost estimation failed for resource ${candidate.resourceId} (rule ${candidate.ruleType}); falling back to retail price estimate`,
          error,
        );
      }

      if (estimatedMonthlyCost === 0) {
        const resource = resourceById.get(candidate.resourceId);
        if (resource) {
          try {
            estimatedMonthlyCost = await estimateRetailMonthlyCost(resource);
          } catch (error) {
            console.error(
              `Retail price fallback failed for resource ${candidate.resourceId} (rule ${candidate.ruleType}); using 0`,
              error,
            );
          }
        }
      }
      let estimatedMonthlySavings: number | null = null;
      try {
        estimatedMonthlySavings = await estimateMonthlySavings(
          candidate,
          resourceById.get(candidate.resourceId),
          estimatedMonthlyCost,
        );
      } catch (error) {
        console.error(
          `Savings estimation failed for resource ${candidate.resourceId} (rule ${candidate.ruleType}); leaving savings unknown`,
          error,
        );
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
          ruleType: candidate.ruleType,
          estimatedMonthlyCost,
          estimatedMonthlySavings,
          savingsCategory: candidate.savingsCategory,
          metricObserved: candidate.metricObserved,
          periodAnalyzedDays: candidate.periodAnalyzedDays,
        },
        update: {
          estimatedMonthlyCost,
          estimatedMonthlySavings,
          savingsCategory: candidate.savingsCategory,
          metricObserved: candidate.metricObserved,
          periodAnalyzedDays: candidate.periodAnalyzedDays,
        },
      });
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
