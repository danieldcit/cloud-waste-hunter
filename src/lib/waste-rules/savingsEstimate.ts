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
