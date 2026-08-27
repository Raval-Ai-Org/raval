# Tasks: Instagram Content Publishing + Facebook Page Wiring

**Input**: Design documents from `/specs/002-instagram-adapter/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Included. The spec's user stories carry acceptance scenarios, and the user explicitly requested unit tests (adapter success + error taxonomy + publisher composite). TDD order used within stories (tests first, then implementation).

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- Single project at repo root: `app/`, `scripts/`, `tests/`
- Existing modular monolith: `app/adapters/`, `app/api/`, `app/services/`, `app/models.py`

---

## Phase 1: Setup

**Purpose**: Confirm the baseline is green before any change.

- [x] T001 [P] Run the full existing test suite and confirm baseline is green: `./venv/bin/python -m pytest -q` (expect 182 passed, 9 warnings) before any code changes.
- [x] T002 [P] Confirm Meta settings are wired end-to-end: `FACEBOOK_CLIENT_ID`, `FACEBOOK_CLIENT_SECRET`, `FACEBOOK_CALLBACK_URL` present in `app/config.py` (Settings fields, ~lines 141-149) and in `.env`.

**Checkpoint**: Baseline green; Meta settings readable.

---

## Phase 2: Foundational — Shared Meta OAuth groundwork

**Purpose**: Extends `app/api/accounts.py` so the existing authorize-only flow can resolve Meta Pages and mint long-lived tokens. Blocks US2 (Facebook Page) and US3 (Instagram, which resolves from the linked Page). No user story work starts until this is done.

- [x] T003 Add `"instagram"` to the platform allowlist in `oauth_start` in `app/api/accounts.py` (~line 228), so the allowlist becomes `("twitter", "linkedin", "facebook", "instagram")`. Instagram reuses the Facebook OAuth dialog; add IG scopes (`instagram_basic,instagram_content_publish`) to the facebook branch params (~lines 283-290) so one dialog grants both FB Page and IG permissions.
- [x] T004 Add two Meta helpers in `app/api/accounts.py` next to the existing token-exchange helpers: (a) `_exchange_long_lived_token(short_token, settings)` calling `GET https://graph.facebook.com/v18.0/oauth/access_token?grant_type=fb_exchange_token&client_id=...&client_secret=...&fb_exchange_token=...`; (b) `_resolve_primary_page(user_token, settings)` calling `GET https://graph.facebook.com/v18.0/me/accounts?fields=id,name,access_token&access_token=...` and returning the first Page's `(page_id, page_name, page_token)`.

**Checkpoint**: Platform allowlist includes instagram; Meta page/token helpers exist.

---

## Phase 3: User Story 1 - Client authorizes only; no developer account (Priority: P1)

**Goal**: Confirm and harden the authorize-only contract — the client clicks Authorize, the engine stores the encrypted per-workspace token, and no credential ever appears in a response or log.

**Independent Test**: A workspace with no connected Meta account runs `/oauth/{platform}/start`, authorizes in a browser, and returns with a connected `facebook`/`instagram` account row — no client-side credential entry, and no token in any response payload.

### Tests for User Story 1 ⚠️

- [x] T005 [US1] Add unit test in `tests/unit/test_publisher.py` (or a new `tests/unit/test_oauth_flow.py`) asserting the OAuth start/callback responses for facebook and instagram contain `authorization_url` + `state_token` and account fields only — never an access/refresh token, app secret, or author URN (FR-012 / FR-MT-08).

### Implementation for User Story 1

- [x] T006 [US1] Audit `oauth_callback` + `AccountResponse` schema in `app/api/accounts.py` / `app/schemas.py` to confirm no credential field is ever serialized; if any leaks, redact it. (Verification task — only edit if a leak is found.)

**Checkpoint**: Authorize-only contract is proven by test; no credential in any response.

---

## Phase 4: User Story 2 - Connect a Facebook Page via authorization and publish (Priority: P1) 🎯 MVP

**Goal**: A client authorizes their Facebook Page through RavalAI's single Meta app; the engine stores the Page (page_id + Page token) and can publish an approved post to it. **This is the MVP slice** — it exercises the full authorize → store → publish path and unblocks Instagram.

**Independent Test**: A workspace authorizes one Facebook Page via the OAuth flow; a publish request to that account posts a live post to the Page and returns platform_post_id + platform_post_url.

### Tests for User Story 2 ⚠️

- [x] T007 [P] [US2] Unit test in `tests/unit/test_oauth_flow.py`: mock httpx so the facebook callback resolves a Page — assert the stored account has `platform=facebook`, `platform_account_id` = Page id, `metadata["page_id"]` = Page id, `metadata["persona"] == "page"`, and the Page token (not the `/me` user id/token) is what gets encrypted.
- [x] T008 [P] [US2] Unit test in `tests/unit/test_publisher.py`: publisher builds `page_id|token` for a facebook account from `metadata["page_id"]` and the decrypted token (`publisher.py:420-423`) — assert the adapter receives `account_id == f"{page_id}|{token}"`.

