import { describe, expect, it, vi } from "vitest";
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import { findDiskPremiumTierUnnecessary } from "@/lib/waste-rules/diskPremiumTierUnnecessary";

function disk(id: string, skuName: string, diskState = "Attached"): ResourceGraphRow {
  return {
    id,
    type: "microsoft.compute/disks",
    subscriptionId: "sub-1",
    sku: { name: skuName },
    properties: { diskState },
  };
}

describe("findDiskPremiumTierUnnecessary", () => {
  it.each(["Premium_LRS", "Premium_ZRS", "UltraSSD_LRS"])(
    "flags a %s disk with average IOPS below 500",
    async (skuName) => {
      const getAverageIops = vi.fn().mockResolvedValue(120);
      const resources = [disk("/subscriptions/sub-1/disks/disk-1", skuName)];

      const result = await findDiskPremiumTierUnnecessary(resources, getAverageIops);

      expect(result).toEqual([
        {
          ruleType: "DISK_PREMIUM_TIER_UNNECESSARY",
          resourceId: "/subscriptions/sub-1/disks/disk-1",
          subscriptionId: "sub-1",
          savingsCategory: "POTENTIAL_SAVING",
          metricObserved: 120,
          periodAnalyzedDays: 30,
        },
      ]);
    },
  );

  it("does not flag a Premium disk with IOPS at or above the threshold", async () => {
    const getAverageIops = vi.fn().mockResolvedValue(500);
    const resources = [disk("/subscriptions/sub-1/disks/disk-2", "Premium_LRS")];

    expect(await findDiskPremiumTierUnnecessary(resources, getAverageIops)).toEqual([]);
  });

  it("does not flag a Standard disk", async () => {
    const getAverageIops = vi.fn().mockResolvedValue(1);
    const resources = [disk("/subscriptions/sub-1/disks/disk-3", "Standard_LRS")];

    expect(await findDiskPremiumTierUnnecessary(resources, getAverageIops)).toEqual([]);
    expect(getAverageIops).not.toHaveBeenCalled();
  });

  it("skips a disk when getAverageIops resolves null (no metric data)", async () => {
    const getAverageIops = vi.fn().mockResolvedValue(null);
    const resources = [disk("/subscriptions/sub-1/disks/disk-4", "Premium_LRS")];

    expect(await findDiskPremiumTierUnnecessary(resources, getAverageIops)).toEqual([]);
  });

  it("does not evaluate an Unattached Premium disk (already covered by ORPHANED_DISK)", async () => {
    const getAverageIops = vi.fn();
    const resources = [disk("/subscriptions/sub-1/disks/disk-5", "Premium_LRS", "Unattached")];

    expect(await findDiskPremiumTierUnnecessary(resources, getAverageIops)).toEqual([]);
    expect(getAverageIops).not.toHaveBeenCalled();
  });
});
