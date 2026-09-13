import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";

export interface AutoscaleCapacity {
  minimum?: string;
  maximum?: string;
}

export interface AutoscaleRule {
  metricTrigger?: { metricName?: string };
  scaleAction?: { direction?: string };
}

export interface AutoscaleProfile {
  capacity?: AutoscaleCapacity;
  rules?: AutoscaleRule[];
  recurrence?: unknown;
}

interface AutoscaleSettingProperties {
  targetResourceUri?: string;
  profiles?: AutoscaleProfile[];
}

export function findAutoscaleSettingFor(
  vmssId: string,
  resources: ResourceGraphRow[],
): ResourceGraphRow | undefined {
  const target = vmssId.toLowerCase();
  return resources.find((r) => {
    if (r.type.toLowerCase() !== "microsoft.insights/autoscalesettings") {
      return false;
    }
    const props = r.properties as AutoscaleSettingProperties;
    return props.targetResourceUri?.toLowerCase() === target;
  });
}

export function autoscaleProfiles(setting: ResourceGraphRow | undefined): AutoscaleProfile[] {
  if (!setting) {
    return [];
  }
  const props = setting.properties as AutoscaleSettingProperties;
  return props.profiles ?? [];
}
