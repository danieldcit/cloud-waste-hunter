import { describe, expect, it } from "vitest";
import { isDeprecatedVmSize } from "@/lib/azure/deprecatedVmSkus";

describe("isDeprecatedVmSize", () => {
  it("returns true for a classic A-series size", () => {
    expect(isDeprecatedVmSize("Standard_A2")).toBe(true);
  });

  it("returns true for a Dv2-series size", () => {
    expect(isDeprecatedVmSize("Standard_D2_v2")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isDeprecatedVmSize("standard_a2")).toBe(true);
  });

  it("returns false for a current-generation size", () => {
    expect(isDeprecatedVmSize("Standard_D2s_v5")).toBe(false);
  });
});
