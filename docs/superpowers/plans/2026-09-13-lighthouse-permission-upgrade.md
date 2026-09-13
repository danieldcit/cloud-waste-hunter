# Lighthouse Permission Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the `Storage Blob Data Reader` role to this project's Azure Lighthouse delegation template, track which roles are actually granted per connected subscription, and surface a re-authorization prompt in the Ambientes UI when a subscription's granted roles fall short of what the app currently requires. This is sub-project 1 of 3 unblocking the FinOps catalog's Category 5 (Storage Accounts/Blob) — no Blob Data Plane calls or FinOps rules are added in this plan.

**Architecture:** `registrationDefinitionName` in the Lighthouse ARM template is deterministic (a GUID of app name + provider tenant + subscription id), so redeploying the same template against an already-connected subscription updates its existing delegation in place rather than creating a duplicate — the existing "Lighthouse" deploy-link button in the UI already works for both first-connect and re-authorization; no new deploy flow is needed. A new `grantedRoleIds` column on `Subscription`, populated every time `verify` succeeds, lets the UI compute whether a re-authorization is needed by comparing against a small, explicit `REQUIRED_ROLE_IDS` list in code.

**Tech Stack:** TypeScript, Next.js, Prisma (Postgres), Vitest, Azure Resource Manager REST API, Bicep.

**Spec:** `docs/superpowers/specs/2026-09-13-lighthouse-permission-upgrade-design.md`

## Global Constraints

- `getGrantedRoleIds`'s exact response shape (whether `$expand=registrationDefinition` inlines authorizations as documented) is **not live-validated** — this project has never been able to test the Lighthouse cross-tenant flow end-to-end (only one tenant is available; see `docs/azure-real-validation-findings.md` finding #3). This is an inherited, pre-existing gap, not something this plan is expected to resolve.
- `infra/lighthouse/lighthouse.json` must be regenerated via `az bicep build --file infra/lighthouse/lighthouse.bicep`, never hand-edited — this project has an existing rule about keeping the compiled template in sync with its Bicep source.
- A failure to fetch granted roles during `verify` must never fail the verify request itself (the subscription still becomes `CONNECTED`) — only `grantedRoleIds` stays unchanged, matching the existing resilience pattern used by `captureCostSnapshot`'s `Promise.allSettled`.
- No new API route, no new deploy-link flow, and no dedicated route-handler test file — this project has no existing convention for testing Next.js route handlers directly; testable logic lives in `src/lib/azure/*` modules instead, and route handlers stay thin wrappers around them.

---

## File Structure

New files:
- `src/lib/azure/lighthouseRoles.ts` — required-role constants, `normalizeRoleId`, `needsPermissionUpgrade`
- `src/lib/azure/lighthouseAssignment.ts` — `getGrantedRoleIds`
- `tests/lib/azure/lighthouseRoles.test.ts`
- `tests/lib/azure/lighthouseAssignment.test.ts`
- One new Prisma migration folder under `prisma/migrations/`

Modified files:
- `prisma/schema.prisma` — `Subscription.grantedRoleIds String[] @default([])`
- `src/app/api/subscriptions/[id]/verify/route.ts` — populate `grantedRoleIds` on success
- `src/app/ambientes/page.tsx` — compute and pass `needsPermissionUpgrade` per subscription row
- `src/components/ambientes/AmbientesClient.tsx` — show the upgrade prompt for `CONNECTED` rows that need it
- `src/lib/i18n/dictionaries.ts` — 2 new `ambientes.*` keys × 3 locales
- `infra/lighthouse/lighthouse.bicep` — second `authorizations` entry
- `infra/lighthouse/lighthouse.json` — regenerated from the above

---

