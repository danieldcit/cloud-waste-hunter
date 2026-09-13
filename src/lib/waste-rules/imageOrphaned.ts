import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import type { WasteFindingCandidate } from "@/lib/waste-rules/types";

interface VmImageReferenceProperties {
  storageProfile?: { imageReference?: { id?: string } };
}

interface VmssImageReferenceProperties {
  virtualMachineProfile?: { storageProfile?: { imageReference?: { id?: string } } };
}

export function findImageOrphaned(resources: ResourceGraphRow[]): WasteFindingCandidate[] {
  const referencedImageIds = new Set<string>();

  for (const r of resources) {
    const type = r.type.toLowerCase();
    if (type === "microsoft.compute/virtualmachines") {
      const id = (r.properties as VmImageReferenceProperties).storageProfile?.imageReference?.id;
      if (id) {
        referencedImageIds.add(id.toLowerCase());
      }
    }
    if (type === "microsoft.compute/virtualmachinescalesets") {
      const id = (r.properties as VmssImageReferenceProperties).virtualMachineProfile
        ?.storageProfile?.imageReference?.id;
      if (id) {
        referencedImageIds.add(id.toLowerCase());
      }
    }
  }

  return resources
    .filter((r) => r.type.toLowerCase() === "microsoft.compute/images")
    .filter((r) => !referencedImageIds.has(r.id.toLowerCase()))
    .map((r) => ({
      ruleType: "IMAGE_ORPHANED" as const,
      resourceId: r.id,
      subscriptionId: r.subscriptionId,
      savingsCategory: "POTENTIAL_SAVING" as const,
    }));
}
