import { describe, expect, it } from "vitest";
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import {
  isScalingPlan,
  findScalingPlanReferenceForPool,
  schedulesForPlan,
  offPeakHoursForSchedule,
  isWithinOffPeakWindow,
  type ScalingPlanSchedule,
} from "@/lib/waste-rules/avdScalingPlans";

const POOL_ID =
  "/subscriptions/sub-1/resourceGroups/rg1/providers/Microsoft.DesktopVirtualization/hostPools/pool-1";
const PLAN_ID =
  "/subscriptions/sub-1/resourceGroups/rg1/providers/Microsoft.DesktopVirtualization/scalingPlans/plan-1";

function scalingPlan(
  hostPoolReferences: unknown[],
  schedules: unknown[] = [],
): ResourceGraphRow {
  return {
    id: PLAN_ID,
    type: "microsoft.desktopvirtualization/scalingplans",
    subscriptionId: "sub-1",
    properties: { hostPoolReferences, schedules },
  };
}

describe("isScalingPlan", () => {
  it("is true for a scalingPlans resource, case-insensitively", () => {
    expect(isScalingPlan(scalingPlan([]))).toBe(true);
    expect(
      isScalingPlan({ ...scalingPlan([]), type: "Microsoft.DesktopVirtualization/scalingPlans" }),
    ).toBe(true);
  });
});

describe("findScalingPlanReferenceForPool", () => {
  it("finds the reference whose hostPoolArmPath matches, case-insensitively", () => {
    const plan = scalingPlan([{ hostPoolArmPath: POOL_ID.toUpperCase(), scalingPlanEnabled: true }]);

    const found = findScalingPlanReferenceForPool(POOL_ID, [plan]);

    expect(found?.plan).toBe(plan);
    expect(found?.reference.scalingPlanEnabled).toBe(true);
  });

  it("returns undefined when no scaling plan references the pool", () => {
    const plan = scalingPlan([{ hostPoolArmPath: "/subscriptions/sub-1/.../hostPools/other-pool" }]);

    expect(findScalingPlanReferenceForPool(POOL_ID, [plan])).toBeUndefined();
  });

  it("returns undefined when there are no scaling plans at all", () => {
    expect(findScalingPlanReferenceForPool(POOL_ID, [])).toBeUndefined();
  });
});

describe("schedulesForPlan", () => {
  it("returns the schedules array from the plan", () => {
    const schedules = [{ daysOfWeek: ["Monday"] }];
    expect(schedulesForPlan(scalingPlan([], schedules))).toBe(schedules);
  });

  it("returns an empty array when the plan has no schedules property", () => {
    const plan: ResourceGraphRow = {
      id: PLAN_ID,
      type: "microsoft.desktopvirtualization/scalingplans",
      subscriptionId: "sub-1",
      properties: { hostPoolReferences: [] },
    };
    expect(schedulesForPlan(plan)).toEqual([]);
  });
});

const OVERNIGHT_SCHEDULE: ScalingPlanSchedule = {
  daysOfWeek: ["Monday"],
  offPeakStartTime: { hour: 20, minute: 0 },
  rampUpStartTime: { hour: 6, minute: 0 },
};

describe("offPeakHoursForSchedule", () => {
  it("computes the duration across midnight (20:00 -> 06:00 = 10 hours)", () => {
    expect(offPeakHoursForSchedule(OVERNIGHT_SCHEDULE)).toBe(10);
  });

  it("computes the duration within the same day (09:00 -> 17:00 = 8 hours)", () => {
    expect(
      offPeakHoursForSchedule({
        daysOfWeek: ["Monday"],
        offPeakStartTime: { hour: 9, minute: 0 },
        rampUpStartTime: { hour: 17, minute: 0 },
      }),
    ).toBe(8);
  });

  it("returns 0 when either time is missing", () => {
    expect(offPeakHoursForSchedule({ daysOfWeek: ["Monday"] })).toBe(0);
  });

  it("starts the window at rampDownStartTime, not offPeakStartTime, when both are set (18:00 -> 06:00 = 12 hours)", () => {
    const schedule: ScalingPlanSchedule = {
      daysOfWeek: ["Monday"],
      rampDownStartTime: { hour: 18, minute: 0 },
      offPeakStartTime: { hour: 20, minute: 0 },
      rampUpStartTime: { hour: 6, minute: 0 },
    };
    expect(offPeakHoursForSchedule(schedule)).toBe(12);
  });
});

describe("isWithinOffPeakWindow", () => {
  it("is true when 'now' falls inside the window on a matching day (same-day part)", () => {
    // 2024-01-01T00:00:00Z is a Monday.
    const monday2200 = new Date("2024-01-01T22:00:00Z");
    expect(isWithinOffPeakWindow(OVERNIGHT_SCHEDULE, monday2200)).toBe(true);
  });

  it("is true when 'now' falls inside the window's overnight carry-over into the next day", () => {
    // 2024-01-02T00:00:00Z is a Tuesday, not itself in daysOfWeek — the window still applies
    // because it started Monday night and hasn't reached rampUpStartTime yet.
    const tuesday0200 = new Date("2024-01-02T02:00:00Z");
    expect(isWithinOffPeakWindow(OVERNIGHT_SCHEDULE, tuesday0200)).toBe(true);
  });

  it("is false during business hours on the same day", () => {
    const monday1000 = new Date("2024-01-01T10:00:00Z");
    expect(isWithinOffPeakWindow(OVERNIGHT_SCHEDULE, monday1000)).toBe(false);
  });

  it("is false on a day not listed in daysOfWeek and not carried over from one that is", () => {
    // 2024-01-03T22:00:00Z is a Wednesday; Tuesday (the prior day) isn't in daysOfWeek either.
    const wednesday2200 = new Date("2024-01-03T22:00:00Z");
    expect(isWithinOffPeakWindow(OVERNIGHT_SCHEDULE, wednesday2200)).toBe(false);
  });

  it("returns false when either time is missing", () => {
    expect(isWithinOffPeakWindow({ daysOfWeek: ["Monday"] }, new Date("2024-01-01T22:00:00Z"))).toBe(
      false,
    );
  });

  it("treats the window as starting at rampDownStartTime, not the later offPeakStartTime, when both are set", () => {
    const schedule: ScalingPlanSchedule = {
      daysOfWeek: ["Monday"],
      rampDownStartTime: { hour: 18, minute: 0 },
      offPeakStartTime: { hour: 20, minute: 0 },
      rampUpStartTime: { hour: 6, minute: 0 },
    };
    // 19:00 UTC on the same Monday: after the new 18:00 rampDown start, but before the old
    // 20:00 offPeak start — would have been false before this fix.
    const monday1900 = new Date("2024-01-01T19:00:00Z");
    expect(isWithinOffPeakWindow(schedule, monday1900)).toBe(true);
  });
});
