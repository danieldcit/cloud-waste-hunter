import { describe, expect, it } from "vitest";
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import { findAvdHostRunningOutsideScalingWindow } from "@/lib/waste-rules/avdHostRunningOutsideScalingWindow";

const POOL_ID = "/subscriptions/sub-1/.../hostPools/pool-1";
const HOST_ID = `${POOL_ID}/sessionHosts/host-1.contoso.com`;
const VM_ID = "/subscriptions/sub-1/.../virtualMachines/host-1";

// 2024-01-01T22:00:00Z is a Monday, inside the overnight off-peak window below.
const MONDAY_NIGHT = new Date("2024-01-01T22:00:00Z");
const MONDAY_NOON = new Date("2024-01-01T12:00:00Z");

function hostPool(): ResourceGraphRow {
  return {
    id: POOL_ID,
    type: "microsoft.desktopvirtualization/hostpools",
    subscriptionId: "sub-1",
    properties: { hostPoolType: "Pooled" },
  };
}

function scalingPlan(scalingPlanEnabled = true): ResourceGraphRow {
  return {
    id: "/subscriptions/sub-1/.../scalingPlans/plan-1",
    type: "microsoft.desktopvirtualization/scalingplans",
    subscriptionId: "sub-1",
    properties: {
      hostPoolReferences: [{ hostPoolArmPath: POOL_ID, scalingPlanEnabled }],
      schedules: [
        {
          daysOfWeek: ["Monday"],
          offPeakStartTime: { hour: 20, minute: 0 },
          rampUpStartTime: { hour: 6, minute: 0 },
        },
      ],
    },
  };
}

function sessionHost(): ResourceGraphRow {
  return {
    id: HOST_ID,
    type: "microsoft.desktopvirtualization/hostpools/sessionhosts",
    subscriptionId: "sub-1",
    properties: { resourceId: VM_ID },
  };
}

function vm(powerState: string): ResourceGraphRow {
  return {
    id: VM_ID,
    type: "microsoft.compute/virtualmachines",
    subscriptionId: "sub-1",
    properties: {},
    powerState,
  };
}

describe("findAvdHostRunningOutsideScalingWindow", () => {
  it("flags a running host during its pool's off-peak window, carrying the window's daily hours as metricObserved", () => {
    const resources = [hostPool(), scalingPlan(), sessionHost(), vm("PowerState/running")];

    expect(findAvdHostRunningOutsideScalingWindow(resources, MONDAY_NIGHT)).toEqual([
      {
        ruleType: "AVD_HOST_RUNNING_OUTSIDE_SCALING_WINDOW",
        resourceId: HOST_ID,
        subscriptionId: "sub-1",
        savingsCategory: "POTENTIAL_SAVING",
        metricObserved: 10,
      },
    ]);
  });

  it("does not flag outside the off-peak window", () => {
    const resources = [hostPool(), scalingPlan(), sessionHost(), vm("PowerState/running")];
    expect(findAvdHostRunningOutsideScalingWindow(resources, MONDAY_NOON)).toEqual([]);
  });

  it("does not flag a host that is already deallocated", () => {
    const resources = [hostPool(), scalingPlan(), sessionHost(), vm("PowerState/deallocated")];
    expect(findAvdHostRunningOutsideScalingWindow(resources, MONDAY_NIGHT)).toEqual([]);
  });

  it("does not evaluate a pool whose scaling plan is disabled (covered by AVD_SCALING_PLAN_DISABLED instead)", () => {
    const resources = [hostPool(), scalingPlan(false), sessionHost(), vm("PowerState/running")];
    expect(findAvdHostRunningOutsideScalingWindow(resources, MONDAY_NIGHT)).toEqual([]);
  });

  it("does not evaluate a pool with no scaling plan at all (covered by AVD_SCALING_PLAN_MISSING instead)", () => {
    const resources = [hostPool(), sessionHost(), vm("PowerState/running")];
    expect(findAvdHostRunningOutsideScalingWindow(resources, MONDAY_NIGHT)).toEqual([]);
  });
});
