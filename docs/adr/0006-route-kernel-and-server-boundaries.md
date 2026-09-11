# ADR-0006: Route Kernel, Safe Outbound Fetch, and Enforced Server/Client Boundaries

- **Status:** Accepted
- **Date:** 2026-09-11
- **Context:** The RPC path (`/api/rpc` → `createServerFn` → RLS-bound client) was correct by default, but the 25 authenticated `/api/*` routes each hand-rolled authentication, body parsing, workspace membership, rate limiting and error mapping — in different orders, with six separate Supabase user-client factories (some untyped) and no auth check at all on `/api/sdr/publications`. Several paid endpoints (`clarify`, `file-extract`, `memory-extract`, `social-multi`, `market/trends`, and eight RPC functions) had no rate limit. The SSRF guard checked only the first hostname, so a redirect or a DNS answer could reach private addresses. Server-only modules were a naming convention, and cross-component UI events were untyped strings — four of them silently dead.

## Decision

### 1. Every authenticated `/api` route is built with `defineRoute` (`src/server/route.ts`)

Fixed order: **authenticate → validate → workspace membership → rate limit → handler**. Validation precedes the limiter, so malformed requests never burn quota. The handler receives the caller's **RLS-bound** client (`ctx.supabase`); `supabaseAdmin` stays an explicit, reviewable import. Returning a `Response` passes it through (streams); anything else becomes `no-store` JSON. One error mapper (`knownErrorResponse`) — shared with `/api/rpc` — turns `UpstreamError`, `RateLimitedError`, `SsrfBlockedError`, `ZodError` and `Unauthorized…` into statuses; everything else logs and returns a generic 500.

Excluded by design: `public/hooks/*` (cron-secret auth), `public/share/[slug]` (anonymous, slug-keyed limiter), `rpc`, `health`, and the public stock-media proxies (`pexels`, `unsplash`).

### 2. One authentication primitive

`verifyBearer` (`src/server/api-auth.ts`) validates the JWT and builds the user client via `createUserClient` (`src/integrations/supabase/client.user.server.ts`). `requireUserId`, `requireWorkspaceAccess`, the kernel, and the RPC middleware `requireSupabaseAuth` all wrap it.

### 3. User-supplied URLs are fetched only through `safeFetch` (`src/server/safe-fetch.ts`)

An undici `Agent` with a guarded DNS lookup rejects any connection whose resolved address is loopback, private, link-local/metadata, CGNAT, multicast, or IPv4-mapped into one of those. Redirects are followed manually and each hop is re-validated; bodies are read with a byte cap (`truncate` for crawls, `error` for downloads). Fixed third-party APIs (OpenRouter, Anthropic, KIE, DataForSEO, Pexels, Unsplash) keep plain `fetch`.

### 4. Paid providers share one transport (`src/server/upstream.ts`)

`fetchWithTimeout` / `fetchWithRetry` (Retry-After aware) and the `UpstreamError` base class. `AiGatewayError`, `AnthropicGatewayError` and `KieGatewayError` extend it, so callers map any provider failure without listing classes.

### 5. RPC functions that spend money declare a rate limit

`.middleware([requireSupabaseAuth, rateLimitFor("generate")])` — same Postgres-backed buckets as the kernel, surfaced as 429 by `/api/rpc`.

### 6. The server/client boundary is enforced, not conventional

Every `*.server.ts`, `src/server/**` module and the `@/lib/ai` barrel imports `server-only` (Next fails the build if a Client Component pulls one in; vitest aliases it to an empty module). ESLint forbids value imports of server modules from `src/components`, `src/hooks`, `src/lib/*.functions.ts` and non-page `src/app` files; `import type` stays allowed.

### 7. Cross-component UI events are declared in `src/lib/app-events.ts`

`AppEventMap` names every window event and its payload; `emitAppEvent` / `useAppEvent` / `onAppEvent` only accept declared names. ESLint forbids `new CustomEvent(` and colon-named `addEventListener` calls elsewhere.

## Consequences

### Positive

- A new route cannot forget auth, validation order, or error mapping; RLS is the default on both server paths.
- Redirect- and DNS-based SSRF are closed at the socket, not just the URL string.
- Spend controls now cover every metered entry point, including RPC.
- The typed event registry surfaced four dead wires at compile time: "Save to Memory" in the client portal discarded the note (now persisted via `src/lib/notes-store.ts`), the Analytics AI-visibility button fired the wrong name, Brand DNA saves never refreshed Studio suggestions (now a debounced `brand-dna:saved`), and two dispatches had no listener.

### Negative

- Routes depend on the kernel's shape; genuinely unusual routes (multi-action `shares`) parse their own bodies inside the handler.
- `safeFetch` uses undici's own `fetch`, not the global — a second HTTP stack in the bundle.
- `open:upgrade` is still declared with no listener: there is no billing surface yet. That is a product decision, not a wiring bug.

## Alternatives Considered

- **Next `middleware.ts` for auth** — runs before routing but cannot build the RLS client or know a route's rate-limit tier; the kernel still needs per-route knowledge — **rejected**.
- **Hostname-only SSRF checks plus `redirect: "error"`** — breaks legitimate `http → https` and `apex → www` redirects and still misses DNS answers — **rejected**.
- **Replacing window events with a React context store** — correct long-term for server state (see deferred React Query work) but a far larger change; typing the existing bus fixes the failure mode now — **deferred**.

## References

- `docs/CODEBASE-ANALYSIS-2026-09-11.md` §9
- `src/server/route.ts`, `src/server/safe-fetch.ts`, `src/server/upstream.ts`, `src/server/rate-limit.ts`, `src/lib/app-events.ts`
