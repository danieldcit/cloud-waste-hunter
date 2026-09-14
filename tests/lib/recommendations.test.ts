import { describe, expect, it } from "vitest";
import { sortByImpact } from "@/lib/recommendations";

describe("sortByImpact", () => {
  it("sorts findings with a known savings amount by savings, highest first", () => {
    const sorted = sortByImpact([
      { id: "a", estimatedMonthlyCost: 10, estimatedMonthlySavings: 5 },
      { id: "b", estimatedMonthlyCost: 10, estimatedMonthlySavings: 20 },
      { id: "c", estimatedMonthlyCost: 10, estimatedMonthlySavings: 12 },
    ]);

    expect(sorted.map((f) => f.id)).toEqual(["b", "c", "a"]);
  });

  it("places findings with unknown (null) savings after all findings with a known amount", () => {
    const sorted = sortByImpact([
      { id: "unknown", estimatedMonthlyCost: 999, estimatedMonthlySavings: null },
      { id: "known", estimatedMonthlyCost: 1, estimatedMonthlySavings: 1 },
    ]);

    expect(sorted.map((f) => f.id)).toEqual(["known", "unknown"]);
  });

  it("sorts findings with unknown savings among themselves by resource cost, highest first", () => {
    const sorted = sortByImpact([
      { id: "cheap", estimatedMonthlyCost: 5, estimatedMonthlySavings: null },
      { id: "pricey", estimatedMonthlyCost: 50, estimatedMonthlySavings: null },
      { id: "mid", estimatedMonthlyCost: 20, estimatedMonthlySavings: null },
    ]);

    expect(sorted.map((f) => f.id)).toEqual(["pricey", "mid", "cheap"]);
  });

  it("does not mutate the input array", () => {
    const input = [
      { id: "a", estimatedMonthlyCost: 10, estimatedMonthlySavings: 1 },
      { id: "b", estimatedMonthlyCost: 10, estimatedMonthlySavings: 2 },
    ];
    const inputCopy = [...input];

    sortByImpact(input);

    expect(input).toEqual(inputCopy);
  });

  it("returns an empty array for an empty input", () => {
    expect(sortByImpact([])).toEqual([]);
  });
});
