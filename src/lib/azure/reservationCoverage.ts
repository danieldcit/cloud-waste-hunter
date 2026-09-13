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

/**
 * Deliberately does NOT return `recommendation.properties.netSavings` as a dollar estimate.
 *
 * `findReservationRecommendation`'s DETECTION logic is live-validated and safe to rely on: the
 * live call against a real Azure subscription (Task 17 Step 5) returned 200 OK with the expected
 * `{ value: [...] }` envelope and no permission error, confirming the endpoint, api-version, and
 * RBAC assumptions. That's enough for Task 18 to use this module to decide WHETHER to flag a
 * VMSS as missing reservation coverage.
 *
 * What is NOT validated is the semantics of `netSavings` itself: the test subscription had no
 * VM usage history, so the API only ever returned an empty `value` array — there was no real
 * recommendation to inspect. Azure reservation terms are commonly 1 or 3 years, and it was not
 * possible to confirm whether `netSavings` is a MONTHLY figure or a TOTAL-OVER-THE-TERM figure.
 * Presenting a term-total as "monthly savings" would misstate every dollar figure this path
 * produces by roughly 12x (1-year term) or 36x (3-year term).
 *
 * Following the same discipline as `VM_OUTDATED_SKU_GENERATION` elsewhere in this codebase
 * ("é mais honesto não estimar do que inventar um número" — it's more honest not to estimate
 * than to invent a number), this function returns `null` unconditionally for now rather than
 * guess at the unit. Revisit this once a subscription with real reservation-recommendation data
 * is available to confirm `netSavings`'s unit/scale against the recommendation's `term` field,
 * at which point this can start returning a real (possibly term-divided) monthly figure.
 */
export async function estimateReservationCoverageMonthlySavings(
  subscriptionId: string,
  resource: ResourceGraphRow | undefined,
): Promise<number | null> {
  if (!resource) return null;
  const vmSize = vmssVmSize(resource);
  const region = resource.location;
  if (!vmSize || !region) return null;

  try {
    await findReservationRecommendation(subscriptionId, vmSize, region);
    return null;
  } catch (error) {
    console.error(`Reservation coverage check failed for ${resource.id}`, error);
    return null;
  }
}
