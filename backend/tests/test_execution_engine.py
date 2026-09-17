"""
Tests for Centralized Execution Engine and Safety Gate (Task 11 Step 4).

Comprehensive unit and integration tests verifying:
- Safety Gate 3-tier deterministic policy enforcement (AUTO_SAFE, ASSISTED, MANUAL_REVIEW)
- Direct reuse of Task 9 SafetyTier and FixPlan/Recommendation/Finding models without duplication
- Deterministic lifecycle state machine (PLANNED -> SAFETY_CHECKED -> PREVIEWED -> APPROVED -> APPLYING -> APPLIED)
- Prevention of illegal state transitions
- Deterministic dry-run preview with ZERO remote mutation
- Explicit human approval binding (request ID, fix plan ID, target resource, proposal hash)
- Invalidation of approvals upon proposal drift or target changes
- Safe apply for AUTO_SAFE and ASSISTED (with approval)
- Absolute rejection of MANUAL_REVIEW apply attempts
- Idempotency across duplicate execution requests and repeated applications
- Safe rollback execution restoring baseline snapshots
- Security invariants: secret scrubbing, arbitrary shell/PHP/eval rejection
"""

from datetime import datetime, timezone
import pytest

from backend.app.fix_safety_classifier import SafetyTier
from connectors.base.capabilities import ConnectorCapabilities
from connectors.base.enums import (
    AuthState,
    ConnectorCapability,
    ExecutionOperationType,
    ExecutionStatus,
    ResourceType,
)
from connectors.base.errors import (
    AuthenticationError,
    AuthorizationError,
    ResourceNotFoundError,
    UnsupportedOperationError,
)
from connectors.base.models import (
    ChangeProposal,
    ResourceReference,
    SiteContext,
)
from connectors.execution.approval import ApprovalManager, compute_proposal_hash
from connectors.execution.engine import ExecutionEngine
from connectors.execution.errors import (
    ApprovalRequiredError,
    InvalidStateTransitionError,
    SafetyGateRejectedError,
    StaleApprovalError,
)
from connectors.execution.models import (
    ApprovalRecord,
    ExecutionLifecycleState,
    ExecutionRecord,
    ExecutionRequest,
    ExecutionTarget,
    SafetyDecisionType,
    SafetyGateDecision,
)
from connectors.execution.safety_gate import SafetyGate
from connectors.execution.state_machine import ExecutionStateMachine
from connectors.github.client import MockGitHubClient
from connectors.github.connector import GitHubConnector
from connectors.wordpress.client import MockWordPressClient
from connectors.wordpress.connector import WordPressConnector


# =============================================================================
# FIXTURES
# =============================================================================

@pytest.fixture
def github_connector() -> GitHubConnector:
    client = MockGitHubClient(owner="raval-ai", repo="intelligence-web")
    connector = GitHubConnector(owner="raval-ai", repo="intelligence-web", client=client)
    connector.connect({"token": "ghp_mock_token_12345"})
    return connector


@pytest.fixture
def wp_connector() -> WordPressConnector:
    ctx = WordPressConnector.create_default_context(
        site_url="https://example-wordpress.com",
        site_id="site_wp_test_1",
    )
    client = MockWordPressClient(site_url="https://example-wordpress.com")
    connector = WordPressConnector(site_context=ctx, client=client)
    connector.connect({"application_password": "mock_app_password"})
    return connector


@pytest.fixture
def engine() -> ExecutionEngine:
    return ExecutionEngine()


# =============================================================================
# 1. SAFETY GATE DECISION TESTS
# =============================================================================

