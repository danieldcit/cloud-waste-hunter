import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import type { WasteFindingCandidate } from "@/lib/waste-rules/types";
import { getAverageDiskIops } from "@/lib/azure/monitorMetrics";

const PREMIUM_SKUS = new Set(["Premium_LRS", "Premium_ZRS", "UltraSSD_LRS"]);
const IOPS_THRESHOLD = 500;
const WINDOW_DAYS = 30;

export async function findDiskPremiumTierUnnecessary(
  resources: ResourceGraphRow[],
  getAverageIops: (resourceId: string, days: number) => Promise<number> = getAverageDiskIops,
): Promise<WasteFindingCandidate[]> {
  const disks = resources.filter(
    (r) => r.type.toLowerCase() === "microsoft.compute/disks" && PREMIUM_SKUS.has(r.sku?.name ?? ""),
  );

  const candidates: WasteFindingCandidate[] = [];
  for (const disk of disks) {
    const avgIops = await getAverageIops(disk.id, WINDOW_DAYS);
    if (avgIops < IOPS_THRESHOLD) {
      candidates.push({
        ruleType: "DISK_PREMIUM_TIER_UNNECESSARY",
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
