import { describe, expect, it } from "vitest";
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import { findDiskNonProdPremium } from "@/lib/waste-rules/diskNonProdPremium";

function disk(id: string, skuName: string): ResourceGraphRow {
  return {
    id,
    type: "microsoft.compute/disks",
    subscriptionId: "sub-1",
    sku: { name: skuName },
    properties: {},
  };
}

describe("findDiskNonProdPremium", () => {
  it.each(["Premium_LRS", "Premium_ZRS", "UltraSSD_LRS"])(
    "flags a %s disk with a non-prod name",
    (skuName) => {
      const resources = [disk("/subscriptions/sub-1/disks/dev-app-osdisk", skuName)];

      expect(findDiskNonProdPremium(resources)).toEqual([
        {
          ruleType: "DISK_NONPROD_PREMIUM",
          resourceId: "/subscriptions/sub-1/disks/dev-app-osdisk",
          subscriptionId: "sub-1",
          savingsCategory: "POTENTIAL_SAVING",
        },
      ]);
    },
  );

  it("does not flag a production-named Premium disk", () => {
    const resources = [disk("/subscriptions/sub-1/disks/prod-app-osdisk", "Premium_LRS")];
    expect(findDiskNonProdPremium(resources)).toEqual([]);
  });

  it("does not flag a non-prod-named Standard disk", () => {
    const resources = [disk("/subscriptions/sub-1/disks/dev-app-osdisk", "Standard_LRS")];
    expect(findDiskNonProdPremium(resources)).toEqual([]);
  });
});
