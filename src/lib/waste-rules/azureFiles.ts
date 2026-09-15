import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import type { WasteFindingCandidate } from "@/lib/waste-rules/types";

const FILE_SHARE_TYPE = "microsoft.storage/storageaccounts/fileservices/shares";
const STORAGE_ACCOUNT_TYPE = "microsoft.storage/storageaccounts";
const PREMIUM_SKUS = new Set(["Premium_LRS", "Premium_ZRS"]);
const LOW_USAGE_RATIO = 0.2;
const MAX_RECOMMENDED_RETENTION_DAYS = 30;
const OLD_DATA_DAYS = 180;
const COOL_TIER_UNUSED_DAYS = 90;

interface FileShareProperties {
  accountSku?: string;
  shareQuota?: number;
  shareUsageBytes?: number;
  usageBytes?: number;
  lastAccessTime?: string;
  deleteRetentionPolicy?: { days?: number; enabled?: boolean };
  shareDeleteRetentionPolicy?: { days?: number; enabled?: boolean };
  accessTier?: string;
  lastModifiedTime?: string;
  duplicateOfResourceId?: string;
  duplicateGroupId?: string;
  isFslogix?: boolean;
  alternativeService?: "Blob" | "Managed Disk";
  recommendedAlternativeService?: "Blob" | "Managed Disk";
}

function daysSince(value: string | undefined): number | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  return (Date.now() - timestamp) / (24 * 60 * 60 * 1000);
}

function isFslogixShare(resource: ResourceGraphRow): boolean {
  const data = properties(resource);
  return (
    data.isFslogix === true ||
    /(?:fslogix|profile|odfc)/i.test(resource.id)
  );
}

function fileShares(resources: ResourceGraphRow[]): ResourceGraphRow[] {
  return resources.filter((resource) => resource.type.toLowerCase() === FILE_SHARE_TYPE);
}

function properties(resource: ResourceGraphRow): FileShareProperties {
  return resource.properties as FileShareProperties;
}

function accountIdForShare(resourceId: string): string {
  return resourceId.replace(/\/fileServices\/[^/]+\/shares\/[^/]+$/i, "");
}

function accountSkuForShare(
  resource: ResourceGraphRow,
  resources: ResourceGraphRow[],
): string {
  const explicitSku = String(properties(resource).accountSku ?? resource.sku?.name ?? "");
  if (explicitSku) {
    return explicitSku;
  }
  const account = resources.find(
    (candidate) =>
      candidate.type.toLowerCase() === STORAGE_ACCOUNT_TYPE &&
      candidate.id.toLowerCase() === accountIdForShare(resource.id).toLowerCase(),
  );
  return String(account?.sku?.name ?? "");
}

function usageRatio(resource: ResourceGraphRow): number | null {
  const data = properties(resource);
  const quotaGb = Number(data.shareQuota);
  const usageBytes = Number(data.shareUsageBytes ?? data.usageBytes);
  if (!Number.isFinite(quotaGb) || quotaGb <= 0 || !Number.isFinite(usageBytes) || usageBytes < 0) {
    return null;
  }
  return usageBytes / (quotaGb * 1024 ** 3);
}

export function findAzureFilesUnusedShares(
  resources: ResourceGraphRow[],
): WasteFindingCandidate[] {
  return fileShares(resources)
    .filter((resource) => {
      const data = properties(resource);
      const ratio = usageRatio(resource);
      const lastAccess = data.lastAccessTime ? Date.parse(data.lastAccessTime) : NaN;
      const hasNoUsage = ratio === 0;
      const hasNoRecentAccess =
        Number.isFinite(lastAccess) &&
        Date.now() - lastAccess > 90 * 24 * 60 * 60 * 1000;
      return hasNoUsage || hasNoRecentAccess;
    })
    .map((resource) => ({
      ruleType: "AZURE_FILES_SHARE_UNUSED" as const,
      resourceId: resource.id,
      subscriptionId: resource.subscriptionId,
      savingsCategory: "POTENTIAL_SAVING" as const,
    }));
}

export function findAzureFilesPremiumOversized(
  resources: ResourceGraphRow[],
): WasteFindingCandidate[] {
  return fileShares(resources)
    .filter((resource) => {
      const accountSku = accountSkuForShare(resource, resources);
      const quotaGb = Number(properties(resource).shareQuota);
      const ratio = usageRatio(resource);
      return PREMIUM_SKUS.has(accountSku) && quotaGb >= 100 && ratio != null && ratio < LOW_USAGE_RATIO;
    })
    .map((resource) => ({
      ruleType: "AZURE_FILES_PREMIUM_OVERSIZED" as const,
      resourceId: resource.id,
      subscriptionId: resource.subscriptionId,
      savingsCategory: "POTENTIAL_SAVING" as const,
      metricObserved: usageRatio(resource) ?? undefined,
    }));
}

