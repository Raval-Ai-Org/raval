# Feature Specification: Social Distribution Engine (SDE)

**Feature Branch**: `001-social-sde`
**Created**: 2026-07-26
**Status**: Draft
**Input**: Existing full-build specification analyzed for readiness and module improvements.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Immediate Publishing (Priority: P1)

A workspace user approves a post in the RavalAI content panel and wants it published right now to one or more connected social accounts (starting with X, LinkedIn, Facebook Pages). The system must accept the request, persist it durably, validate it per platform rules, publish it, and return a confirmed status with a platform link when available.

**Why this priority**: Immediate publishing proves the core value loop end-to-end and is the foundation for all scheduled/retry behavior.

**Independent Test**: Can be fully tested using a staging mode that simulates platform behavior and delivers deterministic pass/fail outcomes without requiring real social accounts.

**Acceptance Scenarios**:

1. **Given** a workspace with valid connected accounts, **When** the user submits an approved post for immediate publishing, **Then** the system creates a durable publish job, returns a job identifier, and shows initial target statuses as pending.
2. **Given** a submitted post, **When** platform validation passes, **Then** the system publishes the content and transitions the target status to published with platform metadata captured.
3. **Given** a submitted post, **When** platform validation fails, **Then** the system returns clear, field-level validation messages indicating exactly which platform rule was violated.
4. **Given** the same publish request submitted twice with the same idempotency key, **When** the system processes the duplicate, **Then** it returns the original job without creating a second publish.

---

### User Story 2 - Scheduled Publishing with Durable Recovery (Priority: P2)

A workspace user schedules a post for a future time. The system must reliably publish it at the scheduled time, survive service restarts and worker failures, and recover automatically without manual intervention.

**Why this priority**: Scheduled publishing is the key reliability differentiator for an autonomous social operations layer.

**Independent Test**: Can be tested by scheduling a post, stopping part of the service stack before the scheduled time, restoring service, and confirming the post still publishes after recovery.

**Acceptance Scenarios**:

1. **Given** a scheduled post, **When** the scheduled time arrives, **Then** the system picks up the due job and begins processing without requiring the originating user to be online.
2. **Given** a scheduled post, **When** the system restarts before the scheduled time, **Then** the post still publishes correctly after recovery.
3. **Given** multiple scheduled posts due at the same moment, **When** multiple workers are running, **Then** each post is processed exactly once with no duplication.

---

### User Story 3 - Reliable Failure Handling, Reauthorization, and Webhook Status Updates (Priority: P3)

When publishing fails, the system must classify the failure, retry where appropriate, notify the workspace through webhooks, and request reauthorization when token problems occur.

**Why this priority**: This ensures operational resilience, transparent status communication, and minimal manual firefighting.

**Independent Test**: Can be tested by simulating different failure classes (temporary errors, token expiry, permanent content violations) and verifying correct status transitions and webhook notifications.

**Acceptance Scenarios**:

1. **Given** a target that fails due to a temporary platform error, **When** retry conditions are met, **Then** the system retries with progressive delays and updates status accordingly.
2. **Given** a target that fails due to invalid or expired authorization, **When** the failure is detected, **Then** the system marks the account as requiring reauthorization and notifies the workspace via webhook.
3. **Given** a target that fails due to permanent content policy violations, **When** the failure is recorded, **Then** the system marks the target as failed permanently and reports the exact platform reason.
4. **Given** any status change on a job or target, **When** a webhook endpoint is configured, **Then** the system sends a signed status event the workspace can use for UI updates.

---

### User Story 4 - Account Connection, Listing, and Disconnection (Priority: P4)

Workspace users can securely connect social accounts through an OAuth-style consent flow, view connected accounts, and disconnect accounts they no longer want to use.

**Why this priority**: Account management is required before publishing can happen and supports ongoing token lifecycle operations.

**Independent Test**: Can be tested by completing a mocked consent flow, listing accounts, validating token encryption at rest, and disconnecting an account to confirm revoked status.

**Acceptance Scenarios**:

1. **Given** a workspace initiating account connection, **When** the user completes the provider consent flow, **Then** the system stores encrypted credentials and returns a connected account entry.
2. **Given** a list request, **When** the workspace queries connected accounts, **Then** the system returns current status, platform, display name, and token expiry information.
3. **Given** a disconnected account, **When** the user removes it, **Then** the system marks it disconnected and prevents future publishing through that account.

---

