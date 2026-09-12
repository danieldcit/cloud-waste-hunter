import { prisma } from "@/lib/prisma";
import { queryResourceGraph } from "@/lib/azure/resourceGraph";
import { estimateMonthlyCost } from "@/lib/azure/costManagement";
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
import type { WasteFindingCandidate } from "@/lib/waste-rules/types";

const COMBINED_QUERY = `
Resources
| where type in (
    'microsoft.compute/disks',
    'microsoft.network/publicipaddresses',
    'microsoft.compute/snapshots',
    'microsoft.network/vpngateways',
    'microsoft.network/virtualnetworkgateways',
    'microsoft.network/connections',
    'microsoft.compute/virtualmachines'
  )
| project id, type, subscriptionId, properties
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

    const candidates: WasteFindingCandidate[] = [
      ...findOrphanedDisks(resources),
      ...findUnassociatedPublicIps(resources),
      ...findOldSnapshots(resources),
      ...findIdleVpnGateways(resources),
      ...idleVmCandidates,
    ];

    for (const candidate of candidates) {
      let estimatedMonthlyCost = 0;
      try {
        estimatedMonthlyCost = await estimateMonthlyCost(
          subscription.azureSubscriptionId,
          candidate.resourceId,
        );
      } catch (error) {
        console.error(
          `Cost estimation failed for resource ${candidate.resourceId} (rule ${candidate.ruleType}); using 0`,
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
        },
        update: { estimatedMonthlyCost },
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
