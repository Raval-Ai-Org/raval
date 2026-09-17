# Raval AI Search Intelligence — Deterministic Scoring Model Specification

> **Canonical Document**: [`docs/SCORE_MODEL.md`](file:///c:/Users/HP/Documents/raval-geo-intelligence/docs/SCORE_MODEL.md)

## 1. Executive Summary & Architectural Overview

The **Raval AI Search Intelligence Scoring System** (Task 8) is a centralized, deterministic, explainable 0–100 scoring and intelligence engine. It consumes normalized signals produced by the underlying page analysis, opportunity detection, and trust/authority verification modules (Tasks 5–7), computes mathematically bounded category and overall site scores, and produces actionable prioritized recommendations and human-readable explanations.

### Complete End-to-End Pipeline
$$\begin{aligned}
\text{Raw Telemetry / Findings} &\xrightarrow{\text{Step 8.2}} \text{Unified Normalization} \\
&\xrightarrow{\text{Step 8.3}} \text{Signal Aggregation \& Deduplication} \\
&\xrightarrow{\text{Step 8.3}} \text{Applicability Evaluation} \\
&\xrightarrow{\text{Step 8.4}} \text{Deterministic 0--100 Scoring} \\
&\xrightarrow{\text{Step 8.5}} \text{Score \& Finding Traceability} \\
&\xrightarrow{\text{Step 8.6}} \text{Priority \& Recommendation Generation} \\
&\xrightarrow{\text{Step 8.7}} \text{Score Explanation \& Page Analytics} \\
&\xrightarrow{\text{Step 8.8}} \text{Site-Level Aggregation \& History} \\
&\xrightarrow{\text{Step 8.8}} \text{FastAPI REST Endpoints} \\
&\xrightarrow{\text{Step 8.9}} \text{Real-Site \& Regression Validation}
\end{aligned}$$

---

## 2. Canonical Scoring Categories & Weights

The scoring system evaluates intelligence across 5 canonical categories. Every category is assigned an explicit weight normalized to sum to exactly 1.0 (100%):

| Category Key | Display Name | Canonical Weight | Primary Intelligence Focus |
| :--- | :--- | :---: | :--- |
| `trust_transparency` | **Trust & Transparency** | **0.20 (20%)** | Business identity, author credentials, editorial contact, publishing dates, legal/privacy notices. |
| `authority_citations` | **Authority & Citations** | **0.25 (25%)** | Factual claim verification, outbound citation grounding, source quality, reference readiness. |
| `content_quality` | **Content Quality & Gaps** | **0.25 (25%)** | Substantive depth, content gap coverage, word count adequacy, quality evidence checks. |
| `content_structure` | **Content Structure & DOM** | **0.15 (15%)** | Heading hierarchy (H1/H2/H3), title tag optimization, meta descriptions, canonical tag integrity. |
| `semantic_readiness` | **Semantic Readiness** | **0.15 (15%)** | Topical coverage, search intent alignment, question & answer readiness, entity depth. |
| **TOTAL** | | **1.00 (100%)** | |

---

## 3. Mathematical Scoring Formulation

### 3.1 Category Score Calculation
Each category score $\text{CatScore}_c \in [0.0, 100.0]$ is computed deterministically from its active, applicable evaluated signals:

$$\text{CatScore}_c = \begin{cases}
100.0 & \text{if } \sum_{i \in \text{Active}_c} w_i = 0 \text{ (no applicable active rules evaluated)} \\
100.0 \times \frac{\sum_{i \in \text{Active}_c} (w_i \times \text{CreditRatio}_i)}{\sum_{i \in \text{Active}_c} w_i} & \text{otherwise}
\end{cases}$$

Where:
- $w_i > 0$ is the configured weight of rule $i$ (default: 1.0).
- $\text{CreditRatio}_i \in [0.0, 1.0]$ is determined by the evaluated rule status:
  - **`PASS`** (or `verified`, `detected`, `optimal`): $\text{CreditRatio}_i = 1.0$ (100% credit, 0 deduction).
  - **`WARNING`** (or `partial`, `caution`, `weak`): $\text{CreditRatio}_i = 0.5$ (50% credit, 50% deduction).
  - **`FAIL`** (or `open`, `missing`, `unsupported`): $\text{CreditRatio}_i = 0.0$ (0% credit, 100% deduction).
  - **`N/A`** (`not_applicable`): **Excluded from $\text{Active}_c$** (0 deduction, does not affect denominator).
  - **`UNKNOWN`** (`insufficient_data`): **Excluded from $\text{Active}_c$** (0 deduction, never penalized as FAIL).

### 3.2 Overall Page Score Calculation
The overall page score is the weighted sum of all 5 category scores, strictly clamped to $[0.0, 100.0]$:

$$\text{OverallScore} = \max\left(0.0, \min\left(100.0, \sum_{c=1}^5 \text{CatScore}_c \times W_c\right)\right)$$

### 3.3 Health Status Tiers
Both overall score and category scores map deterministically to standardized health tiers:
- **`optimal`**: Score $\ge 80.0$ (High compliance, robust evidence).
- **`adequate`**: $65.0 \le \text{Score} < 80.0$ (Satisfactory baseline, moderate remediation opportunities).
- **`needs_improvement`**: $50.0 \le \text{Score} < 65.0$ (Multiple material defects, optimization required).
- **`deficient`**: Score $< 50.0$ (Severe quality, structure, or authority deficits).

---

## 4. Key Architectural Invariants

### 4.1 Missing Data Safety
- Missing HTML, empty body text, or unavailable telemetry **never** converts to a false `FAIL`.
- Insufficient data is classified as `UNKNOWN` status and excluded from scoring calculations without failure penalties.

### 4.2 N/A Contextual Inapplicability
- Inapplicable rules (e.g., author credentials on a legal privacy policy or eCommerce rules on informational articles) are marked `N/A` and produce zero score penalty.

### 4.3 Duplicate Penalty Protection
- Signal deduplication uses deterministic identity keys: `(rule_id, category, finding_id, url)`.
- If the same rule or finding is reported multiple times for the same page, exactly **one** penalty is deducted; subsequent instances are recorded as `is_skipped=True` with `skip_reason="duplicate_prevention"`.

### 4.4 Category Isolation
- Deficits in one category affect only that category and its weighted portion of the overall score. Unrelated categories remain isolated at their true evaluated scores.

---

## 5. Provenance & Traceability Chain (Step 8.5)

Every score deduction maintains complete, auditable provenance through the system:

$$\text{Score Contribution} \rightarrow \text{Category} \rightarrow \text{Rule ID} \rightarrow \text{Finding ID} \rightarrow \text{Evidence} \rightarrow \text{Point Impact}$$

Each `ScoreContribution` record contains:
- `rule_id`: Identifier of the rule (e.g., `missing_h1`, `trust_author_credentials_present`).
- `category`: Canonical category (`trust_transparency`, `authority_citations`, etc.).
- `status`: Evaluated state (`pass`, `fail`, `warning`, `n/a`, `unknown`).
- `credit_ratio`: Credit multiplier ($1.0, 0.5, 0.0$).
- `category_point_impact`: Points deducted from the category (e.g., $-50.0$).
- `overall_point_impact`: Points deducted from the overall score (e.g., $-12.5$).
- `is_penalized`: Boolean indicator of active penalty.
- `evidence`: Original raw evidence excerpt supporting the evaluation.
- `finding_id`: Linked finding database ID if originating from a persisted finding.

---

## 6. Priority & Recommendation Engine (Step 8.6)

### 6.1 Priority Levels
Actionable findings receive exactly one deterministic priority level:

| Priority | Criteria / Triggers |
| :--- | :--- |
| **`Critical`** | Finding severity is `critical`, or overall score impact is $\ge 12.0$ points. |
| **`High`** | Finding severity is `high`, or overall score impact is $\ge 6.0$ points. |
| **`Medium`** | Finding severity is `medium`, or overall score impact is $\ge 2.5$ points. |
| **`Low`** | Finding severity is `low`, or overall score impact is $< 2.5$ points, or `WARNING` status. |
| **`Info`** | Status is `PASS`, `N/A`, or `UNKNOWN`. Excluded from negative recommendations. |

### 6.2 Remediation Classification
- **Quick Win (`quick_win`)**: Minimal effort / high immediate return (e.g., adding missing H1/title tags, drafting meta descriptions, adding author byline, injecting FAQ schema).
- **Deep Fix (`deep_fix`)**: Architectural / content expansion effort (e.g., sourcing outbound citations for factual claims, expanding topical depth, resolving entity coverage gaps).

---

## 7. Score Explanation & Page Analytics (Step 8.7)

### 7.1 Score Explanation Envelope (`ScoreExplanationResponse`)
- `overall_score` & `status`: Score and tier.
- `summary`: Human-readable executive narrative.
- `category_explanations`: Per-category narrative, score, weight, points lost, key strengths, and key deductions.
- `deductions`: List of `DeductionDetail` objects with rule ID, category, point loss, human reason, evidence excerpt, and remedy hint.
- `strengths`: Verified passing rules with supporting evidence.
- `na_rules`: Rules excluded due to inapplicability.
- `unknown_rules`: Rules marked UNKNOWN due to missing data.

### 7.2 Page Analytics Container (`PageScoreAnalytics`)
Persistable analytics model storing:
- `page_id`, `url`, `scan_id`, `website_id`, `timestamp`
- `overall_score`, `status`, `category_scores`
- `finding_counts` by category
- `priority_counts` (`critical`, `high`, `medium`, `low`, `info`)
- `recommendation_counts` (`total`, `quick_wins`, `deep_fixes`)
- `applicability_counts` (`pass`, `fail`, `warning`, `na`, `unknown`)
- `total_points_deducted`

---

## 8. Site-Level Aggregation & History (Step 8.8)

### 8.1 Aggregation Strategy
Rather than blind averaging, the site aggregator:
1. Computes arithmetic averages of each category score across applicable pages:
   $$\text{AvgCatScore}_c = \frac{\sum_{p \in \text{ApplicablePages}} \text{CatScore}_{p, c}}{N_{\text{pages}}}$$
2. Computes the canonical weighted site score:
   $$\text{OverallSiteScore} = \sum_{c=1}^5 \text{AvgCatScore}_c \times W_c$$
3. Identifies and ranks **Top Site Issues** by cumulative score impact across pages and affected page frequency.
4. Safely handles boundary cases (0 pages evaluated defaults to neutral 100.0 baseline).
5. Performs historical comparison against previous scan summaries ($\Delta$ score, improvement flag, resolved vs new issues).

---

## 9. REST API Reference

| HTTP Method | Path | Description |
| :--- | :--- | :--- |
| `GET` | `/api/v1/scores/pages/{page_id}` | Overall score, category breakdown, deductions, verified strengths, and narrative explanation. |
| `GET` | `/api/v1/scores/pages/{page_id}/recommendations` | Prioritized recommendations for a page with optional `?classification=quick_win\|deep_fix` filter. |
| `GET` | `/api/v1/scores/websites/{website_id}` | Site-level aggregated score summary, category breakdowns, top site issues, and health metrics. |
| `GET` | `/api/v1/scores/websites/{website_id}/findings` | Site findings grouped by priority, category, and evaluation status. |
| `GET` | `/api/v1/scores/websites/{website_id}/recommendations` | Deduplicated site-wide recommendations with classification filters. |
| `GET` | `/api/v1/scores/websites/{website_id}/history` | Historical score timeline across all scans for a domain. |

---

## 10. Verification & Test Suite Summary (Step 8.9)

### 10.1 Test Coverage by Step
- **Step 8.2 (Normalization)**: [`backend/tests/test_unified_signal_normalization.py`](file:///c:/Users/HP/Documents/raval-geo-intelligence/backend/tests/test_unified_signal_normalization.py) — 31 tests passed
- **Step 8.3 (Aggregation)**: [`backend/tests/test_signal_aggregation.py`](file:///c:/Users/HP/Documents/raval-geo-intelligence/backend/tests/test_signal_aggregation.py) — 18 tests passed
- **Step 8.3 (Applicability)**: [`backend/tests/test_applicability_engine.py`](file:///c:/Users/HP/Documents/raval-geo-intelligence/backend/tests/test_applicability_engine.py) — 15 tests passed
- **Steps 8.4 & 8.5 (Scoring & Traceability)**: [`backend/tests/test_scoring_engine.py`](file:///c:/Users/HP/Documents/raval-geo-intelligence/backend/tests/test_scoring_engine.py) — 15 tests passed
- **Step 8.6 (Priority & Recommendations)**: [`backend/tests/test_priority_and_recommendations.py`](file:///c:/Users/HP/Documents/raval-geo-intelligence/backend/tests/test_priority_and_recommendations.py) — 10 tests passed
- **Step 8.7 (Score Explanation & Analytics)**: [`backend/tests/test_score_explanation.py`](file:///c:/Users/HP/Documents/raval-geo-intelligence/backend/tests/test_score_explanation.py) — 4 tests passed
- **Step 8.8 (Site Aggregation & APIs)**: [`backend/tests/test_site_aggregation_and_api.py`](file:///c:/Users/HP/Documents/raval-geo-intelligence/backend/tests/test_site_aggregation_and_api.py) — 7 tests passed
- **Step 8.9 (Comprehensive Validation & Boundaries)**: [`backend/tests/test_task8_9_testing_validation.py`](file:///c:/Users/HP/Documents/raval-geo-intelligence/backend/tests/test_task8_9_testing_validation.py) — 34 tests passed

**Total Task 8 Tests**: **134 passed** (100% passing)  
**Total Full Backend Suite**: **600 passed, 0 failed, 0 regressions**

### 10.2 Real-Site Public Page Validation
The validation runner [`backend/scripts/validate_real_site_scoring.py`](file:///c:/Users/HP/Documents/raval-geo-intelligence/backend/scripts/validate_real_site_scoring.py) verifies the pipeline against live public URLs with offline fallback:
- **Homepage** (`https://www.python.org/`): Score 75.0/100 (Adequate)
- **About** (`https://www.python.org/about/`): Score 73.3/100 (Adequate)
- **Documentation** (`https://docs.python.org/3/`): Score 80.0/100 (Optimal)
- **Legal/Privacy** (`https://www.python.org/privacy/`): Score 76.7/100 (Adequate)
- **Aggregated Site Score**: 76.2/100 (Adequate)

---

## 11. Known Deprecations & Out-of-Scope Items

### Known Deprecation Warnings (Non-Breaking)
- Python 3.14 / SQLAlchemy: `datetime.utcnow()` deprecation notices across legacy modules (migrating to timezone-aware UTC timestamps scheduled for database layer modernization).
- Starlette TestClient / httpx: StarletteDeprecationWarning regarding test client transport adapter.

### Intentionally Out of Scope for Task 8
- Modifying underlying crawler engines or database schemas from Tasks 1–4.
- Third-party search engine index querying (all scoring is derived purely from on-page and extracted evidence).
- Hardcoded manual scoring overrides outside the centralized `ScoringConfig`.
