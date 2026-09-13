import { armFetch } from "@/lib/azure/armFetch";

interface MetricsResponse {
  value: {
    timeseries?: {
      data: { timeStamp: string; average?: number }[];
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