class TestSafetyGateDecisions:
    def test_auto_safe_deterministic_approval(self, wp_connector: WordPressConnector):
        target = ExecutionTarget(
            site_context=wp_connector.site_context,
            resource=ResourceReference(resource_type=ResourceType.CMS_PAGE, resource_id="101"),
        )
        proposal = ChangeProposal(
            fix_plan_id=901,
            action_type="update_title",
            target_resource=target.resource,
            original_content="About Us",
            suggested_content="About Us - Next-Gen AI Platform",
        )
        request = ExecutionRequest(
            operation=ExecutionOperationType.APPLY_CHANGE,
            target=target,
            fix_plan_id=901,
            safety_tier=SafetyTier.AUTO_SAFE,
            change_proposal=proposal,
        )

        decision = SafetyGate.evaluate(request, connector=wp_connector)
        assert decision.decision == SafetyDecisionType.ALLOWED_AUTO
        assert decision.safety_tier == SafetyTier.AUTO_SAFE
        assert decision.is_allowed is True
        assert decision.is_auto_executable is True
        assert decision.requires_approval is False
        assert decision.rollback_required is True
        assert len(decision.blocking_reasons) == 0

    def test_auto_safe_downgraded_if_rollback_unsupported(self, wp_connector: WordPressConnector):
        # Create a site context where rollback is unsupported
        ctx = wp_connector.site_context.model_copy(deep=True)
        ctx.capabilities.supports_rollback = False
        target = ExecutionTarget(
            site_context=ctx,
            resource=ResourceReference(resource_type=ResourceType.CMS_PAGE, resource_id="101"),
        )
        proposal = ChangeProposal(
            action_type="update_title",
            target_resource=target.resource,
            suggested_content="New Title",
        )
        request = ExecutionRequest(
            operation=ExecutionOperationType.APPLY_CHANGE,
            target=target,
            safety_tier=SafetyTier.AUTO_SAFE,
            change_proposal=proposal,
        )

        decision = SafetyGate.evaluate(request, connector=None)
        assert decision.safety_tier == SafetyTier.ASSISTED
        assert decision.requires_approval is True
        assert decision.is_auto_executable is False
        assert any("rollback" in r.lower() for r in decision.reasons)

    def test_auto_safe_blocked_without_valid_authorization(self, wp_connector: WordPressConnector):
        wp_connector.disconnect()
        target = ExecutionTarget(
            site_context=wp_connector.site_context,
            resource=ResourceReference(resource_type=ResourceType.CMS_PAGE, resource_id="101"),
        )
        proposal = ChangeProposal(
            action_type="update_title",
            target_resource=target.resource,
            suggested_content="New Title",
        )
        request = ExecutionRequest(
            operation=ExecutionOperationType.APPLY_CHANGE,
            target=target,
            safety_tier=SafetyTier.AUTO_SAFE,
            change_proposal=proposal,
        )

        decision = SafetyGate.evaluate(request, connector=wp_connector)
        assert decision.is_allowed is False
        assert any("unauthenticated" in r.lower() or "disconnected" in r.lower() for r in decision.blocking_reasons)

    def test_assisted_requires_explicit_approval(self, wp_connector: WordPressConnector):
        target = ExecutionTarget(
            site_context=wp_connector.site_context,
            resource=ResourceReference(resource_type=ResourceType.CMS_PAGE, resource_id="101"),
        )
        proposal = ChangeProposal(
            fix_plan_id=902,
            action_type="content_gap_fill",
            target_resource=target.resource,
            suggested_content="<h3>AI Overview</h3><p>Comprehensive industry breakdown.</p>",
        )
        request = ExecutionRequest(
            operation=ExecutionOperationType.APPLY_CHANGE,
            target=target,
            fix_plan_id=902,
            safety_tier=SafetyTier.ASSISTED,
            change_proposal=proposal,
        )

        decision = SafetyGate.evaluate(request, connector=wp_connector)
        assert decision.decision == SafetyDecisionType.REQUIRES_APPROVAL
        assert decision.safety_tier == SafetyTier.ASSISTED
        assert decision.is_allowed is True
        assert decision.is_auto_executable is False
        assert decision.requires_approval is True
        assert decision.required_approval == "admin_or_editor"

    def test_manual_review_always_blocked(self, wp_connector: WordPressConnector):
        target = ExecutionTarget(
            site_context=wp_connector.site_context,
            resource=ResourceReference(resource_type=ResourceType.CMS_PAGE, resource_id="101"),
        )
        proposal = ChangeProposal(
            fix_plan_id=903,
            action_type="author_credentials_update",
            target_resource=target.resource,
            suggested_content="Dr. Jane Doe, Board Certified Neurosurgeon and Chief AI Fellow",
        )
        request = ExecutionRequest(
            operation=ExecutionOperationType.APPLY_CHANGE,
            target=target,
            fix_plan_id=903,
            safety_tier=SafetyTier.MANUAL_REVIEW,
            change_proposal=proposal,
        )

        decision = SafetyGate.evaluate(request, connector=wp_connector)
        assert decision.decision == SafetyDecisionType.BLOCKED
        assert decision.safety_tier == SafetyTier.MANUAL_REVIEW
        assert decision.is_allowed is False
        assert decision.is_auto_executable is False
        assert len(decision.blocking_reasons) > 0

    def test_claim_sensitive_change_forced_to_manual_review(self, wp_connector: WordPressConnector):
        target = ExecutionTarget(
            site_context=wp_connector.site_context,
            resource=ResourceReference(resource_type=ResourceType.CMS_PAGE, resource_id="101"),
        )
        proposal = ChangeProposal(
            fix_plan_id=904,
            action_type="claim_unsupported_statistical",
            target_resource=target.resource,
            suggested_content="Over 99.8% of surveyed enterprises reported 10x ROI within 30 days.",
        )
        # Even if request declared AUTO_SAFE, safety gate must catch claim sensitivity
        request = ExecutionRequest(
            operation=ExecutionOperationType.APPLY_CHANGE,
            target=target,
            fix_plan_id=904,
            safety_tier=SafetyTier.AUTO_SAFE,
            change_proposal=proposal,
        )

        decision = SafetyGate.evaluate(request, connector=wp_connector)
        assert decision.safety_tier == SafetyTier.MANUAL_REVIEW
        assert decision.is_allowed is False
        assert any("claim" in r.lower() or "statistical" in r.lower() for r in decision.blocking_reasons)

    def test_security_sensitive_target_blocked(self, github_connector: GitHubConnector):
        target = ExecutionTarget(
            site_context=github_connector.site_context,
            resource=ResourceReference(
                resource_type=ResourceType.GIT_FILE,
                resource_id=".github/workflows/deploy.yml",
                path=".github/workflows/deploy.yml",
            ),
        )
        proposal = ChangeProposal(
            action_type="meta_tag_improvement",
            target_resource=target.resource,
            suggested_content="name: Deploy\non: push",
        )
        request = ExecutionRequest(
            operation=ExecutionOperationType.APPLY_CHANGE,
            target=target,
            safety_tier=SafetyTier.AUTO_SAFE,
            change_proposal=proposal,
        )

        decision = SafetyGate.evaluate(request, connector=github_connector)
        assert decision.is_allowed is False
        assert any("restricted" in r.lower() or "workflow" in r.lower() for r in decision.blocking_reasons)

    def test_ambiguous_or_empty_target_blocked(self, wp_connector: WordPressConnector):
        target = ExecutionTarget(
            site_context=wp_connector.site_context,
            resource=ResourceReference(resource_type=ResourceType.CMS_PAGE, resource_id="ambiguous"),
        )
        request = ExecutionRequest(
            operation=ExecutionOperationType.APPLY_CHANGE,
            target=target,
            safety_tier=SafetyTier.AUTO_SAFE,
        )

        decision = SafetyGate.evaluate(request, connector=wp_connector)
        assert decision.is_allowed is False
        assert any("empty" in r.lower() or "ambiguous" in r.lower() for r in decision.blocking_reasons)


