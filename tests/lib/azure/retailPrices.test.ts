import { afterEach, describe, expect, it, vi } from "vitest";
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import {
  diskSkuMeterName,
  estimateHybridBenefitMonthlySavings,
  estimateLinuxByolMonthlySavings,
  estimatePremiumDiskDowngradeMonthlySavings,
  estimateRetailMonthlyCost,
  estimateVmSkuMonthlyCost,
  estimateVmssSpotMonthlySavings,
} from "@/lib/azure/retailPrices";

afterEach(() => {
  vi.unstubAllGlobals();
});

function vmResource(vmSize: string, osType?: "Windows" | "Linux"): ResourceGraphRow {
  return {
    id: "/subscriptions/sub-1/vm-1",
    type: "microsoft.compute/virtualmachines",
    subscriptionId: "sub-1",
    location: "eastus",
    properties: {
      hardwareProfile: { vmSize },
      ...(osType ? { storageProfile: { osDisk: { osType } } } : {}),
    },
  };
}

function diskResource(skuName: string, sizeGb: number): ResourceGraphRow {
  return {
    id: "/subscriptions/sub-1/disks/disk-1",
    type: "microsoft.compute/disks",
    subscriptionId: "sub-1",
    location: "eastus",
    sku: { name: skuName },
    properties: { diskSizeGB: sizeGb },
  };
}

interface PriceItemOverrides {
  retailPrice?: number;
  unitOfMeasure?: string;
  meterName?: string;
  skuName?: string;
  productName?: string;
  type?: string;
}

function priceItem(overrides: PriceItemOverrides = {}) {
  return {
    retailPrice: 1,
    unitOfMeasure: "1 Hour",
    meterName: "D2 v2",
    skuName: "D2 v2",
    productName: "Virtual Machines Dv2 Series",
    armRegionName: "eastus",
    type: "Consumption",
    ...overrides,
  };
}

function jsonResponse(items: unknown[]) {
  return { ok: true, json: async () => ({ Items: items }) };
}

describe("diskSkuMeterName", () => {
  // Azure's managed-disk tier numbering is sparse (1, 2, 3, 4, 6, 10, 15, 20, 30, 40, 50, 60,
  // 70, 80) — not sequential — verified live against the real Retail Prices API on 2026-09-13
  // (skuName values returned for Premium SSD / Standard SSD / Standard HDD Managed Disks).
  it.each([
    [4, "P1 LRS"],
    [8, "P2 LRS"],
    [16, "P3 LRS"],
    [32, "P4 LRS"],
    [64, "P6 LRS"],
    [128, "P10 LRS"],
    [256, "P15 LRS"],
    [512, "P20 LRS"],
    [1024, "P30 LRS"],
    [2048, "P40 LRS"],
    [4096, "P50 LRS"],
    [8192, "P60 LRS"],
    [16384, "P70 LRS"],
    [32767, "P80 LRS"],
  ])("maps a %i GiB Premium_LRS disk to %s", (sizeGb, expected) => {
    expect(diskSkuMeterName("Premium_LRS", sizeGb)).toBe(expected);
  });

  it("rounds a size between two Premium tiers up to the next tier (100 GiB -> P10, not P6)", () => {
    expect(diskSkuMeterName("Premium_LRS", 100)).toBe("P10 LRS");
  });

  it("uses the E prefix and the same ladder as Premium for StandardSSD_LRS", () => {
    expect(diskSkuMeterName("StandardSSD_LRS", 128)).toBe("E10 LRS");
    expect(diskSkuMeterName("StandardSSD_LRS", 2048)).toBe("E40 LRS");
  });

  it("uses ZRS redundancy when the SKU name ends in ZRS", () => {
    expect(diskSkuMeterName("Premium_ZRS", 128)).toBe("P10 ZRS");
  });

  it.each([
    [4, "S4 LRS"],
    [32, "S4 LRS"],
    [64, "S6 LRS"],
    [128, "S10 LRS"],
    [2048, "S40 LRS"],
    [32767, "S80 LRS"],
  ])(
    "maps a %i GiB Standard_LRS (HDD) disk to %s (S-tier ladder starts at S4, no S1/S2/S3)",
    (sizeGb, expected) => {
      expect(diskSkuMeterName("Standard_LRS", sizeGb)).toBe(expected);
    },
  );

  it("clamps a size larger than the largest published tier to P80", () => {
    expect(diskSkuMeterName("Premium_LRS", 65536)).toBe("P80 LRS");
  });
});

