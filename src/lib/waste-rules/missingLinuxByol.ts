import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import type { WasteFindingCandidate } from "@/lib/waste-rules/types";

const BYOL_ELIGIBLE_PUBLISHERS = new Set(["redhat", "suse"]);

export function findMissingLinuxByol(
  resources: ResourceGraphRow[],
): WasteFindingCandidate[] {
  return resources
    .filter((r) => {
      if (r.type.toLowerCase() !== "microsoft.compute/virtualmachines") {
        return false;
      }
      const storageProfile = r.properties.storageProfile as
        | { imageReference?: { publisher?: string } }
        | undefined;
      const publisher = storageProfile?.imageReference?.publisher?.toLowerCase();
      if (!publisher || !BYOL_ELIGIBLE_PUBLISHERS.has(publisher)) {
        return false;
      }
      const licenseType = r.properties.licenseType as string | undefined;
      return !licenseType || !licenseType.toUpperCase().endsWith("_BYOS");
    })
    .map((r) => ({
      ruleType: "VM_MISSING_LINUX_BYOL",
      resourceId: r.id,
      subscriptionId: r.subscriptionId,
      savingsCategory: "POTENTIAL_SAVING",
    }));
}
