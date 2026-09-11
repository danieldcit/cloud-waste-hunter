import { describe, expect, it } from "vitest";
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import { findOldSnapshots } from "@/lib/waste-rules/oldSnapshots";

const NOW = new Date("2026-09-11T00:00:00Z");

describe("findOldSnapshots", () => {
  it("returns snapshots older than 30 days", () => {
    const snapshot: ResourceGraphRow = {
      id: "snap-old",
      type: "microsoft.compute/snapshots",
      subscriptionId: "sub-1",
      properties: { timeCreated: "2026-07-01T00:00:00Z" },
    };

    expect(findOldSnapshots([snapshot], NOW)).toEqual([
      { ruleType: "OLD_SNAPSHOT", resourceId: "snap-old", subscriptionId: "sub-1" },
    ]);
  });

  it("ignores snapshots 30 days old or newer, rows missing timeCreated, and resources of different types", () => {
    const recentSnapshot: ResourceGraphRow = {
      id: "snap-recent",
      type: "microsoft.compute/snapshots",
      subscriptionId: "sub-1",
      properties: { timeCreated: "2026-09-01T00:00:00Z" },
    };
    const malformedSnapshot: ResourceGraphRow = {
      id: "snap-no-date",
      type: "microsoft.compute/snapshots",
      subscriptionId: "sub-1",
      properties: {},
    };
    const disk: ResourceGraphRow = {
      id: "disk-1",
      type: "microsoft.compute/disks",
      subscriptionId: "sub-1",
      properties: { timeCreated: "2026-07-01T00:00:00Z" },
    };

    expect(findOldSnapshots([recentSnapshot, malformedSnapshot, disk], NOW)).toEqual([]);
  });
});
