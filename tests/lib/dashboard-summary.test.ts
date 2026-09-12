import { describe, expect, it } from "vitest";
import { computeDashboardSummary } from "@/lib/dashboard-summary";

describe("computeDashboardSummary", () => {
  it("counts only OPEN findings and sums their estimated savings", () => {
    const summary = computeDashboardSummary([
      { status: "OPEN", estimatedMonthlySavings: 10, resourceId: "res-1" },
      { status: "OPEN", estimatedMonthlySavings: 5.5, resourceId: "res-2" },
      { status: "DISMISSED", estimatedMonthlySavings: 100, resourceId: "res-3" },
    ]);

    expect(summary).toEqual({ openFindingsCount: 2, totalEstimatedMonthlySavings: 15.5 });
  });

  it("returns zeroes for an empty list", () => {
    expect(computeDashboardSummary([])).toEqual({
      openFindingsCount: 0,
      totalEstimatedMonthlySavings: 0,
    });
  });

  it("counts a resource's savings once, using the maximum, when multiple open findings share a resourceId", () => {
    const summary = computeDashboardSummary([
      { status: "OPEN", estimatedMonthlySavings: 20, resourceId: "vm-1" },
      { status: "OPEN", estimatedMonthlySavings: 20, resourceId: "vm-1" },
      { status: "OPEN", estimatedMonthlySavings: 20, resourceId: "vm-1" },
      { status: "OPEN", estimatedMonthlySavings: 5, resourceId: "disk-1" },
    ]);

    expect(summary).toEqual({ openFindingsCount: 4, totalEstimatedMonthlySavings: 25 });
  });

  it("excludes findings with an unknown (null) savings amount from the total, but still counts them", () => {
    const summary = computeDashboardSummary([
      { status: "OPEN", estimatedMonthlySavings: 10, resourceId: "res-1" },
      { status: "OPEN", estimatedMonthlySavings: null, resourceId: "res-2" },
    ]);

    expect(summary).toEqual({ openFindingsCount: 2, totalEstimatedMonthlySavings: 10 });
  });
});
