import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import type { WasteFindingCandidate } from "@/lib/waste-rules/types";

export function findIdleAzureFirewalls(
  resources: ResourceGraphRow[],
): WasteFindingCandidate[] {
  return resources
    .filter((resource) => resource.type.toLowerCase() === "microsoft.network/azurefirewalls")
    .filter((resource) => {
      const ipConfigurations = Array.isArray(resource.properties.ipConfigurations)
        ? resource.properties.ipConfigurations
        : [];
      const firewallPolicy =
        resource.properties.firewallPolicy ??
        resource.properties.firewallPolicyId ??
        resource.properties.firewallPolicyResourceId;
      return ipConfigurations.length === 0 && firewallPolicy == null;
    })
    .map((resource) => ({
      ruleType: "NETWORK_FIREWALL_IDLE" as const,
      resourceId: resource.id,
      subscriptionId: resource.subscriptionId,
      savingsCategory: "POTENTIAL_SAVING" as const,
    }));
}

export function findExcessiveEgress(
  resources: ResourceGraphRow[],
): WasteFindingCandidate[] {
  return resources
    .filter((resource) => resource.type.toLowerCase() === "microsoft.network/natgateways")
    .filter((resource) => {
      const idleTimeout = Number(resource.properties.idleTimeoutInMinutes ?? 0);
      const publicIps = Array.isArray(resource.properties.publicIpAddresses)
        ? resource.properties.publicIpAddresses.length
        : 0;
      return Number.isFinite(idleTimeout) && idleTimeout >= 30 && publicIps > 0;
    })
    .map((resource) => ({
      ruleType: "EGRESS_TRANSFER_EXCESSIVE" as const,
      resourceId: resource.id,
      subscriptionId: resource.subscriptionId,
      savingsCategory: "POTENTIAL_SAVING" as const,
      metricObserved: Number(resource.properties.idleTimeoutInMinutes ?? 0),
    }));
}