export function findAzureFilesProtectionExcessive(
  resources: ResourceGraphRow[],
): WasteFindingCandidate[] {
  return fileShares(resources)
    .filter((resource) => {
      const data = properties(resource);
      const retentionDays = Math.max(
        Number(data.deleteRetentionPolicy?.days ?? 0),
        Number(data.shareDeleteRetentionPolicy?.days ?? 0),
      );
      return retentionDays > MAX_RECOMMENDED_RETENTION_DAYS;
    })
    .map((resource) => ({
      ruleType: "AZURE_FILES_PROTECTION_EXCESSIVE" as const,
      resourceId: resource.id,
      subscriptionId: resource.subscriptionId,
      savingsCategory: "POTENTIAL_SAVING" as const,
    }));
}

export function findAzureFilesOldHotTier(
  resources: ResourceGraphRow[],
): WasteFindingCandidate[] {
  return fileShares(resources)
    .filter((resource) => {
      const data = properties(resource);
      const ageDays = daysSince(data.lastModifiedTime ?? data.lastAccessTime);
      return data.accessTier?.toLowerCase() === "hot" && ageDays != null && ageDays >= OLD_DATA_DAYS;
    })
    .map((resource) => ({
      ruleType: "AZURE_FILES_OLD_HOT_TIER" as const,
      resourceId: resource.id,
      subscriptionId: resource.subscriptionId,
      savingsCategory: "POTENTIAL_SAVING" as const,
    }));
}

export function findAzureFilesCoolTierUnused(
  resources: ResourceGraphRow[],
): WasteFindingCandidate[] {
  return fileShares(resources)
    .filter((resource) => {
      const data = properties(resource);
      const ageDays = daysSince(data.lastAccessTime);
      return (
        data.accessTier?.toLowerCase() === "hot" &&
        ageDays != null &&
        ageDays >= COOL_TIER_UNUSED_DAYS &&
        usageRatio(resource) != null &&
        usageRatio(resource)! > 0
      );
    })
    .map((resource) => ({
      ruleType: "AZURE_FILES_COOL_TIER_UNUSED" as const,
      resourceId: resource.id,
      subscriptionId: resource.subscriptionId,
      savingsCategory: "POTENTIAL_SAVING" as const,
    }));
}

export function findAzureFilesDuplicated(
  resources: ResourceGraphRow[],
): WasteFindingCandidate[] {
  return fileShares(resources)
    .filter((resource) => {
      const data = properties(resource);
      return Boolean(data.duplicateOfResourceId || data.duplicateGroupId);
    })
    .map((resource) => ({
      ruleType: "AZURE_FILES_DUPLICATED" as const,
      resourceId: resource.id,
      subscriptionId: resource.subscriptionId,
      savingsCategory: "POTENTIAL_SAVING" as const,
    }));
}

export function findAzureFilesFslogixOversized(
  resources: ResourceGraphRow[],
): WasteFindingCandidate[] {
  return fileShares(resources)
    .filter((resource) => isFslogixShare(resource) && (usageRatio(resource) ?? 1) < LOW_USAGE_RATIO)
    .map((resource) => ({
      ruleType: "AZURE_FILES_FSLOGIX_OVERSIZED" as const,
      resourceId: resource.id,
      subscriptionId: resource.subscriptionId,
      savingsCategory: "POTENTIAL_SAVING" as const,
      metricObserved: usageRatio(resource) ?? undefined,
    }));
}

export function findAzureFilesAlternativeService(
  resources: ResourceGraphRow[],
): WasteFindingCandidate[] {
  return fileShares(resources)
    .filter((resource) => {
      const data = properties(resource);
      return Boolean(data.alternativeService ?? data.recommendedAlternativeService);
    })
    .map((resource) => ({
      ruleType: "AZURE_FILES_ALTERNATIVE_SERVICE_CHEAPER" as const,
      resourceId: resource.id,
      subscriptionId: resource.subscriptionId,
      savingsCategory: "POTENTIAL_SAVING" as const,
    }));
}

export function findAzureFilesQuotaOversized(
  resources: ResourceGraphRow[],
): WasteFindingCandidate[] {
  return fileShares(resources)
    .filter((resource) => {
      const quotaGb = Number(properties(resource).shareQuota);
      const ratio = usageRatio(resource);
      return quotaGb >= 100 && ratio != null && ratio < LOW_USAGE_RATIO;
    })
    .map((resource) => ({
      ruleType: "AZURE_FILES_QUOTA_OVERSIZED" as const,
      resourceId: resource.id,
      subscriptionId: resource.subscriptionId,
      savingsCategory: "POTENTIAL_SAVING" as const,
      metricObserved: usageRatio(resource) ?? undefined,
    }));
}
