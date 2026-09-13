import { describe, expect, it, vi } from "vitest";
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import { findVmssMissingSavingsPlanOrReservation } from "@/lib/waste-rules/vmssMissingSavingsPlanOrReservation";

function vmss(id: string, vmSize: string, region: string, subscriptionId = "sub-1"): ResourceGraphRow {
  return {
    id,
    type: "microsoft.compute/virtualmachinescalesets",
    subscriptionId,
    location: region,
    properties: { virtualMachineProfile: { hardwareProfile: { vmSize } } },
  };
}

describe("findVmssMissingSavingsPlanOrReservation", () => {
  it("flags a VMSS whose SKU/region has a positive reservation recommendation", async () => {
    const v = vmss("/subscriptions/sub-1/vmss-1", "Standard_D2s_v5", "eastus");
    const listRecommendations = vi.fn().mockResolvedValue([
      {
        properties: {
          skuName: "Standard_D2s_v5",
          location: "eastus",
          recommendedQuantity: 1,
          netSavings: 100,
        },
      },
    ]);

    const result = await findVmssMissingSavingsPlanOrReservation([v], listRecommendations);

    expect(result).toEqual([
      {
        ruleType: "VMSS_MISSING_SAVINGS_PLAN_OR_RESERVATION",
        resourceId: v.id,
        subscriptionId: "sub-1",
        savingsCategory: "POTENTIAL_SAVING",
      },
    ]);
    expect(listRecommendations).toHaveBeenCalledWith("sub-1");
  });

  it("does not flag a VMSS with no matching recommendation", async () => {
    const v = vmss("/subscriptions/sub-1/vmss-2", "Standard_D2s_v5", "eastus");
    const listRecommendations = vi.fn().mockResolvedValue([]);

    const result = await findVmssMissingSavingsPlanOrReservation([v], listRecommendations);

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
    const listRecommendations = vi.fn();

    const result = await findVmssMissingSavingsPlanOrReservation([v], listRecommendations);

    expect(result).toEqual([]);
    expect(listRecommendations).not.toHaveBeenCalled();
  });

  it("ignores non-VMSS resources", async () => {
    const disk: ResourceGraphRow = {
      id: "disk-1",
      type: "microsoft.compute/disks",
      subscriptionId: "sub-1",
      properties: {},
    };
    const listRecommendations = vi.fn();

    const result = await findVmssMissingSavingsPlanOrReservation([disk], listRecommendations);

    expect(result).toEqual([]);
    expect(listRecommendations).not.toHaveBeenCalled();
  });

  it("fetches the recommendation list once per subscription across multiple VMSS candidates, not once per candidate", async () => {
    const v1 = vmss("/subscriptions/sub-1/vmss-a", "Standard_D2s_v5", "eastus");
    const v2 = vmss("/subscriptions/sub-1/vmss-b", "Standard_D4s_v5", "eastus");
    const v3 = vmss("/subscriptions/sub-1/vmss-c", "Standard_D8s_v5", "westus");
    const listRecommendations = vi.fn().mockResolvedValue([
      { properties: { skuName: "Standard_D2s_v5", location: "eastus", recommendedQuantity: 1 } },
    ]);

    const result = await findVmssMissingSavingsPlanOrReservation([v1, v2, v3], listRecommendations);

    expect(listRecommendations).toHaveBeenCalledTimes(1);
    expect(listRecommendations).toHaveBeenCalledWith("sub-1");
    expect(result).toEqual([
      {
        ruleType: "VMSS_MISSING_SAVINGS_PLAN_OR_RESERVATION",
        resourceId: v1.id,
        subscriptionId: "sub-1",
        savingsCategory: "POTENTIAL_SAVING",
      },
    ]);
  });

  it("fetches the recommendation list once per distinct subscription, not once per candidate", async () => {
    const v1 = vmss("/subscriptions/sub-1/vmss-a", "Standard_D2s_v5", "eastus", "sub-1");
    const v2 = vmss("/subscriptions/sub-2/vmss-b", "Standard_D2s_v5", "eastus", "sub-2");
    const listRecommendations = vi.fn().mockResolvedValue([]);

    await findVmssMissingSavingsPlanOrReservation([v1, v2], listRecommendations);

    expect(listRecommendations).toHaveBeenCalledTimes(2);
    expect(listRecommendations).toHaveBeenNthCalledWith(1, "sub-1");
    expect(listRecommendations).toHaveBeenNthCalledWith(2, "sub-2");
  });
});
