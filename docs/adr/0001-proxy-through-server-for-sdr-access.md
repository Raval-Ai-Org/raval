# ADR-0001: Proxy-Through-Server for SDR Access

- **Status:** Accepted
- **Date:** 2026-08-08
- **Feature:** 001-sdr-integration
- **Context:** RavalAI must publish client content to LinkedIn, X, Facebook, and Instagram via the standalone Social Distribution Engine (SDR). The SDR holds platform OAuth tokens and the per-workspace credentials that authorize publishing. Spec FR-014 requires that publishing credentials never reach the browser, and FR-013 requires full workspace isolation. The SDR's own auth model is per-workspace Bearer keys, so a decision about where those keys live and how the browser reaches the SDR is forced before any integration work.

## Decision

The browser **never calls the SDR directly**. Every SDR operation flows through a RavalAI server function / file route:

```text
Browser (Studio) ── Supabase JWT + RLS ──▶ TanStack server fn ──▶ SDR (Bearer: per-workspace key)
```

- The server fn re-validates the caller's Supabase session (`requireUserId`) and relies on RLS (`is_workspace_member`) to authorize the `workspace_id`.
- The per-workspace SDR key + webhook secret are read server-side from `workspace_sdr` via the service-role client only; `SDR_ADMIN_TOKEN` and the default `SDR_BASE_URL` live in server-only env (never `VITE_*`).
- Outbound fetch validates the SDR base URL with `assertPublicUrl` (SSRF guard); loopback is permitted for local/dev integration.
- This gives one auditable choke point for idempotency, rate limiting, and audit logging of every proxied SDR call.

## Consequences

### Positive

- **Credentials never reach the browser** (FR-014): the raw per-workspace key and webhook secret are service-role-only, so a client-side compromise cannot exfiltrate them.
- **Isolation is enforced by RLS + per-workspace key together** (FR-013): the server fn scopes every call to the caller's workspace, and the SDR key itself is workspace-specific — defense in depth.
- **One choke point** for request-id, latency logging, idempotency-key derivation, and error-taxonomy mapping (already used for observability, T074).
- **Server-side only**: the SDR's token refresh and OAuth consent still land on RavalAI server routes, keeping the flow intact end-to-end.

### Negative

- Adds a server hop and therefore latency on every SDR call (small; publish is submit-fast, terminal status arrives via webhooks, so the extra hop is off the user-critical path).
- Requires every new SDR endpoint to get a matching proxy route — a small surface to maintain as the integration grows.
- Server fns must be written defensively against SSRF and workspace confusion (mitigated by `assertPublicUrl` + RLS).

## Alternatives Considered

- **(a) Direct browser→SDR**: exposes per-workspace keys to the client, no RLS, breaks isolation — **rejected** (FR-014).
- **(b) Shared Supabase DB between RavalAI and SDR**: couples data planes, violates the SDR's own-DB "build for extraction" doctrine — **rejected**.
- **(c) Merge SDR into `raval/`**: one failure domain, kills service independence and the SDR's modular-monolith extraction goal — **rejected**.

## References

- Feature Spec: `specs/001-sdr-integration/spec.md` (FR-013, FR-014)
- Implementation Plan: `specs/001-sdr-integration/plan.md` (decision D1)
- Contract: `specs/001-sdr-integration/contracts/sdr-proxy.md`
- Evaluator Evidence: `history/prompts/social-distribution-engine/002-integration-topology-evaluation.plan.prompt.md`
