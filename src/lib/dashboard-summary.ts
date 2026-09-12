import type { WasteFinding } from "@prisma/client";

export interface DashboardSummary {
  openFindingsCount: number;
  totalEstimatedMonthlySavings: number;
}

export function computeDashboardSummary(
  findings: Pick<WasteFinding, "status" | "estimatedMonthlyCost" | "resourceId">[],
): DashboardSummary {
  const open = findings.filter((f) => f.status === "OPEN");
  const maxCostByResource = new Map<string, number>();
  for (const f of open) {
    const current = maxCostByResource.get(f.resourceId) ?? 0;
    if (f.estimatedMonthlyCost > current) {
      maxCostByResource.set(f.resourceId, f.estimatedMonthlyCost);
    }
  }
  return {
    openFindingsCount: open.length,
    totalEstimatedMonthlySavings: [...maxCostByResource.values()].reduce(
      (sum, cost) => sum + cost,
      0,
    ),
  };
}
