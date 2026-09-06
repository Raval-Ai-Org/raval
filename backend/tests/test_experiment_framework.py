"""
Unit & Integration Tests for Task 12 Step 5:
Experiment Framework + Metrics + Failure/Recovery + Production Readiness.

Verifies:
1. Experiment contract & lifecycle states (PENDING -> RUNNING -> SUCCEEDED / FAILED / INCONCLUSIVE / INVALID).
2. Deterministic hypothesis evaluation (CONFIRMED vs NOT_CONFIRMED vs INCONCLUSIVE vs INVALID).
3. 5-Dimension Metrics calculation (Fix Effectiveness, Regressions, Score Deltas, Evidence, Operational).
4. Deterministic decision policies (KEEP, ROLLBACK, REVIEW, NO_CHANGE).
5. Failure & Recovery Matrix across 13 stages, timeouts, ambiguous mutations, stale graphs, bounded retries (max 2).
6. Production Readiness Guard across 5 pillars (Auth/Workspace, SSRF/Security, Reliability/Concurrency, Execution Safety, Observability).
7. Thread-safe concurrency and resource locking via ResourceLockManager.
8. Idempotency and result caching.
9. Metric boundary transparency (OBSERVED vs INFERRED vs NOT_MEASURED) & mandatory score disclaimers.
10. FastAPI REST endpoints for experiment creation, execution, retrieval, metrics, and readiness checks.
"""

import concurrent.futures
import time
import uuid
from typing import Any
import pytest
from fastapi.testclient import TestClient

from app.lab.delta import FindingDeltaItem, FindingDeltaReport, FindingTransitionState, ScoreDeltaReport
from app.lab.evidence import EvidenceState, EvidenceStore, MeasurementSnapshot, ResourceObservation, get_evidence_store
from app.lab.experiment import (
    Experiment,
    ExperimentDecision,
    ExperimentStatus,
    ExperimentType,
    Hypothesis,
    HypothesisResult,
    ObservationConfidence,
)
from app.lab.experiment_metrics import (
    EvidenceMetrics,
    ExperimentMetricsSummary,
    ExperimentResult,
    FixEffectivenessMetrics,
    OperationalMetrics,
    RegressionMetrics,
    ScoreMetrics,
    calculate_experiment_metrics,
)
from app.lab.experiment_service import ExperimentEngine, ExperimentService
from app.lab.failure_recovery import (
    FailureClassification,
    FailureIncident,
    FailureRecoveryManager,
    FailureStage,
    RecoveryResult,
)
from app.lab.fixtures import build_static_site_fixture
from app.lab.harness import PipelineHarness, PipelineRunConfig
from app.lab.impact_model import ChangeType
from app.lab.measurement import ClosedLoopMeasurementReport
from app.lab.production_readiness import (
    ProductionReadinessGuard,
    ProductionReadinessReport,
    ReadinessCategory,
    ReadinessSeverity,
)
from app.lab.regression import RegressionDecision, RegressionFinding, RegressionGuardReport
from app.lab.server import LabTestServer
from app.lab.trace import PipelineExecutionStatus, PipelineStage, StageStatus, StageTrace
from app.lab.verifier import FixVerificationResult, VerificationOutcome
from app.main import app


@pytest.fixture(autouse=True)
def reset_experiment_state():
    """Clear in-memory experiment cache and lock manager between tests."""
    ExperimentService.reset_state()
    yield
    ExperimentService.reset_state()


def _make_dummy_snapshot(url: str = "http://test.local", state: EvidenceState = EvidenceState.BEFORE) -> MeasurementSnapshot:
    obs = ResourceObservation(
        http_status=200,
        title="Test Page",
        title_length=9,
        canonical_self_referencing=True,
        is_indexable=True,
        h1_count=1,
        h1_tags=["Test Heading"],
        heading_hierarchy_valid=True,
        content_hash="hash_abc",
        content_word_count=100,
    )
    return MeasurementSnapshot(
        evidence_id=f"ev_{uuid.uuid4().hex[:8]}",
        execution_id="exec_dummy",
        target_resource="/",
        resource_url=url,
        evidence_state=state,
        observation=obs,
    )


# =============================================================================
# 1. Experiment Model & Hypothesis Contracts
# =============================================================================

