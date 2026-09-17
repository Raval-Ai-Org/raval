"""
Tests for Signal Aggregation & Deduplication (Task 8 - Step 8.3)

Verifies:
1. Basic aggregation of multiple distinct signals into one collection.
2. Exact duplicate removal.
3. Semantic/contract-level duplicate handling across multiple Task 5-7 engines.
4. Different rule_ids remaining separate.
5. Different source modules remaining traceable in metadata.
6. Conflict handling for contradictory duplicate observations.
7. Evidence preservation and deep non-destructive merging.
8. Confidence handling (highest valid confidence preserved).
9. Deterministic and repeatable aggregation ordering.
10. Input immutability (no mutation of input objects).
11. Empty and None input safety.
12. Heterogeneous batch handling.
13. Compatibility with Step 8.2 unified signals.
14. Query helpers on AggregatedSignalCollection.
"""

from copy import deepcopy
import pytest

from app.authority_citation_schemas import (
    AuthoritySignalContract,
    ConfidenceLevel,
    ExternalSourceContract,
    SupportNeededClaimContract,
    TrustSignalContract,
)
from app.content_gap_analyzer import ContentGapItem
from app.content_intelligence_analyzer import ContentIntelligenceSummary
from app.schemas import FindingCreate
from app.signal_aggregator import (
    AggregatedSignalCollection,
    SignalAggregator,
    UnifiedSignalAggregator,
    aggregate_signals,
    deduplicate_signals,
)
from app.unified_signal import (
    ApplicabilityType,
    UnifiedSignal,
    UnifiedSignalBatch,
    normalize_signal,
)


@pytest.fixture
def aggregator():
    return SignalAggregator()


class TestBasicAggregationAndDeduplication:
    """Tests basic aggregation, exact duplicate removal, and distinct rule separation."""

    def test_basic_aggregation_distinct_signals(self, aggregator):
        sig1 = UnifiedSignal(
            rule_id="trust_author_credentials_present",
            status="detected",
            value=True,
            evidence={"byline": "Dr. Jane Doe"},
            confidence="high",
            source_module="trust_engine",
            applicability="applicable",
            category="authorship",
        )
        sig2 = UnifiedSignal(
            rule_id="authority_topical_depth",
            status="verified",
            value=1500,
            evidence={"word_count": 1500},
            confidence="high",
            source_module="authority_engine",
            applicability="applicable",
            category="topical_depth",
        )

        collection = aggregator.aggregate([sig1, sig2])

        assert isinstance(collection, AggregatedSignalCollection)
        assert collection.total_input_signals == 2
        assert collection.total_unique_signals == 2
        assert collection.duplicate_count == 0
        assert len(collection.signals) == 2
        assert "trust_engine" in collection.source_modules
        assert "authority_engine" in collection.source_modules
        assert "authorship" in collection.categories
        assert "topical_depth" in collection.categories

    def test_exact_duplicate_removal(self, aggregator):
        sig1 = UnifiedSignal(
            rule_id="trust_email_present",
            status="detected",
            value="support@example.com",
            evidence={"email": "support@example.com"},
            confidence="high",
            source_module="trust_engine",
            applicability="applicable",
        )
        sig2 = sig1.model_copy(deep=True)
        sig3 = sig1.model_copy(deep=True)

        collection = aggregator.aggregate([sig1, sig2, sig3])

        assert collection.total_input_signals == 3
        assert collection.total_unique_signals == 1
        assert collection.duplicate_count == 2
        assert len(collection.signals) == 1

        merged = collection.signals[0]
        assert merged.rule_id == "trust_email_present"
        assert merged.status == "detected"
        assert merged.value == "support@example.com"
        assert merged.metadata["duplicate_count"] == 3
        assert merged.metadata["contributing_modules"] == ["trust_engine"]

    def test_different_rule_ids_remain_separate(self, aggregator):
        sig1 = UnifiedSignal(
            rule_id="content_word_count",
            status="adequate",
            value=500,
            source_module="content_intelligence",
        )
        sig2 = UnifiedSignal(
            rule_id="content_primary_topic",
            status="detected",
            value="AI Safety",
            source_module="content_intelligence",
        )

        collection = aggregator.aggregate([sig1, sig2])
        assert collection.total_unique_signals == 2
        rule_ids = {s.rule_id for s in collection.signals}
        assert rule_ids == {"content_word_count", "content_primary_topic"}

    def test_item_level_signals_with_different_targets_remain_separate(self, aggregator):
        # Two external source detections targeting different URLs should remain separate
        src1 = UnifiedSignal(
            rule_id="source_external_link_detected",
            status="valid",
            value={"url": "https://doi.org/10.1000/182", "domain": "doi.org"},
            evidence={"url": "https://doi.org/10.1000/182"},
            source_module="source_engine",
        )
        src2 = UnifiedSignal(
            rule_id="source_external_link_detected",
            status="valid",
            value={"url": "https://w3.org/standards", "domain": "w3.org"},
            evidence={"url": "https://w3.org/standards"},
            source_module="source_engine",
        )

        collection = aggregator.aggregate([src1, src2])
        assert collection.total_unique_signals == 2
        assert len(collection.signals) == 2