describe("estimateHybridBenefitMonthlySavings", () => {
  it("sends a single armSkuName-based query, never using the OData 'not' operator the live API rejects", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([]));
    vi.stubGlobal("fetch", fetchMock);

    await estimateHybridBenefitMonthlySavings(vmResource("Standard_D2_v2"), 100);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0] as [string];
    const decodedFilter = decodeURIComponent(url.split("$filter=")[1]);
    expect(decodedFilter).toContain("armSkuName eq 'Standard_D2_v2'");
    expect(decodedFilter).toContain("armRegionName eq 'eastus'");
    expect(decodedFilter).not.toMatch(/\bnot\b/);
  });

  it("returns the Windows-vs-base retail price delta from a single response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse([
          priceItem({ retailPrice: 0.146, productName: "Virtual Machines Dv2 Series" }),
          priceItem({ retailPrice: 0.238, productName: "Virtual Machines Dv2 Series Windows" }),
        ]),
      ),
    );

    const savings = await estimateHybridBenefitMonthlySavings(vmResource("Standard_D2_v2"), 999);

    expect(savings).toBeCloseTo((0.238 - 0.146) * 730, 5);
  });

  it("excludes Spot and Low Priority meters so they can't be mistaken for the standard price", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse([
          priceItem({
            retailPrice: 0.029,
            skuName: "D2 v2 Low Priority",
            productName: "Virtual Machines Dv2 Series",
          }),
          priceItem({
            retailPrice: 0.101,
            skuName: "D2 v2 Low Priority",
            productName: "Virtual Machines Dv2 Series Windows",
          }),
          priceItem({ retailPrice: 0.146, skuName: "D2 v2", productName: "Virtual Machines Dv2 Series" }),
          priceItem({
            retailPrice: 0.238,
            skuName: "D2 v2",
            productName: "Virtual Machines Dv2 Series Windows",
          }),
        ]),
      ),
    );

    const savings = await estimateHybridBenefitMonthlySavings(vmResource("Standard_D2_v2"), 999);

    expect(savings).toBeCloseTo((0.238 - 0.146) * 730, 5);
  });

  it("excludes classic Cloud Services meters, which share the same armSkuName and lack 'Windows' in their product name", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse([
          // Cloud Services is Windows-only-priced but its productName doesn't say "Windows" —
          // without exclusion this would be picked as the (wrong, too-expensive) "base" price.
          priceItem({ retailPrice: 5.696, productName: "Dasv5 Series Cloud Services" }),
          priceItem({ retailPrice: 2.752, productName: "Virtual Machines Dasv5 Series" }),
          priceItem({ retailPrice: 5.696, productName: "Virtual Machines Dasv5 Series Windows" }),
        ]),
      ),
    );

    const savings = await estimateHybridBenefitMonthlySavings(vmResource("Standard_D64as_v5"), 999);

    expect(savings).toBeCloseTo((5.696 - 2.752) * 730, 5);
  });

  it("falls back to a 40% approximation of the finding's own resource cost when no price is found", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse([])));

    const savings = await estimateHybridBenefitMonthlySavings(vmResource("Standard_D2_v2"), 100);

    expect(savings).toBe(40);
  });

  it("falls back without fetching when the VM size is missing", async () => {
    const resource: ResourceGraphRow = {
      id: "/subscriptions/sub-1/vm-1",
      type: "microsoft.compute/virtualmachines",
      subscriptionId: "sub-1",
      properties: {},
    };
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const savings = await estimateHybridBenefitMonthlySavings(resource, 100);

    expect(savings).toBe(40);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("estimateRetailMonthlyCost (VM path)", () => {
  it("prices a Windows VM at the Windows rate, not the cheaper base rate", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse([
          priceItem({ retailPrice: 0.146, productName: "Virtual Machines Dv2 Series" }),
          priceItem({ retailPrice: 0.238, productName: "Virtual Machines Dv2 Series Windows" }),
        ]),
      ),
    );

    const cost = await estimateRetailMonthlyCost(vmResource("Standard_D2_v2", "Windows"));

    expect(cost).toBeCloseTo(0.238 * 730, 5);
  });

  it("prices a non-Windows VM at the base rate", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse([
          priceItem({ retailPrice: 0.146, productName: "Virtual Machines Dv2 Series" }),
          priceItem({ retailPrice: 0.238, productName: "Virtual Machines Dv2 Series Windows" }),
        ]),
      ),
    );

    const cost = await estimateRetailMonthlyCost(vmResource("Standard_D2_v2", "Linux"));

    expect(cost).toBeCloseTo(0.146 * 730, 5);
  });

  it("excludes classic Cloud Services meters when pricing a non-Windows VM", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse([
          priceItem({ retailPrice: 5.696, productName: "Dasv5 Series Cloud Services" }),
          priceItem({ retailPrice: 2.752, productName: "Virtual Machines Dasv5 Series" }),
        ]),
      ),
    );

    const cost = await estimateRetailMonthlyCost(vmResource("Standard_D64as_v5", "Linux"));

    expect(cost).toBeCloseTo(2.752 * 730, 5);
  });
});

