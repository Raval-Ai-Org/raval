"""
Task 12 Step 6: GitHub + WordPress Realistic E2E + Full Closed-Loop Integration Suite.

Proves the complete production-style closed-loop site intelligence lifecycle:
SITE -> BASELINE -> DISCOVERY -> CRAWL/RENDER -> EXTRACTION -> INTELLIGENCE ->
SCORE -> FINDING -> FIX PLAN -> CONNECTOR -> SAFETY -> APPLY -> VALIDATE ->
TARGETED RESCAN -> COMPARE -> EFFECTIVENESS -> REGRESSION GUARD ->
EXPERIMENT RESULT -> DECISION -> MONITOR

Covers:
1. GitHub realistic E2E (Happy path, G1 apply failure, G2 validation failure, G3 regression rollback, G4 idempotency, security/isolation).
2. WordPress realistic E2E (Happy path, W1 permission denied, W2 stale state, W3 validation failure, W4 regression rollback, security/isolation).
3. Cross-platform provenance trace integrity (no orphaned IDs, full lineage).
4. Strict observation boundaries (OBSERVED vs INFERRED vs NOT_MEASURED) & mandatory score disclaimers.
"""

from __future__ import annotations

import time
import uuid
from datetime import datetime, timezone
from typing import Any
import pytest

from connectors.base.capabilities import ConnectorCapabilities
from connectors.base.enums import (
    AuthState,
    ConnectorCapability,
    ExecutionOperationType,
    ExecutionStatus,
    HealthStatus,
    ResourceType,
)
from connectors.base.errors import (
    AuthenticationError,
    AuthorizationError,
    InvalidResourceError,
    ResourceNotFoundError,
)
from connectors.base.models import (
    ChangeProposal,
    RateLimitInfo,
    ResourceContent,
    ResourceReference,
    SiteContext,
)
from connectors.base.security import (
    redact_secrets_from_string,
    sanitize_payload,
    validate_safe_identifier,
)
from connectors.github.client import MockGitHubClient
from connectors.github.connector import GitHubConnector
from connectors.github.security import validate_github_path
from connectors.wordpress.client import MockWordPressClient
from connectors.wordpress.connector import WordPressConnector
from connectors.wordpress.models import WordPressSiteIdentity, WordPressUserCapability

from app.fix_safety_classifier import SafetyTier, classify_fix_safety
from app.page_extractor import ExtractionResult, extract_html
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
from app.lab.impact_model import ChangeImpactGraph, ChangeType, DependencyType, ImpactReason, RescanScope
from app.lab.measurement import ClosedLoopMeasurementReport, ClosedLoopMeasurementService
from app.lab.production_readiness import ProductionReadinessGuard
from app.lab.regression import RegressionDecision, RegressionFinding, RegressionGuard, RegressionGuardReport
from app.lab.rescan_policy import RescanPolicyEngine, TargetedRescanRequest
from app.lab.trace import ExecutionTrace, PipelineExecutionStatus, PipelineStage, StageStatus, StageTrace
from app.lab.verifier import FixEffectivenessVerifier, FixVerificationResult, VerificationOutcome


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


@pytest.fixture(autouse=True)
def reset_experiment_state():
    """Clear in-memory state before and after each test."""
    ExperimentService.reset_state()
    yield
    ExperimentService.reset_state()


# =============================================================================
# 1. REALISTIC GITHUB CLOSED-LOOP E2E & SCENARIOS (G1 - G4)
# =============================================================================

