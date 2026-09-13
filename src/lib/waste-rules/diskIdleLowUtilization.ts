import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import type { WasteFindingCandidate } from "@/lib/waste-rules/types";
import { getAverageDiskIops } from "@/lib/azure/monitorMetrics";

interface IopsSeverityTier {
  maxIops: number;
  days: 30 | 60 | 90;
  savingsCategory: "HARD_SAVING" | "POTENTIAL_SAVING";
}

/** Ordered from most to least severe — the first matching tier wins. IOPS thresholds are
 * absolute, not relative to the disk's own tier — even the smallest Standard HDD tier has
 * hundreds of IOPS of capacity, so fractional-digit observed IOPS is unambiguous waste. */
const IOPS_SEVERITY_TIERS: IopsSeverityTier[] = [
  { maxIops: 1, days: 90, savingsCategory: "HARD_SAVING" },
  { maxIops: 1, days: 30, savingsCategory: "HARD_SAVING" },
  { maxIops: 5, days: 60, savingsCategory: "POTENTIAL_SAVING" },
  { maxIops: 10, days: 30, savingsCategory: "POTENTIAL_SAVING" },
];

export async function findDiskIdleLowUtilization(
  resources: ResourceGraphRow[],
  getAverageIops: (resourceId: string, days: number) => Promise<number> = getAverageDiskIops,
): Promise<WasteFindingCandidate[]> {
  const disks = resources.filter(
    (r) =>
      r.type.toLowerCase() === "microsoft.compute/disks" &&
      r.properties.diskState === "Attached",
  );

  const candidates: WasteFindingCandidate[] = [];
  for (const disk of disks) {
    const [iops30, iops60, iops90] = await Promise.all([
      getAverageIops(disk.id, 30),
      getAverageIops(disk.id, 60),
      getAverageIops(disk.id, 90),
    ]);
    const iopsByWindow = new Map<number, number>([
      [30, iops30],
      [60, iops60],
      [90, iops90],
    ]);

    const matchedTier = IOPS_SEVERITY_TIERS.find(
      (tier) => (iopsByWindow.get(tier.days) ?? Infinity) < tier.maxIops,
    );
    if (matchedTier) {
      candidates.push({
        ruleType: "DISK_IDLE_LOW_UTILIZATION",
        resourceId: disk.id,
        subscriptionId: disk.subscriptionId,
        savingsCategory: matchedTier.savingsCategory,
        metricObserved: iopsByWindow.get(matchedTier.days)!,
        periodAnalyzedDays: matchedTier.days,
      });
    }
  }
  return candidates;
}