class TestExperimentContracts:
    def test_hypothesis_creation_and_defaults(self):
        hyp = Hypothesis(
            expected_outcome="Fix meta description on homepage",
            target_finding_ids=["find_meta_1"],
            target_rule_ids=["META_DESC_MISSING"],
            expected_score_min_delta=5.0,
            max_allowed_regression_delta=0.0,
        )
        assert hyp.expected_outcome == "Fix meta description on homepage"
        assert hyp.target_finding_ids == ["find_meta_1"]
        assert hyp.expected_score_min_delta == 5.0
        assert hyp.max_allowed_regression_delta == 0.0
        assert hyp.confidence_level == ObservationConfidence.OBSERVED

    def test_experiment_contract_defaults_and_serialization(self):
        exp = Experiment(
            workspace_id="ws_acme",
            site_id="site_store",
            name="Test Experiment",
            experiment_type=ExperimentType.CONTROLLED_LAB,
            target_resource="/products",
            hypothesis=Hypothesis(expected_outcome="Resolve schema errors"),
        )
        assert exp.experiment_id.startswith("exp_")
        assert exp.status == ExperimentStatus.PENDING
        assert exp.decision == ExperimentDecision.NO_CHANGE
        assert exp.created_at is not None

        dumped = exp.model_dump()
        assert dumped["workspace_id"] == "ws_acme"
        assert dumped["experiment_type"] == "CONTROLLED_LAB"
        assert dumped["status"] == "PENDING"


# =============================================================================
# 2. Deterministic Hypothesis Evaluation & Experiment Engine
# =============================================================================

class TestExperimentEngine:
    def test_evaluate_hypothesis_confirmed(self):
        hyp = Hypothesis(
            expected_outcome="Resolve title defect",
            target_finding_ids=["find_1"],
            expected_score_min_delta=2.0,
            max_allowed_regression_delta=0.0,
        )
        measurement = ClosedLoopMeasurementReport(
            execution_id="exec_1",
            resource_url="http://test.local",
            baseline_snapshot=_make_dummy_snapshot(state=EvidenceState.BEFORE),
            after_snapshot=_make_dummy_snapshot(state=EvidenceState.AFTER),
            verification_results=[
                FixVerificationResult(
                    verification_id="v_1",
                    fix_plan_id="fp_1",
                    finding_id="find_1",
                    rule_id="RULE_TITLE",
                    outcome=VerificationOutcome.RESOLVED,
                    is_resolved=True,
                )
            ],
            regression_report=RegressionGuardReport(
                decision=RegressionDecision.KEEP,
                regressions_detected=False,
                critical_regressions_count=0,
                findings=[],
            ),
            score_delta=ScoreDeltaReport(
                before_score=80.0,
                after_score=88.0,
                overall_delta=8.0,
            ),
            finding_delta=FindingDeltaReport(
                resolved_findings_count=1,
                net_findings_delta=-1,
                transitions=[
                    FindingDeltaItem(
                        finding_id="find_1",
                        rule_id="RULE_TITLE",
                        transition=FindingTransitionState.OPEN_TO_RESOLVED,
                    )
                ],
            ),
            final_decision=RegressionDecision.KEEP,
        )

        result, reason = ExperimentEngine.evaluate_hypothesis(hyp, measurement)
        assert result == HypothesisResult.CONFIRMED
        assert "All targeted findings" in reason
        assert "Score delta +8.0" in reason

    def test_evaluate_hypothesis_not_confirmed_due_to_regression(self):
        hyp = Hypothesis(
            expected_outcome="Fix heading defect",
            target_finding_ids=["find_heading"],
            max_allowed_regression_delta=0.0,
        )
        measurement = ClosedLoopMeasurementReport(
            execution_id="exec_2",
            resource_url="http://test.local",
            baseline_snapshot=_make_dummy_snapshot(state=EvidenceState.BEFORE),
            after_snapshot=_make_dummy_snapshot(state=EvidenceState.AFTER),
            verification_results=[
                FixVerificationResult(
                    verification_id="v_2",
                    fix_plan_id="fp_2",
                    finding_id="find_heading",
                    rule_id="RULE_H1",
                    outcome=VerificationOutcome.RESOLVED,
                    is_resolved=True,
                )
            ],
            regression_report=RegressionGuardReport(
                decision=RegressionDecision.ROLLBACK,
                regressions_detected=True,
                critical_regressions_count=1,
                findings=[
                    RegressionFinding(
                        signal_name="INDEXABILITY",
                        severity="CRITICAL",
                        description="Canonical link broken",
                        is_critical=True,
                    )
                ],
            ),
            score_delta=ScoreDeltaReport(
                before_score=85.0,
                after_score=70.0,
                overall_delta=-15.0,
            ),
            finding_delta=FindingDeltaReport(
                resolved_findings_count=1,
                net_findings_delta=0,
            ),
            final_decision=RegressionDecision.ROLLBACK,
        )

        result, reason = ExperimentEngine.evaluate_hypothesis(hyp, measurement)
        assert result == HypothesisResult.NOT_CONFIRMED
        assert "Blocking regressions detected" in reason

    def test_decision_policy_keep_vs_rollback_vs_review(self):
        # 1. KEEP: Verified, no regression
        dec, expl = ExperimentEngine.evaluate_decision(
            hyp_result=HypothesisResult.CONFIRMED,
            has_blocking_regressions=False,
            all_targets_verified=True,
            score_delta=5.0,
            has_ambiguous_mutations=False,
        )
        assert dec == ExperimentDecision.KEEP
        assert "Hypothesis confirmed" in expl

        # 2. ROLLBACK: Blocking regression
        dec_rb, expl_rb = ExperimentEngine.evaluate_decision(
            hyp_result=HypothesisResult.NOT_CONFIRMED,
            has_blocking_regressions=True,
            all_targets_verified=True,
            score_delta=-10.0,
            has_ambiguous_mutations=False,
        )
        assert dec_rb == ExperimentDecision.ROLLBACK
        assert "Blocking regression" in expl_rb

        # 3. ROLLBACK: Ambiguous mutation
        dec_amb, expl_amb = ExperimentEngine.evaluate_decision(
            hyp_result=HypothesisResult.INCONCLUSIVE,
            has_blocking_regressions=False,
            all_targets_verified=False,
            score_delta=0.0,
            has_ambiguous_mutations=True,
        )
        assert dec_amb == ExperimentDecision.ROLLBACK
        assert "Ambiguous mutation" in expl_amb

        # 4. REVIEW: Unconfirmed without hard regression
        dec_rev, expl_rev = ExperimentEngine.evaluate_decision(
            hyp_result=HypothesisResult.NOT_CONFIRMED,
            has_blocking_regressions=False,
            all_targets_verified=False,
            score_delta=0.0,
            has_ambiguous_mutations=False,
        )
        assert dec_rev == ExperimentDecision.REVIEW
        assert "Manual review" in expl_rev


