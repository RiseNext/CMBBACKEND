# ARCHITECTURE

Rise Next Banking Services — Loan Tracking & Management CRM.

> ⚠️ **Staleness notice, added 2026-09-02 by the Phase 1 final review.** The baseline commit below is now **seven commits behind `HEAD` (`7b33b35`)** and this document received no Phase 1 update. Its test figures are correct **for that baseline only**. Current measured totals are **171 backend cases across 8 files** (was 107 across 4 — Phase 1 added `cors` 16, `cookie-config` 17, `session-invalidation` 11 and `customer-lookup` 20) and **55 frontend cases across 5 files** (was zero). `employee-lifecycle.test.ts` is no longer untracked — it was committed in `583897f`. Treat every "107", "82" and "zero frontend tests" below as history, not as current fact; the live figures live in [CURRENT_STATE.md](CURRENT_STATE.md) and [FEATURE_STATUS.md](FEATURE_STATUS.md).

**What this document is.** A description of the architecture that exists in this
repository, verified against source. Every factual claim carries a `file:line`
citation. Anything that could not be confirmed from code is marked
`UNVERIFIED`. Nothing aspirational is recorded here — if a component is absent,
it is listed as `MISSING` with the evidence for its absence.

**Baseline.** Commit `7ef5da5` ("Add frontend-only employee demo"). The working
tree is **dirty**: 8 modified files and 4 untracked files together implement
employee creation, temporary-password issue, admin password reset, and forced
password change. Where HEAD and the working tree differ, both are documented and
the divergence is called out explicitly.

**Status vocabulary used throughout.**

| Label | Meaning |
|---|---|
| `IMPLEMENTED` | Exists, wired end to end, exercised by code paths that run. |
| `PARTIAL` | Exists but incomplete — e.g. server side present, no client caller; or declared but never enforced. |
| `DEMO` | Exists and works, but is a browser-only simulation with no server involvement. |
| `MISSING` | Does not exist. Proof of absence given. |

---

## 1. System overview

Two independently deployable applications and one database, in a single Git
monorepo with no workspace tooling (no root `package.json`, no Turborepo/Nx —
`ls` of the repo root shows only `.env.example`, `README.md`, `backend/`,
`docs/`, `frontend/`).

| Tier | Technology | Version source |
|---|---|---|
| Frontend | Next.js App Router + React | `next 16.2.12`, `react 19.2.0` — `frontend/package.json:31-34` |
| Backend | Express 5 + TypeScript ESM | `express ^5.1.0` — `package.json:26`; `"type": "module"` — `package.json:5` |
| ORM | Drizzle | `drizzle-orm ^0.44.7` — `package.json:24` |
| Driver | node-postgres `Pool` | `pg ^8.16.3` — `package.json:30`; pool constructed at `src/db/index.ts:19-25` |
| Database | PostgreSQL (Neon-targeted) | `src/db/index.ts:11-15` |
| Password hashing | argon2id | `package.json:20`; parameters at `src/lib/password.ts:8-13` |
| Session | JWT HS256 access (15m, in memory) + rotating httpOnly refresh cookie (7d) | `src/lib/tokens.ts:20-38,66-89`; `frontend/src/lib/api.ts:17` |

### 1.1 Architecture diagram — what actually exists

```
┌──────────────────────────── BROWSER TAB ────────────────────────────┐
│                                                                     │
│  Next.js 16 App Router  (all rendering client-side after the first  │
│  paint; no middleware.ts, no app/api/, no Server Actions)           │
│                                                                     │
│   app/layout.tsx  (server component)                                │
│     └─ ThemeProvider ─ AuthProvider ─ ReferenceProvider ─           │
│           TooltipProvider ─ <Toaster/>                              │
│              │                                                      │
│              ├── /login                (public, "use client")       │
│              └── (app)/layout.tsx ─ AppShell  ← route guard         │
│                    ├─ /dashboard /customers /loans /bank-orders     │
│                    │  /disbursement /settlements /transactions      │
│                    │  /ledger /documents /banks /employees          │
│                    │  /my-work /notifications /recycle-bin          │
│                    │  /reports /settings /change-password           │
│                                                                     │
│   ┌───────────── frontend/src/lib/api.ts :: apiRequest ───────────┐ │
│   │  THE SINGLE CHOKEPOINT. Every HTTP call in the app goes here. │ │
│   │                                                               │ │
│   │  line 118  if (isDemoMode())  ─────────────┐                  │ │
│   │  line 129  build URL, attach Bearer        │                  │ │
│   │  line 151  fetch(credentials:"include")    │                  │ │
│   │  line 153  on 401 → refresh → replay once  │                  │ │
│   └────────────────────────────────────────────┼──────────────────┘ │
│                        │                       │                    │
│         accessToken: module variable           │  DEMO SHORT-CIRCUIT│
│         (api.ts:17 — never localStorage)       │  (first-class path)│
│                        │                       ▼                    │
│                        │        lib/demo/api.ts :: demoRequest      │
│                        │        651 lines. Reimplements the API     │
│                        │        contract in the browser, enforces   │
│                        │        the Executive permission set,       │
│                        │        throws DemoHttpError → ApiError.    │
│                        │                       │                    │
│                        │                       ▼                    │
│                        │        sessionStorage: risenext.demo.*     │
│                        │        (lib/demo/session.ts:13-59)         │
│                        │        NOTHING LEAVES THE TAB.             │
└────────────────────────┼────────────────────────────────────────────┘
                         │  HTTPS, CORS allow-list, credentials:true
                         │  Authorization: Bearer <15m access JWT>
                         │  Cookie: rn_refresh (httpOnly, path=/api/auth)
                         ▼
┌──────────────────── EXPRESS 5 API  (src/app.ts) ────────────┐
│  trust proxy → helmet → cors → requestId → json → urlencoded →      │
│  cookie-parser → pino-http → 22 route mounts → 404 → errorHandler   │
│                                                                     │
│  Per router:  requireAuth  (verify JWT, then RE-READ the user's     │
│               role/permissions/banks from SQL on EVERY request)     │
│                    ↓                                                │
│               requirePermission(PERMISSIONS.x.y)                    │
│                    ↓                                                │
│               bankScope(ctx, table.bankId)   ← tenant isolation     │
│                    ↓                                                │
│               recordAudit(...)                                      │
│                                                                     │
│  9 of the resource routers are produced by ONE factory:             │
│  modules/scoped-resource.ts :: createScopedResource                 │
└──────────────────────────────┬──────────────────────────────────────┘
                               │  node-postgres Pool (max 10 prod / 5 dev)
                               │  TLS unless host contains "localhost"
                               ▼
┌──────────────── POSTGRESQL (Neon-shaped, not provisioned) ──────────┐
│  27 tables · 62 FKs · 7 triggers · 0 CHECK constraints              │
│  3 SQL migration files in drizzle/, applied by an           │
│  explicit `npm run db:migrate` — NEVER on API boot.                 │
│  Migrations use DIRECT_DATABASE_URL; the app uses DATABASE_URL.     │
└─────────────────────────────────────────────────────────────────────┘

ABSENT FROM THIS DIAGRAM BECAUSE ABSENT FROM THE REPOSITORY:
  email/SMTP · object storage · job queue · cache · Redis · WebSockets
  APM/tracing · CI pipeline · container image · deployment
```

### 1.2 The demo short-circuit — a first-class path

`DEMO` — this is not a test fixture or dead code. It is a fully realised second
runtime that serves the entire application from the browser.

| Aspect | Detail |
|---|---|
| Entry | `frontend/src/lib/api.ts:118` — `if (isDemoMode()) return await demoRequest<T>(path, options)`. This is the first statement in `apiRequest`, before any URL is constructed. |
| Credential match | `frontend/src/hooks/use-auth.tsx:174` — `isDemoCredentials(email, password)` is evaluated in `signIn` **before any network call exists**. Comparison at `frontend/src/lib/demo/config.ts:81-83`. |
| Credentials | `demo.employee@risenext.com` — `frontend/src/lib/demo/config.ts:14-15`. Fictional; grants nothing server-side. |
| Flag storage | `sessionStorage`, keys `risenext.demo.session` / `risenext.demo.data` — `frontend/src/lib/demo/config.ts:18-19`, accessors `frontend/src/lib/demo/session.ts:13-59`. Dies with the tab. |
| Handler | `frontend/src/lib/demo/api.ts` (651 lines) + `data.ts` (838 lines) + `store.ts` (65 lines). Mirrors the real envelope: `{data, meta}` for lists, `{data}` for records, `undefined` for 204 — `frontend/src/lib/demo/api.ts:9-12`. |
| Authorization | Enforced in-browser against a hardcoded copy of the seeded `executive` permission set — `frontend/src/lib/demo/config.ts:29-42`, checked at `frontend/src/lib/demo/api.ts:54`. |
| Route confinement | `DEMO_ROUTES` (10 paths) at `frontend/src/lib/demo/config.ts:57-68`; enforced by `AppShell` at `frontend/src/components/layout/app-shell.tsx:28-32`, which redirects to `/my-work`. |
| Error translation | `DemoHttpError` → `ApiError` at `frontend/src/lib/api.ts:120-126`, so pages cannot tell the two runtimes apart. |

**Known defect in the demo lifecycle.** `disableDemoMode()` has exactly one call
site: `frontend/src/hooks/use-auth.tsx:212`, inside the demo branch of
`signOut`. The real branch of `signIn`
(`frontend/src/hooks/use-auth.tsx:187-201`) never clears the flag. A tab that
enters demo mode and then signs in with real credentials without signing out
first keeps `risenext.demo.session === "active"`, so `apiRequest` continues to
short-circuit to `demoRequest` and the real session's data is never fetched.
`enableDemoMode()` does clear the stale *dataset*
(`frontend/src/lib/demo/session.ts:33`) but not this hazard in the reverse
direction.

---

## 2. Frontend architecture

### 2.1 Rendering model — `IMPLEMENTED`

`PARTIAL` as an App Router application: the App Router is used purely as a file
system router. Nothing server-rendered beyond the initial shell.

| Fact | Evidence |
|---|---|
| No route middleware | `frontend/middleware.ts` and `frontend/src/middleware.ts` both absent (verified by `ls`). No edge auth, no server-side redirect on unauthenticated access. |
| No API routes | `frontend/src/app/api/` absent. The Next.js server never proxies or terminates an API call. |
| No Server Actions | Zero `"use server"` directives in `frontend/src/`. |
| 19 of 20 `page.tsx` files are client components | Every page under `(app)/` plus `login/page.tsx` opens with `"use client"`. |
| The exceptions | `frontend/src/app/page.tsx` (server component, `redirect("/login")` at line 4), `frontend/src/app/layout.tsx`, `frontend/src/app/(app)/layout.tsx`, `frontend/src/app/not-found.tsx` — all server components. |
| Config surface is near-empty | `frontend/next.config.ts` sets only `reactStrictMode: true` and an unrestricted image `remotePatterns` allow-list (`hostname: "**"`, line 6). No rewrites, no headers, no CSP. |

**Consequence.** All authentication and authorization on the client are
*rendering decisions*, not request-time gates. A user who disables JavaScript, or
who reads the JS bundle, sees the full route table. The server is the only real
enforcement boundary — which is architecturally correct, but means no page-level
protection exists before hydration.

