import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import type { WasteFindingCandidate } from "@/lib/waste-rules/types";
import {
  listReservationRecommendations,
  matchReservationRecommendation,
  type ReservationRecommendation,
} from "@/lib/azure/reservationCoverage";

interface VmssVirtualMachineProfile {
  hardwareProfile?: { vmSize?: string };
}

/**
 * Fetches the subscription-wide recommendation list ONCE per subscription (via the injected
 * `listRecommendations`, cached in `recommendationsBySubscription`) rather than once per VMSS
 * candidate, then matches each candidate against the already-fetched list in memory.
 */
export async function findVmssMissingSavingsPlanOrReservation(
  resources: ResourceGraphRow[],
  listRecommendations: (
    subscriptionId: string,
  ) => Promise<ReservationRecommendation[]> = listReservationRecommendations,
): Promise<WasteFindingCandidate[]> {
  const scaleSets = resources.filter(
    (r) => r.type.toLowerCase() === "microsoft.compute/virtualmachinescalesets",
  );

  const recommendationsBySubscription = new Map<string, Promise<ReservationRecommendation[]>>();
  const candidates: WasteFindingCandidate[] = [];
  for (const vmss of scaleSets) {
    const profile = vmss.properties.virtualMachineProfile as VmssVirtualMachineProfile | undefined;
    const vmSize = profile?.hardwareProfile?.vmSize;
    const region = vmss.location;
    if (!vmSize || !region) {
      continue;
    }

    let recommendationsPromise = recommendationsBySubscription.get(vmss.subscriptionId);
    if (!recommendationsPromise) {
      recommendationsPromise = listRecommendations(vmss.subscriptionId);
      recommendationsBySubscription.set(vmss.subscriptionId, recommendationsPromise);
    }
    const recommendations = await recommendationsPromise;

    const recommendation = matchReservationRecommendation(recommendations, vmSize, region);
    if (recommendation) {
      candidates.push({
        ruleType: "VMSS_MISSING_SAVINGS_PLAN_OR_RESERVATION",
        resourceId: vmss.id,
        subscriptionId: vmss.subscriptionId,
        savingsCategory: "POTENTIAL_SAVING",
      });
    }
  }
  return candidates;
}