### Task 1: Prisma schema — `grantedRoleIds` column

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260913150000_add_subscription_granted_role_ids/migration.sql`

**Interfaces:**
- Produces: `Subscription.grantedRoleIds: string[]` on the generated Prisma client, defaulting to `[]`.

- [ ] **Step 1: Edit `prisma/schema.prisma`**

In the `model Subscription { ... }` block, add the new field after `connectedAt`:

```prisma
model Subscription {
  id                  String             @id @default(cuid())
  customerId          String
  customer            Customer           @relation(fields: [customerId], references: [id])
  azureSubscriptionId String             @unique
  displayName         String
  status              SubscriptionStatus @default(PENDING)
  connectedAt         DateTime?
  grantedRoleIds      String[]           @default([])
  createdAt           DateTime           @default(now())
  scanRuns            ScanRun[]
  resources           Resource[]
  wasteFindings       WasteFinding[]
  costSnapshots       CostSnapshot[]
}
```

- [ ] **Step 2: Write the migration file by hand**

Create `prisma/migrations/20260913150000_add_subscription_granted_role_ids/migration.sql`:

```sql
-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN     "grantedRoleIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
```

- [ ] **Step 3: Apply the migration to both the dev and test databases, and regenerate the Prisma client**

Run: `npx prisma migrate deploy`
Run: `npx dotenv -e .env.test -- npx prisma migrate deploy`
Run: `npx prisma generate`
Expected: all three succeed. If `prisma generate` reports an `EPERM`/file-lock error on Windows (a known, harmless issue seen in this project before), verify the fix worked anyway: `grep -c "grantedRoleIds" node_modules/.prisma/client/index.d.ts` should print a number > 0.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260913150000_add_subscription_granted_role_ids
git commit -m "feat: add grantedRoleIds column to Subscription"
```

---

### Task 2: `lighthouseRoles.ts` — required roles and upgrade check

**Files:**
- Create: `src/lib/azure/lighthouseRoles.ts`
- Test: `tests/lib/azure/lighthouseRoles.test.ts`

**Interfaces:**
- Produces: `READER_ROLE_ID`, `STORAGE_BLOB_DATA_READER_ROLE_ID`, `REQUIRED_ROLE_IDS: string[]`, `normalizeRoleId(id: string): string`, `needsPermissionUpgrade(grantedRoleIds: string[]): boolean`. Consumed by Task 4 (verify route) and Task 5 (Ambientes UI).

- [ ] **Step 1: Write the failing test**

Create `tests/lib/azure/lighthouseRoles.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  READER_ROLE_ID,
  STORAGE_BLOB_DATA_READER_ROLE_ID,
  REQUIRED_ROLE_IDS,
  normalizeRoleId,
  needsPermissionUpgrade,
} from "@/lib/azure/lighthouseRoles";

describe("normalizeRoleId", () => {
  it("returns a bare GUID unchanged except for lowercasing", () => {
    expect(normalizeRoleId("ACDD72A7-3385-48EF-BD42-F606FBE8A4B8")).toBe(
      "acdd72a7-3385-48ef-bd42-f606fbe8a4b8",
    );
  });

  it("extracts the GUID from a full role definition resource path", () => {
    expect(
      normalizeRoleId(
        "/providers/Microsoft.Authorization/roleDefinitions/2a2b9908-6ea1-4ae2-8e65-a410df84e7d1",
      ),
    ).toBe("2a2b9908-6ea1-4ae2-8e65-a410df84e7d1");
  });
});

describe("needsPermissionUpgrade", () => {
  it("returns false when every required role is granted", () => {
    expect(needsPermissionUpgrade(REQUIRED_ROLE_IDS)).toBe(false);
  });

  it("returns false when the granted roles match required roles up to path/casing differences", () => {
    expect(
      needsPermissionUpgrade([
        READER_ROLE_ID.toUpperCase(),
        `/providers/Microsoft.Authorization/roleDefinitions/${STORAGE_BLOB_DATA_READER_ROLE_ID}`,
      ]),
    ).toBe(false);
  });

  it("returns true when a required role is missing", () => {
    expect(needsPermissionUpgrade([READER_ROLE_ID])).toBe(true);
  });

  it("returns true for an empty granted-roles list", () => {
    expect(needsPermissionUpgrade([])).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/lib/azure/lighthouseRoles.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/lib/azure/lighthouseRoles.ts`:

```ts
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
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run tests/lib/azure/lighthouseRoles.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/azure/lighthouseRoles.ts tests/lib/azure/lighthouseRoles.test.ts
git commit -m "feat: add required Lighthouse role constants and upgrade check"
```

---

### Task 3: `lighthouseAssignment.ts` — read granted roles

**Files:**
- Create: `src/lib/azure/lighthouseAssignment.ts`
- Test: `tests/lib/azure/lighthouseAssignment.test.ts`

**Interfaces:**
- Consumes: `armFetch` from `@/lib/azure/armFetch`.
- Produces: `getGrantedRoleIds(azureSubscriptionId: string): Promise<string[]>`. Consumed by Task 4.

