# Mellox Admin Panel — delivery plan

> **Status (phase 1 built):** foundation, Users, Workspaces (read), Audit log,
> Security, Team & access, Overview. See ADR-0034. Everything below that is not
> in that list is still planned. **Phase 2 built:** entitlement overrides (per
> account or workspace, audited, self-expiring) and a read-only Plans page; plan
> definitions stay in code (ADR-0034). **Phase 3 (partly) built:** System health, Usage & cost
> (read-only) and Emergency switches for AI text/image/video/search. **Jobs console (cancel/nudge for Studio) and abuse signals built.** **Workspace suspension / read-only mode and read-only support views built.** **AI controls built:** model routing overrides and global/workspace spend caps. **Also built:** Analytics, Integrations (state only), Support lookup and goodwill credit adjustments. **Phase 6 built:** DB-backed flags and announcements. Credit
> adjustments, model routing overrides and spend caps are still planned.

Source: `Mellox_AI_Admin_Panel_Complete_Product_Engineering_Roadmap.pdf` (28 sections,
7 phases). This plan maps it onto what the codebase already has, so the admin is
built **on** existing systems and does not duplicate them. Nothing outside the
admin area is changed except by explicit, listed hooks.

## 1. What already exists (reuse, do not rebuild)

| Roadmap area             | Already in the repo                                                                                                                                                               | Decision                                                                                          |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Admin access             | `/admin` + `BillingAdmin.tsx`, `requireBillingAdmin`, env allowlist `BILLING_ADMIN_USER_IDS`                                                                                      | Keep as the Billing tab, unchanged. New RBAC wraps it (allowlist stays a fallback "super admin"). |
| Credit ledger            | `meter_balances`, `meter_grants`, `meter_holds`, `meter_ledger`, `workspace_credit_ledger` (append-only trigger), `apply_credit_entry` (idempotent), `grantMeter`/`clawbackMeter` | Admin only **calls** these. No second ledger.                                                     |
| Plans & features         | `src/lib/billing/catalog.ts` (plans, `FEATURES`, `CREDIT_ACTIONS`, limits), `entitlements.server.ts`, `feature.server.ts`, `limits.server.ts`                                     | See §3: the main architectural decision.                                                          |
| Overrides                | comped plans (`comped_plan_id/until`), `billing_manual_activations`, `billing_admin_adjustments`                                                                                  | Generalise into one overrides table (Phase 2).                                                    |
| AI usage & cost          | `ai_usage_events`, `ai_usage_daily`, `ai_usage_reservations`, `metering.ts`, `task-models.ts`, `billing_margin_report`                                                            | Read-only analytics first; routing changes via a config layer (Phase 3).                          |
| Audit                    | `audit_logs` (workspace-scoped, service-role insert), `billing_admin_adjustments`, `mcp_tool_calls`                                                                               | New `admin_audit_log` (platform scope, append-only). `audit_logs` stays for workspace events.     |
| Jobs & health            | `cron_heartbeats`, `studio_jobs`, `geo_scans`, `experiment_jobs`, `autopilot_actions`, `scheduled_jobs`, `claim_*` lease RPCs                                                     | Admin reads these through a registry of job sources; retry/cancel call each owner's own function. |
| Integrations             | `social_accounts`, `workspace_connections`, `*_oauth_credentials`, `workspace_sites`                                                                                              | Show state only; never select token columns.                                                      |
| Feature flags            | `src/lib/feature-flags.ts`, **env-var** flags with `_WS_<id>` overrides                                                                                                           | Add DB-backed layer that env still overrides (Phase 6).                                           |
| Workspace delete/suspend | `workspace_deletions`, `billing_suspended_members`, owner-only delete in `workspaces/service.server.ts`                                                                           | Admin delete goes through the same service; suspension is new.                                    |
| Notifications            | `account_notifications`, `notify()`                                                                                                                                               | Announcements are a new table; delivery reuses the in-app notification surface.                   |
| Rate limits              | tier map in `src/server/rate-limit.ts`                                                                                                                                            | Add `admin-read`, `admin-write`, `admin-danger` tiers.                                            |

Nothing exists for: admin roles/permissions, MFA enforcement (`aal2` is not
checked anywhere), impersonation, user suspension, announcements, DB-backed
flags, emergency switches, admin data export, abuse detection.

## 2. Principles carried over from the roadmap + CLAUDE.md

1. **Server-side only.** Every admin route verifies auth → permission → scope →
   input itself (`defineAdminRoute`, §4). The UI hides things for comfort only.
2. **Admin never uses the RLS user client for platform data and never exposes
   `supabaseAdmin` outside `src/server/admin/**`.** Admin tables have RLS on
   with **no** policies for `authenticated` — service role only.
