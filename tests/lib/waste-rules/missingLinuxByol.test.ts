import { describe, expect, it } from "vitest";
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import { findMissingLinuxByol } from "@/lib/waste-rules/missingLinuxByol";

function linuxVm(id: string, publisher: string, licenseType?: string): ResourceGraphRow {
  return {
    id,
    type: "microsoft.compute/virtualmachines",
    subscriptionId: "sub-1",
    properties: {
      storageProfile: { imageReference: { publisher } },
      ...(licenseType ? { licenseType } : {}),
    },
  };
}

describe("findMissingLinuxByol", () => {
  it("flags a RedHat VM with no BYOS licenseType", () => {
    const vm = linuxVm("/subscriptions/sub-1/vm-rhel-payg", "RedHat");

    expect(findMissingLinuxByol([vm])).toEqual([
      {
        ruleType: "VM_MISSING_LINUX_BYOL",
        resourceId: vm.id,
        subscriptionId: "sub-1",
        savingsCategory: "HARD_SAVING",
      },
    ]);
  });

  it("flags a SUSE VM with no BYOS licenseType", () => {
    const vm = linuxVm("/subscriptions/sub-1/vm-suse-payg", "SUSE");

    expect(findMissingLinuxByol([vm])).toEqual([
      {
        ruleType: "VM_MISSING_LINUX_BYOL",
        resourceId: vm.id,
        subscriptionId: "sub-1",
        savingsCategory: "HARD_SAVING",
      },
    ]);
  });

  it("does not flag a RedHat VM that already has BYOS applied", () => {
    const vm = linuxVm("/subscriptions/sub-1/vm-rhel-byos", "RedHat", "RHEL_BYOS");

    expect(findMissingLinuxByol([vm])).toEqual([]);
  });

  it("does not flag a VM from a publisher with no BYOL program (e.g. Canonical)", () => {
    const vm = linuxVm("/subscriptions/sub-1/vm-ubuntu", "Canonical");

    expect(findMissingLinuxByol([vm])).toEqual([]);
  });

  it("ignores non-VM resources", () => {
    const disk: ResourceGraphRow = {
      id: "disk-1",
      type: "microsoft.compute/disks",
      subscriptionId: "sub-1",
      properties: {},
    };

    expect(findMissingLinuxByol([disk])).toEqual([]);
  });
});
