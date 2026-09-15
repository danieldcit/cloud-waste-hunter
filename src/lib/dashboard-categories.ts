import type { WasteRuleType } from "@prisma/client";

export type DashboardCategory = "storage" | "compute" | "network";

const CATEGORY_BY_RULE: Record<WasteRuleType, DashboardCategory> = {
  ORPHANED_DISK: "storage",
  OLD_SNAPSHOT: "storage",
  IDLE_VM: "compute",
  UNASSOCIATED_PUBLIC_IP: "network",
  IDLE_VPN_GATEWAY: "network",
  VM_MISSING_HYBRID_BENEFIT: "compute",
  VM_MISSING_LINUX_BYOL: "compute",
  VM_OUTDATED_SKU_GENERATION: "compute",
  VM_STOPPED_RETAINING_RESOURCES: "compute",
  VMSS_NO_AUTOSCALE: "compute",
  VMSS_MAX_INSTANCES_HIGH: "compute",
  VMSS_AUTOSCALE_NO_SCALE_IN: "compute",
  VMSS_IDLE_LOW_UTILIZATION: "compute",
  VMSS_SCALEOUT_METRIC_INADEQUATE: "compute",
  VMSS_NONPROD_NO_SCHEDULE: "compute",
  VMSS_OUTDATED_SKU_GENERATION: "compute",
  VMSS_SPOT_ELIGIBLE: "compute",
  VMSS_MISSING_SAVINGS_PLAN_OR_RESERVATION: "compute",
  VMSS_OUTDATED_MODEL_INSTANCES: "compute",
  AVD_SESSION_HOST_LOW_UTILIZATION: "compute",
  AVD_HOSTPOOL_EXCESS_HOSTS: "compute",
  AVD_HOSTPOOL_LOW_DENSITY: "compute",
  AVD_SESSION_HOST_PREMIUM_DISK_UNUSED: "compute",
  AVD_SCALING_PLAN_MISSING: "compute",
  AVD_SCALING_PLAN_DISABLED: "compute",
  AVD_HOST_RUNNING_OUTSIDE_SCALING_WINDOW: "compute",
  AVD_PERSONAL_HOST_UNUSED: "compute",
  DISK_IDLE_LOW_UTILIZATION: "storage",
  DISK_PREMIUM_TIER_UNNECESSARY: "storage",
  DISK_PREMIUM_V2_OVERSIZED: "storage",
  DISK_TIER_OVERSIZED: "storage",
  DISK_NONPROD_PREMIUM: "storage",
  SNAPSHOT_ORPHANED_SOURCE: "storage",
  SNAPSHOT_EXCESSIVE_COUNT: "storage",
  IMAGE_ORPHANED: "storage",
  GALLERY_IMAGE_VERSION_OLD: "storage",
  AZURE_FILES_SHARE_UNUSED: "storage",
  AZURE_FILES_PREMIUM_OVERSIZED: "storage",
  AZURE_FILES_QUOTA_OVERSIZED: "storage",
  AZURE_FILES_PROTECTION_EXCESSIVE: "storage",
};

export function categoryForRule(ruleType: WasteRuleType): DashboardCategory {
  return CATEGORY_BY_RULE[ruleType];
}

export type ImpactLevel = "high" | "medium" | "low";

export function impactForCost(estimatedMonthlyCost: number): ImpactLevel {
  if (estimatedMonthlyCost >= 20) {
    return "high";
  }
  if (estimatedMonthlyCost >= 5) {
    return "medium";
  }
  return "low";
}