3. **Read through narrow views/RPCs; write through the owning module.** Admin
   credit grants call `grantMeter`; admin job retry calls the job's own retry;
   admin workspace delete calls `workspaces/service.server.ts`. Admin never
   writes another feature's tables directly.
4. **Every mutation: permission → reason → idempotency key → audit row in the
   same transaction where possible.** Dangerous ones also need fresh re-auth.
5. **Real data only.** A metric with no source shows "no data", never zero or a
   placeholder. Estimated vs confirmed money is labelled.
6. **Secrets never selected.** Integration views use column allow-lists; a test
   greps admin queries for `token|secret|key|password|ciphertext`.
7. Follow CLAUDE.md conventions: `defineRoute` family, zod, idempotent
   migrations, `db:verify`, `server-only`, design system (`SurfaceLayout`,
   `Tile`, pill buttons, `EmptyState`/`ErrorState`/`Skeleton`), React Query keys
   under `["admin", …]`. Landing page untouched.

## 3. The big architectural decision — entitlements (roadmap §7)

The roadmap wants plans/limits/credit costs **configurable from the admin**.
CLAUDE.md currently says `catalog.ts` is the _only_ source of prices, plans,
limits and feature gates, and it is browser-safe and workbook-costed.

Recommended approach (keeps both rules true):

- `catalog.ts` stays the **default/baseline** and the type source of truth.
- New table `plan_config_versions` holds **versioned, published overrides** of
  catalog fields (limits, feature on/off, credit costs, prices). A published
  version is immutable; changing means a new version; rollback = republish the
  previous one.
- One resolver `resolveEntitlements(workspaceId)` merges: catalog baseline →
  published plan version → active workspace/user overrides (not expired) →
  emergency switches. Existing `entitlements.server.ts` / `feature.server.ts`
  delegate to it. **This is the only change to non-admin code** and lands
  behind a flag, with a parity test: with no overrides the resolver must equal
  today's catalog output for every plan × feature.
- Prices shown in the UI keep coming from the same resolver output, so the
  "never put a price anywhere else" rule still holds.
- Stripe price ids stay in `billing_price_map`.

If you would rather keep plans code-only for now, Phase 2 shrinks to
"overrides + read-only catalog viewer" and no existing code changes.

## 4. Foundation (Phase 1)

### 4.1 Where it lives

```
src/app/admin/                      layout + one page per section (see §6)
src/components/admin/               presentational screens (BillingAdmin stays as is)
src/server/admin/                   server-only: auth, permissions, audit, services
src/server/fns|api  src/app/api/admin/<section>/…
src/lib/admin/                      pure: permission catalog, role presets, masking, diff
supabase/migrations/…_admin_*.sql   one migration per phase
docs/admin/                         this plan, ADR-0034, runbook
```

Shell: `/admin` becomes a layout with the roadmap's navigation rail
(`SurfaceLayout`). The current page becomes **Billing → Requests/Accounts/Health**
unchanged. Existing URL keeps working.

### 4.2 Data model

- Roles are **presets in code** (`src/lib/admin/permissions.ts`), not tables: one
  source of truth, tested, and a role change is a reviewed code change. An admin
  row stores the role key plus per-person extra and denied permissions.
- `admin_users` — user_id (auth), role_id, status (`active`/`disabled`),
  mfa_required, created_by, created_at, last_seen_at, ip_allowlist (nullable).
  Extra per-user `extra_permissions` / `denied_permissions` (jsonb arrays).
- `admin_audit_log` — append-only (trigger refuses UPDATE/DELETE, like the
  credit ledger). actor_user_id, actor_role, action, target_type, target_id,
  workspace_id, before (jsonb), after (jsonb), reason, success, error,
  request_id, ip, user_agent, impersonating_as, created_at. Secrets scrubbed
  with the existing `scrubAuditPayload`. Retention policy documented, enforced
  by a job that only archives, never edits.
- `admin_sessions` (optional) — last strong-auth time per admin for re-auth.

Bootstrap: `BILLING_ADMIN_USER_IDS` members are implicit `super_admin` until an
`admin_users` row exists; first super admin can be seeded by migration/env.
An admin can never remove the last super admin.

### 4.3 Permissions (pure, `src/lib/admin/permissions.ts`)

Action-based keys, as in the roadmap §21: `users.read`, `users.suspend`,
`users.sessions.revoke`, `users.delete`, `workspaces.read`, `workspaces.update`,
`workspaces.suspend`, `entitlements.read|update`, `overrides.manage`,
`credits.read|grant|refund`, `billing.read|manage`, `ai.read`,
`ai.models.update`, `ai.caps.update`, `jobs.read|retry|cancel`,
`integrations.read|revoke`, `feature_flags.read|update`, `support.read|write`,
`support.impersonate`, `content.read|reprocess`, `announcements.manage`,
`analytics.read`, `security.read|manage`, `admins.manage`, `audit.read`,
`data.export`, `emergency.trigger`, `settings.update`.

