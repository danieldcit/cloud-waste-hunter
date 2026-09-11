import { describe, expect, it } from "vitest";
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import { findOrphanedDisks } from "@/lib/waste-rules/orphanedDisks";

describe("findOrphanedDisks", () => {
  it("returns disks with diskState Unattached", () => {
    const disk: ResourceGraphRow = {
      id: "/subscriptions/sub-1/resourceGroups/rg1/providers/Microsoft.Compute/disks/disk-unattached",
      type: "microsoft.compute/disks",
      subscriptionId: "sub-1",
      properties: { diskState: "Unattached" },
    };

    expect(findOrphanedDisks([disk])).toEqual([
      { ruleType: "ORPHANED_DISK", resourceId: disk.id, subscriptionId: "sub-1" },
    ]);
  });

  it("ignores attached disks and other resource types", () => {
    const attachedDisk: ResourceGraphRow = {
      id: "disk-attached",
      type: "microsoft.compute/disks",
      subscriptionId: "sub-1",
      properties: { diskState: "Attached" },
    };
    const unrelated: ResourceGraphRow = {
      id: "ip-1",
      type: "microsoft.network/publicipaddresses",
      subscriptionId: "sub-1",
      properties: {},
    };

    expect(findOrphanedDisks([attachedDisk, unrelated])).toEqual([]);
  });
});
