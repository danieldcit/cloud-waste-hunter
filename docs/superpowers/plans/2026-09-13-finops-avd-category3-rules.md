# FinOps Catalog Category 3 (Azure Virtual Desktop) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 8 new Azure-Virtual-Desktop waste-detection rules to Cloud Waste Hunter's scanner, matching the FinOps catalog's Category 3, following the exact architecture already established by Categories 1 and 2.

**Architecture:** Each rule is a pure function in `src/lib/waste-rules/*.ts` that takes the scanner's `ResourceGraphRow[]` inventory and returns `WasteFindingCandidate[]`; `runScan.ts` spreads all rules' candidates into one array and separately estimates cost/savings per candidate. Three new Resource Graph resource types feed the new rules (`hostPools`, `hostPools/sessionHosts`, `scalingPlans`), correlated in-memory via two new shared helpers, the same pattern `vmssAutoscale.ts` already established for Category 2. An AVD session host is technically just a `microsoft.compute/virtualmachines` resource — already in the query since Category 1 — so no new API integration and no new Azure Monitor metric are needed anywhere in this category; every rule reads data already present in a single Resource Graph query.

**Tech Stack:** TypeScript, Next.js, Prisma (Postgres), Vitest, Azure Resource Graph / Azure Retail Prices REST APIs.

**Spec:** `docs/superpowers/specs/2026-09-13-finops-avd-category3-rules-design.md`

## Global Constraints

- All 8 new `WasteRuleType` values use `savingsCategory: "POTENTIAL_SAVING"` — none is a "delete it" rule with no review needed.
- No new fields on `WasteFinding` — reuse `savingsCategory`, `metricObserved`, `periodAnalyzedDays`, `estimatedMonthlySavings` from Categories 1/2.
- Every rule filters `resources` by `r.type.toLowerCase()`, following the exact pattern in every existing file under `src/lib/waste-rules/`.
- `SAVINGS_METHOD_BY_RULE` in `src/lib/waste-rules/savingsEstimate.ts` is a `Record<WasteRuleType, SavingsMethod>` — TypeScript will refuse to compile until every one of the 8 new rule types has an entry. Do not skip this.
- Items 5 ("Memória/CPU excessivas") and 6 ("SKU inadequada") of the PDF's Category 3 get **no new rule** — they're already covered by `IDLE_VM` and `VM_OUTDATED_SKU_GENERATION` (Category 1) on the same underlying VM resource. Do not reintroduce a duplicate CPU or SKU-generation check under an `AVD_*` rule type.
- Item 8 ("FSLogix/Azure Files superdimensionado") is explicitly deferred to Category 6 (Azure Files) — do not implement it in this plan.
- All property names read from `microsoft.desktopvirtualization/*` resources (`sessions`, `status`, `assignedUser`, `resourceId`, `hostPoolType`, `maxSessionLimit`, `hostPoolReferences`, `scalingPlanEnabled`, `hostPoolArmPath`, `schedules`, `daysOfWeek`, `rampUpStartTime`, `offPeakStartTime`) come from Microsoft's public REST API reference, **not** from a live call against a real deployment — the project's test subscription has no AVD resources and deploying one to validate would spend real budget (see spec §2, [[azure-budget-constraint]]). This is a known, accepted gap; do not attempt to "fix" it by guessing different property names without checking the spec first.
- All new `rule.AVD_*` i18n keys must be added to all 3 locale dictionaries (`pt-BR`, `en`, `es`) in the same task — Category 1 shipped with this gap once already (commit `1990b72`).

---

## File Structure

New files:
- `src/lib/waste-rules/avdSessionHosts.ts` — shared session-host/host-pool type guards and correlation helpers (used by rules 1, 2, 3, 4, 7, 8)
- `src/lib/waste-rules/avdScalingPlans.ts` — shared scaling-plan correlation and schedule/off-peak-window math (used by rules 5, 6, 7)
- `src/lib/waste-rules/avdSessionHostLowUtilization.ts` — rule 1 (`AVD_SESSION_HOST_LOW_UTILIZATION`)
- `src/lib/waste-rules/avdHostPoolExcessHosts.ts` — rule 2 (`AVD_HOSTPOOL_EXCESS_HOSTS`)
- `src/lib/waste-rules/avdHostPoolLowDensity.ts` — rule 3 (`AVD_HOSTPOOL_LOW_DENSITY`)
- `src/lib/waste-rules/avdSessionHostPremiumDiskUnused.ts` — rule 4 (`AVD_SESSION_HOST_PREMIUM_DISK_UNUSED`)
- `src/lib/waste-rules/avdScalingPlanMissing.ts` — rule 5 (`AVD_SCALING_PLAN_MISSING`)
- `src/lib/waste-rules/avdScalingPlanDisabled.ts` — rule 6 (`AVD_SCALING_PLAN_DISABLED`)
- `src/lib/waste-rules/avdHostRunningOutsideScalingWindow.ts` — rule 7 (`AVD_HOST_RUNNING_OUTSIDE_SCALING_WINDOW`)
- `src/lib/waste-rules/avdPersonalHostUnused.ts` — rule 8 (`AVD_PERSONAL_HOST_UNUSED`)
- One test file per new source file above, under the mirrored `tests/` path.
- One new Prisma migration folder under `prisma/migrations/`.

Modified files:
- `prisma/schema.prisma` — 8 new `WasteRuleType` enum values
- `src/lib/scanner/runScan.ts` — add 3 resource types to `COMBINED_QUERY_TYPES`; wire in the 8 new rules
- `src/lib/azure/retailPrices.ts` — add `estimatePremiumDiskDowngradeMonthlySavings`
- `src/lib/waste-rules/savingsEstimate.ts` — add 8 new `SAVINGS_METHOD_BY_RULE` entries + 2 new savings methods
- `src/lib/dashboard-categories.ts` — add 8 new `CATEGORY_BY_RULE` entries (all `"compute"`)
- `src/lib/i18n/dictionaries.ts` — add 8 new `rule.AVD_*` keys × 3 locales
- `tests/lib/scanner/runScan.test.ts`, `tests/lib/waste-rules/savingsEstimate.test.ts`, `tests/lib/dashboard-categories.test.ts`, `tests/lib/i18n/dictionaries.test.ts`, `tests/lib/azure/retailPrices.test.ts` — extended, not replaced

---

### Task 1: Prisma schema — 8 new `WasteRuleType` values

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260913120000_add_avd_category3_finops_rules/migration.sql`

**Interfaces:**
- Produces: 8 new `WasteRuleType` enum members, usable as string literals in every later task: `AVD_SESSION_HOST_LOW_UTILIZATION`, `AVD_HOSTPOOL_EXCESS_HOSTS`, `AVD_HOSTPOOL_LOW_DENSITY`, `AVD_SESSION_HOST_PREMIUM_DISK_UNUSED`, `AVD_SCALING_PLAN_MISSING`, `AVD_SCALING_PLAN_DISABLED`, `AVD_HOST_RUNNING_OUTSIDE_SCALING_WINDOW`, `AVD_PERSONAL_HOST_UNUSED`.

- [ ] **Step 1: Edit the enum in `prisma/schema.prisma`**

Find the `enum WasteRuleType { ... }` block and add the 8 new values at the end, immediately before the closing `}`:

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
  AVD_SESSION_HOST_LOW_UTILIZATION
  AVD_HOSTPOOL_EXCESS_HOSTS
  AVD_HOSTPOOL_LOW_DENSITY
  AVD_SESSION_HOST_PREMIUM_DISK_UNUSED
  AVD_SCALING_PLAN_MISSING
  AVD_SCALING_PLAN_DISABLED
  AVD_HOST_RUNNING_OUTSIDE_SCALING_WINDOW
  AVD_PERSONAL_HOST_UNUSED
}
```

- [ ] **Step 2: Write the migration file by hand**

Create `prisma/migrations/20260913120000_add_avd_category3_finops_rules/migration.sql`:

```sql
-- AlterEnum
ALTER TYPE "WasteRuleType" ADD VALUE 'AVD_SESSION_HOST_LOW_UTILIZATION';
ALTER TYPE "WasteRuleType" ADD VALUE 'AVD_HOSTPOOL_EXCESS_HOSTS';
ALTER TYPE "WasteRuleType" ADD VALUE 'AVD_HOSTPOOL_LOW_DENSITY';
ALTER TYPE "WasteRuleType" ADD VALUE 'AVD_SESSION_HOST_PREMIUM_DISK_UNUSED';
ALTER TYPE "WasteRuleType" ADD VALUE 'AVD_SCALING_PLAN_MISSING';
ALTER TYPE "WasteRuleType" ADD VALUE 'AVD_SCALING_PLAN_DISABLED';
ALTER TYPE "WasteRuleType" ADD VALUE 'AVD_HOST_RUNNING_OUTSIDE_SCALING_WINDOW';
ALTER TYPE "WasteRuleType" ADD VALUE 'AVD_PERSONAL_HOST_UNUSED';
```

- [ ] **Step 3: Apply the migration and regenerate the Prisma client**

Run: `npx prisma migrate dev --skip-seed`
Expected: prompts to apply the new migration against the local dev database; it applies cleanly (pure `ADD VALUE` statements, no data migration needed) and regenerates `@prisma/client` types.

If there is no local dev database reachable, at minimum run:
Run: `npx prisma generate`
Expected: regenerates `node_modules/@prisma/client` so `WasteRuleType` includes the 8 new literals — required before any later task's TypeScript will compile.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260913120000_add_avd_category3_finops_rules
git commit -m "feat: add WasteRuleType enum values for AVD category 3 rules"
```

---

### Task 2: Resource Graph — 3 new AVD resource types

**Files:**
- Modify: `src/lib/scanner/runScan.ts`
- Test: `tests/lib/scanner/runScan.test.ts`

**Interfaces:**
- Produces: `COMBINED_QUERY_TYPES` now includes `microsoft.desktopvirtualization/hostpools`, `microsoft.desktopvirtualization/hostpools/sessionhosts`, `microsoft.desktopvirtualization/scalingplans` in its `where type in (...)` list.

- [ ] **Step 1: Write a failing regression test for the query's resource type list**

Add to `tests/lib/scanner/runScan.test.ts`, inside the existing `describe("COMBINED_QUERY resource types", ...)` block (added by Category 2), as a new `it`:

```ts
  it("includes the AVD category-3 resource types", async () => {
    const { COMBINED_QUERY_TYPES } = await import("@/lib/scanner/runScan");
    expect(COMBINED_QUERY_TYPES).toEqual(
      expect.arrayContaining([
        "microsoft.desktopvirtualization/hostpools",
        "microsoft.desktopvirtualization/hostpools/sessionhosts",
        "microsoft.desktopvirtualization/scalingplans",
      ]),
    );
  });
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/lib/scanner/runScan.test.ts -t "includes the AVD category-3 resource types"`
Expected: FAIL — the 3 types aren't in `COMBINED_QUERY_TYPES` yet.

- [ ] **Step 3: Add the 3 new types to `COMBINED_QUERY_TYPES`**

In `src/lib/scanner/runScan.ts`, find:

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
```

Replace with:

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
  "microsoft.desktopvirtualization/hostpools",
  "microsoft.desktopvirtualization/hostpools/sessionhosts",
  "microsoft.desktopvirtualization/scalingplans",
];
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run tests/lib/scanner/runScan.test.ts -t "includes the AVD category-3 resource types"`
Expected: PASS

- [ ] **Step 5: Run the full existing runScan test suite to confirm no regression**

Run: `npx vitest run tests/lib/scanner/runScan.test.ts`
Expected: all existing tests still PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/scanner/runScan.ts tests/lib/scanner/runScan.test.ts
git commit -m "feat: add AVD host pool, session host, and scaling plan types to Resource Graph query"
```

---

### Task 3: Shared helper — `avdSessionHosts.ts`

**Files:**
- Create: `src/lib/waste-rules/avdSessionHosts.ts`
- Test: `tests/lib/waste-rules/avdSessionHosts.test.ts`

**Interfaces:**
- Produces: `SessionHostProperties`, `HostPoolProperties` types; `isSessionHost(r): boolean`, `isHostPool(r): boolean`, `parentHostPoolId(sessionHostId: string): string`, `sessionHostsForPool(poolId: string, resources: ResourceGraphRow[]): ResourceGraphRow[]`, `underlyingVm(sessionHost: ResourceGraphRow, resources: ResourceGraphRow[]): ResourceGraphRow | undefined`. Used by Tasks 5, 6, 7, 9, 12, 13.

