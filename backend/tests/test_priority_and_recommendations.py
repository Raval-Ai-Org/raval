"""
Unit and Integration Tests for Priority & Recommendation Engine (Task 8 - Step 8.6)
"""

import pytest
from app.applicability_engine import ApplicabilityContext, evaluate_applicability
from app.priority_engine import (
    FindingPriority,
    PrioritizedRecommendation,
    PriorityConfig,
    PriorityEngine,
    RecommendationClassification,
    determine_finding_priority,
    generate_prioritized_recommendations,
)
from app.scoring_engine import (
    DeterministicScoreResult,
    ScoreContribution,
    ScoringCategory,
    calculate_deterministic_score,
)
from app.unified_signal import ApplicabilityType, UnifiedSignal


class TestPriorityDetermination:
    """Tests for multi-factor deterministic priority assignment."""

    def test_critical_priority_on_high_point_impact_or_severity(self):
        engine = PriorityEngine(PriorityConfig(critical_point_impact_threshold=10.0))

        # 1. High score impact (>= 10.0 pts)
        contrib_high_impact = ScoreContribution(
            rule_id="trust_missing_identity",
            category="trust_transparency",
            source_module="trust_engine",
            status="fail",
            applicability="applicable",
            overall_point_impact=-12.5,
            is_penalized=True,
            finding_severity="high",
        )
        assert engine.determine_priority(contrib_high_impact) == FindingPriority.CRITICAL

        # 2. Explicit critical severity
        contrib_crit = ScoreContribution(
            rule_id="r-str-01",
            category="content_structure",
            source_module="content_structure_analyzer",
            status="fail",
            applicability="applicable",
            overall_point_impact=-5.0,
            is_penalized=True,
            finding_severity="critical",
        )
        assert engine.determine_priority(contrib_crit) == FindingPriority.CRITICAL

    def test_high_priority_assignment(self):
        engine = PriorityEngine()
        contrib_high = ScoreContribution(
            rule_id="authority_topical_depth",
            category="authority_citations",
            source_module="authority_engine",
            status="fail",
            applicability="applicable",
            overall_point_impact=-7.0,
            is_penalized=True,
            finding_severity="high",
        )
        assert engine.determine_priority(contrib_high) == FindingPriority.HIGH

    def test_medium_priority_assignment(self):
        engine = PriorityEngine()
        contrib_med = ScoreContribution(
            rule_id="content_heading_structure",
            category="content_structure",
            source_module="content_structure_analyzer",
            status="fail",
            applicability="applicable",
            overall_point_impact=-3.5,
            is_penalized=True,
            finding_severity="medium",
        )
        assert engine.determine_priority(contrib_med) == FindingPriority.MEDIUM

    def test_low_priority_on_warning_or_minor_impact(self):
        engine = PriorityEngine()
        contrib_low = ScoreContribution(
            rule_id="missing_meta_description",
            category="content_structure",
            source_module="content_structure_analyzer",
            status="warning",
            applicability="applicable",
            overall_point_impact=-1.2,
            is_penalized=True,
            finding_severity="low",
        )
        assert engine.determine_priority(contrib_low) == FindingPriority.LOW

    def test_info_priority_on_pass_na_or_unknown(self):
        engine = PriorityEngine()

        # PASS
        contrib_pass = ScoreContribution(
            rule_id="r-str-01",
            category="content_structure",
            source_module="content_structure_analyzer",
            status="pass",
            applicability="applicable",
            overall_point_impact=0.0,
            is_penalized=False,
        )
        assert engine.determine_priority(contrib_pass) == FindingPriority.INFO

        # N/A
        contrib_na = ScoreContribution(
            rule_id="ecommerce_pricing",
            category="trust_transparency",
            source_module="transparency_engine",
            status="n/a",
            applicability="not_applicable",
            is_skipped=True,
            skip_reason="not_applicable",
        )
        assert engine.determine_priority(contrib_na) == FindingPriority.INFO

        # UNKNOWN / Insufficient Data
        contrib_unk = ScoreContribution(
            rule_id="citation_readiness",
            category="authority_citations",
            source_module="citation_readiness_engine",
            status="unknown",
            applicability="unknown",
            is_skipped=True,
            skip_reason="insufficient_data",
        )
        assert engine.determine_priority(contrib_unk) == FindingPriority.INFO


