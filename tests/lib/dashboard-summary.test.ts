import { describe, expect, it } from "vitest";
import { computeDashboardSummary } from "@/lib/dashboard-summary";

describe("computeDashboardSummary", () => {
  it("counts only OPEN findings and sums their estimated cost", () => {
    const summary = computeDashboardSummary([
      { status: "OPEN", estimatedMonthlyCost: 10, resourceId: "res-1" },
      { status: "OPEN", estimatedMonthlyCost: 5.5, resourceId: "res-2" },
      { status: "DISMISSED", estimatedMonthlyCost: 100, resourceId: "res-3" },
    ]);

    expect(summary).toEqual({ openFindingsCount: 2, totalEstimatedMonthlySavings: 15.5 });
  });

  it("returns zeroes for an empty list", () => {
    expect(computeDashboardSummary([])).toEqual({
      openFindingsCount: 0,
      totalEstimatedMonthlySavings: 0,
    });
  });

  it("counts a resource's cost once, using the maximum, when multiple open findings share a resourceId", () => {
    const summary = computeDashboardSummary([
      { status: "OPEN", estimatedMonthlyCost: 20, resourceId: "vm-1" },
      { status: "OPEN", estimatedMonthlyCost: 20, resourceId: "vm-1" },
      { status: "OPEN", estimatedMonthlyCost: 20, resourceId: "vm-1" },
      { status: "OPEN", estimatedMonthlyCost: 5, resourceId: "disk-1" },
    ]);

    expect(summary).toEqual({ openFindingsCount: 4, totalEstimatedMonthlySavings: 25 });
  });
});