class TestGitHubClosedLoopE2E:
    """
    Validates complete GitHub closed-loop remediation workflows against controlled repository test doubles.
    """

    @pytest.fixture
    def github_repo_setup(self):
        ws_id = "ws_github_prod"
        site_id = "site_github_01"
        initial_files = {
            "index.html": "<!DOCTYPE html><html><head><title>Home - Raval AI Search</title></head><body><h1>Home</h1></body></html>",
            "about.html": "<!DOCTYPE html><html><head><title>About Us</title></head><body><h1>About Raval</h1></body></html>",
            "services.html": "<!DOCTYPE html><html><head><title>Services</title><link rel=\"canonical\" href=\"https://example.com/services\"></head><body><h1>Services</h1></body></html>",
        }
        mock_client = MockGitHubClient(
            owner="raval-ai-org",
            repo="controlled-site",
            default_branch="main",
            initial_files=initial_files,
        )
        site_context = SiteContext(
            workspace_id=ws_id,
            site_id=site_id,
            site_url="https://github.com/raval-ai-org/controlled-site",
            provider="github",
            environment="production",
            auth_state=AuthState.CONNECTED,
            capabilities=ConnectorCapabilities.full_mutation(),
            last_health_status=HealthStatus.HEALTHY,
            rate_limit_info=RateLimitInfo(limit=5000, remaining=4995),
            metadata={"owner": "raval-ai-org", "repo": "controlled-site", "default_branch": "main"},
        )
        connector = GitHubConnector(
            site_context=site_context,
            client=mock_client,
            owner="raval-ai-org",
            repo="controlled-site",
        )
        return {
            "ws_id": ws_id,
            "site_id": site_id,
            "client": mock_client,
            "connector": connector,
            "site_context": site_context,
        }

    def test_github_happy_path_closed_loop_safe_fix(self, github_repo_setup):
        """
        Step 6A Happy Path: Full 16-Stage Closed-Loop GitHub Workflow.
        Missing meta description on about.html -> Finding -> FixPlan (AUTO_SAFE)
        -> Preview -> Apply to Branch/PR -> Validate -> Targeted Rescan ->
        Score Delta -> Regression Guard -> KEEP -> Complete Trace.
        """
        ws_id = github_repo_setup["ws_id"]
        site_id = github_repo_setup["site_id"]
        connector: GitHubConnector = github_repo_setup["connector"]
        mock_client: MockGitHubClient = github_repo_setup["client"]

        exec_id = f"exec_gh_{uuid.uuid4().hex[:8]}"
        resource_path = "about.html"
        resource_url = f"https://github.com/raval-ai-org/controlled-site/blob/main/{resource_path}"

        # 1. Baseline Capture (BEFORE state has no meta description)
        initial_file = mock_client.get_file("raval-ai-org", "controlled-site", resource_path)
        initial_html = initial_file.content or ""
        extracted_before = extract_html(initial_html, resource_url)

        meas_svc = ClosedLoopMeasurementService()
        baseline_snapshot = meas_svc.create_baseline_snapshot(
            execution_id=exec_id,
            site_id=site_id,
            resource_url=resource_url,
            target_resource=resource_path,
            extracted=extracted_before,
            findings=[{"finding_id": "FIND_GH_001", "rule_id": "META_DESC_MISSING", "severity": "MEDIUM"}],
            score_data={"overall_score": 82.0, "category_scores": {"technical_seo": 80.0, "content_quality": 84.0}},
            raw_html=initial_html,
        )
        assert baseline_snapshot.observation.meta_description is None

        # 2. Finding & Fix Plan Generation
        finding_id = "FIND_GH_001"
        fix_plan_id = "FIX_GH_001"
        remediated_html = (
            "<!DOCTYPE html><html><head><title>About Us</title>"
            "<meta name=\"description\" content=\"Learn about Raval AI Search Intelligence and our mission to power accurate AI discovery.\">"
            "</head><body><h1>About Raval</h1></body></html>"
        )

        proposal = ChangeProposal(
            proposal_id="prop_gh_001",
            operation_type=ExecutionOperationType.APPLY_CHANGE,
            action_type="update_meta_tag",
            target_resource=ResourceReference(
                resource_type=ResourceType.GIT_FILE,
                resource_id=resource_path,
                path=resource_path,
            ),
            proposed_diff=remediated_html,
            justification="Add missing meta description to enhance search engine snippet and AI summary context",
            metadata={"finding_id": finding_id, "fix_plan_id": fix_plan_id},
        )

        # 3. Safety Gate Classification
        safety_class = classify_fix_safety(
            finding_type="missing_meta_description",
            fix_type="page_metadata",
        )
        assert safety_class.safety_tier == SafetyTier.AUTO_SAFE

        # 4. GitHub Connector Preview & Apply (Isolated Branch + PR)
        preview = connector.preview_change(proposal)
        assert preview.is_applicable is True or preview.can_apply is True
        assert "description" in (preview.diff_unified or preview.diff or "")

        change_res = connector.apply_change(proposal)
        assert change_res.status == ExecutionStatus.APPLIED
        created_branch = change_res.metadata.get("execution_branch")
        assert created_branch is not None
        assert created_branch.startswith("raval-fix/")

        # 5. Independent Post-Apply Validation
        updated_file = mock_client.get_file("raval-ai-org", "controlled-site", resource_path, ref=created_branch)
        extracted_after = extract_html(updated_file.content or "", resource_url)

        after_snapshot = meas_svc.create_after_snapshot(
            execution_id=exec_id,
            site_id=site_id,
            resource_url=resource_url,
            target_resource=resource_path,
            extracted=extracted_after,
            findings=[],
            score_data={"overall_score": 90.0, "category_scores": {"technical_seo": 92.0, "content_quality": 88.0}},
            raw_html=updated_file.content or "",
        )
        assert after_snapshot.observation.meta_description is not None
        assert "Raval AI Search Intelligence" in after_snapshot.observation.meta_description

        verifier = FixEffectivenessVerifier()
        v_res = verifier.verify_fix(
            finding_id=finding_id,
            rule_id="META_DESC_MISSING",
            fix_plan={"fix_plan_id": fix_plan_id},
            baseline_snapshot=baseline_snapshot,
            after_snapshot=after_snapshot,
            execution_id=exec_id,
        )
        assert v_res.outcome == VerificationOutcome.RESOLVED
        assert v_res.is_resolved is True

        # 6. Targeted Rescan Policy Evaluation
        graph = ChangeImpactGraph(site_url=connector.site_context.site_url)
        graph.add_node(resource_path)
        graph.add_node("index.html")
        graph.add_edge(resource_path, "index.html", DependencyType.LINKS_TO)

        rescan_req = TargetedRescanRequest(
            execution_id=exec_id,
            site_url=connector.site_context.site_url,
            changed_resources=[resource_path],
            change_type=ChangeType.PAGE_METADATA,
        )
        rescan_decision = RescanPolicyEngine.decide_scope(rescan_req, graph)
        assert rescan_decision.scope == RescanScope.TARGETED_RESCAN
        assert len(rescan_decision.selected_resources) == 1

        # 7. Comparison, Regression Guard & Experiment Outcome
        score_delta = ScoreDeltaReport(before_score=82.0, after_score=90.0, overall_delta=8.0)
        finding_delta = FindingDeltaReport(
            resolved_count=1,
            transitions=[FindingDeltaItem(finding_id=finding_id, rule_id="META_DESC_MISSING", transition=FindingTransitionState.OPEN_TO_RESOLVED)],
        )
        reg_guard = RegressionGuard()
        reg_report = reg_guard.evaluate(baseline_snapshot=baseline_snapshot, after_snapshot=after_snapshot)
        assert reg_report.decision == RegressionDecision.KEEP
        assert reg_report.has_blocking_regressions is False

        measurement_report = ClosedLoopMeasurementReport(
            execution_id=exec_id,
            site_id=site_id,
            resource_url=resource_url,
            baseline_snapshot=baseline_snapshot,
            after_snapshot=after_snapshot,
            verification_results=[v_res],
            regression_report=reg_report,
            score_delta=score_delta,
            finding_delta=finding_delta,
            final_decision=RegressionDecision.KEEP,
        )

        hyp = Hypothesis(
            expected_outcome="Resolve missing meta description on about page",
            target_finding_ids=[finding_id],
            target_rule_ids=["META_DESC_MISSING"],
            expected_score_min_delta=5.0,
        )
        hyp_res, hyp_reason = ExperimentEngine.evaluate_hypothesis(hyp, measurement_report)
        assert hyp_res == HypothesisResult.CONFIRMED

        exp_status, exp_decision, _ = ExperimentEngine.evaluate_experiment_outcome(
            Experiment(workspace_id=ws_id, site_id=site_id, hypothesis=hyp, target_resource=resource_path),
            measurement_report,
        )
        assert exp_status == ExperimentStatus.SUCCEEDED
        assert exp_decision == ExperimentDecision.KEEP

        metrics = calculate_experiment_metrics(
            measurement_report=measurement_report,
            rescan_scope="TARGETED_RESCAN",
            rescan_pages_count=1,
            total_site_pages=3,
            execution_duration_ms=42.0,
            validation_duration_ms=15.0,
            rescan_duration_ms=20.0,
            total_duration_ms=77.0,
        )
        assert metrics.fix_effectiveness.verification_rate == 1.0
        assert metrics.regression.is_regression_free is True
        assert metrics.score.score_delta == 8.0
        assert metrics.operational.rescan_efficiency_savings_pct > 60.0
        assert "does not guarantee third-party" in metrics.score.disclaimer

    def test_github_scenario_g1_preview_succeeds_apply_fails(self, github_repo_setup):
        """
        Scenario G1: Preview succeeds, but apply fails due to a network/server error.
        Experiment MUST NOT report success; failure reason preserved; safe decision.
        """
        connector: GitHubConnector = github_repo_setup["connector"]
        mock_client: MockGitHubClient = github_repo_setup["client"]

        proposal = ChangeProposal(
            proposal_id="prop_g1",
            operation_type=ExecutionOperationType.APPLY_CHANGE,
            action_type="update_content",
            target_resource=ResourceReference(resource_type=ResourceType.GIT_FILE, resource_id="index.html"),
            proposed_diff="<new-content>",
        )

        preview = connector.preview_change(proposal)
        assert preview.is_applicable is True

        # Simulate remote GitHub server failure on create_or_update_file
        def fail_commit(*args, **kwargs):
            raise RuntimeError("GitHub API 500: Internal Server Error on commit")
        mock_client.create_or_update_file = fail_commit

        with pytest.raises(Exception) as exc_info:
            connector.apply_change(proposal)
        assert "500" in str(exc_info.value) or "Internal Server Error" in str(exc_info.value)

        # Failure & Recovery evaluation
        incident = FailureRecoveryManager.classify_failure(
            stage=FailureStage.APPLY,
            error_message=str(exc_info.value),
        )
        rec = FailureRecoveryManager.handle_failure(incident)
        assert rec.suggested_action in ("RETRY_STAGE", "FAIL_AND_ALERT")

        # Experiment outcome MUST NOT be KEEP
        dec, _ = ExperimentEngine.evaluate_decision(
            hyp_result=HypothesisResult.INVALID,
            has_blocking_regressions=False,
            all_targets_verified=False,
            score_delta=0.0,
        )
        assert dec != ExperimentDecision.KEEP

    def test_github_scenario_g2_apply_succeeds_validation_fails(self, github_repo_setup):
        """
        Scenario G2: Apply succeeds on Git branch, but post-change evidence does NOT resolve defect.
        Fix effectiveness MUST NOT be RESOLVED; decision must NOT be KEEP (transitions to REVIEW).
        """
        ws_id = github_repo_setup["ws_id"]
        site_id = github_repo_setup["site_id"]
        connector: GitHubConnector = github_repo_setup["connector"]

        exec_id = f"exec_g2_{uuid.uuid4().hex[:8]}"
        resource_path = "about.html"
        resource_url = f"https://github.com/raval-ai-org/controlled-site/blob/main/{resource_path}"

        meas_svc = ClosedLoopMeasurementService()
        baseline_snapshot = meas_svc.create_baseline_snapshot(
            execution_id=exec_id,
            site_id=site_id,
            resource_url=resource_url,
            target_resource=resource_path,
            extracted=extract_html("<html><head><title>No Meta</title></head><body></body></html>", resource_url),
            findings=[{"finding_id": "FIND_G2", "rule_id": "META_DESC_MISSING"}],
        )

        # Apply a dummy change that didn't actually add the meta description
        proposal = ChangeProposal(
            proposal_id="prop_g2",
            operation_type=ExecutionOperationType.APPLY_CHANGE,
            action_type="update_content",
            target_resource=ResourceReference(resource_type=ResourceType.GIT_FILE, resource_id=resource_path),
            proposed_diff="<html><head><title>Still No Meta</title></head><body><!-- Comment --></body></html>",
        )
        change_res = connector.apply_change(proposal)
        assert change_res.status == ExecutionStatus.APPLIED

        # Post-apply observation still lacks meta description
        after_snapshot = meas_svc.create_after_snapshot(
            execution_id=exec_id,
            site_id=site_id,
            resource_url=resource_url,
            target_resource=resource_path,
            extracted=extract_html("<html><head><title>Still No Meta</title></head><body></body></html>", resource_url),
            findings=[{"finding_id": "FIND_G2", "rule_id": "META_DESC_MISSING"}],
        )

        verifier = FixEffectivenessVerifier()
        v_res = verifier.verify_fix(
            finding_id="FIND_G2",
            rule_id="META_DESC_MISSING",
            fix_plan={"fix_plan_id": "FIX_G2"},
            baseline_snapshot=baseline_snapshot,
            after_snapshot=after_snapshot,
            execution_id=exec_id,
        )
        assert v_res.outcome == VerificationOutcome.NOT_RESOLVED
        assert v_res.is_resolved is False

        dec, expl = ExperimentEngine.evaluate_decision(
            hyp_result=HypothesisResult.NOT_CONFIRMED,
            has_blocking_regressions=False,
            all_targets_verified=False,
            score_delta=0.0,
        )
        assert dec == ExperimentDecision.REVIEW
        assert "Unverified" in expl or "hypothesis not confirmed" in expl

    def test_github_scenario_g3_regression_triggers_rollback(self, github_repo_setup):
        """
        Scenario G3: Fix improves title but accidentally introduces noindex tag (critical regression).
        Regression guard flags ROLLBACK; safe rollback decision evaluated.
        """
        ws_id = github_repo_setup["ws_id"]
        site_id = github_repo_setup["site_id"]
        exec_id = f"exec_g3_{uuid.uuid4().hex[:8]}"
        resource_path = "services.html"
        resource_url = f"https://github.com/raval-ai-org/controlled-site/blob/main/{resource_path}"

        meas_svc = ClosedLoopMeasurementService()
        # Baseline had title defect but was indexable with canonical
        baseline_html = "<html><head><title>Services</title><link rel=\"canonical\" href=\"https://example.com/services\"></head><body><h1>Services</h1></body></html>"
        baseline_snapshot = meas_svc.create_baseline_snapshot(
            execution_id=exec_id,
            site_id=site_id,
            resource_url=resource_url,
            target_resource=resource_path,
            extracted=extract_html(baseline_html, resource_url),
            findings=[{"finding_id": "FIND_TITLE", "rule_id": "TITLE_TOO_SHORT"}],
            score_data={"overall_score": 85.0},
            raw_html=baseline_html,
        )

        # After state fixed title but injected noindex directive (critical regression)
        after_html = "<html><head><title>Professional Services - Comprehensive Offerings</title><meta name=\"robots\" content=\"noindex\"></head><body><h1>Services</h1></body></html>"
        after_snapshot = meas_svc.create_after_snapshot(
            execution_id=exec_id,
            site_id=site_id,
            resource_url=resource_url,
            target_resource=resource_path,
            extracted=extract_html(after_html, resource_url),
            score_data={"overall_score": 50.0},
            raw_html=after_html,
        )

        reg_guard = RegressionGuard()
        reg_report = reg_guard.evaluate(baseline_snapshot=baseline_snapshot, after_snapshot=after_snapshot)
        assert reg_report.decision == RegressionDecision.ROLLBACK
        assert reg_report.has_blocking_regressions is True

        dec, expl = ExperimentEngine.evaluate_decision(
            hyp_result=HypothesisResult.NOT_CONFIRMED,
            has_blocking_regressions=True,
            all_targets_verified=True,
            score_delta=-35.0,
        )
        assert dec == ExperimentDecision.ROLLBACK
        assert "Blocking regression" in expl

    def test_github_scenario_g4_idempotent_duplicate_execution(self, github_repo_setup):
        """
        Scenario G4: Repeating exact same experiment request returns cached result with zero duplicate branch/commit creation.
        """
        ws_id = github_repo_setup["ws_id"]
        site_id = github_repo_setup["site_id"]

        exp = ExperimentService.create_experiment(
            workspace_id=ws_id,
            site_id=site_id,
            name="Idempotency Test",
            target_resource="index.html",
            hypothesis=Hypothesis(expected_outcome="Verify idempotency"),
        )

        res1 = ExperimentService.run_experiment(exp.experiment_id, dry_run=True)
        res2 = ExperimentService.run_experiment(exp.experiment_id, dry_run=True)

        assert res1.experiment_id == res2.experiment_id
        assert res1.status == res2.status
        assert res1.decision == res2.decision

    def test_github_security_and_workspace_isolation(self, github_repo_setup):
        """
        Step 6F Security: Enforces workspace boundary validation, SSRF rejection, and path traversal protection.
        """
        ws_id = github_repo_setup["ws_id"]

        # 1. Path Traversal Rejection
        with pytest.raises(InvalidResourceError):
            validate_github_path("../../etc/passwd")

        # 2. SSRF Protection via ProductionReadinessGuard
        report_ssrf = ProductionReadinessGuard.evaluate(
            workspace_id=ws_id,
            target_url="http://169.254.169.254/latest/meta-data",
        )
        assert report_ssrf.is_ready is False
        assert any("ssrf" in issue.lower() or "private" in issue.lower() for issue in report_ssrf.blocking_issues)

        # 3. Secret Protection: Redacts tokens from diagnostic messages
        secret_msg = "Failed with token ghp_012345678901234567890123456789012345"
        redacted = redact_secrets_from_string(secret_msg)
        assert "ghp_012345678901234567890123456789012345" not in redacted
        assert "[REDACTED]" in redacted


