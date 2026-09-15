import { describe, expect, it } from "vitest";
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import {
  findStorageAccountsWithRecommendedRedundancy,
  findUnusedStorageAccounts,
} from "@/lib/waste-rules/storageComplementary";

function account(
  properties: Record<string, unknown> = {},
  overrides: Partial<ResourceGraphRow> = {},
): ResourceGraphRow {
  return {
    id: "/subscriptions/sub/resourceGroups/rg/providers/Microsoft.Storage/storageAccounts/account",
    type: "microsoft.storage/storageAccounts",
    subscriptionId: "sub",
    location: "brazilsouth",
    sku: { name: "Standard_LRS" },
    properties,
    ...overrides,
  };
}

describe("Storage complementary waste rules", () => {
  it("requires an explicit isUnused signal or all zero counters plus old activity", () => {
    expect(findUnusedStorageAccounts([account({ isUnused: true })])).toHaveLength(1);
    expect(
      findUnusedStorageAccounts([
        account({
          blobCount: 0,
          containerCount: 0,
          fileShareCount: 0,
          queueCount: 0,
          tableCount: 0,
          lastAccessTime: "2025-01-01T00:00:00Z",
        }),
      ]),
    ).toHaveLength(1);
    expect(
      findUnusedStorageAccounts([
        account({
          blobCount: 0,
          containerCount: 0,
          fileShareCount: 0,
          queueCount: 0,
          tableCount: 0,
          lastAccessTime: "2025-01-01T00:00:00Z",
          lastModifiedTime: new Date().toISOString(),
        }),
      ]),
    ).toEqual([]);
  });

  it("does not infer unused accounts from missing counters or timestamps", () => {
    expect(
      findUnusedStorageAccounts([
        account({
          blobCount: 0,
          containerCount: 0,
          fileShareCount: 0,
          queueCount: 0,
          tableCount: 0,
        }),
      ]),
    ).toEqual([]);
    expect(findUnusedStorageAccounts([account({ isUnused: "true" })])).toEqual([]);
  });

  it("flags only an explicit recommendation that differs from the current SKU", () => {
    expect(
      findStorageAccountsWithRecommendedRedundancy([
        account({ recommendedRedundancy: "ZRS" }),
      ]),
    ).toMatchObject([{ ruleType: "STORAGE_ACCOUNT_REDUNDANCY_MISMATCH" }]);
    expect(
      findStorageAccountsWithRecommendedRedundancy([
        account({ recommendedRedundancy: "LRS" }),
      ]),
    ).toEqual([]);
    expect(
      findStorageAccountsWithRecommendedRedundancy([
        account({}, { tags: { finopsRecommendedRedundancy: "ZRS" } }),
      ]),
    ).toHaveLength(1);
    expect(
      findStorageAccountsWithRecommendedRedundancy([
        account({ recommendedSku: "Standard_LRS" }),
      ]),
    ).toEqual([]);
  });

  it("does not apply storage-account rules to child storage resources", () => {
    expect(
      findUnusedStorageAccounts([
        account({}, { type: "microsoft.storage/storageAccounts/queues" }),
      ]),
    ).toEqual([]);
  });
});
