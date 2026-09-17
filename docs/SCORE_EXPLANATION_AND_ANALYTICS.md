# Score Explanation & Analytics Data Layer (Task 8 - Step 8.7)

## 1. Executive Summary

Step 8.7 implements the **Score Explanation & Analytics Data Layer** for the Raval AI Search Intelligence backend.

The layer provides:
1. **Human-Readable Score Explanations**: Transparent, evidence-grounded narratives for overall scores, category breakdowns, point deductions, verified passing strengths, N/A rules, and UNKNOWN missing-data areas.
2. **Structured Analytics Data Models**: Analytics-ready payloads (`PageScoreAnalytics`) for telemetry, reporting, and historical tracking without destructive overwriting.

---

## 2. Explanation Schema & Provenance Chain

$$\text{OVERALL SCORE} \rightarrow \text{CATEGORY} \rightarrow \text{RULE} \rightarrow \text{FINDING} \rightarrow \text{EVIDENCE} \rightarrow \text{DEDUCTION}$$

Every explanation response includes:
- **`overall_score` & `status`**: Bounded 0–100 score and health tier (`optimal`, `adequate`, `needs_improvement`, `deficient`).
- **`summary`**: Executive summary explaining primary performance drivers.
- **`category_explanations`**: Category narratives, score, weight, points lost, key strengths, and key deductions.
- **`deductions`**: Full list of point deductions with rule ID, category, point loss, human reason, and evidence excerpt.
- **`strengths`**: Verified passing checks backed by positive evidence.
- **`na_rules`**: Rules excluded due to inapplicability (with zero penalty).
- **`unknown_rules`**: Rules marked UNKNOWN due to insufficient source data (with zero failure penalty).
- **`traceability_summary`**: Quantitative count of signals evaluated, applicable rules, penalties applied, and duplicates prevented.

---

## 3. Historical Preservation & Analytics Data Layer

The `PageScoreAnalytics` model captures a snapshot of every page evaluation:
- `page_id`, `url`, `scan_id`, `website_id`
- `overall_score`, `status`, `category_scores`
- `finding_counts` by category
- `priority_counts` (Critical, High, Medium, Low, Info)
- `recommendation_counts` (Total, Quick Wins, Deep Fixes)
- `applicability_counts` (PASS, FAIL, WARNING, N/A, UNKNOWN)
- `total_points_deducted`
- `timestamp` (ISO 8601 UTC)

Historical records coexist cleanly across multiple scan runs to enable temporal progress tracking and longitudinal reporting.
