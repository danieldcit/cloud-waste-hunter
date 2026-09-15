import { describe, expect, it } from "vitest";
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import {
  findLowUtilizationCosmosDb,
  findLowUtilizationRedisCaches,
  findOverprovisionedFlexibleDatabases,
  findOverprovisionedSqlDatabases,
  findOverprovisionedSqlManagedInstances,
} from "@/lib/waste-rules/dataServices";

function row(id: string, type: string, properties: Record<string, unknown>, sku?: { capacity?: number; name?: string }): ResourceGraphRow {
  return { id, type, subscriptionId: "sub-1", properties, sku };
}

describe("dataServices", () => {
  it("flags a SQL Database using only a small percentage of a large max size", () => {
    const result = findOverprovisionedSqlDatabases([
      row("/subscriptions/sub-1/db-1", "microsoft.sql/servers/databases", {
        currentSize: 250,
        maxSizeBytes: 10000,
      }),
    ]);

    expect(result).toEqual([
      {
        ruleType: "SQL_DATABASE_OVERPROVISIONED",
        resourceId: "/subscriptions/sub-1/db-1",
        subscriptionId: "sub-1",
        savingsCategory: "POTENTIAL_SAVING",
        metricObserved: 0.025,
      },
    ]);
  });

  it("flags a managed instance with low storage utilization", () => {
    const result = findOverprovisionedSqlManagedInstances([
      row("/subscriptions/sub-1/mi-1", "microsoft.sql/managedinstances", {
        storageSizeInGB: 256,
        usedStorageSizeInGB: 12,
      }),
    ]);

    expect(result).toEqual([
      {
        ruleType: "SQL_MANAGED_INSTANCE_OVERPROVISIONED",
        resourceId: "/subscriptions/sub-1/mi-1",
        subscriptionId: "sub-1",
        savingsCategory: "POTENTIAL_SAVING",
        metricObserved: 0.046875,
      },
    ]);
  });

  it("flags PostgreSQL/MySQL Flexible Servers with underutilized storage", () => {
    const result = findOverprovisionedFlexibleDatabases([
      row("/subscriptions/sub-1/pg-1", "microsoft.dbforpostgresql/flexibleservers", {
        storageProfile: { storageMb: 409600, usedStorageMb: 20480 },
      }),
    ]);

    expect(result).toEqual([
      {
        ruleType: "POSTGRES_MYSQL_OVERPROVISIONED",
        resourceId: "/subscriptions/sub-1/pg-1",
        subscriptionId: "sub-1",
        savingsCategory: "POTENTIAL_SAVING",
        metricObserved: 0.05,
      },
    ]);
  });

  it("flags a Cosmos account in free tier", () => {
    const result = findLowUtilizationCosmosDb([
      row("/subscriptions/sub-1/cosmos-1", "microsoft.documentdb/databaseaccounts", {
        enableFreeTier: true,
      }),
    ]);

    expect(result).toEqual([
      {
        ruleType: "COSMOS_DB_LOW_UTILIZATION",
        resourceId: "/subscriptions/sub-1/cosmos-1",
        subscriptionId: "sub-1",
        savingsCategory: "POTENTIAL_SAVING",
        metricObserved: 0,
      },
    ]);
  });

  it("flags small Redis caches", () => {
    const result = findLowUtilizationRedisCaches([
      row("/subscriptions/sub-1/redis-1", "microsoft.cache/redis", {}, { capacity: 1 }),
    ]);

    expect(result).toEqual([
      {
        ruleType: "REDIS_LOW_UTILIZATION",
        resourceId: "/subscriptions/sub-1/redis-1",
        subscriptionId: "sub-1",
        savingsCategory: "POTENTIAL_SAVING",
        metricObserved: 1,
      },
    ]);
  });
});
