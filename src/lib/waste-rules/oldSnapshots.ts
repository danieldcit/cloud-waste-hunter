import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import type { WasteFindingCandidate } from "@/lib/waste-rules/types";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export function findOldSnapshots(
  resources: ResourceGraphRow[],
  now: Date = new Date(),
): WasteFindingCandidate[] {
  return resources
    .filter((r) => {
      if (r.type.toLowerCase() !== "microsoft.compute/snapshots") {
        return false;
      }
      const timeCreated = r.properties.timeCreated;
      if (typeof timeCreated !== "string") {
        return false;
      }
      const ageMs = now.getTime() - new Date(timeCreated).getTime();
      return ageMs > THIRTY_DAYS_MS;
    })
    .map((r) => ({
      ruleType: "OLD_SNAPSHOT",
      resourceId: r.id,
      subscriptionId: r.subscriptionId,
    }));
}
