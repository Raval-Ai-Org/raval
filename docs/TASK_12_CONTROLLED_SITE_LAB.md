# Task 12: Controlled Site Lab & Reproducible Test Fixtures

## 1. Overview & Purpose

The **Controlled Site Lab** is an isolated, deterministic, reproducible experimental testing environment designed to support **Task 12: Evidence, Experimentation, Production-Validation and Closed-Loop Measurement**.

In the Raval AI Search Intelligence lifecycle:
```
Site → Crawl/Render → Analyze → Score → Finding → Fix Plan → Safety → Apply → Validate → Rescan → Compare → Measure → Monitor
```

To scientifically prove and measure the closed-loop effectiveness of fix planning, auto-remediation, and rescan validation without dependency on unstable external websites or sensitive production data, the Controlled Site Lab provides ground-truth test sites with known engineered defects and mathematically deterministic expected states.

---

## 2. Fixture Directory Structure

All lab fixtures, models, and server utilities are located in `backend/app/lab/`:

```
backend/app/lab/
├── __init__.py                # Package exports (models, catalog, fixtures, server)
├── models.py                  # Pydantic schemas: IntentionalDefect, ExpectedPageState, LabFixtureConfig, LabCatalog
├── catalog.py                 # Centralized catalog builder, registry, query, and JSON export utilities
├── server.py                  # In-process ThreadingHTTPServer (LabTestServer) for live HTTP & crawler interaction
└── fixtures/
    ├── __init__.py            # Fixture builders export
    ├── static_site.py         # Multi-page Static HTML website with robots.txt, sitemap.xml, 301 redirects, defects
    ├── server_rendered_site.py# Dynamic Server-Rendered HTML site with SSR metadata and dynamic defect conditions
    ├── dynamic_site.py        # Dynamic React/Next.js SPA fixture (raw shell vs rendered DOM comparison)
    └── wordpress_site.py      # WordPress fixture integrated with MockWordPressClient & WordPressConnector
```

---

## 3. Four Fixture Archetypes

### A. Static HTML Fixture (`static_site_01`)
- **Simulated Base URL**: `https://static.lab.local`
- **Pages**:
  - `/` & `/index.html`: Fully compliant homepage with Organization JSON-LD, self-referencing canonical, clean heading structure.
  - `/about.html`: Missing `<title>` tag (`DEF-STATIC-001`), Multiple `<h1>` headings (`DEF-STATIC-002`).
  - `/services.html`: Weak meta description (`DEF-STATIC-003`, 13 chars), Canonical conflict pointing to wrong URL (`DEF-STATIC-004`), Service schema.
  - `/docs.html`: Malformed JSON-LD structured data (`DEF-STATIC-005`), Heading hierarchy skip H1 -> H3 (`DEF-STATIC-006`), Broken link to 404 target (`DEF-STATIC-007`).
  - `/contact.html`: Meta robots `noindex, follow` (`DEF-STATIC-008`), Missing canonical element (`DEF-STATIC-009`).
  - `/old-services`: 301 Permanent Redirect to `/services.html` (`DEF-STATIC-010`).
- **Robots & Sitemap**: Includes strict `robots.txt` disallowing `/admin/` and valid `sitemap.xml`.

### B. Server-Rendered Fixture (`server_rendered_site_01`)
- **Simulated Base URL**: `https://ssr.lab.local`
- **Characteristics**: Returns dynamically rendered HTML on HTTP GET with server headers (`X-Rendered-By: Server-Side-Engine`).
- **Pages**:
  - `/`: Excessively long title (95 characters, `DEF-SSR-001`), FAQ section without direct answer block (`DEF-SSR-002`).
  - `/products/ai-analytics`: Product catalog images missing `alt` attributes (`DEF-SSR-003`), ItemList schema.
  - `/faq`: Missing canonical tag (`DEF-SSR-004`), Missing H1 heading starting with H2 (`DEF-SSR-005`), FAQPage schema.
  - `/legacy-catalog`: 301 Permanent Redirect to `/products/ai-analytics`.

### C. Dynamic React/Next.js-Style Fixture (`dynamic_browser_site_01`)
- **Simulated Base URL**: `https://dynamic.lab.local`
- **Characteristics**: Simulates modern single-page application hydration:
  - **Raw HTML GET**: Minimal client shell (`<div id="root"><div class="loading-state">...</div></div>`).
  - **Rendered DOM Snapshot**: Hydrated document containing dynamically injected title, canonical, `SoftwareApplication` JSON-LD schema, metric widgets, and a concise AEO direct answer block.
- **Intentional Signals**:
  - Content invisible on raw HTTP GET (`DEF-DYN-001`).
  - Placeholder shell title differs from hydrated DOM title (`DEF-DYN-002`).
  - Schema.org JSON-LD injected post-render by JavaScript (`DEF-DYN-003`).

