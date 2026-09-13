import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import type { WasteFindingCandidate } from "@/lib/waste-rules/types";
import { findAutoscaleSettingFor, autoscaleProfiles } from "@/lib/waste-rules/vmssAutoscale";

export function findVmssAutoscaleWithoutScaleIn(
  resources: ResourceGraphRow[],
): WasteFindingCandidate[] {
  return resources
    .filter((r) => r.type.toLowerCase() === "microsoft.compute/virtualmachinescalesets")
    .filter((r) => {
      const setting = findAutoscaleSettingFor(r.id, resources);
      const profiles = autoscaleProfiles(setting);
      if (profiles.length === 0) {
        return false;
      }
      const hasScaleIn = profiles.some((p) =>
        (p.rules ?? []).some((rule) => rule.scaleAction?.direction === "Decrease"),
      );
      return !hasScaleIn;
    })
    .map((r) => ({
      ruleType: "VMSS_AUTOSCALE_NO_SCALE_IN" as const,
      resourceId: r.id,
      subscriptionId: r.subscriptionId,
      savingsCategory: "POTENTIAL_SAVING" as const,
    }));
}