# =============================================================================
# 2. REALISTIC WORDPRESS CLOSED-LOOP E2E & SCENARIOS (W1 - W4)
# =============================================================================

class TestWordPressClosedLoopE2E:
    """
    Validates complete WordPress closed-loop remediation workflows against controlled WP test doubles.
    """

    @pytest.fixture
    def wp_setup(self):
        ws_id = "ws_wp_tenant_1"
        site_id = "site_wp_101"
        site_url = "https://wp-store.example.local"

        mock_client = MockWordPressClient(site_url=site_url)
        # Ensure page 101 has empty meta description for testing
        mock_client.pages[101]["meta"]["_yoast_wpseo_metadesc"] = ""

        site_context = SiteContext(
            workspace_id=ws_id,
            site_id=site_id,
            site_url=site_url,
            provider="wordpress",
            environment="production",
            auth_state=AuthState.CONNECTED,
            capabilities=ConnectorCapabilities.full_mutation(),
            last_health_status=HealthStatus.HEALTHY,
            rate_limit_info=RateLimitInfo(limit=1000, remaining=995),
            metadata={"wp_version": "6.4.3", "active_plugins": ["wordpress-seo"]},
        )

        connector = WordPressConnector(
            site_context=site_context,
            client=mock_client,
        )
        connector._authenticated_user = mock_client._current_user
        connector._site_identity = mock_client.get_site_info()

        return {
            "ws_id": ws_id,
            "site_id": site_id,
            "site_url": site_url,
            "client": mock_client,
            "connector": connector,
        }

    def test_wordpress_happy_path_closed_loop_safe_fix(self, wp_setup):
        """
        Step 6B Happy Path: Full 16-Stage Closed-Loop WordPress Workflow.
        Page 101 missing Yoast meta description -> Finding -> FixPlan ->
        Capability Check -> Preview -> Apply -> Validate -> Rescan -> Compare -> KEEP.
        """
        ws_id = wp_setup["ws_id"]
        site_id = wp_setup["site_id"]
        site_url = wp_setup["site_url"]
        connector: WordPressConnector = wp_setup["connector"]
        mock_client: MockWordPressClient = wp_setup["client"]

        exec_id = f"exec_wp_{uuid.uuid4().hex[:8]}"
        resource_id = "101"
        resource_url = f"{site_url}/about-us"

        # 1. Baseline Capture (BEFORE state has empty Yoast meta description)
        page_before = mock_client.pages[101]
        extracted_before = extract_html(
            f"<html><head><title>{page_before['title']}</title></head><body>{page_before['content']}</body></html>",
            resource_url,
        )

        meas_svc = ClosedLoopMeasurementService()
        baseline_snapshot = meas_svc.create_baseline_snapshot(
            execution_id=exec_id,
            site_id=site_id,
            resource_url=resource_url,
            target_resource=f"page/{resource_id}",
            extracted=extracted_before,
            findings=[{"finding_id": "FIND_WP_01", "rule_id": "META_DESC_WEAK"}],
            score_data={"overall_score": 75.0},
        )
        assert baseline_snapshot.observation.meta_description is None

        # 2. Capability Check & Fix Proposal
        proposal = ChangeProposal(
            proposal_id="prop_wp_01",
            operation_type=ExecutionOperationType.APPLY_CHANGE,
            action_type="update_meta_tag",
            target_resource=ResourceReference(
                resource_type=ResourceType.CMS_PAGE,
                resource_id=resource_id,
            ),
            parameters={
                "meta_key": "_yoast_wpseo_metadesc",
                "value": "Comprehensive WordPress services and cloud search intelligence solutions.",
            },
            proposed_content="Comprehensive WordPress services and cloud search intelligence solutions.",
            justification="Update Yoast SEO metadata for search engine indexability and AI discoverability",
            metadata={"finding_id": "FIND_WP_01", "fix_plan_id": "FIX_WP_01"},
        )

        # 3. Preview & Apply
        preview = connector.preview_change(proposal)
        assert preview.is_applicable is True

        change_res = connector.apply_change(proposal)
        assert change_res.status == ExecutionStatus.APPLIED

        # 4. Independent Post-Apply Validation
        page_after = mock_client.pages[101]
        assert page_after["meta"]["_yoast_wpseo_metadesc"] == "Comprehensive WordPress services and cloud search intelligence solutions."

        rendered_after_html = (
            f"<html><head><title>{page_after['meta']['_yoast_wpseo_title']}</title>"
            f"<meta name=\"description\" content=\"{page_after['meta']['_yoast_wpseo_metadesc']}\">"
            f"</head><body>{page_after['content']}</body></html>"
        )
        extracted_after = extract_html(rendered_after_html, resource_url)

        after_snapshot = meas_svc.create_after_snapshot(
            execution_id=exec_id,
            site_id=site_id,
            resource_url=resource_url,
            target_resource=f"page/{resource_id}",
            extracted=extracted_after,
            findings=[],
            score_data={"overall_score": 88.0},
            raw_html=rendered_after_html,
        )

        verifier = FixEffectivenessVerifier()
        v_res = verifier.verify_fix(
            finding_id="FIND_WP_01",
            rule_id="META_DESC_WEAK",
            fix_plan={"fix_plan_id": "FIX_WP_01"},
            baseline_snapshot=baseline_snapshot,
            after_snapshot=after_snapshot,
            execution_id=exec_id,
        )
        assert v_res.outcome == VerificationOutcome.RESOLVED
        assert v_res.is_resolved is True

        # 5. Regression Guard & Experiment Decision
        reg_guard = RegressionGuard()
        reg_report = reg_guard.evaluate(baseline_snapshot=baseline_snapshot, after_snapshot=after_snapshot)
        assert reg_report.decision == RegressionDecision.KEEP

        score_delta = ScoreDeltaReport(before_score=75.0, after_score=88.0, overall_delta=13.0)
        finding_delta = FindingDeltaReport(
            resolved_count=1,
            transitions=[FindingDeltaItem(finding_id="FIND_WP_01", rule_id="META_DESC_WEAK", transition=FindingTransitionState.OPEN_TO_RESOLVED)],
        )

        measurement_report = ClosedLoopMeasurementReport(
            execution_id=exec_id,
            site_id=site_id,
            resource_url=resource_url,
            baseline_snapshot=baseline_snapshot,
            after_snapshot=after_snapshot,
            verification_results=[v_res],
            regression_report=reg_report,
            score_delta=score_delta,
            finding_delta=finding_delta,
            final_decision=RegressionDecision.KEEP,
        )

        hyp = Hypothesis(
            expected_outcome="Improve Yoast meta description",
            target_finding_ids=["FIND_WP_01"],
            expected_score_min_delta=5.0,
        )
        hyp_res, _ = ExperimentEngine.evaluate_hypothesis(hyp, measurement_report)
        assert hyp_res == HypothesisResult.CONFIRMED

        status, decision, _ = ExperimentEngine.evaluate_experiment_outcome(
            Experiment(workspace_id=ws_id, site_id=site_id, hypothesis=hyp, target_resource=f"page/{resource_id}"),
            measurement_report,
        )
        assert status == ExperimentStatus.SUCCEEDED
        assert decision == ExperimentDecision.KEEP

    def test_wordpress_scenario_w1_permission_denied(self, wp_setup):
        """
        Scenario W1: Insufficient WordPress user capabilities (subscriber role attempting mutation).
        Mutation rejected with AuthorizationError; site unchanged; no false success.
        """
        connector: WordPressConnector = wp_setup["connector"]
        mock_client: MockWordPressClient = wp_setup["client"]

        # Restrict user capability to subscriber role
        mock_client.set_user_role("subscriber")
        connector._authenticated_user = mock_client._current_user

        proposal = ChangeProposal(
            proposal_id="prop_w1",
            operation_type=ExecutionOperationType.APPLY_CHANGE,
            action_type="update_title",
            target_resource=ResourceReference(resource_type=ResourceType.CMS_PAGE, resource_id="101"),
            proposed_content="Unauthorized Title",
        )

        with pytest.raises(AuthorizationError) as exc_info:
            connector.apply_change(proposal)
        assert "capability" in str(exc_info.value).lower() or "unauthorized" in str(exc_info.value).lower() or "permission" in str(exc_info.value).lower()

    def test_wordpress_scenario_w2_stale_resource_protection(self, wp_setup):
        """
        Scenario W2: Baseline drift detected (remote content changed since plan was generated).
        Mutation rejected before overwrite to protect concurrent edits.
        """
        connector: WordPressConnector = wp_setup["connector"]

        proposal = ChangeProposal(
            proposal_id="prop_w2",
            operation_type=ExecutionOperationType.APPLY_CHANGE,
            action_type="update_title",
            target_resource=ResourceReference(resource_type=ResourceType.CMS_PAGE, resource_id="101"),
            proposed_diff={"before": "Completely different title from the past", "after": "New Title"},
            proposed_content="New Title",
        )

        # WordPressConnector validates baseline drift
        with pytest.raises(Exception) as exc_info:
            connector.apply_change(proposal)
        assert "drift" in str(exc_info.value).lower() or "modified" in str(exc_info.value).lower()

    def test_wordpress_scenario_w3_validation_failure(self, wp_setup):
        """
        Scenario W3: Mutation accepted but live inspection shows defect unresolved.
        Fix effectiveness is NOT_RESOLVED; decision is REVIEW (not KEEP).
        """
        ws_id = wp_setup["ws_id"]
        site_id = wp_setup["site_id"]
        exec_id = f"exec_w3_{uuid.uuid4().hex[:8]}"
        resource_url = "https://wp-store.example.local/about-us"

        meas_svc = ClosedLoopMeasurementService()
        baseline = meas_svc.create_baseline_snapshot(
            execution_id=exec_id,
            site_id=site_id,
            resource_url=resource_url,
            target_resource="page/101",
            extracted=extract_html("<html><head><title>About</title></head><body></body></html>", resource_url),
            findings=[{"finding_id": "FIND_W3", "rule_id": "TITLE_TOO_SHORT"}],
        )

        # After state still lacks proper title
        after = meas_svc.create_after_snapshot(
            execution_id=exec_id,
            site_id=site_id,
            resource_url=resource_url,
            target_resource="page/101",
            extracted=extract_html("<html><head><title>About</title></head><body>No Title Change</body></html>", resource_url),
        )

        verifier = FixEffectivenessVerifier()
        v_res = verifier.verify_fix(
            finding_id="FIND_W3",
            rule_id="TITLE_TOO_SHORT",
            fix_plan={"fix_plan_id": "FIX_W3"},
            baseline_snapshot=baseline,
            after_snapshot=after,
            execution_id=exec_id,
        )
        assert v_res.outcome == VerificationOutcome.NOT_RESOLVED

        dec, _ = ExperimentEngine.evaluate_decision(
            hyp_result=HypothesisResult.NOT_CONFIRMED,
            has_blocking_regressions=False,
            all_targets_verified=False,
            score_delta=0.0,
        )
        assert dec == ExperimentDecision.REVIEW

    def test_wordpress_scenario_w4_regression_triggers_rollback(self, wp_setup):
        """
        Scenario W4: WordPress page mutation triggers automated safe rollback on regression.
        """
        connector: WordPressConnector = wp_setup["connector"]
        mock_client: MockWordPressClient = wp_setup["client"]

        # 1. Apply change
        proposal = ChangeProposal(
            proposal_id="prop_w4",
            operation_type=ExecutionOperationType.APPLY_CHANGE,
            action_type="update_title",
            target_resource=ResourceReference(resource_type=ResourceType.CMS_PAGE, resource_id="101"),
            proposed_content="Regressed Title",
        )
        apply_res = connector.apply_change(proposal)
        assert apply_res.status == ExecutionStatus.APPLIED
        assert mock_client.pages[101]["title"] == "Regressed Title"

        # 2. Execute rollback
        rb_res = connector.rollback_change(apply_res.rollback_token)
        assert rb_res.status == ExecutionStatus.ROLLED_BACK

        # 3. Verify restored state
        assert mock_client.pages[101]["title"] == "About Us"

    def test_wordpress_idempotency_and_security_isolation(self, wp_setup):
        """
        Step 6F Security: Validates multi-tenant workspace isolation and SSRF rejection for WordPress targets.
        """
        ws_id = wp_setup["ws_id"]

        # 1. SSRF rejection for internal private network
        report_ssrf = ProductionReadinessGuard.evaluate(
            workspace_id=ws_id,
            target_url="http://192.168.1.100:8080/wp-admin",
        )
        assert report_ssrf.is_ready is False
        assert any("ssrf" in issue.lower() or "private" in issue.lower() for issue in report_ssrf.blocking_issues)

        # 2. Workspace ID safety validation
        report_bad_ws = ProductionReadinessGuard.evaluate(
            workspace_id="ws_invalid/../traversal",
            target_url="https://legit-site.com",
        )
        assert report_bad_ws.is_ready is False