### D. WordPress Fixture (`wordpress_site_01`)
- **Simulated Base URL**: `https://wp.lab.local`
- **Characteristics**: Seamlessly bridges with Task 11 `MockWordPressClient` and `WordPressConnector`.
- **Seeded Resources**:
  - Page 101 (`/about-us`): Missing Yoast SEO title (`DEF-WP-001`), Weak Yoast meta description (`DEF-WP-002`).
  - Post 201 (`/geo-guide`): Media attachment 301 missing alt text (`DEF-WP-003`), Missing direct answer definition block (`DEF-WP-004`).
  - Post 202 (`/ai-search-ranking`): Yoast canonical pointing to wrong external domain (`DEF-WP-005`).
  - Media 301 (`/wp-content/uploads/2026/09/geo-diagram.png`): Empty `alt_text`.

---

## 4. Master Intentional Defect Catalog

| Defect ID | Fixture ID | Category | Rule Code | Target Resource | Severity | Pre-Fix Raw State | Expected Remediation |
|---|---|---|---|---|---|---|---|
| `DEF-STATIC-001` | `static_site_01` | `METADATA` | `TITLE_MISSING` | `/about.html` | High | `title: None` | Insert document `<title>` |
| `DEF-STATIC-002` | `static_site_01` | `HEADINGS` | `R-STR-02` | `/about.html` | Medium | `h1_count: 2` | Consolidate to single `<h1>` |
| `DEF-STATIC-003` | `static_site_01` | `METADATA` | `META_DESC_WEAK` | `/services.html` | Medium | `length: 13` | Expand meta description |
| `DEF-STATIC-004` | `static_site_01` | `CANONICAL` | `CANONICAL_CONFLICT` | `/services.html` | High | Incorrect target URL | Update canonical to `/services.html` |
| `DEF-STATIC-005` | `static_site_01` | `STRUCTURED_DATA` | `SCHEMA_MALFORMED` | `/docs.html` | High | Unparseable JSON-LD syntax | Repair valid JSON-LD structure |
| `DEF-STATIC-006` | `static_site_01` | `HEADINGS` | `R-STR-03` | `/docs.html` | Medium | Skips H1 -> H3 | Normalize heading levels |
| `DEF-STATIC-007` | `static_site_01` | `LINKS` | `HTTP_404_DEAD_LINK` | `/docs.html` | Medium | Target returns 404 | Update internal link target |
| `DEF-STATIC-008` | `static_site_01` | `INDEXABILITY` | `ROBOTS_NOINDEX` | `/contact.html` | High | `noindex, follow` | Update to `index, follow` |
| `DEF-STATIC-009` | `static_site_01` | `CANONICAL` | `CANONICAL_MISSING` | `/contact.html` | Medium | No canonical tag | Insert self-referencing canonical |
| `DEF-STATIC-010` | `static_site_01` | `REDIRECTS` | `REDIRECT_301` | `/old-services` | Info | 301 Permanent Redirect | Verify redirect resolution |
| `DEF-SSR-001` | `server_rendered_site_01` | `METADATA` | `TITLE_TOO_LONG` | `/` | Medium | Length: 95 chars | Shorten title tag |
| `DEF-SSR-002` | `server_rendered_site_01` | `AEO_GEO` | `R-QNA-02` | `/` | High | Conversational fluff intro | Add direct 30-50 word answer block |
| `DEF-SSR-003` | `server_rendered_site_01` | `ACCESSIBILITY` | `IMAGE_ALT_MISSING` | `/products/ai-analytics` | Medium | Missing image `alt` attrs | Inject descriptive alt text |
| `DEF-SSR-004` | `server_rendered_site_01` | `CANONICAL` | `CANONICAL_MISSING` | `/faq` | Medium | Missing canonical tag | Insert canonical link |
| `DEF-SSR-005` | `server_rendered_site_01` | `HEADINGS` | `R-STR-01` | `/faq` | High | `h1_count: 0` | Add primary H1 heading |
| `DEF-DYN-001` | `dynamic_browser_site_01` | `AEO_GEO` | `CLIENT_SIDE_ONLY_CONTENT` | `/dashboard` | High | Absent on raw GET | Enable SSR / pre-rendering |
| `DEF-DYN-002` | `dynamic_browser_site_01` | `METADATA` | `DYNAMIC_TITLE_MISMATCH` | `/dashboard` | Medium | Raw title = "Loading..." | Server-render document title |
| `DEF-DYN-003` | `dynamic_browser_site_01` | `STRUCTURED_DATA` | `SCHEMA_INJECTED_POST_RENDER` | `/dashboard` | Low | Dynamic JS injection | Embed JSON-LD in initial HTML |
| `DEF-WP-001` | `wordpress_site_01` | `METADATA` | `WP_YOAST_TITLE_MISSING` | `page:101` | High | `_yoast_wpseo_title: ""` | Set Yoast SEO title |
| `DEF-WP-002` | `wordpress_site_01` | `METADATA` | `WP_YOAST_DESC_WEAK` | `page:101` | Medium | Short meta description | Update Yoast meta description |
| `DEF-WP-003` | `wordpress_site_01` | `ACCESSIBILITY` | `WP_MEDIA_ALT_MISSING` | `media:301` | Medium | `alt_text: ""` | Set attachment alt text |
| `DEF-WP-004` | `wordpress_site_01` | `AEO_GEO` | `WP_AEO_ANSWER_MISSING` | `post:201` | High | Missing answer block | Insert AEO answer block |
| `DEF-WP-005` | `wordpress_site_01` | `CANONICAL` | `WP_CANONICAL_MISCONFIGURED` | `post:202` | High | Wrong external domain | Update canonical to local post URL |

