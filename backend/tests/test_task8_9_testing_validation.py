"""
Comprehensive Testing & Real-Site Validation Suite (Task 8 - Step 8.9)

Covers all 8 validation pillars:
1. Scoring Boundary Tests (0.0 to 100.0 strictly bounded, boundary values, deterministic reproducibility)
2. Applicability & Status Tests (PASS, FAIL, WARNING, N/A, UNKNOWN, missing/empty data handling)
3. Duplicate-Penalty Protection (Single penalty per issue, duplicate finding safety, idempotency)
4. Category & Total-Score Regression (Category isolation, weighted sum aggregation, non-bleeding categories)
5. Traceability Regression (Deduction -> Category -> Rule -> Evidence -> Finding provenance)
6. Fixture-Based Regression Suite (Healthy, Partial, Poor, Missing Data, N/A, Duplicate, Mixed fixtures)
7. API Endpoints Regression (Structured REST contracts, boundary safety, empty & N/A page handling)
8. Real Public-Page Validation (Deterministic offline + optional live network validation)
"""

from copy import deepcopy
import random
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.applicability_engine import (
    ApplicabilityContext,
    ApplicabilityStatus,
    ApplicabilityType,
    evaluate_applicability,
)
from app.database import Base, get_db
from app.intelligence_service import (
    evaluate_page_intelligence_score,
    evaluate_site_intelligence_summary,
)
from app.main import app
from app.models import Finding, PageResult, Scan, Website
from app.priority_engine import (
    FindingPriority,
    PrioritizedRecommendation,
    RecommendationClassification,
    generate_prioritized_recommendations,
)
from app.score_explanation import (
    ScoreExplanationEngine,
    build_page_analytics,
    explain_score,
)
from app.scoring_engine import (
    CATEGORY_NORMALIZED_WEIGHTS,
    DEFAULT_CATEGORY_WEIGHTS,
    DeterministicScoreResult,
    DeterministicScoringEngine,
    ScoreContribution,
    ScoringCategory,
    ScoringConfig,
    calculate_deterministic_score,
)
from app.signal_aggregator import aggregate_signals
from app.site_aggregator import aggregate_site_scores
from app.unified_signal import UnifiedSignal, normalize_signal

from scripts.validate_real_site_scoring import (
    OFFLINE_PAGE_FIXTURES,
    run_real_site_validation,
    validate_single_page,
)


# =============================================================================
# Database and TestClient Fixtures
# =============================================================================

@pytest.fixture
def db_session():
    """Isolated SQLite in-memory database fixture for Task 8.9 tests."""
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()
        Base.metadata.drop_all(bind=engine)


@pytest.fixture
def client(db_session):
    """TestClient with overridden get_db dependency."""
    def override_get_db():
        try:
            yield db_session
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


# =============================================================================
# 1. Scoring Boundary Tests
# =============================================================================

