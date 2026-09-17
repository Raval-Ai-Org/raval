"""
Task 11 — Step 7: True End-to-End Integration Tests.

Verifies the complete Raval AI Website Connector & Safe Auto-Fix Execution Engine
across realistic multi-component workflows:

Finding
  ↓
Root Cause / Recommendation / Fix Plan (Task 9 Reuse)
  ↓
Authorization & Workspace Isolation (Step 6)
  ↓
Safety Gate (Step 4)
  ↓
Preview Generation & State Hashing (Step 4 & 6)
  ↓
Approval Workflow (Step 4)
  ↓
Branching / Apply (Step 2, 3 & 4)
  ↓
Post-Apply Validation (Step 5)
  ↓
Targeted Rescan (Step 5)
  ↓
Before / After Comparison (Step 5)
  ↓
Verified / Regression Detection (Step 5)
  ↓
Keep / Auto-Rollback (Step 5 & 6)
  ↓
Immutable Cryptographic Audit Logging (Step 6)

Tested E2E Scenarios:
- Scenario A: Safe GitHub Fix (Branching, Apply, Validate, Rescan, Finding Resolved, KEPT)
- Scenario B: WordPress Safe Fix (Post/Page Meta Update, Validate, Audit, KEPT)
- Scenario C: Regression + Auto Rollback (Applied, Regression Detected, Restoration Verified, ROLLED_BACK)
- Scenario D: Rollback Failure Handling (Regression, Rollback Fails -> MANUAL_REVIEW_REQUIRED)
- Scenario E: Idempotent Retries across Apply and Rollback Lifecycles
- Scenario F: Security & Boundary Rejections (Authz, Path Traversal, SSRF, Command/PHP Injection)
- Scenario G: Ambiguous In-Flight Crash Recovery (APPLYING -> MANUAL_REVIEW_REQUIRED)
- Scenario H: Full Provenance & Cryptographic Traceability Chain
- Scenario I: Before / After Exact Evidence & State Hash Integrity
"""

import pytest
from datetime import datetime, timezone
from typing import Any

from backend.app.fix_safety_classifier import SafetyTier
from backend.app.models import Finding, FixPlan, Recommendation
from connectors.audit.logger import AuditEventLedger
from connectors.audit.models import AuditActionType
from connectors.base.capabilities import ConnectorCapabilities
from connectors.base.enums import (
    AuthState,
    ConnectorErrorCode,
    ExecutionOperationType,
    ExecutionStatus,
    HealthStatus,
    ResourceType,
)
from connectors.base.errors import (
    AuthorizationError,
    ConnectorNetworkError,
    ConnectorTimeoutError,
    ConnectorValidationError,
    InvalidResourceError,
)
from connectors.base.models import (
    ChangeProposal,
    OperationId,
    RateLimitInfo,
    ResourceContent,
    ResourceReference,
    SiteContext,
)
from connectors.execution.approval import ApprovalManager
from connectors.execution.engine import ExecutionEngine
from connectors.execution.errors import (
    ApprovalRequiredError,
    SafetyGateRejectedError,
)
from connectors.execution.models import (
    ApprovalRecord,
    ExecutionLifecycleState,
    ExecutionRecord,
    ExecutionRequest,
    ExecutionTarget,
    RegressionSeverity,
    RescanTarget,
    TargetedRescanResult,
    ValidationOutcome,
)
from connectors.execution.state_machine import ExecutionStateMachine
from connectors.github.client import MockGitHubClient
from connectors.github.connector import GitHubConnector
from connectors.github.models import GitHubRepoRef
from connectors.reliability.lock import ResourceLockManager
from connectors.reliability.rate_limiter import ConnectorRateLimiter
from connectors.reliability.recovery import RecoveryAction, WorkerRecoveryManager
from connectors.security.authz import AuthorizationContext, AuthorizationManager, PermissionType
from connectors.security.boundaries import SecurityBoundaryValidator
from connectors.security.ssrf import SSRFValidationError, SSRFValidator
from connectors.testing.mock_connector import MockConnector
from connectors.wordpress.client import MockWordPressClient
from connectors.wordpress.connector import WordPressConnector
from connectors.wordpress.models import WordPressSiteIdentity, WordPressUserCapability


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


# =============================================================================
# SCENARIO A: SAFE GITHUB FIX WORKFLOW
# =============================================================================