### 2.2 Layout tree

```
app/layout.tsx                    SERVER — metadata, <ThemeScript/>, Google Fonts <link>
  └─ <ThemeProvider>              use-reference.tsx:145   (reads DOM class via useSyncExternalStore)
       └─ <AuthProvider>          use-auth.tsx:82         (session, permissions, signIn/signOut)
            └─ <ReferenceProvider> use-reference.tsx:34   (banks + users + teams, loaded once)
                 └─ <TooltipProvider delayDuration={200}>
                      ├─ {children}
                      └─ <Toaster position="top-right" richColors closeButton/>   (sonner)

  app/page.tsx                    SERVER — redirect("/login")
  app/login/page.tsx              CLIENT — public
  app/not-found.tsx               SERVER
  app/(app)/layout.tsx            SERVER — renders <AppShell>
    └─ AppShell                   CLIENT — app-shell.tsx:13, the sole client-side route guard
         ├─ Sidebar / Topbar / <main> / footer
         └─ 19 page routes
```

Provider order is fixed at `frontend/src/app/layout.tsx:29-36`. `ThemeProvider`
must sit outermost because the pre-paint theme script
(`frontend/src/components/theme-script.tsx`, invoked at `layout.tsx:19`) has
already stamped the class onto `<html>`; the provider only reads it back
(`frontend/src/hooks/use-reference.tsx:140-148`).

### 2.3 The `AppShell` guard — `PARTIAL`

`frontend/src/components/layout/app-shell.tsx` holds three guards, all
client-side, all evaluated after hydration:

| Guard | Lines (working tree) | Behaviour |
|---|---|---|
| Unauthenticated | `20-22` | `ready && !user` → `router.replace("/login")` |
| Demo out-of-scope | `28-32` | demo session on a non-demo route → `router.replace("/my-work")` |
| Forced password change | `39-44` | `ready && user.mustChangePassword && pathname !== "/change-password"` → `router.replace("/change-password")` |

All three collapse into one render gate at line 48: the shell renders a
"Loading workspace" spinner *instead of mounting children*, so a page the account
cannot reach never renders even for a frame (comment at lines 46-47).

**HEAD vs working tree.** At HEAD the third guard does not exist. `git diff`
shows lines 11 and 34-44 added, and line 48's condition extended from
`!ready || !user || outOfScope` to include `|| mustChangePassword`.

### 2.4 The `apiRequest` chokepoint — `IMPLEMENTED`

`frontend/src/lib/api.ts` is the only module in the frontend that calls `fetch`
against the API. Everything else goes through it.

```
apiRequest(path, options)                                   api.ts:114
  ├─ 118  demo short-circuit (§1.2)
  ├─ 129  URL = `${API_BASE_URL}/api${path}`  + query params (empty/null dropped, 130-134)
  ├─ 136  headers: Authorization from module-scope accessToken (137)
  │                Content-Type: application/json unless formData (138-140)
  ├─ 142  send(): fetch { credentials: "include", signal, body }
  ├─ 151  response = await send()
  ├─ 153  if 401 and !skipAuthRetry:
  │         154  token = await refreshAccessToken()        ← de-duplicated, see below
  │         155  if !token → forceSignOut() + throw ApiError(401)
  │         159  replace Authorization header
  │         160  response = await send()                   ← ONE replay only
  │         161  if still 401 → forceSignOut() + throw
  ├─ 167  !ok → throw await parseError(response)
  ├─ 168  204 → return undefined
  └─ 169  return response.json()
```

Thin verb helpers sit on top at `api.ts:177-192`: `list`, `get`, `create`
(POST), `update` (PATCH), `replace` (PUT), `remove` (DELETE), `action` (POST with
`{}` default body), `upload` (POST FormData).

`API_BASE_URL` resolves from `process.env.NEXT_PUBLIC_API_URL` with a
`http://localhost:8080` fallback and a trailing-slash strip — `api.ts:13-15`.

### 2.5 Token handling — `IMPLEMENTED`

| Token | Where it lives | Why |
|---|---|---|
| Access (15m) | Module-scope `let accessToken: string \| null` — `frontend/src/lib/api.ts:17` | Never in `localStorage`/`sessionStorage`, so XSS cannot exfiltrate it from storage and it dies on tab close. Rationale comment at `api.ts:1-8`. |
| Refresh (7d) | httpOnly cookie `rn_refresh`, `path=/api/auth` — `src/lib/tokens.ts:83,89` | JS cannot read it; the browser attaches it automatically because every request sets `credentials: "include"` (`api.ts:89, 146`). |

**Refresh de-duplication.** `refreshInFlight` (`api.ts:18`) memoises the in-flight
refresh promise (`api.ts:85`) and clears it in `finally` (`api.ts:98`). Without
this, concurrent 401s would each POST `/api/auth/refresh`, and because the server
*rotates and revokes* on every refresh (§5), the second call would land on an
already-revoked token and trip reuse detection, nuking every session. The comment
at `api.ts:83-84` states exactly this.

**Forced sign-out fan-out.** `forceSignOut()` (`api.ts:34-37`) nulls the token and
invokes a listener set registered via `onForcedSignOut` (`api.ts:29-32`).
`AuthProvider` subscribes at `frontend/src/hooks/use-auth.tsx:152-162` and does
`router.replace("/login")`. This is how a non-React module drives navigation.

**Session bootstrap.** On mount, `AuthProvider` (a) restores a cached profile from
`localStorage["risenext-auth-user"]` for instant paint
(`use-auth.tsx:98-114`), then (b) POSTs `/auth/refresh` with
`skipAuthRetry: true` to obtain a real access token and authoritative profile
(`use-auth.tsx:116-142`). On failure it clears everything. The cached profile is
*never* trusted for authorization — `can()` reads `user.permissions`
(`use-auth.tsx:259-263`), but the server re-derives permissions per request
regardless (§3.4), so a tampered `localStorage` entry only changes what buttons
render.

The demo session is deliberately excluded from that cache —
`persistAuthUser` returns early when `isDemoMode()` (`use-auth.tsx:68`).

### 2.6 Data fetching — `PARTIAL`

There is **no data-fetching library and no cache**. No React Query, no SWR, no
Apollo, no Zustand/Redux — `frontend/package.json:13-37` lists only Radix
primitives, chart.js, framer-motion, lucide, sonner, tailwind-merge, clsx and
cva.

Everything is hand-rolled in `frontend/src/hooks/use-api.ts`:

| Hook | Lines | Semantics |
|---|---|---|
| `useResource<T>(path, query, enabled)` | `22-81` | `useEffect` + `api.list`. Keyed by `JSON.stringify(query)` (`30`). Returns `[]` on error, never fixtures (`64-67`, rationale `18-21`). Manual invalidation only, via a `nonce` counter (`28, 78`). |
| `useRecord<T>(path)` | `84-136` | Single record. Same nonce pattern. |
| `useStats<T>(path)` | `139-176` | Dashboard KPIs. Zeroes on empty DB, never invented numbers (`138`). |

**Architectural consequences, stated plainly:**

- No deduplication. Two components mounting `useResource("/loans")` issue two
  HTTP requests.
- No cache. Navigating away and back always refetches.
- No background revalidation, no stale-while-revalidate, no optimistic updates.
- Invalidation is manual and local: a mutation calls the `refresh()` returned by
  the hook that owns the list. Nothing propagates across hooks.
- `AbortController` is created in `useResource` (`44`) but its `signal` is never
  passed to `api.list` — only the `cancelled` boolean actually suppresses the
  state update (`58, 63`). The abort at line 74 therefore cancels nothing.

`ReferenceProvider` (`frontend/src/hooks/use-reference.tsx:34-108`) is the one
place with cross-page sharing: banks, users (`pageSize: 200`) and teams are
fetched once per session and exposed as `bankName(id)` / `employeeName(id)` /
`teamName(id)` lookups (`97-103`). Each of the three requests is allowed to fail
independently (`settle()` at `63-64`) so a user without `users.view` still gets
bank names.

### 2.7 Fake handlers — `PARTIAL` / `MISSING` write path

A set of UI actions call `refresh()` and raise a success toast **without issuing
any HTTP request**. The corresponding backend endpoint exists and is never
called. These are listed exhaustively because they are the largest gap between
what the UI appears to do and what the system does.

| Page | Line | Handler | Backend route that exists but is never called |
|---|---|---|---|
| `loans/page.tsx` | 68 | `updateStatus` | `PATCH /api/loans/:id`, `POST /api/loans/:id/approve` |
| `bank-orders/page.tsx` | 58 | `moveStage` | `PATCH /api/bank-orders/:id` |
| `bank-orders/page.tsx` | 64 | `saveRemark` | `PATCH /api/bank-orders/:id` |
| `disbursement/page.tsx` | 81 | `markCredited` | `PATCH /api/disbursements/:id` |
| `disbursement/page.tsx` | 87 | `retry` | `PATCH /api/disbursements/:id` |
| `settlements/page.tsx` | 35 | `markPaid` | `PATCH /api/settlements/:id` |
| `settlements/page.tsx` | 44 | `raiseDispute` | `PATCH /api/settlements/:id` |
| `transactions/page.tsx` | 36 | `settle` | `PATCH /api/transactions/:id` |
| `documents/page.tsx` | 104 | `setStatus` | `PATCH /api/documents/:id` |
| `documents/page.tsx` | 109 | `remove` | `DELETE /api/documents/:id` |
| `customers/[id]/page.tsx` | 458 | Save changes | `PATCH /api/customers/:id` |
| `customers/[id]/page.tsx` | 483 | Delete | `DELETE /api/customers/:id` |
| `customers/[id]/page.tsx` | 185 | Print | — |
| `customers/page.tsx` | 232 | `handleManualFormUpload` — reads a `File`, discards it, toasts "queued for verification" | — (no upload endpoint exists, §9) |

`bank-orders/page.tsx` and `customers/[id]/page.tsx` make **zero** write calls of
any kind.

### 2.8 Frontend/backend coverage

The frontend calls **27 distinct METHOD+path pairs**. **69 of the 96 backend
endpoints (60%) have zero frontend callers.** The read half of that surface is
pinned by `src/tests/frontend-contract.test.ts:62-86`, a 25-entry
`FRONTEND_CALLS` array of GET requests asserted to return 200 for a seeded super
admin.

---

## 3. Backend architecture

### 3.1 Process lifecycle — `IMPLEMENTED`

`src/server.ts` is the entrypoint (`npm start` → `node dist/server.js`,
`package.json:11`).

1. `env()` — parse and cache configuration; throws on invalid config
   (`server.ts:8`).
2. `await getDb().execute(sql\`select 1\`)` — **refuse to start if the database is
   unreachable** (`server.ts:10-16`, `process.exit(1)`).
3. `createApp().listen(PORT)` (`server.ts:18-20`).
4. SIGTERM/SIGINT → stop accepting connections, `closeDb()`, exit 0; a 10-second
   unref'd timer forces exit 1 if draining stalls (`server.ts:22-32`).

Note step 2 checks connectivity only. **Migrations are not run on boot** (§4.3).

