# Implementation Plan: Instagram Content Publishing + Facebook Page Wiring

**Branch**: `002-instagram-adapter` | **Date**: 2026-08-03 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/002-instagram-adapter/spec.md`

## Summary

Connect Meta (Facebook Page + Instagram Professional account) to the SDE through the **authorize-only** flow: ONE RavalAI-owned Meta app (creds in `.env`), clients click Authorize, and the engine stores their encrypted per-workspace token and publishes on their behalf. Facebook is wired via the existing OAuth flow extended to resolve a Page (not `/me`). Instagram is added as a new platform in that flow plus a new two-stage adapter (`/media` → `/media_publish`). No per-client developer accounts, no client-visible credentials.

## Technical Context

**Language/Version**: Python 3.12 (venv; `pyproject.toml`)
**Primary Dependencies**: FastAPI, httpx (async), SQLAlchemy 2.0 async, Celery + Redis, Fernet (crypto) — all existing in the stack
**Storage**: PostgreSQL (app) / SQLite (tests); tokens Fernet-encrypted in `accounts.encrypted_access_token`
**Testing**: pytest — current baseline **182 passed, 9 warnings**; adapter unit tests mock httpx
**Target Platform**: Linux server (FastAPI API + Celery worker)
**Project Type**: single backend monolith (modular; adapter per platform)
**Performance Goals**: publish path deterministic, no LLM; API p95 < 200 ms (CLAUDE.md §9); Instagram media publish is a 2-call sequence bounded by Meta, not by us
**Constraints**: queue-first for publish (never call platform APIs from HTTP handlers) — OAuth _code exchange_ in the callback is the existing, necessary exception (auth, not publish); failure classification per CLAUDE.md §3.3 (Transient/Permanent/Unknown)
**Scale/Scope**: multi-tenant workspaces; one RavalAI Meta app; Instagram limits (≈20 image / 1 video posts per 24h) respected

## Constitution Check

_GATE: passes — see rationale per principle. Re-checked after Phase 1 design; no changes._

| Principle (CLAUDE.md / persona)                        | How this plan satisfies it                                                                                                               |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **4.3 Approval boundary**                              | Engine only publishes what a prior platform approval passed in. This feature adds no auto-publish decision path.                         |
| **4.4 Deterministic dispatch**                         | Adapter publish path is pure HTTP + token; no LLM, no probabilistic behavior.                                                            |
| **3.3 Failure classification**                         | Instagram/Facebook adapters classify Auth (code 190/403) vs Rate-limit (429) vs Content (4xx) vs Transient (5xx/timeout) — never silent. |
| **3.5 Encrypted token storage**                        | OAuth callback already encrypts with Fernet; new platforms reuse it. No plaintext.                                                       |
| **4.1 Adapters are armor**                             | All Meta API specifics isolated in `adapters/instagram.py` / `adapters/meta.py`; a Meta API change touches only those files.             |
| **Anti-pattern: no LLM in dispatch, queue everything** | Publish remains queue-first; OAuth exchange stays in the HTTP callback (auth, not dispatch).                                             |
| **Smallest viable diff**                               | Reuse existing OAuth flow + publisher special-case + adapter registry; no unrelated refactor.                                            |

## Project Structure

### Documentation (this feature)

```text
specs/002-instagram-adapter/
├── plan.md              # This file
├── research.md          # Phase 0 — API flow + token + scope decisions
├── data-model.md        # Phase 1 — Account metadata deltas for fb/ig
├── quickstart.md        # Phase 1 — connect + publish walkthrough
├── contracts/           # Phase 1 — Meta API contract notes
├── checklists/          # Spec quality checklist
└── tasks.md             # Phase 2 (/sp.tasks — NOT created by /sp.plan)
```

### Source Code (repository root)

```text
app/
├── adapters/
│   ├── __init__.py          # register_default_adapters() → add instagram
│   ├── instagram.py         # NEW — InstagramAdapter (two-stage media publish)
│   ├── meta.py              # EXISTING FacebookAdapter (unchanged)
│   ├── base.py, errors.py   # existing interfaces/taxonomy
│   └── ...
├── api/
│   └── accounts.py          # EXTEND — oauth_start/oauth_callback/_exchange_code_for_token/_fetch_user_profile for facebook(Page)+instagram
├── services/
│   └── publisher.py         # EXTEND — instagram account_id composite (ig_user_id|token)
└── models.py                # no schema change (platform is a string column)