class TestRecommendationGeneration:
    """Tests for evidence-backed recommendation generation and classification."""

    def test_quick_win_vs_deep_fix_classification(self):
        engine = PriorityEngine()

        # Quick wins (meta tags, headings, bylines, basic schemas)
        assert engine.classify_recommendation("r-str-01") == RecommendationClassification.QUICK_WIN
        assert engine.classify_recommendation("missing_title") == RecommendationClassification.QUICK_WIN
        assert engine.classify_recommendation("missing_meta_description") == RecommendationClassification.QUICK_WIN
        assert engine.classify_recommendation("trust_byline_present") == RecommendationClassification.QUICK_WIN

        # Deep fixes (topical depth, claim citations, content expansion)
        assert engine.classify_recommendation("authority_topical_depth") == RecommendationClassification.DEEP_FIX
        assert engine.classify_recommendation("source_external_link_detected") == RecommendationClassification.DEEP_FIX
        assert engine.classify_recommendation("quality_thin_content") == RecommendationClassification.DEEP_FIX

    def test_complete_recommendation_traceability(self):
        engine = PriorityEngine()
        contrib = ScoreContribution(
            rule_id="r-str-01",
            category="content_structure",
            source_module="content_structure_analyzer",
            status="fail",
            applicability="applicable",
            confidence=0.95,
            value={"h1_count": 0},
            evidence={"headings": [], "dom_path": "/html/body"},
            overall_point_impact=-15.0,
            is_penalized=True,
            finding_id="find-h1-001",
            finding_severity="high",
            rationale="No H1 tag detected in DOM.",
        )

        rec = engine.generate_recommendation(contrib)
        assert rec is not None
        assert rec.rule_id == "r-str-01"
        assert rec.category == "content_structure"
        assert rec.finding_id == "find-h1-001"
        assert rec.classification == RecommendationClassification.QUICK_WIN.value
        assert rec.priority in (FindingPriority.CRITICAL.value, FindingPriority.HIGH.value)
        assert "H1" in rec.title
        assert rec.score_impact == 15.0
        assert rec.evidence == {"headings": [], "dom_path": "/html/body"}
        assert rec.status == "open"
        assert rec.metadata["source_module"] == "content_structure_analyzer"

    def test_no_recommendations_for_pass_na_or_unknown(self):
        engine = PriorityEngine()

        # PASS
        contrib_pass = ScoreContribution(
            rule_id="r-str-01",
            category="content_structure",
            source_module="content_structure_analyzer",
            status="pass",
            applicability="applicable",
            is_penalized=False,
        )
        assert engine.generate_recommendation(contrib_pass) is None

        # N/A
        contrib_na = ScoreContribution(
            rule_id="ecommerce_pricing",
            category="trust_transparency",
            source_module="transparency_engine",
            status="n/a",
            applicability="not_applicable",
            is_skipped=True,
            is_penalized=False,
        )
        assert engine.generate_recommendation(contrib_na) is None

        # UNKNOWN
        contrib_unk = ScoreContribution(
            rule_id="citation_readiness",
            category="authority_citations",
            source_module="citation_readiness_engine",
            status="unknown",
            applicability="unknown",
            is_skipped=True,
            is_penalized=False,
        )
        assert engine.generate_recommendation(contrib_unk) is None

    def test_duplicate_recommendation_prevention(self):
        # Multiple contributions targeting the same underlying rule
        signals = [
            UnifiedSignal(
                rule_id="r-str-01",
                category="content_structure",
                source_module="content_structure_analyzer",
                status="fail",
                applicability="applicable",
                evidence={"h1_count": 0},
            ),
            UnifiedSignal(
                rule_id="r-str-01",
                category="content_structure",
                source_module="page_extractor",
                status="fail",
                applicability="applicable",
                evidence={"h1_count": 0, "source": "dom"},
            ),
        ]
        score_res = calculate_deterministic_score(signals)
        recs = generate_prioritized_recommendations(score_res)

        # Exactly 1 recommendation generated despite multiple signals
        assert len(recs) == 1
        assert recs[0].rule_id == "r-str-01"

    def test_idempotency_and_sorting(self):
        signals = [
            UnifiedSignal(
                rule_id="r-str-01",
                category="content_structure",
                source_module="content_structure_analyzer",
                status="fail",
                applicability="applicable",
            ),
            UnifiedSignal(
                rule_id="authority_topical_depth",
                category="authority_citations",
                source_module="authority_engine",
                status="fail",
                applicability="applicable",
            ),
        ]
        score_res = calculate_deterministic_score(signals)

        recs_run1 = generate_prioritized_recommendations(score_res)
        recs_run2 = generate_prioritized_recommendations(score_res)

        assert len(recs_run1) == len(recs_run2)
        assert [r.recommendation_id for r in recs_run1] == [r.recommendation_id for r in recs_run2]
        assert [r.rule_id for r in recs_run1] == [r.rule_id for r in recs_run2]
