import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import type { WasteFindingCandidate } from "@/lib/waste-rules/types";
import { getAverageCpuPercent } from "@/lib/azure/monitorMetrics";

interface CpuSeverityTier {
  maxCpuPercent: number;
  days: 30 | 60 | 90;
  savingsCategory: "HARD_SAVING" | "POTENTIAL_SAVING";
}

/** Ordered from most to least severe — the first matching tier wins. */
const CPU_SEVERITY_TIERS: CpuSeverityTier[] = [
  { maxCpuPercent: 5, days: 90, savingsCategory: "HARD_SAVING" },
  { maxCpuPercent: 5, days: 30, savingsCategory: "HARD_SAVING" },
  { maxCpuPercent: 10, days: 60, savingsCategory: "POTENTIAL_SAVING" },
  { maxCpuPercent: 20, days: 30, savingsCategory: "POTENTIAL_SAVING" },
];

export async function findIdleVirtualMachines(
  resources: ResourceGraphRow[],
  getAverageCpu: (resourceId: string, days: number) => Promise<number> = getAverageCpuPercent,
): Promise<WasteFindingCandidate[]> {
  const vms = resources.filter(
    (r) => r.type.toLowerCase() === "microsoft.compute/virtualmachines",
  );

  const candidates: WasteFindingCandidate[] = [];
  for (const vm of vms) {
    const cpuByWindow = new Map<number, number>();
    for (const days of [30, 60, 90]) {
      cpuByWindow.set(days, await getAverageCpu(vm.id, days));
    }

    const matchedTier = CPU_SEVERITY_TIERS.find(
      (tier) => (cpuByWindow.get(tier.days) ?? Infinity) < tier.maxCpuPercent,
    );
    if (matchedTier) {
      candidates.push({
        ruleType: "IDLE_VM",
        resourceId: vm.id,
        subscriptionId: vm.subscriptionId,
        savingsCategory: matchedTier.savingsCategory,
        metricObserved: cpuByWindow.get(matchedTier.days)!,
        periodAnalyzedDays: matchedTier.days,
      });
    }
  }
  return candidates;
}
