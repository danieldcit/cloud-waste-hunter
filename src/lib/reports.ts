import type { WasteFinding } from "@prisma/client";

export interface MonthlyPoint {
  month: string; // "YYYY-MM"
  value: number;
}

/** Sum of estimatedMonthlySavings for RESOLVED findings, grouped by resolvedAt's month. */
export function groupSavingsResolvedByMonth(
  findings: Pick<WasteFinding, "status" | "resolvedAt" | "estimatedMonthlySavings">[],
): MonthlyPoint[] {
  const totals = new Map<string, number>();
  for (const f of findings) {
    if (f.status !== "RESOLVED" || f.resolvedAt == null || f.estimatedMonthlySavings == null) {
      continue;
    }
    const month = f.resolvedAt.toISOString().slice(0, 7);
    totals.set(month, (totals.get(month) ?? 0) + f.estimatedMonthlySavings);
  }
  return [...totals.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, value]) => ({ month, value }));
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
