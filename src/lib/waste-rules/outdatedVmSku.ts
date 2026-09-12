import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import type { WasteFindingCandidate } from "@/lib/waste-rules/types";
import { isDeprecatedVmSize } from "@/lib/azure/deprecatedVmSkus";

export function findOutdatedVmSkus(
  resources: ResourceGraphRow[],
): WasteFindingCandidate[] {
  return resources
    .filter((r) => {
      if (r.type.toLowerCase() !== "microsoft.compute/virtualmachines") {
        return false;
      }
      const hardwareProfile = r.properties.hardwareProfile as
        | { vmSize?: string }
        | undefined;
      const vmSize = hardwareProfile?.vmSize;
      return typeof vmSize === "string" && isDeprecatedVmSize(vmSize);
    })
    .map((r) => ({
      ruleType: "VM_OUTDATED_SKU_GENERATION",
      resourceId: r.id,
      subscriptionId: r.subscriptionId,
      savingsCategory: "POTENTIAL_SAVING",
    }));
}
