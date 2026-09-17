# ADR-0017: Firecrawl as an additive web-intelligence layer

- **Status**: Accepted
- **Date**: 2026-09-17
- **Context sources**: Firecrawl/Mastra/Helicone/Promptfoo/Trigger.dev/LiteLLM
  integration initiative, phase 3 of 5 (follows ADR-0015, ADR-0016)

## Context

Website intelligence in this codebase is spread across a few independent,
narrow pieces: `src/server/safe-fetch.ts` is the sanctioned SSRF-guarded
fetcher; `src/lib/brand-extract.server.ts` crawls a homepage + up to 8
sub-pages via `fetchPublicText` and does external web research through a
hand-rolled DuckDuckGo HTML scrape (`ddgSearch()`); `src/server/fns/coach.ts`
has its own near-identical `ddgSearch()` duplicate; `src/lib/competitor-watch.server.ts`
does regex snapshot-diff alerting (no AI, no multi-page crawl); and no
feature does a genuine multi-page, AI-synthesized competitor profile. The
product goal is to bring in Firecrawl for scraping/crawling/mapping/search
across Brand DNA, competitor research, market research and GEO/AEO research.

Two constraints shaped every decision below:

1. **Firecrawl fetches on its own infrastructure**, entirely outside this
   process's SSRF-guarded `undici.Agent`/DNS-lookup pipeline. A user-supplied
   URL handed to Firecrawl without validation would reopen the exact SSRF
   hole `safe-fetch.ts` exists to close (e.g. a workspace submitting
   `http://169.254.169.254/` as "a competitor to analyze").
2. **`brand-extract.server.ts`'s signal extraction (colors, fonts, JSON-LD,
   socials, emails, headings) is regex-based over raw HTML.** Firecrawl's
   scrape/crawl endpoints return Markdown by default; swapping the existing
   HTML crawl to Firecrawl's Markdown output wholesale would silently break
   every one of those regexes — a regression, not an enhancement.

## Decision

- **`src/lib/firecrawl-gateway.server.ts`** wraps the official
  `@mendable/firecrawl-js` SDK (unlike Helicone, this is a normal API client
  library, not an LLM-provider SDK, so using the real dependency doesn't
  conflict with this codebase's "zero AI SDK" convention). Every function
  taking a user-supplied URL (`firecrawlScrape`, `firecrawlCrawl`,
  `firecrawlMap`) calls `assertPublicUrl()` first — mandatory defense-in-depth
  per constraint 1. `firecrawlSearch()` takes a query, not a URL, so it
  doesn't need this check. **Never requests Firecrawl's LLM-powered `/extract`
  format** — only `markdown`/`links` — so all LLM spend keeps flowing through
  this codebase's own metered, budget-checked gateways, never a side channel
  through a Firecrawl-configured LLM key. Follows the established gateway
  shape: `FirecrawlGatewayError extends UpstreamError`, a `setFirecrawlClient()`
  test seam, `firecrawlEnabled()` (off unless `FIRECRAWL_BASE_URL` is set).
  Every call also flows through `recordUsage()` (provider `"firecrawl"`,
  `est_cost_usd: 0` since self-hosted has no per-call bill to this app) for
  visibility in the existing usage dashboards and Helicone.
- **Only the isolated `ddgSearch()` scrape-hack is replaced**, in both
  `brand-extract.server.ts` and `coach.ts`, with a Firecrawl-first path
  (`firecrawlSearch()`) that falls through to the existing DuckDuckGo scrape
  on any Firecrawl failure, an empty result, or when Firecrawl isn't
  configured — per constraint 2, the raw-HTML crawl/signal-extraction
  pipeline in `brand-extract.server.ts` is untouched in this phase. Both
  functions' external behavior and return shape are unchanged whenever
  `FIRECRAWL_BASE_URL` is unset (the default).
- **Competitor Intelligence** (`src/server/research/competitor-intel.server.ts`,
  `competitor_intelligence_runs` table) is new functionality filling the
  actual gap: a multi-page Firecrawl crawl of a competitor's site, synthesized
  by Claude into positioning/strengths/weaknesses/audience/pricing/differentiators,
  with every crawled page wrapped in `wrapUntrusted()`/`UNTRUSTED_DATA_RULE`
  (mandatory — this is exactly the class of input that guard exists for) and
  an explicit evidence/interpretation split in the output schema, mirroring
  `market-intelligence.server.ts`'s existing "measured evidence vs.
  interpretation" pattern. This is distinct from `competitor-watch.server.ts`
  (kept as-is: narrower, regex-only, no AI). Requires Firecrawl to be
  configured — it doesn't exist without it, so there is no fallback.
- **Runs synchronously within the request** for now (no lease/claim columns,
  no cron sweep) — a later phase moves execution onto Trigger.dev without
  changing `runCompetitorIntel()`'s contract. Safe today because this app
  deploys as a persistent Node process (not serverless with a hard timeout),
  matching how `runBrandExtraction` already runs a comparably long pipeline
  synchronously within one streamed request.
- **Self-hosted via Firecrawl's own, unmodified Docker Compose** from a
  sibling checkout (`docs/self-hosted-integrations.md`), not reproduced
  inside this repository's `docker-compose.integrations.yml` — Firecrawl's
  stack (API, worker, Playwright, Redis, RabbitMQ, a Postgres-backed queue,
  optional FoundationDB) already wires itself together correctly, and
  duplicating that definition here would only drift out of date.

## Consequences

- Brand DNA extraction and Coach's web search get a real search API instead
  of scraping DuckDuckGo's HTML, with zero behavior change for any
  deployment that doesn't configure Firecrawl.
- Competitor Intelligence is a genuinely new capability, not a rebuild of
  `competitor-watch.server.ts` — both coexist.
- The regex-based HTML signal extraction in `brand-extract.server.ts`
  (colors/fonts/JSON-LD/socials) is intentionally **not** migrated to
  Firecrawl in this phase. Doing so safely would require requesting `html`
  alongside `markdown` from Firecrawl and re-validating every regex against
  Firecrawl's HTML output — real follow-up work, not a rushed change bundled
  into this pass.
