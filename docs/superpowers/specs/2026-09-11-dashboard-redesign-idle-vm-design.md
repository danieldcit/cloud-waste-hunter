# Cloud Waste Hunter — Dashboard Redesign + Idle VM Rule — Design Spec

**Status:** Approved by user, ready for implementation planning.

## Background

Fase 1 (`docs/superpowers/specs/2026-09-11-cloud-waste-hunter-core-design.md`,
`docs/superpowers/plans/2026-09-11-cloud-waste-hunter-core.md`) shipped a
read-only dashboard with four waste rules (orphaned disks, unassociated
public IPs, old snapshots, idle VPN gateways), Azure Lighthouse onboarding,
and finding dismissal. It was implemented, reviewed (including a final
whole-branch review that fixed two Critical defects), and pushed to
`https://github.com/danigomesdev/cloud-waste-hunter`.

The user then asked for a visual redesign matching a reference screenshot
(a polished "Cost Optimizer" SaaS dashboard: top nav with tabs, search bar,
stat cards, a cost trend chart, a filterable/actionable recommendations
table, a notifications panel) plus a large list of functionality: category
filters, one-click remediation, automation/rightsizing, multicloud billing,
tag-based cost allocation, forecasting/anomaly detection, and account/auth
flows.

That request describes several independent subsystems, most of which
either require new, security-sensitive capability (write/delete access to
customer Azure resources — currently deliberately Reader-only) or an
entirely new integration surface (AWS/GCP). Per the brainstorming process,
this was decomposed into sub-projects. **This spec covers only the first
sub-project the user chose to build now:** the dashboard visual redesign,
plus the one new waste-detection rule needed to power its "Computação"
filter (idle VMs by CPU utilization), plus two additive UI-infrastructure
pieces the user asked to fold in: light/dark theming and pt-BR/en/es
language switching.

## Goal

Redesign `/dashboard` to match the reference screenshot's look and
interaction model, backed by real data wherever Fase 1 already collects
it, with clearly-marked visual placeholders for pieces that belong to
later sub-projects. Add a fifth waste rule (idle virtual machines) so the
"Computação" filter has real data to show.

## Explicit Non-Goals (deferred sub-projects, not touched here)

These were named during decomposition and are out of scope for this spec
and its implementation plan. Nothing in this work should require them or
make assumptions that only make sense once they exist:

- **Remediation actions** (deleting/resizing/shutting down a resource for
  real). The "Take Action" button in this redesign performs today's only
  real mutation — dismissing a finding — nothing else. Fase 1's Global
  Constraint ("No remediation actions... in this phase") still holds.
- **Automation** (scheduled shutdown/startup, Spot migration, SKU
  rightsizing execution).
- **Multicloud** (AWS/GCP resource or cost integration). The app remains
  Azure-only.
- **Tag-based cost allocation and grouped reporting.**
- **Anomaly detection and a persisted notifications/alerting system**
  (spike detection, budget-threshold alerts, a notifications data model).
  The redesign's notifications panel remains a static visual placeholder
  only. (Note: real month-to-date spend and forecast — originally listed
  here as placeholders — are now in scope; see the amendment below.)
- **Password change / non-Entra account management.** Auth stays Entra ID
  SSO; the account menu only adds Sign out.

## Amendment to Fase 1's Global Constraints

Fase 1's spec said "No Azure Monitor integration... in this phase" and
"cost is estimated via a single Cost Management Query API call per
finding [only]." This sub-project deliberately amends both:

- Azure Monitor Metrics (read-only, covered by the existing Lighthouse
  Reader role — no new permission scope) is now in scope, solely to
  power the idle-VM rule (Part 1).
- Subscription-level Cost Management calls (month-to-date total spend,
  forecast, daily trend — still read-only, still Reader-scoped, still no
  export pipeline) are now in scope, to power real stat cards and a real
  trend chart (Part 2a) and the onboarding flow's first-scan feedback.

No other Fase 1 constraint changes: still Reader-only, still no
remediation, the four existing rules are unchanged, tenant scoping
(`requireCustomerId()`) still applies to every business-data query
without exception.

