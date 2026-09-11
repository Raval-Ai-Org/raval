# Mellox AI — Full Codebase Analysis

**Date:** 2026-09-11
**Commit analyzed:** `b2d0a4d` (branch `main`)
**Scope:** architecture & code health, security & production readiness, product & feature inventory

---

## 1. Executive summary

Mellox AI is a ~63k-LOC Next.js 16 / React 19 + Supabase marketing platform with a
custom RPC layer, four AI provider gateways, an SEO/GEO/AEO audit engine, and a
proxied social-distribution integration. **The engineering fundamentals are
genuinely good** — the build is clean, types are clean, the test suite is green,
RLS is on every table, and every API route validates input and checks auth.

The problems are not in the code that was written carefully. They are in the
**operational perimeter around it**: a live secret sitting in pushed git history,
no CI gate on the code that matters, no rate limiting on metered AI endpoints, and
a lint config that produces 6,772 errors so nobody reads it.

### Verified health checks

Both columns were measured. "Before" is commit `b2d0a4d`; "after" is the working
tree with Phase 1 + Phase 2 applied (see §8).

| Check                    | Command                | Before                                | After                     |
| ------------------------ | ---------------------- | ------------------------------------- | ------------------------- |
| Type safety              | `npm run typecheck`    | ✅ 0 errors                           | ✅ 0 errors               |
| Production build         | `npm run build`        | ✅ exit 0, 54 routes                  | ✅ exit 0, 54 routes      |
| Unit / contract tests    | `npm test`             | ✅ 183 / 44 files                     | ✅ **205 / 46 files**     |
| Lint                     | `npx eslint .`         | ❌ **6,772 errors**                   | ✅ **0 errors**, 386 warn |
| Format                   | `npm run format:check` | ❌ 24 CRLF files                      | ✅ clean                  |
| Dependency audit         | `npm audit --omit=dev` | ⚠️ 1 high (`xlsx`)                    | ✅ **0 vulnerabilities**  |
| Migration apply script   | `apply_migrations_cli` | ❌ **exits 1** (16 files "malformed") | ✅ 61 validate            |
| Secrets in tracked files | manual scan            | ✅ clean                              | ✅ clean                  |
| Secrets in git history   | `git show <rev>:.env`  | ❌ **SDR admin token live**           | ❌ **still — rotate it**  |

### Scorecard

Grades describe commit `b2d0a4d` as analyzed. §8 records which of these have
since been addressed — abuse controls, CI, and code health in particular.

| Dimension                    | Grade  | One-line                                                                              |
| ---------------------------- | ------ | ------------------------------------------------------------------------------------- |
| Security — application layer | **A−** | RLS everywhere, HMAC webhooks, SSRF guards, timing-safe compares, AES-256-GCM at rest |
| Security — secret hygiene    | **D**  | `.env` committed to history and pushed; `SDR_ADMIN_TOKEN` never rotated               |
| Abuse / cost controls        | **F**  | Zero rate limiting on any metered AI endpoint                                         |
| Architecture                 | **B+** | Clean RPC seam and server/client split; a few 3,000-line components                   |
| Code health                  | **B**  | Types clean, tests green; lint gate unusable, `any` in 44 files                       |
| CI / release engineering     | **D**  | One workflow, and it does not run tsc, lint, or the 183 tests                         |
| Product coherence            | **B**  | Rich surface, but nav collapsed to one item and SDR shipped dark                      |
| Documentation                | **B−** | Unusually thorough ADRs/specs; several stale paths and a password in the README       |

---

## 2. What Mellox AI is — product inventory

An AI-native marketing platform for brands and agencies. One workspace covers
plan → create → optimize → distribute, grounded in a per-brand "Brand DNA".

### Feature surface (verified against code, not docs)

