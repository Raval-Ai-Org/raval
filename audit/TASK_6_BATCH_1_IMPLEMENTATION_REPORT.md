# Task 6 Batch 1 Implementation Report

**Implementation Date**: August 27, 2026  
**Implemented Tasks**: Task 6.1 (Opportunity Engine) & Task 6.2 (Opportunity Prioritization)  
**Repository Root**: `C:\Users\HP\Documents\raval-geo-intelligence`  
**Git Branch**: `main`  
**Runtime**: Python 3.14.7  

---

## 1. Scope
This implementation strictly covers **Task 6 Batch 1**:
- **Task 6.1 — Opportunity Engine**: Conversion of findings, recommendations, and intelligence signals into persistent, actionable, and traceable Opportunity records.
- **Task 6.2 — Opportunity Prioritization**: Deterministic, bounded, and explainable prioritization scoring, threshold-based classification (`CRITICAL`, `HIGH`, `MEDIUM`, `LOW`), and human-readable rationale generation.

> [!IMPORTANT]
> **Scope Protection**: Task 6.3+ (Fix Engine, code generation, CMS/Git connectors, validation engine, monitoring, and live LLM benchmark execution) was **NOT** implemented. Those components remain documented future work.

---

## 2. Files Changed

| File Path | Action | Description & Rationale |
|---|---|---|
| `backend/app/models.py` | **Modified** | Added `Opportunity` SQLAlchemy model; established bidirectional relationships on `Website`, `Scan`, `PageResult`, `Finding`, and `Recommendation`. |
| `backend/app/schemas.py` | **Modified** | Added Pydantic v2 schemas: `OpportunityCreate`, `OpportunityUpdate`, `OpportunityResponse`, and `OpportunityBatchGenerateResponse`. |
| `backend/app/opportunity_prioritization.py` | **Created** | Implemented Task 6.2 prioritization engine: deterministic scoring formula, priority level thresholds, input mapping helpers, and explainable rationale generation. |
| `backend/app/opportunity_service.py` | **Created** | Implemented Task 6.1 Opportunity service: finding/recommendation detection, batch scan/website generation, idempotency/deduplication, and full CRUD. |
| `backend/app/services.py` | **Modified** | Re-exported Opportunity service functions and constants for seamless packaging and service-layer cohesion. |
| `backend/app/main.py` | **Modified** | Registered 12 dedicated REST API endpoints for Opportunity CRUD, filtering, relationships, and batch generation. |
| `opportunity-engine/__init__.py` | **Created** | Package façade re-exporting engine and prioritization functions from `backend.app` to match repository packaging conventions. |
| `backend/tests/test_opportunity_model.py` | **Created** | Test suite verifying `Opportunity` model creation, persistence, relationships, foreign keys, and cascade deletion (3 tests). |
| `backend/tests/test_opportunity_prioritization.py` | **Created** | Test suite verifying deterministic formula, boundaries $[0.0, 1.0]$, thresholds, monotonicity, reproducibility, and rationales (7 tests). |
| `backend/tests/test_opportunity_engine.py` | **Created** | Test suite verifying finding/recommendation conversion, idempotency, batch generation, and CRUD operations (7 tests). |
| `backend/tests/test_opportunity_api.py` | **Created** | Test suite verifying REST endpoints, query parameter filtering, relationship endpoints, batch triggers, and HTTP status codes (7 tests). |
| `docs/OPPORTUNITY_ENGINE.md` | **Created** | Comprehensive technical specification of Opportunity Engine architecture, data model, formulas, thresholds, and APIs. |
| `docs/ARCHITECTURE.md` | **Modified** | Updated Section 17 (Opportunity Engine) with implementation status, prioritization formula, and link to `docs/OPPORTUNITY_ENGINE.md`. |
| `audit/TASK_6_BATCH_1_IMPLEMENTATION_REPORT.md` | **Created** | This final implementation and audit verification report. |

---

## 3. Database Changes

