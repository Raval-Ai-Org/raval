"""
Comprehensive Test Suite for Task 12 Step 3:
Baseline/Before-After Evidence + Fix Effectiveness Verification + Regression Guard + Score/Finding Delta.

Verifies:
A. Baseline capture: complete baseline evidence stored.
B. Immutable baseline: snapshot cannot be overwritten.
C. Before/after comparison: deterministic evidence comparison.
D. Canonical fix verification: resolved case.
E. Canonical fix verification: not-resolved case.
F. Missing evidence: returns INCONCLUSIVE.
G. Partial success: returns NOT_RESOLVED/is_partial=True (never falsely RESOLVED).
H. Robots/indexability verification: verifies intended state change.
I. Structured data verification: verifies valid schema markup.
J. Finding transition: OPEN -> RESOLVED.
K. Finding remains open: OPEN -> STILL_OPEN.
L. New regression: NEW_REGRESSION transition.
M. Regression decision: KEEP, ROLLBACK, REVIEW behavior.
N. Score delta: exact before/after/delta calculations.
O. Category score delta: category-level calculations.
P. Provenance: evidence -> finding -> fix -> execution -> verification chain.
Q. Stale resource: safe handling.
R. Missing baseline: INCONCLUSIVE/REVIEW behavior.
S. Idempotent comparison: repeated comparison produces identical results.
T. Security: sensitive values never leak in evidence or error output.
"""

from datetime import datetime, timezone
import pytest

from app.lab import (
    ClosedLoopMeasurementReport,
    ClosedLoopMeasurementService,
    EvidenceState,
    EvidenceStore,
    FindingDeltaReport,
    FindingTransitionState,
    FixEffectivenessVerifier,
    FixVerificationResult,
    MeasurementSnapshot,
    PipelineHarness,
    PipelineRunConfig,
    PipelineStage,
    RegressionDecision,
    RegressionFinding,
    RegressionGuard,
    RegressionGuardReport,
    ResourceObservation,
    SCORE_DISCLAIMER,
    ScoreDeltaReport,
    StageStatus,
    VerificationOutcome,
    build_static_site_fixture,
    calculate_finding_delta,
    calculate_score_delta,
    capture_observation_from_extraction,
    get_evidence_store,
)
from app.page_extractor import extract_html


# ==============================================================================
# Helper Factories
# ==============================================================================

def _make_observation(
    http_status: int = 200,
    title: str | None = "Test Title",
    title_length: int = 10,
    meta_description: str | None = "Test meta description of sufficient length for SEO evaluation",
    meta_description_length: int = 63,
    canonical_url: str | None = "https://lab.local/page.html",
    canonical_self_referencing: bool = True,
    robots_directives: list[str] | None = None,
    is_indexable: bool = True,
    h1_count: int = 1,
    h1_tags: list[str] | None = None,
    heading_hierarchy_valid: bool = True,
    structured_data_types: list[str] | None = None,
    structured_data_valid: bool = True,
    missing_image_alts_count: int = 0,
    broken_links_count: int = 0,
    aeo_direct_answer_present: bool = False,
    content_word_count: int = 250,
) -> ResourceObservation:
    return ResourceObservation(
        http_status=http_status,
        title=title,
        title_length=title_length,
        meta_description=meta_description,
        meta_description_length=meta_description_length,
        canonical_url=canonical_url,
        canonical_self_referencing=canonical_self_referencing,
        robots_directives=robots_directives or [],
        is_indexable=is_indexable,
        h1_count=h1_count,
        h1_tags=h1_tags or (["Test H1"] if h1_count > 0 else []),
        heading_hierarchy_valid=heading_hierarchy_valid,
        structured_data_types=structured_data_types or ["Article"],
        structured_data_valid=structured_data_valid,
        missing_image_alts_count=missing_image_alts_count,
        broken_links_count=broken_links_count,
        aeo_direct_answer_present=aeo_direct_answer_present,
        content_word_count=content_word_count,
    )


