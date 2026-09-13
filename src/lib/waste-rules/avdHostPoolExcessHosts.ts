import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import type { WasteFindingCandidate } from "@/lib/waste-rules/types";
import {
  isHostPool,
  sessionHostsForPool,
  type HostPoolProperties,
  type SessionHostProperties,
} from "@/lib/waste-rules/avdSessionHosts";

/** Configured capacity must be at least this multiple of observed usage to count as "excess". */
const CAPACITY_TO_USAGE_RATIO_THRESHOLD = 2;

export function findAvdHostPoolExcessHosts(
  resources: ResourceGraphRow[],
): WasteFindingCandidate[] {
  return resources
    .filter(isHostPool)
    .filter((r) => (r.properties as HostPoolProperties).hostPoolType === "Pooled")
    .filter((pool) => {
      const maxSessionLimit = (pool.properties as HostPoolProperties).maxSessionLimit ?? 0;
      const hosts = sessionHostsForPool(pool.id, resources);
      if (hosts.length === 0 || maxSessionLimit === 0) {
        return false;
      }
      const totalCapacity = hosts.length * maxSessionLimit;
      const totalSessions = hosts.reduce(
        (sum, h) => sum + ((h.properties as SessionHostProperties).sessions ?? 0),
        0,
      );
      if (totalSessions === 0) {
        return false;
      }
      return totalCapacity >= totalSessions * CAPACITY_TO_USAGE_RATIO_THRESHOLD;
    })
    .map((pool) => ({
      ruleType: "AVD_HOSTPOOL_EXCESS_HOSTS" as const,
      resourceId: pool.id,
      subscriptionId: pool.subscriptionId,
      savingsCategory: "POTENTIAL_SAVING" as const,
    }));
}
