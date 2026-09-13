import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import type { WasteFindingCandidate } from "@/lib/waste-rules/types";
import { getAverageDiskIops } from "@/lib/azure/monitorMetrics";
import { maxIopsForPremiumDiskSize } from "@/lib/azure/premiumDiskTiers";

const PREMIUM_SKUS = new Set(["Premium_LRS", "Premium_ZRS"]);
const UNDERUSED_RATIO_THRESHOLD = 0.2;
const WINDOW_DAYS = 30;

export async function findDiskTierOversized(
  resources: ResourceGraphRow[],
  getAverageIops: (resourceId: string, days: number) => Promise<number | null> = getAverageDiskIops,
): Promise<WasteFindingCandidate[]> {
  const disks = resources.filter(
    (r) =>
      r.type.toLowerCase() === "microsoft.compute/disks" &&
      r.properties.diskState === "Attached" &&
      PREMIUM_SKUS.has(r.sku?.name ?? ""),
  );

  const candidates: WasteFindingCandidate[] = [];
  for (const disk of disks) {
    const sizeGb = Number(disk.properties.diskSizeGB) || 0;
    if (sizeGb <= 0) {
      continue;
    }
    const maxIops = maxIopsForPremiumDiskSize(sizeGb);
    const avgIops = await getAverageIops(disk.id, WINDOW_DAYS);
    if (avgIops === null) {
      continue;
    }
    if (avgIops < maxIops * UNDERUSED_RATIO_THRESHOLD) {
      candidates.push({
        ruleType: "DISK_TIER_OVERSIZED",
        resourceId: disk.id,
        subscriptionId: disk.subscriptionId,
        savingsCategory: "POTENTIAL_SAVING",
        metricObserved: avgIops,
        periodAnalyzedDays: WINDOW_DAYS,
      });
    }
  }
  return candidates;
}
