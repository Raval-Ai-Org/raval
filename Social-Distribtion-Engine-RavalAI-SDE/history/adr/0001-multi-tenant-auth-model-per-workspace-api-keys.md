# ADR-0001: Multi-Tenant Auth Model — Per-Workspace API Keys

- **Status:** Accepted
- **Date:** 2026-08-01
- **Feature:** 001-social-sde
- **Context:** The SDE is being integrated into the RavalAI platform where many brands (workspaces) will use the same service. Today every authenticated caller is mapped to a single default workspace (`workspace_001`) via one global `SDE_API_TOKEN` (`app/api/deps.py`). That is a cross-tenant leak: any holder of the token can read/mutate any tenant's rows. We must authenticate each request to exactly one workspace before the SDE can carry real client traffic.

## Decision

Adopt **per-workspace API keys** as the primary authentication credential for the SDE:

- A new `api_keys` table stores `workspace_id` and a SHA-256 **hash** of the raw key (raw key shown once at issuance, never stored).
- `Authorization: Bearer <key>` → hash → lookup → resolve `workspace_id` + `brand_id`.
- The legacy global `SDE_API_TOKEN` remains only for ops/health and must not grant workspace data.
- HMAC-SHA256 request signing and timestamp replay protection (already in `app/security.py`) stay as-is for webhook verification.

## Consequences

### Positive

- **Real tenant isolation**: Client A's key can never touch Client B's rows — enforced by the auth resolver, not by caller discipline.
- **Simple revocation**: disable one key, no re-deploy; per-workspace key rotation is straightforward.
- **No session/token signing keys to rotate**: stateless verification (hash lookup), no JWT secret management.
- **Fits the platform today**: RavalAI's platform layer owns end-user login/SSO; the SDE only needs a stable per-workspace credential, which the platform mints at workspace onboarding.

### Negative

- Key lifecycle (issue/revoke/rotate) must be managed — the SDE exposes minimal admin endpoints, the platform UI drives them.
- No user-level identity inside the SDE (all requests are workspace-scoped, not user-scoped) — acceptable because end-user auth is explicitly out of scope for this module.
- Hash-lookup adds one DB round-trip per request (mitigated by a tiny cache if needed later).

## Alternatives Considered

- **JWT / OIDC access tokens (platform-issued)**: More standard for a big platform, supports user-level claims and expiry. Rejected for now because the RavalAI platform does not yet issue tokens; it would couple the SDE's auth to the platform's future auth system before that system exists. Can be layered on later (a JWT layer in front of the same resolver) without changing the data model.
- **Shared global token (status quo)**: Fastest to demo, but a direct cross-tenant leak; rejected as production-blocking.
- **Per-tenant client certificates**: Overkill for a JSON API; rejected.

## References

- Feature Spec: `specs/001-social-sde/spec.md`
- Multi-Tenancy Amendment: `specs/001-social-sde/MULTI_TENANCY.md` (FR-MT-02)
- Implementation Plan: `specs/001-social-sde/tasks.md` (Phase 9, task 10)
- Related ADRs: ADR-0003 (token refresh strategy)
- Evaluator Evidence: `history/prompts/001-social-sde/0007-full-codebase-analysis-and-integration-roadmap.plan.prompt.md`