Role presets are data, not logic. A test asserts every route declares one
permission and every permission is used by at least one route.

### 4.4 `defineAdminRoute` (`src/server/admin/route.ts`)

Wraps `defineRoute`'s kernel: authenticate → resolve admin (not disabled) →
**MFA check (`aal2` from the JWT; fail closed for privileged roles)** →
permission → zod validation → rate-limit tier (`admin-read/write/danger`) →
**re-auth freshness for `danger: true`** → handler gets `{ admin, audit(), … }`.
`audit()` writes the row; a mutation handler that returns without auditing
fails a test (route-coverage style, like `billing/route-coverage.test.ts`).
Non-admins get 404, not 403, on `/api/admin/*`.

### 4.5 Phase 1 screens

- **Overview** — real counts only (users, workspaces, paying, failed jobs…),
  date range + period compare, estimated-vs-confirmed labels. Sources: SQL
  views/RPCs with security-invoker off but only callable by service role.
- **Users** — server-paginated table (search email/id/name, filters, sort,
  column visibility), detail page (profile, auth providers, workspaces, plan,
  usage, assets count, notes, audit history). Email search must stop scanning
  `listUsers` (existing code caps at 5,000): add a `admin_user_directory` view /
  mirror on `profiles` with an index.
- **Users actions** — suspend/unsuspend (new `profiles.suspended_at` + a check
  in the shared auth path — one small hook), revoke sessions
  (`auth.admin.signOut`), resend verification, reset onboarding/tour flags,
  internal notes (`admin_notes`), controlled delete (request → confirm → second
  approver → execute via existing deletion service → audit).
- **Workspaces** — list/detail (owner, members, plan, usage, integrations,
  feature overrides); suspend, read-only mode (new `workspaces.status` honoured
  by `defineRoute` for writes), integration revoke, recovery actions.
- **Audit Logs** — filter by actor/action/target/date, export (permission +
  audited), no edit UI.
- **Team & Admin Access** — invite/disable admins, assign role, extra/denied
  permissions; every change audited.
- **Security Center (basic)** — failed admin access attempts, new admins,
  role changes, recent privileged actions; MFA status per admin.

Exit criteria = roadmap §27 items 1–3, 5, 6, 12 plus tests below.

## 5. Later phases (summary)

| Phase                    | Scope                                                                                                                                                                                                                                                                                                                                                 | Key build notes                                                                                                                                                                                                                                                         |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2 Plans & entitlements   | Feature catalog (stable keys), plan config versions + publish/rollback, `resolveEntitlements`, `entitlement_overrides` (scope user/workspace, creator, reason, starts_at, expires_at, feature/limit/credits payload), auto-expiry in the **existing** `run-schedules` hook                                                                            | Parity test vs catalog; override changes audited; entitlement answer = allowed / limit / used / override-source.                                                                                                                                                        |
| 3 Credits, usage, AI ops | Credit packages & allocation rules as config; manual adjustments via `grantMeter`; usage/cost dashboards from `ai_usage_*`; provider/model health; **model routing overrides** layered over `task-models.ts` (admin sets `AI_MODEL_<ROUTE>`-equivalent rows, env still wins); global/workspace spend caps (extend `budget.ts`); abnormal-usage alerts | Never name models at call sites stays true — overrides are read inside `task-models` resolution.                                                                                                                                                                        |
| 4 Support & ops          | Universal lookup (email/user/workspace/sub/request/job/integration id), tickets-lite (notes, priority, assignee), **impersonation**, jobs console                                                                                                                                                                                                     | Impersonation = read-only viewing token: reason required, ≤30 min, banner, audit on every request, blocked on billing/credentials/delete/ownership/secrets. Jobs: registry of sources, retry via owner function, retry ceiling + dead-letter column, no infinite retry. |
| 5 Billing-neutral        | Reserved provider/customer/sub/price/cycle/trial fields, billing notes, event history, invoices/payment-failure views over `stripe_events`, `billing_events`                                                                                                                                                                                          | Mostly exists; this phase is views + notes + states. No Stripe work beyond what's there.                                                                                                                                                                                |
| 6 Flags & comms          | DB-backed flags (global, internal, plan, user, workspace, %, cohort; owner, expiry, kill switch), announcements (banner/modal/notification, targeting, dates, dismissible)                                                                                                                                                                            | Env flags remain highest priority; client reads a cached evaluated map.                                                                                                                                                                                                 |
| 7 Analytics & abuse      | DAU/WAU/MAU, funnel signup→return, retention/churn, feature adoption, margin by plan, abuse heuristics, incident log                                                                                                                                                                                                                                  | Internal analytics only, from stored rows.                                                                                                                                                                                                                              |

