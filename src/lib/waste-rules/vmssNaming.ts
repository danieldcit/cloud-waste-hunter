import { resourceNameFromId, isNonProdResourceName } from "@/lib/waste-rules/resourceNaming";

export const vmssNameFromId = resourceNameFromId;
export const isNonProdVmssName = isNonProdResourceName;
