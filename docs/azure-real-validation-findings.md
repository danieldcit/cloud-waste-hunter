# Real Azure validation — findings (2026-09-12)

Session goal: validate login, dashboard, environment connection, and the
scanner against a real Azure account/subscription instead of mocked data.
Everything below was validated read-only, at no cost.

## Findings

### 1. Cost Management API unavailable for trial/credit subscriptions

`Microsoft.CostManagement/query` and `.../forecast` return:

```
404 NotFound: Given subscription <id> doesn't have valid WebDirect/AIRS offer type.
```

Only Pay-As-You-Go (WebDirect) and Enterprise Agreement (AIRS) subscriptions
support the Cost Management APIs — free trial / Azure credit subscriptions
do not. `captureCostSnapshot` in `src/lib/scanner/runScan.ts` already
handles this gracefully via `Promise.allSettled`, falling back to
`monthToDateSpend: 0`, `projectedSpend: 0`, `dailyTrend: []`. This is why
the dashboard's cost cards and "Tendência de custo" chart show `$0.00` /
"sem dados ainda" for this subscription type — it's an Azure platform
limitation, not an app bug.

### 2. Personal Microsoft accounts collapse to a single tenant ID — fixed

With `auth.ts`'s issuer set to `https://login.microsoftonline.com/common/v2.0`
(required so personal accounts can sign in at all), the `tid` claim on the
ID token for **any** personal Microsoft account (outlook.com/hotmail.com/
live.com) is the fixed Microsoft placeholder tenant
`9188040d-6c67-4c5b-b112-36a304b66dad` ("consumers"), not a real per-user
tenant. Since `Customer.entraTenantId` is unique, every personal-account
user would bootstrap into the **same** `Customer` row — breaking
multi-tenant isolation for personal accounts. Work/school (Entra ID
organizational) accounts are unaffected — they get their real tenant id.

Fixed in the `jwt` callback: when `profile.tid` equals the consumers
placeholder, key the customer by `` `personal:${profile.sub}` `` instead of
the raw tenant id — `sub` is per-user-per-app and already what the
provider uses as the user's own `id`, so it correctly isolates one
personal-account user from another while organizational accounts keep
sharing a `Customer` row per real tenant, as intended. Validated by
signing out/in and confirming a new, correctly-isolated `Customer` row
was created; the existing test subscription was migrated onto it by
hand (one-off local DB cleanup, not part of the app).

### 3. Azure Lighthouse cannot delegate within the same tenant

`managedByTenantId` must differ from the target subscription's own tenant —
Azure rejects same-tenant registrations with
`InvalidRegistrationDefinitionCreateRequest`. This blocked testing the
in-app "Ambientes" Lighthouse connect flow end-to-end with a single
personal tenant. Additional findings along the way:

- The ARM template the "Lighthouse" button links to
  (`https://cloudwastehunter.blob.core.windows.net/templates/lighthouse.json`)
  does not exist — the hostname doesn't resolve. That storage
  account/blob was never provisioned; this is pre-existing unfinished
  infrastructure, not something this session broke.
- Creating a second Azure AD tenant to test cross-tenant delegation now
  requires a paid Microsoft Entra Workforce license (the tenant-creation
  blade shows *"Customers must own a paid license to create Microsoft
  Entra Workforce tenant"*). Confirmed via `subscribedSkus` that this
  Azure account has zero licenses — no free P1/P2 trial available.
- Worked around for validation purposes: connected the subscription
  through the UI, then marked it `CONNECTED` directly in Postgres
  (bypassing the Lighthouse verify gate). The scanner then authenticated
  via `DefaultAzureCredential`, which picked up the already-logged-in
  `az login` CLI session — valid because that session already has direct
  RBAC on the subscription, independent of Lighthouse.

### 4. Root route (`/`) is a placeholder, not the dashboard — fixed

`src/app/page.tsx` rendered only `<p>Cloud Waste Hunter</p>`. The real
dashboard is at `/dashboard`. NextAuth's default post-sign-in redirect
target is `/`, so users landed on the placeholder immediately after
login with no visible next step.

Fixed by checking the session in `src/app/page.tsx` and redirecting to
`/dashboard` when authenticated, rather than in an Auth.js `redirect`
callback — that callback fires for both sign-in *and* sign-out with the
same `{url: baseUrl}` shape, so an earlier attempt at this fix also
sent freshly-signed-out users to `/dashboard`, which then threw
(no session). Handling it in the page itself only affects authenticated
visits, so sign-out still lands on the (unauthenticated) placeholder as
before.

### 5. Browser "force dark mode" can override a correctly-implemented light theme

The app's light theme is correct — `bg-gray-50` resolves to a
high-lightness OKLCH value, and the dark Tailwind variant is properly
scoped to `.dark` via `@custom-variant dark (&:where(.dark, .dark *))`
(confirmed in the generated CSS: no `prefers-color-scheme` media query
present at all). Brave's "Force dark mode for web contents" setting was
repainting every page dark regardless of the underlying CSS/theme
state — including the *unstyled placeholder page*, which has zero
classes. That's what gave it away as a browser-level override rather
than an app bug. Disabling that Brave setting fixed it immediately.

## Changes made this session

- `src/auth.ts` — issuer changed to the `common` endpoint (was
  `organizations`) so personal Microsoft accounts can sign in, plus
  `prompt: select_account` so the account picker shows instead of
  silently reusing a cached session.
- `src/app/globals.css` — explicit `color-scheme: light` /
  `:root.dark { color-scheme: dark }`, so the page states its own
  preference to the browser (helps browsers' built-in auto-dark
  heuristics; does not override a dedicated forced-dark setting like
  Brave's, which repaints after render regardless).
- Azure AD App Registration `Cloud Waste Hunter (local dev)` created
  (multi-tenant + personal accounts) for local OAuth testing.
  `.env` (gitignored, not committed) populated with real
  `AUTH_MICROSOFT_ENTRA_ID_ID` / `_SECRET`, `AUTH_SECRET`,
  `LIGHTHOUSE_PROVIDER_PRINCIPAL_ID` / `_TENANT_ID`.

## Validated working end-to-end (real Azure, no cost incurred)

- Real Microsoft Entra ID login (personal account)
- Dashboard render, i18n, theme toggle
- Ambientes → add environment
- Scanner (`npm run scanner`) → Azure Resource Graph query → waste rules
  → Postgres, against a real subscription (0 resources found, correctly —
  the subscription has none of the tracked resource types)
