import type { WasteFinding } from "@prisma/client";
import {
  sumMaxSavingsPerBilledResource,
  type DedupableFinding,
} from "@/lib/findingDedup";

export interface MonthlyPoint {
  month: string; // "YYYY-MM"
  value: number;
}

/**
 * Savings for RESOLVED findings, grouped by resolvedAt's month.
 *
 * Each month's total is deduplicated by billed resource the same way the dashboard
 * total is (see `sumMaxSavingsPerBilledResource`), so a resource that tripped two
 * rules and got fixed once counts once — otherwise this chart and the PDF would
 * report a larger realized saving than the dashboard reports as potential.
 *
 * The dedup is per month bucket, not global: a resource legitimately contributes to
 * every month in which something about it was resolved, and collapsing across months
 * would silently erase a month's data.
 */
export function groupSavingsResolvedByMonth(
  findings: (Pick<
    WasteFinding,
    "status" | "resolvedAt" | "resourceId" | "estimatedMonthlySavings"
  > & { billedResourceId?: string | null })[],
): MonthlyPoint[] {
  const byMonth = new Map<string, DedupableFinding[]>();
  for (const f of findings) {
    if (f.status !== "RESOLVED" || f.resolvedAt == null || f.estimatedMonthlySavings == null) {
      continue;
    }
    const month = f.resolvedAt.toISOString().slice(0, 7);
    const bucket = byMonth.get(month) ?? [];
    bucket.push(f);
    byMonth.set(month, bucket);
  }
  return [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, bucket]) => ({
      month,
      value: sumMaxSavingsPerBilledResource(bucket),
    }));
}

export interface OpenedVsResolvedPoint {
  month: string;
  opened: number;
  resolved: number;
}

/** Counts findings by detectedAt's month (opened) and by resolvedAt's month (resolved). */
export function groupOpenedVsResolvedByMonth(
  findings: Pick<WasteFinding, "detectedAt" | "resolvedAt">[],
): OpenedVsResolvedPoint[] {
  const points = new Map<string, OpenedVsResolvedPoint>();
  function bump(month: string, key: "opened" | "resolved") {
    const point = points.get(month) ?? { month, opened: 0, resolved: 0 };
    point[key] += 1;
    points.set(month, point);
  }
  for (const f of findings) {
    bump(f.detectedAt.toISOString().slice(0, 7), "opened");
    if (f.resolvedAt != null) {
      bump(f.resolvedAt.toISOString().slice(0, 7), "resolved");
    }
  }
  return [...points.values()].sort((a, b) => a.month.localeCompare(b.month));
}

/** Fills every month between the first and last present month with `makeEmpty`'s value, so a chart never has unexplained gaps. */
export function fillMonthGaps<T extends { month: string }>(
  points: T[],
  makeEmpty: (month: string) => T,
): T[] {
  if (points.length === 0) {
    return [];
  }
  const sorted = [...points].sort((a, b) => a.month.localeCompare(b.month));
  const byMonth = new Map(sorted.map((p) => [p.month, p]));
  const result: T[] = [];
  let current = sorted[0].month;
  const end = sorted[sorted.length - 1].month;
  while (current <= end) {
    result.push(byMonth.get(current) ?? makeEmpty(current));
    current = nextMonth(current);
  }
  return result;
}

function nextMonth(month: string): string {
  const [year, m] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, m, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}
