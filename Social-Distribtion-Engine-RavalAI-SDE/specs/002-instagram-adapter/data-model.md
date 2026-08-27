# Data Model: Instagram Content Publishing + Facebook Page Wiring

**Feature**: `002-instagram-adapter` · **Phase**: 1 · **Date**: 2026-08-03

No schema migration is required. `Account.platform` is a free-form `String(32)` column; `accounts.metadata` is JSONB. This feature only changes *how existing columns are populated* for Meta accounts and how the publisher builds the account-id for Instagram.

## Entity: `Account` (existing table — populated differently for Meta)

| Column | facebook (Page) | instagram |
|---|---|---|
| `workspace_id` | from OAuth state | from OAuth state |
| `brand_id` | from OAuth state | from OAuth state |
| `platform` | `"facebook"` | `"instagram"` |
| `platform_account_id` | **Page id** (resolved via `/me/accounts`) | **IG user id** (via `instagram_business_account` field) |
| `platform_username` | Page name | IG username |
| `encrypted_access_token` | **Page access token** (Fernet-encrypted) | **Page access token** (Fernet-encrypted) |
| `encrypted_refresh_token` | `NULL` (Meta uses token extension, not refresh grant) | `NULL` |
| `token_expires_at` | Page token expiry (~60 days) if obtainable | same |
| `status` | `"active"` | `"active"` |
| `metadata` | `{"page_id": <str>, "persona": "page"}` | `{"ig_user_id": <str>, "page_id": <str>, "persona": "page"}` |

### Metadata contract

- `page_id` — the Facebook Page id the token can publish to. **Required** for the publisher to build `page_id|token` (`publisher.py:420-423`).
- `ig_user_id` — the Instagram user id used as the endpoint path segment in `/media` and `/media_publish`. **Required** for the Instagram adapter.
- `persona` — `"page"` for both, aligning with FR-MT-07 (author identity captured at connect time). No `author_urn` for Meta in this phase (Meta identity is the Page token itself).

## Publisher account-id composite

The publisher passes a single `account_id` string to adapters. For Meta:

| Platform | `account_id` passed to adapter | Adapter parses as |
|---|---|---|
| facebook | `f"{metadata['page_id']}|{token}"` (existing) | `(page_id, token)` — `meta.py:63` |
| instagram | `f"{metadata['ig_user_id']}|{token}"` (new) | `(ig_user_id, token)` — `instagram.py` |

## Validation rules (adapter-level)

- Caption/text ≤ 2200 chars (Instagram) — `FatalContentError` if exceeded.
- Exactly **one** media URL required for Instagram (image or video); no URL, or >1, is a content error. (Instagram does not support text-only posts via this API.)
- Media URL must be `http(s)://`.
- Video posts: `media_type=VIDEO` + `video_url`; image posts: `image_url`.

## State transitions (unchanged from engine)

`target.status`: `pending → publishing → published | failed | retrying`
`Account.status`: `active → expired | disconnected` (on AuthError mark `expired` and notify — FR-MT-04; exact hook is a follow-up).
