import { describe, expect, it, vi } from "vitest";
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import { findDiskIdleLowUtilization } from "@/lib/waste-rules/diskIdleLowUtilization";

function disk(id: string, diskState = "Attached"): ResourceGraphRow {
  return {
    id,
    type: "microsoft.compute/disks",
    subscriptionId: "sub-1",
    properties: { diskState },
  };
}

describe("findDiskIdleLowUtilization", () => {
  it("flags a disk with under 1 IOPS average over 90 days as HARD_SAVING", async () => {
    const getAverageIops = vi.fn().mockResolvedValue(0.2);
    const resources = [disk("/subscriptions/sub-1/disks/disk-1")];

    const result = await findDiskIdleLowUtilization(resources, getAverageIops);

    expect(result).toEqual([
      {
        ruleType: "DISK_IDLE_LOW_UTILIZATION",
        resourceId: "/subscriptions/sub-1/disks/disk-1",
        subscriptionId: "sub-1",
        savingsCategory: "HARD_SAVING",
        metricObserved: 0.2,
        periodAnalyzedDays: 90,
      },
    ]);
  });

  it("flags a disk with moderate IOPS (5-10 range, 30 days) as POTENTIAL_SAVING", async () => {
    const getAverageIops = vi.fn().mockImplementation(async (_id: string, days: number) => {
      if (days === 90) return 12;
      if (days === 60) return 12;
      if (days === 30) return 7;
      return 12;
    });
    const resources = [disk("/subscriptions/sub-1/disks/disk-2")];

    const result = await findDiskIdleLowUtilization(resources, getAverageIops);

    expect(result).toEqual([
      {
        ruleType: "DISK_IDLE_LOW_UTILIZATION",
        resourceId: "/subscriptions/sub-1/disks/disk-2",
        subscriptionId: "sub-1",
        savingsCategory: "POTENTIAL_SAVING",
        metricObserved: 7,
        periodAnalyzedDays: 30,
      },
    ]);
  });

  it("does not flag a disk with healthy IOPS", async () => {
    const getAverageIops = vi.fn().mockResolvedValue(500);
    const resources = [disk("/subscriptions/sub-1/disks/disk-3")];

    expect(await findDiskIdleLowUtilization(resources, getAverageIops)).toEqual([]);
  });

  it("does not evaluate an Unattached disk (already covered by ORPHANED_DISK)", async () => {
    const getAverageIops = vi.fn();
    const resources = [disk("/subscriptions/sub-1/disks/disk-4", "Unattached")];

    expect(await findDiskIdleLowUtilization(resources, getAverageIops)).toEqual([]);
    expect(getAverageIops).not.toHaveBeenCalled();
  });

  it("ignores non-disk resources", () => {
    const vm: ResourceGraphRow = {
      id: "/subscriptions/sub-1/virtualMachines/vm-1",
      type: "microsoft.compute/virtualmachines",
      subscriptionId: "sub-1",
      properties: {},
    };
    return expect(findDiskIdleLowUtilization([vm], vi.fn())).resolves.toEqual([]);
  });
});