| Module                           | Where it lives                                                                                                                  | Status                                                                        |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| **Ravi chat copilot**            | [route.ts](src/app/api/chat/route.ts), [ChatPanel.tsx](src/components/app/ChatPanel.tsx)                                        | Live — SSE streaming, action tags (`[[action:…]]`) the UI parses and executes |
| **Brand DNA**                    | [BrandDnaPanel.tsx](src/components/app/BrandDnaPanel.tsx) (3,892 LOC), [brand-extract](src/app/api/brand-extract/route.ts)      | Live — site crawl → Claude extraction                                         |
| **Studio / canvas**              | [StudioCanvasModal.tsx](src/components/app/StudioCanvasModal.tsx) (2,909 LOC)                                                   | Live — copy + image + video composition                                       |
| **Image / video generation**     | [kie-gateway.server.ts](src/lib/kie-gateway.server.ts), [model-router.server.ts](src/lib/model-router.server.ts)                | Live — KIE, 6 models, complexity-scored routing with fallbacks                |
| **SEO / GEO / AEO audit**        | [geo-audit](src/app/api/geo-audit/route.ts) (674 LOC), [GeoAeoPanel.tsx](src/components/app/GeoAeoPanel.tsx)                    | Live — the differentiated feature ("get visible inside LLMs")                 |
| **Market Brain**                 | [market-intelligence.server.ts](src/lib/market-intelligence.server.ts), [dataforseo/](src/lib/dataforseo)                       | Live — Google Trends via DataForSEO, cron-collected                           |
| **Competitor Watch**             | [competitor-watch.server.ts](src/lib/competitor-watch.server.ts)                                                                | Live — pg_cron sweep every 30 min                                             |
| **Marketing Coach**              | [coach.ts](src/server/fns/coach.ts), [MarketingCoachPanel.tsx](src/components/app/MarketingCoachPanel.tsx)                      | Live — Claude Sonnet/Opus, PDF export                                         |
| **Content calendar & lifecycle** | [ContentCalendar.tsx](src/components/app/ContentCalendar.tsx) (2,353 LOC), [content-lifecycle.ts](src/lib/content-lifecycle.ts) | Live — 9-state machine with enforced transitions                              |
| **Agency command center**        | [AgencyPage.tsx](src/app/agency/AgencyPage.tsx) (3,537 LOC)                                                                     | Live — multi-client feed, realtime                                            |
| **Client share portal**          | [share/[slug]](src/app/api/public/share/[slug]/route.ts)                                                                        | Live — tokenized, scrypt-password, approvals                                  |
| **Social distribution (SDR)**    | [sdr.handlers.ts](src/lib/sdr.handlers.ts), 7 `/api/sdr/*` routes                                                               | **Built, tested, shipped dark** — `FEATURE_FLAG_SDR_ENABLED` off by default   |
| **Analytics**                    | [analytics.ts](src/server/fns/analytics.ts)                                                                                     | Live                                                                          |

### Product observations

1. **The SDR is complete but disabled.** Seven proxy routes, HMAC webhook receiver,
   reconciliation sweep, per-workspace key provisioning, 7 contract test files —
   all gated off by [feature-flags.ts:8](src/lib/feature-flags.ts:8). Per
   [INTEGRATION-HOLD.md](docs/specs/001-sdr-integration/INTEGRATION-HOLD.md) this
   is blocked on infrastructure decisions (Supabase project choice, deployment),
   not code. Real capital is parked here.

2. **The navigation has collapsed to a single item.**
   [app-nav.ts:12](src/lib/app-nav.ts:12) defines `workspaceModules` as exactly one
   entry: `Chat`. Every other module reaches the user through modals, rails, and
   dialogs off the chat shell. Meanwhile the AI's own `PRODUCT_SURFACE` prompt
   fragment still advertises `/agency`, `/projects`, `/calendar`, and three named
   agents ([fragments.ts:61](src/lib/ai/prompts/fragments.ts:61)). Either the
   chat-first collapse is the intended product and the prompt is stale, or
   navigation regressed. **This needs a product decision, not a code fix.**

3. **Agent roster is aspirational.** [agents.ts](src/lib/agents.ts) defines one agent
   (`Scout`/SEO) but the prompt promises `Scout/SEO, Spark/Content, Echo/Social`.
   The model will confidently describe agents that do not exist.

---

## 3. Architecture

### The request path

```
Browser (client component)
  └─ src/lib/*.functions.ts          stub: POST /api/rpc/<module>/<fn> { data }
       └─ src/app/api/rpc/[...fn]/route.ts       single transport, dispatch + error mapping
            └─ src/server/request-context.ts     AsyncLocalStorage request scope
                 └─ requireSupabaseAuth          validates Bearer, builds RLS-bound client
                      └─ src/server/fns/*.ts     handler; queries run AS THE USER
```

**This is the strongest idea in the codebase.** Because the server function's
Supabase client carries the user's own JWT, every query is RLS-enforced by
construction — a handler that forgets a `workspace_id` filter still cannot leak
another tenant's rows. Contrast with the `/api/*` routes, which use
`supabaseAdmin` (service role, RLS bypassed) and must check membership manually
via [`requireWorkspaceAccess`](src/lib/sdr.helpers.server.ts:25). Both paths are
correct today, but only the RPC path is correct _by default_.

### Layering conventions (consistently held)

| Suffix           | Meaning                               | Enforced by                                      |
| ---------------- | ------------------------------------- | ------------------------------------------------ |
| `*.server.ts`    | Never reaches the browser bundle      | Convention + `supabaseAdmin` lazy-import comment |
| `*.functions.ts` | Browser stub that posts to `/api/rpc` | Convention                                       |
| `*.handlers.ts`  | Pure, dependency-injected logic       | Tested without Supabase                          |

The SDR module is the best-engineered part of the codebase: handlers take
`{ db, sdrBaseUrl, token }` as injected deps, so the contract tests in
`tests/contract/` run against a mock SDR and a mock DB with no network.
**This pattern should be the template for the rest of the app.**

### Structural weak points

