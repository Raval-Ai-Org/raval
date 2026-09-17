# Raval GEO Intelligence — Fix / Action Planning Foundation (Task 6.4)

## 1. Foundation Purpose & Safety Boundary
The Fix / Action Planning Foundation converts recommendations into structured, inspectable, and reviewable fix plans.

> [!IMPORTANT]
> **Safety Boundary**: The planning foundation does **NOT** automatically mutate websites, call external CMS APIs, commit to GitHub repositories, or trigger code deployment.
> All fix plans are proposals that must pass through an explicit human review and approval lifecycle before any downstream execution occurs.

```text
Recommendation (6.3 Action Directive)
              ↓
  Fix Planning Engine (6.4 Deterministic Mapping)
              ↓
Structured Fix Plan (Diff Proposals, Risk Ratings, Checklist)
              ↓
Review Lifecycle (draft → ready_for_review → approved → completed)
```

---

## 2. Fix Plan Data Model

The `FixPlan` model (`backend/app/models.py`) provides full relational tracking:

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `Integer` | Primary Key | Unique plan ID |
| `recommendation_id` | `Integer` | Foreign Key `recommendations.id`, Not Null, Indexed | Parent recommendation |
| `finding_id` | `Integer` | Foreign Key `findings.id`, Nullable, Indexed | Originating finding |
| `opportunity_id` | `Integer` | Foreign Key `opportunities.id`, Nullable, Indexed | Originating opportunity |
| `website_id` | `Integer` | Foreign Key `websites.id`, Not Null, Indexed | Scoped website |
| `scan_id` | `Integer` | Foreign Key `scans.id`, Nullable, Indexed | Originating scan execution |
| `page_id` | `Integer` | Foreign Key `page_results.id`, Nullable, Indexed | Target page result |
| `fix_type` | `String(100)` | Not Null, Indexed | Standardized fix type (e.g. `meta_tag_improvement`) |
| `title` | `String(255)` | Not Null | Descriptive title of the proposed plan |
| `description` | `Text` | Not Null | Full explanation of the remediation plan |
| `problem_statement`| `Text` | Not Null | Verifiable statement of current defect / issue |
| `proposed_action` | `Text` | Not Null | Exact modification instructions |
| `expected_outcome`| `Text` | Not Null | Expected outcome upon successful implementation |
| `estimated_effort`| `String(50)` | Not Null, Default `medium` | Implementation difficulty (`low`, `medium`, `high`) |
| `risk_level` | `String(50)` | Not Null, Default `low` | Risk rating (`low`, `medium`, `high`) |
| `priority` | `String(20)` | Not Null, Default `medium` | Inherited priority (`critical`, `high`, `medium`, `low`) |
| `status` | `String(50)` | Not Null, Default `draft`, Indexed | Review lifecycle status |
| `diff_payload` | `JSON` | Nullable | Structured proposal (`target`, `action`, `before`, `after`, `guidelines`) |
| `safety_checks` | `JSON` | Nullable | Safety flags and audit history of transitions |
| `created_at` | `DateTime` | Not Null, Default UTC | Creation timestamp |
| `updated_at` | `DateTime` | Not Null, Auto-updated UTC | Last modification timestamp |

---

## 3. Supported Fix Types & Risk Ratings

| Fix Type | Default Risk | Default Effort | Description |
|---|---|---|---|
| `meta_tag_improvement` | `low` | `low` | Title, meta description, and robots meta tag updates. |
| `structured_data_injection` | `low` | `medium` | JSON-LD schema additions (FAQPage, Organization, Article). |
| `heading_structure_fix` | `medium` | `low` | H1-H6 hierarchy reorganization and consolidation. |
| `content_gap_fill` | `medium` | `medium` | Authoritative section expansion and direct answer drafting. |
| `entity_optimization` | `low` | `low` | Wikipedia/Wikidata sameAs authority linking. |
| `internal_link_addition` | `medium` | `medium` | Anchor text links connecting related internal pages. |
| `technical_seo_correction` | `high` | `low` | Canonical URL fixes, redirect loop resolution. |
| `general_fix` | `medium` | `medium` | Fallback category for custom remediation plans. |

---

## 4. Review Lifecycle & Status Transitions

Fix plans move through a controlled, auditable lifecycle:

