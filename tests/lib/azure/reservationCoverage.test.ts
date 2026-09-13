import { afterEach, describe, expect, it, vi } from "vitest";
import * as armFetchModule from "@/lib/azure/armFetch";
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import {
  findReservationRecommendation,
  listReservationRecommendations,
  matchReservationRecommendation,
  estimateReservationCoverageMonthlySavings,
} from "@/lib/azure/reservationCoverage";

function vmssResource(vmSize: string, region: string): ResourceGraphRow {
  return {
    id: "/subscriptions/sub-1/vmss-1",
    type: "microsoft.compute/virtualmachinescalesets",
    subscriptionId: "sub-1",
    location: region,
    properties: { virtualMachineProfile: { hardwareProfile: { vmSize } } },
  };
}

describe("findReservationRecommendation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the recommendation matching the SKU and region with a positive recommended quantity", async () => {
    vi.spyOn(armFetchModule, "armFetch").mockResolvedValue({
      value: [
        {
          properties: {
            skuName: "Standard_D2s_v5",
            location: "eastus",
            recommendedQuantity: 3,
            netSavings: 120,
          },
        },
      ],
    });

    const rec = await findReservationRecommendation("sub-1", "Standard_D2s_v5", "eastus");

    expect(rec?.properties?.netSavings).toBe(120);
  });

  it("returns undefined when no recommendation matches the SKU/region", async () => {
    vi.spyOn(armFetchModule, "armFetch").mockResolvedValue({
      value: [
        { properties: { skuName: "Standard_D4s_v5", location: "eastus", recommendedQuantity: 1 } },
      ],
    });

    const rec = await findReservationRecommendation("sub-1", "Standard_D2s_v5", "eastus");

    expect(rec).toBeUndefined();
  });

  it("ignores a recommendation with recommendedQuantity of 0", async () => {
    vi.spyOn(armFetchModule, "armFetch").mockResolvedValue({
      value: [
        {
          properties: {
            skuName: "Standard_D2s_v5",
            location: "eastus",
            recommendedQuantity: 0,
          },
        },
      ],
    });

    const rec = await findReservationRecommendation("sub-1", "Standard_D2s_v5", "eastus");

    expect(rec).toBeUndefined();
  });
});

describe("estimateReservationCoverageMonthlySavings", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns null unconditionally, since the savings unit/scale is unverified, and makes no network call", async () => {
    const armFetchSpy = vi.spyOn(armFetchModule, "armFetch");

    const savings = await estimateReservationCoverageMonthlySavings(
      "sub-1",
      vmssResource("Standard_D2s_v5", "eastus"),
    );

    expect(savings).toBeNull();
    expect(armFetchSpy).not.toHaveBeenCalled();
  });

  it("returns null when the resource is undefined", async () => {
    const savings = await estimateReservationCoverageMonthlySavings("sub-1", undefined);

    expect(savings).toBeNull();
  });
});

describe("listReservationRecommendations", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("follows nextLink until exhausted, aggregating every page", async () => {
    const armFetchSpy = vi
      .spyOn(armFetchModule, "armFetch")
      .mockResolvedValueOnce({
        value: [{ properties: { skuName: "Standard_D2s_v5", location: "eastus", recommendedQuantity: 1 } }],
        nextLink: "https://management.azure.com/next-page",
      })
      .mockResolvedValueOnce({
        value: [{ properties: { skuName: "Standard_D4s_v5", location: "eastus", recommendedQuantity: 2 } }],
      });

    const recommendations = await listReservationRecommendations("sub-1");

    expect(recommendations).toHaveLength(2);
    expect(armFetchSpy).toHaveBeenCalledTimes(2);
  });
});

describe("matchReservationRecommendation", () => {
  it("returns the recommendation matching the SKU and region with a positive recommended quantity", () => {
    const recommendations = [
      { properties: { skuName: "Standard_D2s_v5", location: "eastus", recommendedQuantity: 3, netSavings: 120 } },
    ];

    const rec = matchReservationRecommendation(recommendations, "Standard_D2s_v5", "eastus");

    expect(rec?.properties?.netSavings).toBe(120);
  });

  it("returns undefined when no recommendation matches the SKU/region", () => {
    const recommendations = [
      { properties: { skuName: "Standard_D4s_v5", location: "eastus", recommendedQuantity: 1 } },
    ];

    expect(matchReservationRecommendation(recommendations, "Standard_D2s_v5", "eastus")).toBeUndefined();
  });

  it("ignores a recommendation with recommendedQuantity of 0", () => {
    const recommendations = [
      { properties: { skuName: "Standard_D2s_v5", location: "eastus", recommendedQuantity: 0 } },
    ];

    expect(matchReservationRecommendation(recommendations, "Standard_D2s_v5", "eastus")).toBeUndefined();
  });
});
