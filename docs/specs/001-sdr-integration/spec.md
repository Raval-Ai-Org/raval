# Feature Specification: RavalAI × SDR Integration

**Feature Branch**: `001-sdr-integration`  
**Created**: 2026-08-08  
**Status**: Draft  
**Input**: User description: "Integrate the Social Distribution Engine (SDR) into the RavalAI platform per the finalized plan: proxy-through-server topology, per-workspace key minting, workspace_sdr + content_publications tables, publishing status, Studio Connections panel + destination picker + inline Connect, split scheduling, non-disruptive phased rollout (Phase 0 local SDR + DryRun smoke test first)."

## User Scenarios & Testing *(mandatory)*

User stories are prioritized as independently shippable slices. Each slice maps to a rollout phase so the platform never regresses: each can be developed, deployed, and demonstrated alone and still delivers value.

### User Story 1 - Connect and manage social accounts (Priority: P1)

A brand owner opens the Studio and, from the Connections area, connects their brand's LinkedIn, X, Facebook, and/or Instagram accounts. Each connected account appears with its platform, account identity (username/display name), and a clear status (Connected / Expired — Reconnect). The owner can disconnect an account at any time. Connecting uses the platform's own authorization consent screen; the brand never handles developer credentials.

**Why this priority**: This is the foundation — every other capability (publish, schedule, status) requires at least one connected account. It is also the first independent, zero-risk slice to ship (read-only; nothing else changes).

**Independent Test**: Can be fully tested by connecting a real LinkedIn (and/or X) account through the UI and verifying it appears in the Connections view with status "Connected", then disconnecting it. Delivers the account-health surface.

**Acceptance Scenarios**:

1. **Given** a workspace with no connected accounts, **When** the user starts the connect flow for LinkedIn and completes the platform's authorization, **Then** the LinkedIn account appears in the Connections view with its identity and status "Connected".
2. **Given** a connected account, **When** the platform authorization expires or is revoked, **Then** the account is shown as "Expired" with a one-click Reconnect action, and it is excluded from publish targets until reconnected.
3. **Given** a connected account, **When** the user disconnects it, **Then** it is removed from the Connections view and no longer offered as a publish target.
4. **Given** multiple workspaces, **When** one workspace connects an account, **Then** no other workspace can see or use that account (full isolation).

---

### User Story 2 - Publish approved content to connected accounts (Priority: P1)

In the social-post canvas, after content is approved, the user publishes it to a chosen set of connected accounts: a single specific account, a specific platform, or all connected accounts. The canvas shows which platforms are available (connected) and which are not (disabled with an inline Connect action). The post is submitted once; the system prevents duplicates even if the user triggers the action more than once. The content moves to a "publishing" state and, on success, to "published".

**Why this priority**: This is the core product step — turning generated content into live posts on real brand accounts. It is the single biggest capability before launch.

**Independent Test**: Can be fully tested by publishing an approved post to a connected LinkedIn and X account and confirming a live post appears on each platform with no duplicate on re-submission. Delivers real multi-platform publishing.

**Acceptance Scenarios**:

1. **Given** a workspace with LinkedIn, X, and Facebook accounts connected, **When** the user publishes an approved post to "All connected", **Then** the post is delivered to every connected account and each shows a delivery result.
2. **Given** an approved post and a connected account, **When** the user clicks Publish twice quickly (or the request is retried), **Then** only one post is created on the platform (no duplicates).
3. **Given** an approved post and a not-yet-connected platform selected, **When** the user attempts to publish to it, **Then** the platform is shown as disabled with a Connect action, and publishing proceeds only for connected destinations.
4. **Given** a publish action that succeeds on LinkedIn but fails on X, **Then** the user sees both outcomes (published on LinkedIn, failed on X) and the post is not shown as fully published overall.
5. **Given** a post being published to Instagram, **When** the post has no media attached, **Then** the user is shown a clear requirement to attach an image before publishing (Instagram requires exactly one image) rather than receiving a cryptic post-submit failure.
6. **Given** a workspace with two accounts on the same platform (e.g., two LinkedIn pages), **When** the user publishes, **Then** they can choose either specific account, the platform (all its accounts), or all connected accounts.

---

