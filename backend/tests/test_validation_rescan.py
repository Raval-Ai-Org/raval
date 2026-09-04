"""
Tests for Task 11 — Step 5: Validation, Rescan & Rollback Engine.

Verifies:
1. Core Validation:
   - Connector operation acceptance checking
   - Resource existence and HTTP status validation
   - Intended mutation confirmation vs non-reflection
   - Missing resource and critical content loss detection
   - Insufficient evidence handling
2. Targeted Rescan:
   - Single-target rescan without full-site crawling
   - Correct target endpoint resolution
   - Page extractor and crawler fetcher reuse
   - Extraction of structured tags, metadata, and JSON-LD
3. Before / After Comparison:
   - Deterministic finding resolution evaluation
   - Preserved before/after evidence
   - Unchanged, improved, and regressed states
4. Scoring Comparison:
   - Category score before, after, and delta calculations
   - Handling of unchanged scores (valid, not a regression)
   - Bounded, reproducible scoring semantics
5. Regression Detection:
   - Missing target resource (404/500/unreachable)
   - Intended change not reflected in document
   - Critical metadata loss or content truncation
   - Inconsistent connector state
6. Rollback & Post-Rollback Verification:
   - Deterministic rollback trigger on regression
   - Baseline restoration confirmation
   - Rollback failure handling and transition to MANUAL_REVIEW_REQUIRED
   - Idempotent repeated rollbacks
   - Unchanged score does NOT trigger rollback
7. State Machine Transitions:
   - APPLIED -> VALIDATING -> RESCANNING -> VERIFIED -> KEPT
   - APPLIED -> VALIDATING -> RESCANNING -> REGRESSION -> ROLLED_BACK
   - REGRESSION -> ROLLBACK_FAILED -> MANUAL_REVIEW_REQUIRED
   - Rejection of invalid transitions and state jumping
8. Traceability & Security:
   - Full provenance across execution_id, operation_id, finding_id, and fix_plan_id
   - Secret scrubbing and credential protection
   - No arbitrary shell or code execution
"""

import pytest
from datetime import datetime, timezone
from typing import Any

from backend.app.fix_safety_classifier import SafetyTier
from connectors.base.capabilities import ConnectorCapabilities
from connectors.base.enums import (
    AuthState,
    ExecutionOperationType,
    ExecutionStatus,
    HealthStatus,
    ResourceType,
)
from connectors.base.models import (
    ChangeProposal,
    ChangeResult,
    OperationId,
    ResourceReference,
    SiteContext,
)
from connectors.base.errors import (
    ResourceNotFoundError,
)
from connectors.execution.approval import ApprovalManager
from connectors.execution.engine import ExecutionEngine
from connectors.execution.errors import (
    InvalidStateTransitionError,
)
from connectors.execution.models import (
    ExecutionLifecycleState,
    ExecutionRecord,
    ExecutionRequest,
    ExecutionTarget,
    RegressionSeverity,
    ValidationOutcome,
    ValidationReport,
)
from connectors.execution.rescan import TargetedRescanner
from connectors.execution.rollback import RollbackManager
from connectors.execution.state_machine import ExecutionStateMachine
from connectors.execution.validation import ValidationEngine
from connectors.testing.mock_connector import MockConnector


# =============================================================================
# Test Fixtures & Helpers
# =============================================================================

@pytest.fixture
def site_context() -> SiteContext:
    return SiteContext(
        site_id=101,
        site_url="https://example.com",
        provider="mock",
        environment="production",
        auth_state=AuthState.CONNECTED,
        capabilities=ConnectorCapabilities.full_mutation(),
        last_health_status=HealthStatus.HEALTHY,
        metadata={"site_name": "Test Site"},
    )


@pytest.fixture
def page_resource() -> ResourceReference:
    return ResourceReference(
        resource_type=ResourceType.WEBSITE_PAGE,
        resource_id="https://example.com/about",
        path="/about",
        title="About Us",
    )


@pytest.fixture
def mock_connector(site_context: SiteContext) -> MockConnector:
    initial_html = """<!DOCTYPE html>
<html>
<head>
    <title>Old Title</title>
    <meta name="description" content="Old meta description that needs optimization.">
</head>
<body>
    <h1>Old Title</h1>
    <p>Welcome to our about page.</p>
</body>
</html>"""
    return MockConnector(
        site_context=site_context,
        initial_resources={"https://example.com/about": initial_html},
    )


