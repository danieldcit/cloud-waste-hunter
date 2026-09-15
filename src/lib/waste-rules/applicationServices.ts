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

export function findLowUtilizationAksClusters(
  resources: ResourceGraphRow[],
): WasteFindingCandidate[] {
  return resources
    .filter((resource) => resource.type.toLowerCase() === "microsoft.containerservice/managedclusters")
    .filter((resource) => {
      const pools = Array.isArray((resource.properties as Record<string, unknown>).agentPoolProfiles)
        ? ((resource.properties as Record<string, unknown>).agentPoolProfiles as Record<string, unknown>[])
        : [];
      if (pools.length === 0) {
        return false;
      }
      return pools.every((pool) => {
        const count = asNumber(pool.count) ?? 0;
        const minCount = asNumber(pool.minCount) ?? count;
        return count <= 1 && minCount <= 1;
      });
    })
    .map((resource) => ({
      ruleType: "AKS_CLUSTER_LOW_UTILIZATION" as const,
      resourceId: resource.id,
      subscriptionId: resource.subscriptionId,
      savingsCategory: "POTENTIAL_SAVING" as const,
      metricObserved: 1,
    }));
}

export function findIdleContainerApps(
  resources: ResourceGraphRow[],
): WasteFindingCandidate[] {
  return resources
    .filter((resource) => resource.type.toLowerCase() === "microsoft.app/containerapps")
    .filter((resource) => {
      const template = ((resource.properties as Record<string, unknown>).template as Record<string, unknown> | undefined) ?? {};
      const scale = (template.scale as Record<string, unknown> | undefined) ?? {};
      const maxReplicas = asNumber(scale.maxReplicas) ?? 1;
      const replicas = asNumber(scale.replicas) ?? 1;
      return maxReplicas <= 1 && replicas <= 1;
    })
    .map((resource) => ({
      ruleType: "CONTAINER_APPS_IDLE" as const,
      resourceId: resource.id,
      subscriptionId: resource.subscriptionId,
      savingsCategory: "POTENTIAL_SAVING" as const,
      metricObserved: asNumber(((resource.properties as Record<string, unknown>).template as Record<string, unknown> | undefined)?.replicas) ?? 1,
    }));
}

export function findLowUtilizationAppServices(
  resources: ResourceGraphRow[],
): WasteFindingCandidate[] {
  return resources
    .filter((resource) => resource.type.toLowerCase() === "microsoft.web/sites")
    .filter((resource) => {
      const kind = String((resource.properties as Record<string, unknown>).kind ?? "");
      const siteConfig = (resource.properties as Record<string, unknown>).siteConfig as Record<string, unknown> | undefined;
      const alwaysOn = siteConfig?.alwaysOn;
      const isFunctionApp = /functionapp/i.test(kind);
      return !isFunctionApp && (alwaysOn === false || alwaysOn === "false");
    })
    .map((resource) => ({
      ruleType: "APP_SERVICE_LOW_UTILIZATION" as const,
      resourceId: resource.id,
      subscriptionId: resource.subscriptionId,
      savingsCategory: "POTENTIAL_SAVING" as const,
      metricObserved: 0,
    }));
}

export function findLowUtilizationFunctions(
  resources: ResourceGraphRow[],
): WasteFindingCandidate[] {
  return resources
    .filter((resource) => resource.type.toLowerCase() === "microsoft.web/sites")
    .filter((resource) => {
      const kind = String((resource.properties as Record<string, unknown>).kind ?? "");
      const siteConfig = (resource.properties as Record<string, unknown>).siteConfig as Record<string, unknown> | undefined;
      const alwaysOn = siteConfig?.alwaysOn;
      const isFunctionApp = /functionapp/i.test(kind);
      return isFunctionApp && (alwaysOn === false || alwaysOn === "false");
    })
    .map((resource) => ({
      ruleType: "FUNCTIONS_LOW_UTILIZATION" as const,
      resourceId: resource.id,
      subscriptionId: resource.subscriptionId,
      savingsCategory: "POTENTIAL_SAVING" as const,
      metricObserved: 0,
    }));
}
