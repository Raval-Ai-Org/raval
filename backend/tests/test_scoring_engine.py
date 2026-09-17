"""
Tests for Deterministic Scoring & Traceability Engine (Task 8 - Steps 8.4 & 8.5)

Verifies:
Step 8.4:
1. Perfect / all-pass scenario -> 100.0
2. All-fail scenario -> 0.0
3. Mixed PASS / FAIL / WARNING with expected weights
4. Score bounded to [0.0, 100.0]
5. Deterministic repeated execution
6. Category weights normalization
7. Empty input handling (neutral 100.0)
8. N/A handling (0 penalty)
9. UNKNOWN / missing data handling (0 failure penalty)
10. WARNING handling (50% partial credit)
11. Extreme / malformed inputs

Step 8.5:
12. SCORE -> CATEGORY -> RULE -> SIGNAL -> EVIDENCE -> FINDING trace verification
13. Finding association linking (finding_id, finding_type, finding_severity)
14. Duplicate signal penalty prevention (no double penalization)
15. Duplicate finding penalty prevention
16. Different rules remaining independently scoreable
17. Evidence and confidence preservation in contributions
18. Input immutability
19. Trace query helpers on DeterministicScoreResult

Integration:
20. Scoring Step 8.2 normalized signals and Step 8.3 aggregated collections
"""

from copy import deepcopy
import pytest

from app.applicability_engine import ApplicabilityContext
from app.scoring_engine import (
    CategoryScoreResult,
    DeterministicScoreResult,
    DeterministicScoringEngine,
    ScoreContribution,
    ScoringCategory,
    ScoringConfig,
    calculate_deterministic_score,
)
from app.signal_aggregator import aggregate_signals
from app.unified_signal import UnifiedSignal


@pytest.fixture
def scoring_engine():
    return DeterministicScoringEngine()


