import { describe, expect, it, vi } from "vitest";
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import { findDiskTierOversized } from "@/lib/waste-rules/diskTierOversized";

function premiumDisk(
  id: string,
  sizeGb: number,
  skuName = "Premium_LRS",
  diskState = "Attached",
): ResourceGraphRow {
  return {
    id,
    type: "microsoft.compute/disks",
    subscriptionId: "sub-1",
    sku: { name: skuName },
    properties: { diskState, diskSizeGB: sizeGb },
  };
}

describe("findDiskTierOversized", () => {
  it("flags a P30 (1024 GiB, 5000 IOPS max) disk whose observed IOPS is under 20% of that", async () => {
    const getAverageIops = vi.fn().mockResolvedValue(500); // 500 < 5000 * 0.2 = 1000
    const resources = [premiumDisk("/subscriptions/sub-1/disks/disk-1", 1024)];

    const result = await findDiskTierOversized(resources, getAverageIops);

    expect(result).toEqual([
      {
        ruleType: "DISK_TIER_OVERSIZED",
        resourceId: "/subscriptions/sub-1/disks/disk-1",
        subscriptionId: "sub-1",
        savingsCategory: "POTENTIAL_SAVING",
        metricObserved: 500,
        periodAnalyzedDays: 30,
      },
    ]);
  });

  it("does not flag a disk whose observed IOPS is at or above 20% of its tier's max", async () => {
    const getAverageIops = vi.fn().mockResolvedValue(1000); // 1000 >= 5000 * 0.2
    const resources = [premiumDisk("/subscriptions/sub-1/disks/disk-2", 1024)];

    expect(await findDiskTierOversized(resources, getAverageIops)).toEqual([]);
  });

  it("does not evaluate a Standard disk", async () => {
    const getAverageIops = vi.fn();
    const resources = [premiumDisk("/subscriptions/sub-1/disks/disk-3", 1024, "Standard_LRS")];

    expect(await findDiskTierOversized(resources, getAverageIops)).toEqual([]);
    expect(getAverageIops).not.toHaveBeenCalled();
  });

  it("does not evaluate UltraSSD_LRS (not a fixed size tier)", async () => {
    const getAverageIops = vi.fn();
    const resources = [premiumDisk("/subscriptions/sub-1/disks/disk-4", 1024, "UltraSSD_LRS")];

    expect(await findDiskTierOversized(resources, getAverageIops)).toEqual([]);
    expect(getAverageIops).not.toHaveBeenCalled();
  });

  it("skips a disk when getAverageIops resolves null (no metric data)", async () => {
    const getAverageIops = vi.fn().mockResolvedValue(null);
    const resources = [premiumDisk("/subscriptions/sub-1/disks/disk-5", 1024)];

    expect(await findDiskTierOversized(resources, getAverageIops)).toEqual([]);
  });

  it("does not evaluate an Unattached Premium disk (already covered by ORPHANED_DISK)", async () => {
    const getAverageIops = vi.fn();
    const resources = [premiumDisk("/subscriptions/sub-1/disks/disk-6", 1024, "Premium_LRS", "Unattached")];

    expect(await findDiskTierOversized(resources, getAverageIops)).toEqual([]);
    expect(getAverageIops).not.toHaveBeenCalled();
  });
});
