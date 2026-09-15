import { armFetch } from "@/lib/azure/armFetch";

const MAX_COST_QUERY_RETRIES = 3;

interface CostQueryResponse {
  properties: {
    columns: { name: string }[];
    rows: (string | number)[][];
  };
}

async function costFetch<T>(url: string, init: RequestInit): Promise<T> {
  for (let attempt = 0; attempt < MAX_COST_QUERY_RETRIES; attempt += 1) {
    try {
      return await armFetch<T>(url, init);
    } catch (error) {
      if (attempt === MAX_COST_QUERY_RETRIES - 1 || !String(error).includes(" 429:")) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
    }
  }
  throw new Error(`Cost query returned no response for ${url}`);
}

function monthToDatePeriod(now = new Date()): { from: string; to: string } {
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return { from: from.toISOString(), to: now.toISOString() };
}

export interface DailyCost {
  date: string;
  cost: number;
}

function extractTotalCost(response: CostQueryResponse): number {
  const costIndex = response.properties.columns.findIndex((c) => c.name === "Cost");
  if (costIndex === -1 || response.properties.rows.length === 0) {
    return 0;
  }
  return Number(response.properties.rows[0][costIndex]) || 0;
}

export async function getSubscriptionMonthToDateSpend(
  azureSubscriptionId: string,
): Promise<number> {
  const url = `https://management.azure.com/subscriptions/${azureSubscriptionId}/providers/Microsoft.CostManagement/query?api-version=2023-11-01`;
  const response = await costFetch<CostQueryResponse>(url, {
    method: "POST",
    body: JSON.stringify({
      type: "ActualCost",
      timeframe: "Custom",
      timePeriod: monthToDatePeriod(),
      dataset: {
        granularity: "None",
        aggregation: { totalCost: { name: "Cost", function: "Sum" } },
      },
    }),
  });
  return extractTotalCost(response);
}

export async function getSubscriptionForecast(
  azureSubscriptionId: string,
): Promise<number> {
  const url = `https://management.azure.com/subscriptions/${azureSubscriptionId}/providers/Microsoft.CostManagement/forecast?api-version=2023-11-01`;
  const response = await costFetch<CostQueryResponse>(url, {
    method: "POST",
    body: JSON.stringify({
      type: "ActualCost",
      timeframe: "MonthToDate",
      includeActualCost: true,
      dataset: {
        granularity: "Daily",
        aggregation: { totalCost: { name: "Cost", function: "Sum" } },
      },
    }),
  });
  const costIndex = response.properties.columns.findIndex((c) => c.name === "Cost");
  if (costIndex === -1) {
    return 0;
  }
  return response.properties.rows.reduce(
    (sum, row) => sum + (Number(row[costIndex]) || 0),
    0,
  );
}

export async function getSubscriptionDailyCostTrend(
  azureSubscriptionId: string,
  days = 30,
  now: Date = new Date(),
): Promise<DailyCost[]> {
  const from = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const url = `https://management.azure.com/subscriptions/${azureSubscriptionId}/providers/Microsoft.CostManagement/query?api-version=2023-11-01`;
  const response = await costFetch<CostQueryResponse>(url, {
    method: "POST",
    body: JSON.stringify({
      type: "ActualCost",
      timeframe: "Custom",
      timePeriod: { from: from.toISOString(), to: now.toISOString() },
      dataset: {
        granularity: "Daily",
        aggregation: { totalCost: { name: "Cost", function: "Sum" } },
      },
    }),
  });

  const costIndex = response.properties.columns.findIndex((c) => c.name === "Cost");
  const dateIndex = response.properties.columns.findIndex((c) => c.name === "UsageDate");
  if (costIndex === -1 || dateIndex === -1) {
    return [];
  }
  return response.properties.rows
    .map((row) => ({
      date: String(row[dateIndex]),
      cost: Number(row[costIndex]) || 0,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}
