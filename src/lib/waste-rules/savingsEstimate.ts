import type { WasteRuleType } from "@prisma/client";
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import type { WasteFindingCandidate } from "@/lib/waste-rules/types";
import {
  estimateHybridBenefitMonthlySavings,
  estimateLinuxByolMonthlySavings,
  estimateVmssSpotMonthlySavings,
  estimatePremiumDiskDowngradeMonthlySavings,
} from "@/lib/azure/retailPrices";
import { getHourlyCpuBelowThreshold } from "@/lib/azure/monitorMetrics";
import { estimateReservationCoverageMonthlySavings } from "@/lib/azure/reservationCoverage";

type SavingsMethod =
  | "full_cost"
  | "hybrid_benefit"
  | "linux_byol"
  | "nonprod_schedule"
  | "spot_delta"
  | "reservation_recommendation"
  | "premium_disk_delta"
  | "scaling_window_delta"
  | "commitment_recommendation"
  | "unknown";

/** Fraction of hours a VMSS's CPU must sit below this to count toward its "off-hours" savings estimate. */
const NONPROD_IDLE_CPU_THRESHOLD_PERCENT = 5;
const NONPROD_SCHEDULE_WINDOW_DAYS = 30;

/**
 * How each rule's saving relates to its resource cost. `Record<WasteRuleType, ...>` (not a
 * `Set`/`if` chain) is deliberate: TypeScript rejects this file if a future rule type is added
 * to the Prisma schema without a decision being made here, instead of it silently defaulting to
 * "unknown".
 */
const SAVINGS_METHOD_BY_RULE: Record<WasteRuleType, SavingsMethod> = {
  ORPHANED_DISK: "full_cost",
  UNASSOCIATED_PUBLIC_IP: "full_cost",
  OLD_SNAPSHOT: "full_cost",
  IDLE_VPN_GATEWAY: "full_cost",
  IDLE_VM: "full_cost",
  VM_STOPPED_RETAINING_RESOURCES: "full_cost",
  VM_MISSING_HYBRID_BENEFIT: "hybrid_benefit",
  VM_MISSING_LINUX_BYOL: "linux_byol",
  VM_OUTDATED_SKU_GENERATION: "unknown",
  VMSS_NO_AUTOSCALE: "unknown",
  VMSS_MAX_INSTANCES_HIGH: "unknown",
  VMSS_AUTOSCALE_NO_SCALE_IN: "unknown",
  VMSS_IDLE_LOW_UTILIZATION: "full_cost",
  VMSS_SCALEOUT_METRIC_INADEQUATE: "unknown",
  VMSS_NONPROD_NO_SCHEDULE: "nonprod_schedule",
  VMSS_OUTDATED_SKU_GENERATION: "unknown",
  VMSS_SPOT_ELIGIBLE: "spot_delta",
  VMSS_MISSING_SAVINGS_PLAN_OR_RESERVATION: "reservation_recommendation",
  VMSS_OUTDATED_MODEL_INSTANCES: "unknown",
  AVD_SESSION_HOST_LOW_UTILIZATION: "full_cost",
  AVD_HOSTPOOL_EXCESS_HOSTS: "unknown",
  AVD_HOSTPOOL_LOW_DENSITY: "unknown",
  AVD_SESSION_HOST_PREMIUM_DISK_UNUSED: "premium_disk_delta",
  AVD_SCALING_PLAN_MISSING: "unknown",
  AVD_SCALING_PLAN_DISABLED: "unknown",
  AVD_HOST_RUNNING_OUTSIDE_SCALING_WINDOW: "scaling_window_delta",
  AVD_PERSONAL_HOST_UNUSED: "full_cost",
  DISK_IDLE_LOW_UTILIZATION: "full_cost",
  DISK_PREMIUM_TIER_UNNECESSARY: "premium_disk_delta",
  DISK_PREMIUM_V2_OVERSIZED: "unknown",
  DISK_TIER_OVERSIZED: "unknown",
  DISK_NONPROD_PREMIUM: "premium_disk_delta",
  SNAPSHOT_ORPHANED_SOURCE: "full_cost",
  SNAPSHOT_EXCESSIVE_COUNT: "full_cost",
  IMAGE_ORPHANED: "unknown",
  GALLERY_IMAGE_VERSION_OLD: "unknown",
  AZURE_FILES_SHARE_UNUSED: "full_cost",
  AZURE_FILES_PREMIUM_OVERSIZED: "unknown",
  AZURE_FILES_QUOTA_OVERSIZED: "unknown",
  AZURE_FILES_PROTECTION_EXCESSIVE: "unknown",
  AZURE_FILES_OLD_HOT_TIER: "unknown",
  AZURE_FILES_COOL_TIER_UNUSED: "unknown",
  AZURE_FILES_DUPLICATED: "full_cost",
  AZURE_FILES_FSLOGIX_OVERSIZED: "unknown",
  AZURE_FILES_ALTERNATIVE_SERVICE_CHEAPER: "unknown",
  STORAGE_ACCOUNT_UNUSED: "full_cost",
  STORAGE_ACCOUNT_REDUNDANCY_MISMATCH: "unknown",
  BACKUP_VAULT_UNUSED: "unknown",
  BACKUP_ORPHANED_ITEM: "unknown",
  BACKUP_OLD_RECOVERY_POINT: "unknown",
  BACKUP_RETENTION_EXCESSIVE: "unknown",
  NETWORK_FIREWALL_IDLE: "full_cost",
  EGRESS_TRANSFER_EXCESSIVE: "full_cost",
  SQL_DATABASE_OVERPROVISIONED: "full_cost",
  SQL_MANAGED_INSTANCE_OVERPROVISIONED: "full_cost",
  POSTGRES_MYSQL_OVERPROVISIONED: "full_cost",
  COSMOS_DB_LOW_UTILIZATION: "full_cost",
  REDIS_LOW_UTILIZATION: "full_cost",
  AKS_CLUSTER_LOW_UTILIZATION: "full_cost",
  CONTAINER_APPS_IDLE: "full_cost",
  APP_SERVICE_LOW_UTILIZATION: "full_cost",
  FUNCTIONS_LOW_UTILIZATION: "full_cost",
  MONITOR_LOG_ANALYTICS_UNUSED: "full_cost",
  IOT_HUB_IDLE: "full_cost",
  IOT_EDGE_IDLE: "full_cost",
  DATA_FACTORY_IDLE: "full_cost",
  DATABRICKS_IDLE: "full_cost",
  SYNAPSE_IDLE: "full_cost",
  POWER_BI_FABRIC_IDLE: "full_cost",
  STREAM_ANALYTICS_IDLE: "full_cost",
  EVENT_HUBS_IDLE: "full_cost",
  SERVICE_BUS_IDLE: "full_cost",
  STORAGE_QUEUE_IDLE: "full_cost",
  CDN_FRONT_DOOR_IDLE: "full_cost",
  API_MANAGEMENT_IDLE: "full_cost",
  LOGIC_APP_DISABLED: "full_cost",
  AUTOMATION_ACCOUNT_IDLE: "full_cost",
  VM_MISSING_COMMITMENT_COVERAGE: "commitment_recommendation",
  ORPHANED_NAT_GATEWAY: "full_cost",
  DEVTEST_SPOT_ELIGIBLE: "unknown",
  SCHEDULE_REQUIRED_BUT_MISSING: "unknown",
  ARCHITECTURE_REVIEW_REQUIRED: "unknown",
  COST_ANOMALY_DETECTED: "unknown",
  FORECAST_ACTIONABLE_FINDING: "unknown",
  UNIT_ECONOMICS_REVIEW: "unknown",
  AUTOMATION_EXPIRED_RESOURCE: "full_cost",
  ROI_PRIORITIZATION: "unknown",
};