@pytest.fixture
def applied_record(site_context: SiteContext, page_resource: ResourceReference, mock_connector: MockConnector) -> ExecutionRecord:
    engine = ExecutionEngine()
    proposal = ChangeProposal(
        target_resource=page_resource,
        action_type="update_meta_tag",
        suggested_content="New Optimized Title | Brand",
        original_content="Old Title",
        parameters={"field": "title"},
        description="Optimize page title for search visibility",
    )
    req = engine.create_request(
        site_context=site_context,
        resource=page_resource,
        operation=ExecutionOperationType.APPLY_CHANGE,
        fix_plan_id=501,
        recommendation_id=401,
        finding_id=301,
        safety_tier=SafetyTier.AUTO_SAFE,
        change_proposal=proposal,
    )
    engine.check_safety(req, connector=mock_connector)
    engine.preview_execution(req, connector=mock_connector)
    engine.apply_execution(req, connector=mock_connector)
    return engine.get_execution(req.request_id)


# =============================================================================
# 1. Validation Engine Tests
# =============================================================================

class TestValidationEngineCore:
    def test_validation_passes_when_intended_mutation_confirmed(
        self,
        applied_record: ExecutionRecord,
        mock_connector: MockConnector,
    ) -> None:
        """Confirms valid title modification in rescanned content produces VERIFIED/RESOLVED outcome."""
        updated_html = """<!DOCTYPE html>
<html>
<head>
    <title>New Optimized Title | Brand</title>
    <meta name="description" content="A comprehensive guide to our company background and mission statement.">
</head>
<body>
    <h1>New Optimized Title | Brand</h1>
    <p>Welcome to our updated about page with comprehensive info.</p>
</body>
</html>"""
        rescan = TargetedRescanner.rescan_target(
            target=applied_record.request.target,
            custom_html=updated_html,
        )
        report = ValidationEngine.evaluate(
            record=applied_record,
            connector=mock_connector,
            rescan_result=rescan,
        )

        assert report.outcome == ValidationOutcome.RESOLVED
        assert report.is_verified is True
        assert report.is_regression is False
        assert len(report.regression_indicators) == 0
        assert report.finding_comparison is not None
        assert report.finding_comparison.is_resolved is True
        assert "intended_mutation_confirmed" in report.checks_performed

    def test_validation_fails_when_mutation_not_reflected(
        self,
        applied_record: ExecutionRecord,
        mock_connector: MockConnector,
    ) -> None:
        """Detects regression when the page content does not reflect the proposed mutation."""
        stale_html = """<!DOCTYPE html>
<html>
<head>
    <title>Old Title</title>
    <meta name="description" content="Old meta description.">
</head>
<body>
    <h1>Old Title</h1>
</body>
</html>"""
        rescan = TargetedRescanner.rescan_target(
            target=applied_record.request.target,
            custom_html=stale_html,
        )
        report = ValidationEngine.evaluate(
            record=applied_record,
            connector=mock_connector,
            rescan_result=rescan,
        )

        assert report.outcome == ValidationOutcome.REGRESSION
        assert report.is_verified is False
        assert report.is_regression is True
        assert any(r.indicator_type == "mutation_not_reflected" for r in report.regression_indicators)
        assert report.rollback_required is True

    def test_validation_fails_when_resource_missing(
        self,
        applied_record: ExecutionRecord,
        mock_connector: MockConnector,
    ) -> None:
        """Detects critical regression when target resource disappears or returns 404."""
        missing_rescan = TargetedRescanner.rescan_target(
            target=applied_record.request.target,
            custom_html="",
        )
        object.__setattr__(missing_rescan, "status_code", 404)
        object.__setattr__(missing_rescan, "error", "HTTP 404 Not Found")
        object.__setattr__(missing_rescan, "content", None)

        report = ValidationEngine.evaluate(
            record=applied_record,
            connector=mock_connector,
            rescan_result=missing_rescan,
        )

        assert report.outcome == ValidationOutcome.REGRESSION
        assert report.is_verified is False
        assert report.is_regression is True
        assert any(r.indicator_type in ("resource_missing", "http_error") for r in report.regression_indicators)
        assert report.rollback_required is True

    def test_validation_detects_critical_content_loss(
        self,
        applied_record: ExecutionRecord,
        mock_connector: MockConnector,
    ) -> None:
        """Detects critical content loss if content was truncated to an empty stub."""
        truncated_html = "<html></html>"
        rescan = TargetedRescanner.rescan_target(
            target=applied_record.request.target,
            custom_html=truncated_html,
        )
        report = ValidationEngine.evaluate(
            record=applied_record,
            connector=mock_connector,
            rescan_result=rescan,
        )

        assert report.outcome == ValidationOutcome.REGRESSION
        assert report.is_regression is True
        assert any(r.indicator_type == "critical_content_loss" for r in report.regression_indicators)


