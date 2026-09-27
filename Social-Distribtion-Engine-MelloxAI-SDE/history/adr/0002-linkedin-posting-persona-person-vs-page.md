# ADR-0002: LinkedIn Posting Persona — Person vs Page

- **Status:** Accepted
- **Date:** 2026-08-01
- **Feature:** 001-social-sde
- **Context:** LinkedIn's UGC Post API requires an author URN (`urn:li:person:<id>` for individuals, `urn:li:organization:<id>` for company Pages) and the OAuth scope differs between the two (`w_member_social` for persons, `w_organization_social` for Pages). The current adapter fabricates the author as `urn:li:person:{account_id}` from whatever string is passed as the token (`app/adapters/linkedin.py:84`), which is both wrong (it uses the token string) and fails for Page posting. This decision must be locked before the token-decryption fix so the worker knows which identity to post as.

## Decision

Capture the posting **persona per account at OAuth connect time** and pass it explicitly at publish:

- At connect, fetch the LinkedIn identity from `GET /v2/userinfo` and store in `accounts.metadata`:
  - `author_urn` = `urn:li:person:<sub>` (person) or `urn:li:organization:<id>` (Page)
  - `persona` = `"person"` | `"page"`
- Extend the adapter publish signature with an optional `author_urn`; the adapter uses it when provided instead of fabricating one.
- The worker/publisher decrypts the access token and passes `author_urn` from `account.metadata`.
- Phase-1 ships **person** posting (verified live). Page posting requires `w_organization_social` scope + Page selection during connect, flagged as a follow-on capability.

## Consequences

### Positive

- **Correct identity, always**: the author URN comes from LinkedIn's own identity response, not guessed from a token string.
- **One change unlocks Pages later**: the plumbing (author_urn through the worker) is identical for person and Page; only the connect-time scope + metadata differ.
- **Auditable**: the persona is stored data, so "which identity did this post publish as?" is answerable from the account row.

### Negative

- Requires storing a small extra metadata blob on the account row (negligible).
- Adapter interface signature changes ripple to mocks/tests (bounded, one parameter).
- Page posting is not live in Phase 1 (needs scope + Page picker) — a documented limitation, not a regression.

## Alternatives Considered

- **Keep deriving author from token string**: Rejected — provably wrong (token ≠ URN) and unworkable once the token is a real bearer token.
- **Ask the user for persona on every publish**: Rejected — leaks platform knowledge into the API contract and is a UX burden; persona is a property of the connected account.
- **Separate "person adapter" and "page adapter" classes**: More code with no benefit; a single adapter + persona metadata is simpler.

## References

- Feature Spec: `specs/001-social-sde/spec.md`
- Multi-Tenancy Amendment: `specs/001-social-sde/MULTI_TENANCY.md` (FR-MT-07)
- Implementation Plan: `specs/001-social-sde/tasks.md` (Phase 9, tasks 3 & 4)
- Related ADRs: ADR-0001 (auth model), ADR-0003 (token refresh strategy)
- Evaluator Evidence: `history/prompts/001-social-sde/0005-twitter-and-linkedin-live-posting.green.prompt.md` (verified `sub`, working scopes)