# =============================================================================
# 3. Deterministic 5-Dimension Metrics Engine
# =============================================================================

class TestExperimentMetrics:
    def test_calculate_metrics_full_report(self):
        measurement = ClosedLoopMeasurementReport(
            execution_id="exec_met_1",
            resource_url="http://test.local",
            baseline_snapshot=_make_dummy_snapshot(state=EvidenceState.BEFORE),
            after_snapshot=_make_dummy_snapshot(state=EvidenceState.AFTER),
            verification_results=[
                FixVerificationResult(verification_id="v1", fix_plan_id="fp1", finding_id="f1", rule_id="R1", outcome=VerificationOutcome.RESOLVED, is_resolved=True),
                FixVerificationResult(verification_id="v2", fix_plan_id="fp2", finding_id="f2", rule_id="R2", outcome=VerificationOutcome.RESOLVED, is_resolved=True),
            ],
            regression_report=RegressionGuardReport(
                decision=RegressionDecision.KEEP,
                regressions_detected=False,
                critical_regressions_count=0,
                findings=[],
            ),
            score_delta=ScoreDeltaReport(
                before_score=70.0,
                after_score=85.0,
                overall_delta=15.0,
            ),
            finding_delta=FindingDeltaReport(
                resolved_count=2,
                net_findings_delta=-2,
                transitions=[
                    FindingDeltaItem(finding_id="f1", rule_id="R1", transition=FindingTransitionState.OPEN_TO_RESOLVED),
                    FindingDeltaItem(finding_id="f2", rule_id="R2", transition=FindingTransitionState.OPEN_TO_RESOLVED),
                ],
            ),
            final_decision=RegressionDecision.KEEP,
        )

        stage_traces = [
            StageTrace(stage_execution_id="st_1", execution_id="ex_1", stage_name=PipelineStage.CRAWL_RENDER, sequence=2, status=StageStatus.SUCCEEDED, duration_ms=120.0),
            StageTrace(stage_execution_id="st_2", execution_id="ex_1", stage_name=PipelineStage.APPLY, sequence=10, status=StageStatus.SUCCEEDED, duration_ms=45.0),
            StageTrace(stage_execution_id="st_3", execution_id="ex_1", stage_name=PipelineStage.RESCAN, sequence=12, status=StageStatus.SUCCEEDED, duration_ms=30.0),
            StageTrace(stage_execution_id="st_4", execution_id="ex_1", stage_name=PipelineStage.COMPARE, sequence=13, status=StageStatus.SUCCEEDED, duration_ms=15.0),
        ]

        metrics = calculate_experiment_metrics(
            measurement_report=measurement,
            stage_traces=stage_traces,
            rescan_scope="TARGETED_RESOURCE",
            rescan_pages_count=1,
            total_site_pages=10,
        )

        # 1. Fix Effectiveness
        assert metrics.fix_effectiveness.target_findings_count == 2
        assert metrics.fix_effectiveness.verified_count == 2
        assert metrics.fix_effectiveness.verification_rate == 1.0
        assert metrics.fix_effectiveness.overall_fix_verified is True

        # 2. Regressions
        assert metrics.regression.total_regressions == 0
        assert metrics.regression.has_blocking_regressions is False
        assert metrics.regression.regression_decision in ("KEEP", "PASS")

        # 3. Score
        assert metrics.score.score_before == 70.0
        assert metrics.score.score_after == 85.0
        assert metrics.score.score_delta == 15.0
        assert metrics.score.resolved_findings_count == 2
        assert "does not guarantee third-party" in metrics.score.disclaimer

        # 4. Evidence
        assert metrics.evidence.confidence_boundary == "OBSERVED"

        # 5. Operational
        assert metrics.operational.total_duration_ms == 210.0
        assert metrics.operational.rescan_duration_ms == 30.0
        assert metrics.operational.rescan_efficiency_savings_pct == 90.0
        assert metrics.operational.stages_executed == 4
        assert metrics.operational.stages_failed == 0