---

## 5. Usage in Tests and Future Task 12 Steps

### Querying the Catalog
```python
from app.lab import get_lab_catalog, get_defect, get_defects_by_category, DefectCategory

catalog = get_lab_catalog()
all_defects = catalog.get_all_defects()
canonical_issues = get_defects_by_category(DefectCategory.CANONICAL)
defect = get_defect("DEF-STATIC-001")
```

### Running the Live Local HTTP Test Server
```python
from app.lab import LabTestServer
import requests

with LabTestServer() as server:
    # Fetch static fixture
    resp = requests.get(server.get_static_url("/about.html"))
    assert resp.status_code == 200

    # Fetch server-rendered fixture
    resp = requests.get(server.get_ssr_url("/"))
    assert resp.headers.get("X-Rendered-By") == "Server-Side-Engine"

    # Fetch dynamic SPA fixture (rendered snapshot)
    resp = requests.get(server.get_dynamic_url("/dashboard?rendered=true"))
    assert "Real-Time AI Search Analytics" in resp.text
```

### Using WordPress Lab Environment with WordPressConnector
```python
from app.lab import WordPressLabEnvironment

env = WordPressLabEnvironment()
connector = env.get_connector()

# Read resource
resource = connector.get_resource("page:101")
assert resource.title == "About Apex Enterprise"
```

---

## 6. Determinism & Security Boundaries

1. **Strict Determinism**: Fixtures contain static, hardcoded timestamps and HTML strings. Re-initializing any fixture produces byte-for-byte identical state across repeated runs.
2. **Zero External Network Dependencies**: All simulated domains end with `.local` (e.g. `https://static.lab.local`). The in-process `LabTestServer` binds exclusively to `127.0.0.1`.
3. **Zero Production Credentials**: Synthetic mock authentication tokens and user capabilities are used. No secrets, API keys, or live credentials exist in lab fixtures.
4. **No Side-Effects on Task 1–11**: The lab is cleanly isolated in `backend/app/lab/` and acts strictly as a test fixture provider and ground-truth oracle for Task 12 validation.

---

## 7. End-to-End Pipeline Harness & Execution Trace (Step 2)

### 7.1 Architecture & The 13 Pipeline Stages

The `PipelineHarness` orchestrates existing Task 1–11 engines across 13 strictly ordered stages:

```
 1. DISCOVERY        (Seed discovery, robots.txt, sitemaps)
      ↓
 2. CRAWL_RENDER     (Dual-mode crawl & DOM render snapshot)
      ↓
 3. EXTRACTION       (DOM extraction, title, headings, canonicals, schema)
      ↓
 4. INTELLIGENCE     (Normalized UnifiedSignal generation)
      ↓
 5. SCORE            (Category & overall penalty calculation)
      ↓
 6. FINDING          (Finding & Opportunity generation)
      ↓
 7. FIX_PLAN         (Actionable remediation proposals)
      ↓
 8. CONNECTOR        (Site context & connector auth handshake)
      ↓
 9. SAFETY           (Safety tier & policy approval check)
      ↓
10. APPLY            (Dry-run preview or approved mutation)
      ↓
11. VALIDATE         (Pre-rescan sanity validation)
      ↓
12. RESCAN           (Targeted single-resource post-fix extraction)
      ↓
13. COMPARE          (Pre/post delta calculation & closed-loop proof)
```

### 7.2 Stage Dependency Matrix & Failure Propagation

Downstream stages define explicit upstream dependencies in `STAGE_DEPENDENCIES`:

| Stage | Sequence | Prerequisites | Failure Behavior |
|---|---|---|---|
| `DISCOVERY` | 1 | None | Root failure marks pipeline `FAILED` |
| `CRAWL_RENDER` | 2 | `DISCOVERY` | Failure blocks Stages 3–13 (`BLOCKED`, root cause `CRAWL_RENDER`) |
| `EXTRACTION` | 3 | `CRAWL_RENDER` | Failure blocks Stages 4–7, 9–13 |
| `INTELLIGENCE` | 4 | `EXTRACTION` | Failure blocks Stages 5–7, 9–13 |
| `SCORE` | 5 | `INTELLIGENCE` | Isolated failure marks `SCORE` FAILED; non-blocking to fix pipeline |
| `FINDING` | 6 | `INTELLIGENCE` | Failure blocks Stages 7, 9–13 |
| `FIX_PLAN` | 7 | `FINDING` | Failure blocks Stages 9–13 (`SAFETY`, `APPLY`, etc.) |
| `CONNECTOR` | 8 | None | Failure blocks Stage 9 (`SAFETY`) and Stage 10 (`APPLY`) |
| `SAFETY` | 9 | `FIX_PLAN`, `CONNECTOR` | Failure blocks Stages 10–13 (`APPLY`, `VALIDATE`, etc.) |
| `APPLY` | 10 | `SAFETY` | Failure blocks Stages 11–13 (`VALIDATE`, `RESCAN`, `COMPARE`) |
| `VALIDATE` | 11 | `APPLY` | Failure blocks Stage 13 (`COMPARE`) |
| `RESCAN` | 12 | `APPLY` | Failure blocks Stage 13 (`COMPARE`) |
| `COMPARE` | 13 | `RESCAN`, `EXTRACTION` | Final evaluation of fix verification delta |