- [ ] **Step 1: Write the failing test**

Create `tests/lib/waste-rules/avdSessionHosts.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import {
  isSessionHost,
  isHostPool,
  parentHostPoolId,
  sessionHostsForPool,
  underlyingVm,
} from "@/lib/waste-rules/avdSessionHosts";

const POOL_ID =
  "/subscriptions/sub-1/resourceGroups/rg1/providers/Microsoft.DesktopVirtualization/hostPools/pool-1";
const HOST_ID = `${POOL_ID}/sessionHosts/host-1.contoso.com`;
const VM_ID = "/subscriptions/sub-1/resourceGroups/rg1/providers/Microsoft.Compute/virtualMachines/host-1";

function hostPool(id: string): ResourceGraphRow {
  return {
    id,
    type: "microsoft.desktopvirtualization/hostpools",
    subscriptionId: "sub-1",
    properties: { hostPoolType: "Pooled", maxSessionLimit: 10 },
  };
}

function sessionHost(
  id: string,
  props: Record<string, unknown> = {},
): ResourceGraphRow {
  return {
    id,
    type: "microsoft.desktopvirtualization/hostpools/sessionhosts",
    subscriptionId: "sub-1",
    properties: props,
  };
}

function vm(id: string): ResourceGraphRow {
  return {
    id,
    type: "microsoft.compute/virtualmachines",
    subscriptionId: "sub-1",
    properties: {},
  };
}

describe("isSessionHost", () => {
  it("is true for a sessionHosts resource, case-insensitively", () => {
    expect(isSessionHost(sessionHost(HOST_ID))).toBe(true);
    expect(
      isSessionHost({ ...sessionHost(HOST_ID), type: "Microsoft.DesktopVirtualization/hostPools/sessionHosts" }),
    ).toBe(true);
  });

  it("is false for other resource types", () => {
    expect(isSessionHost(hostPool(POOL_ID))).toBe(false);
  });
});

describe("isHostPool", () => {
  it("is true for a hostPools resource, case-insensitively", () => {
    expect(isHostPool(hostPool(POOL_ID))).toBe(true);
    expect(isHostPool({ ...hostPool(POOL_ID), type: "Microsoft.DesktopVirtualization/hostPools" })).toBe(
      true,
    );
  });

  it("is false for a session host", () => {
    expect(isHostPool(sessionHost(HOST_ID))).toBe(false);
  });
});

describe("parentHostPoolId", () => {
  it("strips the /sessionHosts/{name} suffix to recover the host pool id", () => {
    expect(parentHostPoolId(HOST_ID)).toBe(POOL_ID);
  });
});

describe("sessionHostsForPool", () => {
  it("returns only session hosts whose parent host pool matches, case-insensitively", () => {
    const resources = [
      hostPool(POOL_ID),
      sessionHost(HOST_ID),
      sessionHost(`${POOL_ID.toUpperCase()}/sessionHosts/host-2.contoso.com`),
      sessionHost("/subscriptions/sub-1/.../hostPools/other-pool/sessionHosts/host-3.contoso.com"),
    ];

    const result = sessionHostsForPool(POOL_ID, resources);

    expect(result.map((r) => r.id)).toEqual([
      HOST_ID,
      `${POOL_ID.toUpperCase()}/sessionHosts/host-2.contoso.com`,
    ]);
  });

  it("returns an empty array when no session host belongs to the pool", () => {
    expect(sessionHostsForPool(POOL_ID, [hostPool(POOL_ID)])).toEqual([]);
  });
});

describe("underlyingVm", () => {
  it("resolves the VM referenced by properties.resourceId, case-insensitively", () => {
    const host = sessionHost(HOST_ID, { resourceId: VM_ID.toUpperCase() });
    const resources = [host, vm(VM_ID)];

    expect(underlyingVm(host, resources)).toBe(resources[1]);
  });

  it("returns undefined when resourceId is missing", () => {
    const host = sessionHost(HOST_ID);
    expect(underlyingVm(host, [vm(VM_ID)])).toBeUndefined();
  });

  it("returns undefined when the referenced VM is not in the resource set", () => {
    const host = sessionHost(HOST_ID, { resourceId: VM_ID });
    expect(underlyingVm(host, [])).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/lib/waste-rules/avdSessionHosts.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/lib/waste-rules/avdSessionHosts.ts`:

```ts
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";

export interface SessionHostProperties {
  sessions?: number;
  status?: string;
  assignedUser?: string;
  resourceId?: string;
}

export interface HostPoolProperties {
  hostPoolType?: "Personal" | "Pooled";
  maxSessionLimit?: number;
}

export function isSessionHost(r: ResourceGraphRow): boolean {
  return r.type.toLowerCase() === "microsoft.desktopvirtualization/hostpools/sessionhosts";
}

export function isHostPool(r: ResourceGraphRow): boolean {
  return r.type.toLowerCase() === "microsoft.desktopvirtualization/hostpools";
}

/** Session host ids look like ".../hostPools/{poolName}/sessionHosts/{hostName}". */
export function parentHostPoolId(sessionHostId: string): string {
  return sessionHostId.split("/").slice(0, -2).join("/");
}

export function sessionHostsForPool(
  poolId: string,
  resources: ResourceGraphRow[],
): ResourceGraphRow[] {
  const target = poolId.toLowerCase();
  return resources.filter(
    (r) => isSessionHost(r) && parentHostPoolId(r.id).toLowerCase() === target,
  );
}

export function underlyingVm(
  sessionHost: ResourceGraphRow,
  resources: ResourceGraphRow[],
): ResourceGraphRow | undefined {
  const props = sessionHost.properties as SessionHostProperties;
  const vmId = props.resourceId;
  if (!vmId) {
    return undefined;
  }
  const target = vmId.toLowerCase();
  return resources.find((r) => r.id.toLowerCase() === target);
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run tests/lib/waste-rules/avdSessionHosts.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/waste-rules/avdSessionHosts.ts tests/lib/waste-rules/avdSessionHosts.test.ts
git commit -m "feat: add shared AVD session-host/host-pool correlation helper"
```

---

### Task 4: Shared helper — `avdScalingPlans.ts`

**Files:**
- Create: `src/lib/waste-rules/avdScalingPlans.ts`
- Test: `tests/lib/waste-rules/avdScalingPlans.test.ts`

**Interfaces:**
- Produces: `ScalingPlanHostPoolReference`, `ScalingPlanSchedule` types; `isScalingPlan(r): boolean`, `findScalingPlanReferenceForPool(poolId: string, resources: ResourceGraphRow[]): { plan: ResourceGraphRow; reference: ScalingPlanHostPoolReference } | undefined`, `schedulesForPlan(plan: ResourceGraphRow): ScalingPlanSchedule[]`, `offPeakHoursForSchedule(schedule: ScalingPlanSchedule): number`, `isWithinOffPeakWindow(schedule: ScalingPlanSchedule, now: Date): boolean`. Used by Tasks 10, 11, 12.

- [ ] **Step 1: Write the failing test**

Create `tests/lib/waste-rules/avdScalingPlans.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import {
  isScalingPlan,
  findScalingPlanReferenceForPool,
  schedulesForPlan,
  offPeakHoursForSchedule,
  isWithinOffPeakWindow,
  type ScalingPlanSchedule,
} from "@/lib/waste-rules/avdScalingPlans";

const POOL_ID =
  "/subscriptions/sub-1/resourceGroups/rg1/providers/Microsoft.DesktopVirtualization/hostPools/pool-1";
const PLAN_ID =
  "/subscriptions/sub-1/resourceGroups/rg1/providers/Microsoft.DesktopVirtualization/scalingPlans/plan-1";

function scalingPlan(
  hostPoolReferences: unknown[],
  schedules: unknown[] = [],
): ResourceGraphRow {
  return {
    id: PLAN_ID,
    type: "microsoft.desktopvirtualization/scalingplans",
    subscriptionId: "sub-1",
    properties: { hostPoolReferences, schedules },
  };
}

describe("isScalingPlan", () => {
  it("is true for a scalingPlans resource, case-insensitively", () => {
    expect(isScalingPlan(scalingPlan([]))).toBe(true);
    expect(
      isScalingPlan({ ...scalingPlan([]), type: "Microsoft.DesktopVirtualization/scalingPlans" }),
    ).toBe(true);
  });
});

describe("findScalingPlanReferenceForPool", () => {
  it("finds the reference whose hostPoolArmPath matches, case-insensitively", () => {
    const plan = scalingPlan([{ hostPoolArmPath: POOL_ID.toUpperCase(), scalingPlanEnabled: true }]);

    const found = findScalingPlanReferenceForPool(POOL_ID, [plan]);

    expect(found?.plan).toBe(plan);
    expect(found?.reference.scalingPlanEnabled).toBe(true);
  });

  it("returns undefined when no scaling plan references the pool", () => {
    const plan = scalingPlan([{ hostPoolArmPath: "/subscriptions/sub-1/.../hostPools/other-pool" }]);

    expect(findScalingPlanReferenceForPool(POOL_ID, [plan])).toBeUndefined();
  });

  it("returns undefined when there are no scaling plans at all", () => {
    expect(findScalingPlanReferenceForPool(POOL_ID, [])).toBeUndefined();
  });
});

describe("schedulesForPlan", () => {
  it("returns the schedules array from the plan", () => {
    const schedules = [{ daysOfWeek: ["Monday"] }];
    expect(schedulesForPlan(scalingPlan([], schedules))).toBe(schedules);
  });

  it("returns an empty array when the plan has no schedules property", () => {
    const plan: ResourceGraphRow = {
      id: PLAN_ID,
      type: "microsoft.desktopvirtualization/scalingplans",
      subscriptionId: "sub-1",
      properties: { hostPoolReferences: [] },
    };
    expect(schedulesForPlan(plan)).toEqual([]);
  });
});

const OVERNIGHT_SCHEDULE: ScalingPlanSchedule = {
  daysOfWeek: ["Monday"],
  offPeakStartTime: { hour: 20, minute: 0 },
  rampUpStartTime: { hour: 6, minute: 0 },
};

describe("offPeakHoursForSchedule", () => {
  it("computes the duration across midnight (20:00 -> 06:00 = 10 hours)", () => {
    expect(offPeakHoursForSchedule(OVERNIGHT_SCHEDULE)).toBe(10);
  });

  it("computes the duration within the same day (09:00 -> 17:00 = 8 hours)", () => {
    expect(
      offPeakHoursForSchedule({
        daysOfWeek: ["Monday"],
        offPeakStartTime: { hour: 9, minute: 0 },
        rampUpStartTime: { hour: 17, minute: 0 },
      }),
    ).toBe(8);
  });

  it("returns 0 when either time is missing", () => {
    expect(offPeakHoursForSchedule({ daysOfWeek: ["Monday"] })).toBe(0);
  });
});

describe("isWithinOffPeakWindow", () => {
  it("is true when 'now' falls inside the window on a matching day (same-day part)", () => {
    // 2024-01-01T00:00:00Z is a Monday.
    const monday2200 = new Date("2024-01-01T22:00:00Z");
    expect(isWithinOffPeakWindow(OVERNIGHT_SCHEDULE, monday2200)).toBe(true);
  });

  it("is true when 'now' falls inside the window's overnight carry-over into the next day", () => {
    // 2024-01-02T00:00:00Z is a Tuesday, not itself in daysOfWeek — the window still applies
    // because it started Monday night and hasn't reached rampUpStartTime yet.
    const tuesday0200 = new Date("2024-01-02T02:00:00Z");
    expect(isWithinOffPeakWindow(OVERNIGHT_SCHEDULE, tuesday0200)).toBe(true);
  });

  it("is false during business hours on the same day", () => {
    const monday1000 = new Date("2024-01-01T10:00:00Z");
    expect(isWithinOffPeakWindow(OVERNIGHT_SCHEDULE, monday1000)).toBe(false);
  });

  it("is false on a day not listed in daysOfWeek and not carried over from one that is", () => {
    // 2024-01-03T22:00:00Z is a Wednesday; Tuesday (the prior day) isn't in daysOfWeek either.
    const wednesday2200 = new Date("2024-01-03T22:00:00Z");
    expect(isWithinOffPeakWindow(OVERNIGHT_SCHEDULE, wednesday2200)).toBe(false);
  });

  it("returns false when either time is missing", () => {
    expect(isWithinOffPeakWindow({ daysOfWeek: ["Monday"] }, new Date("2024-01-01T22:00:00Z"))).toBe(
      false,
    );
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/lib/waste-rules/avdScalingPlans.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/lib/waste-rules/avdScalingPlans.ts`:

