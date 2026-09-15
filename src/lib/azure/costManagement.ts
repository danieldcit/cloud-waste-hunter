import { armFetch } from "@/lib/azure/armFetch";

interface CostQueryResponse {
  properties: {
    columns: { name: string }[];
    rows: (string | number)[][];
  };
}

const COST_LOOKBACK_DAYS = 30;
const MAX_COST_QUERY_RETRIES = 3;

function costLookbackPeriod(now = new Date()): {
  from: string;
  to: string;
} {
  const from = new Date(now.getTime() - COST_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  return { from: from.toISOString(), to: now.toISOString() };
}

export async function estimateMonthlyCost(
  subscriptionId: string,
  resourceId: string,
): Promise<number> {
  const url = `https://management.azure.com/subscriptions/${subscriptionId}/providers/Microsoft.CostManagement/query?api-version=2023-11-01`;
  const timePeriod = costLookbackPeriod();
  const body = {
    type: "ActualCost",
    timeframe: "Custom",
    timePeriod,
    dataset: {
      granularity: "None",
      aggregation: { totalCost: { name: "Cost", function: "Sum" } },
      filter: {
        dimensions: { name: "ResourceId", operator: "In", values: [resourceId] },
      },
    },
  };

  let response: CostQueryResponse | undefined;
  for (let attempt = 0; attempt < MAX_COST_QUERY_RETRIES; attempt += 1) {
    try {
      response = await armFetch<CostQueryResponse>(url, {
        method: "POST",
        body: JSON.stringify(body),
      });
      break;
    } catch (error) {
      if (attempt === MAX_COST_QUERY_RETRIES - 1 || !String(error).includes(" 429:")) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
    }
  }

  if (!response) {
    throw new Error(`Cost query returned no response for resource ${resourceId}`);
  }

  const costColumnIndex = response.properties.columns.findIndex(
    (c) => c.name === "Cost",
  );
  if (costColumnIndex === -1 || response.properties.rows.length === 0) {
    return 0;
  }
  return Number(response.properties.rows[0][costColumnIndex]) || 0;
}