### 7.3 ExecutionTrace & StageTrace Telemetry Schemas

- **`ExecutionTrace`**:
  - `execution_id`: Top-level unique run identifier (`exec_<hex16>`).
  - `site_url`, `site_id`, `fixture_id`, `environment`, `dry_run`.
  - `started_at`, `completed_at`, `duration_ms`.
  - `overall_status`: `RUNNING` | `SUCCEEDED` | `FAILED` | `PARTIAL`.
  - `stages`: List of 13 ordered `StageTrace` records.
  - `error_summary`: High-level summary of root failure if any.
- **`StageTrace`**:
  - `stage_execution_id`: Unique deterministic per-stage ID (`stage_<name>_<hex12>`).
  - `stage_name`: `PipelineStage` enum member.
  - `sequence`: Integer 1 to 13.
  - `status`: `PENDING` | `RUNNING` | `SUCCEEDED` | `FAILED` | `SKIPPED` | `BLOCKED`.
  - `started_at`, `completed_at`, `duration_ms`.
  - `input_ref`: Compact input references/summaries.
  - `output_ref`: Compact output telemetry.
  - `error_code`, `error_message` (strictly redacted for secrets).
  - `blocked_by_stage`: Name of upstream stage that triggered the block.

### 7.4 Safe Apply & Credential Redaction Defaults

1. **`dry_run=True` Default**: Safe preview mode prevents unintended production mutations. Live mutation requires explicit `allow_mutations=True` and approved safety tier (`SafetyTier.AUTO_SAFE`).
2. **Secret Redaction**: Any exception string or error output passes through `redact_secrets_from_string` to ensure tokens, passwords, GitHub PATs, and API keys are replaced with `[REDACTED]`.
3. **TraceRegistry**: Thread-safe in-memory singleton registry for recording, querying, and clearing historical execution traces.

### 7.5 Usage Example

```python
from app.lab import PipelineHarness, PipelineRunConfig, build_static_site_fixture

# Initialize harness and fixture
harness = PipelineHarness()
fixture = build_static_site_fixture()

# Run pipeline
trace = harness.run(
    PipelineRunConfig(
        site_url=fixture.base_url,
        fixture=fixture,
        dry_run=True,
    )
)

print(f"Run ID: {trace.execution_id} -> Status: {trace.overall_status}")
for st in trace.stages:
    print(f"[{st.sequence:02d}] {st.stage_name.value:15s} -> {st.status.value:10s} ({st.duration_ms}ms)")
```

---

## 8. Baseline & Before-After Evidence + Fix Effectiveness + Regression Guard + Delta Measurement (Step 3)

### 8.1 Deterministic Evidence Lifecycle

Step 3 closes the verification loop by establishing a deterministic, immutable measurement lifecycle:

```
BASELINE CAPTURE (BEFORE)
        ↓
    FIX APPLY
        ↓
    VALIDATE
        ↓
AFTER RESCAN CAPTURE (AFTER)
        ↓
EVIDENCE COMPARISON
        ↓
   ┌────────────────────────────────────────────────────────┐
   │                                                        │
   ▼                                                        ▼
FIX EFFECTIVENESS VERIFIER                          REGRESSION GUARD
(RESOLVED / NOT_RESOLVED / INCONCLUSIVE)           (KEEP / ROLLBACK / REVIEW)
   │                                                        │
   └────────────────────────┬───────────────────────────────┘
                            ▼
              SCORE & FINDING DELTA ENGINE
       (Exact category/overall point changes & transitions)
                            ▼
             CLOSED-LOOP MEASUREMENT REPORT
               (Full provenance & audit trail)
```

### 8.2 Evidence Data Model & Immutability

1. **`ResourceObservation`**:
   Normalized, lightweight capture of technical page attributes without duplicating massive crawler payloads:
   - `http_status_code`, `content_type`, `response_time_ms`, `content_hash`
   - `title`, `meta_description`, `h1_count`, `heading_count`, `heading_hierarchy_issue`
   - `canonical_url`, `is_self_canonical`, `canonical_conflict`
   - `is_indexable`, `robots_noindex`, `robots_nofollow`
   - `structured_data_count`, `structured_data_types`, `has_schema_parse_error`
   - `word_count`, `direct_answer_block_present`, `image_count`, `images_missing_alt`
   - `links_count`, `dead_links_count`

2. **`MeasurementSnapshot` (`frozen=True`)**:
   Immutable container pairing resource observations with intelligence state:
   - `evidence_id`: Unique snapshot identifier (`ev_<hex16>`)
   - `evidence_state`: `BEFORE` or `AFTER`
   - `execution_id`, `stage_execution_id`, `site_id`, `resource_id`, `url`, `captured_at`
   - `observation`: `ResourceObservation`
   - `total_score`, `category_scores`: Immutable snapshot of Task 8 scoring
   - `findings`: List of active finding summaries (`finding_id`, `rule_id`, `severity`, `title`)
   - `fix_plan_id`: Linked remediation plan if applicable