- [ ] **Step 1: Write the failing test**

Create `tests/lib/azure/lighthouseAssignment.test.ts` (check `tests/lib/azure/monitorMetrics.test.ts` or a similar existing file for this project's exact `armFetch` mocking convention — likely `vi.spyOn(armFetchModule, "armFetch")` — and match it):

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as armFetchModule from "@/lib/azure/armFetch";
import { getGrantedRoleIds } from "@/lib/azure/lighthouseAssignment";

describe("getGrantedRoleIds", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the role ids from the expanded registrationDefinition", async () => {
    vi.spyOn(armFetchModule, "armFetch").mockResolvedValue({
      value: [
        {
          properties: {
            registrationDefinitionId: "/subscriptions/sub-1/providers/Microsoft.ManagedServices/registrationDefinitions/def-1",
            registrationDefinition: {
              properties: {
                authorizations: [
                  { roleDefinitionId: "acdd72a7-3385-48ef-bd42-f606fbe8a4b8" },
                  { roleDefinitionId: "2a2b9908-6ea1-4ae2-8e65-a410df84e7d1" },
                ],
              },
            },
          },
        },
      ],
    });

    const roleIds = await getGrantedRoleIds("sub-1");

    expect(roleIds).toEqual([
      "acdd72a7-3385-48ef-bd42-f606fbe8a4b8",
      "2a2b9908-6ea1-4ae2-8e65-a410df84e7d1",
    ]);
  });

  it("deduplicates role ids across multiple assignments", async () => {
    vi.spyOn(armFetchModule, "armFetch").mockResolvedValue({
      value: [
        {
          properties: {
            registrationDefinitionId: "def-1",
            registrationDefinition: {
              properties: { authorizations: [{ roleDefinitionId: "role-a" }] },
            },
          },
        },
        {
          properties: {
            registrationDefinitionId: "def-2",
            registrationDefinition: {
              properties: { authorizations: [{ roleDefinitionId: "role-a" }] },
            },
          },
        },
      ],
    });

    const roleIds = await getGrantedRoleIds("sub-1");

    expect(roleIds).toEqual(["role-a"]);
  });

  it("returns an empty array when there are no registration assignments", async () => {
    vi.spyOn(armFetchModule, "armFetch").mockResolvedValue({ value: [] });

    expect(await getGrantedRoleIds("sub-1")).toEqual([]);
  });

  it("returns an empty array when the expanded definition has no authorizations", async () => {
    vi.spyOn(armFetchModule, "armFetch").mockResolvedValue({
      value: [{ properties: { registrationDefinitionId: "def-1" } }],
    });

    expect(await getGrantedRoleIds("sub-1")).toEqual([]);
  });

  it("queries with $expand=registrationDefinition", async () => {
    const spy = vi.spyOn(armFetchModule, "armFetch").mockResolvedValue({ value: [] });

    await getGrantedRoleIds("sub-1");

    const [url] = spy.mock.calls[0] as [string];
    expect(url).toContain("/subscriptions/sub-1/providers/Microsoft.ManagedServices/registrationAssignments");
    expect(url).toContain("$expand=registrationDefinition");
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/lib/azure/lighthouseAssignment.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/lib/azure/lighthouseAssignment.ts`:

```ts
import { armFetch } from "@/lib/azure/armFetch";

interface RegistrationAssignmentListResponse {
  value: {
    properties: {
      registrationDefinitionId: string;
      registrationDefinition?: {
        properties?: {
          authorizations?: { roleDefinitionId: string }[];
        };
      };
    };
  }[];
}

/**
 * Roles actually granted to this app on a customer's subscription, read from the live
 * `registrationDefinition` behind the subscription's Lighthouse `registrationAssignment`.
 * Uses `$expand=registrationDefinition` to get the authorizations inline in one call rather than
 * a second GET per assignment. **Not live-validated** — this project has never been able to test
 * the Lighthouse cross-tenant flow end to end (only one tenant available; see
 * docs/azure-real-validation-findings.md #3). If the expand parameter doesn't behave as Microsoft
 * documents, this needs a fallback to a direct GET per `registrationDefinitionId` — flagged for
 * whoever first tests this against a real second-tenant subscription.
 */
export async function getGrantedRoleIds(azureSubscriptionId: string): Promise<string[]> {
  const url =
    `https://management.azure.com/subscriptions/${azureSubscriptionId}` +
    `/providers/Microsoft.ManagedServices/registrationAssignments` +
    `?api-version=2022-10-01&$expand=registrationDefinition`;

  const result = await armFetch<RegistrationAssignmentListResponse>(url);

  const roleIds = new Set<string>();
  for (const assignment of result.value) {
    const authorizations =
      assignment.properties.registrationDefinition?.properties?.authorizations ?? [];
    for (const auth of authorizations) {
      roleIds.add(auth.roleDefinitionId);
    }
  }
  return [...roleIds];
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run tests/lib/azure/lighthouseAssignment.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/azure/lighthouseAssignment.ts tests/lib/azure/lighthouseAssignment.test.ts
git commit -m "feat: add getGrantedRoleIds to read a subscription's actual Lighthouse authorizations"
```

---

### Task 4: `verify` route — populate `grantedRoleIds`

**Files:**
- Modify: `src/app/api/subscriptions/[id]/verify/route.ts`

**Interfaces:**
- Consumes: `getGrantedRoleIds` from `@/lib/azure/lighthouseAssignment` (Task 3).
- Produces: the `Subscription` row's `grantedRoleIds` is populated/refreshed on every successful verify.

No dedicated test for this task — this project has no existing route-handler test convention (all testable logic already lives in `src/lib/azure/lighthouseAssignment.ts`, covered by Task 3's tests). This task is a small, direct edit; manual verification happens in Task 7.

- [ ] **Step 1: Add the import**

In `src/app/api/subscriptions/[id]/verify/route.ts`, add:

```ts
import { getGrantedRoleIds } from "@/lib/azure/lighthouseAssignment";
```

- [ ] **Step 2: Fetch and persist granted roles alongside the existing status update**

Find:

```ts
  const updated = await prisma.subscription.update({
    where: { id: subscription.id },
    data: { status: "CONNECTED", connectedAt: new Date() },
  });
```

Replace with:

```ts
  let grantedRoleIds: string[] | undefined;
  try {
    grantedRoleIds = await getGrantedRoleIds(subscription.azureSubscriptionId);
  } catch (error) {
    console.error(
      `Failed to read granted Lighthouse roles for subscription ${subscription.id}`,
      error,
    );
  }

  const updated = await prisma.subscription.update({
    where: { id: subscription.id },
    data: {
      status: "CONNECTED",
      connectedAt: new Date(),
      ...(grantedRoleIds ? { grantedRoleIds } : {}),
    },
  });
```

A failed `getGrantedRoleIds` call leaves `grantedRoleIds` as `undefined`, so the spread adds
nothing to `data` and the existing row's `grantedRoleIds` (whatever it was) is left untouched —
the verify request still succeeds and `status` still becomes `CONNECTED`.

- [ ] **Step 3: Type-check and run the full existing test suite to confirm no regression**

Run: `npx tsc --noEmit`
Expected: 0 errors.
Run: `npm test`
Expected: all existing tests still pass (this route has no dedicated test file, so this step is
about confirming nothing else broke, e.g. an import cycle).

- [ ] **Step 4: Commit**

```bash
git add src/app/api/subscriptions/[id]/verify/route.ts
git commit -m "feat: populate grantedRoleIds on every successful subscription verify"
```

---

### Task 5: Ambientes UI — show the re-authorization prompt

**Files:**
- Modify: `src/app/ambientes/page.tsx`
- Modify: `src/components/ambientes/AmbientesClient.tsx`
- Modify: `src/lib/i18n/dictionaries.ts`
- Test: `tests/lib/i18n/dictionaries.test.ts`

**Interfaces:**
- Consumes: `needsPermissionUpgrade` from `@/lib/azure/lighthouseRoles` (Task 2).
- Produces: `AmbienteRow` gains `needsPermissionUpgrade: boolean`; the UI shows the existing
  "Lighthouse"/"Verificar" buttons (previously shown only for `PENDING` rows) for any `CONNECTED`
  row where `needsPermissionUpgrade` is `true`, plus a warning line.

- [ ] **Step 1: Write the failing i18n test**

Add to `tests/lib/i18n/dictionaries.test.ts`, as a new `describe` block:

```ts
describe("Ambientes permission-upgrade labels", () => {
  const keys = ["ambientes.permissionsOutdated", "ambientes.updatePermissions"];

  it("has a real translation (not a key fallback) for every key in every locale", () => {
    for (const locale of LOCALES) {
      for (const key of keys) {
        expect(translate(locale, key)).not.toBe(key);
      }
    }
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/lib/i18n/dictionaries.test.ts -t "Ambientes permission-upgrade labels"`
Expected: FAIL — the 2 keys don't exist yet.

- [ ] **Step 3: Add the 2 keys to all 3 locale blocks in `src/lib/i18n/dictionaries.ts`**

Add immediately after each locale's `"ambientes.neverScanned"` line.

`"pt-BR"` block:

```ts
    "ambientes.permissionsOutdated":
      "Esta conexão precisa de uma permissão adicional para novas verificações",
    "ambientes.updatePermissions": "Atualizar permissões",
```

`"en"` block:

```ts
    "ambientes.permissionsOutdated":
      "This connection needs an additional permission for newer checks",
    "ambientes.updatePermissions": "Update permissions",
```

`"es"` block:

```ts
    "ambientes.permissionsOutdated":
      "Esta conexión necesita un permiso adicional para verificaciones más nuevas",
    "ambientes.updatePermissions": "Actualizar permisos",
```

- [ ] **Step 4: Run the i18n test to confirm it passes**

Run: `npx vitest run tests/lib/i18n/dictionaries.test.ts`
Expected: PASS (all tests, old and new)

- [ ] **Step 5: Pass `needsPermissionUpgrade` from `page.tsx`**

In `src/app/ambientes/page.tsx`, add the import:

```ts
import { needsPermissionUpgrade } from "@/lib/azure/lighthouseRoles";
```

Change the `initialSubscriptions` mapping from:

```ts
      initialSubscriptions={subscriptions.map((s) => ({
        id: s.id,
        azureSubscriptionId: s.azureSubscriptionId,
        displayName: s.displayName,
        status: s.status,
        lastScanAt: s.costSnapshots[0]?.capturedAt.toISOString() ?? null,
      }))}
```

to:

```ts
      initialSubscriptions={subscriptions.map((s) => ({
        id: s.id,
        azureSubscriptionId: s.azureSubscriptionId,
        displayName: s.displayName,
        status: s.status,
        lastScanAt: s.costSnapshots[0]?.capturedAt.toISOString() ?? null,
        needsPermissionUpgrade: needsPermissionUpgrade(s.grantedRoleIds),
      }))}
```

- [ ] **Step 6: Update `AmbienteRow` and the render logic in `AmbientesClient.tsx`**

Change the `AmbienteRow` interface:

```ts
interface AmbienteRow {
  id: string;
  azureSubscriptionId: string;
  displayName: string;
  status: "PENDING" | "CONNECTED" | "ERROR";
  lastScanAt: string | null;
  needsPermissionUpgrade: boolean;
}
```

Change the button-visibility condition from:

```tsx
              {s.status === "PENDING" && (
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="border rounded px-3 py-1"
                    onClick={() => handleShowDeployLink(s.id)}
                  >
                    Lighthouse
                  </button>
                  <button
                    type="button"
                    className="bg-blue-600 text-white rounded px-3 py-1 hover:bg-blue-700"
                    onClick={() => handleVerify(s.id)}
                  >
                    {t("ambientes.verify")}
                  </button>
                </div>
              )}
```

to:

```tsx
              {(s.status === "PENDING" || (s.status === "CONNECTED" && s.needsPermissionUpgrade)) && (
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="border rounded px-3 py-1"
                    onClick={() => handleShowDeployLink(s.id)}
                  >
                    Lighthouse
                  </button>
                  <button
                    type="button"
                    className="bg-blue-600 text-white rounded px-3 py-1 hover:bg-blue-700"
                    onClick={() => handleVerify(s.id)}
                  >
                    {s.needsPermissionUpgrade && s.status === "CONNECTED"
                      ? t("ambientes.updatePermissions")
                      : t("ambientes.verify")}
                  </button>
                </div>
              )}
```

Add the warning line right after the status `<p>` block (after the `</p>` that renders
`ambientes.lastScan`), still inside the same `<div>`:

```tsx
                {s.status === "CONNECTED" && s.needsPermissionUpgrade && (
                  <p className="mt-1 text-sm text-amber-600">
                    {t("ambientes.permissionsOutdated")}
                  </p>
                )}
```

- [ ] **Step 7: Type-check and run the full test suite**

Run: `npx tsc --noEmit`
Expected: 0 errors.
Run: `npm test`
Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/app/ambientes/page.tsx src/components/ambientes/AmbientesClient.tsx src/lib/i18n/dictionaries.ts tests/lib/i18n/dictionaries.test.ts
git commit -m "feat: show a re-authorization prompt in Ambientes when a subscription's Lighthouse roles are outdated"
```

---

### Task 6: `lighthouse.bicep` — add the Storage Blob Data Reader role

**Files:**
- Modify: `infra/lighthouse/lighthouse.bicep`
- Modify (regenerated, not hand-edited): `infra/lighthouse/lighthouse.json`

**Interfaces:** none (infrastructure template, no code interface).

- [ ] **Step 1: Edit `infra/lighthouse/lighthouse.bicep`**

Add the new role variable after the existing `readerRoleId` line:

```bicep
var readerRoleId = 'acdd72a7-3385-48ef-bd42-f606fbe8a4b8'
var storageBlobDataReaderRoleId = '2a2b9908-6ea1-4ae2-8e65-a410df84e7d1'
```

Change the `authorizations` array inside `registrationDefinition` from:

```bicep
    authorizations: [
      {
        principalId: providerPrincipalId
        principalIdDisplayName: 'Cloud Waste Hunter Scanner'
        roleDefinitionId: readerRoleId
      }
    ]
```

to:

```bicep
    authorizations: [
      {
        principalId: providerPrincipalId
        principalIdDisplayName: 'Cloud Waste Hunter Scanner'
        roleDefinitionId: readerRoleId
      }
      {
        principalId: providerPrincipalId
        principalIdDisplayName: 'Cloud Waste Hunter Scanner (Storage)'
        roleDefinitionId: storageBlobDataReaderRoleId
      }
    ]
```

- [ ] **Step 2: Regenerate the compiled ARM template**

Run: `az bicep build --file infra/lighthouse/lighthouse.bicep`
Expected: overwrites `infra/lighthouse/lighthouse.json` in place, with a new `templateHash` in
its `metadata._generator` block and 2 entries in the `authorizations` array. Do not hand-edit
`lighthouse.json` — if `az bicep build` isn't available in the environment, stop and report this
as blocked rather than reconstructing the JSON by hand (the project's stated rule is to always
generate this file from the Bicep source).

- [ ] **Step 3: Validate the template compiles/lints cleanly**

Run: `az bicep build --file infra/lighthouse/lighthouse.bicep --stdout > /dev/null` (or simply
re-run Step 2's command — a non-zero exit code means the Bicep source has an error).
Expected: exits 0, no warnings printed about the new resource block.

- [ ] **Step 4: Commit**

```bash
git add infra/lighthouse/lighthouse.bicep infra/lighthouse/lighthouse.json
git commit -m "feat: add Storage Blob Data Reader to the Lighthouse delegation template"
```

---

### Task 7: Final verification

**Files:** none (verification only)

**Interfaces:** none

- [ ] **Step 1: Type-check the whole project**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 2: Run the full test suite**

Run: `npm test`
Expected: all tests pass (no regressions in any file touched across Tasks 1-6).

- [ ] **Step 3: Lint the whole project**

Run: `npm run lint`
Expected: 0 errors. The 3 pre-existing warnings from before this plan may still appear — confirm
no *new* warnings were introduced.

- [ ] **Step 4: Manually sanity-check the Ambientes page**

This plan cannot be end-to-end live-validated (no second Azure tenant available — see Global
Constraints). Instead: start the dev server (`npm run dev`), open `/ambientes`, and confirm the
page still renders without error for the existing `CONNECTED` test subscription (which will have
`grantedRoleIds: []` until its next `verify` call, so it should now show the new
"permissionsOutdated" warning and the reused Lighthouse/Verificar buttons — this is expected,
not a bug, since that subscription was connected before this plan's migration). Report what you
observed; do not attempt to actually complete a live re-authorization (that requires redeploying
the ARM template against the real subscription, which is a user decision, not an automatic part
of this plan).

- [ ] **Step 5: Confirm a clean git status**

Run: `git status`
Expected: clean working tree — every change from Tasks 1-6 already committed.