### 3.2 Middleware chain, in order — `IMPLEMENTED`

All of `src/app.ts`, `createApp()` at line 37.

| # | Line | Middleware | Notes |
|---|---|---|---|
| 0 | `41` | `app.set("trust proxy", 1)` | One proxy hop — needed for correct `req.ip` behind Railway/Vercel. Feeds the login audit trail (`auth.routes.ts:44`). |
| 0 | `42` | `app.disable("x-powered-by")` | |
| 1 | `44-49` | `helmet()` | `contentSecurityPolicy: false` — API-only, the frontend sets its own (comment line 46). `crossOriginResourcePolicy: cross-origin`. |
| 2 | `52-63` | `cors()` | Explicit allow-list callback (`56-59`), because `credentials: true` forbids a wildcard origin (comment `54-55`). Origins parsed from `CORS_ORIGIN` by `corsOrigins()` (`config/env.ts:64-68`). Requests with **no** `Origin` header are allowed (line 57). Methods: GET, POST, PATCH, PUT, DELETE, OPTIONS. |
| 3 | `65-68` | request id | `x-request-id` header, else `randomUUID()`. Typed onto `Request` at `src/types/express.d.ts:7`. |
| 4 | `70` | `express.json({ limit: "1mb" })` | |
| 5 | `71` | `express.urlencoded({ extended: true, limit: "1mb" })` | |
| 6 | `72` | `cookieParser()` | Required for the `rn_refresh` cookie. |
| 7 | `74-76` | `pinoHttp` | **Skipped entirely when `NODE_ENV === "test"`.** Request id threaded via `genReqId`. |
| 8 | `78-99` | 22 route mounts | Table below. |
| 9 | `101` | `notFoundHandler` | `404 {error:{code:"not_found"}}` — `middleware/error-handler.ts:36-38`. |
| 10 | `102` | `errorHandler` | §3.5. |

**Not present anywhere in the chain:** rate limiting, request timeout, body
sanitisation, CSRF token, compression, ETag control. See §9.

### 3.3 The 22 mounts

`src/app.ts:78-99`.

| Line | Mount | Router | Origin | Endpoints |
|---|---|---|---|---|
| 78 | `/api` | `healthRouter` | `health.routes.ts` | 2 |
| 79 | `/api/auth` | `authRouter` | `auth.routes.ts` | 5 |
| 80 | `/api/banks` | `banksRouter` | `banks.routes.ts` | 5 |
| 81 | `/api/customers` | `customersRouter` | `customers.routes.ts` | 6 |
| 82 | `/api/users` | `usersRouter` | `admin.routes.ts` | 6 (working tree) / 5 (HEAD) |
| 83 | `/api/roles` | `rolesRouter` | `admin.routes.ts` | 6 |
| 84 | `/api/teams` | `teamsRouter` | `admin.routes.ts` | 4 |
| 85 | `/api/loans` | `loansRouter` | **factory** + 1 hand-written | 6 + 1 |
| 86 | `/api/verifications` | `verificationsRouter` | **factory** | 5 |
| 87 | `/api/bank-orders` | `bankOrdersRouter` | **factory** | 5 |
| 88 | `/api/disbursements` | `disbursementsRouter` | **factory** | 5 |
| 89 | `/api/settlements` | `settlementsRouter` | **factory** | 5 |
| 90 | `/api/transactions` | `transactionsRouter` | **factory** | 4 |
| 91 | `/api/ledger` | `ledgerRouter` | **factory** | 4 |
| 92 | `/api/documents` | `documentsRouter` | **factory** | 5 |
| 93 | `/api/funding-sources` | `fundingSourcesRouter` | **factory** | 5 |
| 94 | `/api/service-providers` | `serviceProvidersRouter` | hand-written | 3 |
| 95 | `/api/recycle-bin` | `recycleBinRouter` | `admin.routes.ts` | 3 |
| 96 | `/api/audit-logs` | `auditRouter` | `admin.routes.ts` | 1 |
| 97 | `/api/notifications` | `notificationsRouter` | `admin.routes.ts` | 3 |
| 98 | `/api/imports` | `importsRouter` | `imports.routes.ts` | 4 |
| 99 | `/api/dashboard` | `dashboardRouter` | `operations.routes.ts` | 3 |

**Endpoint totals — HEAD vs working tree.**

| | Hand-written | Factory-generated | Total |
|---|---|---|---|
| HEAD `7ef5da5` | 51 | 44 | **95** |
| Working tree | 52 | 44 | **96** |

The single added endpoint is `POST /api/users/:id/reset-password`
(`src/modules/admin.routes.ts:325-383`, untracked at HEAD — verified by
`git show HEAD:src/modules/admin.routes.ts` yielding 22 route handlers
against 23 in the working tree).

> **Correction to the working baseline.** The figure "96 = 52 + 44" describes the
> **working tree**, not HEAD. HEAD is 95 = 51 + 44.

### 3.4 `createScopedResource` — the resource factory — `IMPLEMENTED`

`src/modules/scoped-resource.ts:74-322`. Nine of the twenty-two mounts
are produced by a single call to this function, configured declaratively in
`src/modules/operations.routes.ts`.

**The stated rationale** (`scoped-resource.ts:66-73`):

> Builds a router whose every handler goes through the same four gates:
> authenticate -> permission -> bank scope -> audit.
>
> Writing ten of these by hand is how one resource ends up missing its scope
> filter. The factory makes that failure mode structurally impossible: there is
> exactly one place the WHERE clause is assembled.

**Emitted routes.** Four unconditionally, two conditionally:

| Route | Line | Condition | Guard |
|---|---|---|---|
| `GET /` | `102` | always | `permissions.view` |
| `GET /:id` | `155` | always | `permissions.view` |
| `POST /` | `170` | always | `permissions.create` |
| `PATCH /:id` | `205` | always | `permissions.edit` |
| `DELETE /:id` | `252` | only if `permissions.delete` set (`251`) | `permissions.delete` |
| `POST /:id/approve` | `272` | only if `permissions.approve` set (`271`) | `permissions.approve` |

`requireAuth` is applied to the whole router at `scoped-resource.ts:78`.

**Per-resource emission** (config at `operations.routes.ts`):

| Resource | Config line | delete? | approve? | Count |
|---|---|---|---|---|
| loans | `50` | yes | yes | 6 |
| verifications | `185` | no | yes | 5 |
| bank-orders | `215` | yes | no | 5 |
| disbursements | `248` | no | yes | 5 |
| settlements | `283` | no | yes | 5 |
| transactions | `321` | no | no | 4 |
| ledger | `351` | no | no | 4 |
| documents | `380` | yes | no | 5 |
| funding-sources | `405` | yes | no | 5 |
| | | | **Total** | **44** |

**`scopedWhere` — the single WHERE assembly point** (`scoped-resource.ts:93-100`):

```ts
function scopedWhere(req, extra: SQL[] = []): SQL | undefined {
  const ctx = authOf(req);
  const filters: SQL[] = [isNull(deletedAtColumn), ...extra];
  const scope = bankScope(ctx, bankColumn);
  if (scope) filters.push(scope);
  return and(...filters);
}
```

Every read in the factory — list (`130`), get-by-id (`160`), the pre-image reads
in patch (`215`), delete (`259`) and approve (`284`) — goes through it. Soft
delete is folded in at the same point.

**Additional guarantees the factory provides:**

| Behaviour | Line | Why it matters |
|---|---|---|
| `bankId` query filter narrows but never widens | `109-113` | `assertBankAccess(ctx, query.bankId)` runs before the filter is appended. |
| Create asserts against the **payload** `bankId` | `177` | A hand-crafted body cannot plant a record in a foreign bank. |
| Patch asserts the **destination** bank on reassignment | `221-223` | Otherwise scoping could be escaped by moving a record out. |
| 404, not 403, for out-of-scope records | `162-163` | Existence is not leaked. Same choice at `lib/errors.ts:21-27`. |
| Human codes generated centrally | `87-91` | `LN-1001`, `DSB-5001`, `BO-2401`, `STL-3301`, `TXN-77001`, `LG-9001`. **Note:** `nextCode()` derives the suffix from `count(*)` over the whole table, which is not collision-proof under concurrency or after hard deletes. |
| Numeric coercion | `54-64` | Drizzle wants strings for `numeric`; the API takes numbers. |
| `beforeWrite` hook for cross-record invariants | `39-42` | Used for the same-bank checks at `operations.routes.ts:96-99, 241-245, 276-280` and the settlement arithmetic check at `310-318`. |

**Deliberately excluded from the factory:** `serviceProvidersRouter`
(`operations.routes.ts:437`). Service providers are not bank-owned; the comment at
`operations.routes.ts:432-436` explains that feeding a null bank column into the
scope filter would silently hide every row from scoped users.

### 3.5 `loadAuthContext` — per-request authorization resolution — `IMPLEMENTED`

`src/services/access.ts:30-86`, called from
`src/middleware/auth.ts:26` on every authenticated request.

**The rationale, verbatim** (`services/access.ts:25-29`):

> Resolves everything authorisation needs in one round trip. Called per request
> rather than trusted from the JWT so that a permission revoked by an admin
> takes effect on the user's very next request instead of at token expiry.

And at the middleware (`middleware/auth.ts:15-20`):

> Verifies the access token, then re-reads the user's role, permissions and
> bank assignments from the database on every request. Slightly more expensive
> than trusting claims in the JWT, and worth it: a revoked permission or a
> deactivated account takes effect immediately rather than at token expiry.

**Actual SQL cost — up to 3 round trips, not one.** The "one round trip" phrasing
in the comment is inaccurate against its own body:

| # | Line | Query | Always? |
|---|---|---|---|
| 1 | `31-49` | `users INNER JOIN roles WHERE id = ? AND deleted_at IS NULL LIMIT 1` | yes |
| 2 | `55-59` | `role_permissions INNER JOIN permissions WHERE role_id = ?` | yes |
| 3 | `65-68` | `SELECT bank_id FROM user_bank_access WHERE user_id = ?` | **only if** the role lacks `system.access_all_banks` (guard at `64`) |

So: 2 queries for an unrestricted user, 3 for a bank-scoped one, on **every
authenticated request**. **There is no cache of any kind** — no in-process LRU,
no Redis, no TTL. Confirmed by inspection of the function body and by the absence
of any cache dependency in `package.json:19-33`.

**Rejections raised inside the loader**, before any route logic runs:

| Line | Condition | Response |
|---|---|---|
| `51` | user row absent (deleted or unknown id) | 401 `Account no longer exists` |
| `52` | `users.status !== "Active"` | 403 `Account is not active` |
| `53` | `roles.is_active` false | 403 `Assigned role has been disabled` |

**Returned shape** — `AuthContext` (`services/access.ts:8-23`), attached to
`req.auth` and typed globally at `src/types/express.d.ts:5-9`. Field
`mustChangePassword` (`access.ts:19`) is **added in the working tree only**
(`git diff` shows lines 18-19, 38 and 82 added).

### 3.6 Guard composition

`requireAuth` is applied at router scope, never per-handler, in all 12 places it
appears: `admin.routes.ts:39,474,698,807,898,949`, `banks.routes.ts:14`,
`customers.routes.ts:16`, `imports.routes.ts:17`, `operations.routes.ts:438,519`,
`scoped-resource.ts:78`.

