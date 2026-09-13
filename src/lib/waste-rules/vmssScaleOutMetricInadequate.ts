import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import type { WasteFindingCandidate } from "@/lib/waste-rules/types";
import { findAutoscaleSettingFor, autoscaleProfiles } from "@/lib/waste-rules/vmssAutoscale";

const EXPECTED_SCALEOUT_METRIC = "Percentage CPU";

export function findVmssScaleOutMetricInadequate(
  resources: ResourceGraphRow[],
): WasteFindingCandidate[] {
  return resources
    .filter((r) => r.type.toLowerCase() === "microsoft.compute/virtualmachinescalesets")
    .filter((r) => {
      const setting = findAutoscaleSettingFor(r.id, resources);
      const profiles = autoscaleProfiles(setting);
      return profiles.some((p) =>
        (p.rules ?? []).some(
          (rule) =>
            rule.scaleAction?.direction === "Increase" &&
            rule.metricTrigger?.metricName !== EXPECTED_SCALEOUT_METRIC,
        ),
      );
    })
    .map((r) => ({
      ruleType: "VMSS_SCALEOUT_METRIC_INADEQUATE" as const,
      resourceId: r.id,
      subscriptionId: r.subscriptionId,
      savingsCategory: "POTENTIAL_SAVING" as const,
    }));
}
