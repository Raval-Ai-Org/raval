# Raval GEO Intelligence — Opportunity Engine & Prioritization (Task 6.1 & 6.2)

## 1. Engine Purpose
The Opportunity Engine converts technical SEO, content intelligence, AEO, and GEO findings and recommendations into actionable, prioritized improvement opportunities. 

Rather than overwhelming users and automated workflows with raw lists of technical issues, the Opportunity Engine synthesizes findings into concrete, high-ROI opportunities that can be tracked, filtered, prioritized, and executed.

```text
Crawled Evidence & Content Signals
              ↓
    Page Extraction Engine (13 domains)
              ↓
  Content Intelligence & Analyzers (11 engines)
              ↓
           Findings (Issues & Gaps)
              ↓
        Recommendations (Proposed Actions)
              ↓
     Opportunity Engine (Tasks 6.1 & 6.2)
              ↓
Prioritized, Actionable Opportunities
```

---

## 2. Opportunity Lifecycle
Every Opportunity moves through explicit lifecycle states:

- **`identified`**: Default state upon generation from findings or recommendations. Represents an actionable issue discovered by the intelligence pipeline.
- **`in_progress`**: Acknowledged by users or automated workflows; active remediation is underway.
- **`implemented`**: Remediation actions have been deployed or verified.
- **`dismissed`**: Reviewed and marked as intentionally deferred, non-applicable, or accepted risk.
- **`archived`**: Historical record preserved after scan or website obsolescence.

Valid states: `identified`, `in_progress`, `implemented`, `dismissed`, `archived`.

---

## 3. Data Model

The `Opportunity` model (`backend/app/models.py`) provides full relational persistence:

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `Integer` | Primary Key | Unique internal identifier |
| `website_id` | `Integer` | Foreign Key (`websites.id`), Indexed, Not Null | Parent website boundary |
| `scan_id` | `Integer` | Foreign Key (`scans.id`), Indexed, Nullable | Generating scan execution |
| `page_id` | `Integer` | Foreign Key (`page_results.id`), Indexed, Nullable | Target page |
| `finding_id` | `Integer` | Foreign Key (`findings.id`), Indexed, Nullable | Source finding relationship |
| `recommendation_id` | `Integer` | Foreign Key (`recommendations.id`), Indexed, Nullable | Source recommendation relationship |
| `title` | `String(255)` | Not Null | Action-oriented title |
| `description` | `Text` | Not Null | Verifiable description and context |
| `opportunity_type` | `String(100)` | Indexed, Not Null | Standardized opportunity type (e.g. `structured_data_enhancement`) |
| `category` | `String(100)` | Indexed, Not Null | Category (`technical_seo`, `content`, `aeo`, `geo`, `structured_data`, etc.) |
| `status` | `String(50)` | Indexed, Not Null, Default `identified` | Lifecycle status |
| `impact` | `Float` | Not Null, Default `0.5` | Normalized business/search impact $[0.0, 1.0]$ |
| `effort` | `Float` | Not Null, Default `0.5` | Normalized implementation effort $[0.0, 1.0]$ |
| `confidence` | `Float` | Not Null, Default `0.8` | Empirical confidence $[0.0, 1.0]$ |
| `priority_score` | `Float` | Indexed, Not Null | Composite deterministic score $[0.0, 1.0]$ |
| `priority` | `String(20)` | Indexed, Not Null | Level (`CRITICAL`, `HIGH`, `MEDIUM`, `LOW`) |
| `rationale` | `Text` | Not Null | Explainable plain-text prioritization rationale |
| `evidence` | `JSON` | Nullable | Verifiable evidence payload |
| `created_at` | `DateTime` | Not Null, Default UTC | Creation timestamp |
| `updated_at` | `DateTime` | Not Null, Auto-updated UTC | Last mutation timestamp |

### Relationships & Cascades
- `Opportunity.website` $\leftrightarrow$ `Website.opportunities` (Cascades on website deletion)
- `Opportunity.scan` $\leftrightarrow$ `Scan.opportunities` (Cascades on scan deletion)
- `Opportunity.page_result` $\leftrightarrow$ `PageResult.opportunities`
- `Opportunity.finding` $\leftrightarrow$ `Finding.opportunities`
- `Opportunity.recommendation` $\leftrightarrow$ `Recommendation.opportunities`

---

## 4. Finding & Recommendation Traceability

Every generated opportunity maintains strict provenance:
1. **From Finding**: An opportunity references `finding_id`. If a recommendation exists for that finding, `recommendation_id` is linked as well.
2. **From Recommendation**: An opportunity created via recommendation inherits the parent `finding_id` and explicitly sets `recommendation_id`.
3. **Multi-Tenant Scoping**: Foreign key relationships guarantee that an opportunity cannot reference a finding or scan belonging to a different website.

---

## 5. Prioritization Formula & Inputs (Task 6.2)

Prioritization is 100% deterministic, bounded, and explainable. No external LLMs, random numbers, or opaque ML weights are used.

### Inputs
1. **Impact ($I \in [0.0, 1.0]$)**:
   - Derived from finding severity:
     - `critical` $\to 1.00$
     - `high` $\to 0.80$
     - `medium` $\to 0.50$
     - `low` $\to 0.25$
     - `info` $\to 0.10$
