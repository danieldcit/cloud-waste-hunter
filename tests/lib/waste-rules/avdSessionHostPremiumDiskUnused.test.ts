import { describe, expect, it } from "vitest";
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import { findAvdSessionHostPremiumDiskUnused } from "@/lib/waste-rules/avdSessionHostPremiumDiskUnused";

const HOST_ID = "/subscriptions/sub-1/.../hostPools/pool-1/sessionHosts/host-1.contoso.com";
const VM_ID = "/subscriptions/sub-1/.../virtualMachines/host-1";
const DISK_ID = "/subscriptions/sub-1/.../disks/host-1-osdisk";

function sessionHost(sessions: number, status = "Available"): ResourceGraphRow {
  return {
    id: HOST_ID,
    type: "microsoft.desktopvirtualization/hostpools/sessionhosts",
    subscriptionId: "sub-1",
    properties: { sessions, status, resourceId: VM_ID },
  };
}

function vm(diskId: string | undefined): ResourceGraphRow {
  return {
    id: VM_ID,
    type: "microsoft.compute/virtualmachines",
    subscriptionId: "sub-1",
    properties: diskId ? { storageProfile: { osDisk: { managedDisk: { id: diskId } } } } : {},
  };
}

function disk(skuName: string): ResourceGraphRow {
  return {
    id: DISK_ID,
    type: "microsoft.compute/disks",
    subscriptionId: "sub-1",
    sku: { name: skuName },
    properties: {},
  };
}

describe("findAvdSessionHostPremiumDiskUnused", () => {
  it("flags the OS disk of an idle session host that uses a Premium SKU", () => {
    const resources = [sessionHost(0), vm(DISK_ID), disk("Premium_LRS")];

    expect(findAvdSessionHostPremiumDiskUnused(resources)).toEqual([
      {
        ruleType: "AVD_SESSION_HOST_PREMIUM_DISK_UNUSED",
        resourceId: DISK_ID,
        subscriptionId: "sub-1",
        savingsCategory: "POTENTIAL_SAVING",
      },
    ]);
  });

  it.each(["PremiumV2_LRS", "UltraSSD_LRS"])("also flags the %s SKU", (skuName) => {
    const resources = [sessionHost(0), vm(DISK_ID), disk(skuName)];
    expect(findAvdSessionHostPremiumDiskUnused(resources)).toHaveLength(1);
  });

  it("does not flag a Standard SSD disk", () => {
    const resources = [sessionHost(0), vm(DISK_ID), disk("StandardSSD_LRS")];
    expect(findAvdSessionHostPremiumDiskUnused(resources)).toEqual([]);
  });

  it("does not flag a session host that isn't idle", () => {
    const resources = [sessionHost(3), vm(DISK_ID), disk("Premium_LRS")];
    expect(findAvdSessionHostPremiumDiskUnused(resources)).toEqual([]);
  });

  it("does nothing when the underlying VM can't be resolved", () => {
    const resources = [sessionHost(0), disk("Premium_LRS")];
    expect(findAvdSessionHostPremiumDiskUnused(resources)).toEqual([]);
  });

  it("does nothing when the VM has no OS disk reference", () => {
    const resources = [sessionHost(0), vm(undefined), disk("Premium_LRS")];
    expect(findAvdSessionHostPremiumDiskUnused(resources)).toEqual([]);
  });
});