- **Four mega-components** carry a disproportionate share of the UI:
  `BrandDnaPanel` (3,892), `AgencyPage` (3,537), `StudioCanvasModal` (2,909),
  `ContentCalendar` (2,353). Together that's 12,691 LOC — 20% of the codebase in
  four files. They are the natural home of future merge conflicts.
- **113 of 264 files are `"use client"`.** The app is a client-rendered SPA wearing
  an App Router. Server Components are essentially unused outside `page.tsx`
  metadata shells.
- **Auth gating is browser-side only.** [SessionGate.tsx](src/components/auth/SessionGate.tsx)
  redirects on missing session; there is no `middleware.ts`. This is safe (RLS is
  the real boundary) but means private routes are served, then redirected.
- **Module-level in-memory caches** ([ai-gateway.server.ts:60](src/lib/ai-gateway.server.ts:60),
  [workspace-signals.server.ts:15](src/lib/ai/workspace-signals.server.ts:15),
  pexels/unsplash routes) silently lose their hit rate the moment you run more
  than one instance. Correct, but they will not scale horizontally.
- **Stale migration comment:** [AppShell.tsx](src/app/app/AppShell.tsx) still
  documents TanStack Router `validateSearch` behavior. The app is on Next.

---

## 4. Findings

Ordered by severity. Every finding was verified against the code.

### 🔴 CRITICAL

#### C1 — Live `SDR_ADMIN_TOKEN` is in pushed git history and was never rotated

`.env` was committed three times and later removed:

| Commit    | Date       | Secrets present                                                                                                  |
| --------- | ---------- | ---------------------------------------------------------------------------------------------------------------- |
| `46fd519` | 2026-07-29 | Supabase URL + publishable key                                                                                   |
| `abe7526` | 2026-08-30 | `SUPABASE_SERVICE_ROLE_KEY`, `SDR_ADMIN_TOKEN`, `SDR_SECRET_ENCRYPTION_KEY`, `OPENROUTER_API_KEY`, `CRON_SECRET` |
| `6738dbb` | 2026-09-04 | same set, plus `NEXT_PUBLIC_*`                                                                                   |
| `fc37c04` | 2026-09-04 | removal — **history retained**                                                                                   |

`git branch -r --contains 6738dbb` returns `origin/main` and
`origin/recovery-4b59855`. Anyone with read access to the remote can recover
these with a single `git show`.

Comparing the historical blob against the current `.env` by value equality:

| Secret                      | Rotated since leak?           |
| --------------------------- | ----------------------------- |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ rotated                    |
| `SDR_SECRET_ENCRYPTION_KEY` | ✅ rotated                    |
| `OPENROUTER_API_KEY`        | ✅ rotated                    |
| `CRON_SECRET`               | ✅ rotated                    |
| **`SDR_ADMIN_TOKEN`**       | ❌ **IDENTICAL — still live** |

`SDR_ADMIN_TOKEN` is the most privileged credential in the distribution stack.
Per [sdr-provisioning.server.ts:96](src/lib/sdr-provisioning.server.ts:96) it mints
per-workspace API keys via `POST /api/v1/admin/api-keys` — for _any_ workspace id.
An attacker with this token can mint a key for any tenant and publish to that
tenant's connected LinkedIn / X / Facebook / Instagram accounts.

The irony is documented: [README.md:90](README.md:90) warns _"Never commit `.env`
to the repo, even if it's private. Git history is forever."_

**Fix:** rotate `SDR_ADMIN_TOKEN` on the SDR service today. History rewriting is
secondary — rotation is what actually closes the exposure.

---

### 🟠 HIGH

#### H1 — No rate limiting on any metered AI endpoint

`grep -rni "rate.?limit" src` returns zero throttling implementations. Every
authenticated user can issue unbounded requests to:

| Route                                                                | Upstream                | Cost per call                     |
| -------------------------------------------------------------------- | ----------------------- | --------------------------------- |
| [/api/chat](src/app/api/chat/route.ts)                               | OpenRouter (Qwen 3 Max) | tokens                            |
| [/api/ai-generate](src/app/api/ai-generate/route.ts)                 | OpenRouter              | tokens                            |
| [/api/generate-image](src/app/api/generate-image/route.ts)           | KIE                     | **per image**                     |
| [/api/generate-video](src/app/api/generate-video/route.ts)           | KIE (Veo 3.1)           | **per video — the expensive one** |
| [/api/brand-extract](src/app/api/brand-extract/route.ts)             | Anthropic               | tokens                            |
| [/api/geo-audit](src/app/api/geo-audit/route.ts)                     | OpenRouter + crawling   | tokens                            |
| [/api/market/intelligence](src/app/api/market/intelligence/route.ts) | DataForSEO + Claude     | **per query**                     |

