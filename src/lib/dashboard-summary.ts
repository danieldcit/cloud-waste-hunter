import type { WasteFinding } from "@prisma/client";

export interface DashboardSummary {
  openFindingsCount: number;
  totalEstimatedMonthlySavings: number;
}

export function computeDashboardSummary(
  findings: Pick<WasteFinding, "status" | "estimatedMonthlyCost">[],
): DashboardSummary {
  const open = findings.filter((f) => f.status === "OPEN");
  return {
    openFindingsCount: open.length,
    totalEstimatedMonthlySavings: open.reduce((sum, f) => sum + f.estimatedMonthlyCost, 0),
  };
}
