# Deterministic Scoring Engine & Finding Traceability (Task 8 - Steps 8.4 & 8.5)

## 1. Executive Summary & Objective

Steps 8.4 and 8.5 establish the **Centralized Deterministic 0–100 Scoring Engine** and the **End-to-End Score & Finding Traceability System** for the Raval AI Search Intelligence backend.

The engine transforms multi-engine intelligence signals into bounded, explainable category scores and an overall score, while preserving complete auditability through the full provenance chain:

$$\text{SCORE} \rightarrow \text{CATEGORY} \rightarrow \text{RULE} \rightarrow \text{SIGNAL} \rightarrow \text{EVIDENCE} \rightarrow \text{FINDING}$$

---

## 2. Canonical Scoring Categories & Weights

The scoring system organizes all intelligence signals into 5 canonical categories with normalized weights summing to 1.0 (100%):

| Category Key | Display Name | Normalized Weight | Included Sub-Domains | Originating Modules |
| :--- | :--- | :--- | :--- | :--- |
| `trust_transparency` | **Trust & Transparency** | **20%** (`0.20`) | Author credentials, contact info, business identity, legal transparency | `trust_engine`, `transparency_engine` |
| `authority_citations` | **Authority & Citations** | **25%** (`0.25`) | Topical authority, source quality, claim support, citation readiness | `authority_engine`, `source_engine`, `claim_support_engine`, `source_quality_engine`, `citation_readiness_engine` |
| `content_quality` | **Content Quality & Gaps** | **25%** (`0.25`) | Content depth, reading time, content gaps, quality checks | `quality_analyzer`, `content_gap_analyzer`, `content_quality_checks`, `content_intelligence` |
| `content_structure` | **Content & DOM Structure** | **15%** (`0.15`) | Heading hierarchy, main content extraction, HTML integrity | `content_structure_analyzer`, `page_extractor` |
| `semantic_readiness` | **Semantic Coverage & Readiness** | **15%** (`0.15`) | Semantic breadth, search intent alignment, question/answering readiness | `topic_analyzer`, `intent_analyzer`, `question_analyzer`, `answer_analyzer`, `readiness_analyzer`, `semantic_coverage_analyzer` |

---

## 3. Mathematical Scoring Formulas

### Category Score Formula
For any category $c$, let $S_c$ be the set of active, applicable rules evaluated in that category:

$$\text{Category Score}_c = \begin{cases} 100.0 & \text{if } \sum_{i \in S_c} w_i = 0 \\ \min\left(100.0, \max\left(0.0, \frac{\sum_{i \in S_c} (w_i \times \text{credit}_i)}{\sum_{i \in S_c} w_i} \times 100.0\right)\right) & \text{otherwise} \end{cases}$$

Where:
- $w_i$: Rule weight (default $1.0$).
- $\text{credit}_i$: Status credit awarded:
  - $\text{credit}(\text{PASS}) = 1.0$ (100% credit / 0 penalty)
  - $\text{credit}(\text{WARNING}) = 0.5$ (50% partial credit / defined warning factor)
  - $\text{credit}(\text{FAIL}) = 0.0$ (0% credit / full penalty)
  - $\text{credit}(\text{N/A}) \rightarrow$ **Excluded from $S_c$** (0 penalty)
  - $\text{credit}(\text{UNKNOWN}) \rightarrow$ **Excluded from $S_c$** (0 failure penalty)

### Overall Score Formula
The overall score is the weighted average across all categories, strictly clamped to $[0.0, 100.0]$:

$$\text{Overall Score} = \min\left(100.0, \max\left(0.0, \frac{\sum_{c} (W_c \times \text{Category Score}_c)}{\sum_{c} W_c}\right)\right)$$

### Health Status Tiers
- **Optimal**: $\text{Overall Score} \ge 80.0$
- **Adequate**: $65.0 \le \text{Overall Score} < 80.0$
- **Needs Improvement**: $50.0 \le \text{Overall Score} < 65.0$
- **Deficient**: $\text{Overall Score} < 50.0$

---

## 4. Status Semantics & Missing Data Invariant

> [!IMPORTANT]
> **No Synthetic Penalties on Missing Data**
> 1. **`N/A` (Inapplicable)**: Zero penalty. Excluded from calculation.
> 2. **`UNKNOWN` (Insufficient Data)**: Zero penalty. Excluded from calculation. Missing data **never** becomes a failure.
> 3. **`WARNING` (Cautionary / Partial)**: Fixed 50% partial credit.
> 4. **`FAIL` (Verified Defect)**: Applied only when sufficient evidence confirms non-compliance.

---

## 5. Duplicate Penalty Prevention Strategy

To prevent a single underlying defect or missing requirement from penalizing the score multiple times:
1. Every evaluated signal generates a deterministic identity key (`rule_id::target`).
2. When multiple signals share the same identity key, only the primary observation contributes to the score.
3. Subsequent duplicate signals are marked `is_skipped = True` with `skip_reason = "duplicate_prevention"`.
4. Duplicate records remain in the audit trail (`traceability_chain`) for transparency, but do not deduct points.

---

## 6. End-to-End Traceability (Step 8.5)

Every score calculation produces a full audit trail of `ScoreContribution` objects detailing:
- **`rule_id`**: Which rule was evaluated.
- **`category`**: Which category it affected.
- **`source_module`**: Which engine produced the evidence.
- **`status` / `applicability`**: Evaluation state (`PASS`, `FAIL`, `WARNING`, `N/A`, `UNKNOWN`).
- **`credit_ratio` / `weight`**: Credit achieved and rule weighting.
- **`category_point_impact`**: Exact percentage point deduction or contribution to the category.
- **`overall_point_impact`**: Exact percentage point impact on the final overall score.
- **`finding_id` / `finding_type` / `finding_severity`**: Associated finding links.
- **`evidence` / `value`**: Preserved raw evidence supporting the decision.
- **`rationale`**: Human-readable explanation of why the point adjustment was made or skipped.

---

## 7. Usage Example

```python
from app import (
    ApplicabilityContext,
    calculate_deterministic_score,
    ScoringCategory,
)

# 1. Provide context
context = ApplicabilityContext.from_page_data(
    url="https://example.com/article/ai-guide",
    text_content="Article text...",
    raw_html="<html>...</html>",
    headings_count=3,
)

# 2. Calculate score
result = calculate_deterministic_score(signals, context=context)

print(f"Overall Score: {result.overall_score}/100 ({result.status})")

for cat_key, cat_res in result.category_scores.items():
    print(f"  - {cat_res.name}: {cat_res.score}/100 (Weight: {cat_res.weight * 100}%)")

# 3. Query audit trail
penalties = result.get_penalized_contributions()
print(f"Total Penalties Applied: {len(penalties)}")

for p in penalties:
    print(f"  Deduction in {p.category}: Rule '{p.rule_id}' (Impact: {p.overall_point_impact} pts) - {p.rationale}")
```
