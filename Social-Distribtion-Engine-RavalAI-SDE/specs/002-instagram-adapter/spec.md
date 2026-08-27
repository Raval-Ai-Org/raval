# Feature Specification: Instagram Content Publishing + Facebook Page Wiring

**Feature Branch**: `002-instagram-adapter`
**Created**: 2026-08-03
**Status**: Draft
**Input**: User description: "Add an Instagram Content Publishing adapter to the RavalAI Social Distribution Engine, plus the wiring to connect a Facebook Page live."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Client authorizes only; no developer account (Priority: P1)

As a RavalAI client, I click "Post" in the RavalAI platform for a social account that is not yet connected. I do NOT create a developer account, and I never see or handle any app ID, secret, or credential. RavalAI redirects me to the social platform's authorization page; I click "Authorize"; the platform stores my authorization and then posts on my behalf to my own social account.

**Why this priority**: This is the core product contract (MULTI_TENANCY.md, FR-MT-01): **one RavalAI developer app per platform, built once by RavalAI**. Brands never create their own developer apps. All connect + publish flows must run through this authorize-only path. The developer setup (one Meta app, credentials in `.env`) happens once and is never per-client.

**Independent Test**: Can be fully tested by (a) starting an OAuth flow from a workspace that has no connected account for the platform, (b) authorizing in the browser, and (c) confirming a connected account row is created for that workspace with no client-side credential entry.

**Acceptance Scenarios**:

1. **Given** a client with no connected Meta account, **When** the client triggers publish, **Then** the engine redirects to the Meta authorization page (RavalAI's app) — the client never supplies an app ID or secret.
2. **Given** the client authorizes in the browser, **When** the callback completes, **Then** the engine stores the client's OAuth token encrypted and isolated to that workspace, and the account appears connected.
3. **Given** the client is now connected, **When** the client clicks Post, **Then** the engine publishes to the client's own social account without any further authorization and without the client ever touching credentials.

---

### User Story 2 - Connect a Facebook Page via authorization and publish to it (Priority: P1)

As a brand using RavalAI, I want to authorize my Facebook Page through RavalAI's single Meta app and then publish to it, so that my Page content goes out from the same unified publishing flow I already use for LinkedIn and X.

**Why this priority**: Facebook is the foundational Meta connection. Instagram's publishing API only works through a Facebook Page (the Instagram account must be linked to a Page), so without a working Facebook connection, Instagram cannot be connected at all.

**Independent Test**: Can be fully tested by authorizing one Facebook Page through the engine's OAuth flow (RavalAI's Meta app) and publishing a single approved post to it. Delivers a live, visible post on the Page.

**Acceptance Scenarios**:

1. **Given** the engine's Meta app credentials in `.env`, **When** a brand authorizes its Facebook Page via the OAuth flow, **Then** the Page appears as a connected `facebook` account for that workspace and the engine confirms it can reach the Page.
2. **Given** a connected Facebook Page, **When** the brand submits an approved post for that Page through the standard publish flow, **Then** the post appears on the Page and the engine records the platform post ID and public URL.
3. **Given** a Facebook Page whose token is expired or revoked, **When** the brand attempts to publish, **Then** the engine reports an authentication failure (never a silent success) and marks the account as requiring reconnection.

---

### User Story 3 - Connect Instagram and publish an image post (Priority: P1)

As a brand, I want to connect my Instagram Professional account (linked to my Facebook Page) and publish an image post with a caption, so my Instagram feed receives content through the same unified flow.

**Why this priority**: This is the core new capability requested. Instagram publishing is a two-stage operation — the engine first prepares the media, then confirms the publish once media is ready — and the whole path must work end-to-end for the feature to have value.

**Independent Test**: Can be fully tested by connecting one Instagram Professional account (linked to a Facebook Page) and publishing a single approved image with caption. Delivers a live, visible post on the Instagram feed.

**Acceptance Scenarios**:

1. **Given** a connected Facebook Page that has an Instagram Professional account linked to it, **When** the brand registers its Instagram account, **Then** the engine resolves the Instagram account identity from the linked Page and records it as a connected `instagram` account.
2. **Given** a connected Instagram account, **When** the brand submits an approved image post with a caption, **Then** the image post appears on the Instagram feed and the engine records the platform post ID and public URL.
3. **Given** an Instagram account not linked to any Facebook Page, **When** the brand attempts to register it, **Then** the engine reports that the Instagram account must be a Professional account linked to a Facebook Page.

---

### User Story 4 - Publish a video post to Instagram (Priority: P2)

As a brand, I want to publish a short video post to my connected Instagram account, so the engine supports the media types my content team produces.

**Why this priority**: Image publishing is the higher-value, more common path and must work first. Video publishing shares the same two-stage flow and adds a media-type variant, so it is a natural follow-on slice rather than a blocker.

**Independent Test**: Can be fully tested by publishing a single approved short video to a connected Instagram account and confirming it appears on the feed.

**Acceptance Scenarios**:

1. **Given** a connected Instagram account, **When** the brand submits an approved video post, **Then** the video appears on the Instagram feed and the engine records the platform post ID and public URL.
2. **Given** a video that fails the platform's supported formats or size limits, **When** the brand submits it, **Then** the engine reports the specific content error and does not attempt a partial publish.

---

### User Story 5 - See delivery results and errors clearly (Priority: P3)

As a brand, I want to know exactly what happened to each Meta post — published with its URL, or failed with a specific, actionable reason — so I can trust the engine and fix issues without guessing.

**Why this priority**: Trust and observability. Without clear delivery records, a "silent failure" would violate the engine's core promise. This story hardens the delivery trail for Meta the same way it exists for X and LinkedIn.