| Guard | Location | Semantics |
|---|---|---|
| `requireAuth` | `middleware/auth.ts:21-31` | Bearer parse (`7-13`) → `verifyAccessToken` → `loadAuthContext` → `req.auth`. |
| `authOf(req)` | `middleware/auth.ts:33-36` | Non-null accessor; throws 401 if unset. |
| `requirePermission(...keys)` | `middleware/auth.ts:39-49` | ALL of the listed keys. Comment line 38: *"Always reference PERMISSIONS.*, never a role name."* |
| `requireAnyPermission(...keys)` | `middleware/auth.ts:52-64` | ANY of the listed keys. |

### 3.7 Error handling — `IMPLEMENTED`

`src/middleware/error-handler.ts:40-88`. Uniform envelope:
`{ error: { code, message, details? } }`.

| Input | Line | Output |
|---|---|---|
| `ZodError` | `46-55` | 422 `validation_failed` + per-issue `{path, message}` |
| `AppError` | `57-63` | Its own `status`/`code`; logged only when `status >= 500` |
| pg `23505` (unique violation) | `66-76` | 409 `conflict`, with a human message from a 7-entry constraint map (`12-21`) |
| pg `23503` (FK violation) | `77-82` | 409 `conflict` — "still referenced by other records" |
| anything else | `84-87` | 500 `internal_error`, full error logged with `requestId` |

`rootCause()` (`28-34`) walks up to 5 `.cause` levels because Drizzle wraps driver
errors in `DrizzleQueryError`; without it every unique violation would surface as
a 500 (comment `23-27`).

The `AppError` taxonomy lives in `src/lib/errors.ts`: `badRequest` 400,
`unauthorized` 401, `forbidden` 403, `notFound` 404, `conflict` 409,
`unprocessable` 422, `tooManyRequests` 429, `internal` 500.

`forbidden` is deliberately identical for "you lack the permission" and "that
record belongs to a bank you cannot see" (`errors.ts:21-25`) — returning 404 for
out-of-scope records would leak existence, and a distinct message would leak
which banks exist.

### 3.8 Logging — `PARTIAL`

`src/lib/logger.ts` — a single pino instance.

- Level from `LOG_LEVEL`, defaulting to `silent` under `NODE_ENV=test`, else
  `info` (`logger.ts:3`). **`LOG_LEVEL` is not in the env schema** (§7).
- 12 redaction paths covering `authorization`, `cookie`, `set-cookie`,
  `*.password`, `*.passwordHash`, `*.password_hash`, `*.currentPassword`,
  `*.newPassword`, `*.aadhaar`, `*.aadhaarHash`, `*.token`, `*.refreshToken`,
  `*.accessToken` (`logger.ts:11-28`).
- Output is stdout only. No transport, no file, no aggregator, no sampling.

---

## 4. Database & migrations

### 4.1 Connection — `IMPLEMENTED`

`src/db/index.ts`. Lazy singleton `Pool` + lazy singleton Drizzle
instance.

| Setting | Value | Line |
|---|---|---|
| `max` | 10 in production, 5 otherwise | `21` |
| `idleTimeoutMillis` | 20 000 | `22` |
| `connectionTimeoutMillis` | 10 000 | `23` |
| `ssl` | `false` if the URL contains `localhost`, else `{ rejectUnauthorized: true }` | `24` |
| Drizzle options | `{ schema, casing: "snake_case" }` | `31` |

Rationale (`db/index.ts:11-15`): *"Neon terminates idle connections aggressively
and Railway containers are small, so the pool is kept deliberately narrow. Point
`DATABASE_URL` at Neon's pooled endpoint; migrations use `DIRECT_DATABASE_URL`."*

`setDb(instance)` (`db/index.ts:36-38`) is a test seam — the suite injects a
PGlite-backed Drizzle instance through it (`tests/harness.ts:44`).

### 4.2 Schema — `IMPLEMENTED`

**27 tables. Zero drift between SQL and TypeScript.**

| Group | File | `pgTable` count |
|---|---|---|
| Identity | `src/db/schema/identity.ts` | 7 |
| Domain | `src/db/schema/domain.ts` | 3 |
| Governance | `src/db/schema/governance.ts` | 5 |
| Operations | `src/db/schema/operations.ts` | 12 |
| | | **27** |

Migrations declare exactly 27: 15 `CREATE TABLE` in `0000_init.sql` + 12 in
`0002_operations.sql`. Barrel re-export at `src/db/schema/index.ts`.

| Artefact | Count | Location |
|---|---|---|
| Foreign keys | 62 | 20 in `0000_init.sql`, 42 in `0002_operations.sql` |
| Triggers | 7 | all in `0001_governance_guards.sql` — `audit_logs_no_update` (`:16`), `banks_touch_updated_at` (`:31`), `customers_touch_updated_at` (`:36`), `users_touch_updated_at` (`:41`), `roles_touch_updated_at` (`:46`), `teams_touch_updated_at` (`:51`), `roles_protect_system` (`:81`) |
| CHECK constraints | **0** | All value-domain enforcement is Zod-side, in `createSchema` definitions. A direct SQL write can store any string in a status column. |

### 4.3 Migrations — `IMPLEMENTED`, manual

Three files in `drizzle/`, plus `meta/_journal.json` and three snapshots:

| File | Contents |
|---|---|
| `0000_init.sql` | 15 tables (identity + governance + domain), 20 FKs |
| `0001_governance_guards.sql` | 7 triggers. No tables. |
| `0002_operations.sql` | 12 operations tables, 42 FKs |

**Generation.** `drizzle-kit generate` (`package.json:15`), configured by
`drizzle.config.ts` — `schema: ./src/db/schema/index.ts`, `out: ./drizzle`,
`dialect: postgresql`, `strict: true`.

**Application.** `src/db/migrate.ts` is a standalone script run by
`npm run db:migrate` → `tsx src/db/migrate.ts` (`package.json:16`).

```
migrate.ts:13   url = DIRECT_DATABASE_URL ?? DATABASE_URL
migrate.ts:14   new Pool({ connectionString: url, max: 1, ssl: ... })
migrate.ts:21   migrate(drizzle(pool), { migrationsFolder: "./drizzle" })
migrate.ts:23   finally → pool.end()
```

Rationale (`migrate.ts:7-10`): *"Migrations run against Neon's DIRECT (non-pooled)
endpoint. Running DDL through the pooler can fail or deadlock on session-scoped
locks."*

**Migrations do NOT run on boot.** `src/server.ts` calls `env()`, a
`select 1` connectivity probe, then `listen()` — it never imports the migrator.
Deploying a schema change requires an operator to run `npm run db:migrate`
manually against the direct endpoint. `README.md:204` documents this as a manual
step.

Seeding is likewise a separate manual script: `npm run db:seed` →
`src/db/seed.ts` (`package.json:17`), which writes the permission
catalogue, the default roles, and — only if `BOOTSTRAP_SUPERADMIN_EMAIL` and
`_PASSWORD` are both set — the bootstrap super admin (`seed.ts:82-94`).

### 4.4 Test database — `IMPLEMENTED`

`src/tests/harness.ts:36-48` runs **the same migration files that ship to
production** against PGlite (Postgres compiled to WASM), then invokes the real
`seed()`. Comment at `harness.ts:13-17`: *"If a constraint, index or trigger is
wrong, it fails here rather than in production."*
`vitest.config.ts:12` sets `fileParallelism: false` because PGlite
instances are per-file and memory must stay predictable.

**Test inventory (107 runtime cases):**

| File | Static `it()` | `it.each` | Effective |
|---|---|---|---|
| `authorization.test.ts` | 26 | 0 | 26 |
| `workflow.test.ts` | 22 | 0 | 22 |
| `frontend-contract.test.ts` | 9 | 1 (over a 25-entry array, `:62-86`) | 34 |
| `employee-lifecycle.test.ts` *(untracked)* | 25 | 0 | 25 |
| | | | **107** |

**Zero frontend tests. Zero E2E tests. No CI** — see §8.

---

## 5. Authentication architecture — `IMPLEMENTED`

All of `src/modules/auth.routes.ts` and `src/lib/tokens.ts`.

### 5.1 Token specification

| Property | Access token | Refresh token |
|---|---|---|
| Algorithm | HS256 (jsonwebtoken default) | HS256 |
| Secret | `JWT_ACCESS_SECRET` (≥32 chars) | `JWT_REFRESH_SECRET` (≥32 chars) |
| TTL | `ACCESS_TOKEN_TTL`, default `15m` (`config/env.ts:13`) | `REFRESH_TOKEN_TTL_DAYS`, default 7 (`config/env.ts:14`) |
| `issuer` / `audience` | `risenext-crm` / `risenext-crm-api` (`tokens.ts:24-25`) | same (`tokens.ts:34-35`) |
| Claims | `sub, email, roleId, roleKey, roleLevel, tokenType:"access"` (`tokens.ts:5-12`) | `sub, jti, tokenType:"refresh"` (`tokens.ts:14-18`) |
| Transport | `Authorization: Bearer` header | httpOnly cookie `rn_refresh` (`tokens.ts:89`) |
| Server-side record | none (stateless) | SHA-256 hash row in `refresh_tokens` (`auth.routes.ts:39-45`) |
| Cross-type confusion | rejected — `tokenType` asserted at `tokens.ts:46` and `:59` | same |

**Cookie attributes** (`tokens.ts:66-87`): `httpOnly: true`; `secure` and
`sameSite: "none"` in production, `sameSite: "lax"` otherwise;
`path: "/api/auth"`; `maxAge = REFRESH_TOKEN_TTL_DAYS × 86 400 000`; `domain` only
if `COOKIE_DOMAIN` is set. Rationale (`tokens.ts:79-81`): the frontend and API are
different sites in production, so the cookie must be `SameSite=None`, which
requires `Secure`, which requires CORS to send credentials with an explicit
origin.

The narrow `path=/api/auth` means the refresh cookie is transmitted **only** on
`/api/auth/*` requests — it is not sent on ordinary API traffic.

### 5.2 Endpoints

| Method | Path | Line | Auth | Behaviour |
|---|---|---|---|---|
| POST | `/api/auth/login` | `81` | none | credentials → session |
| POST | `/api/auth/refresh` | `157` | cookie | rotate → new access + new refresh |
| POST | `/api/auth/logout` | `195` | cookie | revoke this token, clear cookie, 204 |
| GET | `/api/auth/me` | `212` | Bearer | `{ user: profileOf(ctx) }` |
| POST | `/api/auth/change-password` | `221` | Bearer | rotate password, revoke ALL sessions, 204 |

### 5.3 Login flow (`auth.routes.ts:81-151`)

1. Zod-parse `{email, password}` (`83`, schema `23-26`); lowercase + trim (`85`).
2. `users INNER JOIN roles` on the normalised email, excluding soft-deleted
   (`87-101`).
3. **Lockout check** (`103-106`): if `locked_until > now()`, record a
   `login_failed` audit event and throw 429.
4. **Timing equalisation** (`108-111`): a verification always runs, against
   `DUMMY_HASH` (a real argon2id digest, `154-155`) when the account is absent, so
   response time does not reveal whether the address exists.