```text
       ┌──────────┐
       │  draft   │◀────────────────────────┐
       └────┬─────┘                         │
            │ (ready for review)            │
            ▼                               │
 ┌──────────────────────┐                   │ (reopen / revise)
 │   ready_for_review   │                   │
 └────┬────────────┬────┘                   │
      │ (approve)  │ (reject)               │
      ▼            ▼                        │
┌──────────┐ ┌──────────┐                   │
│ approved │ │ rejected │───────────────────┘
└─────┬────┘ └──────────┘
      │ (complete / deploy)
      ▼
┌───────────┐
│ completed │ (Terminal)
└───────────┘
```

### Safety Enforcement Rules
1. **Approval Required**: A fix plan **cannot** move to `completed` unless it was previously in `approved` state.
2. **Terminal Lock**: Once in `completed` state, no further transitions are allowed.
3. **Audit Trail**: Every status transition automatically records an entry in `safety_checks["audit_history"]` containing `from_status`, `to_status`, `timestamp`, and reviewer `comment`.

---

## 5. API Endpoints

- `POST /api/v1/fix-plans`: Manually create a reviewable fix plan.
- `GET /api/v1/fix-plans/{id}`: Retrieve fix plan by ID.
- `PATCH /api/v1/fix-plans/{id}`: Update fix plan metadata.
- `POST /api/v1/fix-plans/{id}/status`: Transition status (`draft` $\to$ `ready_for_review` $\to$ `approved` $\to$ `completed`).
- `DELETE /api/v1/fix-plans/{id}`: Delete fix plan.
- `GET /api/v1/fix-plans`: List fix plans with query filters (`website_id`, `scan_id`, `recommendation_id`, `opportunity_id`, `status`, `fix_type`, `priority`).
- `POST /api/v1/recommendations/{id}/generate-fix-plan`: Deterministically convert a recommendation into a fix plan.
- `GET /api/v1/recommendations/{id}/fix-plans`: List all fix plans for a recommendation.
- `POST /api/v1/scans/{id}/generate-fix-plans`: Batch generate fix plans for all recommendations in a scan.
- `POST /api/v1/websites/{id}/generate-fix-plans`: Batch generate fix plans for a website.

---

## 6. Root-Cause Analysis & Finding Grouping (Day 10 - Step 2)

The Root-Cause Analysis layer sits between raw findings and fix plan generation:

```text
Findings Collection (from Scans / Extractor)
                     │
                     ▼
┌──────────────────────────────────────────────┐
│       RootCauseAnalyzer (Day 10 Step 2)       │
│  - Tenant & Scan Boundary Partitioning       │
│  - Deterministic Rule-ID Grouping            │
│  - Conservative Scope Classification         │
│  - Complete Provenance Preservation          │
└──────────────────────┬───────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────┐
│          RootCauseGroup Abstractions         │
│  - Scope: PAGE | PAGE_GROUP | SITE | TEMPLATE│
│  - Finding IDs & Evidence References         │
│  - Consolidated Titles & Rationales          │
│  - Deterministic Order-Independent Key       │
└──────────────────────────────────────────────┘
```

### Deterministic Grouping Rules
1. **Tenant & Scan Boundaries**: Findings for different websites (`website_id`) or different scans (`scan_id`) are never grouped together.
2. **Rule Identity**: Each root cause is strictly partitioned by canonical `rule_id` and `category`. Different rules are never merged.
3. **Scope Hierarchy**:
   - `PAGE`: Single isolated page defect.
   - `PAGE_GROUP`: Multiple pages affected by the same rule violation (e.g. 15 pages missing H1).
   - `SITE`: Global domain configuration defect (`page_id is None` or explicit site-level rule such as `trust_missing_identity`).
   - `TEMPLATE`: Multiple pages sharing an explicit template/layout signature (`template_signature` in evidence).
4. **Stable Root-Cause Key**: Derived deterministically as `w{website_id}:s{scan_id}:{category}:{rule_id}:{scope}[:template_sig]` with a 16-hex hash identifier (`rc-xxxxxxxxxxxxxxxx`).
5. **Provenance Preservation**: All contributing `finding_ids`, `affected_page_ids`, `affected_urls`, and raw unaltered evidence payloads are preserved intact in `evidence_references`.

---

## 7. Three-Tier Safety Classification Engine (Day 10 - Step 3)

