import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import type { WasteFindingCandidate } from "@/lib/waste-rules/types";
import {
  isHostPool,
  sessionHostsForPool,
  underlyingVm,
  type HostPoolProperties,
} from "@/lib/waste-rules/avdSessionHosts";
import {
  findScalingPlanReferenceForPool,
  schedulesForPlan,
  isWithinOffPeakWindow,
  offPeakHoursForSchedule,
} from "@/lib/waste-rules/avdScalingPlans";

export function findAvdHostRunningOutsideScalingWindow(
  resources: ResourceGraphRow[],
  now: Date = new Date(),
): WasteFindingCandidate[] {
  const candidates: WasteFindingCandidate[] = [];

  const pools = resources
    .filter(isHostPool)
    .filter((r) => (r.properties as HostPoolProperties).hostPoolType === "Pooled");

  for (const pool of pools) {
    const found = findScalingPlanReferenceForPool(pool.id, resources);
    if (!found || found.reference.scalingPlanEnabled === false) {
      continue;
    }
    const activeSchedule = schedulesForPlan(found.plan).find((s) =>
      isWithinOffPeakWindow(s, now),
    );
    if (!activeSchedule) {
      continue;
    }
    const offPeakHours = offPeakHoursForSchedule(activeSchedule);

    for (const sessionHost of sessionHostsForPool(pool.id, resources)) {
      const vm = underlyingVm(sessionHost, resources);
      if (vm?.powerState === "PowerState/running") {
        candidates.push({
          ruleType: "AVD_HOST_RUNNING_OUTSIDE_SCALING_WINDOW",
          resourceId: sessionHost.id,
          subscriptionId: sessionHost.subscriptionId,
          savingsCategory: "POTENTIAL_SAVING",
          metricObserved: offPeakHours,
        });
      }
    }
  }

  return candidates;
}
