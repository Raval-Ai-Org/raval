# Research: Instagram Content Publishing + Facebook Page Wiring

**Feature**: `002-instagram-adapter` · **Phase**: 0 · **Date**: 2026-08-03

This resolves the technical unknowns for the plan. Every decision is grounded in the existing codebase (verified by reading `app/api/accounts.py`, `app/services/publisher.py`, `app/adapters/meta.py`, `specs/001-social-sde/MULTI_TENANCY.md`) and Meta's documented Content Publishing API flow. External rate-limit/app-review specifics are flagged where they must be re-verified at implementation time against Meta's current dashboard.

---

## R1. OAuth authorize-only model (confirmed from code)

**Decision**: Reuse the existing OAuth flow in `app/api/accounts.py` — `oauth_start` (state token + Redis-backed durable state, CSRF) → `oauth_callback` (verify state, exchange code, fetch profile, Fernet-encrypt and store per-workspace account row). Add `"instagram"` to the platform allowlist and extend the `facebook` branch to resolve a Page.

**Rationale**: This IS the product contract (spec FR-001/002, MULTI_TENANCY FR-MT-01/03/05/08). It already implements "client authorizes only, one RavalAI app, encrypted isolated tokens, no token in any response." Rebuilding it would duplicate working, tested behavior.

**Alternatives considered**: (a) Per-client developer apps — rejected (violates the core contract; the user was explicit). (b) Seed-script-only connect — rejected as the product path; seed stays a dev/test fallback only.

## R2. Facebook connect must resolve a Page, not `/me`

**Decision**: Extend the `facebook` OAuth branch so that after code exchange it:

1. Fetches the user profile (`GET /me?fields=id,name`).
2. Lists pages the user manages: `GET /me/accounts?fields=id,name,access_token`.
3. Selects the first page (MVP) and uses the **Page access token** + Page id as the stored account (`platform_account_id` = page_id, metadata `{page_id, persona:"page"}`).

**Rationale**: The current callback stores the _user_ token/profile from `/me` (`accounts.py:529-540`), but the publisher already builds `page_id|token` from `metadata.get("page_id","me")` (`publisher.py:420-423`) and the FacebookAdapter publishes to `/{page_id}/feed`. Storing the user token would post to the user's own timeline, not a Page — wrong identity (FR-MT-07). Resolving the Page at connect time makes the existing publisher path produce a real `page_id|token`.

**Alternatives considered**: Store user token + `page_id="me"` and post to `/me/feed` — rejected (publishes to the user's personal feed, not the Page the client chose).

## R3. Instagram identity resolution from the linked Page

**Decision**: For `platform="instagram"`, use the same Facebook OAuth dialog with IG scopes. After code exchange + page resolution (R2), call `GET /{page_id}?fields=instagram_business_account&access_token={page_token}` to obtain the linked Instagram Business/Creator account id. Store `platform_account_id` = ig_user_id, metadata `{ig_user_id, page_id, persona:"page"}`, token = Page token.

**Rationale**: Instagram Content Publishing operates on the IG _user id_ but authenticates with a token that has IG scope; the IG account must be linked to the Page. Resolving via `instagram_business_account` field is Meta's documented path and requires no second OAuth consent.

**Alternatives considered**: Instagram Login separately — rejected (the IG account is discovered off the Page; separate login adds friction and a second consent).

## R4. Instagram two-stage publish flow

**Decision**: `InstagramAdapter.publish`:

1. `POST https://graph.facebook.com/v18.0/{ig_user_id}/media` with `image_url` + `caption` (image) **or** `video_url` + `media_type=VIDEO` + `caption` (video), plus `access_token` → returns `{id: creation_id}`.
2. `POST /{ig_user_id}/media_publish` with `creation_id` + `access_token` → returns `{id: media_id}`.
3. `GET /{media_id}?fields=permalink` → public URL for the result.

**Rationale**: This is Meta's Content Publishing API (two-stage container → publish). The second call must not fire until the first succeeds (spec FR-006 — no partial publish). The extra `permalink` fetch satisfies FR-007 (record a public URL) and is cheap (1 call).

**Alternatives considered**: Direct single-call publish — does not exist for IG Graph API; the two-stage flow is mandatory.

## R5. Adapter error taxonomy (per CLAUDE.md §3.3)

**Decision**: Classify Meta errors by HTTP status + error code:

- **Auth** (Permanent): HTTP 401, or 400 with `error.code == 190` (invalid OAuth token), or 403 → `AuthError`, `retryable=False`, account should be marked for reconnect.
- **Rate limit**: HTTP 429 or error code 18/613 → `RateLimitError` with `Retry-After`, `retryable=True`.
- **Transient**: 5xx, timeouts, connection errors → `TransientError`, `retryable=True`.
- **Content/fatal**: other 4xx → `FatalContentError`, `retryable=False`.

**Rationale**: Mirrors the existing `FacebookAdapter._parse_response` (`meta.py:179-253`), keeping behavior consistent across Meta platforms and satisfying FR-008 (never silent).

## R6. Scopes

**Decision**:

- facebook: `pages_manage_posts,pages_read_engagement,pages_show_list`
- instagram: `pages_manage_posts,pages_read_engagement,pages_show_list,instagram_basic,instagram_content_publish`

**Rationale**: `pages_manage_posts` + `pages_read_engagement` already in the facebook branch (`accounts.py:288`). `pages_show_list` is needed to enumerate pages (`/me/accounts`). IG publishing requires `instagram_basic` (read IG id) + `instagram_content_publish` (publish). These are the scopes the user specified.

## R7. Token lifecycle

**Decision**: Store the **Page access token** (Meta Page tokens are long-lived, ~60 days) as `encrypted_access_token`. At connect time, exchange the short-lived code token for a long-lived token via `GET /oauth/access_token?grant_type=fb_exchange_token&client_id=...&client_secret=...&fb_exchange_token=...` then obtain the Page token from `/me/accounts`. Proactive in-app refresh (FR-MT-04 "Meta: long-lived token extension") is a follow-up task, not Phase-1 scope.

**Rationale**: Avoids the short-lived (~2h) user-token expiry that would break the very first scheduled publish. FR-MT-04 explicitly lists Meta's mechanism as long-lived token extension.

## R8. Dev/test seeding

**Decision**: `scripts/seed_meta_account.py` mirrors `seed_linkedin_account.py` and accepts the **owner's** Meta creds for local verification only. It is explicitly documented as NOT the product path (product = OAuth authorize only, FR-001).

**Rationale**: The user said their own Facebook creds are for testing now; the production flow is authorize-only. Keeping the seed script separate from the OAuth path prevents the anti-pattern of seeding real clients.

## R9. Unresolved-at-implementation (re-verify against Meta dashboard)

- Whether `instagram_content_publish` requires **Business Verification / app review** in Production mode (Development mode works for the app owner/tester — our test path).
- Exact current Graph API version default and the deprecation window for `v18.0` (the codebase consistently uses v18.0; keep consistent for now).
- Exact IG per-24h post caps and per-hour rate limits as of the build date.
