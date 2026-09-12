# Dashboard Redesign + Idle VM Rule Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign `/dashboard` to match a reference SaaS-dashboard screenshot (nav, search, stat cards, cost trend chart, filterable/actionable recommendations table, account menu), backed by real data — including a new fifth waste rule (idle VMs) and real subscription-level cost data captured by the scanner — plus a real "add environment" onboarding flow, Tailwind CSS, light/dark theming, and pt-BR/en/es i18n.

**Architecture:** The scanner (`runScan`) gains one new async waste rule (idle VMs, via Azure Monitor) and a cost-snapshot capture step (subscription-level Cost Management calls), both error-isolated so a failure in either never fails the scan. The dashboard stays a Server Component for data fetching, delegating all interactivity (filter, search, subscription selection, theme, locale) to a new Client Component. A new `/ambientes` page exposes Task 12's already-existing onboarding API routes through a real form for the first time.

**Tech Stack:** Next.js 15 (App Router) + TypeScript, Prisma/Postgres, Tailwind CSS v4, Vitest, Azure Monitor Metrics REST API, Azure Cost Management Query/Forecast REST APIs.

**Spec:** `docs/superpowers/specs/2026-09-11-dashboard-redesign-idle-vm-design.md`

## Global Constraints

- Node.js >= 20, npm, TypeScript strict mode, Next.js App Router only (no Pages Router) — inherited from Fase 1, unchanged.
- Every read/write of business data goes through a customer-scoped helper (`requireCustomerId()` + a `where: { customerId }` or `where: { subscription: { customerId } }` filter). No unscoped query on `Customer`-owned data outside the auth bootstrap code — inherited from Fase 1, unchanged, and binds every new query in this plan (findings, subscriptions, cost snapshots) exactly the same way.
- No Azure credentials for a customer subscription are ever stored. All access happens through the Lighthouse-delegated Reader identity via the existing `armFetch` helper — unchanged. Azure Monitor Metrics and subscription-level Cost Management calls are both read-only and both covered by the existing Reader role grant; no new permission scope is requested anywhere in this plan.
- TDD for all business logic: the new waste rule, the new cost-data functions, the scanner changes, and any new pure UI-logic function (category mapping, impact level, dictionary lookup, subscription-ID validation) get a failing test before the implementation. Page-level JSX layout is verified manually (screenshot), matching the precedent Fase 1 Task 13 already set for `dashboard`/`connect` — this project has no component-testing harness and adding one is out of scope.
- No remediation actions (delete, resize, shutdown) exist in this phase. The "Take Action" button in the redesigned table calls the existing dismiss route and nothing else.
- Real data over fake placeholders wherever a real, read-only Azure query can produce it in this phase — that's the whole point of this plan. Only the notifications panel and the "Reports"/"Automation" nav tabs stay non-functional placeholders (explicitly out of scope, see the spec's Non-Goals).

---

## Task 1: Prisma schema — `IDLE_VM` rule type + `CostSnapshot` model

**Files:**
- Modify: `prisma/schema.prisma`
- Test: `tests/lib/costSnapshot.test.ts`

**Interfaces:**
- Produces: `IDLE_VM` as a valid `WasteRuleType` value; the `CostSnapshot` Prisma model (`subscriptionId`, `capturedAt`, `monthToDateSpend`, `projectedSpend`, `dailyTrend: Json`) that Task 5 (scanner) writes and Task 11 (dashboard) reads.

- [ ] **Step 1: Add `IDLE_VM` to the `WasteRuleType` enum**

In `prisma/schema.prisma`, change:

```prisma
enum WasteRuleType {
  ORPHANED_DISK
  UNASSOCIATED_PUBLIC_IP
  OLD_SNAPSHOT
  IDLE_VPN_GATEWAY
}
```

to:

```prisma
enum WasteRuleType {
  ORPHANED_DISK
  UNASSOCIATED_PUBLIC_IP
  OLD_SNAPSHOT
  IDLE_VPN_GATEWAY
  IDLE_VM
}
```

- [ ] **Step 2: Add the `CostSnapshot` model**

Append to `prisma/schema.prisma`, and add the back-relation on `Subscription`:

```prisma
model CostSnapshot {
  id               String       @id @default(cuid())
  subscriptionId   String
  subscription     Subscription @relation(fields: [subscriptionId], references: [id])
  capturedAt       DateTime     @default(now())
  monthToDateSpend Float
  projectedSpend   Float
  dailyTrend       Json
}
```

In the existing `Subscription` model, add a back-relation field alongside the existing `scanRuns`/`resources`/`wasteFindings` fields:

```prisma
model Subscription {
  id                  String             @id @default(cuid())
  customerId          String
  customer            Customer           @relation(fields: [customerId], references: [id])
  azureSubscriptionId String             @unique
  displayName         String
  status              SubscriptionStatus @default(PENDING)
  connectedAt         DateTime?
  createdAt           DateTime           @default(now())
  scanRuns            ScanRun[]
  resources           Resource[]
  wasteFindings       WasteFinding[]
  costSnapshots       CostSnapshot[]
}
```

- [ ] **Step 3: Run the migration**

Run: `npx prisma migrate dev --name add_idle_vm_and_cost_snapshot`
Expected: migration applied, Prisma Client regenerated, no errors.

- [ ] **Step 4: Apply the same migration to the test database**

Run: `dotenv -e .env.test -- npx prisma migrate deploy`
Expected: migration applied to the test DB too.

- [ ] **Step 5: Write and run a test proving the new model works**

`tests/lib/costSnapshot.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { resetDb } from "../helpers/resetDb";

describe("CostSnapshot model", () => {
  beforeEach(resetDb);

  it("creates a cost snapshot linked to a subscription", async () => {
    const customer = await prisma.customer.create({
      data: { entraTenantId: "tenant-cost-1", name: "Acme" },
    });
    const subscription = await prisma.subscription.create({
      data: { customerId: customer.id, azureSubscriptionId: "sub-cost-1", displayName: "Prod" },
    });

    const snapshot = await prisma.costSnapshot.create({
      data: {
        subscriptionId: subscription.id,
        monthToDateSpend: 123.45,
        projectedSpend: 456.78,
        dailyTrend: [{ date: "2026-09-01", cost: 10 }],
      },
    });

    expect(snapshot.subscriptionId).toBe(subscription.id);
    expect(snapshot.monthToDateSpend).toBe(123.45);
    expect(snapshot.dailyTrend).toEqual([{ date: "2026-09-01", cost: 10 }]);
  });

  it("creates a waste finding with the new IDLE_VM rule type", async () => {
    const customer = await prisma.customer.create({
      data: { entraTenantId: "tenant-cost-2", name: "Other" },
    });
    const subscription = await prisma.subscription.create({
      data: { customerId: customer.id, azureSubscriptionId: "sub-cost-2", displayName: "Dev" },
    });

    const finding = await prisma.wasteFinding.create({
      data: {
        subscriptionId: subscription.id,
        ruleType: "IDLE_VM",
        resourceId: "vm-idle-1",
        estimatedMonthlyCost: 42,
      },
    });

    expect(finding.ruleType).toBe("IDLE_VM");
  });
});
```

Run: `npm test -- costSnapshot`
Expected: PASS (2 tests)

- [ ] **Step 6: Run the full suite and commit**

Run: `npm test`
Expected: all PASS

```bash
git add prisma/schema.prisma prisma/migrations tests/lib/costSnapshot.test.ts
git commit -m "feat: add IDLE_VM rule type and CostSnapshot model"
```

---

## Task 2: Azure Monitor metrics client

**Files:**
- Create: `src/lib/azure/monitorMetrics.ts`
- Test: `tests/lib/azure/monitorMetrics.test.ts`

**Interfaces:**
- Consumes: `armFetch<T>(url, init?)` from `@/lib/azure/armFetch` (Fase 1).
- Produces: `getAverageCpuPercent(resourceId: string, days?: number, now?: Date): Promise<number>` — consumed by Task 3.

- [ ] **Step 1: Write the failing test**

`tests/lib/azure/monitorMetrics.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as armFetchModule from "@/lib/azure/armFetch";
import { getAverageCpuPercent } from "@/lib/azure/monitorMetrics";

describe("getAverageCpuPercent", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("averages the returned daily data points", async () => {
    vi.spyOn(armFetchModule, "armFetch").mockResolvedValue({
      value: [
        {
          timeseries: [
            {
              data: [
                { timeStamp: "2026-08-01T00:00:00Z", average: 2 },
                { timeStamp: "2026-08-02T00:00:00Z", average: 8 },
              ],
            },
          ],
        },
      ],
    });

    const result = await getAverageCpuPercent("/subscriptions/sub-1/vm-1");

    expect(result).toBe(5);
  });

  it("returns 0 when there are no data points", async () => {
    vi.spyOn(armFetchModule, "armFetch").mockResolvedValue({
      value: [{ timeseries: [{ data: [] }] }],
    });

    const result = await getAverageCpuPercent("/subscriptions/sub-1/vm-1");

    expect(result).toBe(0);
  });

  it("queries Percentage CPU with Average aggregation over the requested window", async () => {
    const spy = vi
      .spyOn(armFetchModule, "armFetch")
      .mockResolvedValue({ value: [{ timeseries: [{ data: [] }] }] });

    const now = new Date("2026-09-11T00:00:00Z");
    await getAverageCpuPercent("/subscriptions/sub-1/vm-1", 30, now);

    const [url] = spy.mock.calls[0];
    expect(url).toContain("/subscriptions/sub-1/vm-1/providers/Microsoft.Insights/metrics");
    expect(url).toContain("metricnames=Percentage%20CPU");
    expect(url).toContain("aggregation=Average");
    expect(url).toContain(encodeURIComponent("2026-08-12T00:00:00.000Z"));
    expect(url).toContain(encodeURIComponent("2026-09-11T00:00:00.000Z"));
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- monitorMetrics`
Expected: FAIL with "Cannot find module '@/lib/azure/monitorMetrics'"