class TestMultiEngineSemanticDeduplication:
    """Tests deduplication of semantically equivalent signals originating from multiple engines."""

    def test_cross_engine_trust_and_transparency_deduplication(self, aggregator):
        # Trust engine detects business identity
        trust_sig = UnifiedSignal(
            rule_id="transparency_business_identity_consistent",
            status="verified",
            value=True,
            evidence={"legal_name": "Acme Corp", "org_schema": True},
            confidence="high",
            source_module="trust_engine",
            applicability="applicable",
            category="business_identity",
        )
        # Transparency engine also detects the same business identity rule
        trans_sig = UnifiedSignal(
            rule_id="transparency_business_identity_consistent",
            status="verified",
            value=True,
            evidence={"footer_text": "© 2026 Acme Corp", "copyright_holder": "Acme Corp"},
            confidence="medium",
            source_module="transparency_engine",
            applicability="applicable",
            category="business_identity",
        )

        collection = aggregator.aggregate([trust_sig, trans_sig])

        assert collection.total_input_signals == 2
        assert collection.total_unique_signals == 1
        assert collection.duplicate_count == 1

        merged = collection.signals[0]
        assert merged.rule_id == "transparency_business_identity_consistent"
        assert merged.status == "verified"
        assert merged.confidence == "high"  # High takes precedence over medium
        # Verify both contributing modules are recorded in order
        assert merged.metadata["contributing_modules"] == ["trust_engine", "transparency_engine"]
        # Verify evidence from both sources was non-destructively merged
        assert merged.evidence["legal_name"] == "Acme Corp"
        assert merged.evidence["org_schema"] is True
        assert merged.evidence["footer_text"] == "© 2026 Acme Corp"
        assert merged.evidence["copyright_holder"] == "Acme Corp"


class TestConfidenceAndEvidencePreservation:
    """Tests highest valid confidence preservation and non-destructive evidence merging."""

    def test_highest_valid_confidence_selected(self, aggregator):
        low_conf = UnifiedSignal(
            rule_id="test_citation_metric",
            status="detected",
            value=10,
            confidence="low",
            source_module="module_a",
        )
        med_conf = UnifiedSignal(
            rule_id="test_citation_metric",
            status="detected",
            value=10,
            confidence="medium",
            source_module="module_b",
        )
        high_conf = UnifiedSignal(
            rule_id="test_citation_metric",
            status="detected",
            value=10,
            confidence="high",
            source_module="module_c",
        )

        collection = aggregator.aggregate([low_conf, med_conf, high_conf])
        assert collection.total_unique_signals == 1
        merged = collection.signals[0]
        assert merged.confidence == "high"

    def test_evidence_nested_dict_and_list_merging(self, aggregator):
        sig1 = UnifiedSignal(
            rule_id="authority_author_credentials",
            status="detected",
            value=True,
            evidence={
                "authors": ["Dr. Jane Doe"],
                "qualifications": {"degrees": ["Ph.D."]},
                "source_dom": "article > header",
            },
            confidence="high",
            source_module="authority_engine",
        )
        sig2 = UnifiedSignal(
            rule_id="authority_author_credentials",
            status="detected",
            value=True,
            evidence={
                "authors": ["Prof. John Smith"],
                "qualifications": {"affiliations": ["Stanford University"]},
                "verification_method": "schema_org",
            },
            confidence="high",
            source_module="trust_engine",
        )

        collection = aggregator.aggregate([sig1, sig2])
        merged = collection.signals[0]

        # Check list merging without duplicates
        assert "Dr. Jane Doe" in merged.evidence["authors"]
        assert "Prof. John Smith" in merged.evidence["authors"]

        # Check nested dict merging
        assert merged.evidence["qualifications"]["degrees"] == ["Ph.D."]
        assert merged.evidence["qualifications"]["affiliations"] == ["Stanford University"]

        # Check disjoint keys preserved
        assert merged.evidence["source_dom"] == "article > header"
        assert merged.evidence["verification_method"] == "schema_org"