2. **Confidence ($C \in [0.0, 1.0]$)**:
   - Derived from empirical evidence presence:
     - Rich evidence payload ( $\ge 3$ metrics/items) $\to 0.95$
     - Single evidence metric $\to 0.85$
     - Basic heuristic (no evidence payload) $\to 0.70$
3. **Effort ($E \in [0.0, 1.0]$)**:
   - Derived from category and implementation complexity:
     - Title/meta/alt text fixes $\to 0.25$ (Low effort)
     - Schema / FAQPage JSON-LD markup $\to 0.30$ (Low-medium effort)
     - Heading hierarchy / structure outline $\to 0.35$ (Medium effort)
     - Entity authority / sameAs links $\to 0.45$ (Medium effort)
     - Content gap writing / direct answers $\to 0.55$ (Medium-high effort)
     - Site template / architecture overhaul $\to 0.75$ (High effort)
   - **Ease of Implementation**: $\text{Ease} = 1.0 - E$.

### Mathematical Formula
$$\text{PriorityScore} = (0.50 \times I) + (0.25 \times C) + (0.25 \times (1.0 - E))$$

- **Boundedness**: Because $I, C, (1-E) \in [0.0, 1.0]$ and $\sum w_i = 1.0$, the score is guaranteed to remain in $[0.0, 1.0]$.
- **Monotonicity**:
  - Increasing Impact strictly increases score.
  - Increasing Confidence strictly increases score.
  - Increasing Effort strictly decreases score (rewarding higher ROI tasks).

---

## 6. Priority Thresholds & Levels

Deterministic thresholds map the continuous score into clear priority bands:

| Priority Level | Score Range | Description |
|---|---|---|
| **`CRITICAL`** | $\text{Score} \ge 0.80$ | High-impact issues with high confidence and low/moderate effort. Urgent attention required. |
| **`HIGH`** | $0.60 \le \text{Score} < 0.80$ | Meaningful optimization with favorable ROI and proven evidence. |
| **`MEDIUM`** | $0.40 \le \text{Score} < 0.60$ | Standard improvements; moderate impact or higher effort. |
| **`LOW`** | $\text{Score} < 0.40$ | Minor polish items, low impact, or high-effort / low-ROI tasks. |

---

## 7. Explainable Rationale Generation

Every opportunity automatically computes a human-readable explanation of why it was assigned its score:

$$\text{Format: } \text{"\{Priority\} priority (score: \{score\}) because impact is \{impact\_desc\}, confidence is \{conf\_desc\}, and estimated effort is \{effort\_desc\}."}$$

Example output:
> *"CRITICAL priority (score: 0.85) because impact is critical (1.00), confidence is high (0.85), and estimated effort is low (high ease of implementation) (0.25)."*

---

## 8. Idempotency & Deduplication Strategy

To prevent repeated scans or pipeline runs from creating runaway duplicate opportunities:
- When generating from a finding, the engine checks for an existing record with matching `(finding_id, opportunity_type)`.
- If an existing opportunity is found, the engine **updates** its title, description, impact, effort, confidence, priority score, and rationale with fresh signals, preserving the existing record ID.
- If no existing opportunity is found, a new row is created.

---

## 9. API Inventory

All endpoints are registered under `/api/v1` and use standard JSON request/response formats:

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/v1/opportunities` | Create a custom opportunity |
| `GET` | `/api/v1/opportunities/{id}` | Get opportunity detail by ID |
| `PATCH` | `/api/v1/opportunities/{id}` | Update opportunity fields (status, impact, priority, etc.) |
| `DELETE` | `/api/v1/opportunities/{id}` | Delete opportunity |
| `GET` | `/api/v1/opportunities` | Global list with query filters (`website_id`, `scan_id`, `category`, `status`, `priority`, `opportunity_type`) |
| `GET` | `/api/v1/websites/{website_id}/opportunities` | List opportunities for a website |
| `GET` | `/api/v1/scans/{scan_id}/opportunities` | List opportunities for a scan |
| `GET` | `/api/v1/findings/{finding_id}/opportunities` | List opportunities for a finding |
| `POST` | `/api/v1/findings/{finding_id}/generate-opportunities` | Generate opportunity from finding |
| `POST` | `/api/v1/recommendations/{recommendation_id}/generate-opportunities` | Generate opportunity from recommendation |
| `POST` | `/api/v1/scans/{scan_id}/generate-opportunities` | Batch generate opportunities for all findings in a scan |
| `POST` | `/api/v1/websites/{website_id}/generate-opportunities` | Batch generate opportunities across all findings for a website |

---

## 10. Scope Protection & Future Work

In strict accordance with project boundaries:
- **Task 6.1 (Opportunity Engine)**: Implemented.
- **Task 6.2 (Opportunity Prioritization)**: Implemented.
- **Task 6.3+ (Fix Engine, Code Patching, CMS/Git Connectors)**: NOT implemented (Future work).
- **Validation Engine**: NOT implemented (Future work).
- **Monitoring & Scheduled Alerting**: NOT implemented (Future work).
- **External LLM Gateway Execution**: NOT implemented (Future work).
