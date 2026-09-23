# ADR-0023: Market Brain runs on Tavily market signals, not DataForSEO/Google Trends

- **Status**: Accepted
- **Date**: 2026-09-23
- **Supersedes**: the DataForSEO Google Trends integration described nowhere
  as its own ADR (it predates this file); extends ADR-0022.

## Context

Market Brain's measured evidence was Google Trends, reached through
`src/lib/dataforseo/*` — DataForSEO's `keywords_data/google_trends/explore`
endpoints. That meant:

- **A second, unrelated paid provider** just for one feature, with its own
  credentials (`DATAFORSEO_LOGIN`/`DATAFORSEO_PASSWORD`), its own error
  envelope (HTTP 200 bodies with a `status_code`), and its own async task
  lifecycle — `task_post` then poll `task_get` for 1–3 minutes before a scan
  had anything to show.
- **Duplicated infrastructure.** ADR-0022 already gave Mellox a shared,
  metered, budgeted, cached web-research gateway (Tavily → Firecrawl →
  DuckDuckGo). Market Brain used none of it for its primary evidence — only
  `market-intelligence.server.ts`'s secondary "recent coverage" search went
  through Tavily, so the same feature paid for two separate providers doing
  adjacent jobs.
- **A worse product experience than necessary.** A scan took 1–3 minutes of
  polling before any result appeared, purely because DataForSEO's Google
  Trends product is asynchronous. Tavily answers inline.

Removing DataForSEO from the product entirely — not just adding an
alternative — was the explicit instruction: one fewer vendor, one fewer set of
credentials to hold and rotate, and one research path across the whole app, as
ADR-0022 already established for everything else.

## Decision

Market Brain's measured evidence becomes recent web coverage of the tracked
keywords, gathered through the existing `webSearchMany()` (ADR-0022), not a
numeric search-interest index. Nothing in the product tree calls DataForSEO
again; `src/lib/dataforseo/` is deleted, `DATAFORSEO_LOGIN`/`DATAFORSEO_PASSWORD`
are gone from `src/server/env.ts` and `.env.example`, and `"dataforseo"` is
gone from the metering provider union and the pricing table.

### Pure engine: `src/server/research/market-signals.server.ts`

`collectMarketSignals(input)` builds one query per keyword (`"<keyword>
<location>"` when a location is set), calls `webSearchMany()` with
`topic: "news"` and a 45-day window, and returns
`{ keywords, location, sources }` — `MarketSignalSource` is `{title, url,
snippet, domain, publishedDate}`, the same shape every other research surface
in this codebase already produces. `hasMarketSignal()` is true when at least
one source came back.

### Collection/cache layer: `src/lib/market-signals-collection.server.ts`

This replaces `google-trends-collection.server.ts`. The state machine
(`cached` / `pending` / `completed` / `failed` / `no_data`, the same
6-hour TTL, the same compare-and-set row claim so two concurrent requests
never bill twice) is unchanged in shape, but its meaning changes: **Tavily
answers inside the request**, so `requestMarketSignalsCollection()` now runs
the search inline and returns `completed`/`failed`/`no_data` directly in the
common case — there is no provider task id and nothing to poll for under
normal operation. `pollMarketSignalsCollection()` still exists, but only for
crash recovery (a row left `pending` by a request that never finished,
`STALE_PENDING_MS` now 2 minutes, not 20) and so a second browser tab can see
a scan another tab started finish.

### Synthesis: `market-intelligence.server.ts`

The Claude prompt's "measured evidence" is now the collection's own sources
(numbered, with URLs, wrapped as untrusted data — the same treatment
`competitor-intel.server.ts` gives crawled pages), not a serialized trends
graph. The separate "recent coverage" Tavily call this file used to make on
every analysis is gone: the collection already carries real web evidence, so
a re-analysis of the same collection is a pure Claude cost, not a repeated
search. `relatedQueries`/`relatedTopics` are now the notable terms and themes
Claude reads out of the sources, not values Google Trends measured; `analysisKey`
hashes the sources themselves, so identical evidence still reuses a cached
analysis instead of billing a fresh one.

### UI: `MarketBrainPanel.tsx` / `MarketBrainInsights.tsx` / `MarketBrainProgress.tsx`

There is no honest way to keep the numeric interest-over-time chart and
regional-interest map — Tavily does not produce a search-volume index, and
inventing one would violate this codebase's grounding rule (a claim that came
from the web carries its URL, or it is not shown). `TrendChart` and the
region/related-search panel are replaced with `SignalsFeed` and a sources/topics
tab: the sources Mellox actually read, as clickable cards with their title,
domain, date and snippet. The KPI strip changes from "interest index / change /
peak / top region" to "sources found / newest / publishers / most coverage" —
numbers the data actually supports. `PulseSummary`'s rising/declining badge is
now the model's own read across its `trendSignals`, explicitly labelled as
that rather than implied to be a measured statistic. The scan progress copy
and timing no longer describe a 1–3 minute Google Trends wait, because there
usually isn't one.

## Consequences

- One fewer paid vendor and credential pair to hold, rotate or misconfigure.
- A scan is now seconds, not minutes, because Tavily is synchronous where
  DataForSEO's Google Trends product was not.
- Market Brain gets the same quality ladder (Tavily → Firecrawl → DuckDuckGo),
  caching, budget enforcement and rate-limit tiers every other research
  surface has, instead of its own bespoke provider integration.
- The "Market Updates" surface trades a numeric, opaque interest index for
  real, linkable evidence — a better fit for this codebase's rule that a claim
  from the web is shown with its source or not at all.
- `market_trend_collections` rows in the old Google Trends shape are cleared
  by the migration (a provider cache, not user data); every workspace's first
  post-migration scan re-collects from scratch.