class TestScoringBoundaries:
    """Verifies strict 0.0 to 100.0 score boundaries, edge values, and deterministic idempotency."""

    def test_score_strictly_bounded_at_maximum_100(self):
        """Verifies score never exceeds 100.0 even with hundreds of passing rules."""
        signals = []
        for i in range(100):
            signals.append(
                UnifiedSignal(
                    rule_id=f"rule_pass_{i}",
                    status="pass",
                    category="content_quality",
                    source_module="quality_analyzer",
                    confidence="high",
                )
            )
        result = calculate_deterministic_score(signals)
        assert result.overall_score == 100.0
        assert result.status == "optimal"
        for cat in result.category_scores.values():
            assert cat.score == 100.0

    def test_score_strictly_bounded_at_minimum_zero(self):
        """Verifies score never drops below 0.0 when all categories fail."""
        signals = [
            UnifiedSignal(rule_id="r_trust_fail", status="fail", category="trust_transparency", source_module="trust_engine", severity="critical"),
            UnifiedSignal(rule_id="r_auth_fail", status="fail", category="authority_citations", source_module="authority_engine", severity="critical"),
            UnifiedSignal(rule_id="r_qual_fail", status="fail", category="content_quality", source_module="quality_analyzer", severity="critical"),
            UnifiedSignal(rule_id="r_str_fail", status="fail", category="content_structure", source_module="page_extractor", severity="critical"),
            UnifiedSignal(rule_id="r_sem_fail", status="fail", category="semantic_readiness", source_module="topic_analyzer", severity="critical"),
        ]
        result = calculate_deterministic_score(signals)
        assert result.overall_score == 0.0
        assert result.status == "deficient"
        for cat in result.category_scores.values():
            assert cat.score == 0.0

    def test_boundary_thresholds_values(self):
        """Tests that scores at boundaries (0, 1, 99, 100) are handled safely."""
        # 1. Perfect 100
        res_100 = calculate_deterministic_score([])
        assert res_100.overall_score == 100.0
        assert res_100.status == "optimal"

        # 2. Near 100 (single warning on a minor rule)
        sig_near_100 = [
            UnifiedSignal(rule_id="r-str-01", status="pass", category="content_structure", source_module="page_extractor"),
            UnifiedSignal(rule_id="r-str-02", status="pass", category="content_structure", source_module="page_extractor"),
            UnifiedSignal(rule_id="r-str-03", status="warning", category="content_structure", source_module="page_extractor"),
        ]
        res_near_100 = calculate_deterministic_score(sig_near_100)
        assert 90.0 < res_near_100.overall_score < 100.0

        # 3. Near 0 (all categories failing heavily)
        sig_near_0 = [
            UnifiedSignal(rule_id="r-trust-01", status="fail", category="trust_transparency", source_module="trust_engine"),
            UnifiedSignal(rule_id="r-auth-01", status="fail", category="authority_citations", source_module="authority_engine"),
            UnifiedSignal(rule_id="r-qual-01", status="fail", category="content_quality", source_module="quality_analyzer"),
            UnifiedSignal(rule_id="r-str-01", status="fail", category="content_structure", source_module="page_extractor"),
            UnifiedSignal(rule_id="r-sem-01", status="fail", category="semantic_readiness", source_module="topic_analyzer"),
        ]
        res_0 = calculate_deterministic_score(sig_near_0)
        assert res_0.overall_score == 0.0
        assert res_0.status == "deficient"

    def test_deterministic_reproducibility_under_repeated_executions(self):
        """Verifies that 50 repeated evaluations of identical signals produce byte-for-byte identical results."""
        signals = [
            UnifiedSignal(rule_id="trust_contact_info", status="pass", category="trust", source_module="trust_engine"),
            UnifiedSignal(rule_id="authority_claim_support", status="fail", category="authority", source_module="authority_engine", severity="high"),
            UnifiedSignal(rule_id="content_word_count", status="warning", category="quality", source_module="quality_analyzer"),
            UnifiedSignal(rule_id="r-str-01", status="pass", category="structure", source_module="page_extractor"),
            UnifiedSignal(rule_id="semantic_entity_depth", status="pass", category="topic", source_module="topic_analyzer"),
        ]

        baseline = calculate_deterministic_score(signals)

        for _ in range(50):
            current = calculate_deterministic_score(signals)
            assert current.overall_score == baseline.overall_score
            assert current.status == baseline.status
            assert current.total_penalties_applied == baseline.total_penalties_applied
            for cat_k, cat_val in baseline.category_scores.items():
                assert current.category_scores[cat_k].score == cat_val.score

    def test_order_invariance_scoring(self):
        """Verifies that evaluating signals in different permutations yields the exact same overall and category scores."""
        signals = [
            UnifiedSignal(rule_id="r1", status="pass", category="trust_transparency", source_module="trust_engine"),
            UnifiedSignal(rule_id="r2", status="fail", category="authority_citations", source_module="authority_engine"),
            UnifiedSignal(rule_id="r3", status="warning", category="content_quality", source_module="quality_analyzer"),
            UnifiedSignal(rule_id="r4", status="pass", category="content_structure", source_module="page_extractor"),
            UnifiedSignal(rule_id="r5", status="pass", category="semantic_readiness", source_module="topic_analyzer"),
        ]

        base_res = calculate_deterministic_score(signals)

        for _ in range(10):
            shuffled = list(signals)
            random.shuffle(shuffled)
            shuffled_res = calculate_deterministic_score(shuffled)
            assert shuffled_res.overall_score == base_res.overall_score
            for cat_k in base_res.category_scores:
                assert shuffled_res.category_scores[cat_k].score == base_res.category_scores[cat_k].score


# =============================================================================
# 2. Applicability & Status Tests
# =============================================================================