## Part 1 — New waste rule: idle virtual machines

**Rule:** a `microsoft.compute/virtualmachines` resource whose average
`Percentage CPU` over the last 30 days is below 5%.

Unlike the four existing rules (pure functions over `ResourceGraphRow[]`,
Tasks 6-9), this rule needs a per-VM Azure Monitor call and is therefore
async — the first waste rule with an I/O dependency of its own, structurally
closer to `estimateMonthlyCost` (Task 10) than to `findOrphanedDisks`.

**New files:**
- `src/lib/azure/monitorMetrics.ts` — `getAverageCpuPercent(resourceId: string, days?: number): Promise<number>`, calling `armFetch` against `GET {resourceId}/providers/Microsoft.Insights/metrics?api-version=2018-01-01&metricnames=Percentage CPU&timespan={ISO 8601 interval}&aggregation=Average&interval=P1D`, averaging the returned daily data points (a VM with no metrics — e.g. stopped/deallocated the whole period — returns `0`, which correctly flags it as idle).
- `src/lib/waste-rules/idleVirtualMachines.ts` — `findIdleVirtualMachines(resources: ResourceGraphRow[], getAverageCpuPercent = <real impl>): Promise<WasteFindingCandidate[]>`. Filters to `microsoft.compute/virtualmachines` (case-insensitive, matching the existing convention), calls the injected CPU-fetch function per VM, includes those `< 5`. The injectable second parameter is the seam tests use to avoid mocking `armFetch` two layers down — same spirit as `oldSnapshots`' injectable `now`.

**Schema change:** add `IDLE_VM` to the `WasteRuleType` enum in
`prisma/schema.prisma` — a new migration, additive only (no existing rows
affected).

**Scanner integration (`src/lib/scanner/runScan.ts`):**
- Add `'microsoft.compute/virtualmachines'` to `COMBINED_QUERY`'s type list.
- Await `findIdleVirtualMachines(resources)` alongside the four synchronous
  `find*` calls when building `candidates` (the four existing calls stay
  synchronous; this one is awaited before the array is assembled, or the
  four sync results and this one promise are combined — implementation's
  call, as long as all five rules' candidates end up in one `candidates`
  array before the per-candidate cost-estimation loop, unchanged from
  today).
- No change to the per-candidate cost-estimation/upsert loop, the
  try/catch-isolated cost lookup (final review Fix 4), or the
  dismissal-persistence fix (final review Fix 1) — this rule's candidates
  flow through that same, already-hardened path.

**Testing:** TDD, matching Tasks 6-10's rigor:
- `tests/lib/azure/monitorMetrics.test.ts` — mocks `armFetch`, covering:
  normal averaging across multiple data points, zero/no-data-points case,
  a case proving the metric-name/aggregation/timespan query parameters are
  actually what's sent (not just that *some* URL is called — Task 10's
  final-review-caught gap about unverified call arguments applies here
  too).
- `tests/lib/waste-rules/idleVirtualMachines.test.ts` — injects a fake CPU
  function; covers: VM under threshold → included, VM at/over threshold →
  excluded, non-VM resource → excluded (with a genuinely discriminating
  fixture per the Tasks 7-9 lesson: the excluded fixture must fail for the
  *type* reason, not coincidentally pass some other guard), and the
  boundary (`< 5`, not `<=`) made explicit in a comment since it's the same
  kind of unstated-boundary gap the old-snapshots rule had.
- `tests/lib/scanner/runScan.test.ts` — extended with a case seeding a VM
  resource, injecting a low CPU reading, asserting an `IDLE_VM` finding is
  persisted alongside whatever the other rules produce for the same scan.

## Part 2 — Dashboard redesign

**Scope:** `src/app/dashboard/page.tsx` is redesigned in place (it is
already gated by `requireCustomerId()` and already fetches real
`WasteFinding` rows — Task 13's data-fetching stays; only the presentation
and interactivity layer changes). It remains a Server Component for data
fetching; a new Client Component handles filtering/search/theme/language
so the interactive state lives client-side without turning the whole page
into one.