scripts/
├── seed_meta_account.py     # NEW — dev/test-only seed fallback (owner's creds, NOT product path)
└── seed_linkedin_account.py # existing pattern to mirror

tests/
└── unit/
    ├── test_adapters.py     # EXTEND — InstagramAdapter success + error taxonomy
    └── test_publisher.py    # EXTEND — instagram composite token path
```

**Structure Decision**: Reuses the existing modular monolith layout (`app/adapters/*`, `app/api/*`, `app/services/*`). Instagram is a new adapter file + OAuth extensions — no new modules, no extraction.

## Complexity Tracking

> No constitution violations. Complexity is flat: one new adapter + OAuth extensions following existing patterns (LinkedIn/X precedent). No justification table needed.

## Phase 0 — Research Summary (→ `research.md`)

Key decisions (full detail in `research.md`):

1. **OAuth flow**: reuse `app/api/accounts.py`; add `"instagram"` to the platform allowlist. Instagram uses the same Facebook OAuth dialog with IG scopes. Facebook flow extended to resolve a Page.
2. **Facebook Page resolution**: after code exchange, fetch user → `GET /me/accounts?fields=id,name,access_token` → pick the primary Page → store Page as the account (`platform_account_id` = page_id, metadata `{page_id, persona:"page"}`), token = Page access token. This replaces the current `/me` (user) storage so `publisher.py:420` produces a real `page_id|token`.
3. **Instagram identity resolution**: from the linked Page, `GET /{page_id}?fields=instagram_business_account&access_token={page_token}` → IG user id; store `platform_account_id` = ig_user_id, metadata `{ig_user_id, page_id, persona:"page"}`.
4. **Instagram two-stage publish**: `POST /{ig}/media` (image_url or video_url + caption) → `creation_id`; then `POST /{ig}/media_publish` (`creation_id`) → media id; then `GET /{media_id}?fields=permalink` for the public URL.
5. **Account_id composite**: publisher passes `{ig_user_id}|{token}` to the InstagramAdapter (same pattern as facebook's `page_id|token`).
6. **Scopes**: facebook: `pages_manage_posts,pages_read_engagement,pages_show_list`; instagram: `+ instagram_basic,instagram_content_publish`.
7. **Token long-life**: Meta user tokens are short-lived. Page access tokens (60 days) are used for publish; extend via `?grant_type=fb_exchange_token` at connect time. In-app refresh (FR-MT-04) for Meta = long-lived token re-extension, flagged as follow-up.
8. **Dev/test**: `scripts/seed_meta_account.py` accepts the owner's creds for local testing ONLY; never the production path (product = OAuth authorize only, per spec FR-001).

## Phase 1 — Design (→ `data-model.md`, `contracts/`, `quickstart.md`)

Entities, contracts, and quickstart are in the referenced files. Summary of the account-row deltas:

- **facebook account**: `platform_account_id` = Page id; `platform_username` = Page name; metadata `{page_id, persona:"page"}`; access token = Page token.
- **instagram account**: `platform_account_id` = IG user id; `platform_username` = IG username; metadata `{ig_user_id, page_id, persona:"page"}`; access token = Page token (IG publishes with the Page token).
- No new tables; `platform` string already free-form.

## Phase 2 — Tasks

Generated by `/sp.tasks` (not by `/sp.plan`).

## Risks & Follow-ups

- **Meta app-review / advanced access** may be required for `instagram_content_publish` in production; Development mode works for the owner/tester (our test path). Confirm current policy at implementation.
- **Rate limits**: IG ≈20 image / 1 video per 24h via API; enforce in adapter validation and surface 429 as RateLimitError.
- **Video publish** requires `video_url` + `media_type=VIDEO`; some IG business accounts need additional permission for >60s video. Keep MVP to short video.
- **Page selection** for Facebook uses the first Page the token can see; multi-Page selection UI is a follow-up.