function vmssResource(vmSize: string, capacity: number, osType?: "Windows" | "Linux"): ResourceGraphRow {
  return {
    id: "/subscriptions/sub-1/vmss-1",
    type: "microsoft.compute/virtualmachinescalesets",
    subscriptionId: "sub-1",
    location: "eastus",
    sku: { name: vmSize, capacity },
    properties: {
      virtualMachineProfile: {
        hardwareProfile: { vmSize },
        ...(osType ? { storageProfile: { osDisk: { osType } } } : {}),
      },
    },
  };
}

describe("estimateRetailMonthlyCost (VMSS path)", () => {
  it("prices a VMSS at its per-instance rate times its instance capacity", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse([
          priceItem({ retailPrice: 0.146, productName: "Virtual Machines Dv2 Series" }),
        ]),
      ),
    );

    const cost = await estimateRetailMonthlyCost(vmssResource("Standard_D2_v2", 4, "Linux"));

    expect(cost).toBeCloseTo(0.146 * 730 * 4, 5);
  });

  it("prices a Windows VMSS at the Windows rate", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse([
          priceItem({ retailPrice: 0.146, productName: "Virtual Machines Dv2 Series" }),
          priceItem({ retailPrice: 0.238, productName: "Virtual Machines Dv2 Series Windows" }),
        ]),
      ),
    );

    const cost = await estimateRetailMonthlyCost(vmssResource("Standard_D2_v2", 2, "Windows"));

    expect(cost).toBeCloseTo(0.238 * 730 * 2, 5);
  });

  it("defaults capacity to 1 when sku.capacity is missing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse([priceItem({ retailPrice: 0.146, productName: "Virtual Machines Dv2 Series" })]),
      ),
    );
    const resource = vmssResource("Standard_D2_v2", 1, "Linux");
    resource.sku = { name: "Standard_D2_v2" };

    const cost = await estimateRetailMonthlyCost(resource);

    expect(cost).toBeCloseTo(0.146 * 730, 5);
  });
});

describe("estimateLinuxByolMonthlySavings", () => {
  it("returns a 25% approximation of the finding's resource cost", () => {
    expect(estimateLinuxByolMonthlySavings(100)).toBe(25);
  });

  it("returns 0 when the resource cost is 0", () => {
    expect(estimateLinuxByolMonthlySavings(0)).toBe(0);
  });
});

function spotAwarePriceItem(overrides: PriceItemOverrides & { armSkuName?: string } = {}) {
  return {
    ...priceItem(overrides),
    armSkuName: overrides.armSkuName ?? "Standard_D2_v2",
  };
}