The gateway has good _per-call_ cost discipline — token caps, a 30-minute response
cache, in-flight dedupe ([ai-gateway.server.ts:35-60](src/lib/ai-gateway.server.ts:35))
— but nothing caps _call volume_. One signed-up user on a free trial can run a
script against `/api/generate-video` overnight. There is no per-user quota, no
per-workspace budget, and no circuit breaker.

**Fix:** per-user + per-workspace token-bucket in a shared store, applied in
`requireUserId` or a wrapper around it. Tighter limits on image/video.

#### H2 — CI does not run typecheck, lint, or the test suite

`.github/workflows/` contains exactly one file: `seo-meta-tests.yml`. It runs
Playwright SEO/OG/JSON-LD snapshots on PRs to `master`.

It does **not** run:

- `tsc --noEmit` (currently clean — nothing protects that)
- `vitest` (**183 tests across 44 files, including all 7 SDR contract suites**)
- `eslint`
- the Playwright integration/e2e projects

The most valuable tests in the repo — the ones proving webhook signature
verification, idempotency, and terminal-wins state transitions — never run
automatically. There is also no `typecheck` or `test` script in
[package.json](package.json), so there is nothing obvious for CI to call.

#### H3 — Lint is unusable: 6,772 errors, 6,690 of them `␍`

```
by rule: prettier/prettier 6771, prefer-const 1
prettier messages: "Delete ␍" 6690, "Replace X with X" 49, "Insert X" 31
```

24 of 276 tracked `src` files have CRLF line endings, Prettier is configured
`"endOfLine": "lf"` ([.prettierrc](.prettierrc)), and **there is no
`.gitattributes`** — so Windows checkouts normalize to CRLF and every line in
those files becomes a lint error. `npm run lint` is noise, so nobody runs it,
so real issues (the single `prefer-const`) are invisible.

Compounding it, [eslint.config.js:21-23](eslint.config.js:21) disables
`@typescript-eslint/no-unused-vars`, `no-explicit-any`, and `no-empty` — the three
rules most likely to catch real defects. `: any` / `as any` appears **177 times
across 44 files**.

---

### 🟡 MEDIUM

#### M1 — Chat history truncation discards the _newest_ messages first

[ai-gateway.server.ts:97-110](src/lib/ai-gateway.server.ts:97):

```ts
function trimMessages(messages, budgetChars = MAX_INPUT_CHARS) {
  let budget = budgetChars;
  return messages.map((m) => {
    if (budget <= 0) return { ...m, content: m.content.slice(0, 200) }; // ← newest hit first
    if (m.content.length <= budget) {
      budget -= m.content.length;
      return m;
    }
    const trimmed = m.content.slice(0, budget);
    budget = 0;
    return { ...m, content: trimmed };
  });
}
```

Budget is consumed front-to-back. `/api/chat` sends
`[chatSystem (~1.3k chars), context (up to 6k), ...12 tail turns]` against
`MAX_INPUT_CHARS = 16_000`, leaving ~8.7k for twelve turns — about 725 chars each.
The app's own `FMT_CHAT` fragment asks for "TL;DR + 3–5 bullets + numbered plan",
which routinely produces 800–1,500-char assistant turns.

**Failure scenario:** a user twelve turns into a strategy conversation writes a
detailed 600-word question. The old turns consume the budget in order; the
_current question_ — the last element — arrives at the model truncated to **200
characters**. The model answers a fragment and the user sees a non-sequitur, with
no error surfaced.

`compactHistory` ([history-compact.ts](src/lib/ai/history-compact.ts)) already
does the right thing by keeping the tail verbatim; `trimMessages` then undoes it.

**Fix:** reverse the walk — allocate budget from the newest message backward, and
always reserve a floor for the final user turn.

#### M2 — `xlsx@0.18.5`: high-severity prototype pollution + ReDoS, no npm fix

`npm audit` reports GHSA-4r6h-8v6p-xvw6 and GHSA-5pgg-2g8v-p4x9 with **"No fix
available"** on the npm registry.

**Severity is reduced by where it runs:** [file-extract.ts:164](src/lib/file-extract.ts:164)
imports `xlsx` from a client module (reached via `ChatPanel`), and
[/api/file-extract](src/app/api/file-extract/route.ts:26) rejects everything that
isn't an image. So spreadsheets are parsed in the user's own browser on a file
they chose — not server-side on attacker input. It is browser-context prototype
pollution, not RCE on your infrastructure.

Still worth closing: patched builds exist on the SheetJS CDN (`cdn.sheetjs.com`,
0.20.x), which is the vendor's supported distribution channel since they left npm.

#### M3 — Unauthenticated `scryptSync` on the public share endpoint

[share/[slug]/route.ts:34](src/app/api/public/share/[slug]/route.ts:34) calls
`scryptSync` synchronously inside the request handler on an endpoint that requires
no authentication. Node's default scrypt cost blocks the event loop for roughly
50–100ms per call. A few concurrent requests against a password-protected share
slug will stall the whole server process for every other user.

There is also no attempt limiting on share-password verification, so the endpoint
is brute-forceable at whatever rate the network allows.

