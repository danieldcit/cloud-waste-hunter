import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import type { WasteFindingCandidate } from "@/lib/waste-rules/types";
import { getAverageDiskIops } from "@/lib/azure/monitorMetrics";

const OVERSIZED_RATIO_THRESHOLD = 3;
const WINDOW_DAYS = 30;
/** Premium SSD v2 includes this many IOPS at no extra charge — nothing to save below it. */
const PREMIUM_V2_INCLUDED_IOPS = 3000;

interface PremiumV2DiskProperties {
  diskIOPSReadWrite?: number;
}

export async function findDiskPremiumV2Oversized(
  resources: ResourceGraphRow[],
  getAverageIops: (resourceId: string, days: number) => Promise<number | null> = getAverageDiskIops,
): Promise<WasteFindingCandidate[]> {
  const disks = resources.filter(
    (r) =>
      r.type.toLowerCase() === "microsoft.compute/disks" &&
      r.properties.diskState === "Attached" &&
      r.sku?.name === "PremiumV2_LRS",
  );

  const candidates: WasteFindingCandidate[] = [];
  for (const disk of disks) {
    const configuredIops = (disk.properties as PremiumV2DiskProperties).diskIOPSReadWrite;
    if (!configuredIops || configuredIops <= PREMIUM_V2_INCLUDED_IOPS) {
      continue;
    }
    const avgIops = await getAverageIops(disk.id, WINDOW_DAYS);
    if (avgIops === null) {
      continue;
    }
    if (configuredIops >= avgIops * OVERSIZED_RATIO_THRESHOLD) {
      candidates.push({
        ruleType: "DISK_PREMIUM_V2_OVERSIZED",
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
