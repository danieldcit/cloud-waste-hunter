import { describe, expect, it } from "vitest";
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import { findAvdScalingPlanMissing } from "@/lib/waste-rules/avdScalingPlanMissing";

const POOL_ID = "/subscriptions/sub-1/.../hostPools/pool-1";

function hostPool(hostPoolType: "Personal" | "Pooled"): ResourceGraphRow {
  return {
    id: POOL_ID,
    type: "microsoft.desktopvirtualization/hostpools",
    subscriptionId: "sub-1",
    properties: { hostPoolType },
  };
}

function scalingPlan(hostPoolArmPath: string): ResourceGraphRow {
  return {
    id: "/subscriptions/sub-1/.../scalingPlans/plan-1",
    type: "microsoft.desktopvirtualization/scalingplans",
    subscriptionId: "sub-1",
    properties: { hostPoolReferences: [{ hostPoolArmPath, scalingPlanEnabled: true }] },
  };
}

describe("findAvdScalingPlanMissing", () => {
  it("flags a Pooled host pool with no scaling plan referencing it", () => {
    expect(findAvdScalingPlanMissing([hostPool("Pooled")])).toEqual([
      {
        ruleType: "AVD_SCALING_PLAN_MISSING",
        resourceId: POOL_ID,
        subscriptionId: "sub-1",
        savingsCategory: "POTENTIAL_SAVING",
      },
    ]);
  });

  it("does not flag a Pooled host pool referenced by a scaling plan", () => {
    const resources = [hostPool("Pooled"), scalingPlan(POOL_ID)];
    expect(findAvdScalingPlanMissing(resources)).toEqual([]);
  });

  it("does not flag a Personal host pool", () => {
    expect(findAvdScalingPlanMissing([hostPool("Personal")])).toEqual([]);
  });
});
