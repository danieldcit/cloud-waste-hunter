# Cloud Waste Hunter — Operator Multi-Client Switching — Design Spec

**Status:** Approved by user, ready for implementation planning.

## Background

Cloud Waste Hunter's auth model today is strictly 1:1: signing in with
Microsoft Entra ID auto-creates (or resolves) exactly one `Customer` row
keyed by the signed-in identity's tenant — the app has no concept of one
person managing more than one customer.

In practice the user (an employee of DCIT Tecnologia, an MSP) has
administrative access, via their own Azure AD, to many separate client
companies' tenants — shown in a screenshot of the Azure Portal's own
directory switcher (Emive Patrulha 24 Horas, Azure Sysdam, Blackticket,
DCIT Tecnologia itself, and others). They want the equivalent inside Cloud
Waste Hunter: log in once as themselves, see a list of clients they
operate, and switch between them — which is also the product's actual
real-world business model (an Azure Lighthouse-based MSP tool naturally
has one operator managing many customers' environments).

## Goal

Let one authenticated user ("operator") explicitly add named clients and
switch which client's data (`Ambientes`, `Dashboard`) they're currently
viewing, without re-authenticating, while keeping each client's data
strictly isolated from every other client — including from other,
unrelated operators who might sign into the app independently (e.g. a
different person testing their own account should never see this
operator's clients or vice versa).

## Explicit Non-Goals (deferred, not touched here)

- **Multiple operators sharing one client list.** The user confirmed only
  they will use this for now. The design (see Part 1) is forward-compatible
  with adding this later without a breaking data-model change, but the
  join-table/permissions work itself is not built now.
- **Editing or removing a client** once added.
- **Transferring a client between operators.**
- Everything already out of scope per the 2026-09-11 dashboard-redesign
  spec (remediation actions, automation, multicloud, etc.) remains out of
  scope here too — this spec only changes *whose* data is being viewed,
  not what's shown or what actions exist.

## Part 1 — Data model: self-referencing `Customer.operatorCustomerId`

Add one nullable, self-referencing column to the existing `Customer`
model — no new tables:

```prisma
model Customer {
  id                String     @id @default(cuid())
  entraTenantId     String     @unique
  name              String
  createdAt         DateTime   @default(now())
  operatorCustomerId String?
  operator          Customer?  @relation("OperatorClients", fields: [operatorCustomerId], references: [id])
  managedClients    Customer[] @relation("OperatorClients")
  users             User[]
  subscriptions     Subscription[]
}
```

- A `Customer` row created the normal way (via `getOrCreateCustomerForTenant`
  during sign-in — unchanged) has `operatorCustomerId = null`: it's a
  self-sufficient account, exactly like every `Customer` today. This is
  also what makes someone an "operator" — any signed-in user can add
  managed clients under their own `Customer.id`.
- A `Customer` row created explicitly by an operator (Part 3's "Adicionar
  cliente" form) gets `operatorCustomerId = <the creating operator's own
  Customer.id>` and a **placeholder, non-unique-constraint-breaking**
  `entraTenantId` — since a managed client never signs in itself, there's
  no real tenant id to key it by. Use `` `managed:${cuid()}` `` (a random
  id, not derived from anything guessable) to satisfy the existing
  `@unique` constraint without colliding with any real tenant id or
  another operator's managed clients.
- This is deliberately the minimal structure for "one operator, many
  clients." Moving to "many operators, many shared clients" later is a
  additive migration (a join table) that doesn't require touching this
  column or any code outside `getManagedClients`/`setActiveClient` (Part 2).

## Part 2 — Active-client resolution (`src/lib/tenant.ts`)

A new httpOnly cookie, `cwh-active-client`, holds the `Customer.id`
currently being viewed. `requireCustomerId()` changes from "return
`session.customerId`" to:

1. Read `session.customerId` (the operator's own identity — unchanged,
   always resolvable from the JWT as today).
2. Read the `cwh-active-client` cookie. If absent, return the operator's
   own `customerId` (today's exact behavior — the default, no-op case).
3. If present, look up that `Customer` row. It's only honored if
   `id === session.customerId` (switched back to yourself) **or**
   `operatorCustomerId === session.customerId` (a client you operate).
   Otherwise — stale cookie, another operator's client id, a tampered
   value — silently ignore it and fall back to the operator's own
   `customerId`. The cookie is never trusted without this DB check; this
   is the one enforcement point for the whole feature's data isolation.

A new server action, `setActiveClient(clientId: string)`
(`src/app/ambientes/actions.ts` or similar), performs the same ownership
check before writing the cookie — so the validation exists independently
of the UI, not only inside `requireCustomerId`'s defensive fallback.

**No other page or API route changes.** `/dashboard`, `/ambientes`, and
every `/api/subscriptions/*` route already call `requireCustomerId()` and
keep working unmodified — they just now resolve to whichever client is
active.

## Part 3 — UI

**Header switcher** (next to the existing name/locale/theme/sign-out
controls in `DashboardClient.tsx`'s nav): a dropdown showing "Minha conta"
(the operator's own name) plus each managed client's name, current
selection highlighted — same interaction pattern as the Azure Portal
directory switcher the user referenced. Selecting an entry calls
`setActiveClient` and reloads the current page so server-rendered data
reflects the new context.

**"Adicionar cliente" form**: a new section at the top of
`src/app/ambientes/page.tsx` / `AmbientesClient.tsx`, above the existing
"Adicionar ambiente" (subscription) form — a single name field, posting to
a new route or server action that creates the managed `Customer` row (Part
1) under the signed-in operator. After creation it appears in the header
switcher immediately.

**Resulting flow:** Ambientes → "Adicionar cliente" (name only) → switch
to it via the header dropdown → Ambientes (now scoped to that client, via
`requireCustomerId()`) → "Adicionar ambiente" (existing subscription +
Lighthouse flow, unchanged) → Dashboard shows that client's findings.

## Data Flow Summary

```
Sign-in (unchanged): getOrCreateCustomerForTenant -> Customer (operatorCustomerId: null) -> session.customerId

setActiveClient(clientId):
  verify clientId === session.customerId OR Customer(clientId).operatorCustomerId === session.customerId
    -> write cwh-active-client cookie (verified) | reject (unverified)

requireCustomerId() [used by every existing page/API, unchanged call sites]:
  session.customerId (operator identity)
  + cwh-active-client cookie, re-verified against the DB every call
    -> active Customer.id (defaults to session.customerId if cookie absent/invalid)

Ambientes "Adicionar cliente":
  create Customer { operatorCustomerId: session.customerId, entraTenantId: `managed:${cuid()}` }
```

## Testing

- Unit tests for the new resolution logic in `requireCustomerId()` (or a
  small extracted `resolveActiveCustomerId` helper): cookie absent ->
  operator's own id; cookie set to a client the operator owns -> that
  client's id; cookie set to an unrelated `Customer.id` (not owned by this
  operator) -> falls back to the operator's own id, not the unrelated one
  — this is the test that proves data isolation holds.
- Unit test for `setActiveClient`: rejects setting the cookie to a
  `Customer.id` the caller doesn't operate.
- The header switcher UI and "Adicionar cliente" form: manual/screenshot
  verification, consistent with this project's existing precedent for
  page-level interaction testing.

## Manual Validation

Once implemented: sign in, confirm the header shows only "Minha conta"
(no switcher clutter) until a client is added. Add a client via Ambientes,
confirm it appears in the switcher. Switch to it, confirm Ambientes shows
an empty environment list (new client, no subscriptions yet) and Dashboard
shows its own zeroed state — not the operator's own data. Add a
subscription under that client via the existing flow, confirm it only
shows up while that client is active, and disappears when switching back
to "Minha conta" or another client.
