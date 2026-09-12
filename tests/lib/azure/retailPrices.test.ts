import { afterEach, describe, expect, it, vi } from "vitest";
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import {
  estimateHybridBenefitMonthlySavings,
  estimateLinuxByolMonthlySavings,
} from "@/lib/azure/retailPrices";

afterEach(() => {
  vi.unstubAllGlobals();
});

function vmResource(vmSize: string): ResourceGraphRow {
  return {
    id: "/subscriptions/sub-1/vm-1",
    type: "microsoft.compute/virtualmachines",
    subscriptionId: "sub-1",
    location: "eastus",
    properties: { hardwareProfile: { vmSize } },
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

describe("estimateLinuxByolMonthlySavings", () => {
  it("returns a 25% approximation of the finding's resource cost", () => {
    expect(estimateLinuxByolMonthlySavings(100)).toBe(25);
  });

  it("returns 0 when the resource cost is 0", () => {
    expect(estimateLinuxByolMonthlySavings(0)).toBe(0);
  });
});