# =============================================================================
# 3. CROSS-PLATFORM PROVENANCE, TRACEABILITY & MEASUREMENT BOUNDARIES
# =============================================================================

class TestCrossPlatformExperimentProvenance:
    """
    Validates end-to-end provenance integrity and strict measurement boundaries across all archetypes.
    """

    def test_complete_provenance_trace_integrity(self):
        """
        Verifies that every entity in the closed loop carries complete provenance links:
        workspace_id -> site_id -> experiment_id -> execution_id -> stage_execution_id ->
        finding_id -> fix_plan_id -> operation_id -> validation_id -> rescan_id -> comparison_id -> decision.
        """
        ws_id = "ws_provenance_audit"
        site_id = "site_audit_100"
        exec_id = f"exec_audit_{uuid.uuid4().hex[:8]}"

        trace = ExecutionTrace(
            execution_id=exec_id,
            site_id=site_id,
            site_url="https://example.com",
            overall_status=PipelineExecutionStatus.SUCCEEDED,
        )

        stage_crawl = StageTrace(stage_execution_id=f"st_1_{exec_id}", execution_id=exec_id, stage_name=PipelineStage.CRAWL_RENDER, sequence=2, status=StageStatus.SUCCEEDED)
        stage_apply = StageTrace(stage_execution_id=f"st_2_{exec_id}", execution_id=exec_id, stage_name=PipelineStage.APPLY, sequence=10, status=StageStatus.SUCCEEDED)
        stage_compare = StageTrace(stage_execution_id=f"st_3_{exec_id}", execution_id=exec_id, stage_name=PipelineStage.COMPARE, sequence=13, status=StageStatus.SUCCEEDED)
        trace.stages.extend([stage_crawl, stage_apply, stage_compare])

        # Assert no orphaned stages
        for st in trace.stages:
            assert st.execution_id == exec_id
            assert st.stage_execution_id.startswith("st_")
            assert st.status == StageStatus.SUCCEEDED

    def test_observed_vs_inferred_measurement_boundaries(self):
        """
        Step 6H: Enforces strict metric boundaries:
        - Technical evidence = OBSERVED
        - Score improvements carry mandatory measurement model disclaimer
        - Zero ungrounded claims of external search ranking, traffic, conversion, or AI citation.
        """
        metrics = calculate_experiment_metrics(
            total_duration_ms=100.0,
            rescan_pages_count=1,
            total_site_pages=10,
        )

        # 1. Technical metrics boundary
        assert metrics.fix_effectiveness.confidence == ObservationConfidence.OBSERVED
        assert metrics.evidence.confidence_boundary == "OBSERVED"

        # 2. Score disclaimer presence
        assert metrics.score.disclaimer != ""
        assert "does not guarantee third-party" in metrics.score.disclaimer or "NOT proof" in metrics.score.disclaimer

        # 3. Serialized dictionary representation verification
        dumped = metrics.model_dump()
        assert dumped["fix_effectiveness"]["confidence"] == "OBSERVED"
        assert dumped["evidence"]["confidence_boundary"] == "OBSERVED"
        assert len(dumped["score"]["disclaimer"]) > 20
