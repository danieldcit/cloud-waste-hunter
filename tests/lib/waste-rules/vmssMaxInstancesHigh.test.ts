import { describe, expect, it } from "vitest";
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import { findVmssWithHighMaxInstances } from "@/lib/waste-rules/vmssMaxInstancesHigh";

const VMSS_ID = "/subscriptions/sub-1/.../virtualMachineScaleSets/vmss-1";

function vmss(id: string): ResourceGraphRow {
  return {
    id,
    type: "microsoft.compute/virtualmachinescalesets",
    subscriptionId: "sub-1",
    properties: {},
  };
}

function autoscaleSetting(targetResourceUri: string, profiles: unknown[]): ResourceGraphRow {
  return {
    id: "setting-1",
    type: "microsoft.insights/autoscalesettings",
    subscriptionId: "sub-1",
    properties: { targetResourceUri, profiles },
  };
}

describe("findVmssWithHighMaxInstances", () => {
  it("flags a VMSS whose autoscale max exceeds 10", () => {
    const resources = [
      vmss(VMSS_ID),
      autoscaleSetting(VMSS_ID, [{ capacity: { minimum: "2", maximum: "20" } }]),
    ];

    expect(findVmssWithHighMaxInstances(resources)).toEqual([
      {
        ruleType: "VMSS_MAX_INSTANCES_HIGH",
        resourceId: VMSS_ID,
        subscriptionId: "sub-1",
        savingsCategory: "POTENTIAL_SAVING",
      },
    ]);
  });

  it("does not flag a VMSS whose max is at or below 10", () => {
    const resources = [
      vmss(VMSS_ID),
      autoscaleSetting(VMSS_ID, [{ capacity: { minimum: "2", maximum: "10" } }]),
    ];

    expect(findVmssWithHighMaxInstances(resources)).toEqual([]);
  });

  it("does not flag a VMSS with no autoscale setting", () => {
    expect(findVmssWithHighMaxInstances([vmss(VMSS_ID)])).toEqual([]);
  });
});