**Fix:** `scrypt` (async callback/promise form) + per-slug attempt throttling.

#### M4 — `aggregateItemStatus` reports `partial_failed` while deliveries are still in flight

[sdr.webhook.ts:23-34](src/lib/sdr.webhook.ts:23):

```ts
if (allPublished) return "published";
if (allFailed) return "failed";
if (hasPublished && hasFailed) return "partial_failed"; // ← doesn't check in-flight
return "publishing";
```

**Failure scenario:** an item targets LinkedIn, X, and Instagram. LinkedIn
publishes, X fails, Instagram is still `publishing`. The `hasPublished &&
hasFailed` branch fires and the item flips to `partial_failed` — a terminal-looking
status — while a delivery is still running. The UI shows "partially failed" and an
operator may retry a post that is about to succeed.

Self-healing (the next webhook recomputes) but the intermediate state is wrong and
user-visible. **Fix:** check for in-flight rows before the `partial_failed` branch.

#### M5 — Test credentials committed in four tracked files

A real working password appears in:

- [README.md:156](README.md:156)
- [docs/TEAM-CREDENTIALS.md:66](docs/TEAM-CREDENTIALS.md:66)
- [docs/PLATFORM-CREDENTIALS-STATUS.md:68](docs/PLATFORM-CREDENTIALS-STATUS.md:68)
- [docs/specs/001-sdr-integration/CLIENT-LAUNCH-PLAN.md:433](docs/specs/001-sdr-integration/CLIENT-LAUNCH-PLAN.md:433)

This is a real account on the live Supabase project, not a fixture. If that
account is ever granted production workspace access, the repo hands out a login.

---

### 🟢 LOW

| #   | Finding                                                                                                                                                     | Location                                                                                        |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| L1  | Broken doc links: `docs/SUPABASE-AUTH-SETUP.md`, `AUTHENTICATION-RESET-DETAILS.md` don't exist; README points at `../specs/` but specs are at `docs/specs/` | [README.md:34](README.md:34), [CRITICAL-PRODUCTION-SETUP.md](CRITICAL-PRODUCTION-SETUP.md)      |
| L2  | `CRITICAL-PRODUCTION-SETUP.md` references `VITE_APP_URL`, Vercel, and Cloudflare Workers; the project ships Docker/Railway standalone                       | [CRITICAL-PRODUCTION-SETUP.md](CRITICAL-PRODUCTION-SETUP.md)                                    |
| L3  | Docs reference `npm run validate:sitemap`; the actual script is `test:sitemap`                                                                              | [CRITICAL-PRODUCTION-SETUP.md](CRITICAL-PRODUCTION-SETUP.md)                                    |
| L4  | Stale TanStack Router comment after the Next migration                                                                                                      | [AppShell.tsx](src/app/app/AppShell.tsx)                                                        |
| L5  | `prefer-const` on `trendPolls` — the only real lint finding in 6,772                                                                                        | [market-brain-ui.spec.ts:19](tests/integration/market-brain-ui.spec.ts:19)                      |
| L6  | All 5 recent commits are titled "Save all code changes" — history is unbisectable                                                                           | `git log`                                                                                       |
| L7  | Vitest `include` is `*.test.ts` only; no component tests exist for 12,691 LOC of mega-components                                                            | [vitest.config.ts:10](vitest.config.ts:10)                                                      |
| L8  | AI prompt advertises agents (`Spark`, `Echo`) and routes (`/agency`, `/projects`) that the nav no longer exposes                                            | [fragments.ts:61](src/lib/ai/prompts/fragments.ts:61) vs [app-nav.ts:12](src/lib/app-nav.ts:12) |

---

## 5. What is genuinely well built

Worth stating plainly, because the finding list above is not the whole picture:

- **RLS on all 23 tables**, with 4 dedicated hardening migrations in the last
  two days (`harden_generated_asset_storage`, `harden_client_share_secrets`,
  `protect_workspace_owner_membership`, `lock_workspace_resource_ownership`).
- **Webhook verification is textbook.** [sdr.webhook.ts](src/lib/sdr.webhook.ts)
  resolves state, verifies HMAC with `timingSafeEqual`, and rejects with 401
  _before any mutation_ — plus size limits, idempotency, and terminal-wins.
- **SSRF guard** ([api-auth.ts:39-65](src/server/api-auth.ts:39)) covers
  loopback, RFC1918, link-local, CGNAT, IPv6 ULA, and `.internal`/`.local`.
- **Secrets encrypted at rest** with AES-256-GCM and a versioned envelope
  ([sdr-provisioning.server.ts:25](src/lib/sdr-provisioning.server.ts:25)).
- **Cron hooks refuse to start** if `CRON_SECRET` is under 16 chars, and compare
  timing-safely — with an explicit comment on why they don't fall back to the
  service-role key.
- **Input validation on every route** — Zod schemas or explicit allow-lists, no
  exceptions found.
