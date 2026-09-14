import type { WasteFinding } from "@prisma/client";
import { sumMaxSavingsPerBilledResource } from "@/lib/findingDedup";

export interface DashboardSummary {
  openFindingsCount: number;
  totalEstimatedMonthlySavings: number;
}

/**
 * `estimatedMonthlySavings` (not `estimatedMonthlyCost`) is the actual predicted
 * saving — for delete-it rules it equals resource cost, but for optimize-in-place
 * rules (e.g. Hybrid Benefit) it's a fraction of it. The total is deduplicated by
 * billed resource via `sumMaxSavingsPerBilledResource`; see that function for why
 * one resource's several findings collapse to their max rather than their sum.
 */
export function computeDashboardSummary(
  findings: (Pick<WasteFinding, "status" | "resourceId" | "estimatedMonthlySavings"> & {
    billedResourceId?: string | null;
  })[],
): DashboardSummary {
  const open = findings.filter((f) => f.status === "OPEN");
  return {
    openFindingsCount: open.length,
    totalEstimatedMonthlySavings: sumMaxSavingsPerBilledResource(open),
  };
}
