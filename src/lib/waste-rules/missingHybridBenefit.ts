import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import type { WasteFindingCandidate } from "@/lib/waste-rules/types";

const HYBRID_BENEFIT_LICENSE_TYPES = new Set(["windows_server", "windows_client"]);

export function findMissingHybridBenefit(
  resources: ResourceGraphRow[],
): WasteFindingCandidate[] {
  return resources
    .filter((r) => {
      if (r.type.toLowerCase() !== "microsoft.compute/virtualmachines") {
        return false;
      }
      const storageProfile = r.properties.storageProfile as
        | { osDisk?: { osType?: string } }
        | undefined;
      if (storageProfile?.osDisk?.osType !== "Windows") {
        return false;
      }
      const licenseType = r.properties.licenseType as string | undefined;
      return !licenseType || !HYBRID_BENEFIT_LICENSE_TYPES.has(licenseType.toLowerCase());
    })
    .map((r) => ({
      ruleType: "VM_MISSING_HYBRID_BENEFIT",
      resourceId: r.id,
      subscriptionId: r.subscriptionId,
      savingsCategory: "POTENTIAL_SAVING",
    }));
}
