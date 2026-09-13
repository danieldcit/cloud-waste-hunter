import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import type { WasteFindingCandidate } from "@/lib/waste-rules/types";
import { isHostPool, type HostPoolProperties } from "@/lib/waste-rules/avdSessionHosts";
import { findScalingPlanReferenceForPool } from "@/lib/waste-rules/avdScalingPlans";

export function findAvdScalingPlanMissing(
  resources: ResourceGraphRow[],
): WasteFindingCandidate[] {
  return resources
    .filter(isHostPool)
    .filter((r) => (r.properties as HostPoolProperties).hostPoolType === "Pooled")
    .filter((pool) => findScalingPlanReferenceForPool(pool.id, resources) === undefined)
    .map((pool) => ({
      ruleType: "AVD_SCALING_PLAN_MISSING" as const,
      resourceId: pool.id,
      subscriptionId: pool.subscriptionId,
      savingsCategory: "POTENTIAL_SAVING" as const,
    }));
}
