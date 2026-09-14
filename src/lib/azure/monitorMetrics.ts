import { armFetch } from "@/lib/azure/armFetch";

interface MetricsResponse {
  value: {
    timeseries?: {
      data: { timeStamp: string; average?: number; maximum?: number }[];
    }[];
  }[];
}

export async function getAverageCpuPercent(
  resourceId: string,
  days = 30,
  now: Date = new Date(),
): Promise<number> {
  const start = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const timespan = `${start.toISOString()}/${now.toISOString()}`;
  const url =
    `https://management.azure.com${resourceId}/providers/Microsoft.Insights/metrics` +
    `?api-version=2018-01-01&metricnames=${encodeURIComponent("Percentage CPU")}` +
    `&aggregation=Average&interval=P1D&timespan=${encodeURIComponent(timespan)}`;

  const response = await armFetch<MetricsResponse>(url);

  const points = response.value[0]?.timeseries?.[0]?.data ?? [];
  const values = points
    .map((p) => p.average)
    .filter((v): v is number => typeof v === "number");

  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

export async function getHourlyCpuBelowThreshold(
  resourceId: string,
  thresholdPercent: number,
  days = 30,
  now: Date = new Date(),
): Promise<number> {
  const start = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const timespan = `${start.toISOString()}/${now.toISOString()}`;
  const url =
    `https://management.azure.com${resourceId}/providers/Microsoft.Insights/metrics` +
    `?api-version=2018-01-01&metricnames=${encodeURIComponent("Percentage CPU")}` +
    `&aggregation=Average&interval=PT1H&timespan=${encodeURIComponent(timespan)}`;

  const response = await armFetch<MetricsResponse>(url);

  const points = response.value[0]?.timeseries?.[0]?.data ?? [];
  const values = points
    .map((p) => p.average)
    .filter((v): v is number => typeof v === "number");

  if (values.length === 0) {
    return 0;
  }
  const belowThreshold = values.filter((v) => v < thresholdPercent).length;
  return belowThreshold / values.length;
}

/**
 * Generalization of the former private `getAverageMetric` to accept the aggregation type —
 * Azure Monitor's response puts the requested aggregation's value under a matching field name
 * (`average` for `aggregation=Average`, `maximum` for `aggregation=Maximum`, confirmed live
 * against a real VM's Percentage CPU metric on 2026-09-14). `getAverageMetric` callers now call
 * this with `"Average"`.
 */
async function getMetricStatistic(
  resourceId: string,
  metricName: string,
  aggregation: "Average" | "Maximum",
  days: number,
  now: Date,
): Promise<number | null> {
  const start = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const timespan = `${start.toISOString()}/${now.toISOString()}`;
  const url =
    `https://management.azure.com${resourceId}/providers/Microsoft.Insights/metrics` +
    `?api-version=2018-01-01&metricnames=${encodeURIComponent(metricName)}` +
    `&aggregation=${aggregation}&interval=P1D&timespan=${encodeURIComponent(timespan)}`;

  const response = await armFetch<MetricsResponse>(url);
  const points = response.value[0]?.timeseries?.[0]?.data ?? [];
  const field = aggregation === "Average" ? "average" : "maximum";
  const values = points
    .map((p) => p[field])
    .filter((v): v is number => typeof v === "number");

  if (values.length === 0) {
    return null;
  }
  return aggregation === "Average"
    ? values.reduce((sum, v) => sum + v, 0) / values.length
    : Math.max(...values);
}

async function getAverageMetric(
  resourceId: string,
  metricName: string,
  days: number,
  now: Date,
): Promise<number | null> {
  return getMetricStatistic(resourceId, metricName, "Average", days, now);
}

/**
 * Average disk IOPS (Read + Write combined) over the period, or `null` if Azure Monitor
 * returned no data points for either metric — distinguished from a genuine 0 IOPS observation,
 * since these are Preview metrics of uncertain per-disk/per-region availability (see Category 4
 * spec §1). Callers must not treat `null` as 0 — skip the disk instead of fabricating a finding
 * from absent data. Metric names confirmed live against a real disk on 2026-09-13 — lowercase
 * "sec", flagged "(Preview)" by Azure. Two separate metric calls (mirroring the single-metric
 * pattern already used by `getAverageCpuPercent`) rather than one call requesting both names, to
 * avoid needing to align two timeseries by index — summing each metric's own period average is
 * equivalent when both cover the same timespan/interval.
 */
export async function getAverageDiskIops(
  resourceId: string,
  days = 30,
  now: Date = new Date(),
): Promise<number | null> {
  const [readIops, writeIops] = await Promise.all([
    getAverageMetric(resourceId, "Composite Disk Read Operations/sec", days, now),
    getAverageMetric(resourceId, "Composite Disk Write Operations/sec", days, now),
  ]);
  if (readIops === null && writeIops === null) {
    return null;
  }
  return (readIops ?? 0) + (writeIops ?? 0);
}

export async function getMaxCpuPercent(
  resourceId: string,
  days = 30,
  now: Date = new Date(),
): Promise<number | null> {
  return getMetricStatistic(resourceId, "Percentage CPU", "Maximum", days, now);
}

export async function getMaxDiskIops(
  resourceId: string,
  days = 30,
  now: Date = new Date(),
): Promise<number | null> {
  const [read, write] = await Promise.all([
    getMetricStatistic(resourceId, "Composite Disk Read Operations/sec", "Maximum", days, now),
    getMetricStatistic(resourceId, "Composite Disk Write Operations/sec", "Maximum", days, now),
  ]);
  if (read === null && write === null) {
    return null;
  }
  return (read ?? 0) + (write ?? 0);
}
