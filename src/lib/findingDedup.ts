import type { WasteFinding } from "@prisma/client";

export type DedupableFinding = Pick<
  WasteFinding,
  "resourceId" | "estimatedMonthlySavings"
> & {
  billedResourceId?: string | null;
};

/**
 * Totals `estimatedMonthlySavings` across findings without double-counting a
 * resource that carries several of them.
 *
 * One resource can trip multiple rules at once — a VM can be both `IDLE_VM` and
 * `VM_MISSING_HYBRID_BENEFIT` — and those savings are alternatives, not addends:
 * you delete the VM *or* you license it correctly. So each resource contributes
 * its single largest saving, never the sum.
 *
 * Resources are keyed by `billedResourceId`, falling back to `resourceId` when
 * unset (old rows from before that field existed, or a finding whose resource is
 * priced directly). Keying on `resourceId` alone would be wrong in both
 * directions: a finding can target a resource that isn't billed at all (an AVD
 * session host, priced against its underlying VM), and two findings on different
 * `resourceId`s can bill against the same underlying resource — which deduping by
 * `resourceId` would count twice.
 *
 * A rule whose saving isn't estimable yet reports `null`; that's "unknown", so it
 * is excluded from the total rather than read as zero savings or as the full cost.
 *
 * Callers pre-filter to the set they want totalled (e.g. only `OPEN` findings, or
 * only the findings resolved within one month).
 */
export function sumMaxSavingsPerBilledResource(findings: DedupableFinding[]): number {
  const maxSavingsByResource = new Map<string, number>();
  for (const f of findings) {
    if (f.estimatedMonthlySavings == null) continue;
    const dedupeKey = f.billedResourceId ?? f.resourceId;
    const current = maxSavingsByResource.get(dedupeKey) ?? 0;
    if (f.estimatedMonthlySavings > current) {
      maxSavingsByResource.set(dedupeKey, f.estimatedMonthlySavings);
    }
  }
  return [...maxSavingsByResource.values()].reduce((sum, savings) => sum + savings, 0);
}
