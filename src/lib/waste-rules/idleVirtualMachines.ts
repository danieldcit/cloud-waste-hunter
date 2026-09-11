import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import type { WasteFindingCandidate } from "@/lib/waste-rules/types";
import { getAverageCpuPercent } from "@/lib/azure/monitorMetrics";

const IDLE_CPU_THRESHOLD_PERCENT = 5;

export async function findIdleVirtualMachines(
  resources: ResourceGraphRow[],
  getAverageCpu: (resourceId: string) => Promise<number> = getAverageCpuPercent,
): Promise<WasteFindingCandidate[]> {
  const vms = resources.filter(
    (r) => r.type.toLowerCase() === "microsoft.compute/virtualmachines",
  );

  const candidates: WasteFindingCandidate[] = [];
  for (const vm of vms) {
    const avgCpu = await getAverageCpu(vm.id);
    if (avgCpu < IDLE_CPU_THRESHOLD_PERCENT) {
      candidates.push({
        ruleType: "IDLE_VM",
        resourceId: vm.id,
        subscriptionId: vm.subscriptionId,
      });
    }
  }
  return candidates;
}
