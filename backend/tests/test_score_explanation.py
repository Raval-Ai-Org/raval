"""
Unit and Integration Tests for Score Explanation & Analytics Data Layer (Task 8 - Step 8.7)
"""

import pytest
from app.applicability_engine import ApplicabilityContext, evaluate_applicability
from app.priority_engine import generate_prioritized_recommendations
from app.score_explanation import (
    CategoryExplanation,
    DeductionDetail,
    PageScoreAnalytics,
    ScoreExplanationEngine,
    ScoreExplanationResponse,
    build_page_analytics,
    explain_score,
)
from app.scoring_engine import (
    DeterministicScoreResult,
    calculate_deterministic_score,
)
from app.unified_signal import ApplicabilityType, UnifiedSignal


class TestScoreExplanationEngine:
    """Tests for human-readable, evidence-grounded score explanations."""

    def test_overall_score_explanation_structure(self):
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
                rule_id="trust_byline_present",
                category="trust_transparency",
                source_module="trust_engine",
                status="pass",
                applicability="applicable",
                evidence={"author": "Dr. Smith"},
            ),
            UnifiedSignal(
                rule_id="ecommerce_pricing",
                category="trust_transparency",
                source_module="transparency_engine",
                status="n/a",
                applicability="not_applicable",
            ),
            UnifiedSignal(
                rule_id="citation_readiness",
                category="authority_citations",
                source_module="citation_readiness_engine",
                status="unknown",
                applicability="unknown",
            ),
        ]

        score_res = calculate_deterministic_score(signals)
        explanation = explain_score(score_res)

        assert isinstance(explanation, ScoreExplanationResponse)
        assert explanation.overall_score == score_res.overall_score
        assert explanation.status == score_res.status
        assert len(explanation.summary) > 0

        # Verify category explanations exist for all 5 canonical categories
        assert "content_structure" in explanation.category_explanations
        assert "trust_transparency" in explanation.category_explanations
        assert "authority_citations" in explanation.category_explanations

        # Verify deductions list
        assert len(explanation.deductions) == 1
        deduction = explanation.deductions[0]
        assert deduction.rule_id == "r-str-01"
        assert deduction.category == "content_structure"
        assert deduction.point_deduction > 0
        assert deduction.evidence_excerpt == {"h1_count": 0}

        # Verify verified passing strengths
        assert len(explanation.strengths) >= 1
        strength_rules = [s["rule_id"] for s in explanation.strengths]
        assert "trust_byline_present" in strength_rules

        # Verify N/A rules list
        assert len(explanation.na_rules) >= 1
        na_rule_ids = [n["rule_id"] for n in explanation.na_rules]
        assert "ecommerce_pricing" in na_rule_ids

        # Verify UNKNOWN rules list
        assert len(explanation.unknown_rules) >= 1
        unk_rule_ids = [u["rule_id"] for u in explanation.unknown_rules]
        assert "citation_readiness" in unk_rule_ids

    def test_category_explanation_details(self):
        signals = [
            UnifiedSignal(
                rule_id="r-str-01",
                category="content_structure",
                source_module="content_structure_analyzer",
                status="pass",
                applicability="applicable",
                evidence={"h1_count": 1},
            ),
            UnifiedSignal(
                rule_id="content_heading_structure",
                category="content_structure",
                source_module="content_structure_analyzer",
                status="fail",
                applicability="applicable",
                evidence={"skipped_levels": ["H2 -> H4"]},
            ),
        ]
        score_res = calculate_deterministic_score(signals)
        explanation = explain_score(score_res)

        struct_cat = explanation.category_explanations["content_structure"]
        assert struct_cat.name == "Content & DOM Structure"
        assert struct_cat.score == 50.0  # 1 pass, 1 fail
        assert struct_cat.weight == 0.15
        assert struct_cat.total_points_lost == 50.0
        assert len(struct_cat.key_strengths) >= 1
        assert len(struct_cat.key_deductions) == 1


class TestPageAnalyticsDataLayer:
    """Tests for structured PageScoreAnalytics generation and historical coexistence."""

    def test_page_score_analytics_model_generation(self):
        signals = [
            UnifiedSignal(
                rule_id="r-str-01",
                category="content_structure",
                source_module="content_structure_analyzer",
                status="fail",
                applicability="applicable",
            ),
            UnifiedSignal(
                rule_id="trust_contact_info_present",
                category="trust_transparency",
                source_module="trust_engine",
                status="pass",
                applicability="applicable",
            ),
        ]

        score_res = calculate_deterministic_score(signals)
        recs = generate_prioritized_recommendations(score_res)
        analytics = build_page_analytics(
            score_result=score_res,
            recommendations=recs,
            page_id=42,
            url="https://example.com/test-page",
            scan_id=101,
            website_id=5,
        )

        assert isinstance(analytics, PageScoreAnalytics)
        assert analytics.page_id == 42
        assert analytics.url == "https://example.com/test-page"
        assert analytics.scan_id == 101
        assert analytics.website_id == 5
        assert analytics.overall_score == score_res.overall_score
        assert "content_structure" in analytics.category_scores
        assert analytics.applicability_counts["pass"] == 1
        assert analytics.applicability_counts["fail"] == 1
        assert analytics.recommendation_counts["total"] == 1
        assert analytics.timestamp is not None

    def test_historical_coexistence_without_mutation(self):
        # Scan 1 evaluation
        signals_scan1 = [
            UnifiedSignal(
                rule_id="r-str-01",
                category="content_structure",
                source_module="content_structure_analyzer",
                status="fail",
                applicability="applicable",
            ),
        ]
        score_scan1 = calculate_deterministic_score(signals_scan1)
        analytics_scan1 = build_page_analytics(score_scan1, page_id=1, scan_id=1, website_id=1)

        # Scan 2 evaluation (remediated)
        signals_scan2 = [
            UnifiedSignal(
                rule_id="r-str-01",
                category="content_structure",
                source_module="content_structure_analyzer",
                status="pass",
                applicability="applicable",
            ),
        ]
        score_scan2 = calculate_deterministic_score(signals_scan2)
        analytics_scan2 = build_page_analytics(score_scan2, page_id=1, scan_id=2, website_id=1)

        # Both records coexist independently with different scores and scan_ids
        assert analytics_scan1.scan_id == 1
        assert analytics_scan1.overall_score < analytics_scan2.overall_score
        assert analytics_scan2.scan_id == 2
        assert analytics_scan2.overall_score == 100.0
