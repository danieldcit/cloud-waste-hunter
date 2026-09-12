import { armFetch } from "@/lib/azure/armFetch";

export interface ResourceGraphRow {
  id: string;
  type: string;
  subscriptionId: string;
  location?: string;
  sku?: { name?: string; tier?: string } | null;
  properties: Record<string, unknown>;
  powerState?: string;
}

interface ResourceGraphResponse {
  data: ResourceGraphRow[];
  $skipToken?: string;
}

const RESOURCE_GRAPH_URL =
  "https://management.azure.com/providers/Microsoft.ResourceGraph/resources?api-version=2022-10-01";

export async function queryResourceGraph(
  subscriptionIds: string[],
  query: string,
): Promise<ResourceGraphRow[]> {
  const rows: ResourceGraphRow[] = [];
  let skipToken: string | undefined;

  do {
    const response = await armFetch<ResourceGraphResponse>(RESOURCE_GRAPH_URL, {
      method: "POST",
      body: JSON.stringify({
        subscriptions: subscriptionIds,
        query,
        options: skipToken ? { $skipToken: skipToken } : undefined,
      }),
    });
    rows.push(...response.data);
    skipToken = response.$skipToken;
  } while (skipToken);

  return rows;
}
