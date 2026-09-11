# Cloud Waste Hunter — Fase 1 (Core) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a multi-tenant Next.js app that lets a customer connect their Azure subscriptions via Azure Lighthouse, runs a scheduled scanner that detects four categories of Azure waste via Resource Graph, estimates their monthly cost via Cost Management, and shows them in a read-only dashboard.

**Architecture:** A single Next.js (App Router, TypeScript) app serves both the dashboard UI and the onboarding/API routes, backed by Postgres via Prisma. A separate scanner entrypoint (`scripts/scanner/run.ts`) shares the same `src/lib` code and runs as a scheduled Azure Container Apps Job. All Azure Resource Manager calls go through one authenticated-fetch helper using `DefaultAzureCredential`, so the same code path that runs locally against a real Azure subscription in production runs under the Lighthouse-delegated identity.

**Tech Stack:** Next.js 15 (App Router) + TypeScript, Auth.js v5 (Microsoft Entra ID provider, multi-tenant), Prisma + PostgreSQL, `@azure/identity`, native `fetch` against Azure Resource Manager REST endpoints, Vitest, Bicep, Azure Container Apps (web + scheduled Job), Azure Database for PostgreSQL Flexible Server, Azure Key Vault.

**Spec:** `docs/superpowers/specs/2026-09-11-cloud-waste-hunter-core-design.md`

## Global Constraints

- Node.js >= 20, npm as package manager, TypeScript strict mode, Next.js App Router only (no Pages Router).
- Every read/write of business data goes through a customer-scoped helper (`requireCustomerId()` + a `where: { customerId }` or `where: { subscription: { customerId } }` filter). No unscoped query on `Customer`-owned data outside the auth bootstrap code.
- No Azure credentials for a customer subscription are ever stored. All access to customer subscriptions happens through the Azure Lighthouse-delegated identity, requesting only the **Reader** role in this phase.
- TDD for all business logic: waste rules, tenant scoping, the scanner, and API routes get a failing test before the implementation.
- Only these four waste rules exist in this phase: orphaned disks, unassociated public IPs, snapshots older than 30 days, idle VPN gateways. No Azure Monitor integration and no Cost Management export pipeline in this phase — cost is estimated via a single Cost Management Query API call per finding.
- No remediation actions (delete, resize, shutdown) exist in this phase. The only mutation exposed to users is dismissing a finding.

---

## Task 1: Project scaffolding

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `vitest.config.ts`, `.gitignore`, `.env.example`
- Create: `src/app/layout.tsx`, `src/app/page.tsx`
- Create: `tests/setup.ts`, `tests/sanity.test.ts`

**Interfaces:**
- Produces: an `npm test` command that runs Vitest, and an `@/*` → `src/*` import alias every later task relies on.

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "cloud-waste-hunter",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint .",
    "test": "vitest run",
    "test:watch": "vitest",
    "scanner": "tsx scripts/scanner/run.ts",
    "prisma:migrate": "prisma migrate dev",
    "prisma:generate": "prisma generate"
  },
  "dependencies": {
    "next": "^15.0.3",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "next-auth": "5.0.0-beta.25",
    "@prisma/client": "^5.22.0",
    "@azure/identity": "^4.4.1"
  },
  "devDependencies": {
    "typescript": "^5.6.3",
    "@types/node": "^22.9.0",
    "@types/react": "^19.0.1",
    "@types/react-dom": "^19.0.1",
    "eslint": "^9.14.0",
    "eslint-config-next": "^15.0.3",
    "prisma": "^5.22.0",
    "vitest": "^2.1.4",
    "vite-tsconfig-paths": "^5.1.0",
    "tsx": "^4.19.2",
    "dotenv": "^16.4.5"
  }
}
```

- [ ] **Step 2: Install dependencies**

Run: `npm install`

- [ ] **Step 3: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "baseUrl": ".",
    "paths": { "@/*": ["src/*"] },
    "plugins": [{ "name": "next" }]
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 4: Write `next.config.ts`**

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {};

export default nextConfig;
```

- [ ] **Step 5: Write the minimal App Router shell**

`src/app/layout.tsx`:

```tsx
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

`src/app/page.tsx`:

```tsx
export default function HomePage() {
  return <p>Cloud Waste Hunter</p>;
}
```

- [ ] **Step 6: Write `vitest.config.ts` and `tests/setup.ts`**

`vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
  },
});
```

`tests/setup.ts`:

```ts
import { config } from "dotenv";

config({ path: ".env.test" });
```

- [ ] **Step 7: Write a sanity test**

`tests/sanity.test.ts`:

```ts
import { describe, expect, it } from "vitest";

