import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import type { WasteFindingCandidate } from "@/lib/waste-rules/types";
import { getAverageCpuPercent } from "@/lib/azure/monitorMetrics";

interface CpuSeverityTier {
  maxCpuPercent: number;
  days: 30 | 60 | 90;
  savingsCategory: "HARD_SAVING" | "POTENTIAL_SAVING";
}

/** Ordered from most to least severe — the first matching tier wins. Same table as IDLE_VM. */
const CPU_SEVERITY_TIERS: CpuSeverityTier[] = [
  { maxCpuPercent: 5, days: 90, savingsCategory: "HARD_SAVING" },
  { maxCpuPercent: 5, days: 30, savingsCategory: "HARD_SAVING" },
  { maxCpuPercent: 10, days: 60, savingsCategory: "POTENTIAL_SAVING" },
  { maxCpuPercent: 20, days: 30, savingsCategory: "POTENTIAL_SAVING" },
];

export async function findVmssIdleLowUtilization(
  resources: ResourceGraphRow[],
  getAverageCpu: (resourceId: string, days: number) => Promise<number> = getAverageCpuPercent,
): Promise<WasteFindingCandidate[]> {
  const scaleSets = resources.filter(
    (r) => r.type.toLowerCase() === "microsoft.compute/virtualmachinescalesets",
  );

  const candidates: WasteFindingCandidate[] = [];
  for (const vmss of scaleSets) {
    const [cpu30, cpu60, cpu90] = await Promise.all([
      getAverageCpu(vmss.id, 30),
      getAverageCpu(vmss.id, 60),
      getAverageCpu(vmss.id, 90),
    ]);
    const cpuByWindow = new Map<number, number>([
      [30, cpu30],
      [60, cpu60],
      [90, cpu90],
    ]);

    const matchedTier = CPU_SEVERITY_TIERS.find(
      (tier) => (cpuByWindow.get(tier.days) ?? Infinity) < tier.maxCpuPercent,
    );
    if (matchedTier) {
      candidates.push({
        ruleType: "VMSS_IDLE_LOW_UTILIZATION",
        resourceId: vmss.id,
        subscriptionId: vmss.subscriptionId,
        savingsCategory: matchedTier.savingsCategory,
        metricObserved: cpuByWindow.get(matchedTier.days)!,
        periodAnalyzedDays: matchedTier.days,
      });
    }
  }
  return candidates;
}
