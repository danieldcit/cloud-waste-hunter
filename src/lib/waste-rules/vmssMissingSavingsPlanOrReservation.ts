import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import type { WasteFindingCandidate } from "@/lib/waste-rules/types";
import { findReservationRecommendation } from "@/lib/azure/reservationCoverage";

interface VmssVirtualMachineProfile {
  hardwareProfile?: { vmSize?: string };
}

export async function findVmssMissingSavingsPlanOrReservation(
  resources: ResourceGraphRow[],
  findRecommendation: (
    subscriptionId: string,
    vmSize: string,
    region: string,
  ) => ReturnType<typeof findReservationRecommendation> = findReservationRecommendation,
): Promise<WasteFindingCandidate[]> {
  const scaleSets = resources.filter(
    (r) => r.type.toLowerCase() === "microsoft.compute/virtualmachinescalesets",
  );

  const candidates: WasteFindingCandidate[] = [];
  for (const vmss of scaleSets) {
    const profile = vmss.properties.virtualMachineProfile as VmssVirtualMachineProfile | undefined;
    const vmSize = profile?.hardwareProfile?.vmSize;
    const region = vmss.location;
    if (!vmSize || !region) {
      continue;
    }

    const recommendation = await findRecommendation(vmss.subscriptionId, vmSize, region);
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
