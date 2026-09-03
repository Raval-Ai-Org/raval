# ADR-0004: RavalAI × Social Distribution Engine — Full Integration Record (end-to-end)

- **Status:** In progress (integration built + live-verified; deployment pending)
- **Date:** 2026-08-10
- **Feature:** 001-sdr-integration
- **Context:** This is the complete architectural + execution record for integrating the standalone **Social Distribution Engine (SDR)** (FastAPI + Celery + Postgres, publishes to LinkedIn/X/Facebook/Instagram) into **RavalAI** (TanStack Start + Supabase). It records every decision, every task completed and remaining, the live-verification evidence, and the current integration-hold state so the work can be resumed accurately from anywhere.

---

## 1. Architecture (decided, implemented, tested)

Two independent services, contract-only coupling (not microservices, not a merge).

```text
Browser (Studio, Supabase JWT + RLS)
   │  server fns carry the user's Supabase Bearer
TanStack server fn / file route (Cloudflare Worker)
   │  validates user + workspace (RLS) · reads per-workspace SDR key from workspace_sdr (service-role only)
SDR  POST /api/v1/publish · /schedule · /jobs/{id} · /accounts · /oauth/{p}/start · /webhooks/config · /admin/api-keys
   │  (Bearer: per-workspace key, never the global token)
SDR adapters → LinkedIn / X / Facebook / Instagram
   │  webhook (HMAC-SHA256, X-Signature-256)
RavalAI: /api/public/hooks/sdr → verify → upsert content_publications → aggregate content_items.status
   │  Supabase realtime / content:changed → Studio updates without refresh
```

### Decisions (locked + ADRs)

| #   | Decision                                                                                        | Status                  |
| --- | ----------------------------------------------------------------------------------------------- | ----------------------- |
| D1  | Proxy-through-server (browser never calls SDR directly; credentials server-only)                | ✅ ADR-0001             |
| D2  | Per-workspace SDR credential (minted via admin token, AES-256-GCM encrypted in `workspace_sdr`) | ✅ implemented          |
| D3  | HMAC-verified webhook receiver (timingSafeEqual, idempotent upsert, terminal-wins)              | ✅ implemented + tested |
| D4  | Split scheduling (RavalAI = generation timing; SDR = distribution timing, absolute UTC)         | ✅ ADR-0002             |
| D5  | Additive data model (`workspace_sdr` + `content_publications` + `publishing` status)            | ✅ implemented          |
| D6  | Media URL durability (durable public URLs at fire time)                                         | ✅ validated in handler |
| D7  | Approval gate (publish/schedule only from approved; explicit click = consent)                   | ✅ implemented          |
| D8  | Deployment: local-first, Oracle free + Cloudflare Tunnel, Netcup fallback                       | ✅ ADR-0003             |

### Additional decisions (execution-time)

- **Queue-first immediate publish (T067):** `publish()` enqueues targets to `process_target` and returns fast with `status: publishing` — no blocking platform calls in the HTTP handler. Live-verified.
- **Human-readable error surfacing:** clients see plain-language messages ("The Social Distribution Engine is not responding…") with the technical detail as a secondary line; terminal success/failure toasts (green-tick "Successfully posted to LinkedIn" + live link).
- **brand_id mapping:** RavalAI is one workspace per client brand → `brand_id = workspace_id` when minting the per-workspace SDR key (SDR requires both).
- **OAuth (app-login) hold:** Zian's `ad052bc` switched app login from an external OAuth broker to native Supabase Google OAuth (PKCE). **Parked** — not a prerequisite for the SDR integration; password login (test credentials) is unaffected. Revisit after integration is live.

---

## 2. Data model (live-verified on the old Supabase project `smdravaoaeqdajmnrlpr`)

- **`workspace_sdr`** — workspace_id PK/FK, sdr_workspace_id, encrypted_api_key, webhook_secret, sdr_base_url, status, timestamps. RLS: service-role only. **Live row verified** (`workspace_id`, `status: active`).
- **`content_publications`** — id, workspace_id, content_item_id, sdr_post_id, sdr_target_id, platform, account_id, status (`pending|publishing|published|failed|retrying|cancelled|partial_failed`), platform_post_id, platform_post_url, error_category, last_error, attempt, delivered_at, timestamps. UNIQUE(content_item_id, sdr_target_id). RLS: workspace members read, service-role write.
- **`content_items.status`** — added `publishing` (plain TEXT column value, not a PG enum).
- **Indexes:** `(content_item_id)`, `(workspace_id, status)` (migration 0002) + hot-path `(sdr_post_id, sdr_target_id)` and `(status, updated_at)` (migration `20260810000001`, T075).

Migrations: `20260809000001_add_workspace_sdr.sql`, `20260809000002_add_content_publications.sql`, `20260809000003_publishing_status_doc.sql`, `20260810000001_add_publications_perf_indexes.sql`.