3. **`EvidenceStore`**:
   Thread-safe, append-only repository. Attempting to overwrite an existing `evidence_id` raises `ValueError`, enforcing strict immutability.

### 8.3 Fix Effectiveness Verification Policies

The `FixEffectivenessVerifier` deterministically checks whether expected evidence changes occurred and whether target findings were resolved:

| Fix Category | Verification Policy Rules | Success Criteria |
|---|---|---|
| **Canonical** | `CANONICAL_*`, `WP_CANONICAL_*` | Valid canonical tag present, target matches expected URL, canonical conflict flag cleared |
| **Title / Meta** | `TITLE_*`, `META_DESC_*`, `WP_YOAST_*` | Document title or meta description matches target value / length bounds |
| **Robots / Indexability** | `ROBOTS_*`, `INDEXABILITY_*` | `robots_noindex` is `False`, `is_indexable` is `True` |
| **Structured Data** | `SCHEMA_*`, `STRUCTURED_DATA_*` | Required schema type present in `structured_data_types`, `has_schema_parse_error` is `False` |
| **Headings** | `R-STR-*`, `HEADING_*` | `h1_count == 1`, `heading_hierarchy_issue == False` |
| **Accessibility & Links** | `IMAGE_ALT_*`, `HTTP_404_*` | `images_missing_alt == 0`, `dead_links_count == 0` |
| **Content / AEO / GEO** | `R-QNA-*`, `CLIENT_SIDE_*` | `direct_answer_block_present == True`, `word_count > 0` |

#### Determination Outcomes:
- **`RESOLVED`**: All required evidence checks passed AND the specific finding is no longer active in the AFTER snapshot.
- **`NOT_RESOLVED`**: Expected evidence was not observed OR the finding remains active.
- **`INCONCLUSIVE`**: BEFORE or AFTER evidence is missing, stale, or incomplete. (Never converted to `RESOLVED`).
- **Partial Outcomes**: If some checks pass but others fail, the result is `NOT_RESOLVED` with explicit itemized passed, failed, and unavailable checks.

### 8.4 Deterministic Regression Guard

The `RegressionGuard` evaluates target resource health and adjacent safety signals between BEFORE and AFTER states:

| Check Target | Trigger Condition | Severity | Decision Impact |
|---|---|---|---|
| **HTTP Status** | Status was 200/301, becomes 4xx/5xx | Critical | `ROLLBACK` |
| **Indexability** | Page was indexable (`noindex=False`), becomes `noindex=True` | Critical | `ROLLBACK` |
| **Canonical** | Canonical is completely removed or corrupted | High | `ROLLBACK` |
| **Content Loss** | Word count drops by more than 50% | High | `ROLLBACK` |
| **Structured Data** | Schema parse error introduced | Medium | `REVIEW` |
| **Headings** | H1 removed (`h1_count` becomes 0) | Medium | `REVIEW` |
| **New Critical Finding** | A new `CRITICAL` finding appears in AFTER | Critical | `ROLLBACK` |
| **New High Finding** | A new `HIGH` finding appears in AFTER | Medium | `REVIEW` |

#### Regression Guard Decisions:
- **`KEEP`**: Fix succeeded with no critical or high severity regressions detected.
- **`ROLLBACK`**: A critical regression was introduced (e.g. 500 error, accidental noindex, severe content destruction).
- **`REVIEW`**: Ambiguous signals, missing baseline, or non-critical regressions requiring human inspection.

### 8.5 Deterministic Score & Finding Deltas

1. **Score Delta Engine (`ScoreDeltaReport`)**:
   - Reuses existing Task 8 scoring calculations.
   - Calculates exact integer/floating-point point differences across all 6 categories (`seo_technical`, `content_quality`, `aeo_readiness`, `geo_readiness`, `schema_structure`, `security_performance`) and overall score.
   - **Mandatory Score Disclaimer**:
     > *"Score improvement represents a change in Raval's deterministic measurement model and is NOT proof of external search ranking, traffic, conversion, citation, or AI visibility improvement."*

2. **Finding Delta Engine (`FindingDeltaReport`)**:
   Tracks deterministic transitions for all findings:
   - `OPEN_TO_RESOLVED`: Finding existed in BEFORE, confirmed resolved in AFTER.
   - `OPEN_TO_STILL_OPEN`: Finding existed in BEFORE and remains active in AFTER.
   - `OPEN_TO_INCONCLUSIVE`: Insufficient evidence to verify finding status.
   - `NEW_REGRESSION`: Finding was NOT present in BEFORE, newly introduced in AFTER.

### 8.6 Full Provenance & Audit Trail

Every measurement decision is fully traceable back to its root components:
```
resource_id / url
  → BEFORE ResourceObservation (captured_at, hash)
  → Applied FixPlan (plan_id, rule_id, patch)
  → StageExecution (exec_id, stage_execution_id)
  → AFTER ResourceObservation (captured_at, hash)
  → Rule Re-evaluation
  → FixVerificationResult (passed/failed check lists)
  → RegressionGuardReport (decision: KEEP/ROLLBACK/REVIEW)
  → ScoreDeltaReport & FindingDeltaReport
```