5. **Failure path** (`113-129`): increment `failed_login_attempts`; at
   `MAX_FAILED_ATTEMPTS = 8` (`28`) set `locked_until = now + LOCKOUT_MINUTES = 15`
   (`29`). Audit, then throw 401 `Invalid email or password` — the same message
   for unknown account and wrong password.
6. **Post-auth gates** (`131-132`): `status !== "Active"` → 403;
   `roles.is_active` false → 403.
7. Reset counters, stamp `last_login_at` (`134-137`).
8. `issueSession` (`31-57`) → response (`142-147`).

The comment at `auth.routes.ts:74-80` records a deliberate design decision: *"the
client does not tell us which role it wants. The demo frontend let the user pick
from a dropdown; the role now comes from the user record and nowhere else."*

**`issueSession` (`31-57`)** — the only place a session is minted:
`loadAuthContext` → `jti = randomUUID()` → sign refresh → insert
`refresh_tokens { userId, tokenHash: sha256(refresh), expiresAt, userAgent, ipAddress }`
→ sign access with the freshly-loaded role claims → `res.cookie(...)`.

Only the SHA-256 of the refresh JWT is stored (`auth.routes.ts:41`), so a database
read cannot yield a usable token.

### 5.4 Refresh, rotation and reuse detection (`auth.routes.ts:157-193`)

```
cookie present?                       160  → 401 "No refresh token"
verifyRefreshToken(cookie)            162  → 401 on bad sig / expiry / wrong type
lookup by sha256(cookie)              166-170
if !stored || revokedAt || expired:   172
      if stored.revokedAt:            174        ← REUSE DETECTED
          revoke EVERY token for      175-178      update refresh_tokens
          claims.sub                                set revoked_at = now()
                                                    where user_id = claims.sub
      throw 401 "Session expired"     180
revoke the presented token            183-186   ← ROTATION
issueSession(...) → new pair          188
respond { accessToken, expiresIn, user }  189
```

The reuse branch is the security-critical one. Comment at `auth.routes.ts:174`:
*"Reuse of a revoked token is treated as compromise: kill every session."* Because
rotation revokes on every successful refresh, a stolen cookie replayed after the
legitimate client has refreshed will land on a revoked row and terminate all of
that user's sessions.

`/api/auth/refresh` returns the **full profile**, not just a token
(`auth.routes.ts:189`). This is what lets `AuthProvider` bootstrap a session from
nothing but the cookie (`use-auth.tsx:118-130`).

### 5.5 Password lifecycle

| Aspect | Detail |
|---|---|
| Algorithm | argon2id, `memoryCost: 19456`, `timeCost: 2`, `parallelism: 1` — `lib/password.ts:8-13`. Comment: OWASP 2024 low-memory baseline, sized for a small container. |
| Policy | ≥12 chars, one lowercase, one uppercase, one digit — `lib/password.ts:89-98`. No symbol requirement, no denylist, no history, no expiry. |
| Client mirror | `frontend/src/lib/password-policy.ts:10-20` — identical rules, explicitly documented as advisory (`:1-7`: *"The server remains the authority"*). **Untracked.** |
| Verification | `argon2.verify` wrapped to return `false` rather than throw — `lib/password.ts:19-25`. |
| Change | `POST /auth/change-password` (`auth.routes.ts:221-262`): verify current → re-check policy → rehash → set `password_changed_at`, clear `must_change_password` → **revoke every refresh token for the user** (`251-254`) → clear cookie → 204. |

**Temporary password generation — working tree only.**
`generateTemporaryPassword()` (`lib/password.ts:72-87`, added by the working-tree
diff) produces a 14-character credential from an alphabet that omits `0/O` and
`1/l/I` (`lib/password.ts:51-55`) because the value is read off a screen and typed
by hand. One character of each required class is seeded first, then the rest
filled, then Fisher–Yates shuffled with rejection-sampled bytes (`75-84`) — so the
result is *guaranteed* to satisfy `passwordProblems`, never merely likely to.
At HEAD, user creation used `randomToken(12)` instead
(`git diff src/modules/admin.routes.ts`, line 171 replaced).

**Admin reset — working tree only.**
`POST /api/users/:id/reset-password`
(`src/modules/admin.routes.ts:325-383`), guarded by
`PERMISSIONS.users.resetPassword`. Inside one transaction it sets a new hash,
`must_change_password = true`, clears `failed_login_attempts`/`locked_until`
(so a reset also unlocks), revokes every non-revoked refresh token for the
target, and writes a `password_reset` audit entry. The plaintext is returned
exactly once in the response body and stored nowhere. `assertCanManageRoleLevel`
is applied first, so a peer or superior cannot have their account taken over.

### 5.6 `mustChangePassword` enforcement — `PARTIAL`

This is the most important caveat in the authentication story.

| Layer | Status | Evidence |
|---|---|---|
| Written to the DB | `IMPLEMENTED` | set `true` on reset (`admin.routes.ts:344`), cleared on change (`auth.routes.ts:245`) |
| Carried on `AuthContext` | `IMPLEMENTED` *(working tree)* | `services/access.ts:19, 38, 82` |
| Returned on the profile | `IMPLEMENTED` *(working tree)* | `auth.routes.ts:70` — so a page reload cannot drop the client out of the forced change (comment `68-69`) |
| Returned on the login response | `IMPLEMENTED` | `auth.routes.ts:145` |
| **Enforced as a server-side guard** | **`MISSING`** | No middleware in `src/middleware/` reads it; no route asserts it. `requireAuth` (`middleware/auth.ts:21-31`) loads the flag and ignores it. |
| Enforced in React | `IMPLEMENTED` *(working tree)* | `frontend/src/components/layout/app-shell.tsx:39-48` |

**Consequence.** A user holding a temporary password receives a fully privileged
access token and can exercise every endpoint their role permits by talking to the
API directly. The forced-change flow is a UI convention, not a security control.

---

## 6. Authorization architecture — `IMPLEMENTED`

### 6.1 Permission catalogue

`src/lib/permissions.ts:11-134`. **76 permission keys across 20 groups.**
Declared once, in one place. Comment at `permissions.ts:1-7`: *"This is the only
place permission strings are declared. Routes reference
`PERMISSIONS.customers.create` — never a role name."*

| Group | Keys | Count |
|---|---|---|
| `customers` | view, create, edit, delete, import, export | 6 |
| `banks` | view, create, edit, delete, assign | 5 |
| `users` | view, create, edit, delete, assign, reset_password | 6 |
| `roles` | view, create, edit, delete, assign_permissions | 5 |
| `teams` | view, create, edit, delete, assign | 5 |
| `requests` | view, create, edit, delete, assign, approve, import | 7 |
| `verification` | view, create, edit, approve | 4 |
| `bank_orders` | view, create, edit, delete | 4 |
| `funding_sources` | view, create, edit, delete | 4 |
| `service_providers` | view, create, edit, delete | 4 |
| `disbursements` | view, create, edit, approve | 4 |
| `settlements` | view, create, edit, approve | 4 |
| `transactions` | view, create, edit | 3 |
| `ledger` | view, create, edit | 3 |
| `documents` | view, upload, delete | 3 |
| `reports` | view | 1 |
| `audit_logs` | view | 1 |
| `recycle_bin` | view, restore, permanent_delete | 3 |
| `settings` | view, edit | 2 |
| `system` | access_all_banks, manage_any_user | 2 |
| | **Total** | **76** |

`ALL_PERMISSIONS` (`permissions.ts:153-163`) flattens the catalogue into seed rows,
deriving `resource`/`action` by splitting on `.` and supplying a generated
description unless overridden by the 4-entry `DESCRIPTIONS` map (`146-151`).

**Declared but never enforced** (`PARTIAL`). The following keys are seeded into
the database and grantable in the UI, but no route guard references them
(verified by grepping `PERMISSIONS.<group>` across `src/` and excluding
`lib/permissions.ts` itself): `settings.view`, `settings.edit`,
`customers.export`, `requests.import`, `banks.assign`. `settings.view` is granted
to Admin (`permissions.ts:230`) but has nothing to gate — the `app_settings`
table it would govern is dead (§9).

**The domain-name mismatch worth knowing.** The loan resource is guarded by the
`requests.*` group, not a `loans.*` group — see `operations.routes.ts:53-59`.
`requests.approve` therefore controls `POST /api/loans/:id/approve`.

### 6.2 Role hierarchy

`src/lib/permissions.ts:190-313`. Seed data, not law (`permissions.ts:171-172`).

| Key | Name | Level | `isSystem` | Permissions |
|---|---|---|---|---|
| `super_admin` | Super Admin | 0 | **true** | `"*"` — the whole catalogue |
| `admin` | Admin | 10 | false | 12 full groups + selected users/roles/audit/recycle/settings keys + `system.access_all_banks` (`205-232`) |
| `manager` | Manager | 20 | false | full customers/requests/verification/bank_orders/documents; read-mostly elsewhere (`240-260`) |
| `team_leader` | Team Leader | 30 | false | 21 keys, no delete anywhere (`268-290`) |
| `executive` | Executive | 40 | false | 12 keys, view + create only (`298-311`) |

**The one rule** (`services/access.ts:133-149`, verbatim):

> ROLE HIERARCHY
>
> Lower level == more authority. An actor may only operate on a subject whose
> role level is strictly greater than their own. Consequences that fall out of
> this one rule, with no role names in the code:
>   - Admin (10) cannot create or edit another Admin (10)  -> not strictly >
>   - Admin (10) cannot touch Super Admin (0)              -> not strictly >
>   - Admin (10) can manage Manager (20) and below         -> strictly >
>   - Super Admin (0) holds system.manage_any_user         -> bypasses

Implemented as `assertCanManageRoleLevel` (`services/access.ts:144-149`): return
early if the actor holds `system.manage_any_user`; otherwise throw 403 when
`targetLevel <= ctx.roleLevel`.

**Derived guards built on the same rule:**

| Function | Line | Purpose |
|---|---|---|
| `assertCanAssignRole` | `151-159` | Only a holder of `system.manage_any_user` may assign `super_admin`; otherwise the level rule applies. |
| `assertCanGrantPermissions` | `166-174` | **Anti-escalation.** You cannot grant a permission you do not hold. Comment `161-165`: without it, an Admin with `roles.assign_permissions` could mint a role holding `system.access_all_banks` and assign it to themselves. |
| `assertRoleMutable` | `177-181` | System roles are renameable but never deletable and never re-keyable. Also enforced in SQL by the `roles_protect_system` trigger (`0001_governance_guards.sql:81`). |

`src/lib/permissions.ts:1-7` and `README.md:19-21` both claim there is no
`if (role === "admin")` anywhere in the codebase. Consistent with everything read
for this document — the only role-key comparison found is
`target.key === SUPER_ADMIN_ROLE_KEY` at `services/access.ts:155`, which guards
role *assignment*, not capability.

### 6.3 Bank scoping — the tenant-isolation chokepoint

`ctx.bankIds` is `null` for a holder of `system.access_all_banks` (never
populated — `services/access.ts:63-70`), otherwise the array of `bank_id` values
from the `user_bank_access` join table.