describe("estimateVmssSpotMonthlySavings", () => {
  it("returns the exact Spot-vs-on-demand delta times capacity when both prices exist for the SKU", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse([
          spotAwarePriceItem({
            retailPrice: 0.146,
            skuName: "D2 v2",
            productName: "Virtual Machines Dv2 Series",
          }),
          spotAwarePriceItem({
            retailPrice: 0.03,
            skuName: "D2 v2 Spot",
            productName: "Virtual Machines Dv2 Series",
          }),
        ]),
      ),
    );

    const savings = await estimateVmssSpotMonthlySavings(vmssResource("Standard_D2_v2", 4, "Linux"));

    expect(savings).toBeCloseTo((0.146 - 0.03) * 730 * 4, 5);
  });

  it("falls back to the regional average Spot discount ratio when no exact Spot price exists for the SKU", async () => {
    const fetchMock = vi.fn();
    // First call: exact-SKU query, returns only the on-demand price (no Spot meter for this SKU).
    fetchMock.mockResolvedValueOnce(
      jsonResponse([
        spotAwarePriceItem({
          retailPrice: 0.2,
          skuName: "D4 v2",
          productName: "Virtual Machines Dv2 Series",
          armSkuName: "Standard_D4_v2",
        }),
      ]),
    );
    // Second call: region-wide query used to compute the average discount ratio.
    fetchMock.mockResolvedValueOnce(
      jsonResponse([
        spotAwarePriceItem({
          retailPrice: 0.1,
          skuName: "D2 v2",
          productName: "Virtual Machines Dv2 Series",
          armSkuName: "Standard_D2_v2",
        }),
        spotAwarePriceItem({
          retailPrice: 0.04,
          skuName: "D2 v2 Spot",
          productName: "Virtual Machines Dv2 Series",
          armSkuName: "Standard_D2_v2",
        }),
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const savings = await estimateVmssSpotMonthlySavings(vmssResource("Standard_D4_v2", 2, "Linux"));

    // ratio = 0.04/0.1 = 0.4 -> spot is 40% of on-demand -> savings = onDemand * (1 - 0.4)
    expect(savings).toBeCloseTo(0.2 * 730 * (1 - 0.4) * 2, 5);
  });

  it("returns null when the VM size can't be determined", async () => {
    const resource: ResourceGraphRow = {
      id: "/subscriptions/sub-1/vmss-1",
      type: "microsoft.compute/virtualmachinescalesets",
      subscriptionId: "sub-1",
      properties: {},
    };
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const savings = await estimateVmssSpotMonthlySavings(resource);

    expect(savings).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("aggregates every page of the region-wide Spot ratio query, not just page 1", async () => {
    const fetchMock = vi.fn();
    // Call 1: exact-SKU query for the target VMSS's own size — no Spot meter, forces fallback.
    fetchMock.mockResolvedValueOnce(
      jsonResponse([
        spotAwarePriceItem({
          retailPrice: 0.2,
          skuName: "D8 v2",
          productName: "Virtual Machines Dv2 Series",
          armSkuName: "Standard_D8_v2",
        }),
      ]),
    );
    // Call 2: page 1 of the region-wide ratio query — only the on-demand half of the pair.
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        Items: [
          spotAwarePriceItem({
            retailPrice: 0.2,
            skuName: "D4 v2",
            productName: "Virtual Machines Dv2 Series",
            armSkuName: "Standard_D4_v2",
          }),
        ],
        NextPageLink: "https://prices.azure.com/api/retail/prices?$skip=100",
      }),
    });
    // Call 3: page 2 — only the Spot half of the same pair. If NextPageLink isn't followed,
    // this half is silently lost and the ratio can never be computed.
    fetchMock.mockResolvedValueOnce(
      jsonResponse([
        spotAwarePriceItem({
          retailPrice: 0.1,
          skuName: "D4 v2 Spot",
          productName: "Virtual Machines Dv2 Series",
          armSkuName: "Standard_D4_v2",
        }),
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const savings = await estimateVmssSpotMonthlySavings(vmssResource("Standard_D8_v2", 1, "Linux"));

    // ratio = 0.1/0.2 = 0.5, only derivable if both pages were combined.
    expect(savings).toBeCloseTo(0.2 * 730 * (1 - 0.5), 5);
  });

  it("keeps a Windows and a Linux meter sharing an armSkuName as two independent ratios", async () => {
    const fetchMock = vi.fn();
    // Call 1: exact-SKU query for the target VMSS's own size — no Spot meter, forces fallback.
    fetchMock.mockResolvedValueOnce(
      jsonResponse([
        spotAwarePriceItem({
          retailPrice: 1.0,
          skuName: "D8 v2",
          productName: "Virtual Machines Dv2 Series",
          armSkuName: "Standard_D8_v2",
        }),
      ]),
    );
    // Call 2: region-wide ratio query. Windows and Linux meters for the SAME armSkuName
    // (Standard_D2_v2), with very different discount ratios (0.25 vs 0.5). A bare-armSkuName
    // key would let one OS's price silently overwrite the other's in the lookup maps.
    fetchMock.mockResolvedValueOnce(
      jsonResponse([
        spotAwarePriceItem({
          retailPrice: 0.4,
          skuName: "D2 v2",
          productName: "Virtual Machines Dv2 Series Windows",
          armSkuName: "Standard_D2_v2",
        }),
        spotAwarePriceItem({
          retailPrice: 0.1,
          skuName: "D2 v2 Spot",
          productName: "Virtual Machines Dv2 Series Windows",
          armSkuName: "Standard_D2_v2",
        }),
        spotAwarePriceItem({
          retailPrice: 0.1,
          skuName: "D2 v2",
          productName: "Virtual Machines Dv2 Series",
          armSkuName: "Standard_D2_v2",
        }),
        spotAwarePriceItem({
          retailPrice: 0.05,
          skuName: "D2 v2 Spot",
          productName: "Virtual Machines Dv2 Series",
          armSkuName: "Standard_D2_v2",
        }),
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const savings = await estimateVmssSpotMonthlySavings(vmssResource("Standard_D8_v2", 1, "Linux"));

    // Correct: average of the two independent ratios, Windows (0.1/0.4 = 0.25) and
    // Linux (0.05/0.1 = 0.5) -> 0.375. A colliding bare-armSkuName key would instead
    // overwrite down to a single (wrong) ratio of 0.5.
    expect(savings).toBeCloseTo(1.0 * 730 * (1 - 0.375), 5);
  });
});

describe("estimatePremiumDiskDowngradeMonthlySavings", () => {
  it("returns the monthly delta between the Premium price and the Standard SSD equivalent", async () => {
    // 128 GiB is real Azure tier P10/E10 (verified live) — P6/E6 is 64 GiB.
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      const decoded = decodeURIComponent(url);
      if (decoded.includes("skuName eq 'P10 LRS'")) {
        return jsonResponse([
          priceItem({
            retailPrice: 0.283,
            meterName: "P10 LRS Disk",
            productName: "Premium SSD Managed Disks",
          }),
        ]);
      }
      if (decoded.includes("skuName eq 'E10 LRS'")) {
        return jsonResponse([
          priceItem({
            retailPrice: 0.096,
            meterName: "E10 LRS Disk",
            productName: "Standard SSD Managed Disks",
          }),
        ]);
      }
      return jsonResponse([]);
    });
    vi.stubGlobal("fetch", fetchMock);

    const savings = await estimatePremiumDiskDowngradeMonthlySavings(
      diskResource("Premium_LRS", 128),
    );

    expect(savings).toBeCloseTo((0.283 - 0.096) * 730, 5);
  });

  it("prices a 2048 GiB Premium disk against P40, not the pre-fix bug's P10 (~16x underpricing)", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      const decoded = decodeURIComponent(url);
      if (decoded.includes("skuName eq 'P40 LRS'")) {
        return jsonResponse([
          priceItem({
            retailPrice: 4.522,
            meterName: "P40 LRS Disk",
            productName: "Premium SSD Managed Disks",
          }),
        ]);
      }
      if (decoded.includes("skuName eq 'E40 LRS'")) {
        return jsonResponse([
          priceItem({
            retailPrice: 1.161,
            meterName: "E40 LRS Disk",
            productName: "Standard SSD Managed Disks",
          }),
        ]);
      }
      // Pre-fix, a 2048 GiB disk was priced against "P10 LRS" — if that URL is ever hit again,
      // this branch's absence (falling through to []) makes the bug's return value 0 instead of
      // silently reappearing as a plausible-looking number.
      return jsonResponse([]);
    });
    vi.stubGlobal("fetch", fetchMock);

    const savings = await estimatePremiumDiskDowngradeMonthlySavings(
      diskResource("Premium_LRS", 2048),
    );

    expect(savings).toBeCloseTo((4.522 - 1.161) * 730, 5);
  });

  it("returns null when the delta is not positive", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse([priceItem({ retailPrice: 0.1 })])),
    );

    const savings = await estimatePremiumDiskDowngradeMonthlySavings(
      diskResource("Premium_LRS", 128),
    );

    expect(savings).toBeNull();
  });

  it("returns null when a price lookup throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network error")),
    );

    const savings = await estimatePremiumDiskDowngradeMonthlySavings(
      diskResource("Premium_LRS", 128),
    );

    expect(savings).toBeNull();
  });

  it("returns null immediately for UltraSSD_LRS without calling fetch (Ultra isn't tier-priced)", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const savings = await estimatePremiumDiskDowngradeMonthlySavings(
      diskResource("UltraSSD_LRS", 128),
    );

    expect(savings).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("estimateVmSkuMonthlyCost", () => {
  it("prices the Linux/base meter when wantsWindows is false", async () => {
    const mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        Items: [
          {
            retailPrice: 0.096,
            unitOfMeasure: "1 Hour",
            meterName: "D2s v3",
            skuName: "Standard_D2s_v3",
            productName: "Virtual Machines Dsv3 Series",
            armRegionName: "brazilsouth",
            armSkuName: "Standard_D2s_v3",
            type: "Consumption",
          },
        ],
      }),
    });
    const cost = await estimateVmSkuMonthlyCost("brazilsouth", "Standard_D2s_v3", false);
    expect(cost).toBeCloseTo(0.096 * 730, 2);
  });

  it("returns 0 when no matching meter is found", async () => {
    const mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ Items: [] }) });
    expect(await estimateVmSkuMonthlyCost("brazilsouth", "Standard_NoSuchSize", false)).toBe(0);
  });
});
