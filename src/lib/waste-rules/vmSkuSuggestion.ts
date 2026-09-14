import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import { getMaxCpuPercent } from "@/lib/azure/monitorMetrics";
import { listVmSkusForRegion, type VmSkuCandidate } from "@/lib/azure/vmSkus";
import { estimateVmSkuMonthlyCost } from "@/lib/azure/retailPrices";

export type { VmSkuCandidate };

const TARGET_UTILIZATION_CEILING = 0.7;
const PRICE_CHECK_CANDIDATE_LIMIT = 3;

/**
 * Pure filter: candidates that (a) aren't restricted, (b) have at least as much memory as the
 * current VM (no memory metric exists to justify reducing it), and (c) have enough vCPU that the
 * *peak* CPU demand projects to at most 70% utilization on the candidate — never derived from
 * average CPU. Sorted cheapest-vCPU-first as a proxy for "smallest safe candidate"; price comes
 * from a live lookup on the top few in `suggestVmSku`, not all ~1000 candidates.
 */
export function findSafeVmSkuCandidates(
  candidates: VmSkuCandidate[],
  currentVCpus: number,
  currentMemoryGB: number,
  peakCpuPercent: number,
): VmSkuCandidate[] {
  const peakVCpuDemand = (peakCpuPercent / 100) * currentVCpus;
  const minVCpus = peakVCpuDemand / TARGET_UTILIZATION_CEILING;
  return candidates
    .filter(
      (c) =>
        !c.restricted &&
        c.memoryGB >= currentMemoryGB &&
        c.vCPUs >= minVCpus &&
        c.vCPUs < currentVCpus,
    )
    .sort((a, b) => a.vCPUs - b.vCPUs);
}

export interface VmSkuSuggestion {
  skuName: string;
  monthlySavings: number;
}

/**
 * Orchestrates the full VM/VMSS downsize suggestion: peak CPU -> look up the current VM's own
 * specs from the region's real SKU list (no regex-parsing of the vmSize string — reuses the same
 * live data already fetched for candidates, so it's exact, not a heuristic) -> safe candidates ->
 * price the cheapest few -> cheapest candidate with positive savings. Returns null at any failure
 * or when nothing is safe/cheaper — never fabricates a suggestion. Dependencies are injected
 * (defaulting to the real implementations) so tests never hit the network.
 */
export async function suggestVmSku(
  resource: ResourceGraphRow,
  azureSubscriptionId: string,
  vmSize: string,
  currentMonthlyCost: number,
  wantsWindows: boolean,
  getPeakCpu: (resourceId: string, days: number) => Promise<number | null> = getMaxCpuPercent,
  listSkus: (subId: string, location: string) => Promise<VmSkuCandidate[]> = listVmSkusForRegion,
  getSkuPrice: (region: string, vmSize: string, wantsWindows: boolean) => Promise<number> = estimateVmSkuMonthlyCost,
): Promise<VmSkuSuggestion | null> {
  try {
    const peakCpuPercent = await getPeakCpu(resource.id, 30);
    if (peakCpuPercent === null) {
      return null;
    }

    const region = resource.location ?? "eastus";
    const allSkus = await listSkus(azureSubscriptionId, region);
    const currentSku = allSkus.find((s) => s.name === vmSize);
    if (!currentSku) {
      // Can't find the current VM's own specs in the live list — never guess vCPU/RAM.
      return null;
    }
    const safeCandidates = findSafeVmSkuCandidates(allSkus, currentSku.vCPUs, currentSku.memoryGB, peakCpuPercent);
    if (safeCandidates.length === 0) {
      return null;
    }

    const topCandidates = safeCandidates.slice(0, PRICE_CHECK_CANDIDATE_LIMIT);
    let cheapest: { skuName: string; price: number } | null = null;
    for (const candidate of topCandidates) {
      const price = await getSkuPrice(region, candidate.name, wantsWindows);
      if (price <= 0) continue;
      if (cheapest === null || price < cheapest.price) {
        cheapest = { skuName: candidate.name, price };
      }
    }
    if (cheapest === null) {
      return null;
    }
    const monthlySavings = currentMonthlyCost - cheapest.price;
    if (monthlySavings <= 0) {
      return null;
    }
    return { skuName: cheapest.skuName, monthlySavings };
  } catch (error) {
    console.error(`VM SKU suggestion failed for ${resource.id}`, error);
    return null;
  }
}