**Layout (matching the reference screenshot):**
- Top bar: logo + product name, a search input, nav tabs (**Dashboard**,
  **Recommendations**, and **Ambientes** active and pointing at real
  content — Ambientes is new, see Part 2a; **Reports** and **Automation**
  rendered visually identical but disabled — greyed out, not clickable,
  or leading to a static "coming soon" state — per the user's explicit
  choice, not hidden), an account menu (user's name/email from the
  session, a Sign out action, plus the theme and language switches — see
  Parts 3/4).
- A **subscription selector** (dropdown), visible when the customer has
  more than one `CONNECTED` subscription, scoping the stat cards and
  trend chart below to one subscription at a time. Defaults to the
  customer's first connected subscription. Hidden (or shown disabled with
  a single implicit selection) when there is exactly one.
- Stat cards row: **Potential Savings** and **Active Resources** are real,
  computed from the current customer's findings/resources exactly as
  `computeDashboardSummary` and a resource count already do today (these
  two remain cross-subscription totals, not affected by the selector).
  **Monthly Spending** and **Projected Bill** are now real too — sourced
  from the selected subscription's latest `CostSnapshot` (Part 2a). A
  subscription with no snapshot yet (brand new, first scan hasn't
  captured one) shows `$0.00` / an explicit "sem dados ainda" state rather
  than a fake number — this is the "tudo bem estar zerado" behavior the
  user asked for.
- **Cost Trend** chart: real daily spend for the selected subscription
  over the last 30 days, read from the same `CostSnapshot.dailyTrend`. A
  subscription with no snapshot yet renders an empty/zeroed chart, not a
  fake series.
- **Recommendations table**: real `WasteFinding` rows. Columns: category
  (derived, see mapping below), rule/recommendation, resource, an
  **Impact** badge (High/Medium/Low, computed client-side from
  `estimatedMonthlyCost` thresholds — display-only, not a stored field:
  suggest High ≥ $20/mo, Medium ≥ $5/mo, Low below that, adjustable during
  implementation), estimated savings, and a **Take Action** button that
  calls the existing `POST /api/findings/:id/dismiss` route and removes the
  row from the OPEN view — it does not delete or modify any Azure resource.
- **Notifications panel**: a static placeholder (fixed example entries),
  not wired to any real alerting.
- Category filter buttons (**Disco/Armazenamento**, **Computação**,
  **Rede**) filter the recommendations table by `ruleType`:
  - Disco/Armazenamento → `ORPHANED_DISK`, `OLD_SNAPSHOT`
  - Computação → `IDLE_VM`
  - Rede → `UNASSOCIATED_PUBLIC_IP`, `IDLE_VPN_GATEWAY`
  - No filter selected (default) → all rules shown
- Search input filters the currently-visible rows by resource id / rule
  name substring match, case-insensitive, client-side, live as the user
  types — no server round-trip.

**New/changed files (indicative — implementation plan owns exact naming):**
- `src/app/dashboard/page.tsx` — updated to pass findings + summary data
  into a new client component instead of rendering the table itself.
- `src/components/dashboard/DashboardClient.tsx` (or similar) — the client
  component owning filter/search/theme/language UI state.
- `src/lib/dashboard-categories.ts` — the `ruleType → category` mapping and
  the impact-threshold function, as small, independently testable pure
  functions (following the project's established preference for pure,
  unit-tested logic over untested inline JSX conditionals).

**Testing:** the category-mapping and impact-threshold functions get unit
tests (pure functions, cheap to test, real logic). The filtered-table
interaction itself (clicking a filter button, typing in search) is
verified manually via screenshot, consistent with how Task 13 left
`dashboard`/`connect`'s JSX itself untested — this project has not yet
introduced a component-testing setup (no React Testing Library / jsdom
component harness), and adding one is out of scope for this spec.

## Part 2a — Real subscription cost data + "Ambientes" (add-environment) flow

