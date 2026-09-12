import { describe, expect, it, vi } from "vitest";
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import {
  estimateHybridBenefitMonthlySavings,
  estimateLinuxByolMonthlySavings,
} from "@/lib/azure/retailPrices";

function vmResource(vmSize: string): ResourceGraphRow {
  return {
    id: "/subscriptions/sub-1/vm-1",
    type: "microsoft.compute/virtualmachines",
    subscriptionId: "sub-1",
    location: "eastus",
    properties: { hardwareProfile: { vmSize } },
  };
}

function priceResponse(price: number) {
  return {
    ok: true,
    json: async () => ({
      Items: [
        {
          retailPrice: price,
          unitOfMeasure: "1/Month",
          meterName: "D2 v2",
          skuName: "D2_v2",
          productName: "Virtual Machines Dv2 Series",
          armRegionName: "eastus",
          type: "Consumption",
        },
      ],
    }),
  };
}

function emptyResponse() {
  return { ok: true, json: async () => ({ Items: [] }) };
}

describe("estimateHybridBenefitMonthlySavings", () => {
  // The Linux/base-price query's own filter contains the literal substring
  // "not contains(productName, 'Windows')", so mocks must key off "Linux"
  // (unique to that query) rather than "Windows" (present in both URLs).
  it("returns the Windows-vs-Linux retail price delta when both are found", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes("Linux")) return Promise.resolve(priceResponse(60));
      return Promise.resolve(priceResponse(100));
    });
    vi.stubGlobal("fetch", fetchMock);

    const savings = await estimateHybridBenefitMonthlySavings(vmResource("Standard_D2_v2"));

    expect(savings).toBe(40);
  });

  it("falls back to a 40% approximation of the Linux price when the Windows price can't be found", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes("Linux")) return Promise.resolve(priceResponse(60));
      return Promise.resolve(emptyResponse());
    });
    vi.stubGlobal("fetch", fetchMock);

    const savings = await estimateHybridBenefitMonthlySavings(vmResource("Standard_D2_v2"));

    expect(savings).toBe(24);
  });

  it("returns 0 when the VM size is missing", async () => {
    const resource: ResourceGraphRow = {
      id: "/subscriptions/sub-1/vm-1",
      type: "microsoft.compute/virtualmachines",
      subscriptionId: "sub-1",
      properties: {},
    };

    const savings = await estimateHybridBenefitMonthlySavings(resource);

    expect(savings).toBe(0);
  });
});

describe("estimateLinuxByolMonthlySavings", () => {
  it("returns the distro-vs-base-Linux retail price delta when both are found", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes("Red%20Hat")) return Promise.resolve(priceResponse(90));
      return Promise.resolve(priceResponse(60));
    });
    vi.stubGlobal("fetch", fetchMock);

    const savings = await estimateLinuxByolMonthlySavings(vmResource("Standard_D2_v2"), "RedHat");

    expect(savings).toBe(30);
  });

  it("falls back to a 25% approximation of the base Linux price when the distro price can't be found", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes("SUSE")) return Promise.resolve(emptyResponse());
      return Promise.resolve(priceResponse(60));
    });
    vi.stubGlobal("fetch", fetchMock);

    const savings = await estimateLinuxByolMonthlySavings(vmResource("Standard_D2_v2"), "SUSE");

    expect(savings).toBe(15);
  });

  it("returns 0 when the VM size is missing", async () => {
    const resource: ResourceGraphRow = {
      id: "/subscriptions/sub-1/vm-1",
      type: "microsoft.compute/virtualmachines",
      subscriptionId: "sub-1",
      properties: {},
    };

    const savings = await estimateLinuxByolMonthlySavings(resource, "RedHat");

    expect(savings).toBe(0);
  });
});
