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
