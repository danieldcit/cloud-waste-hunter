import { beforeEach, describe, expect, it, vi } from "vitest";
import * as armFetchModule from "@/lib/azure/armFetch";
import { estimateMonthlyCost } from "@/lib/azure/costManagement";

describe("estimateMonthlyCost", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the Cost column value from the query response", async () => {
    vi.spyOn(armFetchModule, "armFetch").mockResolvedValue({
      properties: {
        columns: [{ name: "Cost" }, { name: "Currency" }],
        rows: [[12.5, "USD"]],
      },
    });

    const cost = await estimateMonthlyCost("sub-1", "disk-1");

    expect(cost).toBe(12.5);
  });

  it("uses a custom 30-day period instead of the unsupported TheLastMonth timeframe", async () => {
    const armFetch = vi.spyOn(armFetchModule, "armFetch").mockResolvedValue({
      properties: {
        columns: [{ name: "Cost" }],
        rows: [[8.4]],
      },
    });

    await estimateMonthlyCost("sub-1", "app-service-1");

    const request = armFetch.mock.calls[0]?.[1];
    const body = JSON.parse(String(request?.body));
    expect(body.timeframe).toBe("Custom");
    expect(body.timePeriod.from).toEqual(expect.any(String));
    expect(body.timePeriod.to).toEqual(expect.any(String));
    expect(body.dataset.filter.dimensions.values).toEqual(["app-service-1"]);
  });

  it("retries throttled cost queries before failing", async () => {
    const armFetch = vi
      .spyOn(armFetchModule, "armFetch")
      .mockRejectedValueOnce(new Error("failed with 429: throttled"))
      .mockResolvedValueOnce({
        properties: { columns: [{ name: "Cost" }], rows: [[4.2]] },
      });

    await expect(estimateMonthlyCost("sub-1", "app-service-1")).resolves.toBe(4.2);
    expect(armFetch).toHaveBeenCalledTimes(2);
  });

  it("returns 0 when there are no rows", async () => {
    vi.spyOn(armFetchModule, "armFetch").mockResolvedValue({
      properties: { columns: [{ name: "Cost" }], rows: [] },
    });

    const cost = await estimateMonthlyCost("sub-1", "disk-1");

    expect(cost).toBe(0);
  });

  it("returns the correct cost when Cost column is not at index 0", async () => {
    vi.spyOn(armFetchModule, "armFetch").mockResolvedValue({
      properties: {
        columns: [{ name: "Currency" }, { name: "Cost" }],
        rows: [["USD", 7.25]],
      },
    });

    const cost = await estimateMonthlyCost("sub-1", "disk-1");

    expect(cost).toBe(7.25);
  });

  it("returns 0 when Cost column is missing entirely", async () => {
    vi.spyOn(armFetchModule, "armFetch").mockResolvedValue({
      properties: { columns: [{ name: "Currency" }], rows: [["USD"]] },
    });

    const cost = await estimateMonthlyCost("sub-1", "disk-1");

    expect(cost).toBe(0);
  });
});
