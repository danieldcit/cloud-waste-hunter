import type { WasteFinding } from "@prisma/client";

export interface DashboardSummary {
  openFindingsCount: number;
  totalEstimatedMonthlySavings: number;
}

/**
 * `estimatedMonthlySavings` (not `estimatedMonthlyCost`) is the actual predicted
 * saving — for delete-it rules it equals resource cost, but for optimize-in-place
 * rules (e.g. Hybrid Benefit) it's a fraction of it. It's deduplicated by
 * `billedResourceId` (falling back to `resourceId` when unset — old rows from
 * before this field existed, or a finding whose resource is priced directly)
 * rather than by `resourceId` alone: a finding can target a resource that isn't
 * itself billed (e.g. an AVD session host, priced against its underlying VM),
 * and two findings pointing at different resourceIds can still be billed
 * against the same underlying resource — deduping by `resourceId` in that case
 * would double-count that resource's cost. One resource can carry multiple
 * open findings; a rule whose saving isn't estimable yet reports `null`, which
 * is excluded from the total rather than treated as 0 savings or the full cost.
 */
export function computeDashboardSummary(
  findings: (Pick<WasteFinding, "status" | "resourceId" | "estimatedMonthlySavings"> & {
    billedResourceId?: string | null;
  })[],
): DashboardSummary {
  const open = findings.filter((f) => f.status === "OPEN");
  const maxSavingsByResource = new Map<string, number>();
  for (const f of open) {
    if (f.estimatedMonthlySavings == null) continue;
    const dedupeKey = f.billedResourceId ?? f.resourceId;
    const current = maxSavingsByResource.get(dedupeKey) ?? 0;
    if (f.estimatedMonthlySavings > current) {
      maxSavingsByResource.set(dedupeKey, f.estimatedMonthlySavings);
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