- **Dependency-injected handlers** make the SDR logic testable without network or DB.
- **Cost discipline in the AI gateway** — token ceilings, 30-min response cache,
  in-flight dedupe, retry with `Retry-After` honoring.

---

## 6. Prioritized fix plan

### Phase 0 — Today (security)

| #   | Action                                                                                                  | Effort  |
| --- | ------------------------------------------------------------------------------------------------------- | ------- |
| 0.1 | **Rotate `SDR_ADMIN_TOKEN`** on the SDR service; update `.env` + Railway vars                           | 15 min  |
| 0.2 | Confirm the other four leaked secrets stayed rotated; document rotation date                            | 15 min  |
| 0.3 | Replace the committed password in 4 docs with a 1Password pointer; rotate that account                  | 20 min  |
| 0.4 | Decide on history rewrite (`git filter-repo`) vs. accept-and-rotate — coordinate, it breaks every clone | discuss |

### Phase 1 — This week (stop the bleeding)

| #   | Action                                                                                                        | Files                                    |
| --- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| 1.1 | Add `.gitattributes` (`* text=auto eol=lf`), run `npm run format`, renormalize                                | new `.gitattributes`                     |
| 1.2 | Re-enable `no-unused-vars` (warn) and `no-explicit-any` (warn)                                                | [eslint.config.js](eslint.config.js)     |
| 1.3 | Add `typecheck` / `test` / `test:contract` scripts                                                            | [package.json](package.json)             |
| 1.4 | New `ci.yml`: tsc + eslint + vitest on every PR; make it a required check                                     | `.github/workflows/ci.yml`               |
| 1.5 | Rate limiting — token bucket keyed by user + workspace, wrapping `requireUserId`; strict tier for image/video | new `src/server/rate-limit.ts`, 7 routes |

_1.1 must land before 1.4, or CI fails on line endings from day one._

### Phase 2 — Next sprint (correctness)

| #   | Action                                                                                    | File                                                                    |
| --- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 2.1 | Reverse `trimMessages` to newest-first with a reserved floor for the final user turn      | [ai-gateway.server.ts:97](src/lib/ai-gateway.server.ts:97)              |
| 2.2 | Guard `partial_failed` on in-flight rows; add the 3-target regression test                | [sdr.webhook.ts:23](src/lib/sdr.webhook.ts:23)                          |
| 2.3 | Async `scrypt` + per-slug attempt throttle                                                | [share/[slug]/route.ts:34](src/app/api/public/share/[slug]/route.ts:34) |
| 2.4 | Move `xlsx` to the SheetJS CDN build (or `exceljs`)                                       | [file-extract.ts:164](src/lib/file-extract.ts:164)                      |
| 2.5 | Fix `prefer-const`, stale comments, broken doc links, `validate:sitemap` → `test:sitemap` | L1–L5                                                                   |

### Phase 3 — Backlog (structure & product)

| #   | Action                                                                                                                                                              |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3.1 | **Product decision:** is chat-first navigation intended? If yes, update `PRODUCT_SURFACE` and the agent roster to match reality. If no, restore `workspaceModules`. |
| 3.2 | Decide the SDR launch gate — it is finished code earning nothing while flagged off                                                                                  |
| 3.3 | Split the four mega-components (12,691 LOC / 4 files) along the seams already visible in their tab structure                                                        |
| 3.4 | Move in-memory caches to a shared store before running >1 instance                                                                                                  |
| 3.5 | Add component tests; extend vitest `include` to `*.spec.ts` for non-Playwright specs                                                                                |
| 3.6 | Adopt conventional commits — "Save all code changes" ×5 makes regressions unbisectable                                                                              |

---

## 7. Method

Read-only analysis of commit `b2d0a4d`. Commands run: `tsc --noEmit`,
`npm run build`, `npx vitest run`, `npx eslint . -f json`, `npm audit --omit=dev`,
plus `git log`/`git show`/`git branch -r --contains` for history. All 32 API
routes, the RPC transport, auth middleware, both Supabase clients, all four AI
gateways, the SDR module, and all 56 migrations were read directly. Secret
exposure was verified by hash/equality comparison — **no secret values were
printed, logged, or written to this document.**

---

## 8. What was applied

Phases 1 and 2 of §6 were implemented and verified. Everything below is in the
working tree, not merely proposed.

### Phase 1 — hygiene and gates

