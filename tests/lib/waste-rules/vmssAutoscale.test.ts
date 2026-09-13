import { describe, expect, it } from "vitest";
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import { findAutoscaleSettingFor, autoscaleProfiles } from "@/lib/waste-rules/vmssAutoscale";

const VMSS_ID = "/subscriptions/sub-1/resourceGroups/rg1/providers/Microsoft.Compute/virtualMachineScaleSets/vmss-1";

function autoscaleSetting(targetResourceUri: string, profiles: unknown[]): ResourceGraphRow {
  return {
    id: "/subscriptions/sub-1/resourceGroups/rg1/providers/microsoft.insights/autoscalesettings/setting-1",
    type: "microsoft.insights/autoscalesettings",
    subscriptionId: "sub-1",
    properties: { targetResourceUri, profiles },
  };
}

describe("findAutoscaleSettingFor", () => {
  it("finds the autoscale setting whose targetResourceUri matches the VMSS id, case-insensitively", () => {
    const setting = autoscaleSetting(VMSS_ID.toUpperCase(), []);

    expect(findAutoscaleSettingFor(VMSS_ID, [setting])).toBe(setting);
  });

  it("returns undefined when no autoscale setting targets this VMSS", () => {
    const setting = autoscaleSetting("/subscriptions/sub-1/.../virtualMachineScaleSets/other-vmss", []);

    expect(findAutoscaleSettingFor(VMSS_ID, [setting])).toBeUndefined();
  });

  it("ignores non-autoscalesettings resources", () => {
    const disk: ResourceGraphRow = {
      id: "disk-1",
      type: "microsoft.compute/disks",
      subscriptionId: "sub-1",
      properties: {},
    };

    expect(findAutoscaleSettingFor(VMSS_ID, [disk])).toBeUndefined();
  });
});

describe("autoscaleProfiles", () => {
  it("returns the profiles array from a found setting", () => {
    const profiles = [{ capacity: { minimum: "1", maximum: "5" } }];
    const setting = autoscaleSetting(VMSS_ID, profiles);

    expect(autoscaleProfiles(setting)).toBe(profiles);
  });

  it("returns an empty array when the setting is undefined", () => {
    expect(autoscaleProfiles(undefined)).toEqual([]);
  });

  it("returns an empty array when the setting has no profiles property", () => {
    const setting: ResourceGraphRow = {
      id: "setting-2",
      type: "microsoft.insights/autoscalesettings",
      subscriptionId: "sub-1",
      properties: { targetResourceUri: VMSS_ID },
    };

    expect(autoscaleProfiles(setting)).toEqual([]);
  });
});