Task 12 already built three working API routes — `POST /api/subscriptions`,
`GET /api/subscriptions/connect-link`, `POST /api/subscriptions/:id/verify`
— but Task 13 never built a UI form on top of them; `/connect` only
renders a read-only list plus instructional text. The user wants the real
onboarding capability ("quando eu decidir monitorar um ambiente novo,
consiga adicionar de forma simples e iniciar o monitoramento") actually
wired up, and wants the dashboard's spend/forecast/trend to be real
queries rather than fixed placeholder numbers.

### New data: `CostSnapshot`

A new Prisma model, captured once per scan run (same 6-hour cadence as
everything else the scanner does), so the dashboard only ever reads from
Postgres — no live Azure calls on page view, consistent with the existing
architecture:

```prisma
model CostSnapshot {
  id               String       @id @default(cuid())
  subscriptionId   String
  subscription     Subscription @relation(fields: [subscriptionId], references: [id])
  capturedAt       DateTime     @default(now())
  monthToDateSpend Float
  projectedSpend   Float
  dailyTrend       Json // [{ date: string, cost: number }, ...] for the last 30 days
}
```

**New azure lib functions** (new file, e.g.
`src/lib/azure/subscriptionCost.ts`), each a single, read-only Cost
Management call at subscription scope (no `ResourceId` filter), Reader-
role-covered:

- `getSubscriptionMonthToDateSpend(azureSubscriptionId): Promise<number>`
  — Cost Management Query, `ActualCost`, `MonthToDate`, no resource
  filter.
- `getSubscriptionForecast(azureSubscriptionId): Promise<number>` — the
  Cost Management **Forecast** API
  (`POST /subscriptions/{id}/providers/Microsoft.CostManagement/forecast?api-version=2023-11-01`),
  a real Azure endpoint purpose-built for this, not custom math.
- `getSubscriptionDailyCostTrend(azureSubscriptionId, days = 30): Promise<{ date: string; cost: number }[]>`
  — Cost Management Query, `ActualCost`, `Custom` timeframe spanning the
  last `days` days, `granularity: "Daily"`.

**Scanner integration:** after `runScan`'s existing findings/upsert work
for a subscription, call the three functions above and persist one
`CostSnapshot` row. This is wrapped in its own try/catch, same isolation
principle as the final review's cost-estimation fix (Fix 4) — a failure
capturing the cost snapshot must not fail the scan or the findings it
already produced. A subscription's first scan may still fail to capture a
snapshot (e.g. Cost Management has no data yet for a brand-new
subscription) — that's fine; the dashboard's zero-state handles it.

**Dashboard reads:** the selected subscription's most recent
`CostSnapshot` (`orderBy: capturedAt desc, take: 1`, scoped through
`subscription: { customerId }` like every other query), or nothing if
none exists yet.

### "Ambientes" tab

A new route (e.g. `src/app/ambientes/page.tsx`, replacing `/connect`'s
role — `/connect` can redirect here or be removed, implementation's
call) reachable from the new nav tab, real functionality throughout:

- Lists the customer's subscriptions with their `status`
  (`PENDING` / `CONNECTED` / `ERROR`) and, for `CONNECTED` ones, their
  latest `CostSnapshot.capturedAt` as a "last scanned" indicator.
- **"+ Adicionar ambiente" form:** two fields, Azure Subscription ID and
  a display name, submitting to the existing `POST /api/subscriptions`.
  On success, the new row appears as `PENDING`.
- For a `PENDING` row: shows the Lighthouse deploy link/instructions
  (from the existing `GET /api/subscriptions/connect-link`) and a
  **"Verificar conexão"** button calling the existing
  `POST /api/subscriptions/:id/verify`. On success (200), the row flips to
  `CONNECTED` — and, per the existing route's own logic (unchanged), the
  first scan is already fired automatically in the background. No new
  "start monitoring" action is needed beyond what Task 12 already built;
  this sub-project's job is exposing it through a real form instead of
  leaving it API-only.
- On failure (409 — delegation not found yet), shows an inline retry
  message rather than a generic error.

**Testing:** the form's input validation (e.g., a basic Azure subscription
GUID shape check before submitting) as a pure, unit-tested function. The
page's fetch-and-render interaction: manual/screenshot verification, same
precedent as the rest of this spec's UI.

## Part 3 — Styling: Tailwind CSS

