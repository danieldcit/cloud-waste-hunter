import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import type { WasteFindingCandidate } from "@/lib/waste-rules/types";

const STORAGE_ACCOUNT_TYPE = "microsoft.storage/storageaccounts";
const UNUSED_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;
const USAGE_COUNTERS = [
  "blobCount",
  "containerCount",
  "fileShareCount",
  "queueCount",
  "tableCount",
] as const;

type StorageAccountProperties = {
  isUnused?: unknown;
  blobCount?: unknown;
  containerCount?: unknown;
  fileShareCount?: unknown;
  queueCount?: unknown;
  tableCount?: unknown;
  lastAccessTime?: unknown;
  lastModifiedTime?: unknown;
  recommendedSku?: unknown;
  recommendedRedundancy?: unknown;
};

function storageAccounts(resources: ResourceGraphRow[]): ResourceGraphRow[] {
  return resources.filter(
    (resource) => resource.type.toLowerCase() === STORAGE_ACCOUNT_TYPE,
  );
}

function properties(resource: ResourceGraphRow): StorageAccountProperties {
  return resource.properties as StorageAccountProperties;
}

function hasExplicitZeroCounters(data: StorageAccountProperties): boolean {
  return USAGE_COUNTERS.every(
    (counter) =>
      Object.prototype.hasOwnProperty.call(data, counter) &&
      typeof data[counter] === "number" &&
      Number.isFinite(data[counter]) &&
      data[counter] === 0,
  );
}

function isAtLeastUnusedDaysAgo(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const timestamp = Date.parse(value);
  return (
    Number.isFinite(timestamp) &&
    Date.now() - timestamp >= UNUSED_DAYS * DAY_MS
  );
}

function hasOnlyOldActivityTimestamps(data: StorageAccountProperties): boolean {
  const timestamps = [data.lastAccessTime, data.lastModifiedTime].filter(
    (value): value is string => typeof value === "string",
  );

  if (timestamps.length === 0) return false;

  // Use the newest explicit activity timestamp so one recent activity signal
  // prevents a false positive even when the other timestamp is old.
  return timestamps.every(isAtLeastUnusedDaysAgo);
}

function normalized(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const result = value.trim().toLowerCase();
  return result.length > 0 ? result : null;
}

function redundancy(value: string): string | null {
  const match = value.match(/(?:^|_)(ragzrs|gzrs|ragrs|grs|zrs|lrs)$/i);
  return match?.[1]?.toLowerCase() ?? null;
}

function recommendationDiffers(
  recommendation: unknown,
  currentSku: string,
  compareRedundancy: boolean,
): boolean {
  const recommended = normalized(recommendation);
  const current = normalized(currentSku);
  if (!recommended || !current) return false;
  if (recommended === current) return false;

  if (compareRedundancy) {
    const recommendedRedundancy = redundancy(recommended);
    const currentRedundancy = redundancy(current);
    if (
      recommendedRedundancy &&
      currentRedundancy &&
      recommendedRedundancy === currentRedundancy
    ) {
      return false;
    }
  }

  return true;
}

function hasDifferentRecommendation(
  resource: ResourceGraphRow,
): boolean {
  const data = properties(resource);
  const currentSku = resource.sku?.name;
  if (typeof currentSku !== "string" || !currentSku.trim()) return false;

  return (
    recommendationDiffers(data.recommendedSku, currentSku, false) ||
    recommendationDiffers(data.recommendedRedundancy, currentSku, true) ||
    recommendationDiffers(resource.tags?.finopsRecommendedRedundancy, currentSku, true)
  );
}

export function findUnusedStorageAccounts(
  resources: ResourceGraphRow[],
): WasteFindingCandidate[] {
  return storageAccounts(resources)
    .filter((resource) => {
      const data = properties(resource);
      const explicitlyUnused = data.isUnused === true;
      const zeroUsageAndOldActivity =
        hasExplicitZeroCounters(data) && hasOnlyOldActivityTimestamps(data);
      return explicitlyUnused || zeroUsageAndOldActivity;
    })
    .map((resource) => ({
      ruleType: "STORAGE_ACCOUNT_UNUSED" as const,
      resourceId: resource.id,
      subscriptionId: resource.subscriptionId,
      savingsCategory: "POTENTIAL_SAVING" as const,
      periodAnalyzedDays: UNUSED_DAYS,
    }));
}

export function findStorageAccountsWithRecommendedRedundancy(
  resources: ResourceGraphRow[],
): WasteFindingCandidate[] {
  return storageAccounts(resources)
    .filter(hasDifferentRecommendation)
    .map((resource) => ({
      ruleType: "STORAGE_ACCOUNT_REDUNDANCY_MISMATCH" as const,
      resourceId: resource.id,
      subscriptionId: resource.subscriptionId,
      savingsCategory: "POTENTIAL_SAVING" as const,
    }));
}
