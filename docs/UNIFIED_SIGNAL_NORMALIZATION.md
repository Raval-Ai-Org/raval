# Unified Signal Normalization (Task 8 - Step 8.2)

## 1. Executive Summary & Motivation

Across Tasks 5, 6, and 7, Raval AI Search Intelligence introduced specialized, deterministic analytical engines:
- **Task 5**: Content Intelligence (structure, topics, entities, questions, answers, gaps, quality evidence, search intent, semantic coverage).
- **Task 6**: Opportunity Generation, Fix Plan Generation, and Automated Fix Validation.
- **Task 7**: Authority, Citation, Trust, External Sources, Claim-Support, and First-Party Transparency.

While each engine was built with deterministic schemas suited to its domain, multi-engine synthesis and cross-engine intelligence aggregation in Task 8 require a single, standardized, explainable contract: the **Unified Signal Normalization Layer**.

### Core Principle: Evidence != Conclusion

> [!IMPORTANT]
> **Evidence != Conclusion**
> The unified normalized signal represents observed evidence, deterministic structural detections, and traceable extraction data. It does **NOT** invent authority, ranking, GEO, AEO, SEO, or AI-visibility guarantees. It preserves original facts without transforming evidence into ungrounded conclusions.

---

## 2. Unified Signal Contract

The canonical normalized contract is defined in `backend/app/unified_signal.py` as `UnifiedSignal`.

```json
{
  "rule_id": "trust_author_credentials_present",
  "status": "detected",
  "value": true,
  "evidence": {
    "byline": "By Dr. Jane Doe, Ph.D.",
    "degree": "Ph.D."
  },
  "confidence": "high",
  "source_module": "trust_engine",
  "applicability": "applicable"
}
```

### Field Definitions

| Field | Type | Description |
| :--- | :--- | :--- |
| `rule_id` | `str` | Stable, deterministic identifier for the underlying rule, check, or extraction signal (e.g., `trust_author_credentials_present`, `R-STR-01`, `source_quality_assessment`). |
| `status` | `str` | Preserved or deterministically mapped state (e.g., `detected`, `missing`, `pass`, `fail`, `warn`, `verified`, `partial`, `supported`, `unsupported`, `high`, `adequate`, `weak`, `broken`). |
| `value` | `Any` | Observed signal value preserved across JSON types (boolean, numeric, string, list, dict, or None). |
| `evidence` | `dict \| list \| Any` | Traceable extraction evidence supporting the signal without conversion into unsupported claims. |
| `confidence` | `str` | Detection confidence level (`high`, `medium`, `low`). Preserves source confidence or applies documented deterministic fallbacks. |
| `source_module` | `str` | Canonical name of the originating engine or analyzer module. |
| `applicability` | `str` | Semantic applicability of the signal to the target object (`applicable`, `not_applicable`, `conditional`, `informational`). |

#### Optional Auxiliary Fields
- `title`: Human-readable label describing the signal.
- `description`: Detailed explanation of what the signal measures.
- `category`: Category classification (e.g., `trust`, `authority`, `structure`, `claims`, `source_quality`).
- `severity`: Severity level (`critical`, `high`, `medium`, `low`, `info`) if derived from a finding or check.
- `metadata`: Non-destructive dictionary for execution metadata and originating type traceability.

---

## 3. Status Handling & Vocabulary Mapping

The normalization layer preserves original source engine statuses whenever possible and avoids lossy reinterpretation:

| Source Module | Original State | Normalized `status` | Semantics |
| :--- | :--- | :--- | :--- |
| `trust_engine` | `detected` / `missing` / `partial` / `verified` | Preserved directly | Structural presence of trust indicators. |
| `authority_engine` | `detected` / `missing` / `verified` / `weak` / `strong` | Preserved directly | Depth and credential backing. |
| `source_engine` | `valid` / `broken` / `redirect` / `unverified` | Preserved directly | External source availability. |
| `claim_support_engine` | `has_associated_source = True / False` | `supported` / `unsupported` | Claim citation support linkage. |
| `source_quality_engine` | `high` / `adequate` / `weak` / `broken` | Preserved directly | Primary-source and anchor quality tier. |
| `citation_readiness_engine` | `high` / `moderate` / `low` | Preserved directly | Aggregate structural citation readiness. |
| `content_quality_checks` | `pass` / `fail` / `warn` | Preserved directly | Content integrity evaluation. |
| `findings` / `rules` | `open` / `resolved` / `pass` / `fail` | Preserved directly | Actionable finding state. |

---

## 4. Confidence Handling & Fallback Rules

1. **Enum / String Preservation**: If the source object specifies a `ConfidenceLevel` enum or string (`high`, `medium`, `low`), it is preserved directly.
2. **Numeric Confidence Mapping**: If the source provides numeric confidence (e.g. `0.88`), it is deterministically mapped:
   - `confidence >= 0.70` $\rightarrow$ `"high"`
   - `0.40 <= confidence < 0.70` $\rightarrow$ `"medium"`
   - `confidence < 0.40` $\rightarrow$ `"low"`