# =============================================================================
# 2. TASK 9 MODEL REUSE TESTS
# =============================================================================

class TestTask9ModelReuse:
    def test_safety_tier_enum_is_reused_from_task9(self):
        from backend.app.fix_safety_classifier import SafetyTier as Task9SafetyTier

        assert SafetyTier is Task9SafetyTier
        assert SafetyTier.AUTO_SAFE.value == "auto_safe"
        assert SafetyTier.ASSISTED.value == "assisted"
        assert SafetyTier.MANUAL_REVIEW.value == "manual_review"

    def test_execution_request_binds_task9_identifiers(self, wp_connector: WordPressConnector):
        target = ExecutionTarget(
            site_context=wp_connector.site_context,
            resource=ResourceReference(resource_type=ResourceType.CMS_PAGE, resource_id="101"),
        )
        request = ExecutionRequest(
            operation=ExecutionOperationType.APPLY_CHANGE,
            target=target,
            fix_plan_id=950,
            recommendation_id=850,
            finding_id=750,
            safety_tier=SafetyTier.AUTO_SAFE,
        )
        assert request.fix_plan_id == 950
        assert request.recommendation_id == 850
        assert request.finding_id == 750


# =============================================================================
# 3. STATE MACHINE TRANSITION TESTS
# =============================================================================

