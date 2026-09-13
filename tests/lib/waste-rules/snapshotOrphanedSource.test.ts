import { describe, expect, it } from "vitest";
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import { findSnapshotOrphanedSource } from "@/lib/waste-rules/snapshotOrphanedSource";

function snapshot(id: string, sourceResourceId?: string): ResourceGraphRow {
  return {
    id,
    type: "microsoft.compute/snapshots",
    subscriptionId: "sub-1",
    properties: { creationData: { sourceResourceId } },
  };
}

function disk(id: string): ResourceGraphRow {
  return {
    id,
    type: "microsoft.compute/disks",
    subscriptionId: "sub-1",
    properties: {},
  };
}

const EXISTING_DISK_ID = "/subscriptions/sub-1/disks/disk-1";
const REMOVED_DISK_ID = "/subscriptions/sub-1/disks/disk-removed";

describe("findSnapshotOrphanedSource", () => {
  it("flags a snapshot whose source disk no longer exists in the current scan", () => {
    const resources = [
      disk(EXISTING_DISK_ID),
      snapshot("/subscriptions/sub-1/snapshots/snap-1", REMOVED_DISK_ID),
    ];

    expect(findSnapshotOrphanedSource(resources)).toEqual([
      {
        ruleType: "SNAPSHOT_ORPHANED_SOURCE",
        resourceId: "/subscriptions/sub-1/snapshots/snap-1",
        subscriptionId: "sub-1",
        savingsCategory: "HARD_SAVING",
      },
    ]);
  });

  it("does not flag a snapshot whose source disk still exists (case-insensitive match)", () => {
    const resources = [
      disk(EXISTING_DISK_ID),
      snapshot("/subscriptions/sub-1/snapshots/snap-2", EXISTING_DISK_ID.toUpperCase()),
    ];

    expect(findSnapshotOrphanedSource(resources)).toEqual([]);
  });

  it("does not flag a snapshot with no sourceResourceId at all", () => {
    const resources = [disk(EXISTING_DISK_ID), snapshot("/subscriptions/sub-1/snapshots/snap-3")];

    expect(findSnapshotOrphanedSource(resources)).toEqual([]);
  });

  it("ignores non-snapshot resources", () => {
    expect(findSnapshotOrphanedSource([disk(EXISTING_DISK_ID)])).toEqual([]);
  });
});
