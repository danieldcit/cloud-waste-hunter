# FinOps Catalog Category 4 (Managed Disks, Snapshots e Imagens) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 9 new Managed-Disk/Snapshot/Image waste-detection rules to Cloud Waste Hunter's scanner, matching the FinOps catalog's Category 4, following the exact architecture already established by Categories 1-3.

**Architecture:** Each rule is a pure (or Azure-Monitor-injectable) function in `src/lib/waste-rules/*.ts` that takes the scanner's `ResourceGraphRow[]` inventory and returns `WasteFindingCandidate[]`; `runScan.ts` spreads all rules' candidates into one array and separately estimates cost/savings per candidate. Two new Resource Graph resource types feed 2 of the 9 rules (`microsoft.compute/images`, `microsoft.compute/galleries/images/versions`); the other 7 rules read only properties already available on `microsoft.compute/disks`/`microsoft.compute/snapshots`/`microsoft.compute/virtualmachines`/`microsoft.compute/virtualmachinescalesets`, already in the query since earlier categories. One genuinely new mechanism is needed: disk-level IOPS metrics via Azure Monitor (`getAverageDiskIops`), live-validated against a real (created-and-deleted) disk before this plan was written.

**Tech Stack:** TypeScript, Next.js, Prisma (Postgres), Vitest, Azure Resource Graph / Azure Monitor / Azure Retail Prices REST APIs.

**Spec:** `docs/superpowers/specs/2026-09-13-finops-disks-category4-rules-design.md`

## Global Constraints

- All 9 new `WasteRuleType` values use `savingsCategory` per the table in spec §3 — 5 use `HARD_SAVING` (`SNAPSHOT_ORPHANED_SOURCE`, `SNAPSHOT_EXCESSIVE_COUNT`, `IMAGE_ORPHANED`) or a tiered `HARD_SAVING`/`POTENTIAL_SAVING` (`DISK_IDLE_LOW_UTILIZATION`, mirroring `IDLE_VM`'s severity table), the rest use `POTENTIAL_SAVING`. Do not default any rule to `undefined`.
- No new fields on `WasteFinding` — reuse the existing columns.
- Every rule filters `resources` by `r.type.toLowerCase()`, following the exact pattern in every existing file under `src/lib/waste-rules/`.
- `SAVINGS_METHOD_BY_RULE` in `src/lib/waste-rules/savingsEstimate.ts` is a `Record<WasteRuleType, SavingsMethod>` — TypeScript will refuse to compile until every one of the 9 new rule types has an entry. No new `SavingsMethod` string variants are needed this category — all 9 reuse `full_cost`, `premium_disk_delta`, or `unknown`, already defined.
- The IOPS metric names used by 3 rules (`Composite Disk Read Operations/sec`, `Composite Disk Write Operations/sec`) were live-validated against a real disk on 2026-09-13 (spec §1) — use this exact casing (**lowercase "sec"**), not "Sec".
- `estimatePremiumDiskDowngradeMonthlySavings` (`src/lib/azure/retailPrices.ts`, Category 3) must gain an `UltraSSD_LRS` guard (spec §4.3.1) as its own task, independent of any single rule — this also fixes a latent gap in the already-shipped `AVD_SESSION_HOST_PREMIUM_DISK_UNUSED` rule, which calls the same function.
- All new `rule.*` i18n keys must be added to all 3 locale dictionaries (`pt-BR`, `en`, `es`) in the same task — this project has shipped this gap once already (Category 1, commit `1990b72`).

---

## File Structure

New files:
- `src/lib/waste-rules/resourceNaming.ts` — generic non-prod-name heuristic, extracted from `vmssNaming.ts` so `DISK_NONPROD_PREMIUM` doesn't duplicate the regex
- `src/lib/waste-rules/diskIdleLowUtilization.ts` — rule 1 (`DISK_IDLE_LOW_UTILIZATION`)
- `src/lib/waste-rules/diskPremiumTierUnnecessary.ts` — rule 2 (`DISK_PREMIUM_TIER_UNNECESSARY`)
- `src/lib/azure/premiumDiskTiers.ts` — static IOPS-by-size-band reference table for rule 4
- `src/lib/waste-rules/diskPremiumV2Oversized.ts` — rule 3 (`DISK_PREMIUM_V2_OVERSIZED`)
- `src/lib/waste-rules/diskTierOversized.ts` — rule 4 (`DISK_TIER_OVERSIZED`)
- `src/lib/waste-rules/diskNonProdPremium.ts` — rule 5 (`DISK_NONPROD_PREMIUM`)
- `src/lib/waste-rules/snapshotOrphanedSource.ts` — rule 6 (`SNAPSHOT_ORPHANED_SOURCE`)
- `src/lib/waste-rules/snapshotExcessiveCount.ts` — rule 7 (`SNAPSHOT_EXCESSIVE_COUNT`)
- `src/lib/waste-rules/imageOrphaned.ts` — rule 8 (`IMAGE_ORPHANED`)
- `src/lib/waste-rules/galleryImageVersionOld.ts` — rule 9 (`GALLERY_IMAGE_VERSION_OLD`)
- One test file per new source file above, under the mirrored `tests/` path.
- One new Prisma migration folder under `prisma/migrations/`.

Modified files:
- `prisma/schema.prisma` — 9 new `WasteRuleType` enum values
- `src/lib/scanner/runScan.ts` — add 2 resource types to `COMBINED_QUERY_TYPES`; wire in the 9 new rules
- `src/lib/waste-rules/vmssNaming.ts` — delegate to `resourceNaming.ts` instead of its own regex
- `src/lib/azure/monitorMetrics.ts` — add `getAverageDiskIops`
- `src/lib/azure/retailPrices.ts` — add the `UltraSSD_LRS` guard to `estimatePremiumDiskDowngradeMonthlySavings`
- `src/lib/waste-rules/savingsEstimate.ts` — add 9 new `SAVINGS_METHOD_BY_RULE` entries (no new methods)
- `src/lib/dashboard-categories.ts` — add 9 new `CATEGORY_BY_RULE` entries (all `"storage"`)
- `src/lib/i18n/dictionaries.ts` — add 9 new `rule.*` keys × 3 locales
- `tests/lib/scanner/runScan.test.ts`, `tests/lib/waste-rules/savingsEstimate.test.ts`, `tests/lib/dashboard-categories.test.ts`, `tests/lib/i18n/dictionaries.test.ts`, `tests/lib/azure/retailPrices.test.ts` — extended, not replaced
- `tests/lib/waste-rules/vmssNaming.test.ts` — unchanged assertions, must still pass after the delegation refactor

---

### Task 1: Prisma schema — 9 new `WasteRuleType` values

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260913140000_add_disk_category4_finops_rules/migration.sql`

**Interfaces:**
- Produces: 9 new `WasteRuleType` enum members, usable as string literals in every later task: `DISK_IDLE_LOW_UTILIZATION`, `DISK_PREMIUM_TIER_UNNECESSARY`, `DISK_PREMIUM_V2_OVERSIZED`, `DISK_TIER_OVERSIZED`, `DISK_NONPROD_PREMIUM`, `SNAPSHOT_ORPHANED_SOURCE`, `SNAPSHOT_EXCESSIVE_COUNT`, `IMAGE_ORPHANED`, `GALLERY_IMAGE_VERSION_OLD`.

- [ ] **Step 1: Edit the enum in `prisma/schema.prisma`**

Find the `enum WasteRuleType { ... }` block and add the 9 new values immediately before the closing `}` (after `AVD_PERSONAL_HOST_UNUSED`):

```prisma
  DISK_IDLE_LOW_UTILIZATION
  DISK_PREMIUM_TIER_UNNECESSARY
  DISK_PREMIUM_V2_OVERSIZED
  DISK_TIER_OVERSIZED
  DISK_NONPROD_PREMIUM
  SNAPSHOT_ORPHANED_SOURCE
  SNAPSHOT_EXCESSIVE_COUNT
  IMAGE_ORPHANED
  GALLERY_IMAGE_VERSION_OLD
```

- [ ] **Step 2: Write the migration file by hand**

Create `prisma/migrations/20260913140000_add_disk_category4_finops_rules/migration.sql`:

```sql
-- AlterEnum
ALTER TYPE "WasteRuleType" ADD VALUE 'DISK_IDLE_LOW_UTILIZATION';
ALTER TYPE "WasteRuleType" ADD VALUE 'DISK_PREMIUM_TIER_UNNECESSARY';
ALTER TYPE "WasteRuleType" ADD VALUE 'DISK_PREMIUM_V2_OVERSIZED';
ALTER TYPE "WasteRuleType" ADD VALUE 'DISK_TIER_OVERSIZED';
ALTER TYPE "WasteRuleType" ADD VALUE 'DISK_NONPROD_PREMIUM';
ALTER TYPE "WasteRuleType" ADD VALUE 'SNAPSHOT_ORPHANED_SOURCE';
ALTER TYPE "WasteRuleType" ADD VALUE 'SNAPSHOT_EXCESSIVE_COUNT';
ALTER TYPE "WasteRuleType" ADD VALUE 'IMAGE_ORPHANED';
ALTER TYPE "WasteRuleType" ADD VALUE 'GALLERY_IMAGE_VERSION_OLD';
```

- [ ] **Step 3: Apply the migration to both the dev and test databases, and regenerate the Prisma client**

Run: `npx prisma migrate deploy` (applies to the dev DB per `.env`)
Run: `npx dotenv -e .env.test -- npx prisma migrate deploy` (applies to the test DB — Category 3 hit test-DB migration drift when this step was skipped; do it every time)
Run: `npx prisma generate`
Expected: all three succeed. If `prisma generate` reports an `EPERM`/file-lock error on Windows (a known, harmless issue seen in this project before — usually a stale dev-server process holding the native engine DLL), verify the fix actually worked anyway: `grep -c "DISK_IDLE_LOW_UTILIZATION" node_modules/.prisma/client/index.d.ts` should print a number > 0.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260913140000_add_disk_category4_finops_rules
git commit -m "feat: add WasteRuleType enum values for disk category 4 rules"
```

---

### Task 2: Resource Graph — 2 new image resource types

**Files:**
- Modify: `src/lib/scanner/runScan.ts`
- Test: `tests/lib/scanner/runScan.test.ts`

**Interfaces:**
- Produces: `COMBINED_QUERY_TYPES` now includes `microsoft.compute/images` and `microsoft.compute/galleries/images/versions` in its `where type in (...)` list.

- [ ] **Step 1: Write a failing regression test for the query's resource type list**

Add to `tests/lib/scanner/runScan.test.ts`, inside the existing `describe("COMBINED_QUERY resource types", ...)` block, as a new `it`:

```ts
  it("includes the disk category-4 image resource types", async () => {
    const { COMBINED_QUERY_TYPES } = await import("@/lib/scanner/runScan");
    expect(COMBINED_QUERY_TYPES).toEqual(
      expect.arrayContaining([
        "microsoft.compute/images",
        "microsoft.compute/galleries/images/versions",
      ]),
    );
  });
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/lib/scanner/runScan.test.ts -t "includes the disk category-4 image resource types"`
Expected: FAIL — the 2 types aren't in `COMBINED_QUERY_TYPES` yet.

- [ ] **Step 3: Add the 2 new types to `COMBINED_QUERY_TYPES`**

In `src/lib/scanner/runScan.ts`, add these 2 lines at the end of the `COMBINED_QUERY_TYPES` array (after `"microsoft.desktopvirtualization/scalingplans",`):

```ts
  "microsoft.compute/images",
  "microsoft.compute/galleries/images/versions",
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run tests/lib/scanner/runScan.test.ts -t "includes the disk category-4 image resource types"`
Expected: PASS