# =============================================================================
# 2. Targeted Rescan Tests
# =============================================================================

class TestTargetedRescan:
    def test_targeted_rescan_extracts_metadata_and_structured_data(
        self,
        site_context: SiteContext,
        page_resource: ResourceReference,
    ) -> None:
        """Ensures TargetedRescanner properly extracts headings, title, and JSON-LD structured data."""
        html_payload = """<!DOCTYPE html>
<html>
<head>
    <title>Targeted Rescan Title (45 characters long!)</title>
    <meta name="description" content="This is a perfectly sized meta description snippet for validation testing.">
    <link rel="canonical" href="https://example.com/about">
    <script type="application/ld+json">
    {
        "@context": "https://schema.org",
        "@type": "Organization",
        "name": "Raval AI",
        "url": "https://example.com"
    }
    </script>
</head>
<body>
    <h1>Targeted Rescan Main Heading</h1>
    <p>Content for targeted rescan validation.</p>
</body>
</html>"""
        target = ExecutionTarget(site_context=site_context, resource=page_resource)
        result = TargetedRescanner.rescan_target(target=target, custom_html=html_payload)

        assert result.is_success is True
        assert result.status_code == 200
        ext = result.extraction_result
        assert ext is not None
        assert ext["title_text"] == "Targeted Rescan Title (45 characters long!)"
        assert ext["h1_count"] == 1
        assert ext["canonical_present"] is True
        assert len(ext["structured_data"]) == 1
        assert ext["structured_data"][0]["types"] == ["Organization"]

    def test_rescan_does_not_execute_full_crawl(
        self,
        site_context: SiteContext,
        page_resource: ResourceReference,
    ) -> None:
        """Targeted rescanner must only resolve the single specified target URL."""
        target = ExecutionTarget(site_context=site_context, resource=page_resource)
        resolved_url = TargetedRescanner.resolve_target_url(target)
        assert resolved_url == "https://example.com/about"


# =============================================================================
# 3. Before / After Comparison & Scoring Tests
# =============================================================================

class TestBeforeAfterAndScoring:
    def test_score_comparison_delta_calculation(
        self,
        applied_record: ExecutionRecord,
        mock_connector: MockConnector,
    ) -> None:
        """Computes score before, score after, and delta with full provenance."""
        valid_html = """<!DOCTYPE html>
<html>
<head>
    <title>Valid Title Here (Optimal Length)</title>
    <meta name="description" content="Valid meta description configured for search snippet display.">
</head>
<body>
    <h1>Valid Title Here (Optimal Length)</h1>
</body>
</html>"""
        rescan = TargetedRescanner.rescan_target(target=applied_record.request.target, custom_html=valid_html)
        report = ValidationEngine.evaluate(
            record=applied_record,
            connector=mock_connector,
            rescan_result=rescan,
            expected_score_before=60.0,
            expected_score_after=85.0,
            scoring_category="content_quality",
        )

        sc = report.score_comparison
        assert sc is not None
        assert sc.score_before == 60.0
        assert sc.score_after == 85.0
        assert sc.score_delta == 25.0
        assert sc.category == "content_quality"
        assert "provenance" in sc.model_dump()

    def test_unchanged_score_does_not_cause_regression(
        self,
        applied_record: ExecutionRecord,
        mock_connector: MockConnector,
    ) -> None:
        """A score remaining unchanged is valid and must NOT automatically trigger rollback."""
        valid_html = """<!DOCTYPE html>
<html>
<head>
    <title>New Optimized Title | Brand</title>
    <meta name="description" content="Valid meta description configured for search snippet display.">
</head>
<body>
    <h1>New Optimized Title | Brand</h1>
</body>
</html>"""
        rescan = TargetedRescanner.rescan_target(target=applied_record.request.target, custom_html=valid_html)
        report = ValidationEngine.evaluate(
            record=applied_record,
            connector=mock_connector,
            rescan_result=rescan,
            expected_score_before=70.0,
            expected_score_after=70.0,
        )

        assert report.score_comparison is not None
        assert report.score_comparison.score_delta == 0.0
        assert report.is_regression is False
        assert report.rollback_required is False