### New Table: `opportunities`
- **Table Name**: `opportunities`
- **ORM Class**: `Opportunity` in `backend/app/models.py`
- **Columns**:
  - `id` (`Integer`, Primary Key, Autoincrement)
  - `website_id` (`Integer`, ForeignKey `websites.id`, Not Null, Indexed)
  - `scan_id` (`Integer`, ForeignKey `scans.id`, Nullable, Indexed)
  - `page_id` (`Integer`, ForeignKey `page_results.id`, Nullable, Indexed)
  - `finding_id` (`Integer`, ForeignKey `findings.id`, Nullable, Indexed)
  - `recommendation_id` (`Integer`, ForeignKey `recommendations.id`, Nullable, Indexed)
  - `title` (`String(255)`, Not Null)
  - `description` (`Text`, Not Null)
  - `opportunity_type` (`String(100)`, Not Null, Indexed)
  - `category` (`String(100)`, Not Null, Default `"seo"`, Indexed)
  - `status` (`String(50)`, Not Null, Default `"identified"`, Indexed)
  - `impact` (`Float`, Not Null, Default `0.5`)
  - `effort` (`Float`, Not Null, Default `0.5`)
  - `confidence` (`Float`, Not Null, Default `0.8`)
  - `priority_score` (`Float`, Not Null, Default `0.5`, Indexed)
  - `priority` (`String(20)`, Not Null, Default `"MEDIUM"`, Indexed)
  - `rationale` (`Text`, Not Null)
  - `evidence` (`JSON`, Nullable)
  - `created_at` (`DateTime`, Not Null, Default UTC)
  - `updated_at` (`DateTime`, Not Null, Default UTC, onupdate UTC)

### Relationships & Foreign Keys
- `Opportunity.website_id` $\to$ `websites.id` (`cascade="all, delete-orphan"` on `Website.opportunities`)
- `Opportunity.scan_id` $\to$ `scans.id` (`cascade="all, delete-orphan"` on `Scan.opportunities`)
- `Opportunity.page_id` $\to$ `page_results.id` (`cascade="all, delete-orphan"` on `PageResult.opportunities`)
- `Opportunity.finding_id` $\to$ `findings.id` (`cascade="all, delete-orphan"` on `Finding.opportunities`)
- `Opportunity.recommendation_id` $\to$ `recommendations.id` (`cascade="all, delete-orphan"` on `Recommendation.opportunities`)

### Initialization
- Table auto-created via `Base.metadata.create_all(bind=engine)` during FastAPI application startup in `backend/app/main.py`.

---

## 4. API Changes

All new endpoints follow the repository's `/api/v1` prefix and standard FastAPI error handling:

| # | Method | Path | Purpose | Request Body | Response Model |
|---|---|---|---|---|---|
| 1 | `POST` | `/api/v1/opportunities` | Manually create an opportunity | `OpportunityCreate` | `OpportunityResponse` |
| 2 | `GET` | `/api/v1/opportunities/{id}` | Retrieve opportunity details | None | `OpportunityResponse` |
| 3 | `PATCH` | `/api/v1/opportunities/{id}` | Update opportunity fields (status, impact, priority, etc.) | `OpportunityUpdate` | `OpportunityResponse` |
| 4 | `DELETE`| `/api/v1/opportunities/{id}` | Delete an opportunity record | None | `{"status": "success", "deleted_id": int}` |
| 5 | `GET` | `/api/v1/opportunities` | List all opportunities with query filters (`website_id`, `scan_id`, `category`, `status`, `priority`, `opportunity_type`) | Query Params | `list[OpportunityResponse]` |
| 6 | `GET` | `/api/v1/websites/{id}/opportunities` | List opportunities scoped to a website | Query Params | `list[OpportunityResponse]` |
| 7 | `GET` | `/api/v1/scans/{id}/opportunities` | List opportunities scoped to a scan | Query Params | `list[OpportunityResponse]` |
| 8 | `GET` | `/api/v1/findings/{id}/opportunities` | List opportunities for a specific finding | None | `list[OpportunityResponse]` |
| 9 | `POST` | `/api/v1/findings/{id}/generate-opportunities` | Trigger Opportunity Engine for a finding | Optional query `recommendation_id` | `OpportunityResponse` |
| 10| `POST` | `/api/v1/recommendations/{id}/generate-opportunities` | Trigger Opportunity Engine for a recommendation | None | `OpportunityResponse` |
| 11| `POST` | `/api/v1/scans/{id}/generate-opportunities` | Batch generate opportunities for all findings in a scan | None | `OpportunityBatchGenerateResponse` |
| 12| `POST` | `/api/v1/websites/{id}/generate-opportunities` | Batch generate opportunities across all findings for a website | None | `OpportunityBatchGenerateResponse` |

