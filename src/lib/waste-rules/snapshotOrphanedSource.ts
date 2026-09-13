import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import type { WasteFindingCandidate } from "@/lib/waste-rules/types";

interface SnapshotCreationData {
  sourceResourceId?: string;
}

/** Matches a managed-disk ARM resource id, case-insensitively — a snapshot's sourceResourceId
 * can also legitimately point at another snapshot (createOption Copy/CopyStart) or a restore
 * point; those aren't orphaned-disk evidence and must not be flagged as such. Matches on the
 * trailing `/disks/<name>` path segment (rather than requiring the full
 * `/providers/Microsoft.Compute/disks/` prefix) so it works against both real Azure ARM ids and
 * this project's shortened test-fixture ids. */
function isDiskResourceId(id: string): boolean {
  return /\/disks\/[^/]+$/i.test(id);
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
      if (typeof sourceId !== "string" || !isDiskResourceId(sourceId)) {
        return false;
      }
      return !diskIds.has(sourceId.toLowerCase());
    })
    .map((r) => ({
      ruleType: "SNAPSHOT_ORPHANED_SOURCE" as const,
      resourceId: r.id,
      subscriptionId: r.subscriptionId,
      savingsCategory: "HARD_SAVING" as const,
    }));
}
