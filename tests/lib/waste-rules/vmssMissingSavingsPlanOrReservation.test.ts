import { describe, expect, it, vi } from "vitest";
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import { findVmssMissingSavingsPlanOrReservation } from "@/lib/waste-rules/vmssMissingSavingsPlanOrReservation";

function vmss(id: string, vmSize: string, region: string): ResourceGraphRow {
  return {
    id,
    type: "microsoft.compute/virtualmachinescalesets",
    subscriptionId: "sub-1",
    location: region,
    properties: { virtualMachineProfile: { hardwareProfile: { vmSize } } },
  };
}

describe("findVmssMissingSavingsPlanOrReservation", () => {
  it("flags a VMSS whose SKU/region has a positive reservation recommendation", async () => {
    const v = vmss("/subscriptions/sub-1/vmss-1", "Standard_D2s_v5", "eastus");
    const findRecommendation = vi.fn().mockResolvedValue({
      properties: { netSavings: 100 },
    });

    const result = await findVmssMissingSavingsPlanOrReservation([v], findRecommendation);

    expect(result).toEqual([
      {
        ruleType: "VMSS_MISSING_SAVINGS_PLAN_OR_RESERVATION",
        resourceId: v.id,
        subscriptionId: "sub-1",
        savingsCategory: "POTENTIAL_SAVING",
      },
    ]);
    expect(findRecommendation).toHaveBeenCalledWith("sub-1", "Standard_D2s_v5", "eastus");
  });

  it("does not flag a VMSS with no matching recommendation", async () => {
    const v = vmss("/subscriptions/sub-1/vmss-2", "Standard_D2s_v5", "eastus");
    const findRecommendation = vi.fn().mockResolvedValue(undefined);

    const result = await findVmssMissingSavingsPlanOrReservation([v], findRecommendation);

    expect(result).toEqual([]);
  });

  it("skips a VMSS whose vmSize can't be determined without calling the API", async () => {
    const v: ResourceGraphRow = {
      id: "/subscriptions/sub-1/vmss-3",
      type: "microsoft.compute/virtualmachinescalesets",
      subscriptionId: "sub-1",
      location: "eastus",
      properties: {},
    };
    const findRecommendation = vi.fn();

    const result = await findVmssMissingSavingsPlanOrReservation([v], findRecommendation);

    expect(result).toEqual([]);
    expect(findRecommendation).not.toHaveBeenCalled();
  });

  it("ignores non-VMSS resources", async () => {
    const disk: ResourceGraphRow = {
      id: "disk-1",
      type: "microsoft.compute/disks",
      subscriptionId: "sub-1",
      properties: {},
    };
    const findRecommendation = vi.fn();

    const result = await findVmssMissingSavingsPlanOrReservation([disk], findRecommendation);

    expect(result).toEqual([]);
    expect(findRecommendation).not.toHaveBeenCalled();
  });
});