- [ ] **Step 3: Implement**

`src/lib/azure/monitorMetrics.ts`:

```ts
import { armFetch } from "@/lib/azure/armFetch";

interface MetricsResponse {
  value: {
    timeseries?: {
      data: { timeStamp: string; average?: number }[];
    }[];
  }[];
}

export async function getAverageCpuPercent(
  resourceId: string,
  days = 30,
  now: Date = new Date(),
): Promise<number> {
  const start = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const timespan = `${start.toISOString()}/${now.toISOString()}`;
  const url =
    `https://management.azure.com${resourceId}/providers/Microsoft.Insights/metrics` +
    `?api-version=2018-01-01&metricnames=${encodeURIComponent("Percentage CPU")}` +
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
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- monitorMetrics`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/azure/monitorMetrics.ts tests/lib/azure/monitorMetrics.test.ts
git commit -m "feat: Azure Monitor average CPU metric client"
```

---

## Task 3: Waste rule — idle virtual machines

**Files:**
- Create: `src/lib/waste-rules/idleVirtualMachines.ts`
- Test: `tests/lib/waste-rules/idleVirtualMachines.test.ts`

**Interfaces:**
- Consumes: `ResourceGraphRow`, `WasteFindingCandidate` (Fase 1 Tasks 5/6); `getAverageCpuPercent` (Task 2) as the default CPU-fetch implementation.
- Produces: `findIdleVirtualMachines(resources: ResourceGraphRow[], getAverageCpu?: (resourceId: string) => Promise<number>): Promise<WasteFindingCandidate[]>` — consumed by Task 5 (scanner). Unlike the four Fase 1 rules, this one is `async`.

- [ ] **Step 1: Write the failing test**

`tests/lib/waste-rules/idleVirtualMachines.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import { findIdleVirtualMachines } from "@/lib/waste-rules/idleVirtualMachines";

describe("findIdleVirtualMachines", () => {
  it("returns a VM whose average CPU is below the threshold", async () => {
    const vm: ResourceGraphRow = {
      id: "/subscriptions/sub-1/vm-idle",
      type: "microsoft.compute/virtualmachines",
      subscriptionId: "sub-1",
      properties: {},
    };
    const getAverageCpu = vi.fn().mockResolvedValue(2);

    const result = await findIdleVirtualMachines([vm], getAverageCpu);

    expect(result).toEqual([
      { ruleType: "IDLE_VM", resourceId: vm.id, subscriptionId: "sub-1" },
    ]);
  });

  it("excludes a VM whose average CPU is at or above the threshold", async () => {
    const vm: ResourceGraphRow = {
      id: "/subscriptions/sub-1/vm-busy",
      type: "microsoft.compute/virtualmachines",
      subscriptionId: "sub-1",
      properties: {},
    };
    const getAverageCpu = vi.fn().mockResolvedValue(5);

    const result = await findIdleVirtualMachines([vm], getAverageCpu);

    expect(result).toEqual([]);
  });

  it("never calls the CPU fetcher for a non-VM resource", async () => {
    const disk: ResourceGraphRow = {
      id: "disk-1",
      type: "microsoft.compute/disks",
      subscriptionId: "sub-1",
      properties: {},
    };
    const getAverageCpu = vi.fn().mockResolvedValue(0);

    const result = await findIdleVirtualMachines([disk], getAverageCpu);

    expect(result).toEqual([]);
    expect(getAverageCpu).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- idleVirtualMachines`
Expected: FAIL with "Cannot find module '@/lib/waste-rules/idleVirtualMachines'"

- [ ] **Step 3: Implement**

`src/lib/waste-rules/idleVirtualMachines.ts`:

```ts
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import type { WasteFindingCandidate } from "@/lib/waste-rules/types";
import { getAverageCpuPercent } from "@/lib/azure/monitorMetrics";

const IDLE_CPU_THRESHOLD_PERCENT = 5;

export async function findIdleVirtualMachines(
  resources: ResourceGraphRow[],
  getAverageCpu: (resourceId: string) => Promise<number> = getAverageCpuPercent,
): Promise<WasteFindingCandidate[]> {
  const vms = resources.filter(
    (r) => r.type.toLowerCase() === "microsoft.compute/virtualmachines",
  );

  const candidates: WasteFindingCandidate[] = [];
  for (const vm of vms) {
    const avgCpu = await getAverageCpu(vm.id);
    if (avgCpu < IDLE_CPU_THRESHOLD_PERCENT) {
      candidates.push({
        ruleType: "IDLE_VM",
        resourceId: vm.id,
        subscriptionId: vm.subscriptionId,
      });
    }
  }
  return candidates;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- idleVirtualMachines`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/waste-rules/idleVirtualMachines.ts tests/lib/waste-rules/idleVirtualMachines.test.ts
git commit -m "feat: idle virtual machine waste rule"
```

---

## Task 4: Subscription-level cost functions

**Files:**
- Create: `src/lib/azure/subscriptionCost.ts`
- Test: `tests/lib/azure/subscriptionCost.test.ts`

**Interfaces:**
- Consumes: `armFetch` (Fase 1 Task 5).
- Produces: `getSubscriptionMonthToDateSpend(azureSubscriptionId: string): Promise<number>`, `getSubscriptionForecast(azureSubscriptionId: string): Promise<number>`, `getSubscriptionDailyCostTrend(azureSubscriptionId: string, days?: number, now?: Date): Promise<DailyCost[]>` where `DailyCost = { date: string; cost: number }` — all consumed by Task 5 (scanner) and, via the persisted `CostSnapshot`, by Task 11 (dashboard).

- [ ] **Step 1: Write the failing test**

`tests/lib/azure/subscriptionCost.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as armFetchModule from "@/lib/azure/armFetch";
import {
  getSubscriptionMonthToDateSpend,
  getSubscriptionForecast,
  getSubscriptionDailyCostTrend,
} from "@/lib/azure/subscriptionCost";

describe("getSubscriptionMonthToDateSpend", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the Cost column total with no resource filter", async () => {
    const spy = vi.spyOn(armFetchModule, "armFetch").mockResolvedValue({
      properties: { columns: [{ name: "Cost" }], rows: [[123.45]] },
    });

    const result = await getSubscriptionMonthToDateSpend("sub-1");

    expect(result).toBe(123.45);
    const [url, init] = spy.mock.calls[0];
    expect(url).toContain("/subscriptions/sub-1/providers/Microsoft.CostManagement/query");
    const body = JSON.parse(init!.body as string);
    expect(body.timeframe).toBe("MonthToDate");
    expect(body.dataset.filter).toBeUndefined();
  });

  it("returns 0 when there are no rows", async () => {
    vi.spyOn(armFetchModule, "armFetch").mockResolvedValue({
      properties: { columns: [{ name: "Cost" }], rows: [] },
    });

    expect(await getSubscriptionMonthToDateSpend("sub-1")).toBe(0);
  });
});

describe("getSubscriptionForecast", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("calls the Forecast endpoint and returns the Cost total", async () => {
    const spy = vi.spyOn(armFetchModule, "armFetch").mockResolvedValue({
      properties: { columns: [{ name: "Cost" }], rows: [[999]] },
    });

    const result = await getSubscriptionForecast("sub-1");

    expect(result).toBe(999);
    const [url] = spy.mock.calls[0];
    expect(url).toContain("/subscriptions/sub-1/providers/Microsoft.CostManagement/forecast");
  });
});

