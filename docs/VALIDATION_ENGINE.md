# Raval GEO Intelligence — Validation Engine & Pipeline (Tasks 6.5, 6.6, 6.7)

## 1. Engine Purpose & Overview
The Validation Engine provides evidence-based, deterministic verification of proposed remediations and fixes. It closes the feedback loop between the intelligence pipeline and remediation planning:

```text
Scan & Crawl (Tasks 1–4)
      ↓
Content Intelligence & Findings (Task 5)
      ↓
Opportunity Engine & Prioritization (Tasks 6.1 & 6.2)
      ↓
Recommendation Engine (Task 6.3)
      ↓
Fix / Action Planning Foundation (Task 6.4)
      ↓
Validation Engine Foundation (Task 6.5)
      ↓
Validation Feedback & Lifecycle Updates (Task 6.6)
      ↓
End-to-End Orchestration (Task 6.7)
```

> [!IMPORTANT]
> **Safety Boundary**: The Validation Engine operates strictly internally on simulated or collected page signals. It does **NOT** perform automatic website deployments, external CMS mutations, GitHub pushes, or live LLM gateway calls.

---

## 2. Validation Data Model

The `ValidationResult` model (`backend/app/models.py`) provides full relational tracking:

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `Integer` | Primary Key | Unique validation record identifier |
| `fix_plan_id` | `Integer` | Foreign Key `fix_plans.id`, Nullable, Indexed | Verified fix plan proposal |
| `recommendation_id` | `Integer` | Foreign Key `recommendations.id`, Nullable, Indexed | Verified recommendation directive |
| `finding_id` | `Integer` | Foreign Key `findings.id`, Nullable, Indexed | Originating finding/issue |
| `opportunity_id` | `Integer` | Foreign Key `opportunities.id`, Nullable, Indexed | Originating business opportunity |
| `website_id` | `Integer` | Foreign Key `websites.id`, Not Null, Indexed | Scoped website |
| `scan_id` | `Integer` | Foreign Key `scans.id`, Nullable, Indexed | Originating scan execution |
| `page_id` | `Integer` | Foreign Key `page_results.id`, Nullable, Indexed | Target page result |
| `validation_type` | `String(100)` | Not Null, Indexed | Rule type (`meta_tag_validation`, `structured_data_validation`, etc.) |
| `status` | `String(50)` | Not Null, Default `completed`, Indexed | Execution status (`completed`, `failed`, `pending`) |
| `result` | `String(20)` | Not Null, Indexed | Verification verdict (`PASS`, `FAIL`, `PARTIAL`) |
| `validation_score` | `Float` | Not Null, Default `1.0` | Bounded score $[0.0, 1.0]$ |
| `before_state` | `JSON` | Nullable | Document state prior to remediation |
| `after_state` | `JSON` | Nullable | Document state after remediation |
| `expected_result` | `Text` | Not Null | Expected outcome criteria |
| `actual_result` | `Text` | Not Null | Verifiable observed outcome |
| `explanation` | `Text` | Not Null | Human-readable explanation of the verdict |
| `feedback` | `JSON` | Nullable | Actionable feedback dictionary (`what_changed`, `next_action`, `remediation_cycles`) |
| `created_at` | `DateTime` | Not Null, Default UTC | Creation timestamp |
| `updated_at` | `DateTime` | Not Null, Auto-updated UTC | Last modification timestamp |

---

## 3. Supported Validation Rules & Types

| Validation Type | Target Focus | PASS Condition (Score 1.0) | PARTIAL Condition (Score 0.5–0.6) | FAIL Condition (Score 0.0) |
|---|---|---|---|---|
| `meta_tag_validation` | Title & Meta Description | Length in optimal window (Title: 10–70 chars, Desc: 50–200 chars) | Tag present but outside recommended character window | Missing, empty, or unconfigured |
| `structured_data_validation` | JSON-LD & Schema markup | Valid JSON-LD with `@context` and `@type` | Schema `@type` present but missing standard `@context` | Absent, empty, or malformed schema |
| `heading_structure_validation` | Heading Hierarchy & H1 | Exactly one H1 heading present | — | Zero H1 headings or multiple H1 headings |
| `content_gap_validation` | Content Depth & Gaps | Word count increased by $\ge 50$ words and total $\ge 300$ | Word count increased but total below 300 words | No word count increase or decreased |
| `internal_link_validation` | Internal Link Graph | Link count increased or $\ge 3$ contextual links | — | No link count increase |
| `entity_validation` | Entity Disambiguation | Entity named and linked with authoritative `sameAs` URI | Entity named but lacks `sameAs` URI | No entity optimization detected |
| `aeo_validation` | Direct Answer Blocks | Direct answer block concise (15–85 words) | Direct answer present but verbose ($>85$ words) or brief ($<15$ words) | No direct answer block detected |
| `technical_seo_validation` | Canonical & HTTP Status | Valid HTTP canonical URL and clean status 200 | — | Non-200 status or broken canonical tag |
| `general_validation` | Generic Remediation | After-state differs from before-state and reflects expected change | — | After-state unchanged or missing |

