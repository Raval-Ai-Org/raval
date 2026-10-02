# AI Visibility — GEO / AEO / SEO intelligence

AI Visibility answers one question for a Mellox workspace: *can ChatGPT, Claude,
Gemini and Perplexity read, understand and cite this site — and what should we
fix first?* It crawls a site, scores it on 60+ explainable checks, stores
page-level evidence and findings, recommends prioritised fixes with copy-paste
recipes, compares scans over time and re-scans on a schedule.

It replaces the single-page `/api/geo-audit` (45 checks on the homepage, results
kept in the browser) and absorbs the separately developed Python/FastAPI
**GEO-Module**, whose deterministic analysis was ported to TypeScript (see
[ADR-0010](adr/0010-ai-visibility-geo-intelligence.md)).

## Architecture

```
AiVisibilityDialog ─ GeoAeoPanel (src/components/app/geo/*)
   │  POST /api/geo/scans ─────────────► service.server.ts ── createScan (plan cap, 1 full crawl/workspace)
   │  GET  /api/geo/scans/:id  (poll 2s)      │ quick: driveScan inline          full: after() → driveScan
   │  POST /api/geo/scans/:id/cancel          ▼
   │  /api/rpc/geo/* (findings, pages,   scan-runner.server.ts   queued → discovering → crawling → analyzing → (probing) → done
   │   compare, states, monitors)             │  lease-guarded slices; checkpoints in geo_scan_pages
   ▼                                          ├─ crawler.server.ts   safeFetch (SSRF guard), robots/sitemap/llms.txt, retries
 Supabase (RLS read) ◄──── service role ──────┤─ src/lib/geo/*       pure engine: extract → analyze → rules → score
                                              └─ probes.server.ts    flagged AI answer checks via OpenRouter gateway
pg_cron (every minute) → /api/public/hooks/geo-scans → runDueGeoScans (resume expired leases)
scheduled_jobs task_type 'geo-scan' → runDueScheduledJobs → createScan (monitoring)
```

### Pure engine — `src/lib/geo` (no I/O, browser-safe, unit-tested)

| File | Role | Ported from GEO-Module |
|---|---|---|
| `html-tokenizer.ts`, `extract.ts` | One tolerant pass over HTML: metadata, headings, sections, links, images, JSON-LD, landmarks, text | `page_extractor.py`, `content_structure_analyzer.py` |
| `analyze/schema.ts` | JSON-LD (+ `@graph`) summary: types, organizations, authors, FAQ, dates | `_traverse_json_ld`, entity/trust schema parts |
| `analyze/content.ts` | Structure, questions & direct answers, topic, entities, answer readiness, semantic coverage | `question_/answer_/topic_/entity_/readiness_/semantic_coverage_analyzer.py` |
| `analyze/trust.ts` | First-party trust, external sources, claim support | `trust_/transparency_/source_/source_quality_/claim_support_engine.py` |
| `analyze-page.ts` | HTML → `PageAnalysis` (the stored evidence record) | — |
| `robots.ts`, `sitemap.ts` | AI-crawler access, RFC 9309 path matching, sitemap/llms.txt shape checks | `crawler/robots.py`, `crawler/sitemap.py` |
| `rules.ts` | The rule catalog (6 categories, stable ids) | Mellox 45-point audit + `content_intelligence_rules.py`, `authority_citation_recommendations.py` |
| `score.ts` | Explainable scoring, findings, grouped prioritised actions | `scoring_engine.py`, `score_explanation.py`, `opportunity_prioritization.py` |
| `fix-recipes.ts` | Copy-paste fixes keyed by `fixId`; safety tier per rule | `recommendation_service.py`, `fix_safety_classifier.py` |
| `compare.ts` | Diff two scans by finding fingerprint | replaces simulated `validation_service.py` |
| `probes.ts` | Probe questions, mention and citation detection | `query_intelligence_service.py`, `mention_citation_service.py` |

### Scoring (explainable)

- Rule credit: **pass 1 · warn 0.5 · fail 0 · N/A excluded** (never penalised).
- Page rules: credit is the mean over pages the rule applies to.
- Category score = Σ(weight × credit) / Σ(weight of applicable rules) × 100.
- Overall = Σ(category score × category weight). Categories: AI engine access 20% ·
  Technical & indexability 20% · Structured data & entities 15% · Answer-ready
  content 20% · Authority & trust 20% · Rendering & performance 5%.
