import { describe, expect, it } from "vitest";
import { maxIopsForPremiumDiskSize, smallestPremiumDiskSizeForIops } from "@/lib/azure/premiumDiskTiers";

describe("maxIopsForPremiumDiskSize", () => {
  it.each([
    [4, 120],
    [32, 120],
    [64, 240],
    [128, 500],
    [256, 1100],
    [512, 2300],
    [1024, 5000],
    [2048, 7500],
    [4096, 7500],
    [8192, 16000],
    [16384, 18000],
    [32767, 20000],
  ])("returns %i IOPS max capacity for a %i GiB disk", (sizeGb, expectedIops) => {
    expect(maxIopsForPremiumDiskSize(sizeGb)).toBe(expectedIops);
  });

  it("rounds a size between two bands up to the next tier's capacity (100 GiB -> P10's 500 IOPS)", () => {
    expect(maxIopsForPremiumDiskSize(100)).toBe(500);
  });

  it("clamps a size larger than the largest published tier to P80's capacity", () => {
    expect(maxIopsForPremiumDiskSize(65536)).toBe(20000);
  });
});

describe("smallestPremiumDiskSizeForIops", () => {
  it("returns the smallest tier whose maxIops covers the peak with the 70% safety ceiling", () => {
    // 128 GiB tier has maxIops 500; 500 * 0.7 = 350 — a peak of 340 fits with margin
    expect(smallestPremiumDiskSizeForIops(340)).toBe(128);
  });

  it("clamps to the largest published tier for a peak beyond all bands", () => {
    expect(smallestPremiumDiskSizeForIops(1_000_000)).toBe(32767);
  });

  it("returns the smallest tier for a very low peak", () => {
    expect(smallestPremiumDiskSizeForIops(1)).toBe(32);
  });
});