### User Story 3 - Schedule content for automatic publishing (Priority: P2)

The user schedules an approved post for a chosen future date/time (in their timezone). The system displays it as "Scheduled" in the Studio, allows changing the time before it fires, and allows canceling it. At the scheduled time the post is published automatically to the chosen accounts — even if the user is offline — and the delivery results are recorded.

**Why this priority**: Reliable scheduling is a headline feature and increases the value of every generated post, but it builds on connect + publish, so it ships after them.

**Independent Test**: Can be fully tested by scheduling a post for a few minutes ahead, leaving the session, and confirming it is published on time with a recorded live link. Delivers automated, on-time distribution.

**Acceptance Scenarios**:

1. **Given** an approved post and connected accounts, **When** the user schedules it for a future date/time, **Then** it appears as "Scheduled" and is published automatically at that time without the user being present.
2. **Given** a scheduled post, **When** the user reschedules it to a different time before it fires, **Then** it fires at the updated time.
3. **Given** a scheduled post that has not yet fired, **When** the user cancels it, **Then** it is marked canceled and never published.
4. **Given** a scheduled post that fails at fire time (e.g., account expired), **Then** the user is notified with a clear reason and can reschedule or reconnect rather than the post being silently lost.

---

### User Story 4 - See delivery status and live links per account (Priority: P2)

After publishing (now or scheduled), the Studio shows, for each destination account, the delivery state: published / retrying / failed — with the live link to the published post when available, and the reason when a delivery fails. Status updates arrive in the open Studio without a manual refresh. A permanently failed post returns to an actionable state so the user can fix and republish.

**Why this priority**: Trust and observability — users must know exactly what happened to their posts. It completes the publish and schedule stories.

**Independent Test**: Can be fully tested by publishing to two platforms, then observing independent per-platform status (one live link, one retry/fail reason) appear in the Studio without refresh. Delivers per-platform delivery truth.

**Acceptance Scenarios**:

1. **Given** a post published to LinkedIn and X, **When** both succeed, **Then** the Studio shows each account with status "Published" and the live post link.
2. **Given** a delivery that is retrying (transient failure), **When** the retry succeeds, **Then** the status transitions to "Published" with a live link; while retrying the user sees "Retrying" with the retry timing.
3. **Given** a delivery that fails permanently, **When** the failure is recorded, **Then** the user sees the reason (e.g., content rejected, account invalid) and can edit and republish.
4. **Given** the Studio is open, **When** a delivery status changes, **Then** the change is reflected without the user manually refreshing.
5. **Given** a delivery status update arrives without valid authenticity, **When** the system processes it, **Then** it is rejected and no state changes.
6. **Given** a delivery status update is delivered more than once, **When** it is applied, **Then** it is applied idempotently and produces the same state as a single delivery.

---

### User Story 5 - Safe degradation and no regression (Priority: P3)

If the distribution capability is temporarily unavailable, the platform keeps working: the user's content is never lost, no state is left half-broken, and the rest of the Studio (content creation, generation schedules, other canvases) behaves exactly as before. Distribution can be enabled/disabled without a deploy that changes other behavior.

**Why this priority**: Safety net for launch. Protects the running system and customer trust while distribution is being hardened and deployed.

**Independent Test**: Can be fully tested by disabling distribution (feature flag) and confirming all other Studio flows are unchanged and content remains intact. Delivers a non-regressing rollout guarantee.

**Acceptance Scenarios**:

1. **Given** distribution disabled, **When** a user creates, edits, or schedules content through any canvas, **Then** all existing behavior is unchanged and no content is lost.
2. **Given** distribution unavailable during a publish, **When** the user attempts to publish, **Then** they receive a clear, actionable error and the content item remains editable/retryable — never stuck in a partial state.
3. **Given** a publish partially delivered, **When** delivery stops, **Then** each already-delivered account keeps its "Published" result and undelivered accounts remain actionable.

---

### Edge Cases

