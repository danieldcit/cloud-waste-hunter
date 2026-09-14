import { armFetch } from "@/lib/azure/armFetch";

export interface VmSkuCandidate {
  name: string;
  vCPUs: number;
  memoryGB: number;
  restricted: boolean;
}

interface ResourceSku {
  resourceType: string;
  name: string;
  capabilities?: { name: string; value: string }[];
  restrictions?: unknown[];
}

interface ResourceSkusResponse {
  value: ResourceSku[];
}

function capabilityValue(sku: ResourceSku, name: string): string | undefined {
  return sku.capabilities?.find((c) => c.name === name)?.value;
}

/**
 * Lists every VM size available in a region, with vCPU/RAM specs and whether it's restricted for
 * this subscription. Live-validated 2026-09-14 against a real subscription (brazilsouth): 1165
 * items, no pagination (nextLink absent from the response), 1044 of resourceType
 * "virtualMachines", 92/1044 restricted with reasonCode "NotAvailableForSubscription".
 */
export async function listVmSkusForRegion(
  azureSubscriptionId: string,
  location: string,
): Promise<VmSkuCandidate[]> {
  const url =
    `https://management.azure.com/subscriptions/${azureSubscriptionId}/providers/Microsoft.Compute/skus` +
    `?api-version=2021-07-01&$filter=${encodeURIComponent(`location eq '${location}'`)}`;
  const response = await armFetch<ResourceSkusResponse>(url);
  return response.value
    .filter((sku) => sku.resourceType === "virtualMachines")
    .map((sku) => ({
      name: sku.name,
      vCPUs: Number(capabilityValue(sku, "vCPUs") ?? 0),
      memoryGB: Number(capabilityValue(sku, "MemoryGB") ?? 0),
      restricted: (sku.restrictions?.length ?? 0) > 0,
    }));
}
