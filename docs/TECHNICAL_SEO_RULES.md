# Technical SEO & Indexability Rules

Task 5 — Technical SEO & Indexability Intelligence Engine.

This document is the authoritative catalog of the technical-SEO rule engine: what
every rule detects, on what evidence, at what severity, why it matters, what to do
about it, and the false-positive controls that keep findings trustworthy.

## 1. Pipeline position

Task 5 adds the analysis stage on top of the Task 4 extraction evidence. It does
**not** re-crawl or re-parse anything:

```text
Website → Crawler → Page Extraction → [ Technical SEO Analysis → Findings/Evidence ] → API
          (Task 3)   (Task 4)           (Task 5 — this engine)
```

The engine reads the already-persisted `PageResult` (raw crawl evidence) and
`PageExtraction` + 13 child evidence tables (structured extraction), and turns them
into page-specific, evidence-backed, severity-classified `TechnicalSeoFinding` rows.

Every finding answers the same four questions:

| Question        | Field(s)                                  |
|-----------------|-------------------------------------------|
| What is wrong?  | `message`, `observed_value`               |
| Where?          | `page_result_id` (→ `page_id`), `scan_id`, `website_id` |
| Why?            | `reason`, `expected_state`, `evidence`    |
| What next?      | `recommendation`                          |
| Tracking        | `rule_id` (→ `type`), `category`, `severity`, `status` |

`Finding → Rule ID → Severity → Page → Evidence → Explanation → Recommendation → Status`.

## 2. Architecture

**Hard boundary — pure logic vs persistence.** `backend/app/technical_seo/` is
pure: no `Session`, no FastAPI, no model writes. It reads a `RuleContext` and
returns in-memory `RuleFinding` DTOs. This mirrors Task 4's split where
`page_extractor.extract_html` is pure while `services.run_scan` is stateful.
Persistence and orchestration live in `backend/app/findings_service.py` — the only
place the engine touches the database.

```text
app/technical_seo/
  config.py     severity model, weights, thresholds (all tunables)
  base.py       RuleFinding DTO, RuleContext, ScanContext, Rule, @register, RULE_REGISTRY
  engine.py     run_page_rules(ctx), build_summary(rows, ...)  (imports .rules)
  rules/
    __init__.py imports every rule module so RULE_REGISTRY is populated at import
    http.py indexability.py canonical.py robots.py title.py meta.py headings.py
    duplicates.py links.py images.py structured_data.py social.py language.py
app/findings_service.py   analyze/get/summary + DB persistence (purge-and-reinsert)
```

**Duck typing.** `RuleContext`/`ScanContext` accept both the SQLAlchemy ORM objects
(`PageResult` + `PageExtraction` + child rows — the production path) and the plain
dataclasses returned by `page_extractor.extract_html` (`ExtractionResult` + `*Item`
— the no-DB verification path). The two shapes share field names, so every accessor
uses `getattr` with safe defaults. This is what lets
`backend/scripts/verify_technical_seo.py` run the full engine on a freshly fetched
page with no database.

**Per-rule fault isolation.** `engine.run_page_rules` runs every registered rule in
its own `try/except`; a rule that raises is logged with `logger.warning(...,
exc_info=True)` and skipped, so one buggy rule never suppresses the other findings
on a page. Failures are never silently dropped.

**Context objects.**

- `RuleContext` (one per page): `page` is always present; `extraction` may be
  `None` (failed crawl / non-HTML). Content rules gate on `ctx.is_indexable_html`
  = `is_success` (200–299) AND `looks_html` AND `has_extraction`. HTTP rules run
  off `page` alone. Derived signals: `ctx.noindex`, `ctx.redirected`,
  `ctx.html_lang`, plus child collection accessors (`headings`, `links`, …).
