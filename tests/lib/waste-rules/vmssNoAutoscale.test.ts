import { describe, expect, it } from "vitest";
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import { findVmssWithoutAutoscale } from "@/lib/waste-rules/vmssNoAutoscale";

const VMSS_ID = "/subscriptions/sub-1/.../virtualMachineScaleSets/vmss-1";

function vmss(id: string): ResourceGraphRow {
  return {
    id,
    type: "microsoft.compute/virtualmachinescalesets",
    subscriptionId: "sub-1",
    sku: { name: "Standard_D2s_v5", capacity: 3 },
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

describe("findVmssWithoutAutoscale", () => {
  it("flags a VMSS with no autoscale setting at all", () => {
    const resources = [vmss(VMSS_ID)];

    expect(findVmssWithoutAutoscale(resources)).toEqual([
      {
        ruleType: "VMSS_NO_AUTOSCALE",
        resourceId: VMSS_ID,
        subscriptionId: "sub-1",
        savingsCategory: "POTENTIAL_SAVING",
      },
    ]);
  });

  it("flags a VMSS whose autoscale profile has minimum == maximum", () => {
    const resources = [
      vmss(VMSS_ID),
      autoscaleSetting(VMSS_ID, [{ capacity: { minimum: "3", maximum: "3" } }]),
    ];

    expect(findVmssWithoutAutoscale(resources)).toEqual([
      {
        ruleType: "VMSS_NO_AUTOSCALE",
        resourceId: VMSS_ID,
        subscriptionId: "sub-1",
        savingsCategory: "POTENTIAL_SAVING",
      },
    ]);
  });

  it("does not flag a VMSS with a real min/max range", () => {
    const resources = [
      vmss(VMSS_ID),
      autoscaleSetting(VMSS_ID, [{ capacity: { minimum: "2", maximum: "8" } }]),
    ];

    expect(findVmssWithoutAutoscale(resources)).toEqual([]);
  });

  it("ignores non-VMSS resources", () => {
    const disk: ResourceGraphRow = {
      id: "disk-1",
      type: "microsoft.compute/disks",
      subscriptionId: "sub-1",
      properties: {},
    };

    expect(findVmssWithoutAutoscale([disk])).toEqual([]);
  });
});