- [ ] **Step 5: Run the full existing runScan test suite to confirm no regression**

Run: `npx vitest run tests/lib/scanner/runScan.test.ts`
Expected: all existing tests still PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/scanner/runScan.ts tests/lib/scanner/runScan.test.ts
git commit -m "feat: add managed image and gallery image version types to Resource Graph query"
```

---

### Task 3: Shared helper — extract `resourceNaming.ts` from `vmssNaming.ts`

**Files:**
- Create: `src/lib/waste-rules/resourceNaming.ts`
- Modify: `src/lib/waste-rules/vmssNaming.ts`
- Test: `tests/lib/waste-rules/resourceNaming.test.ts`
- Test: `tests/lib/waste-rules/vmssNaming.test.ts` (must still pass unchanged — do not edit its assertions)

**Interfaces:**
- Produces: `resourceNameFromId(id: string): string`, `isNonProdResourceName(id: string): boolean`. Used by Task 11 (`DISK_NONPROD_PREMIUM`). `vmssNaming.ts`'s existing exports (`vmssNameFromId`, `isNonProdVmssName`) keep their exact names and behavior for the VMSS rules that already import them (Category 2) — this is a behavior-preserving refactor, not a rename.

- [ ] **Step 1: Write the failing test for the new generic module**

Create `tests/lib/waste-rules/resourceNaming.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { resourceNameFromId, isNonProdResourceName } from "@/lib/waste-rules/resourceNaming";

describe("resourceNameFromId", () => {
  it("returns the last path segment of a resource id", () => {
    expect(
      resourceNameFromId(
        "/subscriptions/sub-1/resourceGroups/rg1/providers/Microsoft.Compute/disks/disk-dev-01",
      ),
    ).toBe("disk-dev-01");
  });
});