class TestApplicabilityAndStatusSemantics:
    """Verifies all 5 canonical statuses (PASS, FAIL, WARNING, N/A, UNKNOWN) and missing data handling."""

    def test_all_canonical_statuses_evaluated_correctly(self):
        """Evaluates PASS, FAIL, WARNING, N/A, and UNKNOWN in a single unified signal collection."""
        signals = [
            UnifiedSignal(rule_id="r_pass", status="pass", category="trust_transparency", source_module="trust_engine"),
            UnifiedSignal(rule_id="r_fail", status="fail", category="authority_citations", source_module="authority_engine", severity="high"),
            UnifiedSignal(rule_id="r_warn", status="warning", category="content_quality", source_module="quality_analyzer"),
            UnifiedSignal(rule_id="r_na", status="n/a", category="content_structure", source_module="page_extractor", applicability="not_applicable"),
            UnifiedSignal(rule_id="r_unk", status="unknown", category="semantic_readiness", source_module="topic_analyzer"),
        ]

        context = ApplicabilityContext(page_type="article")
        evaluated = evaluate_applicability(signals, context=context)
        score_res = calculate_deterministic_score(evaluated, context=context)

        # PASS: full credit
        # FAIL: 0 credit
        # WARNING: 0.5 credit
        # N/A: excluded with 0 penalty
        # UNKNOWN: excluded with 0 failure penalty
        assert score_res.total_rules_applicable == 3
        assert score_res.total_penalties_applied == 2  # fail + warning
        assert score_res.category_scores["content_structure"].score == 100.0  # N/A gave 100
        assert score_res.category_scores["semantic_readiness"].score == 100.0  # UNKNOWN gave 100

    def test_na_and_unknown_create_zero_penalty(self):
        """Verifies N/A and UNKNOWN rules produce 0 point deductions in overall and category scores."""
        signals = [
            UnifiedSignal(rule_id="author_credentials_present", status="fail", category="trust_transparency", source_module="trust_engine"),
            UnifiedSignal(rule_id="citation_readiness", status="fail", category="authority_citations", source_module="authority_engine"),
        ]
        # On a privacy policy page with no claims asserted, both become N/A
        context = ApplicabilityContext(page_type="legal_privacy", available_data={"has_claims": False})
        evaluated = evaluate_applicability(signals, context=context)
        score_res = calculate_deterministic_score(evaluated, context=context)

        assert score_res.overall_score == 100.0
        assert score_res.total_penalties_applied == 0
        assert score_res.status == "optimal"

    def test_missing_data_safe_handling_without_false_fails(self):
        """Verifies that missing HTML, empty body, or null fields evaluate to UNKNOWN, not FAIL."""
        context = ApplicabilityContext(
            url="https://example.com/test",
            text_content="",
            raw_html="",
            available_data={"has_raw_html": False, "has_text": False},
        )
        signals = [
            UnifiedSignal(rule_id="heading_structure_h1", status="open", category="content_structure", source_module="page_extractor"),
            UnifiedSignal(rule_id="word_count_depth", status="open", category="content_quality", source_module="quality_analyzer"),
        ]
        evaluated = evaluate_applicability(signals, context=context)
        for s in evaluated:
            assert s.status == ApplicabilityStatus.UNKNOWN.value

        score_res = calculate_deterministic_score(evaluated, context=context)
        assert score_res.overall_score == 100.0  # Missing data is not penalized as FAIL

    def test_pass_generates_zero_negative_recommendations(self):
        """Verifies that PASS signals never produce negative recommendations."""
        signals = [
            UnifiedSignal(rule_id="r_pass_1", status="pass", category="trust_transparency", source_module="trust_engine"),
            UnifiedSignal(rule_id="r_pass_2", status="pass", category="content_quality", source_module="quality_analyzer"),
        ]
        score_res = calculate_deterministic_score(signals)
        recs = generate_prioritized_recommendations(score_res)
        assert len(recs) == 0


# =============================================================================
# 3. Duplicate-Penalty Protection & Idempotency Tests
# =============================================================================

