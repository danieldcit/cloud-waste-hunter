import { describe, expect, it, vi } from "vitest";
import { findSafeVmSkuCandidates, suggestVmSku, type VmSkuCandidate } from "@/lib/waste-rules/vmSkuSuggestion";

describe("findSafeVmSkuCandidates", () => {
  const candidates: VmSkuCandidate[] = [
    { name: "Standard_B1ms", vCPUs: 1, memoryGB: 2, restricted: false },
    { name: "Standard_B2ms", vCPUs: 2, memoryGB: 8, restricted: false },
    { name: "Standard_B4ms", vCPUs: 4, memoryGB: 16, restricted: false },
    { name: "Standard_Restricted2", vCPUs: 2, memoryGB: 8, restricted: true },
  ];

  it("excludes restricted candidates", () => {
    const safe = findSafeVmSkuCandidates(candidates, 8, 16, 10);
    expect(safe.some((c) => c.name === "Standard_Restricted2")).toBe(false);
  });

  it("excludes candidates with less memory than the current VM", () => {
    // current VM: 8 vCPUs, 32 GB RAM — no candidate above has >= 32 GB
    const safe = findSafeVmSkuCandidates(candidates, 8, 32, 10);
    expect(safe).toEqual([]);
  });

  it("excludes candidates whose vCPU can't cover the peak (not the average)", () => {
    // current VM: 8 vCPUs, peak 90% -> peakVCpuDemand = 7.2, minVCpus = 7.2/0.7 = ~10.3
    // no candidate here has vCPUs >= 10.3
    const safe = findSafeVmSkuCandidates(candidates, 8, 2, 90);
    expect(safe).toEqual([]);
  });

  it("only includes candidates that are an actual downsize (fewer vCPUs than current)", () => {
    const safe = findSafeVmSkuCandidates(candidates, 4, 2, 5);
    expect(safe.every((c) => c.vCPUs < 4)).toBe(true);
  });

  it("sorts safe candidates by vCPU ascending", () => {
    const safe = findSafeVmSkuCandidates(candidates, 8, 2, 5);
    const vcpus = safe.map((c) => c.vCPUs);
    expect(vcpus).toEqual([...vcpus].sort((a, b) => a - b));
  });
});

describe("suggestVmSku", () => {
  const resource = {
    id: "/subscriptions/x/resourceGroups/y/providers/Microsoft.Compute/virtualMachines/vm-1",
    type: "microsoft.compute/virtualmachines",
    subscriptionId: "sub-1",
    location: "brazilsouth",
    properties: {},
  };
  // Every test's SKU list includes the VM's own current size ("Standard_D4s_v3", 4 vCPUs/16 GB)
  // — suggestVmSku looks up the current VM's specs from this same list rather than requiring the
  // caller to pass currentVCpus/currentMemoryGB pre-parsed from the vmSize string.
  const currentSku: VmSkuCandidate = { name: "Standard_D4s_v3", vCPUs: 4, memoryGB: 16, restricted: false };

  it("falls back to average CPU when peak CPU is unavailable", async () => {
    const skus: VmSkuCandidate[] = [
      currentSku,
      { name: "Standard_B2ms", vCPUs: 2, memoryGB: 16, restricted: false },
    ];
    const result = await suggestVmSku(
      resource, "sub-1", "Standard_D4s_v3", false,
      vi.fn().mockResolvedValue(null),
      vi.fn().mockResolvedValue(5),
      vi.fn().mockResolvedValue(skus),
      vi.fn()
        .mockResolvedValueOnce(100)
        .mockResolvedValueOnce(60),
    );
    expect(result).toEqual({ skuName: "Standard_B2ms", monthlySavings: 40 });
  });

  it("returns null when the current VM's size isn't found in the region's SKU list", async () => {
    const result = await suggestVmSku(
      resource, "sub-1", "Standard_D4s_v3", false,
      vi.fn().mockResolvedValue(10),
      vi.fn().mockResolvedValue([]), // current size missing — never guess its specs
      vi.fn(),
    );
    expect(result).toBeNull();
  });

  it("returns null when no safe candidate exists", async () => {
    const result = await suggestVmSku(
      resource, "sub-1", "Standard_D4s_v3", false,
      vi.fn().mockResolvedValue(10), // low peak
      vi.fn().mockResolvedValue([currentSku]), // only the current size itself — no smaller candidate
      vi.fn(),
    );
    expect(result).toBeNull();
  });

  it("returns null when the current SKU itself can't be priced", async () => {
    const skus: VmSkuCandidate[] = [
      currentSku,
      { name: "Standard_B2ms", vCPUs: 2, memoryGB: 16, restricted: false },
    ];
    const result = await suggestVmSku(
      resource, "sub-1", "Standard_D4s_v3", false,
      vi.fn().mockResolvedValue(10),
      vi.fn().mockResolvedValue(skus),
      vi.fn().mockResolvedValue(0), // getSkuPrice returns 0 for the current SKU itself
    );
    expect(result).toBeNull();
  });

  it("returns the cheapest confirmed candidate with positive savings", async () => {
    const skus: VmSkuCandidate[] = [
      currentSku,
      { name: "Standard_B1ms", vCPUs: 1, memoryGB: 16, restricted: false },
      { name: "Standard_B2ms", vCPUs: 2, memoryGB: 16, restricted: false },
    ];
    const getSkuPrice = vi.fn()
      .mockResolvedValueOnce(100) // current SKU (Standard_D4s_v3)
      .mockResolvedValueOnce(80) // Standard_B1ms
      .mockResolvedValueOnce(40); // Standard_B2ms — cheaper than B1ms despite more vCPUs (hypothetical, still valid: pick min price)
    const result = await suggestVmSku(
      resource, "sub-1", "Standard_D4s_v3", false,
      vi.fn().mockResolvedValue(10),
      vi.fn().mockResolvedValue(skus),
      getSkuPrice,
    );
    expect(result).toEqual({ skuName: "Standard_B2ms", monthlySavings: 60 });
  });

  it("returns null when all priced candidates cost as much or more than the current VM", async () => {
    const skus: VmSkuCandidate[] = [currentSku, { name: "Standard_B2ms", vCPUs: 2, memoryGB: 16, restricted: false }];
    const getSkuPrice = vi.fn()
      .mockResolvedValueOnce(50) // current SKU
      .mockResolvedValueOnce(60); // candidate — more expensive than current
    const result = await suggestVmSku(
      resource, "sub-1", "Standard_D4s_v3", false,
      vi.fn().mockResolvedValue(10),
      vi.fn().mockResolvedValue(skus),
      getSkuPrice,
    );
    expect(result).toBeNull();
  });
});
