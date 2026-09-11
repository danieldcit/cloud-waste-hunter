import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import type { WasteFindingCandidate } from "@/lib/waste-rules/types";

export function findUnassociatedPublicIps(
  resources: ResourceGraphRow[],
): WasteFindingCandidate[] {
  return resources
    .filter(
      (r) =>
        r.type.toLowerCase() === "microsoft.network/publicipaddresses" &&
        !r.properties.ipConfiguration,
    )
    .map((r) => ({
      ruleType: "UNASSOCIATED_PUBLIC_IP",
      resourceId: r.id,
      subscriptionId: r.subscriptionId,
    }));
}
