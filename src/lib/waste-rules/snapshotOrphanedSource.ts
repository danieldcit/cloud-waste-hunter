import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import type { WasteFindingCandidate } from "@/lib/waste-rules/types";

interface SnapshotCreationData {
  sourceResourceId?: string;
}

export function findSnapshotOrphanedSource(
  resources: ResourceGraphRow[],
): WasteFindingCandidate[] {
  const diskIds = new Set(
    resources
      .filter((r) => r.type.toLowerCase() === "microsoft.compute/disks")
      .map((r) => r.id.toLowerCase()),
  );

  return resources
    .filter((r) => r.type.toLowerCase() === "microsoft.compute/snapshots")
    .filter((r) => {
      const creationData = r.properties.creationData as SnapshotCreationData | undefined;
      const sourceId = creationData?.sourceResourceId;
      return typeof sourceId === "string" && !diskIds.has(sourceId.toLowerCase());
    })
    .map((r) => ({
      ruleType: "SNAPSHOT_ORPHANED_SOURCE" as const,
      resourceId: r.id,
      subscriptionId: r.subscriptionId,
      savingsCategory: "HARD_SAVING" as const,
    }));
}