class TestDuplicatePenaltyProtectionAndIdempotency:
    """Verifies that duplicate signals/findings do not create multiple score penalties."""

    def test_duplicate_signals_no_double_deduction(self):
        """Verifies that passing the exact same failing signal 10 times results in exactly 1 score deduction."""
        failing_sig = UnifiedSignal(
            rule_id="missing_h1",
            status="fail",
            category="content_structure",
            source_module="page_extractor",
            evidence={"h1_count": 0},
            severity="high",
        )
        signals = [failing_sig.model_copy(deep=True) for _ in range(10)]

        score_res = calculate_deterministic_score(signals)
        assert score_res.total_duplicates_prevented == 9
        assert score_res.total_penalties_applied == 1
        assert score_res.category_scores["content_structure"].score == 0.0

    def test_duplicate_findings_no_double_deduction(self):
        """Verifies that multiple duplicate finding models representing the same issue create 1 deduction."""
        finding1 = Finding(title="Missing Meta", finding_type="missing_meta_description", category="content_structure", severity="medium", status="open")
        finding2 = Finding(title="Missing Meta", finding_type="missing_meta_description", category="content_structure", severity="medium", status="open")

        sig1 = normalize_signal(finding1)
        sig2 = normalize_signal(finding2)

        signals = [sig1, sig2]
        aggregated = aggregate_signals(signals)
        assert aggregated.duplicate_count == 1
        assert len(aggregated.signals) == 1

        score_res = calculate_deterministic_score(aggregated.signals)
        assert score_res.total_penalties_applied == 1

    def test_deductions_remain_traceable_to_rule_and_category(self):
        """Verifies that deductions record exact rule_id, category, and evidence."""
        sig = UnifiedSignal(
            rule_id="unsupported_factual_claim",
            status="fail",
            category="authority_citations",
            source_module="authority_engine",
            evidence={"claim": "99% faster", "line": 42},
            severity="high",
        )
        score_res = calculate_deterministic_score([sig])
        assert len(score_res.traceability_chain) == 1
        contrib = score_res.traceability_chain[0]
        assert contrib.rule_id == "unsupported_factual_claim"
        assert contrib.category == "authority_citations"
        assert contrib.evidence == {"claim": "99% faster", "line": 42}
        assert contrib.is_penalized is True

    def test_repeated_execution_idempotency(self):
        """Verifies recommendations generated across repeated runs maintain identical IDs and order."""
        sig = UnifiedSignal(
            rule_id="missing_h1",
            status="fail",
            category="content_structure",
            source_module="page_extractor",
            severity="high",
        )
        score_res = calculate_deterministic_score([sig])
        recs1 = generate_prioritized_recommendations(score_res)
        recs2 = generate_prioritized_recommendations(score_res)

        assert len(recs1) == len(recs2) == 1
        assert recs1[0].recommendation_id == recs2[0].recommendation_id
        assert recs1[0].priority == recs2[0].priority


# =============================================================================
# 4. Category & Total-Score Regression Tests
# =============================================================================

class TestCategoryAndTotalScoreRegression:
    """Verifies category isolation, weight aggregation, and non-bleeding scoring."""

    def test_category_scores_within_zero_to_hundred(self):
        """Verifies all 5 categories remain strictly between [0.0, 100.0]."""
        signals = [
            UnifiedSignal(rule_id="r1", status="pass", category="trust_transparency", source_module="trust_engine"),
            UnifiedSignal(rule_id="r2", status="fail", category="authority_citations", source_module="authority_engine"),
            UnifiedSignal(rule_id="r3", status="warning", category="content_quality", source_module="quality_analyzer"),
        ]
        result = calculate_deterministic_score(signals)
        for cat_k, cat_val in result.category_scores.items():
            assert 0.0 <= cat_val.score <= 100.0

    def test_category_weights_aggregate_correctly(self):
        """Verifies overall_score == sum(cat_score * weight)."""
        signals = [
            UnifiedSignal(rule_id="r_trust", status="pass", category="trust_transparency", source_module="trust_engine"),
            UnifiedSignal(rule_id="r_auth", status="fail", category="authority_citations", source_module="authority_engine"),  # 0
            UnifiedSignal(rule_id="r_qual", status="pass", category="content_quality", source_module="quality_analyzer"),
            UnifiedSignal(rule_id="r_str", status="pass", category="content_structure", source_module="page_extractor"),
            UnifiedSignal(rule_id="r_sem", status="pass", category="semantic_readiness", source_module="topic_analyzer"),
        ]
        result = calculate_deterministic_score(signals)
        # Expected: trust(100*0.20) + auth(0*0.25) + qual(100*0.25) + str(100*0.15) + sem(100*0.15)
        # = 20 + 0 + 25 + 15 + 15 = 75.0
        assert result.overall_score == 75.0

    def test_category_isolation_single_category_defect(self):
        """Verifies defect in trust_transparency affects only trust and overall score, leaving others at 100.0."""
        sig_trust_defect = [
            UnifiedSignal(rule_id="trust_author_credentials_present", status="fail", category="trust_transparency", source_module="trust_engine", severity="high"),
        ]
        result = calculate_deterministic_score(sig_trust_defect)

        assert result.category_scores["trust_transparency"].score == 0.0
        assert result.category_scores["authority_citations"].score == 100.0
        assert result.category_scores["content_quality"].score == 100.0
        assert result.category_scores["content_structure"].score == 100.0
        assert result.category_scores["semantic_readiness"].score == 100.0
        # Overall = 100 - (100 * 0.20) = 80.0
        assert result.overall_score == 80.0

    def test_unrelated_findings_do_not_bleed_into_other_categories(self):
        """Verifies that structure findings do not penalize content_quality or semantic_readiness."""
        signals = [
            UnifiedSignal(rule_id="r-str-01", status="fail", category="content_structure", source_module="page_extractor"),
            UnifiedSignal(rule_id="r-str-02", status="fail", category="content_structure", source_module="page_extractor"),
        ]
        result = calculate_deterministic_score(signals)

        assert result.category_scores["content_structure"].score == 0.0
        assert result.category_scores["content_quality"].score == 100.0
        assert result.category_scores["semantic_readiness"].score == 100.0
        # Overall = 100 - (100 * 0.15) = 85.0
        assert result.overall_score == 85.0