class TestConflictHandlingAndTraceability:
    """Tests handling of conflicting duplicate observations without silent data loss."""

    def test_conflicting_status_preserves_all_observations_in_metadata(self, aggregator):
        sig_pass = UnifiedSignal(
            rule_id="content_heading_structure",
            status="pass",
            value=True,
            evidence={"h1_count": 1},
            confidence="high",
            source_module="content_structure_analyzer",
        )
        sig_fail = UnifiedSignal(
            rule_id="content_heading_structure",
            status="fail",
            value=False,
            evidence={"hierarchy_skip": "H2 to H4"},
            confidence="medium",
            source_module="quality_analyzer",
        )

        collection = aggregator.aggregate([sig_pass, sig_fail])

        assert collection.total_unique_signals == 1
        assert collection.conflict_count == 1

        merged = collection.signals[0]
        assert merged.metadata["has_conflict"] is True
        assert "conflicts" in merged.metadata
        assert len(merged.metadata["conflicts"]) == 2

        # Verify conflict records maintain full traceability
        mods = {c["source_module"] for c in merged.metadata["conflicts"]}
        assert mods == {"content_structure_analyzer", "quality_analyzer"}

        statuses = {c["status"] for c in merged.metadata["conflicts"]}
        assert statuses == {"pass", "fail"}

        assert "conflict_summary" in merged.metadata
        assert "Conflicting observations detected" in merged.metadata["conflict_summary"]

    def test_conflicted_query_helper(self, aggregator):
        sig1 = UnifiedSignal(
            rule_id="rule_clean",
            status="detected",
            source_module="mod_a",
        )
        sig2_a = UnifiedSignal(
            rule_id="rule_conflict",
            status="detected",
            source_module="mod_a",
        )
        sig2_b = UnifiedSignal(
            rule_id="rule_conflict",
            status="missing",
            source_module="mod_b",
        )

        collection = aggregator.aggregate([sig1, sig2_a, sig2_b])
        conflicted = collection.get_conflicted()

        assert len(conflicted) == 1
        assert conflicted[0].rule_id == "rule_conflict"


class TestInputImmutabilityAndDefensiveness:
    """Tests non-mutation of input objects and robust handling of edge cases."""

    def test_input_objects_are_not_mutated(self, aggregator):
        orig_evidence = {"items": [1, 2, 3], "meta": {"state": "initial"}}
        sig1 = UnifiedSignal(
            rule_id="immutable_test_rule",
            status="detected",
            evidence=deepcopy(orig_evidence),
            source_module="engine_a",
        )
        sig2 = UnifiedSignal(
            rule_id="immutable_test_rule",
            status="detected",
            evidence={"items": [4, 5], "meta": {"extra": "added"}},
            source_module="engine_b",
        )

        collection = aggregator.aggregate([sig1, sig2])
        merged = collection.signals[0]

        # Mutate merged object's evidence and metadata
        merged.evidence["items"].append(999)
        merged.metadata["new_key"] = "test"

        # Verify original sig1 was not modified
        assert sig1.evidence["items"] == [1, 2, 3]
        assert "new_key" not in sig1.metadata

    def test_none_and_empty_inputs_handled_safely(self, aggregator):
        col_none = aggregator.aggregate(None)
        assert col_none.total_input_signals == 0
        assert col_none.total_unique_signals == 0
        assert col_none.signals == []

        col_empty = aggregator.aggregate([])
        assert col_empty.total_input_signals == 0
        assert col_empty.total_unique_signals == 0

    def test_heterogeneous_input_batch_with_raw_contracts(self, aggregator):
        # Mix UnifiedSignals, Task 7 contracts, Task 5 dataclasses, and dicts
        items = [
            TrustSignalContract(
                signal_id="trust_byline_present",
                title="Author Byline Present",
                status="detected",
                evidence={"byline": "Jane Doe"},
            ),
            AuthoritySignalContract(
                signal_id="authority_methodology_present",
                title="Research Methodology Present",
                status="verified",
                evidence={"method": "benchmarking"},
            ),
            FindingCreate(
                finding_type="R-STR-01",
                category="structure",
                title="Missing H1 Heading",
                description="Lacks H1",
                severity="high",
                status="open",
            ),
            {
                "rule_id": "custom_telemetry",
                "status": "observed",
                "value": 100,
                "source_module": "telemetry_engine",
            },
        ]

        collection = aggregator.aggregate(items)

        assert collection.total_input_signals == 4
        assert collection.total_unique_signals == 4
        rule_ids = {s.rule_id for s in collection.signals}
        assert "trust_byline_present" in rule_ids
        assert "authority_methodology_present" in rule_ids
        assert "R-STR-01" in rule_ids
        assert "custom_telemetry" in rule_ids

    def test_deterministic_repeatable_ordering(self, aggregator):
        sig_a = UnifiedSignal(rule_id="signal_a", status="detected", source_module="mod")
        sig_b = UnifiedSignal(rule_id="signal_b", status="detected", source_module="mod")
        sig_c = UnifiedSignal(rule_id="signal_c", status="detected", source_module="mod")

        input_list = [sig_a, sig_b, sig_c, sig_a, sig_b]

        col1 = aggregator.aggregate(input_list)
        col2 = aggregator.aggregate(input_list)

        order1 = [s.rule_id for s in col1.signals]
        order2 = [s.rule_id for s in col2.signals]

        assert order1 == ["signal_a", "signal_b", "signal_c"]
        assert order1 == order2


