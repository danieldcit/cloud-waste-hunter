import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import type { WasteFindingCandidate } from "@/lib/waste-rules/types";
import {
  isHostPool,
  isSessionHost,
  parentHostPoolId,
  underlyingVm,
  type HostPoolProperties,
  type SessionHostProperties,
} from "@/lib/waste-rules/avdSessionHosts";

export function findAvdPersonalHostUnused(
  resources: ResourceGraphRow[],
): WasteFindingCandidate[] {
  const personalPoolIds = new Set(
    resources
      .filter(isHostPool)
      .filter((r) => (r.properties as HostPoolProperties).hostPoolType === "Personal")
      .map((r) => r.id.toLowerCase()),
  );

  return resources
    .filter(isSessionHost)
    .filter((r) => personalPoolIds.has(parentHostPoolId(r.id).toLowerCase()))
    .filter((r) => {
      const props = r.properties as SessionHostProperties;
      if (!props.assignedUser) {
        return false;
      }
      if ((props.sessions ?? 0) !== 0) {
        return false;
      }
      const vm = underlyingVm(r, resources);
      return vm?.powerState === "PowerState/running";
    })
    .map((r) => ({
      ruleType: "AVD_PERSONAL_HOST_UNUSED" as const,
      resourceId: r.id,
      subscriptionId: r.subscriptionId,
      savingsCategory: "POTENTIAL_SAVING" as const,
    }));
}