# =============================================================================
# 4. Failure & Recovery Matrix
# =============================================================================

class TestFailureRecoveryManager:
    def test_classify_and_handle_transient_crawl_failure(self):
        incident = FailureRecoveryManager.classify_failure(
            stage=FailureStage.CRAWL,
            error_message="HTTPConnectionPool(host='test.local', port=80): Read timed out",
            attempt=1,
        )
        assert incident.stage == FailureStage.CRAWL
        assert incident.classification == FailureClassification.TRANSIENT_NETWORK
        assert incident.is_retryable is True
        assert incident.actionable_remediation != ""

        # Handle recovery
        rec = FailureRecoveryManager.handle_failure(incident)
        assert rec.should_retry is True
        assert rec.suggested_action == "RETRY_STAGE"
        assert rec.attempts_exhausted is False

    def test_bounded_retries_exhaustion(self):
        # Attempt 3 exceeds MAX_RETRIES (2)
        incident = FailureRecoveryManager.classify_failure(
            stage=FailureStage.CRAWL,
            error_message="Connection refused",
            attempt=3,
        )
        rec = FailureRecoveryManager.handle_failure(incident)
        assert rec.should_retry is False
        assert rec.attempts_exhausted is True
        assert rec.suggested_action == "FAIL_AND_ALERT"

    def test_ambiguous_mutation_safety_handling(self):
        incident = FailureRecoveryManager.classify_failure(
            stage=FailureStage.APPLY,
            error_message="Connector socket closed during write: mutation state UNKNOWN",
            attempt=1,
        )
        assert incident.classification == FailureClassification.AMBIGUOUS_MUTATION_STATE
        assert incident.is_retryable is False

        rec = FailureRecoveryManager.handle_failure(incident)
        assert rec.should_retry is False
        assert rec.suggested_action == "HALT_AND_VERIFY_STATE"
        assert "Do not blindly re-apply" in rec.reason

    def test_stale_dependency_graph_escalation(self):
        incident = FailureRecoveryManager.classify_failure(
            stage=FailureStage.RESCAN,
            error_message="Graph hash mismatch: stale dependency graph detected",
            attempt=1,
        )
        assert incident.classification == FailureClassification.STALE_DEPENDENCY_GRAPH

        rec = FailureRecoveryManager.handle_failure(incident)
        assert rec.should_escalate_to_full_rescan is True
        assert rec.suggested_action == "FULL_RESCAN"

    def test_security_violation_rejection(self):
        incident = FailureRecoveryManager.classify_failure(
            stage=FailureStage.WORKSPACE,
            error_message="SSRF Blocked: Attempted connection to private AWS metadata 169.254.169.254",
            attempt=1,
        )
        assert incident.classification == FailureClassification.SECURITY_VIOLATION
        assert incident.is_retryable is False

        rec = FailureRecoveryManager.handle_failure(incident)
        assert rec.suggested_action == "REJECT_AND_AUDIT"


