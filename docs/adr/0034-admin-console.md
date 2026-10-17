# ADR-0034: The admin console

Status: accepted (phase 1). Plan: [docs/admin/ADMIN-PANEL-PLAN.md](../admin/ADMIN-PANEL-PLAN.md).

## Context

Staff had one admin page, the billing console. The product roadmap asks for an
internal control centre: users, workspaces, access, audit, security, and later
plans, credits, AI operations and support. It must be safe to give to people who
are not developers.

## Decision

- **One kernel, `defineAdminRoute`** (`src/server/admin/route.ts`). Every
  `/api/admin/*` route except the older `billing/` ones uses it. Order:
  authenticate → admin? (else **404**) → second factor → permission (a refusal
  is audited) → rate limit → fresh second factor for `danger` routes → validate
  input → handler. A test fails the build if a route skips it or declares no
  permission.
- **Permissions are actions** (`src/lib/admin/permissions.ts`), not labels.
  Roles are presets in code; an admin may have extras and denials, and denied
  wins. Unknown strings in old rows are ignored, never trusted.
- **Two ways in:** a row in `admin_users`, or the existing
  `BILLING_ADMIN_USER_IDS` list (treated as super admin, and the way back in).
- **Service role only.** Admin tables have RLS and no policy; functions are
  `SECURITY DEFINER`, empty `search_path`, executable by `service_role` only.
  `db.server.ts` is the single file under `src/server/admin` that imports the
  service client (a test enforces it).
- **A change and its audit row are one transaction**, written by the database
  function that makes the change. The audit table is append-only even for the
  service role.
- **Suspending a customer uses Supabase Auth's own ban** (`banned_until`) and
  ends their sessions, so it is enforced at sign-in without touching the app's
  request path.
- **Personal data is masked by default**; `users.pii.read` shows it.
- **Second factor** (TOTP) is required in production (`ADMIN_REQUIRE_MFA`).
  Sensitive changes also need a code from the last ten minutes.
- The billing console is unchanged; it moved from `/admin` to `/admin/billing`
  and the new shell lists it for people who may open it.

## Phase 2: entitlement overrides

Plans stay in code (`catalog.ts` is the baseline, costed against the pricing
workbook, and the browser reads it directly for prices and upgrade copy).
What staff can change is **exceptions**: `entitlement_overrides` rows that allow
or deny a sold feature, or set a numeric limit, for a billing account or one
workspace, each with a reason and an optional end. They are applied once, after
the plan is resolved in `getEntitlements`, and the Plans page is a read-only view
of the catalog. Editable, versioned plan definitions were **not** built: they
would make the database a second source of prices next to the catalog. Revisit
only together with the pricing workbook process.

## Phase 3: health, usage and emergency switches

- **System health** (`/admin/health`) and **Usage & cost** (`/admin/usage`) are
  read-only views over rows that already exist: `cron_heartbeats`, `studio_jobs`
  and `ai_usage_events`. A hook is "late" after two of its own intervals. Costs
  are the providers' reported cost per call and are labelled as estimates.
- **Emergency switches** (`platform_switches`: AI text, images, video, search)
  are read at the one place every paid call already asks, `checkBudget`
  (`src/server/platform/switches.server.ts`). They fail open (an unreadable table
  means running), are cached about ten seconds per process, and a flip needs
  `emergency.manage`, a reason, a fresh second factor, and writes its audit row
  in the same transaction (`admin_switch_set`).

## Phase 6: flags and announcements

- **Feature flags** (`platform_flags`, `/admin/flags`) are a database layer for
  NEW gates only: `isFlagOn(key, workspaceId)` in `src/server/platform/flags.server.ts`.
  The env-var flags in `feature-flags.ts` are untouched. Order: env var
  `FEATURE_FLAG_<KEY>` > the row > off. A missing flag or an unreadable table is
  **off** (a new feature must never switch itself on). Rules are pure
  (`src/lib/flags/evaluate.ts`): end date, workspace allow list, then a stable
  percentage bucket per flag and workspace, so a roll-out only grows.
- **Announcements** (`platform_announcements`, `/admin/announcements`) are shown
  by `AnnouncementsOutlet` at the top of `AppShell`. Row-level security lets a
  signed-in person read only live rows; a failed read shows nothing. Closing one
  is a per-browser convenience. Saves are audited with the id and state, not the text.
