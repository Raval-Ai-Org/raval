"""
Signal Aggregator & Deduplication Engine (Task 8 - Step 8.3)

Centralized aggregation and deduplication layer that consumes normalized `UnifiedSignal`
objects (produced by Step 8.2 normalization adapters or Task 5-7 engines) and safely
aggregates, deduplicates, and resolves conflicts across multi-engine intelligence.

Strict Architectural Invariants:
1. EVIDENCE != CONCLUSION: Merged signals preserve observed structural evidence without
   converting evidence into unsupported claims or fabricated scores.
2. DETERMINISTIC & REPEATABLE: Aggregation and deduplication produce identical, order-stable
   results on identical inputs.
3. FULL TRACEABILITY: Preserves all contributing source modules, evidence variants, and
   conflicting observations in explainable metadata.
4. NON-MUTATING & PURE: Input objects and evidence dictionaries are never modified.
5. CONTRACT COMPATIBILITY: Builds strictly on the canonical `UnifiedSignal` contract.
"""

from copy import deepcopy
from datetime import datetime, timezone
import re
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from .unified_signal import (
    ApplicabilityType,
    UnifiedSignal,
    UnifiedSignalBatch,
    UnifiedSignalNormalizer,
    normalize_signal,
)

# Confidence ranking for deterministic comparison
CONFIDENCE_RANK = {
    "high": 3,
    "medium": 2,
    "low": 1,
}

# Status ranking for deterministic primary status resolution in case of ties
STATUS_PRIORITY = {
    "verified": 6,
    "pass": 5,
    "detected": 4,
    "supported": 4,
    "optimal": 4,
    "strong": 4,
    "adequate": 3,
    "moderate": 3,
    "partial": 2,
    "warn": 2,
    "unsupported": 1,
    "missing": 1,
    "deficient": 1,
    "weak": 1,
    "fail": 1,
    "broken": 1,
    "open": 1,
}


class AggregatedSignalCollection(BaseModel):
    """
    Canonical container representing a collection of aggregated and deduplicated signals.
    Provides query helpers for rule IDs, source modules, categories, and conflicted signals.
    """
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    total_input_signals: int = Field(default=0, description="Total raw input signals before deduplication")
    total_unique_signals: int = Field(default=0, description="Total deduplicated unique signals in collection")
    duplicate_count: int = Field(default=0, description="Count of redundant signals consolidated")
    conflict_count: int = Field(default=0, description="Count of signals that had conflicting duplicate observations")
    signals: list[UnifiedSignal] = Field(default_factory=list, description="Ordered list of deduplicated UnifiedSignal objects")
    source_modules: list[str] = Field(default_factory=list, description="List of all unique contributing source modules")
    categories: list[str] = Field(default_factory=list, description="List of all unique signal categories represented")
    metadata: dict[str, Any] = Field(default_factory=dict, description="Aggregation execution metadata")

    def get_by_rule_id(self, rule_id: str) -> list[UnifiedSignal]:
        """Retrieve all signals matching a specific rule_id."""
        if not rule_id:
            return []
        target = rule_id.strip().lower()
        return [s for s in self.signals if s.rule_id.strip().lower() == target]

    def get_by_module(self, source_module: str) -> list[UnifiedSignal]:
        """Retrieve all signals originating from or contributed to by a specific module."""
        if not source_module:
            return []
        target = source_module.strip().lower()
        results: list[UnifiedSignal] = []
        for s in self.signals:
            primary_mod = (s.source_module or "").strip().lower()
            contributing = [m.strip().lower() for m in s.metadata.get("contributing_modules", [])]
            if target == primary_mod or target in contributing:
                results.append(s)
        return results

    def get_by_category(self, category: str) -> list[UnifiedSignal]:
        """Retrieve all signals classified under a given category."""
        if not category:
            return []
        target = category.strip().lower()
        return [s for s in self.signals if (s.category or "").strip().lower() == target]

    def get_conflicted(self) -> list[UnifiedSignal]:
        """Retrieve all signals that had conflicting observations across duplicates."""
        return [s for s in self.signals if s.metadata.get("has_conflict", False)]

    def to_dict(self) -> dict[str, Any]:
        """Serialize collection to a JSON-compatible dictionary."""
        return self.model_dump()