```ts
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";

export interface ScalingPlanHostPoolReference {
  hostPoolArmPath?: string;
  scalingPlanEnabled?: boolean;
}

export interface ScalingPlanTimeOfDay {
  hour: number;
  minute: number;
}

export interface ScalingPlanSchedule {
  daysOfWeek?: string[];
  rampUpStartTime?: ScalingPlanTimeOfDay;
  peakStartTime?: ScalingPlanTimeOfDay;
  rampDownStartTime?: ScalingPlanTimeOfDay;
  offPeakStartTime?: ScalingPlanTimeOfDay;
}

interface ScalingPlanProperties {
  hostPoolReferences?: ScalingPlanHostPoolReference[];
  schedules?: ScalingPlanSchedule[];
}

const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

export function isScalingPlan(r: ResourceGraphRow): boolean {
  return r.type.toLowerCase() === "microsoft.desktopvirtualization/scalingplans";
}

export function findScalingPlanReferenceForPool(
  poolId: string,
  resources: ResourceGraphRow[],
): { plan: ResourceGraphRow; reference: ScalingPlanHostPoolReference } | undefined {
  const target = poolId.toLowerCase();
  for (const r of resources) {
    if (!isScalingPlan(r)) {
      continue;
    }
    const props = r.properties as ScalingPlanProperties;
    const reference = (props.hostPoolReferences ?? []).find(
      (ref) => ref.hostPoolArmPath?.toLowerCase() === target,
    );
    if (reference) {
      return { plan: r, reference };
    }
  }
  return undefined;
}

export function schedulesForPlan(plan: ResourceGraphRow): ScalingPlanSchedule[] {
  return (plan.properties as ScalingPlanProperties).schedules ?? [];
}

function minutesSinceMidnight(t: ScalingPlanTimeOfDay | undefined): number | undefined {
  if (!t) {
    return undefined;
  }
  return t.hour * 60 + t.minute;
}

/**
 * Duration of the off-peak window (offPeakStartTime -> rampUpStartTime, wrapping past midnight
 * if rampUpStartTime is earlier in the clock than offPeakStartTime), in hours.
 */
export function offPeakHoursForSchedule(schedule: ScalingPlanSchedule): number {
  const start = minutesSinceMidnight(schedule.offPeakStartTime);
  const end = minutesSinceMidnight(schedule.rampUpStartTime);
  if (start === undefined || end === undefined) {
    return 0;
  }
  const durationMinutes = end > start ? end - start : 24 * 60 - start + end;
  return durationMinutes / 60;
}

/**
 * True when `now` (evaluated in UTC — this project does not convert Azure Monitor/schedule
 * timestamps across time zones anywhere else either) falls within this schedule's off-peak
 * window (offPeakStartTime -> rampUpStartTime) on one of its configured days, including the
 * portion of an overnight window that carries into the following calendar day.
 */
export function isWithinOffPeakWindow(schedule: ScalingPlanSchedule, now: Date): boolean {
  const start = minutesSinceMidnight(schedule.offPeakStartTime);
  const end = minutesSinceMidnight(schedule.rampUpStartTime);
  if (start === undefined || end === undefined) {
    return false;
  }

  const nowMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const today = DAY_NAMES[now.getUTCDay()];
  const yesterday = DAY_NAMES[(now.getUTCDay() + 6) % 7];
  const days = schedule.daysOfWeek ?? [];

  if (end > start) {
    // Same-day window (e.g. 09:00 -> 17:00).
    return days.includes(today) && nowMinutes >= start && nowMinutes < end;
  }
  // Wraps past midnight (e.g. 20:00 -> 06:00): the portion before `end` belongs to yesterday's
  // window carrying over; the portion from `start` onward belongs to today's window starting.
  const carriedOverFromYesterday = days.includes(yesterday) && nowMinutes < end;
  const startedToday = days.includes(today) && nowMinutes >= start;
  return carriedOverFromYesterday || startedToday;
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run tests/lib/waste-rules/avdScalingPlans.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/waste-rules/avdScalingPlans.ts tests/lib/waste-rules/avdScalingPlans.test.ts
git commit -m "feat: add shared AVD scaling-plan correlation and off-peak-window helper"
```

---

### Task 5: Rule `AVD_SESSION_HOST_LOW_UTILIZATION`

**Files:**
- Create: `src/lib/waste-rules/avdSessionHostLowUtilization.ts`
- Test: `tests/lib/waste-rules/avdSessionHostLowUtilization.test.ts`

