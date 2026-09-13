import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import type { WasteFindingCandidate } from "@/lib/waste-rules/types";
import { isSessionHost, underlyingVm } from "@/lib/waste-rules/avdSessionHosts";
import { findAvdSessionHostLowUtilization } from "@/lib/waste-rules/avdSessionHostLowUtilization";

const PREMIUM_DISK_SKUS = new Set(["Premium_LRS", "Premium_ZRS", "PremiumV2_LRS", "UltraSSD_LRS"]);

interface VmStorageProfile {
  osDisk?: { managedDisk?: { id?: string } };
}

export function findAvdSessionHostPremiumDiskUnused(
  resources: ResourceGraphRow[],
): WasteFindingCandidate[] {
  const idleHostIds = new Set(
    findAvdSessionHostLowUtilization(resources).map((c) => c.resourceId),
  );
  const candidates: WasteFindingCandidate[] = [];

  for (const sessionHost of resources.filter(isSessionHost)) {
    if (!idleHostIds.has(sessionHost.id)) {
      continue;
    }
    const vm = underlyingVm(sessionHost, resources);
    if (!vm) {
      continue;
    }
    const storageProfile = vm.properties.storageProfile as VmStorageProfile | undefined;
    const diskId = storageProfile?.osDisk?.managedDisk?.id;
    if (!diskId) {
      continue;
    }
    const disk = resources.find((r) => r.id.toLowerCase() === diskId.toLowerCase());
    if (!disk || !PREMIUM_DISK_SKUS.has(disk.sku?.name ?? "")) {
      continue;
    }

    candidates.push({
      ruleType: "AVD_SESSION_HOST_PREMIUM_DISK_UNUSED",
      resourceId: disk.id,
      subscriptionId: disk.subscriptionId,
      savingsCategory: "POTENTIAL_SAVING",
    });
  }

  return candidates;
}