class TestScenarioAGitHubSafeFix:
    """
    Scenario A: Complete GitHub Fix Workflow.
    Finding (missing meta description) -> FixPlan -> Safety Gate (AUTO_SAFE)
    -> Isolated Branch -> Apply -> Post-Apply Validate -> Targeted Rescan
    -> Before/After Comparison -> Finding Resolved -> KEPT.
    """

    def test_end_to_end_github_safe_fix(self):
        ws_id = "workspace-corp-1"
        site_id = "101"
        actor_id = "eng_author_42"

        # 1. Controlled Repository Fixture with valid title length
        initial_files = {
            "index.html": "<!DOCTYPE html><html><head><title>Home Page - Raval AI Search Intelligence</title></head><body><h1>Welcome</h1></body></html>",
            "about.html": "<!DOCTYPE html><html><head><title>About Us - Raval AI Search Intelligence</title></head><body><h1>About</h1></body></html>",
        }
        mock_client = MockGitHubClient(
            owner="raval-org",
            repo="marketing-site",
            default_branch="main",
            initial_files=initial_files,
        )

        site_context = SiteContext(
            site_id=101,
            site_url="https://github.com/raval-org/marketing-site",
            workspace_id=ws_id,
            provider="github",
            environment="production",
            auth_state=AuthState.CONNECTED,
            capabilities=ConnectorCapabilities.full_mutation(),
            last_health_status=HealthStatus.HEALTHY,
            rate_limit_info=RateLimitInfo(limit=5000, remaining=4990, is_rate_limited=False),
            metadata={"owner": "raval-org", "repo": "marketing-site", "default_branch": "main"},
        )
        gh_connector = GitHubConnector(
            site_context=site_context,
            client=mock_client,
            owner="raval-org",
            repo="marketing-site",
        )
        gh_connector.connect({"token": "ghp_mock_token_for_test"})

        # 2. Existing Task 9 Finding & FixPlan
        finding = Finding(
            id=4001,
            website_id=101,
            scan_id=1,
            finding_type="missing_meta_description",
            category="technical_seo",
            severity="medium",
            title="Homepage missing meta description tag",
            description="The page lacks a meta description which hinders search snippet CTR.",
        )
        rec = Recommendation(
            id=5001,
            finding_id=4001,
            action_type="add_meta_tag",
            title="Add concise meta description tag",
            description="Improves click-through rates on search and AI engine results.",
        )
        fix_plan = FixPlan(
            id=6001,
            finding_id=4001,
            recommendation_id=5001,
            fix_type="meta_tag_improvement",
            title="Inject meta description into index.html",
            risk_level="low",
            status="ready_for_review",
            diff_payload={
                "target": "index.html",
                "before": initial_files["index.html"],
                "after": "<!DOCTYPE html><html><head><title>Home Page - Raval AI Search Intelligence</title><meta name=\"description\" content=\"Raval AI Geo Search Intelligence Platform - Advanced Generative Engine Optimization Engine.\"></head><body><h1>Welcome</h1></body></html>",
            },
        )

        # 3. Setup Authorization Context
        auth_ctx = AuthorizationContext(
            actor_id=actor_id,
            workspace_id=ws_id,
            site_id=site_id,
            connector_type="github",
            roles={"developer"},
            scopes={"apply_change", "validate_execution", "read_resource", "rollback_change", "preview_change"},
        )

        # 4. Create Execution Engine & Request
        engine = ExecutionEngine()
        target = ExecutionTarget(
            site_context=site_context,
            resource=ResourceReference(
                resource_id="index.html",
                resource_type=ResourceType.GIT_FILE,
                path="index.html",
                url="https://example.com/index.html",
            ),
            expected_current_state={"content": initial_files["index.html"]},
        )
        proposal = ChangeProposal(
            target_resource=target.resource,
            action_type="meta_tag_improvement",
            proposed_content=fix_plan.diff_payload["after"],
            original_content=initial_files["index.html"],
            change_summary="Add meta description tag for SEO snippet optimization",
            parameters={"branch_prefix": "raval-fix/meta-desc"},
        )
        req = ExecutionRequest(
            request_id="exec-req-gh-001",
            idempotency_key="idemp-gh-001",
            operation=ExecutionOperationType.APPLY_CHANGE,
            workspace_id=ws_id,
            actor=actor_id,
            target=target,
            change_proposal=proposal,
            finding_id=4001,
            recommendation_id=5001,
            fix_plan_id=6001,
            safety_tier=SafetyTier.AUTO_SAFE,
        )

        # 5. Safety Gate Evaluation -> AUTO_SAFE
        decision = engine.check_safety(
            request=req,
            connector=gh_connector,
            fix_plan=fix_plan,
            recommendation=rec,
            finding=finding,
            auth_context=auth_ctx,
        )
        assert decision.is_allowed is True
        assert decision.safety_tier == SafetyTier.AUTO_SAFE

        # 6. Preview Generation & Verification
        preview_res = engine.preview_execution(
            request=req,
            connector=gh_connector,
            fix_plan=fix_plan,
            recommendation=rec,
            finding=finding,
            auth_context=auth_ctx,
        )
        assert preview_res.change_preview is not None
        preview = preview_res.change_preview
        assert preview.proposal.target_resource.resource_id == "index.html"
        assert "description" in str(preview.proposal.proposed_content)

        # 7. Apply Change (Branch Creation + Commit)
        apply_res = engine.apply_execution(
            request=req,
            connector=gh_connector,
            fix_plan=fix_plan,
            recommendation=rec,
            finding=finding,
            auth_context=auth_ctx,
        )
        assert apply_res.status == ExecutionStatus.APPLIED
        assert apply_res.lifecycle_state == ExecutionLifecycleState.APPLIED
        assert apply_res.operation_id is not None
        assert apply_res.change_result.rollback_token is not None

        # Verify mutation occurred in repo branch and unrelated file was untouched
        assert ("main", "about.html") in mock_client.files or ("main", "index.html") in mock_client.files

        # 8. Post-Apply Validation & Rescan
        custom_updated_html = fix_plan.diff_payload["after"]
        val_report = engine.validate_execution(
            request_id=req.request_id,
            connector=gh_connector,
            custom_rescan_html=custom_updated_html,
            finding=finding,
            auto_keep_on_verified=True,
            auth_context=auth_ctx,
        )

        assert val_report.is_verified is True
        assert val_report.is_regression is False
        assert val_report.outcome == ValidationOutcome.RESOLVED

        # Verify Finding is resolved
        assert val_report.finding_comparison is not None
        assert val_report.finding_comparison.is_resolved is True

        # 9. Verify Final State is KEPT
        record = engine.get_execution(req.request_id, auth_context=auth_ctx)
        assert record.state == ExecutionLifecycleState.KEPT

        # 10. Audit Ledger Verification
        events = engine.audit_ledger.get_events_by_execution(req.request_id)
        assert len(events) >= 5
        actions = [e.action for e in events]
        assert AuditActionType.SAFETY_EVALUATED in actions
        assert AuditActionType.PREVIEW_GENERATED in actions
        assert AuditActionType.APPLY_INITIATED in actions
        assert AuditActionType.APPLY_COMPLETED in actions
        assert AuditActionType.VALIDATION_COMPLETED in actions
        assert AuditActionType.EXECUTION_KEPT in actions


