import { describe, expect, it } from "vitest";
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import { findVmssOutdatedModelInstances } from "@/lib/waste-rules/vmssOutdatedModelInstances";

const VMSS_ID =
  "/subscriptions/sub-1/resourceGroups/rg1/providers/Microsoft.Compute/virtualMachineScaleSets/vmss-1";

function instance(index: number, latestModelApplied: boolean): ResourceGraphRow {
  return {
    id: `${VMSS_ID}/virtualMachines/${index}`,
    type: "microsoft.compute/virtualmachinescalesets/virtualmachines",
    subscriptionId: "sub-1",
    properties: { latestModelApplied },
  };
}

describe("findVmssOutdatedModelInstances", () => {
  it("flags the parent VMSS once when at least one instance has latestModelApplied=false", () => {
    const resources = [instance(0, true), instance(1, false), instance(2, true)];

    expect(findVmssOutdatedModelInstances(resources)).toEqual([
      {
        ruleType: "VMSS_OUTDATED_MODEL_INSTANCES",
        resourceId: VMSS_ID,
        subscriptionId: "sub-1",
        savingsCategory: "POTENTIAL_SAVING",
      },
    ]);
  });

  it("does not flag a VMSS whose instances are all on the latest model", () => {
    const resources = [instance(0, true), instance(1, true)];

    expect(findVmssOutdatedModelInstances(resources)).toEqual([]);
  });

  it("emits only one candidate even when multiple instances of the same VMSS are stale", () => {
    const resources = [instance(0, false), instance(1, false)];

    expect(findVmssOutdatedModelInstances(resources)).toHaveLength(1);
  });

  it("ignores non-VMSS-instance resources", () => {
    const disk: ResourceGraphRow = {
      id: "disk-1",
      type: "microsoft.compute/disks",
      subscriptionId: "sub-1",
      properties: {},
    };

    expect(findVmssOutdatedModelInstances([disk])).toEqual([]);
  });
});
