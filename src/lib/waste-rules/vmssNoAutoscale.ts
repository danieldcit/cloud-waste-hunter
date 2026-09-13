import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import type { WasteFindingCandidate } from "@/lib/waste-rules/types";
import { findAutoscaleSettingFor, autoscaleProfiles } from "@/lib/waste-rules/vmssAutoscale";

export function findVmssWithoutAutoscale(
  resources: ResourceGraphRow[],
): WasteFindingCandidate[] {
  return resources
    .filter((r) => r.type.toLowerCase() === "microsoft.compute/virtualmachinescalesets")
    .filter((r) => {
      const setting = findAutoscaleSettingFor(r.id, resources);
      const profiles = autoscaleProfiles(setting);
      if (profiles.length === 0) {
        return true;
      }
      return profiles.every((p) => {
        const min = Number(p.capacity?.minimum ?? NaN);
        const max = Number(p.capacity?.maximum ?? NaN);
        return !Number.isNaN(min) && !Number.isNaN(max) && min === max;
      });
    })
    .map((r) => ({
      ruleType: "VMSS_NO_AUTOSCALE" as const,
      resourceId: r.id,
      subscriptionId: r.subscriptionId,
      savingsCategory: "POTENTIAL_SAVING" as const,
    }));
}