### 8.7 Stale / Missing Evidence & Security Controls

1. **Missing Evidence Safety**:
   - Missing BEFORE or AFTER snapshot immediately yields `VerificationOutcome.INCONCLUSIVE` and `RegressionDecision.REVIEW`.
   - Stale resources (where URL or content hash differs unexpectedly) are flagged with warnings and marked for `REVIEW`.
   - No default zeroes or fabricated values are ever inserted.

2. **Security & Redaction**:
   - All URLs, finding details, and measurement summaries are sanitized against credentials, API tokens, cookies, and bearer authorization headers.
   - Workspace isolation is strictly preserved through `site_id` boundaries.

---

## 9. Task 12 Step 4 — Targeted Rescan Policy & Change-Impact Model

### 9.1 Purpose & Architectural Overview

In closed-loop post-fix verification, rescanning entire websites after every minor modification is inefficient and unnecessary. However, under-scanning can overlook critical side effects (e.g. broken links, canonical mismatches, template regressions).

**Task 12 Step 4** implements a deterministic, explainable **Change-Impact Model** and **Targeted Rescan Policy** that guarantees:
1. **Smallest Safe Scope**: Rescans only the directly mutated page and deterministically affected dependencies.
2. **Safety First**: If dependency data is stale, missing, or unbounded, the system safely escalates to `FULL_RESCAN`.
3. **Explainability**: Every rescanned resource carries an auditable `ImpactReason`.
4. **Zero Duplication**: Reuses existing Task 11 `TargetedRescanner`, `PageFetcher`, `PageExtractor`, and execution trace linkages (`execution_id`, `stage_execution_id`, `rescan_id`).

```
Applied Fix Plan (Target, Category, Rules)
  ↓
Change Impact Model (Classification: ChangeType)
  ↓
Dependency Graph (LINKS_TO, CANONICAL_TO, IN_SITEMAP, SHARES_ENTITY, etc.)
  ↓
Rescan Policy Engine (Freshness, Safety Bounds, Staleness Detection)
  ↓
Rescan Scope Decision (TARGETED_RESCAN / RELATED_RESCAN / FULL_RESCAN)
  ↓
Targeted Rescan Service (Thread-Safe, Idempotent, Crawler/Fetcher Reuse)
  ↓
AFTER Snapshots & Pipeline Trace Stage 12 Output
```

---

### 9.2 Rescan Scope Levels

| Scope Level | When Used | Example Triggers | Rescanned Targets |
|---|---|---|---|
| **`TARGETED_RESCAN`** | Localized single-page changes where dependencies are unaffected | Title, Meta Description, H1/H2, Schema.org JSON-LD, Image Alt Text | Exactly the directly changed resource(s) (`depth=0`) |
| **`RELATED_RESCAN`** | Relational changes affecting a deterministically bounded set of related pages | Internal link additions/removals, canonical updates, sitemap inclusion, entity updates | Directly changed resource + 1st-degree connected dependency nodes |
| **`FULL_RESCAN`** | Global/template changes, stale or missing dependency graphs, unbounded sets | Header/Footer/Nav template change, robots.txt, graph age > max age, unknown change type | All known site resources |

---

### 9.3 Change Classification & Dependency Mapping

| Change Type (`ChangeType`) | Scope Selected | Dependency Types Evaluated | Impact Reason |
|---|---|---|---|
| `PAGE_METADATA` | `TARGETED_RESCAN` | None (isolated to target) | `DIRECTLY_CHANGED` |
| `HEADINGS` | `TARGETED_RESCAN` | None (isolated to target) | `DIRECTLY_CHANGED` |
| `STRUCTURED_DATA` | `TARGETED_RESCAN` | None (isolated to target) | `DIRECTLY_CHANGED` |
| `ACCESSIBILITY` | `TARGETED_RESCAN` | None (isolated to target) | `DIRECTLY_CHANGED` |
| `INTERNAL_LINKS` | `RELATED_RESCAN` | `LINKS_TO`, `LINKED_FROM`, `REDIRECTS_TO` | `INTERNAL_LINK_DEPENDENCY` |
| `CANONICAL` | `RELATED_RESCAN` | `CANONICAL_TO`, `CANONICAL_FROM` | `CANONICAL_DEPENDENCY` |
| `SITEMAP` | `RELATED_RESCAN` | `IN_SITEMAP` | `SITEMAP_DEPENDENCY` |
| `ENTITY` | `RELATED_RESCAN` | `SHARES_ENTITY` | `ENTITY_DEPENDENCY` |
| `CONTENT_TOPIC` | `RELATED_RESCAN` | `SHARES_TOPIC` | `CONTENT_DEPENDENCY` |
| `TEMPLATE_SHARED` | `FULL_RESCAN` | `USES_TEMPLATE` | `TEMPLATE_DEPENDENCY` |
| `SITE_WIDE_GLOBAL` | `FULL_RESCAN` | All site nodes | `GLOBAL_CHANGE` |
| `UNKNOWN` | `FULL_RESCAN` | Fallback escalation | `UNKNOWN_DEPENDENCY_FALLBACK` |

---

