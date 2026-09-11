import { describe, expect, it } from "vitest";
import { computeDashboardSummary } from "@/lib/dashboard-summary";

describe("computeDashboardSummary", () => {
  it("counts only OPEN findings and sums their estimated cost", () => {
    const summary = computeDashboardSummary([
      { status: "OPEN", estimatedMonthlyCost: 10 },
      { status: "OPEN", estimatedMonthlyCost: 5.5 },
      { status: "DISMISSED", estimatedMonthlyCost: 100 },
    ]);

    expect(summary).toEqual({ openFindingsCount: 2, totalEstimatedMonthlySavings: 15.5 });
  });

  it("returns zeroes for an empty list", () => {
    expect(computeDashboardSummary([])).toEqual({
      openFindingsCount: 0,
      totalEstimatedMonthlySavings: 0,
    });
  });
});