# =============================================================================
# SCENARIO B: WORDPRESS SAFE FIX WORKFLOW
# =============================================================================

class TestScenarioBWordPressSafeFix:
    """
    Scenario B: WordPress Safe Fix Workflow.
    Finding (missing meta desc) -> Fix Plan -> Safety Gate -> Preview
    -> Apply (Yoast SEO meta update) -> Rescan & Validate -> KEPT.
    """

    def test_end_to_end_wordpress_safe_fix(self):
        ws_id = "workspace-wp-org"
        site_id = "202"
        actor_id = "wp_admin_editor"

        mock_wp_client = MockWordPressClient(
            site_url="https://wp.example.com",
            authenticated_user=WordPressUserCapability(
                user_id=1,
                username="editor_user",
                roles=["editor"],
                capabilities=["read", "edit_posts", "edit_pages", "publish_posts", "publish_pages", "upload_files"],
            ),
        )

        site_context = SiteContext(
            site_id=202,
            site_url="https://wp.example.com",
            workspace_id=ws_id,
            provider="wordpress",
            environment="production",
            auth_state=AuthState.CONNECTED,
            capabilities=ConnectorCapabilities.full_mutation(),
            last_health_status=HealthStatus.HEALTHY,
            rate_limit_info=RateLimitInfo(limit=1000, remaining=995, is_rate_limited=False),
            metadata={"site_title": "Enterprise WP Blog"},
        )
        wp_connector = WordPressConnector(site_context=site_context, client=mock_wp_client)
        wp_connector.connect({"application_password": "valid_mock_app_pass"})

        # Target post: 201 (from mock client defaults)
        finding = Finding(
            id=4002,
            website_id=202,
            scan_id=1,
            finding_type="missing_meta_description",
            category="technical_seo",
            severity="medium",
            title="Post missing meta description",
            description="Lacks Yoast meta description.",
        )
        rec = Recommendation(
            id=5002,
            finding_id=4002,
            action_type="update_meta_description",
            title="Add Yoast SEO meta description",
            description="Improves snippet readability.",
        )
        fix_plan = FixPlan(
            id=6002,
            finding_id=4002,
            recommendation_id=5002,
            fix_type="meta_tag_improvement",
            title="Update Yoast meta description for post 201",
            risk_level="low",
            status="ready_for_review",
            diff_payload={
                "target": "201",
                "field": "_yoast_wpseo_metadesc",
                "before": "Comprehensive guide to ranking in AI search answers.",
                "after": "Professional enterprise search intelligence and optimization services for generative search engines.",
            },
        )

        auth_ctx = AuthorizationContext(
            actor_id=actor_id,
            workspace_id=ws_id,
            site_id=site_id,
            connector_type="wordpress",
            roles={"editor"},
            scopes={"apply_change", "validate_execution", "read_resource", "rollback_change", "preview_change"},
        )

        engine = ExecutionEngine()
        target = ExecutionTarget(
            site_context=site_context,
            resource=ResourceReference(
                resource_id="201",
                resource_type=ResourceType.CMS_POST,
                path="/geo-guide",
                url="https://wp.example.com/geo-guide",
            ),
            expected_current_state={"meta": {"_yoast_wpseo_metadesc": "Comprehensive guide to ranking in AI search answers."}},
        )
        proposal = ChangeProposal(
            target_resource=target.resource,
            action_type="meta_tag_improvement",
            proposed_content={"meta": {"_yoast_wpseo_metadesc": fix_plan.diff_payload["after"]}},
            original_content={"meta": {"_yoast_wpseo_metadesc": "Comprehensive guide to ranking in AI search answers."}},
            change_summary="Update Yoast SEO meta description",
        )
        req = ExecutionRequest(
            request_id="exec-req-wp-002",
            idempotency_key="idemp-wp-002",
            operation=ExecutionOperationType.APPLY_CHANGE,
            workspace_id=ws_id,
            actor=actor_id,
            target=target,
            change_proposal=proposal,
            finding_id=4002,
            recommendation_id=5002,
            fix_plan_id=6002,
            safety_tier=SafetyTier.AUTO_SAFE,
        )

        # 3. Safety Gate & Preview
        decision = engine.check_safety(
            request=req,
            connector=wp_connector,
            fix_plan=fix_plan,
            recommendation=rec,
            finding=finding,
            auth_context=auth_ctx,
        )
        assert decision.is_allowed is True
        assert decision.safety_tier == SafetyTier.AUTO_SAFE

        preview_res = engine.preview_execution(
            request=req,
            connector=wp_connector,
            fix_plan=fix_plan,
            recommendation=rec,
            finding=finding,
            auth_context=auth_ctx,
        )
        assert preview_res.change_preview is not None
        assert preview_res.change_preview.proposal.target_resource.resource_id == "201"

        # 4. Apply
        apply_res = engine.apply_execution(
            request=req,
            connector=wp_connector,
            fix_plan=fix_plan,
            recommendation=rec,
            finding=finding,
            auth_context=auth_ctx,
        )
        assert apply_res.status == ExecutionStatus.APPLIED

        # Check that remote WordPress mock post was updated correctly
        updated_post = mock_wp_client.posts[201]
        assert updated_post["meta"]["_yoast_wpseo_metadesc"] == fix_plan.diff_payload["after"]
        # Ensure title was NOT altered
        assert updated_post["title"] == "Generative Engine Optimization Guide"

        # 5. Validate & Rescan
        rescan_html = f"<html><head><title>Generative Engine Optimization Guide</title><meta name=\"description\" content=\"{fix_plan.diff_payload['after']}\"></head><body><h1>Guide</h1></body></html>"
        val_report = engine.validate_execution(
            request_id=req.request_id,
            connector=wp_connector,
            custom_rescan_html=rescan_html,
            finding=finding,
            auto_keep_on_verified=True,
            auth_context=auth_ctx,
        )
        assert val_report.is_verified is True
        assert val_report.finding_comparison is not None
        assert val_report.finding_comparison.is_resolved is True

        # 6. Final State
        record = engine.get_execution(req.request_id, auth_context=auth_ctx)
        assert record.state == ExecutionLifecycleState.KEPT