- **Account expired mid-publish**: the expired account's delivery fails with a clear "Reconnect required" reason; other selected accounts still publish.
- **Partial success**: some platforms published, some failed — overall state reflects "partially published", never a blanket success/failure.
- **Duplicate submission**: double-click, retry, or a user error must not produce duplicate posts on any platform (idempotent submit).
- **Character/media limits**: content that exceeds a platform's limits is flagged to the user before or at publish time rather than silently rejected by the platform.
- **Distribution service down**: graceful failure, content retained, retryable, no corrupted state.
- **Concurrent team members**: two members publishing the same item must not double-post; the latest explicit action wins.
- **Cancel race**: a scheduled post canceled just as it fires either fires or cancels cleanly — never both.
- **Webhook/status delivery failure**: missing a status callback must not strand a post in "publishing"; the system reconciles to a definitive state.
- **Media URL expiry on a scheduled post**: a media URL that is no longer reachable at fire time must produce a clear, retryable failure — not a silent drop or a misleading "published".
- **Text-only to Instagram**: Instagram requires media; the user is guided to attach an image before publish.
- **Unverified or replayed callback**: a status callback without valid authenticity (or delivered twice) is rejected / applied idempotently — no state change from unverified sources, no double-apply.
- **Republish after permanent failure**: editing and republishing a post that previously failed permanently must create a fresh distribution attempt, not silently return the old failed result.
- **Undeliverable generated variants**: a generated variant for a platform the distribution engine does not support (e.g., Threads, TikTok, YouTube) is clearly shown as not available as a publish destination and never offered as one.
- **Facebook identity loss**: a Facebook variant must remain a Facebook destination end-to-end (it must not be re-labeled as another channel) so it is actually publishable to Facebook.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Users MUST be able to connect at least one account per supported platform (LinkedIn, X, Facebook, Instagram) from the Studio, via each platform's own authorization consent.
- **FR-002**: The system MUST display all connected accounts for the workspace with platform, account identity, and connection status (Connected / Expired / Disconnected).
- **FR-003**: Users MUST be able to disconnect a connected account.
- **FR-004**: When an account's authorization expires or is revoked, the system MUST mark it Expired, surface a Reconnect action, and exclude it from publish targets.
- **FR-005**: Users MUST be able to publish an approved content item to a single specific account, a specific platform, or all connected accounts.
- **FR-006**: The system MUST make publish submission idempotent — a repeated or retried submission MUST NOT create a duplicate post on any platform.
- **FR-007**: Unconnected platforms MUST be shown as unavailable in the publish picker, with an inline Connect action, and MUST NOT block publishing to connected destinations.
- **FR-008**: Users MUST be able to schedule an approved content item for a future date/time and have it published automatically, without the user being present.
- **FR-009**: Users MUST be able to reschedule and cancel a scheduled item before it fires.
- **FR-010**: The system MUST record and display per-destination delivery status (Published / Retrying / Failed) with a live link when available and a clear reason on failure.
- **FR-011**: The system MUST represent partial success when a publish succeeds on some destinations and fails on others.
- **FR-012**: Platform content limits (characters, media) MUST be validated with a user-visible message before a rejected-by-platform result.
- **FR-013**: Workspace data isolation MUST hold: accounts, publish actions, and delivery records of one workspace MUST NOT be visible to or usable by another.
- **FR-014**: Publishing credentials MUST NOT be exposed to the user's browser or any client-side code.
- **FR-015**: When the distribution capability is unavailable, the system MUST fail gracefully, retain all content, and leave every item in a consistent, actionable state.
- **FR-016**: Retryable delivery failures MUST be retried automatically with increasing backoff; permanent failures MUST be surfaced with the reason.
- **FR-017**: Distribution capability MUST be toggleable independently (feature flag) so the platform never regresses during rollout.
- **FR-018**: The system MUST reconcile any missed status callback so no item remains stuck in "publishing" indefinitely.
- **FR-019**: Media attached to a content item MUST be transferred to the distribution engine and remain fetchable at publish time (for scheduled posts this is minutes or days later), so delivery never fails on an expired or unreachable media URL.
- **FR-020**: For destinations that require media (e.g., Instagram requires exactly one image), the user MUST be guided to attach media before publish rather than receiving a post-submit platform rejection.
- **FR-021**: Every delivery status callback MUST be cryptographically verified as authentic before any state change is applied; unverified callbacks MUST be rejected, and callbacks MUST be applied idempotently (repeated delivery produces the same state).
- **FR-022**: The system MUST automatically provision a workspace's distribution identity (its access credential and its dedicated delivery callback endpoint) on first use, entirely server-side and without user-visible setup.
- **FR-023**: Republishing content that previously failed permanently MUST start a fresh distribution attempt (a new identity), so it is not suppressed by the earlier failed job.
- **FR-024**: Publish and schedule actions MUST only be available for content in an approved state, and MUST require an explicit user action (the user's click is the consent for the irreversible public post).
- **FR-025**: Schedule times MUST be stored as absolute instants; the UI MUST accept and display them in the user's timezone without ambiguity.
- **FR-026**: The destination platform of every generated variant MUST be preserved from creation through approval and publishing (a Facebook variant stays a Facebook destination), so content is never mis-routed.
- **FR-027**: Pre-publish content validation MUST use a single authoritative source of platform limits (the distribution engine's own limits) so valid content is never wrongly blocked and invalid content is never sent.
- **FR-028**: Generated variants for platforms the distribution engine cannot deliver (e.g., Threads, TikTok, YouTube) MUST be clearly presented as not available as publish destinations and MUST NOT be offered as targets.

### Key Entities

- **Connected Social Account**: A brand's account on a platform (LinkedIn, X, Facebook, Instagram) authorized for the workspace — platform, account identity, connection status, expiry. Belongs to exactly one workspace.
- **Content Item**: An existing entity (a post/caption generated and approved in the Studio) that is the subject of distribution.
- **Distribution Job**: The request to publish a content item to one or more connected accounts — its overall status and timeline.
- **Delivery Record**: The per-account outcome of a job — published / retrying / failed, live post link, error category and reason, timestamps. The source of the Studio's delivery view.
- **Workspace Credential**: The secure, server-side mapping that lets a workspace use the distribution capability; never exposed to the browser.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can connect a social account and see it in the Connections view in under 2 minutes.
- **SC-002**: A successful publish shows a confirmed "Published" state with a live post link in the Studio within 60 seconds of the post being live.
- **SC-003**: Duplicate-publish protection: repeated/retried submission of the same action produces 0 duplicate posts on any platform.
- **SC-004**: Scheduled posts are published within 5 minutes of their scheduled time ≥99% of the time while the distribution service is healthy.
- **SC-005**: Expired/revoked accounts never fail silently: 100% of expired-token delivery attempts produce a visible, actionable "Reconnect required" state.
- **SC-006**: 100% of delivery outcomes (published / retrying / failed) are visible to the user with a reason for any failure.
- **SC-007**: Platform non-regression during rollout: all existing Studio flows (content creation, generation schedules, other canvases) behave identically while distribution is rolled out behind a flag.
- **SC-008**: No content is ever lost across any failure path (service down, partial publish, canceled race).
- **SC-009**: 100% of delivery state changes are applied only from verified callbacks — zero state changes from unverified sources.
- **SC-010**: Media-bearing posts (immediate and scheduled) deliver successfully ≥99% of the time when their media remains reachable; expired-media failures are visible and actionable, never silent.

## Assumptions

- The distribution capability is provided by an external service (the Social Distribution Engine) that owns platform authorization, token storage, and delivery execution. RavalAI integrates with it as a trusted counterparty and never re-implements platform APIs.
- Each workspace gets its own distribution identity (per-workspace key) and its own delivery callback secret — no cross-workspace sharing.
- Supported platforms in scope for launch: LinkedIn, X, Facebook, Instagram. Other platforms (Threads, TikTok, YouTube) are out of scope and behave as "not connected" today.
- RavalAI's existing generation scheduler (scheduled content production) remains in RavalAI; the distribution service owns only delivery timing. These are separate concepts and are not merged.
- Rollout is phased and flag-gated; each user story above is independently shippable without regression.
- Phase 0 (stand up the distribution engine locally and smoke-test it in dry-run mode) is a prerequisite but does not change any user-facing behavior.
- Media handed to the distribution engine MUST be reachable via durable, public (or long-lived) URLs at publish time — short-lived signed URLs are not acceptable for scheduled posts.
- Delivery callbacks are verified server-side against a per-workspace secret; verification is a server-only responsibility and never exposed to the browser.