**Independent Test**: Can be fully tested by triggering a successful publish and a forced failure (e.g., expired token), then confirming the delivery record and error detail for each.

**Acceptance Scenarios**:

1. **Given** a successful Meta publish, **When** the brand inspects the job, **Then** the delivery log shows the platform, the platform post ID, and the public URL.
2. **Given** a failed Meta publish, **When** the brand inspects the job, **Then** the delivery log shows a classified error (auth / rate-limit / content / transient) with a detail message.

---

### Edge Cases

- What happens when the Instagram account is not a Professional account, or is not linked to the Facebook Page? → Engine reports the linkage requirement explicitly (US3-AC3).
- What happens when the Page or Instagram access token is expired, revoked, or invalid? → Engine classifies as an authentication failure, never silent success (US2-AC3).
- What happens when Meta rate limits are hit (Instagram allows a limited number of image posts per 24 hours and fewer video posts)? → Engine classifies as a rate-limit error with the wait period, separate from transient errors.
- What happens when media cannot be downloaded or is an unsupported format/size? → Engine reports a content error and does not publish partial content (US4-AC2).
- What happens if a client begins authorization but never completes it? → The OAuth state expires (Redis TTL); the client can restart the flow; no partial account is created.
- What happens when a caption exceeds the platform limit? → Engine reports a content validation error before any platform call.
- What happens when the media step succeeds but the publish step fails? → Engine records the state accurately and reports the failure; it must not leave the brand believing the post is live.
- What happens when publishing is attempted while the engine's Meta credentials are missing from `.env`? → Engine fails fast with a clear configuration error, not a vague network error.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The engine MUST support connecting a Facebook Page to a workspace through a client **authorization flow only** — the client clicks Authorize in Meta's OAuth dialog; the client MUST never create a developer account, never supply an app ID/secret, and never see platform credentials.
- **FR-002**: The engine MUST run the connect flow through ONE RavalAI-owned Meta app (client ID/secret in `.env`), built once by RavalAI; there MUST be no per-client developer apps.
- **FR-003**: The engine MUST store the authorized Facebook Page token encrypted, isolated to its workspace, and MUST format it internally as page-id + token so both the Page identity and credential are available to the publisher.
- **FR-004**: The engine MUST publish an approved post to a connected Facebook Page (text-only, and text with a media link) using the stored per-workspace token.
- **FR-005**: The engine MUST support connecting an Instagram Professional account as an `instagram` account through the same authorization flow, resolving its identity from the Facebook Page it is linked to.
- **FR-006**: For Instagram, the engine MUST publish media using a two-stage flow: first prepare the media with its caption, then confirm the publish only after the media is ready. It MUST support image posts (with caption) and video posts.
- **FR-007**: The engine MUST record, for every successful Meta publish, the platform post ID and a public post URL.
- **FR-008**: The engine MUST classify Meta failures as authentication, rate-limit, content, or transient — never silently dropping a failure.
- **FR-009**: The engine MUST validate content against platform constraints (caption length, media format/count) before making any external call.
- **FR-010**: The engine MUST fail fast and clearly when the RavalAI Meta app credentials are missing or unset, rather than producing a misleading network error.
- **FR-011**: The engine MUST keep existing platform capabilities (X, LinkedIn, scheduling, webhooks) fully functional — adding Meta support MUST NOT regress them.
- **FR-012**: The engine MUST NOT expose any token, author URN, or credential in any API response or log (FR-MT-08).

### Key Entities *(include if feature involves data)*

- **Account**: A connected social platform identity (here: `facebook` or `instagram`). Stores the encrypted token, the platform account ID, a display username, token expiry, and status (`active` / `expired` / `disconnected`). For Facebook the platform identity is the Page ID; for Instagram it is the Instagram user ID resolved from the linked Page.
- **Post / PostTarget**: A publish request targeting one or more accounts. Each target records which account was targeted and, once delivered, the platform post ID and public URL.
- **DeliveryLog**: The auditable record of each publish attempt — platform, outcome, error classification, and detail — so "what happened to that post?" is always answerable.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A client can authorize a Facebook Page and publish a live post to it within 15 minutes of starting — without creating any developer account or handling any credential (only clicking Authorize).
- **SC-002**: A client can authorize an Instagram Professional account and publish a live image post with caption within 15 minutes of the Facebook Page being connected.
- **SC-003**: 100% of successful Meta publishes return both a platform post ID and a public post URL to the brand.
- **SC-004**: 100% of Meta failures are recorded with a classified reason (authentication / rate-limit / content / transient) — no silent failures.
- **SC-005**: 100% of Meta accounts are connected via the authorization flow — zero accounts connected via client-supplied developer credentials.
- **SC-006**: The full existing engine test suite continues to pass with Meta support added (no regression to X, LinkedIn, scheduling, or webhooks).

### Assumptions

- **One RavalAI Meta app is created once by RavalAI** (Business-type, with the required products and permissions) and its client ID/secret live in `.env`. This feature consumes that app; it does not create a new one, and clients never have their own.
- The client's Facebook Page and Instagram account are authorized through that single RavalAI app via the OAuth flow already implemented in `app/api/accounts.py` (`/oauth/{platform}/start` + `/callback`), extended for Meta Page/IG resolution.
- The Instagram account to be connected is a Professional (Business or Creator) account that has already been linked to the Facebook Page by the client in Meta's own settings. This linkage is a prerequisite the engine cannot perform on the client's behalf.
- The owner's personal credentials are used only to build and test the single RavalAI app and to act as the first test client; they are not part of the production flow.
- The exact rate limits and any app-review/advanced-access requirements are confirmed against current Meta policy at implementation time and surfaced in the plan.