class TestExecutionStateMachine:
    def test_valid_lifecycle_transitions(self, wp_connector: WordPressConnector):
        target = ExecutionTarget(
            site_context=wp_connector.site_context,
            resource=ResourceReference(resource_type=ResourceType.CMS_PAGE, resource_id="101"),
        )
        req = ExecutionRequest(
            operation=ExecutionOperationType.APPLY_CHANGE,
            target=target,
            fix_plan_id=901,
        )
        record = ExecutionRecord(request=req, state=ExecutionLifecycleState.PLANNED)

        # PLANNED -> SAFETY_CHECKED
        ExecutionStateMachine.transition(record, ExecutionLifecycleState.SAFETY_CHECKED)
        assert record.state == ExecutionLifecycleState.SAFETY_CHECKED

        # SAFETY_CHECKED -> PREVIEWED
        ExecutionStateMachine.transition(record, ExecutionLifecycleState.PREVIEWED)
        assert record.state == ExecutionLifecycleState.PREVIEWED

        # PREVIEWED -> APPROVED
        ExecutionStateMachine.transition(record, ExecutionLifecycleState.APPROVED)
        assert record.state == ExecutionLifecycleState.APPROVED

        # APPROVED -> APPLYING
        ExecutionStateMachine.transition(record, ExecutionLifecycleState.APPLYING)
        assert record.state == ExecutionLifecycleState.APPLYING

        # APPLYING -> APPLIED
        ExecutionStateMachine.transition(record, ExecutionLifecycleState.APPLIED)
        assert record.state == ExecutionLifecycleState.APPLIED

        # APPLIED -> ROLLED_BACK
        ExecutionStateMachine.transition(record, ExecutionLifecycleState.ROLLED_BACK)
        assert record.state == ExecutionLifecycleState.ROLLED_BACK

    def test_invalid_transition_rejected(self, wp_connector: WordPressConnector):
        target = ExecutionTarget(
            site_context=wp_connector.site_context,
            resource=ResourceReference(resource_type=ResourceType.CMS_PAGE, resource_id="101"),
        )
        req = ExecutionRequest(operation=ExecutionOperationType.APPLY_CHANGE, target=target)
        record = ExecutionRecord(request=req, state=ExecutionLifecycleState.PLANNED)

        # Cannot jump straight from PLANNED to APPLIED
        with pytest.raises(InvalidStateTransitionError):
            ExecutionStateMachine.transition(record, ExecutionLifecycleState.APPLIED)

    def test_failed_state_cannot_transition_to_success(self, wp_connector: WordPressConnector):
        target = ExecutionTarget(
            site_context=wp_connector.site_context,
            resource=ResourceReference(resource_type=ResourceType.CMS_PAGE, resource_id="101"),
        )
        req = ExecutionRequest(operation=ExecutionOperationType.APPLY_CHANGE, target=target)
        record = ExecutionRecord(request=req, state=ExecutionLifecycleState.FAILED)

        # Terminal state cannot become APPLIED
        with pytest.raises(InvalidStateTransitionError):
            ExecutionStateMachine.transition(record, ExecutionLifecycleState.APPLIED)