---

## 4. Validation Feedback Loop (Task 6.6)

Validation updates the lifecycle of upstream entities deterministically:

```text
                        ┌──────────────┐
                        │  Validation  │
                        └──────┬───────┘
                               │
               ┌───────────────┼───────────────┐
               ▼               ▼               ▼
           [ PASS ]       [ PARTIAL ]       [ FAIL ]
               │               │               │
  FixPlan: "completed"  FixPlan: "ready" FixPlan: "ready"
  Rec: "resolved"       Rec: "in_progress" Rec: "open"
  Cycles: 0             Cycles: preserved Cycles: incremented
```

### Safety & Anti-Looping Guarantees
1. **Cycle Tracking**: Failed validations increment `remediation_cycles` in the feedback payload.
2. **No Infinite Loops**: The system provides structured diagnostic feedback (`next_action`, `remaining_issues`) without triggering autonomous re-execution loops.
3. **Traceability**: Complete provenance is maintained:
   $$\text{Finding} \to \text{Opportunity} \to \text{Recommendation} \to \text{FixPlan} \to \text{ValidationResult}$$

---

## 5. End-to-End Intelligence Pipeline Orchestration (Task 6.7)

The `pipeline_service.py` service coordinates the entire intelligence workflow into a single deterministic call:

$$\text{run\_end\_to\_end\_intelligence\_pipeline(db, website\_id, scan\_id, run\_validations)}$$

### Execution Stages:
1. **Findings Resolution**: Queries findings for scan or website.
2. **Opportunities Generation**: Batch-generates prioritized opportunities (Tasks 6.1 & 6.2).
3. **Recommendations Synthesis**: Batch-generates actionable recommendations (Task 6.3).
4. **Fix Plans Construction**: Batch-generates reviewable fix plans (Task 6.4).
5. **Validation & Feedback**: Deterministically validates fix plans and updates lifecycle statuses (Tasks 6.5 & 6.6).
6. **Metrics Compilation**: Summarizes stage counts and health score.

### Empty Data & Error Boundaries
- **Empty Findings**: Safely returns completed status with 0 counts.
- **Empty Opportunities**: Handled gracefully without database exceptions.
- **Idempotency**: Repeated execution preserves counts without runaway duplicate rows.

---

## 6. REST API Endpoints

### Validation Endpoints
- `POST /api/v1/fix-plans/{id}/validate`: Execute validation on a fix plan.
- `POST /api/v1/recommendations/{id}/validate`: Execute validation on a recommendation.
- `POST /api/v1/validations`: Manually create and evaluate a validation record.
- `GET /api/v1/validations/{id}`: Retrieve validation record details.
- `GET /api/v1/validations`: List validations with filters (`website_id`, `scan_id`, `status`, `result`, etc.).
- `GET /api/v1/fix-plans/{id}/validations`: List all validation history for a fix plan.
- `GET /api/v1/recommendations/{id}/validations`: List all validation history for a recommendation.
- `POST /api/v1/scans/{id}/validate`: Batch validate all fix plans in a scan.
- `POST /api/v1/websites/{id}/validate`: Batch validate all fix plans for a website.

### Pipeline Orchestration Endpoints
- `POST /api/v1/scans/{scan_id}/run-pipeline`: Trigger complete intelligence pipeline for a scan.
- `POST /api/v1/websites/{website_id}/run-pipeline`: Trigger complete intelligence pipeline for a website.
- `GET /api/v1/scans/{scan_id}/pipeline-summary`: Retrieve stage counts, validation breakdown, and health score.
- `GET /api/v1/websites/{website_id}/pipeline-summary`: Retrieve pipeline summary across a website.
