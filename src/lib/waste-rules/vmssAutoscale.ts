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
  /** Azure defaults a setting to enabled when this is omitted; `undefined` must be treated as enabled. */
  enabled?: boolean;
}

/**
 * Index of targetResourceUri (lowercased) -> every autoscale setting targeting it, built once
 * per `resources` array and cached by array reference so 5 call sites don't each do a linear
 * scan per VMSS. The WeakMap key is the array itself, so the index is garbage-collected
 * automatically once the array is, with no manual invalidation needed.
 */
const autoscaleIndexCache = new WeakMap<ResourceGraphRow[], Map<string, ResourceGraphRow[]>>();

function buildAutoscaleIndex(resources: ResourceGraphRow[]): Map<string, ResourceGraphRow[]> {
  const index = new Map<string, ResourceGraphRow[]>();
  for (const r of resources) {
    if (r.type.toLowerCase() !== "microsoft.insights/autoscalesettings") {
      continue;
    }
    const props = r.properties as AutoscaleSettingProperties;
    const target = props.targetResourceUri?.toLowerCase();
    if (!target) {
      continue;
    }
    const settingsForTarget = index.get(target);
    if (settingsForTarget) {
      settingsForTarget.push(r);
    } else {
      index.set(target, [r]);
    }
  }
  return index;
}

function getAutoscaleIndex(resources: ResourceGraphRow[]): Map<string, ResourceGraphRow[]> {
  let index = autoscaleIndexCache.get(resources);
  if (!index) {
    index = buildAutoscaleIndex(resources);
    autoscaleIndexCache.set(resources, index);
  }
  return index;
}

function isExplicitlyEnabled(setting: ResourceGraphRow): boolean {
  const props = setting.properties as AutoscaleSettingProperties;
  return props.enabled !== false;
}

/**
 * Returns the autoscale setting targeting this VMSS. When multiple settings target the same
 * VMSS, prefers one that isn't explicitly disabled (`enabled !== false`, matching Azure's own
 * default of treating a missing `enabled` as on) over an explicitly disabled one. If every
 * candidate is explicitly disabled, falls back to the first match, preserving prior behavior
 * for the single-setting case.
 */
export function findAutoscaleSettingFor(
  vmssId: string,
  resources: ResourceGraphRow[],
): ResourceGraphRow | undefined {
  const target = vmssId.toLowerCase();
  const candidates = getAutoscaleIndex(resources).get(target);
  if (!candidates || candidates.length === 0) {
    return undefined;
  }
  return candidates.find(isExplicitlyEnabled) ?? candidates[0];
}

export function autoscaleProfiles(setting: ResourceGraphRow | undefined): AutoscaleProfile[] {
  if (!setting) {
    return [];
  }
  const props = setting.properties as AutoscaleSettingProperties;
  return props.profiles ?? [];
}
