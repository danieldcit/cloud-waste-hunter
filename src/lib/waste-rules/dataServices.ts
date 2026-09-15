import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import type { WasteFindingCandidate } from "@/lib/waste-rules/types";

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function ratioFromProperties(
  resource: ResourceGraphRow,
  currentKeys: string[],
  totalKeys: string[],
): number | null {
  const props = resource.properties as Record<string, unknown>;

  const current = currentKeys
    .map((key) => asNumber(props[key]))
    .find((value): value is number => value != null);
  const total = totalKeys
    .map((key) => asNumber(props[key]))
    .find((value): value is number => value != null);

  if (current == null || total == null || total <= 0) {
    return null;
  }

  return current / total;
}

export function findOverprovisionedSqlDatabases(
  resources: ResourceGraphRow[],
): WasteFindingCandidate[] {
  return resources
    .filter((resource) => resource.type.toLowerCase() === "microsoft.sql/servers/databases")
    .filter((resource) => {
      const props = resource.properties as Record<string, unknown>;
      const current =
        asNumber(props.currentSize) ??
        asNumber(props.currentSizeBytes) ??
        asNumber(props.currentDatabaseSizeBytes) ??
        asNumber((props.usage as Record<string, unknown> | undefined)?.currentSizeBytes);
      const total =
        asNumber(props.maxSizeBytes) ??
        asNumber(props.maxSize) ??
        asNumber((props.storage as Record<string, unknown> | undefined)?.maxSizeBytes);

      if (current == null || total == null || total <= 0) {
        return false;
      }

      return current / total < 0.1;
    })
    .map((resource) => ({
      ruleType: "SQL_DATABASE_OVERPROVISIONED" as const,
      resourceId: resource.id,
      subscriptionId: resource.subscriptionId,
      savingsCategory: "POTENTIAL_SAVING" as const,
      metricObserved: ratioFromProperties(resource, ["currentSize", "currentSizeBytes"], ["maxSizeBytes", "maxSize"]) ?? undefined,
    }));
}

export function findOverprovisionedSqlManagedInstances(
  resources: ResourceGraphRow[],
): WasteFindingCandidate[] {
  return resources
    .filter((resource) => resource.type.toLowerCase() === "microsoft.sql/managedinstances")
    .filter((resource) => {
      const props = resource.properties as Record<string, unknown>;
      const total =
        asNumber(props.storageSizeInGB) ??
        asNumber(props.maxStorageSizeInGB) ??
        asNumber((props.storage as Record<string, unknown> | undefined)?.sizeInGB);
      const used =
        asNumber(props.usedStorageSizeInGB) ??
        asNumber(props.storageUsageInGB) ??
        asNumber((props.storage as Record<string, unknown> | undefined)?.usedSizeInGB);

      if (total == null || used == null || total <= 0) {
        return false;
      }

      return total >= 128 && used / total < 0.15;
    })
    .map((resource) => ({
      ruleType: "SQL_MANAGED_INSTANCE_OVERPROVISIONED" as const,
      resourceId: resource.id,
      subscriptionId: resource.subscriptionId,
      savingsCategory: "POTENTIAL_SAVING" as const,
      metricObserved:
        ((asNumber((resource.properties as Record<string, unknown>).usedStorageSizeInGB) ??
          asNumber((resource.properties as Record<string, unknown>).storageUsageInGB) ??
          0) /
          (asNumber((resource.properties as Record<string, unknown>).storageSizeInGB) ??
            asNumber((resource.properties as Record<string, unknown>).maxStorageSizeInGB) ??
            1)) || undefined,
    }));
}

export function findOverprovisionedFlexibleDatabases(
  resources: ResourceGraphRow[],
): WasteFindingCandidate[] {
  return resources
    .filter(
      (resource) =>
        resource.type.toLowerCase() === "microsoft.dbforpostgresql/flexibleservers" ||
        resource.type.toLowerCase() === "microsoft.dbformysql/flexibleservers",
    )
    .filter((resource) => {
      const props = resource.properties as Record<string, unknown>;
      const storageProfile = props.storageProfile as Record<string, unknown> | undefined;
      const total =
        asNumber(storageProfile?.storageMb) ??
        asNumber(props.storageMb) ??
        asNumber(props.storageSizeInMb) ??
        asNumber((props.storage as Record<string, unknown> | undefined)?.storageMb);
      const used =
        asNumber(storageProfile?.usedStorageMb) ??
        asNumber(props.usedStorageMb) ??
        asNumber(props.storageUsedInMb) ??
        asNumber((props.storage as Record<string, unknown> | undefined)?.usedStorageMb);

      if (total == null || used == null || total <= 0) {
        return false;
      }

      return total >= 1024 && used / total < 0.15;
    })
    .map((resource) => ({
      ruleType: "POSTGRES_MYSQL_OVERPROVISIONED" as const,
      resourceId: resource.id,
      subscriptionId: resource.subscriptionId,
      savingsCategory: "POTENTIAL_SAVING" as const,
      metricObserved:
        ((asNumber(((resource.properties as Record<string, unknown>).storageProfile as Record<string, unknown> | undefined)?.usedStorageMb) ??
          asNumber((resource.properties as Record<string, unknown>).usedStorageMb) ??
          0) /
          (asNumber(((resource.properties as Record<string, unknown>).storageProfile as Record<string, unknown> | undefined)?.storageMb) ??
            asNumber((resource.properties as Record<string, unknown>).storageMb) ??
            1)) || undefined,
    }));
}

export function findLowUtilizationCosmosDb(
  resources: ResourceGraphRow[],
): WasteFindingCandidate[] {
  return resources
    .filter((resource) => resource.type.toLowerCase() === "microsoft.documentdb/databaseaccounts")
    .filter((resource) => {
      const props = resource.properties as Record<string, unknown>;
      return props.enableFreeTier === true || props.databaseAccountOfferType === "Standard";
    })
    .map((resource) => ({
      ruleType: "COSMOS_DB_LOW_UTILIZATION" as const,
      resourceId: resource.id,
      subscriptionId: resource.subscriptionId,
      savingsCategory: "POTENTIAL_SAVING" as const,
      metricObserved: 0,
    }));
}

export function findLowUtilizationRedisCaches(
  resources: ResourceGraphRow[],
): WasteFindingCandidate[] {
  return resources
    .filter((resource) => resource.type.toLowerCase() === "microsoft.cache/redis")
    .filter((resource) => {
      const capacity = asNumber(resource.sku?.capacity) ?? asNumber((resource.properties as Record<string, unknown>).capacity);
      return capacity != null && capacity <= 1;
    })
    .map((resource) => ({
      ruleType: "REDIS_LOW_UTILIZATION" as const,
      resourceId: resource.id,
      subscriptionId: resource.subscriptionId,
      savingsCategory: "POTENTIAL_SAVING" as const,
      metricObserved: asNumber(resource.sku?.capacity) ?? asNumber((resource.properties as Record<string, unknown>).capacity) ?? undefined,
    }));
}

