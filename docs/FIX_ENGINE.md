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