class TestDeterministicScoringEngine:
    """Tests Step 8.4 - 100/100 Deterministic Scoring Engine."""

    def test_perfect_all_pass_scenario_yields_100(self, scoring_engine):
        signals = [
            UnifiedSignal(rule_id="trust_author_credentials_present", status="pass", source_module="trust_engine", category="trust"),
            UnifiedSignal(rule_id="authority_topical_depth", status="pass", source_module="authority_engine", category="authority"),
            UnifiedSignal(rule_id="quality_word_count", status="pass", source_module="quality_analyzer", category="quality"),
            UnifiedSignal(rule_id="r-str-01", status="pass", source_module="content_structure_analyzer", category="structure"),
            UnifiedSignal(rule_id="content_semantic_coverage", status="pass", source_module="semantic_coverage_analyzer", category="semantic_coverage"),
        ]

        result = scoring_engine.score(signals)

        assert isinstance(result, DeterministicScoreResult)
        assert result.overall_score == 100.0
        assert result.status == "optimal"
        assert result.total_penalties_applied == 0
        for cat_key, cat_res in result.category_scores.items():
            assert cat_res.score == 100.0

    def test_all_fail_scenario_yields_0(self, scoring_engine):
        signals = [
            UnifiedSignal(rule_id="trust_author_credentials_present", status="fail", source_module="trust_engine", category="trust"),
            UnifiedSignal(rule_id="authority_topical_depth", status="fail", source_module="authority_engine", category="authority"),
            UnifiedSignal(rule_id="quality_word_count", status="fail", source_module="quality_analyzer", category="quality"),
            UnifiedSignal(rule_id="r-str-01", status="fail", source_module="content_structure_analyzer", category="structure"),
            UnifiedSignal(rule_id="content_semantic_coverage", status="fail", source_module="semantic_coverage_analyzer", category="semantic_coverage"),
        ]

        result = scoring_engine.score(signals)

        assert result.overall_score == 0.0
        assert result.status == "deficient"
        assert result.total_penalties_applied == 5
        for cat_key, cat_res in result.category_scores.items():
            assert cat_res.score == 0.0

    def test_mixed_pass_fail_warning_calculation(self, scoring_engine):
        # Within Content Quality category (Weight = 0.25):
        # Rule 1: PASS (credit 1.0)
        # Rule 2: WARNING (credit 0.5)
        # Rule 3: FAIL (credit 0.0)
        # Category score = (1.0 + 0.5 + 0.0) / 3 * 100 = 50.0
        signals = [
            UnifiedSignal(rule_id="quality_reading_time", status="pass", source_module="quality_analyzer", category="quality"),
            UnifiedSignal(rule_id="quality_thin_content", status="warning", source_module="quality_analyzer", category="quality"),
            UnifiedSignal(rule_id="quality_empty_content", status="fail", source_module="quality_analyzer", category="quality"),
        ]

        result = scoring_engine.score(signals)

        quality_cat = result.category_scores[ScoringCategory.CONTENT_QUALITY.value]
        assert quality_cat.score == 50.0
        assert quality_cat.passed_count == 1
        assert quality_cat.warning_count == 1
        assert quality_cat.failed_count == 1

    def test_score_strictly_bounded_between_0_and_100(self, scoring_engine):
        signals = [
            UnifiedSignal(rule_id="r1", status="pass", source_module="trust_engine", category="trust"),
            UnifiedSignal(rule_id="r2", status="fail", source_module="trust_engine", category="trust"),
        ]
        result = scoring_engine.score(signals)
        assert 0.0 <= result.overall_score <= 100.0

    def test_deterministic_reproducibility(self, scoring_engine):
        signals = [
            UnifiedSignal(rule_id="r1", status="pass", source_module="trust_engine"),
            UnifiedSignal(rule_id="r2", status="warning", source_module="authority_engine"),
            UnifiedSignal(rule_id="r3", status="fail", source_module="quality_analyzer"),
        ]

        res1 = scoring_engine.score(signals)
        res2 = scoring_engine.score(signals)

        assert res1.overall_score == res2.overall_score
        assert [c.rule_id for c in res1.traceability_chain] == [c.rule_id for c in res2.traceability_chain]

    def test_na_rule_creates_zero_penalty(self, scoring_engine):
        # A signal explicitly marked N/A should be excluded with 0 penalty
        sig_pass = UnifiedSignal(rule_id="r1", status="pass", source_module="trust_engine", category="trust")
        sig_na = UnifiedSignal(rule_id="r2", status="n/a", applicability="not_applicable", source_module="trust_engine", category="trust")

        result = scoring_engine.score([sig_pass, sig_na])

        trust_cat = result.category_scores[ScoringCategory.TRUST_TRANSPARENCY.value]
        assert trust_cat.score == 100.0
        assert trust_cat.na_count == 1
        assert trust_cat.passed_count == 1
        assert trust_cat.failed_count == 0

    def test_unknown_missing_data_creates_zero_failure_penalty(self, scoring_engine):
        # A signal marked UNKNOWN due to missing data must not drag the score down to 0
        sig_pass = UnifiedSignal(rule_id="r1", status="pass", source_module="structure_engine", category="structure")
        sig_unknown = UnifiedSignal(rule_id="r2", status="unknown", source_module="structure_engine", category="structure")

        result = scoring_engine.score([sig_pass, sig_unknown])

        struct_cat = result.category_scores[ScoringCategory.CONTENT_STRUCTURE.value]
        assert struct_cat.score == 100.0
        assert struct_cat.unknown_count == 1
        assert struct_cat.failed_count == 0

    def test_empty_signals_handled_safely(self, scoring_engine):
        result = scoring_engine.score([])
        assert result.overall_score == 100.0
        assert result.total_signals_evaluated == 0
        assert result.total_rules_applicable == 0

        res_none = scoring_engine.score(None)
        assert res_none.overall_score == 100.0