The safety classification engine assigns every remediation proposal to one of three deterministic safety tiers:

| Tier | Policy Boundary | Approval Rule | Examples |
|---|---|---|---|
| **`AUTO_SAFE`** | Deterministic, reversible, low-risk structural/technical changes derived from verified evidence. | Eligible for automated processing, but still subject to lifecycle review. | Single H1 insertion (`R-STR-01`), heading hierarchy (`R-STR-03`), title/meta tag bounded length fixes, canonical URLs, JSON-LD syntax. |
| **`ASSISTED`** | AI/content drafting is useful, but requires human editorial review and explicit sign-off before application. | Explicit human approval required (`requires_human_approval=True`). | FAQ answer drafting (`R-QNA-02`), content gap expansion (`R-GAP-01`), topic depth (`R-TOP-03`), semantic entity optimization (`R-SEM-01`), internal link additions. |
| **`MANUAL_REVIEW`** | Changes involving factual, legal, commercial, identity, credentials, expertise, or unsupported claims. Conservative fallback for ambiguous cases. | Mandatory human authorization (`requires_human_approval=True`). Never fabricate citations or facts. | Author credentials (`authority_missing_credentials`), statistical claims (`claim_unsupported_statistical`), business identity (`trust_missing_identity`), privacy policies, broken external sources. |

### Safety Invariants
1. **No Automatic Deployment**: `AUTO_SAFE` classification indicates policy eligibility for automated execution; it **does NOT** automatically authorize, execute, or deploy code or mutate sites.
2. **Conservative Fallback**: Any proposal with ambiguous rules, missing facts, or domain-sensitive trust factors immediately falls back to `MANUAL_REVIEW`.
3. **Lifecycle Preservation**: Fix plans remain in `draft` state upon generation and must follow the full audit-tracked state machine (`draft` $\to$ `ready_for_review` $\to$ `approved` $\to$ `completed`).

---

## 8. Comprehensive Testing & Quality Assurance (Task 8 - Step 7)

The Task 8 Fix Planning Engine is verified through a 17-dimension testing matrix implemented in `backend/tests/test_fix_planning_comprehensive.py`, `backend/tests/test_root_cause_analyzer.py`, `backend/tests/test_fix_safety_classifier.py`, `backend/tests/test_fix_plan_engine.py`, `backend/tests/test_fix_plan_api.py`, and `backend/tests/test_fix_plan_model.py`:

