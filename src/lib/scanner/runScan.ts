import { prisma } from "@/lib/prisma";
import { queryResourceGraph } from "@/lib/azure/resourceGraph";
import { estimateMonthlyCost } from "@/lib/azure/costManagement";
import { findOrphanedDisks } from "@/lib/waste-rules/orphanedDisks";
import { findUnassociatedPublicIps } from "@/lib/waste-rules/unassociatedPublicIps";
import { findOldSnapshots } from "@/lib/waste-rules/oldSnapshots";
import { findIdleVpnGateways } from "@/lib/waste-rules/idleVpnGateways";
import type { WasteFindingCandidate } from "@/lib/waste-rules/types";

const COMBINED_QUERY = `
Resources
| where type in (
    'microsoft.compute/disks',
    'microsoft.network/publicipaddresses',
    'microsoft.compute/snapshots',
    'microsoft.network/vpngateways',
    'microsoft.network/virtualnetworkgateways',
    'microsoft.network/connections'
  )
| project id, type, subscriptionId, properties
`;

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

    const candidates: WasteFindingCandidate[] = [
      ...findOrphanedDisks(resources),
      ...findUnassociatedPublicIps(resources),
      ...findOldSnapshots(resources),
      ...findIdleVpnGateways(resources),
    ];

    for (const candidate of candidates) {
      const estimatedMonthlyCost = await estimateMonthlyCost(
        subscription.azureSubscriptionId,
        candidate.resourceId,
      );
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
        update: { estimatedMonthlyCost, status: "OPEN" },
      });
    }

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
