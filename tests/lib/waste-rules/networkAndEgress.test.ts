import { describe, expect, it } from "vitest";
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import {
  findExcessiveEgress,
  findIdleAzureFirewalls,
} from "@/lib/waste-rules/networkAndEgress";

function row(id: string, type: string, properties: Record<string, unknown>): ResourceGraphRow {
  return { id, type, subscriptionId: "sub-1", properties };
}

describe("networkAndEgress", () => {
  it("flags an idle Azure Firewall with no IP configuration and no policy", () => {
    const result = findIdleAzureFirewalls([
      row("/subscriptions/sub-1/fw-idle", "microsoft.network/azurefirewalls", {
        ipConfigurations: [],
      }),
    ]);

    expect(result).toEqual([
      {
        ruleType: "NETWORK_FIREWALL_IDLE",
        resourceId: "/subscriptions/sub-1/fw-idle",
        subscriptionId: "sub-1",
        savingsCategory: "POTENTIAL_SAVING",
      },
    ]);
  });

  it("ignores an Azure Firewall with active configuration", () => {
    const result = findIdleAzureFirewalls([
      row("/subscriptions/sub-1/fw-live", "microsoft.network/azurefirewalls", {
        ipConfigurations: [{ id: "ip-1" }],
      }),
    ]);

    expect(result).toEqual([]);
  });

  it("flags a NAT gateway with long idle timeout and public IPs", () => {
    const result = findExcessiveEgress([
      row("/subscriptions/sub-1/nat-gw", "microsoft.network/natgateways", {
        idleTimeoutInMinutes: 30,
        publicIpAddresses: [{ id: "pip-1" }],
      }),
    ]);

    expect(result).toEqual([
      {
        ruleType: "EGRESS_TRANSFER_EXCESSIVE",
        resourceId: "/subscriptions/sub-1/nat-gw",
        subscriptionId: "sub-1",
        savingsCategory: "POTENTIAL_SAVING",
        metricObserved: 30,
      },
    ]);
  });
});