**`bankScope(ctx, column)`** — `services/access.ts:108-111`. Comment `101-107`:
*"The single choke point for tenant isolation."*

```ts
export function bankScope(ctx: AuthContext, column: PgColumn): SQL | undefined {
  if (ctx.bankIds === null) return undefined;                     // unrestricted
  return inArray(column, ctx.bankIds.length > 0 ? ctx.bankIds : [NO_BANK_SENTINEL]);
}
```

**Fails closed.** `NO_BANK_SENTINEL = "00000000-0000-0000-0000-000000000000"`
(`services/access.ts:114`) — a UUID that can never exist. A user with zero bank
assignments gets a predicate that matches nothing, rather than an empty `IN ()`
that Drizzle might render as a no-op. This is the difference between "sees
nothing" and "sees everything".

**`assertBankAccess(ctx, bankId)`** — `services/access.ts:121-127`. The write-side
counterpart, called before reading or writing any bank-owned record *including on
the `bankId` supplied in a request body*. Comment `116-120`: *"This is what stops
an executive changing a path parameter or a payload field to reach another bank's
data."* Note line 123: for a scoped user, a **missing** `bankId` is a 403, not a
pass-through.

| Layer | Mechanism | Reference |
|---|---|---|
| Factory reads | `bankScope` inside `scopedWhere` | `scoped-resource.ts:97` |
| Factory create | `assertBankAccess(ctx, parsed.bankId)` | `scoped-resource.ts:177` |
| Factory patch (bank reassignment) | `assertBankAccess(ctx, parsed.bankId)` | `scoped-resource.ts:221-223` |
| Factory list `?bankId=` | `assertBankAccess` before the filter is added | `scoped-resource.ts:110-112` |
| Hand-written routes | `bankScope` called explicitly | e.g. `operations.routes.ts:114, 584, 603` |
| Dashboard raw SQL | separate `scopeFor(column)` builder emitting `true` / `false` / `IN (...)` | `operations.routes.ts:527-532` |
| Cross-record integrity | `assertSameBank` — a customer/loan must belong to the same bank as the record pointing at it | `operations.routes.ts:33-48`, rationale `28-32` |

Note the dashboard uses a **parallel** implementation of scoping
(`operations.routes.ts:527-532`) rather than `bankScope`, because it composes raw
SQL sub-selects. It is correct — `ids.length === 0` yields `sql\`false\`` — but it
is a second copy of the rule, not the chokepoint.

---

## 7. Configuration

### 7.1 Backend environment variables

Schema: `src/config/env.ts:4-26`, Zod-validated. `loadEnv()` throws a
formatted aggregate error on any failure (`env.ts:36-43`); rationale at
`env.ts:32-35`: *"Fail fast on boot. A backend that starts with a missing JWT
secret is worse than one that refuses to start."* `env()` caches
(`env.ts:55-58`); `resetEnvCache()` (`60-62`) exists for tests.

Secret values are never printed in this document.

| Name | Required | Default | Declared | Consumed at | Notes |
|---|---|---|---|---|---|
| `NODE_ENV` | no | `development` | `env.ts:5` | `app.ts:74`, `db/index.ts:21,24`, `tokens.ts:75`, `env.ts:44` | enum `development\|test\|production` |
| `PORT` | no | `8080` | `env.ts:6` | `server.ts:18` | coerced positive int |
| `DATABASE_URL` | **yes** | — | `env.ts:8` | `db/index.ts:20,24`; fallback in `migrate.ts:13` | Neon **pooled** endpoint |
| `DIRECT_DATABASE_URL` | no | — | `env.ts:9` | `migrate.ts:13` | Neon **direct** endpoint; DDL through the pooler can deadlock |
| `JWT_ACCESS_SECRET` | **yes** | — | `env.ts:11` | `tokens.ts:27,42` | min 32 chars |
| `JWT_REFRESH_SECRET` | **yes** | — | `env.ts:12` | `tokens.ts:37,55` | min 32 chars; must differ from the access secret in production (`env.ts:48-50`) |
| `ACCESS_TOKEN_TTL` | no | `15m` | `env.ts:13` | `tokens.ts:23`; echoed at `auth.routes.ts:144,189` | jsonwebtoken duration string; **not format-validated** |
| `REFRESH_TOKEN_TTL_DAYS` | no | `7` | `env.ts:14` | `tokens.ts:33,84`; `auth.routes.ts:37` | coerced positive int |
| `COOKIE_DOMAIN` | no | — | `env.ts:15` | `tokens.ts:85` | omitted from the cookie when unset |
| `CORS_ORIGIN` | no | `http://localhost:3000` | `env.ts:17` | `app.ts:51` via `corsOrigins()` | comma-separated allow-list. **Defaulting rather than requiring this in production is a latent risk.** |
| `FRONTEND_URL` | no | `http://localhost:3000` | `env.ts:18` | **nowhere in application code** | Set only in `tests/setup.ts:10` and `tests/harness.ts:25`. **Dead variable.** |
| `BOOTSTRAP_SUPERADMIN_EMAIL` | no | — | `env.ts:20` | `db/seed.ts:82` | first boot only |
| `BOOTSTRAP_SUPERADMIN_PASSWORD` | no | — | `env.ts:21` | `db/seed.ts:83,94` | must satisfy `passwordProblems` |
| `RECYCLE_BIN_RETENTION_DAYS` | no | `30` | `env.ts:23` | `services/recycle-bin.ts:96` | |
| `MAX_UPLOAD_MB` | no | `10` | `env.ts:24` | `modules/imports.routes.ts:29` | Excel import only; no general upload path exists (§9) |
| `AADHAAR_PEPPER` | no (dev) / **yes (prod)** | `dev-only-pepper-change-me!!` | `env.ts:25` | `customers.routes.ts:81`, `imports.routes.ts:414` | min 16 chars. Production boot **throws** if left at the default (`env.ts:44-47`). Rotating it invalidates Aadhaar duplicate detection. |
| `LOG_LEVEL` | no | `info` (`silent` under test) | **not in the schema** | `lib/logger.ts:3` — read directly from `process.env` | Bypasses Zod validation entirely. |

**Production-only assertions** (`env.ts:44-51`), evaluated after parsing:

1. `AADHAAR_PEPPER` must not equal the development default.
2. `JWT_ACCESS_SECRET` must not equal `JWT_REFRESH_SECRET`.

### 7.2 Drift between `env.ts` and `.env.example`

The backend example file lives at the **repository root**, not at
`.env.example`. `.env.example` **does not exist** — confirmed by
`find . -name "*.env*"`, which returns only `./.env.example` and
`./frontend/.env.example`. `README.md:28` (`cd CMBBACKEND` … `cp .env.example .env`)
and `README.md:202` ("Set every variable in `.env.example`") both point at
a path that is not there.

| Variable | In `env.ts` | In `.env.example` | Verdict |
|---|---|---|---|
| `AADHAAR_PEPPER` | yes (`:25`) | **no** | **Missing from the example, and mandatory in production.** A deployment copied from the example boots in dev and *crashes* in prod at `env.ts:46`. Documented in `README.md:48` but not in the file operators actually copy. |
| `LOG_LEVEL` | **no** (read raw at `logger.ts:3`) | **no** | Undocumented and unvalidated. |
| `FRONTEND_URL` | yes (`:18`) | yes (`:21`) | Declared and documented but **consumed nowhere**. Dead. |
| `NEXT_PUBLIC_API_URL` | n/a | present in the backend example at `:32` | A frontend variable sitting in the backend example file, under a comment that redirects the reader to `frontend/.env.local` (`:31`). |
| everything else | yes | yes | aligned |

### 7.3 Frontend environment variables

`frontend/.env.example`:

| Name | Required | Default | Consumed at | Verdict |
|---|---|---|---|---|
| `NEXT_PUBLIC_API_URL` | no (falls back) | `http://localhost:8080` | `frontend/src/lib/api.ts:14` | The only frontend variable that does anything. |
| `NEXT_PUBLIC_APP_NAME` | — | — | **nowhere** | Dead. Zero references in `frontend/src/`. |
| `NEXT_PUBLIC_APP_ENV` | — | — | **nowhere** | Dead. Zero references in `frontend/src/`. |

`README.md:168` states *"`NEXT_PUBLIC_API_URL` is the only variable the frontend
needs"* — accurate, and the other two entries in the example file are noise.

There is no `frontend/.env.local` in the repository (correctly gitignored).

---

## 8. Deployment architecture — `MISSING`

### 8.1 What the README claims

| Claim | Location |
|---|---|
| "backend/ … deployed to Railway" | `README.md:7` |
| `Vercel (Next.js) ──HTTPS──> Railway (Express API) ──TLS──> Neon (PostgreSQL)` | `README.md:14-17` |
| Vercel: root directory `frontend`, set `NEXT_PUBLIC_API_URL`, deploy | `README.md:192-196` |
| Railway: root directory `backend`, build `npm ci && npm run build`, start `npm run start`, health check `/api/health` | `README.md:198-205` |

### 8.2 What exists

**Nothing.** No deployment artefact of any kind is present in the repository:

| Artefact | Present? |
|---|---|
| `.github/` (any CI) | **no** — directory absent |
| Any `.yml` / `.yaml` file anywhere in the repo | **no** — `find` returns zero results |
| `Dockerfile` / `docker-compose.yml` | **no** |
| `vercel.json` | **no** |
| `railway.json` / `railway.toml` | **no** |
| `Procfile` | **no** |
| `nixpacks.toml`, deployment scripts | **no** |

There is no automated build, no automated test run, no lint gate, no type-check
gate, and no deploy pipeline. Every check (`npm run lint`, `npm run typecheck`,
`npm test`) is a local, manual command.

### 8.3 The README self-certifies "Not deployed"

`README.md:207-212`, verbatim:

> ## Deployment status
>
> **Not deployed.** Neon (`console.neon.tech`) and Railway (`railway.app`) both
> return HTTP 403 from this build environment's egress proxy, and no credentials
> were supplied. Every local gate passes; nothing has been verified against a live
> deployment, and no claim is made that it has.

The Railway/Vercel/Neon references throughout the codebase — `db/index.ts:11-15`,
`tokens.ts:79-81`, `migrate.ts:7-10`, `health.routes.ts:7`, `password.ts:5-7` —
are **design intent encoded in comments**, not evidence of a running system. The
architecture is shaped for that topology (narrow pool, `SameSite=None` cookie,
direct-endpoint migrations, liveness endpoint that never touches the database),
but no environment has ever been provisioned from this repository.

**Deployment-adjacent things that DO exist and work:**

| Item | Status | Location |
|---|---|---|
| `GET /api/health` — liveness, never touches the DB | `IMPLEMENTED` | `health.routes.ts:8-10` |
| `GET /api/health/ready` — readiness, `select 1`, 503 on failure with latency | `IMPLEMENTED` | `health.routes.ts:13-29` |
| Graceful SIGTERM/SIGINT shutdown with a 10s hard-exit timer | `IMPLEMENTED` | `server.ts:22-32` |
| Refuse-to-start on unreachable database | `IMPLEMENTED` | `server.ts:10-16` |
| Build script (`tsc -p tsconfig.build.json` → `dist/`) | `IMPLEMENTED` | `package.json:10-11` |
| Node engine floor (`>=20`) | `IMPLEMENTED` | `package.json:7` |

