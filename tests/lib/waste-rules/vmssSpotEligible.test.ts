import { describe, expect, it } from "vitest";
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import { findVmssSpotEligible } from "@/lib/waste-rules/vmssSpotEligible";

function vmss(id: string, priority?: string): ResourceGraphRow {
  return {
    id,
    type: "microsoft.compute/virtualmachinescalesets",
    subscriptionId: "sub-1",
    properties: { virtualMachineProfile: priority ? { priority } : {} },
  };
}

describe("findVmssSpotEligible", () => {
  it("flags a dev-named VMSS still running at Regular priority", () => {
    const v = vmss("/subscriptions/sub-1/.../virtualMachineScaleSets/vmss-dev-01", "Regular");

    expect(findVmssSpotEligible([v])).toEqual([
      {
        ruleType: "VMSS_SPOT_ELIGIBLE",
        resourceId: v.id,
        subscriptionId: "sub-1",
        savingsCategory: "POTENTIAL_SAVING",
      },
    ]);
  });

  it("flags a dev-named VMSS with no priority set (defaults to Regular)", () => {
    const v = vmss("/subscriptions/sub-1/.../virtualMachineScaleSets/vmss-test-02");

    expect(findVmssSpotEligible([v])).toHaveLength(1);
  });

  it("does not flag a dev-named VMSS already running at Spot priority", () => {
    const v = vmss("/subscriptions/sub-1/.../virtualMachineScaleSets/vmss-dev-01", "Spot");

    expect(findVmssSpotEligible([v])).toEqual([]);
  });

  it("does not flag a production-named VMSS", () => {
    const v = vmss("/subscriptions/sub-1/.../virtualMachineScaleSets/vmss-prod-01", "Regular");

    expect(findVmssSpotEligible([v])).toEqual([]);
  });
});