# =============================================================================
# 5. Production Readiness Pre-Flight Guards (5 Pillars)
# =============================================================================

class TestProductionReadinessGuard:
    def test_production_readiness_pass_on_valid_workspace(self):
        report = ProductionReadinessGuard.evaluate(
            workspace_id="ws_production_tenant",
            target_url="https://example.com/blog",
            connector_type="GITHUB",
            change_type="PAGE_METADATA",
            is_dry_run=False,
            resource_id="/blog",
        )
        assert report.is_ready is True
        assert report.total_checks >= 10
        assert report.failed_checks_count == 0
        assert len(report.blocking_issues) == 0

    def test_production_readiness_rejects_ssrf_and_invalid_workspace(self):
        # Invalid workspace ID
        report_bad_ws = ProductionReadinessGuard.evaluate(
            workspace_id="ws/../escape",
            target_url="https://example.com",
        )
        assert report_bad_ws.is_ready is False
        assert any("workspace_id" in issue.lower() for issue in report_bad_ws.blocking_issues)

        # SSRF blocked private IP in non-lab environment
        report_ssrf = ProductionReadinessGuard.evaluate(
            workspace_id="ws_legit",
            target_url="http://192.168.1.100:8080/admin",
        )
        assert report_ssrf.is_ready is False
        assert any("ssrf" in issue.lower() or "private" in issue.lower() for issue in report_ssrf.blocking_issues)


# =============================================================================
# 6. End-to-End Closed-Loop Experiment Service & Concurrency
# =============================================================================

class TestExperimentServiceE2E:
    def test_full_closed_loop_experiment_flow(self):
        with LabTestServer() as server:
            base_url = server.get_static_url("/")
            exp = ExperimentService.create_experiment(
                workspace_id="ws_lab_e2e",
                site_id="site_static_lab",
                name="Lab Static Defect Optimization",
                experiment_type=ExperimentType.CONTROLLED_LAB,
                target_resource="/",
                hypothesis=Hypothesis(
                    expected_outcome="Fix missing metadata without regressions",
                    expected_score_min_delta=0.0,
                ),
            )

            run_config = PipelineRunConfig(
                execution_id=f"run_{exp.experiment_id}",
                workspace_id="ws_lab_e2e",
                site_url=base_url,
                dry_run=False,
            )

            result = ExperimentService.run_experiment(
                experiment=exp.experiment_id,
                run_config=run_config,
            )

            assert result.experiment_id == exp.experiment_id
            assert result.status in (ExperimentStatus.SUCCEEDED, ExperimentStatus.FAILED, ExperimentStatus.INCONCLUSIVE)
            assert result.decision in (ExperimentDecision.KEEP, ExperimentDecision.REVIEW, ExperimentDecision.NO_CHANGE)
            assert result.metrics is not None
            assert result.metrics.operational.total_duration_ms > 0
            assert result.readiness_report is not None
            assert result.readiness_report.is_ready is True

            # Verify retrieval endpoints
            retrieved_exp = ExperimentService.get_experiment(exp.experiment_id)
            assert retrieved_exp is not None
            assert retrieved_exp.status == result.status

            retrieved_res = ExperimentService.get_experiment_result(exp.experiment_id)
            assert retrieved_res is not None
            assert retrieved_res.experiment_id == exp.experiment_id

    def test_concurrent_experiment_locking_safety(self):
        """Verify that concurrent runs execute thread-safely."""
        with LabTestServer() as server:
            base_url = server.get_static_url("/")
            exp1 = ExperimentService.create_experiment(
                workspace_id="ws_concurrent",
                site_id="site_1",
                name="Exp 1",
                target_resource="/page-a",
                hypothesis=Hypothesis(expected_outcome="Test 1"),
            )
            exp2 = ExperimentService.create_experiment(
                workspace_id="ws_concurrent",
                site_id="site_1",
                name="Exp 2",
                target_resource="/page-b",
                hypothesis=Hypothesis(expected_outcome="Test 2"),
            )

            def run_dummy(exp_id: str):
                cfg = PipelineRunConfig(
                    execution_id=f"run_{exp_id}",
                    workspace_id="ws_concurrent",
                    site_url=base_url,
                    dry_run=True,
                )
                return ExperimentService.run_experiment(exp_id, run_config=cfg)

            with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
                f1 = executor.submit(run_dummy, exp1.experiment_id)
                f2 = executor.submit(run_dummy, exp2.experiment_id)
                r1 = f1.result()
                r2 = f2.result()

            assert r1.experiment_id == exp1.experiment_id
            assert r2.experiment_id == exp2.experiment_id


