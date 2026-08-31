# Signal Aggregation & Deduplication (Task 8 - Step 8.3)

## 1. Executive Summary & Objective

Step 8.3 establishes the **Centralized Signal Aggregation and Deduplication Layer** for the Raval AI Search Intelligence backend.

Following the introduction of the canonical `UnifiedSignal` contract in Step 8.2, Step 8.3 provides a unified engine (`SignalAggregator`) and canonical container (`AggregatedSignalCollection`) to:
1. Aggregate heterogeneous normalized signals produced across all Task 5–7 intelligence modules.
2. Deduplicate semantically equivalent signals using deterministic identity rules.
3. Merge duplicate observations without data loss (highest confidence, union of evidence, complete source module attribution).
4. Detect, safely resolve, and record conflicting observations across duplicate sources with full traceability.

### Core Architectural Invariant: Evidence != Conclusion

> [!IMPORTANT]
> **Evidence != Conclusion**
> The aggregation and deduplication layer consolidates observed structural evidence. It does **NOT** invent scores, synthesize ungrounded ranking claims, or fabricate confidence levels. All merged signals maintain full traceability back to their originating modules and evidence.

---

## 2. Architecture & Data Flow

```text
+---------------------------------------------------------------------------------+
|                        Heterogeneous Task 5–7 Sources                           |
|  - Task 5 Content Intelligence (structure, topics, quality, intent, gaps)       |
|  - Task 6 Findings & Recommendations                                            |
|  - Task 7 Authority, Citation, Trust, Claims, Sources, Transparency             |
+---------------------------------------------------------------------------------+
                                         |
                                         v
                      +--------------------------------------+
                      |  UnifiedSignalNormalizer (Step 8.2)  |
                      +--------------------------------------+
                                         |
                                         v  (Normalized UnifiedSignals)
                      +--------------------------------------+
                      |       SignalAggregator (Step 8.3)    |
                      |  - Deduplication Key Discriminator   |
                      |  - Confidence & Evidence Merging     |
                      |  - Conflict Detection & Metadata     |
                      |  - Non-Mutating / Deepcopy Protected |
                      +--------------------------------------+
                                         |
                                         v
                      +--------------------------------------+
                      |     AggregatedSignalCollection       |
                      |  - signals: list[UnifiedSignal]      |
                      |  - duplicate_count, conflict_count   |
                      |  - query helpers (rule, module, etc.)|
                      +--------------------------------------+
```

---

## 3. Deduplication Key Strategy

To ensure genuine distinct signals are never improperly merged while exact and semantic duplicates are consolidated, `get_deduplication_key` implements a deterministic identity strategy:

1. **Page-Level Signals**:
   - Single-instance page-level evaluations (e.g. `content_word_count`, `content_primary_topic`, `citation_readiness_level`, `trust_author_credentials_present`, `transparency_business_identity_consistent`, `R-STR-01`) use their normalized `rule_id` as the identity key.
2. **Item-Level Signals**:
   - Signals evaluating specific target resources append a target discriminator:
     - **External Source Links** (`source_external_link_detected`, `source_quality_assessment`): `rule_id::{normalized_url}`
     - **Claims** (`claim_support_*`): `rule_id::{claim_id}` or `rule_id::{normalized_claim_text_snippet}`
     - **Source Associations** (`source_association_*`): `rule_id::{source_url}::{claim_id}`
     - **Content Gaps** (`content_gap_*`): `rule_id::{missing_element_snippet}`
     - **Quality Checks** (`quality_check_*`): `rule_id::{check_name}`
     - **Location-Specific Findings**: `rule_id::{location}`

---

## 4. Merging Duplicate Signals

When multiple duplicate signals match the same identity key, they are merged according to the following deterministic rules:

### A. Canonical Rule ID & Classification
- The canonical `rule_id` is preserved.
- The title, description, category, and severity are inherited from the primary signal (highest confidence / verified observation).

### B. Source Module Provenance
- The primary signal's source module becomes `source_module`.
- All contributing modules across all duplicates are recorded in order of appearance in `metadata["contributing_modules"]` (e.g., `["trust_engine", "transparency_engine"]`).

### C. Confidence Selection
- The resulting confidence is the highest valid confidence present among duplicates based on the contract hierarchy:
  $$\text{"high"} > \text{"medium"} > \text{"low"}$$
- Confidence is **never fabricated** or inflated beyond observed values.

### D. Evidence Merging
- **Dictionaries**: Recursively merged without data loss. If two duplicates provide different keys, both are preserved. If a key has conflicting primitive values, the existing value is kept and the alternative is recorded under `_evidence_alternatives`.
- **Lists**: Combined and deduplicated while preserving stable ordering.
- **Primitives**: The most complete / non-null value is preserved.

### E. Applicability Resolution
- Evaluated with logical precedence:
  $$\text{"applicable"} > \text{"conditional"} > \text{"informational"} > \text{"not_applicable"}$$

---

## 5. Conflict Handling & Explainability

When duplicate signals report contradictory statuses (e.g., `trust_engine` reports `detected` while `transparency_engine` reports `missing`) or contradictory boolean values:

1. **No Silent Data Loss**: All observations are preserved.
2. **Flagging**: `metadata["has_conflict"] = True`.
3. **Structured Conflict Log**: `metadata["conflicts"]` captures a complete list of all competing observations with their originating source module, status, value, confidence, and evidence.
4. **Human-Readable Summary**: `metadata["conflict_summary"]` provides an immediate explanation:
   ```text
   Conflicting observations detected across 2 sources: trust_engine ('detected'), transparency_engine ('missing')
   ```
5. **Deterministic Primary Status**: Resolved deterministically in favor of higher confidence and verified evidence.

---

## 6. AggregatedSignalCollection API

```python
class AggregatedSignalCollection(BaseModel):
    total_input_signals: int
    total_unique_signals: int
    duplicate_count: int
    conflict_count: int
    signals: list[UnifiedSignal]
    source_modules: list[str]
    categories: list[str]
    metadata: dict[str, Any]

    # Query Helpers:
    def get_by_rule_id(rule_id: str) -> list[UnifiedSignal]
    def get_by_module(source_module: str) -> list[UnifiedSignal]
    def get_by_category(category: str) -> list[UnifiedSignal]
    def get_conflicted() -> list[UnifiedSignal]
    def to_dict() -> dict[str, Any]
```

---

## 7. Universal Usage Examples

```python
from app import aggregate_signals, deduplicate_signals

# Aggregate a heterogeneous list of Task 5-7 results
collection = aggregate_signals([
    trust_signal_result,
    authority_signal_result,
    content_intelligence_summary,
    custom_finding,
])

print(f"Total Unique Signals: {collection.total_unique_signals}")
print(f"Duplicates Consolidated: {collection.duplicate_count}")
print(f"Conflicted Signals: {collection.conflict_count}")

# Retrieve trust signals
trust_signals = collection.get_by_module("trust_engine")

# Retrieve any signals with cross-engine conflict
conflicts = collection.get_conflicted()
```