# =============================================================================
# 5. Traceability Regression Tests
# =============================================================================

class TestTraceabilityRegression:
    """Verifies complete deduction -> category -> rule -> evidence -> finding provenance chain."""

    def test_complete_deduction_traceability_chain(self):
        """Verifies that each deduction contains full rule, category, evidence, and finding provenance."""
        finding = Finding(
            id=101,
            title="Missing Canonical Tag",
            finding_type="missing_canonical_tag",
            category="structure",
            severity="medium",
            status="open",
            evidence={"canonical_url": None},
        )
        sig = normalize_signal(finding)
        score_res = calculate_deterministic_score([sig])
        explanation = explain_score(score_res)

        assert len(explanation.deductions) == 1
        deduction = explanation.deductions[0]
        assert deduction.rule_id == "missing_canonical_tag"
        assert deduction.category == "content_structure"
        assert deduction.point_deduction > 0.0
        assert deduction.status == "fail"
        assert deduction.finding_id == "101"

    def test_traceability_survives_api_and_pydantic_serialization(self):
        """Verifies that Pydantic model_dump() serialization preserves all provenance fields."""
        sig = UnifiedSignal(
            rule_id="unsupported_claim_stat",
            status="fail",
            category="authority_citations",
            source_module="authority_engine",
            evidence={"stat": "10x performance"},
            metadata={"finding_id": "999"},
        )
        score_res = calculate_deterministic_score([sig])
        recs = generate_prioritized_recommendations(score_res)

        assert len(recs) == 1
        rec_dict = recs[0].model_dump()
        assert rec_dict["finding_id"] == "999"
        assert rec_dict["rule_id"] == "unsupported_claim_stat"
        assert rec_dict["category"] == "authority_citations"
        assert rec_dict["evidence"] == {"stat": "10x performance"}

    def test_page_analytics_traceability_counts(self):
        """Verifies PageScoreAnalytics counts match score deductions exactly."""
        signals = [
            UnifiedSignal(rule_id="r1", status="fail", category="trust_transparency", source_module="trust_engine", severity="critical"),
            UnifiedSignal(rule_id="r2", status="warning", category="content_quality", source_module="quality_analyzer", severity="low"),
            UnifiedSignal(rule_id="r3", status="pass", category="semantic_readiness", source_module="topic_analyzer"),
        ]
        score_res = calculate_deterministic_score(signals)
        recs = generate_prioritized_recommendations(score_res)
        analytics = build_page_analytics(score_res, recommendations=recs, page_id=1, url="https://test.com")

        assert analytics.priority_counts["critical"] >= 1
        assert analytics.applicability_counts["pass"] == 1
        assert analytics.applicability_counts["fail"] == 1
        assert analytics.applicability_counts["warning"] == 1


# =============================================================================
# 6. Fixture-Based Regression Suite
# =============================================================================