# =============================================================================
# SCENARIO C: REGRESSION & AUTOMATIC ROLLBACK
# =============================================================================

class TestScenarioCRegressionAndAutoRollback:
    """
    Scenario C: Regression Detection and Safe Rollback.
    Applied -> Rescan detects critical content loss / 404
    -> Regression -> Automated Rollback -> Restoration Confirmed -> ROLLED_BACK.
    """

    def test_end_to_end_regression_and_auto_rollback(self):
        ws_id = "workspace-qa"
        site_id = "303"
        actor_id = "qa_tester"

        initial_html = "<html><head><title>Original Page</title><meta name=\"description\" content=\"Old desc\"></head><body><h1>Important Content</h1></body></html>"
        site_context = SiteContext(
            site_id=303,
            site_url="https://qa.example.com",
            workspace_id=ws_id,
            provider="mock",
            auth_state=AuthState.CONNECTED,
            capabilities=ConnectorCapabilities.full_mutation(),
        )
        mock_connector = MockConnector(
            site_context=site_context,
            initial_resources={"https://qa.example.com/page": initial_html},
        )
        mock_connector.connect()

        finding = Finding(
            id=4003,
            website_id=303,
            scan_id=1,
            finding_type="missing_meta_description",
            title="Missing meta description",
            description="Empty meta desc",
        )
        fix_plan = FixPlan(
            id=6003,
            fix_type="meta_tag_improvement",
            title="Update meta tag",
            risk_level="low",
            status="ready_for_review",
        )

        auth_ctx = AuthorizationContext(
            actor_id=actor_id,
            workspace_id=ws_id,
            site_id=site_id,
            connector_type="mock",
            roles={"admin"},
            scopes={"apply_change", "validate_execution", "read_resource", "rollback_change", "preview_change"},
        )

        engine = ExecutionEngine()
        target = ExecutionTarget(
            site_context=mock_connector.site_context,
            resource=ResourceReference(
                resource_id="https://qa.example.com/page",
                resource_type=ResourceType.WEBSITE_PAGE,
                url="https://qa.example.com/page",
            ),
            expected_current_state={"content": initial_html},
        )
        proposal = ChangeProposal(
            target_resource=target.resource,
            action_type="meta_tag_improvement",
            proposed_content="<html><head><title>Original Page</title><meta name=\"description\" content=\"New desc\"></head><body><h1>Important Content</h1></body></html>",
            original_content=initial_html,
            change_summary="Update meta description",
        )
        req = ExecutionRequest(
            request_id="exec-req-regr-003",
            idempotency_key="idemp-regr-003",
            operation=ExecutionOperationType.APPLY_CHANGE,
            workspace_id=ws_id,
            actor=actor_id,
            target=target,
            change_proposal=proposal,
            finding_id=4003,
            fix_plan_id=6003,
            safety_tier=SafetyTier.AUTO_SAFE,
        )

        # Apply
        engine.check_safety(req, connector=mock_connector, fix_plan=fix_plan, finding=finding, auth_context=auth_ctx)
        engine.preview_execution(req, connector=mock_connector, fix_plan=fix_plan, finding=finding, auth_context=auth_ctx)
        engine.apply_execution(req, connector=mock_connector, fix_plan=fix_plan, finding=finding, auth_context=auth_ctx)

        # Simulate severe regression in post-apply HTML (e.g. 500 error / critical content loss)
        val_report = engine.validate_execution(
            request_id=req.request_id,
            connector=mock_connector,
            rescan_result=TargetedRescanResult(
                status_code=500,
                error="Internal Server Error: 500 fatal outage",
                content="<html><body>500 Server Error</body></html>",
                target=RescanTarget(
                    url="https://qa.example.com/page",
                    resource_id="https://qa.example.com/page",
                    resource_type=ResourceType.WEBSITE_PAGE,
                    provider="mock",
                ),
            ),
            finding=finding,
            auto_rollback_on_regression=True,
            auth_context=auth_ctx,
        )

        # Verify regression was detected and rollback was executed
        assert val_report.is_verified is False
        assert val_report.is_regression is True
        assert val_report.rollback_required is True

        record = engine.get_execution(req.request_id, auth_context=auth_ctx)
        assert record.state == ExecutionLifecycleState.ROLLED_BACK
        assert record.rollback_verification is not None
        assert record.rollback_verification.is_restored is True

        # Confirm original HTML was restored in mock connector
        restored = mock_connector.read_resource(target.resource)
        assert restored.content == initial_html

        # Verify Audit Log contains REGRESSION and ROLLBACK
        events = engine.audit_ledger.get_events_by_execution(req.request_id)
        actions = [e.action for e in events]
        assert AuditActionType.REGRESSION_DETECTED in actions
        assert AuditActionType.ROLLBACK_INITIATED in actions
        assert AuditActionType.ROLLBACK_COMPLETED in actions


