import { armFetch } from "@/lib/azure/armFetch";
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";

interface ReservationRecommendationProperties {
  skuName?: string;
  location?: string;
  recommendedQuantity?: number;
  netSavings?: number;
}

export interface ReservationRecommendation {
  properties?: ReservationRecommendationProperties;
}

interface ReservationRecommendationsResponse {
  value: ReservationRecommendation[];
  nextLink?: string | null;
}

/**
 * Fetches the full subscription-wide reservation-recommendation list, following `nextLink`
 * until exhausted. Callers that need to check multiple VM sizes/regions (e.g. one scan
 * covering many VMSS candidates) should call this ONCE per subscription and match against
 * the result with `matchReservationRecommendation`, rather than re-fetching per candidate.
 */
export async function listReservationRecommendations(
  subscriptionId: string,
): Promise<ReservationRecommendation[]> {
  const recommendations: ReservationRecommendation[] = [];
  let url: string | null =
    `https://management.azure.com/subscriptions/${subscriptionId}` +
    `/providers/Microsoft.Consumption/reservationRecommendations` +
    `?api-version=2024-08-01&$filter=${encodeURIComponent("properties/resourceType eq 'VirtualMachines'")}`;

  while (url) {
    const response: ReservationRecommendationsResponse =
      await armFetch<ReservationRecommendationsResponse>(url);
    recommendations.push(...response.value);
    url = response.nextLink ?? null;
  }

  return recommendations;
}

/**
 * Pure, synchronous match against an already-fetched recommendation list — a recommendation
 * with recommendedQuantity > 0 means Azure itself sees uncovered on-demand usage for this VM
 * family/region, i.e. no Reservation/Savings Plan already covers it. Schema per Microsoft
 * Learn as of authoring time (`Microsoft.Consumption/reservationRecommendations`, api-version
 * 2024-08-01) — validated live per plan Task 17 Step 5 before this was trusted in production.
 */
export function matchReservationRecommendation(
  recommendations: ReservationRecommendation[],
  vmSize: string,
  region: string,
): ReservationRecommendation | undefined {
  return recommendations.find(
    (rec) =>
      rec.properties?.location?.toLowerCase() === region.toLowerCase() &&
      rec.properties?.skuName?.toLowerCase() === vmSize.toLowerCase() &&
      (rec.properties?.recommendedQuantity ?? 0) > 0,
  );
}

/**
 * Convenience wrapper that fetches the full list and matches in one call. Prefer
 * `listReservationRecommendations` + `matchReservationRecommendation` directly when checking
 * more than one VM size/region per scan, to avoid re-fetching the subscription-wide list once
 * per candidate.
 */
export async function findReservationRecommendation(
  subscriptionId: string,
  vmSize: string,
  region: string,
): Promise<ReservationRecommendation | undefined> {
  const recommendations = await listReservationRecommendations(subscriptionId);
  return matchReservationRecommendation(recommendations, vmSize, region);
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
  _subscriptionId: string,
  _resource: ResourceGraphRow | undefined,
): Promise<number | null> {
  return null;
}
