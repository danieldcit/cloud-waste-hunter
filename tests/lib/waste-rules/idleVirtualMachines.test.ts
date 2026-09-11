import { describe, expect, it, vi } from "vitest";
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import { findIdleVirtualMachines } from "@/lib/waste-rules/idleVirtualMachines";

describe("findIdleVirtualMachines", () => {
  it("returns a VM whose average CPU is below the threshold", async () => {
    const vm: ResourceGraphRow = {
      id: "/subscriptions/sub-1/vm-idle",
      type: "microsoft.compute/virtualmachines",
      subscriptionId: "sub-1",
      properties: {},
    };
    const getAverageCpu = vi.fn().mockResolvedValue(2);

    const result = await findIdleVirtualMachines([vm], getAverageCpu);

    expect(result).toEqual([
      { ruleType: "IDLE_VM", resourceId: vm.id, subscriptionId: "sub-1" },
    ]);
  });

  it("excludes a VM whose average CPU is at or above the threshold", async () => {
    const vm: ResourceGraphRow = {
      id: "/subscriptions/sub-1/vm-busy",
      type: "microsoft.compute/virtualmachines",
      subscriptionId: "sub-1",
      properties: {},
    };
    const getAverageCpu = vi.fn().mockResolvedValue(5);

    const result = await findIdleVirtualMachines([vm], getAverageCpu);

    expect(result).toEqual([]);
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