3. **Deterministic Extraction Fallback**: Structural extraction rules that verify factual DOM existence (e.g., presence of schema markup, headings, links) default to `"high"` confidence.
4. **Heuristic Rule Fallback**: Statistical or heuristic detectors default to `"medium"` confidence.

---

## 5. Applicability Semantics

Signals convey how they relate to the analyzed document using `ApplicabilityType`:

- `applicable`: The rule or signal directly applies to the target page or content (standard default).
- `not_applicable`: The rule cannot be evaluated or is out of scope (e.g., claim coverage checks when 0 claims were detected, or question-answering checks when no questions exist on the page).
- `conditional`: Applicability depends on a secondary condition (e.g., FAQ structured data only applies if questions are present).
- `informational`: Diagnostic telemetry or descriptive metadata (e.g., raw token counts) rather than quality pass/fail criteria.

---

## 6. Adapter & Normalization Architecture

The normalization pipeline is implemented in `UnifiedSignalNormalizer`:

```text
+-------------------------------------------------------------+
|               Existing Task 5–7 Engine Outputs               |
|  - TrustSignalContract / TrustSignalResult                  |
|  - AuthoritySignalContract / AuthoritySignalResult          |
|  - ExternalSourceContract / ExternalSourceResult            |
|  - SupportNeededClaimContract / ClaimSupportResult          |
|  - SourceQualityAssessment / SourceQualityResult            |
|  - CitationReadinessContract / AuthorityCitationTrustResult |
|  - ContentIntelligenceSummary / QualityAnalysisEvidence     |
|  - FindingCreate / FindingResponse / Finding                |
+-------------------------------------------------------------+
                                |
                                v
               +----------------------------------+
               |     UnifiedSignalNormalizer      |
               |  (Deepcopy / Non-Mutating / Safe)|
               +----------------------------------+
                                |
                                v
               +----------------------------------+
               |          UnifiedSignal           |
               | (One canonical, explainable JSON)|
               +----------------------------------+
                                |
                                v
               +----------------------------------+
               |        UnifiedSignalBatch        |
               |  (Ready for Task 8 Aggregation)  |
               +----------------------------------+
```

### Universal Entry Points
- `normalize_signal(obj, source_module=None, **kwargs) -> list[UnifiedSignal]`
- `normalize_signals(items, metadata=None) -> UnifiedSignalBatch`

---

## 7. Compatibility with Task 5–7 Engines

All existing Task 5–7 engines remain untouched and independently operable. The normalization layer acts as a pure, non-destructive adapter without side effects or mutation.

| Source Module | Contract / Dataclass | Normalized Output |
| :--- | :--- | :--- |
| `trust_engine` | `TrustSignalContract` / `TrustSignalResult` | `UnifiedSignal` (rule_id: `trust_*`) |
| `authority_engine` | `AuthoritySignalContract` / `AuthoritySignalResult` | `UnifiedSignal` (rule_id: `authority_*`) |
| `source_engine` | `ExternalSourceContract` / `ExternalSourceResult` | `UnifiedSignal` (rule_id: `source_external_link_detected`) |
| `claim_support_engine` | `SupportNeededClaimContract` / `SourceAssociationContract` | `UnifiedSignal` (rule_id: `claim_support_*`, `source_association_*`) |
| `source_quality_engine` | `SourceQualityAssessment` / `SourceQualityResult` | `UnifiedSignal` (rule_id: `source_quality_assessment`) |
| `transparency_engine` | `FirstPartyTransparencyResult` | `UnifiedSignal` (rule_id: `transparency_*`) |
| `citation_readiness_engine` | `CitationReadinessContract` / `AuthorityCitationTrustResult` | `list[UnifiedSignal]` (`citation_readiness_level`, `citation_has_verifiable_sources`, etc.) |
| `content_intelligence_analyzer` | `ContentIntelligenceSummary` | `list[UnifiedSignal]` (`content_word_count`, `content_primary_topic`, `content_search_intent`, etc.) |
| `quality_analyzer` | `QualityAnalysisEvidence` | `list[UnifiedSignal]` (`quality_evidence_score`, `quality_quantitative_data_points`, etc.) |
| `topic_analyzer` | `TopicAnalysisEvidence` | `list[UnifiedSignal]` (`topic_primary_topic`, `topic_lexical_diversity`, etc.) |
| `content_gap_analyzer` | `ContentGapEvidence` / `ContentGapItem` | `list[UnifiedSignal]` (`content_gaps_total`, `content_gap_*`) |
| `content_quality_checks` | `ContentQualityChecksResult` / `QualityCheckItem` | `list[UnifiedSignal]` (`quality_check_*`) |
| Findings | `FindingCreate` / `FindingResponse` / `Finding` / dict | `UnifiedSignal` (rule_id: finding type) |
