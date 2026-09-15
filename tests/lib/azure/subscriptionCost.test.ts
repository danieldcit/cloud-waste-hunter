import { beforeEach, describe, expect, it, vi } from "vitest";
import * as armFetchModule from "@/lib/azure/armFetch";
import {
  getSubscriptionMonthToDateSpend,
  getSubscriptionForecast,
  getSubscriptionDailyCostTrend,
} from "@/lib/azure/subscriptionCost";

describe("getSubscriptionMonthToDateSpend", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the Cost column total with no resource filter", async () => {
    const spy = vi.spyOn(armFetchModule, "armFetch").mockResolvedValue({
      properties: { columns: [{ name: "Cost" }], rows: [[123.45]] },
    });

    const result = await getSubscriptionMonthToDateSpend("sub-1");

    expect(result).toBe(123.45);
    const [url, init] = spy.mock.calls[0];
    expect(url).toContain("/subscriptions/sub-1/providers/Microsoft.CostManagement/query");
    const body = JSON.parse(init!.body as string);
    expect(body.timeframe).toBe("Custom");
    expect(body.timePeriod.from).toEqual(expect.any(String));
    expect(body.timePeriod.to).toEqual(expect.any(String));
    expect(body.dataset.filter).toBeUndefined();
  });

  it("returns 0 when there are no rows", async () => {
    vi.spyOn(armFetchModule, "armFetch").mockResolvedValue({
      properties: { columns: [{ name: "Cost" }], rows: [] },
    });

    expect(await getSubscriptionMonthToDateSpend("sub-1")).toBe(0);
  });
});

describe("getSubscriptionForecast", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("calls the Forecast endpoint and returns the Cost total", async () => {
    const spy = vi.spyOn(armFetchModule, "armFetch").mockResolvedValue({
      properties: { columns: [{ name: "Cost" }], rows: [[999]] },
    });

    const result = await getSubscriptionForecast("sub-1");

    expect(result).toBe(999);
    const [url] = spy.mock.calls[0];
    expect(url).toContain("/subscriptions/sub-1/providers/Microsoft.CostManagement/forecast");
  });

  it("sums the Cost column across multiple forecast rows instead of only reading the first row", async () => {
    const spy = vi.spyOn(armFetchModule, "armFetch").mockResolvedValue({
      properties: {
        columns: [{ name: "Cost" }],
        rows: [[100], [150], [250]],
      },
    });

    const result = await getSubscriptionForecast("sub-1");

    expect(result).toBe(500);
    const [, init] = spy.mock.calls[0];
    const body = JSON.parse(init!.body as string);
    expect(body.includeActualCost).toBe(true);
    expect(body.dataset.granularity).toBe("Daily");
  });

  it("returns 0 when there are no rows", async () => {
    vi.spyOn(armFetchModule, "armFetch").mockResolvedValue({
      properties: { columns: [{ name: "Cost" }], rows: [] },
    });

    expect(await getSubscriptionForecast("sub-1")).toBe(0);
  });
});

describe("getSubscriptionDailyCostTrend", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("maps Cost/UsageDate columns into a date-ordered array", async () => {
    const spy = vi.spyOn(armFetchModule, "armFetch").mockResolvedValue({
      properties: {
        columns: [{ name: "Cost" }, { name: "UsageDate" }],
        rows: [
          [10, 20260901],
          [15, 20260902],
        ],
      },
    });

    const now = new Date("2026-09-11T00:00:00Z");
    const result = await getSubscriptionDailyCostTrend("sub-1", 30, now);

    expect(result).toEqual([
      { date: "20260901", cost: 10 },
      { date: "20260902", cost: 15 },
    ]);
    const [, init] = spy.mock.calls[0];
    const body = JSON.parse(init!.body as string);
    expect(body.timeframe).toBe("Custom");
    expect(body.dataset.granularity).toBe("Daily");
  });

  it("returns an empty array when the expected columns are missing", async () => {
    vi.spyOn(armFetchModule, "armFetch").mockResolvedValue({
      properties: { columns: [{ name: "Cost" }], rows: [[10]] },
    });

    expect(await getSubscriptionDailyCostTrend("sub-1")).toEqual([]);
  });

  it("sorts out-of-order rows by date ascending before returning", async () => {
    vi.spyOn(armFetchModule, "armFetch").mockResolvedValue({
      properties: {
        columns: [{ name: "Cost" }, { name: "UsageDate" }],
        rows: [
          [15, 20260903],
          [10, 20260901],
          [12, 20260902],
        ],
      },
    });

    const now = new Date("2026-09-11T00:00:00Z");
    const result = await getSubscriptionDailyCostTrend("sub-1", 30, now);

    expect(result).toEqual([
      { date: "20260901", cost: 10 },
      { date: "20260902", cost: 12 },
      { date: "20260903", cost: 15 },
    ]);
  });
});