---

## 5. Opportunity Engine (Task 6.1)

### Generation Logic & Source Relationships
The engine inspects input findings and recommendations, mapping them into standardized, high-ROI opportunities:
- **Finding Type Mapping**: Maps specific findings (e.g. `missing_faq_schema`, `heading_hierarchy_issue`, `unanswered_question`, `missing_title`, `entity_missing_authority_links`) to actionable opportunity profiles.
- **Traceability**: Every opportunity explicitly links to its source `finding_id` and optional `recommendation_id`, preserving full provenance back through `PageResult` and `Scan` to the originating `Website`.
- **Supported Categories**:
  - `technical_seo`
  - `content`
  - `aeo`
  - `geo`
  - `entity`
  - `structured_data`
  - `internal_linking`
  - `quality`
  - `discoverability`
  - `citation`
  - `seo`

### Idempotency & Duplicate Prevention
To prevent redundant rows during repeated crawl/intelligence runs:
- The engine queries `Opportunity` for an existing record matching `(finding_id, opportunity_type)`.
- If an existing record exists, it updates the metrics, priority score, and rationale with latest data in place, avoiding duplicates.
- Verified in automated test `test_opportunity_engine.py::test_generate_opportunity_idempotency`.

### Lifecycle
Managed via standard status transitions:
`identified` $\to$ `in_progress` $\to$ `implemented` / `dismissed` / `archived`.

---

## 6. Prioritization Engine (Task 6.2)

### Inputs
1. **Impact ($I \in [0.0, 1.0]$)**: Normalized from finding severity:
   - `critical`: 1.00
   - `high`: 0.80
   - `medium`: 0.50
   - `low`: 0.25
   - `info`: 0.10
2. **Confidence ($C \in [0.0, 1.0]$)**: Normalized based on empirical evidence presence:
   - Evidence collection $\ge 3$ items: 0.95
   - Evidence collection $\ge 1$ item: 0.85
   - Heuristic/fallback: 0.70
3. **Effort ($E \in [0.0, 1.0]$)**: Estimated implementation complexity:
   - Metadata / title tags / alt text: 0.25 (High ease)
   - Structured data / FAQPage JSON-LD: 0.30
   - Heading structure / outlines: 0.35
   - Entity sameAs / authority links: 0.45
   - Content gap writing / direct answers: 0.55
   - Comprehensive architecture overhaul: 0.75

### Prioritization Formula
$$\text{PriorityScore} = (0.50 \times I) + (0.25 \times C) + (0.25 \times (1.0 - E))$$

- **Mathematical Bounds**: Strictly bounded to $[0.0, 1.0]$.
- **Monotonicity**: Verified in `test_prioritization_monotonicity`. Higher impact/confidence increases score; lower effort increases score.
- **Determinism**: 100% reproducible; zero external LLM or random variables.

### Priority Level Thresholds
- **`CRITICAL`**: $\text{Score} \ge 0.80$
- **`HIGH`**: $0.60 \le \text{Score} < 0.80$
- **`MEDIUM`**: $0.40 \le \text{Score} < 0.60$
- **`LOW`**: $\text{Score} < 0.40$

### Explainable Rationale
Constructed deterministically:
> `"{Priority} priority (score: {score:.2f}) because impact is {imp_desc} ({imp:.2f}), confidence is {conf_desc} ({conf:.2f}), and estimated effort is {eff_desc} ({eff:.2f})."`

---

## 7. Security

