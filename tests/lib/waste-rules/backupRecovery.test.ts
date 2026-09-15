import { describe, expect, it } from "vitest";
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import {
  findBackupVaultsUnused,
  findOrphanedBackupItems,
  findOldRecoveryPoints,
  findExcessiveBackupRetention,
} from "@/lib/waste-rules/backupRecovery";

const vaultId =
  "/subscriptions/sub/resourceGroups/rg/providers/Microsoft.RecoveryServices/vaults/vault";

function resource(
  id: string,
  properties: Record<string, unknown> = {},
): ResourceGraphRow {
  return {
    id,
    type: "microsoft.recoveryservices/vaults",
    subscriptionId: "sub",
    properties,
  };
}

describe("Backup and Recovery Services waste rules", () => {
  it("detects a vault without protected items", () => {
    expect(findBackupVaultsUnused([resource(vaultId)])).toMatchObject([
      { ruleType: "BACKUP_VAULT_UNUSED" },
    ]);
  });

  it("does not flag a vault with a protected item", () => {
    const item = `${vaultId}/backupFabrics/Azure/protectionContainers/container/protectedItems/item`;
    expect(findBackupVaultsUnused([resource(vaultId), resource(item)])).toEqual([]);
  });

  it("detects a protected item whose source resource is missing", () => {
    const item = `${vaultId}/backupFabrics/Azure/protectionContainers/container/protectedItems/item`;
    expect(
      findOrphanedBackupItems([
        resource(item, { sourceResourceId: "/subscriptions/sub/resourceGroups/rg/vms/deleted" }),
      ]),
    ).toMatchObject([{ ruleType: "BACKUP_ORPHANED_ITEM" }]);
  });

  it("detects old recovery points only when a timestamp is available", () => {
    const item = `${vaultId}/backupFabrics/Azure/protectionContainers/container/protectedItems/item`;
    expect(
      findOldRecoveryPoints([
        resource(item, { lastRecoveryPointTime: "2025-01-01T00:00:00Z" }),
      ]),
    ).toMatchObject([{ ruleType: "BACKUP_OLD_RECOVERY_POINT" }]);
  });

  it("detects retention above one year", () => {
    const policy = `${vaultId}/backupPolicies/policy`;
    expect(
      findExcessiveBackupRetention([
        resource(policy, { retentionDurationInDays: 730 }),
      ]),
    ).toMatchObject([{ ruleType: "BACKUP_RETENTION_EXCESSIVE" }]);
  });
});
