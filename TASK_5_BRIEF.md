# Task 5 — Technical SEO & Indexability Intelligence — Brief

A one-page summary of what was delivered, framed the way the engine itself frames
every finding: **what is wrong, where, why it matters, what happens next, and what is fixed.**

---

## What has been done

Built a **Technical SEO & Indexability Intelligence Engine** on top of the existing
Task 4 page-extraction evidence — **without** rebuilding crawling or extraction.

```
Website → Crawler → Page Extraction → [ Technical SEO Analysis → Findings ] → API
                    (Task 4)            (Task 5 — this work)
```

It turns the already-persisted crawl + extraction evidence into **page-specific,
evidence-backed, severity-classified, API-accessible** findings:

- **58 rules across 13 categories** (http, indexability, canonical, robots, title,
  meta, headings, duplicates, links, images, structured data, social, language).
- A **pure rule engine** (`backend/app/technical_seo/`) with a `@register` registry
  and per-rule fault isolation — one broken rule can never suppress the others.
- A **persistence/service layer** (`backend/app/findings_service.py`) — the single
  place the engine touches the database; idempotent (purge-and-reinsert), strict
  per-scan isolation.
- **6 API endpoints** for analyzing and reading findings (with filters + summary).
- Analysis **runs automatically after each crawl**, error-isolated so it can never
  fail an otherwise-successful scan.

**Every finding answers four questions** — this is the core deliverable:

| Question | Field(s) |
|----------|----------|
| **What is wrong?** | `message`, `observed_value` |
| **Where?** | `page_id` (`page_result_id`), `scan_id`, `website_id` |
| **Why does it matter?** | `reason`, `expected_state`, `evidence` |
| **What next?** | `recommendation` |
| Tracking | `rule_id` (`type`), `category`, `severity`, `status` |

---

## What is wrong (known issues / limitations)

- **robots.txt-block rule is fixture-only today.** The live crawler hardcodes
  `robots_txt_allowed = True` and skips robots-blocked URLs *before* fetch, so
  `SEO-INDEX-002` never fires on real crawls yet. This is a property of the upstream
  crawl evidence, **not a bug in the rule** — the rule is kept for forward compatibility.
- **The score is provisional, not final.** The summary exposes a transparent
  technical-health heuristic derived from real findings. It is explicitly marked
  `provisional` and is **not** the final GEO/AEO score.
- **9 outstanding GitHub security alerts** on the company repository (8 high, 1
  moderate) — see the Security note below. Untouched by design.

---

## Where (key locations)

| Area | Path |
|------|------|
| Pure rule engine | `backend/app/technical_seo/` (`base.py`, `engine.py`, `config.py`, `rules/`) |
| Persistence + orchestration | `backend/app/findings_service.py` |
| Model | `TechnicalSeoFinding` in `backend/app/models.py` |
| API routes | `backend/app/main.py` (6 endpoints under `/api/v1`) |
| Auto-run hook | `backend/app/services.py` (`run_scan`) |
| Verification script | `backend/scripts/verify_technical_seo.py` |
| Tests | `backend/tests/test_technical_seo_{rules,scoring,api,real_site}.py` |
| Full rule catalog | `docs/TECHNICAL_SEO_RULES.md` |

---

## Why it matters

- Findings are **traceable to the exact evidence** that produced them — you can
  always answer *why* an issue was flagged, on *which* page.
- The engine is **conservative**: it reports only what the evidence proves, so the
  output is trustworthy rather than noisy.
- It is **modular and configurable** — new rules, severities, and thresholds can be
  added or retuned without touching unrelated code.

---

## What is fixed (the trust controls that were deliberately built in)

- **No fabricated broken links** — `SEO-LINK-004` fires only when a link's
  destination was actually crawled in-scan and returned 4xx/5xx. A single fetched
  page never produces it.
- **External links are never flagged** as broken or internal.
- **Multiple H1 and cross-page canonical are informational**, not errors (both are
  legitimate); cross-page canonical escalates only if its target is a crawled error.
- **No double-emission** — an ownership matrix gives each signal exactly one owning
  category (e.g. HTTP owns status codes; indexability owns noindex).
- **Structural-only structured-data checks** — parse errors + missing top-level
  `@context`/`@type`; no false Schema.org validation.
- **Determinism & idempotency** — re-running on the same evidence yields the same
  findings.

---

## Status

- **Tests:** `279 passed` (222 baseline + 57 new). Green.
- **Commits:** 7 logical commits on branch `task5-technical-seo`; final `d69e19c`.
- **Not pushed:** no git remote is configured. Pushing to a company/production repo
  needs explicit authorization + credentials — provide the remote and it can be done
  as a separate, confirmed step.

---

## Security note (spec §26)

> Task 4 reports 9 GitHub dependency/security alerts on the company repository,
> including 8 high and 1 moderate. This is outside today's scope. Do not silently
> change dependencies; report security findings.

**Reported, not acted on:** no dependency was changed as part of Task 5 (all work
was additive application/test/doc code). The 9 alerts (8 high, 1 moderate) should be
triaged separately, with authorization.

---

## What should happen next

1. **Triage the 9 GitHub security alerts** (8 high, 1 moderate) in a dedicated,
   authorized change.
2. **Push the branch** once a remote and authorization are provided.
3. **Persist real robots.txt evidence** in the crawler so `SEO-INDEX-002` becomes
   live rather than fixture-only.
4. **Replace the provisional score** with the final `Score → Category → Rule →
   Evidence → Page` GEO/AEO chain (the API payload is already versioned for this).
5. Optionally, build the downstream **Recommendation / Fix** workflows on top of the
   findings.