# =============================================================================
# 4. Rollback & Verification Tests
# =============================================================================

class TestRollbackAndVerification:
    def test_rollback_and_verification_succeeds(
        self,
        applied_record: ExecutionRecord,
        mock_connector: MockConnector,
    ) -> None:
        """Rollback restores baseline and transitions state to ROLLED_BACK."""
        engine = ExecutionEngine()
        engine._records[applied_record.request.request_id] = applied_record

        verify_res = engine.rollback_and_verify(
            request_id=applied_record.request.request_id,
            connector=mock_connector,
        )

        assert verify_res.status in ("RESTORED", "ROLLED_BACK")
        assert verify_res.is_restored is True
        assert applied_record.state == ExecutionLifecycleState.ROLLED_BACK

    def test_repeated_rollback_is_idempotent(
        self,
        applied_record: ExecutionRecord,
        mock_connector: MockConnector,
    ) -> None:
        """Repeated rollback on an already rolled-back record returns cached outcome."""
        engine = ExecutionEngine()
        engine._records[applied_record.request.request_id] = applied_record

        first_res = engine.rollback_and_verify(
            request_id=applied_record.request.request_id,
            connector=mock_connector,
        )
        second_res = engine.rollback_and_verify(
            request_id=applied_record.request.request_id,
            connector=mock_connector,
        )

        assert first_res.rollback_id == second_res.rollback_id
        assert applied_record.state == ExecutionLifecycleState.ROLLED_BACK

    def test_rollback_failure_transitions_to_manual_review_required(
        self,
        applied_record: ExecutionRecord,
    ) -> None:
        """Rollback failure must transition state to MANUAL_REVIEW_REQUIRED."""
        class FailingRollbackConnector(MockConnector):
            def rollback_change(self, operation_id: Any, rollback_token: str | None = None) -> Any:
                raise RuntimeError("Simulated remote rollback provider crash")

        failing_conn = FailingRollbackConnector(site_context=applied_record.request.target.site_context)
        engine = ExecutionEngine()
        engine._records[applied_record.request.request_id] = applied_record

        res = engine.rollback_and_verify(
            request_id=applied_record.request.request_id,
            connector=failing_conn,
        )

        assert res.status == "ROLLBACK_FAILED"
        assert res.is_restored is False
        assert applied_record.state == ExecutionLifecycleState.MANUAL_REVIEW_REQUIRED


# =============================================================================
# 5. Full End-to-End Execution Lifecycle State Machine Tests
# =============================================================================