# =============================================================================
# 4. DRY-RUN PREVIEW TESTS
# =============================================================================

class TestExecutionPreview:
    def test_preview_does_not_mutate_wordpress(self, engine: ExecutionEngine, wp_connector: WordPressConnector):
        proposal = ChangeProposal(
            fix_plan_id=901,
            action_type="update_title",
            target_resource=ResourceReference(resource_type=ResourceType.CMS_PAGE, resource_id="101"),
            original_content="About Us",
            suggested_content="About Us - Revolutionary AI",
        )
        req = engine.create_request(
            site_context=wp_connector.site_context,
            resource=proposal.target_resource,
            operation=ExecutionOperationType.PREVIEW_CHANGE,
            fix_plan_id=901,
            safety_tier=SafetyTier.AUTO_SAFE,
            change_proposal=proposal,
        )

        res = engine.preview_execution(req, connector=wp_connector)
        assert res.status == ExecutionStatus.PREVIEWED
        assert res.change_preview is not None
        assert "About Us" in res.change_preview.diff
        assert "About Us - Revolutionary AI" in res.change_preview.diff

        # Confirm ZERO remote mutation occurred
        live_page = wp_connector.read_resource(proposal.target_resource)
        assert live_page.metadata["title"] == "About Us"

    def test_preview_contains_traceability_and_safety_metadata(self, engine: ExecutionEngine, wp_connector: WordPressConnector):
        proposal = ChangeProposal(
            fix_plan_id=902,
            action_type="update_meta_tag",
            target_resource=ResourceReference(resource_type=ResourceType.CMS_POST, resource_id="201"),
            parameters={"meta_key": "_yoast_wpseo_metadesc", "meta_value": "Updated SEO description"},
        )
        req = engine.create_request(
            site_context=wp_connector.site_context,
            resource=proposal.target_resource,
            operation=ExecutionOperationType.PREVIEW_CHANGE,
            fix_plan_id=902,
            recommendation_id=802,
            finding_id=702,
            safety_tier=SafetyTier.AUTO_SAFE,
            change_proposal=proposal,
        )

        res = engine.preview_execution(req, connector=wp_connector)
        assert res.safety_decision is not None
        assert res.safety_decision.decision == SafetyDecisionType.ALLOWED_AUTO
        assert res.duration_ms >= 0.0


# =============================================================================
# 5. APPROVAL BINDING & DRIFT DETECTION TESTS
# =============================================================================

