import type { WasteRuleType } from "@prisma/client";

export type DashboardCategory =
  | "storage"
  | "compute"
  | "network"
  | "databases"
  | "containers"
  | "dataAi"
  | "costManagement";

export type CostManagementSubcategory =
  | "licensing"
  | "reservations"
  | "savingsPlans"
  | "devTest"
  | "schedule"
  | "cleanup"
  | "anomalies"
  | "forecastBudget"
  | "architecture"
  | "roi";

const CATEGORY_BY_RULE: Record<WasteRuleType, DashboardCategory> = {
  ORPHANED_DISK: "storage",
  OLD_SNAPSHOT: "storage",
  IDLE_VM: "compute",
  UNASSOCIATED_PUBLIC_IP: "network",
  IDLE_VPN_GATEWAY: "network",
  VM_MISSING_HYBRID_BENEFIT: "costManagement",
  VM_MISSING_LINUX_BYOL: "costManagement",
  VM_OUTDATED_SKU_GENERATION: "compute",
  VM_STOPPED_RETAINING_RESOURCES: "compute",
  VMSS_NO_AUTOSCALE: "compute",
  VMSS_MAX_INSTANCES_HIGH: "compute",
  VMSS_AUTOSCALE_NO_SCALE_IN: "compute",
  VMSS_IDLE_LOW_UTILIZATION: "compute",
  VMSS_SCALEOUT_METRIC_INADEQUATE: "compute",
  VMSS_NONPROD_NO_SCHEDULE: "costManagement",
  VMSS_OUTDATED_SKU_GENERATION: "compute",
  VMSS_SPOT_ELIGIBLE: "costManagement",
  VMSS_MISSING_SAVINGS_PLAN_OR_RESERVATION: "costManagement",
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
  AZURE_FILES_OLD_HOT_TIER: "storage",
  AZURE_FILES_COOL_TIER_UNUSED: "storage",
  AZURE_FILES_DUPLICATED: "storage",
  AZURE_FILES_FSLOGIX_OVERSIZED: "storage",
  AZURE_FILES_ALTERNATIVE_SERVICE_CHEAPER: "storage",
  STORAGE_ACCOUNT_UNUSED: "storage",
  STORAGE_ACCOUNT_REDUNDANCY_MISMATCH: "storage",
  BACKUP_VAULT_UNUSED: "storage",
  BACKUP_ORPHANED_ITEM: "storage",
  BACKUP_OLD_RECOVERY_POINT: "storage",
  BACKUP_RETENTION_EXCESSIVE: "storage",
  NETWORK_FIREWALL_IDLE: "network",
  EGRESS_TRANSFER_EXCESSIVE: "network",
  SQL_DATABASE_OVERPROVISIONED: "databases",
  SQL_MANAGED_INSTANCE_OVERPROVISIONED: "databases",
  POSTGRES_MYSQL_OVERPROVISIONED: "databases",
  COSMOS_DB_LOW_UTILIZATION: "databases",
  REDIS_LOW_UTILIZATION: "databases",
  AKS_CLUSTER_LOW_UTILIZATION: "containers",
  CONTAINER_APPS_IDLE: "containers",
  APP_SERVICE_LOW_UTILIZATION: "containers",
  FUNCTIONS_LOW_UTILIZATION: "containers",
  MONITOR_LOG_ANALYTICS_UNUSED: "dataAi",
  IOT_HUB_IDLE: "dataAi",
  IOT_EDGE_IDLE: "dataAi",
  DATA_FACTORY_IDLE: "dataAi",
  DATABRICKS_IDLE: "dataAi",
  SYNAPSE_IDLE: "dataAi",
  POWER_BI_FABRIC_IDLE: "dataAi",
  STREAM_ANALYTICS_IDLE: "dataAi",
  EVENT_HUBS_IDLE: "dataAi",
  SERVICE_BUS_IDLE: "dataAi",
  STORAGE_QUEUE_IDLE: "storage",
  CDN_FRONT_DOOR_IDLE: "network",
  API_MANAGEMENT_IDLE: "dataAi",
  LOGIC_APP_DISABLED: "dataAi",
  AUTOMATION_ACCOUNT_IDLE: "costManagement",
  VM_MISSING_COMMITMENT_COVERAGE: "costManagement",
  ORPHANED_NAT_GATEWAY: "network",
  DEVTEST_SPOT_ELIGIBLE: "costManagement",
  SCHEDULE_REQUIRED_BUT_MISSING: "costManagement",
  ARCHITECTURE_REVIEW_REQUIRED: "costManagement",
  COST_ANOMALY_DETECTED: "costManagement",
  FORECAST_ACTIONABLE_FINDING: "costManagement",
  UNIT_ECONOMICS_REVIEW: "costManagement",
  AUTOMATION_EXPIRED_RESOURCE: "costManagement",
  ROI_PRIORITIZATION: "costManagement",
};

export function categoryForRule(ruleType: WasteRuleType): DashboardCategory {
  return CATEGORY_BY_RULE[ruleType];
}

const COST_SUBCATEGORY_BY_RULE: Partial<Record<WasteRuleType, CostManagementSubcategory>> = {
  VM_MISSING_HYBRID_BENEFIT: "licensing",
  VM_MISSING_LINUX_BYOL: "licensing",
  VMSS_MISSING_SAVINGS_PLAN_OR_RESERVATION: "reservations",
  VM_MISSING_COMMITMENT_COVERAGE: "reservations",
  DEVTEST_SPOT_ELIGIBLE: "devTest",
  VMSS_NONPROD_NO_SCHEDULE: "schedule",
  SCHEDULE_REQUIRED_BUT_MISSING: "schedule",
  ORPHANED_NAT_GATEWAY: "cleanup",
  AUTOMATION_ACCOUNT_IDLE: "cleanup",
  AUTOMATION_EXPIRED_RESOURCE: "cleanup",
  COST_ANOMALY_DETECTED: "anomalies",
  UNIT_ECONOMICS_REVIEW: "anomalies",
  FORECAST_ACTIONABLE_FINDING: "forecastBudget",
  ARCHITECTURE_REVIEW_REQUIRED: "architecture",
  ROI_PRIORITIZATION: "roi",
};

export function costManagementSubcategoryForRule(
  ruleType: WasteRuleType,
): CostManagementSubcategory | null {
  return COST_SUBCATEGORY_BY_RULE[ruleType] ?? null;
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
