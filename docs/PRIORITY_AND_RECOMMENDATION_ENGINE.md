# Priority & Recommendation Engine (Task 8 - Step 8.6)

## 1. Executive Summary

Step 8.6 establishes the **Centralized Priority & Recommendation Engine** for the Raval AI Search Intelligence backend.

The engine transforms evaluated intelligence signals and score contributions into:
1. **Deterministic Priorities**: `Critical`, `High`, `Medium`, `Low`, and `Info`.
2. **Evidence-Backed Recommendations**: Categorized into `Quick Win` (fast impact / minimal effort) vs `Deep Fix` (content expansion / architectural restructuring).

---

## 2. Deterministic Priority Assignment Model

Priority calculation uses multi-factor analysis without arbitrary random thresholds:

| Priority Level | Determination Rules / Triggers |
| :--- | :--- |
| **Critical** | Finding severity is `critical`, or overall score impact is $\ge 12.0$ points, or structural/trust defect on homepage. |
| **High** | Finding severity is `high`, or overall score impact is $\ge 6.0$ points, or verified `FAIL` on core ranking requirement. |
| **Medium** | Finding severity is `medium`, or overall score impact is $\ge 2.5$ points. |
| **Low** | Finding severity is `low`, or overall score impact is $< 2.5$ points, or `WARNING` status. |
| **Info** | Status is `PASS`, `N/A`, or `UNKNOWN` (insufficient data). Does **not** receive an actionable failure priority. |

---

## 3. Recommendation Classification (Quick Win vs Deep Fix)

Remediations are classified deterministically based on rule scope and implementation effort:

### Quick Wins (`quick_win`)
- Title tag addition and optimization
- Meta description drafting
- Single H1 heading insertion / consolidation
- Author byline and publication date disclosure
- Contact info and business identity harmonization
- FAQPage schema injection

### Deep Fixes (`deep_fix`)
- Substantive topical depth and section expansion
- Outbound citation sourcing for factual claims
- Statistical verification and primary research anchoring
- Semantic entity cluster integration
- Complete topic gap remediation

---

## 4. Architectural Invariants

1. **No Recommendations for Passing or Inapplicable Checks**:
   - `PASS`, `N/A`, and `UNKNOWN` signals never produce negative recommendations.
2. **Duplicate Recommendation Prevention**:
   - Multiple signals or duplicate findings targeting the same underlying rule/issue generate exactly **one** consolidated recommendation.
3. **Traceability Guarantee**:
   - Every recommendation links directly to `recommendation_id`, `finding_id`, `rule_id`, `category`, `priority`, `classification`, `score_impact`, and supporting `evidence`.
4. **Idempotency**:
   - Consecutive runs with identical inputs produce identical recommendation sets and deterministic IDs.
