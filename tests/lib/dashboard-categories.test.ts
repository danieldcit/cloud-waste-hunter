import { describe, expect, it } from "vitest";
import { categoryForRule, impactForCost } from "@/lib/dashboard-categories";

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

  it("maps every VMSS category-2 rule to compute", () => {
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
      expect(categoryForRule(ruleType)).toBe("compute");
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