- `src/integrations/supabase/types.ts` is not regenerated yet: run `npm run db:types`
  after the migrations are applied.

## Phases 4, 5 and 7 (read side) and credit adjustments

- **Analytics** (`/admin/analytics`), **Integrations** (`/admin/integrations`) and
  **Support** lookup (`/admin/support`) are read-only functions over stored rows.
  The platform keeps no page-view history, so "active" is only ever "used an AI
  feature" or "signed in", and each figure is labelled with what it counts.
  Integration views name their columns and never read a token.
- **Lookup never confirms an email by guessing:** matching on email is only
  enabled for admins with `users.pii.read`.
- **Credit adjustments** (`credits.grant`, a danger route) call `grantMeter` with
  source `adjustment`, AI-only, bounded per adjustment and keyed by an operation
  id so a double click replays. The grant is the billing module's own RPC, so the
  audit row is written right after it succeeds (and a failed attempt is audited
  as a failure) rather than in the same transaction.

## AI controls: routing overrides and spend caps

- **Routing** (`model_route_overrides`, `/admin/ai`): an admin can override the
  models or reasoning effort of a route. `task-models.ts` stays the baseline.
  Precedence is env var `AI_MODEL_<ROUTE>` > override > registry. An override may
  only name a model the registry already uses (`knownModels`), checked on save and
  again at read time. `planFor` stays synchronous: the overrides live in a
  process-wide snapshot (`routing-overrides.server.ts`) that the gateways refresh
  (15 s cache) before building a request; an unreadable table keeps the last
  snapshot. Never name a model at a call site still holds.
- **Spend caps** (`spend_caps`, global and per workspace, daily and/or monthly USD)
  are checked inside `checkBudget`, so every paid gateway honours them. A platform
  cap blocks all paid calls; a workspace cap degrades text to the economy model and
  blocks images, video and search. They fail open like the rest of metering. Platform
  spend is the estimated cost in `ai_usage_events` since the UTC day/month start
  (`platform_spend_since`, cached 60 s).
- Both are `danger` routes (fresh second factor) with their audit row written in the
  same transaction by `admin_route_override_set` / `admin_spend_cap_set`.

## Workspace suspension, read-only mode and support views

- **Access state** is `workspace_access_state` (one row per restricted workspace,
  none means active). It is deliberately NOT a column on `workspaces`: an owner can
  update their own workspace row and must never be able to lift a suspension. The
  table is service-role only.
- **Enforced in one place**, `checkWorkspaceMembership` (`src/server/api-auth.ts`),
  which `defineRoute` and server functions (`requireWorkspaceRole`) both use, and
  only after membership is proven, so a non-member never learns a workspace's state.
  `suspended` refuses every request; `read_only` refuses a request whose `minRole`
  is editor or higher. That relies on the existing convention that side-effecting
  routes declare `minRole: "editor"`: a route that writes without declaring it is
  not stopped by read-only mode, so keep following the convention. Fails open (an
  unreadable table means active) and is cached about ten seconds per process.
  Pages still load for a suspended workspace; its data calls answer 403 with a clear
  message and a `code`.
- **A support view is not impersonation in the login sense.** No token is minted and
  nothing can act as the customer. `admin_view_start` opens a 30-minute session for
  one admin (one at a time, reason required, fresh second factor); `admin_view_read`
  checks it and returns an allow-listed snapshot. **Every read is audited.** The
  snapshot never contains post or message text, Brand DNA, credentials, tokens, or
  payment/billing detail beyond the plan name, and member emails follow the usual
  masking. An in-app "you are being viewed" banner and an acting-as session were
  not built.

## Not built yet (on purpose)

Impersonation as the customer (a support view exists; acting as them does not),
editable plan definitions, a jobs console with
retry/cancel, content tools, abuse detection, data export. Each has a phase in the plan.

## Consequences

- Adding an admin route means: one permission, `defineAdminRoute`, and (for a
  change) a database function that writes its own audit row.
- A permission with no route that uses it fails a test, unless it is checked
  inside a handler through `can()` (list it in `coverage.test.ts`).
