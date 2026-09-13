/** Built-in Azure RBAC role definition GUIDs this app's Lighthouse delegation requires. */
export const READER_ROLE_ID = "acdd72a7-3385-48ef-bd42-f606fbe8a4b8";
export const STORAGE_BLOB_DATA_READER_ROLE_ID = "2a2b9908-6ea1-4ae2-8e65-a410df84e7d1";

export const REQUIRED_ROLE_IDS: string[] = [READER_ROLE_ID, STORAGE_BLOB_DATA_READER_ROLE_ID];

/**
 * Role definition ids returned by Azure can be a bare GUID or a full path
 * (".../providers/Microsoft.Authorization/roleDefinitions/{guid}") — normalize to the bare,
 * lowercase GUID before comparing.
 */
export function normalizeRoleId(id: string): string {
  const segments = id.split("/");
  return (segments[segments.length - 1] ?? id).toLowerCase();
}

/** True when the granted role set doesn't cover every role this app currently requires. */
export function needsPermissionUpgrade(grantedRoleIds: string[]): boolean {
  const granted = new Set(grantedRoleIds.map(normalizeRoleId));
  return REQUIRED_ROLE_IDS.some((required) => !granted.has(normalizeRoleId(required)));
}
