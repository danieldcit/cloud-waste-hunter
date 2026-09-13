import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import type { WasteFindingCandidate } from "@/lib/waste-rules/types";
import { isSessionHost, type SessionHostProperties } from "@/lib/waste-rules/avdSessionHosts";

export function findAvdSessionHostLowUtilization(
  resources: ResourceGraphRow[],
): WasteFindingCandidate[] {
  return resources
    .filter(isSessionHost)
    .filter((r) => {
      const props = r.properties as SessionHostProperties;
      return (props.sessions ?? 0) === 0 && props.status === "Available";
    })
    .map((r) => ({
      ruleType: "AVD_SESSION_HOST_LOW_UTILIZATION" as const,
      resourceId: r.id,
      subscriptionId: r.subscriptionId,
      savingsCategory: "POTENTIAL_SAVING" as const,
    }));
}
