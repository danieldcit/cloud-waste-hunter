import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import { getMaxDiskIops } from "@/lib/azure/monitorMetrics";
import { smallestPremiumDiskSizeForIops } from "@/lib/azure/premiumDiskTiers";
import { estimateDiskCost } from "@/lib/azure/retailPrices";

export interface DiskTierSuggestion {
  suggestedSizeGb: number;
  monthlySavings: number;
}

/**
 * Suggests a smaller size within the SAME disk family/tier ladder (not a family swap — that's
 * DISK_PREMIUM_TIER_UNNECESSARY's already-existing estimatePremiumDiskDowngradeMonthlySavings).
 * Peak IOPS -> smallest safe same-family size -> price both sizes -> the delta. Returns null when
 * the suggested size isn't genuinely smaller, or any step fails.
 */
export async function suggestDiskTier(
  resource: ResourceGraphRow,
  getPeakIops: (resourceId: string, days: number) => Promise<number | null> = getMaxDiskIops,
  priceDisk: (resource: ResourceGraphRow) => Promise<number> = estimateDiskCost,
): Promise<DiskTierSuggestion | null> {
  try {
    const peakIops = await getPeakIops(resource.id, 30);
    if (peakIops === null) {
      return null;
    }

    const currentSizeGb = Number(resource.properties.diskSizeGB) || 0;
    const suggestedSizeGb = smallestPremiumDiskSizeForIops(peakIops);
    if (suggestedSizeGb >= currentSizeGb) {
      return null;
    }

    const currentCost = await priceDisk(resource);
    const suggestedResource: ResourceGraphRow = {
      ...resource,
      properties: { ...resource.properties, diskSizeGB: suggestedSizeGb },
    };
    const suggestedCost = await priceDisk(suggestedResource);
    const monthlySavings = currentCost - suggestedCost;
    if (monthlySavings <= 0) {
      return null;
    }
    return { suggestedSizeGb, monthlySavings };
  } catch (error) {
    console.error(`Disk tier suggestion failed for ${resource.id}`, error);
    return null;
  }
}
