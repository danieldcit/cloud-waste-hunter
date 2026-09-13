import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import type { WasteFindingCandidate } from "@/lib/waste-rules/types";

interface SnapshotCreationData {
  sourceResourceId?: string;
}

/** Keep the N most recent snapshots per source disk; anything beyond that is a cleanup candidate. */
const MAX_SNAPSHOTS_PER_DISK = 5;

export function findSnapshotExcessiveCount(
  resources: ResourceGraphRow[],
): WasteFindingCandidate[] {
  const snapshots = resources.filter(
    (r) => r.type.toLowerCase() === "microsoft.compute/snapshots",
  );

  const bySource = new Map<string, ResourceGraphRow[]>();
  for (const snapshot of snapshots) {
    const creationData = snapshot.properties.creationData as SnapshotCreationData | undefined;
    const sourceId = creationData?.sourceResourceId;
    if (typeof sourceId !== "string") {
      continue;
    }
    const key = sourceId.toLowerCase();
    const group = bySource.get(key) ?? [];
    group.push(snapshot);
    bySource.set(key, group);
  }

  const candidates: WasteFindingCandidate[] = [];
  for (const group of bySource.values()) {
    if (group.length <= MAX_SNAPSHOTS_PER_DISK) {
      continue;
    }
    const sortedNewestFirst = [...group].sort((a, b) => {
      const timeA = new Date(String(a.properties.timeCreated ?? 0)).getTime();
      const timeB = new Date(String(b.properties.timeCreated ?? 0)).getTime();
      return timeB - timeA;
    });
    const excess = sortedNewestFirst.slice(MAX_SNAPSHOTS_PER_DISK);
    for (const snapshot of excess) {
      candidates.push({
        ruleType: "SNAPSHOT_EXCESSIVE_COUNT",
        resourceId: snapshot.id,
        subscriptionId: snapshot.subscriptionId,
        savingsCategory: "HARD_SAVING",
      });
    }
  }
  return candidates;
}
