import { describe, expect, it } from "vitest";
import {
  findAzureFilesPremiumOversized,
  findAzureFilesQuotaOversized,
  findAzureFilesProtectionExcessive,
  findAzureFilesUnusedShares,
} from "@/lib/waste-rules/azureFiles";
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";

function share(overrides: Record<string, unknown> = {}): ResourceGraphRow {
  return {
    id: "/subscriptions/sub/resourceGroups/rg/providers/Microsoft.Storage/storageAccounts/acct/fileServices/default/shares/share",
    type: "microsoft.storage/storageAccounts/fileServices/shares",
    subscriptionId: "sub",
    location: "brazilsouth",
    sku: { name: "Premium_LRS" },
    properties: {
      shareQuota: 100,
      shareUsageBytes: 0,
      ...overrides,
    },
  };
}

describe("Azure Files waste rules", () => {
  it("detects a share with zero reported usage", () => {
    expect(findAzureFilesUnusedShares([share()])).toHaveLength(1);
  });

  it("detects a premium share with very low usage", () => {
    expect(
      findAzureFilesPremiumOversized([
        share({ shareUsageBytes: 1 * 1024 ** 3 }),
      ]),
    ).toMatchObject([{ ruleType: "AZURE_FILES_PREMIUM_OVERSIZED" }]);
  });

  it("detects provisioned quota above observed usage", () => {
    expect(
      findAzureFilesQuotaOversized([
        share({ shareUsageBytes: 1 * 1024 ** 3 }),
      ]),
    ).toMatchObject([{ ruleType: "AZURE_FILES_QUOTA_OVERSIZED", metricObserved: 0.01 }]);
  });

  it("does not flag a share with healthy capacity usage", () => {
    const resource = share({ shareUsageBytes: 80 * 1024 ** 3 });
    expect(findAzureFilesPremiumOversized([resource])).toEqual([]);
    expect(findAzureFilesQuotaOversized([resource])).toEqual([]);
  });

  it("detects retention protection above the recommended window", () => {
    expect(
      findAzureFilesProtectionExcessive([
        share({ shareDeleteRetentionPolicy: { enabled: true, days: 90 } }),
      ]),
    ).toMatchObject([{ ruleType: "AZURE_FILES_PROTECTION_EXCESSIVE" }]);
  });
});
