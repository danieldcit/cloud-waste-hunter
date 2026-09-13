import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import type { WasteFindingCandidate } from "@/lib/waste-rules/types";
import { isDeprecatedVmSize } from "@/lib/azure/deprecatedVmSkus";

interface VmssVirtualMachineProfile {
  hardwareProfile?: { vmSize?: string };
}

export function findOutdatedVmssSkus(resources: ResourceGraphRow[]): WasteFindingCandidate[] {
  return resources
    .filter((r) => {
      if (r.type.toLowerCase() !== "microsoft.compute/virtualmachinescalesets") {
        return false;
      }
      const profile = r.properties.virtualMachineProfile as VmssVirtualMachineProfile | undefined;
      const vmSize = profile?.hardwareProfile?.vmSize;
      return typeof vmSize === "string" && isDeprecatedVmSize(vmSize);
    })
    .map((r) => ({
      ruleType: "VMSS_OUTDATED_SKU_GENERATION" as const,
      resourceId: r.id,
      subscriptionId: r.subscriptionId,
      savingsCategory: "POTENTIAL_SAVING" as const,
    }));
}