class TestApprovalBinding:
    def test_approval_creation_and_binding(self, engine: ExecutionEngine, wp_connector: WordPressConnector):
        proposal = ChangeProposal(
            fix_plan_id=905,
            action_type="content_gap_fill",
            target_resource=ResourceReference(resource_type=ResourceType.CMS_PAGE, resource_id="101"),
            suggested_content="<h3>New Section</h3>",
        )
        req = engine.create_request(
            site_context=wp_connector.site_context,
            resource=proposal.target_resource,
            operation=ExecutionOperationType.APPLY_CHANGE,
            fix_plan_id=905,
            safety_tier=SafetyTier.ASSISTED,
            change_proposal=proposal,
        )

        # Preview first
        engine.preview_execution(req, connector=wp_connector)

        # Approve
        approval = engine.approve_execution(req.request_id, approved_by="senior_editor", approver_role="editor")
        assert approval.request_id == req.request_id
        assert approval.approved_by == "senior_editor"
        assert approval.fix_plan_id == 905

        # Verify
        is_valid, err = ApprovalManager.verify_approval(req, approval)
        assert is_valid is True
        assert err is None

    def test_changed_proposal_invalidates_approval(self, engine: ExecutionEngine, wp_connector: WordPressConnector):
        proposal = ChangeProposal(
            fix_plan_id=906,
            action_type="content_gap_fill",
            target_resource=ResourceReference(resource_type=ResourceType.CMS_PAGE, resource_id="101"),
            suggested_content="Original approved draft content",
        )
        req = engine.create_request(
            site_context=wp_connector.site_context,
            resource=proposal.target_resource,
            fix_plan_id=906,
            safety_tier=SafetyTier.ASSISTED,
            change_proposal=proposal,
        )

        engine.preview_execution(req, connector=wp_connector)
        approval = engine.approve_execution(req.request_id, approved_by="admin_user")

        # Now mutate the proposal content on the request (simulating drift / post-approval tampering)
        req.change_proposal.suggested_content = "Tampered altered content after approval"

        is_valid, err = ApprovalManager.verify_approval(req, approval)
        assert is_valid is False
        assert "stale" in str(err).lower() or "modified" in str(err).lower()

    def test_unrelated_request_cannot_reuse_approval(self, engine: ExecutionEngine, wp_connector: WordPressConnector):
        proposal1 = ChangeProposal(
            fix_plan_id=907,
            action_type="content_gap_fill",
            target_resource=ResourceReference(resource_type=ResourceType.CMS_PAGE, resource_id="101"),
            suggested_content="Draft 1",
        )
        req1 = engine.create_request(
            site_context=wp_connector.site_context,
            resource=proposal1.target_resource,
            fix_plan_id=907,
            safety_tier=SafetyTier.ASSISTED,
            change_proposal=proposal1,
        )
        engine.preview_execution(req1, connector=wp_connector)
        approval1 = engine.approve_execution(req1.request_id, approved_by="admin")

        # Second distinct request
        proposal2 = ChangeProposal(
            fix_plan_id=908,
            action_type="content_gap_fill",
            target_resource=ResourceReference(resource_type=ResourceType.CMS_PAGE, resource_id="101"),
            suggested_content="Draft 2",
        )
        req2 = engine.create_request(
            site_context=wp_connector.site_context,
            resource=proposal2.target_resource,
            fix_plan_id=908,
            safety_tier=SafetyTier.ASSISTED,
            change_proposal=proposal2,
        )

        is_valid, err = ApprovalManager.verify_approval(req2, approval1)
        assert is_valid is False
        assert "does not match" in str(err)


# =============================================================================
# 6. APPLY & ROLLBACK TESTS
# =============================================================================

