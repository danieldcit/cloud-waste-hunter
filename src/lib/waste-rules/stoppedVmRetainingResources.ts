import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import type { WasteFindingCandidate } from "@/lib/waste-rules/types";

interface VmStorageProfile {
  osDisk?: { managedDisk?: { id?: string } };
  dataDisks?: { managedDisk?: { id?: string } }[];
}

export function findStoppedVmsRetainingResources(
  resources: ResourceGraphRow[],
): WasteFindingCandidate[] {
  const candidates: WasteFindingCandidate[] = [];

  for (const r of resources) {
    if (r.type.toLowerCase() !== "microsoft.compute/virtualmachines") {
      continue;
    }
    if (r.powerState !== "PowerState/deallocated") {
      continue;
    }

    const storageProfile = r.properties.storageProfile as VmStorageProfile | undefined;
    const diskIds = [
      storageProfile?.osDisk?.managedDisk?.id,
      ...(storageProfile?.dataDisks ?? []).map((d) => d.managedDisk?.id),
    ].filter((id): id is string => typeof id === "string");

    for (const diskId of diskIds) {
      candidates.push({
        ruleType: "VM_STOPPED_RETAINING_RESOURCES",
        resourceId: diskId,
        subscriptionId: r.subscriptionId,
        savingsCategory: "POTENTIAL_SAVING",
      });
    }
  }

  return candidates;
}
