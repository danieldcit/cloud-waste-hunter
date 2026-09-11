import { armFetch } from "@/lib/azure/armFetch";

interface CostQueryResponse {
  properties: {
    columns: { name: string }[];
    rows: (string | number)[][];
  };
}

export async function estimateMonthlyCost(
  subscriptionId: string,
  resourceId: string,
): Promise<number> {
  const url = `https://management.azure.com/subscriptions/${subscriptionId}/providers/Microsoft.CostManagement/query?api-version=2023-11-01`;

  const response = await armFetch<CostQueryResponse>(url, {
    method: "POST",
    body: JSON.stringify({
      type: "ActualCost",
      timeframe: "TheLastMonth",
      dataset: {
        granularity: "None",
        aggregation: { totalCost: { name: "Cost", function: "Sum" } },
        filter: {
          dimensions: { name: "ResourceId", operator: "In", values: [resourceId] },
        },
      },
    }),
  });

  const costColumnIndex = response.properties.columns.findIndex((c) => c.name === "Cost");
  if (costColumnIndex === -1 || response.properties.rows.length === 0) {
    return 0;
  }
  return Number(response.properties.rows[0][costColumnIndex]) || 0;
}
