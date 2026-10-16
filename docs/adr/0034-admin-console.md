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

## Not in phase 1 (on purpose)

Workspace suspension and read-only mode (they need a check in the shared
request path), impersonation, plan and entitlement management, credit tools, AI
routing controls, feature flags, announcements. Each has a phase in the plan.

## Consequences

- Adding an admin route means: one permission, `defineAdminRoute`, and (for a
  change) a database function that writes its own audit row.
- A permission with no route that uses it fails a test, unless it is checked
  inside a handler through `can()` (list it in `coverage.test.ts`).