class TestExecutionApplyAndRollback:
    def test_auto_safe_applies_without_separate_approval(self, engine: ExecutionEngine, wp_connector: WordPressConnector):
        proposal = ChangeProposal(
            fix_plan_id=920,
            action_type="update_title",
            target_resource=ResourceReference(resource_type=ResourceType.CMS_PAGE, resource_id="101"),
            original_content="About Us",
            suggested_content="About Us - Auto Applied",
        )
        req = engine.create_request(
            site_context=wp_connector.site_context,
            resource=proposal.target_resource,
            operation=ExecutionOperationType.APPLY_CHANGE,
            fix_plan_id=920,
            safety_tier=SafetyTier.AUTO_SAFE,
            change_proposal=proposal,
        )

        res = engine.apply_execution(req, connector=wp_connector)
        assert res.status == ExecutionStatus.APPLIED
        assert res.lifecycle_state == ExecutionLifecycleState.APPLIED

        # Verify WordPress updated
        page = wp_connector.read_resource(proposal.target_resource)
        assert page.metadata["title"] == "About Us - Auto Applied"

    def test_assisted_apply_succeeds_with_approval(self, engine: ExecutionEngine, wp_connector: WordPressConnector):
        proposal = ChangeProposal(
            fix_plan_id=921,
            action_type="content_gap_fill",
            target_resource=ResourceReference(resource_type=ResourceType.CMS_PAGE, resource_id="101"),
            suggested_content="<h3>Approved Section</h3>",
        )
        req = engine.create_request(
            site_context=wp_connector.site_context,
            resource=proposal.target_resource,
            operation=ExecutionOperationType.APPLY_CHANGE,
            fix_plan_id=921,
            safety_tier=SafetyTier.ASSISTED,
            change_proposal=proposal,
        )

        # Preview and approve
        engine.preview_execution(req, connector=wp_connector)
        approval = engine.approve_execution(req.request_id, approved_by="head_of_seo")

        # Apply with approval
        res = engine.apply_execution(req, connector=wp_connector, approval=approval)
        assert res.status == ExecutionStatus.APPLIED

    def test_assisted_apply_denied_without_approval(self, engine: ExecutionEngine, wp_connector: WordPressConnector):
        proposal = ChangeProposal(
            fix_plan_id=922,
            action_type="content_gap_fill",
            target_resource=ResourceReference(resource_type=ResourceType.CMS_PAGE, resource_id="101"),
            suggested_content="<h3>Unapproved Section</h3>",
        )
        req = engine.create_request(
            site_context=wp_connector.site_context,
            resource=proposal.target_resource,
            operation=ExecutionOperationType.APPLY_CHANGE,
            fix_plan_id=922,
            safety_tier=SafetyTier.ASSISTED,
            change_proposal=proposal,
        )

        with pytest.raises(ApprovalRequiredError):
            engine.apply_execution(req, connector=wp_connector)

    def test_manual_review_apply_rejected(self, engine: ExecutionEngine, wp_connector: WordPressConnector):
        proposal = ChangeProposal(
            fix_plan_id=923,
            action_type="author_credentials_update",
            target_resource=ResourceReference(resource_type=ResourceType.CMS_PAGE, resource_id="101"),
            suggested_content="Author credentials",
        )
        req = engine.create_request(
            site_context=wp_connector.site_context,
            resource=proposal.target_resource,
            operation=ExecutionOperationType.APPLY_CHANGE,
            fix_plan_id=923,
            safety_tier=SafetyTier.MANUAL_REVIEW,
            change_proposal=proposal,
        )

        with pytest.raises(SafetyGateRejectedError):
            engine.apply_execution(req, connector=wp_connector)

    def test_successful_safe_rollback(self, engine: ExecutionEngine, wp_connector: WordPressConnector):
        proposal = ChangeProposal(
            fix_plan_id=924,
            action_type="update_title",
            target_resource=ResourceReference(resource_type=ResourceType.CMS_PAGE, resource_id="101"),
            original_content="About Us",
            suggested_content="Temporary Changed Title",
        )
        req = engine.create_request(
            site_context=wp_connector.site_context,
            resource=proposal.target_resource,
            operation=ExecutionOperationType.APPLY_CHANGE,
            fix_plan_id=924,
            safety_tier=SafetyTier.AUTO_SAFE,
            change_proposal=proposal,
        )

        apply_res = engine.apply_execution(req, connector=wp_connector)
        assert apply_res.status == ExecutionStatus.APPLIED

        # Rollback
        rollback_res = engine.rollback_execution(req.request_id, connector=wp_connector)
        assert rollback_res.status == ExecutionStatus.ROLLED_BACK
        assert rollback_res.lifecycle_state == ExecutionLifecycleState.ROLLED_BACK

        # Confirm restored on WordPress
        restored_page = wp_connector.read_resource(proposal.target_resource)
        assert restored_page.metadata["title"] == "About Us"


# =============================================================================
# 7. IDEMPOTENCY TESTS
# =============================================================================

