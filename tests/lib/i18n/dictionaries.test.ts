import { describe, expect, it } from "vitest";
import { translate, LOCALES } from "@/lib/i18n/dictionaries";

describe("translate", () => {
  it("returns the pt-BR string for a known key", () => {
    expect(translate("pt-BR", "nav.dashboard")).toBe("Painel");
  });

  it("returns the English string for the same key", () => {
    expect(translate("en", "nav.dashboard")).toBe("Dashboard");
  });

  it("returns the Spanish string for the same key", () => {
    expect(translate("es", "nav.dashboard")).toBe("Panel");
  });

  it("falls back to the key itself when the key is unknown", () => {
    expect(translate("en", "nav.doesNotExist")).toBe("nav.doesNotExist");
  });
});

describe("VMSS category-2 rule labels", () => {
  const vmssRuleKeys = [
    "rule.VMSS_NO_AUTOSCALE",
    "rule.VMSS_MAX_INSTANCES_HIGH",
    "rule.VMSS_AUTOSCALE_NO_SCALE_IN",
    "rule.VMSS_IDLE_LOW_UTILIZATION",
    "rule.VMSS_SCALEOUT_METRIC_INADEQUATE",
    "rule.VMSS_NONPROD_NO_SCHEDULE",
    "rule.VMSS_OUTDATED_SKU_GENERATION",
    "rule.VMSS_SPOT_ELIGIBLE",
    "rule.VMSS_MISSING_SAVINGS_PLAN_OR_RESERVATION",
    "rule.VMSS_OUTDATED_MODEL_INSTANCES",
  ];

  it("has a real translation (not a key fallback) for every VMSS rule key in every locale", () => {
    for (const locale of LOCALES) {
      for (const key of vmssRuleKeys) {
        expect(translate(locale, key)).not.toBe(key);
      }
    }
  });
});

describe("AVD category-3 rule labels", () => {
  const avdRuleKeys = [
    "rule.AVD_SESSION_HOST_LOW_UTILIZATION",
    "rule.AVD_HOSTPOOL_EXCESS_HOSTS",
    "rule.AVD_HOSTPOOL_LOW_DENSITY",
    "rule.AVD_SESSION_HOST_PREMIUM_DISK_UNUSED",
    "rule.AVD_SCALING_PLAN_MISSING",
    "rule.AVD_SCALING_PLAN_DISABLED",
    "rule.AVD_HOST_RUNNING_OUTSIDE_SCALING_WINDOW",
    "rule.AVD_PERSONAL_HOST_UNUSED",
  ];

  it("has a real translation (not a key fallback) for every AVD rule key in every locale", () => {
    for (const locale of LOCALES) {
      for (const key of avdRuleKeys) {
        expect(translate(locale, key)).not.toBe(key);
      }
    }
  });
});

describe("Disk category-4 rule labels", () => {
  const diskRuleKeys = [
    "rule.DISK_IDLE_LOW_UTILIZATION",
    "rule.DISK_PREMIUM_TIER_UNNECESSARY",
    "rule.DISK_PREMIUM_V2_OVERSIZED",
    "rule.DISK_TIER_OVERSIZED",
    "rule.DISK_NONPROD_PREMIUM",
    "rule.SNAPSHOT_ORPHANED_SOURCE",
    "rule.SNAPSHOT_EXCESSIVE_COUNT",
    "rule.IMAGE_ORPHANED",
    "rule.GALLERY_IMAGE_VERSION_OLD",
  ];

  it("has a real translation (not a key fallback) for every disk rule key in every locale", () => {
    for (const locale of LOCALES) {
      for (const key of diskRuleKeys) {
        expect(translate(locale, key)).not.toBe(key);
      }
    }
  });
});

describe("Ambientes permission-upgrade labels", () => {
  const keys = ["ambientes.permissionsOutdated", "ambientes.updatePermissions"];

  it("has a real translation (not a key fallback) for every key in every locale", () => {
    for (const locale of LOCALES) {
      for (const key of keys) {
        expect(translate(locale, key)).not.toBe(key);
      }
    }
  });
});
