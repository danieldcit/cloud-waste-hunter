import { describe, expect, it } from "vitest";
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import { findOutdatedVmSkus } from "@/lib/waste-rules/outdatedVmSku";

function vmWithSize(id: string, vmSize: string): ResourceGraphRow {
  return {
    id,
    type: "microsoft.compute/virtualmachines",
    subscriptionId: "sub-1",
    properties: { hardwareProfile: { vmSize } },
  };
}

describe("findOutdatedVmSkus", () => {
  it("flags a VM on a deprecated size", () => {
    const vm = vmWithSize("/subscriptions/sub-1/vm-old", "Standard_A2");

    expect(findOutdatedVmSkus([vm])).toEqual([
      {
        ruleType: "VM_OUTDATED_SKU_GENERATION",
        resourceId: vm.id,
        subscriptionId: "sub-1",
        savingsCategory: "POTENTIAL_SAVING",
      },
    ]);
  });

  it("does not flag a VM on a current-generation size", () => {
    const vm = vmWithSize("/subscriptions/sub-1/vm-current", "Standard_D2s_v5");

    expect(findOutdatedVmSkus([vm])).toEqual([]);
  });

  it("ignores non-VM resources", () => {
    const disk: ResourceGraphRow = {
      id: "disk-1",
      type: "microsoft.compute/disks",
      subscriptionId: "sub-1",
      properties: {},
    };

    expect(findOutdatedVmSkus([disk])).toEqual([]);
  });
});