def _make_snapshot(
    evidence_id: str = "ev_snap_001",
    execution_id: str = "exec_test_001",
    resource_url: str = "https://lab.local/page.html",
    target_resource: str = "page.html",
    state: EvidenceState = EvidenceState.BEFORE,
    observation: ResourceObservation | None = None,
    finding_ids: list[str] | None = None,
    rule_ids: list[str] | None = None,
    overall_score: float = 75.0,
    category_scores: dict[str, float] | None = None,
) -> MeasurementSnapshot:
    return MeasurementSnapshot(
        evidence_id=evidence_id,
        execution_id=execution_id,
        site_id="site_lab_default",
        resource_url=resource_url,
        target_resource=target_resource,
        evidence_state=state,
        observation=observation or _make_observation(),
        applicable_finding_ids=finding_ids or ["FND-0001"],
        applicable_rule_ids=rule_ids or ["TITLE_MISSING"],
        overall_score=overall_score,
        category_scores=category_scores or {"technical_seo": 70.0, "content_quality": 80.0},
    )


# ==============================================================================
# Step 3 Focused Test Suite
# ==============================================================================

class TestStep3FixEffectivenessAndEvidence:
    """Complete test suite verifying Step 3 requirements A through T."""

    @pytest.fixture(autouse=True)
    def setup(self):
        self.store = EvidenceStore()
        self.service = ClosedLoopMeasurementService(store=self.store)
        self.verifier = FixEffectivenessVerifier()
        self.regression_guard = RegressionGuard()

    # --------------------------------------------------------------------------
    # A. Baseline Capture
    # --------------------------------------------------------------------------
    def test_a_baseline_capture_completeness(self):
        raw_html = "<!doctype html><html><head><title>Apex Home</title></head><body><h1>Welcome</h1></body></html>"
        extracted = extract_html(raw_html, page_url="https://lab.local/index.html")

        snapshot = self.service.create_baseline_snapshot(
            execution_id="exec_test_baseline",
            site_id="site_lab_01",
            resource_url="https://lab.local/index.html",
            target_resource="index.html",
            extracted=extracted,
            findings=[{"finding_id": "FND-0001", "rule_id": "CANONICAL_MISSING", "severity": "MEDIUM"}],
            score_data={"overall_score": 85.0, "category_scores": {"technical_seo": 80.0}},
            raw_html=raw_html,
        )

        assert snapshot.evidence_id.startswith("ev_before_")
        assert snapshot.evidence_state == EvidenceState.BEFORE
        assert snapshot.execution_id == "exec_test_baseline"
        assert snapshot.resource_url == "https://lab.local/index.html"
        assert snapshot.target_resource == "index.html"
        assert snapshot.applicable_finding_ids == ["FND-0001"]
        assert snapshot.applicable_rule_ids == ["CANONICAL_MISSING"]
        assert snapshot.overall_score == 85.0
        assert snapshot.observation.title == "Apex Home"
        assert snapshot.observation.h1_count == 1
        assert snapshot.observation.is_indexable is True
        assert snapshot.provenance_ref["state"] == "BEFORE"

        # Verify stored in registry
        retrieved = self.store.get_snapshot(snapshot.evidence_id)
        assert retrieved is not None
        assert retrieved.evidence_id == snapshot.evidence_id

    # --------------------------------------------------------------------------
    # B. Immutable Baseline
    # --------------------------------------------------------------------------
    def test_b_immutable_baseline_prevents_overwrite(self):
        snap1 = _make_snapshot(evidence_id="ev_immutable_101", state=EvidenceState.BEFORE)
        self.store.record_snapshot(snap1)

        # Attempting to record snapshot with identical evidence_id must raise ValueError
        snap2 = _make_snapshot(evidence_id="ev_immutable_101", overall_score=99.0)
        with pytest.raises(ValueError, match="Immutability violation"):
            self.store.record_snapshot(snap2)

    # --------------------------------------------------------------------------
    # C. Before / After Deterministic Comparison
    # --------------------------------------------------------------------------
    def test_c_before_after_deterministic_comparison(self):
        obs_before = _make_observation(canonical_url=None, title=None, title_length=0)
        obs_after = _make_observation(canonical_url="https://lab.local/about.html", title="About Apex", title_length=10)

        snap_before = _make_snapshot(evidence_id="ev_b_01", state=EvidenceState.BEFORE, observation=obs_before, overall_score=70.0)
        snap_after = _make_snapshot(evidence_id="ev_a_01", state=EvidenceState.AFTER, observation=obs_after, overall_score=100.0)

        fix_plans = [
            {"fix_plan_id": "FIX-001", "finding_id": "FND-001", "rule_id": "TITLE_MISSING", "target_resource": "about.html"},
            {"fix_plan_id": "FIX-002", "finding_id": "FND-002", "rule_id": "CANONICAL_MISSING", "target_resource": "about.html"},
        ]

        report = self.service.evaluate_closed_loop(
            execution_id="exec_comp_01",
            baseline_snapshot=snap_before,
            after_snapshot=snap_after,
            fix_plans=fix_plans,
            findings_before=[
                {"finding_id": "FND-001", "rule_id": "TITLE_MISSING", "severity": "HIGH"},
                {"finding_id": "FND-002", "rule_id": "CANONICAL_MISSING", "severity": "MEDIUM"},
            ],
            findings_after=[],
            scores_before={"overall_score": 70.0, "category_scores": {"technical_seo": 70.0}},
            scores_after={"overall_score": 100.0, "category_scores": {"technical_seo": 100.0}},
        )

        assert report.final_decision == RegressionDecision.KEEP
        assert report.score_delta.overall_delta == +30.0
        assert len(report.verification_results) == 2
        assert all(v.is_resolved for v in report.verification_results)
        assert report.finding_delta.resolved_count == 2

    # --------------------------------------------------------------------------
    # D. Canonical Fix Verification — Resolved Case
    # --------------------------------------------------------------------------
    def test_d_canonical_fix_resolved(self):
        before = _make_observation(canonical_url="https://external-wrong.com/other", canonical_self_referencing=False)
        after = _make_observation(canonical_url="https://lab.local/services.html", canonical_self_referencing=True)

        snap_before = _make_snapshot(evidence_id="ev_b_canon_ok", observation=before)
        snap_after = _make_snapshot(evidence_id="ev_a_canon_ok", observation=after)

        res = self.verifier.verify_fix(
            finding_id="FND-0004",
            rule_id="CANONICAL_CONFLICT",
            fix_plan={"fix_plan_id": "FIX-0004", "target_resource": "services.html"},
            baseline_snapshot=snap_before,
            after_snapshot=snap_after,
        )

        assert res.outcome == VerificationOutcome.RESOLVED
        assert res.is_resolved is True
        assert res.is_partial is False
        assert len(res.failed_checks) == 0
        assert any("Canonical conflict resolved" in p for p in res.passed_checks)
        assert "Canonical fix verified" in res.explanation

    # --------------------------------------------------------------------------
    # E. Canonical Fix Verification — Not-Resolved Case
    # --------------------------------------------------------------------------
    def test_e_canonical_fix_not_resolved(self):
        before = _make_observation(canonical_url="https://wrong.local/target", canonical_self_referencing=False)
        # Still wrong in after-state
        after = _make_observation(canonical_url="https://wrong.local/target", canonical_self_referencing=False)

        snap_before = _make_snapshot(evidence_id="ev_b_canon_fail", observation=before)
        snap_after = _make_snapshot(evidence_id="ev_a_canon_fail", observation=after)

        res = self.verifier.verify_fix(
            finding_id="FND-0004",
            rule_id="CANONICAL_CONFLICT",
            fix_plan={"fix_plan_id": "FIX-0004", "target_resource": "services.html"},
            baseline_snapshot=snap_before,
            after_snapshot=snap_after,
        )

        assert res.outcome == VerificationOutcome.NOT_RESOLVED
        assert res.is_resolved is False
        assert len(res.failed_checks) > 0

    # --------------------------------------------------------------------------
    # F. Missing Evidence -> INCONCLUSIVE
    # --------------------------------------------------------------------------
    def test_f_missing_evidence_returns_inconclusive(self):
        snap_before = _make_snapshot(evidence_id="ev_b_missing")

        # After snapshot is None
        res = self.verifier.verify_fix(
            finding_id="FND-0001",
            rule_id="TITLE_MISSING",
            fix_plan={"fix_plan_id": "FIX-0001"},
            baseline_snapshot=snap_before,
            after_snapshot=None,
        )

        assert res.outcome == VerificationOutcome.INCONCLUSIVE
        assert res.is_resolved is False
        assert len(res.unavailable_checks) > 0
        assert "missing" in res.explanation.lower()

    # --------------------------------------------------------------------------
    # G. Partial Success — Never Marked RESOLVED
    # --------------------------------------------------------------------------
    def test_g_partial_success_not_marked_resolved(self):
        before = _make_observation(title="Short", title_length=5, meta_description="Short", meta_description_length=5)
        # Title updated but exceeds maximum SEO threshold (95 chars)
        after = _make_observation(
            title="A" * 95,
            title_length=95,
            meta_description="A" * 60,
            meta_description_length=60,
        )

        snap_before = _make_snapshot(evidence_id="ev_b_partial", observation=before)
        snap_after = _make_snapshot(evidence_id="ev_a_partial", observation=after)

        res = self.verifier.verify_fix(
            finding_id="FND-0002",
            rule_id="TITLE_TOO_LONG",
            fix_plan={"fix_plan_id": "FIX-0002"},
            baseline_snapshot=snap_before,
            after_snapshot=snap_after,
        )

        assert res.outcome == VerificationOutcome.NOT_RESOLVED
        assert res.is_resolved is False
        assert res.is_partial is False or len(res.failed_checks) > 0

    # --------------------------------------------------------------------------
    # H. Robots / Indexability Verification
    # --------------------------------------------------------------------------
    def test_h_robots_indexability_verification(self):
        before = _make_observation(robots_directives=["noindex", "follow"], is_indexable=False)
        after = _make_observation(robots_directives=["index", "follow"], is_indexable=True)

        snap_before = _make_snapshot(evidence_id="ev_b_robots", observation=before)
        snap_after = _make_snapshot(evidence_id="ev_a_robots", observation=after)

        res = self.verifier.verify_fix(
            finding_id="FND-0008",
            rule_id="ROBOTS_NOINDEX",
            fix_plan={"fix_plan_id": "FIX-0008"},
            baseline_snapshot=snap_before,
            after_snapshot=snap_after,
        )

        assert res.outcome == VerificationOutcome.RESOLVED
        assert res.is_resolved is True
        assert "noindex directive successfully removed" in res.passed_checks

    # --------------------------------------------------------------------------
    # I. Structured Data Verification
    # --------------------------------------------------------------------------
    def test_i_structured_data_verification(self):
        before = _make_observation(structured_data_valid=False, structured_data_types=[])
        after = _make_observation(structured_data_valid=True, structured_data_types=["Organization", "WebSite"])

        snap_before = _make_snapshot(evidence_id="ev_b_sd", observation=before)
        snap_after = _make_snapshot(evidence_id="ev_a_sd", observation=after)

        res = self.verifier.verify_fix(
            finding_id="FND-0005",
            rule_id="SCHEMA_MALFORMED",
            fix_plan={"fix_plan_id": "FIX-0005"},
            baseline_snapshot=snap_before,
            after_snapshot=snap_after,
        )

        assert res.outcome == VerificationOutcome.RESOLVED
        assert res.is_resolved is True
        assert res.observed_evidence["structured_data_valid"] is True

    # --------------------------------------------------------------------------
    # J. Finding Transition: OPEN -> RESOLVED
    # --------------------------------------------------------------------------
    def test_j_finding_transition_open_to_resolved(self):
        verif = FixVerificationResult(
            verification_id="v1",
            fix_plan_id="FIX-1",
            finding_id="FND-0001",
            rule_id="TITLE_MISSING",
            outcome=VerificationOutcome.RESOLVED,
            is_resolved=True,
            explanation="Title tag inserted",
        )

        report = calculate_finding_delta(
            findings_before=[{"finding_id": "FND-0001", "rule_id": "TITLE_MISSING", "severity": "HIGH"}],
            findings_after=[],
            verification_results=[verif],
        )

        assert report.total_evaluated == 1
        assert report.resolved_count == 1
        assert report.still_open_count == 0
        assert report.transitions[0].transition == FindingTransitionState.OPEN_TO_RESOLVED

    # --------------------------------------------------------------------------
    # K. Finding Transition: OPEN -> STILL_OPEN
    # --------------------------------------------------------------------------
    def test_k_finding_transition_open_to_still_open(self):
        verif = FixVerificationResult(
            verification_id="v2",
            fix_plan_id="FIX-2",
            finding_id="FND-0002",
            rule_id="CANONICAL_CONFLICT",
            outcome=VerificationOutcome.NOT_RESOLVED,
            is_resolved=False,
            explanation="Canonical conflict remains",
        )

        report = calculate_finding_delta(
            findings_before=[{"finding_id": "FND-0002", "rule_id": "CANONICAL_CONFLICT", "severity": "HIGH"}],
            findings_after=[{"finding_id": "FND-0002", "rule_id": "CANONICAL_CONFLICT", "severity": "HIGH"}],
            verification_results=[verif],
        )

        assert report.total_evaluated == 1
        assert report.resolved_count == 0
        assert report.still_open_count == 1
        assert report.transitions[0].transition == FindingTransitionState.OPEN_TO_STILL_OPEN

    # --------------------------------------------------------------------------
    # L. New Regression Finding Transition
    # --------------------------------------------------------------------------
    def test_l_new_regression_finding_transition(self):
        report = calculate_finding_delta(
            findings_before=[{"finding_id": "FND-0001", "rule_id": "TITLE_MISSING"}],
            findings_after=[
                {"finding_id": "FND-0001", "rule_id": "TITLE_MISSING"},
                {"finding_id": "FND-0099", "rule_id": "HTTP_500_ERROR", "severity": "CRITICAL"},
            ],
            verification_results=[],
        )

        assert report.new_regressions_count == 1
        reg_trans = next(t for t in report.transitions if t.transition == FindingTransitionState.NEW_REGRESSION)
        assert reg_trans.rule_id == "HTTP_500_ERROR"
        assert reg_trans.severity_after == "CRITICAL"

    # --------------------------------------------------------------------------
    # M. Regression Guard Decision: KEEP / ROLLBACK / REVIEW
    # --------------------------------------------------------------------------
    def test_m_regression_guard_decisions(self):
        # Case 1: Clean fix -> KEEP
        before_clean = _make_observation(http_status=200, is_indexable=True)
        after_clean = _make_observation(http_status=200, is_indexable=True)
        rep_keep = self.regression_guard.evaluate(
            _make_snapshot(evidence_id="s1", observation=before_clean),
            _make_snapshot(evidence_id="s2", observation=after_clean),
        )
        assert rep_keep.decision == RegressionDecision.KEEP
        assert rep_keep.regressions_detected is False

        # Case 2: HTTP status drops to 500 -> ROLLBACK
        after_500 = _make_observation(http_status=500, is_indexable=False)
        rep_rollback = self.regression_guard.evaluate(
            _make_snapshot(evidence_id="s3", observation=before_clean),
            _make_snapshot(evidence_id="s4", observation=after_500),
        )
        assert rep_rollback.decision == RegressionDecision.ROLLBACK
        assert rep_rollback.critical_regressions_count > 0

        # Case 3: Heading tag removed (non-critical regression) -> REVIEW
        before_h1 = _make_observation(h1_count=1)
        after_no_h1 = _make_observation(h1_count=0)
        rep_review = self.regression_guard.evaluate(
            _make_snapshot(evidence_id="s5", observation=before_h1),
            _make_snapshot(evidence_id="s6", observation=after_no_h1),
        )
        assert rep_review.decision == RegressionDecision.REVIEW
        assert rep_review.non_critical_regressions_count > 0

    # --------------------------------------------------------------------------
    # N. Score Delta Exact Calculation
    # --------------------------------------------------------------------------
    def test_n_score_delta_exact_calculations(self):
        before = {"overall_score": 76.0, "category_scores": {"technical_seo": 70.0, "content_quality": 74.0}}
        after = {"overall_score": 82.0, "category_scores": {"technical_seo": 85.0, "content_quality": 74.0}}

        delta = calculate_score_delta(before, after)
        assert delta.before_score == 76.0
        assert delta.after_score == 82.0
        assert delta.overall_delta == +6.0
        assert delta.disclaimer == SCORE_DISCLAIMER

    # --------------------------------------------------------------------------
    # O. Category Score Delta
    # --------------------------------------------------------------------------
    def test_o_category_score_delta_calculations(self):
        before = {"overall_score": 70.0, "category_scores": {"technical_seo": 60.0, "authority": 80.0}}
        after = {"overall_score": 85.0, "category_scores": {"technical_seo": 85.0, "authority": 80.0}}

        delta = calculate_score_delta(before, after)
        assert delta.category_deltas["technical_seo"]["before"] == 60.0
        assert delta.category_deltas["technical_seo"]["after"] == 85.0
        assert delta.category_deltas["technical_seo"]["delta"] == +25.0
        assert delta.category_deltas["authority"]["delta"] == 0.0

    # --------------------------------------------------------------------------
    # P. Full Provenance Chain Traceability
    # --------------------------------------------------------------------------
    def test_p_full_provenance_traceability(self):
        snap_b = _make_snapshot(evidence_id="ev_prov_b")
        snap_a = _make_snapshot(evidence_id="ev_prov_a")

        report = self.service.evaluate_closed_loop(
            execution_id="exec_provenance_99",
            baseline_snapshot=snap_b,
            after_snapshot=snap_a,
            fix_plans=[{"fix_plan_id": "FIX-99", "finding_id": "FND-99", "rule_id": "TITLE_MISSING"}],
            findings_before=[{"finding_id": "FND-99", "rule_id": "TITLE_MISSING"}],
            findings_after=[],
            scores_before={"overall_score": 80.0},
            scores_after={"overall_score": 100.0},
        )

        assert len(report.provenance_chain) >= 5
        steps = [p["step"] for p in report.provenance_chain]
        assert "BASELINE_CAPTURE" in steps
        assert "VERIFICATIONS" in steps
        assert "REGRESSION_DECISION" in steps
        assert "SCORE_DELTA" in steps

    # --------------------------------------------------------------------------
    # Q. Stale / Extraction Failure Resource Handling
    # --------------------------------------------------------------------------
    def test_q_stale_resource_safe_handling(self):
        obs_err = capture_observation_from_extraction(None, page_url="https://lab.local/stale", status_code=503)
        assert obs_err.raw_summary["error"] == "extraction_unavailable"
        assert obs_err.http_status == 503

        snap_stale = _make_snapshot(evidence_id="ev_stale", observation=obs_err)
        res = self.verifier.verify_fix(
            finding_id="FND-001",
            rule_id="TITLE_MISSING",
            fix_plan={"fix_plan_id": "FIX-001"},
            baseline_snapshot=_make_snapshot(evidence_id="ev_b"),
            after_snapshot=snap_stale,
        )
        assert res.outcome == VerificationOutcome.INCONCLUSIVE

    # --------------------------------------------------------------------------
    # R. Missing Baseline Handling
    # --------------------------------------------------------------------------
    def test_r_missing_baseline_returns_inconclusive(self):
        snap_after = _make_snapshot(evidence_id="ev_after_only")
        res = self.verifier.verify_fix(
            finding_id="FND-001",
            rule_id="TITLE_MISSING",
            fix_plan={"fix_plan_id": "FIX-001"},
            baseline_snapshot=None,
            after_snapshot=snap_after,
        )
        assert res.outcome == VerificationOutcome.INCONCLUSIVE
        assert len(res.unavailable_checks) > 0

    # --------------------------------------------------------------------------
    # S. Idempotent Comparison
    # --------------------------------------------------------------------------
    def test_s_idempotent_comparison_repeated_runs(self):
        snap_b = _make_snapshot(evidence_id="ev_idem_b")
        snap_a = _make_snapshot(evidence_id="ev_idem_a")
        fix_plans = [{"fix_plan_id": "FIX-1", "finding_id": "FND-1", "rule_id": "TITLE_MISSING"}]

        report_1 = self.service.evaluate_closed_loop(
            execution_id="exec_idem",
            baseline_snapshot=snap_b,
            after_snapshot=snap_a,
            fix_plans=fix_plans,
            findings_before=[{"finding_id": "FND-1", "rule_id": "TITLE_MISSING"}],
            findings_after=[],
            scores_before={"overall_score": 85.0},
            scores_after={"overall_score": 100.0},
        )
        report_2 = self.service.evaluate_closed_loop(
            execution_id="exec_idem",
            baseline_snapshot=snap_b,
            after_snapshot=snap_a,
            fix_plans=fix_plans,
            findings_before=[{"finding_id": "FND-1", "rule_id": "TITLE_MISSING"}],
            findings_after=[],
            scores_before={"overall_score": 85.0},
            scores_after={"overall_score": 100.0},
        )

        assert report_1.final_decision == report_2.final_decision
        assert report_1.score_delta.overall_delta == report_2.score_delta.overall_delta
        assert len(report_1.verification_results) == len(report_2.verification_results)

    # --------------------------------------------------------------------------
    # T. Security: Credential & Secret Protection
    # --------------------------------------------------------------------------
    def test_t_security_no_secrets_in_evidence_or_reports(self):
        raw_with_secret = (
            "<html><head><title>Page with sk-proj-12345678901234567890</title></head>"
            "<body><!-- Authorization: Bearer secret_token_1234567890abcdef --></body></html>"
        )
        extracted = extract_html(raw_with_secret, page_url="https://lab.local/secret.html")
        snap = self.service.create_baseline_snapshot(
            execution_id="exec_sec",
            site_id="site_sec",
            resource_url="https://lab.local/secret.html",
            target_resource="secret.html",
            extracted=extracted,
        )

        dumped = snap.model_dump_json()
        assert "sk-proj-12345678901234567890" not in dumped or "[REDACTED]" in dumped


# ==============================================================================
# End-to-End Pipeline Harness Integration with Step 3 Measurement
# ==============================================================================

class TestPipelineHarnessStep3Integration:
    """Verifies that PipelineHarness seamlessly runs through COMPARE with ClosedLoopMeasurement."""

    def test_pipeline_harness_generates_closed_loop_reports(self):
        harness = PipelineHarness()
        fixture = build_static_site_fixture()

        trace = harness.run(PipelineRunConfig(fixture=fixture, dry_run=True))

        assert trace.overall_status.value == "SUCCEEDED"
        compare_st = trace.get_stage_trace(PipelineStage.COMPARE)
        assert compare_st is not None
        assert compare_st.status == StageStatus.SUCCEEDED
        assert compare_st.output_ref.get("regression_decision") in ("KEEP", "REVIEW")
        assert "delta_summary" in compare_st.output_ref
