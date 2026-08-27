# Raval GEO Intelligence — Recommendation Engine (Task 6.3)

## 1. Engine Purpose
The Recommendation Engine translates raw findings and prioritized opportunities into actionable, structured, and explainable recommendations.

Where the Opportunity Engine prioritizes *what* areas provide the highest business/search ROI, the Recommendation Engine defines *what concrete actions* must be taken, *why* they matter, *where* they apply, and *what benefits* they yield.

```text
Findings (Issues / Signals)
      ↓
Opportunity Engine (6.1 & 6.2 Prioritization)
      ↓
Recommendation Engine (6.3 Action Guidance)
      ↓
Fix / Action Planning Foundation (6.4 Safe Proposals)
```

---

## 2. Recommendation Structure
Each Recommendation contains:

| Field | Type | Description |
|---|---|---|
| `id` | `Integer` | Unique recommendation identifier |
| `finding_id` | `Integer` | Foreign key referencing source `Finding` |
| `opportunity_id` | `Integer (optional)` | Reference to generating or associated `Opportunity` |
| `title` | `String(255)` | Action-oriented directive (e.g. "Inject FAQPage Structured Data") |
| `description` | `Text` | Actionable explanation and benefit summary |
| `priority` | `String(20)` | Inherited priority level (`critical`, `high`, `medium`, `low`) |
| `status` | `String(20)` | Lifecycle state (`open`, `in_progress`, `resolved`, `dismissed`) |
| `category` | `String(100)` | Domain category (`technical_seo`, `content`, `aeo`, `geo`, `entity`, `structured_data`, etc.) |
| `action_type` | `String(100)` | Standardized remediation type (e.g. `schema_markup`, `meta_tag_fix`, `heading_fix`) |
| `effort` | `String(50)` | Implementation effort estimate (`low`, `medium`, `high`) |
| `impact` | `String(100)` | Expected search/AI ranking impact |
| `rationale` | `Text` | Structured explainability statement (`WHY`, `WHAT`, `WHERE`, `EXPECTED BENEFIT`, `ESTIMATED EFFORT`) |
| `payload` | `JSON` | Complete metadata bundle including affected URL, page ID, scan ID, website ID, and evidence |
| `created_at` | `DateTime` | Creation timestamp |

---

## 3. Priority Inheritance
Priorities are deterministically inherited from upstream intelligence:
- **From Opportunity**:
  - `CRITICAL` $\to$ `critical`
  - `HIGH` $\to$ `high`
  - `MEDIUM` $\to$ `medium`
  - `LOW` $\to$ `low`
- **From Finding**:
  - `critical` $\to$ `critical`
  - `high` $\to$ `high`
  - `medium` / `moderate` $\to$ `medium`
  - `low` / `info` $\to$ `low`

---

## 4. Explainability Architecture
Every recommendation generates a deterministic rationale following the format:

$$\text{"WHY: \{why\} | WHAT: \{what\} | WHERE: \{where\} | EXPECTED BENEFIT: \{benefit\} | ESTIMATED EFFORT: \{effort\}."}$$

Example:
> *"WHY: Identified issue 'Missing FAQ Schema': Questions found without JSON-LD schema. | WHAT: Add valid JSON-LD FAQPage markup containing questions and concise direct answers. | WHERE: Page https://example.com/pricing | EXPECTED BENEFIT: Enables rich snippets and boosts inclusion in Google AI Overviews and Perplexity answers. | ESTIMATED EFFORT: Medium."*

---

## 5. Deduplication & Idempotency
To prevent runaway duplicate recommendations during repeated scan executions:
- Recommendations are keyed by `(finding_id, action_type)`.
- If a recommendation already exists for that finding and action type, the engine updates its title, description, priority, impact, and payload in place.
- Guarantees 1-to-1 mapping per issue type without database bloat.

---

## 6. Supported Categories
- `technical_seo`: Title tags, meta descriptions, canonical tags, robots.txt directives.
- `content`: Heading structure, thin content expansion, readability, paragraph formatting.
- `aeo`: Direct question answering, Q&A formatting, snippet conciseness.
- `geo`: AI engine citation probability, entity authority references.
- `entity`: SameAs schema links, knowledge graph node disambiguation.
- `structured_data`: FAQPage, Article, Organization, and Product JSON-LD schemas.
- `internal_linking`: Contextual anchor text links, orphan page resolution.
- `crawlability`: Canonical URL consolidation, redirect loop resolution.

---

## 7. API Endpoints
- `GET /api/v1/recommendations`: List recommendations with query filters (`website_id`, `scan_id`, `finding_id`, `opportunity_id`, `status`, `priority`, `action_type`).
- `GET /api/v1/recommendations/{id}`: Fetch recommendation details.
- `PATCH /api/v1/recommendations/{id}`: Update status, priority, or payload.
- `DELETE /api/v1/recommendations/{id}`: Delete recommendation.
- `POST /api/v1/findings/{finding_id}/generate-recommendations`: Generate recommendation from a finding.
- `POST /api/v1/opportunities/{opportunity_id}/generate-recommendations`: Generate recommendation from an opportunity.
- `POST /api/v1/scans/{scan_id}/generate-recommendations`: Batch generate for all findings/opportunities in a scan.
- `POST /api/v1/websites/{website_id}/generate-recommendations`: Batch generate across all findings for a website.
- `GET /api/v1/opportunities/{opportunity_id}/recommendations`: List recommendations for an opportunity.
