import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";

interface RetailPriceItem {
  retailPrice: number;
  unitOfMeasure: string;
  meterName: string;
  skuName: string;
  productName: string;
  armRegionName: string;
  type: string;
}

interface RetailPricesResponse {
  Items: RetailPriceItem[];
}

const HOURS_PER_MONTH = 730;
const RETAIL_PRICES_URL = "https://prices.azure.com/api/retail/prices";

function escapeODataString(value: string): string {
  return value.replace(/'/g, "''");
}

async function queryRetailPrices(filter: string): Promise<RetailPriceItem[]> {
  const url = `${RETAIL_PRICES_URL}?$filter=${encodeURIComponent(filter)}`;
  const response = await fetch(url);
  if (!response.ok) {
    return [];
  }
  const data = (await response.json()) as RetailPricesResponse;
  return data.Items.filter((item) => item.type === "Consumption");
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

/** Managed Disk SKU name (e.g. "Standard_LRS") -> Retail Prices skuName tier prefix (e.g. "S4") for a given size. */
function diskSkuMeterName(skuName: string | undefined, sizeGb: number): string | undefined {
  const family = (skuName ?? "Standard_LRS").startsWith("Premium")
    ? "P"
    : (skuName ?? "").includes("StandardSSD")
      ? "E"
      : "S";
  const redundancy = (skuName ?? "").endsWith("ZRS") ? "ZRS" : "LRS";
  // Standard tiers snap to fixed sizes: 4, 8, 16, 32, 64, 128, 256, 512, 1024...
  const tierIndex = Math.max(0, Math.ceil(Math.log2(Math.max(sizeGb, 1) / 4)));
  const tierNumber = tierIndex + 1;
  return `${family}${tierNumber} ${redundancy}`;
}

async function estimateDiskCost(resource: ResourceGraphRow): Promise<number> {
  const region = resource.location ?? "eastus";
  const sizeGb = Number(resource.properties.diskSizeGB) || 32;
  const skuName = resource.sku?.name;
  const meterSkuName = diskSkuMeterName(skuName, sizeGb);
  if (!meterSkuName) return 0;

  const isSnapshot = resource.type.toLowerCase() === "microsoft.compute/snapshots";
  const productFilter = isSnapshot ? "contains(productName, 'Snapshots')" : "contains(productName, 'Disks')";

  const items = await queryRetailPrices(
    `serviceName eq 'Storage' and armRegionName eq '${escapeODataString(region)}' and skuName eq '${escapeODataString(meterSkuName)}' and ${productFilter}`,
  );
  return monthlyPriceFromItems(items.filter((i) => !i.meterName.includes("Mount")));
}

async function estimatePublicIpCost(resource: ResourceGraphRow): Promise<number> {
  const region = resource.location ?? "eastus";
  const skuName = resource.sku?.name ?? "Basic";

  const items = await queryRetailPrices(
    `serviceName eq 'Virtual Network' and armRegionName eq '${escapeODataString(region)}' and skuName eq '${escapeODataString(skuName)}' and contains(meterName, 'IP Address')`,
  );
  return monthlyPriceFromItems(items);
}

async function estimateVmCost(resource: ResourceGraphRow): Promise<number> {
  const region = resource.location ?? "eastus";
  const hardwareProfile = resource.properties.hardwareProfile as { vmSize?: string } | undefined;
  const vmSize = hardwareProfile?.vmSize;
  if (!vmSize) return 0;
  const skuName = vmSize.replace(/^Standard_/, "");

  const items = await queryRetailPrices(
    `serviceName eq 'Virtual Machines' and armRegionName eq '${escapeODataString(region)}' and skuName eq '${escapeODataString(skuName)}' and contains(productName, 'Linux') and not contains(productName, 'Windows')`,
  );
  return monthlyPriceFromItems(items);
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