- Every rule reports `pointsLost` (overall points); every finding carries its
  share (`pointImpact`), evidence, severity, `fixId`, safety tier and effort.
- Priority = 0.5·impact + 0.25·confidence + 0.25·(1 − effort) → critical ≥ .8,
  high ≥ .6, medium ≥ .4, low.
- Finding fingerprint = `ruleId|host+path(+query)` — stable across scans; keys
  workflow state (`geo_finding_states`) and scan comparison.

**Score version 2** (`SCORE_VERSION` in `score.ts`, stored as
`report.scoreVersion`). Scores from different versions are not compared: the
Overview delta and History mark the change as "New scoring".

- **A well-built site reaches 100** (a test builds one). The overall score is
  rounded once, from the exact category scores.
- **Crawlers have tiers** (`AI_BOTS` in `robots.ts`): `search` (OAI-SearchBot,
  PerplexityBot, Claude-SearchBot, Googlebot, Bingbot), `user` (ChatGPT-User,
  Claude-User, Perplexity-User, …) and `training` (GPTBot, ClaudeBot,
  Google-Extended, CCBot, …). Blocking a search or user crawler fails;
  blocking a training crawler is the owner's choice and is never scored. A
  partial block (`Disallow: /blog/`) is caught against the scanned pages.
- **`ai.live_access`**: the homepage is requested with three search-crawler
  user agents (skipping any robots.txt already blocks). A refusal or challenge
  page only ever warns — a firewall may turn away a look-alike and still admit
  the real crawler.
- **Checks added**: `tech.snippet` (nosnippet / max-snippet / data-nosnippet),
  canonical targets (off-site, broken or noindex), `schema.valid` (required
  fields), `schema.matches_page` (markup vs visible text), `tech.sitemap_lastmod`,
  `tech.sitemap_coverage`, `tech.orphan_pages`, `trust.freshness`,
  `content.evidence`; llms.txt is validated against the format and weighs less.
- **Page types**: legal and contact pages aren't asked for JSON-LD, social
  tags or five internal links. Headings and sections are judged inside the
  page's content region; discounts aren't statistics; inline framework data
  doesn't count as HTML weight; response time excludes retry backoff.
- **Evidence label** per rule (`documented` · `measured` · `emerging`), shown
  beside each check, so a convention is never presented as a proven signal.
- **Path to 100** (`path.ts` → `report.pathTo100`): every lost point by who
  can close it — Mellox alone, Mellox after one answer, or the owner.
- **Agent extras, never scored** (`report.agent`): markdown content
  negotiation, Content Signals, `llms-full.txt`.
- **Verification of comparison rules**: shared titles, shared descriptions
  and broken links are verified by re-reading the other pages involved
  (`comparisonUrls` in `verify.ts`); without them the result is inconclusive.

## Database (migration `20260914120000_add_geo_intelligence.sql`)

| Table | Purpose | Access |
|---|---|---|
| `geo_scans` | One row per scan: status/stage, config, site artifacts, progress, scores, report, probes, lease | members SELECT; writes service role only |
| `geo_scan_pages` | Crawl frontier + per-page `analysis` JSON (no raw HTML), score, issues | members SELECT |
| `geo_findings` | Findings with evidence, fingerprint, priority, point impact | members SELECT |
| `geo_finding_states` | open / in_progress / resolved / dismissed per fingerprint | members read/write (editor+ enforced in API) |

Also: RPC `claim_geo_scans` (FOR UPDATE SKIP LOCKED lease claim, service role
only); partial unique index = one active full scan per workspace; cron job
`mellox-geo-scans`; `prune_operational_logs()` clears page evidence after 180 days;
the browser INSERT policy on `geo_audit_runs` is dropped — the worker writes
score history there (Analytics, Coach and suggestions keep reading it).

## API contracts

Types live in `src/lib/geo/contracts.ts`.