**Interfaces:**
- Consumes: `isSessionHost`, `SessionHostProperties` from `@/lib/waste-rules/avdSessionHosts` (Task 3).
- Produces: `findAvdSessionHostLowUtilization(resources: ResourceGraphRow[]): WasteFindingCandidate[]`. Consumed by Task 9 (rule 4 reuses this rule's output to identify idle hosts).

- [ ] **Step 1: Write the failing test**

Create `tests/lib/waste-rules/avdSessionHostLowUtilization.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import { findAvdSessionHostLowUtilization } from "@/lib/waste-rules/avdSessionHostLowUtilization";

const HOST_ID = "/subscriptions/sub-1/.../hostPools/pool-1/sessionHosts/host-1.contoso.com";

function sessionHost(id: string, props: Record<string, unknown>): ResourceGraphRow {
  return {
    id,
    type: "microsoft.desktopvirtualization/hostpools/sessionhosts",
    subscriptionId: "sub-1",
    properties: props,
  };
}

describe("findAvdSessionHostLowUtilization", () => {
  it("flags an Available host with 0 sessions", () => {
    const resources = [sessionHost(HOST_ID, { sessions: 0, status: "Available" })];

    expect(findAvdSessionHostLowUtilization(resources)).toEqual([
      {
        ruleType: "AVD_SESSION_HOST_LOW_UTILIZATION",
        resourceId: HOST_ID,
        subscriptionId: "sub-1",
        savingsCategory: "POTENTIAL_SAVING",
      },
    ]);
  });

  it("does not flag a host with active sessions", () => {
    const resources = [sessionHost(HOST_ID, { sessions: 2, status: "Available" })];
    expect(findAvdSessionHostLowUtilization(resources)).toEqual([]);
  });

  it("does not flag a host that isn't Available (e.g. Unavailable or NoHeartbeat)", () => {
    const resources = [sessionHost(HOST_ID, { sessions: 0, status: "NoHeartbeat" })];
    expect(findAvdSessionHostLowUtilization(resources)).toEqual([]);
  });

  it("treats a missing sessions field as 0", () => {
    const resources = [sessionHost(HOST_ID, { status: "Available" })];
    expect(findAvdSessionHostLowUtilization(resources)).toHaveLength(1);
  });

  it("ignores non-session-host resources", () => {
    const pool: ResourceGraphRow = {
      id: "/subscriptions/sub-1/.../hostPools/pool-1",
      type: "microsoft.desktopvirtualization/hostpools",
      subscriptionId: "sub-1",
      properties: {},
    };
    expect(findAvdSessionHostLowUtilization([pool])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/lib/waste-rules/avdSessionHostLowUtilization.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/lib/waste-rules/avdSessionHostLowUtilization.ts`:

```ts
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import type { WasteFindingCandidate } from "@/lib/waste-rules/types";
import { isSessionHost, type SessionHostProperties } from "@/lib/waste-rules/avdSessionHosts";

export function findAvdSessionHostLowUtilization(
  resources: ResourceGraphRow[],
): WasteFindingCandidate[] {
  return resources
    .filter(isSessionHost)
    .filter((r) => {
      const props = r.properties as SessionHostProperties;
      return (props.sessions ?? 0) === 0 && props.status === "Available";
    })
    .map((r) => ({
      ruleType: "AVD_SESSION_HOST_LOW_UTILIZATION" as const,
      resourceId: r.id,
      subscriptionId: r.subscriptionId,
      savingsCategory: "POTENTIAL_SAVING" as const,
    }));
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run tests/lib/waste-rules/avdSessionHostLowUtilization.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/waste-rules/avdSessionHostLowUtilization.ts tests/lib/waste-rules/avdSessionHostLowUtilization.test.ts
git commit -m "feat: add AVD_SESSION_HOST_LOW_UTILIZATION waste rule"
```

---

### Task 6: Rule `AVD_HOSTPOOL_EXCESS_HOSTS`

**Files:**
- Create: `src/lib/waste-rules/avdHostPoolExcessHosts.ts`
- Test: `tests/lib/waste-rules/avdHostPoolExcessHosts.test.ts`

**Interfaces:**
- Consumes: `isHostPool`, `sessionHostsForPool`, `HostPoolProperties`, `SessionHostProperties` from `@/lib/waste-rules/avdSessionHosts` (Task 3).
- Produces: `findAvdHostPoolExcessHosts(resources: ResourceGraphRow[]): WasteFindingCandidate[]`.

- [ ] **Step 1: Write the failing test**

Create `tests/lib/waste-rules/avdHostPoolExcessHosts.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import { findAvdHostPoolExcessHosts } from "@/lib/waste-rules/avdHostPoolExcessHosts";

const POOL_ID = "/subscriptions/sub-1/.../hostPools/pool-1";

function hostPool(
  id: string,
  hostPoolType: "Personal" | "Pooled",
  maxSessionLimit: number,
): ResourceGraphRow {
  return {
    id,
    type: "microsoft.desktopvirtualization/hostpools",
    subscriptionId: "sub-1",
    properties: { hostPoolType, maxSessionLimit },
  };
}

function sessionHost(id: string, sessions: number): ResourceGraphRow {
  return {
    id,
    type: "microsoft.desktopvirtualization/hostpools/sessionhosts",
    subscriptionId: "sub-1",
    properties: { sessions, status: "Available" },
  };
}

describe("findAvdHostPoolExcessHosts", () => {
  it("flags a Pooled host pool whose total capacity is at least double its total sessions", () => {
    const resources = [
      hostPool(POOL_ID, "Pooled", 10),
      sessionHost(`${POOL_ID}/sessionHosts/h1`, 1),
      sessionHost(`${POOL_ID}/sessionHosts/h2`, 0),
      sessionHost(`${POOL_ID}/sessionHosts/h3`, 0),
      sessionHost(`${POOL_ID}/sessionHosts/h4`, 1),
    ]; // capacity = 4 * 10 = 40, sessions = 2, 40 >= 2*2

    expect(findAvdHostPoolExcessHosts(resources)).toEqual([
      {
        ruleType: "AVD_HOSTPOOL_EXCESS_HOSTS",
        resourceId: POOL_ID,
        subscriptionId: "sub-1",
        savingsCategory: "POTENTIAL_SAVING",
      },
    ]);
  });

  it("does not flag a pool whose capacity is proportionate to its usage", () => {
    const resources = [
      hostPool(POOL_ID, "Pooled", 10),
      sessionHost(`${POOL_ID}/sessionHosts/h1`, 9),
      sessionHost(`${POOL_ID}/sessionHosts/h2`, 8),
    ]; // capacity = 20, sessions = 17, 20 < 17*2

    expect(findAvdHostPoolExcessHosts(resources)).toEqual([]);
  });

  it("does not flag a Personal host pool", () => {
    const resources = [
      hostPool(POOL_ID, "Personal", 1),
      sessionHost(`${POOL_ID}/sessionHosts/h1`, 0),
    ];

    expect(findAvdHostPoolExcessHosts(resources)).toEqual([]);
  });

  it("does not flag a pool with no session hosts", () => {
    expect(findAvdHostPoolExcessHosts([hostPool(POOL_ID, "Pooled", 10)])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/lib/waste-rules/avdHostPoolExcessHosts.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/lib/waste-rules/avdHostPoolExcessHosts.ts`:

```ts
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import type { WasteFindingCandidate } from "@/lib/waste-rules/types";
import {
  isHostPool,
  sessionHostsForPool,
  type HostPoolProperties,
  type SessionHostProperties,
} from "@/lib/waste-rules/avdSessionHosts";

/** Configured capacity must be at least this multiple of observed usage to count as "excess". */
const CAPACITY_TO_USAGE_RATIO_THRESHOLD = 2;

export function findAvdHostPoolExcessHosts(
  resources: ResourceGraphRow[],
): WasteFindingCandidate[] {
  return resources
    .filter(isHostPool)
    .filter((r) => (r.properties as HostPoolProperties).hostPoolType === "Pooled")
    .filter((pool) => {
      const maxSessionLimit = (pool.properties as HostPoolProperties).maxSessionLimit ?? 0;
      const hosts = sessionHostsForPool(pool.id, resources);
      if (hosts.length === 0 || maxSessionLimit === 0) {
        return false;
      }
      const totalCapacity = hosts.length * maxSessionLimit;
      const totalSessions = hosts.reduce(
        (sum, h) => sum + ((h.properties as SessionHostProperties).sessions ?? 0),
        0,
      );
      return totalCapacity >= totalSessions * CAPACITY_TO_USAGE_RATIO_THRESHOLD;
    })
    .map((pool) => ({
      ruleType: "AVD_HOSTPOOL_EXCESS_HOSTS" as const,
      resourceId: pool.id,
      subscriptionId: pool.subscriptionId,
      savingsCategory: "POTENTIAL_SAVING" as const,
    }));
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run tests/lib/waste-rules/avdHostPoolExcessHosts.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/waste-rules/avdHostPoolExcessHosts.ts tests/lib/waste-rules/avdHostPoolExcessHosts.test.ts
git commit -m "feat: add AVD_HOSTPOOL_EXCESS_HOSTS waste rule"
```

---

### Task 7: Rule `AVD_HOSTPOOL_LOW_DENSITY`

**Files:**
- Create: `src/lib/waste-rules/avdHostPoolLowDensity.ts`
- Test: `tests/lib/waste-rules/avdHostPoolLowDensity.test.ts`

**Interfaces:**
- Consumes: `isHostPool`, `sessionHostsForPool`, `HostPoolProperties`, `SessionHostProperties` from `@/lib/waste-rules/avdSessionHosts` (Task 3).
- Produces: `findAvdHostPoolLowDensity(resources: ResourceGraphRow[]): WasteFindingCandidate[]`.

- [ ] **Step 1: Write the failing test**

Create `tests/lib/waste-rules/avdHostPoolLowDensity.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import { findAvdHostPoolLowDensity } from "@/lib/waste-rules/avdHostPoolLowDensity";

const POOL_ID = "/subscriptions/sub-1/.../hostPools/pool-1";

function hostPool(
  id: string,
  hostPoolType: "Personal" | "Pooled",
  maxSessionLimit: number,
): ResourceGraphRow {
  return {
    id,
    type: "microsoft.desktopvirtualization/hostpools",
    subscriptionId: "sub-1",
    properties: { hostPoolType, maxSessionLimit },
  };
}

function sessionHost(id: string, sessions: number, status = "Available"): ResourceGraphRow {
  return {
    id,
    type: "microsoft.desktopvirtualization/hostpools/sessionhosts",
    subscriptionId: "sub-1",
    properties: { sessions, status },
  };
}

describe("findAvdHostPoolLowDensity", () => {
  it("flags a Pooled host pool whose average sessions per host is under 30% of maxSessionLimit", () => {
    const resources = [
      hostPool(POOL_ID, "Pooled", 10),
      sessionHost(`${POOL_ID}/sessionHosts/h1`, 2),
      sessionHost(`${POOL_ID}/sessionHosts/h2`, 1),
    ]; // average = 1.5, 30% of 10 = 3, 1.5 < 3

    expect(findAvdHostPoolLowDensity(resources)).toEqual([
      {
        ruleType: "AVD_HOSTPOOL_LOW_DENSITY",
        resourceId: POOL_ID,
        subscriptionId: "sub-1",
        savingsCategory: "POTENTIAL_SAVING",
      },
    ]);
  });

  it("does not flag a pool whose average density is at or above the threshold", () => {
    const resources = [
      hostPool(POOL_ID, "Pooled", 10),
      sessionHost(`${POOL_ID}/sessionHosts/h1`, 4),
      sessionHost(`${POOL_ID}/sessionHosts/h2`, 4),
    ]; // average = 4, 30% of 10 = 3, 4 >= 3

    expect(findAvdHostPoolLowDensity(resources)).toEqual([]);
  });

  it("excludes hosts that are not Available from the density average", () => {
    const resources = [
      hostPool(POOL_ID, "Pooled", 10),
      sessionHost(`${POOL_ID}/sessionHosts/h1`, 5),
      sessionHost(`${POOL_ID}/sessionHosts/h2`, 0, "NoHeartbeat"),
    ]; // only h1 counts: average = 5, 30% of 10 = 3, 5 >= 3 -> not flagged

    expect(findAvdHostPoolLowDensity(resources)).toEqual([]);
  });

  it("does not flag a Personal host pool", () => {
    const resources = [
      hostPool(POOL_ID, "Personal", 1),
      sessionHost(`${POOL_ID}/sessionHosts/h1`, 0),
    ];

    expect(findAvdHostPoolLowDensity(resources)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/lib/waste-rules/avdHostPoolLowDensity.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/lib/waste-rules/avdHostPoolLowDensity.ts`:

```ts
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import type { WasteFindingCandidate } from "@/lib/waste-rules/types";
import {
  isHostPool,
  sessionHostsForPool,
  type HostPoolProperties,
  type SessionHostProperties,
} from "@/lib/waste-rules/avdSessionHosts";

/** Average sessions-per-host below this fraction of maxSessionLimit counts as "low density". */
const LOW_DENSITY_RATIO_THRESHOLD = 0.3;

export function findAvdHostPoolLowDensity(
  resources: ResourceGraphRow[],
): WasteFindingCandidate[] {
  return resources
    .filter(isHostPool)
    .filter((r) => (r.properties as HostPoolProperties).hostPoolType === "Pooled")
    .filter((pool) => {
      const maxSessionLimit = (pool.properties as HostPoolProperties).maxSessionLimit ?? 0;
      const availableHosts = sessionHostsForPool(pool.id, resources).filter(
        (h) => (h.properties as SessionHostProperties).status === "Available",
      );
      if (availableHosts.length === 0 || maxSessionLimit === 0) {
        return false;
      }
      const totalSessions = availableHosts.reduce(
        (sum, h) => sum + ((h.properties as SessionHostProperties).sessions ?? 0),
        0,
      );
      const averageSessions = totalSessions / availableHosts.length;
      return averageSessions < maxSessionLimit * LOW_DENSITY_RATIO_THRESHOLD;
    })
    .map((pool) => ({
      ruleType: "AVD_HOSTPOOL_LOW_DENSITY" as const,
      resourceId: pool.id,
      subscriptionId: pool.subscriptionId,
      savingsCategory: "POTENTIAL_SAVING" as const,
    }));
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run tests/lib/waste-rules/avdHostPoolLowDensity.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/waste-rules/avdHostPoolLowDensity.ts tests/lib/waste-rules/avdHostPoolLowDensity.test.ts
git commit -m "feat: add AVD_HOSTPOOL_LOW_DENSITY waste rule"
```

---

### Task 8: Retail Prices — `estimatePremiumDiskDowngradeMonthlySavings`

**Files:**
- Modify: `src/lib/azure/retailPrices.ts`
- Test: `tests/lib/azure/retailPrices.test.ts`

**Interfaces:**
- Produces: `estimatePremiumDiskDowngradeMonthlySavings(resource: ResourceGraphRow): Promise<number | null>` — the monthly delta between a Premium/Ultra disk's current price and its Standard SSD (`StandardSSD_LRS`) equivalent at the same size/region, or `null` if the delta isn't positive or a price is missing. Consumed by Task 14 (`savingsEstimate.ts`, `premium_disk_delta` method).

- [ ] **Step 1: Write the failing test**

Add to `tests/lib/azure/retailPrices.test.ts`, after the existing imports, a new fixture and `describe` block:

```ts
import { estimatePremiumDiskDowngradeMonthlySavings } from "@/lib/azure/retailPrices";
```

(add this to the existing `import { ... } from "@/lib/azure/retailPrices";` block at the top of the file rather than as a separate import line)

```ts
function diskResource(skuName: string, sizeGb: number): ResourceGraphRow {
  return {
    id: "/subscriptions/sub-1/disks/disk-1",
    type: "microsoft.compute/disks",
    subscriptionId: "sub-1",
    location: "eastus",
    sku: { name: skuName },
    properties: { diskSizeGB: sizeGb },
  };
}

describe("estimatePremiumDiskDowngradeMonthlySavings", () => {
  it("returns the monthly delta between the Premium price and the Standard SSD equivalent", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      const decoded = decodeURIComponent(url);
      if (decoded.includes("skuName eq 'P6 LRS'")) {
        return jsonResponse([
          priceItem({
            retailPrice: 0.283,
            meterName: "P6 LRS Disk",
            productName: "Premium SSD Managed Disks",
          }),
        ]);
      }
      if (decoded.includes("skuName eq 'E6 LRS'")) {
        return jsonResponse([
          priceItem({
            retailPrice: 0.096,
            meterName: "E6 LRS Disk",
            productName: "Standard SSD Managed Disks",
          }),
        ]);
      }
      return jsonResponse([]);
    });
    vi.stubGlobal("fetch", fetchMock);

    const savings = await estimatePremiumDiskDowngradeMonthlySavings(
      diskResource("Premium_LRS", 128),
    );

    expect(savings).toBeCloseTo((0.283 - 0.096) * 730, 5);
  });

  it("returns null when the delta is not positive", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse([priceItem({ retailPrice: 0.1 })])),
    );

    const savings = await estimatePremiumDiskDowngradeMonthlySavings(
      diskResource("Premium_LRS", 128),
    );

    expect(savings).toBeNull();
  });

  it("returns null when a price lookup throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network error")),
    );

    const savings = await estimatePremiumDiskDowngradeMonthlySavings(
      diskResource("Premium_LRS", 128),
    );

    expect(savings).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/lib/azure/retailPrices.test.ts -t "estimatePremiumDiskDowngradeMonthlySavings"`
Expected: FAIL — `estimatePremiumDiskDowngradeMonthlySavings` is not exported yet.

- [ ] **Step 3: Implement**

In `src/lib/azure/retailPrices.ts`, add below `estimateDiskCost` (which stays module-private — this new function calls it internally):

```ts
/**
 * Estimated monthly saving from downgrading a Premium/Ultra managed disk to the Standard SSD
 * tier at the same size/region: the retail-price delta between the two, using the same
 * `estimateDiskCost` path (and its `diskSkuMeterName` size-banding) with the SKU swapped.
 */
export async function estimatePremiumDiskDowngradeMonthlySavings(
  resource: ResourceGraphRow,
): Promise<number | null> {
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
Expected: PASS (all tests in the file, old and new)

- [ ] **Step 5: Commit**

```bash
git add src/lib/azure/retailPrices.ts tests/lib/azure/retailPrices.test.ts
git commit -m "feat: add premium-to-standard-SSD disk downgrade savings estimation"
```

---

### Task 9: Rule `AVD_SESSION_HOST_PREMIUM_DISK_UNUSED`

**Files:**
- Create: `src/lib/waste-rules/avdSessionHostPremiumDiskUnused.ts`
- Test: `tests/lib/waste-rules/avdSessionHostPremiumDiskUnused.test.ts`

**Interfaces:**
- Consumes: `isSessionHost`, `underlyingVm` from `@/lib/waste-rules/avdSessionHosts` (Task 3); `findAvdSessionHostLowUtilization` from Task 5.
- Produces: `findAvdSessionHostPremiumDiskUnused(resources: ResourceGraphRow[]): WasteFindingCandidate[]`. The candidate's `resourceId` is the **disk's** id, not the session host's or VM's (matches the existing `VM_STOPPED_RETAINING_RESOURCES` convention of targeting the disk).

- [ ] **Step 1: Write the failing test**

Create `tests/lib/waste-rules/avdSessionHostPremiumDiskUnused.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import { findAvdSessionHostPremiumDiskUnused } from "@/lib/waste-rules/avdSessionHostPremiumDiskUnused";

const HOST_ID = "/subscriptions/sub-1/.../hostPools/pool-1/sessionHosts/host-1.contoso.com";
const VM_ID = "/subscriptions/sub-1/.../virtualMachines/host-1";
const DISK_ID = "/subscriptions/sub-1/.../disks/host-1-osdisk";

function sessionHost(sessions: number, status = "Available"): ResourceGraphRow {
  return {
    id: HOST_ID,
    type: "microsoft.desktopvirtualization/hostpools/sessionhosts",
    subscriptionId: "sub-1",
    properties: { sessions, status, resourceId: VM_ID },
  };
}

function vm(diskId: string | undefined): ResourceGraphRow {
  return {
    id: VM_ID,
    type: "microsoft.compute/virtualmachines",
    subscriptionId: "sub-1",
    properties: diskId ? { storageProfile: { osDisk: { managedDisk: { id: diskId } } } } : {},
  };
}

function disk(skuName: string): ResourceGraphRow {
  return {
    id: DISK_ID,
    type: "microsoft.compute/disks",
    subscriptionId: "sub-1",
    sku: { name: skuName },
    properties: {},
  };
}

describe("findAvdSessionHostPremiumDiskUnused", () => {
  it("flags the OS disk of an idle session host that uses a Premium SKU", () => {
    const resources = [sessionHost(0), vm(DISK_ID), disk("Premium_LRS")];

    expect(findAvdSessionHostPremiumDiskUnused(resources)).toEqual([
      {
        ruleType: "AVD_SESSION_HOST_PREMIUM_DISK_UNUSED",
        resourceId: DISK_ID,
        subscriptionId: "sub-1",
        savingsCategory: "POTENTIAL_SAVING",
      },
    ]);
  });

  it.each(["PremiumV2_LRS", "UltraSSD_LRS"])("also flags the %s SKU", (skuName) => {
    const resources = [sessionHost(0), vm(DISK_ID), disk(skuName)];
    expect(findAvdSessionHostPremiumDiskUnused(resources)).toHaveLength(1);
  });

  it("does not flag a Standard SSD disk", () => {
    const resources = [sessionHost(0), vm(DISK_ID), disk("StandardSSD_LRS")];
    expect(findAvdSessionHostPremiumDiskUnused(resources)).toEqual([]);
  });

  it("does not flag a session host that isn't idle", () => {
    const resources = [sessionHost(3), vm(DISK_ID), disk("Premium_LRS")];
    expect(findAvdSessionHostPremiumDiskUnused(resources)).toEqual([]);
  });

  it("does nothing when the underlying VM can't be resolved", () => {
    const resources = [sessionHost(0), disk("Premium_LRS")];
    expect(findAvdSessionHostPremiumDiskUnused(resources)).toEqual([]);
  });

  it("does nothing when the VM has no OS disk reference", () => {
    const resources = [sessionHost(0), vm(undefined), disk("Premium_LRS")];
    expect(findAvdSessionHostPremiumDiskUnused(resources)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/lib/waste-rules/avdSessionHostPremiumDiskUnused.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/lib/waste-rules/avdSessionHostPremiumDiskUnused.ts`:

```ts
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import type { WasteFindingCandidate } from "@/lib/waste-rules/types";
import { isSessionHost, underlyingVm } from "@/lib/waste-rules/avdSessionHosts";
import { findAvdSessionHostLowUtilization } from "@/lib/waste-rules/avdSessionHostLowUtilization";

const PREMIUM_DISK_SKUS = new Set(["Premium_LRS", "Premium_ZRS", "PremiumV2_LRS", "UltraSSD_LRS"]);

interface VmStorageProfile {
  osDisk?: { managedDisk?: { id?: string } };
}

export function findAvdSessionHostPremiumDiskUnused(
  resources: ResourceGraphRow[],
): WasteFindingCandidate[] {
  const idleHostIds = new Set(
    findAvdSessionHostLowUtilization(resources).map((c) => c.resourceId),
  );
  const candidates: WasteFindingCandidate[] = [];

  for (const sessionHost of resources.filter(isSessionHost)) {
    if (!idleHostIds.has(sessionHost.id)) {
      continue;
    }
    const vm = underlyingVm(sessionHost, resources);
    if (!vm) {
      continue;
    }
    const storageProfile = vm.properties.storageProfile as VmStorageProfile | undefined;
    const diskId = storageProfile?.osDisk?.managedDisk?.id;
    if (!diskId) {
      continue;
    }
    const disk = resources.find((r) => r.id.toLowerCase() === diskId.toLowerCase());
    if (!disk || !PREMIUM_DISK_SKUS.has(disk.sku?.name ?? "")) {
      continue;
    }

    candidates.push({
      ruleType: "AVD_SESSION_HOST_PREMIUM_DISK_UNUSED",
      resourceId: disk.id,
      subscriptionId: disk.subscriptionId,
      savingsCategory: "POTENTIAL_SAVING",
    });
  }

  return candidates;
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run tests/lib/waste-rules/avdSessionHostPremiumDiskUnused.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/waste-rules/avdSessionHostPremiumDiskUnused.ts tests/lib/waste-rules/avdSessionHostPremiumDiskUnused.test.ts
git commit -m "feat: add AVD_SESSION_HOST_PREMIUM_DISK_UNUSED waste rule"
```

---

### Task 10: Rule `AVD_SCALING_PLAN_MISSING`

**Files:**
- Create: `src/lib/waste-rules/avdScalingPlanMissing.ts`
- Test: `tests/lib/waste-rules/avdScalingPlanMissing.test.ts`

**Interfaces:**
- Consumes: `isHostPool`, `HostPoolProperties` from `@/lib/waste-rules/avdSessionHosts` (Task 3); `findScalingPlanReferenceForPool` from `@/lib/waste-rules/avdScalingPlans` (Task 4).
- Produces: `findAvdScalingPlanMissing(resources: ResourceGraphRow[]): WasteFindingCandidate[]`.

- [ ] **Step 1: Write the failing test**

Create `tests/lib/waste-rules/avdScalingPlanMissing.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import { findAvdScalingPlanMissing } from "@/lib/waste-rules/avdScalingPlanMissing";

const POOL_ID = "/subscriptions/sub-1/.../hostPools/pool-1";

function hostPool(hostPoolType: "Personal" | "Pooled"): ResourceGraphRow {
  return {
    id: POOL_ID,
    type: "microsoft.desktopvirtualization/hostpools",
    subscriptionId: "sub-1",
    properties: { hostPoolType },
  };
}

function scalingPlan(hostPoolArmPath: string): ResourceGraphRow {
  return {
    id: "/subscriptions/sub-1/.../scalingPlans/plan-1",
    type: "microsoft.desktopvirtualization/scalingplans",
    subscriptionId: "sub-1",
    properties: { hostPoolReferences: [{ hostPoolArmPath, scalingPlanEnabled: true }] },
  };
}

describe("findAvdScalingPlanMissing", () => {
  it("flags a Pooled host pool with no scaling plan referencing it", () => {
    expect(findAvdScalingPlanMissing([hostPool("Pooled")])).toEqual([
      {
        ruleType: "AVD_SCALING_PLAN_MISSING",
        resourceId: POOL_ID,
        subscriptionId: "sub-1",
        savingsCategory: "POTENTIAL_SAVING",
      },
    ]);
  });

  it("does not flag a Pooled host pool referenced by a scaling plan", () => {
    const resources = [hostPool("Pooled"), scalingPlan(POOL_ID)];
    expect(findAvdScalingPlanMissing(resources)).toEqual([]);
  });

  it("does not flag a Personal host pool", () => {
    expect(findAvdScalingPlanMissing([hostPool("Personal")])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/lib/waste-rules/avdScalingPlanMissing.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/lib/waste-rules/avdScalingPlanMissing.ts`:

```ts
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import type { WasteFindingCandidate } from "@/lib/waste-rules/types";
import { isHostPool, type HostPoolProperties } from "@/lib/waste-rules/avdSessionHosts";
import { findScalingPlanReferenceForPool } from "@/lib/waste-rules/avdScalingPlans";

export function findAvdScalingPlanMissing(
  resources: ResourceGraphRow[],
): WasteFindingCandidate[] {
  return resources
    .filter(isHostPool)
    .filter((r) => (r.properties as HostPoolProperties).hostPoolType === "Pooled")
    .filter((pool) => findScalingPlanReferenceForPool(pool.id, resources) === undefined)
    .map((pool) => ({
      ruleType: "AVD_SCALING_PLAN_MISSING" as const,
      resourceId: pool.id,
      subscriptionId: pool.subscriptionId,
      savingsCategory: "POTENTIAL_SAVING" as const,
    }));
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run tests/lib/waste-rules/avdScalingPlanMissing.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/waste-rules/avdScalingPlanMissing.ts tests/lib/waste-rules/avdScalingPlanMissing.test.ts
git commit -m "feat: add AVD_SCALING_PLAN_MISSING waste rule"
```

---

### Task 11: Rule `AVD_SCALING_PLAN_DISABLED`

**Files:**
- Create: `src/lib/waste-rules/avdScalingPlanDisabled.ts`
- Test: `tests/lib/waste-rules/avdScalingPlanDisabled.test.ts`

**Interfaces:**
- Consumes: `isHostPool`, `HostPoolProperties` from `@/lib/waste-rules/avdSessionHosts` (Task 3); `findScalingPlanReferenceForPool` from `@/lib/waste-rules/avdScalingPlans` (Task 4).
- Produces: `findAvdScalingPlanDisabled(resources: ResourceGraphRow[]): WasteFindingCandidate[]`.

- [ ] **Step 1: Write the failing test**

Create `tests/lib/waste-rules/avdScalingPlanDisabled.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import { findAvdScalingPlanDisabled } from "@/lib/waste-rules/avdScalingPlanDisabled";

const POOL_ID = "/subscriptions/sub-1/.../hostPools/pool-1";

function hostPool(): ResourceGraphRow {
  return {
    id: POOL_ID,
    type: "microsoft.desktopvirtualization/hostpools",
    subscriptionId: "sub-1",
    properties: { hostPoolType: "Pooled" },
  };
}

function scalingPlan(hostPoolArmPath: string, scalingPlanEnabled: boolean): ResourceGraphRow {
  return {
    id: "/subscriptions/sub-1/.../scalingPlans/plan-1",
    type: "microsoft.desktopvirtualization/scalingplans",
    subscriptionId: "sub-1",
    properties: { hostPoolReferences: [{ hostPoolArmPath, scalingPlanEnabled }] },
  };
}

describe("findAvdScalingPlanDisabled", () => {
  it("flags a host pool referenced by a scaling plan with scalingPlanEnabled: false", () => {
    const resources = [hostPool(), scalingPlan(POOL_ID, false)];

    expect(findAvdScalingPlanDisabled(resources)).toEqual([
      {
        ruleType: "AVD_SCALING_PLAN_DISABLED",
        resourceId: POOL_ID,
        subscriptionId: "sub-1",
        savingsCategory: "POTENTIAL_SAVING",
      },
    ]);
  });

  it("does not flag a host pool whose scaling plan is enabled", () => {
    const resources = [hostPool(), scalingPlan(POOL_ID, true)];
    expect(findAvdScalingPlanDisabled(resources)).toEqual([]);
  });

  it("does not flag a host pool with no scaling plan at all (covered by AVD_SCALING_PLAN_MISSING instead)", () => {
    expect(findAvdScalingPlanDisabled([hostPool()])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/lib/waste-rules/avdScalingPlanDisabled.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/lib/waste-rules/avdScalingPlanDisabled.ts`:

```ts
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import type { WasteFindingCandidate } from "@/lib/waste-rules/types";
import { isHostPool, type HostPoolProperties } from "@/lib/waste-rules/avdSessionHosts";
import { findScalingPlanReferenceForPool } from "@/lib/waste-rules/avdScalingPlans";

export function findAvdScalingPlanDisabled(
  resources: ResourceGraphRow[],
): WasteFindingCandidate[] {
  return resources
    .filter(isHostPool)
    .filter((r) => (r.properties as HostPoolProperties).hostPoolType === "Pooled")
    .filter((pool) => {
      const found = findScalingPlanReferenceForPool(pool.id, resources);
      return found !== undefined && found.reference.scalingPlanEnabled === false;
    })
    .map((pool) => ({
      ruleType: "AVD_SCALING_PLAN_DISABLED" as const,
      resourceId: pool.id,
      subscriptionId: pool.subscriptionId,
      savingsCategory: "POTENTIAL_SAVING" as const,
    }));
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run tests/lib/waste-rules/avdScalingPlanDisabled.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/waste-rules/avdScalingPlanDisabled.ts tests/lib/waste-rules/avdScalingPlanDisabled.test.ts
git commit -m "feat: add AVD_SCALING_PLAN_DISABLED waste rule"
```

---

### Task 12: Rule `AVD_HOST_RUNNING_OUTSIDE_SCALING_WINDOW`

**Files:**
- Create: `src/lib/waste-rules/avdHostRunningOutsideScalingWindow.ts`
- Test: `tests/lib/waste-rules/avdHostRunningOutsideScalingWindow.test.ts`

**Interfaces:**
- Consumes: `isHostPool`, `sessionHostsForPool`, `underlyingVm`, `HostPoolProperties` from `@/lib/waste-rules/avdSessionHosts` (Task 3); `findScalingPlanReferenceForPool`, `schedulesForPlan`, `isWithinOffPeakWindow`, `offPeakHoursForSchedule` from `@/lib/waste-rules/avdScalingPlans` (Task 4).
- Produces: `findAvdHostRunningOutsideScalingWindow(resources: ResourceGraphRow[], now?: Date): WasteFindingCandidate[]`. Sets `metricObserved` to the matched schedule's off-peak-window length in hours/day — Task 14 (`savingsEstimate.ts`, `scaling_window_delta` method) reads this directly, no separate savings-estimation call needed.

- [ ] **Step 1: Write the failing test**

Create `tests/lib/waste-rules/avdHostRunningOutsideScalingWindow.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import { findAvdHostRunningOutsideScalingWindow } from "@/lib/waste-rules/avdHostRunningOutsideScalingWindow";

const POOL_ID = "/subscriptions/sub-1/.../hostPools/pool-1";
const HOST_ID = `${POOL_ID}/sessionHosts/host-1.contoso.com`;
const VM_ID = "/subscriptions/sub-1/.../virtualMachines/host-1";

// 2024-01-01T22:00:00Z is a Monday, inside the overnight off-peak window below.
const MONDAY_NIGHT = new Date("2024-01-01T22:00:00Z");
const MONDAY_NOON = new Date("2024-01-01T12:00:00Z");

function hostPool(): ResourceGraphRow {
  return {
    id: POOL_ID,
    type: "microsoft.desktopvirtualization/hostpools",
    subscriptionId: "sub-1",
    properties: { hostPoolType: "Pooled" },
  };
}

function scalingPlan(scalingPlanEnabled = true): ResourceGraphRow {
  return {
    id: "/subscriptions/sub-1/.../scalingPlans/plan-1",
    type: "microsoft.desktopvirtualization/scalingplans",
    subscriptionId: "sub-1",
    properties: {
      hostPoolReferences: [{ hostPoolArmPath: POOL_ID, scalingPlanEnabled }],
      schedules: [
        {
          daysOfWeek: ["Monday"],
          offPeakStartTime: { hour: 20, minute: 0 },
          rampUpStartTime: { hour: 6, minute: 0 },
        },
      ],
    },
  };
}

function sessionHost(): ResourceGraphRow {
  return {
    id: HOST_ID,
    type: "microsoft.desktopvirtualization/hostpools/sessionhosts",
    subscriptionId: "sub-1",
    properties: { resourceId: VM_ID },
  };
}

function vm(powerState: string): ResourceGraphRow {
  return {
    id: VM_ID,
    type: "microsoft.compute/virtualmachines",
    subscriptionId: "sub-1",
    properties: {},
    powerState,
  };
}

describe("findAvdHostRunningOutsideScalingWindow", () => {
  it("flags a running host during its pool's off-peak window, carrying the window's daily hours as metricObserved", () => {
    const resources = [hostPool(), scalingPlan(), sessionHost(), vm("PowerState/running")];

    expect(findAvdHostRunningOutsideScalingWindow(resources, MONDAY_NIGHT)).toEqual([
      {
        ruleType: "AVD_HOST_RUNNING_OUTSIDE_SCALING_WINDOW",
        resourceId: HOST_ID,
        subscriptionId: "sub-1",
        savingsCategory: "POTENTIAL_SAVING",
        metricObserved: 10,
      },
    ]);
  });

  it("does not flag outside the off-peak window", () => {
    const resources = [hostPool(), scalingPlan(), sessionHost(), vm("PowerState/running")];
    expect(findAvdHostRunningOutsideScalingWindow(resources, MONDAY_NOON)).toEqual([]);
  });

  it("does not flag a host that is already deallocated", () => {
    const resources = [hostPool(), scalingPlan(), sessionHost(), vm("PowerState/deallocated")];
    expect(findAvdHostRunningOutsideScalingWindow(resources, MONDAY_NIGHT)).toEqual([]);
  });

  it("does not evaluate a pool whose scaling plan is disabled (covered by AVD_SCALING_PLAN_DISABLED instead)", () => {
    const resources = [hostPool(), scalingPlan(false), sessionHost(), vm("PowerState/running")];
    expect(findAvdHostRunningOutsideScalingWindow(resources, MONDAY_NIGHT)).toEqual([]);
  });

  it("does not evaluate a pool with no scaling plan at all (covered by AVD_SCALING_PLAN_MISSING instead)", () => {
    const resources = [hostPool(), sessionHost(), vm("PowerState/running")];
    expect(findAvdHostRunningOutsideScalingWindow(resources, MONDAY_NIGHT)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/lib/waste-rules/avdHostRunningOutsideScalingWindow.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/lib/waste-rules/avdHostRunningOutsideScalingWindow.ts`:

```ts
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import type { WasteFindingCandidate } from "@/lib/waste-rules/types";
import {
  isHostPool,
  sessionHostsForPool,
  underlyingVm,
  type HostPoolProperties,
} from "@/lib/waste-rules/avdSessionHosts";
import {
  findScalingPlanReferenceForPool,
  schedulesForPlan,
  isWithinOffPeakWindow,
  offPeakHoursForSchedule,
} from "@/lib/waste-rules/avdScalingPlans";

export function findAvdHostRunningOutsideScalingWindow(
  resources: ResourceGraphRow[],
  now: Date = new Date(),
): WasteFindingCandidate[] {
  const candidates: WasteFindingCandidate[] = [];

  const pools = resources
    .filter(isHostPool)
    .filter((r) => (r.properties as HostPoolProperties).hostPoolType === "Pooled");

  for (const pool of pools) {
    const found = findScalingPlanReferenceForPool(pool.id, resources);
    if (!found || found.reference.scalingPlanEnabled === false) {
      continue;
    }
    const activeSchedule = schedulesForPlan(found.plan).find((s) =>
      isWithinOffPeakWindow(s, now),
    );
    if (!activeSchedule) {
      continue;
    }
    const offPeakHours = offPeakHoursForSchedule(activeSchedule);

    for (const sessionHost of sessionHostsForPool(pool.id, resources)) {
      const vm = underlyingVm(sessionHost, resources);
      if (vm?.powerState === "PowerState/running") {
        candidates.push({
          ruleType: "AVD_HOST_RUNNING_OUTSIDE_SCALING_WINDOW",
          resourceId: sessionHost.id,
          subscriptionId: sessionHost.subscriptionId,
          savingsCategory: "POTENTIAL_SAVING",
          metricObserved: offPeakHours,
        });
      }
    }
  }

  return candidates;
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run tests/lib/waste-rules/avdHostRunningOutsideScalingWindow.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/waste-rules/avdHostRunningOutsideScalingWindow.ts tests/lib/waste-rules/avdHostRunningOutsideScalingWindow.test.ts
git commit -m "feat: add AVD_HOST_RUNNING_OUTSIDE_SCALING_WINDOW waste rule"
```

---

### Task 13: Rule `AVD_PERSONAL_HOST_UNUSED`

**Files:**
- Create: `src/lib/waste-rules/avdPersonalHostUnused.ts`
- Test: `tests/lib/waste-rules/avdPersonalHostUnused.test.ts`

**Interfaces:**
- Consumes: `isHostPool`, `isSessionHost`, `parentHostPoolId`, `underlyingVm`, `HostPoolProperties`, `SessionHostProperties` from `@/lib/waste-rules/avdSessionHosts` (Task 3).
- Produces: `findAvdPersonalHostUnused(resources: ResourceGraphRow[]): WasteFindingCandidate[]`.

- [ ] **Step 1: Write the failing test**

Create `tests/lib/waste-rules/avdPersonalHostUnused.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import { findAvdPersonalHostUnused } from "@/lib/waste-rules/avdPersonalHostUnused";

const POOL_ID = "/subscriptions/sub-1/.../hostPools/pool-1";
const HOST_ID = `${POOL_ID}/sessionHosts/host-1.contoso.com`;
const VM_ID = "/subscriptions/sub-1/.../virtualMachines/host-1";

function hostPool(hostPoolType: "Personal" | "Pooled"): ResourceGraphRow {
  return {
    id: POOL_ID,
    type: "microsoft.desktopvirtualization/hostpools",
    subscriptionId: "sub-1",
    properties: { hostPoolType },
  };
}

function sessionHost(props: Record<string, unknown>): ResourceGraphRow {
  return {
    id: HOST_ID,
    type: "microsoft.desktopvirtualization/hostpools/sessionhosts",
    subscriptionId: "sub-1",
    properties: { resourceId: VM_ID, ...props },
  };
}

function vm(powerState: string): ResourceGraphRow {
  return {
    id: VM_ID,
    type: "microsoft.compute/virtualmachines",
    subscriptionId: "sub-1",
    properties: {},
    powerState,
  };
}

describe("findAvdPersonalHostUnused", () => {
  it("flags a running, assigned, session-less Personal host", () => {
    const resources = [
      hostPool("Personal"),
      sessionHost({ assignedUser: "alice@contoso.com", sessions: 0 }),
      vm("PowerState/running"),
    ];

    expect(findAvdPersonalHostUnused(resources)).toEqual([
      {
        ruleType: "AVD_PERSONAL_HOST_UNUSED",
        resourceId: HOST_ID,
        subscriptionId: "sub-1",
        savingsCategory: "POTENTIAL_SAVING",
      },
    ]);
  });

  it("does not flag a host with an active session", () => {
    const resources = [
      hostPool("Personal"),
      sessionHost({ assignedUser: "alice@contoso.com", sessions: 1 }),
      vm("PowerState/running"),
    ];
    expect(findAvdPersonalHostUnused(resources)).toEqual([]);
  });

  it("does not flag an unassigned host", () => {
    const resources = [hostPool("Personal"), sessionHost({ sessions: 0 }), vm("PowerState/running")];
    expect(findAvdPersonalHostUnused(resources)).toEqual([]);
  });

  it("does not flag a deallocated host", () => {
    const resources = [
      hostPool("Personal"),
      sessionHost({ assignedUser: "alice@contoso.com", sessions: 0 }),
      vm("PowerState/deallocated"),
    ];
    expect(findAvdPersonalHostUnused(resources)).toEqual([]);
  });

  it("does not flag a session host that belongs to a Pooled host pool", () => {
    const resources = [
      hostPool("Pooled"),
      sessionHost({ assignedUser: "alice@contoso.com", sessions: 0 }),
      vm("PowerState/running"),
    ];
    expect(findAvdPersonalHostUnused(resources)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/lib/waste-rules/avdPersonalHostUnused.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/lib/waste-rules/avdPersonalHostUnused.ts`:

```ts
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import type { WasteFindingCandidate } from "@/lib/waste-rules/types";
import {
  isHostPool,
  isSessionHost,
  parentHostPoolId,
  underlyingVm,
  type HostPoolProperties,
  type SessionHostProperties,
} from "@/lib/waste-rules/avdSessionHosts";

export function findAvdPersonalHostUnused(
  resources: ResourceGraphRow[],
): WasteFindingCandidate[] {
  const personalPoolIds = new Set(
    resources
      .filter(isHostPool)
      .filter((r) => (r.properties as HostPoolProperties).hostPoolType === "Personal")
      .map((r) => r.id.toLowerCase()),
  );

  return resources
    .filter(isSessionHost)
    .filter((r) => personalPoolIds.has(parentHostPoolId(r.id).toLowerCase()))
    .filter((r) => {
      const props = r.properties as SessionHostProperties;
      if (!props.assignedUser) {
        return false;
      }
      if ((props.sessions ?? 0) !== 0) {
        return false;
      }
      const vm = underlyingVm(r, resources);
      return vm?.powerState === "PowerState/running";
    })
    .map((r) => ({
      ruleType: "AVD_PERSONAL_HOST_UNUSED" as const,
      resourceId: r.id,
      subscriptionId: r.subscriptionId,
      savingsCategory: "POTENTIAL_SAVING" as const,
    }));
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run tests/lib/waste-rules/avdPersonalHostUnused.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/waste-rules/avdPersonalHostUnused.ts tests/lib/waste-rules/avdPersonalHostUnused.test.ts
git commit -m "feat: add AVD_PERSONAL_HOST_UNUSED waste rule"
```

---

### Task 14: `savingsEstimate.ts` — wire the 8 new rules

**Files:**
- Modify: `src/lib/waste-rules/savingsEstimate.ts`
- Test: `tests/lib/waste-rules/savingsEstimate.test.ts`

**Interfaces:**
- Consumes: `estimatePremiumDiskDowngradeMonthlySavings` from `@/lib/azure/retailPrices` (Task 8).
- Produces: `SAVINGS_METHOD_BY_RULE` and `estimateMonthlySavings` now handle all 8 new `WasteRuleType` values.

- [ ] **Step 1: Write the failing tests**

Add to `tests/lib/waste-rules/savingsEstimate.test.ts`. First, extend the existing `vi.mock("@/lib/azure/retailPrices", ...)` factory at the top of the file to include the new function:

```ts
vi.mock("@/lib/azure/retailPrices", () => ({
  estimateHybridBenefitMonthlySavings: vi.fn(),
  estimateLinuxByolMonthlySavings: vi.fn(),
  estimateVmssSpotMonthlySavings: vi.fn(),
  estimatePremiumDiskDowngradeMonthlySavings: vi.fn(),
}));
```

Add `estimatePremiumDiskDowngradeMonthlySavings` to the corresponding `import { ... } from "@/lib/azure/retailPrices";` block below the mocks.

Then add new tests inside the `describe("estimateMonthlySavings", ...)` block, after the existing cases:

```ts
  it("returns the full resource cost for AVD_SESSION_HOST_LOW_UTILIZATION", async () => {
    const candidate: WasteFindingCandidate = {
      ruleType: "AVD_SESSION_HOST_LOW_UTILIZATION",
      resourceId: "host-1",
      subscriptionId: "sub-1",
    };

    expect(await estimateMonthlySavings(candidate, undefined, 80)).toBe(80);
  });

  it("returns the full resource cost for AVD_PERSONAL_HOST_UNUSED", async () => {
    const candidate: WasteFindingCandidate = {
      ruleType: "AVD_PERSONAL_HOST_UNUSED",
      resourceId: "host-2",
      subscriptionId: "sub-1",
    };

    expect(await estimateMonthlySavings(candidate, undefined, 60)).toBe(60);
  });

  it.each([
    "AVD_HOSTPOOL_EXCESS_HOSTS",
    "AVD_HOSTPOOL_LOW_DENSITY",
    "AVD_SCALING_PLAN_MISSING",
    "AVD_SCALING_PLAN_DISABLED",
  ] as const)("returns null (no fabricated number) for %s", async (ruleType) => {
    const candidate: WasteFindingCandidate = {
      ruleType,
      resourceId: "pool-1",
      subscriptionId: "sub-1",
    };

    expect(await estimateMonthlySavings(candidate, undefined, 500)).toBeNull();
  });

  it("delegates AVD_SESSION_HOST_PREMIUM_DISK_UNUSED to estimatePremiumDiskDowngradeMonthlySavings", async () => {
    vi.mocked(estimatePremiumDiskDowngradeMonthlySavings).mockResolvedValue(12.5);
    const resource: ResourceGraphRow = {
      id: "disk-1",
      type: "microsoft.compute/disks",
      subscriptionId: "sub-1",
      properties: {},
    };
    const candidate: WasteFindingCandidate = {
      ruleType: "AVD_SESSION_HOST_PREMIUM_DISK_UNUSED",
      resourceId: "disk-1",
      subscriptionId: "sub-1",
    };

    const savings = await estimateMonthlySavings(candidate, resource, 20);

    expect(savings).toBe(12.5);
    expect(estimatePremiumDiskDowngradeMonthlySavings).toHaveBeenCalledWith(resource);
  });

  it("returns null for AVD_SESSION_HOST_PREMIUM_DISK_UNUSED when no resource is available", async () => {
    const candidate: WasteFindingCandidate = {
      ruleType: "AVD_SESSION_HOST_PREMIUM_DISK_UNUSED",
      resourceId: "disk-1",
      subscriptionId: "sub-1",
    };

    expect(await estimateMonthlySavings(candidate, undefined, 20)).toBeNull();
  });

  it("computes AVD_HOST_RUNNING_OUTSIDE_SCALING_WINDOW savings from metricObserved as a fraction of 24 hours", async () => {
    const candidate: WasteFindingCandidate = {
      ruleType: "AVD_HOST_RUNNING_OUTSIDE_SCALING_WINDOW",
      resourceId: "host-3",
      subscriptionId: "sub-1",
      metricObserved: 12,
    };

    const savings = await estimateMonthlySavings(candidate, undefined, 240);

    expect(savings).toBeCloseTo(240 * (12 / 24), 5);
  });

  it("treats a missing metricObserved as 0 hours for AVD_HOST_RUNNING_OUTSIDE_SCALING_WINDOW", async () => {
    const candidate: WasteFindingCandidate = {
      ruleType: "AVD_HOST_RUNNING_OUTSIDE_SCALING_WINDOW",
      resourceId: "host-3",
      subscriptionId: "sub-1",
    };

    expect(await estimateMonthlySavings(candidate, undefined, 240)).toBe(0);
  });
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/lib/waste-rules/savingsEstimate.test.ts`
Expected: FAIL — TypeScript rejects the 8 new `WasteRuleType` literals not existing yet in `SAVINGS_METHOD_BY_RULE`'s consumers, and `estimatePremiumDiskDowngradeMonthlySavings` isn't exported/mocked correctly yet.

- [ ] **Step 3: Implement**

In `src/lib/waste-rules/savingsEstimate.ts`:

1. Add the import:

```ts
import {
  estimateHybridBenefitMonthlySavings,
  estimateLinuxByolMonthlySavings,
  estimateVmssSpotMonthlySavings,
  estimatePremiumDiskDowngradeMonthlySavings,
} from "@/lib/azure/retailPrices";
```

2. Extend the `SavingsMethod` union:

```ts
type SavingsMethod =
  | "full_cost"
  | "hybrid_benefit"
  | "linux_byol"
  | "nonprod_schedule"
  | "spot_delta"
  | "reservation_recommendation"
  | "premium_disk_delta"
  | "scaling_window_delta"
  | "unknown";
```

3. Add the 8 new entries to `SAVINGS_METHOD_BY_RULE`:

```ts
  AVD_SESSION_HOST_LOW_UTILIZATION: "full_cost",
  AVD_HOSTPOOL_EXCESS_HOSTS: "unknown",
  AVD_HOSTPOOL_LOW_DENSITY: "unknown",
  AVD_SESSION_HOST_PREMIUM_DISK_UNUSED: "premium_disk_delta",
  AVD_SCALING_PLAN_MISSING: "unknown",
  AVD_SCALING_PLAN_DISABLED: "unknown",
  AVD_HOST_RUNNING_OUTSIDE_SCALING_WINDOW: "scaling_window_delta",
  AVD_PERSONAL_HOST_UNUSED: "full_cost",
```

4. Add the 2 new `case`s to the `switch` in `estimateMonthlySavings`, immediately before the `case "unknown":` line:

```ts
    case "premium_disk_delta":
      return resource ? estimatePremiumDiskDowngradeMonthlySavings(resource) : null;
    case "scaling_window_delta": {
      const offPeakHoursPerDay = candidate.metricObserved ?? 0;
      return estimatedMonthlyCost * (offPeakHoursPerDay / 24);
    }
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run tests/lib/waste-rules/savingsEstimate.test.ts`
Expected: PASS (all tests, old and new)

- [ ] **Step 5: Commit**

```bash
git add src/lib/waste-rules/savingsEstimate.ts tests/lib/waste-rules/savingsEstimate.test.ts
git commit -m "feat: wire AVD category-3 savings estimation methods into the dispatcher"
```

---

### Task 15: `dashboard-categories.ts` — wire the 8 new rules

**Files:**
- Modify: `src/lib/dashboard-categories.ts`
- Test: `tests/lib/dashboard-categories.test.ts`

**Interfaces:**
- Produces: `CATEGORY_BY_RULE` maps all 8 new `WasteRuleType` values to `"compute"`.

- [ ] **Step 1: Write the failing test**

Add to `tests/lib/dashboard-categories.test.ts`, inside the existing `describe("categoryForRule", ...)` block, after the VMSS test:

```ts
  it("maps every AVD category-3 rule to compute", () => {
    const avdRuleTypes = [
      "AVD_SESSION_HOST_LOW_UTILIZATION",
      "AVD_HOSTPOOL_EXCESS_HOSTS",
      "AVD_HOSTPOOL_LOW_DENSITY",
      "AVD_SESSION_HOST_PREMIUM_DISK_UNUSED",
      "AVD_SCALING_PLAN_MISSING",
      "AVD_SCALING_PLAN_DISABLED",
      "AVD_HOST_RUNNING_OUTSIDE_SCALING_WINDOW",
      "AVD_PERSONAL_HOST_UNUSED",
    ] as const;
    for (const ruleType of avdRuleTypes) {
      expect(categoryForRule(ruleType)).toBe("compute");
    }
  });
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/lib/dashboard-categories.test.ts`
Expected: FAIL — TypeScript rejects `CATEGORY_BY_RULE` for missing the 8 new keys.

- [ ] **Step 3: Implement**

In `src/lib/dashboard-categories.ts`, add the 8 new entries to `CATEGORY_BY_RULE`, after the `VMSS_OUTDATED_MODEL_INSTANCES` line:

```ts
  AVD_SESSION_HOST_LOW_UTILIZATION: "compute",
  AVD_HOSTPOOL_EXCESS_HOSTS: "compute",
  AVD_HOSTPOOL_LOW_DENSITY: "compute",
  AVD_SESSION_HOST_PREMIUM_DISK_UNUSED: "compute",
  AVD_SCALING_PLAN_MISSING: "compute",
  AVD_SCALING_PLAN_DISABLED: "compute",
  AVD_HOST_RUNNING_OUTSIDE_SCALING_WINDOW: "compute",
  AVD_PERSONAL_HOST_UNUSED: "compute",
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run tests/lib/dashboard-categories.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/dashboard-categories.ts tests/lib/dashboard-categories.test.ts
git commit -m "feat: add dashboard category for AVD category-3 rules"
```

---

### Task 16: i18n — 8 new rule labels × 3 locales

**Files:**
- Modify: `src/lib/i18n/dictionaries.ts`
- Test: `tests/lib/i18n/dictionaries.test.ts`

**Interfaces:**
- Produces: `rule.AVD_*` translation keys (8 keys) present in `pt-BR`, `en`, and `es`.

- [ ] **Step 1: Write the failing test**

Add to `tests/lib/i18n/dictionaries.test.ts`, as a new `describe` block after the existing VMSS one:

```ts
describe("AVD category-3 rule labels", () => {
  const avdRuleKeys = [
    "rule.AVD_SESSION_HOST_LOW_UTILIZATION",
    "rule.AVD_HOSTPOOL_EXCESS_HOSTS",
    "rule.AVD_HOSTPOOL_LOW_DENSITY",
    "rule.AVD_SESSION_HOST_PREMIUM_DISK_UNUSED",
    "rule.AVD_SCALING_PLAN_MISSING",
    "rule.AVD_SCALING_PLAN_DISABLED",
    "rule.AVD_HOST_RUNNING_OUTSIDE_SCALING_WINDOW",
    "rule.AVD_PERSONAL_HOST_UNUSED",
  ];

  it("has a real translation (not a key fallback) for every AVD rule key in every locale", () => {
    for (const locale of LOCALES) {
      for (const key of avdRuleKeys) {
        expect(translate(locale, key)).not.toBe(key);
      }
    }
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/lib/i18n/dictionaries.test.ts -t "AVD category-3 rule labels"`
Expected: FAIL — the 8 keys don't exist in any locale yet, so `translate` falls back to the key itself.

- [ ] **Step 3: Implement**

In `src/lib/i18n/dictionaries.ts`, add the 8 keys to each of the 3 locale blocks, immediately after their respective `"rule.VMSS_OUTDATED_MODEL_INSTANCES"` line.

`"pt-BR"` block:

```ts
    "rule.AVD_SESSION_HOST_LOW_UTILIZATION": "Session host do AVD com baixa utilização",
    "rule.AVD_HOSTPOOL_EXCESS_HOSTS": "Host pool do AVD com excesso de hosts",
    "rule.AVD_HOSTPOOL_LOW_DENSITY": "Host pool do AVD com baixa densidade de usuários",
    "rule.AVD_SESSION_HOST_PREMIUM_DISK_UNUSED": "Disco Premium ocioso em session host do AVD",
    "rule.AVD_SCALING_PLAN_MISSING": "Host pool do AVD sem Scaling Plan",
    "rule.AVD_SCALING_PLAN_DISABLED": "Scaling Plan do AVD desabilitado",
    "rule.AVD_HOST_RUNNING_OUTSIDE_SCALING_WINDOW": "Session host do AVD ligado fora da janela do Scaling Plan",
    "rule.AVD_PERSONAL_HOST_UNUSED": "Desktop pessoal do AVD sem uso",
```

`"en"` block:

```ts
    "rule.AVD_SESSION_HOST_LOW_UTILIZATION": "AVD session host with low utilization",
    "rule.AVD_HOSTPOOL_EXCESS_HOSTS": "AVD host pool with excess hosts",
    "rule.AVD_HOSTPOOL_LOW_DENSITY": "AVD host pool with low user density",
    "rule.AVD_SESSION_HOST_PREMIUM_DISK_UNUSED": "Unused Premium disk on AVD session host",
    "rule.AVD_SCALING_PLAN_MISSING": "AVD host pool missing a Scaling Plan",
    "rule.AVD_SCALING_PLAN_DISABLED": "AVD Scaling Plan disabled",
    "rule.AVD_HOST_RUNNING_OUTSIDE_SCALING_WINDOW": "AVD session host running outside its Scaling Plan window",
    "rule.AVD_PERSONAL_HOST_UNUSED": "Unused AVD personal desktop",
```

`"es"` block:

```ts
    "rule.AVD_SESSION_HOST_LOW_UTILIZATION": "Session host de AVD con baja utilización",
    "rule.AVD_HOSTPOOL_EXCESS_HOSTS": "Host pool de AVD con exceso de hosts",
    "rule.AVD_HOSTPOOL_LOW_DENSITY": "Host pool de AVD con baja densidad de usuarios",
    "rule.AVD_SESSION_HOST_PREMIUM_DISK_UNUSED": "Disco Premium sin uso en session host de AVD",
    "rule.AVD_SCALING_PLAN_MISSING": "Host pool de AVD sin Scaling Plan",
    "rule.AVD_SCALING_PLAN_DISABLED": "Scaling Plan de AVD deshabilitado",
    "rule.AVD_HOST_RUNNING_OUTSIDE_SCALING_WINDOW": "Session host de AVD encendido fuera de la ventana del Scaling Plan",
    "rule.AVD_PERSONAL_HOST_UNUSED": "Escritorio personal de AVD sin uso",
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run tests/lib/i18n/dictionaries.test.ts`
Expected: PASS (all tests, old and new)

- [ ] **Step 5: Commit**

```bash
git add src/lib/i18n/dictionaries.ts tests/lib/i18n/dictionaries.test.ts
git commit -m "feat: add i18n labels for AVD category-3 rules"
```

---

### Task 17: `runScan.ts` — wire all 8 AVD category-3 rules into the scanner

**Files:**
- Modify: `src/lib/scanner/runScan.ts`
- Test: `tests/lib/scanner/runScan.test.ts`

**Interfaces:**
- Consumes: all 8 `findAvd*` functions from Tasks 5, 6, 7, 9, 10, 11, 12, 13.
- Produces: `runScan`'s `candidates` array includes AVD category-3 candidates end to end.

- [ ] **Step 1: Write the failing end-to-end test**

Add to `tests/lib/scanner/runScan.test.ts`, inside the existing `describe("runScan", ...)` block, as a new `it` (place it near the other rule-specific scenario tests, e.g. right after the VMSS ones):

```ts
  it("persists an AVD_SESSION_HOST_LOW_UTILIZATION finding end to end", async () => {
    const customer = await prisma.customer.create({
      data: { entraTenantId: "tenant-avd-1", name: "Acme" },
    });
    const subscription = await prisma.subscription.create({
      data: { customerId: customer.id, azureSubscriptionId: "sub-avd-1", displayName: "Prod" },
    });

    vi.mocked(queryResourceGraph).mockResolvedValue([
      {
        id: "/subscriptions/sub-avd-1/hostPools/pool-1/sessionHosts/host-1.contoso.com",
        type: "microsoft.desktopvirtualization/hostpools/sessionhosts",
        subscriptionId: "sub-avd-1",
        properties: { sessions: 0, status: "Available" },
      },
    ]);
    vi.mocked(estimateMonthlyCost).mockResolvedValue(90);
    vi.mocked(getSubscriptionMonthToDateSpend).mockResolvedValue(0);
    vi.mocked(getSubscriptionForecast).mockResolvedValue(0);
    vi.mocked(getSubscriptionDailyCostTrend).mockResolvedValue([]);

    await runScan(subscription.id);

    const findings = await prisma.wasteFinding.findMany({
      where: { subscriptionId: subscription.id, ruleType: "AVD_SESSION_HOST_LOW_UTILIZATION" },
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      resourceId: "/subscriptions/sub-avd-1/hostPools/pool-1/sessionHosts/host-1.contoso.com",
      estimatedMonthlyCost: 90,
      estimatedMonthlySavings: 90,
    });
  });

  it("persists an AVD_SCALING_PLAN_MISSING finding for a Pooled host pool with no scaling plan", async () => {
    const customer = await prisma.customer.create({
      data: { entraTenantId: "tenant-avd-2", name: "Acme" },
    });
    const subscription = await prisma.subscription.create({
      data: { customerId: customer.id, azureSubscriptionId: "sub-avd-2", displayName: "Prod" },
    });

    vi.mocked(queryResourceGraph).mockResolvedValue([
      {
        id: "/subscriptions/sub-avd-2/hostPools/pool-2",
        type: "microsoft.desktopvirtualization/hostpools",
        subscriptionId: "sub-avd-2",
        properties: { hostPoolType: "Pooled", maxSessionLimit: 10 },
      },
    ]);
    vi.mocked(estimateMonthlyCost).mockResolvedValue(0);
    vi.mocked(estimateRetailMonthlyCost).mockResolvedValue(0);
    vi.mocked(getSubscriptionMonthToDateSpend).mockResolvedValue(0);
    vi.mocked(getSubscriptionForecast).mockResolvedValue(0);
    vi.mocked(getSubscriptionDailyCostTrend).mockResolvedValue([]);

    await runScan(subscription.id);

    const findings = await prisma.wasteFinding.findMany({
      where: { subscriptionId: subscription.id, ruleType: "AVD_SCALING_PLAN_MISSING" },
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].resourceId).toBe("/subscriptions/sub-avd-2/hostPools/pool-2");
    expect(findings[0].estimatedMonthlySavings).toBeNull();
  });
```

Also update the `vi.mock("@/lib/azure/retailPrices", ...)` factory near the top of the file to include the new export, so the test file's module graph resolves it:

```ts
vi.mock("@/lib/azure/retailPrices", () => ({
  estimateRetailMonthlyCost: vi.fn(),
  estimateHybridBenefitMonthlySavings: vi.fn(),
  estimateLinuxByolMonthlySavings: vi.fn(),
  estimateVmssSpotMonthlySavings: vi.fn(),
  estimatePremiumDiskDowngradeMonthlySavings: vi.fn(),
}));
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/lib/scanner/runScan.test.ts -t "AVD_SESSION_HOST_LOW_UTILIZATION"`
Expected: FAIL — no `AVD_*` findings are produced yet, since `runScan.ts` doesn't call any `findAvd*` function.

- [ ] **Step 3: Wire the 8 rules into `runScan.ts`**

Add the 8 imports, grouped after the existing VMSS imports:

```ts
import { findAvdSessionHostLowUtilization } from "@/lib/waste-rules/avdSessionHostLowUtilization";
import { findAvdHostPoolExcessHosts } from "@/lib/waste-rules/avdHostPoolExcessHosts";
import { findAvdHostPoolLowDensity } from "@/lib/waste-rules/avdHostPoolLowDensity";
import { findAvdSessionHostPremiumDiskUnused } from "@/lib/waste-rules/avdSessionHostPremiumDiskUnused";
import { findAvdScalingPlanMissing } from "@/lib/waste-rules/avdScalingPlanMissing";
import { findAvdScalingPlanDisabled } from "@/lib/waste-rules/avdScalingPlanDisabled";
import { findAvdHostRunningOutsideScalingWindow } from "@/lib/waste-rules/avdHostRunningOutsideScalingWindow";
import { findAvdPersonalHostUnused } from "@/lib/waste-rules/avdPersonalHostUnused";
```

Add their calls to the `candidates` array, after the existing `...missingReservationCandidates,` line:

```ts
      ...missingReservationCandidates,
      ...findAvdSessionHostLowUtilization(resources),
      ...findAvdHostPoolExcessHosts(resources),
      ...findAvdHostPoolLowDensity(resources),
      ...findAvdSessionHostPremiumDiskUnused(resources),
      ...findAvdScalingPlanMissing(resources),
      ...findAvdScalingPlanDisabled(resources),
      ...findAvdHostRunningOutsideScalingWindow(resources),
      ...findAvdPersonalHostUnused(resources),
    ];
```

(All 8 are synchronous, pure functions — same as most VMSS rules — so no `try/catch`-wrapped intermediate variable is needed; they're spread directly like `findVmssWithoutAutoscale(resources)`.)

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run tests/lib/scanner/runScan.test.ts -t "AVD"`
Expected: PASS (both new tests)

- [ ] **Step 5: Run the full runScan test suite to confirm no regression**

Run: `npx vitest run tests/lib/scanner/runScan.test.ts`
Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/scanner/runScan.ts tests/lib/scanner/runScan.test.ts
git commit -m "feat: wire all 8 AVD category-3 waste rules into the scanner"
```

---

### Task 18: Final verification

**Files:** none (verification only)

**Interfaces:** none

- [ ] **Step 1: Type-check the whole project**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 2: Run the full test suite**

Run: `npm test`
Expected: all tests pass (no regressions in any file touched across Tasks 1-17).

- [ ] **Step 3: Lint the whole project**

Run: `npm run lint`
Expected: 0 errors. The 1 pre-existing unrelated warning (`estimateLinuxByolMonthlySavings` unused import in `tests/lib/scanner/runScan.test.ts`, present since before Category 1) may still appear — confirm no *new* warnings were introduced.

- [ ] **Step 4: Update the project memory**

Update `finops_catalog_deferred_items.md` (`C:\Users\DanielGomesDeOliveir\.claude\projects\C--Cloud-Waste-Hunter\memory\`) with a short section recording: Category 3 (AVD) shipped with 8 rules covering 7 of the PDF's 10 items (items 5, 6 reused Category 1 rules; item 8 deferred to Category 6); note the accepted budget-driven gap in live-validating AVD Resource Graph property names (spec §2) so the next AVD-touching session knows to verify against a real customer scan before fully trusting these 8 rules' output.

- [ ] **Step 5: Commit if the memory file changed**

```bash
git add prisma/schema.prisma
git status
```

(No code commit expected in this task — Step 4 only touches the memory file outside the repo. If any repo file changed as part of verification, review it manually before committing; this step exists to confirm a clean `git status` at the end of the plan, not to introduce new changes.)
