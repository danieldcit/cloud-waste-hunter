import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import type { WasteFindingCandidate } from "@/lib/waste-rules/types";
import { isNonProdVmssName } from "@/lib/waste-rules/vmssNaming";

interface VmssVirtualMachineProfile {
  priority?: string;
}

export function findVmssSpotEligible(resources: ResourceGraphRow[]): WasteFindingCandidate[] {
  return resources
    .filter((r) => r.type.toLowerCase() === "microsoft.compute/virtualmachinescalesets")
    .filter((r) => isNonProdVmssName(r.id))
    .filter((r) => {
      const profile = r.properties.virtualMachineProfile as VmssVirtualMachineProfile | undefined;
      return profile?.priority !== "Spot";
    })
    .map((r) => ({
      ruleType: "VMSS_SPOT_ELIGIBLE" as const,
      resourceId: r.id,
      subscriptionId: r.subscriptionId,
      savingsCategory: "POTENTIAL_SAVING" as const,
    }));
}