| Change                                                                                  | Files                                                                |
| --------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| LF normalization: `* text=auto eol=lf`, CRLF kept only for `.ps1`/`.bat`/`.cmd`         | new [.gitattributes](.gitattributes)                                 |
| Reformatted and `git add --renormalize`d the tree — **6,772 lint errors → 0**           | 15 files                                                             |
| Excluded the vendored Python SDE service and Playwright baselines from Prettier         | [.prettierignore](.prettierignore)                                   |
| Re-enabled `no-unused-vars`, `no-explicit-any`, `no-empty` as warnings                  | [eslint.config.js](eslint.config.js)                                 |
| Added `typecheck`, `test`, `test:watch`, `format:check` scripts                         | [package.json](package.json)                                         |
| CI that actually gates: typecheck + lint + format + 205 tests, and a separate build job | new [.github/workflows/ci.yml](.github/workflows/ci.yml)             |
| Removed unreachable dead code (`let trendPolls` after a `return`)                       | [market-brain-ui.spec.ts](tests/integration/market-brain-ui.spec.ts) |
| Fixed the Vite `__dirname` deprecation warning                                          | [vitest.config.ts](vitest.config.ts)                                 |

### Phase 1.5 — rate limiting (the missing spend control)

Postgres-backed fixed-window limiter, because the app runs as a Railway
standalone service that can scale past one instance and module-level counters
reset on deploy.

- New [`api_rate_limits`](supabase/migrations/20260911000000_add_api_rate_limits.sql)
  table + `consume_rate_limit()` — one atomic `INSERT … ON CONFLICT … RETURNING`
  per check, RLS-on with zero policies so only the service role reaches it,
  plus an opportunistic sweep of expired windows.
- New [`src/server/rate-limit.ts`](src/server/rate-limit.ts) — **fails open**: a
  limiter outage must not take the product down.
- Applied to all seven metered routes:

  | Tier             | Budget     | Routes                                                                                           |
  | ---------------- | ---------- | ------------------------------------------------------------------------------------------------ |
  | `chat`           | 60 / min   | `/api/chat`                                                                                      |
  | `generate`       | 40 / min   | `/api/ai-generate`                                                                               |
  | `audit`          | 20 / 5 min | `/api/geo-audit`, `/api/brand-extract`, `/api/market/intelligence`, `ai-generate?task=seo-audit` |
  | `image`          | 30 / hour  | `/api/generate-image`                                                                            |
  | `video`          | 8 / hour   | `/api/generate-video`                                                                            |
  | `share-password` | 10 / 5 min | `/api/public/share/[slug]`                                                                       |

  Returns 429 with `Retry-After` and `RateLimit-*` headers. `/api/ai-generate`
  validates the body _before_ charging quota, so a malformed request is free.

### Phase 2 — correctness

| #   | Fix                                                                                                                                                                                                           | File                                                                                                              |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 2.1 | `trimMessages` now allocates by priority — system prompt, then the newest turn, then older history — instead of front-to-back. The current user question is no longer the first thing truncated to 200 chars. | [ai-gateway.server.ts](src/lib/ai-gateway.server.ts)                                                              |
| 2.2 | `partial_failed` only reported once every destination has settled; an item with a delivery still in flight stays `publishing`                                                                                 | [sdr.webhook.ts](src/lib/sdr.webhook.ts)                                                                          |
| 2.3 | `scryptSync` → async `scrypt` on both the public verify path and share creation, so password checks no longer block the event loop                                                                            | [share/[slug]/route.ts](src/app/api/public/share/[slug]/route.ts), [shares/route.ts](src/app/api/shares/route.ts) |
| 2.4 | `xlsx` pinned to the SheetJS CDN 0.20.3 build — npm's newest is the unpatched 0.18.5. **`npm audit` now reports 0 vulnerabilities.**                                                                          | [package.json](package.json), [file-extract.ts](src/lib/file-extract.ts)                                          |
| 2.5 | Stale TanStack Router comment, dead `validate:sitemap` reference, Vercel/Cloudflare/`VITE_APP_URL` leftovers, broken doc links                                                                                | [AppShell.tsx](src/app/app/AppShell.tsx), [CRITICAL-PRODUCTION-SETUP.md](CRITICAL-PRODUCTION-SETUP.md)            |

**+22 tests** (183 → 205): 10 for the limiter (including both fail-open paths),
9 for `trimMessages` (regression-guarding the truncation bug), 3 for the
delivery-status aggregation.

### Found while fixing — two live defects not in the original report

**The migration deploy script was broken.** `apply_migrations_cli.py` validated
filenames against `^\d{14}_[A-Za-z0-9-]+\.sql$`, which excludes underscores —
so all 16 hand-written snake_case migrations since `20260809` were flagged
"malformed" and the script exited 1 before applying anything. Fixed in both
[apply_migrations_cli.py](apply_migrations_cli.py) and
[apply_migrations_via_cli.py](apply_migrations_via_cli.py); 61 migrations now
validate.

**No cron job is scheduled at all.** The original `competitor-watch-scan` was
unscheduled by `20260903000000` and never replaced, so nothing drives
`run-schedules`, `competitor-watch`, or `sdr-reconcile`. The user-visible
consequence: **a scheduled post is accepted in the calendar and never goes out.**
Addressed with
[`public.call_app_hook()`](supabase/migrations/20260911000100_add_app_hook_caller.sql),
which reads the origin and `CRON_SECRET` from Supabase Vault at call time —
no URL or secret in committed SQL, and rotation needs no reschedule — plus a
manual runbook at [ENABLE-CRON-JOBS.sql](supabase/ENABLE-CRON-JOBS.sql).

