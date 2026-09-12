import { describe, expect, it } from "vitest";
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import { findMissingHybridBenefit } from "@/lib/waste-rules/missingHybridBenefit";

function windowsVm(id: string, licenseType?: string): ResourceGraphRow {
  return {
    id,
    type: "microsoft.compute/virtualmachines",
    subscriptionId: "sub-1",
    properties: {
      storageProfile: { osDisk: { osType: "Windows" } },
      ...(licenseType ? { licenseType } : {}),
    },
  };
}

describe("findMissingHybridBenefit", () => {
  it("flags a Windows VM with no licenseType set", () => {
    const vm = windowsVm("/subscriptions/sub-1/vm-win-no-license");

    expect(findMissingHybridBenefit([vm])).toEqual([
      {
        ruleType: "VM_MISSING_HYBRID_BENEFIT",
        resourceId: vm.id,
        subscriptionId: "sub-1",
        savingsCategory: "POTENTIAL_SAVING",
      },
    ]);
  });

  it("does not flag a Windows VM with Hybrid Benefit already applied", () => {
    const vm = windowsVm("/subscriptions/sub-1/vm-win-hybrid", "Windows_Server");

    expect(findMissingHybridBenefit([vm])).toEqual([]);
  });

  it("does not flag a Windows VM whose licenseType has different casing than expected", () => {
    const vm = windowsVm("/subscriptions/sub-1/vm-win-lowercase-license", "windows_server");

    expect(findMissingHybridBenefit([vm])).toEqual([]);
  });

  it("does not flag a Linux VM", () => {
    const vm: ResourceGraphRow = {
      id: "/subscriptions/sub-1/vm-linux",
      type: "microsoft.compute/virtualmachines",
      subscriptionId: "sub-1",
      properties: { storageProfile: { osDisk: { osType: "Linux" } } },
    };

    expect(findMissingHybridBenefit([vm])).toEqual([]);
  });

  it("ignores non-VM resources", () => {
    const disk: ResourceGraphRow = {
      id: "disk-1",
      type: "microsoft.compute/disks",
      subscriptionId: "sub-1",
      properties: {},
    };

    expect(findMissingHybridBenefit([disk])).toEqual([]);
  });
});
