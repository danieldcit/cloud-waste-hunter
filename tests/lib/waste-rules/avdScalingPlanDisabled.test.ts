import { describe, expect, it } from "vitest";
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import { findAvdScalingPlanDisabled } from "@/lib/waste-rules/avdScalingPlanDisabled";

const POOL_ID = "/subscriptions/sub-1/.../hostPools/pool-1";

function hostPool(): ResourceGraphRow {
  return {
    id: POOL_ID,
    type: "microsoft.desktopvirtualization/hostpools",
    subscriptionId: "sub-1",
    properties: { hostPoolType: "Pooled" },
  };
}

function scalingPlan(hostPoolArmPath: string, scalingPlanEnabled: boolean): ResourceGraphRow {
  return {
    id: "/subscriptions/sub-1/.../scalingPlans/plan-1",
    type: "microsoft.desktopvirtualization/scalingplans",
    subscriptionId: "sub-1",
    properties: { hostPoolReferences: [{ hostPoolArmPath, scalingPlanEnabled }] },
  };
}

describe("findAvdScalingPlanDisabled", () => {
  it("flags a host pool referenced by a scaling plan with scalingPlanEnabled: false", () => {
    const resources = [hostPool(), scalingPlan(POOL_ID, false)];

    expect(findAvdScalingPlanDisabled(resources)).toEqual([
      {
        ruleType: "AVD_SCALING_PLAN_DISABLED",
        resourceId: POOL_ID,
        subscriptionId: "sub-1",
        savingsCategory: "POTENTIAL_SAVING",
      },
    ]);
  });

  it("does not flag a host pool whose scaling plan is enabled", () => {
    const resources = [hostPool(), scalingPlan(POOL_ID, true)];
    expect(findAvdScalingPlanDisabled(resources)).toEqual([]);
  });

  it("does not flag a host pool with no scaling plan at all (covered by AVD_SCALING_PLAN_MISSING instead)", () => {
    expect(findAvdScalingPlanDisabled([hostPool()])).toEqual([]);
  });
});
