import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import type { WasteFindingCandidate } from "@/lib/waste-rules/types";

export function findOrphanedDisks(
  resources: ResourceGraphRow[],
): WasteFindingCandidate[] {
  return resources
    .filter(
      (r) =>
        r.type.toLowerCase() === "microsoft.compute/disks" &&
        r.properties.diskState === "Unattached",
    )
    .map((r) => ({
      ruleType: "ORPHANED_DISK",
      resourceId: r.id,
      subscriptionId: r.subscriptionId,
    }));
}
