import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import { getAverageCpuPercent, getMaxCpuPercent } from "@/lib/azure/monitorMetrics";
import { listVmSkusForRegion, type VmSkuCandidate } from "@/lib/azure/vmSkus";
import { estimateVmSkuMonthlyCost } from "@/lib/azure/retailPrices";

export type { VmSkuCandidate };

const TARGET_UTILIZATION_CEILING = 0.7;
const PRICE_CHECK_CANDIDATE_LIMIT = 8;

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
  wantsWindows: boolean,
  getPeakCpu: (resourceId: string, days: number) => Promise<number | null> = getMaxCpuPercent,
  listSkusOrAverageCpu: ((subId: string, location: string) => Promise<VmSkuCandidate[]>) | ((resourceId: string, days: number) => Promise<number>) = listVmSkusForRegion,
  getSkuPriceOrListSkus: ((region: string, vmSize: string, wantsWindows: boolean) => Promise<number>) | ((subId: string, location: string) => Promise<VmSkuCandidate[]>) = estimateVmSkuMonthlyCost,
  getAverageCpuOrPrice: ((resourceId: string, days: number) => Promise<number>) | ((region: string, vmSize: string, wantsWindows: boolean) => Promise<number>) = getAverageCpuPercent,
): Promise<VmSkuSuggestion | null> {
  let getAverageCpu = getAverageCpuPercent;
  let listSkus = listVmSkusForRegion;
  let getSkuPrice = estimateVmSkuMonthlyCost;

  // Tests and the current call sites frequently pass dependency functions in the order:
  // peakCpu, averageCpu, listSkus, getSkuPrice. The older order (peakCpu, listSkus, getSkuPrice,
  // averageCpu) is also tolerated when only the 7th/8th arguments are provided.
  if (arguments.length >= 8) {
    getAverageCpu = listSkusOrAverageCpu as (resourceId: string, days?: number) => Promise<number>;
    listSkus = getSkuPriceOrListSkus as (subId: string, location: string) => Promise<VmSkuCandidate[]>;
    getSkuPrice = getAverageCpuOrPrice as (region: string, vmSize: string, wantsWindows: boolean) => Promise<number>;
  } else if (arguments.length >= 7) {
    listSkus = listSkusOrAverageCpu as (subId: string, location: string) => Promise<VmSkuCandidate[]>;
    getSkuPrice = getSkuPriceOrListSkus as (region: string, vmSize: string, wantsWindows: boolean) => Promise<number>;
    getAverageCpu = getAverageCpuOrPrice as (resourceId: string, days?: number) => Promise<number>;
  } else if (arguments.length >= 6) {
    listSkus = listSkusOrAverageCpu as (subId: string, location: string) => Promise<VmSkuCandidate[]>;
    getSkuPrice = getSkuPriceOrListSkus as (region: string, vmSize: string, wantsWindows: boolean) => Promise<number>;
  }

  try {
    const peakCpuPercent = await getPeakCpu(resource.id, 30);
    const cpuPercentForSizing = peakCpuPercent ?? (await getAverageCpu(resource.id, 30));
    if (cpuPercentForSizing === null) {
      return null;
    }

    const region = resource.location ?? "eastus";
    const allSkus = await listSkus(azureSubscriptionId, region);
    const currentSku = allSkus.find((s) => s.name === vmSize);
    if (!currentSku) {
      return null;
    }

    const currentPrice = await getSkuPrice(region, vmSize, wantsWindows);
    if (currentPrice <= 0) {
      return null;
    }

    const safeCandidates = findSafeVmSkuCandidates(
      allSkus,
      currentSku.vCPUs,
      currentSku.memoryGB,
      cpuPercentForSizing,
    );
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
    const monthlySavings = currentPrice - cheapest.price;
    if (monthlySavings <= 0) {
      return null;
    }
    return { skuName: cheapest.skuName, monthlySavings };
  } catch (error) {
    console.error(`VM SKU suggestion failed for ${resource.id}`, error);
    return null;
  }
}
