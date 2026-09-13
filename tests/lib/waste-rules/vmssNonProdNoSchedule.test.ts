import { describe, expect, it } from "vitest";
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import { findVmssNonProdWithoutSchedule } from "@/lib/waste-rules/vmssNonProdNoSchedule";

const DEV_VMSS_ID = "/subscriptions/sub-1/.../virtualMachineScaleSets/vmss-dev-01";
const PROD_VMSS_ID = "/subscriptions/sub-1/.../virtualMachineScaleSets/vmss-prod-01";

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

describe("findVmssNonProdWithoutSchedule", () => {
  it("flags a dev-named VMSS with no autoscale recurrence at all", () => {
    expect(findVmssNonProdWithoutSchedule([vmss(DEV_VMSS_ID)])).toEqual([
      {
        ruleType: "VMSS_NONPROD_NO_SCHEDULE",
        resourceId: DEV_VMSS_ID,
        subscriptionId: "sub-1",
        savingsCategory: "POTENTIAL_SAVING",
      },
    ]);
  });

  it("flags a dev-named VMSS whose autoscale profiles have no recurrence block", () => {
    const resources = [
      vmss(DEV_VMSS_ID),
      autoscaleSetting(DEV_VMSS_ID, [{ capacity: { minimum: "1", maximum: "3" } }]),
    ];

    expect(findVmssNonProdWithoutSchedule(resources)).toEqual([
      {
        ruleType: "VMSS_NONPROD_NO_SCHEDULE",
        resourceId: DEV_VMSS_ID,
        subscriptionId: "sub-1",
        savingsCategory: "POTENTIAL_SAVING",
      },
    ]);
  });

  it("does not flag a dev-named VMSS that already has a recurrence-scheduled profile", () => {
    const resources = [
      vmss(DEV_VMSS_ID),
      autoscaleSetting(DEV_VMSS_ID, [
        { capacity: { minimum: "0", maximum: "3" }, recurrence: { frequency: "Week" } },
      ]),
    ];

    expect(findVmssNonProdWithoutSchedule(resources)).toEqual([]);
  });

  it("does not flag a production-named VMSS", () => {
    expect(findVmssNonProdWithoutSchedule([vmss(PROD_VMSS_ID)])).toEqual([]);
  });
});