### Edge Cases

- What happens when the same post is submitted concurrently with two different idempotency keys targeting the same account?
- How does the system behave when a platform returns partial success for multi-account publishing (some targets published, some failed)?
- What happens when webhook delivery repeatedly fails for a configured endpoint?
- How does the system handle malformed media references or unsupported content types per platform?
- What happens when token refresh fails repeatedly and the account remains in an invalid state?
- How does the system behave when due jobs backlog after a prolonged outage?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST accept publish and schedule requests for workspace-scoped posts and persist them durably before processing.
- **FR-002**: System MUST route each target to the correct platform adapter based on declared platform type.
- **FR-003**: System MUST enforce per-platform content validation rules at ingestion and return field-level errors when violated.
- **FR-004**: System MUST support immediate publishing and future scheduled publishing with reliable time-based execution.
- **FR-005**: System MUST process due jobs safely across multiple workers without duplicate publishing.
- **FR-006**: System MUST survive restarts and recover pending or due work automatically.
- **FR-007**: System MUST classify failures as retryable, authorization-related, or permanent and act accordingly.
- **FR-008**: System MUST retry transient failures with progressive delays and jitter and stop after reaching retry limits.
- **FR-009**: System MUST refresh expiring tokens proactively to avoid failed publishes due to stale credentials.
- **FR-010**: System MUST mark accounts needing reauthorization and notify the workspace immediately.
- **FR-011**: System MUST send signed webhook events for key job and account lifecycle changes.
- **FR-012**: System MUST provide observability outputs for health, queue status, failure rates, and publishing latency.
- **FR-013**: System MUST provide an append-only delivery audit trail for every publishing attempt and outcome.
- **FR-014**: System MUST support cancel operations for pending work without cancelling in-flight or already-published work.
- **FR-015**: System MUST provide a no-op staging mode for full-flow testing without calling real social platforms.
- **FR-016**: System MUST support platform feature flags so specific platforms can be enabled or disabled operationally.
- **FR-017**: System MUST expose a stable versioned integration contract for the RavalAI backend and future agents.
- **FR-018**: System MUST prevent replay abuse on authenticated endpoints using request signing and timestamp validation.
- **FR-019**: System MUST keep secrets out of code and logs and protect stored tokens at rest.
- **FR-020**: System MUST allow one-command startup for the full service stack in supported environments.

### Key Entities

- **Connected Social Account**: Represents a workspace-linked social identity or page with authorization credentials, status, and token lifecycle metadata.
- **Post**: Represents a single logical publish request from a workspace that may target multiple accounts.
- **Post Target**: Represents one publish attempt against one connected account and carries content, status, attempt history, and platform result metadata.
- **Webhook Endpoint**: Represents a workspace-registered callback destination for status and account lifecycle events.
- **Delivery Log**: Represents an append-only audit record of every publishing attempt, outcome, and diagnostic context.

## Assumptions

- The module is a backend-only distribution and scheduling layer; the RavalAI content panel remains the user interface.
- Content generation, analytics ingestion, and user authentication are out of scope for this module.
- The initial MVP platforms are X, LinkedIn, and Facebook Pages; Instagram and Threads are explicitly deferred to a near-term follow-on phase.
- Workspace-scoped service authentication is sufficient; end-user login is not owned by this module.
- The system should be deployable as a single stack rather than as a distributed microservices platform during MVP.
- Business owners will separately submit provider app approvals and business verification requirements; those external approval timelines are not owned by the module itself.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can approve a post and have it published through the module successfully in the majority of normal attempts without manual intervention.
- **SC-002**: Scheduled posts execute reliably even after service restarts or worker disruptions.
- **SC-003**: Duplicate requests using the same idempotency key do not create duplicate published posts.
- **SC-004**: Validation errors are returned with enough detail for a user to correct platform-specific issues without engineering support.
- **SC-005**: Failed publishes due to expired credentials are prevented through proactive refresh before scheduled windows when possible.
- **SC-006**: Workspace integrations can observe current job and account status through webhook events and status endpoints.
- **SC-007**: The module can be tested end-to-end in staging mode without calling external social platforms.
- **SC-008**: The full service stack can be started with a single command in supported deployment environments.
- **SC-009**: Operators can quickly determine system health, failure reasons, and retry behavior from observability outputs.
- **SC-010**: Adding support for an additional social platform requires limited, isolated work and does not require changing core publishing orchestration logic.
