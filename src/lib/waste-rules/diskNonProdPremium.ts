import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import type { WasteFindingCandidate } from "@/lib/waste-rules/types";
import { isNonProdResourceName } from "@/lib/waste-rules/resourceNaming";

const PREMIUM_SKUS = new Set(["Premium_LRS", "Premium_ZRS", "UltraSSD_LRS"]);

export function findDiskNonProdPremium(resources: ResourceGraphRow[]): WasteFindingCandidate[] {
  return resources
    .filter(
      (r) =>
        r.type.toLowerCase() === "microsoft.compute/disks" &&
        PREMIUM_SKUS.has(r.sku?.name ?? "") &&
        isNonProdResourceName(r.id),
    )
    .map((r) => ({
      ruleType: "DISK_NONPROD_PREMIUM" as const,
      resourceId: r.id,
      subscriptionId: r.subscriptionId,
      savingsCategory: "POTENTIAL_SAVING" as const,
    }));
}