class TestFixtureBasedRegressionSuite:
    """Evaluates comprehensive fixtures representing healthy, partial, poor, missing, N/A, and mixed pages."""

    def test_healthy_page_fixture(self):
        """Fully compliant page fixture -> optimal status, high score (>= 90)."""
        signals = [
            UnifiedSignal(rule_id="trust_author_credentials_present", status="pass", category="trust_transparency", source_module="trust_engine"),
            UnifiedSignal(rule_id="authority_claim_support", status="pass", category="authority_citations", source_module="authority_engine"),
            UnifiedSignal(rule_id="content_word_count_adequate", status="pass", category="content_quality", source_module="quality_analyzer"),
            UnifiedSignal(rule_id="heading_structure_h1_present", status="pass", category="content_structure", source_module="page_extractor"),
            UnifiedSignal(rule_id="semantic_entity_coverage_deep", status="pass", category="semantic_readiness", source_module="topic_analyzer"),
        ]
        result = calculate_deterministic_score(signals)
        assert result.overall_score == 100.0
        assert result.status == "optimal"
        assert result.total_penalties_applied == 0

    def test_partially_compliant_page_fixture(self):
        """Partially compliant page fixture -> adequate status, moderate score (65-85)."""
        signals = [
            UnifiedSignal(rule_id="trust_author_credentials_present", status="pass", category="trust_transparency", source_module="trust_engine"),
            UnifiedSignal(rule_id="authority_claim_support", status="warning", category="authority_citations", source_module="authority_engine"),  # partial credit
            UnifiedSignal(rule_id="content_word_count_adequate", status="pass", category="content_quality", source_module="quality_analyzer"),
            UnifiedSignal(rule_id="heading_structure_h1_present", status="fail", category="content_structure", source_module="page_extractor"),   # 0 credit
            UnifiedSignal(rule_id="semantic_entity_coverage_deep", status="pass", category="semantic_readiness", source_module="topic_analyzer"),
        ]
        result = calculate_deterministic_score(signals)
        # auth loses 12.5 pts (0.5 of 25), structure loses 15 pts -> Overall = 100 - 27.5 = 72.5
        assert result.overall_score == 72.5
        assert result.status == "adequate"

    def test_poor_quality_page_fixture(self):
        """Poor-quality page fixture -> deficient status, low score (< 50)."""
        signals = [
            UnifiedSignal(rule_id="trust_author_credentials_present", status="fail", category="trust_transparency", source_module="trust_engine", severity="critical"),
            UnifiedSignal(rule_id="authority_claim_support", status="fail", category="authority_citations", source_module="authority_engine", severity="high"),
            UnifiedSignal(rule_id="content_word_count_adequate", status="fail", category="content_quality", source_module="quality_analyzer", severity="high"),
            UnifiedSignal(rule_id="heading_structure_h1_present", status="fail", category="content_structure", source_module="page_extractor", severity="medium"),
            UnifiedSignal(rule_id="semantic_entity_coverage_deep", status="warning", category="semantic_readiness", source_module="topic_analyzer", severity="low"),
        ]
        result = calculate_deterministic_score(signals)
        assert result.overall_score < 50.0
        assert result.status == "deficient"

    def test_missing_data_page_fixture(self):
        """Page with missing body/HTML -> all UNKNOWN, 0 failure penalty, score stays at 100.0 baseline."""
        context = ApplicabilityContext(
            url="https://empty.example.com",
            text_content="",
            raw_html="",
            available_data={"has_raw_html": False, "has_text": False},
        )
        signals = [
            UnifiedSignal(rule_id="r-str-01", status="open", category="content_structure", source_module="page_extractor"),
            UnifiedSignal(rule_id="word_count", status="open", category="content_quality", source_module="quality_analyzer"),
        ]
        evaluated = evaluate_applicability(signals, context=context)
        result = calculate_deterministic_score(evaluated, context=context)
        assert result.overall_score == 100.0
        assert result.total_penalties_applied == 0

    def test_na_rules_page_fixture(self):
        """Legal privacy policy page fixture -> author and claim rules marked N/A with 0 penalty."""
        context = ApplicabilityContext(page_type="legal_privacy", available_data={"has_claims": False})
        signals = [
            UnifiedSignal(rule_id="author_credentials_present", status="fail", category="trust_transparency", source_module="trust_engine"),
            UnifiedSignal(rule_id="claim_support", status="fail", category="authority_citations", source_module="authority_engine"),
            UnifiedSignal(rule_id="content_structure_h1", status="pass", category="content_structure", source_module="page_extractor"),
        ]
        evaluated = evaluate_applicability(signals, context=context)
        result = calculate_deterministic_score(evaluated, context=context)
        assert result.overall_score == 100.0
        assert result.category_scores["content_structure"].score == 100.0

    def test_duplicate_evidence_findings_page_fixture(self):
        """Page with 5 duplicate missing_h1 findings -> exactly 1 penalty applied."""
        signals = [
            UnifiedSignal(rule_id="missing_h1", status="fail", category="content_structure", source_module="page_extractor", severity="high")
            for _ in range(5)
        ]
        result = calculate_deterministic_score(signals)
        assert result.total_duplicates_prevented == 4
        assert result.total_penalties_applied == 1

    def test_mixed_results_page_fixture(self):
        """Rich combination of PASS, FAIL, WARNING, N/A, UNKNOWN -> mathematically consistent result."""
        signals = [
            UnifiedSignal(rule_id="r_pass_trust", status="pass", category="trust_transparency", source_module="trust_engine"),
            UnifiedSignal(rule_id="r_fail_auth", status="fail", category="authority_citations", source_module="authority_engine"),
            UnifiedSignal(rule_id="r_warn_qual", status="warning", category="content_quality", source_module="quality_analyzer"),
            UnifiedSignal(rule_id="r_na_str", status="n/a", category="content_structure", source_module="page_extractor"),
            UnifiedSignal(rule_id="r_unk_sem", status="unknown", category="semantic_readiness", source_module="topic_analyzer"),
        ]
        result = calculate_deterministic_score(signals)
        assert 0.0 < result.overall_score < 100.0
        assert result.total_rules_applicable == 3
        assert result.category_scores["content_structure"].score == 100.0
        assert result.category_scores["semantic_readiness"].score == 100.0