### Implementation for User Story 2

- [x] T009 [US2] Rewire the facebook branch of `oauth_callback`/`_fetch_user_profile` in `app/api/accounts.py` (currently stores `/me`, ~lines 529-540): after code exchange, use `_exchange_long_lived_token` + `_resolve_primary_page` (T004); store the account with `platform_account_id` = Page id, `platform_username` = Page name, `encrypted_access_token` = Page token, metadata `{"page_id": <id>, "persona": "page"}`.
- [x] T010 [US2] Confirm publisher facebook path (`app/services/publisher.py` ~line 420) already reads `metadata.get("page_id", "me")` and builds `page_id|token` — no change expected; only verify against the new metadata shape.

**Checkpoint**: Facebook Page connect via OAuth works; publish targets the Page, not `/me`.

---

## Phase 5: User Story 3 - Connect Instagram and publish an image post (Priority: P1)

**Goal**: A client authorizes their Instagram Professional account (linked to a Facebook Page); the engine resolves the IG user id off the Page and publishes an approved image post via the two-stage flow.

**Independent Test**: A workspace with a connected facebook Page that has a linked IG Professional account authorizes instagram; an approved image+caption post to the instagram account appears live with a permalink.

### Tests for User Story 3 ⚠️

- [x] T011 [P] [US3] Unit test in `tests/unit/test_oauth_flow.py`: mock httpx so the instagram callback resolves the IG account off the linked Page — assert stored account has `platform=instagram`, `platform_account_id` = IG user id, metadata `{"ig_user_id": ..., "page_id": ..., "persona": "page"}`.
- [x] T012 [P] [US3] Unit test in `tests/unit/test_adapters.py`: `InstagramAdapter.publish` with an image URL + caption succeeds (mock httpx for `/media` → creation_id, `/media_publish` → media_id, `/media_id?fields=permalink` → permalink); assert `PublishStatus.PUBLISHED`, `platform_post_id`, `platform_post_url`.
- [x] T013 [P] [US3] Unit test in `tests/unit/test_publisher.py`: publisher builds `ig_user_id|token` for an instagram account from `metadata["ig_user_id"]` — assert the adapter receives `account_id == f"{ig_user_id}|{token}"`.

### Implementation for User Story 3

- [x] T014 [US3] Add the instagram branch to `_exchange_code_for_token` in `app/api/accounts.py` (~lines 472-486): identical to the facebook exchange (Meta app id/secret + redirect_uri + code) since IG reuses the FB OAuth.
- [x] T015 [US3] Add the instagram branch to `_fetch_user_profile` in `app/api/accounts.py`: resolve IG user id via `GET https://graph.facebook.com/v18.0/{page_id}?fields=instagram_business_account&access_token={page_token}`; on missing link, raise a clear error "Instagram account must be a Professional account linked to a Facebook Page". Return `{id: ig_user_id, username, name}`.
- [x] T016 [P] [US3] Create `app/adapters/instagram.py` — `InstagramAdapter(BaseAdapter)` with `validate_content` (caption ≤ 2200 chars; exactly one http(s) media URL; image vs video) and `publish` implementing the two-stage flow for **images** (`POST /{ig_user_id}/media` with `image_url`+`caption` → creation_id; `POST /{ig_user_id}/media_publish` with creation_id → media_id; `GET /{media_id}?fields=permalink` → public URL). Parse `account_id` as `ig_user_id|token` (mirror `FacebookAdapter._parse_account` in `app/adapters/meta.py`). Classify errors via `app/adapters/errors.py` (Auth code 190/403, RateLimit 429/18/613, Transient 5xx/timeout, Fatal other 4xx).
- [x] T017 [US3] Add the instagram composite in `app/services/publisher.py` next to the facebook branch (~lines 420-423): `if account.platform == "instagram": ig_id = metadata.get("ig_user_id", "me"); token = f"{ig_id}|{token}"`.
- [x] T018 [P] [US3] Register `InstagramAdapter` in `register_default_adapters()` in `app/adapters/__init__.py` as `("instagram", InstagramAdapter)`.

**Checkpoint**: Instagram image publish works end-to-end via the authorize flow + two-stage adapter.

---

## Phase 6: User Story 4 - Publish a video post to Instagram (Priority: P2)

**Goal**: Extend the Instagram adapter to publish short videos (`media_type=VIDEO` + `video_url`), sharing the same two-stage flow.

**Independent Test**: An approved short video URL posts live to a connected Instagram account with a permalink.

### Tests for User Story 4 ⚠️

- [x] T019 [P] [US4] Unit test in `tests/unit/test_adapters.py`: `InstagramAdapter.publish` with a video URL + `media_type=VIDEO` succeeds (mock httpx) — assert PUBLISHED + permalink; and a validation test asserting an unsupported/oversized media input raises `FatalContentError` before any external call.

### Implementation for User Story 4

