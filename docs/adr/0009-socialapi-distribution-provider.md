# ADR 0009 — SocialAPI.ai as the social distribution provider

- **Status:** Accepted
- **Date:** 2026-09-14
- **Supersedes:** nothing. The self-hosted SDR ([ADR 0004](0004-sdr-integration-full-record.md)) stays as an alternate provider.

## Context

Mellox built a complete publishing pipeline around the self-hosted Social
Distribution Engine (SDR), but it shipped dark. Running it means per-platform
developer apps, app reviews, token storage and a separate service. SocialAPI.ai
is a managed unified API with managed OAuth apps for Meta, LinkedIn, TikTok,
YouTube and Google. X is bring-your-own-key. It provides posts, scheduling,
media, webhooks and engagement metrics.

## Decision

SocialAPI.ai is a **provider behind the existing pipeline**, not a parallel
system:

| Concern                                                                 | Where                                                                                                                                    |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Provider choice                                                         | `DISTRIBUTION_PROVIDER` (`socialapi` \| `sdr` \| `none`), default SocialAPI when `SOCIALAPI_API_KEY` is set — `src/lib/feature-flags.ts` |
| HTTP client, error taxonomy                                             | `src/lib/socialapi/client.server.ts`                                                                                                     |
| Handlers (accounts, connect, publish, schedule, cancel, retry, metrics) | `src/lib/socialapi/handlers.ts`                                                                                                          |
| Webhook receiver                                                        | `src/lib/socialapi/webhook.ts` → `POST /api/public/hooks/socialapi`                                                                      |
| Reconcile + metrics sweep                                               | `src/lib/socialapi/reconcile.ts`, run by the existing `sdr-reconcile` cron                                                               |
| Routes                                                                  | `/api/sdr/*` dispatch by provider; SocialAPI-only extras under `/api/social/*`                                                           |
| Data                                                                    | `content_publications` (+ `provider`, `metrics`), `social_accounts`, `workspace_socialapi`, `social_oauth_states`, `social_usage_events` |

### Tenant isolation

One API key serves every tenant, so isolation is enforced by Mellox:

- Each workspace maps to exactly one SocialAPI **brand** (`workspace_socialapi`).
- Every account operation lists `GET /accounts?brand_id=<workspace brand>`.
  Mellox also filters by `brand_id` itself before trusting any account id.
- Brand creation isn't idempotent at the provider. A unique DB claim comes
  first, so only the request that wins the claim creates the brand. After a
  crash, recovery finds the brand again by its suffixed name.
- OAuth `state` is 256 random bits. Only its SHA-256 is stored, bound to the
  user and workspace that started the flow, with a 30-minute lifetime and
  single use. The Facebook Page selection step is bound the same way.
- Page selection never shows another brand's name (`lost_access` and
  `assigned_brand_name` are stripped).
- Browsers can only _read_ their own workspace's `social_accounts`,
  `social_usage_events` and `content_publications` (RLS). Brand mapping and
  connect state are service-role only. This is covered in
  `tests/db/tenant-isolation.test.ts`.

### Delivery correctness

- `POST /posts` has no idempotency key. The content item is claimed with a
  conditional status update before the call, and the call is never retried.
  If it times out, Mellox searches recent posts (same accounts, same text)
  before declaring failure, so a retry click can't duplicate a live post.
- Provider validation (`POST /posts/validate`, free) runs before the claim, so
  invalid posts never change state.
- Scheduled posts copy stored media into the provider library (a `media_id`),
  because a signed URL would expire before the post fires.
- TikTok requires an explicit `privacy_level` taken from creator info. Mellox
  never picks a default.
- Webhooks are verified with v2 HMAC over `timestamp.body` (5-minute window),
  deduplicated on `X-SocialAPI-Delivery`, and applied terminal-wins. The
  reconcile sweep converges state when webhooks are missing.

### Credits

Each provider post operation (publish, schedule, retry) uses one Mellox
publishing credit. Credits are recorded in `social_usage_events` and capped
per plan (`monthlyPosts`, overridable with `PLAN_<PLAN>_MONTHLY_POSTS`). When a
workspace runs out, the request fails with `QUOTA_EXCEEDED` before the provider
is called. Provider-side exhaustion maps to the same code.

## Consequences

- SocialAPI plan limits apply across all tenants. The free tier allows 2 brands
  and 10 posts a month, so production needs a paid SocialAPI plan sized to the
  number of workspaces.
- `SOCIALAPI_WEBHOOK_SECRET` can only be issued once the deployment is
  reachable over HTTPS (`node scripts/socialapi-webhook.mjs register`). Until
  then, status converges through the 5-minute sweep.
- X/Twitter publishing requires BYOK credentials in the SocialAPI dashboard,
  and X posts are text-only.
- The `sdr_*` column names in `content_publications` are kept for
  compatibility and documented per provider.