---

## 9. External services, storage, email, queues, observability

Every item in this section is `MISSING`. Proof is given for each.

### 9.1 Email / SMTP — `MISSING`

| Evidence | Result |
|---|---|
| Provider dependencies in `package.json` | none — no `nodemailer`, `@sendgrid/*`, `resend`, `postmark`, `mailgun-js`, `@aws-sdk/client-ses` |
| Grep for `nodemailer\|sendgrid\|@aws-sdk\|resend\|postmark\|mailgun\|smtp` across `src/` | zero real matches (only incidental substrings inside unrelated identifiers) |
| `EMAIL_*` / `SMTP_*` / `MAIL_*` env vars | none in `src/config/env.ts:4-26`, none in `.env.example` |
| Email templates | no template directory, no `.hbs`/`.mjml`/`.ejs` files |

**Architectural consequence.** Credential handover is out-of-band by necessity.
A temporary password is displayed once in the response body
(`admin.routes.ts:378`) and surfaced by the untracked
`frontend/src/components/shared/credential-handover.tsx`. There is no password
reset self-service, no email verification, no notification delivery, and no way
to reach a user who has lost their credential other than an administrator reading
a new one to them.

### 9.2 File / object storage — `MISSING`

| Evidence | Result |
|---|---|
| `multer` usage | appears in exactly one module: `src/modules/imports.routes.ts:2,24,27,28` |
| Storage engine | `multer.memoryStorage()` (`imports.routes.ts:28`) — the buffer is parsed by ExcelJS and then discarded; nothing is written to disk or to a bucket |
| Accepted types | `.xlsx`, `.xls`, `.csv` only (`imports.routes.ts:31-42`), one file, `MAX_UPLOAD_MB` cap |
| `/api/documents` | JSON CRUD produced by `createScopedResource` (`operations.routes.ts:380-403`). No multipart handler, no binary body. |
| `documents.storage_key` | Declared at `db/schema/operations.ts:371` and `drizzle/0002_operations.sql:71`. Accepted as an optional string in the create schema (`operations.routes.ts:399`). **Never generated by the backend and never referenced by the frontend** — zero occurrences of `storageKey` in `frontend/src/`. |
| Object-store SDKs | none in `package.json` |

**Architectural consequence.** The documents module records *metadata about files
that are not stored anywhere*. `customers/page.tsx:232` completes the illusion:
it reads a `File`, discards it, and toasts "queued for verification".

### 9.3 Notifications — `PARTIAL` (read path only)

| Layer | Status | Evidence |
|---|---|---|
| Table | exists | `notifications` in `db/schema/` (governance group) |
| Read endpoints | `IMPLEMENTED` | `GET /api/notifications` (`admin.routes.ts:955`), `POST /:id/read` (`:987`), `POST /read-all` (`:974`) — the only three routers with no `requirePermission` guard, since a user reads their own |
| Frontend page | `IMPLEMENTED` | `frontend/src/app/(app)/notifications/page.tsx` |
| **Write path** | **`MISSING`** | `grep -rn "insert(notifications)" src/` returns **zero matches**. Nothing anywhere ever creates a notification row. |

The notifications page will render empty against any real database, permanently.

### 9.4 `app_settings` — `MISSING` (dead table)

`grep -rn "appSettings" src/` returns exactly one match:
`src/db/schema/governance.ts:95`, the declaration itself. The table is
created by the migration and referenced by nothing — no route, no service, no
seed. The `settings.view` / `settings.edit` permissions (§6.1) have nothing to
gate.

### 9.5 Job queue / scheduler / cache — `MISSING`

`grep -rniE "bullmq|redis|ioredis|rabbitmq|kafka|sqs|amqp|agenda|cron"` across
`src/` returns **zero matches**. No dependency, no worker process, no
`setInterval`-based scheduler.

**Consequence.** `RECYCLE_BIN_RETENTION_DAYS` (`env.ts:23`,
`services/recycle-bin.ts:96`) defines a retention policy that nothing enforces on
a schedule — expiry is computed at read time, never swept.

### 9.6 Observability / APM — `MISSING`

`grep -rniE "sentry|opentelemetry|datadog|newrelic|prom-client|metrics"` across
`src/` returns **zero matches**.

| Capability | Status |
|---|---|
| Structured logging (pino, with redaction) | `IMPLEMENTED` — `lib/logger.ts` |
| Request-id correlation | `IMPLEMENTED` — `app.ts:65-68, 75` |
| Health/readiness endpoints | `IMPLEMENTED` — `health.routes.ts` |
| Audit trail (`audit_logs`, append-only via trigger) | `IMPLEMENTED` — `services/audit.ts`, `0001_governance_guards.sql:16` |
| Error tracking / crash reporting | **MISSING** |
| Distributed tracing | **MISSING** |
| Metrics endpoint / dashboards | **MISSING** |
| Log aggregation / retention | **MISSING** — stdout only |
| Uptime monitoring / alerting | **MISSING** |

### 9.7 Rate limiting — `MISSING`

No `express-rate-limit`, no `rate-limiter-flexible`, no reverse-proxy config in
the repository. The **only** throttle anywhere is a per-account login lockout:
`MAX_FAILED_ATTEMPTS = 8` / `LOCKOUT_MINUTES = 15`
(`src/modules/auth.routes.ts:28-29`), applied at `:103-106` and `:114-126`.

**Consequences.** No IP-based limiting, so credential-stuffing across many
accounts is unthrottled. The lockout is also an unauthenticated denial-of-service
primitive: anyone who knows an email address can lock that account out for 15
minutes with 8 requests. No limit on `/api/auth/refresh`, on the Excel import
endpoint, or on any read endpoint.

### 9.8 Other absences worth recording

| Item | Status | Note |
|---|---|---|
| WebSockets / SSE / realtime | `MISSING` | no `ws`, `socket.io`, or `EventSource` anywhere |
| CSRF token | `MISSING` | mitigated in practice: the API is bearer-authenticated, and the refresh cookie is `SameSite` (`lax` dev / `none` prod) and scoped to `path=/api/auth` |
| Secret management (vault/KMS) | `MISSING` | secrets come from `process.env` via `dotenv` |
| Backup / restore procedure | `MISSING` | delegated to Neon; nothing in the repo |
| Feature flags | `MISSING` | |
| i18n | `MISSING` | `<html lang="en">` hardcoded at `frontend/src/app/layout.tsx:17` |
| API versioning | `MISSING` | all routes mount at `/api/*` with no version segment |
| OpenAPI / generated client | `MISSING` | the contract is maintained by hand and pinned by `frontend-contract.test.ts` |

---

## 10. Component status register

Every architectural component identified in this document, with its status.

### Frontend

| Component | Status | Reference |
|---|---|---|
| Next.js App Router (routing only) | `IMPLEMENTED` | `frontend/src/app/` |
| Root layout + metadata + pre-paint theme script | `IMPLEMENTED` | `app/layout.tsx:9-19` |
| Provider stack (Theme → Auth → Reference → Tooltip → Toaster) | `IMPLEMENTED` | `app/layout.tsx:29-36` |
| `AppShell` route guard (unauth) | `IMPLEMENTED` | `app-shell.tsx:20-22` |
| `AppShell` route guard (demo scope) | `DEMO` | `app-shell.tsx:28-32` |
| `AppShell` route guard (forced password change) | `PARTIAL` — working tree only, client-only | `app-shell.tsx:39-48` |
| `apiRequest` single chokepoint | `IMPLEMENTED` | `lib/api.ts:114-170` |
| In-memory access token | `IMPLEMENTED` | `lib/api.ts:17` |
| 401 → refresh → single replay | `IMPLEMENTED` | `lib/api.ts:153-165` |
| Refresh de-duplication | `IMPLEMENTED` | `lib/api.ts:18,85-101` |
| Forced sign-out listener fan-out | `IMPLEMENTED` | `lib/api.ts:29-37`; `use-auth.tsx:152-162` |
| Session bootstrap from refresh cookie | `IMPLEMENTED` | `use-auth.tsx:116-142` |
| Cached profile in `localStorage` (paint only) | `IMPLEMENTED` | `use-auth.tsx:63-78,98-114` |
| `useResource` / `useRecord` / `useStats` | `IMPLEMENTED` | `hooks/use-api.ts` |
| `AbortController` signal propagation | `MISSING` | created `use-api.ts:44`, never passed to `api.list` |
| Data-fetching library / client cache | `MISSING` | `frontend/package.json:13-37` |
| `ReferenceProvider` (banks/users/teams, once per session) | `IMPLEMENTED` | `use-reference.tsx:34-108` |
| `ThemeProvider` + flash-free dark mode | `IMPLEMENTED` | `use-reference.tsx:145-167` |
| Demo runtime (`lib/demo/*`, 1 814 lines) | `DEMO` | `lib/demo/` |
| Demo teardown on real sign-in | `MISSING` | `disableDemoMode` called only at `use-auth.tsx:212` |
| Client password policy mirror | `IMPLEMENTED` — untracked | `lib/password-policy.ts:10-20` |
| Change-password page | `IMPLEMENTED` — untracked | `app/(app)/change-password/page.tsx` |
| Credential handover component | `IMPLEMENTED` — untracked | `components/shared/credential-handover.tsx` |
| 14 fake write handlers | `PARTIAL` | §2.7 |
| Route middleware (`middleware.ts`) | `MISSING` | file absent |
| Next.js API routes / Server Actions | `MISSING` | `app/api/` absent; zero `"use server"` |
| Frontend tests | `MISSING` | no test runner in `frontend/package.json` |

### Backend

| Component | Status | Reference |
|---|---|---|
| Express 5 app factory | `IMPLEMENTED` | `app.ts:37-105` |
| helmet | `IMPLEMENTED` (CSP disabled by design) | `app.ts:44-49` |
| CORS allow-list with credentials | `IMPLEMENTED` | `app.ts:52-63` |
| Request-id propagation | `IMPLEMENTED` | `app.ts:65-68` |
| Body parsers (1 MB cap) | `IMPLEMENTED` | `app.ts:70-71` |
| cookie-parser | `IMPLEMENTED` | `app.ts:72` |
| pino-http (off under test) | `IMPLEMENTED` | `app.ts:74-76` |
| 22 route mounts | `IMPLEMENTED` | `app.ts:78-99` |
| 404 + centralised error handler | `IMPLEMENTED` | `app.ts:101-102`; `middleware/error-handler.ts` |
| pg constraint → 409 translation | `IMPLEMENTED` | `error-handler.ts:65-82` |
| `createScopedResource` factory (44 endpoints, 9 resources) | `IMPLEMENTED` | `modules/scoped-resource.ts:74-322` |
| `scopedWhere` single WHERE assembly | `IMPLEMENTED` | `scoped-resource.ts:93-100` |
| Human code generation (`nextCode`) | `PARTIAL` — `count(*)`-derived, not collision-proof | `scoped-resource.ts:87-91` |
| `requireAuth` / `requirePermission` / `requireAnyPermission` | `IMPLEMENTED` | `middleware/auth.ts` |
| `loadAuthContext` (2–3 SQL/request, no cache) | `IMPLEMENTED` | `services/access.ts:30-86` |
| Auth-context cache | `MISSING` | by design; §3.5 |
| Graceful shutdown | `IMPLEMENTED` | `server.ts:22-32` |
| Refuse-to-start on DB failure | `IMPLEMENTED` | `server.ts:10-16` |
| Liveness + readiness endpoints | `IMPLEMENTED` | `health.routes.ts` |
| Structured logging + 12 redaction paths | `IMPLEMENTED` | `lib/logger.ts` |
| Rate limiting | `MISSING` | §9.7 |
| Per-account login lockout (8 / 15 min) | `IMPLEMENTED` | `auth.routes.ts:28-29,103-126` |
| Excel import (memory-only multer + ExcelJS staging) | `IMPLEMENTED` | `modules/imports.routes.ts` |
| Audit trail (append-only via trigger) | `IMPLEMENTED` | `services/audit.ts`; `0001_governance_guards.sql:16` |
| Recycle bin (soft delete + restore) | `IMPLEMENTED` | `services/recycle-bin.ts` |
| Recycle-bin retention sweeper | `MISSING` | no scheduler; §9.5 |
| Notifications read endpoints | `IMPLEMENTED` | `admin.routes.ts:955-999` |
| Notifications write path | `MISSING` | §9.3 |
| `app_settings` | `MISSING` (dead table) | §9.4 |

