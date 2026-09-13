import { afterEach, describe, expect, it, vi } from "vitest";
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import {
  estimateHybridBenefitMonthlySavings,
  estimateLinuxByolMonthlySavings,
  estimateRetailMonthlyCost,
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
});