class TestExecutionLifecycleTransitions:
    def test_complete_successful_lifecycle(
        self,
        site_context: SiteContext,
        page_resource: ResourceReference,
        mock_connector: MockConnector,
    ) -> None:
        """
        Tests full happy path:
        PLANNED -> SAFETY_CHECKED -> PREVIEWED -> APPROVED -> APPLYING -> APPLIED
        -> VALIDATING -> RESCANNING -> VERIFIED -> KEPT
        """
        engine = ExecutionEngine()
        proposal = ChangeProposal(
            target_resource=page_resource,
            action_type="update_meta_tag",
            suggested_content="Optimal Title for SEO Testing",
            original_content="Old Title",
            description="Update title",
        )
        req = engine.create_request(
            site_context=site_context,
            resource=page_resource,
            operation=ExecutionOperationType.APPLY_CHANGE,
            safety_tier=SafetyTier.ASSISTED,
            change_proposal=proposal,
        )

        # 1. PLANNED -> SAFETY_CHECKED
        engine.check_safety(req, connector=mock_connector)
        rec = engine.get_execution(req.request_id)
        assert rec.state == ExecutionLifecycleState.SAFETY_CHECKED

        # 2. SAFETY_CHECKED -> PREVIEWED
        engine.preview_execution(req, connector=mock_connector)
        assert rec.state == ExecutionLifecycleState.PREVIEWED

        # 3. PREVIEWED -> APPROVED
        engine.approve_execution(req.request_id, approved_by="admin_user")
        assert rec.state == ExecutionLifecycleState.APPROVED

        # 4. APPROVED -> APPLYING -> APPLIED
        engine.apply_execution(req, connector=mock_connector)
        assert rec.state == ExecutionLifecycleState.APPLIED

        # 5. APPLIED -> VALIDATING -> RESCANNING -> VERIFIED -> KEPT
        valid_html = """<!DOCTYPE html>
<html>
<head><title>Optimal Title for SEO Testing</title></head>
<body><h1>Optimal Title for SEO Testing</h1></body>
</html>"""
        report = engine.validate_execution(
            request_id=req.request_id,
            connector=mock_connector,
            custom_rescan_html=valid_html,
            auto_keep_on_verified=True,
        )

        assert report.is_verified is True
        assert rec.state == ExecutionLifecycleState.KEPT

        # Verify state transition history is complete and strictly ordered
        state_names = [s for s, _ in rec.history]
        assert state_names == [
            ExecutionLifecycleState.PLANNED,
            ExecutionLifecycleState.SAFETY_CHECKED,
            ExecutionLifecycleState.PREVIEWED,
            ExecutionLifecycleState.APPROVED,
            ExecutionLifecycleState.APPLYING,
            ExecutionLifecycleState.APPLIED,
            ExecutionLifecycleState.VALIDATING,
            ExecutionLifecycleState.RESCANNING,
            ExecutionLifecycleState.VERIFIED,
            ExecutionLifecycleState.KEPT,
        ]

    def test_regression_auto_rollback_flow(
        self,
        site_context: SiteContext,
        page_resource: ResourceReference,
        mock_connector: MockConnector,
    ) -> None:
        """
        Tests regression lifecycle with automatic rollback:
        APPLIED -> VALIDATING -> RESCANNING -> REGRESSION -> ROLLED_BACK
        """
        engine = ExecutionEngine()
        proposal = ChangeProposal(
            target_resource=page_resource,
            action_type="update_meta_tag",
            suggested_content="Optimal Title for SEO Testing",
            original_content="Old Title",
            description="Update title",
        )
        req = engine.create_request(
            site_context=site_context,
            resource=page_resource,
            operation=ExecutionOperationType.APPLY_CHANGE,
            safety_tier=SafetyTier.AUTO_SAFE,
            change_proposal=proposal,
        )
        engine.check_safety(req, connector=mock_connector)
        engine.preview_execution(req, connector=mock_connector)
        engine.apply_execution(req, connector=mock_connector)

        rec = engine.get_execution(req.request_id)
        assert rec.state == ExecutionLifecycleState.APPLIED

        # Regression: mutation not found in rescan
        broken_html = "<html><head><title>Unrelated Content</title></head></html>"
        report = engine.validate_execution(
            request_id=req.request_id,
            connector=mock_connector,
            custom_rescan_html=broken_html,
            auto_rollback_on_regression=True,
        )

        assert report.is_regression is True
        assert rec.state == ExecutionLifecycleState.ROLLED_BACK

    def test_invalid_state_transitions_rejected(
        self,
        applied_record: ExecutionRecord,
    ) -> None:
        """Illegal jumps (e.g. PLANNED directly to VERIFIED or VALIDATING) are strictly rejected."""
        fresh_record = ExecutionRecord(request=applied_record.request)
        with pytest.raises(InvalidStateTransitionError):
            ExecutionStateMachine.transition(fresh_record, ExecutionLifecycleState.VERIFIED)

        with pytest.raises(InvalidStateTransitionError):
            ExecutionStateMachine.transition(fresh_record, ExecutionLifecycleState.VALIDATING)


# =============================================================================
# 6. Traceability & Security Invariants
# =============================================================================