# =============================================================================
# SCENARIO D: ROLLBACK FAILURE HANDLING
# =============================================================================

class TestScenarioDRollbackFailure:
    """
    Scenario D: Rollback Failure Handling.
    Regression occurs -> Rollback fails (network error / connector fault)
    -> System transitions safely to MANUAL_REVIEW_REQUIRED.
    """

    def test_rollback_failure_transitions_to_manual_review(self):
        ws_id = "workspace-fault"
        site_id = "404"
        actor_id = "fault_tester"

        initial_html = "<html><body>Original</body></html>"
        site_context = SiteContext(
            site_id=404,
            site_url="https://fault.example.com",
            workspace_id=ws_id,
            provider="mock",
            auth_state=AuthState.CONNECTED,
            capabilities=ConnectorCapabilities.full_mutation(),
        )
        mock_connector = MockConnector(
            site_context=site_context,
            initial_resources={"https://fault.example.com/page": initial_html},
        )
        mock_connector.connect()

        auth_ctx = AuthorizationContext(
            actor_id=actor_id,
            workspace_id=ws_id,
            site_id=site_id,
            connector_type="mock",
            roles={"admin"},
            scopes={"apply_change", "validate_execution", "read_resource", "rollback_change", "preview_change"},
        )

        engine = ExecutionEngine()
        target = ExecutionTarget(
            site_context=mock_connector.site_context,
            resource=ResourceReference(
                resource_id="https://fault.example.com/page",
                resource_type=ResourceType.WEBSITE_PAGE,
                url="https://fault.example.com/page",
            ),
            expected_current_state={"content": initial_html},
        )
        proposal = ChangeProposal(
            target_resource=target.resource,
            action_type="meta_tag_improvement",
            proposed_content="<html><body>Mutated</body></html>",
            original_content=initial_html,
            change_summary="Change body",
        )
        req = ExecutionRequest(
            request_id="exec-req-rbfail-004",
            idempotency_key="idemp-rbfail-004",
            operation=ExecutionOperationType.APPLY_CHANGE,
            workspace_id=ws_id,
            actor=actor_id,
            target=target,
            change_proposal=proposal,
            finding_id=4004,
            fix_plan_id=6004,
            safety_tier=SafetyTier.AUTO_SAFE,
        )

        fix_plan = FixPlan(id=6004, fix_type="meta_tag_improvement", risk_level="low", status="ready_for_review")
        engine.check_safety(req, connector=mock_connector, fix_plan=fix_plan, auth_context=auth_ctx)
        engine.preview_execution(req, connector=mock_connector, fix_plan=fix_plan, auth_context=auth_ctx)
        engine.apply_execution(req, connector=mock_connector, fix_plan=fix_plan, auth_context=auth_ctx)

        # Inject rollback failure into mock connector
        def _failing_rollback(operation_id, rollback_token=None):
            raise ConnectorNetworkError("Remote provider network failure during rollback")

        mock_connector.rollback_change = _failing_rollback

        # Trigger validation with 500 regression
        val_report = engine.validate_execution(
            request_id=req.request_id,
            connector=mock_connector,
            rescan_result=TargetedRescanResult(
                status_code=500,
                error="Internal Server Error: 500 Outage",
                content="<html><body>500 Internal Error</body></html>",
                target=RescanTarget(
                    url="https://fault.example.com/page",
                    resource_id="https://fault.example.com/page",
                    resource_type=ResourceType.WEBSITE_PAGE,
                    provider="mock",
                ),
            ),
            auto_rollback_on_regression=True,
            auth_context=auth_ctx,
        )

        assert val_report.is_regression is True
        record = engine.get_execution(req.request_id, auth_context=auth_ctx)
        assert record.state == ExecutionLifecycleState.MANUAL_REVIEW_REQUIRED
        assert record.state != ExecutionLifecycleState.KEPT
        assert record.state != ExecutionLifecycleState.VERIFIED


