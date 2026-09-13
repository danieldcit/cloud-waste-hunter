import { afterEach, describe, expect, it, vi } from "vitest";
import * as armFetchModule from "@/lib/azure/armFetch";
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import {
  findReservationRecommendation,
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

  it("returns null even when a match is found, since the savings unit/scale is unverified", async () => {
    vi.spyOn(armFetchModule, "armFetch").mockResolvedValue({
      value: [
        {
          properties: {
            skuName: "Standard_D2s_v5",
            location: "eastus",
            recommendedQuantity: 2,
            netSavings: 80,
          },
        },
      ],
    });

    const savings = await estimateReservationCoverageMonthlySavings(
      "sub-1",
      vmssResource("Standard_D2s_v5", "eastus"),
    );

    expect(savings).toBeNull();
  });

  it("returns null when the resource is undefined", async () => {
    const savings = await estimateReservationCoverageMonthlySavings("sub-1", undefined);

    expect(savings).toBeNull();
  });

  it("returns null when the API call throws", async () => {
    vi.spyOn(armFetchModule, "armFetch").mockRejectedValue(new Error("throttled"));

    const savings = await estimateReservationCoverageMonthlySavings(
      "sub-1",
      vmssResource("Standard_D2s_v5", "eastus"),
    );

    expect(savings).toBeNull();
  });
});