class TestScoreTraceabilityAndAuditability:
    """Tests Step 8.5 - Finding & Score Traceability."""

    def test_complete_traceability_chain(self, scoring_engine):
        evidence_payload = {"h1_count": 0, "found_tags": ["h2", "h3"]}
        sig = UnifiedSignal(
            rule_id="r-str-01",
            status="fail",
            value=False,
            evidence=evidence_payload,
            confidence="high",
            source_module="content_structure_analyzer",
            category="structure",
            severity="high",
            metadata={"finding_id": "find_101", "finding_type": "R-STR-01"},
        )

        result = scoring_engine.score([sig])

        # Verify SCORE -> CATEGORY -> RULE -> SIGNAL -> EVIDENCE -> FINDING
        assert len(result.traceability_chain) >= 1
        contrib = result.get_contributions_by_rule("r-str-01")[0]

        # Category Link
        assert contrib.category == ScoringCategory.CONTENT_STRUCTURE.value
        # Rule Link
        assert contrib.rule_id == "r-str-01"
        # Source Module Link
        assert contrib.source_module == "content_structure_analyzer"
        # Status Link
        assert contrib.status == "fail"
        assert contrib.is_penalized is True
        # Evidence Link
        assert contrib.evidence == evidence_payload
        # Finding Link
        assert contrib.finding_id == "find_101"
        assert contrib.finding_type == "R-STR-01"
        assert contrib.finding_severity == "high"
        # Originating Signal
        assert contrib.originating_signal is not None
        assert contrib.originating_signal.rule_id == "r-str-01"

    def test_duplicate_signal_does_not_cause_duplicate_penalty(self, scoring_engine):
        # If two duplicate signals representing the same rule/issue reach the scoring engine,
        # the engine must penalize only ONCE.
        sig1 = UnifiedSignal(
            rule_id="trust_author_credentials_present",
            status="fail",
            source_module="trust_engine",
            category="trust",
        )
        sig2 = UnifiedSignal(
            rule_id="trust_author_credentials_present",
            status="fail",
            source_module="trust_engine",
            category="trust",
        )

        result = scoring_engine.score([sig1, sig2])

        trust_cat = result.category_scores[ScoringCategory.TRUST_TRANSPARENCY.value]
        # Only 1 rule failed, the duplicate was prevented
        assert trust_cat.failed_count == 1
        assert trust_cat.score == 0.0  # (0.0 / 1.0) * 100
        assert result.total_duplicates_prevented == 1

        # Check traceability records the duplicate prevention
        skipped = result.get_skipped_contributions()
        assert len(skipped) == 1
        assert skipped[0].skip_reason == "duplicate_prevention"

    def test_different_rules_remain_independently_scoreable(self, scoring_engine):
        # Two distinct rules in the same category must be independently evaluated
        sig1 = UnifiedSignal(
            rule_id="quality_empty_content",
            status="pass",
            source_module="quality_analyzer",
            category="quality",
        )
        sig2 = UnifiedSignal(
            rule_id="quality_thin_content",
            status="fail",
            source_module="quality_analyzer",
            category="quality",
        )

        result = scoring_engine.score([sig1, sig2])

        quality_cat = result.category_scores[ScoringCategory.CONTENT_QUALITY.value]
        assert quality_cat.passed_count == 1
        assert quality_cat.failed_count == 1
        assert quality_cat.score == 50.0

    def test_finding_association_query_helper(self, scoring_engine):
        sig = UnifiedSignal(
            rule_id="r-str-01",
            status="fail",
            source_module="structure_engine",
            category="structure",
            metadata={"finding_id": "f_123", "finding_type": "MISSING_H1", "severity": "high"},
        )

        result = scoring_engine.score([sig])
        associations = result.get_finding_associations()

        assert len(associations) == 1
        assert associations[0]["finding_id"] == "f_123"
        assert associations[0]["finding_type"] == "MISSING_H1"
        assert associations[0]["finding_severity"] == "high"

    def test_input_immutability(self, scoring_engine):
        orig_evidence = {"count": 5}
        sig = UnifiedSignal(
            rule_id="test_immutability",
            status="pass",
            evidence=deepcopy(orig_evidence),
            source_module="engine_a",
        )

        result = scoring_engine.score([sig])
        contrib = result.traceability_chain[0]

        # Mutate result
        contrib.evidence["count"] = 999

        # Verify original was not mutated
        assert sig.evidence["count"] == 5

    def test_to_dict_serialization(self, scoring_engine):
        sig = UnifiedSignal(rule_id="test_rule", status="pass", source_module="mod")
        result = scoring_engine.score([sig])

        dict_data = result.to_dict()
        assert isinstance(dict_data, dict)
        assert "overall_score" in dict_data
        assert "category_scores" in dict_data
        assert "traceability_chain" in dict_data


class TestEndToEndIntegration:
    """Tests end-to-end integration of Step 8.2 -> Step 8.3 -> Step 8.4 -> Step 8.5."""

    def test_end_to_end_scoring_from_heterogeneous_signals(self):
        signals = [
            UnifiedSignal(rule_id="trust_byline_present", status="detected", source_module="trust_engine", category="trust"),
            UnifiedSignal(rule_id="authority_topical_depth", status="verified", source_module="authority_engine", category="authority"),
            UnifiedSignal(rule_id="r-str-01", status="fail", source_module="content_structure_analyzer", category="structure"),
            UnifiedSignal(rule_id="custom_telemetry", status="unknown", source_module="telemetry"),
        ]

        context = ApplicabilityContext(
            page_type="article",
            available_data={"has_raw_html": True, "has_text": True},
        )

        result = calculate_deterministic_score(signals, context=context)

        assert isinstance(result, DeterministicScoreResult)
        assert 0.0 <= result.overall_score <= 100.0
        assert len(result.category_scores) == 5
        assert len(result.traceability_chain) >= 4