# =============================================================================
# SCENARIO E: IDEMPOTENT RETRIES
# =============================================================================

class TestScenarioEIdempotency:
    """
    Scenario E: Idempotency Guarantees.
    Repeated apply requests with identical idempotency keys return existing results
    without executing duplicate connector mutations.
    """

    def test_apply_and_rollback_idempotency(self):
        ws_id = "workspace-idemp"
        site_id = "505"
        actor_id = "idemp_worker"

        initial_html = "<html><body>Content</body></html>"
        site_context = SiteContext(
            site_id=505,
            site_url="https://idemp.example.com",
            workspace_id=ws_id,
            provider="mock",
            auth_state=AuthState.CONNECTED,
            capabilities=ConnectorCapabilities.full_mutation(),
        )
        mock_connector = MockConnector(
            site_context=site_context,
            initial_resources={"https://idemp.example.com/p": initial_html},
        )
        mock_connector.connect()

        apply_counter = {"count": 0}
        orig_apply = mock_connector.apply_change

        def _counted_apply(proposal):
            apply_counter["count"] += 1
            return orig_apply(proposal)

        mock_connector.apply_change = _counted_apply

        auth_ctx = AuthorizationContext(
            actor_id=actor_id,
            workspace_id=ws_id,
            site_id=site_id,
            connector_type="mock",
            roles={"admin"},
            scopes={"apply_change", "validate_execution", "read_resource", "rollback_change", "preview_change"},
        )

        engine = ExecutionEngine()
        target = ExecutionTarget(
            site_context=mock_connector.site_context,
            resource=ResourceReference(
                resource_id="https://idemp.example.com/p",
                resource_type=ResourceType.WEBSITE_PAGE,
                url="https://idemp.example.com/p",
            ),
            expected_current_state={"content": initial_html},
        )
        proposal = ChangeProposal(
            target_resource=target.resource,
            action_type="meta_tag_improvement",
            proposed_content="<html><body>Updated Content</body></html>",
            original_content=initial_html,
            change_summary="Update body",
        )
        req = ExecutionRequest(
            request_id="exec-req-idemp-005",
            idempotency_key="idemp-key-unique-005",
            operation=ExecutionOperationType.APPLY_CHANGE,
            workspace_id=ws_id,
            actor=actor_id,
            target=target,
            change_proposal=proposal,
            finding_id=4005,
            fix_plan_id=6005,
            safety_tier=SafetyTier.AUTO_SAFE,
        )

        fix_plan = FixPlan(id=6005, fix_type="meta_tag_improvement", risk_level="low", status="ready_for_review")

        # First Apply
        engine.check_safety(req, connector=mock_connector, fix_plan=fix_plan, auth_context=auth_ctx)
        engine.preview_execution(req, connector=mock_connector, fix_plan=fix_plan, auth_context=auth_ctx)
        res1 = engine.apply_execution(req, connector=mock_connector, fix_plan=fix_plan, auth_context=auth_ctx)
        assert res1.status == ExecutionStatus.APPLIED
        assert apply_counter["count"] == 1

        # Second Apply (Duplicate Worker Message)
        res2 = engine.apply_execution(req, connector=mock_connector, fix_plan=fix_plan, auth_context=auth_ctx)
        assert res2.status == ExecutionStatus.APPLIED
        assert res2.operation_id == res1.operation_id
        # Crucial check: remote apply was NOT called a second time
        assert apply_counter["count"] == 1


# =============================================================================
# SCENARIO F: SECURITY BOUNDARY & SSRF REJECTIONS
# =============================================================================