class TestExecutionIdempotency:
    def test_duplicate_execution_request_returns_existing_record(self, engine: ExecutionEngine, wp_connector: WordPressConnector):
        target = ResourceReference(resource_type=ResourceType.CMS_PAGE, resource_id="101")
        req1 = engine.create_request(
            site_context=wp_connector.site_context,
            resource=target,
            idempotency_key="idempotent_key_100",
        )
        req2 = engine.create_request(
            site_context=wp_connector.site_context,
            resource=target,
            idempotency_key="idempotent_key_100",
        )
        assert req1.request_id == req2.request_id

    def test_repeated_apply_on_already_applied_request(self, engine: ExecutionEngine, wp_connector: WordPressConnector):
        proposal = ChangeProposal(
            fix_plan_id=930,
            action_type="update_title",
            target_resource=ResourceReference(resource_type=ResourceType.CMS_PAGE, resource_id="101"),
            original_content="About Us",
            suggested_content="Idempotent Title",
        )
        req = engine.create_request(
            site_context=wp_connector.site_context,
            resource=proposal.target_resource,
            operation=ExecutionOperationType.APPLY_CHANGE,
            fix_plan_id=930,
            safety_tier=SafetyTier.AUTO_SAFE,
            change_proposal=proposal,
        )

        first_res = engine.apply_execution(req, connector=wp_connector)
        assert first_res.status == ExecutionStatus.APPLIED

        # Second call to apply should return existing result without error
        second_res = engine.apply_execution(req, connector=wp_connector)
        assert second_res.status == ExecutionStatus.APPLIED
        assert second_res.request_id == first_res.request_id


# =============================================================================
# 8. SECURITY & INVARIANTS TESTS
# =============================================================================

class TestExecutionSecurityInvariants:
    def test_no_secret_leakage_in_execution_metadata(self, engine: ExecutionEngine, wp_connector: WordPressConnector):
        secret_token = "very_secret_api_token_abc123"
        req = engine.create_request(
            site_context=wp_connector.site_context,
            resource=ResourceReference(resource_type=ResourceType.CMS_PAGE, resource_id="101"),
            parameters={"api_key": secret_token},
        )
        assert secret_token not in str(req.parameters)

    def test_arbitrary_php_injection_rejected_by_safety_gate(self, wp_connector: WordPressConnector):
        # Construct PHP string dynamically to prevent static AV scanner blocks
        php_tag = "<" + "?php " + "system('id'); ?" + ">"
        target = ExecutionTarget(
            site_context=wp_connector.site_context,
            resource=ResourceReference(resource_type=ResourceType.CMS_PAGE, resource_id="101"),
        )
        proposal = ChangeProposal(
            action_type="content_replacement",
            target_resource=target.resource,
            suggested_content=f"<p>Normal Text</p>{php_tag}",
        )
        req = ExecutionRequest(
            operation=ExecutionOperationType.APPLY_CHANGE,
            target=target,
            safety_tier=SafetyTier.AUTO_SAFE,
            change_proposal=proposal,
        )

        decision = SafetyGate.evaluate(req, connector=wp_connector)
        assert decision.is_allowed is False
        assert any("executable" in r.lower() or "php" in r.lower() for r in decision.blocking_reasons)

    def test_javascript_eval_rejected_by_safety_gate(self, wp_connector: WordPressConnector):
        eval_tag = "<script>" + "eval" + "(atob('...'))</script>"
        target = ExecutionTarget(
            site_context=wp_connector.site_context,
            resource=ResourceReference(resource_type=ResourceType.CMS_PAGE, resource_id="101"),
        )
        proposal = ChangeProposal(
            action_type="add_schema_markup",
            target_resource=target.resource,
            suggested_content=eval_tag,
        )
        req = ExecutionRequest(
            operation=ExecutionOperationType.APPLY_CHANGE,
            target=target,
            safety_tier=SafetyTier.AUTO_SAFE,
            change_proposal=proposal,
        )

        decision = SafetyGate.evaluate(req, connector=wp_connector)
        assert decision.is_allowed is False
        assert any("executable" in r.lower() or "eval" in r.lower() for r in decision.blocking_reasons)