---

## 3. Task ledger (complete — done + remaining)

### ✅ Completed

| Task      | Summary                                                                                                                                                                                            |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T001–T006 | SDR local standup (docker-compose, 209 tests), DryRun smoke, server env keys, test baseline, MockSDR fixture, dev-server wiring                                                                    |
| T007–T018 | Foundational: HMAC verifier, idempotency keys, provisioning, platform limits, schema migrations, `publishing` status, FB channel fix, `sdr.server.ts`, `sdr-provisioning.server.ts`, feature flags |
| T019–T029 | US1 Connect & Manage: oauth/start, accounts, disconnect routes + ConnectionsPanel + rail wiring + target gating                                                                                    |
| T030–T041 | US2 Publish: publish route + handlers, destination picker, typed client, Studio wiring, `publishing` render                                                                                        |
| T042–T051 | US3 Schedule: schedule/cancel routes, timezone, reschedule/race, integration test, schedule wiring + cancel affordance                                                                             |
| T052–T061 | US4 Delivery: webhook receiver, idempotent apply, aggregation, reconciliation, delivery-view data + **render (T061)**                                                                              |
| T062–T066 | US5 Degradation: flag + degraded mode, SDR-unreachable graceful, e2e regression spec                                                                                                               |
| T067      | **Queue-first immediate publish (SDR)** — was reverted earlier; re-landed with root-cause fix (eager-mode leak + SQLite busy-timeout + broker-dispatch stub). SDR 221/221                          |
| T068–T072 | SDR-side fixes: OAuth redirect_after, IG worker token + refresh, webhook retry loop, CORS lockdown, run-demo health check                                                                          |
| T073–T074 | RLS security test, observability logging                                                                                                                                                           |
| T075      | Performance indexes (hot-path audit + 2 new indexes)                                                                                                                                               |
| T076      | Docs: `raval/README.md` (new) + `quickstart.md` (env keys, provisioning, webhook verification)                                                                                                     |
| T077      | ADRs 0001–0003 (proxy-through-server, split scheduling, deployment topology)                                                                                                                       |

### ⚠️ In progress

| Task | Status                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T078 | Full E2E sweep — harness live; **4/6 Playwright specs pass**; **real-login E2E against live Supabase + live SDR verified end-to-end** (login 200 → workspace → `GET /api/sdr/accounts` 200 → `POST /api/sdr/oauth/start` 200 with real LinkedIn auth URL). 2 specs are generation-gated (canvas picker/delivery need a real generated content item — not an integration defect). **2 real bugs found + fixed by the live run:** missing `brand_id` in provisioning (mint 422) and SDR migrations not applied to cloud (PGRST205) |

### ⬜ Remaining

| Task | Summary                                                                                       |
| ---- | --------------------------------------------------------------------------------------------- |
| T079 | FR/SC audit (28/28 FR, 10/10 SC) + commit branch                                              |
| T080 | Deploy SDR (Oracle free + Cloudflare Tunnel, real domain, backups, UptimeRobot, CORS locked)  |
| T081 | Platform release gates: Meta app review (FB/IG), X paid tier, real-domain OAuth redirect URIs |
| T082 | Workspace SDR key revocation/rotation                                                         |
| T083 | Release go/no-go: quickstart checklist + E2E against deployed SDR + FR/SC audit               |

### 🔒 On hold (integration hold — see ADR-0005/integration-hold)

- Live Vercel deployment is missing (`raval-mu.vercel.app` → `DEPLOYMENT_NOT_FOUND`). Needs dashboard-side check (or ask Zian).
- Zian's `ad052bc` re-pointed Supabase to a **new, empty project** `slcmqbbjzyztqyucauol`; his migration set excludes the SDR migrations. Decision pending: keep old project `smdravaoaeqdajmnrlpr` (recommended) vs provision the new one.

---

## 4. Test / verification evidence

- RavalAI: **vitest 115/115** (28 files) — unit/contract/integration.
- SDR: **221/221** pytest.
- Playwright e2e: **4/6** (US1 ×2, US5, US3); 2 generation-gated.
- **Live:** SDR `/healthz` healthy (DB/Redis/workers); live publish through SDR dryrun returns job accepted → published; real-login + SDR proxy + OAuth-start 200 on `smdravaoaeqdajmnrlpr`.

## References

- Spec: `specs/001-sdr-integration/spec.md` · Plan: `plan.md` · Tasks: `tasks.md`
- Contracts: `contracts/sdr-proxy.md`, `contracts/sdr-webhook.md`
- ADRs: 0001, 0002, 0003 (this file)
- Integration-hold: `specs/001-sdr-integration/INTEGRATION-HOLD.md` (see Documentation.md pointer)
