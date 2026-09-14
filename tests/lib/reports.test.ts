import { describe, expect, it } from "vitest";
import {
  groupSavingsResolvedByMonth,
  groupOpenedVsResolvedByMonth,
  fillMonthGaps,
} from "@/lib/reports";

describe("groupSavingsResolvedByMonth", () => {
  it("sums estimatedMonthlySavings for RESOLVED findings, grouped by resolvedAt's month", () => {
    const result = groupSavingsResolvedByMonth([
      {
        status: "RESOLVED",
        resolvedAt: new Date("2026-01-15"),
        resourceId: "vm-a",
        billedResourceId: "vm-a",
        estimatedMonthlySavings: 10,
      },
      {
        status: "RESOLVED",
        resolvedAt: new Date("2026-01-20"),
        resourceId: "vm-b",
        billedResourceId: "vm-b",
        estimatedMonthlySavings: 5,
      },
      {
        status: "RESOLVED",
        resolvedAt: new Date("2026-02-01"),
        resourceId: "vm-c",
        billedResourceId: "vm-c",
        estimatedMonthlySavings: 20,
      },
    ]);
    expect(result).toEqual([
      { month: "2026-01", value: 15 },
      { month: "2026-02", value: 20 },
    ]);
  });

  it("counts a billed resource once per month, at its max saving, not the sum of its findings", () => {
    // One VM resolved as both IDLE_VM and VM_MISSING_HYBRID_BENEFIT: you delete it or
    // you license it, you don't bank both savings.
    const result = groupSavingsResolvedByMonth([
      {
        status: "RESOLVED",
        resolvedAt: new Date("2026-01-15"),
        resourceId: "vm-shared",
        billedResourceId: "vm-shared",
        estimatedMonthlySavings: 30,
      },
      {
        status: "RESOLVED",
        resolvedAt: new Date("2026-01-20"),
        resourceId: "vm-shared",
        billedResourceId: "vm-shared",
        estimatedMonthlySavings: 12,
      },
    ]);
    expect(result).toEqual([{ month: "2026-01", value: 30 }]);
  });

  it("dedupes by billedResourceId even when the findings point at different resourceIds", () => {
    const result = groupSavingsResolvedByMonth([
      {
        status: "RESOLVED",
        resolvedAt: new Date("2026-01-15"),
        resourceId: "session-host-1",
        billedResourceId: "vm-underlying",
        estimatedMonthlySavings: 40,
      },
      {
        status: "RESOLVED",
        resolvedAt: new Date("2026-01-16"),
        resourceId: "vm-underlying",
        billedResourceId: "vm-underlying",
        estimatedMonthlySavings: 25,
      },
    ]);
    expect(result).toEqual([{ month: "2026-01", value: 40 }]);
  });

  it("dedupes per month bucket, so one billed resource still counts in each month it was resolved in", () => {
    const result = groupSavingsResolvedByMonth([
      {
        status: "RESOLVED",
        resolvedAt: new Date("2026-01-15"),
        resourceId: "vm-shared",
        billedResourceId: "vm-shared",
        estimatedMonthlySavings: 30,
      },
      {
        status: "RESOLVED",
        resolvedAt: new Date("2026-02-15"),
        resourceId: "vm-shared",
        billedResourceId: "vm-shared",
        estimatedMonthlySavings: 12,
      },
    ]);
    expect(result).toEqual([
      { month: "2026-01", value: 30 },
      { month: "2026-02", value: 12 },
    ]);
  });

  it("falls back to resourceId for dedup when billedResourceId is unset (pre-backfill rows)", () => {
    const result = groupSavingsResolvedByMonth([
      {
        status: "RESOLVED",
        resolvedAt: new Date("2026-01-15"),
        resourceId: "disk-legacy",
        billedResourceId: null,
        estimatedMonthlySavings: 8,
      },
      {
        status: "RESOLVED",
        resolvedAt: new Date("2026-01-18"),
        resourceId: "disk-legacy",
        billedResourceId: null,
        estimatedMonthlySavings: 3,
      },
    ]);
    expect(result).toEqual([{ month: "2026-01", value: 8 }]);
  });

  it("ignores findings that are not RESOLVED", () => {
    const result = groupSavingsResolvedByMonth([
      {
        status: "OPEN",
        resolvedAt: null,
        resourceId: "vm-a",
        billedResourceId: "vm-a",
        estimatedMonthlySavings: 10,
      },
      {
        status: "DISMISSED",
        resolvedAt: null,
        resourceId: "vm-b",
        billedResourceId: "vm-b",
        estimatedMonthlySavings: 10,
      },
    ]);
    expect(result).toEqual([]);
  });

  it("ignores RESOLVED findings with a null estimatedMonthlySavings (unknown, not zero)", () => {
    const result = groupSavingsResolvedByMonth([
      {
        status: "RESOLVED",
        resolvedAt: new Date("2026-01-15"),
        resourceId: "vm-a",
        billedResourceId: "vm-a",
        estimatedMonthlySavings: null,
      },
    ]);
    expect(result).toEqual([]);
  });

  it("returns an empty array for an empty input", () => {
    expect(groupSavingsResolvedByMonth([])).toEqual([]);
  });
});

describe("groupOpenedVsResolvedByMonth", () => {
  it("counts opened by detectedAt's month and resolved by resolvedAt's month", () => {
    const result = groupOpenedVsResolvedByMonth([
      { detectedAt: new Date("2026-01-10"), resolvedAt: new Date("2026-02-05") },
      { detectedAt: new Date("2026-01-12"), resolvedAt: null },
    ]);
    expect(result).toEqual([
      { month: "2026-01", opened: 2, resolved: 0 },
      { month: "2026-02", opened: 0, resolved: 1 },
    ]);
  });

  it("returns an empty array for an empty input", () => {
    expect(groupOpenedVsResolvedByMonth([])).toEqual([]);
  });
});

describe("fillMonthGaps", () => {
  it("fills missing months between the first and last present month with the empty value", () => {
    const result = fillMonthGaps(
      [
        { month: "2026-01", value: 10 },
        { month: "2026-03", value: 30 },
      ],
      (month) => ({ month, value: 0 }),
    );
    expect(result).toEqual([
      { month: "2026-01", value: 10 },
      { month: "2026-02", value: 0 },
      { month: "2026-03", value: 30 },
    ]);
  });

  it("handles a year boundary", () => {
    const result = fillMonthGaps(
      [
        { month: "2025-12", value: 1 },
        { month: "2026-02", value: 2 },
      ],
      (month) => ({ month, value: 0 }),
    );
    expect(result.map((p) => p.month)).toEqual(["2025-12", "2026-01", "2026-02"]);
  });

  it("returns an empty array for an empty input", () => {
    expect(fillMonthGaps([], (month) => ({ month, value: 0 }))).toEqual([]);
  });
});
