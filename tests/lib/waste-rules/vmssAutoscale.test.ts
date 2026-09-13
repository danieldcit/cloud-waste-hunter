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

  function autoscaleSettingWithId(
    settingId: string,
    targetResourceUri: string,
    enabled: boolean | undefined,
  ): ResourceGraphRow {
    return {
      id: settingId,
      type: "microsoft.insights/autoscalesettings",
      subscriptionId: "sub-1",
      properties: { targetResourceUri, profiles: [], ...(enabled === undefined ? {} : { enabled }) },
    };
  }

  it("prefers the enabled autoscale setting when a disabled and an enabled one both target the same VMSS", () => {
    const disabled = autoscaleSettingWithId("setting-disabled", VMSS_ID, false);
    const enabled = autoscaleSettingWithId("setting-enabled", VMSS_ID, true);

    expect(findAutoscaleSettingFor(VMSS_ID, [disabled, enabled])).toBe(enabled);
    // Order shouldn't matter.
    expect(findAutoscaleSettingFor(VMSS_ID, [enabled, disabled])).toBe(enabled);
  });

  it("treats an undefined `enabled` as enabled, preferring it over an explicitly disabled one", () => {
    const disabled = autoscaleSettingWithId("setting-disabled", VMSS_ID, false);
    const implicitlyEnabled = autoscaleSettingWithId("setting-implicit", VMSS_ID, undefined);

    expect(findAutoscaleSettingFor(VMSS_ID, [disabled, implicitlyEnabled])).toBe(implicitlyEnabled);
  });

  it("still returns a single disabled setting when it's the only one targeting the VMSS", () => {
    const disabled = autoscaleSettingWithId("setting-disabled", VMSS_ID, false);

    expect(findAutoscaleSettingFor(VMSS_ID, [disabled])).toBe(disabled);
  });

  it("returns correct results across repeated calls with the same resources array (index reuse) and a fresh array (index rebuild)", () => {
    const setting = autoscaleSetting(VMSS_ID, []);
    const resources = [setting];

    expect(findAutoscaleSettingFor(VMSS_ID, resources)).toBe(setting);
    // Repeated call with the SAME array reference should reuse the cached index.
    expect(findAutoscaleSettingFor(VMSS_ID, resources)).toBe(setting);

    // A fresh array (new reference, same content) should rebuild the index and still be correct.
    const otherSetting = autoscaleSetting(VMSS_ID, []);
    const freshResources = [otherSetting];
    expect(findAutoscaleSettingFor(VMSS_ID, freshResources)).toBe(otherSetting);
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