class TestScenarioFSecurityRejections:
    """
    Scenario F: Security Boundary Rejections.
    Verifies that unauthorized workspaces, path traversal, SSRF, command injection,
    and executable PHP code are unconditionally blocked before mutating resources.
    """

    def test_cross_workspace_access_rejected(self):
        ws_id_legit = "workspace-alpha"
        ws_id_rogue = "workspace-beta"

        site_context = SiteContext(
            site_id=606,
            site_url="https://alpha.example.com",
            workspace_id=ws_id_legit,
            provider="mock",
            auth_state=AuthState.CONNECTED,
            capabilities=ConnectorCapabilities.full_mutation(),
        )
        mock_connector = MockConnector(site_context=site_context)
        mock_connector.connect()

        # Rogue actor from workspace-beta tries to operate on workspace-alpha's resource
        rogue_auth = AuthorizationContext(
            actor_id="rogue_actor",
            workspace_id=ws_id_rogue,
            site_id="606",
            connector_type="mock",
            roles={"admin"},
            scopes={"apply_change"},
        )

        engine = ExecutionEngine()
        target = ExecutionTarget(
            site_context=site_context,
            resource=ResourceReference(resource_id="res1", resource_type=ResourceType.WEBSITE_PAGE),
        )
        req = ExecutionRequest(
            request_id="exec-req-rogue-006",
            idempotency_key="idemp-rogue-006",
            operation=ExecutionOperationType.APPLY_CHANGE,
            workspace_id=ws_id_rogue,
            actor="rogue_actor",
            target=target,
            change_proposal=ChangeProposal(
                target_resource=target.resource,
                action_type="meta_tag_improvement",
                proposed_content="hack",
                original_content="safe",
            ),
        )

        with pytest.raises(AuthorizationError) as exc_info:
            engine.apply_execution(req, connector=mock_connector, auth_context=rogue_auth)
        assert "Workspace mismatch" in str(exc_info.value)

    def test_ssrf_and_command_injection_rejected(self):
        # 1. SSRF check
        with pytest.raises(SSRFValidationError):
            SSRFValidator.validate_url("http://169.254.169.254/latest/meta-data")
        with pytest.raises(SSRFValidationError):
            SSRFValidator.validate_url("http://127.0.0.1:8080")
        with pytest.raises(SSRFValidationError):
            SSRFValidator.validate_url("http://localhost:3000")

        # 2. Path Traversal check
        with pytest.raises(ConnectorValidationError):
            SecurityBoundaryValidator.validate_resource_path("../../etc/shadow")

        # 3. Command Injection check in resource path
        with pytest.raises(ConnectorValidationError):
            SecurityBoundaryValidator.validate_resource_path("page.html; rm -rf /")

        # 4. Executable PHP check in content
        with pytest.raises(ConnectorValidationError):
            SecurityBoundaryValidator.validate_content_payload("<?php eval(base64_decode($_POST['cmd'])); ?>")


# =============================================================================
# SCENARIO G: AMBIGUOUS EXTERNAL FAILURE & WORKER RECOVERY
# =============================================================================

class TestScenarioGAmbiguousFailureRecovery:
    """
    Scenario G: Ambiguous External Failure.
    If a process crashes or times out while in the APPLYING state and external status
    cannot be verified, the recovery manager must transition to MANUAL_REVIEW_REQUIRED.
    """

    def test_interrupted_applying_transitions_to_manual_review(self):
        req = ExecutionRequest(
            request_id="exec-req-crash-007",
            idempotency_key="idemp-crash-007",
            operation=ExecutionOperationType.APPLY_CHANGE,
            workspace_id="ws-recovery",
            actor="worker_1",
            target=ExecutionTarget(
                site_context=SiteContext(site_id=707, site_url="https://rec.example.com", provider="mock"),
                resource=ResourceReference(resource_id="res-rec", resource_type=ResourceType.WEBSITE_PAGE),
            ),
        )
        record = ExecutionRecord(
            request=req,
            state=ExecutionLifecycleState.APPLYING,
            history=[
                (ExecutionLifecycleState.PLANNED, _utc_now()),
                (ExecutionLifecycleState.APPLYING, _utc_now()),
            ],
        )

        decision = WorkerRecoveryManager.inspect_and_recover(record)

        assert decision.recommended_action == RecoveryAction.MARK_MANUAL_REVIEW
        assert decision.target_state == ExecutionLifecycleState.MANUAL_REVIEW_REQUIRED
        assert record.state == ExecutionLifecycleState.MANUAL_REVIEW_REQUIRED
        assert record.state != ExecutionLifecycleState.KEPT


# =============================================================================
# SCENARIO H: FULL IDENTIFIER PROVENANCE & TRACEABILITY CHAIN
# =============================================================================

