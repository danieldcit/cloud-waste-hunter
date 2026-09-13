import { beforeEach, describe, expect, it, vi } from "vitest";
import * as armFetchModule from "@/lib/azure/armFetch";
import { getAverageCpuPercent, getHourlyCpuBelowThreshold } from "@/lib/azure/monitorMetrics";

describe("getAverageCpuPercent", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("averages the returned daily data points", async () => {
    vi.spyOn(armFetchModule, "armFetch").mockResolvedValue({
      value: [
        {
          timeseries: [
            {
              data: [
                { timeStamp: "2026-08-01T00:00:00Z", average: 2 },
                { timeStamp: "2026-08-02T00:00:00Z", average: 8 },
              ],
            },
          ],
        },
      ],
    });

    const result = await getAverageCpuPercent("/subscriptions/sub-1/vm-1");

    expect(result).toBe(5);
  });

  it("returns 0 when there are no data points", async () => {
    vi.spyOn(armFetchModule, "armFetch").mockResolvedValue({
      value: [{ timeseries: [{ data: [] }] }],
    });

    const result = await getAverageCpuPercent("/subscriptions/sub-1/vm-1");

    expect(result).toBe(0);
  });

  it("queries Percentage CPU with Average aggregation over the requested window", async () => {
    const spy = vi
      .spyOn(armFetchModule, "armFetch")
      .mockResolvedValue({ value: [{ timeseries: [{ data: [] }] }] });

    const now = new Date("2026-09-11T00:00:00Z");
    await getAverageCpuPercent("/subscriptions/sub-1/vm-1", 30, now);

    const [url] = spy.mock.calls[0];
    expect(url).toContain("/subscriptions/sub-1/vm-1/providers/Microsoft.Insights/metrics");
    expect(url).toContain("metricnames=Percentage%20CPU");
    expect(url).toContain("aggregation=Average");
    expect(url).toContain(encodeURIComponent("2026-08-12T00:00:00.000Z"));
    expect(url).toContain(encodeURIComponent("2026-09-11T00:00:00.000Z"));
  });
});

describe("getHourlyCpuBelowThreshold", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the fraction of hourly samples below the threshold", async () => {
    vi.spyOn(armFetchModule, "armFetch").mockResolvedValue({
      value: [
        {
          timeseries: [
            {
              data: [
                { timeStamp: "2026-09-01T00:00:00Z", average: 2 },
                { timeStamp: "2026-09-01T01:00:00Z", average: 8 },
                { timeStamp: "2026-09-01T02:00:00Z", average: 3 },
                { timeStamp: "2026-09-01T03:00:00Z", average: 40 },
              ],
            },
          ],
        },
      ],
    });

    const fraction = await getHourlyCpuBelowThreshold("/subscriptions/sub-1/vmss-1", 5);

    expect(fraction).toBe(0.5);
  });

  it("returns 0 when there are no data points", async () => {
    vi.spyOn(armFetchModule, "armFetch").mockResolvedValue({
      value: [{ timeseries: [{ data: [] }] }],
    });

    const fraction = await getHourlyCpuBelowThreshold("/subscriptions/sub-1/vmss-1", 5);

    expect(fraction).toBe(0);
  });

  it("queries with PT1H interval instead of P1D", async () => {
    const spy = vi
      .spyOn(armFetchModule, "armFetch")
      .mockResolvedValue({ value: [{ timeseries: [{ data: [] }] }] });

    await getHourlyCpuBelowThreshold("/subscriptions/sub-1/vmss-1", 5, 30);

    const [url] = spy.mock.calls[0];
    expect(url).toContain("interval=PT1H");
    expect(url).toContain("metricnames=Percentage%20CPU");
  });
});
