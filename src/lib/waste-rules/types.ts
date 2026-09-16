import type { WasteRuleType, SavingsCategory } from "@prisma/client";
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";

export interface WasteFindingCandidate {
  ruleType: WasteRuleType;
  resourceId: string;
  subscriptionId: string;
  savingsCategory?: SavingsCategory;
  metricName?: string;
  metricObserved?: number;
  periodAnalyzedDays?: number;
  metricSummary?: string;
}

export type WasteRule = (resources: ResourceGraphRow[]) => WasteFindingCandidate[];
