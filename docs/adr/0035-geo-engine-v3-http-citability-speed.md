# ADR-0035: AI Visibility engine v3 — HTTP behaviour, citability and measured speed

Status: accepted. Supersedes nothing; extends [ADR-0010](0010-ai-visibility-geo-intelligence.md).

## Context

The AI Visibility engine (score version 2) read each page's HTML well but saw
little of what the server did around it, judged content at page level only,
and had no measurement of speed beyond Mellox's own response time. Three MIT
projects cover those gaps and were analysed in full:

| Project | What it does well | What Mellox took |
|---|---|---|
| [SiteOne Crawler](https://github.com/janreges/siteone-crawler) (Rust) | Whole-site crawl analyzers: headers, caching, redirects, 404s, security, accessibility, best practices; an AI-readiness report with sitemap, hreflang and "vague reference" verdicts | Header summary, redirect chains and links through redirects, soft-404 probe, http→https, sitemap entries that aren't indexable, hreflang reciprocity, unlabelled controls, DOM size |
| [GEO Optimizer](https://github.com/Auriti-Labs/geo-optimizer-skill) (Python) | 47 citability methods (Princeton GEO), prompt-injection detector, trust stack, temporal coherence | Hidden instructions to AI (CSS-hidden text, comments, `data-ai-*`, invisible characters), quotable passages, readability (Flesch), stale headline years, visible vs structured dates, generic alt text |
| [Unlighthouse](https://github.com/harlan-zw/unlighthouse) (TypeScript) | Lighthouse on every route, dynamic route sampling, CrUX history | Route-template sampling (one page per `/blog/:slug`), Lighthouse category scores and savings, Chrome UX Report p75s and weekly history |

Nothing was vendored: each idea was re-implemented as pure TypeScript in the
existing engine, with a credit line in the file that adapts it.

## Decision

- **Evidence is collected once, stored as JSON, never as raw HTML or headers.**
  `PageAnalysis.http` (`src/lib/geo/http.ts` summarises headers and the
  redirect hops `safe-fetch` now records), `PageAnalysis.hygiene`
  (`analyze/hygiene.ts`, a second tokenizer pass) and
  `PageAnalysis.citability` (`analyze/citability.ts`). Site-level:
  `SiteArtifacts.http` (homepage headers, `http://` behaviour, a missing-page
  probe) and `SiteArtifacts.performance`. No migration: all of it lives in the
  existing `geo_scan_pages.analysis` and `geo_scans.site` columns.
- **21 rules, score version 3** (`src/lib/geo/rules-v3.ts`). Every one is N/A
  when its evidence wasn't collected (older scans, quick scans, speed off), so
  a missing measurement never costs points, and the well-built fixture still
  reaches exactly 100. Each carries an evidence label or none.
- **Speed is measured, through Google, under Mellox's key.**
  `src/server/geo/performance.server.ts` is the only file that calls PageSpeed
  Insights or the Chrome UX Report or reads `GOOGLE_PAGESPEED_API_KEY`
  (falling back to `GOOGLE_API_KEY`); the key travels in `x-goog-api-key`.
  The scan runner measures after the crawl frontier is exhausted, inside the
  `crawling` stage (no new stage, no schema change): real-user data once,
  then Lighthouse on `GEO_LAB_PAGES` (default 4) route-sampled pages, saving
  each result as it arrives so a slice that runs out of time resumes.
  Quick scans get real-user data only; verification scans get neither.
  Flag `FEATURE_FLAG_GEO_PERFORMANCE_ENABLED` (on unless `false`, per
  workspace `_WS_<id>`).
- **Prioritisation weighs where a problem is.** `pageImportance` (homepage 1;
  shallow, well-linked, in-sitemap pages higher) scales a page finding's
  impact by `0.7 + 0.3 × importance`. It orders work only; scores and points
  lost are unchanged.
- **Improvement is measured, not asserted.** "Since your fixes went live"
  adds real-user speed: CrUX weekly p75s before the first live fix against
  weeks whose 28-day window started after it (`fieldChangeSince`), shown only
  when a vital moved 5% or more.
- **Fixes follow the existing paths and their limits.** Content rules
  (`content.self_contained`, `content.readability`, `tech.mixed_content`) are
  WordPress/Webflow `content_html` edits with grounding; code-level rules go to
  the GEO Engineer. Response headers (compression, caching, security headers)
  are hosting configuration, which `paths.ts` never lets Mellox write, so they
  are manual with exact steps. Hidden instructions, headline years and
  real-user speed need the owner and stay manual.

## Consequences

- Scores move to version 3; the UI already refuses to compare across versions.
- A full scan makes up to `GEO_LAB_PAGES` PageSpeed calls plus two CrUX calls.
  Both APIs are free; a keyless PageSpeed quota is small, so production sets a key.
- `trust.hidden_instructions` fails a page outright. Its patterns only read
  text a visitor can't see (inline-hidden, `aria-hidden`, comments,
  `data-ai-*`), so ordinary hidden UI never matches.