describe("isNonProdResourceName", () => {
  it.each([
    "/subscriptions/sub-1/.../disks/disk-dev-01",
    "/subscriptions/sub-1/.../disks/disk-Test-web",
    "/subscriptions/sub-1/.../disks/poc-cluster-osdisk",
    "/subscriptions/sub-1/.../disks/staging-app-datadisk",
    "/subscriptions/sub-1/.../disks/qa-batch-01",
  ])("flags %s as non-production by name", (id) => {
    expect(isNonProdResourceName(id)).toBe(true);
  });

  it("does not flag a production-named resource", () => {
    expect(isNonProdResourceName("/subscriptions/sub-1/.../disks/prod-web-01-osdisk")).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/lib/waste-rules/resourceNaming.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the generic module**

Create `src/lib/waste-rules/resourceNaming.ts`:

```ts
const NONPROD_NAME_PATTERN = /dev|test|poc|staging|qa/i;

export function resourceNameFromId(id: string): string {
  const segments = id.split("/");
  return segments[segments.length - 1] ?? id;
}

export function isNonProdResourceName(id: string): boolean {
  return NONPROD_NAME_PATTERN.test(resourceNameFromId(id));
}
```

- [ ] **Step 4: Run the new test to confirm it passes**

Run: `npx vitest run tests/lib/waste-rules/resourceNaming.test.ts`
Expected: PASS

- [ ] **Step 5: Refactor `vmssNaming.ts` to delegate, without changing its exported behavior**

Replace the full contents of `src/lib/waste-rules/vmssNaming.ts`:

```ts
import { resourceNameFromId, isNonProdResourceName } from "@/lib/waste-rules/resourceNaming";

export const vmssNameFromId = resourceNameFromId;
export const isNonProdVmssName = isNonProdResourceName;
```

- [ ] **Step 6: Run the existing `vmssNaming.test.ts` to confirm the refactor is behavior-preserving**

Run: `npx vitest run tests/lib/waste-rules/vmssNaming.test.ts`
Expected: PASS — same assertions as before, unchanged, still pass against the new delegating implementation. Do not edit this test file's expectations; if it fails, the refactor broke behavior and must be fixed, not the test.

- [ ] **Step 7: Run the full VMSS rule test suite to confirm nothing downstream broke**

Run: `npx vitest run tests/lib/waste-rules/vmssNonProdNoSchedule.test.ts tests/lib/waste-rules/vmssSpotEligible.test.ts`
Expected: all PASS — these Category 2 rules import `isNonProdVmssName` and must be unaffected.

- [ ] **Step 8: Commit**

```bash
git add src/lib/waste-rules/resourceNaming.ts src/lib/waste-rules/vmssNaming.ts tests/lib/waste-rules/resourceNaming.test.ts
git commit -m "refactor: extract generic non-prod-name heuristic from vmssNaming into resourceNaming"
```

---

### Task 4: Monitor Metrics — disk IOPS (`getAverageDiskIops`)

**Files:**
- Modify: `src/lib/azure/monitorMetrics.ts`
- Test: `tests/lib/azure/monitorMetrics.test.ts`

**Interfaces:**
- Produces: `getAverageDiskIops(resourceId: string, days?: number, now?: Date): Promise<number>` — sum of average Read + Write IOPS/sec over the period. Consumed by Tasks 6, 7, 9, 10 (rules 1-4).

- [ ] **Step 1: Write the failing test**

First, extend the existing top-of-file import to add `getAverageDiskIops` (do not add a second, duplicate import line):

```ts
import { getAverageCpuPercent, getHourlyCpuBelowThreshold, getAverageDiskIops } from "@/lib/azure/monitorMetrics";
```

Then add a new `describe` block, after the existing ones — check the top of the file for how `armFetch` is mocked/spied and match that exact pattern, e.g. `vi.spyOn(armFetchModule, "armFetch")`:

```ts
describe("getAverageDiskIops", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("sums the average Read and Write IOPS/sec metrics over the period", async () => {
    const spy = vi.spyOn(armFetchModule, "armFetch").mockImplementation(async (url: string) => {
      if (url.includes("Read%20Operations")) {
        return {
          value: [{ timeseries: [{ data: [{ timeStamp: "2026-09-01T00:00:00Z", average: 3 }] }] }],
        };
      }
      return {
        value: [{ timeseries: [{ data: [{ timeStamp: "2026-09-01T00:00:00Z", average: 2 }] }] }],
      };
    });

    const iops = await getAverageDiskIops("/subscriptions/sub-1/disks/disk-1");

    expect(iops).toBe(5);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("returns 0 when there are no data points for either metric", async () => {
    vi.spyOn(armFetchModule, "armFetch").mockResolvedValue({
      value: [{ timeseries: [{ data: [] }] }],
    });

    const iops = await getAverageDiskIops("/subscriptions/sub-1/disks/disk-1");

    expect(iops).toBe(0);
  });

  it("queries the exact lowercase metric names confirmed live against the real API", async () => {
    const spy = vi
      .spyOn(armFetchModule, "armFetch")
      .mockResolvedValue({ value: [{ timeseries: [{ data: [] }] }] });

    await getAverageDiskIops("/subscriptions/sub-1/disks/disk-1", 30);

    const readUrl = spy.mock.calls[0][0] as string;
    const writeUrl = spy.mock.calls[1][0] as string;
    expect(decodeURIComponent(readUrl)).toContain("Composite Disk Read Operations/sec");
    expect(decodeURIComponent(writeUrl)).toContain("Composite Disk Write Operations/sec");
    expect(readUrl).toContain("interval=P1D");
  });
});
```

(If this test file doesn't already import `armFetchModule` the way `getHourlyCpuBelowThreshold`'s tests do, check the top of `tests/lib/azure/monitorMetrics.test.ts` for the exact existing import/mock pattern and match it — do not introduce a second, different mocking style in the same file.)

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/lib/azure/monitorMetrics.test.ts -t "getAverageDiskIops"`
Expected: FAIL — `getAverageDiskIops` is not exported yet.

- [ ] **Step 3: Implement**

In `src/lib/azure/monitorMetrics.ts`, add below the existing functions:

```ts
async function getAverageMetric(
  resourceId: string,
  metricName: string,
  days: number,
  now: Date,
): Promise<number> {
  const start = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const timespan = `${start.toISOString()}/${now.toISOString()}`;
  const url =
    `https://management.azure.com${resourceId}/providers/Microsoft.Insights/metrics` +
    `?api-version=2018-01-01&metricnames=${encodeURIComponent(metricName)}` +
    `&aggregation=Average&interval=P1D&timespan=${encodeURIComponent(timespan)}`;

  const response = await armFetch<MetricsResponse>(url);

  const points = response.value[0]?.timeseries?.[0]?.data ?? [];
  const values = points
    .map((p) => p.average)
    .filter((v): v is number => typeof v === "number");

  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Average disk IOPS (Read + Write combined) over the period. Metric names confirmed live
 * against a real disk on 2026-09-13 — lowercase "sec", flagged "(Preview)" by Azure (see spec
 * for Category 4). Two separate metric calls (mirroring the single-metric pattern already used
 * by `getAverageCpuPercent`) rather than one call requesting both names, to avoid needing to
 * align two timeseries by index — summing each metric's own period average is equivalent when
 * both cover the same timespan/interval.
 */
export async function getAverageDiskIops(
  resourceId: string,
  days = 30,
  now: Date = new Date(),
): Promise<number> {
  const [readIops, writeIops] = await Promise.all([
    getAverageMetric(resourceId, "Composite Disk Read Operations/sec", days, now),
    getAverageMetric(resourceId, "Composite Disk Write Operations/sec", days, now),
  ]);
  return readIops + writeIops;
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run tests/lib/azure/monitorMetrics.test.ts`
Expected: PASS (all tests, old and new)

- [ ] **Step 5: Commit**

```bash
git add src/lib/azure/monitorMetrics.ts tests/lib/azure/monitorMetrics.test.ts
git commit -m "feat: add disk IOPS metric for idle/oversized disk rules"
```

---

### Task 5: `estimatePremiumDiskDowngradeMonthlySavings` — Ultra Disk guard

**Files:**
- Modify: `src/lib/azure/retailPrices.ts`
- Test: `tests/lib/azure/retailPrices.test.ts`

**Interfaces:**
- Modifies: `estimatePremiumDiskDowngradeMonthlySavings(resource)` now returns `null` immediately (no network call) when `resource.sku?.name === "UltraSSD_LRS"`. Signature unchanged — no caller (Category 3's AVD rule, or this category's rules 2 and 5) needs any change.

- [ ] **Step 1: Write the failing test**

Add to `tests/lib/azure/retailPrices.test.ts`, inside the existing `describe("estimatePremiumDiskDowngradeMonthlySavings", ...)` block:

```ts
  it("returns null immediately for UltraSSD_LRS without calling fetch (Ultra isn't tier-priced)", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const savings = await estimatePremiumDiskDowngradeMonthlySavings(
      diskResource("UltraSSD_LRS", 128),
    );

    expect(savings).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/lib/azure/retailPrices.test.ts -t "UltraSSD_LRS"`
Expected: FAIL — the function currently calls `fetch` for any SKU, including Ultra.

- [ ] **Step 3: Implement**

In `src/lib/azure/retailPrices.ts`, modify `estimatePremiumDiskDowngradeMonthlySavings`:

```ts
export async function estimatePremiumDiskDowngradeMonthlySavings(
  resource: ResourceGraphRow,
): Promise<number | null> {
  if (resource.sku?.name === "UltraSSD_LRS") {
    // Ultra Disk is priced by configured IOPS/throughput, not a fixed size tier —
    // diskSkuMeterName's tier-name lookup doesn't apply to it, and reusing it here would price
    // against the wrong family entirely. Detection rules may still flag Ultra disks; this
    // function just refuses to fabricate a number for them.
    return null;
  }
  try {
    const premiumCost = await estimateDiskCost(resource);
    const standardEquivalent: ResourceGraphRow = {
      ...resource,
      sku: { ...resource.sku, name: "StandardSSD_LRS" },
    };
    const standardCost = await estimateDiskCost(standardEquivalent);
    const delta = premiumCost - standardCost;
    return delta > 0 ? delta : null;
  } catch (error) {
    console.error(`Premium disk downgrade savings estimation failed for ${resource.id}`, error);
    return null;
  }
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run tests/lib/azure/retailPrices.test.ts`
Expected: PASS (all tests, old and new — including the existing Premium/StandardSSD delta tests, which are unaffected since they never use `UltraSSD_LRS`)

- [ ] **Step 5: Run the AVD rule that also uses this function, to confirm no regression**

Run: `npx vitest run tests/lib/waste-rules/avdSessionHostPremiumDiskUnused.test.ts`
Expected: PASS — this rule's existing tests use `Premium_LRS`/`Premium_ZRS`/`PremiumV2_LRS`/`UltraSSD_LRS` fixtures but never previously asserted on the *savings number* for the Ultra case (that's computed later, in `savingsEstimate.ts`, out of this rule's own test scope) — so no test here should need updating, only confirming nothing broke.

- [ ] **Step 6: Commit**

```bash
git add src/lib/azure/retailPrices.ts tests/lib/azure/retailPrices.test.ts
git commit -m "fix: never fabricate a premium-disk-downgrade savings number for UltraSSD_LRS"
```

---

### Task 6: Rule `DISK_IDLE_LOW_UTILIZATION`

**Files:**
- Create: `src/lib/waste-rules/diskIdleLowUtilization.ts`
- Test: `tests/lib/waste-rules/diskIdleLowUtilization.test.ts`

**Interfaces:**
- Consumes: `getAverageDiskIops` from `@/lib/azure/monitorMetrics` (Task 4).
- Produces: `findDiskIdleLowUtilization(resources: ResourceGraphRow[], getAverageIops?): Promise<WasteFindingCandidate[]>`.

- [ ] **Step 1: Write the failing test**

Create `tests/lib/waste-rules/diskIdleLowUtilization.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import { findDiskIdleLowUtilization } from "@/lib/waste-rules/diskIdleLowUtilization";

function disk(id: string, diskState = "Attached"): ResourceGraphRow {
  return {
    id,
    type: "microsoft.compute/disks",
    subscriptionId: "sub-1",
    properties: { diskState },
  };
}

describe("findDiskIdleLowUtilization", () => {
  it("flags a disk with under 1 IOPS average over 90 days as HARD_SAVING", async () => {
    const getAverageIops = vi.fn().mockResolvedValue(0.2);
    const resources = [disk("/subscriptions/sub-1/disks/disk-1")];

    const result = await findDiskIdleLowUtilization(resources, getAverageIops);

    expect(result).toEqual([
      {
        ruleType: "DISK_IDLE_LOW_UTILIZATION",
        resourceId: "/subscriptions/sub-1/disks/disk-1",
        subscriptionId: "sub-1",
        savingsCategory: "HARD_SAVING",
        metricObserved: 0.2,
        periodAnalyzedDays: 90,
      },
    ]);
  });

  it("flags a disk with moderate IOPS (5-10 range, 30 days) as POTENTIAL_SAVING", async () => {
    const getAverageIops = vi.fn().mockImplementation(async (_id: string, days: number) => {
      if (days === 90) return 12;
      if (days === 60) return 12;
      if (days === 30) return 7;
      return 12;
    });
    const resources = [disk("/subscriptions/sub-1/disks/disk-2")];

    const result = await findDiskIdleLowUtilization(resources, getAverageIops);

    expect(result).toEqual([
      {
        ruleType: "DISK_IDLE_LOW_UTILIZATION",
        resourceId: "/subscriptions/sub-1/disks/disk-2",
        subscriptionId: "sub-1",
        savingsCategory: "POTENTIAL_SAVING",
        metricObserved: 7,
        periodAnalyzedDays: 30,
      },
    ]);
  });

  it("does not flag a disk with healthy IOPS", async () => {
    const getAverageIops = vi.fn().mockResolvedValue(500);
    const resources = [disk("/subscriptions/sub-1/disks/disk-3")];

    expect(await findDiskIdleLowUtilization(resources, getAverageIops)).toEqual([]);
  });

  it("does not evaluate an Unattached disk (already covered by ORPHANED_DISK)", async () => {
    const getAverageIops = vi.fn();
    const resources = [disk("/subscriptions/sub-1/disks/disk-4", "Unattached")];

    expect(await findDiskIdleLowUtilization(resources, getAverageIops)).toEqual([]);
    expect(getAverageIops).not.toHaveBeenCalled();
  });

  it("ignores non-disk resources", () => {
    const vm: ResourceGraphRow = {
      id: "/subscriptions/sub-1/virtualMachines/vm-1",
      type: "microsoft.compute/virtualmachines",
      subscriptionId: "sub-1",
      properties: {},
    };
    return expect(findDiskIdleLowUtilization([vm], vi.fn())).resolves.toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/lib/waste-rules/diskIdleLowUtilization.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/lib/waste-rules/diskIdleLowUtilization.ts`:

```ts
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import type { WasteFindingCandidate } from "@/lib/waste-rules/types";
import { getAverageDiskIops } from "@/lib/azure/monitorMetrics";

interface IopsSeverityTier {
  maxIops: number;
  days: 30 | 60 | 90;
  savingsCategory: "HARD_SAVING" | "POTENTIAL_SAVING";
}

/** Ordered from most to least severe — the first matching tier wins. IOPS thresholds are
 * absolute, not relative to the disk's own tier — even the smallest Standard HDD tier has
 * hundreds of IOPS of capacity, so fractional-digit observed IOPS is unambiguous waste. */
const IOPS_SEVERITY_TIERS: IopsSeverityTier[] = [
  { maxIops: 1, days: 90, savingsCategory: "HARD_SAVING" },
  { maxIops: 1, days: 30, savingsCategory: "HARD_SAVING" },
  { maxIops: 5, days: 60, savingsCategory: "POTENTIAL_SAVING" },
  { maxIops: 10, days: 30, savingsCategory: "POTENTIAL_SAVING" },
];

export async function findDiskIdleLowUtilization(
  resources: ResourceGraphRow[],
  getAverageIops: (resourceId: string, days: number) => Promise<number> = getAverageDiskIops,
): Promise<WasteFindingCandidate[]> {
  const disks = resources.filter(
    (r) =>
      r.type.toLowerCase() === "microsoft.compute/disks" &&
      r.properties.diskState === "Attached",
  );

  const candidates: WasteFindingCandidate[] = [];
  for (const disk of disks) {
    const [iops30, iops60, iops90] = await Promise.all([
      getAverageIops(disk.id, 30),
      getAverageIops(disk.id, 60),
      getAverageIops(disk.id, 90),
    ]);
    const iopsByWindow = new Map<number, number>([
      [30, iops30],
      [60, iops60],
      [90, iops90],
    ]);

    const matchedTier = IOPS_SEVERITY_TIERS.find(
      (tier) => (iopsByWindow.get(tier.days) ?? Infinity) < tier.maxIops,
    );
    if (matchedTier) {
      candidates.push({
        ruleType: "DISK_IDLE_LOW_UTILIZATION",
        resourceId: disk.id,
        subscriptionId: disk.subscriptionId,
        savingsCategory: matchedTier.savingsCategory,
        metricObserved: iopsByWindow.get(matchedTier.days)!,
        periodAnalyzedDays: matchedTier.days,
      });
    }
  }
  return candidates;
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run tests/lib/waste-rules/diskIdleLowUtilization.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/waste-rules/diskIdleLowUtilization.ts tests/lib/waste-rules/diskIdleLowUtilization.test.ts
git commit -m "feat: add DISK_IDLE_LOW_UTILIZATION waste rule"
```

---

### Task 7: Rule `DISK_PREMIUM_TIER_UNNECESSARY`

**Files:**
- Create: `src/lib/waste-rules/diskPremiumTierUnnecessary.ts`
- Test: `tests/lib/waste-rules/diskPremiumTierUnnecessary.test.ts`

**Interfaces:**
- Consumes: `getAverageDiskIops` from `@/lib/azure/monitorMetrics` (Task 4).
- Produces: `findDiskPremiumTierUnnecessary(resources, getAverageIops?): Promise<WasteFindingCandidate[]>`.

- [ ] **Step 1: Write the failing test**

Create `tests/lib/waste-rules/diskPremiumTierUnnecessary.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import { findDiskPremiumTierUnnecessary } from "@/lib/waste-rules/diskPremiumTierUnnecessary";

function disk(id: string, skuName: string): ResourceGraphRow {
  return {
    id,
    type: "microsoft.compute/disks",
    subscriptionId: "sub-1",
    sku: { name: skuName },
    properties: { diskState: "Attached" },
  };
}

describe("findDiskPremiumTierUnnecessary", () => {
  it.each(["Premium_LRS", "Premium_ZRS", "UltraSSD_LRS"])(
    "flags a %s disk with average IOPS below 500",
    async (skuName) => {
      const getAverageIops = vi.fn().mockResolvedValue(120);
      const resources = [disk("/subscriptions/sub-1/disks/disk-1", skuName)];

      const result = await findDiskPremiumTierUnnecessary(resources, getAverageIops);

      expect(result).toEqual([
        {
          ruleType: "DISK_PREMIUM_TIER_UNNECESSARY",
          resourceId: "/subscriptions/sub-1/disks/disk-1",
          subscriptionId: "sub-1",
          savingsCategory: "POTENTIAL_SAVING",
          metricObserved: 120,
          periodAnalyzedDays: 30,
        },
      ]);
    },
  );

  it("does not flag a Premium disk with IOPS at or above the threshold", async () => {
    const getAverageIops = vi.fn().mockResolvedValue(500);
    const resources = [disk("/subscriptions/sub-1/disks/disk-2", "Premium_LRS")];

    expect(await findDiskPremiumTierUnnecessary(resources, getAverageIops)).toEqual([]);
  });

  it("does not flag a Standard disk", async () => {
    const getAverageIops = vi.fn().mockResolvedValue(1);
    const resources = [disk("/subscriptions/sub-1/disks/disk-3", "Standard_LRS")];

    expect(await findDiskPremiumTierUnnecessary(resources, getAverageIops)).toEqual([]);
    expect(getAverageIops).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/lib/waste-rules/diskPremiumTierUnnecessary.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/lib/waste-rules/diskPremiumTierUnnecessary.ts`:

```ts
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import type { WasteFindingCandidate } from "@/lib/waste-rules/types";
import { getAverageDiskIops } from "@/lib/azure/monitorMetrics";

const PREMIUM_SKUS = new Set(["Premium_LRS", "Premium_ZRS", "UltraSSD_LRS"]);
const IOPS_THRESHOLD = 500;
const WINDOW_DAYS = 30;

export async function findDiskPremiumTierUnnecessary(
  resources: ResourceGraphRow[],
  getAverageIops: (resourceId: string, days: number) => Promise<number> = getAverageDiskIops,
): Promise<WasteFindingCandidate[]> {
  const disks = resources.filter(
    (r) => r.type.toLowerCase() === "microsoft.compute/disks" && PREMIUM_SKUS.has(r.sku?.name ?? ""),
  );

  const candidates: WasteFindingCandidate[] = [];
  for (const disk of disks) {
    const avgIops = await getAverageIops(disk.id, WINDOW_DAYS);
    if (avgIops < IOPS_THRESHOLD) {
      candidates.push({
        ruleType: "DISK_PREMIUM_TIER_UNNECESSARY",
        resourceId: disk.id,
        subscriptionId: disk.subscriptionId,
        savingsCategory: "POTENTIAL_SAVING",
        metricObserved: avgIops,
        periodAnalyzedDays: WINDOW_DAYS,
      });
    }
  }
  return candidates;
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run tests/lib/waste-rules/diskPremiumTierUnnecessary.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/waste-rules/diskPremiumTierUnnecessary.ts tests/lib/waste-rules/diskPremiumTierUnnecessary.test.ts
git commit -m "feat: add DISK_PREMIUM_TIER_UNNECESSARY waste rule"
```

---

### Task 8: `premiumDiskTiers.ts` — IOPS-by-size reference table

**Files:**
- Create: `src/lib/azure/premiumDiskTiers.ts`
- Test: `tests/lib/azure/premiumDiskTiers.test.ts`

**Interfaces:**
- Produces: `maxIopsForPremiumDiskSize(sizeGb: number): number`. Consumed by Task 10 (rule 4).

- [ ] **Step 1: Write the failing test**

Create `tests/lib/azure/premiumDiskTiers.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { maxIopsForPremiumDiskSize } from "@/lib/azure/premiumDiskTiers";

describe("maxIopsForPremiumDiskSize", () => {
  it.each([
    [4, 120],
    [32, 120],
    [64, 240],
    [128, 500],
    [256, 1100],
    [512, 2300],
    [1024, 5000],
    [2048, 7500],
    [4096, 7500],
    [8192, 16000],
    [16384, 18000],
    [32767, 20000],
  ])("returns %i IOPS max capacity for a %i GiB disk", (sizeGb, expectedIops) => {
    expect(maxIopsForPremiumDiskSize(sizeGb)).toBe(expectedIops);
  });

  it("rounds a size between two bands up to the next tier's capacity (100 GiB -> P10's 500 IOPS)", () => {
    expect(maxIopsForPremiumDiskSize(100)).toBe(500);
  });

  it("clamps a size larger than the largest published tier to P80's capacity", () => {
    expect(maxIopsForPremiumDiskSize(65536)).toBe(20000);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/lib/azure/premiumDiskTiers.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/lib/azure/premiumDiskTiers.ts`:

```ts
interface PremiumDiskTierBand {
  maxSizeGb: number;
  maxIops: number;
}

/**
 * Premium SSD size -> maximum IOPS capacity per tier, from Microsoft's published Managed Disks
 * documentation. Not live-validated (would require provisioning a disk at every tier just to
 * read its capability — real cost beyond the single live validation already done for this
 * category, see the Category 4 spec §1). Revisit if Azure changes these published limits.
 *
 * Deliberately independent from `diskSkuMeterName` in `retailPrices.ts`, even though both use
 * the same underlying Microsoft-documented size breakpoints — one answers "what does this cost"
 * (a pricing-tier name), the other "what can this do" (an IOPS ceiling). They're different facts
 * that happen to share size boundaries; coupling the two modules together isn't warranted.
 */
const PREMIUM_DISK_TIER_LADDER: PremiumDiskTierBand[] = [
  { maxSizeGb: 32, maxIops: 120 },
  { maxSizeGb: 64, maxIops: 240 },
  { maxSizeGb: 128, maxIops: 500 },
  { maxSizeGb: 256, maxIops: 1100 },
  { maxSizeGb: 512, maxIops: 2300 },
  { maxSizeGb: 1024, maxIops: 5000 },
  { maxSizeGb: 2048, maxIops: 7500 },
  { maxSizeGb: 4096, maxIops: 7500 },
  { maxSizeGb: 8192, maxIops: 16000 },
  { maxSizeGb: 16384, maxIops: 18000 },
  { maxSizeGb: 32767, maxIops: 20000 },
];

/** Smallest band whose capacity covers `sizeGb` (disks always round up to the next tier); clamps to the largest published tier for anything beyond it. */
export function maxIopsForPremiumDiskSize(sizeGb: number): number {
  const band = PREMIUM_DISK_TIER_LADDER.find((b) => sizeGb <= b.maxSizeGb);
  return (band ?? PREMIUM_DISK_TIER_LADDER[PREMIUM_DISK_TIER_LADDER.length - 1]).maxIops;
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run tests/lib/azure/premiumDiskTiers.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/azure/premiumDiskTiers.ts tests/lib/azure/premiumDiskTiers.test.ts
git commit -m "feat: add Premium SSD IOPS-by-size reference table"
```

---

### Task 9: Rule `DISK_PREMIUM_V2_OVERSIZED`

**Files:**
- Create: `src/lib/waste-rules/diskPremiumV2Oversized.ts`
- Test: `tests/lib/waste-rules/diskPremiumV2Oversized.test.ts`

**Interfaces:**
- Consumes: `getAverageDiskIops` from `@/lib/azure/monitorMetrics` (Task 4).
- Produces: `findDiskPremiumV2Oversized(resources, getAverageIops?): Promise<WasteFindingCandidate[]>`.

- [ ] **Step 1: Write the failing test**

Create `tests/lib/waste-rules/diskPremiumV2Oversized.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import { findDiskPremiumV2Oversized } from "@/lib/waste-rules/diskPremiumV2Oversized";

function premiumV2Disk(id: string, diskIOPSReadWrite?: number): ResourceGraphRow {
  return {
    id,
    type: "microsoft.compute/disks",
    subscriptionId: "sub-1",
    sku: { name: "PremiumV2_LRS" },
    properties: { diskState: "Attached", diskIOPSReadWrite },
  };
}

describe("findDiskPremiumV2Oversized", () => {
  it("flags a PremiumV2 disk whose configured IOPS is at least 3x the observed average", async () => {
    const getAverageIops = vi.fn().mockResolvedValue(1000);
    const resources = [premiumV2Disk("/subscriptions/sub-1/disks/disk-1", 3000)];

    const result = await findDiskPremiumV2Oversized(resources, getAverageIops);

    expect(result).toEqual([
      {
        ruleType: "DISK_PREMIUM_V2_OVERSIZED",
        resourceId: "/subscriptions/sub-1/disks/disk-1",
        subscriptionId: "sub-1",
        savingsCategory: "POTENTIAL_SAVING",
        metricObserved: 1000,
        periodAnalyzedDays: 30,
      },
    ]);
  });

  it("does not flag when configured IOPS is proportionate to observed usage", async () => {
    const getAverageIops = vi.fn().mockResolvedValue(1000);
    const resources = [premiumV2Disk("/subscriptions/sub-1/disks/disk-2", 1500)];

    expect(await findDiskPremiumV2Oversized(resources, getAverageIops)).toEqual([]);
  });

  it("skips a PremiumV2 disk with no configured diskIOPSReadWrite value", async () => {
    const getAverageIops = vi.fn();
    const resources = [premiumV2Disk("/subscriptions/sub-1/disks/disk-3", undefined)];

    expect(await findDiskPremiumV2Oversized(resources, getAverageIops)).toEqual([]);
    expect(getAverageIops).not.toHaveBeenCalled();
  });

  it("ignores non-PremiumV2 disks", async () => {
    const getAverageIops = vi.fn();
    const resources: ResourceGraphRow[] = [
      {
        id: "/subscriptions/sub-1/disks/disk-4",
        type: "microsoft.compute/disks",
        subscriptionId: "sub-1",
        sku: { name: "Premium_LRS" },
        properties: { diskState: "Attached" },
      },
    ];

    expect(await findDiskPremiumV2Oversized(resources, getAverageIops)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/lib/waste-rules/diskPremiumV2Oversized.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/lib/waste-rules/diskPremiumV2Oversized.ts`:

```ts
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import type { WasteFindingCandidate } from "@/lib/waste-rules/types";
import { getAverageDiskIops } from "@/lib/azure/monitorMetrics";

const OVERSIZED_RATIO_THRESHOLD = 3;
const WINDOW_DAYS = 30;

interface PremiumV2DiskProperties {
  diskIOPSReadWrite?: number;
}

export async function findDiskPremiumV2Oversized(
  resources: ResourceGraphRow[],
  getAverageIops: (resourceId: string, days: number) => Promise<number> = getAverageDiskIops,
): Promise<WasteFindingCandidate[]> {
  const disks = resources.filter(
    (r) => r.type.toLowerCase() === "microsoft.compute/disks" && r.sku?.name === "PremiumV2_LRS",
  );

  const candidates: WasteFindingCandidate[] = [];
  for (const disk of disks) {
    const configuredIops = (disk.properties as PremiumV2DiskProperties).diskIOPSReadWrite;
    if (!configuredIops) {
      continue;
    }
    const avgIops = await getAverageIops(disk.id, WINDOW_DAYS);
    if (configuredIops >= avgIops * OVERSIZED_RATIO_THRESHOLD) {
      candidates.push({
        ruleType: "DISK_PREMIUM_V2_OVERSIZED",
        resourceId: disk.id,
        subscriptionId: disk.subscriptionId,
        savingsCategory: "POTENTIAL_SAVING",
        metricObserved: avgIops,
        periodAnalyzedDays: WINDOW_DAYS,
      });
    }
  }
  return candidates;
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run tests/lib/waste-rules/diskPremiumV2Oversized.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/waste-rules/diskPremiumV2Oversized.ts tests/lib/waste-rules/diskPremiumV2Oversized.test.ts
git commit -m "feat: add DISK_PREMIUM_V2_OVERSIZED waste rule"
```

---

### Task 10: Rule `DISK_TIER_OVERSIZED`

**Files:**
- Create: `src/lib/waste-rules/diskTierOversized.ts`
- Test: `tests/lib/waste-rules/diskTierOversized.test.ts`

**Interfaces:**
- Consumes: `getAverageDiskIops` from `@/lib/azure/monitorMetrics` (Task 4); `maxIopsForPremiumDiskSize` from `@/lib/azure/premiumDiskTiers` (Task 8).
- Produces: `findDiskTierOversized(resources, getAverageIops?): Promise<WasteFindingCandidate[]>`.

- [ ] **Step 1: Write the failing test**

Create `tests/lib/waste-rules/diskTierOversized.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import { findDiskTierOversized } from "@/lib/waste-rules/diskTierOversized";

function premiumDisk(id: string, sizeGb: number, skuName = "Premium_LRS"): ResourceGraphRow {
  return {
    id,
    type: "microsoft.compute/disks",
    subscriptionId: "sub-1",
    sku: { name: skuName },
    properties: { diskState: "Attached", diskSizeGB: sizeGb },
  };
}

describe("findDiskTierOversized", () => {
  it("flags a P30 (1024 GiB, 5000 IOPS max) disk whose observed IOPS is under 20% of that", async () => {
    const getAverageIops = vi.fn().mockResolvedValue(500); // 500 < 5000 * 0.2 = 1000
    const resources = [premiumDisk("/subscriptions/sub-1/disks/disk-1", 1024)];

    const result = await findDiskTierOversized(resources, getAverageIops);

    expect(result).toEqual([
      {
        ruleType: "DISK_TIER_OVERSIZED",
        resourceId: "/subscriptions/sub-1/disks/disk-1",
        subscriptionId: "sub-1",
        savingsCategory: "POTENTIAL_SAVING",
        metricObserved: 500,
        periodAnalyzedDays: 30,
      },
    ]);
  });

  it("does not flag a disk whose observed IOPS is at or above 20% of its tier's max", async () => {
    const getAverageIops = vi.fn().mockResolvedValue(1000); // 1000 >= 5000 * 0.2
    const resources = [premiumDisk("/subscriptions/sub-1/disks/disk-2", 1024)];

    expect(await findDiskTierOversized(resources, getAverageIops)).toEqual([]);
  });

  it("does not evaluate a Standard disk", async () => {
    const getAverageIops = vi.fn();
    const resources = [premiumDisk("/subscriptions/sub-1/disks/disk-3", 1024, "Standard_LRS")];

    expect(await findDiskTierOversized(resources, getAverageIops)).toEqual([]);
    expect(getAverageIops).not.toHaveBeenCalled();
  });

  it("does not evaluate UltraSSD_LRS (not a fixed size tier)", async () => {
    const getAverageIops = vi.fn();
    const resources = [premiumDisk("/subscriptions/sub-1/disks/disk-4", 1024, "UltraSSD_LRS")];

    expect(await findDiskTierOversized(resources, getAverageIops)).toEqual([]);
    expect(getAverageIops).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/lib/waste-rules/diskTierOversized.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/lib/waste-rules/diskTierOversized.ts`:

```ts
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import type { WasteFindingCandidate } from "@/lib/waste-rules/types";
import { getAverageDiskIops } from "@/lib/azure/monitorMetrics";
import { maxIopsForPremiumDiskSize } from "@/lib/azure/premiumDiskTiers";

const PREMIUM_SKUS = new Set(["Premium_LRS", "Premium_ZRS"]);
const UNDERUSED_RATIO_THRESHOLD = 0.2;
const WINDOW_DAYS = 30;

export async function findDiskTierOversized(
  resources: ResourceGraphRow[],
  getAverageIops: (resourceId: string, days: number) => Promise<number> = getAverageDiskIops,
): Promise<WasteFindingCandidate[]> {
  const disks = resources.filter(
    (r) => r.type.toLowerCase() === "microsoft.compute/disks" && PREMIUM_SKUS.has(r.sku?.name ?? ""),
  );

  const candidates: WasteFindingCandidate[] = [];
  for (const disk of disks) {
    const sizeGb = Number(disk.properties.diskSizeGB) || 0;
    if (sizeGb <= 0) {
      continue;
    }
    const maxIops = maxIopsForPremiumDiskSize(sizeGb);
    const avgIops = await getAverageIops(disk.id, WINDOW_DAYS);
    if (avgIops < maxIops * UNDERUSED_RATIO_THRESHOLD) {
      candidates.push({
        ruleType: "DISK_TIER_OVERSIZED",
        resourceId: disk.id,
        subscriptionId: disk.subscriptionId,
        savingsCategory: "POTENTIAL_SAVING",
        metricObserved: avgIops,
        periodAnalyzedDays: WINDOW_DAYS,
      });
    }
  }
  return candidates;
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run tests/lib/waste-rules/diskTierOversized.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/waste-rules/diskTierOversized.ts tests/lib/waste-rules/diskTierOversized.test.ts
git commit -m "feat: add DISK_TIER_OVERSIZED waste rule"
```

---

### Task 11: Rule `DISK_NONPROD_PREMIUM`

**Files:**
- Create: `src/lib/waste-rules/diskNonProdPremium.ts`
- Test: `tests/lib/waste-rules/diskNonProdPremium.test.ts`

**Interfaces:**
- Consumes: `isNonProdResourceName` from `@/lib/waste-rules/resourceNaming` (Task 3).
- Produces: `findDiskNonProdPremium(resources: ResourceGraphRow[]): WasteFindingCandidate[]`.

- [ ] **Step 1: Write the failing test**

Create `tests/lib/waste-rules/diskNonProdPremium.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import { findDiskNonProdPremium } from "@/lib/waste-rules/diskNonProdPremium";

function disk(id: string, skuName: string): ResourceGraphRow {
  return {
    id,
    type: "microsoft.compute/disks",
    subscriptionId: "sub-1",
    sku: { name: skuName },
    properties: {},
  };
}

describe("findDiskNonProdPremium", () => {
  it.each(["Premium_LRS", "Premium_ZRS", "UltraSSD_LRS"])(
    "flags a %s disk with a non-prod name",
    (skuName) => {
      const resources = [disk("/subscriptions/sub-1/disks/dev-app-osdisk", skuName)];

      expect(findDiskNonProdPremium(resources)).toEqual([
        {
          ruleType: "DISK_NONPROD_PREMIUM",
          resourceId: "/subscriptions/sub-1/disks/dev-app-osdisk",
          subscriptionId: "sub-1",
          savingsCategory: "POTENTIAL_SAVING",
        },
      ]);
    },
  );

  it("does not flag a production-named Premium disk", () => {
    const resources = [disk("/subscriptions/sub-1/disks/prod-app-osdisk", "Premium_LRS")];
    expect(findDiskNonProdPremium(resources)).toEqual([]);
  });

  it("does not flag a non-prod-named Standard disk", () => {
    const resources = [disk("/subscriptions/sub-1/disks/dev-app-osdisk", "Standard_LRS")];
    expect(findDiskNonProdPremium(resources)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/lib/waste-rules/diskNonProdPremium.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/lib/waste-rules/diskNonProdPremium.ts`:

```ts
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import type { WasteFindingCandidate } from "@/lib/waste-rules/types";
import { isNonProdResourceName } from "@/lib/waste-rules/resourceNaming";

const PREMIUM_SKUS = new Set(["Premium_LRS", "Premium_ZRS", "UltraSSD_LRS"]);

export function findDiskNonProdPremium(resources: ResourceGraphRow[]): WasteFindingCandidate[] {
  return resources
    .filter(
      (r) =>
        r.type.toLowerCase() === "microsoft.compute/disks" &&
        PREMIUM_SKUS.has(r.sku?.name ?? "") &&
        isNonProdResourceName(r.id),
    )
    .map((r) => ({
      ruleType: "DISK_NONPROD_PREMIUM" as const,
      resourceId: r.id,
      subscriptionId: r.subscriptionId,
      savingsCategory: "POTENTIAL_SAVING" as const,
    }));
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run tests/lib/waste-rules/diskNonProdPremium.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/waste-rules/diskNonProdPremium.ts tests/lib/waste-rules/diskNonProdPremium.test.ts
git commit -m "feat: add DISK_NONPROD_PREMIUM waste rule"
```

---

### Task 12: Rule `SNAPSHOT_ORPHANED_SOURCE`

**Files:**
- Create: `src/lib/waste-rules/snapshotOrphanedSource.ts`
- Test: `tests/lib/waste-rules/snapshotOrphanedSource.test.ts`

**Interfaces:**
- Produces: `findSnapshotOrphanedSource(resources: ResourceGraphRow[]): WasteFindingCandidate[]`.

- [ ] **Step 1: Write the failing test**

Create `tests/lib/waste-rules/snapshotOrphanedSource.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import { findSnapshotOrphanedSource } from "@/lib/waste-rules/snapshotOrphanedSource";

function snapshot(id: string, sourceResourceId?: string): ResourceGraphRow {
  return {
    id,
    type: "microsoft.compute/snapshots",
    subscriptionId: "sub-1",
    properties: { creationData: { sourceResourceId } },
  };
}

function disk(id: string): ResourceGraphRow {
  return {
    id,
    type: "microsoft.compute/disks",
    subscriptionId: "sub-1",
    properties: {},
  };
}

const EXISTING_DISK_ID = "/subscriptions/sub-1/disks/disk-1";
const REMOVED_DISK_ID = "/subscriptions/sub-1/disks/disk-removed";

describe("findSnapshotOrphanedSource", () => {
  it("flags a snapshot whose source disk no longer exists in the current scan", () => {
    const resources = [
      disk(EXISTING_DISK_ID),
      snapshot("/subscriptions/sub-1/snapshots/snap-1", REMOVED_DISK_ID),
    ];

    expect(findSnapshotOrphanedSource(resources)).toEqual([
      {
        ruleType: "SNAPSHOT_ORPHANED_SOURCE",
        resourceId: "/subscriptions/sub-1/snapshots/snap-1",
        subscriptionId: "sub-1",
        savingsCategory: "HARD_SAVING",
      },
    ]);
  });

  it("does not flag a snapshot whose source disk still exists (case-insensitive match)", () => {
    const resources = [
      disk(EXISTING_DISK_ID),
      snapshot("/subscriptions/sub-1/snapshots/snap-2", EXISTING_DISK_ID.toUpperCase()),
    ];

    expect(findSnapshotOrphanedSource(resources)).toEqual([]);
  });

  it("does not flag a snapshot with no sourceResourceId at all", () => {
    const resources = [disk(EXISTING_DISK_ID), snapshot("/subscriptions/sub-1/snapshots/snap-3")];

    expect(findSnapshotOrphanedSource(resources)).toEqual([]);
  });

  it("ignores non-snapshot resources", () => {
    expect(findSnapshotOrphanedSource([disk(EXISTING_DISK_ID)])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/lib/waste-rules/snapshotOrphanedSource.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/lib/waste-rules/snapshotOrphanedSource.ts`:

```ts
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import type { WasteFindingCandidate } from "@/lib/waste-rules/types";

interface SnapshotCreationData {
  sourceResourceId?: string;
}

export function findSnapshotOrphanedSource(
  resources: ResourceGraphRow[],
): WasteFindingCandidate[] {
  const diskIds = new Set(
    resources
      .filter((r) => r.type.toLowerCase() === "microsoft.compute/disks")
      .map((r) => r.id.toLowerCase()),
  );

  return resources
    .filter((r) => r.type.toLowerCase() === "microsoft.compute/snapshots")
    .filter((r) => {
      const creationData = r.properties.creationData as SnapshotCreationData | undefined;
      const sourceId = creationData?.sourceResourceId;
      return typeof sourceId === "string" && !diskIds.has(sourceId.toLowerCase());
    })
    .map((r) => ({
      ruleType: "SNAPSHOT_ORPHANED_SOURCE" as const,
      resourceId: r.id,
      subscriptionId: r.subscriptionId,
      savingsCategory: "HARD_SAVING" as const,
    }));
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run tests/lib/waste-rules/snapshotOrphanedSource.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/waste-rules/snapshotOrphanedSource.ts tests/lib/waste-rules/snapshotOrphanedSource.test.ts
git commit -m "feat: add SNAPSHOT_ORPHANED_SOURCE waste rule"
```

---

### Task 13: Rule `SNAPSHOT_EXCESSIVE_COUNT`

**Files:**
- Create: `src/lib/waste-rules/snapshotExcessiveCount.ts`
- Test: `tests/lib/waste-rules/snapshotExcessiveCount.test.ts`

**Interfaces:**
- Produces: `findSnapshotExcessiveCount(resources: ResourceGraphRow[]): WasteFindingCandidate[]`.

- [ ] **Step 1: Write the failing test**

Create `tests/lib/waste-rules/snapshotExcessiveCount.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import { findSnapshotExcessiveCount } from "@/lib/waste-rules/snapshotExcessiveCount";

const SOURCE_DISK_ID = "/subscriptions/sub-1/disks/disk-1";

function snapshot(id: string, timeCreated: string, sourceResourceId = SOURCE_DISK_ID): ResourceGraphRow {
  return {
    id,
    type: "microsoft.compute/snapshots",
    subscriptionId: "sub-1",
    properties: { creationData: { sourceResourceId }, timeCreated },
  };
}

describe("findSnapshotExcessiveCount", () => {
  it("flags the oldest snapshots beyond the retention limit of 5 for one source disk", () => {
    const resources = [
      snapshot("/subscriptions/sub-1/snapshots/snap-1", "2026-01-01T00:00:00Z"),
      snapshot("/subscriptions/sub-1/snapshots/snap-2", "2026-02-01T00:00:00Z"),
      snapshot("/subscriptions/sub-1/snapshots/snap-3", "2026-03-01T00:00:00Z"),
      snapshot("/subscriptions/sub-1/snapshots/snap-4", "2026-04-01T00:00:00Z"),
      snapshot("/subscriptions/sub-1/snapshots/snap-5", "2026-05-01T00:00:00Z"),
      snapshot("/subscriptions/sub-1/snapshots/snap-6", "2026-06-01T00:00:00Z"),
      snapshot("/subscriptions/sub-1/snapshots/snap-7", "2026-07-01T00:00:00Z"),
    ];

    const result = findSnapshotExcessiveCount(resources);

    // 7 snapshots, keep the 5 newest (snap-3..snap-7), flag the 2 oldest (snap-1, snap-2).
    // Assert on the set of flagged resourceIds rather than array order, since the
    // implementation's internal sort direction is not part of this rule's contract.
    expect(result).toHaveLength(2);
    expect(result.map((c) => c.resourceId).sort()).toEqual(
      [
        "/subscriptions/sub-1/snapshots/snap-1",
        "/subscriptions/sub-1/snapshots/snap-2",
      ].sort(),
    );
    for (const candidate of result) {
      expect(candidate).toMatchObject({
        ruleType: "SNAPSHOT_EXCESSIVE_COUNT",
        subscriptionId: "sub-1",
        savingsCategory: "HARD_SAVING",
      });
    }
  });

  it("does not flag any snapshot when a source disk has 5 or fewer snapshots", () => {
    const resources = [
      snapshot("/subscriptions/sub-1/snapshots/snap-1", "2026-01-01T00:00:00Z"),
      snapshot("/subscriptions/sub-1/snapshots/snap-2", "2026-02-01T00:00:00Z"),
    ];

    expect(findSnapshotExcessiveCount(resources)).toEqual([]);
  });

  it("groups by sourceResourceId independently — 6 snapshots split across 2 disks (3 each) is not excessive", () => {
    const otherDisk = "/subscriptions/sub-1/disks/disk-2";
    const resources = [
      snapshot("/subscriptions/sub-1/snapshots/a1", "2026-01-01T00:00:00Z", SOURCE_DISK_ID),
      snapshot("/subscriptions/sub-1/snapshots/a2", "2026-01-02T00:00:00Z", SOURCE_DISK_ID),
      snapshot("/subscriptions/sub-1/snapshots/a3", "2026-01-03T00:00:00Z", SOURCE_DISK_ID),
      snapshot("/subscriptions/sub-1/snapshots/b1", "2026-01-01T00:00:00Z", otherDisk),
      snapshot("/subscriptions/sub-1/snapshots/b2", "2026-01-02T00:00:00Z", otherDisk),
      snapshot("/subscriptions/sub-1/snapshots/b3", "2026-01-03T00:00:00Z", otherDisk),
    ];

    expect(findSnapshotExcessiveCount(resources)).toEqual([]);
  });

  it("ignores snapshots with no sourceResourceId when grouping", () => {
    const resources = [
      snapshot("/subscriptions/sub-1/snapshots/snap-1", "2026-01-01T00:00:00Z", undefined as unknown as string),
    ];

    expect(findSnapshotExcessiveCount(resources)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/lib/waste-rules/snapshotExcessiveCount.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/lib/waste-rules/snapshotExcessiveCount.ts`:

```ts
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import type { WasteFindingCandidate } from "@/lib/waste-rules/types";

interface SnapshotCreationData {
  sourceResourceId?: string;
}

/** Keep the N most recent snapshots per source disk; anything beyond that is a cleanup candidate. */
const MAX_SNAPSHOTS_PER_DISK = 5;

export function findSnapshotExcessiveCount(
  resources: ResourceGraphRow[],
): WasteFindingCandidate[] {
  const snapshots = resources.filter(
    (r) => r.type.toLowerCase() === "microsoft.compute/snapshots",
  );

  const bySource = new Map<string, ResourceGraphRow[]>();
  for (const snapshot of snapshots) {
    const creationData = snapshot.properties.creationData as SnapshotCreationData | undefined;
    const sourceId = creationData?.sourceResourceId;
    if (typeof sourceId !== "string") {
      continue;
    }
    const key = sourceId.toLowerCase();
    const group = bySource.get(key) ?? [];
    group.push(snapshot);
    bySource.set(key, group);
  }

  const candidates: WasteFindingCandidate[] = [];
  for (const group of bySource.values()) {
    if (group.length <= MAX_SNAPSHOTS_PER_DISK) {
      continue;
    }
    const sortedNewestFirst = [...group].sort((a, b) => {
      const timeA = new Date(String(a.properties.timeCreated ?? 0)).getTime();
      const timeB = new Date(String(b.properties.timeCreated ?? 0)).getTime();
      return timeB - timeA;
    });
    const excess = sortedNewestFirst.slice(MAX_SNAPSHOTS_PER_DISK);
    for (const snapshot of excess) {
      candidates.push({
        ruleType: "SNAPSHOT_EXCESSIVE_COUNT",
        resourceId: snapshot.id,
        subscriptionId: snapshot.subscriptionId,
        savingsCategory: "HARD_SAVING",
      });
    }
  }
  return candidates;
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run tests/lib/waste-rules/snapshotExcessiveCount.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/waste-rules/snapshotExcessiveCount.ts tests/lib/waste-rules/snapshotExcessiveCount.test.ts
git commit -m "feat: add SNAPSHOT_EXCESSIVE_COUNT waste rule"
```

---

### Task 14: Rule `IMAGE_ORPHANED`

**Files:**
- Create: `src/lib/waste-rules/imageOrphaned.ts`
- Test: `tests/lib/waste-rules/imageOrphaned.test.ts`

**Interfaces:**
- Produces: `findImageOrphaned(resources: ResourceGraphRow[]): WasteFindingCandidate[]`.

- [ ] **Step 1: Write the failing test**

Create `tests/lib/waste-rules/imageOrphaned.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import { findImageOrphaned } from "@/lib/waste-rules/imageOrphaned";

const IMAGE_ID = "/subscriptions/sub-1/images/custom-image-1";

function image(id: string): ResourceGraphRow {
  return {
    id,
    type: "microsoft.compute/images",
    subscriptionId: "sub-1",
    properties: {},
  };
}

function vmUsingImage(imageId: string | undefined): ResourceGraphRow {
  return {
    id: "/subscriptions/sub-1/virtualMachines/vm-1",
    type: "microsoft.compute/virtualmachines",
    subscriptionId: "sub-1",
    properties: imageId ? { storageProfile: { imageReference: { id: imageId } } } : {},
  };
}

function vmssUsingImage(imageId: string): ResourceGraphRow {
  return {
    id: "/subscriptions/sub-1/virtualMachineScaleSets/vmss-1",
    type: "microsoft.compute/virtualmachinescalesets",
    subscriptionId: "sub-1",
    properties: {
      virtualMachineProfile: { storageProfile: { imageReference: { id: imageId } } },
    },
  };
}

describe("findImageOrphaned", () => {
  it("flags a legacy image referenced by no VM or VMSS", () => {
    const resources = [image(IMAGE_ID), vmUsingImage(undefined)];

    expect(findImageOrphaned(resources)).toEqual([
      {
        ruleType: "IMAGE_ORPHANED",
        resourceId: IMAGE_ID,
        subscriptionId: "sub-1",
        savingsCategory: "HARD_SAVING",
      },
    ]);
  });

  it("does not flag an image referenced by a VM's imageReference (case-insensitive)", () => {
    const resources = [image(IMAGE_ID), vmUsingImage(IMAGE_ID.toUpperCase())];

    expect(findImageOrphaned(resources)).toEqual([]);
  });

  it("does not flag an image referenced by a VMSS's imageReference", () => {
    const resources = [image(IMAGE_ID), vmssUsingImage(IMAGE_ID)];

    expect(findImageOrphaned(resources)).toEqual([]);
  });

  it("ignores non-image resources", () => {
    expect(findImageOrphaned([vmUsingImage(undefined)])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/lib/waste-rules/imageOrphaned.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/lib/waste-rules/imageOrphaned.ts`:

```ts
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import type { WasteFindingCandidate } from "@/lib/waste-rules/types";

interface VmImageReferenceProperties {
  storageProfile?: { imageReference?: { id?: string } };
}

interface VmssImageReferenceProperties {
  virtualMachineProfile?: { storageProfile?: { imageReference?: { id?: string } } };
}

export function findImageOrphaned(resources: ResourceGraphRow[]): WasteFindingCandidate[] {
  const referencedImageIds = new Set<string>();

  for (const r of resources) {
    const type = r.type.toLowerCase();
    if (type === "microsoft.compute/virtualmachines") {
      const id = (r.properties as VmImageReferenceProperties).storageProfile?.imageReference?.id;
      if (id) {
        referencedImageIds.add(id.toLowerCase());
      }
    }
    if (type === "microsoft.compute/virtualmachinescalesets") {
      const id = (r.properties as VmssImageReferenceProperties).virtualMachineProfile
        ?.storageProfile?.imageReference?.id;
      if (id) {
        referencedImageIds.add(id.toLowerCase());
      }
    }
  }

  return resources
    .filter((r) => r.type.toLowerCase() === "microsoft.compute/images")
    .filter((r) => !referencedImageIds.has(r.id.toLowerCase()))
    .map((r) => ({
      ruleType: "IMAGE_ORPHANED" as const,
      resourceId: r.id,
      subscriptionId: r.subscriptionId,
      savingsCategory: "HARD_SAVING" as const,
    }));
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run tests/lib/waste-rules/imageOrphaned.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/waste-rules/imageOrphaned.ts tests/lib/waste-rules/imageOrphaned.test.ts
git commit -m "feat: add IMAGE_ORPHANED waste rule"
```

---

### Task 15: Rule `GALLERY_IMAGE_VERSION_OLD`

**Files:**
- Create: `src/lib/waste-rules/galleryImageVersionOld.ts`
- Test: `tests/lib/waste-rules/galleryImageVersionOld.test.ts`

**Interfaces:**
- Produces: `findGalleryImageVersionOld(resources: ResourceGraphRow[], now?: Date): WasteFindingCandidate[]`.

- [ ] **Step 1: Write the failing test**

Create `tests/lib/waste-rules/galleryImageVersionOld.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import { findGalleryImageVersionOld } from "@/lib/waste-rules/galleryImageVersionOld";

const VERSION_ID = "/subscriptions/sub-1/galleries/gal-1/images/img-1/versions/1.0.0";
const NOW = new Date("2026-09-13T00:00:00Z");

function galleryImageVersion(
  publishedDate: string | undefined,
  excludeFromLatest: boolean | undefined,
): ResourceGraphRow {
  return {
    id: VERSION_ID,
    type: "microsoft.compute/galleries/images/versions",
    subscriptionId: "sub-1",
    properties: { publishingProfile: { publishedDate, excludeFromLatest } },
  };
}

describe("findGalleryImageVersionOld", () => {
  it("flags a version published over 180 days ago and excluded from latest", () => {
    const resources = [galleryImageVersion("2026-01-01T00:00:00Z", true)];

    expect(findGalleryImageVersionOld(resources, NOW)).toEqual([
      {
        ruleType: "GALLERY_IMAGE_VERSION_OLD",
        resourceId: VERSION_ID,
        subscriptionId: "sub-1",
        savingsCategory: "POTENTIAL_SAVING",
      },
    ]);
  });

  it("does not flag a version published under 180 days ago even if excluded from latest", () => {
    const resources = [galleryImageVersion("2026-08-01T00:00:00Z", true)];

    expect(findGalleryImageVersionOld(resources, NOW)).toEqual([]);
  });

  it("does not flag an old version that is still the latest (excludeFromLatest false/undefined)", () => {
    const resources = [galleryImageVersion("2026-01-01T00:00:00Z", false)];

    expect(findGalleryImageVersionOld(resources, NOW)).toEqual([]);
  });

  it("does not flag a version with no publishedDate", () => {
    const resources = [galleryImageVersion(undefined, true)];

    expect(findGalleryImageVersionOld(resources, NOW)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/lib/waste-rules/galleryImageVersionOld.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/lib/waste-rules/galleryImageVersionOld.ts`:

```ts
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import type { WasteFindingCandidate } from "@/lib/waste-rules/types";

const MAX_AGE_MS = 180 * 24 * 60 * 60 * 1000;

interface GalleryImageVersionProperties {
  publishingProfile?: { publishedDate?: string; excludeFromLatest?: boolean };
}

export function findGalleryImageVersionOld(
  resources: ResourceGraphRow[],
  now: Date = new Date(),
): WasteFindingCandidate[] {
  return resources
    .filter((r) => r.type.toLowerCase() === "microsoft.compute/galleries/images/versions")
    .filter((r) => {
      const props = r.properties as GalleryImageVersionProperties;
      if (props.publishingProfile?.excludeFromLatest !== true) {
        return false;
      }
      const publishedDate = props.publishingProfile?.publishedDate;
      if (typeof publishedDate !== "string") {
        return false;
      }
      const ageMs = now.getTime() - new Date(publishedDate).getTime();
      return ageMs > MAX_AGE_MS;
    })
    .map((r) => ({
      ruleType: "GALLERY_IMAGE_VERSION_OLD" as const,
      resourceId: r.id,
      subscriptionId: r.subscriptionId,
      savingsCategory: "POTENTIAL_SAVING" as const,
    }));
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run tests/lib/waste-rules/galleryImageVersionOld.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/waste-rules/galleryImageVersionOld.ts tests/lib/waste-rules/galleryImageVersionOld.test.ts
git commit -m "feat: add GALLERY_IMAGE_VERSION_OLD waste rule"
```

---

### Task 16: `savingsEstimate.ts` — wire the 9 new rules

**Files:**
- Modify: `src/lib/waste-rules/savingsEstimate.ts`
- Test: `tests/lib/waste-rules/savingsEstimate.test.ts`

**Interfaces:**
- Produces: `SAVINGS_METHOD_BY_RULE` covers all 9 new `WasteRuleType` values. No new `SavingsMethod` variants or `switch` cases needed — all 9 reuse `full_cost`, `premium_disk_delta`, or `unknown`.

- [ ] **Step 1: Write the failing tests**

Add to `tests/lib/waste-rules/savingsEstimate.test.ts`, inside the existing `describe("estimateMonthlySavings", ...)` block:

```ts
  it.each([
    "DISK_IDLE_LOW_UTILIZATION",
    "SNAPSHOT_ORPHANED_SOURCE",
    "SNAPSHOT_EXCESSIVE_COUNT",
    "IMAGE_ORPHANED",
    "GALLERY_IMAGE_VERSION_OLD",
  ] as const)("returns the full resource cost for %s", async (ruleType) => {
    const candidate: WasteFindingCandidate = {
      ruleType,
      resourceId: "res-1",
      subscriptionId: "sub-1",
    };

    expect(await estimateMonthlySavings(candidate, undefined, 42)).toBe(42);
  });

  it.each(["DISK_PREMIUM_V2_OVERSIZED", "DISK_TIER_OVERSIZED"] as const)(
    "returns null (no fabricated number) for %s",
    async (ruleType) => {
      const candidate: WasteFindingCandidate = {
        ruleType,
        resourceId: "disk-1",
        subscriptionId: "sub-1",
      };

      expect(await estimateMonthlySavings(candidate, undefined, 500)).toBeNull();
    },
  );

  it.each(["DISK_PREMIUM_TIER_UNNECESSARY", "DISK_NONPROD_PREMIUM"] as const)(
    "delegates %s to estimatePremiumDiskDowngradeMonthlySavings",
    async (ruleType) => {
      vi.mocked(estimatePremiumDiskDowngradeMonthlySavings).mockResolvedValue(15);
      const resource: ResourceGraphRow = {
        id: "disk-1",
        type: "microsoft.compute/disks",
        subscriptionId: "sub-1",
        properties: {},
      };
      const candidate: WasteFindingCandidate = {
        ruleType,
        resourceId: "disk-1",
        subscriptionId: "sub-1",
      };

      const savings = await estimateMonthlySavings(candidate, resource, 30);

      expect(savings).toBe(15);
      expect(estimatePremiumDiskDowngradeMonthlySavings).toHaveBeenCalledWith(resource);
    },
  );
```

(`estimatePremiumDiskDowngradeMonthlySavings` is already imported/mocked at the top of this test file since Category 3 — no new mock setup needed.)

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/lib/waste-rules/savingsEstimate.test.ts`
Expected: FAIL — TypeScript rejects the 9 new `WasteRuleType` literals not existing yet in `SAVINGS_METHOD_BY_RULE`.

- [ ] **Step 3: Implement**

In `src/lib/waste-rules/savingsEstimate.ts`, add the 9 new entries to `SAVINGS_METHOD_BY_RULE`, after `AVD_PERSONAL_HOST_UNUSED: "full_cost",`:

```ts
  DISK_IDLE_LOW_UTILIZATION: "full_cost",
  DISK_PREMIUM_TIER_UNNECESSARY: "premium_disk_delta",
  DISK_PREMIUM_V2_OVERSIZED: "unknown",
  DISK_TIER_OVERSIZED: "unknown",
  DISK_NONPROD_PREMIUM: "premium_disk_delta",
  SNAPSHOT_ORPHANED_SOURCE: "full_cost",
  SNAPSHOT_EXCESSIVE_COUNT: "full_cost",
  IMAGE_ORPHANED: "full_cost",
  GALLERY_IMAGE_VERSION_OLD: "full_cost",
```

No changes to the `SavingsMethod` type or the `switch` statement — every value here reuses an existing method.

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run tests/lib/waste-rules/savingsEstimate.test.ts`
Expected: PASS (all tests, old and new)

- [ ] **Step 5: Commit**

```bash
git add src/lib/waste-rules/savingsEstimate.ts tests/lib/waste-rules/savingsEstimate.test.ts
git commit -m "feat: wire disk category-4 savings estimation methods into the dispatcher"
```

---

### Task 17: `dashboard-categories.ts` — wire the 9 new rules

**Files:**
- Modify: `src/lib/dashboard-categories.ts`
- Test: `tests/lib/dashboard-categories.test.ts`

**Interfaces:**
- Produces: `CATEGORY_BY_RULE` maps all 9 new `WasteRuleType` values to `"storage"`.

- [ ] **Step 1: Write the failing test**

Add to `tests/lib/dashboard-categories.test.ts`, inside the existing `describe("categoryForRule", ...)` block, after the AVD test:

```ts
  it("maps every disk category-4 rule to storage", () => {
    const diskRuleTypes = [
      "DISK_IDLE_LOW_UTILIZATION",
      "DISK_PREMIUM_TIER_UNNECESSARY",
      "DISK_PREMIUM_V2_OVERSIZED",
      "DISK_TIER_OVERSIZED",
      "DISK_NONPROD_PREMIUM",
      "SNAPSHOT_ORPHANED_SOURCE",
      "SNAPSHOT_EXCESSIVE_COUNT",
      "IMAGE_ORPHANED",
      "GALLERY_IMAGE_VERSION_OLD",
    ] as const;
    for (const ruleType of diskRuleTypes) {
      expect(categoryForRule(ruleType)).toBe("storage");
    }
  });
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/lib/dashboard-categories.test.ts`
Expected: FAIL — TypeScript rejects `CATEGORY_BY_RULE` for missing the 9 new keys.

- [ ] **Step 3: Implement**

In `src/lib/dashboard-categories.ts`, add the 9 new entries to `CATEGORY_BY_RULE`, after `AVD_PERSONAL_HOST_UNUSED: "compute",`:

```ts
  DISK_IDLE_LOW_UTILIZATION: "storage",
  DISK_PREMIUM_TIER_UNNECESSARY: "storage",
  DISK_PREMIUM_V2_OVERSIZED: "storage",
  DISK_TIER_OVERSIZED: "storage",
  DISK_NONPROD_PREMIUM: "storage",
  SNAPSHOT_ORPHANED_SOURCE: "storage",
  SNAPSHOT_EXCESSIVE_COUNT: "storage",
  IMAGE_ORPHANED: "storage",
  GALLERY_IMAGE_VERSION_OLD: "storage",
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run tests/lib/dashboard-categories.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/dashboard-categories.ts tests/lib/dashboard-categories.test.ts
git commit -m "feat: add dashboard storage category for disk category-4 rules"
```

---

### Task 18: i18n — 9 new rule labels × 3 locales

**Files:**
- Modify: `src/lib/i18n/dictionaries.ts`
- Test: `tests/lib/i18n/dictionaries.test.ts`

**Interfaces:**
- Produces: `rule.*` translation keys (9 keys) present in `pt-BR`, `en`, and `es`.

- [ ] **Step 1: Write the failing test**

Add to `tests/lib/i18n/dictionaries.test.ts`, as a new `describe` block after the AVD one:

```ts
describe("Disk category-4 rule labels", () => {
  const diskRuleKeys = [
    "rule.DISK_IDLE_LOW_UTILIZATION",
    "rule.DISK_PREMIUM_TIER_UNNECESSARY",
    "rule.DISK_PREMIUM_V2_OVERSIZED",
    "rule.DISK_TIER_OVERSIZED",
    "rule.DISK_NONPROD_PREMIUM",
    "rule.SNAPSHOT_ORPHANED_SOURCE",
    "rule.SNAPSHOT_EXCESSIVE_COUNT",
    "rule.IMAGE_ORPHANED",
    "rule.GALLERY_IMAGE_VERSION_OLD",
  ];

  it("has a real translation (not a key fallback) for every disk rule key in every locale", () => {
    for (const locale of LOCALES) {
      for (const key of diskRuleKeys) {
        expect(translate(locale, key)).not.toBe(key);
      }
    }
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/lib/i18n/dictionaries.test.ts -t "Disk category-4 rule labels"`
Expected: FAIL — the 9 keys don't exist in any locale yet.

- [ ] **Step 3: Implement**

In `src/lib/i18n/dictionaries.ts`, add the 9 keys to each of the 3 locale blocks, immediately after their respective `"rule.AVD_PERSONAL_HOST_UNUSED"` line.

`"pt-BR"` block:

```ts
    "rule.DISK_IDLE_LOW_UTILIZATION": "Disco com baixa utilização de IOPS",
    "rule.DISK_PREMIUM_TIER_UNNECESSARY": "Disco Premium/Ultra sem necessidade de performance",
    "rule.DISK_PREMIUM_V2_OVERSIZED": "Disco Premium v2 com IOPS/throughput superdimensionado",
    "rule.DISK_TIER_OVERSIZED": "Disco Premium em tier de tamanho maior que o necessário",
    "rule.DISK_NONPROD_PREMIUM": "Disco Premium/Ultra em recurso não-produtivo",
    "rule.SNAPSHOT_ORPHANED_SOURCE": "Snapshot com disco de origem removido",
    "rule.SNAPSHOT_EXCESSIVE_COUNT": "Snapshots excedentes do mesmo disco de origem",
    "rule.IMAGE_ORPHANED": "Imagem gerenciada sem VM ou VMSS associado",
    "rule.GALLERY_IMAGE_VERSION_OLD": "Versão antiga de imagem na Azure Compute Gallery",
```

`"en"` block:

```ts
    "rule.DISK_IDLE_LOW_UTILIZATION": "Disk with low IOPS utilization",
    "rule.DISK_PREMIUM_TIER_UNNECESSARY": "Premium/Ultra disk without a performance need",
    "rule.DISK_PREMIUM_V2_OVERSIZED": "Premium v2 disk with oversized IOPS/throughput",
    "rule.DISK_TIER_OVERSIZED": "Premium disk in a larger size tier than needed",
    "rule.DISK_NONPROD_PREMIUM": "Premium/Ultra disk on a non-production resource",
    "rule.SNAPSHOT_ORPHANED_SOURCE": "Snapshot with a removed source disk",
    "rule.SNAPSHOT_EXCESSIVE_COUNT": "Excess snapshots for the same source disk",
    "rule.IMAGE_ORPHANED": "Managed image with no associated VM or VMSS",
    "rule.GALLERY_IMAGE_VERSION_OLD": "Old image version in Azure Compute Gallery",
```

`"es"` block:

```ts
    "rule.DISK_IDLE_LOW_UTILIZATION": "Disco con baja utilización de IOPS",
    "rule.DISK_PREMIUM_TIER_UNNECESSARY": "Disco Premium/Ultra sin necesidad de rendimiento",
    "rule.DISK_PREMIUM_V2_OVERSIZED": "Disco Premium v2 con IOPS/throughput sobredimensionado",
    "rule.DISK_TIER_OVERSIZED": "Disco Premium en un tier de tamaño mayor al necesario",
    "rule.DISK_NONPROD_PREMIUM": "Disco Premium/Ultra en recurso no productivo",
    "rule.SNAPSHOT_ORPHANED_SOURCE": "Snapshot con disco de origen eliminado",
    "rule.SNAPSHOT_EXCESSIVE_COUNT": "Snapshots excedentes del mismo disco de origen",
    "rule.IMAGE_ORPHANED": "Imagen administrada sin VM o VMSS asociado",
    "rule.GALLERY_IMAGE_VERSION_OLD": "Versión antigua de imagen en Azure Compute Gallery",
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run tests/lib/i18n/dictionaries.test.ts`
Expected: PASS (all tests, old and new)

- [ ] **Step 5: Commit**

```bash
git add src/lib/i18n/dictionaries.ts tests/lib/i18n/dictionaries.test.ts
git commit -m "feat: add i18n labels for disk category-4 rules"
```

---

### Task 19: `runScan.ts` — wire all 9 disk category-4 rules into the scanner

**Files:**
- Modify: `src/lib/scanner/runScan.ts`
- Test: `tests/lib/scanner/runScan.test.ts`

**Interfaces:**
- Consumes: all 9 `find*` functions from Tasks 6, 7, 9, 10, 11, 12, 13, 14, 15.
- Produces: `runScan`'s `candidates` array includes disk category-4 candidates end to end.

- [ ] **Step 1: Write the failing end-to-end tests**

Add to `tests/lib/scanner/runScan.test.ts`, inside the existing `describe("runScan", ...)` block:

```ts
  it("persists a SNAPSHOT_ORPHANED_SOURCE finding end to end", async () => {
    const customer = await prisma.customer.create({
      data: { entraTenantId: "tenant-disk-1", name: "Acme" },
    });
    const subscription = await prisma.subscription.create({
      data: { customerId: customer.id, azureSubscriptionId: "sub-disk-1", displayName: "Prod" },
    });

    vi.mocked(queryResourceGraph).mockResolvedValue([
      {
        id: "/subscriptions/sub-disk-1/snapshots/snap-1",
        type: "microsoft.compute/snapshots",
        subscriptionId: "sub-disk-1",
        properties: {
          creationData: { sourceResourceId: "/subscriptions/sub-disk-1/disks/disk-removed" },
        },
      },
    ]);
    vi.mocked(estimateMonthlyCost).mockResolvedValue(4);
    vi.mocked(getSubscriptionMonthToDateSpend).mockResolvedValue(0);
    vi.mocked(getSubscriptionForecast).mockResolvedValue(0);
    vi.mocked(getSubscriptionDailyCostTrend).mockResolvedValue([]);

    await runScan(subscription.id);

    const findings = await prisma.wasteFinding.findMany({
      where: { subscriptionId: subscription.id, ruleType: "SNAPSHOT_ORPHANED_SOURCE" },
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      resourceId: "/subscriptions/sub-disk-1/snapshots/snap-1",
      estimatedMonthlyCost: 4,
      estimatedMonthlySavings: 4,
    });
  });

  it("persists a DISK_IDLE_LOW_UTILIZATION finding (async, IOPS-metric-backed) end to end", async () => {
    const customer = await prisma.customer.create({
      data: { entraTenantId: "tenant-disk-2", name: "Acme" },
    });
    const subscription = await prisma.subscription.create({
      data: { customerId: customer.id, azureSubscriptionId: "sub-disk-2", displayName: "Prod" },
    });

    vi.mocked(queryResourceGraph).mockResolvedValue([
      {
        id: "/subscriptions/sub-disk-2/disks/disk-1",
        type: "microsoft.compute/disks",
        subscriptionId: "sub-disk-2",
        properties: { diskState: "Attached" },
      },
    ]);
    vi.mocked(getAverageDiskIops).mockResolvedValue(0.1);
    vi.mocked(estimateMonthlyCost).mockResolvedValue(20);
    vi.mocked(getSubscriptionMonthToDateSpend).mockResolvedValue(0);
    vi.mocked(getSubscriptionForecast).mockResolvedValue(0);
    vi.mocked(getSubscriptionDailyCostTrend).mockResolvedValue([]);

    await runScan(subscription.id);

    const findings = await prisma.wasteFinding.findMany({
      where: { subscriptionId: subscription.id, ruleType: "DISK_IDLE_LOW_UTILIZATION" },
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      resourceId: "/subscriptions/sub-disk-2/disks/disk-1",
      savingsCategory: "HARD_SAVING",
      estimatedMonthlyCost: 20,
      estimatedMonthlySavings: 20,
    });
  });
```

Also add `getAverageDiskIops` to the existing `vi.mock("@/lib/azure/monitorMetrics", ...)` factory near the top of the file:

```ts
vi.mock("@/lib/azure/monitorMetrics", () => ({
  getAverageCpuPercent: vi.fn(),
  getHourlyCpuBelowThreshold: vi.fn(),
  getAverageDiskIops: vi.fn(),
}));
```

And extend the existing `import { getAverageCpuPercent, getHourlyCpuBelowThreshold } from "@/lib/azure/monitorMetrics";` line below the mocks to also import `getAverageDiskIops` — modify that one line in place, do not add a second import line for the same module:

```ts
import { getAverageCpuPercent, getHourlyCpuBelowThreshold, getAverageDiskIops } from "@/lib/azure/monitorMetrics";
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/lib/scanner/runScan.test.ts -t "SNAPSHOT_ORPHANED_SOURCE|DISK_IDLE_LOW_UTILIZATION"`
Expected: FAIL — no disk-category-4 findings are produced yet.

- [ ] **Step 3: Wire the 9 rules into `runScan.ts`**

Add the 9 imports, grouped after the existing AVD imports:

```ts
import { findDiskIdleLowUtilization } from "@/lib/waste-rules/diskIdleLowUtilization";
import { findDiskPremiumTierUnnecessary } from "@/lib/waste-rules/diskPremiumTierUnnecessary";
import { findDiskPremiumV2Oversized } from "@/lib/waste-rules/diskPremiumV2Oversized";
import { findDiskTierOversized } from "@/lib/waste-rules/diskTierOversized";
import { findDiskNonProdPremium } from "@/lib/waste-rules/diskNonProdPremium";
import { findSnapshotOrphanedSource } from "@/lib/waste-rules/snapshotOrphanedSource";
import { findSnapshotExcessiveCount } from "@/lib/waste-rules/snapshotExcessiveCount";
import { findImageOrphaned } from "@/lib/waste-rules/imageOrphaned";
import { findGalleryImageVersionOld } from "@/lib/waste-rules/galleryImageVersionOld";
```

4 of these 9 rules are `async` (they call `getAverageDiskIops`): `findDiskIdleLowUtilization`, `findDiskPremiumTierUnnecessary`, `findDiskPremiumV2Oversized`, `findDiskTierOversized`. Add them as awaited, try/catch-wrapped intermediate variables — same pattern as `idleVmCandidates`/`idleVmssCandidates` — placed after the existing `missingReservationCandidates` block and before the `candidates` array:

```ts
    let diskIdleCandidates: WasteFindingCandidate[] = [];
    try {
      diskIdleCandidates = await findDiskIdleLowUtilization(resources);
    } catch (error) {
      console.error(
        "Disk idle-utilization rule failed; treating as zero idle disks for this scan",
        error,
      );
    }

    let diskPremiumTierCandidates: WasteFindingCandidate[] = [];
    try {
      diskPremiumTierCandidates = await findDiskPremiumTierUnnecessary(resources);
    } catch (error) {
      console.error(
        "Disk premium-tier-unnecessary rule failed; treating as zero findings for this scan",
        error,
      );
    }

    let diskPremiumV2Candidates: WasteFindingCandidate[] = [];
    try {
      diskPremiumV2Candidates = await findDiskPremiumV2Oversized(resources);
    } catch (error) {
      console.error(
        "Disk PremiumV2-oversized rule failed; treating as zero findings for this scan",
        error,
      );
    }

    let diskTierOversizedCandidates: WasteFindingCandidate[] = [];
    try {
      diskTierOversizedCandidates = await findDiskTierOversized(resources);
    } catch (error) {
      console.error(
        "Disk tier-oversized rule failed; treating as zero findings for this scan",
        error,
      );
    }
```

Add the other 5 (synchronous) rules and the 4 async intermediates to the `candidates` array, after the existing `...findAvdPersonalHostUnused(resources),` line:

```ts
      ...findAvdPersonalHostUnused(resources),
      ...diskIdleCandidates,
      ...diskPremiumTierCandidates,
      ...diskPremiumV2Candidates,
      ...diskTierOversizedCandidates,
      ...findDiskNonProdPremium(resources),
      ...findSnapshotOrphanedSource(resources),
      ...findSnapshotExcessiveCount(resources),
      ...findImageOrphaned(resources),
      ...findGalleryImageVersionOld(resources),
    ];
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run tests/lib/scanner/runScan.test.ts -t "SNAPSHOT_ORPHANED_SOURCE|DISK_IDLE_LOW_UTILIZATION"`
Expected: PASS (both new tests)

- [ ] **Step 5: Run the full runScan test suite to confirm no regression**

Run: `npx vitest run tests/lib/scanner/runScan.test.ts`
Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/scanner/runScan.ts tests/lib/scanner/runScan.test.ts
git commit -m "feat: wire all 9 disk category-4 waste rules into the scanner"
```

---

### Task 20: Final verification

**Files:** none (verification only)

**Interfaces:** none

- [ ] **Step 1: Type-check the whole project**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 2: Run the full test suite**

Run: `npm test`
Expected: all tests pass (no regressions in any file touched across Tasks 1-19).

- [ ] **Step 3: Lint the whole project**

Run: `npm run lint`
Expected: 0 errors. The 3 pre-existing warnings from before this plan (2 in `reservationCoverage.ts`, 1 in `tests/lib/scanner/runScan.test.ts`) may still appear — confirm no *new* warnings were introduced.

- [ ] **Step 4: Update the project memory**

Update `finops_catalog_deferred_items.md` (`C:\Users\DanielGomesDeOliveir\.claude\projects\C--Cloud-Waste-Hunter\memory\`) recording that Category 4 shipped with 9 rules, and that its final whole-branch review (if one is run per the subagent-driven-development skill) should specifically re-check the IOPS-based rules' arithmetic (§4.2 of the spec) and the `UltraSSD_LRS`/`PremiumV2_LRS` pricing-model gap, since both are new territory for this project.

- [ ] **Step 5: Confirm a clean git status**

Run: `git status`
Expected: clean working tree — every change from Tasks 1-19 already committed. If anything is uncommitted, review it before committing (this step verifies, it does not introduce new changes).