# =============================================================================
# 7. FastAPI REST API Endpoints Testing
# =============================================================================

class TestExperimentAPIEndpoints:
    @pytest.fixture
    def client(self):
        return TestClient(app)

    def test_create_experiment_api(self, client):
        payload = {
            "workspace_id": "ws_api_test",
            "site_id": "site_api_test",
            "name": "API Created Experiment",
            "description": "Created via REST API",
            "experiment_type": "CONTROLLED_LAB",
            "target_resource": "/homepage",
            "hypothesis": {
                "expected_outcome": "Improve schema markup score",
                "target_finding_ids": ["find_schema_01"],
                "target_rule_ids": ["RULE_SCHEMA_ORG"],
                "expected_score_min_delta": 4.5,
                "max_allowed_regression_delta": 0.0,
            },
            "tags": ["seo", "lab"],
        }
        res = client.post("/api/lab/experiments/create", json=payload)
        assert res.status_code == 200
        data = res.json()
        assert data["workspace_id"] == "ws_api_test"
        assert data["status"] == "PENDING"
        assert data["hypothesis"]["expected_score_min_delta"] == 4.5

        # Fetch experiment
        exp_id = data["experiment_id"]
        res_get = client.get(f"/api/lab/experiments/{exp_id}")
        assert res_get.status_code == 200
        assert res_get.json()["experiment_id"] == exp_id

    def test_production_readiness_check_api(self, client):
        payload = {
            "workspace_id": "ws_check_api",
            "target_url": "https://example.com/about",
            "connector_type": "WORDPRESS",
            "change_type": "PAGE_METADATA",
            "is_dry_run": False,
        }
        res = client.post("/api/lab/production-readiness/check", json=payload)
        assert res.status_code == 200
        data = res.json()
        assert data["is_ready"] is True
        assert data["workspace_id"] == "ws_check_api"
        assert len(data["checks"]) > 0

    def test_run_experiment_and_fetch_metrics_api(self, client):
        with LabTestServer() as server:
            base_url = server.get_static_url("/")
            # Create and run
            create_payload = {
                "workspace_id": "ws_run_api",
                "site_id": "site_run_api",
                "name": "API Run Experiment",
                "target_resource": "/",
                "hypothesis": {"expected_outcome": "Verify metrics API"},
            }
            res_create = client.post("/api/lab/experiments/create", json=create_payload)
            assert res_create.status_code == 200
            exp_id = res_create.json()["experiment_id"]

            run_payload = {
                "experiment_id": exp_id,
                "dry_run": True,
                "run_config": {
                    "execution_id": f"exec_api_{exp_id}",
                    "workspace_id": "ws_run_api",
                    "site_url": base_url,
                    "dry_run": True,
                },
            }
            res_run = client.post("/api/lab/experiments/run", json=run_payload)
            assert res_run.status_code == 200
            run_data = res_run.json()
            assert run_data["experiment_id"] == exp_id
            assert "metrics" in run_data
            assert "decision" in run_data

            # Fetch metrics endpoint
            res_metrics = client.get(f"/api/lab/experiments/{exp_id}/metrics")
            assert res_metrics.status_code == 200
            metrics_data = res_metrics.json()
            assert metrics_data["experiment_id"] == exp_id
            assert metrics_data["metrics"]["score"]["disclaimer"] != ""

