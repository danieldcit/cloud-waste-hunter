import { describe, expect, it, vi } from "vitest";
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import { findIdleVirtualMachines } from "@/lib/waste-rules/idleVirtualMachines";

function vmRow(id: string): ResourceGraphRow {
  return {
    id,
    type: "microsoft.compute/virtualmachines",
    subscriptionId: "sub-1",
    properties: {},
  };
}

describe("findIdleVirtualMachines", () => {
  it("classifies as HARD_SAVING when 90-day CPU average is below 5%", async () => {
    const vm = vmRow("/subscriptions/sub-1/vm-90d-hard");
    const getAverageCpu = vi.fn().mockResolvedValue(2);

    const result = await findIdleVirtualMachines([vm], getAverageCpu);

    expect(result).toEqual([
      {
        ruleType: "IDLE_VM",
        resourceId: vm.id,
        subscriptionId: "sub-1",
        savingsCategory: "HARD_SAVING",
        metricObserved: 2,
        periodAnalyzedDays: 90,
      },
    ]);
  });

  it("classifies as HARD_SAVING on 30-day CPU below 5% even when the 90-day average is not", async () => {
    const vm = vmRow("/subscriptions/sub-1/vm-30d-hard");
    const getAverageCpu = vi.fn().mockImplementation((_id: string, days: number) =>
      Promise.resolve(days === 30 ? 3 : 15),
    );

    const result = await findIdleVirtualMachines([vm], getAverageCpu);

    expect(result).toEqual([
      {
        ruleType: "IDLE_VM",
        resourceId: vm.id,
        subscriptionId: "sub-1",
        savingsCategory: "HARD_SAVING",
        metricObserved: 3,
        periodAnalyzedDays: 30,
      },
    ]);
  });

  it("classifies as POTENTIAL_SAVING on 60-day CPU below 10% when no HARD_SAVING tier matches", async () => {
    const vm = vmRow("/subscriptions/sub-1/vm-60d-potential");
    const getAverageCpu = vi.fn().mockImplementation((_id: string, days: number) =>
      Promise.resolve(days === 60 ? 8 : 25),
    );

    const result = await findIdleVirtualMachines([vm], getAverageCpu);

    expect(result).toEqual([
      {
        ruleType: "IDLE_VM",
        resourceId: vm.id,
        subscriptionId: "sub-1",
        savingsCategory: "POTENTIAL_SAVING",
        metricObserved: 8,
        periodAnalyzedDays: 60,
      },
    ]);
  });

  it("classifies as POTENTIAL_SAVING on 30-day CPU below 20% when no stronger tier matches", async () => {
    const vm = vmRow("/subscriptions/sub-1/vm-30d-potential");
    const getAverageCpu = vi.fn().mockImplementation((_id: string, days: number) =>
      Promise.resolve(days === 30 ? 18 : 25),
    );

    const result = await findIdleVirtualMachines([vm], getAverageCpu);

    expect(result).toEqual([
      {
        ruleType: "IDLE_VM",
        resourceId: vm.id,
        subscriptionId: "sub-1",
        savingsCategory: "POTENTIAL_SAVING",
        metricObserved: 18,
        periodAnalyzedDays: 30,
      },
    ]);
  });

  it("excludes a VM whose CPU average is at or above every threshold in all windows", async () => {
    const vm = vmRow("/subscriptions/sub-1/vm-busy");
    const getAverageCpu = vi.fn().mockResolvedValue(25);

    const result = await findIdleVirtualMachines([vm], getAverageCpu);

    expect(result).toEqual([]);
  });

  it("excludes a deallocated VM even when its reported CPU is below every threshold", async () => {
    const vm: ResourceGraphRow = {
      id: "/subscriptions/sub-1/vm-deallocated",
      type: "microsoft.compute/virtualmachines",
      subscriptionId: "sub-1",
      powerState: "PowerState/deallocated",
      properties: {},
    };
    const getAverageCpu = vi.fn().mockResolvedValue(0);

    const result = await findIdleVirtualMachines([vm], getAverageCpu);

    expect(result).toEqual([]);
    expect(getAverageCpu).not.toHaveBeenCalled();
  });

  it("never calls the CPU fetcher for a non-VM resource", async () => {
    const disk: ResourceGraphRow = {
      id: "disk-1",
      type: "microsoft.compute/disks",
      subscriptionId: "sub-1",
      properties: {},
    };
    const getAverageCpu = vi.fn().mockResolvedValue(0);

    const result = await findIdleVirtualMachines([disk], getAverageCpu);

    expect(result).toEqual([]);
    expect(getAverageCpu).not.toHaveBeenCalled();
  });
});
