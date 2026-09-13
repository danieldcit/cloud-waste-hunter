import { describe, expect, it, vi } from "vitest";
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import { findVmssIdleLowUtilization } from "@/lib/waste-rules/vmssIdleLowUtilization";

function vmssRow(id: string): ResourceGraphRow {
  return {
    id,
    type: "microsoft.compute/virtualmachinescalesets",
    subscriptionId: "sub-1",
    properties: {},
  };
}

describe("findVmssIdleLowUtilization", () => {
  it("classifies as HARD_SAVING when 90-day CPU average is below 5%", async () => {
    const vmss = vmssRow("/subscriptions/sub-1/vmss-90d-hard");
    const getAverageCpu = vi.fn().mockResolvedValue(2);

    const result = await findVmssIdleLowUtilization([vmss], getAverageCpu);

    expect(result).toEqual([
      {
        ruleType: "VMSS_IDLE_LOW_UTILIZATION",
        resourceId: vmss.id,
        subscriptionId: "sub-1",
        savingsCategory: "HARD_SAVING",
        metricObserved: 2,
        periodAnalyzedDays: 90,
      },
    ]);
  });

  it("classifies as POTENTIAL_SAVING on 30-day CPU below 20% when no stronger tier matches", async () => {
    const vmss = vmssRow("/subscriptions/sub-1/vmss-30d-potential");
    const getAverageCpu = vi.fn().mockImplementation((_id: string, days: number) =>
      Promise.resolve(days === 30 ? 18 : 25),
    );

    const result = await findVmssIdleLowUtilization([vmss], getAverageCpu);

    expect(result).toEqual([
      {
        ruleType: "VMSS_IDLE_LOW_UTILIZATION",
        resourceId: vmss.id,
        subscriptionId: "sub-1",
        savingsCategory: "POTENTIAL_SAVING",
        metricObserved: 18,
        periodAnalyzedDays: 30,
      },
    ]);
  });

  it("excludes a VMSS whose CPU average is at or above every threshold in all windows", async () => {
    const vmss = vmssRow("/subscriptions/sub-1/vmss-busy");
    const getAverageCpu = vi.fn().mockResolvedValue(25);

    const result = await findVmssIdleLowUtilization([vmss], getAverageCpu);

    expect(result).toEqual([]);
  });

  it("never calls the CPU fetcher for a non-VMSS resource", async () => {
    const disk: ResourceGraphRow = {
      id: "disk-1",
      type: "microsoft.compute/disks",
      subscriptionId: "sub-1",
      properties: {},
    };
    const getAverageCpu = vi.fn().mockResolvedValue(0);

    const result = await findVmssIdleLowUtilization([disk], getAverageCpu);

    expect(result).toEqual([]);
    expect(getAverageCpu).not.toHaveBeenCalled();
  });
});