describe("getSubscriptionDailyCostTrend", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("maps Cost/UsageDate columns into a date-ordered array", async () => {
    const spy = vi.spyOn(armFetchModule, "armFetch").mockResolvedValue({
      properties: {
        columns: [{ name: "Cost" }, { name: "UsageDate" }],
        rows: [
          [10, 20260901],
          [15, 20260902],
        ],
      },
    });

    const now = new Date("2026-09-11T00:00:00Z");
    const result = await getSubscriptionDailyCostTrend("sub-1", 30, now);

    expect(result).toEqual([
      { date: "20260901", cost: 10 },
      { date: "20260902", cost: 15 },
    ]);
    const [, init] = spy.mock.calls[0];
    const body = JSON.parse(init!.body as string);
    expect(body.timeframe).toBe("Custom");
    expect(body.dataset.granularity).toBe("Daily");
  });

  it("returns an empty array when the expected columns are missing", async () => {
    vi.spyOn(armFetchModule, "armFetch").mockResolvedValue({
      properties: { columns: [{ name: "Cost" }], rows: [[10]] },
    });

    expect(await getSubscriptionDailyCostTrend("sub-1")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- subscriptionCost`
Expected: FAIL with "Cannot find module '@/lib/azure/subscriptionCost'"

- [ ] **Step 3: Implement**

`src/lib/azure/subscriptionCost.ts`:

```ts
import { armFetch } from "@/lib/azure/armFetch";

interface CostQueryResponse {
  properties: {
    columns: { name: string }[];
    rows: (string | number)[][];
  };
}

export interface DailyCost {
  date: string;
  cost: number;
}

function extractTotalCost(response: CostQueryResponse): number {
  const costIndex = response.properties.columns.findIndex((c) => c.name === "Cost");
  if (costIndex === -1 || response.properties.rows.length === 0) {
    return 0;
  }
  return Number(response.properties.rows[0][costIndex]) || 0;
}

export async function getSubscriptionMonthToDateSpend(
  azureSubscriptionId: string,
): Promise<number> {
  const url = `https://management.azure.com/subscriptions/${azureSubscriptionId}/providers/Microsoft.CostManagement/query?api-version=2023-11-01`;
  const response = await armFetch<CostQueryResponse>(url, {
    method: "POST",
    body: JSON.stringify({
      type: "ActualCost",
      timeframe: "MonthToDate",
      dataset: {
        granularity: "None",
        aggregation: { totalCost: { name: "Cost", function: "Sum" } },
      },
    }),
  });
  return extractTotalCost(response);
}

export async function getSubscriptionForecast(
  azureSubscriptionId: string,
): Promise<number> {
  const url = `https://management.azure.com/subscriptions/${azureSubscriptionId}/providers/Microsoft.CostManagement/forecast?api-version=2023-11-01`;
  const response = await armFetch<CostQueryResponse>(url, {
    method: "POST",
    body: JSON.stringify({
      type: "ActualCost",
      timeframe: "MonthToDate",
      dataset: {
        granularity: "None",
        aggregation: { totalCost: { name: "Cost", function: "Sum" } },
      },
    }),
  });
  return extractTotalCost(response);
}

export async function getSubscriptionDailyCostTrend(
  azureSubscriptionId: string,
  days = 30,
  now: Date = new Date(),
): Promise<DailyCost[]> {
  const from = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const url = `https://management.azure.com/subscriptions/${azureSubscriptionId}/providers/Microsoft.CostManagement/query?api-version=2023-11-01`;
  const response = await armFetch<CostQueryResponse>(url, {
    method: "POST",
    body: JSON.stringify({
      type: "ActualCost",
      timeframe: "Custom",
      timePeriod: { from: from.toISOString(), to: now.toISOString() },
      dataset: {
        granularity: "Daily",
        aggregation: { totalCost: { name: "Cost", function: "Sum" } },
      },
    }),
  });

  const costIndex = response.properties.columns.findIndex((c) => c.name === "Cost");
  const dateIndex = response.properties.columns.findIndex((c) => c.name === "UsageDate");
  if (costIndex === -1 || dateIndex === -1) {
    return [];
  }
  return response.properties.rows.map((row) => ({
    date: String(row[dateIndex]),
    cost: Number(row[costIndex]) || 0,
  }));
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- subscriptionCost`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/azure/subscriptionCost.ts tests/lib/azure/subscriptionCost.test.ts
git commit -m "feat: subscription-level cost query, forecast, and daily trend"
```

---

## Task 5: Scanner integration — idle VMs + cost snapshot capture

**Files:**
- Modify: `src/lib/scanner/runScan.ts`
- Modify: `tests/lib/scanner/runScan.test.ts`

**Interfaces:**
- Consumes: `findIdleVirtualMachines` (Task 3), `getSubscriptionMonthToDateSpend`/`getSubscriptionForecast`/`getSubscriptionDailyCostTrend` (Task 4).
- Produces: no new exports — `runScan`'s signature is unchanged; it now also persists `CostSnapshot` rows and can produce `IDLE_VM` findings.

- [ ] **Step 1: Write the failing tests**

First, at the very top of `tests/lib/scanner/runScan.test.ts`, alongside the
existing `vi.mock("@/lib/azure/resourceGraph", ...)` and
`vi.mock("@/lib/azure/costManagement", ...)` calls and their corresponding
imports (add these as two more `vi.mock` calls and two more import
statements in that same top-of-file block — not inside the `describe`):

```ts
vi.mock("@/lib/azure/monitorMetrics", () => ({
  getAverageCpuPercent: vi.fn(),
}));
vi.mock("@/lib/azure/subscriptionCost", () => ({
  getSubscriptionMonthToDateSpend: vi.fn(),
  getSubscriptionForecast: vi.fn(),
  getSubscriptionDailyCostTrend: vi.fn(),
}));
```

```ts
import { getAverageCpuPercent } from "@/lib/azure/monitorMetrics";
import {
  getSubscriptionMonthToDateSpend,
  getSubscriptionForecast,
  getSubscriptionDailyCostTrend,
} from "@/lib/azure/subscriptionCost";
```

Then append these three `it` blocks inside the existing
`describe("runScan", ...)`, alongside the existing tests — do not remove
any existing test:

```ts
it("persists an IDLE_VM finding for an idle VM returned by Resource Graph", async () => {
  const customer = await prisma.customer.create({
    data: { entraTenantId: "tenant-vm-1", name: "Acme" },
  });
  const subscription = await prisma.subscription.create({
    data: { customerId: customer.id, azureSubscriptionId: "sub-vm-1", displayName: "Prod" },
  });

  vi.mocked(queryResourceGraph).mockResolvedValue([
    {
      id: "vm-idle-1",
      type: "microsoft.compute/virtualmachines",
      subscriptionId: "sub-vm-1",
      properties: {},
    },
  ]);
  vi.mocked(estimateMonthlyCost).mockResolvedValue(15);
  vi.mocked(getAverageCpuPercent).mockResolvedValue(1);
  vi.mocked(getSubscriptionMonthToDateSpend).mockResolvedValue(0);
  vi.mocked(getSubscriptionForecast).mockResolvedValue(0);
  vi.mocked(getSubscriptionDailyCostTrend).mockResolvedValue([]);

  await runScan(subscription.id);

  const findings = await prisma.wasteFinding.findMany({
    where: { subscriptionId: subscription.id },
  });
  expect(findings).toHaveLength(1);
  expect(findings[0].ruleType).toBe("IDLE_VM");
});

it("persists a CostSnapshot with the captured subscription-level cost data", async () => {
  const customer = await prisma.customer.create({
    data: { entraTenantId: "tenant-cs-1", name: "Acme" },
  });
  const subscription = await prisma.subscription.create({
    data: { customerId: customer.id, azureSubscriptionId: "sub-cs-1", displayName: "Prod" },
  });

  vi.mocked(queryResourceGraph).mockResolvedValue([]);
  vi.mocked(getSubscriptionMonthToDateSpend).mockResolvedValue(200);
  vi.mocked(getSubscriptionForecast).mockResolvedValue(500);
  vi.mocked(getSubscriptionDailyCostTrend).mockResolvedValue([{ date: "2026-09-01", cost: 10 }]);

  await runScan(subscription.id);

  const snapshots = await prisma.costSnapshot.findMany({
    where: { subscriptionId: subscription.id },
  });
  expect(snapshots).toHaveLength(1);
  expect(snapshots[0].monthToDateSpend).toBe(200);
  expect(snapshots[0].projectedSpend).toBe(500);
  expect(snapshots[0].dailyTrend).toEqual([{ date: "2026-09-01", cost: 10 }]);
});

it("still succeeds and still persists findings when cost snapshot capture fails", async () => {
  const customer = await prisma.customer.create({
    data: { entraTenantId: "tenant-cs-2", name: "Acme" },
  });
  const subscription = await prisma.subscription.create({
    data: { customerId: customer.id, azureSubscriptionId: "sub-cs-2", displayName: "Prod" },
  });

  vi.mocked(queryResourceGraph).mockResolvedValue([
    {
      id: "disk-cs-2",
      type: "microsoft.compute/disks",
      subscriptionId: "sub-cs-2",
      properties: { diskState: "Unattached" },
    },
  ]);
  vi.mocked(estimateMonthlyCost).mockResolvedValue(9);
  vi.mocked(getSubscriptionMonthToDateSpend).mockRejectedValue(new Error("rate limited"));

  await runScan(subscription.id);

  const scanRun = await prisma.scanRun.findFirstOrThrow({
    where: { subscriptionId: subscription.id },
  });
  expect(scanRun.status).toBe("SUCCEEDED");

  const findings = await prisma.wasteFinding.findMany({
    where: { subscriptionId: subscription.id },
  });
  expect(findings).toHaveLength(1);

  const snapshots = await prisma.costSnapshot.findMany({
    where: { subscriptionId: subscription.id },
  });
  expect(snapshots).toHaveLength(0);
});
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `npm test -- runScan`
Expected: FAIL — `getAverageCpuPercent`/cost-snapshot related assertions fail because `runScan` doesn't call the idle-VM rule or persist a `CostSnapshot` yet.

- [ ] **Step 3: Implement**

Replace the full contents of `src/lib/scanner/runScan.ts`:

```ts
import { prisma } from "@/lib/prisma";
import { queryResourceGraph } from "@/lib/azure/resourceGraph";
import { estimateMonthlyCost } from "@/lib/azure/costManagement";
import {
  getSubscriptionMonthToDateSpend,
  getSubscriptionForecast,
  getSubscriptionDailyCostTrend,
} from "@/lib/azure/subscriptionCost";
import { findOrphanedDisks } from "@/lib/waste-rules/orphanedDisks";
import { findUnassociatedPublicIps } from "@/lib/waste-rules/unassociatedPublicIps";
import { findOldSnapshots } from "@/lib/waste-rules/oldSnapshots";
import { findIdleVpnGateways } from "@/lib/waste-rules/idleVpnGateways";
import { findIdleVirtualMachines } from "@/lib/waste-rules/idleVirtualMachines";
import type { WasteFindingCandidate } from "@/lib/waste-rules/types";

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
| project id, type, subscriptionId, properties
`;

async function captureCostSnapshot(
  subscriptionRecordId: string,
  azureSubscriptionId: string,
): Promise<void> {
  try {
    const [monthToDateSpend, projectedSpend, dailyTrend] = await Promise.all([
      getSubscriptionMonthToDateSpend(azureSubscriptionId),
      getSubscriptionForecast(azureSubscriptionId),
      getSubscriptionDailyCostTrend(azureSubscriptionId),
    ]);
    await prisma.costSnapshot.create({
      data: {
        subscriptionId: subscriptionRecordId,
        monthToDateSpend,
        projectedSpend,
        dailyTrend,
      },
    });
  } catch (error) {
    console.error(
      `Cost snapshot capture failed for subscription ${subscriptionRecordId}; skipping this run`,
      error,
    );
  }
}

export async function runScan(subscriptionRecordId: string): Promise<void> {
  const subscription = await prisma.subscription.findUniqueOrThrow({
    where: { id: subscriptionRecordId },
  });

  const scanRun = await prisma.scanRun.create({
    data: { subscriptionId: subscription.id, status: "RUNNING" },
  });

  try {
    const resources = await queryResourceGraph(
      [subscription.azureSubscriptionId],
      COMBINED_QUERY,
    );

    if (resources.length > 0) {
      await prisma.resource.createMany({
        data: resources.map((r) => ({
          subscriptionId: subscription.id,
          scanRunId: scanRun.id,
          resourceId: r.id,
          type: r.type,
          rawProperties: r.properties as object,
        })),
      });
    }

    const candidates: WasteFindingCandidate[] = [
      ...findOrphanedDisks(resources),
      ...findUnassociatedPublicIps(resources),
      ...findOldSnapshots(resources),
      ...findIdleVpnGateways(resources),
      ...(await findIdleVirtualMachines(resources)),
    ];

    for (const candidate of candidates) {
      let estimatedMonthlyCost = 0;
      try {
        estimatedMonthlyCost = await estimateMonthlyCost(
          subscription.azureSubscriptionId,
          candidate.resourceId,
        );
      } catch (error) {
        console.error(
          `Cost estimation failed for resource ${candidate.resourceId} (rule ${candidate.ruleType}); using 0`,
          error,
        );
      }
      await prisma.wasteFinding.upsert({
        where: {
          subscriptionId_resourceId_ruleType: {
            subscriptionId: subscription.id,
            resourceId: candidate.resourceId,
            ruleType: candidate.ruleType,
          },
        },
        create: {
          subscriptionId: subscription.id,
          resourceId: candidate.resourceId,
          ruleType: candidate.ruleType,
          estimatedMonthlyCost,
        },
        update: { estimatedMonthlyCost },
      });
    }

    await captureCostSnapshot(subscription.id, subscription.azureSubscriptionId);

    await prisma.scanRun.update({
      where: { id: scanRun.id },
      data: { status: "SUCCEEDED", finishedAt: new Date() },
    });
  } catch (error) {
    await prisma.scanRun.update({
      where: { id: scanRun.id },
      data: { status: "FAILED", finishedAt: new Date() },
    });
    throw error;
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- runScan`
Expected: PASS (all tests in the file, old and new)

- [ ] **Step 5: Run the full suite and commit**

Run: `npm test`
Expected: all PASS

```bash
git add src/lib/scanner/runScan.ts tests/lib/scanner/runScan.test.ts
git commit -m "feat: scanner captures idle VMs and subscription cost snapshots"
```

---

## Task 6: Tailwind CSS v4 setup

**Files:**
- Create: `postcss.config.mjs`
- Create: `src/app/globals.css`
- Modify: `src/app/layout.tsx`
- Modify: `package.json` (new devDependencies)

**Interfaces:**
- Produces: Tailwind utility classes available in every `.tsx` file under `src/`, and a `.dark` class on `<html>` that Task 7's theme provider toggles.

- [ ] **Step 1: Install dependencies**

Run: `npm install -D tailwindcss@^4.3.3 @tailwindcss/postcss@^4.3.3 postcss@^8.5.28`
Expected: `package.json`'s `devDependencies` gains all three; `package-lock.json` updates.

- [ ] **Step 2: Write the PostCSS config**

`postcss.config.mjs`:

```js
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
```

- [ ] **Step 3: Write the global stylesheet**

`src/app/globals.css`:

```css
@import "tailwindcss";

@custom-variant dark (&:where(.dark, .dark *));
```

The `@custom-variant dark` line switches Tailwind v4's `dark:` utilities from the default OS-preference media query to a `.dark` ancestor class — this is what lets Task 7's `ThemeProvider` control the theme by toggling a class instead of relying on the OS setting.

- [ ] **Step 4: Import the stylesheet from the root layout**

Modify `src/app/layout.tsx` to add the import (keep the existing component body unchanged for now — Task 11 will add the provider wrapper):

```tsx
import "./globals.css";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
```

- [ ] **Step 5: Verify the build still works**

Run: `npm run build`
Expected: succeeds (Tailwind processes `globals.css` with no errors).

Run: `npm test`
Expected: all PASS (no test touches styling, this is a sanity check).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json postcss.config.mjs src/app/globals.css src/app/layout.tsx
git commit -m "chore: add Tailwind CSS v4"
```

---

## Task 7: Theme provider (light/dark)

**Files:**
- Create: `src/lib/theme/ThemeProvider.tsx`
- Test: `tests/lib/theme/resolveInitialTheme.test.ts`

**Interfaces:**
- Produces: `ThemeProvider` (React component, wraps children), `useTheme(): { theme: "light" | "dark"; toggleTheme: () => void }` — consumed by Task 11's `DashboardClient`. Also produces the pure, independently-testable `resolveInitialTheme(storedValue: string | null): "light" | "dark"` helper.

- [ ] **Step 1: Write the failing test for the pure helper**

`tests/lib/theme/resolveInitialTheme.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { resolveInitialTheme } from "@/lib/theme/ThemeProvider";

describe("resolveInitialTheme", () => {
  it("returns dark when the stored value is 'dark'", () => {
    expect(resolveInitialTheme("dark")).toBe("dark");
  });

  it("returns light when the stored value is 'light'", () => {
    expect(resolveInitialTheme("light")).toBe("light");
  });

  it("defaults to light when there is no stored value", () => {
    expect(resolveInitialTheme(null)).toBe("light");
  });

  it("defaults to light for an unrecognized stored value", () => {
    expect(resolveInitialTheme("something-else")).toBe("light");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- resolveInitialTheme`
Expected: FAIL with "Cannot find module '@/lib/theme/ThemeProvider'"

- [ ] **Step 3: Implement**

`src/lib/theme/ThemeProvider.tsx`:

```tsx
"use client";

import { createContext, useContext, useEffect, useState } from "react";

export type Theme = "light" | "dark";

const STORAGE_KEY = "cwh-theme";

export function resolveInitialTheme(storedValue: string | null): Theme {
  return storedValue === "dark" ? "dark" : "light";
}

interface ThemeContextValue {
  theme: Theme;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    setTheme(resolveInitialTheme(stored));
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    window.localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme((current) => (current === "light" ? "dark" : "light"));
  };

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- resolveInitialTheme`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/theme/ThemeProvider.tsx tests/lib/theme/resolveInitialTheme.test.ts
git commit -m "feat: light/dark theme provider"
```

---

## Task 8: i18n — pt-BR / en / es dictionary + provider

**Files:**
- Create: `src/lib/i18n/dictionaries.ts`
- Create: `src/lib/i18n/LocaleProvider.tsx`
- Test: `tests/lib/i18n/dictionaries.test.ts`

**Interfaces:**
- Produces: `Locale = "pt-BR" | "en" | "es"`, `translate(locale: Locale, key: string): string` (pure function), `LocaleProvider`, `useLocale(): { locale: Locale; setLocale: (l: Locale) => void; t: (key: string) => string }` — consumed by Task 10 (Ambientes) and Task 11 (DashboardClient).

- [ ] **Step 1: Write the failing test for the dictionary**

`tests/lib/i18n/dictionaries.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { translate } from "@/lib/i18n/dictionaries";

describe("translate", () => {
  it("returns the pt-BR string for a known key", () => {
    expect(translate("pt-BR", "nav.dashboard")).toBe("Painel");
  });

  it("returns the English string for the same key", () => {
    expect(translate("en", "nav.dashboard")).toBe("Dashboard");
  });

  it("returns the Spanish string for the same key", () => {
    expect(translate("es", "nav.dashboard")).toBe("Panel");
  });

  it("falls back to the key itself when the key is unknown", () => {
    expect(translate("en", "nav.doesNotExist")).toBe("nav.doesNotExist");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- dictionaries`
Expected: FAIL with "Cannot find module '@/lib/i18n/dictionaries'"

- [ ] **Step 3: Implement the dictionary**

`src/lib/i18n/dictionaries.ts`:

```ts
export type Locale = "pt-BR" | "en" | "es";

export const LOCALES: Locale[] = ["pt-BR", "en", "es"];

type Dictionary = Record<string, string>;

const dictionaries: Record<Locale, Dictionary> = {
  "pt-BR": {
    "nav.dashboard": "Painel",
    "nav.recommendations": "Recomendações",
    "nav.ambientes": "Ambientes",
    "nav.reports": "Relatórios",
    "nav.automation": "Automação",
    "nav.comingSoon": "em breve",
    "account.signOut": "Sair",
    "cards.potentialSavings": "Economia potencial",
    "cards.activeResources": "Recursos ativos",
    "cards.monthlySpending": "Gasto no mês",
    "cards.projectedBill": "Previsão de fatura",
    "chart.title": "Tendência de custo (30 dias)",
    "chart.noData": "Sem dados ainda — aguardando o primeiro scan",
    "table.category": "Categoria",
    "table.rule": "Regra",
    "table.resource": "Recurso",
    "table.subscription": "Subscription",
    "table.impact": "Impacto",
    "table.estimatedSavings": "Economia estimada/mês",
    "table.status": "Status",
    "table.takeAction": "Take Action",
    "filters.all": "Todos",
    "filters.storage": "Disco/Armazenamento",
    "filters.compute": "Computação",
    "filters.network": "Rede",
    "search.placeholder": "Buscar recurso ou regra...",
    "notifications.title": "Notificações",
    "notifications.placeholder": "Nenhuma notificação nova",
    "impact.high": "Alto",
    "impact.medium": "Médio",
    "impact.low": "Baixo",
    "rule.ORPHANED_DISK": "Disco órfão",
    "rule.UNASSOCIATED_PUBLIC_IP": "IP público não associado",
    "rule.OLD_SNAPSHOT": "Snapshot antigo",
    "rule.IDLE_VPN_GATEWAY": "VPN Gateway ocioso",
    "rule.IDLE_VM": "VM ociosa",
    "ambientes.title": "Ambientes",
    "ambientes.addButton": "+ Adicionar ambiente",
    "ambientes.subscriptionId": "ID da subscription",
    "ambientes.displayName": "Nome de exibição",
    "ambientes.submit": "Adicionar",
    "ambientes.verify": "Verificar conexão",
    "ambientes.pending": "Pendente",
    "ambientes.connected": "Conectado",
    "ambientes.lastScan": "Último scan",
    "ambientes.neverScanned": "Ainda não escaneado",
    "ambientes.deployInstructions":
      "Implante o template Azure Lighthouse abaixo e depois clique em Verificar conexão.",
  },
  en: {
    "nav.dashboard": "Dashboard",
    "nav.recommendations": "Recommendations",
    "nav.ambientes": "Environments",
    "nav.reports": "Reports",
    "nav.automation": "Automation",
    "nav.comingSoon": "coming soon",
    "account.signOut": "Sign out",
    "cards.potentialSavings": "Potential savings",
    "cards.activeResources": "Active resources",
    "cards.monthlySpending": "Monthly spending",
    "cards.projectedBill": "Projected bill",
    "chart.title": "Cost trend (30 days)",
    "chart.noData": "No data yet — waiting on the first scan",
    "table.category": "Category",
    "table.rule": "Rule",
    "table.resource": "Resource",
    "table.subscription": "Subscription",
    "table.impact": "Impact",
    "table.estimatedSavings": "Estimated savings/mo",
    "table.status": "Status",
    "table.takeAction": "Take Action",
    "filters.all": "All",
    "filters.storage": "Storage",
    "filters.compute": "Compute",
    "filters.network": "Network",
    "search.placeholder": "Search resource or rule...",
    "notifications.title": "Notifications",
    "notifications.placeholder": "No new notifications",
    "impact.high": "High",
    "impact.medium": "Medium",
    "impact.low": "Low",
    "rule.ORPHANED_DISK": "Orphaned disk",
    "rule.UNASSOCIATED_PUBLIC_IP": "Unassociated public IP",
    "rule.OLD_SNAPSHOT": "Old snapshot",
    "rule.IDLE_VPN_GATEWAY": "Idle VPN gateway",
    "rule.IDLE_VM": "Idle VM",
    "ambientes.title": "Environments",
    "ambientes.addButton": "+ Add environment",
    "ambientes.subscriptionId": "Subscription ID",
    "ambientes.displayName": "Display name",
    "ambientes.submit": "Add",
    "ambientes.verify": "Verify connection",
    "ambientes.pending": "Pending",
    "ambientes.connected": "Connected",
    "ambientes.lastScan": "Last scan",
    "ambientes.neverScanned": "Not scanned yet",
    "ambientes.deployInstructions":
      "Deploy the Azure Lighthouse template below, then click Verify connection.",
  },
  es: {
    "nav.dashboard": "Panel",
    "nav.recommendations": "Recomendaciones",
    "nav.ambientes": "Entornos",
    "nav.reports": "Informes",
    "nav.automation": "Automatización",
    "nav.comingSoon": "próximamente",
    "account.signOut": "Cerrar sesión",
    "cards.potentialSavings": "Ahorro potencial",
    "cards.activeResources": "Recursos activos",
    "cards.monthlySpending": "Gasto mensual",
    "cards.projectedBill": "Factura proyectada",
    "chart.title": "Tendencia de costo (30 días)",
    "chart.noData": "Sin datos todavía — esperando el primer escaneo",
    "table.category": "Categoría",
    "table.rule": "Regla",
    "table.resource": "Recurso",
    "table.subscription": "Suscripción",
    "table.impact": "Impacto",
    "table.estimatedSavings": "Ahorro estimado/mes",
    "table.status": "Estado",
    "table.takeAction": "Take Action",
    "filters.all": "Todos",
    "filters.storage": "Almacenamiento",
    "filters.compute": "Cómputo",
    "filters.network": "Red",
    "search.placeholder": "Buscar recurso o regla...",
    "notifications.title": "Notificaciones",
    "notifications.placeholder": "Sin notificaciones nuevas",
    "impact.high": "Alto",
    "impact.medium": "Medio",
    "impact.low": "Bajo",
    "rule.ORPHANED_DISK": "Disco huérfano",
    "rule.UNASSOCIATED_PUBLIC_IP": "IP pública no asociada",
    "rule.OLD_SNAPSHOT": "Snapshot antiguo",
    "rule.IDLE_VPN_GATEWAY": "Puerta de enlace VPN inactiva",
    "rule.IDLE_VM": "VM inactiva",
    "ambientes.title": "Entornos",
    "ambientes.addButton": "+ Agregar entorno",
    "ambientes.subscriptionId": "ID de suscripción",
    "ambientes.displayName": "Nombre visible",
    "ambientes.submit": "Agregar",
    "ambientes.verify": "Verificar conexión",
    "ambientes.pending": "Pendiente",
    "ambientes.connected": "Conectado",
    "ambientes.lastScan": "Último escaneo",
    "ambientes.neverScanned": "Aún no escaneado",
    "ambientes.deployInstructions":
      "Implemente la plantilla de Azure Lighthouse a continuación y luego haga clic en Verificar conexión.",
  },
};

export function translate(locale: Locale, key: string): string {
  return dictionaries[locale][key] ?? key;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- dictionaries`
Expected: PASS (4 tests)

- [ ] **Step 5: Implement the provider (no dedicated test — thin wrapper over the already-tested `translate`, verified manually alongside the rest of the redesigned UI in Task 12)**

`src/lib/i18n/LocaleProvider.tsx`:

```tsx
"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { translate, type Locale } from "@/lib/i18n/dictionaries";

const STORAGE_KEY = "cwh-locale";
const DEFAULT_LOCALE: Locale = "pt-BR";

interface LocaleContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string) => string;
}

const LocaleContext = createContext<LocaleContextValue | undefined>(undefined);

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY) as Locale | null;
    if (stored === "pt-BR" || stored === "en" || stored === "es") {
      setLocaleState(stored);
    }
  }, []);

  const setLocale = (next: Locale) => {
    setLocaleState(next);
    window.localStorage.setItem(STORAGE_KEY, next);
  };

  const t = (key: string) => translate(locale, key);

  return (
    <LocaleContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </LocaleContext.Provider>
  );
}

export function useLocale(): LocaleContextValue {
  const context = useContext(LocaleContext);
  if (!context) {
    throw new Error("useLocale must be used within a LocaleProvider");
  }
  return context;
}
```

- [ ] **Step 6: Run the full suite and commit**

Run: `npm test`
Expected: all PASS

```bash
git add src/lib/i18n tests/lib/i18n
git commit -m "feat: pt-BR/en/es i18n dictionary and provider"
```

---

## Task 9: Dashboard category + impact pure functions

**Files:**
- Create: `src/lib/dashboard-categories.ts`
- Test: `tests/lib/dashboard-categories.test.ts`

**Interfaces:**
- Consumes: `WasteRuleType` (Prisma).
- Produces: `DashboardCategory = "storage" | "compute" | "network"`, `categoryForRule(ruleType: WasteRuleType): DashboardCategory`, `ImpactLevel = "high" | "medium" | "low"`, `impactForCost(estimatedMonthlyCost: number): ImpactLevel` — both consumed by Task 11's `DashboardClient`.

- [ ] **Step 1: Write the failing test**

`tests/lib/dashboard-categories.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { categoryForRule, impactForCost } from "@/lib/dashboard-categories";

describe("categoryForRule", () => {
  it("maps storage rules", () => {
    expect(categoryForRule("ORPHANED_DISK")).toBe("storage");
    expect(categoryForRule("OLD_SNAPSHOT")).toBe("storage");
  });

  it("maps the compute rule", () => {
    expect(categoryForRule("IDLE_VM")).toBe("compute");
  });

  it("maps network rules", () => {
    expect(categoryForRule("UNASSOCIATED_PUBLIC_IP")).toBe("network");
    expect(categoryForRule("IDLE_VPN_GATEWAY")).toBe("network");
  });
});

describe("impactForCost", () => {
  it("is high at or above $20/mo", () => {
    expect(impactForCost(20)).toBe("high");
    expect(impactForCost(50)).toBe("high");
  });

  it("is medium between $5 and just under $20/mo", () => {
    expect(impactForCost(5)).toBe("medium");
    expect(impactForCost(19.99)).toBe("medium");
  });

  it("is low below $5/mo", () => {
    expect(impactForCost(0)).toBe("low");
    expect(impactForCost(4.99)).toBe("low");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- dashboard-categories`
Expected: FAIL with "Cannot find module '@/lib/dashboard-categories'"

- [ ] **Step 3: Implement**

`src/lib/dashboard-categories.ts`:

```ts
import type { WasteRuleType } from "@prisma/client";

export type DashboardCategory = "storage" | "compute" | "network";

const CATEGORY_BY_RULE: Record<WasteRuleType, DashboardCategory> = {
  ORPHANED_DISK: "storage",
  OLD_SNAPSHOT: "storage",
  IDLE_VM: "compute",
  UNASSOCIATED_PUBLIC_IP: "network",
  IDLE_VPN_GATEWAY: "network",
};

export function categoryForRule(ruleType: WasteRuleType): DashboardCategory {
  return CATEGORY_BY_RULE[ruleType];
}

export type ImpactLevel = "high" | "medium" | "low";

export function impactForCost(estimatedMonthlyCost: number): ImpactLevel {
  if (estimatedMonthlyCost >= 20) {
    return "high";
  }
  if (estimatedMonthlyCost >= 5) {
    return "medium";
  }
  return "low";
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- dashboard-categories`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/dashboard-categories.ts tests/lib/dashboard-categories.test.ts
git commit -m "feat: dashboard category and impact-level mapping"
```

---

## Task 10: "Ambientes" page — real add-environment flow

**Files:**
- Create: `src/lib/ambientes/validateSubscriptionId.ts`
- Create: `src/app/ambientes/page.tsx`
- Create: `src/components/ambientes/AmbientesClient.tsx`
- Test: `tests/lib/ambientes/validateSubscriptionId.test.ts`
- Delete: `src/app/connect/page.tsx` (superseded — see Step 5)

**Interfaces:**
- Consumes: `requireCustomerId`, `prisma` (Fase 1), the existing `POST /api/subscriptions`, `GET /api/subscriptions/connect-link`, `POST /api/subscriptions/:id/verify` routes (Fase 1 Task 12, unmodified).
- Produces: the real onboarding UI. No new API routes — this task is UI-only on top of already-existing, already-reviewed backend routes.

- [ ] **Step 1: Write the failing test for subscription-ID validation**

`tests/lib/ambientes/validateSubscriptionId.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isValidSubscriptionId } from "@/lib/ambientes/validateSubscriptionId";

describe("isValidSubscriptionId", () => {
  it("accepts a well-formed GUID", () => {
    expect(isValidSubscriptionId("11111111-2222-3333-4444-555555555555")).toBe(true);
  });

  it("rejects an empty string", () => {
    expect(isValidSubscriptionId("")).toBe(false);
  });

  it("rejects a string that isn't GUID-shaped", () => {
    expect(isValidSubscriptionId("not-a-guid")).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- validateSubscriptionId`
Expected: FAIL with "Cannot find module '@/lib/ambientes/validateSubscriptionId'"

- [ ] **Step 3: Implement the validator**

`src/lib/ambientes/validateSubscriptionId.ts`:

```ts
const GUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidSubscriptionId(value: string): boolean {
  return GUID_PATTERN.test(value.trim());
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- validateSubscriptionId`
Expected: PASS (3 tests)

- [ ] **Step 5: Remove the superseded `/connect` page**

Run: `git rm src/app/connect/page.tsx`

(This page's entire job — listing subscriptions and explaining the Lighthouse deploy step — is replaced by `/ambientes` below, which does the same thing plus the real add/verify form Task 12's routes never had a UI for.)

- [ ] **Step 6: Write the Ambientes server page**

`src/app/ambientes/page.tsx`:

```tsx
import { prisma } from "@/lib/prisma";
import { requireCustomerId } from "@/lib/tenant";
import { AmbientesClient } from "@/components/ambientes/AmbientesClient";

export default async function AmbientesPage() {
  const customerId = await requireCustomerId();

  const subscriptions = await prisma.subscription.findMany({
    where: { customerId },
    orderBy: { createdAt: "desc" },
    include: {
      costSnapshots: {
        orderBy: { capturedAt: "desc" },
        take: 1,
      },
    },
  });

  return (
    <AmbientesClient
      initialSubscriptions={subscriptions.map((s) => ({
        id: s.id,
        azureSubscriptionId: s.azureSubscriptionId,
        displayName: s.displayName,
        status: s.status,
        lastScanAt: s.costSnapshots[0]?.capturedAt.toISOString() ?? null,
      }))}
    />
  );
}
```

- [ ] **Step 7: Write the Ambientes client component**

`src/components/ambientes/AmbientesClient.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useLocale } from "@/lib/i18n/LocaleProvider";
import { isValidSubscriptionId } from "@/lib/ambientes/validateSubscriptionId";

interface AmbienteRow {
  id: string;
  azureSubscriptionId: string;
  displayName: string;
  status: "PENDING" | "CONNECTED" | "ERROR";
  lastScanAt: string | null;
}

interface ConnectLinkInfo {
  deployUrl: string;
}

export function AmbientesClient({
  initialSubscriptions,
}: {
  initialSubscriptions: AmbienteRow[];
}) {
  const { t } = useLocale();
  const [subscriptions, setSubscriptions] = useState(initialSubscriptions);
  const [azureSubscriptionId, setAzureSubscriptionId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [connectLinkBySubscription, setConnectLinkBySubscription] = useState<
    Record<string, ConnectLinkInfo>
  >({});
  const [verifyMessageBySubscription, setVerifyMessageBySubscription] = useState<
    Record<string, string>
  >({});

  async function handleAddEnvironment(event: React.FormEvent) {
    event.preventDefault();
    if (!isValidSubscriptionId(azureSubscriptionId)) {
      setFormError("ID de subscription inválido");
      return;
    }
    if (!displayName.trim()) {
      setFormError("Nome é obrigatório");
      return;
    }
    setFormError(null);

    const response = await fetch("/api/subscriptions", {
      method: "POST",
      body: JSON.stringify({ azureSubscriptionId, displayName }),
    });

    if (!response.ok) {
      setFormError("Não foi possível adicionar este ambiente");
      return;
    }

    const created = await response.json();
    setSubscriptions((current) => [
      {
        id: created.id,
        azureSubscriptionId: created.azureSubscriptionId,
        displayName: created.displayName,
        status: created.status,
        lastScanAt: null,
      },
      ...current,
    ]);
    setAzureSubscriptionId("");
    setDisplayName("");
  }

  async function handleShowDeployLink(subscriptionRowId: string) {
    const response = await fetch("/api/subscriptions/connect-link");
    if (!response.ok) {
      return;
    }
    const data = await response.json();
    setConnectLinkBySubscription((current) => ({
      ...current,
      [subscriptionRowId]: { deployUrl: data.deployUrl },
    }));
  }

  async function handleVerify(subscriptionRowId: string) {
    const response = await fetch(`/api/subscriptions/${subscriptionRowId}/verify`, {
      method: "POST",
    });

    if (response.status === 409) {
      setVerifyMessageBySubscription((current) => ({
        ...current,
        [subscriptionRowId]: "Delegação ainda não encontrada — tente novamente em alguns minutos.",
      }));
      return;
    }
    if (!response.ok) {
      setVerifyMessageBySubscription((current) => ({
        ...current,
        [subscriptionRowId]: "Não foi possível verificar a conexão.",
      }));
      return;
    }

    setSubscriptions((current) =>
      current.map((s) =>
        s.id === subscriptionRowId ? { ...s, status: "CONNECTED" } : s,
      ),
    );
    setVerifyMessageBySubscription((current) => {
      const next = { ...current };
      delete next[subscriptionRowId];
      return next;
    });
  }

  return (
    <main className="p-6">
      <h1 className="text-2xl font-bold mb-4">{t("ambientes.title")}</h1>

      <form onSubmit={handleAddEnvironment} className="mb-8 flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-sm mb-1" htmlFor="azureSubscriptionId">
            {t("ambientes.subscriptionId")}
          </label>
          <input
            id="azureSubscriptionId"
            className="border rounded px-3 py-2"
            value={azureSubscriptionId}
            onChange={(e) => setAzureSubscriptionId(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-sm mb-1" htmlFor="displayName">
            {t("ambientes.displayName")}
          </label>
          <input
            id="displayName"
            className="border rounded px-3 py-2"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </div>
        <button
          type="submit"
          className="bg-blue-600 text-white rounded px-4 py-2 hover:bg-blue-700"
        >
          {t("ambientes.submit")}
        </button>
        {formError && <p className="text-red-600 text-sm">{formError}</p>}
      </form>

      <ul className="space-y-4">
        {subscriptions.map((s) => (
          <li key={s.id} className="border rounded p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">
                  {s.displayName} ({s.azureSubscriptionId})
                </p>
                <p className="text-sm text-gray-500">
                  {s.status === "CONNECTED" ? t("ambientes.connected") : t("ambientes.pending")}
                  {" · "}
                  {t("ambientes.lastScan")}: {s.lastScanAt ?? t("ambientes.neverScanned")}
                </p>
              </div>
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
            </div>
            {connectLinkBySubscription[s.id] && (
              <p className="mt-2 text-sm">
                {t("ambientes.deployInstructions")}{" "}
                <a
                  className="text-blue-600 underline"
                  href={connectLinkBySubscription[s.id].deployUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  {connectLinkBySubscription[s.id].deployUrl}
                </a>
              </p>
            )}
            {verifyMessageBySubscription[s.id] && (
              <p className="mt-2 text-sm text-amber-600">
                {verifyMessageBySubscription[s.id]}
              </p>
            )}
          </li>
        ))}
      </ul>
    </main>
  );
}
```

- [ ] **Step 8: Run the full suite and commit**

Run: `npm test`
Expected: all PASS (removing `/connect` deletes no tests — Fase 1 never added one for that page).

```bash
git add -A src/app/ambientes src/components/ambientes src/lib/ambientes tests/lib/ambientes src/app/connect
git commit -m "feat: real add-environment flow (Ambientes page)"
```

---

## Task 11: Dashboard redesign

**Files:**
- Modify: `src/app/layout.tsx`
- Modify: `src/app/dashboard/page.tsx`
- Create: `src/components/dashboard/DashboardClient.tsx`
- Create: `src/components/dashboard/CostTrendChart.tsx`
- Create: `src/app/dashboard/actions.ts`

**Interfaces:**
- Consumes: `computeDashboardSummary` (Fase 1), `categoryForRule`/`impactForCost` (Task 9), `useTheme` (Task 7), `useLocale` (Task 8).
- Produces: the redesigned dashboard UI. No new exports consumed by anything outside this task.

- [ ] **Step 1: Wrap the root layout in the theme/locale providers**

Replace `src/app/layout.tsx`:

```tsx
import "./globals.css";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";
import { LocaleProvider } from "@/lib/i18n/LocaleProvider";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR">
      <body>
        <ThemeProvider>
          <LocaleProvider>{children}</LocaleProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
```

- [ ] **Step 2: Add the sign-out server action**

`src/app/dashboard/actions.ts`:

```ts
"use server";

import { signOut } from "@/auth";

export async function signOutAction() {
  await signOut({ redirectTo: "/" });
}
```

- [ ] **Step 3: Update the dashboard server page to fetch everything the client needs**

Replace `src/app/dashboard/page.tsx`:

```tsx
import { prisma } from "@/lib/prisma";
import { requireCustomerId } from "@/lib/tenant";
import { auth } from "@/auth";
import { computeDashboardSummary } from "@/lib/dashboard-summary";
import { DashboardClient } from "@/components/dashboard/DashboardClient";

export default async function DashboardPage() {
  const customerId = await requireCustomerId();
  const session = await auth();

  const findings = await prisma.wasteFinding.findMany({
    where: { subscription: { customerId } },
    orderBy: { detectedAt: "desc" },
    include: { subscription: true },
  });

  const subscriptions = await prisma.subscription.findMany({
    where: { customerId, status: "CONNECTED" },
    orderBy: { createdAt: "asc" },
    include: {
      costSnapshots: {
        orderBy: { capturedAt: "desc" },
        take: 1,
      },
    },
  });

  const summary = computeDashboardSummary(findings);
  const activeResourceCount = await prisma.resource.count({
    where: { subscription: { customerId } },
  });

  return (
    <DashboardClient
      userLabel={session?.user?.name ?? session?.user?.email ?? ""}
      summary={summary}
      activeResourceCount={activeResourceCount}
      findings={findings.map((f) => ({
        id: f.id,
        ruleType: f.ruleType,
        resourceId: f.resourceId,
        subscriptionName: f.subscription.displayName,
        estimatedMonthlyCost: f.estimatedMonthlyCost,
        status: f.status,
      }))}
      subscriptions={subscriptions.map((s) => ({
        id: s.id,
        displayName: s.displayName,
        monthToDateSpend: s.costSnapshots[0]?.monthToDateSpend ?? null,
        projectedSpend: s.costSnapshots[0]?.projectedSpend ?? null,
        dailyTrend: (s.costSnapshots[0]?.dailyTrend as
          | { date: string; cost: number }[]
          | undefined) ?? [],
      }))}
    />
  );
}
```

- [ ] **Step 4: Write the cost trend chart component**

`src/components/dashboard/CostTrendChart.tsx`:

```tsx
"use client";

interface DailyCost {
  date: string;
  cost: number;
}

export function CostTrendChart({
  data,
  noDataLabel,
}: {
  data: DailyCost[];
  noDataLabel: string;
}) {
  if (data.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center text-sm text-gray-400">
        {noDataLabel}
      </div>
    );
  }

  const width = 600;
  const height = 160;
  const maxCost = Math.max(...data.map((d) => d.cost), 1);
  const stepX = width / Math.max(data.length - 1, 1);

  const points = data
    .map((d, i) => {
      const x = i * stepX;
      const y = height - (d.cost / maxCost) * height;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-40 w-full">
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        className="text-blue-600 dark:text-blue-400"
        strokeWidth={2}
      />
    </svg>
  );
}
```

- [ ] **Step 5: Write the dashboard client component**

`src/components/dashboard/DashboardClient.tsx`:

```tsx
"use client";

import { useMemo, useState } from "react";
import type { FindingStatus, WasteRuleType } from "@prisma/client";
import { useTheme } from "@/lib/theme/ThemeProvider";
import { useLocale } from "@/lib/i18n/LocaleProvider";
import { categoryForRule, impactForCost, type DashboardCategory } from "@/lib/dashboard-categories";
import { CostTrendChart } from "@/components/dashboard/CostTrendChart";
import { signOutAction } from "@/app/dashboard/actions";
import type { Locale } from "@/lib/i18n/dictionaries";

interface FindingRow {
  id: string;
  ruleType: WasteRuleType;
  resourceId: string;
  subscriptionName: string;
  estimatedMonthlyCost: number;
  status: FindingStatus;
}

interface SubscriptionOption {
  id: string;
  displayName: string;
  monthToDateSpend: number | null;
  projectedSpend: number | null;
  dailyTrend: { date: string; cost: number }[];
}

export function DashboardClient({
  userLabel,
  summary,
  activeResourceCount,
  findings,
  subscriptions,
}: {
  userLabel: string;
  summary: { openFindingsCount: number; totalEstimatedMonthlySavings: number };
  activeResourceCount: number;
  findings: FindingRow[];
  subscriptions: SubscriptionOption[];
}) {
  const { theme, toggleTheme } = useTheme();
  const { locale, setLocale, t } = useLocale();
  const [categoryFilter, setCategoryFilter] = useState<DashboardCategory | "all">("all");
  const [search, setSearch] = useState("");
  const [selectedSubscriptionId, setSelectedSubscriptionId] = useState(
    subscriptions[0]?.id ?? "",
  );
  const [visibleFindings, setVisibleFindings] = useState(findings);

  const selectedSubscription = subscriptions.find((s) => s.id === selectedSubscriptionId);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return visibleFindings.filter((f) => {
      if (categoryFilter !== "all" && categoryForRule(f.ruleType) !== categoryFilter) {
        return false;
      }
      if (!term) {
        return true;
      }
      return (
        f.resourceId.toLowerCase().includes(term) ||
        t(`rule.${f.ruleType}`).toLowerCase().includes(term)
      );
    });
  }, [visibleFindings, categoryFilter, search, t]);

  async function handleTakeAction(findingId: string) {
    const response = await fetch(`/api/findings/${findingId}/dismiss`, { method: "POST" });
    if (response.ok) {
      setVisibleFindings((current) => current.filter((f) => f.id !== findingId));
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 dark:bg-gray-900 dark:text-gray-100">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-gray-200 p-4 dark:border-gray-700">
        <div className="flex items-center gap-6">
          <span className="text-lg font-bold">Cloud Waste Hunter</span>
          <nav className="flex gap-4 text-sm">
            <span className="font-medium">{t("nav.dashboard")}</span>
            <span className="font-medium">{t("nav.recommendations")}</span>
            <a href="/ambientes" className="font-medium hover:underline">
              {t("nav.ambientes")}
            </a>
            <span className="text-gray-400" title={t("nav.comingSoon")}>
              {t("nav.reports")}
            </span>
            <span className="text-gray-400" title={t("nav.comingSoon")}>
              {t("nav.automation")}
            </span>
          </nav>
        </div>
        <input
          type="search"
          placeholder={t("search.placeholder")}
          className="rounded border border-gray-300 px-3 py-1 text-sm dark:border-gray-600 dark:bg-gray-800"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="flex items-center gap-3 text-sm">
          <span>{userLabel}</span>
          <select
            value={locale}
            onChange={(e) => setLocale(e.target.value as Locale)}
            className="rounded border border-gray-300 px-2 py-1 dark:border-gray-600 dark:bg-gray-800"
          >
            <option value="pt-BR">pt-BR</option>
            <option value="en">en</option>
            <option value="es">es</option>
          </select>
          <button
            type="button"
            onClick={toggleTheme}
            className="rounded border border-gray-300 px-2 py-1 dark:border-gray-600"
          >
            {theme === "light" ? "🌙" : "☀️"}
          </button>
          <form action={signOutAction}>
            <button type="submit" className="rounded border border-gray-300 px-2 py-1 dark:border-gray-600">
              {t("account.signOut")}
            </button>
          </form>
        </div>
      </header>

      <main className="p-6">
        {subscriptions.length > 1 && (
          <div className="mb-4">
            <select
              value={selectedSubscriptionId}
              onChange={(e) => setSelectedSubscriptionId(e.target.value)}
              className="rounded border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-800"
            >
              {subscriptions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.displayName}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
          <StatCard label={t("cards.potentialSavings")} value={`$${summary.totalEstimatedMonthlySavings.toFixed(2)}`} />
          <StatCard label={t("cards.activeResources")} value={String(activeResourceCount)} />
          <StatCard
            label={t("cards.monthlySpending")}
            value={
              selectedSubscription?.monthToDateSpend != null
                ? `$${selectedSubscription.monthToDateSpend.toFixed(2)}`
                : "$0.00"
            }
          />
          <StatCard
            label={t("cards.projectedBill")}
            value={
              selectedSubscription?.projectedSpend != null
                ? `$${selectedSubscription.projectedSpend.toFixed(2)}`
                : "$0.00"
            }
          />
        </div>

        <div className="mb-6 grid gap-4 md:grid-cols-3">
          <section className="rounded border border-gray-200 p-4 md:col-span-2 dark:border-gray-700">
            <h2 className="mb-2 font-semibold">{t("chart.title")}</h2>
            <CostTrendChart
              data={selectedSubscription?.dailyTrend ?? []}
              noDataLabel={t("chart.noData")}
            />
          </section>
          <section className="rounded border border-gray-200 p-4 dark:border-gray-700">
            <h2 className="mb-2 font-semibold">{t("notifications.title")}</h2>
            <p className="text-sm text-gray-400">{t("notifications.placeholder")}</p>
          </section>
        </div>

        <div className="mb-4 flex gap-2">
          {(["all", "storage", "compute", "network"] as const).map((category) => (
            <button
              key={category}
              type="button"
              onClick={() => setCategoryFilter(category)}
              className={`rounded px-3 py-1 text-sm ${
                categoryFilter === category
                  ? "bg-blue-600 text-white"
                  : "border border-gray-300 dark:border-gray-600"
              }`}
            >
              {category === "all" ? t("filters.all") : t(`filters.${category}`)}
            </button>
          ))}
        </div>

        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left dark:border-gray-700">
              <th className="p-2">{t("table.category")}</th>
              <th className="p-2">{t("table.rule")}</th>
              <th className="p-2">{t("table.resource")}</th>
              <th className="p-2">{t("table.subscription")}</th>
              <th className="p-2">{t("table.impact")}</th>
              <th className="p-2">{t("table.estimatedSavings")}</th>
              <th className="p-2">{t("table.status")}</th>
              <th className="p-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((finding) => {
              const impact = impactForCost(finding.estimatedMonthlyCost);
              return (
                <tr key={finding.id} className="border-b border-gray-100 dark:border-gray-800">
                  <td className="p-2">{t(`filters.${categoryForRule(finding.ruleType)}`)}</td>
                  <td className="p-2">{t(`rule.${finding.ruleType}`)}</td>
                  <td className="p-2">{finding.resourceId}</td>
                  <td className="p-2">{finding.subscriptionName}</td>
                  <td className="p-2">
                    <span
                      className={`rounded px-2 py-0.5 text-xs ${
                        impact === "high"
                          ? "bg-red-100 text-red-700"
                          : impact === "medium"
                            ? "bg-amber-100 text-amber-700"
                            : "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {t(`impact.${impact}`)}
                    </span>
                  </td>
                  <td className="p-2">${finding.estimatedMonthlyCost.toFixed(2)}</td>
                  <td className="p-2">{finding.status}</td>
                  <td className="p-2">
                    <button
                      type="button"
                      onClick={() => handleTakeAction(finding.id)}
                      className="rounded bg-blue-600 px-3 py-1 text-xs text-white hover:bg-blue-700"
                    >
                      {t("table.takeAction")}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </main>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-gray-200 p-4 dark:border-gray-700">
      <p className="text-sm text-gray-500 dark:text-gray-400">{label}</p>
      <p className="text-xl font-bold">{value}</p>
    </div>
  );
}
```

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: all PASS (this task adds no new automated tests — the JSX/layout is verified manually in Task 12, per the plan's Global Constraints and Fase 1's own precedent for `dashboard`/`connect`).

- [ ] **Step 7: Verify the build and type-check**

Run: `npx tsc --noEmit`
Expected: zero errors.

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 8: Commit**

```bash
git add src/app/layout.tsx src/app/dashboard src/components/dashboard
git commit -m "feat: redesign dashboard (nav, cards, chart, filters, search, i18n, theme)"
```

---

## Task 12: Manual end-to-end validation

**Files:** none (manual validation only — no code changes)

**Interfaces:**
- Consumes: every artifact from Tasks 1-11.

- [ ] **Step 1: Seed a subscription and findings directly via Prisma (no real Azure needed for a visual check)**

Run `npx tsx` with a short inline script, or use `npx prisma studio`, to create: one `Customer` (or reuse the one your Entra ID login already created), one `Subscription` with `status: "CONNECTED"`, a few `WasteFinding` rows across different `ruleType`s (including at least one `IDLE_VM`), and one `CostSnapshot` row with a non-empty `dailyTrend`.

- [ ] **Step 2: Run the app and sign in**

Run: `npm run dev`, sign in with a real test Entra ID account.

- [ ] **Step 3: Verify the dashboard**

Visit `/dashboard`. Confirm: the stat cards show real numbers (not the seeded snapshot's zero-state unless you seeded zeros), the cost trend chart renders the seeded `dailyTrend`, the three category filters correctly partition the seeded findings, the search box narrows visible rows as you type, the theme toggle switches light/dark instantly, the language selector switches every redesigned label across pt-BR/en/es, and "Take Action" removes a row and calls the existing dismiss route (confirm via `npx prisma studio` that the row's `status` is now `DISMISSED`).

- [ ] **Step 4: Verify Ambientes**

Visit `/ambientes`. Add a new environment through the real form with a syntactically-valid but fake subscription GUID (verification will correctly fail with a real Azure call, or you can test against the real test subscription from Fase 1's Task 15 if you have it available). Confirm the new row appears as `PENDING`, and that clicking "Lighthouse" reveals the deploy link from the existing `connect-link` route.

- [ ] **Step 5: Record the result**

Add a short note to `docs/superpowers/plans/2026-09-11-dashboard-redesign-idle-vm.md` (this file) under a new `## Validation Log` heading with the date and outcome, and commit.

```bash
git add docs/superpowers/plans/2026-09-11-dashboard-redesign-idle-vm.md
git commit -m "docs: record dashboard redesign end-to-end validation result"
```

## Validation Log

**2026-09-11 — Controller-run validation (no real Entra ID/Azure available in this session):**

- Full suite re-verified clean after all 12 tasks and the final-review fix wave: 82/82 tests, 3 consecutive runs, no flake reproduction (one earlier anomalous timeout was environmental, not a code defect). `npx tsc --noEmit`, `npm run lint`, `npm run build` all clean.
- Visual validation: rendered the real, committed `DashboardClient`/`CostTrendChart` components via a temporary, uncommitted preview route fed with mock props (deleted immediately after). Confirmed live and working: light/dark theme toggle, pt-BR/en language switch across all redesigned labels, category filter (Storage/Compute/Network) correctly narrowing the table, stat cards and cost-trend chart rendering prop data with correct formatting and zero-state handling. Screenshots reviewed by the user.
- `/ambientes`'s add-environment form, real Entra ID login end-to-end, and a live smoke test of the Forecast API body (flagged unverified in the final review) were **not** exercised against real Azure/Entra ID — deferred, same limitation as Fase 1's Task 15. Steps 2-4 above remain open for whoever has access to a real test tenant/subscription.
