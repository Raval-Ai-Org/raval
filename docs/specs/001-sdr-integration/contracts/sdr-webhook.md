# Contract: SDR → RavalAI Webhook Receiver

**Branch**: `001-sdr-integration` | **Date**: 2026-08-08

The receiver is `src/routes/api/public/hooks/sdr.ts` (file route, cloned from the `run-schedules.ts` pattern). It receives delivery events from the SDR, verifies each signature, and applies state via the service-role Supabase client. **No state change is applied to an unverified callback** (spec FR-021 / SC-009).

## Endpoint

`POST /api/public/hooks/sdr`

## SDR→RavalAI payload (as sent by the SDR's `webhook_out.py`)

SDR sends one event per **target** (per-account delivery unit). Wrapped payload:

```json
{
  "event": "post.published | post.failed | post.retrying | account.expired",
  "timestamp": "2026-08-08T10:00:00Z",
  "data": {
    "post_id": "...", // SDR job id (== our sdr_post_id)
    "target_id": "...", // SDR target id (== our sdr_target_id)
    "status": "published | failed | retrying",
    "platform_post_id": "...", // when published
    "platform_post_url": "..." // when published
  }
}
```

Headers:

- `X-Signature-256: sha256=<hex>` — HMAC-SHA256 over the literal string `POST|/webhook|<body>` using the workspace's webhook secret.
- `X-Event-Type: post.published` (etc.)

> The `data` envelope contains no `workspace_id`. The receiver resolves the workspace from the matching `content_publications` row by `(sdr_post_id, sdr_target_id)` — or the SDR registers a **per-workspace** webhook endpoint, in which case the URL already identifies the workspace (via a path segment or per-workspace secret lookup). **Chosen:** per-workspace secret lookup by resolved row; if no matching row, respond 404 (unknown job) without applying anything.

## Verification (mandatory, in order)

1. **Look up** the workspace + secret: from the `content_publications` row matching `(sdr_post_id, sdr_target_id)` → `workspace_sdr.webhook_secret`. No row → `404`.
2. **Verify** `X-Signature-256` with `timingSafeEqual(computed, provided)` where `computed = "sha256=" + HMAC_SHA256(secret, "POST|/webhook|" + rawBody)`. Mismatch or missing header → `401`, log `unverified-webhook`, **no state change**.
3. **Replay mitigation**: a captured, correctly-signed payload still passes HMAC (it is a valid signature) — replay is defeated by **idempotent + terminal-wins application** (an already-applied row is a no-op; a stale `retrying` never downgrades a `published`/`failed` row), **not** by the signature alone. Timestamp freshness is advisory (reject obviously stale payloads), not a security boundary.
4. **Apply idempotently** — upsert `content_publications` on `(content_item_id, sdr_target_id)`.

## Apply rules (idempotent, terminal-wins)

| Event             | Action                                                                                                                                                                                                                            |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `post.published`  | upsert row → status `published`, set `platform_post_id`, `platform_post_url`, `delivered_at`; recompute item status (`published` if all rows published)                                                                           |
| `post.failed`     | upsert row → status `failed`, set `error_category` + `last_error`; recompute item status (`failed` if all failed, `partial_failed` on mix); **do not overwrite a `published` row with `failed`** (per-target terminal state wins) |
| `post.retrying`   | upsert row → status `retrying`, set `attempt`, `last_error`; item → `publishing`; **must not downgrade** a `published` row                                                                                                        |
| `account.expired` | mark the matching `content_publications` row → `failed` (auth), and surface `content_publications`/Connections with "Reconnect required" (FR-004)                                                                                 |

Response: `200 {"ok":true}` after successful apply; `204` for duplicate/reordered events that change nothing.

## Reconciliation backstop (FR-018)

A pg_cron row (Supabase pg_cron) invokes `POST /api/public/hooks/sdr-reconcile` (guarded with `CRON_SECRET` + `timingSafeEqual`, mirroring the existing `run-schedules.ts` pattern). The handler finds `content_publications` stuck in `publishing`/`pending` older than a threshold (e.g. >10 min) and reconciles each against SDR `GET /api/v1/jobs/{id}` (or marks them actionable). This guarantees nothing is stranded in "publishing" even if a webhook is lost. pg_cron is a scheduler shared with content generation — the two concerns (generate vs reconcile) stay separate endpoints; only the trigger mechanism is common. Alerts on repeated drift.

## Security notes

- Receiver is unauthenticated by design (it must accept SDR calls), so verification **is** the auth. Never fall back to trusting an unsigned callback.
- `assertPublicUrl` applies to any outbound fetch from the receiver (it performs none in the happy path).
- Signature secrets never enter client code.
- **Max request-body size (C1):** reject bodies > 1 MB with 413 **before** verification — the SDR delivery payload is tiny, so 1 MB is a generous ceiling and blocks oversized/abusive requests from consuming the receiver.