**Emergency Control Center** (needs Phase 1 + a small runtime hook, so schedule
with Phase 3): table `platform_switches` (read-only mode, signups, AI, images,
video, social publishing, provider/model, schedules, queues). Each switch is
checked in one place per area (e.g. the gateways, the publisher, signup route).
Every flip: confirmation text, fresh re-auth, audit, banner. Force-logout and
lock user/workspace reuse the Phase 1 actions.

## 6. Navigation → route map

Overview `/admin` · Users `/admin/users` · Workspaces `/admin/workspaces` ·
Plans `/admin/plans` · Billing `/admin/billing` (existing console) ·
Credits & Usage `/admin/credits` · AI Ops `/admin/ai` · Content `/admin/content` ·
Integrations `/admin/integrations` · Support & Ops `/admin/support` ·
Flags `/admin/flags` · Communications `/admin/announcements` ·
Analytics `/admin/analytics` · System Health `/admin/health` ·
Security `/admin/security` · Team `/admin/team` · Audit `/admin/audit` ·
Settings `/admin/settings` · Emergency `/admin/emergency`.
Items appear only when the admin holds at least one permission for them;
sections not yet built are not shown (no placeholder pages).

## 7. Touch points outside the admin (the only "other" code changes)

1. Shared auth path: reject `suspended` users/workspaces and honour read-only
   mode (Phase 1; one function, covered by tests).
2. Entitlement resolver delegation (Phase 2, behind a flag, parity-tested).
3. `task-models.ts` reads routing overrides (Phase 3).
4. Platform switches checked in gateways/publisher/signup (Phase 3).
5. In-app impersonation banner + announcements outlet in `AppShell` (Phase 4/6).
6. Rate-limit tiers in `rate-limit.ts`.

Everything else is new files.

## 8. Testing & verification (per phase)

- Unit: permission catalog, role presets, masking, diff builder, resolver parity.
- Route coverage test: every `/api/admin/**` handler is `defineAdminRoute`,
  declares a permission, and mutations call `audit()`.
- Authorization matrix test: for each route × role (and anonymous, normal
  user, member of another workspace) → expected 404/403/200.
- Cross-workspace test: admin queries always filter by the id in the URL; a
  customer JWT can never read admin tables (RLS test).
- Ledger tests: duplicate grant with same idempotency key is a no-op; concurrent
  grants/holds never go negative.
- `npm run db:verify` replays migrations; `db:types` regenerated.
- Playwright: login as non-admin (404), admin without MFA (blocked), happy
  paths per screen, light/dark, 390px not required (desktop-first) but tablet.
- Live check `tests/live/admin.live.ts` (read-only by default; writes behind
  `ADMIN_LIVE_WRITE=yes`).
- Apply migrations to the real database (dry-run then push) and say plainly
  what could not be verified (e.g. real MFA enrolment).

## 9. Risks / things to settle before Phase 1 starts

1. **Plan config in DB vs code** (§3) — biggest decision.
2. **MFA**: Supabase supports TOTP; confirm it is enabled on the project and
   whether staff accounts will enrol. Without it, "MFA required" cannot be real.
3. **Impersonation scope**: view-only (recommended) vs acting as the user.
4. **Admin location**: same app at `/admin` (assumed) vs separate deployment on
   an internal domain. The roadmap says "independent module for later
   integration"; the code plan above is modular enough to extract, but the
   same-origin app is simpler and reuses auth/UI.
5. **User directory scale**: current email lookup scans auth users; fix in Phase 1.
6. **Data export/deletion policy**: retention periods and second-approver rule
   need a business decision before building §24.
7. **Role preset contents**: confirm which permissions each of the six roles gets.

## 10. Suggested order of work inside Phase 1

1. ADR-0034 + permission catalog + role presets (pure, tested).
2. Migration: admin tables, append-only audit trigger, RLS (no policies), seed.
3. `src/server/admin/` (auth, MFA, audit, `defineAdminRoute`) + rate tiers + tests.
4. Admin shell/layout; move current page under Billing, behaviour unchanged.
5. Audit Logs + Team & Admin Access (so every later action is observable).
6. Users (read) → Users (actions) → Workspaces (read) → Workspaces (actions).
7. Overview + basic Security Center.
8. Authorization-matrix tests, live check, docs/runbook, verification.