# =============================================================================
# 7. API Endpoints Regression Tests
# =============================================================================

class TestAPIEndpointsRegression:
    """Verifies all score, recommendation, site summary, and history REST endpoints."""

    def test_page_score_endpoint_regression(self, client, db_session):
        website = Website(name="Acme Corp", url="https://acme.org")
        db_session.add(website)
        db_session.commit()

        scan = Scan(website_id=website.id, status="completed")
        db_session.add(scan)
        db_session.commit()

        page = PageResult(scan_id=scan.id, url="https://acme.org/services", content="<h1>Services</h1>")
        db_session.add(page)
        db_session.commit()

        finding = Finding(
            website_id=website.id,
            scan_id=scan.id,
            page_id=page.id,
            finding_type="missing_meta_description",
            category="structure",
            title="Missing Meta Description",
            description="Page lacks meta description",
            severity="medium",
            status="open",
        )
        db_session.add(finding)
        db_session.commit()

        res = client.get(f"/api/v1/scores/pages/{page.id}")
        assert res.status_code == 200
        data = res.json()
        assert data["overall_score"] < 100.0
        assert "category_explanations" in data
        assert "deductions" in data
        assert len(data["deductions"]) >= 1
        assert data["deductions"][0]["rule_id"] == "missing_meta_description"

    def test_page_recommendations_endpoint_regression(self, client, db_session):
        website = Website(name="Beta Corp", url="https://beta.com")
        db_session.add(website)
        db_session.commit()

        scan = Scan(website_id=website.id, status="completed")
        db_session.add(scan)
        db_session.commit()

        page = PageResult(scan_id=scan.id, url="https://beta.com/blog", content="<p>Blog post</p>")
        db_session.add(page)
        db_session.commit()

        finding = Finding(
            website_id=website.id,
            scan_id=scan.id,
            page_id=page.id,
            finding_type="missing_h1",
            category="structure",
            title="Missing H1 Heading",
            description="No H1 heading found",
            severity="high",
            status="open",
        )
        db_session.add(finding)
        db_session.commit()

        res = client.get(f"/api/v1/scores/pages/{page.id}/recommendations")
        assert res.status_code == 200
        data = res.json()
        assert data["total_recommendations"] >= 1
        assert data["quick_wins_count"] >= 1

        # Test query parameter classification filter
        res_qw = client.get(f"/api/v1/scores/pages/{page.id}/recommendations?classification=quick_win")
        assert res_qw.status_code == 200
        assert all(r["classification"] == "quick_win" for r in res_qw.json()["recommendations"])

    def test_site_summary_endpoint_regression(self, client, db_session):
        website = Website(name="Gamma Site", url="https://gamma.io")
        db_session.add(website)
        db_session.commit()

        scan = Scan(website_id=website.id, status="completed")
        db_session.add(scan)
        db_session.commit()

        p1 = PageResult(scan_id=scan.id, url="https://gamma.io/", content="<h1>Gamma Home</h1>")
        p2 = PageResult(scan_id=scan.id, url="https://gamma.io/about", content="<h1>About Gamma</h1>")
        db_session.add_all([p1, p2])
        db_session.commit()

        f1 = Finding(
            title="Missing Title 1",
            description="Page is missing title tag",
            website_id=website.id,
            scan_id=scan.id,
            page_id=p1.id,
            finding_type="missing_title",
            category="structure",
            severity="high",
            status="open",
        )
        f2 = Finding(
            title="Missing Title 2",
            description="Page is missing title tag",
            website_id=website.id,
            scan_id=scan.id,
            page_id=p2.id,
            finding_type="missing_title",
            category="structure",
            severity="high",
            status="open",
        )
        db_session.add_all([f1, f2])
        db_session.commit()

        res = client.get(f"/api/v1/scores/websites/{website.id}")
        assert res.status_code == 200
        data = res.json()
        assert data["total_pages_analyzed"] == 2
        assert len(data["top_issues"]) >= 1
        assert data["top_issues"][0]["rule_id"] == "missing_title"
        assert data["top_issues"][0]["affected_pages_count"] == 2

    def test_site_history_endpoint_regression(self, client, db_session):
        website = Website(name="Delta Site", url="https://delta.dev")
        db_session.add(website)
        db_session.commit()

        s1 = Scan(website_id=website.id, status="completed")
        s2 = Scan(website_id=website.id, status="completed")
        db_session.add_all([s1, s2])
        db_session.commit()

        p1 = PageResult(scan_id=s1.id, url="https://delta.dev/home", content="<h1>Delta</h1>")
        p2 = PageResult(scan_id=s2.id, url="https://delta.dev/home", content="<h1>Delta</h1>")
        db_session.add_all([p1, p2])
        db_session.commit()

        res = client.get(f"/api/v1/scores/websites/{website.id}/history")
        assert res.status_code == 200
        data = res.json()
        assert data["website_id"] == website.id
        assert len(data["history"]) == 2

    def test_api_boundary_empty_and_na_handling(self, client, db_session):
        website = Website(name="Empty Site", url="https://empty.com")
        db_session.add(website)
        db_session.commit()

        # Site with 0 scans
        res_empty = client.get(f"/api/v1/scores/websites/{website.id}")
        assert res_empty.status_code == 200
        assert res_empty.json()["overall_site_score"] == 100.0
        assert res_empty.json()["total_pages_analyzed"] == 0

        # Nonexistent page 404
        res_404 = client.get("/api/v1/scores/pages/999999")
        assert res_404.status_code == 404


