import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";

export interface ScalingPlanHostPoolReference {
  hostPoolArmPath?: string;
  scalingPlanEnabled?: boolean;
}

export interface ScalingPlanTimeOfDay {
  hour: number;
  minute: number;
}

export interface ScalingPlanSchedule {
  daysOfWeek?: string[];
  rampUpStartTime?: ScalingPlanTimeOfDay;
  peakStartTime?: ScalingPlanTimeOfDay;
  rampDownStartTime?: ScalingPlanTimeOfDay;
  offPeakStartTime?: ScalingPlanTimeOfDay;
}

interface ScalingPlanProperties {
  hostPoolReferences?: ScalingPlanHostPoolReference[];
  schedules?: ScalingPlanSchedule[];
}

const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

export function isScalingPlan(r: ResourceGraphRow): boolean {
  return r.type.toLowerCase() === "microsoft.desktopvirtualization/scalingplans";
}

export function findScalingPlanReferenceForPool(
  poolId: string,
  resources: ResourceGraphRow[],
): { plan: ResourceGraphRow; reference: ScalingPlanHostPoolReference } | undefined {
  const target = poolId.toLowerCase();
  for (const r of resources) {
    if (!isScalingPlan(r)) {
      continue;
    }
    const props = r.properties as ScalingPlanProperties;
    const reference = (props.hostPoolReferences ?? []).find(
      (ref) => ref.hostPoolArmPath?.toLowerCase() === target,
    );
    if (reference) {
      return { plan: r, reference };
    }
  }
  return undefined;
}

export function schedulesForPlan(plan: ResourceGraphRow): ScalingPlanSchedule[] {
  return (plan.properties as ScalingPlanProperties).schedules ?? [];
}

function minutesSinceMidnight(t: ScalingPlanTimeOfDay | undefined): number | undefined {
  if (!t) {
    return undefined;
  }
  return t.hour * 60 + t.minute;
}

/**
 * Duration of the off-peak window (offPeakStartTime -> rampUpStartTime, wrapping past midnight
 * if rampUpStartTime is earlier in the clock than offPeakStartTime), in hours.
 */
export function offPeakHoursForSchedule(schedule: ScalingPlanSchedule): number {
  const start = minutesSinceMidnight(schedule.offPeakStartTime);
  const end = minutesSinceMidnight(schedule.rampUpStartTime);
  if (start === undefined || end === undefined) {
    return 0;
  }
  const durationMinutes = end > start ? end - start : 24 * 60 - start + end;
  return durationMinutes / 60;
}

/**
 * True when `now` (evaluated in UTC — this project does not convert Azure Monitor/schedule
 * timestamps across time zones anywhere else either) falls within this schedule's off-peak
 * window (offPeakStartTime -> rampUpStartTime) on one of its configured days, including the
 * portion of an overnight window that carries into the following calendar day.
 */
export function isWithinOffPeakWindow(schedule: ScalingPlanSchedule, now: Date): boolean {
  const start = minutesSinceMidnight(schedule.offPeakStartTime);
  const end = minutesSinceMidnight(schedule.rampUpStartTime);
  if (start === undefined || end === undefined) {
    return false;
  }

  const nowMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const today = DAY_NAMES[now.getUTCDay()];
  const yesterday = DAY_NAMES[(now.getUTCDay() + 6) % 7];
  const days = schedule.daysOfWeek ?? [];

  if (end > start) {
    // Same-day window (e.g. 09:00 -> 17:00).
    return days.includes(today) && nowMinutes >= start && nowMinutes < end;
  }
  // Wraps past midnight (e.g. 20:00 -> 06:00): the portion before `end` belongs to yesterday's
  // window carrying over; the portion from `start` onward belongs to today's window starting.
  const carriedOverFromYesterday = days.includes(yesterday) && nowMinutes < end;
  const startedToday = days.includes(today) && nowMinutes >= start;
  return carriedOverFromYesterday || startedToday;
}
