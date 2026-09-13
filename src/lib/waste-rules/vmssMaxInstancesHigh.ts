import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import type { WasteFindingCandidate } from "@/lib/waste-rules/types";
import { findAutoscaleSettingFor, autoscaleProfiles } from "@/lib/waste-rules/vmssAutoscale";

const MAX_INSTANCES_THRESHOLD = 10;

export function findVmssWithHighMaxInstances(
  resources: ResourceGraphRow[],
): WasteFindingCandidate[] {
  return resources
    .filter((r) => r.type.toLowerCase() === "microsoft.compute/virtualmachinescalesets")
    .filter((r) => {
      const setting = findAutoscaleSettingFor(r.id, resources);
      const profiles = autoscaleProfiles(setting);
      return profiles.some((p) => {
        const max = Number(p.capacity?.maximum ?? NaN);
        return !Number.isNaN(max) && max > MAX_INSTANCES_THRESHOLD;
      });
    })
    .map((r) => ({
      ruleType: "VMSS_MAX_INSTANCES_HIGH" as const,
      resourceId: r.id,
      subscriptionId: r.subscriptionId,
      savingsCategory: "POTENTIAL_SAVING" as const,
    }));
}
