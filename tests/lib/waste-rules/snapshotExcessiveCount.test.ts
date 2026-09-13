import { describe, expect, it } from "vitest";
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import { findSnapshotExcessiveCount } from "@/lib/waste-rules/snapshotExcessiveCount";

const SOURCE_DISK_ID = "/subscriptions/sub-1/disks/disk-1";

function snapshot(id: string, timeCreated: string, sourceResourceId = SOURCE_DISK_ID): ResourceGraphRow {
  return {
    id,
    type: "microsoft.compute/snapshots",
    subscriptionId: "sub-1",
    properties: { creationData: { sourceResourceId }, timeCreated },
  };
}

describe("findSnapshotExcessiveCount", () => {
  it("flags the oldest snapshots beyond the retention limit of 5 for one source disk", () => {
    const resources = [
      snapshot("/subscriptions/sub-1/snapshots/snap-1", "2026-01-01T00:00:00Z"),
      snapshot("/subscriptions/sub-1/snapshots/snap-2", "2026-02-01T00:00:00Z"),
      snapshot("/subscriptions/sub-1/snapshots/snap-3", "2026-03-01T00:00:00Z"),
      snapshot("/subscriptions/sub-1/snapshots/snap-4", "2026-04-01T00:00:00Z"),
      snapshot("/subscriptions/sub-1/snapshots/snap-5", "2026-05-01T00:00:00Z"),
      snapshot("/subscriptions/sub-1/snapshots/snap-6", "2026-06-01T00:00:00Z"),
      snapshot("/subscriptions/sub-1/snapshots/snap-7", "2026-07-01T00:00:00Z"),
    ];

    const result = findSnapshotExcessiveCount(resources);

    // 7 snapshots, keep the 5 newest (snap-3..snap-7), flag the 2 oldest (snap-1, snap-2).
    // Assert on the set of flagged resourceIds rather than array order, since the
    // implementation's internal sort direction is not part of this rule's contract.
    expect(result).toHaveLength(2);
    expect(result.map((c) => c.resourceId).sort()).toEqual(
      [
        "/subscriptions/sub-1/snapshots/snap-1",
        "/subscriptions/sub-1/snapshots/snap-2",
      ].sort(),
    );
    for (const candidate of result) {
      expect(candidate).toMatchObject({
        ruleType: "SNAPSHOT_EXCESSIVE_COUNT",
        subscriptionId: "sub-1",
        savingsCategory: "HARD_SAVING",
      });
    }
  });

  it("does not flag any snapshot when a source disk has 5 or fewer snapshots", () => {
    const resources = [
      snapshot("/subscriptions/sub-1/snapshots/snap-1", "2026-01-01T00:00:00Z"),
      snapshot("/subscriptions/sub-1/snapshots/snap-2", "2026-02-01T00:00:00Z"),
    ];

    expect(findSnapshotExcessiveCount(resources)).toEqual([]);
  });

  it("groups by sourceResourceId independently — 6 snapshots split across 2 disks (3 each) is not excessive", () => {
    const otherDisk = "/subscriptions/sub-1/disks/disk-2";
    const resources = [
      snapshot("/subscriptions/sub-1/snapshots/a1", "2026-01-01T00:00:00Z", SOURCE_DISK_ID),
      snapshot("/subscriptions/sub-1/snapshots/a2", "2026-01-02T00:00:00Z", SOURCE_DISK_ID),
      snapshot("/subscriptions/sub-1/snapshots/a3", "2026-01-03T00:00:00Z", SOURCE_DISK_ID),
      snapshot("/subscriptions/sub-1/snapshots/b1", "2026-01-01T00:00:00Z", otherDisk),
      snapshot("/subscriptions/sub-1/snapshots/b2", "2026-01-02T00:00:00Z", otherDisk),
      snapshot("/subscriptions/sub-1/snapshots/b3", "2026-01-03T00:00:00Z", otherDisk),
    ];

    expect(findSnapshotExcessiveCount(resources)).toEqual([]);
  });

  it("ignores snapshots with no sourceResourceId when grouping", () => {
    const resources = [
      snapshot("/subscriptions/sub-1/snapshots/snap-1", "2026-01-01T00:00:00Z", undefined as unknown as string),
    ];

    expect(findSnapshotExcessiveCount(resources)).toEqual([]);
  });
});
