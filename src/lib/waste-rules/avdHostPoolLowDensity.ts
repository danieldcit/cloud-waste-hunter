import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import type { WasteFindingCandidate } from "@/lib/waste-rules/types";
import {
  isHostPool,
  sessionHostsForPool,
  type HostPoolProperties,
  type SessionHostProperties,
} from "@/lib/waste-rules/avdSessionHosts";

/** Average sessions-per-host below this fraction of maxSessionLimit counts as "low density". */
const LOW_DENSITY_RATIO_THRESHOLD = 0.3;

export function findAvdHostPoolLowDensity(
  resources: ResourceGraphRow[],
): WasteFindingCandidate[] {
  return resources
    .filter(isHostPool)
    .filter((r) => (r.properties as HostPoolProperties).hostPoolType === "Pooled")
    .filter((pool) => {
      const maxSessionLimit = (pool.properties as HostPoolProperties).maxSessionLimit ?? 0;
      const availableHosts = sessionHostsForPool(pool.id, resources).filter(
        (h) => (h.properties as SessionHostProperties).status === "Available",
      );
      if (availableHosts.length === 0 || maxSessionLimit === 0) {
        return false;
      }
      const totalSessions = availableHosts.reduce(
        (sum, h) => sum + ((h.properties as SessionHostProperties).sessions ?? 0),
        0,
      );
      const averageSessions = totalSessions / availableHosts.length;
      return averageSessions < maxSessionLimit * LOW_DENSITY_RATIO_THRESHOLD;
    })
    .map((pool) => ({
      ruleType: "AVD_HOSTPOOL_LOW_DENSITY" as const,
      resourceId: pool.id,
      subscriptionId: pool.subscriptionId,
      savingsCategory: "POTENTIAL_SAVING" as const,
    }));
}