class TestCollectionQueryHelpers:
    """Tests query methods on AggregatedSignalCollection."""

    def test_get_by_rule_id(self, aggregator):
        sig1 = UnifiedSignal(rule_id="rule_target", status="detected", source_module="mod_a")
        sig2 = UnifiedSignal(rule_id="rule_other", status="detected", source_module="mod_b")

        col = aggregator.aggregate([sig1, sig2])
        results = col.get_by_rule_id("rule_target")
        assert len(results) == 1
        assert results[0].rule_id == "rule_target"
        assert col.get_by_rule_id("non_existent") == []

    def test_get_by_module(self, aggregator):
        sig1 = UnifiedSignal(rule_id="rule_1", status="detected", source_module="trust_engine")
        sig2 = UnifiedSignal(rule_id="rule_2", status="detected", source_module="authority_engine")
        sig3 = UnifiedSignal(rule_id="rule_1", status="detected", source_module="transparency_engine")

        col = aggregator.aggregate([sig1, sig2, sig3])

        # rule_1 has contributing modules: ["trust_engine", "transparency_engine"]
        trust_sigs = col.get_by_module("trust_engine")
        trans_sigs = col.get_by_module("transparency_engine")
        auth_sigs = col.get_by_module("authority_engine")

        assert len(trust_sigs) == 1
        assert len(trans_sigs) == 1
        assert len(auth_sigs) == 1
        assert col.get_by_module("unknown_engine") == []

    def test_get_by_category(self, aggregator):
        sig1 = UnifiedSignal(rule_id="rule_1", status="detected", source_module="mod", category="trust")
        sig2 = UnifiedSignal(rule_id="rule_2", status="detected", source_module="mod", category="authority")

        col = aggregator.aggregate([sig1, sig2])
        trust_sigs = col.get_by_category("trust")
        assert len(trust_sigs) == 1
        assert trust_sigs[0].rule_id == "rule_1"

    def test_to_dict_serialization(self, aggregator):
        sig1 = UnifiedSignal(rule_id="rule_1", status="detected", source_module="mod")
        col = aggregator.aggregate([sig1])

        dict_data = col.to_dict()
        assert isinstance(dict_data, dict)
        assert dict_data["total_input_signals"] == 1
        assert dict_data["total_unique_signals"] == 1
        assert len(dict_data["signals"]) == 1
        assert dict_data["signals"][0]["rule_id"] == "rule_1"


class TestConvenienceFunctions:
    """Tests aggregate_signals and deduplicate_signals convenience functions."""

    def test_aggregate_signals_and_deduplicate_signals(self):
        sig1 = UnifiedSignal(rule_id="conv_rule", status="detected", source_module="mod_a")
        sig2 = UnifiedSignal(rule_id="conv_rule", status="detected", source_module="mod_b")

        col = aggregate_signals([sig1, sig2])
        assert isinstance(col, AggregatedSignalCollection)
        assert col.total_unique_signals == 1

        deduped = deduplicate_signals([sig1, sig2])
        assert isinstance(deduped, list)
        assert len(deduped) == 1
        assert deduped[0].rule_id == "conv_rule"