| Endpoint | Auth | Body / query | Returns |
|---|---|---|---|
| `POST /api/geo/scans` | workspace **editor**; rate limit `audit` (quick) / `geo-scan` 12/h (full) | `{workspaceId, url, mode: "quick"\|"full", trigger?, probes?, idempotencyKey?}` | `201 {scan: GeoScanView}`; `409 {error, activeScanId}`; `400` invalid/private URL |
| `GET /api/geo/scans/:id` | workspace member | `?workspaceId=` | `{scan}` (re-kicks a scan whose lease expired) |
| `POST /api/geo/scans/:id/cancel` | editor | `{workspaceId}` | `{scan}`; `409` if finished |
| `POST /api/public/hooks/geo-scans` | `x-cron-secret` | — | `{ok, claimed, done, yield, lost_lease}` |
| RPC `geo/listScans` | member | `{workspaceId, host?, limit?}` | `GeoScanSummary[]` |
| RPC `geo/getScanFindings` | member | `{workspaceId, scanId}` | `GeoFindingView[]` (with workflow state) |
| RPC `geo/getScanPages` / `geo/getScanPage` | member | `{workspaceId, scanId}` / `{workspaceId, pageId}` | `GeoPageView[]` / `GeoPageDetail` |
| RPC `geo/compareScans` | member | `{workspaceId, baseScanId, targetScanId}` | `ScanComparison` |
| RPC `geo/setFindingState` | editor | `{workspaceId, fingerprint, state, note?}` | `{fingerprint, state}` |
| RPC `geo/listMonitors` / `saveMonitor` / `deleteMonitor` | member / editor | see `src/server/fns/geo.ts` | `GeoMonitor` |
| RPC `geo/getGeoSettings` | member | `{workspaceId}` | `{plan, maxPages, probesAvailable}` |

## Background processing

No new infrastructure — the `studio_jobs` / `scheduled_jobs` pattern:

1. **Quick scan** (homepage) runs inline in the POST, ≤45 s.
2. **Full scan** is kicked with `after()` and runs up to 240 s in the same
   process, crawling with concurrency 3, ≥150 ms between requests (or the site's
   `Crawl-delay`, capped at 2 s), retrying 429/5xx with backoff.
3. A slice that reaches its deadline **checkpoints and yields** (expires its lease).
   Fetched pages are never refetched; the analyze stage is idempotent.