class SignalAggregator:
    """
    Centralized Signal Aggregator & Deduplication Engine (Step 8.3).

    Aggregates normalized `UnifiedSignal` objects across Task 5-7 intelligence engines,
    deduplicates semantically equivalent signals, resolves conflicts safely, and
    preserves full evidence and provenance traceability.
    """

    def __init__(self, normalizer: UnifiedSignalNormalizer | None = None):
        self.normalizer = normalizer or UnifiedSignalNormalizer()

    def aggregate(
        self,
        inputs: Any,
        metadata: dict[str, Any] | None = None,
        preserve_order: bool = True,
    ) -> AggregatedSignalCollection:
        """
        Universal entry point to aggregate and deduplicate signals from any supported input:
        - List of `UnifiedSignal` objects
        - `UnifiedSignalBatch`
        - Heterogeneous list of Task 5-7 contracts / result objects / dicts
        - Single engine result object
        """
        if inputs is None:
            return AggregatedSignalCollection(
                total_input_signals=0,
                total_unique_signals=0,
                duplicate_count=0,
                conflict_count=0,
                signals=[],
                source_modules=[],
                categories=[],
                metadata=metadata or {"aggregated_at": datetime.now(timezone.utc).isoformat()},
            )

        # 1. Normalize all inputs into a flat list of UnifiedSignal objects
        raw_signals: list[UnifiedSignal] = []

        if isinstance(inputs, UnifiedSignalBatch):
            raw_signals = [s.model_copy(deep=True) for s in inputs.signals]
        elif isinstance(inputs, (list, tuple, set)):
            for item in inputs:
                if item is None:
                    continue
                if isinstance(item, UnifiedSignal):
                    raw_signals.append(item.model_copy(deep=True))
                elif isinstance(item, UnifiedSignalBatch):
                    raw_signals.extend([s.model_copy(deep=True) for s in item.signals])
                else:
                    normalized = self.normalizer.normalize(item)
                    raw_signals.extend(normalized)
        elif isinstance(inputs, UnifiedSignal):
            raw_signals = [inputs.model_copy(deep=True)]
        else:
            normalized = self.normalizer.normalize(inputs)
            raw_signals.extend(normalized)

        total_input_count = len(raw_signals)
        if total_input_count == 0:
            return AggregatedSignalCollection(
                total_input_signals=0,
                total_unique_signals=0,
                duplicate_count=0,
                conflict_count=0,
                signals=[],
                source_modules=[],
                categories=[],
                metadata=metadata or {"aggregated_at": datetime.now(timezone.utc).isoformat()},
            )

        # 2. Deduplicate signals
        deduplicated = self.deduplicate(raw_signals, preserve_order=preserve_order)

        # 3. Extract unique source modules and categories
        all_modules: set[str] = set()
        all_categories: set[str] = set()
        conflict_count = 0

        for sig in deduplicated:
            if sig.source_module:
                all_modules.add(sig.source_module)
            for m in sig.metadata.get("contributing_modules", []):
                if m:
                    all_modules.add(m)
            if sig.category:
                all_categories.add(sig.category)
            if sig.metadata.get("has_conflict", False):
                conflict_count += 1

        exec_metadata = deepcopy(metadata) if metadata else {}
        exec_metadata["aggregated_at"] = datetime.now(timezone.utc).isoformat()

        return AggregatedSignalCollection(
            total_input_signals=total_input_count,
            total_unique_signals=len(deduplicated),
            duplicate_count=total_input_count - len(deduplicated),
            conflict_count=conflict_count,
            signals=deduplicated,
            source_modules=sorted(list(all_modules)),
            categories=sorted(list(all_categories)),
            metadata=exec_metadata,
        )

    def deduplicate(
        self,
        signals: list[UnifiedSignal],
        preserve_order: bool = True,
    ) -> list[UnifiedSignal]:
        """
        Deduplicates a list of UnifiedSignal instances using stable identity rules.
        Preserves original input objects without mutation.
        """
        if not signals:
            return []

        # Group signals by their deterministic deduplication key
        grouped: dict[str, list[UnifiedSignal]] = {}
        ordered_keys: list[str] = []

        for sig in signals:
            if not isinstance(sig, UnifiedSignal):
                continue
            key = self.get_deduplication_key(sig)
            if key not in grouped:
                grouped[key] = []
                ordered_keys.append(key)
            # Add a clean copy to avoid mutating original
            grouped[key].append(sig.model_copy(deep=True))

        # Merge each group into a single canonical UnifiedSignal
        merged_signals: list[UnifiedSignal] = []
        for key in ordered_keys:
            duplicates = grouped[key]
            if len(duplicates) == 1:
                single = duplicates[0]
                # Ensure contributing_modules is populated
                if "contributing_modules" not in single.metadata:
                    single.metadata["contributing_modules"] = [single.source_module]
                merged_signals.append(single)
            else:
                merged = self.merge_duplicate_signals(duplicates)
                merged_signals.append(merged)

        return merged_signals

    def get_deduplication_key(self, signal: UnifiedSignal) -> str:
        """
        Generates a deterministic identity key for signal deduplication.

        Rules:
        1. Page-level unique signals (e.g. `content_word_count`, `trust_author_credentials_present`,
           `R-STR-01`, `citation_readiness_level`) use their base `rule_id`.
        2. Item-level signals that apply to distinct external URLs, claims, content sections,
           or quality checks append a normalized target discriminator so distinct items are
           never erroneously merged together.
        """
        rule_id = (signal.rule_id or "").strip().lower()

        # Item-level discriminator detection
        discriminator: str | None = None

        # 1. Check for URL targets (External sources, source quality, source associations)
        if isinstance(signal.value, dict) and "url" in signal.value and signal.value["url"]:
            discriminator = self._normalize_target_url(str(signal.value["url"]))
        elif isinstance(signal.evidence, dict) and "url" in signal.evidence and signal.evidence["url"]:
            discriminator = self._normalize_target_url(str(signal.evidence["url"]))
        elif isinstance(signal.value, str) and (signal.value.startswith("http://") or signal.value.startswith("https://")):
            discriminator = self._normalize_target_url(signal.value)

        # 2. Check for Claim targets
        if not discriminator and rule_id.startswith("claim_"):
            claim_id = signal.metadata.get("claim_id") if isinstance(signal.metadata, dict) else None
            if not claim_id and isinstance(signal.evidence, dict):
                claim_id = signal.evidence.get("claim_id")
            
            if claim_id:
                discriminator = f"claim_{claim_id}"
            else:
                # Use bounded claim text snippet
                claim_text = ""
                if isinstance(signal.value, str):
                    claim_text = signal.value
                elif isinstance(signal.evidence, dict) and "claim_text" in signal.evidence:
                    claim_text = str(signal.evidence["claim_text"])
                if claim_text:
                    normalized_snippet = re.sub(r"\s+", " ", claim_text.strip().lower())[:60]
                    discriminator = f"claim_text_{normalized_snippet}"

        # 3. Check for Content Gaps
        if not discriminator and rule_id.startswith("content_gap_"):
            missing_el = ""
            if isinstance(signal.value, str):
                missing_el = signal.value
            elif isinstance(signal.evidence, dict) and "missing_element" in signal.evidence:
                missing_el = str(signal.evidence["missing_element"])
            elif signal.title:
                missing_el = signal.title
            if missing_el:
                normalized_gap = re.sub(r"\s+", " ", missing_el.strip().lower())[:60]
                discriminator = f"gap_{normalized_gap}"

        # 4. Check for Specific Content Quality Checks
        if not discriminator and rule_id.startswith("quality_check_"):
            check_name = rule_id.replace("quality_check_", "")
            discriminator = f"check_{check_name}"

        # 5. Check for Location / DOM Heading targets if present in evidence
        if not discriminator and isinstance(signal.evidence, dict) and "location" in signal.evidence:
            loc = str(signal.evidence["location"]).strip().lower()
            if loc:
                discriminator = f"loc_{loc}"

        if discriminator:
            return f"{rule_id}::{discriminator}"
        return rule_id

    def merge_duplicate_signals(self, duplicates: list[UnifiedSignal]) -> UnifiedSignal:
        """
        Merges a group of duplicate UnifiedSignal objects into one canonical UnifiedSignal.

        Guarantees:
        - Preserves canonical rule_id and category.
        - Selects primary representation based on confidence and evidence completeness.
        - Retains all contributing source modules in `metadata["contributing_modules"]`.
        - Selects highest valid confidence according to contract (high > medium > low).
        - Merges evidence dictionaries and lists non-destructively.
        - Detects and records any conflicting duplicate observations in metadata.
        - Resolves applicability logically (applicable > conditional > informational > not_applicable).
        """
        if not duplicates:
            raise ValueError("Cannot merge empty duplicates list")

        if len(duplicates) == 1:
            res = duplicates[0].model_copy(deep=True)
            if "contributing_modules" not in res.metadata:
                res.metadata["contributing_modules"] = [res.source_module]
            return res

        # 1. Collect all contributing source modules in order of appearance
        contributing_modules: list[str] = []
        for d in duplicates:
            if d.source_module and d.source_module not in contributing_modules:
                contributing_modules.append(d.source_module)
            for m in d.metadata.get("contributing_modules", []):
                if m and m not in contributing_modules:
                    contributing_modules.append(m)

        # 2. Determine highest confidence
        highest_conf_rank = max(CONFIDENCE_RANK.get((d.confidence or "high").lower(), 3) for d in duplicates)
        canonical_confidence = "high"
        for conf_name, rank in CONFIDENCE_RANK.items():
            if rank == highest_conf_rank:
                canonical_confidence = conf_name
                break

        # 3. Determine applicability precedence
        # applicable > conditional > informational > not_applicable
        has_applicable = any(d.applicability == ApplicabilityType.APPLICABLE.value for d in duplicates)
        has_conditional = any(d.applicability == ApplicabilityType.CONDITIONAL.value for d in duplicates)
        has_informational = any(d.applicability == ApplicabilityType.INFORMATIONAL.value for d in duplicates)

        if has_applicable:
            canonical_applicability = ApplicabilityType.APPLICABLE.value
        elif has_conditional:
            canonical_applicability = ApplicabilityType.CONDITIONAL.value
        elif has_informational:
            canonical_applicability = ApplicabilityType.INFORMATIONAL.value
        else:
            canonical_applicability = ApplicabilityType.NOT_APPLICABLE.value

        # 4. Check for conflicting status or values across duplicates
        distinct_statuses = sorted(list({(d.status or "").strip().lower() for d in duplicates}))
        has_status_conflict = len(distinct_statuses) > 1

        # Check for substantive value conflicts (e.g. True vs False)
        distinct_primitive_values = set()
        for d in duplicates:
            if isinstance(d.value, (bool, int, float, str)):
                distinct_primitive_values.add(d.value)
        has_value_conflict = len(distinct_primitive_values) > 1

        has_conflict = has_status_conflict or has_value_conflict

        # 5. Select primary signal representation
        # Ranking criteria:
        # 1) Confidence rank (higher first)
        # 2) Status priority (verified/pass/detected first)
        # 3) Evidence completeness (count of items/keys in evidence)
        def _sort_key(s: UnifiedSignal):
            conf_val = CONFIDENCE_RANK.get((s.confidence or "high").lower(), 3)
            status_val = STATUS_PRIORITY.get((s.status or "").lower(), 2)
            evidence_size = 0
            if isinstance(s.evidence, dict):
                evidence_size = len(s.evidence)
            elif isinstance(s.evidence, list):
                evidence_size = len(s.evidence)
            elif s.evidence is not None:
                evidence_size = 1
            return (conf_val, status_val, evidence_size)

        sorted_duplicates = sorted(duplicates, key=_sort_key, reverse=True)
        primary = sorted_duplicates[0]

        # 6. Deep merge evidence non-destructively
        merged_evidence = self._merge_evidence_list([d.evidence for d in duplicates])

        # 7. Build merged metadata with traceability
        merged_metadata = deepcopy(primary.metadata)
        merged_metadata["duplicate_count"] = len(duplicates)
        merged_metadata["contributing_modules"] = contributing_modules
        merged_metadata["aggregated_at"] = datetime.now(timezone.utc).isoformat()

        if has_conflict:
            merged_metadata["has_conflict"] = True
            conflict_records = []
            for d in duplicates:
                conflict_records.append({
                    "source_module": d.source_module,
                    "status": d.status,
                    "value": deepcopy(d.value),
                    "confidence": d.confidence,
                    "evidence": deepcopy(d.evidence),
                })
            merged_metadata["conflicts"] = conflict_records
            
            # Format clear human-readable conflict summary
            sources_summary = ", ".join(
                f"{d.source_module} ('{d.status}')" for d in duplicates
            )
            merged_metadata["conflict_summary"] = (
                f"Conflicting observations detected across {len(duplicates)} sources: {sources_summary}"
            )
        else:
            merged_metadata["has_conflict"] = False

        # 8. Create canonical merged UnifiedSignal
        return UnifiedSignal(
            rule_id=primary.rule_id,
            status=primary.status,
            value=deepcopy(primary.value),
            evidence=merged_evidence,
            confidence=canonical_confidence,
            source_module=primary.source_module,
            applicability=canonical_applicability,
            title=primary.title,
            description=primary.description,
            category=primary.category,
            severity=primary.severity,
            metadata=merged_metadata,
        )

    def _merge_evidence_list(self, evidence_items: list[Any]) -> Any:
        """
        Deep-merges a list of evidence payloads from duplicates without data loss.
        """
        valid_items = [e for e in evidence_items if e is not None]
        if not valid_items:
            return None

        # If all valid items are dicts, perform a non-destructive recursive dict merge
        if all(isinstance(e, dict) for e in valid_items):
            merged_dict: dict[str, Any] = {}
            evidence_alternatives: dict[str, list[Any]] = {}

            for d in valid_items:
                for k, v in d.items():
                    if k not in merged_dict:
                        merged_dict[k] = deepcopy(v)
                    else:
                        existing = merged_dict[k]
                        # If both are dicts, recursively merge
                        if isinstance(existing, dict) and isinstance(v, dict):
                            merged_dict[k] = self._merge_evidence_list([existing, v])
                        # If both are lists, combine unique items
                        elif isinstance(existing, list) and isinstance(v, list):
                            combined = deepcopy(existing)
                            for item in v:
                                if item not in combined:
                                    combined.append(deepcopy(item))
                            merged_dict[k] = combined
                        # If values differ, keep existing and record alternative
                        elif existing != v:
                            if k not in evidence_alternatives:
                                evidence_alternatives[k] = [deepcopy(existing)]
                            if v not in evidence_alternatives[k]:
                                evidence_alternatives[k].append(deepcopy(v))

            if evidence_alternatives:
                merged_dict["_evidence_alternatives"] = evidence_alternatives

            return merged_dict

        # If all valid items are lists, combine and deduplicate
        if all(isinstance(e, list) for e in valid_items):
            combined_list: list[Any] = []
            for lst in valid_items:
                for item in lst:
                    if item not in combined_list:
                        combined_list.append(deepcopy(item))
            return combined_list

        # If mixed or primitive, return the most complete or first valid
        return deepcopy(valid_items[0])

    @staticmethod
    def _normalize_target_url(url_str: str) -> str:
        """Normalizes a URL string for stable deduplication targeting."""
        cleaned = url_str.strip().lower()
        # Strip trailing slash and URL fragments for consistent identity
        cleaned = re.sub(r"/+$", "", cleaned)
        cleaned = cleaned.split("#")[0]
        return cleaned


# Global singleton instance & convenience functions
_DEFAULT_AGGREGATOR = SignalAggregator()
UnifiedSignalAggregator = SignalAggregator


def aggregate_signals(
    inputs: Any,
    metadata: dict[str, Any] | None = None,
    preserve_order: bool = True,
) -> AggregatedSignalCollection:
    """Convenience function to aggregate and deduplicate signals."""
    return _DEFAULT_AGGREGATOR.aggregate(
        inputs=inputs,
        metadata=metadata,
        preserve_order=preserve_order,
    )


def deduplicate_signals(
    signals: list[UnifiedSignal],
    preserve_order: bool = True,
) -> list[UnifiedSignal]:
    """Convenience function to deduplicate a list of UnifiedSignal instances."""
    return _DEFAULT_AGGREGATOR.deduplicate(signals, preserve_order=preserve_order)