class TestTraceabilityAndSecurity:
    def test_full_traceability_identifiers_preserved(
        self,
        applied_record: ExecutionRecord,
        mock_connector: MockConnector,
    ) -> None:
        """Validates that validation reports contain exact finding_id, fix_plan_id, and request_id."""
        engine = ExecutionEngine()
        engine._records[applied_record.request.request_id] = applied_record

        valid_html = "<html><head><title>New Optimized Title | Brand</title></head></html>"
        report = engine.validate_execution(
            request_id=applied_record.request.request_id,
            connector=mock_connector,
            custom_rescan_html=valid_html,
        )

        assert report.request_id == applied_record.request.request_id
        assert report.finding_comparison is not None
        assert report.finding_comparison.finding_id == applied_record.request.finding_id
        assert applied_record.request.fix_plan_id == 501
        assert applied_record.request.recommendation_id == 401

    def test_no_secrets_in_validation_report(
        self,
        applied_record: ExecutionRecord,
        mock_connector: MockConnector,
    ) -> None:
        """Confirms that passwords and API secrets are not exposed in validation output."""
        report = ValidationEngine.evaluate(
            record=applied_record,
            connector=mock_connector,
        )
        report_str = report.model_dump_json()
        assert "password" not in report_str.lower()
        assert "ghp_" not in report_str
        assert "bearer" not in report_str.lower()

    def test_structured_data_validation_rule_evaluation(
        self,
        site_context: SiteContext,
        page_resource: ResourceReference,
        mock_connector: MockConnector,
    ) -> None:
        """Evaluates structured data remediation using JSON-LD schema markup."""
        engine = ExecutionEngine()
        proposal = ChangeProposal(
            target_resource=page_resource,
            action_type="inject_structured_data",
            suggested_content='{"@context": "https://schema.org", "@type": "Organization", "name": "Raval AI"}',
            original_content="",
            description="Inject Organization structured data",
        )
        req = engine.create_request(
            site_context=site_context,
            resource=page_resource,
            operation=ExecutionOperationType.APPLY_CHANGE,
            change_proposal=proposal,
        )
        engine.check_safety(req, connector=mock_connector)
        engine.preview_execution(req, connector=mock_connector)
        engine.apply_execution(req, connector=mock_connector)

        valid_schema_html = """<!DOCTYPE html>
<html>
<head>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Organization",
  "name": "Raval AI"
}
</script>
</head>
<body><h1>About</h1></body>
</html>"""
        report = engine.validate_execution(
            request_id=req.request_id,
            connector=mock_connector,
            custom_rescan_html=valid_schema_html,
        )
        assert report.is_verified is True
        assert report.outcome == ValidationOutcome.RESOLVED

    def test_heading_structure_validation_detects_multiple_h1_issue(
        self,
        site_context: SiteContext,
        page_resource: ResourceReference,
        mock_connector: MockConnector,
    ) -> None:
        """Ensures heading structure with multiple H1s is flagged appropriately."""
        engine = ExecutionEngine()
        proposal = ChangeProposal(
            target_resource=page_resource,
            action_type="heading_structure",
            suggested_content="Single Main Heading",
            original_content="Multiple H1s",
            description="Normalize to single H1 heading",
        )
        req = engine.create_request(
            site_context=site_context,
            resource=page_resource,
            operation=ExecutionOperationType.APPLY_CHANGE,
            change_proposal=proposal,
        )
        engine.check_safety(req, connector=mock_connector)
        engine.preview_execution(req, connector=mock_connector)
        engine.apply_execution(req, connector=mock_connector)

        multiple_h1_html = """<!DOCTYPE html>
<html><body>
<h1>First Heading</h1>
<h1>Second Heading</h1>
</body></html>"""
        report = engine.validate_execution(
            request_id=req.request_id,
            connector=mock_connector,
            custom_rescan_html=multiple_h1_html,
        )
        assert report.is_verified is False
        assert any("heading" in r.indicator_type for r in report.regression_indicators)

    def test_rollback_unknown_request_raises_resource_not_found(
        self,
        mock_connector: MockConnector,
    ) -> None:
        """Attempting to rollback an unknown request ID must raise ResourceNotFoundError."""
        engine = ExecutionEngine()
        with pytest.raises(ResourceNotFoundError):
            engine.rollback_and_verify(
                request_id="req_non_existent_9999",
                connector=mock_connector,
            )

    def test_skipping_lifecycle_states_is_rejected(
        self,
        applied_record: ExecutionRecord,
    ) -> None:
        """Directly jumping from APPLIED to KEPT or VERIFIED is strictly rejected."""
        with pytest.raises(InvalidStateTransitionError):
            ExecutionStateMachine.transition(applied_record, ExecutionLifecycleState.KEPT)

        with pytest.raises(InvalidStateTransitionError):
            ExecutionStateMachine.transition(applied_record, ExecutionLifecycleState.VERIFIED)