/**
 * Resolves how much a candidate would actually save, as opposed to what its
 * resource costs — the two only coincide for delete-it rules. Returns `null`
 * when the saving can't be reasonably estimated yet rather than fabricating a
 * number.
 */
export async function estimateMonthlySavings(
  candidate: WasteFindingCandidate,
  resource: ResourceGraphRow | undefined,
  estimatedMonthlyCost: number,
): Promise<number | null> {
  const method = SAVINGS_METHOD_BY_RULE[candidate.ruleType];
  switch (method) {
    case "full_cost":
      return estimatedMonthlyCost;
    case "hybrid_benefit":
      return resource
        ? estimateHybridBenefitMonthlySavings(resource, estimatedMonthlyCost)
        : null;
    case "linux_byol":
      return estimateLinuxByolMonthlySavings(estimatedMonthlyCost);
    case "nonprod_schedule": {
      const idleFraction = await getHourlyCpuBelowThreshold(
        candidate.resourceId,
        NONPROD_IDLE_CPU_THRESHOLD_PERCENT,
        NONPROD_SCHEDULE_WINDOW_DAYS,
      );
      return estimatedMonthlyCost * idleFraction;
    }
    case "spot_delta":
      return resource ? estimateVmssSpotMonthlySavings(resource) : null;
    case "reservation_recommendation":
      return estimateReservationCoverageMonthlySavings(candidate.subscriptionId, resource);
    case "commitment_recommendation":
      return estimateReservationCoverageMonthlySavings(candidate.subscriptionId, resource);
    case "premium_disk_delta":
      return resource ? estimatePremiumDiskDowngradeMonthlySavings(resource) : null;
    case "scaling_window_delta": {
      const offPeakHoursPerDay = candidate.metricObserved ?? 0;
      return estimatedMonthlyCost * (offPeakHoursPerDay / 24);
    }
    case "unknown":
      return null;
    default: {
      const exhaustiveCheck: never = method;
      throw new Error(`Unhandled savings method: ${exhaustiveCheck}`);
    }
  }
}

export function buildCombinedSuggestionSummary({
  reductionActions = [],
  complementaryActions = [],
}: {
  reductionActions?: string[];
  complementaryActions?: string[];
}): string | null {
  const actions = [...reductionActions, ...complementaryActions].filter(Boolean);
  if (actions.length === 0) {
    return null;
  }

  if (actions.length === 1) {
    return actions[0];
  }

  if (actions.length === 2) {
    return `${actions[0]} e ${actions[1]}.`;
  }

  return `${actions[0]}, ${actions[1]} ou ${actions[2]}.`;
}