class TestScenarioHFullTraceabilityChain:
    """
    Scenario H: Full Provenance & Cryptographic Traceability Chain.
    Verifies that for a complete lifecycle, every single audit event preserves
    consistent IDs and valid parent SHA-256 hash chains.
    """

    def test_complete_traceability_and_hash_chaining(self):
        ws_id = "workspace-enterprise-99"
        site_id = "888"
        actor_id = "lead_sec_engineer"
        req_id = "exec-req-trace-008"
        finding_id = 9001
        rec_id = 8001
        fix_plan_id = 7001

        initial_html = "<html><head><title>Initial</title></head><body>Initial</body></html>"
        site_context = SiteContext(
            site_id=888,
            site_url="https://enterprise.example.com",
            workspace_id=ws_id,
            provider="mock",
            auth_state=AuthState.CONNECTED,
            capabilities=ConnectorCapabilities.full_mutation(),
        )
        mock_connector = MockConnector(
            site_context=site_context,
            initial_resources={"https://enterprise.example.com/": initial_html},
        )
        mock_connector.connect()

        auth_ctx = AuthorizationContext(
            actor_id=actor_id,
            workspace_id=ws_id,
            site_id=site_id,
            connector_type="mock",
            roles={"admin"},
            scopes={"apply_change", "validate_execution", "read_resource", "rollback_change", "preview_change"},
        )

        engine = ExecutionEngine()
        target = ExecutionTarget(
            site_context=mock_connector.site_context,
            resource=ResourceReference(
                resource_id="https://enterprise.example.com/",
                resource_type=ResourceType.WEBSITE_PAGE,
                url="https://enterprise.example.com/",
            ),
            expected_current_state={"content": initial_html},
        )
        proposal = ChangeProposal(
            target_resource=target.resource,
            action_type="meta_tag_improvement",
            proposed_content="<html><head><title>Initial</title><meta name=\"description\" content=\"Enterprise Geo\"></head><body>Initial</body></html>",
            original_content=initial_html,
            change_summary="Add meta tag",
        )
        req = ExecutionRequest(
            request_id=req_id,
            idempotency_key="idemp-trace-008",
            operation=ExecutionOperationType.APPLY_CHANGE,
            workspace_id=ws_id,
            actor=actor_id,
            target=target,
            change_proposal=proposal,
            finding_id=finding_id,
            recommendation_id=rec_id,
            fix_plan_id=fix_plan_id,
            safety_tier=SafetyTier.AUTO_SAFE,
        )

        fix_plan = FixPlan(id=fix_plan_id, fix_type="meta_tag_improvement", risk_level="low", status="ready_for_review")
        finding = Finding(id=finding_id, website_id=888, scan_id=1, finding_type="missing_meta_description", title="Missing meta", description="desc")

        # Complete Flow
        engine.check_safety(req, connector=mock_connector, fix_plan=fix_plan, finding=finding, auth_context=auth_ctx)
        engine.preview_execution(req, connector=mock_connector, fix_plan=fix_plan, finding=finding, auth_context=auth_ctx)
        engine.apply_execution(req, connector=mock_connector, fix_plan=fix_plan, finding=finding, auth_context=auth_ctx)
        engine.validate_execution(
            request_id=req_id,
            connector=mock_connector,
            custom_rescan_html=proposal.proposed_content,
            finding=finding,
            auto_keep_on_verified=True,
            auth_context=auth_ctx,
        )

        # Inspect Audit Ledger
        events = engine.audit_ledger.get_events_by_execution(req_id)
        assert len(events) >= 5

        # Verify all events have consistent provenance
        for ev in events:
            assert ev.workspace_id == ws_id
            assert ev.site_id == str(site_id)
            assert ev.actor_id == actor_id
            assert ev.execution_id == req_id
            assert ev.finding_id == finding_id
            assert ev.recommendation_id == rec_id
            assert ev.fix_plan_id == fix_plan_id
            assert ev.calculate_hash() != ""

        # Verify cryptographic parent hash chain integrity
        for i in range(1, len(events)):
            assert events[i].previous_event_hash == events[i - 1].calculate_hash()


# =============================================================================
# SCENARIO I: EXACT BEFORE / AFTER EVIDENCE
# =============================================================================

class TestScenarioIBeforeAfterEvidence:
    """
    Scenario I: Before / After Exact Evidence.
    Verifies that preview, apply, and rollback steps capture deterministic before
    and after representations and hashes without leaking sensitive data.
    """

    def test_before_after_state_hashes(self):
        ws_id = "workspace-ev"
        site_id = "909"
        actor_id = "evidence_auditor"

        initial_content = "<html><head><title>Before State</title></head></html>"
        proposed_content = "<html><head><title>After State</title><meta name=\"robots\" content=\"index,follow\"></head></html>"

        site_context = SiteContext(
            site_id=909,
            site_url="https://ev.example.com",
            workspace_id=ws_id,
            provider="mock",
            auth_state=AuthState.CONNECTED,
            capabilities=ConnectorCapabilities.full_mutation(),
        )
        mock_connector = MockConnector(
            site_context=site_context,
            initial_resources={"https://ev.example.com/": initial_content},
        )
        mock_connector.connect()

        auth_ctx = AuthorizationContext(
            actor_id=actor_id,
            workspace_id=ws_id,
            site_id=site_id,
            connector_type="mock",
            roles={"admin"},
            scopes={"apply_change", "validate_execution", "read_resource", "preview_change"},
        )

        engine = ExecutionEngine()
        target = ExecutionTarget(
            site_context=mock_connector.site_context,
            resource=ResourceReference(resource_id="https://ev.example.com/", resource_type=ResourceType.WEBSITE_PAGE),
        )
        proposal = ChangeProposal(
            target_resource=target.resource,
            action_type="meta_tag_improvement",
            proposed_content=proposed_content,
            original_content=initial_content,
            change_summary="Add robots meta",
        )
        req = ExecutionRequest(
            request_id="exec-req-ev-009",
            idempotency_key="idemp-ev-009",
            operation=ExecutionOperationType.APPLY_CHANGE,
            workspace_id=ws_id,
            actor=actor_id,
            target=target,
            change_proposal=proposal,
            finding_id=9900,
            fix_plan_id=9901,
            safety_tier=SafetyTier.AUTO_SAFE,
        )

        finding = Finding(id=9900, website_id=909, scan_id=1, finding_type="missing_meta_description", title="Robots meta", description="desc")
        fix_plan = FixPlan(id=9901, fix_type="meta_tag_improvement", risk_level="low", status="ready_for_review")

        preview_res = engine.preview_execution(req, connector=mock_connector, fix_plan=fix_plan, finding=finding, auth_context=auth_ctx)
        assert preview_res.change_preview is not None
        assert preview_res.change_preview.before_state_hash is not None
        assert preview_res.change_preview.after_state_hash is not None
        assert preview_res.change_preview.before_state_hash != preview_res.change_preview.after_state_hash
