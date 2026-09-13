# FinOps Catalog Category 2 (VM Scale Sets) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 10 new VM-Scale-Set waste-detection rules to Cloud Waste Hunter's scanner, matching the FinOps catalog's Category 2, following the exact architecture already established by Category 1 (Virtual Machines).

**Architecture:** Each rule is a pure (or Azure-Monitor/Retail-Prices-injectable) function in `src/lib/waste-rules/*.ts` that takes the scanner's `ResourceGraphRow[]` inventory and returns `WasteFindingCandidate[]`; `runScan.ts` spreads all rules' candidates into one array and separately estimates cost/savings per candidate. Three new Resource Graph resource types feed the new rules (`virtualmachinescalesets`, its child `virtualmachines`, and `microsoft.insights/autoscalesettings`), correlated in-memory rather than via new API calls. Two rules need genuinely new mechanisms instead of a documented fixed-percentage fallback (per explicit user direction): hourly-granularity Monitor Metrics, and a region-wide Retail-Prices average. One rule (`VMSS_MISSING_SAVINGS_PLAN_OR_RESERVATION`) needs a brand-new Azure API integration that must be validated live before being trusted.

**Tech Stack:** TypeScript, Next.js, Prisma (Postgres), Vitest, Azure Resource Graph / Azure Monitor / Azure Retail Prices / Azure Consumption REST APIs.

**Spec:** `docs/superpowers/specs/2026-09-12-finops-vmss-category2-rules-design.md`

## Global Constraints