describe("toolchain sanity check", () => {
  it("runs a basic assertion", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 8: Run the test suite to confirm the toolchain works**

Run: `npm test`
Expected: 1 passed (`toolchain sanity check`)

- [ ] **Step 9: Write `.gitignore` and `.env.example`**

`.gitignore`:

```
node_modules
.next
.env
.env.test
*.local
```

`.env.example`:

```
DATABASE_URL="postgresql://cwh:cwh@localhost:5433/cloud_waste_hunter"
AUTH_MICROSOFT_ENTRA_ID_ID=""
AUTH_MICROSOFT_ENTRA_ID_SECRET=""
AUTH_SECRET=""
LIGHTHOUSE_PROVIDER_PRINCIPAL_ID=""
LIGHTHOUSE_PROVIDER_TENANT_ID=""
```

- [ ] **Step 10: Commit**

```bash
git add package.json tsconfig.json next.config.ts vitest.config.ts .gitignore .env.example src tests
git commit -m "chore: scaffold Next.js + Vitest project"
```

---

## Task 2: Database — Postgres, Prisma schema, test helpers

**Files:**
- Create: `docker-compose.yml`
- Create: `prisma/schema.prisma`
- Create: `src/lib/prisma.ts`
- Create: `tests/helpers/resetDb.ts`
- Create: `.env`, `.env.test` (local only, not committed)

**Interfaces:**
- Produces: `prisma` singleton (`src/lib/prisma.ts`) and the full Prisma schema (`Customer`, `User`, `Subscription`, `ScanRun`, `Resource`, `WasteFinding`, enums `SubscriptionStatus`, `ScanStatus`, `WasteRuleType`, `FindingStatus`) that every later task depends on. Also produces `resetDb()` used by every test that touches the database.

- [ ] **Step 1: Write `docker-compose.yml`**

```yaml
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_USER: cwh
      POSTGRES_PASSWORD: cwh
      POSTGRES_DB: cloud_waste_hunter
    ports:
      - "5433:5432"
    volumes:
      - cwh-postgres-data:/var/lib/postgresql/data

volumes:
  cwh-postgres-data:
```

- [ ] **Step 2: Start Postgres and create the databases**

Run: `docker compose up -d`
Run: `docker compose exec postgres psql -U cwh -d cloud_waste_hunter -c "CREATE DATABASE cloud_waste_hunter_test;"`

- [ ] **Step 3: Write `.env` and `.env.test`** (not committed — already in `.gitignore`)

`.env`:

```
DATABASE_URL="postgresql://cwh:cwh@localhost:5433/cloud_waste_hunter"
```

`.env.test`:

```
DATABASE_URL="postgresql://cwh:cwh@localhost:5433/cloud_waste_hunter_test"
```

- [ ] **Step 4: Write `prisma/schema.prisma`**

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Customer {
  id            String         @id @default(cuid())
  entraTenantId String         @unique
  name          String
  createdAt     DateTime       @default(now())
  users         User[]
  subscriptions Subscription[]
}

model User {
  id            String   @id @default(cuid())
  customerId    String
  customer      Customer @relation(fields: [customerId], references: [id])
  entraObjectId String   @unique
  email         String
  role          String   @default("member")
  createdAt     DateTime @default(now())
}

enum SubscriptionStatus {
  PENDING
  CONNECTED
  ERROR
}

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
}

enum ScanStatus {
  RUNNING
  SUCCEEDED
  FAILED
}

model ScanRun {
  id             String       @id @default(cuid())
  subscriptionId String
  subscription   Subscription @relation(fields: [subscriptionId], references: [id])
  startedAt      DateTime     @default(now())
  finishedAt     DateTime?
  status         ScanStatus   @default(RUNNING)
  resources      Resource[]
}

model Resource {
  id             String       @id @default(cuid())
  subscriptionId String
  subscription   Subscription @relation(fields: [subscriptionId], references: [id])
  scanRunId      String
  scanRun        ScanRun      @relation(fields: [scanRunId], references: [id])
  resourceId     String
  type           String
  rawProperties  Json
  createdAt      DateTime     @default(now())
}

enum WasteRuleType {
  ORPHANED_DISK
  UNASSOCIATED_PUBLIC_IP
  OLD_SNAPSHOT
  IDLE_VPN_GATEWAY
}

enum FindingStatus {
  OPEN
  DISMISSED
}

model WasteFinding {
  id                   String        @id @default(cuid())
  subscriptionId       String
  subscription         Subscription  @relation(fields: [subscriptionId], references: [id])
  ruleType             WasteRuleType
  resourceId           String
  estimatedMonthlyCost Float
  detectedAt           DateTime      @default(now())
  status               FindingStatus @default(OPEN)

  @@unique([subscriptionId, resourceId, ruleType])
}
```

- [ ] **Step 5: Run the initial migration against the dev database**

Run: `npx prisma migrate dev --name init`
Expected: migration applied, Prisma Client generated.

- [ ] **Step 6: Apply the same migration to the test database**

Run: `dotenv -e .env.test -- npx prisma migrate deploy`

(If `dotenv-cli` is not installed, run `npm install --save-dev dotenv-cli` first.)

- [ ] **Step 7: Write the Prisma singleton**

`src/lib/prisma.ts`:

```ts
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
```

- [ ] **Step 8: Write the shared test DB reset helper**

`tests/helpers/resetDb.ts`:

```ts
import { prisma } from "@/lib/prisma";

export async function resetDb(): Promise<void> {
  await prisma.wasteFinding.deleteMany();
  await prisma.resource.deleteMany();
  await prisma.scanRun.deleteMany();
  await prisma.subscription.deleteMany();
  await prisma.user.deleteMany();
  await prisma.customer.deleteMany();
}
```

- [ ] **Step 9: Write and run a test proving the schema and reset helper work**

`tests/lib/prisma.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { resetDb } from "../helpers/resetDb";

describe("prisma schema", () => {
  beforeEach(resetDb);

  it("creates a customer with a subscription", async () => {
    const customer = await prisma.customer.create({
      data: {
        entraTenantId: "tenant-1",
        name: "Acme",
        subscriptions: {
          create: {
            azureSubscriptionId: "sub-1",
            displayName: "Acme Prod",
          },
        },
      },
      include: { subscriptions: true },
    });

    expect(customer.subscriptions).toHaveLength(1);
    expect(customer.subscriptions[0].status).toBe("PENDING");
  });
});
```

Run: `npm test`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add docker-compose.yml prisma src/lib/prisma.ts tests/helpers/resetDb.ts tests/lib/prisma.test.ts
git commit -m "feat: add Postgres/Prisma schema and test DB helpers"
```

---

## Task 3: Multi-tenant login — Auth.js + customer bootstrap

**Files:**
- Create: `src/lib/customer-bootstrap.ts`
- Create: `src/auth.ts`
- Create: `src/app/api/auth/[...nextauth]/route.ts`
- Create: `src/types/next-auth.d.ts`
- Test: `tests/lib/customer-bootstrap.test.ts`

**Interfaces:**
- Consumes: `prisma` from Task 2.
- Produces: `getOrCreateCustomerForTenant(entraTenantId: string, fallbackName: string): Promise<Customer>`, `auth()` / `handlers` from `src/auth.ts`, and a `session.customerId: string | undefined` field every later API route/page reads via `requireCustomerId()` (Task 4).

- [ ] **Step 1: Write the failing test for customer bootstrap**

`tests/lib/customer-bootstrap.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { getOrCreateCustomerForTenant } from "@/lib/customer-bootstrap";
import { resetDb } from "../helpers/resetDb";

describe("getOrCreateCustomerForTenant", () => {
  beforeEach(resetDb);

  it("creates a new customer on first call for a tenant", async () => {
    const customer = await getOrCreateCustomerForTenant("tenant-a", "Acme Corp");
    expect(customer.entraTenantId).toBe("tenant-a");
    expect(customer.name).toBe("Acme Corp");
  });

  it("returns the existing customer on subsequent calls for the same tenant", async () => {
    const first = await getOrCreateCustomerForTenant("tenant-a", "Acme Corp");
    const second = await getOrCreateCustomerForTenant("tenant-a", "Different Name");
    expect(second.id).toBe(first.id);
    expect(second.name).toBe("Acme Corp");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- customer-bootstrap`
Expected: FAIL with "Cannot find module '@/lib/customer-bootstrap'"

- [ ] **Step 3: Implement `getOrCreateCustomerForTenant`**

`src/lib/customer-bootstrap.ts`:

```ts
import type { Customer } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export async function getOrCreateCustomerForTenant(
  entraTenantId: string,
  fallbackName: string,
): Promise<Customer> {
  const existing = await prisma.customer.findUnique({
    where: { entraTenantId },
  });
  if (existing) {
    return existing;
  }

  try {
    return await prisma.customer.create({
      data: { entraTenantId, name: fallbackName },
    });
  } catch (error) {
    const raceWinner = await prisma.customer.findUnique({
      where: { entraTenantId },
    });
    if (raceWinner) {
      return raceWinner;
    }
    throw error;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- customer-bootstrap`
Expected: PASS (2 tests)

- [ ] **Step 5: Add the NextAuth session type augmentation**

`src/types/next-auth.d.ts`:

```ts
import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface Session {
    customerId?: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    customerId?: string;
  }
}
```

- [ ] **Step 6: Configure Auth.js with the multi-tenant Entra ID provider**

`src/auth.ts`:

```ts
import NextAuth from "next-auth";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import { getOrCreateCustomerForTenant } from "@/lib/customer-bootstrap";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    MicrosoftEntraID({
      clientId: process.env.AUTH_MICROSOFT_ENTRA_ID_ID!,
      clientSecret: process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET!,
      issuer: "https://login.microsoftonline.com/organizations/v2.0",
    }),
  ],
  callbacks: {
    async jwt({ token, profile }) {
      if (profile?.tid && typeof profile.tid === "string") {
        const customer = await getOrCreateCustomerForTenant(
          profile.tid,
          (profile.name as string | undefined) ?? profile.tid,
        );
        token.customerId = customer.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (typeof token.customerId === "string") {
        session.customerId = token.customerId;
      }
      return session;
    },
  },
});
```

- [ ] **Step 7: Wire the route handler**

`src/app/api/auth/[...nextauth]/route.ts`:

```ts
import { handlers } from "@/auth";

export const { GET, POST } = handlers;
```

- [ ] **Step 8: Add the two Entra ID env vars to `.env.example`** (already present from Task 1 — confirm `AUTH_MICROSOFT_ENTRA_ID_ID`, `AUTH_MICROSOFT_ENTRA_ID_SECRET`, `AUTH_SECRET` are listed)

- [ ] **Step 9: Run the full test suite**

Run: `npm test`
Expected: all PASS

- [ ] **Step 10: Commit**

```bash
git add src/lib/customer-bootstrap.ts src/auth.ts src/app/api/auth src/types tests/lib/customer-bootstrap.test.ts
git commit -m "feat: multi-tenant Entra ID login with customer bootstrap"
```

---

## Task 4: Tenant-scoped data access helper

**Files:**
- Create: `src/lib/tenant.ts`
- Create: `src/lib/findings.ts`
- Test: `tests/lib/findings.test.ts`

**Interfaces:**
- Consumes: `auth()` from Task 3, `prisma` from Task 2.
- Produces: `requireCustomerId(): Promise<string>`, `UnauthenticatedError`, `listFindingsForCurrentCustomer(): Promise<WasteFinding[]>` — the pattern every later API route/page copies for tenant scoping.

- [ ] **Step 1: Write the failing isolation test**

`tests/lib/findings.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { resetDb } from "../helpers/resetDb";

vi.mock("@/auth", () => ({
  auth: vi.fn(),
}));

import { auth } from "@/auth";
import { listFindingsForCurrentCustomer } from "@/lib/findings";

async function seedCustomerWithFinding(tenantId: string, resourceId: string) {
  const customer = await prisma.customer.create({
    data: { entraTenantId: tenantId, name: tenantId },
  });
  const subscription = await prisma.subscription.create({
    data: {
      customerId: customer.id,
      azureSubscriptionId: `${tenantId}-sub`,
      displayName: `${tenantId} sub`,
    },
  });
  await prisma.wasteFinding.create({
    data: {
      subscriptionId: subscription.id,
      ruleType: "ORPHANED_DISK",
      resourceId,
      estimatedMonthlyCost: 12.5,
    },
  });
  return customer;
}

describe("listFindingsForCurrentCustomer", () => {
  beforeEach(resetDb);

  it("only returns findings belonging to the logged-in customer's subscriptions", async () => {
    const customerA = await seedCustomerWithFinding("tenant-a", "disk-a");
    await seedCustomerWithFinding("tenant-b", "disk-b");

    vi.mocked(auth).mockResolvedValue({
      customerId: customerA.id,
    } as never);

    const findings = await listFindingsForCurrentCustomer();

    expect(findings).toHaveLength(1);
    expect(findings[0].resourceId).toBe("disk-a");
  });

  it("throws when there is no authenticated session", async () => {
    vi.mocked(auth).mockResolvedValue(null);

    await expect(listFindingsForCurrentCustomer()).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- findings`
Expected: FAIL with "Cannot find module '@/lib/tenant'" or `'@/lib/findings'`

- [ ] **Step 3: Implement the tenant helper**

`src/lib/tenant.ts`:

```ts
import { auth } from "@/auth";

export class UnauthenticatedError extends Error {
  constructor() {
    super("No authenticated customer in session");
  }
}

export async function requireCustomerId(): Promise<string> {
  const session = await auth();
  if (!session?.customerId) {
    throw new UnauthenticatedError();
  }
  return session.customerId;
}
```

- [ ] **Step 4: Implement the scoped findings repository function**

`src/lib/findings.ts`:

```ts
import type { WasteFinding } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireCustomerId } from "@/lib/tenant";

export async function listFindingsForCurrentCustomer(): Promise<WasteFinding[]> {
  const customerId = await requireCustomerId();
  return prisma.wasteFinding.findMany({
    where: { subscription: { customerId } },
    orderBy: { detectedAt: "desc" },
  });
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- findings`
Expected: PASS (2 tests)

- [ ] **Step 6: Commit**

```bash
git add src/lib/tenant.ts src/lib/findings.ts tests/lib/findings.test.ts
git commit -m "feat: tenant-scoped data access helper with isolation test"
```

---

## Task 5: Azure REST client helper + Resource Graph query

**Files:**
- Create: `src/lib/azure/credential.ts`
- Create: `src/lib/azure/armFetch.ts`
- Create: `src/lib/azure/resourceGraph.ts`
- Test: `tests/lib/azure/armFetch.test.ts`
- Test: `tests/lib/azure/resourceGraph.test.ts`

**Interfaces:**
- Produces: `armFetch<T>(url: string, init?: RequestInit): Promise<T>` and `queryResourceGraph(subscriptionIds: string[], query: string): Promise<ResourceGraphRow[]>` with `ResourceGraphRow { id, type, subscriptionId, properties }` — the shape every waste rule (Tasks 6-9) and the scanner (Task 11) consume.

- [ ] **Step 1: Write the failing test for `armFetch`**

`tests/lib/azure/armFetch.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as credential from "@/lib/azure/credential";
import { armFetch } from "@/lib/azure/armFetch";

describe("armFetch", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("attaches a bearer token and returns parsed JSON on success", async () => {
    vi.spyOn(credential, "getArmAccessToken").mockResolvedValue("fake-token");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ hello: "world" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await armFetch<{ hello: string }>("https://example.test/api");

    expect(result).toEqual({ hello: "world" });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.test/api",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer fake-token" }),
      }),
    );
  });

  it("throws when the response is not ok", async () => {
    vi.spyOn(credential, "getArmAccessToken").mockResolvedValue("fake-token");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        text: async () => "Forbidden",
      }),
    );

    await expect(armFetch("https://example.test/api")).rejects.toThrow(/403/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- armFetch`
Expected: FAIL with "Cannot find module '@/lib/azure/credential'"

- [ ] **Step 3: Implement the credential helper**

`src/lib/azure/credential.ts`:

```ts
import { DefaultAzureCredential } from "@azure/identity";

const ARM_SCOPE = "https://management.azure.com/.default";

let cachedCredential: DefaultAzureCredential | undefined;

function getCredential(): DefaultAzureCredential {
  if (!cachedCredential) {
    cachedCredential = new DefaultAzureCredential();
  }
  return cachedCredential;
}

export async function getArmAccessToken(): Promise<string> {
  const token = await getCredential().getToken(ARM_SCOPE);
  if (!token) {
    throw new Error("Failed to acquire an Azure Resource Manager access token");
  }
  return token.token;
}
```

- [ ] **Step 4: Implement `armFetch`**

`src/lib/azure/armFetch.ts`:

```ts
import { getArmAccessToken } from "@/lib/azure/credential";

export async function armFetch<T>(
  url: string,
  init: RequestInit = {},
): Promise<T> {
  const token = await getArmAccessToken();
  const response = await fetch(url, {
    ...init,
    headers: {
      ...init.headers,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Azure ARM request to ${url} failed with ${response.status}: ${body}`,
    );
  }
  return (await response.json()) as T;
}
```

- [ ] **Step 5: Run to verify `armFetch` tests pass**

Run: `npm test -- armFetch`
Expected: PASS (2 tests)

- [ ] **Step 6: Write the failing test for `queryResourceGraph`**

`tests/lib/azure/resourceGraph.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as armFetchModule from "@/lib/azure/armFetch";
import { queryResourceGraph } from "@/lib/azure/resourceGraph";

