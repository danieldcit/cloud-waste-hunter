import { describe, expect, it } from "vitest";
import {
  categoryForRule,
  costManagementSubcategoryForRule,
  impactForCost,
} from "@/lib/dashboard-categories";

describe("categoryForRule", () => {
  it("maps storage rules", () => {
    expect(categoryForRule("ORPHANED_DISK")).toBe("storage");
    expect(categoryForRule("OLD_SNAPSHOT")).toBe("storage");
  });

  it("maps the compute rule", () => {
    expect(categoryForRule("IDLE_VM")).toBe("compute");
  });

  it("maps network rules", () => {
    expect(categoryForRule("UNASSOCIATED_PUBLIC_IP")).toBe("network");
    expect(categoryForRule("IDLE_VPN_GATEWAY")).toBe("network");
  });

  it("maps cost-management rules to every applicable subcategory", () => {
    expect(costManagementSubcategoryForRule("VMSS_MISSING_SAVINGS_PLAN_OR_RESERVATION"))
      .toEqual(["reservations", "savingsPlans"]);
    expect(costManagementSubcategoryForRule("ROI_PRIORITIZATION")).toEqual(["roi"]);
  });

  it("maps every VMSS category-2 rule to its main dashboard group", () => {
    const vmssRuleTypes = [
      "VMSS_NO_AUTOSCALE",
      "VMSS_MAX_INSTANCES_HIGH",
      "VMSS_AUTOSCALE_NO_SCALE_IN",
      "VMSS_IDLE_LOW_UTILIZATION",
      "VMSS_SCALEOUT_METRIC_INADEQUATE",
      "VMSS_NONPROD_NO_SCHEDULE",
      "VMSS_OUTDATED_SKU_GENERATION",
      "VMSS_SPOT_ELIGIBLE",
      "VMSS_MISSING_SAVINGS_PLAN_OR_RESERVATION",
      "VMSS_OUTDATED_MODEL_INSTANCES",
    ] as const;
    for (const ruleType of vmssRuleTypes) {
      expect(categoryForRule(ruleType)).toBe(
        ["VMSS_NONPROD_NO_SCHEDULE", "VMSS_SPOT_ELIGIBLE", "VMSS_MISSING_SAVINGS_PLAN_OR_RESERVATION"].includes(ruleType)
          ? "costManagement"
          : "compute",
      );
    }
  });

  it("maps every AVD category-3 rule to compute", () => {
    const avdRuleTypes = [
      "AVD_SESSION_HOST_LOW_UTILIZATION",
      "AVD_HOSTPOOL_EXCESS_HOSTS",
      "AVD_HOSTPOOL_LOW_DENSITY",
      "AVD_SESSION_HOST_PREMIUM_DISK_UNUSED",
      "AVD_SCALING_PLAN_MISSING",
      "AVD_SCALING_PLAN_DISABLED",
      "AVD_HOST_RUNNING_OUTSIDE_SCALING_WINDOW",
      "AVD_PERSONAL_HOST_UNUSED",
    ] as const;
    for (const ruleType of avdRuleTypes) {
      expect(categoryForRule(ruleType)).toBe("compute");
    }
  });

  it("maps every disk category-4 rule to storage", () => {
    const diskRuleTypes = [
      "DISK_IDLE_LOW_UTILIZATION",
      "DISK_PREMIUM_TIER_UNNECESSARY",
      "DISK_PREMIUM_V2_OVERSIZED",
      "DISK_TIER_OVERSIZED",
      "DISK_NONPROD_PREMIUM",
      "SNAPSHOT_ORPHANED_SOURCE",
      "SNAPSHOT_EXCESSIVE_COUNT",
      "IMAGE_ORPHANED",
      "GALLERY_IMAGE_VERSION_OLD",
    ] as const;
    for (const ruleType of diskRuleTypes) {
      expect(categoryForRule(ruleType)).toBe("storage");
    }
  });

  it("maps category-5 storage account rules to storage", () => {
    expect(categoryForRule("STORAGE_ACCOUNT_UNUSED")).toBe("storage");
    expect(categoryForRule("STORAGE_ACCOUNT_REDUNDANCY_MISMATCH")).toBe("storage");
  });

  it("maps every FinOps category 21-33 rule", () => {
    const category21To33 = [
      ["IOT_EDGE_IDLE", "dataAi"],
      ["DATA_FACTORY_IDLE", "dataAi"],
      ["DATABRICKS_IDLE", "dataAi"],
      ["SYNAPSE_IDLE", "dataAi"],
      ["POWER_BI_FABRIC_IDLE", "dataAi"],
      ["STREAM_ANALYTICS_IDLE", "dataAi"],
      ["EVENT_HUBS_IDLE", "dataAi"],
      ["SERVICE_BUS_IDLE", "dataAi"],
      ["STORAGE_QUEUE_IDLE", "storage"],
      ["CDN_FRONT_DOOR_IDLE", "network"],
      ["API_MANAGEMENT_IDLE", "dataAi"],
      ["LOGIC_APP_DISABLED", "dataAi"],
      ["AUTOMATION_ACCOUNT_IDLE", "costManagement"],
    ] as const;
    for (const [ruleType, category] of category21To33) {
      expect(categoryForRule(ruleType)).toBe(category);
    }
  });

  it("maps the implemented category 34-43 rules", () => {
    const category34To43 = [
      ["VM_MISSING_COMMITMENT_COVERAGE", "costManagement"],
      ["ORPHANED_NAT_GATEWAY", "costManagement"],
      ["DEVTEST_SPOT_ELIGIBLE", "costManagement"],
      ["SCHEDULE_REQUIRED_BUT_MISSING", "costManagement"],
      ["ARCHITECTURE_REVIEW_REQUIRED", "costManagement"],
      ["COST_ANOMALY_DETECTED", "costManagement"],
      ["FORECAST_ACTIONABLE_FINDING", "costManagement"],
      ["UNIT_ECONOMICS_REVIEW", "costManagement"],
      ["ROI_PRIORITIZATION", "costManagement"],
    ] as const;
    for (const [ruleType, category] of category34To43) {
      expect(categoryForRule(ruleType)).toBe(category);
    }
  });
});

describe("impactForCost", () => {
  it("is high at or above $20/mo", () => {
    expect(impactForCost(20)).toBe("high");
    expect(impactForCost(50)).toBe("high");
  });

  it("is medium between $5 and just under $20/mo", () => {
    expect(impactForCost(5)).toBe("medium");
    expect(impactForCost(19.99)).toBe("medium");
  });

  it("is low below $5/mo", () => {
    expect(impactForCost(0)).toBe("low");
    expect(impactForCost(4.99)).toBe("low");
  });
});
