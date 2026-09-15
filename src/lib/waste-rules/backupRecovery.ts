import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import type { WasteFindingCandidate } from "@/lib/waste-rules/types";

const VAULT_TYPE = "microsoft.recoveryservices/vaults";
const POLICY_MARKER = "/backuppolicies/";
const OLD_RECOVERY_POINT_DAYS = 180;
const EXCESSIVE_RETENTION_DAYS = 365;

function isType(resource: ResourceGraphRow, type: string): boolean {
  return resource.type.toLowerCase() === type;
}

function vaultId(resourceId: string): string {
  const markerIndex = resourceId.search(/\/backupfabrics\//i);
  return markerIndex >= 0 ? resourceId.slice(0, markerIndex) : resourceId;
}

function daysSince(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  return (Date.now() - timestamp) / (24 * 60 * 60 * 1000);
}

function sourceResourceId(resource: ResourceGraphRow): string | undefined {
  const properties = resource.properties as {
    sourceResourceId?: unknown;
    datasourceInfo?: { resourceID?: unknown; resourceId?: unknown };
  };
  const value =
    properties.sourceResourceId ??
    properties.datasourceInfo?.resourceID ??
    properties.datasourceInfo?.resourceId;
  return typeof value === "string" ? value : undefined;
}

function protectedItems(resource: ResourceGraphRow): boolean {
  return /\/backupfabrics\//i.test(resource.id);
}

export function findBackupVaultsUnused(
  resources: ResourceGraphRow[],
): WasteFindingCandidate[] {
  const vaults = resources.filter(
    (resource) => isType(resource, VAULT_TYPE) && !protectedItems(resource),
  );
  const usedVaultIds = new Set(
    resources
      .filter(protectedItems)
      .map((resource) => vaultId(resource.id).toLowerCase()),
  );

  return vaults
    .filter((vault) => !usedVaultIds.has(vault.id.toLowerCase()))
    .map((vault) => ({
      ruleType: "BACKUP_VAULT_UNUSED" as const,
      resourceId: vault.id,
      subscriptionId: vault.subscriptionId,
      savingsCategory: "POTENTIAL_SAVING" as const,
    }));
}

export function findOrphanedBackupItems(
  resources: ResourceGraphRow[],
): WasteFindingCandidate[] {
  const resourceIds = new Set(resources.map((resource) => resource.id.toLowerCase()));
  return resources
    .filter(protectedItems)
    .filter((resource) => {
      const sourceId = sourceResourceId(resource);
      return Boolean(sourceId && !resourceIds.has(sourceId.toLowerCase()));
    })
    .map((resource) => ({
      ruleType: "BACKUP_ORPHANED_ITEM" as const,
      resourceId: resource.id,
      subscriptionId: resource.subscriptionId,
      savingsCategory: "POTENTIAL_SAVING" as const,
    }));
}

export function findOldRecoveryPoints(
  resources: ResourceGraphRow[],
): WasteFindingCandidate[] {
  return resources
    .filter(protectedItems)
    .filter((resource) => {
      const properties = resource.properties as Record<string, unknown>;
      const lastRecoveryPoint =
        properties.lastRecoveryPointTime ??
        properties.latestRecoveryPointTime ??
        properties.lastBackupTime;
      const age = daysSince(lastRecoveryPoint);
      return age != null && age >= OLD_RECOVERY_POINT_DAYS;
    })
    .map((resource) => ({
      ruleType: "BACKUP_OLD_RECOVERY_POINT" as const,
      resourceId: resource.id,
      subscriptionId: resource.subscriptionId,
      savingsCategory: "POTENTIAL_SAVING" as const,
    }));
}

export function findExcessiveBackupRetention(
  resources: ResourceGraphRow[],
): WasteFindingCandidate[] {
  return resources
    .filter((resource) => resource.id.toLowerCase().includes(POLICY_MARKER))
    .filter((resource) => {
      const properties = resource.properties as Record<string, unknown>;
      const retentionDays = Number(
        properties.retentionDurationInDays ??
          properties.retentionDays ??
          properties.dailyRetentionDurationInDays,
      );
      return Number.isFinite(retentionDays) && retentionDays > EXCESSIVE_RETENTION_DAYS;
    })
    .map((resource) => ({
      ruleType: "BACKUP_RETENTION_EXCESSIVE" as const,
      resourceId: resource.id,
      subscriptionId: resource.subscriptionId,
      savingsCategory: "POTENTIAL_SAVING" as const,
    }));
}