### Authentication & authorization

| Component | Status | Reference |
|---|---|---|
| argon2id hashing (OWASP 2024 low-memory) | `IMPLEMENTED` | `lib/password.ts:8-25` |
| Password policy (≥12, upper/lower/digit) | `IMPLEMENTED` | `lib/password.ts:89-98` |
| JWT HS256 access token (15m, iss/aud pinned) | `IMPLEMENTED` | `lib/tokens.ts:20-28,40-51` |
| Refresh token — httpOnly, `path=/api/auth`, hashed at rest | `IMPLEMENTED` | `lib/tokens.ts:66-89`; `auth.routes.ts:39-45` |
| Token-type confusion rejection | `IMPLEMENTED` | `tokens.ts:46,59` |
| Refresh rotation on every use | `IMPLEMENTED` | `auth.routes.ts:183-186` |
| Reuse detection → revoke all sessions | `IMPLEMENTED` | `auth.routes.ts:172-181` |
| Login timing equalisation (dummy hash) | `IMPLEMENTED` | `auth.routes.ts:108-111,154-155` |
| Change-password revokes all sessions | `IMPLEMENTED` | `auth.routes.ts:251-254` |
| Temporary password generator (14 chars, no ambiguous glyphs) | `IMPLEMENTED` — working tree only | `lib/password.ts:51-87` |
| `POST /users/:id/reset-password` | `IMPLEMENTED` — working tree only | `admin.routes.ts:325-383` |
| `mustChangePassword` — persisted, carried, returned | `IMPLEMENTED` — working tree only | `access.ts:19,38,82`; `auth.routes.ts:70,145` |
| `mustChangePassword` — server-side enforcement | **`MISSING`** | no guard in `middleware/`; §5.6 |
| Permission catalogue (76 keys, 20 groups, single source) | `IMPLEMENTED` | `lib/permissions.ts:11-134` |
| 5 default roles, levels 0/10/20/30/40 | `IMPLEMENTED` | `lib/permissions.ts:190-313` |
| Strictly-greater role-level rule | `IMPLEMENTED` | `services/access.ts:144-149` |
| `system.manage_any_user` bypass | `IMPLEMENTED` | `services/access.ts:145,167` |
| Anti-escalation on permission grant | `IMPLEMENTED` | `services/access.ts:166-174` |
| System-role protection (app + DB trigger) | `IMPLEMENTED` | `services/access.ts:177-181`; `0001_governance_guards.sql:81` |
| `bankScope` fail-closed sentinel | `IMPLEMENTED` | `services/access.ts:108-114` |
| `assertBankAccess` on path and payload | `IMPLEMENTED` | `services/access.ts:121-127` |
| `assertSameBank` cross-record integrity | `IMPLEMENTED` | `operations.routes.ts:33-48` |
| Dashboard scoping (parallel implementation) | `PARTIAL` — correct but duplicated | `operations.routes.ts:527-532` |
| 5 declared-but-unenforced permissions | `PARTIAL` | §6.1 |

### Data layer

| Component | Status | Reference |
|---|---|---|
| Drizzle + node-postgres, narrow pool | `IMPLEMENTED` | `db/index.ts:16-33` |
| 27 tables, zero SQL↔TS drift | `IMPLEMENTED` | `db/schema/`; `drizzle/*.sql` |
| 62 foreign keys | `IMPLEMENTED` | `0000_init.sql`, `0002_operations.sql` |
| 7 triggers (audit immutability, touch-updated-at, system-role guard) | `IMPLEMENTED` | `0001_governance_guards.sql` |
| CHECK constraints | `MISSING` | zero; all value domains enforced in Zod only |
| Soft delete (`deleted_at`) applied uniformly | `IMPLEMENTED` | `scoped-resource.ts:96` |
| Migration generation (`drizzle-kit`) | `IMPLEMENTED` | `drizzle.config.ts` |
| Migration application (manual script, direct endpoint) | `IMPLEMENTED` | `db/migrate.ts` |
| Migration on boot | `MISSING` — by design | `server.ts` never imports the migrator |
| Seed script (permissions, roles, bootstrap admin) | `IMPLEMENTED` | `db/seed.ts` |
| Test DB = real migrations on PGlite | `IMPLEMENTED` | `tests/harness.ts:36-48` |
| `setDb` test seam | `IMPLEMENTED` | `db/index.ts:36-38` |

### Configuration, deployment, external services

| Component | Status | Reference |
|---|---|---|
| Zod-validated, fail-fast env schema | `IMPLEMENTED` | `config/env.ts:4-53` |
| Production-only secret assertions | `IMPLEMENTED` | `config/env.ts:44-51` |
| `.env.example` | `MISSING` | the file is at the repo root; `README.md:28,202` cite the wrong path |
| `AADHAAR_PEPPER` in the example file | `MISSING` | mandatory in production, absent from `.env.example` |
| `LOG_LEVEL` in the env schema | `MISSING` | read raw at `logger.ts:3` |
| `FRONTEND_URL` | `MISSING` (dead) | declared and documented, consumed nowhere |
| `NEXT_PUBLIC_APP_NAME` / `NEXT_PUBLIC_APP_ENV` | `MISSING` (dead) | zero references in `frontend/src/` |
| Backend test suite (107 cases on real migrations) | `IMPLEMENTED` | `src/tests/` |
| E2E tests | `MISSING` | none |
| CI pipeline | `MISSING` | no `.github/`, zero YAML files in the repo |
| Container image | `MISSING` | no `Dockerfile` |
| Platform config (Vercel / Railway) | `MISSING` | no `vercel.json`, `railway.*`, `Procfile` |
| Deployed environment | `MISSING` | `README.md:207-212` — **"Not deployed."** |
| Email / SMTP | `MISSING` | §9.1 |
| Object / file storage | `MISSING` | §9.2 |
| Job queue / scheduler | `MISSING` | §9.5 |
| Cache (Redis or in-process) | `MISSING` | §9.5 |
| APM / tracing / metrics / error tracking | `MISSING` | §9.6 |
| WebSockets / realtime | `MISSING` | §9.8 |
| API versioning | `MISSING` | §9.8 |
| OpenAPI spec / generated client | `MISSING` | §9.8 |

---

## Appendix A — HEAD vs working tree

The working tree is dirty. This appendix records the delta so a future reader can
tell which architecture they are looking at.

**Modified (8):**

| File | Architectural effect |
|---|---|
| `src/lib/password.ts` | +43 lines: `generateTemporaryPassword()` and its rejection-sampled alphabet helpers (`:46-87`). |
| `src/modules/admin.routes.ts` | +101/-… : new `POST /users/:id/reset-password` (`:325-383`); optional `teamId` on user creation, gated by `teams.assign` (`:54, 174-183, 220-225`); `randomToken(12)` → `generateTemporaryPassword()` (`:184`). **This is the one added endpoint: 95 → 96.** |
| `src/modules/auth.routes.ts` | +3: `mustChangePassword` added to `profileOf` (`:68-70`). |
| `src/services/access.ts` | +4: `mustChangePassword` on `AuthContext`, selected and returned (`:18-19, 38, 82`). |
| `frontend/src/hooks/use-auth.tsx` | +7: optional `mustChangePassword` on `SessionUser` (`:40-45`). |
| `frontend/src/components/layout/app-shell.tsx` | +16: the forced-password-change guard (`:11, 34-44, 48`). |
| `frontend/src/app/(app)/employees/page.tsx` | +622/-…: employee create + credential handover + reset UI. |
| `frontend/src/app/(app)/settings/page.tsx` | +79: self-service password change entry point. |

**Untracked (4):** `src/tests/employee-lifecycle.test.ts` (25 cases),
`frontend/src/app/(app)/change-password/page.tsx`,
`frontend/src/components/shared/credential-handover.tsx`,
`frontend/src/lib/password-policy.ts`.

**Net architectural change:** one new endpoint; one new client route; forced
password change enforced in React only. No change to the middleware chain, the
factory, the permission catalogue, the schema, or the migration set.

## Appendix B — Unverified and corrected claims

| Claim | Disposition |
|---|---|
| "96 endpoints" | Correct for the **working tree**. HEAD is **95** (51 hand-written + 44 factory), verified via `git show HEAD:src/modules/admin.routes.ts`. |
| "ALL frontend pages are `use client`" | Nearly. 19 of 20 `page.tsx` files carry the directive; `frontend/src/app/page.tsx` is a **server component** performing `redirect("/login")`. `layout.tsx` (both), and `not-found.tsx` are also server components. |
| "`loadAuthContext` — 3 SQL round trips" | Up to 3. Two always (user+role join, role permissions); the third (`user_bank_access`) is skipped for holders of `system.access_all_banks` — guard at `services/access.ts:64`. The function's own doc comment ("one round trip", `:25-29`) is inaccurate. |
| "`documents.storage_key` is never written by anything" | Nothing in the backend *generates* it and nothing reads it, but it **is** an accepted optional field on `POST /api/documents` (`operations.routes.ts:399`), so a client could persist an arbitrary string there. No frontend code does — zero `storageKey` references in `frontend/src/`. |
| Cookie `SameSite` policy | `none` in production, `lax` otherwise (`tokens.ts:82`) — not `none` unconditionally. |
| Test-case total (107) | Confirmed: 26 + 22 + (9 + 25) + 25. |
| 27 tables / 62 FKs / 7 triggers / 0 CHECKs | Table, trigger and CHECK counts independently confirmed. **FK count (62) not independently recounted for this document** — `UNVERIFIED`, carried from the supplied baseline. |
| `CORS_ORIGIN` behaviour for requests with no `Origin` header | Allowed (`app.ts:57`, `if (!origin) return callback(null, true)`). Standard for server-to-server and curl; recorded here because it is not obvious from the allow-list framing. |
