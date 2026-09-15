import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import type { WasteFindingCandidate } from "@/lib/waste-rules/types";

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

export function findUnusedMonitorWorkspaces(
  resources: ResourceGraphRow[],
): WasteFindingCandidate[] {
  return resources
    .filter((resource) => resource.type.toLowerCase() === "microsoft.operationalinsights/workspaces")
    .filter((resource) => {
      const props = resource.properties as Record<string, unknown>;
      const dailyQuotaGb = asNumber(props.dailyQuotaGb) ?? asNumber(props.dailyQuotaGbInGb);
      const retentionDays = asNumber(props.retentionInDays) ?? 0;
      return dailyQuotaGb != null && dailyQuotaGb <= 1 && retentionDays >= 30;
    })
    .map((resource) => ({
      ruleType: "MONITOR_LOG_ANALYTICS_UNUSED" as const,
      resourceId: resource.id,
      subscriptionId: resource.subscriptionId,
      savingsCategory: "POTENTIAL_SAVING" as const,
      metricObserved: asNumber((resource.properties as Record<string, unknown>).dailyQuotaGb) ?? 1,
    }));
}

export function findIdleIoTHubs(
  resources: ResourceGraphRow[],
): WasteFindingCandidate[] {
  return resources
    .filter((resource) => resource.type.toLowerCase() === "microsoft.devices/iothubs")
    .filter((resource) => {
      const props = resource.properties as Record<string, unknown>;
      const devices =
        asNumber(props.totalDeviceCount) ??
        asNumber(props.deviceCount) ??
        asNumber(props.connectedDeviceCount);
      return devices != null && devices === 0;
    })
    .map((resource) => ({
      ruleType: "IOT_HUB_IDLE" as const,
      resourceId: resource.id,
      subscriptionId: resource.subscriptionId,
      savingsCategory: "POTENTIAL_SAVING" as const,
      metricObserved: 0,
    }));
}