- All 10 new `WasteRuleType` values use `savingsCategory: "POTENTIAL_SAVING"` except `VMSS_IDLE_LOW_UTILIZATION`, which reuses the existing 4-tier CPU severity table (can reach `HARD_SAVING`).
- No new fields on `WasteFinding` — reuse `savingsCategory`, `metricObserved`, `periodAnalyzedDays`, `estimatedMonthlySavings` from Category 1.
- Every rule filters `resources` by `r.type.toLowerCase()`, following the exact pattern in every existing file under `src/lib/waste-rules/`.
- `SAVINGS_METHOD_BY_RULE` in `src/lib/waste-rules/savingsEstimate.ts` is a `Record<WasteRuleType, SavingsMethod>` — TypeScript will refuse to compile until every one of the 10 new rule types has an entry. Do not skip this.
- Fallback numbers for `VMSS_SPOT_ELIGIBLE` and `VMSS_NONPROD_NO_SCHEDULE` must be derived from real observed data (regional Retail Prices average, or the resource's own hourly utilization) — never a hardcoded "typical discount" constant. This was an explicit user correction; do not fall back to Category 1's fixed-percentage style for these two.
- `VMSS_MISSING_SAVINGS_PLAN_OR_RESERVATION`'s API integration (`Microsoft.Consumption/reservationRecommendations`) must be validated with a real, live API call before the task is considered done — mocked tests alone are not sufficient (see spec §4.7 and memory `verify-azure-retail-prices-queries-live`).
- All new `rule.VMSS_*` i18n keys must be added to all 3 locale dictionaries (`pt-BR`, `en`, `es`) in the same task — Category 1 shipped with this gap once already (commit `1990b72`).

---

## File Structure

New files:
- `src/lib/waste-rules/vmssNaming.ts` — shared name-heuristic helper (used by rules 6, 8)
- `src/lib/waste-rules/vmssAutoscale.ts` — shared autoscale-settings correlation/parsing helper (used by rules 1, 2, 3, 5, 6)
- `src/lib/waste-rules/vmssNoAutoscale.ts` — rule 1 (`VMSS_NO_AUTOSCALE`)
- `src/lib/waste-rules/vmssMaxInstancesHigh.ts` — rule 2 (`VMSS_MAX_INSTANCES_HIGH`)
- `src/lib/waste-rules/vmssAutoscaleNoScaleIn.ts` — rule 3 (`VMSS_AUTOSCALE_NO_SCALE_IN`)
- `src/lib/waste-rules/vmssScaleOutMetricInadequate.ts` — rule 5 (`VMSS_SCALEOUT_METRIC_INADEQUATE`)
- `src/lib/waste-rules/vmssNonProdNoSchedule.ts` — rule 6 (`VMSS_NONPROD_NO_SCHEDULE`)
- `src/lib/waste-rules/vmssIdleLowUtilization.ts` — rule 4 (`VMSS_IDLE_LOW_UTILIZATION`)
- `src/lib/waste-rules/vmssOutdatedSku.ts` — rule 7 (`VMSS_OUTDATED_SKU_GENERATION`)
- `src/lib/waste-rules/vmssOutdatedModelInstances.ts` — rule 10 (`VMSS_OUTDATED_MODEL_INSTANCES`)
- `src/lib/waste-rules/vmssSpotEligible.ts` — rule 8 (`VMSS_SPOT_ELIGIBLE`)
- `src/lib/azure/reservationCoverage.ts` — new Consumption API client for rule 9
- `src/lib/waste-rules/vmssMissingSavingsPlanOrReservation.ts` — rule 9 (`VMSS_MISSING_SAVINGS_PLAN_OR_RESERVATION`)
- One test file per new source file above, under the mirrored `tests/` path.
- One new Prisma migration folder under `prisma/migrations/`.

Modified files:
- `prisma/schema.prisma` — 10 new `WasteRuleType` enum values
- `src/lib/azure/resourceGraph.ts` — widen `ResourceGraphRow.sku` to include `capacity?: number`
- `src/lib/scanner/runScan.ts` — add 3 resource types to `COMBINED_QUERY`; wire in the 10 new rules
- `src/lib/azure/monitorMetrics.ts` — add `getHourlyCpuBelowThreshold`
- `src/lib/azure/retailPrices.ts` — extract `fetchVmSizePriceCatalog`; add `estimateVmssCost`, `estimateVmssSpotMonthlySavings`, `estimateRegionalSpotDiscountRatio`; wire VMSS into `estimateRetailMonthlyCost`
- `src/lib/waste-rules/savingsEstimate.ts` — add 10 new `SAVINGS_METHOD_BY_RULE` entries + 3 new savings methods
- `src/lib/dashboard-categories.ts` — add 10 new `CATEGORY_BY_RULE` entries (all `"compute"`)
- `src/lib/i18n/dictionaries.ts` — add 10 new `rule.VMSS_*` keys × 3 locales
- `tests/lib/scanner/runScan.test.ts`, `tests/lib/waste-rules/savingsEstimate.test.ts`, `tests/lib/dashboard-categories.test.ts`, `tests/lib/i18n/dictionaries.test.ts` — extended, not replaced

---

### Task 1: Prisma schema — 10 new `WasteRuleType` values

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260913000000_add_vmss_category2_finops_rules/migration.sql`

**Interfaces:**
- Produces: 10 new `WasteRuleType` enum members, usable as string literals in every later task: `VMSS_NO_AUTOSCALE`, `VMSS_MAX_INSTANCES_HIGH`, `VMSS_AUTOSCALE_NO_SCALE_IN`, `VMSS_IDLE_LOW_UTILIZATION`, `VMSS_SCALEOUT_METRIC_INADEQUATE`, `VMSS_NONPROD_NO_SCHEDULE`, `VMSS_OUTDATED_SKU_GENERATION`, `VMSS_SPOT_ELIGIBLE`, `VMSS_MISSING_SAVINGS_PLAN_OR_RESERVATION`, `VMSS_OUTDATED_MODEL_INSTANCES`.

- [ ] **Step 1: Edit the enum in `prisma/schema.prisma`**

Find the `enum WasteRuleType { ... }` block and replace it with:

```prisma
enum WasteRuleType {
  ORPHANED_DISK
  UNASSOCIATED_PUBLIC_IP
  OLD_SNAPSHOT
  IDLE_VPN_GATEWAY
  IDLE_VM
  VM_MISSING_HYBRID_BENEFIT
  VM_MISSING_LINUX_BYOL
  VM_OUTDATED_SKU_GENERATION
  VM_STOPPED_RETAINING_RESOURCES
  VMSS_NO_AUTOSCALE
  VMSS_MAX_INSTANCES_HIGH
  VMSS_AUTOSCALE_NO_SCALE_IN
  VMSS_IDLE_LOW_UTILIZATION
  VMSS_SCALEOUT_METRIC_INADEQUATE
  VMSS_NONPROD_NO_SCHEDULE
  VMSS_OUTDATED_SKU_GENERATION
  VMSS_SPOT_ELIGIBLE
  VMSS_MISSING_SAVINGS_PLAN_OR_RESERVATION
  VMSS_OUTDATED_MODEL_INSTANCES
}
```

- [ ] **Step 2: Write the migration file by hand**

Create `prisma/migrations/20260913000000_add_vmss_category2_finops_rules/migration.sql`:

```sql
-- AlterEnum
ALTER TYPE "WasteRuleType" ADD VALUE 'VMSS_NO_AUTOSCALE';
ALTER TYPE "WasteRuleType" ADD VALUE 'VMSS_MAX_INSTANCES_HIGH';
ALTER TYPE "WasteRuleType" ADD VALUE 'VMSS_AUTOSCALE_NO_SCALE_IN';
ALTER TYPE "WasteRuleType" ADD VALUE 'VMSS_IDLE_LOW_UTILIZATION';
ALTER TYPE "WasteRuleType" ADD VALUE 'VMSS_SCALEOUT_METRIC_INADEQUATE';
ALTER TYPE "WasteRuleType" ADD VALUE 'VMSS_NONPROD_NO_SCHEDULE';
ALTER TYPE "WasteRuleType" ADD VALUE 'VMSS_OUTDATED_SKU_GENERATION';
ALTER TYPE "WasteRuleType" ADD VALUE 'VMSS_SPOT_ELIGIBLE';
ALTER TYPE "WasteRuleType" ADD VALUE 'VMSS_MISSING_SAVINGS_PLAN_OR_RESERVATION';
ALTER TYPE "WasteRuleType" ADD VALUE 'VMSS_OUTDATED_MODEL_INSTANCES';
```

- [ ] **Step 3: Apply the migration and regenerate the Prisma client**

Run: `npx prisma migrate dev --skip-seed`
Expected: prompts to apply the new migration against the local dev database; it applies cleanly (pure `ADD VALUE` statements, no data migration needed) and regenerates `@prisma/client` types.

If there is no local dev database reachable, at minimum run:
Run: `npx prisma generate`
Expected: regenerates `node_modules/@prisma/client` so `WasteRuleType` includes the 10 new literals — required before any later task's TypeScript will compile.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260913000000_add_vmss_category2_finops_rules
git commit -m "feat: add WasteRuleType enum values for VMSS category 2 rules"
```

---

### Task 2: Resource Graph — new resource types + `sku.capacity` typing

**Files:**
- Modify: `src/lib/azure/resourceGraph.ts`
- Modify: `src/lib/scanner/runScan.ts:22-35` (the `COMBINED_QUERY` template string)
- Test: `tests/lib/scanner/runScan.test.ts`

**Interfaces:**
- Produces: `ResourceGraphRow.sku` now typed `{ name?: string; tier?: string; capacity?: number } | null` — later tasks (VMSS cost/Spot estimation) read `resource.sku?.capacity`.
- Produces: `COMBINED_QUERY` now includes `microsoft.compute/virtualmachinescalesets`, `microsoft.compute/virtualmachinescalesets/virtualmachines`, `microsoft.insights/autoscalesettings` in its `where type in (...)` list.

- [ ] **Step 1: Widen the `sku` type in `resourceGraph.ts`**

In `src/lib/azure/resourceGraph.ts`, change:

```ts
  sku?: { name?: string; tier?: string } | null;
```

to:

```ts
  sku?: { name?: string; tier?: string; capacity?: number } | null;
```

- [ ] **Step 2: Write a failing regression test for the query's resource type list**

Add to `tests/lib/scanner/runScan.test.ts` (new `describe` block, after the imports, before the existing `describe("runScan", ...)`):

```ts
describe("COMBINED_QUERY resource types", () => {
  it("includes the VMSS category-2 resource types", async () => {
    const { COMBINED_QUERY_TYPES } = await import("@/lib/scanner/runScan");
    expect(COMBINED_QUERY_TYPES).toEqual(
      expect.arrayContaining([
        "microsoft.compute/virtualmachinescalesets",
        "microsoft.compute/virtualmachinescalesets/virtualmachines",
        "microsoft.insights/autoscalesettings",
      ]),
    );
  });
});
```

- [ ] **Step 2b: Run it to confirm it fails**

Run: `npx vitest run tests/lib/scanner/runScan.test.ts -t "COMBINED_QUERY resource types"`
Expected: FAIL — `COMBINED_QUERY_TYPES` is not exported yet.

- [ ] **Step 3: Refactor `COMBINED_QUERY` to expose its type list, and add the 3 new types**

In `src/lib/scanner/runScan.ts`, replace:

```ts
const COMBINED_QUERY = `
Resources
| where type in (
    'microsoft.compute/disks',
    'microsoft.network/publicipaddresses',
    'microsoft.compute/snapshots',
    'microsoft.network/vpngateways',
    'microsoft.network/virtualnetworkgateways',
    'microsoft.network/connections',
    'microsoft.compute/virtualmachines'
  )
| extend powerState = tostring(properties.extended.instanceView.powerState.code)
| project id, type, subscriptionId, location, sku, properties, powerState
`;
```

with:

```ts
export const COMBINED_QUERY_TYPES = [
  "microsoft.compute/disks",
  "microsoft.network/publicipaddresses",
  "microsoft.compute/snapshots",
  "microsoft.network/vpngateways",
  "microsoft.network/virtualnetworkgateways",
  "microsoft.network/connections",
  "microsoft.compute/virtualmachines",
  "microsoft.compute/virtualmachinescalesets",
  "microsoft.compute/virtualmachinescalesets/virtualmachines",
  "microsoft.insights/autoscalesettings",
];

const COMBINED_QUERY = `
Resources
| where type in (${COMBINED_QUERY_TYPES.map((t) => `'${t}'`).join(", ")})
| extend powerState = tostring(properties.extended.instanceView.powerState.code)
| project id, type, subscriptionId, location, sku, properties, powerState
`;
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run tests/lib/scanner/runScan.test.ts -t "COMBINED_QUERY resource types"`
Expected: PASS

- [ ] **Step 5: Run the full existing runScan test suite to confirm no regression**

Run: `npx vitest run tests/lib/scanner/runScan.test.ts`
Expected: all existing tests still PASS (the query string content changed but its meaning for existing types did not).

- [ ] **Step 6: Commit**

```bash
git add src/lib/azure/resourceGraph.ts src/lib/scanner/runScan.ts tests/lib/scanner/runScan.test.ts
git commit -m "feat: add VMSS, VMSS instance, and autoscale settings to Resource Graph query"
```

---

### Task 3: Shared helper — `vmssNaming.ts`

**Files:**
- Create: `src/lib/waste-rules/vmssNaming.ts`
- Test: `tests/lib/waste-rules/vmssNaming.test.ts`

**Interfaces:**
- Produces: `isNonProdVmssName(id: string): boolean`, used by Task 10 (rule 6) and Task 16 (rule 8).

- [ ] **Step 1: Write the failing test**

Create `tests/lib/waste-rules/vmssNaming.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isNonProdVmssName } from "@/lib/waste-rules/vmssNaming";

describe("isNonProdVmssName", () => {
  it.each([
    "/subscriptions/sub-1/resourceGroups/rg1/providers/Microsoft.Compute/virtualMachineScaleSets/vmss-dev-01",
    "/subscriptions/sub-1/.../virtualMachineScaleSets/vmss-Test-web",
    "/subscriptions/sub-1/.../virtualMachineScaleSets/poc-cluster",
    "/subscriptions/sub-1/.../virtualMachineScaleSets/staging-app",
    "/subscriptions/sub-1/.../virtualMachineScaleSets/qa-batch",
  ])("flags %s as non-production by name", (id) => {
    expect(isNonProdVmssName(id)).toBe(true);
  });

  it("does not flag a production-named VMSS", () => {
    expect(
      isNonProdVmssName(
        "/subscriptions/sub-1/resourceGroups/rg1/providers/Microsoft.Compute/virtualMachineScaleSets/prod-web-01",
      ),
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/lib/waste-rules/vmssNaming.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/lib/waste-rules/vmssNaming.ts`:

```ts
const NONPROD_NAME_PATTERN = /dev|test|poc|staging|qa/i;

export function vmssNameFromId(id: string): string {
  const segments = id.split("/");
  return segments[segments.length - 1] ?? id;
}

export function isNonProdVmssName(id: string): boolean {
  return NONPROD_NAME_PATTERN.test(vmssNameFromId(id));
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run tests/lib/waste-rules/vmssNaming.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/waste-rules/vmssNaming.ts tests/lib/waste-rules/vmssNaming.test.ts
git commit -m "feat: add VMSS non-prod name heuristic helper"
```

---

### Task 4: Shared helper — `vmssAutoscale.ts`

**Files:**
- Create: `src/lib/waste-rules/vmssAutoscale.ts`
- Test: `tests/lib/waste-rules/vmssAutoscale.test.ts`

**Interfaces:**
- Consumes: `ResourceGraphRow` from `@/lib/azure/resourceGraph`.
- Produces: `AutoscaleProfile` type, `findAutoscaleSettingFor(vmssId: string, resources: ResourceGraphRow[]): ResourceGraphRow | undefined`, `autoscaleProfiles(setting: ResourceGraphRow | undefined): AutoscaleProfile[]`. Used by Tasks 5, 6, 7, 8, 10.

- [ ] **Step 1: Write the failing test**

Create `tests/lib/waste-rules/vmssAutoscale.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import { findAutoscaleSettingFor, autoscaleProfiles } from "@/lib/waste-rules/vmssAutoscale";

const VMSS_ID = "/subscriptions/sub-1/resourceGroups/rg1/providers/Microsoft.Compute/virtualMachineScaleSets/vmss-1";

function autoscaleSetting(targetResourceUri: string, profiles: unknown[]): ResourceGraphRow {
  return {
    id: "/subscriptions/sub-1/resourceGroups/rg1/providers/microsoft.insights/autoscalesettings/setting-1",
    type: "microsoft.insights/autoscalesettings",
    subscriptionId: "sub-1",
    properties: { targetResourceUri, profiles },
  };
}

describe("findAutoscaleSettingFor", () => {
  it("finds the autoscale setting whose targetResourceUri matches the VMSS id, case-insensitively", () => {
    const setting = autoscaleSetting(VMSS_ID.toUpperCase(), []);

    expect(findAutoscaleSettingFor(VMSS_ID, [setting])).toBe(setting);
  });

  it("returns undefined when no autoscale setting targets this VMSS", () => {
    const setting = autoscaleSetting("/subscriptions/sub-1/.../virtualMachineScaleSets/other-vmss", []);

    expect(findAutoscaleSettingFor(VMSS_ID, [setting])).toBeUndefined();
  });

  it("ignores non-autoscalesettings resources", () => {
    const disk: ResourceGraphRow = {
      id: "disk-1",
      type: "microsoft.compute/disks",
      subscriptionId: "sub-1",
      properties: {},
    };

    expect(findAutoscaleSettingFor(VMSS_ID, [disk])).toBeUndefined();
  });
});

describe("autoscaleProfiles", () => {
  it("returns the profiles array from a found setting", () => {
    const profiles = [{ capacity: { minimum: "1", maximum: "5" } }];
    const setting = autoscaleSetting(VMSS_ID, profiles);

    expect(autoscaleProfiles(setting)).toBe(profiles);
  });

  it("returns an empty array when the setting is undefined", () => {
    expect(autoscaleProfiles(undefined)).toEqual([]);
  });

  it("returns an empty array when the setting has no profiles property", () => {
    const setting: ResourceGraphRow = {
      id: "setting-2",
      type: "microsoft.insights/autoscalesettings",
      subscriptionId: "sub-1",
      properties: { targetResourceUri: VMSS_ID },
    };

    expect(autoscaleProfiles(setting)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/lib/waste-rules/vmssAutoscale.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/lib/waste-rules/vmssAutoscale.ts`:

```ts
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";

export interface AutoscaleCapacity {
  minimum?: string;
  maximum?: string;
}

export interface AutoscaleRule {
  metricTrigger?: { metricName?: string };
  scaleAction?: { direction?: string };
}

export interface AutoscaleProfile {
  capacity?: AutoscaleCapacity;
  rules?: AutoscaleRule[];
  recurrence?: unknown;
}

interface AutoscaleSettingProperties {
  targetResourceUri?: string;
  profiles?: AutoscaleProfile[];
}

export function findAutoscaleSettingFor(
  vmssId: string,
  resources: ResourceGraphRow[],
): ResourceGraphRow | undefined {
  const target = vmssId.toLowerCase();
  return resources.find((r) => {
    if (r.type.toLowerCase() !== "microsoft.insights/autoscalesettings") {
      return false;
    }
    const props = r.properties as AutoscaleSettingProperties;
    return props.targetResourceUri?.toLowerCase() === target;
  });
}

export function autoscaleProfiles(setting: ResourceGraphRow | undefined): AutoscaleProfile[] {
  if (!setting) {
    return [];
  }
  const props = setting.properties as AutoscaleSettingProperties;
  return props.profiles ?? [];
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run tests/lib/waste-rules/vmssAutoscale.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/waste-rules/vmssAutoscale.ts tests/lib/waste-rules/vmssAutoscale.test.ts
git commit -m "feat: add shared VMSS autoscale-settings correlation helper"
```

---

### Task 5: Rule `VMSS_NO_AUTOSCALE`

**Files:**
- Create: `src/lib/waste-rules/vmssNoAutoscale.ts`
- Test: `tests/lib/waste-rules/vmssNoAutoscale.test.ts`

**Interfaces:**
- Consumes: `findAutoscaleSettingFor`, `autoscaleProfiles` from `@/lib/waste-rules/vmssAutoscale` (Task 4).
- Produces: `findVmssWithoutAutoscale(resources: ResourceGraphRow[]): WasteFindingCandidate[]`.

- [ ] **Step 1: Write the failing test**

Create `tests/lib/waste-rules/vmssNoAutoscale.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import { findVmssWithoutAutoscale } from "@/lib/waste-rules/vmssNoAutoscale";

const VMSS_ID = "/subscriptions/sub-1/.../virtualMachineScaleSets/vmss-1";

function vmss(id: string): ResourceGraphRow {
  return {
    id,
    type: "microsoft.compute/virtualmachinescalesets",
    subscriptionId: "sub-1",
    sku: { name: "Standard_D2s_v5", capacity: 3 },
    properties: {},
  };
}

function autoscaleSetting(targetResourceUri: string, profiles: unknown[]): ResourceGraphRow {
  return {
    id: "setting-1",
    type: "microsoft.insights/autoscalesettings",
    subscriptionId: "sub-1",
    properties: { targetResourceUri, profiles },
  };
}

describe("findVmssWithoutAutoscale", () => {
  it("flags a VMSS with no autoscale setting at all", () => {
    const resources = [vmss(VMSS_ID)];

    expect(findVmssWithoutAutoscale(resources)).toEqual([
      {
        ruleType: "VMSS_NO_AUTOSCALE",
        resourceId: VMSS_ID,
        subscriptionId: "sub-1",
        savingsCategory: "POTENTIAL_SAVING",
      },
    ]);
  });

  it("flags a VMSS whose autoscale profile has minimum == maximum", () => {
    const resources = [
      vmss(VMSS_ID),
      autoscaleSetting(VMSS_ID, [{ capacity: { minimum: "3", maximum: "3" } }]),
    ];

    expect(findVmssWithoutAutoscale(resources)).toEqual([
      {
        ruleType: "VMSS_NO_AUTOSCALE",
        resourceId: VMSS_ID,
        subscriptionId: "sub-1",
        savingsCategory: "POTENTIAL_SAVING",
      },
    ]);
  });

  it("does not flag a VMSS with a real min/max range", () => {
    const resources = [
      vmss(VMSS_ID),
      autoscaleSetting(VMSS_ID, [{ capacity: { minimum: "2", maximum: "8" } }]),
    ];

    expect(findVmssWithoutAutoscale(resources)).toEqual([]);
  });

  it("ignores non-VMSS resources", () => {
    const disk: ResourceGraphRow = {
      id: "disk-1",
      type: "microsoft.compute/disks",
      subscriptionId: "sub-1",
      properties: {},
    };

    expect(findVmssWithoutAutoscale([disk])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/lib/waste-rules/vmssNoAutoscale.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/lib/waste-rules/vmssNoAutoscale.ts`:

```ts
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import type { WasteFindingCandidate } from "@/lib/waste-rules/types";
import { findAutoscaleSettingFor, autoscaleProfiles } from "@/lib/waste-rules/vmssAutoscale";

export function findVmssWithoutAutoscale(
  resources: ResourceGraphRow[],
): WasteFindingCandidate[] {
  return resources
    .filter((r) => r.type.toLowerCase() === "microsoft.compute/virtualmachinescalesets")
    .filter((r) => {
      const setting = findAutoscaleSettingFor(r.id, resources);
      const profiles = autoscaleProfiles(setting);
      if (profiles.length === 0) {
        return true;
      }
      return profiles.every((p) => {
        const min = Number(p.capacity?.minimum ?? NaN);
        const max = Number(p.capacity?.maximum ?? NaN);
        return !Number.isNaN(min) && !Number.isNaN(max) && min === max;
      });
    })
    .map((r) => ({
      ruleType: "VMSS_NO_AUTOSCALE" as const,
      resourceId: r.id,
      subscriptionId: r.subscriptionId,
      savingsCategory: "POTENTIAL_SAVING" as const,
    }));
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run tests/lib/waste-rules/vmssNoAutoscale.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/waste-rules/vmssNoAutoscale.ts tests/lib/waste-rules/vmssNoAutoscale.test.ts
git commit -m "feat: add VMSS_NO_AUTOSCALE waste rule"
```

---

### Task 6: Rule `VMSS_MAX_INSTANCES_HIGH`

**Files:**
- Create: `src/lib/waste-rules/vmssMaxInstancesHigh.ts`
- Test: `tests/lib/waste-rules/vmssMaxInstancesHigh.test.ts`

**Interfaces:**
- Consumes: `findAutoscaleSettingFor`, `autoscaleProfiles` (Task 4).
- Produces: `findVmssWithHighMaxInstances(resources: ResourceGraphRow[]): WasteFindingCandidate[]`.

- [ ] **Step 1: Write the failing test**

Create `tests/lib/waste-rules/vmssMaxInstancesHigh.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import { findVmssWithHighMaxInstances } from "@/lib/waste-rules/vmssMaxInstancesHigh";

const VMSS_ID = "/subscriptions/sub-1/.../virtualMachineScaleSets/vmss-1";

function vmss(id: string): ResourceGraphRow {
  return {
    id,
    type: "microsoft.compute/virtualmachinescalesets",
    subscriptionId: "sub-1",
    properties: {},
  };
}

function autoscaleSetting(targetResourceUri: string, profiles: unknown[]): ResourceGraphRow {
  return {
    id: "setting-1",
    type: "microsoft.insights/autoscalesettings",
    subscriptionId: "sub-1",
    properties: { targetResourceUri, profiles },
  };
}

describe("findVmssWithHighMaxInstances", () => {
  it("flags a VMSS whose autoscale max exceeds 10", () => {
    const resources = [
      vmss(VMSS_ID),
      autoscaleSetting(VMSS_ID, [{ capacity: { minimum: "2", maximum: "20" } }]),
    ];

    expect(findVmssWithHighMaxInstances(resources)).toEqual([
      {
        ruleType: "VMSS_MAX_INSTANCES_HIGH",
        resourceId: VMSS_ID,
        subscriptionId: "sub-1",
        savingsCategory: "POTENTIAL_SAVING",
      },
    ]);
  });

  it("does not flag a VMSS whose max is at or below 10", () => {
    const resources = [
      vmss(VMSS_ID),
      autoscaleSetting(VMSS_ID, [{ capacity: { minimum: "2", maximum: "10" } }]),
    ];

    expect(findVmssWithHighMaxInstances(resources)).toEqual([]);
  });

  it("does not flag a VMSS with no autoscale setting", () => {
    expect(findVmssWithHighMaxInstances([vmss(VMSS_ID)])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/lib/waste-rules/vmssMaxInstancesHigh.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/lib/waste-rules/vmssMaxInstancesHigh.ts`:

```ts
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import type { WasteFindingCandidate } from "@/lib/waste-rules/types";
import { findAutoscaleSettingFor, autoscaleProfiles } from "@/lib/waste-rules/vmssAutoscale";

const MAX_INSTANCES_THRESHOLD = 10;

export function findVmssWithHighMaxInstances(
  resources: ResourceGraphRow[],
): WasteFindingCandidate[] {
  return resources
    .filter((r) => r.type.toLowerCase() === "microsoft.compute/virtualmachinescalesets")
    .filter((r) => {
      const setting = findAutoscaleSettingFor(r.id, resources);
      const profiles = autoscaleProfiles(setting);
      return profiles.some((p) => {
        const max = Number(p.capacity?.maximum ?? NaN);
        return !Number.isNaN(max) && max > MAX_INSTANCES_THRESHOLD;
      });
    })
    .map((r) => ({
      ruleType: "VMSS_MAX_INSTANCES_HIGH" as const,
      resourceId: r.id,
      subscriptionId: r.subscriptionId,
      savingsCategory: "POTENTIAL_SAVING" as const,
    }));
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run tests/lib/waste-rules/vmssMaxInstancesHigh.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/waste-rules/vmssMaxInstancesHigh.ts tests/lib/waste-rules/vmssMaxInstancesHigh.test.ts
git commit -m "feat: add VMSS_MAX_INSTANCES_HIGH waste rule"
```

---

### Task 7: Rule `VMSS_AUTOSCALE_NO_SCALE_IN`

**Files:**
- Create: `src/lib/waste-rules/vmssAutoscaleNoScaleIn.ts`
- Test: `tests/lib/waste-rules/vmssAutoscaleNoScaleIn.test.ts`

**Interfaces:**
- Consumes: `findAutoscaleSettingFor`, `autoscaleProfiles` (Task 4).
- Produces: `findVmssAutoscaleWithoutScaleIn(resources: ResourceGraphRow[]): WasteFindingCandidate[]`.

- [ ] **Step 1: Write the failing test**

Create `tests/lib/waste-rules/vmssAutoscaleNoScaleIn.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import { findVmssAutoscaleWithoutScaleIn } from "@/lib/waste-rules/vmssAutoscaleNoScaleIn";

const VMSS_ID = "/subscriptions/sub-1/.../virtualMachineScaleSets/vmss-1";

function vmss(id: string): ResourceGraphRow {
  return {
    id,
    type: "microsoft.compute/virtualmachinescalesets",
    subscriptionId: "sub-1",
    properties: {},
  };
}

function autoscaleSetting(targetResourceUri: string, profiles: unknown[]): ResourceGraphRow {
  return {
    id: "setting-1",
    type: "microsoft.insights/autoscalesettings",
    subscriptionId: "sub-1",
    properties: { targetResourceUri, profiles },
  };
}

describe("findVmssAutoscaleWithoutScaleIn", () => {
  it("flags a VMSS whose autoscale has only Increase rules, never Decrease", () => {
    const resources = [
      vmss(VMSS_ID),
      autoscaleSetting(VMSS_ID, [
        {
          capacity: { minimum: "2", maximum: "8" },
          rules: [{ scaleAction: { direction: "Increase" } }],
        },
      ]),
    ];

    expect(findVmssAutoscaleWithoutScaleIn(resources)).toEqual([
      {
        ruleType: "VMSS_AUTOSCALE_NO_SCALE_IN",
        resourceId: VMSS_ID,
        subscriptionId: "sub-1",
        savingsCategory: "POTENTIAL_SAVING",
      },
    ]);
  });

  it("does not flag a VMSS with at least one Decrease rule in any profile", () => {
    const resources = [
      vmss(VMSS_ID),
      autoscaleSetting(VMSS_ID, [
        {
          capacity: { minimum: "2", maximum: "8" },
          rules: [
            { scaleAction: { direction: "Increase" } },
            { scaleAction: { direction: "Decrease" } },
          ],
        },
      ]),
    ];

    expect(findVmssAutoscaleWithoutScaleIn(resources)).toEqual([]);
  });

  it("does not flag a VMSS with no autoscale settings at all (covered by VMSS_NO_AUTOSCALE instead)", () => {
    expect(findVmssAutoscaleWithoutScaleIn([vmss(VMSS_ID)])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/lib/waste-rules/vmssAutoscaleNoScaleIn.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/lib/waste-rules/vmssAutoscaleNoScaleIn.ts`:

```ts
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import type { WasteFindingCandidate } from "@/lib/waste-rules/types";
import { findAutoscaleSettingFor, autoscaleProfiles } from "@/lib/waste-rules/vmssAutoscale";

export function findVmssAutoscaleWithoutScaleIn(
  resources: ResourceGraphRow[],
): WasteFindingCandidate[] {
  return resources
    .filter((r) => r.type.toLowerCase() === "microsoft.compute/virtualmachinescalesets")
    .filter((r) => {
      const setting = findAutoscaleSettingFor(r.id, resources);
      const profiles = autoscaleProfiles(setting);
      if (profiles.length === 0) {
        return false;
      }
      const hasScaleIn = profiles.some((p) =>
        (p.rules ?? []).some((rule) => rule.scaleAction?.direction === "Decrease"),
      );
      return !hasScaleIn;
    })
    .map((r) => ({
      ruleType: "VMSS_AUTOSCALE_NO_SCALE_IN" as const,
      resourceId: r.id,
      subscriptionId: r.subscriptionId,
      savingsCategory: "POTENTIAL_SAVING" as const,
    }));
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run tests/lib/waste-rules/vmssAutoscaleNoScaleIn.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/waste-rules/vmssAutoscaleNoScaleIn.ts tests/lib/waste-rules/vmssAutoscaleNoScaleIn.test.ts
git commit -m "feat: add VMSS_AUTOSCALE_NO_SCALE_IN waste rule"
```

---

### Task 8: Rule `VMSS_SCALEOUT_METRIC_INADEQUATE`

**Files:**
- Create: `src/lib/waste-rules/vmssScaleOutMetricInadequate.ts`
- Test: `tests/lib/waste-rules/vmssScaleOutMetricInadequate.test.ts`

**Interfaces:**
- Consumes: `findAutoscaleSettingFor`, `autoscaleProfiles` (Task 4).
- Produces: `findVmssScaleOutMetricInadequate(resources: ResourceGraphRow[]): WasteFindingCandidate[]`.

- [ ] **Step 1: Write the failing test**

Create `tests/lib/waste-rules/vmssScaleOutMetricInadequate.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import { findVmssScaleOutMetricInadequate } from "@/lib/waste-rules/vmssScaleOutMetricInadequate";

const VMSS_ID = "/subscriptions/sub-1/.../virtualMachineScaleSets/vmss-1";

function vmss(id: string): ResourceGraphRow {
  return {
    id,
    type: "microsoft.compute/virtualmachinescalesets",
    subscriptionId: "sub-1",
    properties: {},
  };
}

function autoscaleSetting(targetResourceUri: string, profiles: unknown[]): ResourceGraphRow {
  return {
    id: "setting-1",
    type: "microsoft.insights/autoscalesettings",
    subscriptionId: "sub-1",
    properties: { targetResourceUri, profiles },
  };
}

describe("findVmssScaleOutMetricInadequate", () => {
  it("flags a VMSS whose scale-out rule uses a metric other than Percentage CPU", () => {
    const resources = [
      vmss(VMSS_ID),
      autoscaleSetting(VMSS_ID, [
        {
          rules: [
            {
              scaleAction: { direction: "Increase" },
              metricTrigger: { metricName: "Queue Length" },
            },
          ],
        },
      ]),
    ];

    expect(findVmssScaleOutMetricInadequate(resources)).toEqual([
      {
        ruleType: "VMSS_SCALEOUT_METRIC_INADEQUATE",
        resourceId: VMSS_ID,
        subscriptionId: "sub-1",
        savingsCategory: "POTENTIAL_SAVING",
      },
    ]);
  });

  it("does not flag a VMSS whose scale-out rule uses Percentage CPU", () => {
    const resources = [
      vmss(VMSS_ID),
      autoscaleSetting(VMSS_ID, [
        {
          rules: [
            {
              scaleAction: { direction: "Increase" },
              metricTrigger: { metricName: "Percentage CPU" },
            },
          ],
        },
      ]),
    ];

    expect(findVmssScaleOutMetricInadequate(resources)).toEqual([]);
  });

  it("ignores Decrease rules regardless of their metric", () => {
    const resources = [
      vmss(VMSS_ID),
      autoscaleSetting(VMSS_ID, [
        {
          rules: [
            {
              scaleAction: { direction: "Decrease" },
              metricTrigger: { metricName: "Queue Length" },
            },
          ],
        },
      ]),
    ];

    expect(findVmssScaleOutMetricInadequate(resources)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/lib/waste-rules/vmssScaleOutMetricInadequate.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/lib/waste-rules/vmssScaleOutMetricInadequate.ts`:

```ts
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import type { WasteFindingCandidate } from "@/lib/waste-rules/types";
import { findAutoscaleSettingFor, autoscaleProfiles } from "@/lib/waste-rules/vmssAutoscale";

const EXPECTED_SCALEOUT_METRIC = "Percentage CPU";

export function findVmssScaleOutMetricInadequate(
  resources: ResourceGraphRow[],
): WasteFindingCandidate[] {
  return resources
    .filter((r) => r.type.toLowerCase() === "microsoft.compute/virtualmachinescalesets")
    .filter((r) => {
      const setting = findAutoscaleSettingFor(r.id, resources);
      const profiles = autoscaleProfiles(setting);
      return profiles.some((p) =>
        (p.rules ?? []).some(
          (rule) =>
            rule.scaleAction?.direction === "Increase" &&
            rule.metricTrigger?.metricName !== EXPECTED_SCALEOUT_METRIC,
        ),
      );
    })
    .map((r) => ({
      ruleType: "VMSS_SCALEOUT_METRIC_INADEQUATE" as const,
      resourceId: r.id,
      subscriptionId: r.subscriptionId,
      savingsCategory: "POTENTIAL_SAVING" as const,
    }));
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run tests/lib/waste-rules/vmssScaleOutMetricInadequate.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/waste-rules/vmssScaleOutMetricInadequate.ts tests/lib/waste-rules/vmssScaleOutMetricInadequate.test.ts
git commit -m "feat: add VMSS_SCALEOUT_METRIC_INADEQUATE waste rule"
```

---

### Task 9: Monitor Metrics — hourly CPU fraction (`getHourlyCpuBelowThreshold`)

**Files:**
- Modify: `src/lib/azure/monitorMetrics.ts`
- Test: `tests/lib/azure/monitorMetrics.test.ts`

**Interfaces:**
- Produces: `getHourlyCpuBelowThreshold(resourceId: string, thresholdPercent: number, days?: number, now?: Date): Promise<number>` — returns the fraction (0..1) of hourly CPU samples below `thresholdPercent`. Consumed by Task 19 (`savingsEstimate.ts`, `nonprod_schedule` method).

- [ ] **Step 1: Write the failing test**

Add to `tests/lib/azure/monitorMetrics.test.ts` (new `describe` block, after the existing `getAverageCpuPercent` one):

```ts
import { getHourlyCpuBelowThreshold } from "@/lib/azure/monitorMetrics";

describe("getHourlyCpuBelowThreshold", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the fraction of hourly samples below the threshold", async () => {
    vi.spyOn(armFetchModule, "armFetch").mockResolvedValue({
      value: [
        {
          timeseries: [
            {
              data: [
                { timeStamp: "2026-09-01T00:00:00Z", average: 2 },
                { timeStamp: "2026-09-01T01:00:00Z", average: 8 },
                { timeStamp: "2026-09-01T02:00:00Z", average: 3 },
                { timeStamp: "2026-09-01T03:00:00Z", average: 40 },
              ],
            },
          ],
        },
      ],
    });

    const fraction = await getHourlyCpuBelowThreshold("/subscriptions/sub-1/vmss-1", 5);

    expect(fraction).toBe(0.5);
  });

  it("returns 0 when there are no data points", async () => {
    vi.spyOn(armFetchModule, "armFetch").mockResolvedValue({
      value: [{ timeseries: [{ data: [] }] }],
    });

    const fraction = await getHourlyCpuBelowThreshold("/subscriptions/sub-1/vmss-1", 5);

    expect(fraction).toBe(0);
  });

  it("queries with PT1H interval instead of P1D", async () => {
    const spy = vi
      .spyOn(armFetchModule, "armFetch")
      .mockResolvedValue({ value: [{ timeseries: [{ data: [] }] }] });

    await getHourlyCpuBelowThreshold("/subscriptions/sub-1/vmss-1", 5, 30);

    const [url] = spy.mock.calls[0];
    expect(url).toContain("interval=PT1H");
    expect(url).toContain("metricnames=Percentage%20CPU");
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/lib/azure/monitorMetrics.test.ts -t "getHourlyCpuBelowThreshold"`
Expected: FAIL — `getHourlyCpuBelowThreshold` is not exported yet.

- [ ] **Step 3: Implement**

In `src/lib/azure/monitorMetrics.ts`, add below the existing `getAverageCpuPercent` function:

```ts
export async function getHourlyCpuBelowThreshold(
  resourceId: string,
  thresholdPercent: number,
  days = 30,
  now: Date = new Date(),
): Promise<number> {
  const start = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const timespan = `${start.toISOString()}/${now.toISOString()}`;
  const url =
    `https://management.azure.com${resourceId}/providers/Microsoft.Insights/metrics` +
    `?api-version=2018-01-01&metricnames=${encodeURIComponent("Percentage CPU")}` +
    `&aggregation=Average&interval=PT1H&timespan=${encodeURIComponent(timespan)}`;

  const response = await armFetch<MetricsResponse>(url);

  const points = response.value[0]?.timeseries?.[0]?.data ?? [];
  const values = points
    .map((p) => p.average)
    .filter((v): v is number => typeof v === "number");

  if (values.length === 0) {
    return 0;
  }
  const belowThreshold = values.filter((v) => v < thresholdPercent).length;
  return belowThreshold / values.length;
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run tests/lib/azure/monitorMetrics.test.ts`
Expected: PASS (both old and new tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/azure/monitorMetrics.ts tests/lib/azure/monitorMetrics.test.ts
git commit -m "feat: add hourly CPU-below-threshold metric for schedule-savings estimation"
```

---

### Task 10: Rule `VMSS_NONPROD_NO_SCHEDULE`

**Files:**
- Create: `src/lib/waste-rules/vmssNonProdNoSchedule.ts`
- Test: `tests/lib/waste-rules/vmssNonProdNoSchedule.test.ts`

**Interfaces:**
- Consumes: `isNonProdVmssName` (Task 3), `findAutoscaleSettingFor`/`autoscaleProfiles` (Task 4).
- Produces: `findVmssNonProdWithoutSchedule(resources: ResourceGraphRow[]): WasteFindingCandidate[]`. Its savings are computed later (Task 19) via `getHourlyCpuBelowThreshold` — this rule only detects, it does not fetch metrics itself.

- [ ] **Step 1: Write the failing test**

Create `tests/lib/waste-rules/vmssNonProdNoSchedule.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import { findVmssNonProdWithoutSchedule } from "@/lib/waste-rules/vmssNonProdNoSchedule";

const DEV_VMSS_ID = "/subscriptions/sub-1/.../virtualMachineScaleSets/vmss-dev-01";
const PROD_VMSS_ID = "/subscriptions/sub-1/.../virtualMachineScaleSets/vmss-prod-01";

function vmss(id: string): ResourceGraphRow {
  return {
    id,
    type: "microsoft.compute/virtualmachinescalesets",
    subscriptionId: "sub-1",
    properties: {},
  };
}

function autoscaleSetting(targetResourceUri: string, profiles: unknown[]): ResourceGraphRow {
  return {
    id: "setting-1",
    type: "microsoft.insights/autoscalesettings",
    subscriptionId: "sub-1",
    properties: { targetResourceUri, profiles },
  };
}

describe("findVmssNonProdWithoutSchedule", () => {
  it("flags a dev-named VMSS with no autoscale recurrence at all", () => {
    expect(findVmssNonProdWithoutSchedule([vmss(DEV_VMSS_ID)])).toEqual([
      {
        ruleType: "VMSS_NONPROD_NO_SCHEDULE",
        resourceId: DEV_VMSS_ID,
        subscriptionId: "sub-1",
        savingsCategory: "POTENTIAL_SAVING",
      },
    ]);
  });

  it("flags a dev-named VMSS whose autoscale profiles have no recurrence block", () => {
    const resources = [
      vmss(DEV_VMSS_ID),
      autoscaleSetting(DEV_VMSS_ID, [{ capacity: { minimum: "1", maximum: "3" } }]),
    ];

    expect(findVmssNonProdWithoutSchedule(resources)).toEqual([
      {
        ruleType: "VMSS_NONPROD_NO_SCHEDULE",
        resourceId: DEV_VMSS_ID,
        subscriptionId: "sub-1",
        savingsCategory: "POTENTIAL_SAVING",
      },
    ]);
  });

  it("does not flag a dev-named VMSS that already has a recurrence-scheduled profile", () => {
    const resources = [
      vmss(DEV_VMSS_ID),
      autoscaleSetting(DEV_VMSS_ID, [
        { capacity: { minimum: "0", maximum: "3" }, recurrence: { frequency: "Week" } },
      ]),
    ];

    expect(findVmssNonProdWithoutSchedule(resources)).toEqual([]);
  });

  it("does not flag a production-named VMSS", () => {
    expect(findVmssNonProdWithoutSchedule([vmss(PROD_VMSS_ID)])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/lib/waste-rules/vmssNonProdNoSchedule.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/lib/waste-rules/vmssNonProdNoSchedule.ts`:

```ts
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import type { WasteFindingCandidate } from "@/lib/waste-rules/types";
import { findAutoscaleSettingFor, autoscaleProfiles } from "@/lib/waste-rules/vmssAutoscale";
import { isNonProdVmssName } from "@/lib/waste-rules/vmssNaming";

export function findVmssNonProdWithoutSchedule(
  resources: ResourceGraphRow[],
): WasteFindingCandidate[] {
  return resources
    .filter((r) => r.type.toLowerCase() === "microsoft.compute/virtualmachinescalesets")
    .filter((r) => isNonProdVmssName(r.id))
    .filter((r) => {
      const setting = findAutoscaleSettingFor(r.id, resources);
      const profiles = autoscaleProfiles(setting);
      return !profiles.some((p) => p.recurrence != null);
    })
    .map((r) => ({
      ruleType: "VMSS_NONPROD_NO_SCHEDULE" as const,
      resourceId: r.id,
      subscriptionId: r.subscriptionId,
      savingsCategory: "POTENTIAL_SAVING" as const,
    }));
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run tests/lib/waste-rules/vmssNonProdNoSchedule.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/waste-rules/vmssNonProdNoSchedule.ts tests/lib/waste-rules/vmssNonProdNoSchedule.test.ts
git commit -m "feat: add VMSS_NONPROD_NO_SCHEDULE waste rule"
```

---

### Task 11: Rule `VMSS_IDLE_LOW_UTILIZATION`

**Files:**
- Create: `src/lib/waste-rules/vmssIdleLowUtilization.ts`
- Test: `tests/lib/waste-rules/vmssIdleLowUtilization.test.ts`

**Interfaces:**
- Consumes: `getAverageCpuPercent` from `@/lib/azure/monitorMetrics` (existing).
- Produces: `findVmssIdleLowUtilization(resources: ResourceGraphRow[], getAverageCpu?: (resourceId: string, days: number) => Promise<number>): Promise<WasteFindingCandidate[]>`.

- [ ] **Step 1: Write the failing test**

Create `tests/lib/waste-rules/vmssIdleLowUtilization.test.ts` (mirrors `idleVirtualMachines.test.ts`):

```ts
import { describe, expect, it, vi } from "vitest";
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import { findVmssIdleLowUtilization } from "@/lib/waste-rules/vmssIdleLowUtilization";

function vmssRow(id: string): ResourceGraphRow {
  return {
    id,
    type: "microsoft.compute/virtualmachinescalesets",
    subscriptionId: "sub-1",
    properties: {},
  };
}

describe("findVmssIdleLowUtilization", () => {
  it("classifies as HARD_SAVING when 90-day CPU average is below 5%", async () => {
    const vmss = vmssRow("/subscriptions/sub-1/vmss-90d-hard");
    const getAverageCpu = vi.fn().mockResolvedValue(2);

    const result = await findVmssIdleLowUtilization([vmss], getAverageCpu);

    expect(result).toEqual([
      {
        ruleType: "VMSS_IDLE_LOW_UTILIZATION",
        resourceId: vmss.id,
        subscriptionId: "sub-1",
        savingsCategory: "HARD_SAVING",
        metricObserved: 2,
        periodAnalyzedDays: 90,
      },
    ]);
  });

  it("classifies as POTENTIAL_SAVING on 30-day CPU below 20% when no stronger tier matches", async () => {
    const vmss = vmssRow("/subscriptions/sub-1/vmss-30d-potential");
    const getAverageCpu = vi.fn().mockImplementation((_id: string, days: number) =>
      Promise.resolve(days === 30 ? 18 : 25),
    );

    const result = await findVmssIdleLowUtilization([vmss], getAverageCpu);

    expect(result).toEqual([
      {
        ruleType: "VMSS_IDLE_LOW_UTILIZATION",
        resourceId: vmss.id,
        subscriptionId: "sub-1",
        savingsCategory: "POTENTIAL_SAVING",
        metricObserved: 18,
        periodAnalyzedDays: 30,
      },
    ]);
  });

  it("excludes a VMSS whose CPU average is at or above every threshold in all windows", async () => {
    const vmss = vmssRow("/subscriptions/sub-1/vmss-busy");
    const getAverageCpu = vi.fn().mockResolvedValue(25);

    const result = await findVmssIdleLowUtilization([vmss], getAverageCpu);

    expect(result).toEqual([]);
  });

  it("never calls the CPU fetcher for a non-VMSS resource", async () => {
    const disk: ResourceGraphRow = {
      id: "disk-1",
      type: "microsoft.compute/disks",
      subscriptionId: "sub-1",
      properties: {},
    };
    const getAverageCpu = vi.fn().mockResolvedValue(0);

    const result = await findVmssIdleLowUtilization([disk], getAverageCpu);

    expect(result).toEqual([]);
    expect(getAverageCpu).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/lib/waste-rules/vmssIdleLowUtilization.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/lib/waste-rules/vmssIdleLowUtilization.ts`:

```ts
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import type { WasteFindingCandidate } from "@/lib/waste-rules/types";
import { getAverageCpuPercent } from "@/lib/azure/monitorMetrics";

interface CpuSeverityTier {
  maxCpuPercent: number;
  days: 30 | 60 | 90;
  savingsCategory: "HARD_SAVING" | "POTENTIAL_SAVING";
}

/** Ordered from most to least severe — the first matching tier wins. Same table as IDLE_VM. */
const CPU_SEVERITY_TIERS: CpuSeverityTier[] = [
  { maxCpuPercent: 5, days: 90, savingsCategory: "HARD_SAVING" },
  { maxCpuPercent: 5, days: 30, savingsCategory: "HARD_SAVING" },
  { maxCpuPercent: 10, days: 60, savingsCategory: "POTENTIAL_SAVING" },
  { maxCpuPercent: 20, days: 30, savingsCategory: "POTENTIAL_SAVING" },
];

export async function findVmssIdleLowUtilization(
  resources: ResourceGraphRow[],
  getAverageCpu: (resourceId: string, days: number) => Promise<number> = getAverageCpuPercent,
): Promise<WasteFindingCandidate[]> {
  const scaleSets = resources.filter(
    (r) => r.type.toLowerCase() === "microsoft.compute/virtualmachinescalesets",
  );

  const candidates: WasteFindingCandidate[] = [];
  for (const vmss of scaleSets) {
    const [cpu30, cpu60, cpu90] = await Promise.all([
      getAverageCpu(vmss.id, 30),
      getAverageCpu(vmss.id, 60),
      getAverageCpu(vmss.id, 90),
    ]);
    const cpuByWindow = new Map<number, number>([
      [30, cpu30],
      [60, cpu60],
      [90, cpu90],
    ]);

    const matchedTier = CPU_SEVERITY_TIERS.find(
      (tier) => (cpuByWindow.get(tier.days) ?? Infinity) < tier.maxCpuPercent,
    );
    if (matchedTier) {
      candidates.push({
        ruleType: "VMSS_IDLE_LOW_UTILIZATION",
        resourceId: vmss.id,
        subscriptionId: vmss.subscriptionId,
        savingsCategory: matchedTier.savingsCategory,
        metricObserved: cpuByWindow.get(matchedTier.days)!,
        periodAnalyzedDays: matchedTier.days,
      });
    }
  }
  return candidates;
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run tests/lib/waste-rules/vmssIdleLowUtilization.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/waste-rules/vmssIdleLowUtilization.ts tests/lib/waste-rules/vmssIdleLowUtilization.test.ts
git commit -m "feat: add VMSS_IDLE_LOW_UTILIZATION waste rule"
```

---

### Task 12: Rule `VMSS_OUTDATED_SKU_GENERATION`

**Files:**
- Create: `src/lib/waste-rules/vmssOutdatedSku.ts`
- Test: `tests/lib/waste-rules/vmssOutdatedSku.test.ts`

**Interfaces:**
- Consumes: `isDeprecatedVmSize` from `@/lib/azure/deprecatedVmSkus` (existing, unchanged).
- Produces: `findOutdatedVmssSkus(resources: ResourceGraphRow[]): WasteFindingCandidate[]`.

- [ ] **Step 1: Write the failing test**

Create `tests/lib/waste-rules/vmssOutdatedSku.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import { findOutdatedVmssSkus } from "@/lib/waste-rules/vmssOutdatedSku";

function vmssWithSize(id: string, vmSize: string): ResourceGraphRow {
  return {
    id,
    type: "microsoft.compute/virtualmachinescalesets",
    subscriptionId: "sub-1",
    properties: { virtualMachineProfile: { hardwareProfile: { vmSize } } },
  };
}

describe("findOutdatedVmssSkus", () => {
  it("flags a VMSS on a deprecated size", () => {
    const vmss = vmssWithSize("/subscriptions/sub-1/vmss-old", "Standard_A2");

    expect(findOutdatedVmssSkus([vmss])).toEqual([
      {
        ruleType: "VMSS_OUTDATED_SKU_GENERATION",
        resourceId: vmss.id,
        subscriptionId: "sub-1",
        savingsCategory: "POTENTIAL_SAVING",
      },
    ]);
  });

  it("does not flag a VMSS on a current-generation size", () => {
    const vmss = vmssWithSize("/subscriptions/sub-1/vmss-current", "Standard_D2s_v5");

    expect(findOutdatedVmssSkus([vmss])).toEqual([]);
  });

  it("ignores non-VMSS resources", () => {
    const disk: ResourceGraphRow = {
      id: "disk-1",
      type: "microsoft.compute/disks",
      subscriptionId: "sub-1",
      properties: {},
    };

    expect(findOutdatedVmssSkus([disk])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/lib/waste-rules/vmssOutdatedSku.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/lib/waste-rules/vmssOutdatedSku.ts`:

```ts
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import type { WasteFindingCandidate } from "@/lib/waste-rules/types";
import { isDeprecatedVmSize } from "@/lib/azure/deprecatedVmSkus";

interface VmssVirtualMachineProfile {
  hardwareProfile?: { vmSize?: string };
}

export function findOutdatedVmssSkus(resources: ResourceGraphRow[]): WasteFindingCandidate[] {
  return resources
    .filter((r) => {
      if (r.type.toLowerCase() !== "microsoft.compute/virtualmachinescalesets") {
        return false;
      }
      const profile = r.properties.virtualMachineProfile as VmssVirtualMachineProfile | undefined;
      const vmSize = profile?.hardwareProfile?.vmSize;
      return typeof vmSize === "string" && isDeprecatedVmSize(vmSize);
    })
    .map((r) => ({
      ruleType: "VMSS_OUTDATED_SKU_GENERATION" as const,
      resourceId: r.id,
      subscriptionId: r.subscriptionId,
      savingsCategory: "POTENTIAL_SAVING" as const,
    }));
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run tests/lib/waste-rules/vmssOutdatedSku.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/waste-rules/vmssOutdatedSku.ts tests/lib/waste-rules/vmssOutdatedSku.test.ts
git commit -m "feat: add VMSS_OUTDATED_SKU_GENERATION waste rule"
```

---

### Task 13: Rule `VMSS_OUTDATED_MODEL_INSTANCES`

**Files:**
- Create: `src/lib/waste-rules/vmssOutdatedModelInstances.ts`
- Test: `tests/lib/waste-rules/vmssOutdatedModelInstances.test.ts`

**Interfaces:**
- Produces: `findVmssOutdatedModelInstances(resources: ResourceGraphRow[]): WasteFindingCandidate[]` — emits one candidate per VMSS (not per stale instance), resourceId = the parent VMSS's id.

- [ ] **Step 1: Write the failing test**

Create `tests/lib/waste-rules/vmssOutdatedModelInstances.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import { findVmssOutdatedModelInstances } from "@/lib/waste-rules/vmssOutdatedModelInstances";

const VMSS_ID =
  "/subscriptions/sub-1/resourceGroups/rg1/providers/Microsoft.Compute/virtualMachineScaleSets/vmss-1";

function instance(index: number, latestModelApplied: boolean): ResourceGraphRow {
  return {
    id: `${VMSS_ID}/virtualMachines/${index}`,
    type: "microsoft.compute/virtualmachinescalesets/virtualmachines",
    subscriptionId: "sub-1",
    properties: { latestModelApplied },
  };
}

describe("findVmssOutdatedModelInstances", () => {
  it("flags the parent VMSS once when at least one instance has latestModelApplied=false", () => {
    const resources = [instance(0, true), instance(1, false), instance(2, true)];

    expect(findVmssOutdatedModelInstances(resources)).toEqual([
      {
        ruleType: "VMSS_OUTDATED_MODEL_INSTANCES",
        resourceId: VMSS_ID,
        subscriptionId: "sub-1",
        savingsCategory: "POTENTIAL_SAVING",
      },
    ]);
  });

  it("does not flag a VMSS whose instances are all on the latest model", () => {
    const resources = [instance(0, true), instance(1, true)];

    expect(findVmssOutdatedModelInstances(resources)).toEqual([]);
  });

  it("emits only one candidate even when multiple instances of the same VMSS are stale", () => {
    const resources = [instance(0, false), instance(1, false)];

    expect(findVmssOutdatedModelInstances(resources)).toHaveLength(1);
  });

  it("ignores non-VMSS-instance resources", () => {
    const disk: ResourceGraphRow = {
      id: "disk-1",
      type: "microsoft.compute/disks",
      subscriptionId: "sub-1",
      properties: {},
    };

    expect(findVmssOutdatedModelInstances([disk])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/lib/waste-rules/vmssOutdatedModelInstances.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/lib/waste-rules/vmssOutdatedModelInstances.ts`:

```ts
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import type { WasteFindingCandidate } from "@/lib/waste-rules/types";

/** VMSS instance ids look like ".../virtualMachineScaleSets/{name}/virtualMachines/{index}". */
function parentVmssId(instanceId: string): string {
  return instanceId.split("/").slice(0, -2).join("/");
}

export function findVmssOutdatedModelInstances(
  resources: ResourceGraphRow[],
): WasteFindingCandidate[] {
  const staleVmssIds = new Set<string>();
  const subscriptionByVmssId = new Map<string, string>();

  for (const r of resources) {
    if (r.type.toLowerCase() !== "microsoft.compute/virtualmachinescalesets/virtualmachines") {
      continue;
    }
    if (r.properties.latestModelApplied !== false) {
      continue;
    }
    const vmssId = parentVmssId(r.id);
    staleVmssIds.add(vmssId);
    subscriptionByVmssId.set(vmssId, r.subscriptionId);
  }

  return Array.from(staleVmssIds).map((vmssId) => ({
    ruleType: "VMSS_OUTDATED_MODEL_INSTANCES" as const,
    resourceId: vmssId,
    subscriptionId: subscriptionByVmssId.get(vmssId)!,
    savingsCategory: "POTENTIAL_SAVING" as const,
  }));
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run tests/lib/waste-rules/vmssOutdatedModelInstances.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/waste-rules/vmssOutdatedModelInstances.ts tests/lib/waste-rules/vmssOutdatedModelInstances.test.ts
git commit -m "feat: add VMSS_OUTDATED_MODEL_INSTANCES waste rule"
```

---

### Task 14: Retail Prices — VMSS cost estimation

**Files:**
- Modify: `src/lib/azure/retailPrices.ts`
- Test: `tests/lib/azure/retailPrices.test.ts`

**Interfaces:**
- Produces: `estimateVmssCost(resource: ResourceGraphRow): Promise<number>` (internal to the dispatcher, but exported for direct testing); wires a new `microsoft.compute/virtualmachinescalesets` branch into `estimateRetailMonthlyCost`.
- Refactors (no external signature change): extracts `fetchVmPriceItemsForSize(region: string, vmSize: string): Promise<RetailPriceItem[]>` out of the existing `fetchVmPriceItems(resource)`, which now just resolves `region`/`vmSize` from the resource and delegates. Existing exported functions (`estimateHybridBenefitMonthlySavings`, `estimateLinuxByolMonthlySavings`, `estimateRetailMonthlyCost`) keep their exact current signatures and behavior.

- [ ] **Step 1: Write the failing test**

Add to `tests/lib/azure/retailPrices.test.ts` (new `describe` block, after `estimateRetailMonthlyCost (VM path)`):

```ts
function vmssResource(vmSize: string, capacity: number, osType?: "Windows" | "Linux"): ResourceGraphRow {
  return {
    id: "/subscriptions/sub-1/vmss-1",
    type: "microsoft.compute/virtualmachinescalesets",
    subscriptionId: "sub-1",
    location: "eastus",
    sku: { name: vmSize, capacity },
    properties: {
      virtualMachineProfile: {
        hardwareProfile: { vmSize },
        ...(osType ? { storageProfile: { osDisk: { osType } } } : {}),
      },
    },
  };
}

describe("estimateRetailMonthlyCost (VMSS path)", () => {
  it("prices a VMSS at its per-instance rate times its instance capacity", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse([
          priceItem({ retailPrice: 0.146, productName: "Virtual Machines Dv2 Series" }),
        ]),
      ),
    );

    const cost = await estimateRetailMonthlyCost(vmssResource("Standard_D2_v2", 4, "Linux"));

    expect(cost).toBeCloseTo(0.146 * 730 * 4, 5);
  });

  it("prices a Windows VMSS at the Windows rate", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse([
          priceItem({ retailPrice: 0.146, productName: "Virtual Machines Dv2 Series" }),
          priceItem({ retailPrice: 0.238, productName: "Virtual Machines Dv2 Series Windows" }),
        ]),
      ),
    );

    const cost = await estimateRetailMonthlyCost(vmssResource("Standard_D2_v2", 2, "Windows"));

    expect(cost).toBeCloseTo(0.238 * 730 * 2, 5);
  });

  it("defaults capacity to 1 when sku.capacity is missing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse([priceItem({ retailPrice: 0.146, productName: "Virtual Machines Dv2 Series" })]),
      ),
    );
    const resource = vmssResource("Standard_D2_v2", 1, "Linux");
    resource.sku = { name: "Standard_D2_v2" };

    const cost = await estimateRetailMonthlyCost(resource);

    expect(cost).toBeCloseTo(0.146 * 730, 5);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/lib/azure/retailPrices.test.ts -t "estimateRetailMonthlyCost (VMSS path)"`
Expected: FAIL — VMSS resources currently price at 0 (no matching branch in `estimateRetailMonthlyCost`).

- [ ] **Step 3: Refactor `fetchVmPriceItems` and add the VMSS cost path**

In `src/lib/azure/retailPrices.ts`, replace the existing `fetchVmPriceItems` function with:

```ts
async function fetchVmPriceItemsForSize(region: string, vmSize: string): Promise<RetailPriceItem[]> {
  const items = await queryRetailPrices(
    `serviceName eq 'Virtual Machines' and armRegionName eq '${escapeODataString(region)}' and armSkuName eq '${escapeODataString(vmSize)}'`,
  );
  return items.filter(
    (item) =>
      item.unitOfMeasure === "1 Hour" &&
      !item.skuName.includes("Spot") &&
      !item.skuName.includes("Low Priority") &&
      !/cloud\s*services/i.test(item.productName),
  );
}

async function fetchVmPriceItems(resource: ResourceGraphRow): Promise<RetailPriceItem[]> {
  const region = resource.location ?? "eastus";
  const hardwareProfile = resource.properties.hardwareProfile as { vmSize?: string } | undefined;
  const vmSize = hardwareProfile?.vmSize;
  if (!vmSize) return [];
  return fetchVmPriceItemsForSize(region, vmSize);
}
```

(This is a pure extraction — `fetchVmPriceItems`'s behavior for VM callers is unchanged.)

Then add, below `isWindowsVm`/`estimateVmCost`:

```ts
interface VmssVirtualMachineProfile {
  hardwareProfile?: { vmSize?: string };
  storageProfile?: { osDisk?: { osType?: string } };
}

function vmssVmSize(resource: ResourceGraphRow): string | undefined {
  const profile = resource.properties.virtualMachineProfile as VmssVirtualMachineProfile | undefined;
  return profile?.hardwareProfile?.vmSize;
}

function isWindowsVmss(resource: ResourceGraphRow): boolean {
  const profile = resource.properties.virtualMachineProfile as VmssVirtualMachineProfile | undefined;
  return profile?.storageProfile?.osDisk?.osType === "Windows";
}

/**
 * Estimates a VM Scale Set's total monthly compute cost: the per-instance retail price
 * (same logic as `estimateVmCost`, read from `virtualMachineProfile` instead of a VM's
 * top-level properties) times its current instance count (`sku.capacity`).
 */
async function estimateVmssCost(resource: ResourceGraphRow): Promise<number> {
  const vmSize = vmssVmSize(resource);
  if (!vmSize) return 0;
  const region = resource.location ?? "eastus";
  const items = await fetchVmPriceItemsForSize(region, vmSize);
  const wantsWindows = isWindowsVmss(resource);
  const price = items.find((item) => item.productName.includes("Windows") === wantsWindows);
  const perInstanceCost = price ? monthlyPriceFromItems([price]) : 0;
  const capacity = resource.sku?.capacity ?? 1;
  return perInstanceCost * capacity;
}
```

Then update `estimateRetailMonthlyCost`'s dispatch, adding this branch right after the `microsoft.compute/virtualmachines` one:

```ts
    if (type === "microsoft.compute/virtualmachinescalesets") {
      return await estimateVmssCost(resource);
    }
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run tests/lib/azure/retailPrices.test.ts`
Expected: PASS (all tests, old and new — the refactor must not break any existing `estimateHybridBenefitMonthlySavings`/`estimateVmCost` test).

- [ ] **Step 5: Commit**

```bash
git add src/lib/azure/retailPrices.ts tests/lib/azure/retailPrices.test.ts
git commit -m "feat: estimate VMSS monthly cost from retail prices, priced per instance x capacity"
```

---

### Task 15: Retail Prices — VMSS Spot savings with regional average fallback

**Files:**
- Modify: `src/lib/azure/retailPrices.ts`
- Test: `tests/lib/azure/retailPrices.test.ts`

**Interfaces:**
- Produces: `estimateVmssSpotMonthlySavings(resource: ResourceGraphRow): Promise<number | null>`. Consumed by Task 19 (`savingsEstimate.ts`, `spot_delta` method).
- Requires adding `armSkuName: string;` to the internal `RetailPriceItem` interface (the real API returns it; needed to group meters by SKU for the regional average).

- [ ] **Step 1: Write the failing test**

Add to `tests/lib/azure/retailPrices.test.ts`:

```ts
import { estimateVmssSpotMonthlySavings } from "@/lib/azure/retailPrices";

function spotAwarePriceItem(overrides: PriceItemOverrides & { armSkuName?: string } = {}) {
  return {
    ...priceItem(overrides),
    armSkuName: overrides.armSkuName ?? "Standard_D2_v2",
  };
}

describe("estimateVmssSpotMonthlySavings", () => {
  it("returns the exact Spot-vs-on-demand delta times capacity when both prices exist for the SKU", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse([
          spotAwarePriceItem({
            retailPrice: 0.146,
            skuName: "D2 v2",
            productName: "Virtual Machines Dv2 Series",
          }),
          spotAwarePriceItem({
            retailPrice: 0.03,
            skuName: "D2 v2 Spot",
            productName: "Virtual Machines Dv2 Series",
          }),
        ]),
      ),
    );

    const savings = await estimateVmssSpotMonthlySavings(vmssResource("Standard_D2_v2", 4, "Linux"));

    expect(savings).toBeCloseTo((0.146 - 0.03) * 730 * 4, 5);
  });

  it("falls back to the regional average Spot discount ratio when no exact Spot price exists for the SKU", async () => {
    const fetchMock = vi.fn();
    // First call: exact-SKU query, returns only the on-demand price (no Spot meter for this SKU).
    fetchMock.mockResolvedValueOnce(
      jsonResponse([
        spotAwarePriceItem({
          retailPrice: 0.2,
          skuName: "D4 v2",
          productName: "Virtual Machines Dv2 Series",
          armSkuName: "Standard_D4_v2",
        }),
      ]),
    );
    // Second call: region-wide query used to compute the average discount ratio.
    fetchMock.mockResolvedValueOnce(
      jsonResponse([
        spotAwarePriceItem({
          retailPrice: 0.1,
          skuName: "D2 v2",
          productName: "Virtual Machines Dv2 Series",
          armSkuName: "Standard_D2_v2",
        }),
        spotAwarePriceItem({
          retailPrice: 0.04,
          skuName: "D2 v2 Spot",
          productName: "Virtual Machines Dv2 Series",
          armSkuName: "Standard_D2_v2",
        }),
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const savings = await estimateVmssSpotMonthlySavings(vmssResource("Standard_D4_v2", 2, "Linux"));

    // ratio = 0.04/0.1 = 0.4 -> spot is 40% of on-demand -> savings = onDemand * (1 - 0.4)
    expect(savings).toBeCloseTo(0.2 * 730 * (1 - 0.4) * 2, 5);
  });

  it("returns null when the VM size can't be determined", async () => {
    const resource: ResourceGraphRow = {
      id: "/subscriptions/sub-1/vmss-1",
      type: "microsoft.compute/virtualmachinescalesets",
      subscriptionId: "sub-1",
      properties: {},
    };
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const savings = await estimateVmssSpotMonthlySavings(resource);

    expect(savings).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/lib/azure/retailPrices.test.ts -t "estimateVmssSpotMonthlySavings"`
Expected: FAIL — not exported yet.

- [ ] **Step 3: Implement**

In `src/lib/azure/retailPrices.ts`:

1. Add `armSkuName: string;` to the `RetailPriceItem` interface:

```ts
interface RetailPriceItem {
  retailPrice: number;
  unitOfMeasure: string;
  meterName: string;
  skuName: string;
  productName: string;
  armRegionName: string;
  armSkuName: string;
  type: string;
}
```

2. Add these functions below `estimateVmssCost` (from Task 14):

```ts
function isHourlyVmMeter(item: RetailPriceItem): boolean {
  return item.unitOfMeasure === "1 Hour" && !/cloud\s*services/i.test(item.productName);
}

async function fetchVmSizePriceCatalog(region: string, vmSize: string): Promise<RetailPriceItem[]> {
  const items = await queryRetailPrices(
    `serviceName eq 'Virtual Machines' and armRegionName eq '${escapeODataString(region)}' and armSkuName eq '${escapeODataString(vmSize)}'`,
  );
  return items.filter(isHourlyVmMeter);
}

/**
 * Average ratio of Spot price to on-demand price across every VM family in a region that
 * publishes both, used only when the VMSS's own SKU has no Spot meter of its own. Derived
 * from live regional pricing data rather than a hardcoded "typical Spot discount" constant,
 * per explicit user direction (see spec §"médias derivadas de dados reais").
 */
async function estimateRegionalSpotDiscountRatio(region: string): Promise<number | null> {
  const items = await queryRetailPrices(
    `serviceName eq 'Virtual Machines' and armRegionName eq '${escapeODataString(region)}'`,
  );
  const hourly = items.filter(isHourlyVmMeter);

  const onDemandBySku = new Map<string, number>();
  const spotBySku = new Map<string, number>();
  for (const item of hourly) {
    if (item.skuName.includes("Low Priority")) continue;
    if (item.skuName.includes("Spot")) {
      spotBySku.set(item.armSkuName, item.retailPrice);
    } else {
      onDemandBySku.set(item.armSkuName, item.retailPrice);
    }
  }

  const ratios: number[] = [];
  for (const [sku, spotPrice] of spotBySku) {
    const onDemandPrice = onDemandBySku.get(sku);
    if (onDemandPrice && onDemandPrice > 0) {
      ratios.push(spotPrice / onDemandPrice);
    }
  }

  if (ratios.length === 0) {
    return null;
  }
  return ratios.reduce((sum, r) => sum + r, 0) / ratios.length;
}

/**
 * Estimated monthly saving from moving a Spot-eligible VMSS to Spot pricing. Prefers the
 * exact Spot meter for this VMSS's own SKU/region; only falls back to the region-wide average
 * discount ratio (never a fixed percentage) when that exact meter isn't published.
 */
export async function estimateVmssSpotMonthlySavings(
  resource: ResourceGraphRow,
): Promise<number | null> {
  const vmSize = vmssVmSize(resource);
  if (!vmSize) return null;
  const region = resource.location ?? "eastus";
  const capacity = resource.sku?.capacity ?? 1;
  const wantsWindows = isWindowsVmss(resource);

  try {
    const items = await fetchVmSizePriceCatalog(region, vmSize);
    const onDemandItem = items.find(
      (item) =>
        !item.skuName.includes("Spot") &&
        !item.skuName.includes("Low Priority") &&
        item.productName.includes("Windows") === wantsWindows,
    );
    const spotItem = items.find(
      (item) => item.skuName.includes("Spot") && item.productName.includes("Windows") === wantsWindows,
    );

    if (onDemandItem && spotItem) {
      const delta = monthlyPriceFromItems([onDemandItem]) - monthlyPriceFromItems([spotItem]);
      if (delta > 0) {
        return delta * capacity;
      }
    }

    if (onDemandItem) {
      const ratio = await estimateRegionalSpotDiscountRatio(region);
      if (ratio !== null) {
        return monthlyPriceFromItems([onDemandItem]) * (1 - ratio) * capacity;
      }
    }
  } catch (error) {
    console.error(`VMSS Spot savings estimation failed for ${resource.id}`, error);
  }
  return null;
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run tests/lib/azure/retailPrices.test.ts`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/azure/retailPrices.ts tests/lib/azure/retailPrices.test.ts
git commit -m "feat: estimate VMSS Spot savings via exact price or regional average discount"
```

---

### Task 16: Rule `VMSS_SPOT_ELIGIBLE`

**Files:**
- Create: `src/lib/waste-rules/vmssSpotEligible.ts`
- Test: `tests/lib/waste-rules/vmssSpotEligible.test.ts`

**Interfaces:**
- Consumes: `isNonProdVmssName` (Task 3).
- Produces: `findVmssSpotEligible(resources: ResourceGraphRow[]): WasteFindingCandidate[]`.

- [ ] **Step 1: Write the failing test**

Create `tests/lib/waste-rules/vmssSpotEligible.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import { findVmssSpotEligible } from "@/lib/waste-rules/vmssSpotEligible";

function vmss(id: string, priority?: string): ResourceGraphRow {
  return {
    id,
    type: "microsoft.compute/virtualmachinescalesets",
    subscriptionId: "sub-1",
    properties: { virtualMachineProfile: priority ? { priority } : {} },
  };
}

describe("findVmssSpotEligible", () => {
  it("flags a dev-named VMSS still running at Regular priority", () => {
    const v = vmss("/subscriptions/sub-1/.../virtualMachineScaleSets/vmss-dev-01", "Regular");

    expect(findVmssSpotEligible([v])).toEqual([
      {
        ruleType: "VMSS_SPOT_ELIGIBLE",
        resourceId: v.id,
        subscriptionId: "sub-1",
        savingsCategory: "POTENTIAL_SAVING",
      },
    ]);
  });

  it("flags a dev-named VMSS with no priority set (defaults to Regular)", () => {
    const v = vmss("/subscriptions/sub-1/.../virtualMachineScaleSets/vmss-test-02");

    expect(findVmssSpotEligible([v])).toHaveLength(1);
  });

  it("does not flag a dev-named VMSS already running at Spot priority", () => {
    const v = vmss("/subscriptions/sub-1/.../virtualMachineScaleSets/vmss-dev-01", "Spot");

    expect(findVmssSpotEligible([v])).toEqual([]);
  });

  it("does not flag a production-named VMSS", () => {
    const v = vmss("/subscriptions/sub-1/.../virtualMachineScaleSets/vmss-prod-01", "Regular");

    expect(findVmssSpotEligible([v])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/lib/waste-rules/vmssSpotEligible.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/lib/waste-rules/vmssSpotEligible.ts`:

```ts
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import type { WasteFindingCandidate } from "@/lib/waste-rules/types";
import { isNonProdVmssName } from "@/lib/waste-rules/vmssNaming";

interface VmssVirtualMachineProfile {
  priority?: string;
}

export function findVmssSpotEligible(resources: ResourceGraphRow[]): WasteFindingCandidate[] {
  return resources
    .filter((r) => r.type.toLowerCase() === "microsoft.compute/virtualmachinescalesets")
    .filter((r) => isNonProdVmssName(r.id))
    .filter((r) => {
      const profile = r.properties.virtualMachineProfile as VmssVirtualMachineProfile | undefined;
      return profile?.priority !== "Spot";
    })
    .map((r) => ({
      ruleType: "VMSS_SPOT_ELIGIBLE" as const,
      resourceId: r.id,
      subscriptionId: r.subscriptionId,
      savingsCategory: "POTENTIAL_SAVING" as const,
    }));
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run tests/lib/waste-rules/vmssSpotEligible.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/waste-rules/vmssSpotEligible.ts tests/lib/waste-rules/vmssSpotEligible.test.ts
git commit -m "feat: add VMSS_SPOT_ELIGIBLE waste rule"
```

---

### Task 17: Reservation Coverage API client (`reservationCoverage.ts`) — includes mandatory live validation

**Files:**
- Create: `src/lib/azure/reservationCoverage.ts`
- Test: `tests/lib/azure/reservationCoverage.test.ts`

**Interfaces:**
- Produces: `findReservationRecommendation(subscriptionId: string, vmSize: string, region: string): Promise<{ properties?: { skuName?: string; location?: string; recommendedQuantity?: number; netSavings?: number } } | undefined>`, `estimateReservationCoverageMonthlySavings(subscriptionId: string, resource: ResourceGraphRow | undefined): Promise<number | null>`. Consumed by Task 18 (rule 9) and Task 19 (`savingsEstimate.ts`, `reservation_recommendation` method).

**This task carries real external-API risk** — read spec §4.7 and memory `verify-azure-retail-prices-queries-live` before starting. Do not skip Step 5.

- [ ] **Step 1: Write the failing test (mocked)**

Create `tests/lib/azure/reservationCoverage.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import * as armFetchModule from "@/lib/azure/armFetch";
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import {
  findReservationRecommendation,
  estimateReservationCoverageMonthlySavings,
} from "@/lib/azure/reservationCoverage";

function vmssResource(vmSize: string, region: string): ResourceGraphRow {
  return {
    id: "/subscriptions/sub-1/vmss-1",
    type: "microsoft.compute/virtualmachinescalesets",
    subscriptionId: "sub-1",
    location: region,
    properties: { virtualMachineProfile: { hardwareProfile: { vmSize } } },
  };
}

describe("findReservationRecommendation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the recommendation matching the SKU and region with a positive recommended quantity", async () => {
    vi.spyOn(armFetchModule, "armFetch").mockResolvedValue({
      value: [
        {
          properties: {
            skuName: "Standard_D2s_v5",
            location: "eastus",
            recommendedQuantity: 3,
            netSavings: 120,
          },
        },
      ],
    });

    const rec = await findReservationRecommendation("sub-1", "Standard_D2s_v5", "eastus");

    expect(rec?.properties?.netSavings).toBe(120);
  });

  it("returns undefined when no recommendation matches the SKU/region", async () => {
    vi.spyOn(armFetchModule, "armFetch").mockResolvedValue({
      value: [
        { properties: { skuName: "Standard_D4s_v5", location: "eastus", recommendedQuantity: 1 } },
      ],
    });

    const rec = await findReservationRecommendation("sub-1", "Standard_D2s_v5", "eastus");

    expect(rec).toBeUndefined();
  });

  it("ignores a recommendation with recommendedQuantity of 0", async () => {
    vi.spyOn(armFetchModule, "armFetch").mockResolvedValue({
      value: [
        {
          properties: {
            skuName: "Standard_D2s_v5",
            location: "eastus",
            recommendedQuantity: 0,
          },
        },
      ],
    });

    const rec = await findReservationRecommendation("sub-1", "Standard_D2s_v5", "eastus");

    expect(rec).toBeUndefined();
  });
});

describe("estimateReservationCoverageMonthlySavings", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the recommendation's netSavings when a match is found", async () => {
    vi.spyOn(armFetchModule, "armFetch").mockResolvedValue({
      value: [
        {
          properties: {
            skuName: "Standard_D2s_v5",
            location: "eastus",
            recommendedQuantity: 2,
            netSavings: 80,
          },
        },
      ],
    });

    const savings = await estimateReservationCoverageMonthlySavings(
      "sub-1",
      vmssResource("Standard_D2s_v5", "eastus"),
    );

    expect(savings).toBe(80);
  });

  it("returns null when the resource is undefined", async () => {
    const savings = await estimateReservationCoverageMonthlySavings("sub-1", undefined);

    expect(savings).toBeNull();
  });

  it("returns null when the API call throws", async () => {
    vi.spyOn(armFetchModule, "armFetch").mockRejectedValue(new Error("throttled"));

    const savings = await estimateReservationCoverageMonthlySavings(
      "sub-1",
      vmssResource("Standard_D2s_v5", "eastus"),
    );

    expect(savings).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/lib/azure/reservationCoverage.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/lib/azure/reservationCoverage.ts`:

```ts
import { armFetch } from "@/lib/azure/armFetch";
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";

interface ReservationRecommendationProperties {
  skuName?: string;
  location?: string;
  recommendedQuantity?: number;
  netSavings?: number;
}

interface ReservationRecommendation {
  properties?: ReservationRecommendationProperties;
}

interface ReservationRecommendationsResponse {
  value: ReservationRecommendation[];
}

interface VmssHardwareProfile {
  virtualMachineProfile?: { hardwareProfile?: { vmSize?: string } };
}

function vmssVmSize(resource: ResourceGraphRow): string | undefined {
  const properties = resource.properties as VmssHardwareProfile;
  return properties.virtualMachineProfile?.hardwareProfile?.vmSize;
}

/**
 * Checks whether Azure's own reservation-recommendation engine currently suggests buying a
 * Reservation for this VM family/region — a recommendation with recommendedQuantity > 0 means
 * Azure itself sees uncovered on-demand usage there, i.e. no Reservation/Savings Plan already
 * covers it. Schema per Microsoft Learn as of authoring time
 * (`Microsoft.Consumption/reservationRecommendations`, api-version 2024-08-01) — validated
 * live per plan Task 17 Step 5 before this was trusted in production.
 */
export async function findReservationRecommendation(
  subscriptionId: string,
  vmSize: string,
  region: string,
): Promise<ReservationRecommendation | undefined> {
  const url =
    `https://management.azure.com/subscriptions/${subscriptionId}` +
    `/providers/Microsoft.Consumption/reservationRecommendations` +
    `?api-version=2024-08-01&$filter=${encodeURIComponent("properties/resourceType eq 'VirtualMachines'")}`;

  const response = await armFetch<ReservationRecommendationsResponse>(url);
  return response.value.find(
    (rec) =>
      rec.properties?.location?.toLowerCase() === region.toLowerCase() &&
      rec.properties?.skuName?.toLowerCase() === vmSize.toLowerCase() &&
      (rec.properties?.recommendedQuantity ?? 0) > 0,
  );
}

export async function estimateReservationCoverageMonthlySavings(
  subscriptionId: string,
  resource: ResourceGraphRow | undefined,
): Promise<number | null> {
  if (!resource) return null;
  const vmSize = vmssVmSize(resource);
  const region = resource.location;
  if (!vmSize || !region) return null;

  try {
    const recommendation = await findReservationRecommendation(subscriptionId, vmSize, region);
    return recommendation?.properties?.netSavings ?? null;
  } catch (error) {
    console.error(`Reservation coverage check failed for ${resource.id}`, error);
    return null;
  }
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run tests/lib/azure/reservationCoverage.test.ts`
Expected: PASS

- [ ] **Step 5: MANDATORY — validate live against the real Azure API before proceeding**

This step cannot be skipped or deferred to code review — it is the task, not an extra. Using an authenticated session against a real (test/sandbox) Azure subscription:

```bash
az account get-access-token --query accessToken -o tsv
```

Then, with that token:

```bash
curl -s -H "Authorization: Bearer <token>" \
  "https://management.azure.com/subscriptions/<real-subscription-id>/providers/Microsoft.Consumption/reservationRecommendations?api-version=2024-08-01&\$filter=properties/resourceType%20eq%20%27VirtualMachines%27"
```

Compare the real response shape against the `ReservationRecommendationProperties` interface above. Specifically confirm:
- The field names `skuName`, `location`, `recommendedQuantity`, `netSavings` actually exist (vs. e.g. `instanceFlexibilityGroup`, `scope`-specific fields that differ between "Shared" and "Single" scope recommendations).
- Whether `netSavings` is already a monthly figure or covers the recommendation's full `term` (e.g. 1 or 3 years) — if it's not monthly, `estimateReservationCoverageMonthlySavings` must divide by the correct number of months before returning.
- Whether the call succeeds with only `Reader` RBAC on the subscription, or needs `Microsoft.Consumption/*/read`/`Microsoft.Capacity/*/read` explicitly. If it 403s, stop and report back — granting new RBAC roles to the scanner's service principal is a permission change outside what this plan can authorize on its own; do not silently work around it.

If the shape differs from what Step 3 assumed, fix `reservationCoverage.ts` and its test to match reality now, before Task 18 builds on it. If the API fails outright (unavailable, wrong permissions, or a scope model your Azure subscription can't produce test data for), stop and report this back rather than guessing — per spec §4.7, the fallback plan is to simplify `VMSS_MISSING_SAVINGS_PLAN_OR_RESERVATION` to a "subscription has zero commitments" signal, which is a scope change that needs to be called out explicitly, not silently substituted.

- [ ] **Step 6: Commit**

```bash
git add src/lib/azure/reservationCoverage.ts tests/lib/azure/reservationCoverage.test.ts
git commit -m "feat: add Reservation Recommendations API client for VMSS coverage checks"
```

---

### Task 18: Rule `VMSS_MISSING_SAVINGS_PLAN_OR_RESERVATION`

**Files:**
- Create: `src/lib/waste-rules/vmssMissingSavingsPlanOrReservation.ts`
- Test: `tests/lib/waste-rules/vmssMissingSavingsPlanOrReservation.test.ts`

**Interfaces:**
- Consumes: `findReservationRecommendation` from `@/lib/azure/reservationCoverage` (Task 17), injectable as a parameter (same DI pattern as `getAverageCpu` in Task 11).
- Produces: `findVmssMissingSavingsPlanOrReservation(resources: ResourceGraphRow[], findRecommendation?): Promise<WasteFindingCandidate[]>`.

- [ ] **Step 1: Write the failing test**

Create `tests/lib/waste-rules/vmssMissingSavingsPlanOrReservation.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import { findVmssMissingSavingsPlanOrReservation } from "@/lib/waste-rules/vmssMissingSavingsPlanOrReservation";

function vmss(id: string, vmSize: string, region: string): ResourceGraphRow {
  return {
    id,
    type: "microsoft.compute/virtualmachinescalesets",
    subscriptionId: "sub-1",
    location: region,
    properties: { virtualMachineProfile: { hardwareProfile: { vmSize } } },
  };
}

describe("findVmssMissingSavingsPlanOrReservation", () => {
  it("flags a VMSS whose SKU/region has a positive reservation recommendation", async () => {
    const v = vmss("/subscriptions/sub-1/vmss-1", "Standard_D2s_v5", "eastus");
    const findRecommendation = vi.fn().mockResolvedValue({
      properties: { netSavings: 100 },
    });

    const result = await findVmssMissingSavingsPlanOrReservation([v], findRecommendation);

    expect(result).toEqual([
      {
        ruleType: "VMSS_MISSING_SAVINGS_PLAN_OR_RESERVATION",
        resourceId: v.id,
        subscriptionId: "sub-1",
        savingsCategory: "POTENTIAL_SAVING",
      },
    ]);
    expect(findRecommendation).toHaveBeenCalledWith("sub-1", "Standard_D2s_v5", "eastus");
  });

  it("does not flag a VMSS with no matching recommendation", async () => {
    const v = vmss("/subscriptions/sub-1/vmss-2", "Standard_D2s_v5", "eastus");
    const findRecommendation = vi.fn().mockResolvedValue(undefined);

    const result = await findVmssMissingSavingsPlanOrReservation([v], findRecommendation);

    expect(result).toEqual([]);
  });

  it("skips a VMSS whose vmSize can't be determined without calling the API", async () => {
    const v: ResourceGraphRow = {
      id: "/subscriptions/sub-1/vmss-3",
      type: "microsoft.compute/virtualmachinescalesets",
      subscriptionId: "sub-1",
      location: "eastus",
      properties: {},
    };
    const findRecommendation = vi.fn();

    const result = await findVmssMissingSavingsPlanOrReservation([v], findRecommendation);

    expect(result).toEqual([]);
    expect(findRecommendation).not.toHaveBeenCalled();
  });

  it("ignores non-VMSS resources", async () => {
    const disk: ResourceGraphRow = {
      id: "disk-1",
      type: "microsoft.compute/disks",
      subscriptionId: "sub-1",
      properties: {},
    };
    const findRecommendation = vi.fn();

    const result = await findVmssMissingSavingsPlanOrReservation([disk], findRecommendation);

    expect(result).toEqual([]);
    expect(findRecommendation).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/lib/waste-rules/vmssMissingSavingsPlanOrReservation.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/lib/waste-rules/vmssMissingSavingsPlanOrReservation.ts`:

```ts
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import type { WasteFindingCandidate } from "@/lib/waste-rules/types";
import { findReservationRecommendation } from "@/lib/azure/reservationCoverage";

interface VmssVirtualMachineProfile {
  hardwareProfile?: { vmSize?: string };
}

export async function findVmssMissingSavingsPlanOrReservation(
  resources: ResourceGraphRow[],
  findRecommendation: (
    subscriptionId: string,
    vmSize: string,
    region: string,
  ) => ReturnType<typeof findReservationRecommendation> = findReservationRecommendation,
): Promise<WasteFindingCandidate[]> {
  const scaleSets = resources.filter(
    (r) => r.type.toLowerCase() === "microsoft.compute/virtualmachinescalesets",
  );

  const candidates: WasteFindingCandidate[] = [];
  for (const vmss of scaleSets) {
    const profile = vmss.properties.virtualMachineProfile as VmssVirtualMachineProfile | undefined;
    const vmSize = profile?.hardwareProfile?.vmSize;
    const region = vmss.location;
    if (!vmSize || !region) {
      continue;
    }

    const recommendation = await findRecommendation(vmss.subscriptionId, vmSize, region);
    if (recommendation) {
      candidates.push({
        ruleType: "VMSS_MISSING_SAVINGS_PLAN_OR_RESERVATION",
        resourceId: vmss.id,
        subscriptionId: vmss.subscriptionId,
        savingsCategory: "POTENTIAL_SAVING",
      });
    }
  }
  return candidates;
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run tests/lib/waste-rules/vmssMissingSavingsPlanOrReservation.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/waste-rules/vmssMissingSavingsPlanOrReservation.ts tests/lib/waste-rules/vmssMissingSavingsPlanOrReservation.test.ts
git commit -m "feat: add VMSS_MISSING_SAVINGS_PLAN_OR_RESERVATION waste rule"
```

---

### Task 19: Wire `savingsEstimate.ts` dispatcher

**Files:**
- Modify: `src/lib/waste-rules/savingsEstimate.ts`
- Test: `tests/lib/waste-rules/savingsEstimate.test.ts`

**Interfaces:**
- Consumes: `getHourlyCpuBelowThreshold` (Task 9), `estimateVmssSpotMonthlySavings` (Task 15), `estimateReservationCoverageMonthlySavings` (Task 17).
- Produces: `SAVINGS_METHOD_BY_RULE` now covers all 19 `WasteRuleType` values (compile-enforced); `estimateMonthlySavings` handles 3 new method branches.

- [ ] **Step 1: Write the failing tests**

Add to `tests/lib/waste-rules/savingsEstimate.test.ts`. First, extend the existing `vi.mock` calls at the top of the file:

```ts
vi.mock("@/lib/azure/retailPrices", () => ({
  estimateHybridBenefitMonthlySavings: vi.fn(),
  estimateLinuxByolMonthlySavings: vi.fn(),
  estimateVmssSpotMonthlySavings: vi.fn(),
}));
vi.mock("@/lib/azure/monitorMetrics", () => ({
  getHourlyCpuBelowThreshold: vi.fn(),
}));
vi.mock("@/lib/azure/reservationCoverage", () => ({
  estimateReservationCoverageMonthlySavings: vi.fn(),
}));
```

Then update the import block to also pull in the new mocked functions:

```ts
import {
  estimateHybridBenefitMonthlySavings,
  estimateLinuxByolMonthlySavings,
  estimateVmssSpotMonthlySavings,
} from "@/lib/azure/retailPrices";
import { getHourlyCpuBelowThreshold } from "@/lib/azure/monitorMetrics";
import { estimateReservationCoverageMonthlySavings } from "@/lib/azure/reservationCoverage";
```

Then add these tests at the end of the `describe("estimateMonthlySavings", ...)` block:

```ts
  it("returns the full resource cost for VMSS_IDLE_LOW_UTILIZATION, like the delete-it rules", async () => {
    const candidate: WasteFindingCandidate = {
      ruleType: "VMSS_IDLE_LOW_UTILIZATION",
      resourceId: "vmss-1",
      subscriptionId: "sub-1",
    };

    const savings = await estimateMonthlySavings(candidate, undefined, 200);

    expect(savings).toBe(200);
  });

  it("multiplies cost by the observed idle-hours fraction for VMSS_NONPROD_NO_SCHEDULE", async () => {
    const candidate: WasteFindingCandidate = {
      ruleType: "VMSS_NONPROD_NO_SCHEDULE",
      resourceId: "vmss-2",
      subscriptionId: "sub-1",
    };
    vi.mocked(getHourlyCpuBelowThreshold).mockResolvedValue(0.7);

    const savings = await estimateMonthlySavings(candidate, undefined, 300);

    expect(savings).toBe(210);
    expect(getHourlyCpuBelowThreshold).toHaveBeenCalledWith("vmss-2", 5, 30);
  });

  it("delegates to the VMSS Spot estimator for VMSS_SPOT_ELIGIBLE", async () => {
    const resource: ResourceGraphRow = {
      id: "vmss-3",
      type: "microsoft.compute/virtualmachinescalesets",
      subscriptionId: "sub-1",
      properties: {},
    };
    const candidate: WasteFindingCandidate = {
      ruleType: "VMSS_SPOT_ELIGIBLE",
      resourceId: "vmss-3",
      subscriptionId: "sub-1",
    };
    vi.mocked(estimateVmssSpotMonthlySavings).mockResolvedValue(75);

    const savings = await estimateMonthlySavings(candidate, resource, 250);

    expect(savings).toBe(75);
    expect(estimateVmssSpotMonthlySavings).toHaveBeenCalledWith(resource);
  });

  it("returns null for VMSS_SPOT_ELIGIBLE when the resource can't be found", async () => {
    const candidate: WasteFindingCandidate = {
      ruleType: "VMSS_SPOT_ELIGIBLE",
      resourceId: "vmss-4",
      subscriptionId: "sub-1",
    };

    const savings = await estimateMonthlySavings(candidate, undefined, 250);

    expect(savings).toBeNull();
    expect(estimateVmssSpotMonthlySavings).not.toHaveBeenCalled();
  });

  it("delegates to the reservation coverage estimator for VMSS_MISSING_SAVINGS_PLAN_OR_RESERVATION", async () => {
    const resource: ResourceGraphRow = {
      id: "vmss-5",
      type: "microsoft.compute/virtualmachinescalesets",
      subscriptionId: "sub-1",
      properties: {},
    };
    const candidate: WasteFindingCandidate = {
      ruleType: "VMSS_MISSING_SAVINGS_PLAN_OR_RESERVATION",
      resourceId: "vmss-5",
      subscriptionId: "sub-1",
    };
    vi.mocked(estimateReservationCoverageMonthlySavings).mockResolvedValue(60);

    const savings = await estimateMonthlySavings(candidate, resource, 400);

    expect(savings).toBe(60);
    expect(estimateReservationCoverageMonthlySavings).toHaveBeenCalledWith("sub-1", resource);
  });

  it.each([
    "VMSS_NO_AUTOSCALE",
    "VMSS_MAX_INSTANCES_HIGH",
    "VMSS_AUTOSCALE_NO_SCALE_IN",
    "VMSS_SCALEOUT_METRIC_INADEQUATE",
    "VMSS_OUTDATED_SKU_GENERATION",
    "VMSS_OUTDATED_MODEL_INSTANCES",
  ] as const)("returns null for %s, since no number can be estimated yet", async (ruleType) => {
    const candidate: WasteFindingCandidate = {
      ruleType,
      resourceId: "vmss-x",
      subscriptionId: "sub-1",
    };

    const savings = await estimateMonthlySavings(candidate, undefined, 30);

    expect(savings).toBeNull();
  });
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/lib/waste-rules/savingsEstimate.test.ts`
Expected: FAIL — new methods don't exist in `SAVINGS_METHOD_BY_RULE` yet, and TypeScript itself will refuse to compile the file once the 10 new `WasteRuleType` values exist (Task 1) without corresponding entries.

- [ ] **Step 3: Implement**

Replace the full contents of `src/lib/waste-rules/savingsEstimate.ts`:

```ts
import type { WasteRuleType } from "@prisma/client";
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import type { WasteFindingCandidate } from "@/lib/waste-rules/types";
import {
  estimateHybridBenefitMonthlySavings,
  estimateLinuxByolMonthlySavings,
  estimateVmssSpotMonthlySavings,
} from "@/lib/azure/retailPrices";
import { getHourlyCpuBelowThreshold } from "@/lib/azure/monitorMetrics";
import { estimateReservationCoverageMonthlySavings } from "@/lib/azure/reservationCoverage";

type SavingsMethod =
  | "full_cost"
  | "hybrid_benefit"
  | "linux_byol"
  | "nonprod_schedule"
  | "spot_delta"
  | "reservation_recommendation"
  | "unknown";

/** Fraction of hours a VMSS's CPU must sit below this to count toward its "off-hours" savings estimate. */
const NONPROD_IDLE_CPU_THRESHOLD_PERCENT = 5;
const NONPROD_SCHEDULE_WINDOW_DAYS = 30;

/**
 * How each rule's saving relates to its resource cost. `Record<WasteRuleType, ...>` (not a
 * `Set`/`if` chain) is deliberate: TypeScript rejects this file if a future rule type is added
 * to the Prisma schema without a decision being made here, instead of it silently defaulting to
 * "unknown".
 */
const SAVINGS_METHOD_BY_RULE: Record<WasteRuleType, SavingsMethod> = {
  ORPHANED_DISK: "full_cost",
  UNASSOCIATED_PUBLIC_IP: "full_cost",
  OLD_SNAPSHOT: "full_cost",
  IDLE_VPN_GATEWAY: "full_cost",
  IDLE_VM: "full_cost",
  VM_STOPPED_RETAINING_RESOURCES: "full_cost",
  VM_MISSING_HYBRID_BENEFIT: "hybrid_benefit",
  VM_MISSING_LINUX_BYOL: "linux_byol",
  VM_OUTDATED_SKU_GENERATION: "unknown",
  VMSS_NO_AUTOSCALE: "unknown",
  VMSS_MAX_INSTANCES_HIGH: "unknown",
  VMSS_AUTOSCALE_NO_SCALE_IN: "unknown",
  VMSS_IDLE_LOW_UTILIZATION: "full_cost",
  VMSS_SCALEOUT_METRIC_INADEQUATE: "unknown",
  VMSS_NONPROD_NO_SCHEDULE: "nonprod_schedule",
  VMSS_OUTDATED_SKU_GENERATION: "unknown",
  VMSS_SPOT_ELIGIBLE: "spot_delta",
  VMSS_MISSING_SAVINGS_PLAN_OR_RESERVATION: "reservation_recommendation",
  VMSS_OUTDATED_MODEL_INSTANCES: "unknown",
};

/**
 * Resolves how much a candidate would actually save, as opposed to what its
 * resource costs — the two only coincide for delete-it rules. Returns `null`
 * when the saving can't be reasonably estimated yet rather than fabricating a
 * number.
 */
export async function estimateMonthlySavings(
  candidate: WasteFindingCandidate,
  resource: ResourceGraphRow | undefined,
  estimatedMonthlyCost: number,
): Promise<number | null> {
  const method = SAVINGS_METHOD_BY_RULE[candidate.ruleType];
  switch (method) {
    case "full_cost":
      return estimatedMonthlyCost;
    case "hybrid_benefit":
      return resource
        ? estimateHybridBenefitMonthlySavings(resource, estimatedMonthlyCost)
        : null;
    case "linux_byol":
      return estimateLinuxByolMonthlySavings(estimatedMonthlyCost);
    case "nonprod_schedule": {
      const idleFraction = await getHourlyCpuBelowThreshold(
        candidate.resourceId,
        NONPROD_IDLE_CPU_THRESHOLD_PERCENT,
        NONPROD_SCHEDULE_WINDOW_DAYS,
      );
      return estimatedMonthlyCost * idleFraction;
    }
    case "spot_delta":
      return resource ? estimateVmssSpotMonthlySavings(resource) : null;
    case "reservation_recommendation":
      return estimateReservationCoverageMonthlySavings(candidate.subscriptionId, resource);
    case "unknown":
      return null;
    default: {
      const exhaustiveCheck: never = method;
      throw new Error(`Unhandled savings method: ${exhaustiveCheck}`);
    }
  }
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run tests/lib/waste-rules/savingsEstimate.test.ts`
Expected: PASS (all tests, old and new)

- [ ] **Step 5: Commit**

```bash
git add src/lib/waste-rules/savingsEstimate.ts tests/lib/waste-rules/savingsEstimate.test.ts
git commit -m "feat: wire VMSS category-2 savings estimation methods into the dispatcher"
```

---

### Task 20: Wire the 10 new rules into `runScan.ts`

**Files:**
- Modify: `src/lib/scanner/runScan.ts`
- Test: `tests/lib/scanner/runScan.test.ts`

**Interfaces:**
- Consumes: all 10 rule functions from Tasks 5–8, 10–13, 16, 18.
- Produces: `runScan` now persists `WasteFinding` rows for all 19 rule types.

- [ ] **Step 1: Write the failing tests**

Add to `tests/lib/scanner/runScan.test.ts`. First, extend the `vi.mock("@/lib/azure/retailPrices", ...)` block to include the two new exports it now needs:

```ts
vi.mock("@/lib/azure/retailPrices", () => ({
  estimateRetailMonthlyCost: vi.fn(),
  estimateHybridBenefitMonthlySavings: vi.fn(),
  estimateLinuxByolMonthlySavings: vi.fn(),
  estimateVmssSpotMonthlySavings: vi.fn(),
}));
vi.mock("@/lib/azure/reservationCoverage", () => ({
  findReservationRecommendation: vi.fn(),
  estimateReservationCoverageMonthlySavings: vi.fn(),
}));
```

And extend the `vi.mock("@/lib/azure/monitorMetrics", ...)` block:

```ts
vi.mock("@/lib/azure/monitorMetrics", () => ({
  getAverageCpuPercent: vi.fn(),
  getHourlyCpuBelowThreshold: vi.fn(),
}));
```

Add the corresponding imports near the top:

```ts
import { getHourlyCpuBelowThreshold } from "@/lib/azure/monitorMetrics";
import { estimateReservationCoverageMonthlySavings } from "@/lib/azure/reservationCoverage";
```

Then add these tests at the end of the `describe("runScan", ...)` block:

```ts
  it("persists a VMSS_NO_AUTOSCALE finding for a VMSS with no autoscale settings", async () => {
    const customer = await prisma.customer.create({
      data: { entraTenantId: "tenant-vmss-1", name: "Acme" },
    });
    const subscription = await prisma.subscription.create({
      data: { customerId: customer.id, azureSubscriptionId: "sub-vmss-1", displayName: "Prod" },
    });

    vi.mocked(queryResourceGraph).mockResolvedValue([
      {
        id: "vmss-1",
        type: "microsoft.compute/virtualmachinescalesets",
        subscriptionId: "sub-vmss-1",
        sku: { name: "Standard_D2s_v5", capacity: 3 },
        properties: {},
      },
    ]);
    vi.mocked(estimateMonthlyCost).mockResolvedValue(90);
    vi.mocked(getSubscriptionMonthToDateSpend).mockResolvedValue(0);
    vi.mocked(getSubscriptionForecast).mockResolvedValue(0);
    vi.mocked(getSubscriptionDailyCostTrend).mockResolvedValue([]);

    await runScan(subscription.id);

    const findings = await prisma.wasteFinding.findMany({
      where: { subscriptionId: subscription.id },
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      ruleType: "VMSS_NO_AUTOSCALE",
      resourceId: "vmss-1",
      savingsCategory: "POTENTIAL_SAVING",
      estimatedMonthlyCost: 90,
      estimatedMonthlySavings: null,
    });
  });

  it("persists a VMSS_IDLE_LOW_UTILIZATION finding using the aggregated VMSS-level CPU metric", async () => {
    const customer = await prisma.customer.create({
      data: { entraTenantId: "tenant-vmss-2", name: "Acme" },
    });
    const subscription = await prisma.subscription.create({
      data: { customerId: customer.id, azureSubscriptionId: "sub-vmss-2", displayName: "Prod" },
    });

    vi.mocked(queryResourceGraph).mockResolvedValue([
      {
        id: "vmss-2",
        type: "microsoft.compute/virtualmachinescalesets",
        subscriptionId: "sub-vmss-2",
        sku: { name: "Standard_D2s_v5", capacity: 2 },
        properties: {},
      },
    ]);
    vi.mocked(estimateMonthlyCost).mockResolvedValue(60);
    vi.mocked(getAverageCpuPercent).mockResolvedValue(2);
    vi.mocked(getSubscriptionMonthToDateSpend).mockResolvedValue(0);
    vi.mocked(getSubscriptionForecast).mockResolvedValue(0);
    vi.mocked(getSubscriptionDailyCostTrend).mockResolvedValue([]);

    await runScan(subscription.id);

    const findings = await prisma.wasteFinding.findMany({
      where: { subscriptionId: subscription.id, ruleType: "VMSS_IDLE_LOW_UTILIZATION" },
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      savingsCategory: "HARD_SAVING",
      metricObserved: 2,
      periodAnalyzedDays: 90,
      estimatedMonthlySavings: 60,
    });
  });

  it("persists a VMSS_NONPROD_NO_SCHEDULE finding with savings from the observed idle-hours fraction", async () => {
    const customer = await prisma.customer.create({
      data: { entraTenantId: "tenant-vmss-3", name: "Acme" },
    });
    const subscription = await prisma.subscription.create({
      data: { customerId: customer.id, azureSubscriptionId: "sub-vmss-3", displayName: "Prod" },
    });

    vi.mocked(queryResourceGraph).mockResolvedValue([
      {
        id: "vmss-dev-3",
        type: "microsoft.compute/virtualmachinescalesets",
        subscriptionId: "sub-vmss-3",
        sku: { name: "Standard_D2s_v5", capacity: 1 },
        properties: {},
      },
    ]);
    vi.mocked(estimateMonthlyCost).mockResolvedValue(100);
    vi.mocked(getAverageCpuPercent).mockResolvedValue(50);
    vi.mocked(getHourlyCpuBelowThreshold).mockResolvedValue(0.6);
    vi.mocked(getSubscriptionMonthToDateSpend).mockResolvedValue(0);
    vi.mocked(getSubscriptionForecast).mockResolvedValue(0);
    vi.mocked(getSubscriptionDailyCostTrend).mockResolvedValue([]);

    await runScan(subscription.id);

    const findings = await prisma.wasteFinding.findMany({
      where: { subscriptionId: subscription.id, ruleType: "VMSS_NONPROD_NO_SCHEDULE" },
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      estimatedMonthlyCost: 100,
      estimatedMonthlySavings: 60,
    });
  });

  it("persists a VMSS_MISSING_SAVINGS_PLAN_OR_RESERVATION finding using the reservation recommendation savings", async () => {
    const customer = await prisma.customer.create({
      data: { entraTenantId: "tenant-vmss-4", name: "Acme" },
    });
    const subscription = await prisma.subscription.create({
      data: { customerId: customer.id, azureSubscriptionId: "sub-vmss-4", displayName: "Prod" },
    });

    vi.mocked(queryResourceGraph).mockResolvedValue([
      {
        id: "vmss-4",
        type: "microsoft.compute/virtualmachinescalesets",
        subscriptionId: "sub-vmss-4",
        location: "eastus",
        sku: { name: "Standard_D2s_v5", capacity: 2 },
        properties: { virtualMachineProfile: { hardwareProfile: { vmSize: "Standard_D2s_v5" } } },
      },
    ]);
    vi.mocked(estimateMonthlyCost).mockResolvedValue(150);
    vi.mocked(getAverageCpuPercent).mockResolvedValue(50);
    const { findReservationRecommendation } = await import("@/lib/azure/reservationCoverage");
    vi.mocked(findReservationRecommendation).mockResolvedValue({
      properties: { netSavings: 45 },
    });
    vi.mocked(estimateReservationCoverageMonthlySavings).mockResolvedValue(45);
    vi.mocked(getSubscriptionMonthToDateSpend).mockResolvedValue(0);
    vi.mocked(getSubscriptionForecast).mockResolvedValue(0);
    vi.mocked(getSubscriptionDailyCostTrend).mockResolvedValue([]);

    await runScan(subscription.id);

    const findings = await prisma.wasteFinding.findMany({
      where: {
        subscriptionId: subscription.id,
        ruleType: "VMSS_MISSING_SAVINGS_PLAN_OR_RESERVATION",
      },
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      resourceId: "vmss-4",
      estimatedMonthlyCost: 150,
      estimatedMonthlySavings: 45,
    });
  });

  it("does not fail the whole scan when the VMSS idle-utilization rule throws", async () => {
    const customer = await prisma.customer.create({
      data: { entraTenantId: "tenant-vmss-5", name: "Acme" },
    });
    const subscription = await prisma.subscription.create({
      data: { customerId: customer.id, azureSubscriptionId: "sub-vmss-5", displayName: "Prod" },
    });

    vi.mocked(queryResourceGraph).mockResolvedValue([
      {
        id: "disk-vmss-5",
        type: "microsoft.compute/disks",
        subscriptionId: "sub-vmss-5",
        properties: { diskState: "Unattached" },
      },
      {
        id: "vmss-5",
        type: "microsoft.compute/virtualmachinescalesets",
        subscriptionId: "sub-vmss-5",
        sku: { name: "Standard_D2s_v5", capacity: 1 },
        properties: {},
      },
    ]);
    vi.mocked(estimateMonthlyCost).mockResolvedValue(9.99);
    vi.mocked(getAverageCpuPercent).mockRejectedValue(new Error("Azure Monitor throttled"));
    vi.mocked(getSubscriptionMonthToDateSpend).mockResolvedValue(0);
    vi.mocked(getSubscriptionForecast).mockResolvedValue(0);
    vi.mocked(getSubscriptionDailyCostTrend).mockResolvedValue([]);

    await runScan(subscription.id);

    const scanRun = await prisma.scanRun.findFirstOrThrow({
      where: { subscriptionId: subscription.id },
    });
    expect(scanRun.status).toBe("SUCCEEDED");

    const findings = await prisma.wasteFinding.findMany({
      where: { subscriptionId: subscription.id },
    });
    expect(findings.map((f) => f.ruleType)).toEqual(["ORPHANED_DISK"]);
  });
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/lib/scanner/runScan.test.ts`
Expected: FAIL — the new rules aren't wired into `runScan` yet, so none of the new findings get persisted.

- [ ] **Step 3: Implement**

In `src/lib/scanner/runScan.ts`, add these imports after the existing rule imports:

```ts
import { findVmssWithoutAutoscale } from "@/lib/waste-rules/vmssNoAutoscale";
import { findVmssWithHighMaxInstances } from "@/lib/waste-rules/vmssMaxInstancesHigh";
import { findVmssAutoscaleWithoutScaleIn } from "@/lib/waste-rules/vmssAutoscaleNoScaleIn";
import { findVmssScaleOutMetricInadequate } from "@/lib/waste-rules/vmssScaleOutMetricInadequate";
import { findVmssNonProdWithoutSchedule } from "@/lib/waste-rules/vmssNonProdNoSchedule";
import { findVmssIdleLowUtilization } from "@/lib/waste-rules/vmssIdleLowUtilization";
import { findOutdatedVmssSkus } from "@/lib/waste-rules/vmssOutdatedSku";
import { findVmssOutdatedModelInstances } from "@/lib/waste-rules/vmssOutdatedModelInstances";
import { findVmssSpotEligible } from "@/lib/waste-rules/vmssSpotEligible";
import { findVmssMissingSavingsPlanOrReservation } from "@/lib/waste-rules/vmssMissingSavingsPlanOrReservation";
```

Then, inside `runScan`, replace:

```ts
    let idleVmCandidates: WasteFindingCandidate[] = [];
    try {
      idleVmCandidates = await findIdleVirtualMachines(resources);
    } catch (error) {
      console.error(
        "Idle VM rule failed; treating as zero idle VMs for this scan",
        error,
      );
    }

    const candidates: WasteFindingCandidate[] = [
      ...findOrphanedDisks(resources),
      ...findUnassociatedPublicIps(resources),
      ...findOldSnapshots(resources),
      ...findIdleVpnGateways(resources),
      ...idleVmCandidates,
      ...findMissingHybridBenefit(resources),
      ...findMissingLinuxByol(resources),
      ...findOutdatedVmSkus(resources),
      ...findStoppedVmsRetainingResources(resources),
    ];
```

with:

```ts
    let idleVmCandidates: WasteFindingCandidate[] = [];
    try {
      idleVmCandidates = await findIdleVirtualMachines(resources);
    } catch (error) {
      console.error(
        "Idle VM rule failed; treating as zero idle VMs for this scan",
        error,
      );
    }

    let idleVmssCandidates: WasteFindingCandidate[] = [];
    try {
      idleVmssCandidates = await findVmssIdleLowUtilization(resources);
    } catch (error) {
      console.error(
        "Idle VMSS rule failed; treating as zero idle VMSS for this scan",
        error,
      );
    }

    let missingReservationCandidates: WasteFindingCandidate[] = [];
    try {
      missingReservationCandidates = await findVmssMissingSavingsPlanOrReservation(resources);
    } catch (error) {
      console.error(
        "VMSS reservation-coverage rule failed; treating as zero findings for this scan",
        error,
      );
    }

    const candidates: WasteFindingCandidate[] = [
      ...findOrphanedDisks(resources),
      ...findUnassociatedPublicIps(resources),
      ...findOldSnapshots(resources),
      ...findIdleVpnGateways(resources),
      ...idleVmCandidates,
      ...findMissingHybridBenefit(resources),
      ...findMissingLinuxByol(resources),
      ...findOutdatedVmSkus(resources),
      ...findStoppedVmsRetainingResources(resources),
      ...findVmssWithoutAutoscale(resources),
      ...findVmssWithHighMaxInstances(resources),
      ...findVmssAutoscaleWithoutScaleIn(resources),
      ...findVmssScaleOutMetricInadequate(resources),
      ...findVmssNonProdWithoutSchedule(resources),
      ...idleVmssCandidates,
      ...findOutdatedVmssSkus(resources),
      ...findVmssOutdatedModelInstances(resources),
      ...findVmssSpotEligible(resources),
      ...missingReservationCandidates,
    ];
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run tests/lib/scanner/runScan.test.ts`
Expected: PASS (all tests, old and new)

- [ ] **Step 5: Commit**

```bash
git add src/lib/scanner/runScan.ts tests/lib/scanner/runScan.test.ts
git commit -m "feat: wire all 10 VMSS category-2 waste rules into the scanner"
```

---

### Task 21: Dashboard category + i18n wiring

**Files:**
- Modify: `src/lib/dashboard-categories.ts`
- Modify: `src/lib/i18n/dictionaries.ts`
- Test: `tests/lib/dashboard-categories.test.ts`, `tests/lib/i18n/dictionaries.test.ts`

**Interfaces:**
- Produces: `categoryForRule` returns `"compute"` for all 10 new rule types; `translate(locale, "rule.VMSS_*")` resolves to a real label (not the raw key) in all 3 locales, for all 10 new rule types.

- [ ] **Step 1: Write the failing tests**

Add to `tests/lib/dashboard-categories.test.ts`, inside `describe("categoryForRule", ...)`:

```ts
  it("maps every VMSS category-2 rule to compute", () => {
    const vmssRuleTypes = [
      "VMSS_NO_AUTOSCALE",
      "VMSS_MAX_INSTANCES_HIGH",
      "VMSS_AUTOSCALE_NO_SCALE_IN",
      "VMSS_IDLE_LOW_UTILIZATION",
      "VMSS_SCALEOUT_METRIC_INADEQUATE",
      "VMSS_NONPROD_NO_SCHEDULE",
      "VMSS_OUTDATED_SKU_GENERATION",
      "VMSS_SPOT_ELIGIBLE",
      "VMSS_MISSING_SAVINGS_PLAN_OR_RESERVATION",
      "VMSS_OUTDATED_MODEL_INSTANCES",
    ] as const;
    for (const ruleType of vmssRuleTypes) {
      expect(categoryForRule(ruleType)).toBe("compute");
    }
  });
```

Add to `tests/lib/i18n/dictionaries.test.ts`:

```ts
import { LOCALES } from "@/lib/i18n/dictionaries";

describe("VMSS category-2 rule labels", () => {
  const vmssRuleKeys = [
    "rule.VMSS_NO_AUTOSCALE",
    "rule.VMSS_MAX_INSTANCES_HIGH",
    "rule.VMSS_AUTOSCALE_NO_SCALE_IN",
    "rule.VMSS_IDLE_LOW_UTILIZATION",
    "rule.VMSS_SCALEOUT_METRIC_INADEQUATE",
    "rule.VMSS_NONPROD_NO_SCHEDULE",
    "rule.VMSS_OUTDATED_SKU_GENERATION",
    "rule.VMSS_SPOT_ELIGIBLE",
    "rule.VMSS_MISSING_SAVINGS_PLAN_OR_RESERVATION",
    "rule.VMSS_OUTDATED_MODEL_INSTANCES",
  ];

  it("has a real translation (not a key fallback) for every VMSS rule key in every locale", () => {
    for (const locale of LOCALES) {
      for (const key of vmssRuleKeys) {
        expect(translate(locale, key)).not.toBe(key);
      }
    }
  });
});
```

- [ ] **Step 2: Run them to confirm they fail**

Run: `npx vitest run tests/lib/dashboard-categories.test.ts tests/lib/i18n/dictionaries.test.ts`
Expected: FAIL — `categoryForRule` throws/returns undefined for the new types (not yet in `CATEGORY_BY_RULE`, so TypeScript itself won't compile until Step 3 below); the i18n test fails because `translate` falls back to the raw key.

- [ ] **Step 3: Implement**

In `src/lib/dashboard-categories.ts`, add to `CATEGORY_BY_RULE`:

```ts
const CATEGORY_BY_RULE: Record<WasteRuleType, DashboardCategory> = {
  ORPHANED_DISK: "storage",
  OLD_SNAPSHOT: "storage",
  IDLE_VM: "compute",
  UNASSOCIATED_PUBLIC_IP: "network",
  IDLE_VPN_GATEWAY: "network",
  VM_MISSING_HYBRID_BENEFIT: "compute",
  VM_MISSING_LINUX_BYOL: "compute",
  VM_OUTDATED_SKU_GENERATION: "compute",
  VM_STOPPED_RETAINING_RESOURCES: "compute",
  VMSS_NO_AUTOSCALE: "compute",
  VMSS_MAX_INSTANCES_HIGH: "compute",
  VMSS_AUTOSCALE_NO_SCALE_IN: "compute",
  VMSS_IDLE_LOW_UTILIZATION: "compute",
  VMSS_SCALEOUT_METRIC_INADEQUATE: "compute",
  VMSS_NONPROD_NO_SCHEDULE: "compute",
  VMSS_OUTDATED_SKU_GENERATION: "compute",
  VMSS_SPOT_ELIGIBLE: "compute",
  VMSS_MISSING_SAVINGS_PLAN_OR_RESERVATION: "compute",
  VMSS_OUTDATED_MODEL_INSTANCES: "compute",
};
```

In `src/lib/i18n/dictionaries.ts`, add to the `"pt-BR"` dictionary (right after `"rule.VM_STOPPED_RETAINING_RESOURCES"`):

```ts
    "rule.VMSS_NO_AUTOSCALE": "VMSS sem autoscaling",
    "rule.VMSS_MAX_INSTANCES_HIGH": "VMSS com máximo de instâncias muito alto",
    "rule.VMSS_AUTOSCALE_NO_SCALE_IN": "VMSS sem regra de scale-in",
    "rule.VMSS_IDLE_LOW_UTILIZATION": "VMSS com baixa utilização",
    "rule.VMSS_SCALEOUT_METRIC_INADEQUATE": "VMSS com scale-out em métrica inadequada",
    "rule.VMSS_NONPROD_NO_SCHEDULE": "VMSS não-produtivo sem agendamento",
    "rule.VMSS_OUTDATED_SKU_GENERATION": "VMSS em SKU/geração descontinuada",
    "rule.VMSS_SPOT_ELIGIBLE": "VMSS elegível para Spot",
    "rule.VMSS_MISSING_SAVINGS_PLAN_OR_RESERVATION": "VMSS sem Savings Plan ou Reservation",
    "rule.VMSS_OUTDATED_MODEL_INSTANCES": "VMSS com instâncias desatualizadas",
```

Add to the `en` dictionary (same position):

```ts
    "rule.VMSS_NO_AUTOSCALE": "VMSS without autoscaling",
    "rule.VMSS_MAX_INSTANCES_HIGH": "VMSS with a high max instance count",
    "rule.VMSS_AUTOSCALE_NO_SCALE_IN": "VMSS with no scale-in rule",
    "rule.VMSS_IDLE_LOW_UTILIZATION": "VMSS with low utilization",
    "rule.VMSS_SCALEOUT_METRIC_INADEQUATE": "VMSS scaling out on an inadequate metric",
    "rule.VMSS_NONPROD_NO_SCHEDULE": "Non-production VMSS with no schedule",
    "rule.VMSS_OUTDATED_SKU_GENERATION": "VMSS on outdated SKU generation",
    "rule.VMSS_SPOT_ELIGIBLE": "VMSS eligible for Spot",
    "rule.VMSS_MISSING_SAVINGS_PLAN_OR_RESERVATION": "VMSS missing Savings Plan or Reservation",
    "rule.VMSS_OUTDATED_MODEL_INSTANCES": "VMSS with outdated instances",
```

Add to the `es` dictionary (same position):

```ts
    "rule.VMSS_NO_AUTOSCALE": "VMSS sin autoscaling",
    "rule.VMSS_MAX_INSTANCES_HIGH": "VMSS con máximo de instancias muy alto",
    "rule.VMSS_AUTOSCALE_NO_SCALE_IN": "VMSS sin regla de scale-in",
    "rule.VMSS_IDLE_LOW_UTILIZATION": "VMSS con baja utilización",
    "rule.VMSS_SCALEOUT_METRIC_INADEQUATE": "VMSS con scale-out en métrica inadecuada",
    "rule.VMSS_NONPROD_NO_SCHEDULE": "VMSS no productivo sin programación",
    "rule.VMSS_OUTDATED_SKU_GENERATION": "VMSS en generación de SKU obsoleta",
    "rule.VMSS_SPOT_ELIGIBLE": "VMSS elegible para Spot",
    "rule.VMSS_MISSING_SAVINGS_PLAN_OR_RESERVATION": "VMSS sin Savings Plan o Reservation",
    "rule.VMSS_OUTDATED_MODEL_INSTANCES": "VMSS con instancias desactualizadas",
```

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `npx vitest run tests/lib/dashboard-categories.test.ts tests/lib/i18n/dictionaries.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/dashboard-categories.ts src/lib/i18n/dictionaries.ts tests/lib/dashboard-categories.test.ts tests/lib/i18n/dictionaries.test.ts
git commit -m "feat: add dashboard category and i18n labels for VMSS category-2 rules"
```

---

### Task 22: Final verification pass

**Files:** none (verification only)

- [ ] **Step 1: Type-check the whole project**

Run: `npx tsc --noEmit`
Expected: no errors. Pay particular attention to `savingsEstimate.ts` and `dashboard-categories.ts` — if either `Record<WasteRuleType, ...>` is missing an entry, this is where it will surface.

- [ ] **Step 2: Run the full test suite**

Run: `npm test`
Expected: all tests pass, including every file touched in Tasks 1–21.

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 4: Confirm Task 17's live validation actually happened**

Re-check: did Task 17 Step 5 (the live curl against `Microsoft.Consumption/reservationRecommendations`) get run against a real subscription, and did `reservationCoverage.ts` get adjusted to match the real response shape if it differed? If this was skipped, stop here and go back — this is the one piece of the plan that cannot be verified by mocked tests alone, per spec §4.7.

- [ ] **Step 5: Update project memory**

Update `finops_catalog_deferred_items.md` (in the memory directory) to note Category 2 is now implemented, and record any deviation from the spec that Task 17's live validation forced (e.g., if the API needed different field names, or RBAC had to be granted, or the fallback to "subscription has zero commitments" had to be used instead of exact-coverage matching).

---

## Self-Review Notes

- **Spec coverage:** All 10 catalog items (§2.1–2.10 of the spec) map to Tasks 5–13, 16, 18. The two "real-data-average" mechanisms (§ "Decisão de projeto") are Tasks 9 and 15. The Reservation API risk (§4.7) is Task 17, with its live-validation gate as a first-class step, not a footnote. Dashboard/i18n wiring (§7 of the spec) is Task 21.
- **Placeholder scan:** no TBD/TODO left in any step; Task 17 has an inherent "go verify reality" gate, but it names the exact command to run and what to check, which is a concrete step, not a placeholder.
- **Type consistency:** verified that `findAutoscaleSettingFor`/`autoscaleProfiles` (Task 4) are imported with identical names/signatures in Tasks 5, 6, 7, 8, 10; `isNonProdVmssName` (Task 3) is imported identically in Tasks 10 and 16; `fetchVmPriceItemsForSize` (Task 14) is reused by name in Task 15; `SAVINGS_METHOD_BY_RULE` keys in Task 19 exactly match the 10 enum literals introduced in Task 1.
