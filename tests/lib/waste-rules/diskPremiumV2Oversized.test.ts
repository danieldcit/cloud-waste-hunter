import { describe, expect, it, vi } from "vitest";
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import { findDiskPremiumV2Oversized } from "@/lib/waste-rules/diskPremiumV2Oversized";

function premiumV2Disk(
  id: string,
  diskIOPSReadWrite?: number,
  diskState = "Attached",
): ResourceGraphRow {
  return {
    id,
    type: "microsoft.compute/disks",
    subscriptionId: "sub-1",
    sku: { name: "PremiumV2_LRS" },
    properties: { diskState, diskIOPSReadWrite },
  };
}

describe("findDiskPremiumV2Oversized", () => {
  it("flags a PremiumV2 disk whose configured IOPS is at least 3x the observed average", async () => {
    const getAverageIops = vi.fn().mockResolvedValue(1000);
    const resources = [premiumV2Disk("/subscriptions/sub-1/disks/disk-1", 4500)];

    const result = await findDiskPremiumV2Oversized(resources, getAverageIops);

    expect(result).toEqual([
      {
        ruleType: "DISK_PREMIUM_V2_OVERSIZED",
        resourceId: "/subscriptions/sub-1/disks/disk-1",
        subscriptionId: "sub-1",
        savingsCategory: "POTENTIAL_SAVING",
        metricObserved: 1000,
        periodAnalyzedDays: 30,
      },
    ]);
  });

  it("does not flag a disk configured at exactly the included 3000 IOPS floor", async () => {
    const getAverageIops = vi.fn();
    const resources = [premiumV2Disk("/subscriptions/sub-1/disks/disk-floor", 3000)];

    expect(await findDiskPremiumV2Oversized(resources, getAverageIops)).toEqual([]);
    expect(getAverageIops).not.toHaveBeenCalled();
  });

  it("skips a disk when getAverageIops resolves null (no metric data)", async () => {
    const getAverageIops = vi.fn().mockResolvedValue(null);
    const resources = [premiumV2Disk("/subscriptions/sub-1/disks/disk-null", 4500)];

    expect(await findDiskPremiumV2Oversized(resources, getAverageIops)).toEqual([]);
  });

  it("does not evaluate an Unattached PremiumV2 disk (already covered by ORPHANED_DISK)", async () => {
    const getAverageIops = vi.fn();
    const resources = [premiumV2Disk("/subscriptions/sub-1/disks/disk-unattached", 4500, "Unattached")];

    expect(await findDiskPremiumV2Oversized(resources, getAverageIops)).toEqual([]);
    expect(getAverageIops).not.toHaveBeenCalled();
  });

  it("does not flag when configured IOPS is proportionate to observed usage", async () => {
    const getAverageIops = vi.fn().mockResolvedValue(1000);
    const resources = [premiumV2Disk("/subscriptions/sub-1/disks/disk-2", 1500)];

    expect(await findDiskPremiumV2Oversized(resources, getAverageIops)).toEqual([]);
  });

  it("skips a PremiumV2 disk with no configured diskIOPSReadWrite value", async () => {
    const getAverageIops = vi.fn();
    const resources = [premiumV2Disk("/subscriptions/sub-1/disks/disk-3", undefined)];

    expect(await findDiskPremiumV2Oversized(resources, getAverageIops)).toEqual([]);
    expect(getAverageIops).not.toHaveBeenCalled();
  });

  it("ignores non-PremiumV2 disks", async () => {
    const getAverageIops = vi.fn();
    const resources: ResourceGraphRow[] = [
      {
        id: "/subscriptions/sub-1/disks/disk-4",
        type: "microsoft.compute/disks",
        subscriptionId: "sub-1",
        sku: { name: "Premium_LRS" },
        properties: { diskState: "Attached" },
      },
    ];

    expect(await findDiskPremiumV2Oversized(resources, getAverageIops)).toEqual([]);
  });
});
