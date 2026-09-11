import { describe, expect, it } from "vitest";
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import { findIdleVpnGateways } from "@/lib/waste-rules/idleVpnGateways";

describe("findIdleVpnGateways", () => {
  it("returns a gateway with no referencing connection", () => {
    const gateway: ResourceGraphRow = {
      id: "/subscriptions/sub-1/.../vpnGateways/gw-idle",
      type: "microsoft.network/vpngateways",
      subscriptionId: "sub-1",
      properties: {},
    };

    expect(findIdleVpnGateways([gateway])).toEqual([
      { ruleType: "IDLE_VPN_GATEWAY", resourceId: gateway.id, subscriptionId: "sub-1" },
    ]);
  });

  it("ignores a gateway referenced by a connection, case-insensitively", () => {
    const gateway: ResourceGraphRow = {
      id: "/subscriptions/sub-1/.../vpnGateways/gw-active",
      type: "microsoft.network/virtualnetworkgateways",
      subscriptionId: "sub-1",
      properties: {},
    };
    const connection: ResourceGraphRow = {
      id: "conn-1",
      type: "microsoft.network/connections",
      subscriptionId: "sub-1",
      properties: {
        virtualNetworkGateway1: { id: gateway.id.toUpperCase() },
      },
    };

    expect(findIdleVpnGateways([gateway, connection])).toEqual([]);
  });
});
