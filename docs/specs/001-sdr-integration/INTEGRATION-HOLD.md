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
   removed/re-created), separate from code. Needs a Vercel dashboard check (or ask Zian).
2. **Zian's `ad052bc` on `raval` master** ("Replace Lovable OAuth with native Supabase
   Google OAuth") ALSO re-pointed Supabase to a **brand-new empty project**
   `slcmqbbjzyztqyucauol` (config.toml + .temp/project-ref + apply_migrations_cli.py),
   and his final-state migration set **excludes the 3 SDR migrations**
   (`20260809000001-3`). Google provider is OFF on the old project too.

## Key facts verified (read-only, 2026-08-10)

- Old Supabase `smdravaoaeqdajmnrlpr` (raval-dev-v2): **live, has data + migrations + test
  user** (`junaidsajjad2298@gmail.com`). `workspace_sdr` row present (`status: active`).
- New Supabase `slcmqbbjzyztqyucauol` ("Raval"): **empty** — "Invalid API key" for the
  known keys; no data, no test user, no migrations applied.
- `raval` branches: `master` = Zian's `ad052bc`; `junaid` = our SDR work (`e1b09e6` + prior).
  Our work is committed + pushed on `junaid`; `project-alpa` is a separate repo, untouched.
- App-login OAuth (Zian's change) vs social-platform OAuth (ours) are two different things;
  password login via the test credentials is unaffected by OAuth.

## Decisions pending (not executed)

- **Supabase project:** use the old `smdravaoaeqdajmnrlpr` (recommended — everything works
  there) vs provision the new `slcmqbbjzyztqyucauol` properly (apply all migrations incl.
  SDR ones, create test user, enable Google provider).
- **Vercel:** restore/rebuild the `raval-mu` deployment (dashboard-side; env vars need the
  SDR server-only keys added per `raval/README.md`).
- **Zian's OAuth code:** keep as a future login modernization (parked), or revert the
  project re-point only.

## Guardrail

No branch switches, stashes, resets, reverts, or force-pushes on `raval` without explicit
user go-ahead. Documentation + commits to the planning branch (`001-sdr-integration`) only.
