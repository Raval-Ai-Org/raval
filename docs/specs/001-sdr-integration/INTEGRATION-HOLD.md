# Integration Hold — Current State & Decisions (2026-08-10)

> **Purpose:** Records why the integration is currently "on hold", what changed on the
> live/deployed side, and the decisions pending. Everything else (the full record) is in
> `history/adr/0004-sdr-integration-full-record.md`.

## TL;DR

The SDR integration is **built and live-verified locally** (vitest 115/115, SDR 221/221,
real-login E2E against live Supabase + live SDR passed). Two things changed outside our
SDR work that we are treating as **on hold** until discussed:

1. **Live Vercel deployment is missing** — `https://raval-mu.vercel.app` returns
   `DEPLOYMENT_NOT_FOUND` on every route. This is a dashboard-side issue (deployment
  removed/re-created), separate from code. Needs a dashboard check by the deployment owner.
2. A historical change on the legacy branch ("Replace the external OAuth broker with native Supabase
  Google OAuth") also re-pointed Supabase to a **brand-new empty project**
  (project identifier intentionally omitted; config.toml and migration tooling were affected),
   and his final-state migration set **excludes the 3 SDR migrations**
   (`20260809000001-3`). Google provider is OFF on the old project too.

## Key facts verified (read-only, 2026-08-10)

  and a test user. Project identifiers and account details are intentionally omitted.
  then-known keys; no data, test user, or migrations were applied.
  Our work is committed + pushed on `junaid`; `project-alpa` is a separate repo, untouched.
  password login via the test credentials is unaffected by OAuth.

 Google provider is OFF on the historical project too.

- **Supabase project:** use the approved current deployment project (identifiers
  intentionally omitted) versus provisioning a separate test project properly.
- **Vercel:** restore/rebuild the `raval-mu` deployment (dashboard-side; env vars need the
  SDR server-only keys added per `raval/README.md`).
- **Zian's OAuth code:** keep as a future login modernization (parked), or revert the
  project re-point only.

## Guardrail

No branch switches, stashes, resets, reverts, or force-pushes on `raval` without explicit
user go-ahead. Documentation + commits to the planning branch (`001-sdr-integration`) only.
