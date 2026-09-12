# Operator Multi-Client Switching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let one signed-in user ("operator") explicitly add named clients and switch which client's `Ambientes`/`Dashboard` data they're viewing, without re-authenticating, with strict per-request DB-verified isolation so no operator can ever view another operator's client.

**Architecture:** A single nullable self-relation column (`Customer.operatorCustomerId`) turns any existing `Customer` row into an operator by letting other `Customer` rows point back to it. An httpOnly cookie (`cwh-active-client`) names the currently-viewed client; every read of it is re-verified against the database (never trusted blindly) inside `resolveActiveCustomerId`, the single enforcement point reused by both the read path (`requireCustomerId`) and the write path (`setActiveClient`). No existing page or API route changes beyond passing a few extra props — they all already call `requireCustomerId()`.

**Tech Stack:** Next.js 15 (App Router, Server Actions), Prisma 5 / PostgreSQL, next-auth v5, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-12-multi-client-operator-design.md`

## Global Constraints

- Single operator only for now (no multi-operator/shared-team model) — per spec Non-Goals.
- No client edit/delete/transfer in this pass — per spec Non-Goals.
- The `cwh-active-client` cookie value must never be trusted without a DB ownership check — every resolution goes through `resolveActiveCustomerId`.
- No existing page/API route's call sites change except to add new props — `requireCustomerId()`'s signature and return type stay identical.

---

## Task 1: `Customer.operatorCustomerId` schema + migration

**Files:**
- Modify: `prisma/schema.prisma:10-17` (the `Customer` model)
- Modify: `tests/helpers/resetDb.ts`

**Interfaces:**
- Produces: `Customer.operatorCustomerId: string | null`, self-relation `Customer.operator`/`Customer.managedClients` — consumed by every later task.

- [ ] **Step 1: Add the column and self-relation to the `Customer` model**

In `prisma/schema.prisma`, replace the `Customer` model:

```prisma
model Customer {
  id                 String         @id @default(cuid())
  entraTenantId      String         @unique
  name               String
  createdAt          DateTime       @default(now())
  operatorCustomerId String?
  operator           Customer?      @relation("OperatorClients", fields: [operatorCustomerId], references: [id])
  managedClients     Customer[]     @relation("OperatorClients")
  users              User[]
  subscriptions      Subscription[]
}
```

- [ ] **Step 2: Generate and apply the migration**

Run: `npx prisma migrate dev --name add_operator_customer_id`
Expected: a new folder under `prisma/migrations/` is created, the dev database is migrated, and the Prisma client is regenerated. No prompts about data loss (the column is nullable and additive).

- [ ] **Step 3: Fix `resetDb` for the new self-reference**

A single `DELETE FROM "Customer"` removing every row while some rows still reference others via `operatorCustomerId` can fail the foreign key constraint. Null out the self-reference first. Replace `tests/helpers/resetDb.ts` with:

```ts
import { prisma } from "@/lib/prisma";

export async function resetDb(): Promise<void> {
  await prisma.costSnapshot.deleteMany();
  await prisma.wasteFinding.deleteMany();
  await prisma.resource.deleteMany();
  await prisma.scanRun.deleteMany();
  await prisma.subscription.deleteMany();
  await prisma.user.deleteMany();
  await prisma.customer.updateMany({ data: { operatorCustomerId: null } });
  await prisma.customer.deleteMany();
}
```

- [ ] **Step 4: Apply the same migration to the test database and run the full suite**

Run: `npx dotenv -e .env.test -- npx prisma migrate deploy`
Run: `npm test`
Expected: all existing tests still pass — this is what proves `resetDb`'s fix actually works, since every existing DB test calls it in `beforeEach`.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations tests/helpers/resetDb.ts
git commit -m "feat: add Customer.operatorCustomerId for multi-client operators"
```

---

## Task 2: Active-client resolution in `src/lib/tenant.ts`

