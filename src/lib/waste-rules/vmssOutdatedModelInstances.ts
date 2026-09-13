import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import type { WasteFindingCandidate } from "@/lib/waste-rules/types";

/** VMSS instance ids look like ".../virtualMachineScaleSets/{name}/virtualMachines/{index}". */
function parentVmssId(instanceId: string): string {
  return instanceId.split("/").slice(0, -2).join("/");
}

export function findVmssOutdatedModelInstances(
  resources: ResourceGraphRow[],
): WasteFindingCandidate[] {
  const staleVmssIds = new Set<string>();
  const subscriptionByVmssId = new Map<string, string>();

  for (const r of resources) {
    if (r.type.toLowerCase() !== "microsoft.compute/virtualmachinescalesets/virtualmachines") {
      continue;
    }
    if (r.properties.latestModelApplied !== false) {
      continue;
    }
    const vmssId = parentVmssId(r.id);
    staleVmssIds.add(vmssId);
    subscriptionByVmssId.set(vmssId, r.subscriptionId);
  }

  return Array.from(staleVmssIds).map((vmssId) => ({
    ruleType: "VMSS_OUTDATED_MODEL_INSTANCES" as const,
    resourceId: vmssId,
    subscriptionId: subscriptionByVmssId.get(vmssId)!,
    savingsCategory: "POTENTIAL_SAVING" as const,
  }));
}
