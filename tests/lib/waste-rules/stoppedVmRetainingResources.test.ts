import { describe, expect, it } from "vitest";
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import { findStoppedVmsRetainingResources } from "@/lib/waste-rules/stoppedVmRetainingResources";

describe("findStoppedVmsRetainingResources", () => {
  it("flags the OS disk and data disks of a deallocated VM", () => {
    const vm: ResourceGraphRow = {
      id: "/subscriptions/sub-1/vm-stopped",
      type: "microsoft.compute/virtualmachines",
      subscriptionId: "sub-1",
      powerState: "PowerState/deallocated",
      properties: {
        storageProfile: {
          osDisk: { managedDisk: { id: "/subscriptions/sub-1/disks/os-disk" } },
          dataDisks: [
            { managedDisk: { id: "/subscriptions/sub-1/disks/data-disk-1" } },
            { managedDisk: { id: "/subscriptions/sub-1/disks/data-disk-2" } },
          ],
        },
      },
    };

    const result = findStoppedVmsRetainingResources([vm]);

    expect(result).toEqual([
      {
        ruleType: "VM_STOPPED_RETAINING_RESOURCES",
        resourceId: "/subscriptions/sub-1/disks/os-disk",
        subscriptionId: "sub-1",
        savingsCategory: "POTENTIAL_SAVING",
      },
      {
        ruleType: "VM_STOPPED_RETAINING_RESOURCES",
        resourceId: "/subscriptions/sub-1/disks/data-disk-1",
        subscriptionId: "sub-1",
        savingsCategory: "POTENTIAL_SAVING",
      },
      {
        ruleType: "VM_STOPPED_RETAINING_RESOURCES",
        resourceId: "/subscriptions/sub-1/disks/data-disk-2",
        subscriptionId: "sub-1",
        savingsCategory: "POTENTIAL_SAVING",
      },
    ]);
  });

  it("does not flag a running VM", () => {
    const vm: ResourceGraphRow = {
      id: "/subscriptions/sub-1/vm-running",
      type: "microsoft.compute/virtualmachines",
      subscriptionId: "sub-1",
      powerState: "PowerState/running",
      properties: {
        storageProfile: {
          osDisk: { managedDisk: { id: "/subscriptions/sub-1/disks/os-disk" } },
        },
      },
    };

    expect(findStoppedVmsRetainingResources([vm])).toEqual([]);
  });

  it("does not flag a deallocated VM with no readable disk references", () => {
    const vm: ResourceGraphRow = {
      id: "/subscriptions/sub-1/vm-no-disks",
      type: "microsoft.compute/virtualmachines",
      subscriptionId: "sub-1",
      powerState: "PowerState/deallocated",
      properties: { storageProfile: {} },
    };

    expect(findStoppedVmsRetainingResources([vm])).toEqual([]);
  });

  it("ignores non-VM resources", () => {
    const disk: ResourceGraphRow = {
      id: "disk-1",
      type: "microsoft.compute/disks",
      subscriptionId: "sub-1",
      powerState: "PowerState/deallocated",
      properties: {},
    };

    expect(findStoppedVmsRetainingResources([disk])).toEqual([]);
  });
});