**Files:**
- Modify: `src/lib/tenant.ts` (full rewrite — it's currently 16 lines)
- Test: `tests/lib/tenant.test.ts` (new)

**Interfaces:**
- Consumes: `prisma.customer` (Task 1's schema), `auth()` from `@/auth` (existing).
- Produces:
  - `ACTIVE_CLIENT_COOKIE: string` — the cookie name, reused by Task 3.
  - `getOperatorCustomerId(): Promise<string>` — reused by Task 3 and Tasks 6-7's pages.
  - `resolveActiveCustomerId(operatorCustomerId: string, activeClientCookieValue: string | null): Promise<string>` — reused by Task 3.
  - `getManagedClients(operatorCustomerId: string): Promise<{ id: string; name: string }[]>` — reused by Tasks 6-7's pages.
  - `requireCustomerId(): Promise<string>` — unchanged signature/behavior for every existing caller.

- [ ] **Step 1: Write the failing tests**

Create `tests/lib/tenant.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { getManagedClients, resolveActiveCustomerId } from "@/lib/tenant";
import { resetDb } from "../helpers/resetDb";

describe("resolveActiveCustomerId", () => {
  beforeEach(resetDb);

  it("returns the operator's own id when no cookie value is present", async () => {
    const operator = await prisma.customer.create({
      data: { entraTenantId: "tenant-op", name: "Operator" },
    });
    const result = await resolveActiveCustomerId(operator.id, null);
    expect(result).toBe(operator.id);
  });

  it("returns the operator's own id when the cookie matches it", async () => {
    const operator = await prisma.customer.create({
      data: { entraTenantId: "tenant-op2", name: "Operator" },
    });
    const result = await resolveActiveCustomerId(operator.id, operator.id);
    expect(result).toBe(operator.id);
  });

  it("returns a managed client's id when the cookie names a client the operator owns", async () => {
    const operator = await prisma.customer.create({
      data: { entraTenantId: "tenant-op3", name: "Operator" },
    });
    const client = await prisma.customer.create({
      data: { entraTenantId: "managed:client-1", name: "Client A", operatorCustomerId: operator.id },
    });
    const result = await resolveActiveCustomerId(operator.id, client.id);
    expect(result).toBe(client.id);
  });

  it("falls back to the operator's own id when the cookie names a customer they do not operate", async () => {
    const operator = await prisma.customer.create({
      data: { entraTenantId: "tenant-op4", name: "Operator" },
    });
    const otherOperator = await prisma.customer.create({
      data: { entraTenantId: "tenant-other", name: "Other Operator" },
    });
    const someoneElsesClient = await prisma.customer.create({
      data: {
        entraTenantId: "managed:client-2",
        name: "Someone Else's Client",
        operatorCustomerId: otherOperator.id,
      },
    });
    const result = await resolveActiveCustomerId(operator.id, someoneElsesClient.id);
    expect(result).toBe(operator.id);
  });

  it("falls back to the operator's own id when the cookie names a nonexistent customer", async () => {
    const operator = await prisma.customer.create({
      data: { entraTenantId: "tenant-op5", name: "Operator" },
    });
    const result = await resolveActiveCustomerId(operator.id, "does-not-exist");
    expect(result).toBe(operator.id);
  });
});

describe("getManagedClients", () => {
  beforeEach(resetDb);

  it("returns only customers operated by the given operator, sorted by name", async () => {
    const operator = await prisma.customer.create({
      data: { entraTenantId: "tenant-op6", name: "Operator" },
    });
    const other = await prisma.customer.create({
      data: { entraTenantId: "tenant-op7", name: "Unrelated Operator" },
    });
    await prisma.customer.create({
      data: { entraTenantId: "managed:b", name: "Beta Client", operatorCustomerId: operator.id },
    });
    await prisma.customer.create({
      data: { entraTenantId: "managed:a", name: "Alpha Client", operatorCustomerId: operator.id },
    });
    await prisma.customer.create({
      data: { entraTenantId: "managed:c", name: "Not Mine", operatorCustomerId: other.id },
    });

    const result = await getManagedClients(operator.id);

    expect(result.map((c) => c.name)).toEqual(["Alpha Client", "Beta Client"]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- tests/lib/tenant.test.ts`
Expected: FAIL — `resolveActiveCustomerId`/`getManagedClients` are not exported yet.

- [ ] **Step 3: Rewrite `src/lib/tenant.ts`**

```ts
import { cookies } from "next/headers";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export const ACTIVE_CLIENT_COOKIE = "cwh-active-client";

export class UnauthenticatedError extends Error {
  constructor() {
    super("No authenticated customer in session");
  }
}

/** The signed-in identity's own Customer.id — never the currently-viewed client. */
export async function getOperatorCustomerId(): Promise<string> {
  const session = await auth();
  if (!session?.customerId) {
    throw new UnauthenticatedError();
  }
  return session.customerId;
}

/**
 * Resolves which Customer.id should be treated as "active" for this
 * request. The cookie value is never trusted on its own — it's only
 * honored when it names the operator themself or a Customer row whose
 * operatorCustomerId is this operator, verified fresh against the
 * database on every call. Anything else (unowned, tampered, stale,
 * nonexistent) silently falls back to the operator's own id.
 */
export async function resolveActiveCustomerId(
  operatorCustomerId: string,
  activeClientCookieValue: string | null,
): Promise<string> {
  if (!activeClientCookieValue || activeClientCookieValue === operatorCustomerId) {
    return operatorCustomerId;
  }
  const candidate = await prisma.customer.findUnique({
    where: { id: activeClientCookieValue },
    select: { id: true, operatorCustomerId: true },
  });
  if (candidate && candidate.operatorCustomerId === operatorCustomerId) {
    return candidate.id;
  }
  return operatorCustomerId;
}

/** Every client the given operator has added, alphabetically. */
export async function getManagedClients(
  operatorCustomerId: string,
): Promise<{ id: string; name: string }[]> {
  return prisma.customer.findMany({
    where: { operatorCustomerId },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

export async function requireCustomerId(): Promise<string> {
  const operatorCustomerId = await getOperatorCustomerId();
  const cookieStore = await cookies();
  const activeClientCookieValue = cookieStore.get(ACTIVE_CLIENT_COOKIE)?.value ?? null;
  return resolveActiveCustomerId(operatorCustomerId, activeClientCookieValue);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- tests/lib/tenant.test.ts`
Expected: PASS (5 + 1 tests).

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS — confirms nothing that already calls `requireCustomerId()` broke.

- [ ] **Step 6: Commit**

```bash
git add src/lib/tenant.ts tests/lib/tenant.test.ts
git commit -m "feat: verified active-client resolution in requireCustomerId"
```

---

## Task 3: Server actions — `setActiveClient` and `addManagedClient`

**Files:**
- Create: `src/app/ambientes/actions.ts`
- Test: `tests/app/ambientes/actions.test.ts` (new)

**Interfaces:**
- Consumes: `ACTIVE_CLIENT_COOKIE`, `getOperatorCustomerId`, `resolveActiveCustomerId` from `@/lib/tenant` (Task 2).
- Produces:
  - `setActiveClient(clientId: string): Promise<void>` — reused by Task 4's `ClientSwitcher`.
  - `addManagedClient(name: string): Promise<{ id: string; name: string }>` — reused by Task 7's `AmbientesClient`.

- [ ] **Step 1: Write the failing tests**

Create `tests/app/ambientes/actions.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { resetDb } from "../../helpers/resetDb";

vi.mock("@/lib/tenant", async () => {
  const actual = await vi.importActual<typeof import("@/lib/tenant")>("@/lib/tenant");
  return {
    ...actual,
    getOperatorCustomerId: vi.fn(),
  };
});
vi.mock("next/headers", () => ({ cookies: vi.fn() }));

import { getOperatorCustomerId } from "@/lib/tenant";
import { cookies } from "next/headers";
import { addManagedClient, setActiveClient } from "@/app/ambientes/actions";

function fakeCookieStore() {
  const store = new Map<string, string>();
  return {
    get: (name: string) =>
      store.has(name) ? { name, value: store.get(name) as string } : undefined,
    set: (name: string, value: string) => {
      store.set(name, value);
    },
    _store: store,
  };
}

describe("addManagedClient", () => {
  beforeEach(resetDb);

  it("creates a customer owned by the signed-in operator", async () => {
    const operator = await prisma.customer.create({
      data: { entraTenantId: "tenant-op", name: "Operator" },
    });
    vi.mocked(getOperatorCustomerId).mockResolvedValue(operator.id);

    const result = await addManagedClient("Acme Corp");

    const created = await prisma.customer.findUniqueOrThrow({ where: { id: result.id } });
    expect(created.name).toBe("Acme Corp");
    expect(created.operatorCustomerId).toBe(operator.id);
  });

  it("rejects a blank name", async () => {
    const operator = await prisma.customer.create({
      data: { entraTenantId: "tenant-op2", name: "Operator" },
    });
    vi.mocked(getOperatorCustomerId).mockResolvedValue(operator.id);

    await expect(addManagedClient("   ")).rejects.toThrow();
  });
});

describe("setActiveClient", () => {
  beforeEach(resetDb);

  it("sets the cookie to a client the operator owns", async () => {
    const operator = await prisma.customer.create({
      data: { entraTenantId: "tenant-op3", name: "Operator" },
    });
    const client = await prisma.customer.create({
      data: { entraTenantId: "managed:x", name: "Client X", operatorCustomerId: operator.id },
    });
    vi.mocked(getOperatorCustomerId).mockResolvedValue(operator.id);
    const store = fakeCookieStore();
    vi.mocked(cookies).mockResolvedValue(store as never);

    await setActiveClient(client.id);

    expect(store._store.get("cwh-active-client")).toBe(client.id);
  });

  it("falls back to the operator's own id when given a client it does not own", async () => {
    const operator = await prisma.customer.create({
      data: { entraTenantId: "tenant-op4", name: "Operator" },
    });
    const otherOperator = await prisma.customer.create({
      data: { entraTenantId: "tenant-other", name: "Other" },
    });
    const notMine = await prisma.customer.create({
      data: { entraTenantId: "managed:y", name: "Not mine", operatorCustomerId: otherOperator.id },
    });
    vi.mocked(getOperatorCustomerId).mockResolvedValue(operator.id);
    const store = fakeCookieStore();
    vi.mocked(cookies).mockResolvedValue(store as never);

    await setActiveClient(notMine.id);

    expect(store._store.get("cwh-active-client")).toBe(operator.id);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- tests/app/ambientes/actions.test.ts`
Expected: FAIL — `src/app/ambientes/actions.ts` doesn't exist yet.

- [ ] **Step 3: Create `src/app/ambientes/actions.ts`**

```ts
"use server";

import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { ACTIVE_CLIENT_COOKIE, getOperatorCustomerId, resolveActiveCustomerId } from "@/lib/tenant";

export async function setActiveClient(clientId: string): Promise<void> {
  const operatorCustomerId = await getOperatorCustomerId();
  const resolved = await resolveActiveCustomerId(operatorCustomerId, clientId);
  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_CLIENT_COOKIE, resolved, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  });
}

export async function addManagedClient(name: string): Promise<{ id: string; name: string }> {
  const operatorCustomerId = await getOperatorCustomerId();
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error("Client name is required");
  }
  const client = await prisma.customer.create({
    data: {
      entraTenantId: `managed:${crypto.randomUUID()}`,
      name: trimmed,
      operatorCustomerId,
    },
  });
  return { id: client.id, name: client.name };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- tests/app/ambientes/actions.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/ambientes/actions.ts tests/app/ambientes/actions.test.ts
git commit -m "feat: add setActiveClient and addManagedClient server actions"
```

---

## Task 4: i18n strings for client management

**Files:**
- Modify: `src/lib/i18n/dictionaries.ts` (three locations — one per locale block)

**Interfaces:**
- Produces: dictionary keys `ambientes.clientsHeading`, `ambientes.clientName`, `ambientes.addClient`, `ambientes.clientNameRequired`, `ambientes.addClientFailed` — consumed by Task 7.

- [ ] **Step 1: Add the pt-BR keys**

In `src/lib/i18n/dictionaries.ts`, in the `"pt-BR"` block, right after the existing `"ambientes.displayName": "Nome de exibição",` line, add:

```ts
    "ambientes.clientsHeading": "Clientes",
    "ambientes.clientName": "Nome do cliente",
    "ambientes.addClient": "Adicionar cliente",
    "ambientes.clientNameRequired": "Nome do cliente é obrigatório",
    "ambientes.addClientFailed": "Não foi possível adicionar este cliente",
```

- [ ] **Step 2: Add the English keys**

In the `"en"` block, right after `"ambientes.displayName": "Display name",`, add:

```ts
    "ambientes.clientsHeading": "Clients",
    "ambientes.clientName": "Client name",
    "ambientes.addClient": "Add client",
    "ambientes.clientNameRequired": "Client name is required",
    "ambientes.addClientFailed": "Could not add this client",
```

- [ ] **Step 3: Add the Spanish keys**

In the `"es"` block, right after `"ambientes.displayName": "Nombre visible",`, add:

```ts
    "ambientes.clientsHeading": "Clientes",
    "ambientes.clientName": "Nombre del cliente",
    "ambientes.addClient": "Agregar cliente",
    "ambientes.clientNameRequired": "El nombre del cliente es obligatorio",
    "ambientes.addClientFailed": "No se pudo agregar este cliente",
```

- [ ] **Step 4: Run the existing dictionary test**

Run: `npm test -- tests/lib/i18n/dictionaries.test.ts`
Expected: PASS (unchanged — this only proves the file still parses/exports correctly).

- [ ] **Step 5: Commit**

```bash
git add src/lib/i18n/dictionaries.ts
git commit -m "feat: add client-management i18n strings"
```

---

## Task 5: `ClientSwitcher` component

**Files:**
- Create: `src/components/ClientSwitcher.tsx`

**Interfaces:**
- Consumes: `setActiveClient` from `@/app/ambientes/actions` (Task 3).
- Produces: `<ClientSwitcher myAccountId activeClientId myAccountLabel managedClients />` — consumed by Tasks 6-7.

- [ ] **Step 1: Create the component**

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { setActiveClient } from "@/app/ambientes/actions";

interface ManagedClient {
  id: string;
  name: string;
}

export function ClientSwitcher({
  myAccountId,
  myAccountLabel,
  activeClientId,
  managedClients,
}: {
  myAccountId: string;
  myAccountLabel: string;
  activeClientId: string;
  managedClients: ManagedClient[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const nextId = event.target.value;
    startTransition(async () => {
      await setActiveClient(nextId);
      router.refresh();
    });
  }

  return (
    <select
      value={activeClientId}
      onChange={handleChange}
      disabled={isPending}
      className="rounded border border-gray-300 px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-800"
    >
      <option value={myAccountId}>{myAccountLabel}</option>
      {managedClients.map((client) => (
        <option key={client.id} value={client.id}>
          {client.name}
        </option>
      ))}
    </select>
  );
}
```

This component has no automated test — it's pure UI wiring around already-tested logic (`setActiveClient`, verified in Task 3), consistent with this project's existing precedent of verifying interactive components manually/by screenshot (see the 2026-09-11 dashboard-redesign spec's testing sections).

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no new type errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/ClientSwitcher.tsx
git commit -m "feat: add ClientSwitcher component"
```

---

## Task 6: Wire the switcher into the Dashboard

**Files:**
- Modify: `src/app/dashboard/page.tsx` (full file, currently 57 lines)
- Modify: `src/components/dashboard/DashboardClient.tsx:1-10` (imports), `:29-41` (props), `:78-94` (header JSX)

**Interfaces:**
- Consumes: `getOperatorCustomerId`, `getManagedClients` from `@/lib/tenant` (Task 2); `ClientSwitcher` (Task 5).

- [ ] **Step 1: Update `src/app/dashboard/page.tsx`**

Replace the whole file:

```tsx
import { prisma } from "@/lib/prisma";
import { requireCustomerId, getOperatorCustomerId, getManagedClients } from "@/lib/tenant";
import { auth } from "@/auth";
import { computeDashboardSummary } from "@/lib/dashboard-summary";
import { DashboardClient } from "@/components/dashboard/DashboardClient";

export default async function DashboardPage() {
  const customerId = await requireCustomerId();
  const operatorCustomerId = await getOperatorCustomerId();
  const session = await auth();
  const managedClients = await getManagedClients(operatorCustomerId);

  const findings = await prisma.wasteFinding.findMany({
    where: { subscription: { customerId }, status: "OPEN" },
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
      operatorCustomerId={operatorCustomerId}
      activeClientId={customerId}
      managedClients={managedClients}
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

- [ ] **Step 2: Add the import and extend the props interface in `DashboardClient.tsx`**

At the top of `src/components/dashboard/DashboardClient.tsx`, add to the import block (after the `signOutAction` import):

```tsx
import { ClientSwitcher } from "@/components/ClientSwitcher";
```

Change the component's props destructuring and type from:

```tsx
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
```

to:

```tsx
export function DashboardClient({
  userLabel,
  operatorCustomerId,
  activeClientId,
  managedClients,
  summary,
  activeResourceCount,
  findings,
  subscriptions,
}: {
  userLabel: string;
  operatorCustomerId: string;
  activeClientId: string;
  managedClients: { id: string; name: string }[];
  summary: { openFindingsCount: number; totalEstimatedMonthlySavings: number };
  activeResourceCount: number;
  findings: FindingRow[];
  subscriptions: SubscriptionOption[];
}) {
```

- [ ] **Step 3: Render the switcher in the header**

In the header's right-hand `<div className="flex items-center gap-3 text-sm">`, right before the existing `<span>{userLabel}</span>`, add the switcher:

```tsx
        <div className="flex items-center gap-3 text-sm">
          <ClientSwitcher
            myAccountId={operatorCustomerId}
            myAccountLabel={userLabel}
            activeClientId={activeClientId}
            managedClients={managedClients}
          />
          <span>{userLabel}</span>
```

- [ ] **Step 4: Verify it compiles and the app renders**

Run: `npx tsc --noEmit`
Expected: no new type errors.

Run: `npm run dev`, sign in, visit `/dashboard`.
Expected: the header shows a dropdown with your own name as the only option (no managed clients yet) — same dashboard content as before otherwise.

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboard/page.tsx src/components/dashboard/DashboardClient.tsx
git commit -m "feat: show ClientSwitcher on the dashboard"
```

---

## Task 7: "Adicionar cliente" + switcher on Ambientes

**Files:**
- Modify: `src/app/ambientes/page.tsx` (full file, currently 30 lines)
- Modify: `src/components/ambientes/AmbientesClient.tsx` (full file, currently 213 lines)

**Interfaces:**
- Consumes: `getOperatorCustomerId`, `getManagedClients` from `@/lib/tenant` (Task 2); `addManagedClient` from `@/app/ambientes/actions` (Task 3); `ClientSwitcher` (Task 5); i18n keys from Task 4.

- [ ] **Step 1: Update `src/app/ambientes/page.tsx`**

Replace the whole file:

```tsx
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { requireCustomerId, getOperatorCustomerId, getManagedClients } from "@/lib/tenant";
import { AmbientesClient } from "@/components/ambientes/AmbientesClient";

export default async function AmbientesPage() {
  const customerId = await requireCustomerId();
  const operatorCustomerId = await getOperatorCustomerId();
  const session = await auth();
  const managedClients = await getManagedClients(operatorCustomerId);

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
      operatorCustomerId={operatorCustomerId}
      operatorLabel={session?.user?.name ?? session?.user?.email ?? ""}
      activeClientId={customerId}
      initialManagedClients={managedClients}
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

- [ ] **Step 2: Update imports and props in `AmbientesClient.tsx`**

Change the top of the file from:

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
```

to:

```tsx
"use client";

import { useState } from "react";
import { useLocale } from "@/lib/i18n/LocaleProvider";
import { isValidSubscriptionId } from "@/lib/ambientes/validateSubscriptionId";
import { addManagedClient } from "@/app/ambientes/actions";
import { ClientSwitcher } from "@/components/ClientSwitcher";

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

interface ManagedClient {
  id: string;
  name: string;
}

export function AmbientesClient({
  operatorCustomerId,
  operatorLabel,
  activeClientId,
  initialManagedClients,
  initialSubscriptions,
}: {
  operatorCustomerId: string;
  operatorLabel: string;
  activeClientId: string;
  initialManagedClients: ManagedClient[];
  initialSubscriptions: AmbienteRow[];
}) {
  const { t } = useLocale();
  const [managedClients, setManagedClients] = useState(initialManagedClients);
  const [newClientName, setNewClientName] = useState("");
  const [clientFormError, setClientFormError] = useState<string | null>(null);
  const [subscriptions, setSubscriptions] = useState(initialSubscriptions);
```

Everything else already inside the function body (`azureSubscriptionId`, `displayName`, `formError`, `connectLinkBySubscription`, `verifyMessageBySubscription`, `handleAddEnvironment`, `handleShowDeployLink`, `handleVerify`) stays exactly as-is — do not modify those.

- [ ] **Step 3: Add the `handleAddClient` handler**

Right before the existing `return (` in the component, add:

```tsx
  async function handleAddClient(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = newClientName.trim();
    if (!trimmed) {
      setClientFormError(t("ambientes.clientNameRequired"));
      return;
    }
    setClientFormError(null);
    try {
      const created = await addManagedClient(trimmed);
      setManagedClients((current) =>
        [...current, created].sort((a, b) => a.name.localeCompare(b.name)),
      );
      setNewClientName("");
    } catch {
      setClientFormError(t("ambientes.addClientFailed"));
    }
  }

```

- [ ] **Step 4: Add the header and "Adicionar cliente" section to the JSX**

Change the start of the returned JSX from:

```tsx
  return (
    <main className="p-6">
      <h1 className="text-2xl font-bold mb-4">{t("ambientes.title")}</h1>
```

to:

```tsx
  return (
    <main className="p-6">
      <header className="mb-6 flex items-center justify-between">
        <span className="text-lg font-bold">Cloud Waste Hunter</span>
        <ClientSwitcher
          myAccountId={operatorCustomerId}
          myAccountLabel={operatorLabel}
          activeClientId={activeClientId}
          managedClients={managedClients}
        />
      </header>

      <section className="mb-8">
        <h2 className="mb-2 text-lg font-semibold">{t("ambientes.clientsHeading")}</h2>
        <form onSubmit={handleAddClient} className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-sm mb-1" htmlFor="clientName">
              {t("ambientes.clientName")}
            </label>
            <input
              id="clientName"
              className="border rounded px-3 py-2"
              value={newClientName}
              onChange={(e) => setNewClientName(e.target.value)}
            />
          </div>
          <button
            type="submit"
            className="bg-blue-600 text-white rounded px-4 py-2 hover:bg-blue-700"
          >
            {t("ambientes.addClient")}
          </button>
          {clientFormError && <p className="text-red-600 text-sm">{clientFormError}</p>}
        </form>
      </section>

      <h1 className="text-2xl font-bold mb-4">{t("ambientes.title")}</h1>
```

Everything after that (`<form onSubmit={handleAddEnvironment}...` through the closing `</main>`) stays exactly as-is.

- [ ] **Step 5: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no new type errors.

- [ ] **Step 6: Manual end-to-end verification**

Run: `npm run dev`, sign in, visit `/ambientes`.
Expected:
1. The header shows the switcher with only your own name (no clients yet).
2. Type a name in "Nome do cliente", click "Adicionar cliente" — it appears in the switcher immediately (no page reload).
3. Select the new client in the switcher — the page reloads (via `router.refresh()`), the environments list is now empty (a brand-new client has no subscriptions).
4. Add a subscription via the existing "Adicionar ambiente" form while that client is active — it appears in the list.
5. Switch back to your own name in the switcher — that subscription no longer appears (it belongs to the client, not to you).
6. Visit `/dashboard` while the client is still active — confirm the header's switcher shows the same selection and the dashboard reflects the client's (empty) data, not your own.

- [ ] **Step 7: Commit**

```bash
git add src/app/ambientes/page.tsx src/components/ambientes/AmbientesClient.tsx
git commit -m "feat: add client creation and switching to Ambientes"
```

---

## Manual Validation Summary

After all tasks: run `npm test` (full suite) and `npx tsc --noEmit` once more, then repeat Task 7 Step 6's walkthrough end-to-end as the final sign-off, confirming isolation holds (a client's data is never visible while a different client — or "Minha conta" — is active) and that nothing in the existing dashboard/ambientes/scanner flows regressed.