### 9.4 Full Rescan Safety Escalation Rules

The policy engine enforces strict safety rules where efficiency is **never** prioritized over correctness:
1. **Missing or Invalid Graph**: If `graph is None` or `graph.is_valid == False`, automatically escalates to `FULL_RESCAN` with `is_escalated_to_full=True` and reason `MISSING_GRAPH_FALLBACK`.
2. **Stale Graph**: If `graph.is_stale(max_age_seconds)` (age > threshold, default 3600s), automatically escalates to `FULL_RESCAN` with `STALE_DEPENDENCY_FALLBACK`.
3. **Unbounded Dependency Set**: If the number of related resources exceeds `max_related_resources` (default 20), automatically escalates to `FULL_RESCAN` with `UNBOUNDED_DEPENDENCY_SET`.
4. **Unknown Change Type**: If change type is unclassified or unrecognized, escalates to `FULL_RESCAN` with `UNKNOWN_DEPENDENCY_FALLBACK`.

---

### 9.5 Idempotency, Concurrency & Security

- **Idempotency**: Requests with matching `idempotency_key` return the previously evaluated decision and cached rescan results (`is_cached=True`), preventing redundant network fetches.
- **Concurrency**: Thread-safe execution using re-entrant locks (`threading.RLock`) in `TargetedRescanService`, guaranteeing safe parallel requests without state corruption.
- **Workspace Isolation**: Multi-tenant isolation verified by cross-referencing `workspace_id`. Cross-workspace requests are rejected with explicit isolation violation errors.
- **SSRF & URL Safety**: All resource targets are validated against forbidden URL schemes (`javascript:`, `file:`, `data:`) and cross-host mismatches.

---

### 9.6 Concrete Examples

#### Example 1: Local Title Tag Fix
```python
request = TargetedRescanRequest(
    execution_id="exec_101",
    site_url="https://example.com",
    changed_resources=["/about.html"],
    change_type=ChangeType.PAGE_METADATA,
    changed_fields=["title"],
)
decision = RescanPolicyEngine.decide_scope(request, graph)
# Output:
# scope: TARGETED_RESCAN
# selected_resources:
#   - /about.html (reason: DIRECTLY_CHANGED, depth: 0)
```

#### Example 2: Internal Navigation Link Addition
```python
request = TargetedRescanRequest(
    execution_id="exec_102",
    site_url="https://example.com",
    changed_resources=["/about.html"],
    change_type=ChangeType.INTERNAL_LINKS,
)
decision = RescanPolicyEngine.decide_scope(request, graph)
# Output:
# scope: RELATED_RESCAN
# selected_resources:
#   - /about.html (reason: DIRECTLY_CHANGED, depth: 0)
#   - /services.html (reason: INTERNAL_LINK_DEPENDENCY, depth: 1)
#   - /docs.html (reason: INTERNAL_LINK_DEPENDENCY, depth: 1)
```

#### Example 3: Stale Graph Escalation
```python
request = TargetedRescanRequest(
    execution_id="exec_103",
    site_url="https://example.com",
    changed_resources=["/faq.html"],
    change_type=ChangeType.PAGE_METADATA,
    max_graph_age_seconds=60.0,  # Graph is 3600s old
)
decision = RescanPolicyEngine.decide_scope(request, graph)
# Output:
# scope: FULL_RESCAN
# is_escalated_to_full: True
# escalation_reason: STALE_DEPENDENCY_FALLBACK
# selected_resources: all known site pages
```

---

## 10. Experiment Framework, Metrics, Failure Recovery & Production Readiness (Step 5)

### 10.1 Closed-Loop Architecture

Step 5 closes the loop on automated SEO/AEO optimization by introducing the **Experiment Framework, 5-Dimension Deterministic Metrics Engine, Failure/Recovery Matrix, and Production Readiness Pre-Flight Guards**:

```
SITE → BASELINE → CHANGE → VALIDATE → RESCAN → COMPARE → EXPERIMENT RESULT → METRICS → DECISION → MONITOR
```

Every remediation action is treated as a formal experiment with an explicit, testable hypothesis and deterministic evaluation criteria.

---

### 10.2 Hypothesis & Experiment Contracts

#### Hypothesis Contract (`Hypothesis`)
- **`expected_outcome`**: Human- and machine-readable description of intended remediation.
- **`target_finding_ids`** / **`target_rule_ids`**: Specific finding/rule identifiers expected to be resolved.
- **`expected_score_min_delta`**: Minimum expected score improvement (e.g. `+5.0`).
- **`max_allowed_regression_delta`**: Maximum tolerated score drop (default `0.0`).
- **`confidence_level`**: Explicit confidence boundary (`OBSERVED`, `INFERRED`, `NOT_MEASURED`).

#### Deterministic Hypothesis Results (`HypothesisResult`)
1. **`CONFIRMED`**: All targeted findings verified resolved, no blocking regressions introduced, and score delta met or exceeded expectation.
2. **`NOT_CONFIRMED`**: Target finding unverified, or score improvement fell short, or blocking regression introduced.
3. **`INCONCLUSIVE`**: Evidence missing, snapshot capture failed, or verification outcome indeterminate.
4. **`INVALID`**: Pre-flight checks failed, security violation occurred, or experiment contract was misconfigured.

