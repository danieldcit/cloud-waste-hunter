import { describe, expect, it } from "vitest";
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import { findVmssAutoscaleWithoutScaleIn } from "@/lib/waste-rules/vmssAutoscaleNoScaleIn";

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

describe("findVmssAutoscaleWithoutScaleIn", () => {
  it("flags a VMSS whose autoscale has only Increase rules, never Decrease", () => {
    const resources = [
      vmss(VMSS_ID),
      autoscaleSetting(VMSS_ID, [
        {
          capacity: { minimum: "2", maximum: "8" },
          rules: [{ scaleAction: { direction: "Increase" } }],
        },
      ]),
    ];

    expect(findVmssAutoscaleWithoutScaleIn(resources)).toEqual([
      {
        ruleType: "VMSS_AUTOSCALE_NO_SCALE_IN",
        resourceId: VMSS_ID,
        subscriptionId: "sub-1",
        savingsCategory: "POTENTIAL_SAVING",
      },
    ]);
  });

  it("does not flag a VMSS with at least one Decrease rule in any profile", () => {
    const resources = [
      vmss(VMSS_ID),
      autoscaleSetting(VMSS_ID, [
        {
          capacity: { minimum: "2", maximum: "8" },
          rules: [
            { scaleAction: { direction: "Increase" } },
            { scaleAction: { direction: "Decrease" } },
          ],
        },
      ]),
    ];

    expect(findVmssAutoscaleWithoutScaleIn(resources)).toEqual([]);
  });

  it("does not flag a VMSS with no autoscale settings at all (covered by VMSS_NO_AUTOSCALE instead)", () => {
    expect(findVmssAutoscaleWithoutScaleIn([vmss(VMSS_ID)])).toEqual([]);
  });
});
