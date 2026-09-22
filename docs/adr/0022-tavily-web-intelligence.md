# ADR-0022: Tavily as Mellox's shared web-intelligence layer

- **Status**: Accepted
- **Date**: 2026-09-23
- **Supersedes in part**: the DuckDuckGo fallback described in ADR-0017

## Context

Mellox understands each customer's own business well — Brand DNA, GEO scans,
Studio context, Market Brain all read from the workspace's own site and data.
It understood almost nothing about the live market around that business, and
the few paths that tried were weak or broken:

- Web search was a **DuckDuckGo HTML scrape**, duplicated byte-for-byte in
  `src/lib/brand-extract.server.ts` and `src/server/fns/coach.ts`. ADR-0017 put
  Firecrawl in front of it, but Firecrawl is self-hosted and
  `FIRECRAWL_BASE_URL` is unset in ordinary deployments, so in practice the
  "research your market" step of Brand DNA onboarding and the Marketing Coach
  was a brittle SERP scrape of a page that is under no obligation to keep its
  markup stable.
- **Competitor intelligence was two disconnected half-features.**
  `competitor_watches` did regex snapshot diffing of one URL and had the only
  UI; `competitor_intelligence_runs` produced Firecrawl + Claude profiles and
  had no UI at all — nothing in the app read the table. Neither could answer
  the question a marketer actually asks: who are my competitors, what do they
  do, and what changed? And because `crawlCompetitorPages()` hard-required
  Firecrawl, every run on a default deployment failed with
  `"Firecrawl is not configured"`.
- There was no competitor **discovery** anywhere. A user had to already know
  and type every competitor's URL.
- GEO's answer-engine probes are paid model generations behind
  `FEATURE_FLAG_GEO_AI_PROBES_ENABLED`, off by default, so the `ai_search`
  readiness dimension in `src/lib/geo/dimensions.ts` had no data to score.

Tavily is a purpose-built research API: ranked results with snippets and
publication dates, `topic: "news"` with a day window, `include_answer`, domain
include/exclude, and `/extract` for page text.

## Decision

Add Tavily once, as a shared capability behind the existing gateway,
metering, budget, cache and rate-limit conventions — not as a
Competitor-Analysis-only integration.

### Division of responsibility

| Fetcher | Owns |
|---|---|
| **Tavily** | Discovery across the open web: who exists, what changed, what is being said, who gets cited. |
| **Firecrawl** | Deep, structured crawl of one known site. Preferred wherever it is configured. |
| **safeFetch** | Anything this process fetches itself from a user-supplied URL. |

Firecrawl is kept and is still the first choice for reading a site, because it
discovers pages. Tavily `/extract` exists only as a fallback for when Firecrawl
is unconfigured — which is what unbreaks competitor profiling today. Tavily
never crawls: it reads exactly the URLs it is handed.

### The gateway

`src/lib/tavily-gateway.server.ts` is the only file that reads
`TAVILY_API_KEY` or talks to `api.tavily.com`. It mirrors
`firecrawl-gateway.server.ts`:

- `TavilyGatewayError extends UpstreamError`, so the route kernel maps every
  failure to an HTTP status in one place.
- `setTavilyTransport()` as the test seam; `requireEnabled()` → 503
  `missing_config`.
- The host is a fixed constant, never user input, so requests use plain fetch
  through `src/server/upstream.ts` rather than `safeFetch` — the DataForSEO
  precedent. **User-supplied domains and URLs are checked with
  `assertPublicUrl()` before they enter a request body**, because Tavily
  fetches on its own infrastructure, outside this process's SSRF pipeline.
- The key travels in an `Authorization` header only: never a URL, never a log,
  never a response.
- `await enforceBudget("search")` (which already *blocks* rather than degrades
  for search), tenant-scoped caching through `src/server/cache/store.ts`
  (6 h general, 30 min news), in-flight dedupe, and `recordUsage` on every
  call including cache hits, which are metered as `cached` with `savedUsd`.
- The budget check sits **after** the cache: a cached answer costs nothing, so
  being over a ceiling should not stop it being served.

