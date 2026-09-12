import type { WasteRuleType } from "@prisma/client";
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import type { WasteFindingCandidate } from "@/lib/waste-rules/types";
import {
  estimateHybridBenefitMonthlySavings,
  estimateLinuxByolMonthlySavings,
} from "@/lib/azure/retailPrices";

/** Delete-it / deprovision-it rules: the whole resource cost is the saving. */
const FULL_COST_IS_SAVINGS_RULES = new Set<WasteRuleType>([
  "ORPHANED_DISK",
  "UNASSOCIATED_PUBLIC_IP",
  "OLD_SNAPSHOT",
  "IDLE_VPN_GATEWAY",
  "IDLE_VM",
  "VM_STOPPED_RETAINING_RESOURCES",
]);

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
  if (FULL_COST_IS_SAVINGS_RULES.has(candidate.ruleType)) {
    return estimatedMonthlyCost;
  }
  if (candidate.ruleType === "VM_MISSING_HYBRID_BENEFIT" && resource) {
    return estimateHybridBenefitMonthlySavings(resource);
  }
  if (candidate.ruleType === "VM_MISSING_LINUX_BYOL" && resource) {
    const storageProfile = resource.properties.storageProfile as
      | { imageReference?: { publisher?: string } }
      | undefined;
    const publisher = storageProfile?.imageReference?.publisher ?? "";
    return estimateLinuxByolMonthlySavings(resource, publisher);
  }
  return null;
}
