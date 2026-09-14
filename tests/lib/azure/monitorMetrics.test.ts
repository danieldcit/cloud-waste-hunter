import { beforeEach, describe, expect, it, vi } from "vitest";
import * as armFetchModule from "@/lib/azure/armFetch";
import { getAverageCpuPercent, getHourlyCpuBelowThreshold, getAverageDiskIops, getMaxCpuPercent, getMaxDiskIops } from "@/lib/azure/monitorMetrics";

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

describe("getAverageDiskIops", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("sums the average Read and Write IOPS/sec metrics over the period", async () => {
    const spy = vi.spyOn(armFetchModule, "armFetch").mockImplementation(async (url: string) => {
      if (url.includes("Read%20Operations")) {
        return {
          value: [{ timeseries: [{ data: [{ timeStamp: "2026-09-01T00:00:00Z", average: 3 }] }] }],
        };
      }
      return {
        value: [{ timeseries: [{ data: [{ timeStamp: "2026-09-01T00:00:00Z", average: 2 }] }] }],
      };
    });

    const iops = await getAverageDiskIops("/subscriptions/sub-1/disks/disk-1");

    expect(iops).toBe(5);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("returns null when there are no data points for either metric", async () => {
    vi.spyOn(armFetchModule, "armFetch").mockResolvedValue({
      value: [{ timeseries: [{ data: [] }] }],
    });

    const iops = await getAverageDiskIops("/subscriptions/sub-1/disks/disk-1");

    expect(iops).toBeNull();
  });

  it("sums the real value with 0 when only one metric has data", async () => {
    vi.spyOn(armFetchModule, "armFetch").mockImplementation(async (url: string) => {
      if (url.includes("Read%20Operations")) {
        return {
          value: [{ timeseries: [{ data: [{ timeStamp: "2026-09-01T00:00:00Z", average: 4 }] }] }],
        };
      }
      return { value: [{ timeseries: [{ data: [] }] }] };
    });

    const iops = await getAverageDiskIops("/subscriptions/sub-1/disks/disk-1");

    expect(iops).toBe(4);
  });

  it("queries the exact lowercase metric names confirmed live against the real API", async () => {
    const spy = vi
      .spyOn(armFetchModule, "armFetch")
      .mockResolvedValue({ value: [{ timeseries: [{ data: [] }] }] });

    await getAverageDiskIops("/subscriptions/sub-1/disks/disk-1", 30);

    const readUrl = spy.mock.calls[0][0] as string;
    const writeUrl = spy.mock.calls[1][0] as string;
    expect(decodeURIComponent(readUrl)).toContain("Composite Disk Read Operations/sec");
    expect(decodeURIComponent(writeUrl)).toContain("Composite Disk Write Operations/sec");
    expect(readUrl).toContain("interval=P1D");
  });
});

describe("getMaxCpuPercent", () => {
  it("returns the maximum value across the daily data points", async () => {
    vi.spyOn(armFetchModule, "armFetch").mockResolvedValue({
      value: [{ timeseries: [{ data: [{ timeStamp: "t1", maximum: 4.1 }, { timeStamp: "t2", maximum: 99.22 }, { timeStamp: "t3", maximum: 3 }] }] }],
    });
    expect(await getMaxCpuPercent("/subscriptions/x/vm-1", 30)).toBe(99.22);
  });

  it("returns null when there are no data points (not zero)", async () => {
    vi.spyOn(armFetchModule, "armFetch").mockResolvedValue({ value: [{ timeseries: [{ data: [] }] }] });
    expect(await getMaxCpuPercent("/subscriptions/x/vm-1", 30)).toBeNull();
  });
});

describe("getMaxDiskIops", () => {
  it("sums the read and write maximums", async () => {
    const spy = vi.spyOn(armFetchModule, "armFetch");
    spy
      .mockResolvedValueOnce({ value: [{ timeseries: [{ data: [{ timeStamp: "t1", maximum: 500 }] }] }] })
      .mockResolvedValueOnce({ value: [{ timeseries: [{ data: [{ timeStamp: "t1", maximum: 300 }] }] }] });
    expect(await getMaxDiskIops("/subscriptions/x/disk-1", 30)).toBe(800);
  });

  it("returns null when both read and write have no data", async () => {
    const spy = vi.spyOn(armFetchModule, "armFetch");
    spy
      .mockResolvedValueOnce({ value: [{ timeseries: [{ data: [] }] }] })
      .mockResolvedValueOnce({ value: [{ timeseries: [{ data: [] }] }] });
    expect(await getMaxDiskIops("/subscriptions/x/disk-1", 30)).toBeNull();
  });

  it("treats one side having data and the other not as a real zero on the missing side, not null", async () => {
    const spy = vi.spyOn(armFetchModule, "armFetch");
    spy
      .mockResolvedValueOnce({ value: [{ timeseries: [{ data: [{ timeStamp: "t1", maximum: 500 }] }] }] })
      .mockResolvedValueOnce({ value: [{ timeseries: [{ data: [] }] }] });
    expect(await getMaxDiskIops("/subscriptions/x/disk-1", 30)).toBe(500);
  });
});
