import type { WasteRuleType } from "@prisma/client";
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";

export interface WasteFindingCandidate {
  ruleType: WasteRuleType;
  resourceId: string;
  subscriptionId: string;
}

export type WasteRule = (resources: ResourceGraphRow[]) => WasteFindingCandidate[];