- [x] T020 [US4] Add the video branch to `InstagramAdapter.publish` in `app/adapters/instagram.py`: when the single media URL is a video, send `media_type=VIDEO` + `video_url` in the `/media` step (same caption + `/media_publish` + permalink steps).

**Checkpoint**: Instagram image AND video publishing both work.

---

## Phase 7: User Story 5 - See delivery results and errors clearly (Priority: P3)

**Goal**: Meta publishes record platform_post_id + platform_post_url in the delivery trail, and failures are classified with an actionable reason — no silent failures.

**Independent Test**: A successful Meta publish shows a delivery log entry with platform/id/URL; a forced failure (e.g., expired token → 400 code 190) shows a classified auth error.

### Tests for User Story 5 ⚠️

- [x] T021 [P] [US5] Unit test in `tests/unit/test_adapters.py`: error-taxonomy matrix for `InstagramAdapter._parse_response` — 401 / 400 code 190 / 403 → `AuthError` (retryable=False); 429 / code 18 / 613 → `RateLimitError` (retryable=True, Retry-After); 5xx/timeout → `TransientError`; other 4xx → `FatalContentError`.
- [x] T022 [P] [US5] Unit/integration test in `tests/unit/test_publisher.py`: a successful Meta publish records `platform_post_id` + `platform_post_url` on the target and a delivery-log row (mirror the existing webhook/delivery test patterns).

### Implementation for User Story 5

- [x] T023 [US5] Verify the publish→delivery path in `app/services/publisher.py` already records `target.platform_post_id`/`platform_post_url` and a delivery log for any adapter result; if the instagram path needs the permalink populated (T016 returns it), confirm it flows through — no new code expected unless the audit finds a gap.

**Checkpoint**: Meta delivery + error visibility proven by tests.

---

## Phase 8: Polish & Cross-Cutting

**Purpose**: Dev fallback, full-suite regression, security audit.

- [x] T024 Create `scripts/seed_meta_account.py` mirroring `scripts/seed_linkedin_account.py` (long-lived exchange → resolve Page → encrypt → upsert `accounts` row) for **dev/test only**. Header docstring MUST state it is NOT the product path (product = OAuth authorize only, spec FR-001).
- [x] T025 [P] Run the full test suite: `./venv/bin/python -m pytest -q` — expect the prior 182 plus new tests all green (no regressions to X, LinkedIn, scheduling, webhooks).
- [x] T026 [P] Security audit (FR-012/FR-MT-08): grep changed files for accidental token/secret logging; confirm no new credential lands in responses, logs, or commit-able artifacts. Update `.env.example` with any new Meta var placeholders if not already present.
- [x] T027 Update `specs/002-instagram-adapter/quickstart.md` if implementation diverges from the documented flow (should not require change).

**Checkpoint**: Full suite green; no credential leakage; dev seed documented as test-only.

---

## Dependencies (story completion order)

```text
US1 (authorize-only) ──► US2 (FB Page connect+publish) ──► US3 (IG connect+image) ──► US4 (IG video)
                                          │                                   │
                                          └──────────────► US5 (delivery visibility)
```

- **US1 → US2**: US2's connect runs through the authorize-only flow; the contract must be proven first.
- **US2 → US3**: IG identity resolves from the linked Facebook Page, so a connected FB Page must exist.
- **US3 → US4**: video builds on the same adapter created in US3.
- **US5**: applies to all Meta publishes; ordered last but testable once the adapter exists.

## Parallel execution examples

- **Setup → Foundational**: T003 (allowlist) can run while T004 (helpers) is being written — different functions in the same file, so review together but implement in any order.
- **US2 parallel**: T007 + T008 (tests, `tests/unit/`) run while T009 rewires the OAuth callback (`app/api/accounts.py`) — different files.
- **US3 parallel**: T016 (adapter, `app/adapters/instagram.py`), T018 (registry, `app/adapters/__init__.py`), T017 (publisher, `app/services/publisher.py`) are different files → can be developed in parallel after T011–T013 tests define the contracts.
- **US4/US5 parallel**: T019/T020 (video, same adapter file — sequential with each other) parallel to T021/T022/T023 (delivery, different files).

## Implementation strategy

- **MVP first**: Ship Phase 1 + 2 + US1 + US2 (Facebook Page connect + publish) as the first independently testable increment — it proves the authorize→store→publish path and unblocks everything else.
- **Incremental delivery**: US3 (Instagram image) is the second increment and delivers the headline new capability; US4 (video) and US5 (visibility) harden it.
- **TDD within stories**: write the test tasks in each story before the implementation tasks; tests should fail until implementation lands.
- **No regression**: T025 is the gate — the 182-test baseline plus new Meta tests must all pass before the branch is committed.

## Notes

- No schema migration (data-model.md): `platform` is a free-form string column; Meta metadata lives in existing JSONB `accounts.metadata`.
- Meta API version stays `v18.0` to match the existing codebase (contracts/meta-api.md).
- `app/adapters/meta.py` (FacebookAdapter) is used unchanged — only the OAuth connect layer changes to supply it a real `page_id|token`.
