import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import type { WasteFindingCandidate } from "@/lib/waste-rules/types";

const GATEWAY_TYPES = new Set([
  "microsoft.network/vpngateways",
  "microsoft.network/virtualnetworkgateways",
]);

function referencesGateway(connection: ResourceGraphRow, gatewayId: string): boolean {
  const gw1 = connection.properties.virtualNetworkGateway1 as { id?: string } | undefined;
  const gw2 = connection.properties.virtualNetworkGateway2 as { id?: string } | undefined;
  const normalizedGatewayId = gatewayId.toLowerCase();
  return (
    gw1?.id?.toLowerCase() === normalizedGatewayId ||
    gw2?.id?.toLowerCase() === normalizedGatewayId
  );
}

export function findIdleVpnGateways(
  resources: ResourceGraphRow[],
): WasteFindingCandidate[] {
  const gateways = resources.filter((r) => GATEWAY_TYPES.has(r.type.toLowerCase()));
  const connections = resources.filter(
    (r) => r.type.toLowerCase() === "microsoft.network/connections",
  );

  return gateways
    .filter(
      (gateway) => !connections.some((connection) => referencesGateway(connection, gateway.id)),
    )
    .map((gateway) => ({
      ruleType: "IDLE_VPN_GATEWAY",
      resourceId: gateway.id,
      subscriptionId: gateway.subscriptionId,
    }));
}
