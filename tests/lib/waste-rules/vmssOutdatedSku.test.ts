import { describe, expect, it } from "vitest";
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import { findOutdatedVmssSkus } from "@/lib/waste-rules/vmssOutdatedSku";

function vmssWithSize(id: string, vmSize: string): ResourceGraphRow {
  return {
    id,
    type: "microsoft.compute/virtualmachinescalesets",
    subscriptionId: "sub-1",
    properties: { virtualMachineProfile: { hardwareProfile: { vmSize } } },
  };
}

describe("findOutdatedVmssSkus", () => {
  it("flags a VMSS on a deprecated size", () => {
    const vmss = vmssWithSize("/subscriptions/sub-1/vmss-old", "Standard_A2");

    expect(findOutdatedVmssSkus([vmss])).toEqual([
      {
        ruleType: "VMSS_OUTDATED_SKU_GENERATION",
        resourceId: vmss.id,
        subscriptionId: "sub-1",
        savingsCategory: "POTENTIAL_SAVING",
      },
    ]);
  });

  it("does not flag a VMSS on a current-generation size", () => {
    const vmss = vmssWithSize("/subscriptions/sub-1/vmss-current", "Standard_D2s_v5");

    expect(findOutdatedVmssSkus([vmss])).toEqual([]);
  });

  it("ignores non-VMSS resources", () => {
    const disk: ResourceGraphRow = {
      id: "disk-1",
      type: "microsoft.compute/disks",
      subscriptionId: "sub-1",
      properties: {},
    };

    expect(findOutdatedVmssSkus([disk])).toEqual([]);
  });
});