---

### 10.3 5-Dimension Deterministic Metrics Engine

The metrics engine calculates 5 deterministic dimensions without LLM hallucination:

1. **Fix Effectiveness Metrics** (`FixEffectivenessMetrics`):
   - Intended target findings count vs verified count.
   - Verification and resolution rates ($0.0 - 1.0$).
   - Breakdown of resolved, partial, unverified, still open, and inconclusive findings.
2. **Regression Metrics** (`RegressionMetrics`):
   - Total detected regressions count.
   - Critical vs warning regressions breakdown.
   - Blocking regressions flag and `RegressionDecision` (`KEEP`, `ROLLBACK`, `REVIEW`).
3. **Score Delta Metrics** (`ScoreMetrics`):
   - Before baseline score vs after rescan score.
   - Overall net delta and per-category score breakdowns.
   - Mandatory measurement disclaimer attached to all outputs.
4. **Evidence Metrics** (`EvidenceMetrics`):
   - Total observations captured vs verified.
   - Evidence items completeness ratio ($0.0 - 1.0$) and changed evidence count.
   - Explicit confidence boundaries (`OBSERVED` vs `INFERRED` vs `NOT_MEASURED`).
5. **Operational Metrics** (`OperationalMetrics`):
   - Apply, validate, rescan, and total execution duration in milliseconds.
   - Rescan efficiency savings percentage ($\frac{\text{site pages} - \text{rescanned pages}}{\text{site pages}} \times 100\%$).
   - Bounded retry, recovery, and rollback counters.

---

### 10.4 Deterministic Decision Policies

| Hypothesis Result | Regressions | Verification Outcome | Actionable Decision | Action Taken |
|---|---|---|---|---|
| `CONFIRMED` | Zero Blocking | All Targets Verified | `KEEP` | Maintain changes; record positive evidence. |
| `NOT_CONFIRMED` | Blocking Detected | Any Target | `ROLLBACK` | Automated safe rollback triggered immediately. |
| `INCONCLUSIVE` | Any / Ambiguous | Ambiguous State | `ROLLBACK` / `REVIEW` | Ambiguous mutation halts and escalates for review. |
| `NOT_CONFIRMED` | No Critical Regressions | Unverified / Partial | `REVIEW` | Flag for human SEO specialist review. |
| `INVALID` | Pre-Flight Failure | Unexecuted | `NO_CHANGE` | Execution aborted prior to mutation. |

---

### 10.5 Failure & Recovery Matrix

| Failure Classification | Sample Trigger Scenario | Is Retryable? | Recovery Action | Max Retries | Escalates to Full Rescan? |
|---|---|---|---|---|---|
| `TRANSIENT_NETWORK` | HTTP connection read timeout during crawl | Yes | `RETRY_STAGE` | 2 | No |
| `RATE_LIMIT` | HTTP 429 Too Many Requests | Yes | `BACKOFF_AND_RETRY` | 2 | No |
| `AUTHENTICATION_EXPIRED` | Connector session token expired | No | `FAIL_AND_ALERT` | 0 | No |
| `STALE_DEPENDENCY_GRAPH` | Graph hash mismatch in rescan stage | No | `FULL_RESCAN` | 0 | Yes |
| `AMBIGUOUS_MUTATION_STATE`| Socket closed during connector write | No | `HALT_AND_VERIFY_STATE` | 0 | No (Safety Halt) |
| `SECURITY_VIOLATION` | SSRF attempt or forbidden path | No | `REJECT_AND_AUDIT` | 0 | No (Hard Abort) |
| `PERMANENT_UNRECOVERABLE` | Invalid payload schema / 404 target | No | `FAIL_AND_ALERT` | 0 | No |

---

### 10.6 5 Pillars of Production Readiness Pre-Flight Guards

Prior to executing mutations, `ProductionReadinessGuard` enforces 5 strict pillars:
1. **Tenant & Workspace Isolation**: Validates workspace ID format and rejects directory traversal attempts.
2. **SSRF & Security Isolation**: Rejects internal/private IP ranges (`127.0.0.1`, `10.0.0.0/8`, `169.254.169.254`, `192.168.0.0/16`) for non-lab target domains.
3. **Reliability & Concurrency**: Acquires distributed resource locks via `ResourceLockManager` to prevent simultaneous mutation collisions.
4. **Execution Safety & Connector Health**: Validates dry-run flags and connector authorization readiness.
5. **Observability & Traceability**: Verifies structured execution ID generation and telemetry hooks.

---

### 10.7 FastAPI REST API Endpoints

- `POST /api/lab/experiments/create`: Creates and validates an experiment contract.
- `POST /api/lab/experiments/run`: Executes the end-to-end closed loop with pre-flight checks, harness execution, metrics calculation, and decision evaluation.
- `GET /api/lab/experiments/{experiment_id}`: Retrieves experiment definition and current status.
- `GET /api/lab/experiments/{experiment_id}/metrics`: Retrieves calculated 5-dimension metrics, decision, and evidence audit trail.
- `POST /api/lab/production-readiness/check`: Standalone pre-flight evaluation across all 5 production readiness pillars.

