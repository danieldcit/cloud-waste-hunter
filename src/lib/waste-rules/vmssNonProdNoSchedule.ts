import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import type { WasteFindingCandidate } from "@/lib/waste-rules/types";
import { findAutoscaleSettingFor, autoscaleProfiles } from "@/lib/waste-rules/vmssAutoscale";
import { isNonProdVmssName } from "@/lib/waste-rules/vmssNaming";

export function findVmssNonProdWithoutSchedule(
  resources: ResourceGraphRow[],
): WasteFindingCandidate[] {
  return resources
    .filter((r) => r.type.toLowerCase() === "microsoft.compute/virtualmachinescalesets")
    .filter((r) => isNonProdVmssName(r.id))
    .filter((r) => {
      const setting = findAutoscaleSettingFor(r.id, resources);
      const profiles = autoscaleProfiles(setting);
      return !profiles.some((p) => p.recurrence != null);
    })
    .map((r) => ({
      ruleType: "VMSS_NONPROD_NO_SCHEDULE" as const,
      resourceId: r.id,
      subscriptionId: r.subscriptionId,
      savingsCategory: "POTENTIAL_SAVING" as const,
    }));
}