Add Tailwind CSS (`tailwindcss`, `postcss`, `autoprefixer` as
devDependencies; `tailwind.config.ts` with `darkMode: 'class'`; a
`src/app/globals.css` with the standard `@tailwind` directives, imported
from `src/app/layout.tsx`). This is the styling foundation for the whole
redesign, not only the theme toggle — the reference screenshot's layout
(cards, table, nav, badges) is built with Tailwind utility classes.

## Part 4 — Theme: light/dark

A small client-side `ThemeProvider` (React Context) toggles a `dark`
class on `<html>`, matching Tailwind's `class` dark-mode strategy. The
user's choice persists in `localStorage` (no new database column — this
is a device-local UI preference, not account data) and is applied on
initial load via a small inline script or a client-side effect that
tolerates the one-frame flash-of-wrong-theme rather than adding
server-side cookie plumbing. Default: light (matches the reference
screenshot). Toggle control lives in the account menu, top-right.

## Part 5 — Language: pt-BR / en / es

A lightweight custom i18n layer, no new routing:
- `src/lib/i18n/dictionaries.ts` (or one file per locale) — flat key→string
  maps for `pt-BR`, `en`, `es`, covering every user-facing label
  introduced or touched by this redesign (nav tabs, stat card labels,
  table headers, filter button labels, the account menu, empty states).
  Fase 1's existing dashboard/connect copy that isn't touched by this
  redesign does not need to be retrofitted into the dictionary as part of
  this spec — only what this redesign renders.
- `src/lib/i18n/LocaleProvider.tsx` (Context) + a `useTranslation()` (or
  similarly named) hook, mirroring the theme provider's shape.
- Persisted in `localStorage`, same as theme. Default: `pt-BR` (matches
  the current `<html lang="pt-BR">` and the app's existing Portuguese
  copy). URLs do not change (no `/en/dashboard`-style prefixing).
- Toggle control lives in the account menu, next to the theme toggle.

**Testing:** the dictionary lookup function (given a key and a locale,
returns the right string, falls back sensibly if a key is missing) gets a
unit test. The providers/components themselves are covered by the same
manual/screenshot verification as the rest of the redesigned page.

## Data Flow Summary

```
Scanner (runScan):
  Resource Graph query (now includes VMs)
    -> 4 existing sync rules + findIdleVirtualMachines (async, calls Monitor)
    -> candidates[] (now can include IDLE_VM)
    -> per-candidate cost estimate (existing, error-isolated) + upsert (existing, dismissal-safe)
    -> [own try/catch] subscription cost snapshot (MTD spend, forecast, daily trend) -> CostSnapshot row

Dashboard page (Server Component):
  requireCustomerId() -> WasteFinding rows + resource count (unchanged)
                      -> customer's CONNECTED subscriptions + selected one's latest CostSnapshot (new)
    -> passed as props to DashboardClient

DashboardClient (Client Component):
  local state: activeCategoryFilter, searchText, selectedSubscriptionId, theme, locale (persisted)
    -> derives visible rows from props + filter/search state
    -> renders table, cards (real: savings/resources/spend/forecast; placeholder: notifications), chart (real, zero-state if no snapshot), nav, account menu
    -> "Take Action" click -> POST /api/findings/:id/dismiss (existing route, unchanged) -> optimistic row removal

Ambientes page:
  list subscriptions + latest scan indicator
    -> "+ Adicionar ambiente" form -> POST /api/subscriptions (existing)
    -> "Verificar conexão" -> POST /api/subscriptions/:id/verify (existing) -> CONNECTED -> runScan fires (existing)
```

## Manual Validation

Once implemented: `npm run dev`, visit `/dashboard` with a real or
mock-seeded session, confirm: the three category filters correctly
partition real findings, search narrows the visible rows, theme toggle
switches light/dark without a full reload, language toggle switches all
redesigned labels across pt-BR/en/es, and the "Take Action" button
dismisses a finding via the existing route. On **Ambientes**, add a new
subscription through the real form, verify the connection, and confirm
the dashboard's subscription selector picks it up — showing a zeroed
spend/forecast/chart state until its first scan captures a `CostSnapshot`.
This is a manual pass (no new automated E2E harness), same spirit as
Fase 1's Task 15.
