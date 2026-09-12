import type { WasteFinding } from "@prisma/client";

export interface DashboardSummary {
  openFindingsCount: number;
  totalEstimatedMonthlySavings: number;
}

/**
 * `estimatedMonthlySavings` (not `estimatedMonthlyCost`) is the actual predicted
 * saving — for delete-it rules it equals resource cost, but for optimize-in-place
 * rules (e.g. Hybrid Benefit) it's a fraction of it. It's deduplicated by
 * resourceId (taking the max) because one resource can carry multiple open
 * findings, and a rule whose saving isn't estimable yet reports `null`, which is
 * excluded from the total rather than treated as 0 savings or the full cost.
 */
export function computeDashboardSummary(
  findings: Pick<WasteFinding, "status" | "resourceId" | "estimatedMonthlySavings">[],
): DashboardSummary {
  const open = findings.filter((f) => f.status === "OPEN");
  const maxSavingsByResource = new Map<string, number>();
  for (const f of open) {
    if (f.estimatedMonthlySavings == null) continue;
    const current = maxSavingsByResource.get(f.resourceId) ?? 0;
    if (f.estimatedMonthlySavings > current) {
      maxSavingsByResource.set(f.resourceId, f.estimatedMonthlySavings);
    }
  }
  return {
    openFindingsCount: open.length,
    totalEstimatedMonthlySavings: [...maxSavingsByResource.values()].reduce(
      (sum, savings) => sum + savings,
      0,
    ),
  };
}
