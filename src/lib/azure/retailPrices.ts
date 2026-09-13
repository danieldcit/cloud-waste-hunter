import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";

interface RetailPriceItem {
  retailPrice: number;
  unitOfMeasure: string;
  meterName: string;
  skuName: string;
  productName: string;
  armRegionName: string;
  armSkuName: string;
  type: string;
}

interface RetailPricesResponse {
  Items: RetailPriceItem[];
  NextPageLink?: string | null;
}

const HOURS_PER_MONTH = 730;
const RETAIL_PRICES_URL = "https://prices.azure.com/api/retail/prices";

function escapeODataString(value: string): string {
  return value.replace(/'/g, "''");
}

/**
 * Fetches every page of a Retail Prices API query, following `NextPageLink` until it is
 * null/absent. A region-wide query (e.g. the Spot discount ratio scan) commonly returns
 * 1000+ rows across multiple pages — reading only page 1 silently truncates the result set.
 */
async function queryRetailPrices(filter: string): Promise<RetailPriceItem[]> {
  const items: RetailPriceItem[] = [];
  let url: string | null = `${RETAIL_PRICES_URL}?$filter=${encodeURIComponent(filter)}`;

  while (url) {
    const response: Response = await fetch(url);
    if (!response.ok) {
      console.error(`Retail Prices API request failed with ${response.status}: ${url}`);
      break;
    }
    const data = (await response.json()) as RetailPricesResponse;
    items.push(...data.Items);
    url = data.NextPageLink ?? null;
  }

  return items.filter((item) => item.type === "Consumption");
}

function monthlyPriceFromItems(items: RetailPriceItem[]): number {
  const monthly = items.find((i) => i.unitOfMeasure === "1/Month");
  if (monthly) {
    return monthly.retailPrice;
  }
  const hourly = items.find((i) => i.unitOfMeasure === "1 Hour");
  if (hourly) {
    return hourly.retailPrice * HOURS_PER_MONTH;
  }
  return 0;
}

interface DiskTierBand {
  maxSizeGb: number;
  tier: number;
}

/**
 * Premium SSD (P) and Standard SSD (E) share this size -> tier-number ladder. Azure's tier
 * numbering is sparse (1, 2, 3, 4, 6, 10, 15, 20, 30, 40, 50, 60, 70, 80), not sequential —
 * verified live against the real Retail Prices API on 2026-09-13 (the `skuName` values it
 * actually returns for "Premium SSD Managed Disks" and "Standard SSD Managed Disks"). A prior
 * version of this table used `ceil(log2(sizeGb / 4)) + 1` as a sequential tier number, which
 * silently mispriced every disk ≥ 64 GiB: some sizes mapped to a real-but-wrong-sized tier name
 * (e.g. a 2048 GiB disk priced as the much cheaper 128 GiB "P10"), others mapped to a tier name
 * that doesn't exist at all (P5, P7, P8, P9, P11+), which the Retail Prices API silently returns
 * zero rows for — read as a fabricated $0 cost, not an error.
 */
const PREMIUM_STANDARD_SSD_TIER_LADDER: DiskTierBand[] = [
  { maxSizeGb: 4, tier: 1 },
  { maxSizeGb: 8, tier: 2 },
  { maxSizeGb: 16, tier: 3 },
  { maxSizeGb: 32, tier: 4 },
  { maxSizeGb: 64, tier: 6 },
  { maxSizeGb: 128, tier: 10 },
  { maxSizeGb: 256, tier: 15 },
  { maxSizeGb: 512, tier: 20 },
  { maxSizeGb: 1024, tier: 30 },
  { maxSizeGb: 2048, tier: 40 },
  { maxSizeGb: 4096, tier: 50 },
  { maxSizeGb: 8192, tier: 60 },
  { maxSizeGb: 16384, tier: 70 },
  { maxSizeGb: 32767, tier: 80 },
];

/** Standard HDD (S) uses a different ladder that starts at S4 — there is no S1, S2, or S3. */
const STANDARD_HDD_TIER_LADDER: DiskTierBand[] = [
  { maxSizeGb: 32, tier: 4 },
  { maxSizeGb: 64, tier: 6 },
  { maxSizeGb: 128, tier: 10 },
  { maxSizeGb: 256, tier: 15 },
  { maxSizeGb: 512, tier: 20 },
  { maxSizeGb: 1024, tier: 30 },
  { maxSizeGb: 2048, tier: 40 },
  { maxSizeGb: 4096, tier: 50 },
  { maxSizeGb: 8192, tier: 60 },
  { maxSizeGb: 16384, tier: 70 },
  { maxSizeGb: 32767, tier: 80 },
];

/** Smallest band whose capacity covers `sizeGb` (disks always round up to the next tier); clamps to the largest published tier for anything beyond it. */
function diskTierNumber(ladder: DiskTierBand[], sizeGb: number): number {
  const band = ladder.find((b) => sizeGb <= b.maxSizeGb);
  return (band ?? ladder[ladder.length - 1]).tier;
}

/** Managed Disk SKU name (e.g. "Standard_LRS") -> Retail Prices skuName tier prefix (e.g. "S4 LRS") for a given size. */
export function diskSkuMeterName(skuName: string | undefined, sizeGb: number): string {
  const family = (skuName ?? "Standard_LRS").startsWith("Premium")
    ? "P"
    : (skuName ?? "").includes("StandardSSD")
      ? "E"
      : "S";
  const redundancy = (skuName ?? "").endsWith("ZRS") ? "ZRS" : "LRS";
  const ladder = family === "S" ? STANDARD_HDD_TIER_LADDER : PREMIUM_STANDARD_SSD_TIER_LADDER;
  const tier = diskTierNumber(ladder, Math.max(sizeGb, 1));
  return `${family}${tier} ${redundancy}`;
}

async function estimateDiskCost(resource: ResourceGraphRow): Promise<number> {
  const region = resource.location ?? "eastus";
  const sizeGb = Number(resource.properties.diskSizeGB) || 32;
  const skuName = resource.sku?.name;
  const meterSkuName = diskSkuMeterName(skuName, sizeGb);

  const isSnapshot = resource.type.toLowerCase() === "microsoft.compute/snapshots";
  const productFilter = isSnapshot ? "contains(productName, 'Snapshots')" : "contains(productName, 'Disks')";

  const items = await queryRetailPrices(
    `serviceName eq 'Storage' and armRegionName eq '${escapeODataString(region)}' and skuName eq '${escapeODataString(meterSkuName)}' and ${productFilter}`,
  );
  return monthlyPriceFromItems(items.filter((i) => !i.meterName.includes("Mount")));
}

/**
 * Estimated monthly saving from downgrading a Premium/Ultra managed disk to the Standard SSD
 * tier at the same size/region: the retail-price delta between the two, using the same
 * `estimateDiskCost` path (and its `diskSkuMeterName` size-banding) with the SKU swapped.
 */
export async function estimatePremiumDiskDowngradeMonthlySavings(
  resource: ResourceGraphRow,
): Promise<number | null> {
  if (resource.sku?.name === "UltraSSD_LRS") {
    // Ultra Disk is priced by configured IOPS/throughput, not a fixed size tier —
    // diskSkuMeterName's tier-name lookup doesn't apply to it, and reusing it here would price
    // against the wrong family entirely. Detection rules may still flag Ultra disks; this
    // function just refuses to fabricate a number for them.
    return null;
  }
  try {
    const premiumCost = await estimateDiskCost(resource);
    const standardEquivalent: ResourceGraphRow = {
      ...resource,
      sku: { ...resource.sku, name: "StandardSSD_LRS" },
    };
    const standardCost = await estimateDiskCost(standardEquivalent);
    const delta = premiumCost - standardCost;
    return delta > 0 ? delta : null;
  } catch (error) {
    console.error(`Premium disk downgrade savings estimation failed for ${resource.id}`, error);
    return null;
  }
}

async function estimatePublicIpCost(resource: ResourceGraphRow): Promise<number> {
  const region = resource.location ?? "eastus";
  const skuName = resource.sku?.name ?? "Basic";

  const items = await queryRetailPrices(
    `serviceName eq 'Virtual Network' and armRegionName eq '${escapeODataString(region)}' and skuName eq '${escapeODataString(skuName)}' and contains(meterName, 'IP Address')`,
  );
  return monthlyPriceFromItems(items);
}

/**
 * Fetches every Consumption-priced meter for this VM's exact size/region via
 * `armSkuName` (the literal ARM size, e.g. "Standard_D2_v2" — unlike `skuName`,
 * it needs no prefix-stripping and matches exactly one VM family), excluding
 * variant meters that would otherwise be picked up by a naive "first match"
 * and badly skew any price comparison: Spot and Low Priority (separate, much
 * cheaper meters for interruptible capacity) and classic Cloud Services
 * (a different, Windows-only-priced product that happens to share the same
 * `armSkuName` and lacks "Windows" in its own product name, so it can get
 * mistaken for the plain Linux/base price otherwise).
 */
async function fetchVmPriceItemsForSize(region: string, vmSize: string): Promise<RetailPriceItem[]> {
  const items = await queryRetailPrices(
    `serviceName eq 'Virtual Machines' and armRegionName eq '${escapeODataString(region)}' and armSkuName eq '${escapeODataString(vmSize)}'`,
  );
  return items.filter(
    (item) =>
      item.unitOfMeasure === "1 Hour" &&
      !item.skuName.includes("Spot") &&
      !item.skuName.includes("Low Priority") &&
      !/cloud\s*services/i.test(item.productName),
  );
}

async function fetchVmPriceItems(resource: ResourceGraphRow): Promise<RetailPriceItem[]> {
  const region = resource.location ?? "eastus";
  const hardwareProfile = resource.properties.hardwareProfile as { vmSize?: string } | undefined;
  const vmSize = hardwareProfile?.vmSize;
  if (!vmSize) return [];
  return fetchVmPriceItemsForSize(region, vmSize);
}

function isWindowsVm(resource: ResourceGraphRow): boolean {
  const storageProfile = resource.properties.storageProfile as
    | { osDisk?: { osType?: string } }
    | undefined;
  return storageProfile?.osDisk?.osType === "Windows";
}

/**
 * Estimates a VM's own monthly compute cost from the retail catalog, priced
 * for its actual OS — a Windows VM is priced at the Windows-licensed rate,
 * not the cheaper base/Linux one, so this stays consistent with whatever
 * license-saving estimate (e.g. Hybrid Benefit) gets computed against it.
 */
async function estimateVmCost(resource: ResourceGraphRow): Promise<number> {
  const items = await fetchVmPriceItems(resource);
  const wantsWindows = isWindowsVm(resource);
  const price = items.find((item) => item.productName.includes("Windows") === wantsWindows);
  return price ? monthlyPriceFromItems([price]) : 0;
}

interface VmssVirtualMachineProfile {
  hardwareProfile?: { vmSize?: string };
  storageProfile?: { osDisk?: { osType?: string } };
}

function vmssVmSize(resource: ResourceGraphRow): string | undefined {
  const profile = resource.properties.virtualMachineProfile as VmssVirtualMachineProfile | undefined;
  return profile?.hardwareProfile?.vmSize;
}

function isWindowsVmss(resource: ResourceGraphRow): boolean {
  const profile = resource.properties.virtualMachineProfile as VmssVirtualMachineProfile | undefined;
  return profile?.storageProfile?.osDisk?.osType === "Windows";
}

/**
 * Estimates a VM Scale Set's total monthly compute cost: the per-instance retail price
 * (same logic as `estimateVmCost`, read from `virtualMachineProfile` instead of a VM's
 * top-level properties) times its current instance count (`sku.capacity`).
 */
async function estimateVmssCost(resource: ResourceGraphRow): Promise<number> {
  const vmSize = vmssVmSize(resource);
  if (!vmSize) return 0;
  const region = resource.location ?? "eastus";
  const items = await fetchVmPriceItemsForSize(region, vmSize);
  const wantsWindows = isWindowsVmss(resource);
  const price = items.find((item) => item.productName.includes("Windows") === wantsWindows);
  const perInstanceCost = price ? monthlyPriceFromItems([price]) : 0;
  const capacity = resource.sku?.capacity ?? 1;
  return perInstanceCost * capacity;
}

function isHourlyVmMeter(item: RetailPriceItem): boolean {
  return item.unitOfMeasure === "1 Hour" && !/cloud\s*services/i.test(item.productName);
}

async function fetchVmSizePriceCatalog(region: string, vmSize: string): Promise<RetailPriceItem[]> {
  const items = await queryRetailPrices(
    `serviceName eq 'Virtual Machines' and armRegionName eq '${escapeODataString(region)}' and armSkuName eq '${escapeODataString(vmSize)}'`,
  );
  return items.filter(isHourlyVmMeter);
}

/**
 * Average ratio of Spot price to on-demand price across every VM family in a region that
 * publishes both, used only when the VMSS's own SKU has no Spot meter of its own. Derived
 * from live regional pricing data rather than a hardcoded "typical Spot discount" constant,
 * per explicit user direction (see spec §"médias derivadas de dados reais").
 */
async function estimateRegionalSpotDiscountRatio(region: string): Promise<number | null> {
  const items = await queryRetailPrices(
    `serviceName eq 'Virtual Machines' and armRegionName eq '${escapeODataString(region)}'`,
  );
  const hourly = items.filter(isHourlyVmMeter);

  // Keyed by armSkuName + OS, not armSkuName alone: a Windows meter and a Linux meter for the
  // same VM size share the same armSkuName, so a bare-armSkuName key would let one silently
  // overwrite the other and badly skew the resulting ratio.
  const onDemandBySku = new Map<string, number>();
  const spotBySku = new Map<string, number>();
  for (const item of hourly) {
    if (item.skuName.includes("Low Priority")) continue;
    const key = `${item.armSkuName}::${item.productName.includes("Windows")}`;
    if (item.skuName.includes("Spot")) {
      spotBySku.set(key, item.retailPrice);
    } else {
      onDemandBySku.set(key, item.retailPrice);
    }
  }

  const ratios: number[] = [];
  for (const [key, spotPrice] of spotBySku) {
    const onDemandPrice = onDemandBySku.get(key);
    if (onDemandPrice && onDemandPrice > 0) {
      ratios.push(spotPrice / onDemandPrice);
    }
  }

  if (ratios.length === 0) {
    return null;
  }
  return ratios.reduce((sum, r) => sum + r, 0) / ratios.length;
}

/**
 * Estimated monthly saving from moving a Spot-eligible VMSS to Spot pricing. Prefers the
 * exact Spot meter for this VMSS's own SKU/region; only falls back to the region-wide average
 * discount ratio (never a fixed percentage) when that exact meter isn't published.
 */
export async function estimateVmssSpotMonthlySavings(
  resource: ResourceGraphRow,
): Promise<number | null> {
  const vmSize = vmssVmSize(resource);
  if (!vmSize) return null;
  const region = resource.location ?? "eastus";
  const capacity = resource.sku?.capacity ?? 1;
  const wantsWindows = isWindowsVmss(resource);

  try {
    const items = await fetchVmSizePriceCatalog(region, vmSize);
    const onDemandItem = items.find(
      (item) =>
        !item.skuName.includes("Spot") &&
        !item.skuName.includes("Low Priority") &&
        item.productName.includes("Windows") === wantsWindows,
    );
    const spotItem = items.find(
      (item) => item.skuName.includes("Spot") && item.productName.includes("Windows") === wantsWindows,
    );

    if (onDemandItem && spotItem) {
      const delta = monthlyPriceFromItems([onDemandItem]) - monthlyPriceFromItems([spotItem]);
      if (delta > 0) {
        return delta * capacity;
      }
    }

    if (onDemandItem) {
      const ratio = await estimateRegionalSpotDiscountRatio(region);
      if (ratio !== null) {
        return monthlyPriceFromItems([onDemandItem]) * (1 - ratio) * capacity;
      }
    }
  } catch (error) {
    console.error(`VMSS Spot savings estimation failed for ${resource.id}`, error);
  }
  return null;
}

/** Used only when retail pricing data for the license delta itself is unavailable. */
const HYBRID_BENEFIT_FALLBACK_FRACTION = 0.4;
const LINUX_BYOL_FALLBACK_FRACTION = 0.25;

/**
 * Estimated monthly saving from applying Azure Hybrid Benefit to a Windows VM:
 * the delta between the Windows-licensed and base (license-free) retail price
 * for the same SKU/region, both read from a single Retail Prices API call and
 * split by whether `productName` mentions Windows — Hybrid Benefit removes
 * the Windows Server license fee, leaving the base compute rate. Falls back
 * to a documented ~40% approximation of the finding's own resource cost
 * (Microsoft's commonly cited Hybrid Benefit saving on Windows Server
 * compute) when either price can't be found in the catalog. A missing price
 * is distinguished from a genuinely free one by item presence, not by a
 * `> 0` check, so a real $0 meter is never mistaken for "not found."
 */
export async function estimateHybridBenefitMonthlySavings(
  resource: ResourceGraphRow,
  estimatedMonthlyCost: number,
): Promise<number> {
  try {
    const items = await fetchVmPriceItems(resource);
    const basePrice = items.find((item) => !item.productName.includes("Windows"));
    const windowsPrice = items.find((item) => item.productName.includes("Windows"));
    if (basePrice && windowsPrice) {
      const delta = monthlyPriceFromItems([windowsPrice]) - monthlyPriceFromItems([basePrice]);
      if (delta > 0) {
        return delta;
      }
    }
  } catch (error) {
    console.error(`Hybrid Benefit savings estimation failed for ${resource.id}`, error);
  }
  return estimatedMonthlyCost * HYBRID_BENEFIT_FALLBACK_FRACTION;
}

/**
 * Estimated monthly saving from bringing your own RHEL/SUSE subscription
 * (BYOL) instead of paying for Azure's built-in distro license.
 *
 * Unlike Hybrid Benefit, the RHEL/SUSE license fee is billed as its own
 * meter under the "Virtual Machines Licenses" service, banded by the VM's
 * actual vCPU count rather than by its SKU/region — pricing it precisely
 * would require knowing that vCPU count, which the scanner doesn't collect
 * today (Resource Graph's `hardwareProfile.vmSize` names the SKU, not its
 * core count). Until that data is available, this uses a documented ~25%
 * approximation of the finding's own resource cost (a typical RHEL/SUSE
 * subscription premium) rather than guessing at a vCPU-band lookup this
 * scanner can't yet do correctly.
 */
export function estimateLinuxByolMonthlySavings(estimatedMonthlyCost: number): number {
  return estimatedMonthlyCost * LINUX_BYOL_FALLBACK_FRACTION;
}

async function estimateVpnGatewayCost(resource: ResourceGraphRow): Promise<number> {
  const region = resource.location ?? "eastus";
  const properties = resource.properties as { sku?: { name?: string } } | undefined;
  const skuName = properties?.sku?.name ?? "Basic";

  const items = await queryRetailPrices(
    `serviceName eq 'VPN Gateway' and armRegionName eq '${escapeODataString(region)}' and skuName eq '${escapeODataString(skuName)}' and meterName eq '${escapeODataString(skuName)}'`,
  );
  return monthlyPriceFromItems(items);
}

/**
 * Estimates a resource's monthly cost from Azure's public retail (list) price
 * catalog, for use when Cost Management's actual-spend API is unavailable
 * (e.g. trial/credit subscriptions — see docs/azure-real-validation-findings.md #1).
 * This is a list-price estimate, not actual billed spend.
 */
export async function estimateRetailMonthlyCost(resource: ResourceGraphRow): Promise<number> {
  const type = resource.type.toLowerCase();
  try {
    if (type === "microsoft.compute/disks" || type === "microsoft.compute/snapshots") {
      return await estimateDiskCost(resource);
    }
    if (type === "microsoft.network/publicipaddresses") {
      return await estimatePublicIpCost(resource);
    }
    if (type === "microsoft.compute/virtualmachines") {
      return await estimateVmCost(resource);
    }
    if (type === "microsoft.compute/virtualmachinescalesets") {
      return await estimateVmssCost(resource);
    }
    if (
      type === "microsoft.network/vpngateways" ||
      type === "microsoft.network/virtualnetworkgateways"
    ) {
      return await estimateVpnGatewayCost(resource);
    }
  } catch (error) {
    console.error(`Retail price estimation failed for ${resource.id}`, error);
  }
  return 0;
}