# =============================================================================
# 8. Real Public-Page Validation Tests
# =============================================================================

class TestRealSiteScoringValidation:
    """Validates the complete pipeline against real-world page types with offline determinism."""

    def test_offline_real_world_pages_pipeline_validation(self):
        """Runs the validation runner against all 4 offline real-world page fixtures."""
        report = run_real_site_validation(allow_live_network=False)

        assert report["total_pages_evaluated"] == 4
        assert len(report["pages"]) == 4

        # Check that all 4 expected page types were evaluated
        page_types = {p["inferred_page_type"] for p in report["pages"]}
        assert "homepage" in page_types
        assert "about" in page_types
        assert "documentation" in page_types
        assert "legal_privacy" in page_types

        # Check that scores, categories, and recommendations were generated
        for p in report["pages"]:
            assert 0.0 <= p["overall_score"] <= 100.0
            assert p["score_status"] in ("optimal", "adequate", "needs_improvement", "deficient")
            assert len(p["category_scores"]) == 5
            assert p["live_fetch"] is False

        # Check Site Summary
        site = report["site_summary"]
        assert site["total_pages_analyzed"] == 4
        assert 0.0 <= site["overall_site_score"] <= 100.0
        assert len(site["category_summaries"]) == 5

    def test_single_page_validation_helper(self):
        """Tests validate_single_page directly on the homepage fixture."""
        homepage_info = OFFLINE_PAGE_FIXTURES["homepage"]
        res = validate_single_page("homepage", homepage_info, allow_live_network=False)

        assert res["target_key"] == "homepage"
        assert res["url"] == "https://www.python.org/"
        assert res["overall_score"] > 0.0
        assert res["recommendations_count"] >= 0
        assert res["analytics"] is not None
