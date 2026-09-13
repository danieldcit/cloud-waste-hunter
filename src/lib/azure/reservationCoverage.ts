import { armFetch } from "@/lib/azure/armFetch";
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";

interface ReservationRecommendationProperties {
  skuName?: string;
  location?: string;
  recommendedQuantity?: number;
  netSavings?: number;
}

interface ReservationRecommendation {
  properties?: ReservationRecommendationProperties;
}

interface ReservationRecommendationsResponse {
  value: ReservationRecommendation[];
}

interface VmssHardwareProfile {
  virtualMachineProfile?: { hardwareProfile?: { vmSize?: string } };
}

function vmssVmSize(resource: ResourceGraphRow): string | undefined {
  const properties = resource.properties as VmssHardwareProfile;
  return properties.virtualMachineProfile?.hardwareProfile?.vmSize;
}

/**
 * Checks whether Azure's own reservation-recommendation engine currently suggests buying a
 * Reservation for this VM family/region — a recommendation with recommendedQuantity > 0 means
 * Azure itself sees uncovered on-demand usage there, i.e. no Reservation/Savings Plan already
 * covers it. Schema per Microsoft Learn as of authoring time
 * (`Microsoft.Consumption/reservationRecommendations`, api-version 2024-08-01) — validated
 * live per plan Task 17 Step 5 before this was trusted in production.
 */
export async function findReservationRecommendation(
  subscriptionId: string,
  vmSize: string,
  region: string,
): Promise<ReservationRecommendation | undefined> {
  const url =
    `https://management.azure.com/subscriptions/${subscriptionId}` +
    `/providers/Microsoft.Consumption/reservationRecommendations` +
    `?api-version=2024-08-01&$filter=${encodeURIComponent("properties/resourceType eq 'VirtualMachines'")}`;

  const response = await armFetch<ReservationRecommendationsResponse>(url);
  return response.value.find(
    (rec) =>
      rec.properties?.location?.toLowerCase() === region.toLowerCase() &&
      rec.properties?.skuName?.toLowerCase() === vmSize.toLowerCase() &&
      (rec.properties?.recommendedQuantity ?? 0) > 0,
  );
}

export async function estimateReservationCoverageMonthlySavings(
  subscriptionId: string,
  resource: ResourceGraphRow | undefined,
): Promise<number | null> {
  if (!resource) return null;
  const vmSize = vmssVmSize(resource);
  const region = resource.location;
  if (!vmSize || !region) return null;

  try {
    const recommendation = await findReservationRecommendation(subscriptionId, vmSize, region);
    return recommendation?.properties?.netSavings ?? null;
  } catch (error) {
    console.error(`Reservation coverage check failed for ${resource.id}`, error);
    return null;
  }
}
