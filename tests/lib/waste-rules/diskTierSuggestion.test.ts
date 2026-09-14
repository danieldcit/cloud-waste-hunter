import { describe, expect, it, vi } from "vitest";
import { suggestDiskTier } from "@/lib/waste-rules/diskTierSuggestion";

const resource = {
  id: "/subscriptions/x/resourceGroups/y/providers/Microsoft.Compute/disks/disk-1",
  type: "microsoft.compute/disks",
  subscriptionId: "sub-1",
  location: "brazilsouth",
  sku: { name: "Premium_LRS" },
  properties: { diskSizeGB: 1024 },
};

describe("suggestDiskTier", () => {
  it("returns null when peak IOPS is unavailable", async () => {
    const result = await suggestDiskTier(resource, vi.fn().mockResolvedValue(null), vi.fn());
    expect(result).toBeNull();
  });

  it("returns null when the suggested size is not smaller than the current size", async () => {
    // peak IOPS high enough that the safe tier is >= current 1024 GiB
    const result = await suggestDiskTier(
      resource,
      vi.fn().mockResolvedValue(100_000),
      vi.fn(),
    );
    expect(result).toBeNull();
  });

  it("returns the size and price delta when the suggested size is genuinely smaller", async () => {
    const priceDisk = vi.fn()
      .mockResolvedValueOnce(120) // current 1024 GiB
      .mockResolvedValueOnce(20); // suggested 128 GiB
    const result = await suggestDiskTier(
      resource,
      vi.fn().mockResolvedValue(300), // low peak -> small suggested tier
      priceDisk,
    );
    expect(result).toEqual({ suggestedSizeGb: 128, monthlySavings: 100 });
  });

  it("returns null when pricing either size fails", async () => {
    const result = await suggestDiskTier(
      resource,
      vi.fn().mockResolvedValue(300),
      vi.fn().mockRejectedValue(new Error("Retail Prices API 429")),
    );
    expect(result).toBeNull();
  });
});