- **Authentication & Authorization**: Maintained consistency with existing repository standards (`db: Session = Depends(get_db)`). Zero bypasses introduced.
- **Multi-Tenant Scoping**: All opportunity operations validate foreign key ownership: an opportunity cannot be created with a `scan_id` or `finding_id` belonging to another `website_id` (enforced via database queries raising HTTP 400).
- **SQL Injection Prevention**: 100% parameterized SQLAlchemy ORM queries; zero raw SQL string concatenation.
- **Input Validation**: Pydantic v2 schemas enforce types, string lengths, and numeric bounds on all endpoints.

---

## 8. Tests

### Test Execution Summary
- **Command**: `python -m pytest -v`
- **Execution Time**: **49.06 seconds**
- **Test Suite Results**:
  - **Task 6 Tests Collected**: **24**
  - **Task 6 Tests Passed**: **24** (100%)
  - **Task 6 Tests Failed**: **0**
  - **Full Suite Collected**: **383**
  - **Full Suite Passed**: **383** (100%)
  - **Full Suite Failed**: **0**
  - **Skipped**: **0**
  - **Errors**: **0**
  - **Warnings**: 788 (primarily Python 3.14 `datetime.utcnow` deprecations)

### Comparison Against Baseline
- **Previous Baseline (Tasks 1–5)**: 359 passed, 0 failed, 0 skipped.
- **Current Baseline (Tasks 1–6.2)**: **383 passed (+24 new tests)**, 0 failed, 0 skipped.

### New Test Suite Breakdown
1. `backend/tests/test_opportunity_model.py` (3 tests): Model creation, ORM relationships, and cascade deletions.
2. `backend/tests/test_opportunity_prioritization.py` (7 tests): Scoring formula, boundary clamping $[0.0, 1.0]$, thresholds, monotonicity, determinism, rationales, and helper mappings.
3. `backend/tests/test_opportunity_engine.py` (7 tests): Finding-to-opportunity generation, recommendation-to-opportunity generation, idempotency deduplication, scan/website batch generation, and CRUD operations.
4. `backend/tests/test_opportunity_api.py` (7 tests): REST API endpoints, validation errors, ID lookup, update recomputation, deletion, query filters, and batch generate triggers.

---

## 9. Regression Check

Tasks 1 through 5 were fully verified without any regressions:
- **Task 1**: Architecture and data model specifications intact.
- **Task 2**: Core backend flows and scan lifecycle states pass (`test_core_flow.py`).
- **Task 3**: Crawler package, sitemaps, robots.txt, and scan execution pipeline pass (`tests/test_crawler*.py`, `test_scan_run.py`, `test_sitemap.py`).
- **Task 4**: 13-domain page extraction engine and API pass (`test_page_extractor.py`, `test_page_extraction_api.py`, `test_real_site_verification.py`).
- **Task 5**: 11 Content Intelligence analytical engines, synthesis, and quality checks pass (`test_content_*.py`, `test_task5_final_audit.py`).
- **Foundation Entities**: Findings, Recommendations, Entities, Question Sets, and AI Runs pass (`test_findings.py`, `test_recommendations.py`, `test_entities.py`, `test_ai_runs.py`).

---

## 10. Documentation Updates

1. **`docs/OPPORTUNITY_ENGINE.md`**: Created complete 10-section architectural guide covering engine purpose, data model, lifecycle, mathematical formula, thresholds, rationales, idempotency, and API endpoints.
2. **`docs/ARCHITECTURE.md`**: Updated Section 17 with Task 6 implementation status, prioritization formula, and link to `docs/OPPORTUNITY_ENGINE.md`.

---

## 11. Known Issues & Limitations

1. **Python 3.14 Datetime Deprecation Warnings**:
   SQLAlchemy column defaults and timestamp updates emit deprecation warnings for `datetime.utcnow()`. These are non-blocking warnings that do not affect correctness.
2. **Task 6.3+ Downstream Modules**:
   Automated code fix generation, CMS integration, and validation re-crawling are planned for future tasks and not implemented in Batch 1.

---

## 12. Scope Protection Confirmation

It is explicitly confirmed that:
- **Task 6.1 (Opportunity Engine)**: Genuinely implemented and verified.
- **Task 6.2 (Opportunity Prioritization)**: Genuinely implemented and verified.
- **Task 6.3+ (Fix Engine, Validation Engine, Monitoring, Live LLM Execution)**: **NOT implemented**.
