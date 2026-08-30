# SDE — Multi-Tenancy Requirements Amendment

**Feature**: 001-social-sde · **Branch**: 001-social-sde · **Date**: 2026-08-01
**Status**: Accepted (amends `spec.md`)
**Scope**: Turns the SDE from a single-workspace lab module into the **distribution service for the RavalAI platform**, where many brands authorize their own social accounts and RavalAI posts on their behalf.

---

## 1. Context

The SDE is the "last mile" of RavalAI: it accepts approved posts from the platform's content panel and publishes them to X, LinkedIn, Facebook, Instagram. In production there is **one RavalAI developer app per platform** (the same model Buffer/Omni use). Each brand (workspace) authorizes its own social account _through that single app_, and RavalAI holds that brand's OAuth credentials — encrypted, isolated per account — and posts with the brand's identity.

The current implementation routes every authenticated caller to the default workspace (`workspace_001`) and treats the platform account id as the OAuth token. That is fine for a demo and **unacceptable for real clients**. This amendment pins the requirements that close the gap.

---

## 2. Core Model (Non-Negotiable)

- **One RavalAI dev app per platform.** Brands never create their own developer apps. RavalAI registers one app on X/LinkedIn/Meta; every brand authorizes through it; consent, quotas, and revocations are isolated per account token.
- **Tenant = workspace.** All data rows (`accounts`, `posts`, `post_targets`, `webhooks`, `delivery_logs`) are workspace-scoped, and **every authenticated request resolves to exactly one workspace** via a per-workspace credential (see FR-MT-02).
- **Token ownership is per account, never shared.** A brand's OAuth tokens live only on that brand's account rows, encrypted with Fernet at rest, and are decrypted **only at publish/refresh time** in the worker.
- **Approval boundary holds** (CLAUDE.md 4.3): the engine publishes, schedules, and retries — it never _decides_ to publish. Approval is a platform concern enforced before `/api/v1/publish` is called.
- **Deterministic, auditable dispatch.** Publish path contains no LLM calls; every step lands in `delivery_logs`.

---

## 3. Functional Requirements (deltas to `spec.md`)

| ID           | Requirement                                                                                                                                                                                                             |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **FR-MT-01** | The system MUST support ONE RavalAI OAuth app per platform; all tenants authorize through it. Per-tenant identity comes from the OAuth account, never from per-tenant developer apps.                                   |
| **FR-MT-02** | The system MUST authenticate each API request to exactly one workspace using a per-workspace credential (API key). The single global `SDE_API_TOKEN` MAY remain for ops only and MUST NOT grant workspace data.         |
| **FR-MT-03** | The system MUST decrypt and use the per-account OAuth access token (from `accounts.encrypted_access_token`) when publishing; it MUST NOT pass the platform account id as the token.                                     |
| **FR-MT-04** | The system MUST refresh per-account tokens proactively per platform (LinkedIn & X: `refresh_token` grant; Meta: long-lived token extension). Refresh failures MUST mark the account `expired` and notify the workspace. |
| **FR-MT-05** | The system MUST store OAuth state durably (Redis with TTL), not in process memory, so callbacks survive restarts and multi-instance deployments.                                                                        |
| **FR-MT-06** | The system MUST scope webhook delivery to the workspace that registered the endpoint and MUST sign every event (HMAC-SHA256).                                                                                           |
| **FR-MT-07** | The system MUST record an author identity (`author_urn`, persona) on each account at connect time so publishes use the correct identity (person vs Page).                                                               |
| **FR-MT-08** | The system MUST never expose a token, author URN, or other credential in any API response or log.                                                                                                                       |
| **FR-MT-09** | The system MUST return a 409 (not 500) when a duplicate `idempotency_key` races with a concurrent request.                                                                                                              |
| **FR-MT-10** | The system MUST resolve the platform name from the account row in all job/target responses (no hardcoded `"dryrun"`).                                                                                                   |

---

## 4. Data Model Implications

- **New table `api_keys`**: `id`, `workspace_id`, `key_hash` (SHA-256 of the raw key), `label`, `created_at`, `revoked_at`, `last_used_at`. The raw key is issued once at creation and never stored.
- **`accounts.metadata`** gains `author_urn` (e.g. `urn:li:person:<sub>` or `urn:li:organization:<id>`) and `persona` (`"person"` | `"page"`), captured at OAuth connect time.
- **`delivery_logs`** remain the append-only audit trail per workspace.

---

## 5. Non-Functional Requirements

| Area              | Requirement                                                                                                                            |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **Isolation**     | A request authenticated as workspace A MUST NOT read or mutate workspace B rows. Enforced in every query (`WHERE workspace_id = ...`). |
| **Security**      | API keys stored hashed; OAuth tokens Fernet-encrypted at rest; secrets never in logs or responses.                                     |
| **Reliability**   | Token refresh keeps publish success ≥99.9%; a stale/expired token never silently drops a post — it marks `expired` and notifies.       |
| **Observability** | Every job answers "what happened to that post?" in <10s via `GET /jobs/{id}` timeline + webhooks.                                      |

---

## 6. Out of Scope (this amendment)

- End-user login / SSO / JWT issuance (owned by the RavalAI platform).
- Brand-data ingestion, LLM content generation, analytics, billing.
- Per-tenant developer apps on platform sides.
- Public HTTPS termination (ops concern at deploy time).

---

## 7. Acceptance Criteria

- [ ] Two API keys for two workspaces can each list only their own accounts.
- [ ] A publish with account A's id from workspace B is rejected.
- [ ] A real LinkedIn post publishes through `/api/v1/publish` using the decrypted token + `author_urn`.
- [ ] A scheduled post publishes through `/schedule` + worker + beat.
- [ ] Webhook fires on `post.published` / `post.failed` scoped to the owning workspace.
- [ ] Concurrent duplicate `idempotency_key` returns 409.
- [ ] Job responses report the real platform (`linkedin`, `twitter`, ...), never `"dryrun"`.
- [ ] OAuth callback survives an API restart mid-flow (Redis-backed state).
- [ ] No secret or token appears in any response payload or structured log.

---

## 8. Related Artifacts

- `history/adr/0001-*` — multi-tenant auth model (API keys vs JWT)
- `history/adr/0002-*` — LinkedIn posting persona (person vs Page)
- `history/adr/0003-*` — per-platform token-refresh strategy
- `specs/001-social-sde/tasks.md` — Phase 9 (implementation tasks)
