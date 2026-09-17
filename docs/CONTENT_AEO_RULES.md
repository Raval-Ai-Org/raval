# Content AEO, GEO & SEO Intelligence Rules & Specification

## 1. Architectural Philosophy

The Raval GEO & AEO Content Intelligence Engine operates on three inviolable foundational principles:

1. **Evidence != Conclusion**:
   - Extraction layers extract objective observable facts (e.g. heading tags, numbers, keywords, schema blocks).
   - Analytical layers evaluate patterns and relationships against deterministic rules.
   - Conclusions, scores, and findings are derived deterministically without ungrounded hallucinations.

2. **Deterministic & Explainable**:
   - Zero black-box prompts for core grading.
   - Every score is mathematically auditable, bounded between `0.0` and `1.0`.
   - Every finding provides the exact evidence payload, line/sentence reference, severity, and remediation guidance.

3. **Multi-Tenant & Scan Isolation**:
   - All analyses, findings, and summaries are strictly bound to `(website_id, scan_id, page_id)`.
   - Historical scans remain immutable upon rescanning.
   - Graceful resilience: missing, empty, malformed, or truncated content never crashes a scan.

---

## 2. The 11 Content Intelligence Analytical Engines

```text
Crawled HTML & Page Extraction Evidence
               │
               ▼
┌─────────────────────────────────────────────────────────────┐
│ 1. Content Quality & Integrity Checks (Safety & Malformation)│
└──────────────────────────────┬──────────────────────────────┘
                               │
       ┌───────────────────────┴───────────────────────┐
       ▼                                               ▼
┌──────────────────────────────┐        ┌──────────────────────────────┐
│ 2. Content Structure Engine   │        │ 3. Topic / Semantic Engine   │
│  - H1 count & hierarchy      │        │  - Primary & supporting      │
│  - Section segmentation      │        │  - Lexical diversity         │
│  - Title/H1 alignment        │        │  - Keyword density & stuffing│
└──────────────┬───────────────┘        └──────────────┬───────────────┘
               │                                       │
       ┌───────┴───────────────────────────────────────┴───────┐
       ▼                                                       ▼
┌──────────────────────────────┐        ┌──────────────────────────────┐
│ 4. Entity Analysis Engine    │        │ 5. Question & Answer Engine  │
│  - Named entity detection    │        │  - Heading & body questions  │
│  - Entity classification     │        │  - Direct answer snippets    │
│  - Schema entity cross-check │        │  - FAQPage detection         │
└──────────────┬───────────────┘        └──────────────┬───────────────┘
               │                                       │
       ┌───────┴───────────────────────────────────────┴───────┐
       ▼                                                       ▼
┌──────────────────────────────┐        ┌──────────────────────────────┐
│ 6. Answer-Readiness Scorer   │        │ 7. Content Gap Detector      │
│  - Answer directness         │        │  - Unanswered questions      │
│  - List & table presence     │        │  - Missing domain facets     │
│  - Readiness level grading   │        │  - Competitive dimensions    │
└──────────────┬───────────────┘        └──────────────┬───────────────┘
               │                                       │
       ┌───────┴───────────────────────────────────────┴───────┐
       ▼                                                       ▼
┌──────────────────────────────┐        ┌──────────────────────────────┐
│ 8. Quality & Evidence Engine │        │ 9. Search Intent Engine      │
│  - Empirical data points     │        │  - Primary intent class      │
│  - External citations        │        │  - Conflicting signals       │
│  - Unsupported claims        │        │  - Transactional balance     │
└──────────────┬───────────────┘        └──────────────┬───────────────┘
               │                                       │
               └───────────────────────┬───────────────┘
                                       │
                                       ▼
                     ┌───────────────────────────────────┐
                     │ 10. Semantic Coverage Engine      │
                     │  - Domain breadth & depth         │
                     │  - Concept presence & gaps        │
                     └─────────────────┬─────────────────┘
                                       │
                                       ▼
                     ┌───────────────────────────────────┐
                     │ 11. Master Content Intelligence   │
                     │  - Weighted composite scoring     │
                     │  - Status: optimal/needs/deficient│
                     │  - Strengths, issues, findings    │
                     └───────────────────────────────────┘
```

---

## 3. Rules Catalog

### 3.1 Content Structure Rules (`structure`)

| Rule ID | Name | Severity | Weight | Condition | Recommendation |
| --- | --- | --- | --- | --- | --- |
| `R-STR-01` | Missing H1 Heading | High | 1.0 | `h1_count == 0` | Add a single, descriptive H1 heading aligned with the page title and primary topic. |
| `R-STR-02` | Multiple H1 Headings | Medium | 0.8 | `h1_count > 1` | Consolidate page structure into exactly one primary H1 heading; use H2 and H3 for sub-sections. |
| `R-STR-03` | Heading Hierarchy Skip | Medium | 0.6 | `len(heading_level_skips) > 0` | Maintain a strict, sequential heading hierarchy (e.g. H1 -> H2 -> H3). |
| `R-STR-04` | Long Text Block | Low | 0.4 | `words > 150 without break` | Break dense paragraphs into bite-sized explanations, bullet points, or subheadings. |
| `R-STR-05` | Title/H1 Misalignment | Medium | 0.7 | `title_h1_alignment.aligned is False` | Align the primary keyword and topic across both the document title and the primary H1. |

