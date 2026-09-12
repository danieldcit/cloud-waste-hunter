import type { WasteRuleType } from "@prisma/client";
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import type { WasteFindingCandidate } from "@/lib/waste-rules/types";
import {
  estimateHybridBenefitMonthlySavings,
  estimateLinuxByolMonthlySavings,
} from "@/lib/azure/retailPrices";

type SavingsMethod = "full_cost" | "hybrid_benefit" | "linux_byol" | "unknown";

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
};

/**
 * Resolves how much a candidate would actually save, as opposed to what its
 * resource costs — the two only coincide for delete-it rules. Returns `null`
 * when the saving can't be reasonably estimated yet (e.g. resizing to a
 * different SKU generation, which depends on a target SKU this rule doesn't
 * pick) rather than fabricating a number.
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
    case "unknown":
      return null;
  }
}