| Dimension | Scope Tested | Primary Verification Invariant |
|---|---|---|
| **1. Root Cause Analyzer** | Multi-page findings, shared rule grouping, scope deduction (`page`, `page_group`, `site_wide`), provenance tracking. | Zero invented evidence, exact byte/dict equality preservation, deterministic order invariance. |
| **2. Fix Type Classification** | All supported fix types (`meta_tag_improvement`, `heading_structure_fix`, `content_gap_fill`, `structured_data_injection`, `technical_seo_correction`, etc.). | Unknown or missing action types safely fall back to `general_fix` with `medium` risk/effort. |
| **3. Fix Plan Schema** | `FixPlanCreate`, `FixPlanUpdate`, `FixPlanResponse`, Pydantic validation, nullable vs required fields. | Empty titles, invalid status enums, and malformed payloads are strictly rejected with 400 Bad Request. |
| **4. Safety & Risk Classification** | 3-tier safety policy (`AUTO_SAFE`, `ASSISTED`, `MANUAL_REVIEW`), rule ID attribution, audit tracking. | Planners and APIs cannot bypass safety controls; all plans require human authorization prior to execution. |
| **5. Content Planner** | Content gap fills (`r-gap-01`), thin content expansion, long paragraph breaking (`r-str-04`). | Diff payloads produce target, action, before, after, and structured editorial guidelines without hallucinations. |
| **6. AEO/GEO Planner** | Direct answer snippets (`r-qna-01`, `r-qna-02`), AI answer readiness (`r-red-01`), entity context (`r-sem-01`). | Assigned `ASSISTED` safety tier with mandatory editorial review and 40-word target lengths. |
| **7. Trust & Authority Planner** | Missing author credentials (`authority_missing_credentials`), unsupported statistics (`claim_unsupported_statistical`), trust identity (`trust_missing_identity`). | Strictly classified as `MANUAL_REVIEW`; never fabricates citations, credentials, or factual URLs. |
| **8. SEO Integration** | Meta tags (`missing_title`, `missing_meta_description`), canonical URLs (`missing_canonical`), robots.txt. | Reuses existing SEO findings without analyzer duplication; preserves all raw finding evidence. |
| **9. Expected Impact** | Impact statement derivation, category alignment, finding linkage. | Generates clear, explainable impact narratives referencing specific finding IDs; no fabricated metrics. |
| **10. Verification Engine** | Linkage between `FixPlan` and `ValidationResult`, before/after validation score delta, status transitions. | Successful validation links to fix plan; failed validation prevents invalid completions. |
| **11. Before / After Payloads** | Structured `diff_payload` dictionary (`target`, `action`, `before`, `after`, `guidelines`). | Explicitly distinguishes changed vs unchanged state and provides actionable remediation diffs. |
| **12. API Layer** | Full REST endpoints (`POST /api/v1/fix-plans`, `GET /api/v1/fix-plans/{id}`, `PATCH`, `DELETE`, `status`, batch generation). | Correct HTTP status codes (200, 201, 400, 404), terminal status locking for completed plans. |
| **13. Service Integration** | End-to-end pipeline: Finding $\to$ Root Cause $\to$ Fix Type $\to$ Fix Plan $\to$ Safety $\to$ Impact $\to$ Verification. | Provenance and foreign key integrity preserved across all relational database models. |
| **14. Traceability & Explainability** | Audit history, rule IDs, classification reasons, problem statements. | Complete bidirectional traceability from generated fix plan back to finding, page, and scan. |
| **15. Idempotency & Deduplication** | Repeated batch generation for recommendations, scans, and websites. | Updates existing fix plan records in-place without generating duplicate database rows. |
| **16. Edge Cases** | Empty findings, None fields, malformed dicts, non-existent entity IDs. | Handled gracefully with clean ValueErrors and HTTP 404/400 exceptions without unhandled crashes. |
| **17. Regression Protection** | Full repository test suite execution. | 100% passing test baseline across all 663 unit, integration, and API tests. |

---

## 9. Real-Site Archetype Validation (Day 10 - Step 8)

The Fix Planning Engine is verified against realistic, diverse web page archetypes and real-world domain profiles in `backend/tests/test_fix_planning_real_site.py` and `backend/scripts/run_real_site_fix_planning_validation.py`:

```text
Realistic Web Page Archetypes (PSF, Martin Fowler, Enterprise Docs)
                              │
                              ▼
        Full Extraction & Intelligent Signal Extraction
                              │
                              ▼
    Findings (SEO, Structure, Q&A, Gaps, Authority, Citations)
                              │
                              ▼
    Deterministic Root-Cause Grouping (Page, Group, Sitewide)
                              │
                              ▼
    Opportunity & Recommendation Synthesis
                              │
                              ▼
    Fix Planning Engine (Deterministic Action & Diff Generation)
                              │
                              ▼
    Three-Tier Safety Classification (AUTO_SAFE, ASSISTED, MANUAL_REVIEW)
                              │
                              ▼
    Auditable Review Lifecycle (draft → review → approved → completed)
                              │
                              ▼
    Verification Engine Linkage (ValidationResult score & delta check)
```

### Validated Archetypes
1. **Corporate / Homepage Archetype**: Missing meta descriptions, heading hierarchy anomalies (`missing_meta_description`, `r-str-01`). Verified `AUTO_SAFE` tier with deterministic structured diffs (`replace_or_insert_meta_tag`, `reorder_heading_hierarchy`).
2. **Technical Documentation / KB Archetype**: Missing direct answer snippets, topic depth gaps (`r-qna-02`, `r-gap-01`). Verified `ASSISTED` tier with explicit 40-word answer drafting guidelines and human approval locks.
3. **Editorial / Authority Profile Archetype**: Unsupported statistical performance claims, missing author credentials (`claim_unsupported_statistical`, `authority_missing_credentials`). Verified `MANUAL_REVIEW` tier with strict anti-hallucination guarantees (never fabricating citations or author credentials).
4. **Validation Linkage**: Verification records (`ValidationResult`) accurately link to approved/completed fix plans and verify score delta improvements without false positive successes.