describe("queryResourceGraph", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("sends the subscriptions and query, and returns the rows", async () => {
    const armFetchSpy = vi.spyOn(armFetchModule, "armFetch").mockResolvedValue({
      data: [
        { id: "disk-1", type: "microsoft.compute/disks", subscriptionId: "sub-1", properties: {} },
      ],
    });

    const rows = await queryResourceGraph(["sub-1"], "Resources | where type == 'x'");

    expect(rows).toHaveLength(1);
    expect(armFetchSpy).toHaveBeenCalledWith(
      expect.stringContaining("Microsoft.ResourceGraph/resources"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          subscriptions: ["sub-1"],
          query: "Resources | where type == 'x'",
          options: undefined,
        }),
      }),
    );
  });

  it("follows the $skipToken across pages", async () => {
    const armFetchSpy = vi
      .spyOn(armFetchModule, "armFetch")
      .mockResolvedValueOnce({
        data: [{ id: "page-1", type: "t", subscriptionId: "sub-1", properties: {} }],
        $skipToken: "token-2",
      })
      .mockResolvedValueOnce({
        data: [{ id: "page-2", type: "t", subscriptionId: "sub-1", properties: {} }],
      });

    const rows = await queryResourceGraph(["sub-1"], "Resources");

    expect(rows.map((r) => r.id)).toEqual(["page-1", "page-2"]);
    expect(armFetchSpy).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 7: Run to verify it fails**

Run: `npm test -- resourceGraph`
Expected: FAIL with "Cannot find module '@/lib/azure/resourceGraph'"

- [ ] **Step 8: Implement `queryResourceGraph`**

`src/lib/azure/resourceGraph.ts`:

```ts
import { armFetch } from "@/lib/azure/armFetch";

export interface ResourceGraphRow {
  id: string;
  type: string;
  subscriptionId: string;
  properties: Record<string, unknown>;
}

interface ResourceGraphResponse {
  data: ResourceGraphRow[];
  $skipToken?: string;
}

const RESOURCE_GRAPH_URL =
  "https://management.azure.com/providers/Microsoft.ResourceGraph/resources?api-version=2022-10-01";

export async function queryResourceGraph(
  subscriptionIds: string[],
  query: string,
): Promise<ResourceGraphRow[]> {
  const rows: ResourceGraphRow[] = [];
  let skipToken: string | undefined;

  do {
    const response = await armFetch<ResourceGraphResponse>(RESOURCE_GRAPH_URL, {
      method: "POST",
      body: JSON.stringify({
        subscriptions: subscriptionIds,
        query,
        options: skipToken ? { $skipToken: skipToken } : undefined,
      }),
    });
    rows.push(...response.data);
    skipToken = response.$skipToken;
  } while (skipToken);

  return rows;
}
```

- [ ] **Step 9: Run to verify it passes**

Run: `npm test -- resourceGraph`
Expected: PASS (2 tests)

- [ ] **Step 10: Commit**

```bash
git add src/lib/azure/credential.ts src/lib/azure/armFetch.ts src/lib/azure/resourceGraph.ts tests/lib/azure
git commit -m "feat: authenticated ARM fetch helper and Resource Graph client"
```

---

## Task 6: Waste rule — orphaned disks

**Files:**
- Create: `src/lib/waste-rules/types.ts`
- Create: `src/lib/waste-rules/orphanedDisks.ts`
- Test: `tests/lib/waste-rules/orphanedDisks.test.ts`

**Interfaces:**
- Consumes: `ResourceGraphRow` from Task 5.
- Produces: `WasteFindingCandidate { ruleType, resourceId, subscriptionId }`, `WasteRule` type, and `findOrphanedDisks(resources: ResourceGraphRow[]): WasteFindingCandidate[]` — Tasks 7-9 follow the exact same shape.

- [ ] **Step 1: Write the shared waste-rule types**

`src/lib/waste-rules/types.ts`:

```ts
import type { WasteRuleType } from "@prisma/client";
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";

export interface WasteFindingCandidate {
  ruleType: WasteRuleType;
  resourceId: string;
  subscriptionId: string;
}

export type WasteRule = (resources: ResourceGraphRow[]) => WasteFindingCandidate[];
```

- [ ] **Step 2: Write the failing test**

`tests/lib/waste-rules/orphanedDisks.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import { findOrphanedDisks } from "@/lib/waste-rules/orphanedDisks";

describe("findOrphanedDisks", () => {
  it("returns disks with diskState Unattached", () => {
    const disk: ResourceGraphRow = {
      id: "/subscriptions/sub-1/resourceGroups/rg1/providers/Microsoft.Compute/disks/disk-unattached",
      type: "microsoft.compute/disks",
      subscriptionId: "sub-1",
      properties: { diskState: "Unattached" },
    };

    expect(findOrphanedDisks([disk])).toEqual([
      { ruleType: "ORPHANED_DISK", resourceId: disk.id, subscriptionId: "sub-1" },
    ]);
  });

  it("ignores attached disks and other resource types", () => {
    const attachedDisk: ResourceGraphRow = {
      id: "disk-attached",
      type: "microsoft.compute/disks",
      subscriptionId: "sub-1",
      properties: { diskState: "Attached" },
    };
    const unrelated: ResourceGraphRow = {
      id: "ip-1",
      type: "microsoft.network/publicipaddresses",
      subscriptionId: "sub-1",
      properties: {},
    };

    expect(findOrphanedDisks([attachedDisk, unrelated])).toEqual([]);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npm test -- orphanedDisks`
Expected: FAIL with "Cannot find module '@/lib/waste-rules/orphanedDisks'"

- [ ] **Step 4: Implement the rule**

`src/lib/waste-rules/orphanedDisks.ts`:

```ts
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import type { WasteFindingCandidate } from "@/lib/waste-rules/types";

export function findOrphanedDisks(
  resources: ResourceGraphRow[],
): WasteFindingCandidate[] {
  return resources
    .filter(
      (r) =>
        r.type.toLowerCase() === "microsoft.compute/disks" &&
        r.properties.diskState === "Unattached",
    )
    .map((r) => ({
      ruleType: "ORPHANED_DISK",
      resourceId: r.id,
      subscriptionId: r.subscriptionId,
    }));
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npm test -- orphanedDisks`
Expected: PASS (2 tests)

- [ ] **Step 6: Commit**

```bash
git add src/lib/waste-rules/types.ts src/lib/waste-rules/orphanedDisks.ts tests/lib/waste-rules/orphanedDisks.test.ts
git commit -m "feat: orphaned disk waste rule"
```

---

## Task 7: Waste rule — unassociated public IPs

**Files:**
- Create: `src/lib/waste-rules/unassociatedPublicIps.ts`
- Test: `tests/lib/waste-rules/unassociatedPublicIps.test.ts`

**Interfaces:**
- Consumes: `ResourceGraphRow`, `WasteFindingCandidate` (Tasks 5, 6).
- Produces: `findUnassociatedPublicIps(resources: ResourceGraphRow[]): WasteFindingCandidate[]`.

- [ ] **Step 1: Write the failing test**

`tests/lib/waste-rules/unassociatedPublicIps.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import { findUnassociatedPublicIps } from "@/lib/waste-rules/unassociatedPublicIps";

describe("findUnassociatedPublicIps", () => {
  it("returns public IPs without an ipConfiguration", () => {
    const ip: ResourceGraphRow = {
      id: "ip-orphan",
      type: "microsoft.network/publicipaddresses",
      subscriptionId: "sub-1",
      properties: {},
    };

    expect(findUnassociatedPublicIps([ip])).toEqual([
      { ruleType: "UNASSOCIATED_PUBLIC_IP", resourceId: "ip-orphan", subscriptionId: "sub-1" },
    ]);
  });

  it("ignores associated public IPs", () => {
    const ip: ResourceGraphRow = {
      id: "ip-in-use",
      type: "microsoft.network/publicipaddresses",
      subscriptionId: "sub-1",
      properties: { ipConfiguration: { id: "nic-1" } },
    };

    expect(findUnassociatedPublicIps([ip])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- unassociatedPublicIps`
Expected: FAIL with "Cannot find module '@/lib/waste-rules/unassociatedPublicIps'"

- [ ] **Step 3: Implement the rule**

`src/lib/waste-rules/unassociatedPublicIps.ts`:

```ts
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import type { WasteFindingCandidate } from "@/lib/waste-rules/types";

export function findUnassociatedPublicIps(
  resources: ResourceGraphRow[],
): WasteFindingCandidate[] {
  return resources
    .filter(
      (r) =>
        r.type.toLowerCase() === "microsoft.network/publicipaddresses" &&
        !r.properties.ipConfiguration,
    )
    .map((r) => ({
      ruleType: "UNASSOCIATED_PUBLIC_IP",
      resourceId: r.id,
      subscriptionId: r.subscriptionId,
    }));
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- unassociatedPublicIps`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/waste-rules/unassociatedPublicIps.ts tests/lib/waste-rules/unassociatedPublicIps.test.ts
git commit -m "feat: unassociated public IP waste rule"
```

---

## Task 8: Waste rule — old snapshots

**Files:**
- Create: `src/lib/waste-rules/oldSnapshots.ts`
- Test: `tests/lib/waste-rules/oldSnapshots.test.ts`

**Interfaces:**
- Consumes: `ResourceGraphRow`, `WasteFindingCandidate` (Tasks 5, 6).
- Produces: `findOldSnapshots(resources: ResourceGraphRow[], now?: Date): WasteFindingCandidate[]`.

- [ ] **Step 1: Write the failing test**

`tests/lib/waste-rules/oldSnapshots.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import { findOldSnapshots } from "@/lib/waste-rules/oldSnapshots";

const NOW = new Date("2026-09-11T00:00:00Z");

describe("findOldSnapshots", () => {
  it("returns snapshots older than 30 days", () => {
    const snapshot: ResourceGraphRow = {
      id: "snap-old",
      type: "microsoft.compute/snapshots",
      subscriptionId: "sub-1",
      properties: { timeCreated: "2026-07-01T00:00:00Z" },
    };

    expect(findOldSnapshots([snapshot], NOW)).toEqual([
      { ruleType: "OLD_SNAPSHOT", resourceId: "snap-old", subscriptionId: "sub-1" },
    ]);
  });

  it("ignores snapshots 30 days old or newer, and rows missing timeCreated", () => {
    const recentSnapshot: ResourceGraphRow = {
      id: "snap-recent",
      type: "microsoft.compute/snapshots",
      subscriptionId: "sub-1",
      properties: { timeCreated: "2026-09-01T00:00:00Z" },
    };
    const malformedSnapshot: ResourceGraphRow = {
      id: "snap-no-date",
      type: "microsoft.compute/snapshots",
      subscriptionId: "sub-1",
      properties: {},
    };

    expect(findOldSnapshots([recentSnapshot, malformedSnapshot], NOW)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- oldSnapshots`
Expected: FAIL with "Cannot find module '@/lib/waste-rules/oldSnapshots'"

- [ ] **Step 3: Implement the rule**

`src/lib/waste-rules/oldSnapshots.ts`:

```ts
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import type { WasteFindingCandidate } from "@/lib/waste-rules/types";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export function findOldSnapshots(
  resources: ResourceGraphRow[],
  now: Date = new Date(),
): WasteFindingCandidate[] {
  return resources
    .filter((r) => {
      if (r.type.toLowerCase() !== "microsoft.compute/snapshots") {
        return false;
      }
      const timeCreated = r.properties.timeCreated;
      if (typeof timeCreated !== "string") {
        return false;
      }
      const ageMs = now.getTime() - new Date(timeCreated).getTime();
      return ageMs > THIRTY_DAYS_MS;
    })
    .map((r) => ({
      ruleType: "OLD_SNAPSHOT",
      resourceId: r.id,
      subscriptionId: r.subscriptionId,
    }));
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- oldSnapshots`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/waste-rules/oldSnapshots.ts tests/lib/waste-rules/oldSnapshots.test.ts
git commit -m "feat: old snapshot waste rule"
```

---

## Task 9: Waste rule — idle VPN gateways

**Files:**
- Create: `src/lib/waste-rules/idleVpnGateways.ts`
- Test: `tests/lib/waste-rules/idleVpnGateways.test.ts`

**Interfaces:**
- Consumes: `ResourceGraphRow`, `WasteFindingCandidate` (Tasks 5, 6).
- Produces: `findIdleVpnGateways(resources: ResourceGraphRow[]): WasteFindingCandidate[]`.

- [ ] **Step 1: Write the failing test**

`tests/lib/waste-rules/idleVpnGateways.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import { findIdleVpnGateways } from "@/lib/waste-rules/idleVpnGateways";

describe("findIdleVpnGateways", () => {
  it("returns a gateway with no referencing connection", () => {
    const gateway: ResourceGraphRow = {
      id: "/subscriptions/sub-1/.../vpnGateways/gw-idle",
      type: "microsoft.network/vpngateways",
      subscriptionId: "sub-1",
      properties: {},
    };

    expect(findIdleVpnGateways([gateway])).toEqual([
      { ruleType: "IDLE_VPN_GATEWAY", resourceId: gateway.id, subscriptionId: "sub-1" },
    ]);
  });

  it("ignores a gateway referenced by a connection, case-insensitively", () => {
    const gateway: ResourceGraphRow = {
      id: "/subscriptions/sub-1/.../vpnGateways/gw-active",
      type: "microsoft.network/virtualnetworkgateways",
      subscriptionId: "sub-1",
      properties: {},
    };
    const connection: ResourceGraphRow = {
      id: "conn-1",
      type: "microsoft.network/connections",
      subscriptionId: "sub-1",
      properties: {
        virtualNetworkGateway1: { id: gateway.id.toUpperCase() },
      },
    };

    expect(findIdleVpnGateways([gateway, connection])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- idleVpnGateways`
Expected: FAIL with "Cannot find module '@/lib/waste-rules/idleVpnGateways'"

- [ ] **Step 3: Implement the rule**

`src/lib/waste-rules/idleVpnGateways.ts`:

```ts
import type { ResourceGraphRow } from "@/lib/azure/resourceGraph";
import type { WasteFindingCandidate } from "@/lib/waste-rules/types";

const GATEWAY_TYPES = new Set([
  "microsoft.network/vpngateways",
  "microsoft.network/virtualnetworkgateways",
]);

function referencesGateway(connection: ResourceGraphRow, gatewayId: string): boolean {
  const gw1 = connection.properties.virtualNetworkGateway1 as { id?: string } | undefined;
  const gw2 = connection.properties.virtualNetworkGateway2 as { id?: string } | undefined;
  const normalizedGatewayId = gatewayId.toLowerCase();
  return (
    gw1?.id?.toLowerCase() === normalizedGatewayId ||
    gw2?.id?.toLowerCase() === normalizedGatewayId
  );
}

export function findIdleVpnGateways(
  resources: ResourceGraphRow[],
): WasteFindingCandidate[] {
  const gateways = resources.filter((r) => GATEWAY_TYPES.has(r.type.toLowerCase()));
  const connections = resources.filter(
    (r) => r.type.toLowerCase() === "microsoft.network/connections",
  );

  return gateways
    .filter(
      (gateway) => !connections.some((connection) => referencesGateway(connection, gateway.id)),
    )
    .map((gateway) => ({
      ruleType: "IDLE_VPN_GATEWAY",
      resourceId: gateway.id,
      subscriptionId: gateway.subscriptionId,
    }));
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- idleVpnGateways`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/waste-rules/idleVpnGateways.ts tests/lib/waste-rules/idleVpnGateways.test.ts
git commit -m "feat: idle VPN gateway waste rule"
```

---

## Task 10: Cost Management — estimate monthly cost

**Files:**
- Create: `src/lib/azure/costManagement.ts`
- Test: `tests/lib/azure/costManagement.test.ts`

**Interfaces:**
- Consumes: `armFetch` (Task 5).
- Produces: `estimateMonthlyCost(subscriptionId: string, resourceId: string): Promise<number>` — consumed by the scanner (Task 11).

- [ ] **Step 1: Write the failing test**

`tests/lib/azure/costManagement.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as armFetchModule from "@/lib/azure/armFetch";
import { estimateMonthlyCost } from "@/lib/azure/costManagement";

describe("estimateMonthlyCost", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the Cost column value from the query response", async () => {
    vi.spyOn(armFetchModule, "armFetch").mockResolvedValue({
      properties: {
        columns: [{ name: "Cost" }, { name: "Currency" }],
        rows: [[12.5, "USD"]],
      },
    });

    const cost = await estimateMonthlyCost("sub-1", "disk-1");

    expect(cost).toBe(12.5);
  });

  it("returns 0 when there are no rows", async () => {
    vi.spyOn(armFetchModule, "armFetch").mockResolvedValue({
      properties: { columns: [{ name: "Cost" }], rows: [] },
    });

    const cost = await estimateMonthlyCost("sub-1", "disk-1");

    expect(cost).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- costManagement`
Expected: FAIL with "Cannot find module '@/lib/azure/costManagement'"

- [ ] **Step 3: Implement the Cost Management query wrapper**

`src/lib/azure/costManagement.ts`:

```ts
import { armFetch } from "@/lib/azure/armFetch";

interface CostQueryResponse {
  properties: {
    columns: { name: string }[];
    rows: (string | number)[][];
  };
}

export async function estimateMonthlyCost(
  subscriptionId: string,
  resourceId: string,
): Promise<number> {
  const url = `https://management.azure.com/subscriptions/${subscriptionId}/providers/Microsoft.CostManagement/query?api-version=2023-11-01`;

  const response = await armFetch<CostQueryResponse>(url, {
    method: "POST",
    body: JSON.stringify({
      type: "ActualCost",
      timeframe: "MonthToDate",
      dataset: {
        granularity: "None",
        aggregation: { totalCost: { name: "Cost", function: "Sum" } },
        filter: {
          dimensions: { name: "ResourceId", operator: "In", values: [resourceId] },
        },
      },
    }),
  });

  const costColumnIndex = response.properties.columns.findIndex((c) => c.name === "Cost");
  if (costColumnIndex === -1 || response.properties.rows.length === 0) {
    return 0;
  }
  return Number(response.properties.rows[0][costColumnIndex]) || 0;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- costManagement`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/azure/costManagement.ts tests/lib/azure/costManagement.test.ts
git commit -m "feat: Cost Management monthly cost estimation"
```

---

## Task 11: Scanner worker orchestration

**Files:**
- Create: `src/lib/scanner/runScan.ts`
- Create: `scripts/scanner/run.ts`
- Test: `tests/lib/scanner/runScan.test.ts`

**Interfaces:**
- Consumes: `prisma` (Task 2), `queryResourceGraph` (Task 5), `estimateMonthlyCost` (Task 10), the four `find*` rule functions (Tasks 6-9).
- Produces: `runScan(subscriptionRecordId: string): Promise<void>` and the `npm run scanner` CLI entrypoint that Task 15's manual validation exercises against the real test subscription.

- [ ] **Step 1: Write the failing test**

`tests/lib/scanner/runScan.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { resetDb } from "../../helpers/resetDb";

vi.mock("@/lib/azure/resourceGraph", () => ({
  queryResourceGraph: vi.fn(),
}));
vi.mock("@/lib/azure/costManagement", () => ({
  estimateMonthlyCost: vi.fn(),
}));

import { queryResourceGraph } from "@/lib/azure/resourceGraph";
import { estimateMonthlyCost } from "@/lib/azure/costManagement";
import { runScan } from "@/lib/scanner/runScan";

describe("runScan", () => {
  beforeEach(resetDb);

  it("persists resources and waste findings, and marks the scan SUCCEEDED", async () => {
    const customer = await prisma.customer.create({
      data: { entraTenantId: "tenant-1", name: "Acme" },
    });
    const subscription = await prisma.subscription.create({
      data: { customerId: customer.id, azureSubscriptionId: "sub-1", displayName: "Prod" },
    });

    vi.mocked(queryResourceGraph).mockResolvedValue([
      {
        id: "disk-1",
        type: "microsoft.compute/disks",
        subscriptionId: "sub-1",
        properties: { diskState: "Unattached" },
      },
    ]);
    vi.mocked(estimateMonthlyCost).mockResolvedValue(9.99);

    await runScan(subscription.id);

    const scanRun = await prisma.scanRun.findFirstOrThrow({
      where: { subscriptionId: subscription.id },
    });
    expect(scanRun.status).toBe("SUCCEEDED");

    const findings = await prisma.wasteFinding.findMany({
      where: { subscriptionId: subscription.id },
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      ruleType: "ORPHANED_DISK",
      resourceId: "disk-1",
      estimatedMonthlyCost: 9.99,
    });
  });

  it("marks the scan FAILED when Resource Graph throws", async () => {
    const customer = await prisma.customer.create({
      data: { entraTenantId: "tenant-2", name: "Other" },
    });
    const subscription = await prisma.subscription.create({
      data: { customerId: customer.id, azureSubscriptionId: "sub-2", displayName: "Other" },
    });

    vi.mocked(queryResourceGraph).mockRejectedValue(new Error("boom"));

    await expect(runScan(subscription.id)).rejects.toThrow("boom");

    const scanRun = await prisma.scanRun.findFirstOrThrow({
      where: { subscriptionId: subscription.id },
    });
    expect(scanRun.status).toBe("FAILED");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- runScan`
Expected: FAIL with "Cannot find module '@/lib/scanner/runScan'"

- [ ] **Step 3: Implement `runScan`**

`src/lib/scanner/runScan.ts`:

```ts
import { prisma } from "@/lib/prisma";
import { queryResourceGraph } from "@/lib/azure/resourceGraph";
import { estimateMonthlyCost } from "@/lib/azure/costManagement";
import { findOrphanedDisks } from "@/lib/waste-rules/orphanedDisks";
import { findUnassociatedPublicIps } from "@/lib/waste-rules/unassociatedPublicIps";
import { findOldSnapshots } from "@/lib/waste-rules/oldSnapshots";
import { findIdleVpnGateways } from "@/lib/waste-rules/idleVpnGateways";
import type { WasteFindingCandidate } from "@/lib/waste-rules/types";

const COMBINED_QUERY = `
Resources
| where type in (
    'microsoft.compute/disks',
    'microsoft.network/publicipaddresses',
    'microsoft.compute/snapshots',
    'microsoft.network/vpngateways',
    'microsoft.network/virtualnetworkgateways',
    'microsoft.network/connections'
  )
| project id, type, subscriptionId, properties
`;

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
    ];

    for (const candidate of candidates) {
      const estimatedMonthlyCost = await estimateMonthlyCost(
        subscription.azureSubscriptionId,
        candidate.resourceId,
      );
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
        update: { estimatedMonthlyCost, status: "OPEN" },
      });
    }

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
Expected: PASS (2 tests)

- [ ] **Step 5: Write the CLI entrypoint for the scheduled job**

`scripts/scanner/run.ts`:

```ts
import { prisma } from "@/lib/prisma";
import { runScan } from "@/lib/scanner/runScan";

async function main() {
  const subscriptions = await prisma.subscription.findMany({
    where: { status: "CONNECTED" },
  });

  for (const subscription of subscriptions) {
    try {
      await runScan(subscription.id);
      console.log(`Scan succeeded for subscription ${subscription.azureSubscriptionId}`);
    } catch (error) {
      console.error(`Scan failed for subscription ${subscription.azureSubscriptionId}`, error);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
```

- [ ] **Step 6: Verify the entrypoint at least type-checks and runs against an empty DB**

Run: `npx tsx scripts/scanner/run.ts`
Expected: exits 0 and prints nothing (no `CONNECTED` subscriptions exist yet)

- [ ] **Step 7: Commit**

```bash
git add src/lib/scanner scripts/scanner tests/lib/scanner
git commit -m "feat: scanner worker orchestration and CLI entrypoint"
```

---

## Task 12: Azure Lighthouse onboarding

**Files:**
- Create: `infra/lighthouse/lighthouse.bicep`
- Create: `src/app/api/subscriptions/route.ts`
- Create: `src/app/api/subscriptions/connect-link/route.ts`
- Create: `src/app/api/subscriptions/[id]/verify/route.ts`
- Test: `tests/app/api/subscriptions.test.ts`
- Test: `tests/app/api/subscriptions-verify.test.ts`

**Interfaces:**
- Consumes: `requireCustomerId` (Task 4), `prisma` (Task 2), `armFetch` (Task 5), `runScan` (Task 11).
- Produces: `GET/POST /api/subscriptions`, `GET /api/subscriptions/connect-link`, `POST /api/subscriptions/:id/verify` — consumed by the dashboard's connect flow (Task 13).

- [ ] **Step 1: Write the Lighthouse delegation template**

`infra/lighthouse/lighthouse.bicep`:

```bicep
targetScope = 'subscription'

@description('Display name shown to the customer for this delegation')
param mspOfferName string = 'Cloud Waste Hunter'

@description('Object ID of the provider security group granted delegated access')
param providerPrincipalId string

@description('Tenant ID of the provider (Cloud Waste Hunter)')
param providerTenantId string

var registrationDefinitionName = guid(mspOfferName, providerTenantId, subscription().subscriptionId)
var registrationAssignmentName = guid(registrationDefinitionName, subscription().subscriptionId)
var readerRoleId = 'acdd72a7-3385-48ef-bd42-f606fba81ae7'

resource registrationDefinition 'Microsoft.ManagedServices/registrationDefinitions@2022-10-01' = {
  name: registrationDefinitionName
  properties: {
    registrationDefinitionName: mspOfferName
    description: 'Grants Cloud Waste Hunter read-only access to detect cost-saving opportunities.'
    managedByTenantId: providerTenantId
    authorizations: [
      {
        principalId: providerPrincipalId
        principalIdDisplayName: 'Cloud Waste Hunter Scanner'
        roleDefinitionId: readerRoleId
      }
    ]
  }
}

resource registrationAssignment 'Microsoft.ManagedServices/registrationAssignments@2022-10-01' = {
  name: registrationAssignmentName
  properties: {
    registrationDefinitionId: registrationDefinition.id
  }
}
```

- [ ] **Step 2: Write the failing test for the subscriptions list/create route**

`tests/app/api/subscriptions.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { resetDb } from "../../helpers/resetDb";

vi.mock("@/lib/tenant", () => ({
  requireCustomerId: vi.fn(),
}));

import { requireCustomerId } from "@/lib/tenant";
import { GET, POST } from "@/app/api/subscriptions/route";

describe("/api/subscriptions", () => {
  beforeEach(resetDb);

  it("creates a PENDING subscription scoped to the current customer", async () => {
    const customer = await prisma.customer.create({
      data: { entraTenantId: "tenant-1", name: "Acme" },
    });
    vi.mocked(requireCustomerId).mockResolvedValue(customer.id);

    const request = new Request("http://localhost/api/subscriptions", {
      method: "POST",
      body: JSON.stringify({ azureSubscriptionId: "sub-1", displayName: "Acme Prod" }),
    });
    const response = await POST(request);
    expect(response.status).toBe(201);

    const created = await prisma.subscription.findUniqueOrThrow({
      where: { azureSubscriptionId: "sub-1" },
    });
    expect(created.customerId).toBe(customer.id);
    expect(created.status).toBe("PENDING");
  });

  it("rejects a POST missing required fields", async () => {
    vi.mocked(requireCustomerId).mockResolvedValue("customer-1");

    const request = new Request("http://localhost/api/subscriptions", {
      method: "POST",
      body: JSON.stringify({}),
    });
    const response = await POST(request);

    expect(response.status).toBe(400);
  });

  it("only lists subscriptions belonging to the current customer", async () => {
    const customerA = await prisma.customer.create({
      data: { entraTenantId: "tenant-a", name: "A" },
    });
    const customerB = await prisma.customer.create({
      data: { entraTenantId: "tenant-b", name: "B" },
    });
    await prisma.subscription.create({
      data: { customerId: customerA.id, azureSubscriptionId: "sub-a", displayName: "A sub" },
    });
    await prisma.subscription.create({
      data: { customerId: customerB.id, azureSubscriptionId: "sub-b", displayName: "B sub" },
    });

    vi.mocked(requireCustomerId).mockResolvedValue(customerA.id);

    const response = await GET();
    const body = (await response.json()) as { azureSubscriptionId: string }[];

    expect(body).toHaveLength(1);
    expect(body[0].azureSubscriptionId).toBe("sub-a");
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npm test -- subscriptions.test`
Expected: FAIL with "Cannot find module '@/app/api/subscriptions/route'"

- [ ] **Step 4: Implement the subscriptions route**

`src/app/api/subscriptions/route.ts`:

```ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCustomerId } from "@/lib/tenant";

export async function GET() {
  const customerId = await requireCustomerId();
  const subscriptions = await prisma.subscription.findMany({
    where: { customerId },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(subscriptions);
}

export async function POST(request: Request) {
  const customerId = await requireCustomerId();
  const body = (await request.json()) as {
    azureSubscriptionId?: string;
    displayName?: string;
  };

  if (!body.azureSubscriptionId || !body.displayName) {
    return NextResponse.json(
      { error: "azureSubscriptionId and displayName are required" },
      { status: 400 },
    );
  }

  const subscription = await prisma.subscription.create({
    data: {
      customerId,
      azureSubscriptionId: body.azureSubscriptionId,
      displayName: body.displayName,
    },
  });

  return NextResponse.json(subscription, { status: 201 });
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npm test -- subscriptions.test`
Expected: PASS (3 tests)

- [ ] **Step 6: Implement the connect-link route** (no dedicated test — it returns static config, exercised manually in Task 15)

`src/app/api/subscriptions/connect-link/route.ts`:

```ts
import { NextResponse } from "next/server";
import { requireCustomerId } from "@/lib/tenant";

const TEMPLATE_URI =
  "https://cloudwastehunter.blob.core.windows.net/templates/lighthouse.json";

export async function GET() {
  await requireCustomerId();

  return NextResponse.json({
    deployUrl: `https://portal.azure.com/#create/Microsoft.Template/uri/${encodeURIComponent(TEMPLATE_URI)}`,
    providerPrincipalId: process.env.LIGHTHOUSE_PROVIDER_PRINCIPAL_ID,
    providerTenantId: process.env.LIGHTHOUSE_PROVIDER_TENANT_ID,
  });
}
```

- [ ] **Step 7: Write the failing test for the verify route**

`tests/app/api/subscriptions-verify.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { resetDb } from "../../helpers/resetDb";

vi.mock("@/lib/tenant", () => ({ requireCustomerId: vi.fn() }));
vi.mock("@/lib/azure/armFetch", () => ({ armFetch: vi.fn() }));
vi.mock("@/lib/scanner/runScan", () => ({ runScan: vi.fn().mockResolvedValue(undefined) }));

import { requireCustomerId } from "@/lib/tenant";
import { armFetch } from "@/lib/azure/armFetch";
import { runScan } from "@/lib/scanner/runScan";
import { POST } from "@/app/api/subscriptions/[id]/verify/route";

describe("POST /api/subscriptions/:id/verify", () => {
  beforeEach(resetDb);

  it("marks the subscription CONNECTED and triggers a scan when a delegation exists", async () => {
    const customer = await prisma.customer.create({
      data: { entraTenantId: "tenant-1", name: "Acme" },
    });
    const subscription = await prisma.subscription.create({
      data: { customerId: customer.id, azureSubscriptionId: "sub-1", displayName: "Prod" },
    });

    vi.mocked(requireCustomerId).mockResolvedValue(customer.id);
    vi.mocked(armFetch).mockResolvedValue({ value: [{ id: "assignment-1" }] });

    const response = await POST(new Request("http://localhost"), {
      params: { id: subscription.id },
    });

    expect(response.status).toBe(200);
    const updated = await prisma.subscription.findUniqueOrThrow({ where: { id: subscription.id } });
    expect(updated.status).toBe("CONNECTED");
    expect(runScan).toHaveBeenCalledWith(subscription.id);
  });

  it("returns 409 when no delegation exists yet", async () => {
    const customer = await prisma.customer.create({
      data: { entraTenantId: "tenant-2", name: "Other" },
    });
    const subscription = await prisma.subscription.create({
      data: { customerId: customer.id, azureSubscriptionId: "sub-2", displayName: "Other" },
    });

    vi.mocked(requireCustomerId).mockResolvedValue(customer.id);
    vi.mocked(armFetch).mockResolvedValue({ value: [] });

    const response = await POST(new Request("http://localhost"), {
      params: { id: subscription.id },
    });

    expect(response.status).toBe(409);
  });

  it("returns 404 for a subscription belonging to another customer", async () => {
    const customerA = await prisma.customer.create({
      data: { entraTenantId: "tenant-a", name: "A" },
    });
    const customerB = await prisma.customer.create({
      data: { entraTenantId: "tenant-b", name: "B" },
    });
    const subscriptionB = await prisma.subscription.create({
      data: { customerId: customerB.id, azureSubscriptionId: "sub-b", displayName: "B" },
    });

    vi.mocked(requireCustomerId).mockResolvedValue(customerA.id);

    const response = await POST(new Request("http://localhost"), {
      params: { id: subscriptionB.id },
    });

    expect(response.status).toBe(404);
  });
});
```

- [ ] **Step 8: Run to verify it fails**

Run: `npm test -- subscriptions-verify`
Expected: FAIL with "Cannot find module '@/app/api/subscriptions/[id]/verify/route'"

- [ ] **Step 9: Implement the verify route**

`src/app/api/subscriptions/[id]/verify/route.ts`:

```ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCustomerId } from "@/lib/tenant";
import { armFetch } from "@/lib/azure/armFetch";
import { runScan } from "@/lib/scanner/runScan";

interface RegistrationAssignmentListResponse {
  value: { id: string }[];
}

export async function POST(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const customerId = await requireCustomerId();

  const subscription = await prisma.subscription.findFirst({
    where: { id: params.id, customerId },
  });
  if (!subscription) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const url = `https://management.azure.com/subscriptions/${subscription.azureSubscriptionId}/providers/Microsoft.ManagedServices/registrationAssignments?api-version=2022-10-01`;
  const result = await armFetch<RegistrationAssignmentListResponse>(url);

  if (result.value.length === 0) {
    return NextResponse.json({ error: "Lighthouse delegation not found yet" }, { status: 409 });
  }

  const updated = await prisma.subscription.update({
    where: { id: subscription.id },
    data: { status: "CONNECTED", connectedAt: new Date() },
  });

  runScan(updated.id).catch((error) => {
    console.error(`Initial scan failed for subscription ${updated.id}`, error);
  });

  return NextResponse.json({ status: updated.status });
}
```

- [ ] **Step 10: Run to verify it passes**

Run: `npm test -- subscriptions-verify`
Expected: PASS (3 tests)

- [ ] **Step 11: Commit**

```bash
git add infra/lighthouse src/app/api/subscriptions tests/app/api
git commit -m "feat: Azure Lighthouse onboarding flow"
```

---

## Task 13: Dashboard UI and finding dismissal

**Files:**
- Create: `src/lib/dashboard-summary.ts`
- Create: `src/app/api/findings/[id]/dismiss/route.ts`
- Create: `src/app/dashboard/page.tsx`
- Create: `src/app/connect/page.tsx`
- Test: `tests/lib/dashboard-summary.test.ts`
- Test: `tests/app/api/findings-dismiss.test.ts`

**Interfaces:**
- Consumes: `requireCustomerId` (Task 4), `prisma` (Task 2), `listFindingsForCurrentCustomer` (Task 4), the subscriptions API (Task 12).
- Produces: the dashboard page users see, and `POST /api/findings/:id/dismiss`.

- [ ] **Step 1: Write the failing test for the summary calculation**

`tests/lib/dashboard-summary.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { computeDashboardSummary } from "@/lib/dashboard-summary";

describe("computeDashboardSummary", () => {
  it("counts only OPEN findings and sums their estimated cost", () => {
    const summary = computeDashboardSummary([
      { status: "OPEN", estimatedMonthlyCost: 10 },
      { status: "OPEN", estimatedMonthlyCost: 5.5 },
      { status: "DISMISSED", estimatedMonthlyCost: 100 },
    ]);

    expect(summary).toEqual({ openFindingsCount: 2, totalEstimatedMonthlySavings: 15.5 });
  });

  it("returns zeroes for an empty list", () => {
    expect(computeDashboardSummary([])).toEqual({
      openFindingsCount: 0,
      totalEstimatedMonthlySavings: 0,
    });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- dashboard-summary`
Expected: FAIL with "Cannot find module '@/lib/dashboard-summary'"

- [ ] **Step 3: Implement the summary function**

`src/lib/dashboard-summary.ts`:

```ts
import type { WasteFinding } from "@prisma/client";

export interface DashboardSummary {
  openFindingsCount: number;
  totalEstimatedMonthlySavings: number;
}

export function computeDashboardSummary(
  findings: Pick<WasteFinding, "status" | "estimatedMonthlyCost">[],
): DashboardSummary {
  const open = findings.filter((f) => f.status === "OPEN");
  return {
    openFindingsCount: open.length,
    totalEstimatedMonthlySavings: open.reduce((sum, f) => sum + f.estimatedMonthlyCost, 0),
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- dashboard-summary`
Expected: PASS (2 tests)

- [ ] **Step 5: Write the failing test for the dismiss route**

`tests/app/api/findings-dismiss.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { resetDb } from "../../helpers/resetDb";

vi.mock("@/lib/tenant", () => ({ requireCustomerId: vi.fn() }));

import { requireCustomerId } from "@/lib/tenant";
import { POST } from "@/app/api/findings/[id]/dismiss/route";

async function seedFinding(tenantId: string, resourceId: string) {
  const customer = await prisma.customer.create({
    data: { entraTenantId: tenantId, name: tenantId },
  });
  const subscription = await prisma.subscription.create({
    data: { customerId: customer.id, azureSubscriptionId: `${tenantId}-sub`, displayName: tenantId },
  });
  const finding = await prisma.wasteFinding.create({
    data: {
      subscriptionId: subscription.id,
      ruleType: "ORPHANED_DISK",
      resourceId,
      estimatedMonthlyCost: 1,
    },
  });
  return { customer, finding };
}

describe("POST /api/findings/:id/dismiss", () => {
  beforeEach(resetDb);

  it("dismisses a finding belonging to the current customer", async () => {
    const { customer, finding } = await seedFinding("tenant-a", "disk-a");
    vi.mocked(requireCustomerId).mockResolvedValue(customer.id);

    const response = await POST(new Request("http://localhost"), {
      params: { id: finding.id },
    });

    expect(response.status).toBe(200);
    const updated = await prisma.wasteFinding.findUniqueOrThrow({ where: { id: finding.id } });
    expect(updated.status).toBe("DISMISSED");
  });

  it("returns 404 for a finding belonging to another customer", async () => {
    const { finding } = await seedFinding("tenant-b", "disk-b");
    vi.mocked(requireCustomerId).mockResolvedValue("some-other-customer-id");

    const response = await POST(new Request("http://localhost"), {
      params: { id: finding.id },
    });

    expect(response.status).toBe(404);
  });
});
```

- [ ] **Step 6: Run to verify it fails**

Run: `npm test -- findings-dismiss`
Expected: FAIL with "Cannot find module '@/app/api/findings/[id]/dismiss/route'"

- [ ] **Step 7: Implement the dismiss route**

`src/app/api/findings/[id]/dismiss/route.ts`:

```ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCustomerId } from "@/lib/tenant";

export async function POST(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const customerId = await requireCustomerId();

  const finding = await prisma.wasteFinding.findFirst({
    where: { id: params.id, subscription: { customerId } },
  });
  if (!finding) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const updated = await prisma.wasteFinding.update({
    where: { id: finding.id },
    data: { status: "DISMISSED" },
  });

  return NextResponse.json({ status: updated.status });
}
```

- [ ] **Step 8: Run to verify it passes**

Run: `npm test -- findings-dismiss`
Expected: PASS (2 tests)

- [ ] **Step 9: Build the dashboard page**

`src/app/dashboard/page.tsx`:

```tsx
import { prisma } from "@/lib/prisma";
import { requireCustomerId } from "@/lib/tenant";
import { computeDashboardSummary } from "@/lib/dashboard-summary";

export default async function DashboardPage() {
  const customerId = await requireCustomerId();

  const findings = await prisma.wasteFinding.findMany({
    where: { subscription: { customerId } },
    orderBy: { detectedAt: "desc" },
    include: { subscription: true },
  });

  const summary = computeDashboardSummary(findings);

  return (
    <main>
      <h1>Cloud Waste Hunter</h1>
      <section>
        <p>Findings abertos: {summary.openFindingsCount}</p>
        <p>Economia potencial mensal: ${summary.totalEstimatedMonthlySavings.toFixed(2)}</p>
      </section>
      <table>
        <thead>
          <tr>
            <th>Regra</th>
            <th>Recurso</th>
            <th>Subscription</th>
            <th>Custo estimado/mês</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {findings.map((finding) => (
            <tr key={finding.id}>
              <td>{finding.ruleType}</td>
              <td>{finding.resourceId}</td>
              <td>{finding.subscription.displayName}</td>
              <td>${finding.estimatedMonthlyCost.toFixed(2)}</td>
              <td>{finding.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
```

- [ ] **Step 10: Build the connect page**

`src/app/connect/page.tsx`:

```tsx
import { prisma } from "@/lib/prisma";
import { requireCustomerId } from "@/lib/tenant";

export default async function ConnectPage() {
  const customerId = await requireCustomerId();

  const subscriptions = await prisma.subscription.findMany({
    where: { customerId },
    orderBy: { createdAt: "desc" },
  });

  return (
    <main>
      <h1>Conectar Azure</h1>
      <p>
        Para conectar uma subscription, implante o template Azure Lighthouse
        fornecido e depois clique em &quot;Verificar conexão&quot;.
      </p>
      <ul>
        {subscriptions.map((s) => (
          <li key={s.id}>
            {s.displayName} ({s.azureSubscriptionId}) — {s.status}
          </li>
        ))}
      </ul>
    </main>
  );
}
```

- [ ] **Step 11: Run the full test suite**

Run: `npm test`
Expected: all PASS

- [ ] **Step 12: Manually verify the dashboard renders**

Run: `npm run dev`, sign in via a test Entra ID account, seed a subscription and a waste finding directly via `npx prisma studio` or a Prisma script, and confirm `/dashboard` shows the correct counts and `/connect` lists the subscription. Confirm dismissing a finding via a direct `fetch` call to `/api/findings/:id/dismiss` removes it from the OPEN count on reload.

- [ ] **Step 13: Commit**

```bash
git add src/lib/dashboard-summary.ts src/app/api/findings src/app/dashboard src/app/connect tests/lib/dashboard-summary.test.ts tests/app/api/findings-dismiss.test.ts
git commit -m "feat: read-only dashboard and finding dismissal"
```

---

## Task 14: Provider infrastructure (Bicep)

**Files:**
- Create: `infra/provider/main.bicep`

**Interfaces:**
- Produces: the IaC used to deploy the Next.js web app, the scheduled scanner job, the Postgres database and Key Vault for the provider's own Azure environment. No other task depends on this file at test time; it is validated with `az bicep build`.

- [ ] **Step 1: Write the provider infrastructure template**

`infra/provider/main.bicep`:

```bicep
@description('Short name used as a prefix for all resources, e.g. cwh')
param namePrefix string = 'cwh'

@description('Azure region for all resources')
param location string = resourceGroup().location

@secure()
@description('Administrator password for the Postgres Flexible Server')
param postgresAdminPassword string

@description('Container image for the Next.js web app, e.g. myregistry.azurecr.io/cwh-web:latest')
param webContainerImage string

@description('Container image for the scanner job, e.g. myregistry.azurecr.io/cwh-scanner:latest')
param scannerContainerImage string

var logAnalyticsName = '${namePrefix}-logs'
var containerEnvName = '${namePrefix}-env'
var postgresServerName = '${namePrefix}-pg'
var keyVaultName = '${namePrefix}-kv'
var webAppName = '${namePrefix}-web'
var scannerJobName = '${namePrefix}-scanner'

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: logAnalyticsName
  location: location
  properties: {
    sku: { name: 'PerGB2018' }
  }
}

resource containerEnv 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: containerEnvName
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logAnalytics.properties.customerId
        sharedKey: logAnalytics.listKeys().primarySharedKey
      }
    }
  }
}

resource postgres 'Microsoft.DBforPostgreSQL/flexibleServers@2023-06-01-preview' = {
  name: postgresServerName
  location: location
  sku: {
    name: 'Standard_B1ms'
    tier: 'Burstable'
  }
  properties: {
    version: '16'
    administratorLogin: 'cwhadmin'
    administratorLoginPassword: postgresAdminPassword
    storage: { storageSizeGB: 32 }
  }
}

resource postgresFirewallAllowAzure 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2023-06-01-preview' = {
  parent: postgres
  name: 'AllowAzureServices'
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0'
  }
}

resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: keyVaultName
  location: location
  properties: {
    sku: { family: 'A', name: 'standard' }
    tenantId: subscription().tenantId
    enableRbacAuthorization: true
    accessPolicies: []
  }
}

resource webApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: webAppName
  location: location
  identity: { type: 'SystemAssigned' }
  properties: {
    managedEnvironmentId: containerEnv.id
    configuration: {
      ingress: { external: true, targetPort: 3000 }
    }
    template: {
      containers: [
        {
          name: 'web'
          image: webContainerImage
          resources: { cpu: json('0.5'), memory: '1Gi' }
        }
      ]
      scale: { minReplicas: 1, maxReplicas: 3 }
    }
  }
}

resource scannerJob 'Microsoft.App/jobs@2024-03-01' = {
  name: scannerJobName
  location: location
  identity: { type: 'SystemAssigned' }
  properties: {
    environmentId: containerEnv.id
    configuration: {
      triggerType: 'Schedule'
      scheduleTriggerConfig: {
        cronExpression: '0 */6 * * *'
        parallelism: 1
        replicaCompletionCount: 1
      }
      replicaTimeout: 1800
      replicaRetryLimit: 1
    }
    template: {
      containers: [
        {
          name: 'scanner'
          image: scannerContainerImage
          resources: { cpu: json('0.5'), memory: '1Gi' }
        }
      ]
    }
  }
}

output webAppFqdn string = webApp.properties.configuration.ingress.fqdn
output postgresServerFqdn string = postgres.properties.fullyQualifiedDomainName
```

- [ ] **Step 2: Validate the template compiles**

Run: `az bicep build --file infra/provider/main.bicep`
Expected: no errors, produces `infra/provider/main.json`

- [ ] **Step 3: Commit**

```bash
git add infra/provider/main.bicep
git commit -m "infra: provider Container Apps, Postgres, Key Vault and scanner job"
```

---

## Task 15: Manual end-to-end validation against the test subscription

**Files:** none (manual validation only — no code changes)

**Interfaces:**
- Consumes: every artifact from Tasks 1-14, exercised against the real Azure test subscription the user confirmed is available.

- [ ] **Step 1: Register the provider's own app/security group in Entra ID**

Create (or reuse) a security group in the provider's Entra ID tenant to act as `providerPrincipalId`, and note the provider tenant's ID (`providerTenantId`). Set both as env vars (`LIGHTHOUSE_PROVIDER_PRINCIPAL_ID`, `LIGHTHOUSE_PROVIDER_TENANT_ID`) in `.env`.

- [ ] **Step 2: Deploy the Lighthouse template to the test subscription**

Run: `az deployment sub create --location <region> --template-file infra/lighthouse/lighthouse.bicep --parameters providerPrincipalId=<group-object-id> providerTenantId=<provider-tenant-id>` against the test subscription (requires Owner or User Access Administrator there).
Expected: deployment succeeds; `az role assignment list --scope /subscriptions/<test-sub-id>` shows the Reader role assigned to the provider's group.

- [ ] **Step 3: Create a known piece of waste in the test subscription**

Run: `az disk create --resource-group <test-rg> --name cwh-validation-disk --size-gb 4 --sku Standard_LRS` (creates an unattached disk — do not attach it to any VM).

- [ ] **Step 4: Run the app locally against the test subscription**

Run: `npm run dev`, sign in with a test Entra ID account belonging to the test tenant, visit `/connect`, call `POST /api/subscriptions` with the test subscription's ID, then `POST /api/subscriptions/:id/verify`.
Expected: response `{ "status": "CONNECTED" }`.

- [ ] **Step 5: Confirm the scan found the seeded waste**

Run: `npm run scanner`
Expected: log line `Scan succeeded for subscription <test-sub-id>`. Visit `/dashboard` and confirm a finding with `ruleType: ORPHANED_DISK` and `resourceId` containing `cwh-validation-disk` appears, with a non-negative estimated monthly cost.

- [ ] **Step 6: Confirm dismissal works end-to-end**

From the dashboard, dismiss the finding (via the API route). Reload `/dashboard` and confirm it no longer counts toward `openFindingsCount`.

- [ ] **Step 7: Clean up the seeded test resource**

Run: `az disk delete --resource-group <test-rg> --name cwh-validation-disk --yes`

- [ ] **Step 8: Record the validation result**

Add a short note to `docs/superpowers/plans/2026-09-11-cloud-waste-hunter-core.md` (this file) under a new `## Validation Log` heading with the date and outcome, and commit.

```bash
git add docs/superpowers/plans/2026-09-11-cloud-waste-hunter-core.md
git commit -m "docs: record Fase 1 end-to-end validation result"
```