### 3.2 Topic & Semantic Rules (`topic`)

| Rule ID | Name | Severity | Weight | Condition | Recommendation |
| --- | --- | --- | --- | --- | --- |
| `R-TOP-01` | Primary Topic Absent From Title/H1 | High | 1.0 | `topic not in title or h1` | Incorporate the core subject keyword directly into the document title and primary H1. |
| `R-TOP-02` | Keyword Stuffing | High | 0.9 | `max_keyword_density > 0.045` | Reduce repetition of the primary keyword; use natural synonyms and related semantic concepts. |
| `R-TOP-03` | Low Lexical Diversity | Medium | 0.6 | `lexical_diversity < 0.25` | Expand explanatory depth by introducing domain-specific terminology, examples, and nuances. |

### 3.3 Question & Answer Rules (`questions`)

| Rule ID | Name | Severity | Weight | Condition | Recommendation |
| --- | --- | --- | --- | --- | --- |
| `R-QNA-01` | Unanswered Question Heading | High | 1.0 | `unanswered_count > 0` | Provide a direct, complete 1–3 sentence answer immediately following any question heading. |
| `R-QNA-02` | Absence of Direct Answer | Medium | 0.7 | `direct_answer_count == 0` | Structure answer sections with clear direct answers (e.g. `[Subject] is [definition]...`). |
| `R-QNA-03` | Missing FAQ Schema | Medium | 0.6 | `question_count >= 2 and not faq_schema` | Mark up Q&A sections with valid Schema.org FAQPage JSON-LD structured data. |

### 3.4 Answer-Readiness & Content Gap Rules (`readiness`, `content_gaps`)

| Rule ID | Name | Severity | Weight | Condition | Recommendation |
| --- | --- | --- | --- | --- | --- |
| `R-RED-01` | Low Answer Readiness | High | 1.0 | `answer_readiness_score < 0.50` | Add structured lists, concise definitions, and direct answers to primary user questions. |
| `R-GAP-01` | Missing Essential Dimensions | Medium | 0.8 | `len(unaddressed_facets) > 0` | Cover standard dimensions including costs, comparison against alternatives, and implementation steps. |

### 3.5 Quality & Evidence Rules (`quality_evidence`)

| Rule ID | Name | Severity | Weight | Condition | Recommendation |
| --- | --- | --- | --- | --- | --- |
| `R-EV-01` | Unsupported Superlative | High | 1.0 | `unsupported_claims > 0` | Back superlative claims with verified benchmark metrics, third-party awards, or empirical citations. |
| `R-EV-02` | No Empirical Data Points | Medium | 0.8 | `data_points == 0` | Incorporate authoritative figures, specifications, percentages, and data points into the analysis. |

### 3.6 Intent & Semantic Coverage Rules (`search_intent`, `semantic_coverage`)

| Rule ID | Name | Severity | Weight | Condition | Recommendation |
| --- | --- | --- | --- | --- | --- |
| `R-INT-01` | Conflicting Intent Signals | Medium | 0.7 | `len(conflicts) > 0` | Clarify primary intent: provide educational answers first before presenting commercial offers. |
| `R-SEM-01` | Low Semantic Coverage | Medium | 0.8 | `semantic_coverage < 0.50` | Expand coverage of core semantic terms, related subtopics, and contextual relationships. |

### 3.7 Content Integrity & Resilience Checks (`content_checks`)

| Rule ID | Name | Severity | Weight | Condition | Recommendation |
| --- | --- | --- | --- | --- | --- |
| `R-CHK-01` | Empty Content | High | 1.0 | `body_text == ''` | Ensure page renders meaningful HTML body content on initial HTTP GET. |
| `R-CHK-02` | Thin Content | High | 0.9 | `word_count < 35` | Expand body text to at least 150+ words of informative, original content. |
| `R-CHK-03` | Missing Title & H1 | High | 0.8 | `title is None and h1 is None` | Add a unique `<title>` tag and a clear `<h1>` heading to the document. |

---

## 4. Master Scoring Formulas

### 4.1 Overall Content Score
$$\text{OverallScore} = 0.25 \times S_{\text{structure}} + 0.25 \times S_{\text{readiness}} + 0.25 \times S_{\text{quality}} + 0.25 \times S_{\text{coverage}}$$

Where:
- $S_{\text{structure}}$ = 1.0 - penalties for missing H1 (0.35), multiple H1 (0.20), hierarchy skips (0.15), misalignment (0.20), long blocks (0.10).
- $S_{\text{readiness}}$ = $0.35 \times S_{\text{structural}} + 0.35 \times S_{\text{qna}} + 0.30 \times S_{\text{quality}}$.
- $S_{\text{quality}}$ = Base (0.50) + DataPoints (up to 0.25) + Citations/Attributions (up to 0.25) - SuperlativePenalties (up to 0.40) - ThinPenalties (up to 0.20).
- $S_{\text{coverage}}$ = $0.40 \times \text{breadth} + 0.30 \times \text{terms} + 0.30 \times \text{entities}$.

### 4.2 Content Status Thresholds
- **Optimal (`optimal`)**: $\text{OverallScore} \ge 0.75$
- **Needs Improvement (`needs_improvement`)**: $0.45 \le \text{OverallScore} < 0.75$
- **Deficient (`deficient`)**: $\text{OverallScore} < 0.45$
