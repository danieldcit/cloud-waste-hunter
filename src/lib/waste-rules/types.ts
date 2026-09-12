import type { WasteRuleType, SavingsCategory } from "@prisma/client";
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";

export interface WasteFindingCandidate {
  ruleType: WasteRuleType;
  resourceId: string;
  subscriptionId: string;
  savingsCategory?: SavingsCategory;
  metricObserved?: number;
  periodAnalyzedDays?: number;
}

export type WasteRule = (resources: ResourceGraphRow[]) => WasteFindingCandidate[];