`src/server/research/web-search.server.ts` is the one entry point everything
else uses. Its provider chain is a quality ladder, not a load balancer:
Tavily → Firecrawl → the DuckDuckGo scrape, falling through on failure or an
empty result. It never throws: "no sources" is a fact about the world, not an
error. Both copies of `ddgSearch` are gone; there is one implementation.

`src/lib/research/sources.ts` holds the source rules — URL normalisation,
dedupe with a per-host cap, low-quality refusal (file hosts, shorteners,
throwaway TLDs, binaries), aggregator detection, authority hints and prompt
formatting. It is pure and browser-safe, because the UI needs the same rules
to decide whether to render a source chip.

### One competitor entity

`workspace_competitors` becomes the canonical competitor, and the two existing
engines hang off it (both gain a nullable `competitor_id`; neither changes
behaviour for existing rows). `competitor_updates` is the "what changed"
feed, with a unique `(competitor_id, fingerprint)` index that is what keeps it
meaningful rather than noisy.

Three engines, all grounded:

- **Discovery** (`discovery.server.ts`) searches around the Brand DNA context,
  filters candidates to companies' own domains, and asks Claude to classify
  *only* candidates the search really returned. A domain the searches never
  produced is dropped even if the model names it — a competitor Mellox invented
  is worse than none, because the user cannot tell the difference.
- **Profiling** (`profile.server.ts`) reads the competitor's own pages
  (Firecrawl, else Tavily extract) plus genuinely third-party coverage, and
  keeps the URL for every claim.
- **Updates** (`updates.server.ts`) searches news since the last check — a
  derived window, never a fixed sweep — and has Claude keep only real moves.
  An empty result is stated to be the normal case.

Recurring work uses the existing lease/`SKIP LOCKED` pattern
(`claim_competitor_jobs` mirrors `claim_geo_scans`) and is advanced by the
**already-scheduled** `competitor-watch` cron hook. No new cron job, nothing
new to enable per environment. `next_check_at` backs off for quiet
competitors, so a quiet market costs almost nothing.

### Selective use elsewhere

Tavily is not called on every AI interaction. Where it is used, it is gated:

- **Coach** — its three existing cached searches now go through the ladder, and
  the trend query asks for a grounded summary. Cost is unchanged.
- **Chat** — `src/lib/research/triggers.ts` decides, with pure string work and
  no model call, whether a turn needs the outside world. It requires an
  explicit ask, or both an external subject and a reason to think today's
  answer differs. Questions about the user's own brand, drafts or numbers —
  which Mellox already holds — never search.
- **Studio** — `briefNeedsResearch()` researches a factual or market-based
  brief; a caption, a hook or a visual idea never triggers it.
- **Market Intelligence** — trends say *what* is moving, coverage says *why*.
  Absorbed by the existing `context_fingerprint` cache key.
- **GEO/AEO** — `citation-probes.server.ts` runs a search per probe question to
  establish who is actually surfaced for the queries this brand should own. It
  reuses `detectMentions`/`extractCitations`/`summarizeProbes` unchanged, so it
  feeds the same `ProbeSummary` the paid probes do, and the `ai_search`
  dimension finally has data on a server that has never enabled them. It is
  labelled "Web search", not ChatGPT: it is a proxy for retrievability, not a
  transcript.
- **Backlinks** — deliberately untouched. It has its own paid provider and its
  own invariants.

## Consequences

- Every research surface improves at once, and there is one place to improve
  them further.
- With `TAVILY_API_KEY` unset, every surface degrades to exactly its prior
  behaviour and reports itself unavailable rather than failing when someone
  asks. Mellox owns the credential; a user is never asked for one.
- Competitor intelligence works on a deployment without Firecrawl for the
  first time.
- Cost is bounded by four independent mechanisms: the trigger gates, the
  tenant-scoped cache, the `search` budget kind, and the
  `web-research` / `competitor-discovery` / `competitor-profile` rate-limit
  tiers.
- A claim without a source is not rendered. That is a product rule, not a
  styling choice, and it is why `sources.ts` is browser-safe.
