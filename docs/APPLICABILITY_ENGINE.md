# Applicability Engine (Task 8 - Step 8.3)

## 1. Executive Summary & Objective

The **Applicability Engine** is the contextual evaluation layer of Task 8 Step 8.3. It analyzes normalized and aggregated intelligence signals against the specific context of the target page:
- **Page Type** (e.g. `article`, `homepage`, `legal_privacy`, `contact`, `product`, `faq`, `documentation`)
- **Content / Search Intent** (e.g. `informational`, `transactional`, `navigational`, `qa`, `commercial_investigation`)
- **Available Source Data** (e.g. raw HTML, extracted main text, heading hierarchy, structured schemas, asserted claims)

### Core Architectural Invariant: Missing Data is NOT Failure

> [!IMPORTANT]
> **Missing Data Must NOT Automatically Become FAIL**
> The Applicability Engine enforces strict boundaries between:
> 1. **N/A (`not_applicable`)**: The rule genuinely does not apply to this page type or context.
> 2. **UNKNOWN (`unknown`)**: The rule is applicable, but there is insufficient reliable source data to evaluate it.
> 3. **FAIL (`fail`)**: The rule is applicable, sufficient source data exists, and an actual defect or missing requirement is verified.

---

## 2. Canonical Status Vocabulary & Semantics

| Status | Code | Semantic Definition | Example |
| :--- | :--- | :--- | :--- |
| **PASS** | `pass` | The rule is applicable, sufficient data was evaluated, and the requirement is satisfied. | Main H1 heading present on an article page. |
| **FAIL** | `fail` | The rule is applicable, sufficient data was evaluated, and the requirement was violated or missing. | Missing H1 heading on an article page where HTML was extracted. |
| **WARNING** | `warning` | The rule is applicable and evaluated, but indicates a partial, weak, or cautionary condition. | Author bio present but unusually brief (e.g. < 20 characters). |
| **N/A** | `n/a` | The rule genuinely does not apply to the current page type, intent, or context. | Author byline / credential rule evaluated against a Privacy Policy or Contact page. |
| **UNKNOWN** | `unknown` | The rule is applicable, but insufficient or unextracted source data prevented definitive evaluation. | DOM structure check when raw HTML could not be fetched or extraction failed. |

---

## 3. Page Type & Intent Applicability Matrix

```text
+------------------------------------+-------------------------+----------------------+--------------------+
| Rule Category                      | Applicable Page Types   | Inapplicable (N/A)   | Required Telemetry |
+------------------------------------+-------------------------+----------------------+--------------------+
| Authorship & Bylines               | article, blog_post,     | legal_privacy,       | text_content       |
| (trust_author_credentials_present) | documentation, news     | contact, utility     |                    |
+------------------------------------+-------------------------+----------------------+--------------------+
| Contact Info & Business Identity   | homepage, about,        | sub-article child    | raw_html / text    |
| (trust_contact_info_present)       | contact, landing_page   | fragments            |                    |
+------------------------------------+-------------------------+----------------------+--------------------+
| Claim Support & Citations          | article, blog_post,     | legal_privacy with   | claims_count > 0   |
| (claim_support_*, citation_read.)  | documentation, news     | 0 asserted claims    |                    |
+------------------------------------+-------------------------+----------------------+--------------------+
| FAQ & Question Answering           | faq, article, product,  | legal_privacy,       | questions_count > 0|
| (content_question_*, faq_schema)   | documentation           | pure navigational    |                    |
+------------------------------------+-------------------------+----------------------+--------------------+
| E-Commerce & Checkout              | product, category,      | informational blog,  | transactional intent|
| (pricing_transparency, checkout)   | landing_page            | privacy policy       |                    |
+------------------------------------+-------------------------+----------------------+--------------------+
| Document Structure & Headings      | standard web documents  | non-HTML assets      | raw_html / text    |
| (r-str-01, heading_structure)      |                         |                      |                    |
+------------------------------------+-------------------------+----------------------+--------------------+
```

---

## 4. Applicability Context & Heuristics

The `ApplicabilityContext` model encapsulates the page context and data availability:

```python
class ApplicabilityContext(BaseModel):
    page_type: str = "general"
    intent: str | None = None
    available_data: dict[str, bool] = Field(default_factory=dict)
    extracted_data: dict[str, Any] = Field(default_factory=dict)
    metadata: dict[str, Any] = Field(default_factory=dict)
```

### Auto-Inference from Extraction
`ApplicabilityContext.from_page_data(...)` automatically infers page types, intents, and availability flags from URLs, text snippets, and structured schema markers:
- `/privacy`, `/terms`, `/legal` $\rightarrow$ `legal_privacy` (`navigational` intent)
- `/contact`, `/contact-us` $\rightarrow$ `contact` (`navigational` intent)
- `/blog/`, `/article/`, `/news/` $\rightarrow$ `article` (`informational` intent)
- `/faq`, `/help`, `/support` $\rightarrow$ `faq` (`qa` intent)
- `/product/`, `/shop/` $\rightarrow$ `product` (`transactional` intent)

---

## 5. Traceability & Decision Record

Every evaluated `UnifiedSignal` attaches an explainable `ApplicabilityDecision` to its `metadata["applicability_decision"]`:

```json
{
  "rule_id": "trust_author_credentials_present",
  "status": "n/a",
  "is_applicable": false,
  "applicability_type": "not_applicable",
  "reason": "Author credentials and byline rules are not applicable to legal privacy pages. Rule was marked as N/A because it does not apply to this page type or context.",
  "confidence": "high",
  "source_module": "trust_engine",
  "evidence_available": true,
  "metadata": {
    "evaluated_at": "2026-08-31T16:27:44.123456+00:00",
    "page_type": "legal_privacy",
    "intent": "navigational"
  }
}
```

---

## 6. Usage Example

```python
from app import aggregate_signals, evaluate_applicability, ApplicabilityContext

# 1. Aggregate signals across Task 5-7
collection = aggregate_signals(raw_engine_results)

# 2. Build context for the analyzed target
context = ApplicabilityContext.from_page_data(
    url="https://example.com/privacy-policy",
    text_content="Privacy Policy text...",
    raw_html="<html>...</html>",
    headings_count=2,
)

# 3. Evaluate applicability
evaluated_collection = evaluate_applicability(collection, context=context)

# 4. Inspect results
for signal in evaluated_collection.signals:
    print(f"[{signal.status.upper()}] {signal.rule_id} (Applicability: {signal.applicability})")
```