4. **pg_cron** calls `/api/public/hooks/geo-scans` every minute and resumes up to
   3 scans with expired leases (90 s budget, inside pg_net's 120 s timeout).
   Reading a stale scan in the UI also re-kicks it, so local development works
   without pg_cron.
5. A scan claimed more than 60 times fails instead of looping forever.
6. **Monitoring**: `scheduled_jobs` rows with `task_type = 'geo-scan'` and
   `meta.url`; the existing `run-schedules` cron enqueues a full scan.

## Security

- Every fetch goes through `createSafeFetch`: DNS-level private/metadata address
  block, per-hop redirect re-validation, byte cap (2 MB/page, truncating),
  timeouts. `assertPublicUrl` rejects bad URLs before a row is created; a
  DNS-level block fails the scan with "That URL is not allowed."
- Crawl stays on the scanned host (www-insensitive), skips files, auth/cart
  paths, tracking params and unbounded query strings, honours robots.txt for
  the `MelloxAI-Audit` token and `nofollow`.
- Soft-404 guards: HTML served at `/robots.txt`, `/sitemap.xml` or `/llms.txt`
  doesn't count as present.
- Tenant isolation: RLS on all four tables; service role only inside the worker
  and cron; routes verify membership and role (editor for writes) first.
- No raw HTML stored. Probe questions are generated by Mellox, never taken from
  page content; probes are metered, budget-checked and cached (6 h).
- Scores are computed server-side — the browser can no longer write a score.

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `PLAN_STARTER_GEO_MAX_PAGES` / `_GROWTH_` / `_AGENCY_` | 25 / 100 / 300 | Pages per full scan |
| `FEATURE_FLAG_GEO_AI_PROBES_ENABLED` | off | AI answer checks (paid) |
| `FEATURE_FLAG_GEO_AI_PROBES_ENABLED_WS_<id>` | — | Per-workspace override |
| `GEO_PROBE_MODELS` | `perplexity/sonar,openai/gpt-4o-mini` | OpenRouter models to probe |
| `GEO_PROBE_MAX_QUERIES` | 4 (max 10) | Questions per model per scan |

Existing requirements apply: `SUPABASE_*`, `CRON_SECRET`, `OPENROUTER_API_KEY`
(probes only), `APP_URL` (crawler user agent).

## Local development

```bash
npm run dev                        # http://localhost:8080 → AI Visibility in the sidebar
supabase db push --db-url "$SUPABASE_DB_URL"   # apply migrations (dry-run first)
npm run db:types && npm run db:verify
```

Full scans finish without pg_cron: the in-request `after()` slice plus the UI's
2-second polling (which re-kicks expired leases) drive them to completion.

## Testing

```bash
npx vitest run src/lib/geo src/server/geo        # engine, scoring, runner (in-memory store)
npm run test:live -- tests/live/geo-scan.live.ts  # real crawl + real DB, cleans up after itself
npx playwright test tests/integration/suggestion-event-deep-links.spec.ts  # needs dev server
```

## Deployment

1. Apply the migration (`supabase db push`), regenerate types if needed.
2. Ensure the Vault secrets exist (see `docs/OPERATIONS-RUNBOOK.md`); the
   migration schedules `mellox-geo-scans` when they do, otherwise run
   `supabase/ENABLE-CRON-JOBS.sql`.
3. Route `maxDuration`: `/api/geo/scans` 60 s, cron hook 120 s. On a
   long-running Node server (Docker/Railway, `output: standalone`) `after()`
   continues after the response; on a serverless host the cron hook alone
   still completes scans, one minute per 90-second slice.
4. Optionally enable probes per workspace.

## Fix workflow and verification

See [ADR-0012](adr/0012-geo-fix-pull-requests-and-verification.md) and
[github-connector.md](github-connector.md). In short: a finding's "Fix this" plans
files for supported framework × rule pairs (`src/server/geo/fixes/targets.ts`),
generates a validated change, opens a PR after exact-content approval, and a
targeted rescan (`mode = 'targeted'`, excluded from history and `geo_audit_runs`)
resolves the finding only when its rule passes on the live page. Manual fixes use
"Verify fix". Resolved findings that reappear are reopened by the next scan.

"Fix all automatically" (`src/server/geo/fixes/batch.server.ts`, table
`geo_fix_batches`) does the same for up to 15 findings at once. The result is one
combined, validated change, approved once and delivered as one pull request.
After merge, one verification resolves each finding only when its own check passes.

PR-fixable rules: `ai.robots_txt`, `ai.bot.*`, `ai.llms_txt`, `tech.sitemap`,
`tech.robots_sitemap`, `tech.title`, `tech.meta_description`, `tech.canonical`,
`tech.lang`, `schema.jsonld`, `schema.organization`, `schema.website`,
`content.h1`, `perf.viewport`, `perf.charset` — on Next.js (App/Pages Router),
Nuxt, Astro, Vite/Vue, Create React App, Angular (`src/index.html`) and static
HTML. Single-page apps get per-route tags only for the homepage.

## GEO Engineer (coding agent) and repository ownership

See [ADR-0013](adr/0013-geo-coding-agent-and-repo-ownership.md).

**Ownership.**
- **Before any repository change**, Mellox proves the linked repository builds
  the scanned host (`src/lib/connectors/ownership.ts` +
  `src/server/connectors/github/ownership.server.ts`). Evidence: GitHub Pages /
  deployment hosting, repository homepage, CNAME, config site URLs, the host
  written in source, and live page text found in source.
- The verdict and its evidence are on `workspace_sources.ownership_*`.
- Fixes need `verified` for the host, checked within 7 days.
- Settings → Connections and the finding's setup step show what would prove it.

**From a finding, "Fix with AI Agent"** starts a run (`geo_agent_runs`):
1. **Investigate.** The agent (routes `geo.agent.*` in
   `src/server/ai/task-models.ts`, Opus 5.5 through OpenRouter) uses read-only
   tools: list/search/read repository files, the scan's page facts, the list
   of scanned pages, the rule and framework playbook, and the live page via
   the SSRF-guarded fetcher.
2. **Plan.** Files with reasons and evidence, risks, scope and validation
   criteria. The server rejects plans that change unread files, blocked paths,
   more than 4 files, or manual-only rules. Missing facts become `needs_input`.
3. **Approve the plan.** Bound to its hash.
4. **Implement.** Exact find/replace edits limited to the plan's files.
5. **Self-review, then validate.** Paths, size, secrets, unsafe additions,
   imports, syntax, rule re-check, plan scope, grounding, deletion cap. Up to
   two correction rounds.
6. **Draft proposal.** From here it follows the ADR-0012 workflow: exact-patch
   approval → `mellox/` branch → PR → merge (by you) → verification rescan.

**Run record.**
- Every tool call and transition is a `geo_agent_events` summary. Model
  reasoning is never stored or shown.
- Runs are leased (`claim_geo_agent_runs`), checkpoint each turn, resume after a
  restart, cancel (closing Mellox's PR), and retry from investigation or from
  the approved plan.

**Staying valid while the repository moves.**
- Each file the agent reads is recorded with its Git blob id. If the base
  branch gains commits before the plan is implemented, the run carries on when
  every file it read is unchanged (`planStillHolds`); otherwise it is stale.
- A proposal's files keep the blob id they were edited from. On approval,
  `commitToNewBranch` accepts a moved base only when those files are
  byte-identical (and new files still don't exist), and commits on the latest
  code. The approved content never changes.
- The implement stage can re-open files the investigation read; a resumed
  stage gets its read list back from the checkpoint.
- Edits match exactly first, then with the file's own line endings (CRLF),
  then with flexible whitespace — always exactly one match (`locateEdit`).

**Limits.**
- `GEO_AGENT_MAX_COST_USD` per run and `GEO_AGENT_DAILY_RUNS` per workspace.
- `geo-agent` and `geo-agent-action` rate-limit tiers.
- Per-repository admin consent before code is sent to the model.

**Dimensions** (`src/lib/geo/dimensions.ts`) — crawlability, indexability,
technical SEO, extractability, answer readiness, entity clarity, structured
data, authority & trust, AI search readiness, plus overall readiness:
- They are derived from each scan's rule summaries, with every rule mapped,
  and stored on the report (`report.dimensions`).
- The overall score stays the six-category score.
- Findings carry `fixMode` and `verifyScope`, and can be marked reviewed or
  ignored with a reason.

## JavaScript rendering

HTTP first. `src/lib/geo/rendering.ts` flags a page whose server HTML has fewer
than 150 words and a client-rendered shell (empty `#root`/`#app`, `<app-root>`,
Nuxt/Next/Svelte markers, module bundles). Those pages are rendered by
`src/server/geo/render.server.ts` (Chromium via `playwright-core`) when
`FEATURE_FLAG_GEO_RENDERING_ENABLED` is on — 10 per full scan, 1 per quick scan.
Every browser request is fulfilled through `createSafeFetch` (Chromium itself
resolves no hostnames), GET only, no images/fonts/media/websockets, ≤ 80 requests,
≤ 8 MB, 20 s. `analysis.rendering` records the mode, reason and word counts;
content rules use the rendered DOM, `perf.server_rendered` still judges the raw
HTML, and `perf.js_dependent_content` reports content that only exists after
JavaScript. When rendering is unavailable the report says so.

## Known limitations

- Rendering needs Chromium (in the Docker image, or Playwright's in development)
  and the flag; without it client-rendered pages are analysed from server HTML and
  the report says rendering was unavailable.
- Authority is on-page only — no backlink data, Search Console, Analytics or
  PageSpeed/Core Web Vitals integration (none existed in the GEO-Module either).
- Heuristic NLP (topic, entities, questions) is English-centric.
- Probes sample a few questions on a few models; answers vary by user and time.
- Response time is measured from Mellox's server, not real-user performance.

## Not ported from the GEO-Module (deliberately)

- FastAPI routes, SQLAlchemy models, its orchestration layer (in-memory queue,
  worker, scheduler) — replaced by Mellox's leases, pg_cron and `scheduled_jobs`.
- The module's auto-apply connectors — replaced by approval-gated GitHub pull
  requests (ADR-0012) and approval-gated WordPress / Webflow field changes
  (`src/server/geo/cms/`); Framer and Shopify aren't implemented.
- Simulated validation — replaced by real rescans and fingerprint comparison.
- The controlled-site lab, keyword stuffing of intent/content-gap rules that
  depended on unimplemented taxonomies.

## Future improvements

Search Console / GA4 connectors; backlink and brand-mention data; Shopify and
Framer connectors on the same proposal/verification records; probe trends over
time and competitor sets; agent-fixable findings inside the one "Fix all" pull
request (today they are fixed one at a time); WordPress custom post types.