### Still outstanding

1. **Rotate `SDR_ADMIN_TOKEN`** (C1). Code cannot close this — it is a
   credential rotation on the SDR service.
2. **Replace the committed test password** in four docs (M5).
3. **Run `ENABLE-CRON-JOBS.sql`** against each environment once a public origin
   and `CRON_SECRET` exist. Until then scheduled publishing does not run.
4. **Apply the two new migrations** — they are picked up automatically by the
   apply script's auto-include, but have not been run against any database.
5. Phase 3 (mega-component splits, shared cache store, product decisions on the
   collapsed nav and the dark SDR) is untouched.

---

## 9. Architecture pass (Phase 3, server + event bus)

Recorded in [ADR-0006](adr/0006-route-kernel-and-server-boundaries.md). Everything
below is in the working tree and verified: `typecheck` 0 errors, `eslint` 0
errors (warnings 386 → 379), `format:check` clean, **273 tests / 51 files**
(205 → 273), `next build` exit 0, and a dev-server smoke test of the auth paths.

| Change                                                                                                                                          | Where                                                                                                                                                           |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Route kernel `defineRoute`: auth → validate → membership → rate limit → handler, RLS client by default, one error mapper shared with `/api/rpc` | [route.ts](../src/server/route.ts); 25 routes migrated                                                                                                          |
| One auth primitive `verifyBearer` + one typed user-client factory; six ad-hoc factories deleted                                                 | [api-auth.ts](../src/server/api-auth.ts), [client.user.server.ts](../src/integrations/supabase/client.user.server.ts)                                           |
| SSRF: connect-time IP blocking (undici guarded lookup), per-hop redirect checks, streaming byte caps                                            | [safe-fetch.ts](../src/server/safe-fetch.ts)                                                                                                                    |
| Shared provider transport + `UpstreamError` base for OpenRouter / Anthropic / KIE                                                               | [upstream.ts](../src/server/upstream.ts)                                                                                                                        |
| Brand DNA crawl and GEO audit engines moved out of route files; shared HTML helpers                                                             | [brand-extract.server.ts](../src/lib/brand-extract.server.ts), [geo-audit.server.ts](../src/lib/geo-audit.server.ts), [crawl/html.ts](../src/lib/crawl/html.ts) |
| `server-only` on every server module + ESLint boundary rule                                                                                     | [eslint.config.js](../eslint.config.js)                                                                                                                         |
| Typed app-event registry; ~200 call sites migrated                                                                                              | [app-events.ts](../src/lib/app-events.ts)                                                                                                                       |

### Defects found and fixed along the way

1. **GEO audit misreported AI crawlers.** `parseRobotsAllow` kept only the last
   of consecutive `User-agent:` lines and its group flags were sticky, so
   `User-agent: GPTBot` + `User-agent: CCBot` + `Disallow: /` reported GPTBot
   as allowed, and a `Disallow: /` for an unrelated bot later in the file
   reported GPTBot as blocked. Rewritten with proper grouping; 9 regression tests.
2. **Client portal "Save to Memory" lost the note.** It dispatched
   `memory:add-note`, which nothing listened to, then marked the suggestion
   applied. Notes are now written through `notes-store.appendNote`.
3. **Analytics "AI visibility" button did nothing** (`open:visibility` vs
   `open:ai-visibility`).
4. **Brand DNA edits never refreshed Studio suggestions** — the listener
   existed, the emitter did not. Now emitted, debounced 2 s because fields save
   per keystroke and the listener triggers a model call.
5. **`/api/sdr/publications` had no authentication check** (RLS still applied).
6. **Unmetered paid endpoints:** `clarify`, `file-extract`, `memory-extract`,
   `social-multi`, `market/trends` and eight RPC functions (coach briefing,
   content generation ×3, suggestion refresh, competitor-watch scans ×2,
   run-schedule-now) now carry rate limits.
7. **`assets/persist` downloaded the whole source before checking the 50 MB cap**
   and `competitor-watch` read unbounded bodies — both capped while streaming now.
8. **A malformed bearer token returned 500, not 401.** `supabase.auth.getClaims`
   throws on a three-segment token it cannot decode; every one of the six old
   auth copies let that escape. Caught once in `verifyBearer`, with a test.

### Still outstanding from this pass

- **`src/integrations/supabase/types.ts` is stale** — it has no `assets` table,
  so the two asset routes query through an explicitly untyped client. Regenerate
  with `supabase gen types typescript` against the live project.
- `open:upgrade` has no listener: decide whether to hide the menu item or build
  a billing surface.
- Deferred: React Query hooks replacing `content:changed` refetching, splitting
  the four mega-components, a shared cache store for multi-instance deploys.
