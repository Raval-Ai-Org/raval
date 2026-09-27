# ADR-0003: Per-Platform Token Refresh Strategy

- **Status:** Accepted
- **Date:** 2026-08-01
- **Feature:** 001-social-sde
- **Context:** Platform OAuth access tokens expire. The current `refresh_tokens` beat task (`app/services/scheduler_tasks.py:356-364`) is a stub that logs "refresh needed" and does nothing, so clients silently stop posting once tokens lapse. Refresh mechanics differ per platform, so the strategy must be encoded per adapter (matches CLAUDE.md "Adapters Are Armor").

## Decision

Implement **proactive, per-platform token refresh** driven by the daily beat task, with a shared refresh pipeline and platform-specific token providers:

- The beat task (`refresh_tokens`) selects active accounts whose `token_expires_at` is within the refresh window (≤7 days) and not yet expired.
- For each account it calls a **platform refresh provider** that returns a new `(access_token, refresh_token?, expires_at)`:
  - **LinkedIn**: `POST /oauth/v2/accessToken` with `grant_type=refresh_token`, `client_id`, `client_secret`, `refresh_token`.
  - **X/Twitter**: `POST /oauth2/token` with `grant_type=refresh_token`, `client_id`, `client_secret`, `refresh_token`.
  - **Meta/Facebook**: long-lived token extension (`fb_exchange_token`); on failure, mark `expired`.
- On success: re-encrypt (Fernet) and persist both tokens + new `token_expires_at`.
- On failure: mark the account `expired` and emit a webhook so the workspace re-authorizes — a post is **never silently dropped**.
- Token providers live in `app/adapters/` (or a `token.py` helper) so each platform's quirks are isolated.

## Consequences

### Positive

- **Prevents the silent-failure class**: tokens refresh before they lapse; publish success stays ≥99.9%.
- **Per-platform quirks isolated**: LinkedIn/X refresh flows differ and are each ~15 lines behind one interface.
- **Honest failure**: an unrefreshable account is surfaced as `expired` + webhook instead of failing at publish time.
- **Reuses existing pipeline**: beat schedule + sync sessions already exist; refresh runs in the same Celery worker.

### Negative

- Requires live credentials to fully verify LinkedIn/X refresh (X is credit-blocked, so X refresh is verified against the token endpoint only).
- Refresh is one more external API call path that can fail — handled by the same error taxonomy (transient retry, permanent → expired).
- A refresh token may itself rotate or be revoked; provider must persist the newest one.

## Alternatives Considered

- **Refresh lazily at publish time (on 401)**: Simpler but risks a failed post before recovery; rejected — proactive beats reactive for a scheduling engine.
- **Ignore expiry (status quo)**: Silently breaks clients; rejected.
- **One generic refresh call**: Rejected — platform refresh contracts differ; a single implementation would be wrong for at least one platform.

## References

- Feature Spec: `specs/001-social-sde/spec.md` (FR-009)
- Multi-Tenancy Amendment: `specs/001-social-sde/MULTI_TENANCY.md` (FR-MT-04)
- Implementation Plan: `specs/001-social-sde/tasks.md` (Phase 9, task 11)
- Related ADRs: ADR-0001 (auth model), ADR-0002 (LinkedIn persona)
- Evaluator Evidence: `history/prompts/001-social-sde/0005-twitter-and-linkedin-live-posting.green.prompt.md`