- `ScanContext` (one per scan, strict isolation to that scan's pages): pre-computed
  cross-page maps keyed by `page_extractor._normalize_url`:
  - `url_status: {normalized url & final_url → (status_code, error)}` — powers
    broken-internal-link and cross-page-canonical escalation.
  - `url_pages: {normalized url → [page_result_id]}` — powers duplicate-URL.
  - `title_map`, `meta_desc_map: {normalized text → [page_result_id]}` — power
    cross-page duplicate detection (len > 1 ⇒ duplicate).
  - `canonical_targets: {normalized canonical → [page_result_id]}` — powers
    shared-canonical.
  - `urls_in_scan: set[normalized url]` — powers hreflang return-reference.

## 3. Severity model

`Critical > High > Medium > Low > Info` (`config.SEVERITY_ORDER`).

| Severity  | Meaning                                                              |
|-----------|---------------------------------------------------------------------|
| critical  | Blocks indexing outright and signals an unhealthy endpoint (5xx).   |
| high      | Prevents or strongly harms indexing (4xx, crawl failure, noindex, robots.txt block, missing/empty title, broken internal link). |
| medium    | Meaningful quality/consolidation issue (missing meta description, missing H1, multiple/invalid canonical, duplicate title, no internal links, invalid JSON-LD, conflicting hreflang). |
| low       | Minor quality signal worth improving (length issues, missing alt, missing OG/Twitter, missing html lang, …). |
| info      | Neutral observation to confirm, not necessarily a defect (redirect, multiple H1, cross-page canonical, decorative empty alt, missing image dimensions, …). |

Severity is **configurable without touching rule code**: each rule declares a
default at its `@register` call, and `config.SEVERITY_OVERRIDES` (currently empty)
can override any `rule_id` centrally. A rule may also escalate its own severity for
a specific finding when it has evidence to justify it (e.g. a cross-page canonical
that points at a crawled error page → `low` instead of `info`).

**Severity distribution (58 rules):** critical 1, high 7, medium 12, low 22, info 16.

## 4. Ownership matrix (one owner per signal)

To prevent the same underlying cause from producing duplicate findings across
categories, each signal has exactly one owning category:

| Signal                                   | Owner          | Notes |
|------------------------------------------|----------------|-------|
| HTTP status (4xx/5xx/crawl-fail/redirect/content-type) | **http** | Carries `{"prevents_indexing": true}` in evidence so indexability never re-emits a status-based block. |
| `noindex`, robots.txt disallow           | **indexability** | Plus the noindex+canonical *combination* conflict. |
| Meta robots directives other than noindex (`nofollow`, `noarchive`, `nosnippet`, other) | **robots** | Page-level directives parsed from HTML. |
| Canonical missing/multiple/empty/invalid/conflicting/cross-page | **canonical** | Cross-page canonical is Info unless the target is a crawled error. |
| **Cross-page** duplicate title / description, shared canonical, duplicate URL | **duplicates** | Derived from `ScanContext` maps, not per-page flags. |
| **Within-page** multiple/empty/short/long title | **title** | |
| **Within-page** multiple/empty/short/long/duplicate description | **meta** | |
| Heading structure (missing/multiple H1, empty, hierarchy, none) | **headings** | Multiple H1 is Info (HTML5 permits it). |
| Internal linking (none/few/empty-anchor/broken/excessive-repeat) | **links** | Broken only with crawl evidence. |
| Image alt/dimensions/count                | **images** | Never claims "slow" or "inaccessible". |
| JSON-LD parse/`@context`/`@type`/duplicate-blocks | **structured_data** | Not a Schema.org validator. |
| Open Graph / Twitter card tags            | **social** | |
| html lang, hreflang validity/duplicate/conflict/return-reference | **language** | |

## 5. False-positive controls

The engine is deliberately conservative — it reports only what the evidence proves.
The key controls (spec §23):

1. **Broken internal link (`SEO-LINK-004`)** fires *only* when the link is
   `link_type == "internal"`, its destination scheme is `http(s)` (guards
   `mailto:`/`tel:`/`javascript:` and scheme-less anchors the extractor mislabels
   internal), **and** the normalized destination was actually crawled in this scan
   and returned 400–599 (`ScanContext.url_status`). An uncrawled / out-of-budget
   destination produces **no** finding. Deduped per normalized destination. A
   single fetched page therefore never produces this finding.
2. **External links are never flagged** as broken or internal.
3. **Cross-page canonical (`SEO-CANON-006`)** is Info with neutral wording
   (pagination and parameter consolidation are legitimate). It escalates to Low
   only when a target is a crawled 4xx/5xx.
4. **Multiple H1 (`SEO-HEADING-002`)** is Info — HTML5 permits multiple H1s inside
   sectioning elements. Wording asks the author to *confirm intent*, never "fix".
5. **Duplicate title (`SEO-DUP-001`)** is computed from `ScanContext.title_map`,
   **not** the Task 4 `title_duplicate` flag (which conflates within-page multiples
   with cross-scan duplicates).
6. **Decorative empty alt (`SEO-IMG-002`)** is Info and never says "inaccessible";
   it asks the author to confirm the image is decorative.
7. **Hreflang return-reference (`SEO-LANG-005`)** fires only when at least one
   referenced target is present in the scan; `x-default` is whitelisted; "invalid
   code" is limited to *clearly* malformed values (no full ISO allowlist).
8. **Structured data** flags a parse error (Medium) and only checks `@context` /
   `@type` on a *top-level* JSON-LD object, skipping lists and `@graph` containers.
   No Schema.org property validation.
9. **Redirect (`SEO-HTTP-004`)** is based on `PageIndexabilityEvidence.redirected`
   (or a normalized url ≠ final_url fallback), reported as Info; it escalates to
   Low only if the final status is 4xx/5xx.
10. **Idempotency & determinism.** Analysis purges and reinserts per scan/page, so
    re-running on the same evidence yields the same findings. Rules are pure
    functions of the evidence — no clock, no randomness.

## 6. Rule catalog

58 rules across 13 categories. Each rule is registered with
`@register(rule_id, category, default_severity, name, purpose)`. "Gate" below means
the rule only runs on indexable HTML (`ctx.is_indexable_html`) unless noted.

### 6.1 HTTP / response (`http`) — runs off `page` alone (no gate)

| Rule ID | Sev | Name | Condition | Key evidence | Recommendation |
|---------|-----|------|-----------|--------------|----------------|
| SEO-HTTP-001 | critical | Server error (5xx) | `500 ≤ status_code ≤ 599` | `status_code`, `prevents_indexing:true` | Fix the server error so the page returns 2xx. |
| SEO-HTTP-002 | high | Client error (4xx) | `400 ≤ status_code ≤ 499` | `status_code`, `prevents_indexing:true` | Restore the page or remove references to it. |
| SEO-HTTP-003 | high | Crawl failure | `status_code is None` **and** `error` present | `error`, `prevents_indexing:true` | Investigate the network/DNS/timeout error. |
| SEO-HTTP-004 | info | Redirect | `ctx.redirected` is true | `requested_url`, `final_url`, `final_status`, `lands_on_error` | Confirm the redirect is intentional and lands on 2xx. Escalates to **low** if final status is 4xx/5xx. |
| SEO-HTTP-005 | info | Unexpected content type | `is_success` and content-type present and not HTML | `content_type`, `status_code` | Confirm the URL is meant to be a crawlable HTML page. |

### 6.2 Indexability (`indexability`)

| Rule ID | Sev | Name | Condition | Key evidence | Recommendation |
|---------|-----|------|-----------|--------------|----------------|
| SEO-INDEX-001 | high | Page marked noindex | `ctx.noindex` (meta robots or indexability evidence) | `noindex:true`, `source` | Remove noindex if the page should be indexable. |
| SEO-INDEX-002 | high | Blocked by robots.txt | `robots_txt_allowed is False` (explicit) | `robots_txt_allowed:false` | Allow this path in robots.txt if it should be indexed. (See §8 limitation.) |
| SEO-INDEX-003 | medium | Noindex with canonical | `noindex` **and** `canonical_present` | `noindex`, `canonical_present` | Keep either noindex or the canonical, not both. |

### 6.3 Canonical (`canonical`) — gated

| Rule ID | Sev | Name | Condition | Key evidence | Recommendation |
|---------|-----|------|-----------|--------------|----------------|
| SEO-CANON-001 | low | Missing canonical | no `canonical_present` | `canonical_present:false` | Add a canonical, usually self-referencing. |
| SEO-CANON-002 | medium | Multiple canonicals | `canonical_multiple` or `canonical_count > 1` | `canonical_count`, `urls` | Keep a single canonical link. |
| SEO-CANON-003 | medium | Empty canonical | any canonical `empty` | `empty_canonical:true` | Set the canonical href to the preferred absolute URL. |
| SEO-CANON-004 | medium | Invalid canonical URL | canonical not `empty` and not `valid` | `invalid_urls` | Use a valid absolute http(s) URL. |
| SEO-CANON-005 | medium | Conflicting canonicals | `canonical_conflict` | `canonical_conflict`, `urls` | Resolve to one consistent target. |
| SEO-CANON-006 | info | Cross-page canonical | any canonical `cross_page` | `cross_page_targets`, `broken_targets` | Confirm the target is intentional and returns 2xx. Escalates to **low** if a target is a crawled 4xx/5xx. |

### 6.4 Robots directives (`robots`)

Owns meta-robots directives other than `noindex`. `ctx.robots` may be `None`.

| Rule ID | Sev | Name | Condition | Key evidence | Recommendation |
|---------|-----|------|-----------|--------------|----------------|
| SEO-ROBOTS-001 | low | Meta nofollow | `robots.nofollow` | `nofollow:true` | Remove nofollow if links should be followed. |
| SEO-ROBOTS-002 | info | Noarchive directive | `robots.noarchive` | `noarchive:true` | Keep only if caching is intentionally disabled. |
| SEO-ROBOTS-003 | info | Nosnippet directive | `robots.nosnippet` | `nosnippet:true` | Keep only if snippets are intentionally suppressed. |
| SEO-ROBOTS-004 | info | Other robots directives | `robots.other_directives` non-empty | `other_directives` | Review each directive and confirm it is intentional. |

### 6.5 Title (`title`) — gated, within-page only

| Rule ID | Sev | Name | Condition | Key evidence | Recommendation |
|---------|-----|------|-----------|--------------|----------------|
| SEO-TITLE-001 | high | Missing title | no `title_present` or `title_count == 0` | `title_present:false` | Add a descriptive unique title. |
| SEO-TITLE-002 | high | Empty title | `title_present` and `title_empty` | `title_empty:true` | Add descriptive text to the title. |
| SEO-TITLE-003 | low | Title too short | `title_too_short` (Task 4 flag) and not empty | `title_length`, `title_text` | Expand the title so it clearly describes the page. |
| SEO-TITLE-004 | low | Title too long | `title_too_long` (Task 4 flag) | `title_length`, `title_text` | Shorten so important words appear first. |
| SEO-TITLE-005 | low | Multiple title elements | `title_count > 1` | `title_count` | Keep a single title element in the head. |

### 6.6 Meta description (`meta`) — gated, within-page only

| Rule ID | Sev | Name | Condition | Key evidence | Recommendation |
|---------|-----|------|-----------|--------------|----------------|
| SEO-META-001 | medium | Missing meta description | no `meta_description_present` or count 0 | `meta_description_present:false` | Add a concise, descriptive meta description. |
| SEO-META-002 | medium | Empty meta description | any description item `empty` | `empty_description:true` | Add descriptive content to the meta description. |
| SEO-META-003 | low | Meta description too short | any item `too_short` and not empty | `too_short:true` | Expand to better summarise the page. |
| SEO-META-004 | low | Meta description too long | any item `too_long` | `too_long:true` | Shorten so the key message appears first. |
| SEO-META-005 | low | Multiple meta descriptions | `meta_description_count > 1` | `meta_description_count` | Keep a single meta description. |
| SEO-META-006 | low | Duplicate within page | any item `duplicate_within_page` | `duplicate_within_page:true` | Remove the duplicate description tags. |

### 6.7 Headings (`headings`) — gated

| Rule ID | Sev | Name | Condition | Key evidence | Recommendation |
|---------|-----|------|-----------|--------------|----------------|
| SEO-HEADING-001 | medium | Missing H1 | `missing_h1` **and** `len(headings) > 0` | `h1_count` | Add a single descriptive H1. |
| SEO-HEADING-002 | info | Multiple H1 | `multiple_h1` | `h1_count` | Confirm the multiple H1s are intentional (HTML5 permits it). |
| SEO-HEADING-003 | low | Empty headings | any heading `empty` | `empty_heading_count`, `levels` | Remove empty headings or add text. |
| SEO-HEADING-004 | low | Heading hierarchy issue | `heading_hierarchy_issue`, excluding the missing-H1 detail | `heading_hierarchy_details` | Adjust levels so they nest without skipping. |
| SEO-HEADING-005 | low | No heading structure | `len(headings) == 0` | `heading_count:0` | Add a heading structure starting with an H1. |

`SEO-HEADING-004` filters out the "Document is missing an H1" detail so it never
double-emits with `SEO-HEADING-001`/`005`.

### 6.8 Duplicates (`duplicates`) — gated, cross-page via `ScanContext`

| Rule ID | Sev | Name | Condition | Key evidence | Recommendation |
|---------|-----|------|-----------|--------------|----------------|
| SEO-DUP-001 | medium | Duplicate title across pages | normalized title in `title_map` with > 1 page | `shared_by_page_ids`, `occurrences` | Give each page a unique title. |
| SEO-DUP-002 | low | Duplicate description across pages | first non-empty description in `meta_desc_map` with > 1 page | `shared_by_page_ids`, `occurrences` | Write a unique description per page. |
| SEO-DUP-003 | info | Shared canonical target | canonical target shared by ≥ `SHARED_CANONICAL_MIN` (3) pages | `canonical_target`, `page_count` | Confirm the consolidation is intentional. |
| SEO-DUP-004 | info | Duplicate URL via normalization | > 1 crawled URL normalizes to the same address (`url_pages`) | `normalized_url`, `other_page_ids` | Consolidate duplicate URLs (redirect/canonicalise). |

### 6.9 Links (`links`) — gated; `_internal_http_links` filters non-http schemes

| Rule ID | Sev | Name | Condition | Key evidence | Recommendation |
|---------|-----|------|-----------|--------------|----------------|
| SEO-LINK-001 | medium | No internal links | 0 internal http links | `internal_link_count:0` | Add internal links to related pages. |
| SEO-LINK-002 | low | Very few internal links | `0 < n < FEW_INTERNAL_LINKS_THRESHOLD` (3) | `internal_link_count`, `threshold` | Add more internal links where relevant. |
| SEO-LINK-003 | info | Empty anchor text | internal links with blank anchor text | `empty_anchor_count`, `sample_destinations` | Add descriptive anchor text or alt text for image links. |
| SEO-LINK-004 | high | Broken internal link | internal http destination crawled in-scan with status 400–599 | `destination_url`, `destination_status` | Fix/remove the link or restore the destination. **Only with crawl evidence** (see §5.1). |
| SEO-LINK-005 | info | Excessively repeated link | same destination repeated > `EXCESSIVE_REPEAT_LINK_THRESHOLD` (20) times | `repeated_destinations`, `threshold` | Confirm the repetition is intentional. |

### 6.10 Images (`images`) — gated; count/attribute signals only

| Rule ID | Sev | Name | Condition | Key evidence | Recommendation |
|---------|-----|------|-----------|--------------|----------------|
| SEO-IMG-001 | low | Images missing alt | any image `alt_missing` | `images_missing_alt`, `sample_urls` | Add descriptive alt text to informative images. |
| SEO-IMG-002 | info | Images with empty alt | any image `alt_empty` | `images_empty_alt`, `sample_urls` | Confirm empty-alt images are decorative. |
| SEO-IMG-003 | info | Images missing dimensions | any image without width or height | `images_missing_dimensions` | Add width/height where the intrinsic size is known. |
| SEO-IMG-004 | info | High image count | `image_count > IMAGE_COUNT_THRESHOLD` (100) | `image_count`, `threshold` | Review whether all images are necessary. |

Per spec §13 these rules **never** claim an image is slow or inaccessible — only
what the evidence proves (a missing/empty attribute, an absent dimension, a count).

### 6.11 Structured data (`structured_data`) — gated; not a Schema.org validator

| Rule ID | Sev | Name | Condition | Key evidence | Recommendation |
|---------|-----|------|-----------|--------------|----------------|
| SEO-SD-001 | medium | Invalid JSON-LD | block has `parse_error` | `block_position`, `parse_error` | Fix the JSON-LD syntax so the block parses. |
| SEO-SD-002 | low | Missing @context | top-level object (not list/`@graph`) without `@context` | `block_position` | Add an `@context` such as `https://schema.org`. |
| SEO-SD-003 | low | Missing @type | top-level object (not list/`@graph`) without `@type` | `block_position` | Add an `@type` describing the entity. |
| SEO-SD-004 | info | Duplicate blocks | more than one block with the same sorted type set | `duplicate_type_sets` | Confirm the repeated blocks are intentional. |

### 6.12 Social (`social`) — gated; aggregated per page

| Rule ID | Sev | Name | Condition | Key evidence | Recommendation |
|---------|-----|------|-----------|--------------|----------------|
| SEO-SOCIAL-001 | low | Missing Open Graph tags | any of `og:title/description/image/url` absent | `missing_og`, `present_og` | Add the missing OG tags for reliable previews. |
| SEO-SOCIAL-002 | low | Missing Twitter/X card tags | `twitter:card` absent | `missing_twitter`, `present_twitter` | Add a `twitter:card` and relevant metadata. |

### 6.13 Language & hreflang (`language`) — gated

| Rule ID | Sev | Name | Condition | Key evidence | Recommendation |
|---------|-----|------|-----------|--------------|----------------|
| SEO-LANG-001 | low | Missing html language | blank `html_lang` | `html_lang` | Add a `lang` attribute to `<html>`. |
| SEO-LANG-002 | low | Invalid or empty hreflang | any `language_region` clearly malformed (`x-default` whitelisted) | `invalid_codes` | Use valid BCP-47 codes. |
| SEO-LANG-003 | low | Duplicate hreflang | any `duplicate_declaration` | `duplicate_declaration:true` | Remove duplicate hreflang entries. |
| SEO-LANG-004 | medium | Conflicting hreflang | any `conflicting_declaration` | `conflicting_declaration:true` | Resolve to one target per language. |
| SEO-LANG-005 | info | Missing return reference | in an hreflang cluster with ≥1 target in-scan, page does not reference itself | `hreflang_targets`, `in_scan_targets` | Add a self-referencing hreflang entry. |

## 7. Provisional scoring foundation

The scoring here is **provisional** and explicitly *not* the final GEO/AEO score
(spec §20). It is a transparent heuristic derived from the real findings so the
future `Score → Category → Rule → Evidence → Page` chain can replace the numbers
without changing the finding evidence or breaking clients.

- `SEVERITY_WEIGHTS = {info:0, low:1, medium:3, high:7, critical:15}` (tunable).
- Per category: `penalty = Σ severity_weight`, and
  `category_health = max(0, round(100 − penalty / max(1, pages_analyzed)))`.
- `provisional_overall_health = round(mean(category_health for categories with findings))`;
  `worst_category` is the lowest-health category. An empty scan scores 100.
- Every summary payload carries
  `scoring = {provisional: true, version: "0.1-provisional", weights, note}`.

`build_summary(rows, pages_analyzed, scan_id, website_id)` takes a list of
`(category, severity)` pairs — one per finding — which works identically for
in-memory `RuleFinding` objects and persisted rows, keeping the aggregation free of
any ORM dependency. `get_scan_findings_summary` computes the same shape from the
*persisted* findings (reflecting the last analysis without re-running it).

## 8. Known evidence limitation (documented, not a bug)

The live crawler hardcodes `robots_txt_allowed = True` and skips robots-blocked
URLs *before* fetch, so in production `SEO-INDEX-002` (Blocked by robots.txt) is
effectively **fixture-only** today — it fires when evidence explicitly sets
`robots_txt_allowed = False`, which the current crawler never does for fetched
pages. The rule is intentionally kept for forward compatibility: when the crawler
begins persisting real robots.txt disallow evidence, the rule will fire with no
engine change. This is a property of the upstream crawl evidence, not of the rule.

## 9. Persistence & API

### Model — `TechnicalSeoFinding` (`technical_seo_findings`)

`id`, `website_id` (FK, idx), `scan_id` (FK, idx), `page_result_id` (FK, idx,
**not null** — every finding is page-anchored), `rule_id`, `category`, `severity`,
`status` (default `"open"`), `message`, `observed_value`, `expected_state`,
`reason`, `recommendation`, `evidence` (JSON), `created_at`. `Scan.findings` and
`PageResult.findings` relationships use `cascade="all, delete-orphan"`. There is
**no** unique constraint — a rule may legitimately emit several rows on one page
(e.g. multiple broken links); idempotency comes from purge-and-reinsert. The table
is created by `Base.metadata.create_all` (no Alembic in this repo).

Two documented reconciliations with the earlier data model (the `pages` /
`PageObservation` tables do not exist yet):

- Column `page_result_id` is exposed as `page_id` in the response schema.
- Columns `rule_id` + `category` are kept; `type` is exposed as an alias of
  `rule_id`. Together these satisfy the Finding contract in VALIDATION_RULES.md §9
  (`website_id, scan_id, page_id, type, severity, status`) without a redundant
  column.

### Endpoints (all under `/api/v1`)

| Method & path | Purpose | Errors |
|---------------|---------|--------|
| `POST /scans/{scan_id}/analyze` | Run analysis over the scan's extracted pages; returns the provisional summary. | 404 unknown scan |
| `GET /scans/{scan_id}/findings` | List a scan's findings. Filters: `severity`, `category`, `rule_id`, `status`. | 400 invalid `severity`/`category`; 404 unknown scan |
| `GET /scans/{scan_id}/findings/summary` | Provisional summary from persisted findings. | 404 unknown scan |
| `GET /pages/{page_id}/findings` | List a page's findings (+ same filters). Clean page → `[]`. | 400 invalid filter; 404 unknown page |
| `GET /findings/{finding_id}` | A single finding. | 404 "Finding not found" |
| `GET /websites/{website_id}/findings` | All findings for a website (+ filters). | 400 invalid filter; 404 unknown website |

Error contract matches the rest of the API: `ValueError("… not found")` → 404;
invalid filter value → 400. Filter validity is derived from the live registry:
valid categories are `{rule.category for rule in RULE_REGISTRY}` and valid
severities are `SEVERITY_ORDER`.

### Automatic analysis after a crawl

`services.run_scan` calls `analyze_scan_findings(db, scan.id)` after the Task 4
extraction hook and before `update_scan_status(..., "completed")`, wrapped in
`try/except: pass`. Analysis failure must never fail a successful crawl — identical
error-isolation to the extraction hook.

## 10. Extensibility

- **Add a rule:** write a function in the appropriate `rules/*.py` module and
  decorate it with `@register(rule_id, category, severity, name, purpose)`. Return
  a list of `RuleFinding` (empty list when the rule does not fire). It is picked up
  automatically because `rules/__init__.py` imports every module and `engine.py`
  imports `.rules`.
- **Retune severity:** add `{"SEO-XXX-001": "medium"}` to
  `config.SEVERITY_OVERRIDES` — no rule code changes.
- **Retune thresholds:** edit `config.py` (`FEW_INTERNAL_LINKS_THRESHOLD`,
  `EXCESSIVE_REPEAT_LINK_THRESHOLD`, `SHARED_CANONICAL_MIN`,
  `IMAGE_COUNT_THRESHOLD`). Title/meta length thresholds are intentionally *not*
  duplicated here — rules reuse Task 4's already-computed boolean flags so those
  thresholds keep a single source of truth in `page_extractor`.

## 11. Test coverage

| Suite | Focus |
|-------|-------|
| `backend/tests/test_technical_seo_rules.py` | Per-rule detection, ownership (no double-emit), the false-positive controls in §5, gating on non-HTML/non-200 pages. |
| `backend/tests/test_technical_seo_scoring.py` | `build_summary` category health, provisional overall health, empty-scan = 100, `scoring.provisional`, idempotency, strict scan isolation. |
| `backend/tests/test_technical_seo_api.py` | The six endpoints: analyze happy-path + 404, each filter + invalid-filter 400, summary shape incl. `scoring.provisional`, page/finding/website endpoints, clean page → `[]`, `page_id`/`type` aliases, two-scan isolation. |
| `backend/tests/test_technical_seo_real_site.py` | Live-or-offline verification: stable, non-fabricated, page-anchored, explainable findings; no `SEO-LINK-004` without crawl evidence; external links never flagged; multiple-H1 stays Info; determinism. |

Real-site verification script: `backend/scripts/verify_technical_seo.py` (default
target `https://www.python.org/`) runs the full engine with no database via the
duck-typed dataclass path and applies the §5 mechanical false-positive controls.
