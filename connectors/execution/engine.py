"""
Centralized Execution Engine and Safety Orchestrator (Task 11 Step 4, 5 & 6).

Coordinates the end-to-end safe execution workflow:
ExecutionRequest -> Authorization -> Safety Gate -> Preview -> Approval -> Apply -> Validate -> Rescan -> Rollback

Guarantees:
- Enforces strict multi-tenant workspace isolation and authorization contexts
- Enforces 3-tier Safety Gate policy checks before any mutation
- Mandates explicit approval for ASSISTED fix plans
- Scoped rate limiting and granular resource-level locking to prevent concurrency conflicts
- Immutable append-only audit event logging with SHA-256 hash chaining
- Dispatches mutations strictly through provider-neutral BaseConnector instances
- Maintains deterministic state machine and idempotency guarantees
- Completely sanitizes and redacts credentials across all execution telemetry
"""

from __future__ import annotations

import logging
import time
from datetime import datetime, timezone
from typing import Any

from backend.app.fix_safety_classifier import SafetyTier
from connectors.audit.logger import AuditEventLedger, AuditLogger
from connectors.audit.models import AuditActionType, AuditEvent
from connectors.base.enums import (
    ConnectorCapability,
    ConnectorErrorCode,
    ExecutionOperationType,
    ExecutionStatus,
)
from connectors.base.errors import (
    AuthenticationError,
    AuthorizationError,
    ConnectorErrorInfo,
    ResourceNotFoundError,
    UnsupportedOperationError,
)
from connectors.base.interface import BaseConnector
from connectors.base.models import (
    ChangePreview,
    ChangeProposal,
    ChangeResult,
    OperationId,
    ResourceReference,
    SiteContext,
)
from connectors.base.security import sanitize_payload
from connectors.execution.approval import ApprovalManager
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
    ExecutionResult,
    ExecutionTarget,
    RollbackVerificationResult,
    SafetyDecisionType,
    SafetyGateDecision,
    TargetedRescanResult,
    ValidationOutcome,
    ValidationReport,
)
from connectors.execution.rescan import TargetedRescanner
from connectors.execution.rollback import RollbackManager
from connectors.execution.safety_gate import SafetyGate
from connectors.execution.state_machine import ExecutionStateMachine
from connectors.execution.validation import ValidationEngine
from connectors.reliability.lock import ResourceLockManager
from connectors.reliability.rate_limiter import ConnectorRateLimiter
from connectors.security.authz import AuthorizationContext, AuthorizationManager
from connectors.security.boundaries import SecurityBoundaryValidator
from connectors.security.scrubber import DeepScrubber

logger = logging.getLogger(__name__)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


class ExecutionEngine:
    """
    Centralized execution coordination engine for Raval AI remediation plans.
    Hardened with multi-tenant authorization, audit logging, rate limiting, and concurrency locks.
    """

    def __init__(
        self,
        audit_ledger: AuditEventLedger | None = None,
        rate_limiter: ConnectorRateLimiter | None = None,
        lock_manager: ResourceLockManager | None = None,
    ) -> None:
        self._records: dict[str, ExecutionRecord] = {}
        self._idempotency_map: dict[str, str] = {}  # idempotency_key -> request_id
        self._auth_contexts: dict[str, AuthorizationContext] = {}
        self.audit_ledger = audit_ledger or AuditEventLedger()
        self.rate_limiter = rate_limiter or ConnectorRateLimiter()
        self.lock_manager = lock_manager or ResourceLockManager()

    # =========================================================================
    # 1. Request Creation & Registration
    # =========================================================================

    def create_request(
        self,
        site_context: SiteContext,
        resource: ResourceReference,
        operation: ExecutionOperationType = ExecutionOperationType.PREVIEW_CHANGE,
        fix_plan_id: int | None = None,
        recommendation_id: int | None = None,
        finding_id: int | None = None,
        safety_tier: SafetyTier | str = SafetyTier.AUTO_SAFE,
        change_proposal: ChangeProposal | None = None,
        actor: str = "system",
        idempotency_key: str | None = None,
        parameters: dict[str, Any] | None = None,
        auth_context: AuthorizationContext | None = None,
        workspace_id: str | None = None,
    ) -> ExecutionRequest:
        """
        Constructs and registers a new ExecutionRequest in the PLANNED lifecycle state.
        Validates authorization context and records an initial audit event.
        """
        target_ws_id = workspace_id or str(site_context.workspace_id or "default_workspace")
        ws_id = auth_context.workspace_id if auth_context else target_ws_id
        
        # Enforce authorization if context provided
        if auth_context is not None:
            AuthorizationManager.enforce(
                context=auth_context,
                target_workspace_id=target_ws_id,
                target_site_id=str(site_context.site_id),
                connector_type=site_context.provider,
                resource_id=str(resource.resource_id),
                operation=operation,
            )

        target = ExecutionTarget(site_context=site_context, resource=resource)
        kwargs: dict[str, Any] = {
            "operation": operation,
            "target": target,
            "workspace_id": ws_id,
            "fix_plan_id": fix_plan_id,
            "recommendation_id": recommendation_id,
            "finding_id": finding_id,
            "safety_tier": safety_tier,
            "change_proposal": change_proposal,
            "actor": actor,
            "parameters": parameters or {},
        }
        if idempotency_key:
            kwargs["idempotency_key"] = idempotency_key

        req = ExecutionRequest(**kwargs)
        
        # Check idempotency
        if req.idempotency_key in self._idempotency_map:
            existing_id = self._idempotency_map[req.idempotency_key]
            return self._records[existing_id].request

        record = ExecutionRecord(
            request=req,
            state=ExecutionLifecycleState.PLANNED,
            history=[(ExecutionLifecycleState.PLANNED, _utc_now())],
        )
        self._records[req.request_id] = record
        self._idempotency_map[req.idempotency_key] = req.request_id
        if auth_context:
            self._auth_contexts[req.request_id] = auth_context

        # Record Audit Event
        AuditLogger.record(
            workspace_id=ws_id,
            site_id=str(site_context.site_id),
            actor_id=actor,
            execution_id=req.request_id,
            action=AuditActionType.REQUEST_CREATED,
            connector=site_context.provider,
            resource_reference=str(resource.resource_id),
            requested_operation=str(operation.value if hasattr(operation, "value") else operation),
            safety_tier=str(safety_tier.value if hasattr(safety_tier, "value") else safety_tier),
            finding_id=finding_id,
            recommendation_id=recommendation_id,
            fix_plan_id=fix_plan_id,
            ledger=self.audit_ledger,
        )

        return req

    # =========================================================================
    # 2. Safety Gate Evaluation
    # =========================================================================

    def check_safety(
        self,
        request: ExecutionRequest,
        connector: BaseConnector | None = None,
        fix_plan: Any | None = None,
        recommendation: Any | None = None,
        finding: Any | None = None,
        auth_context: AuthorizationContext | None = None,
    ) -> SafetyGateDecision:
        """
        Evaluates the request through the deterministic Safety Gate and Security Boundaries.
        """
        active_auth = auth_context or self._auth_contexts.get(request.request_id)
        target_ws_id = str((connector.site_context.workspace_id if connector and connector.site_context else None) or (request.target.site_context.workspace_id if request.target and request.target.site_context else None) or request.workspace_id or "default_workspace")
        site_id = str(request.target.site_context.site_id)
        conn_provider = connector.site_context.provider if connector else request.target.site_context.provider

        if request.workspace_id and request.workspace_id != target_ws_id:
            raise AuthorizationError(
                message=f"Workspace mismatch: request workspace '{request.workspace_id}' cannot access target workspace '{target_ws_id}'",
                details={"workspace_id": request.workspace_id, "site_id": site_id},
            )

        if active_auth is not None:
            AuthorizationManager.enforce(
                context=active_auth,
                target_workspace_id=target_ws_id,
                target_site_id=site_id,
                connector_type=conn_provider,
                resource_id=str(request.target.resource.resource_id),
                operation=request.operation,
            )
        ws_id = target_ws_id

        # Security boundary validation on target resource ID
        SecurityBoundaryValidator.validate_resource_path(str(request.target.resource.resource_id))

        record = self._get_or_create_record(request)
        decision = SafetyGate.evaluate(
            request=request,
            connector=connector,
            fix_plan=fix_plan,
            recommendation=recommendation,
            finding=finding,
        )
        record.safety_decision = decision

        if decision.is_allowed:
            if record.state == ExecutionLifecycleState.PLANNED:
                ExecutionStateMachine.transition(record, ExecutionLifecycleState.SAFETY_CHECKED)
        else:
            if record.state != ExecutionLifecycleState.BLOCKED:
                ExecutionStateMachine.transition(record, ExecutionLifecycleState.BLOCKED, reason="Safety Gate rejected")

        # Record Audit Event
        AuditLogger.record(
            workspace_id=ws_id,
            site_id=site_id,
            actor_id=request.actor,
            execution_id=request.request_id,
            action=AuditActionType.SAFETY_EVALUATED if decision.is_allowed else AuditActionType.EXECUTION_BLOCKED,
            connector=conn_provider,
            resource_reference=str(request.target.resource.resource_id),
            requested_operation=str(request.operation.value if hasattr(request.operation, "value") else request.operation),
            safety_tier=str(decision.safety_tier.value),
            lifecycle_state=record.state.value,
            finding_id=request.finding_id,
            recommendation_id=request.recommendation_id,
            fix_plan_id=request.fix_plan_id,
            details={"decision": decision.decision.value, "blocking_reasons": decision.blocking_reasons},
            ledger=self.audit_ledger,
        )

        return decision

    # =========================================================================
    # 3. Dry-Run Preview
    # =========================================================================

    def preview_execution(
        self,
        request: ExecutionRequest,
        connector: BaseConnector,
        fix_plan: Any | None = None,
        recommendation: Any | None = None,
        finding: Any | None = None,
        auth_context: AuthorizationContext | None = None,
    ) -> ExecutionResult:
        """
        Generates a dry-run preview with deterministic before/after diffs.
        GUARANTEE: Preview performs ZERO remote mutations on the target website.
        """
        start_time = time.monotonic()
        active_auth = auth_context or self._auth_contexts.get(request.request_id)
        target_ws_id = str(connector.site_context.workspace_id or (request.target.site_context.workspace_id if request.target and request.target.site_context else None) or request.workspace_id or "default_workspace")
        site_id = str(connector.site_context.site_id)
        conn_provider = connector.site_context.provider

        if request.workspace_id and request.workspace_id != target_ws_id:
            raise AuthorizationError(
                message=f"Workspace mismatch: request workspace '{request.workspace_id}' cannot access target workspace '{target_ws_id}'",
                details={"workspace_id": request.workspace_id, "site_id": site_id},
            )

        if active_auth is not None:
            AuthorizationManager.enforce(
                context=active_auth,
                target_workspace_id=target_ws_id,
                target_site_id=site_id,
                connector_type=conn_provider,
                resource_id=str(request.target.resource.resource_id),
                operation=ExecutionOperationType.PREVIEW_CHANGE,
            )
        ws_id = target_ws_id

        # Rate limiting check
        scope_key = self.rate_limiter.build_scope_key(ws_id, site_id, conn_provider)
        self.rate_limiter.check_and_record_request(scope_key)

        record = self._get_or_create_record(request)

        # 1. Evaluate Safety Gate
        decision = self.check_safety(
            request,
            connector=connector,
            fix_plan=fix_plan,
            recommendation=recommendation,
            finding=finding,
            auth_context=active_auth,
        )

        if not decision.is_allowed:
            raise SafetyGateRejectedError(
                message=f"Safety Gate rejected preview: {'; '.join(decision.blocking_reasons)}",
                blocking_reasons=decision.blocking_reasons,
                details={"safety_tier": decision.safety_tier.value},
            )

        if not request.change_proposal:
            raise SafetyGateRejectedError(
                message="Cannot preview execution: change_proposal is missing from ExecutionRequest",
                blocking_reasons=["Missing change_proposal"],
            )

        # Validate proposal content safety boundaries
        content_to_check = getattr(request.change_proposal, "proposed_content", None) or getattr(request.change_proposal, "suggested_content", None)
        if isinstance(content_to_check, str):
            SecurityBoundaryValidator.validate_content_payload(content_to_check)

        # 2. Execute Preview via Connector
        try:
            preview_output = connector.preview_change(request.change_proposal)
            record.preview = preview_output
            ExecutionStateMachine.transition(record, ExecutionLifecycleState.PREVIEWED)

            elapsed = (time.monotonic() - start_time) * 1000.0
            res = ExecutionResult(
                request_id=request.request_id,
                status=ExecutionStatus.PREVIEWED,
                lifecycle_state=ExecutionLifecycleState.PREVIEWED,
                operation=ExecutionOperationType.PREVIEW_CHANGE,
                target=request.target,
                safety_decision=decision,
                change_preview=preview_output,
                started_at=_utc_now(),
                completed_at=_utc_now(),
                duration_ms=round(elapsed, 2),
                metadata={
                    "provider": connector.site_context.provider,
                    "diff_length": len(preview_output.diff or ""),
                },
            )
            record.result = res

            # Record Audit Event
            AuditLogger.record(
                workspace_id=ws_id,
                site_id=site_id,
                actor_id=request.actor,
                execution_id=request.request_id,
                action=AuditActionType.PREVIEW_GENERATED,
                connector=conn_provider,
                resource_reference=str(request.target.resource.resource_id),
                requested_operation="preview_change",
                safety_tier=str(decision.safety_tier.value),
                lifecycle_state=ExecutionLifecycleState.PREVIEWED.value,
                before_state_reference=getattr(preview_output, "before_state_hash", None),
                after_state_reference=getattr(preview_output, "after_state_hash", None),
                finding_id=request.finding_id,
                recommendation_id=request.recommendation_id,
                fix_plan_id=request.fix_plan_id,
                details={"diff_length": len(preview_output.diff or "")},
                ledger=self.audit_ledger,
            )

            return res
        except Exception as exc:
            ExecutionStateMachine.transition(record, ExecutionLifecycleState.FAILED, reason=str(exc))
            raise

    # =========================================================================
    # 4. Human Approval
    # =========================================================================

    def approve_execution(
        self,
        request_id: str,
        approved_by: str,
        approver_role: str = "admin",
        comments: str | None = None,
        auth_context: AuthorizationContext | None = None,
    ) -> ApprovalRecord:
        """
        Registers an auditable approval for an ASSISTED execution request.
        """
        if request_id not in self._records:
            raise ResourceNotFoundError(f"Execution request '{request_id}' not found")

        record = self._records[request_id]
        active_auth = auth_context or self._auth_contexts.get(request_id)
        ws_id = record.request.workspace_id or (active_auth.workspace_id if active_auth else "default_workspace")
        site_id = str(record.request.target.site_context.site_id)
        conn_provider = record.request.target.site_context.provider

        if active_auth is not None:
            AuthorizationManager.enforce(
                context=active_auth,
                target_workspace_id=ws_id,
                target_site_id=site_id,
                connector_type=conn_provider,
                resource_id=str(record.request.target.resource.resource_id),
                operation=ExecutionOperationType.APPLY_CHANGE,
            )

        if record.state not in (ExecutionLifecycleState.PREVIEWED, ExecutionLifecycleState.SAFETY_CHECKED):
            raise InvalidStateTransitionError(
                current_state=record.state.value,
                target_state=ExecutionLifecycleState.APPROVED.value,
                message=f"Cannot approve execution in '{record.state.value}' state. Request must be SAFETY_CHECKED or PREVIEWED first.",
            )

        approval = ApprovalManager.create_approval(
            request=record.request,
            approved_by=approved_by,
            approver_role=approver_role,
            comments=comments,
        )
        record.approval = approval
        ExecutionStateMachine.transition(record, ExecutionLifecycleState.APPROVED)

        # Record Audit Event
        AuditLogger.record(
            workspace_id=ws_id,
            site_id=site_id,
            actor_id=approved_by,
            execution_id=request_id,
            action=AuditActionType.APPROVAL_GRANTED,
            connector=conn_provider,
            resource_reference=str(record.request.target.resource.resource_id),
            requested_operation="approve_execution",
            approval_state="approved",
            lifecycle_state=ExecutionLifecycleState.APPROVED.value,
            finding_id=record.request.finding_id,
            recommendation_id=record.request.recommendation_id,
            fix_plan_id=record.request.fix_plan_id,
            details={"approver_role": approver_role, "comments": comments},
            ledger=self.audit_ledger,
        )

        return approval

    # =========================================================================
    # 5. Apply Execution
    # =========================================================================

    def apply_execution(
        self,
        request: ExecutionRequest,
        connector: BaseConnector,
        approval: ApprovalRecord | None = None,
        fix_plan: Any | None = None,
        recommendation: Any | None = None,
        finding: Any | None = None,
        auth_context: AuthorizationContext | None = None,
    ) -> ExecutionResult:
        """
        Applies an approved fix proposal to the target environment.
        Enforces:
        - Workspace isolation & authorization
        - Safety Gate policy compliance
        - Scoped resource lock concurrency protection
        - Explicit approval verification for ASSISTED tier
        - State machine transition integrity & idempotency
        - Audit trail generation
        """
        start_time = time.monotonic()
        active_auth = auth_context or self._auth_contexts.get(request.request_id)
        target_ws_id = str(connector.site_context.workspace_id or (request.target.site_context.workspace_id if request.target and request.target.site_context else None) or request.workspace_id or "default_workspace")
        site_id = str(connector.site_context.site_id)
        conn_provider = connector.site_context.provider
        resource_id = str(request.target.resource.resource_id)

        if request.workspace_id and request.workspace_id != target_ws_id:
            raise AuthorizationError(
                message=f"Workspace mismatch: request workspace '{request.workspace_id}' cannot access target workspace '{target_ws_id}'",
                details={"workspace_id": request.workspace_id, "site_id": site_id},
            )

        # 1. Authorization Enforcement
        if active_auth is not None:
            AuthorizationManager.enforce(
                context=active_auth,
                target_workspace_id=target_ws_id,
                target_site_id=site_id,
                connector_type=conn_provider,
                resource_id=resource_id,
                operation=ExecutionOperationType.APPLY_CHANGE,
            )
        ws_id = target_ws_id

        # 2. Rate Limiting Check
        scope_key = self.rate_limiter.build_scope_key(ws_id, site_id, conn_provider)
        self.rate_limiter.check_and_record_request(scope_key)

        record = self._get_or_create_record(request)

        # Idempotency check: if already applied, return recorded result
        if record.state == ExecutionLifecycleState.APPLIED and record.result is not None:
            logger.info("Execution request '%s' already applied; returning cached outcome", request.request_id)
            return record.result

        # 3. Safety Gate Evaluation (if not already evaluated)
        decision = record.safety_decision or self.check_safety(
            request,
            connector=connector,
            fix_plan=fix_plan,
            recommendation=recommendation,
            finding=finding,
            auth_context=active_auth,
        )

        if not decision.is_allowed:
            raise SafetyGateRejectedError(
                message=f"Safety Gate rejected execution: {'; '.join(decision.blocking_reasons)}",
                blocking_reasons=decision.blocking_reasons,
                details={"safety_tier": decision.safety_tier.value},
            )

        if decision.safety_tier == SafetyTier.MANUAL_REVIEW:
            raise SafetyGateRejectedError(
                message="MANUAL_REVIEW tier fix plans are strictly blocked from automated execution",
                blocking_reasons=["MANUAL_REVIEW required"],
            )

        # 4. Approval Verification for ASSISTED Tier
        if decision.safety_tier == SafetyTier.ASSISTED:
            active_approval = approval or record.approval
            is_valid, err_msg = ApprovalManager.verify_approval(request, active_approval)
            if not is_valid:
                if "stale" in str(err_msg).lower():
                    raise StaleApprovalError(err_msg or "Approval is stale")
                raise ApprovalRequiredError(err_msg or "Explicit approval required for ASSISTED fix")
            record.approval = active_approval

        # 5. State Transition -> APPLYING
        if record.state in (ExecutionLifecycleState.PREVIEWED, ExecutionLifecycleState.APPROVED):
            ExecutionStateMachine.transition(record, ExecutionLifecycleState.APPLYING)
        elif record.state == ExecutionLifecycleState.SAFETY_CHECKED and decision.is_auto_executable:
            ExecutionStateMachine.transition(record, ExecutionLifecycleState.PREVIEWED)
            ExecutionStateMachine.transition(record, ExecutionLifecycleState.APPLYING)
        else:
            raise InvalidStateTransitionError(
                current_state=record.state.value,
                target_state=ExecutionLifecycleState.APPLYING.value,
                message=f"Cannot apply execution in '{record.state.value}' state",
            )

        if not request.change_proposal:
            ExecutionStateMachine.transition(record, ExecutionLifecycleState.FAILED)
            raise SafetyGateRejectedError(
                message="Cannot apply execution: change_proposal is missing from ExecutionRequest",
                blocking_reasons=["Missing change_proposal"],
            )

        # Validate proposal content safety boundaries
        content_to_check = getattr(request.change_proposal, "proposed_content", None) or getattr(request.change_proposal, "suggested_content", None)
        if isinstance(content_to_check, str):
            SecurityBoundaryValidator.validate_content_payload(content_to_check)

        # 6. Dispatch Apply to Connector with Scoped Resource Locking
        with self.lock_manager.lock_resource(
            workspace_id=ws_id,
            site_id=site_id,
            connector=conn_provider,
            resource_id=resource_id,
            owner_id=request.request_id,
        ):
            # Record Apply Initiated Audit Event
            AuditLogger.record(
                workspace_id=ws_id,
                site_id=site_id,
                actor_id=request.actor,
                execution_id=request.request_id,
                action=AuditActionType.APPLY_INITIATED,
                connector=conn_provider,
                resource_reference=resource_id,
                requested_operation="apply_change",
                safety_tier=str(decision.safety_tier.value),
                lifecycle_state=ExecutionLifecycleState.APPLYING.value,
                finding_id=request.finding_id,
                recommendation_id=request.recommendation_id,
                fix_plan_id=request.fix_plan_id,
                ledger=self.audit_ledger,
            )

            try:
                apply_res = connector.apply_change(request.change_proposal)
                ExecutionStateMachine.transition(record, ExecutionLifecycleState.APPLIED)

                elapsed = (time.monotonic() - start_time) * 1000.0
                res = ExecutionResult(
                    request_id=request.request_id,
                    operation_id=apply_res.operation_id,
                    status=ExecutionStatus.APPLIED,
                    lifecycle_state=ExecutionLifecycleState.APPLIED,
                    operation=ExecutionOperationType.APPLY_CHANGE,
                    target=request.target,
                    safety_decision=decision,
                    approval=record.approval,
                    change_result=apply_res,
                    started_at=_utc_now(),
                    completed_at=_utc_now(),
                    duration_ms=round(elapsed, 2),
                    metadata={
                        "provider": connector.site_context.provider,
                        "rollback_token": apply_res.rollback_token,
                    },
                )
                record.result = res

                # Record Apply Completed Audit Event
                AuditLogger.record(
                    workspace_id=ws_id,
                    site_id=site_id,
                    actor_id=request.actor,
                    execution_id=request.request_id,
                    action=AuditActionType.APPLY_COMPLETED,
                    connector=conn_provider,
                    resource_reference=resource_id,
                    requested_operation="apply_change",
                    safety_tier=str(decision.safety_tier.value),
                    lifecycle_state=ExecutionLifecycleState.APPLIED.value,
                    operation_id=str(apply_res.operation_id),
                    commit_id=apply_res.metadata.get("commit_sha") or apply_res.metadata.get("commit_id"),
                    pr_id=str(apply_res.metadata.get("pr_number") or apply_res.metadata.get("pr_id") or "") or None,
                    finding_id=request.finding_id,
                    recommendation_id=request.recommendation_id,
                    fix_plan_id=request.fix_plan_id,
                    details={"rollback_token": apply_res.rollback_token},
                    ledger=self.audit_ledger,
                )

                return res
            except Exception as exc:
                ExecutionStateMachine.transition(record, ExecutionLifecycleState.FAILED, reason=str(exc))
                AuditLogger.record(
                    workspace_id=ws_id,
                    site_id=site_id,
                    actor_id=request.actor,
                    execution_id=request.request_id,
                    action=AuditActionType.EXECUTION_FAILED,
                    connector=conn_provider,
                    resource_reference=resource_id,
                    requested_operation="apply_change",
                    lifecycle_state=ExecutionLifecycleState.FAILED.value,
                    error_classification=ConnectorErrorCode.UNKNOWN_ERROR.value,
                    details={"error": str(exc)},
                    ledger=self.audit_ledger,
                )
                raise

    # Alias for apply_execution
    apply_change = apply_execution

    # =========================================================================
    # 6. Post-Apply Validation & Rescan (Step 5)
    # =========================================================================

    def validate_execution(
        self,
        request_id: str,
        connector: BaseConnector,
        rescan_result: TargetedRescanResult | None = None,
        custom_rescan_html: str | None = None,
        finding: Any | None = None,
        expected_score_before: float | None = None,
        expected_score_after: float | None = None,
        scoring_category: str | None = None,
        auto_rollback_on_regression: bool = False,
        auto_keep_on_verified: bool = True,
        auth_context: AuthorizationContext | None = None,
    ) -> ValidationReport:
        """
        Executes post-apply verification pipeline:
        APPLIED -> VALIDATING -> RESCANNING -> VERIFIED / REGRESSION -> KEPT / ROLLED_BACK
        """
        if request_id not in self._records:
            raise ResourceNotFoundError(f"Execution request '{request_id}' not found for validation")

        record = self._records[request_id]
        active_auth = auth_context or self._auth_contexts.get(request_id)
        ws_id = record.request.workspace_id or (active_auth.workspace_id if active_auth else str(connector.site_context.workspace_id or "default_workspace"))
        site_id = str(connector.site_context.site_id)
        conn_provider = connector.site_context.provider
        resource_id = str(record.request.target.resource.resource_id)

        if active_auth is not None:
            AuthorizationManager.enforce(
                context=active_auth,
                target_workspace_id=ws_id,
                target_site_id=site_id,
                connector_type=conn_provider,
                resource_id=resource_id,
                operation=ExecutionOperationType.READ_RESOURCE,
            )

        # Idempotency: if already completed and verified, return existing report
        if record.state in (ExecutionLifecycleState.VERIFIED, ExecutionLifecycleState.KEPT) and record.validation_report:
            logger.info("Execution '%s' already verified; returning cached report", request_id)
            return record.validation_report

        if record.state != ExecutionLifecycleState.APPLIED and record.state != ExecutionLifecycleState.VALIDATING:
            raise InvalidStateTransitionError(
                current_state=record.state.value,
                target_state=ExecutionLifecycleState.VALIDATING.value,
                message=f"Cannot validate execution in state '{record.state.value}'. Request must be in APPLIED state.",
            )

        # 1. Transition -> VALIDATING
        if record.state == ExecutionLifecycleState.APPLIED:
            ExecutionStateMachine.transition(record, ExecutionLifecycleState.VALIDATING)

        # 2. Transition -> RESCANNING
        ExecutionStateMachine.transition(record, ExecutionLifecycleState.RESCANNING)

        # 3. Targeted Rescan
        active_rescan = rescan_result or TargetedRescanner.rescan_target(
            target=record.request.target,
            connector=connector,
            custom_html=custom_rescan_html,
        )

        # 4. Deterministic Validation Evaluation
        report = ValidationEngine.evaluate(
            record=record,
            connector=connector,
            rescan_result=active_rescan,
            finding=finding,
            expected_score_before=expected_score_before,
            expected_score_after=expected_score_after,
            scoring_category=scoring_category,
        )
        record.validation_report = report
        if record.result:
            record.result.validation_report = report

        # 5. Outcome State Transitions & Audit Recording
        if report.is_verified:
            ExecutionStateMachine.transition(record, ExecutionLifecycleState.VERIFIED)
            AuditLogger.record(
                workspace_id=ws_id,
                site_id=site_id,
                actor_id=record.request.actor,
                execution_id=request_id,
                action=AuditActionType.VALIDATION_COMPLETED,
                connector=conn_provider,
                resource_reference=resource_id,
                requested_operation="validate_execution",
                lifecycle_state=ExecutionLifecycleState.VERIFIED.value,
                validation_result="VERIFIED",
                rescan_result="SUCCESS" if active_rescan.is_success else "FAILED",
                finding_id=record.request.finding_id,
                recommendation_id=record.request.recommendation_id,
                fix_plan_id=record.request.fix_plan_id,
                ledger=self.audit_ledger,
            )
            if auto_keep_on_verified:
                ExecutionStateMachine.transition(record, ExecutionLifecycleState.KEPT)
                AuditLogger.record(
                    workspace_id=ws_id,
                    site_id=site_id,
                    actor_id=record.request.actor,
                    execution_id=request_id,
                    action=AuditActionType.EXECUTION_KEPT,
                    connector=conn_provider,
                    resource_reference=resource_id,
                    requested_operation="validate_execution",
                    lifecycle_state=ExecutionLifecycleState.KEPT.value,
                    finding_id=record.request.finding_id,
                    recommendation_id=record.request.recommendation_id,
                    fix_plan_id=record.request.fix_plan_id,
                    ledger=self.audit_ledger,
                )
        elif report.is_regression or report.outcome == ValidationOutcome.REGRESSION:
            ExecutionStateMachine.transition(record, ExecutionLifecycleState.REGRESSION, reason="Validation detected regression")
            AuditLogger.record(
                workspace_id=ws_id,
                site_id=site_id,
                actor_id=record.request.actor,
                execution_id=request_id,
                action=AuditActionType.REGRESSION_DETECTED,
                connector=conn_provider,
                resource_reference=resource_id,
                requested_operation="validate_execution",
                lifecycle_state=ExecutionLifecycleState.REGRESSION.value,
                validation_result="REGRESSION",
                finding_id=record.request.finding_id,
                recommendation_id=record.request.recommendation_id,
                fix_plan_id=record.request.fix_plan_id,
                details={"regression_indicators": [r.model_dump() for r in report.regression_indicators]},
                ledger=self.audit_ledger,
            )
            if auto_rollback_on_regression:
                self.rollback_and_verify(request_id=request_id, connector=connector, auth_context=active_auth)
        else:
            ExecutionStateMachine.transition(record, ExecutionLifecycleState.REGRESSION, reason="Validation requirements not met")
            AuditLogger.record(
                workspace_id=ws_id,
                site_id=site_id,
                actor_id=record.request.actor,
                execution_id=request_id,
                action=AuditActionType.REGRESSION_DETECTED,
                connector=conn_provider,
                resource_reference=resource_id,
                requested_operation="validate_execution",
                lifecycle_state=ExecutionLifecycleState.REGRESSION.value,
                validation_result=report.outcome.value,
                finding_id=record.request.finding_id,
                recommendation_id=record.request.recommendation_id,
                fix_plan_id=record.request.fix_plan_id,
                ledger=self.audit_ledger,
            )
            if auto_rollback_on_regression and report.rollback_required:
                self.rollback_and_verify(request_id=request_id, connector=connector, auth_context=active_auth)

        return report

    # =========================================================================
    # 7. Rollback & Verification (Step 5 & 6)
    # =========================================================================

    def rollback_and_verify(
        self,
        request_id: str,
        connector: BaseConnector,
        custom_post_rollback_html: str | None = None,
        auth_context: AuthorizationContext | None = None,
    ) -> RollbackVerificationResult:
        """
        Coordinates rollback and verifies post-rollback target restoration.
        """
        if request_id not in self._records:
            raise ResourceNotFoundError(f"Execution request '{request_id}' not found for rollback")

        record = self._records[request_id]
        active_auth = auth_context or self._auth_contexts.get(request_id)
        ws_id = record.request.workspace_id or (active_auth.workspace_id if active_auth else str(connector.site_context.workspace_id or "default_workspace"))
        site_id = str(connector.site_context.site_id)
        conn_provider = connector.site_context.provider
        resource_id = str(record.request.target.resource.resource_id)

        if active_auth is not None:
            AuthorizationManager.enforce(
                context=active_auth,
                target_workspace_id=ws_id,
                target_site_id=site_id,
                connector_type=conn_provider,
                resource_id=resource_id,
                operation=ExecutionOperationType.ROLLBACK_CHANGE,
            )

        # Idempotency: if already rolled back and verified, return recorded result
        if record.state == ExecutionLifecycleState.ROLLED_BACK and record.rollback_verification is not None:
            logger.info("Execution '%s' already rolled back; returning recorded verification", request_id)
            return record.rollback_verification

        if record.state not in (
            ExecutionLifecycleState.APPLIED,
            ExecutionLifecycleState.VERIFIED,
            ExecutionLifecycleState.KEPT,
            ExecutionLifecycleState.REGRESSION,
        ):
            raise InvalidStateTransitionError(
                current_state=record.state.value,
                target_state=ExecutionLifecycleState.ROLLED_BACK.value,
                message=f"Cannot rollback execution in state '{record.state.value}'",
            )

        with self.lock_manager.lock_resource(
            workspace_id=ws_id,
            site_id=site_id,
            connector=conn_provider,
            resource_id=resource_id,
            owner_id=request_id,
        ):
            # Record Rollback Initiated Audit Event
            AuditLogger.record(
                workspace_id=ws_id,
                site_id=site_id,
                actor_id=record.request.actor,
                execution_id=request_id,
                action=AuditActionType.ROLLBACK_INITIATED,
                connector=conn_provider,
                resource_reference=resource_id,
                requested_operation="rollback_change",
                lifecycle_state=ExecutionLifecycleState.ROLLED_BACK.value,
                finding_id=record.request.finding_id,
                recommendation_id=record.request.recommendation_id,
                fix_plan_id=record.request.fix_plan_id,
                ledger=self.audit_ledger,
            )

            verification_res = RollbackManager.execute_and_verify(
                record=record,
                connector=connector,
                custom_post_rollback_html=custom_post_rollback_html,
            )
            record.rollback_verification = verification_res
            if record.result:
                record.result.rollback_verification = verification_res
                record.result.status = ExecutionStatus.ROLLED_BACK if verification_res.is_restored else ExecutionStatus.FAILED
                record.result.lifecycle_state = record.state

            # Record Rollback Completed Audit Event
            AuditLogger.record(
                workspace_id=ws_id,
                site_id=site_id,
                actor_id=record.request.actor,
                execution_id=request_id,
                action=AuditActionType.ROLLBACK_COMPLETED,
                connector=conn_provider,
                resource_reference=resource_id,
                requested_operation="rollback_change",
                lifecycle_state=record.state.value,
                rollback_result=verification_res.status,
                finding_id=record.request.finding_id,
                recommendation_id=record.request.recommendation_id,
                fix_plan_id=record.request.fix_plan_id,
                details={"is_restored": verification_res.is_restored},
                ledger=self.audit_ledger,
            )

            return verification_res

    def rollback_execution(
        self,
        request_id: str,
        connector: BaseConnector,
        auth_context: AuthorizationContext | None = None,
    ) -> ExecutionResult:
        """
        Reverts an applied fix by restoring the preserved previous state snapshot.
        """
        start_time = time.monotonic()
        if request_id not in self._records:
            raise ResourceNotFoundError(f"Execution request '{request_id}' not found for rollback")

        record = self._records[request_id]
        active_auth = auth_context or self._auth_contexts.get(request_id)
        ws_id = record.request.workspace_id or (active_auth.workspace_id if active_auth else str(connector.site_context.workspace_id or "default_workspace"))
        site_id = str(connector.site_context.site_id)
        conn_provider = connector.site_context.provider
        resource_id = str(record.request.target.resource.resource_id)

        if active_auth is not None:
            AuthorizationManager.enforce(
                context=active_auth,
                target_workspace_id=ws_id,
                target_site_id=site_id,
                connector_type=conn_provider,
                resource_id=resource_id,
                operation=ExecutionOperationType.ROLLBACK_CHANGE,
            )

        # Idempotency: if already rolled back, return recorded execution result
        if record.state == ExecutionLifecycleState.ROLLED_BACK and record.result and record.result.status == ExecutionStatus.ROLLED_BACK:
            logger.info("Execution '%s' already rolled back; returning cached result", request_id)
            return record.result

        if record.state not in (
            ExecutionLifecycleState.APPLIED,
            ExecutionLifecycleState.VERIFIED,
            ExecutionLifecycleState.KEPT,
            ExecutionLifecycleState.REGRESSION,
        ) or not record.result or not record.result.change_result:
            raise InvalidStateTransitionError(
                current_state=record.state.value,
                target_state=ExecutionLifecycleState.ROLLED_BACK.value,
                message=f"Cannot rollback execution in state '{record.state.value}'",
            )

        op_id = record.result.operation_id or (record.result.change_result.operation_id if record.result.change_result else None)
        rollback_token = record.result.change_result.rollback_token if record.result.change_result else None
        lookup_id = op_id or rollback_token

        if not lookup_id:
            raise ResourceNotFoundError("No rollback token or operation ID recorded for this execution")

        with self.lock_manager.lock_resource(
            workspace_id=ws_id,
            site_id=site_id,
            connector=conn_provider,
            resource_id=resource_id,
            owner_id=request_id,
        ):
            rollback_res = connector.rollback_change(lookup_id, rollback_token=rollback_token)
            ExecutionStateMachine.transition(record, ExecutionLifecycleState.ROLLED_BACK)

            elapsed = (time.monotonic() - start_time) * 1000.0
            res = ExecutionResult(
                request_id=request_id,
                operation_id=rollback_res.operation_id,
                status=ExecutionStatus.ROLLED_BACK,
                lifecycle_state=ExecutionLifecycleState.ROLLED_BACK,
                operation=ExecutionOperationType.ROLLBACK_CHANGE,
                target=record.request.target,
                safety_decision=record.safety_decision,
                approval=record.approval,
                change_result=rollback_res,
                started_at=_utc_now(),
                completed_at=_utc_now(),
                duration_ms=round(elapsed, 2),
                metadata={"rollback_status": "reverted"},
            )
            record.result = res

            # Record Rollback Audit Event
            AuditLogger.record(
                workspace_id=ws_id,
                site_id=site_id,
                actor_id=record.request.actor,
                execution_id=request_id,
                action=AuditActionType.ROLLBACK_COMPLETED,
                connector=conn_provider,
                resource_reference=resource_id,
                requested_operation="rollback_change",
                lifecycle_state=ExecutionLifecycleState.ROLLED_BACK.value,
                rollback_result="ROLLED_BACK",
                finding_id=record.request.finding_id,
                recommendation_id=record.request.recommendation_id,
                fix_plan_id=record.request.fix_plan_id,
                details={"operation_id": str(rollback_res.operation_id)},
                ledger=self.audit_ledger,
            )

            return res

    # =========================================================================
    # 8. Query Registry
    # =========================================================================

    def get_execution(
        self,
        request_id: str,
        auth_context: AuthorizationContext | None = None,
    ) -> ExecutionRecord:
        """Returns the execution record for a given request ID with authorization enforcement."""
        if request_id not in self._records:
            raise ResourceNotFoundError(f"Execution request '{request_id}' not found")
        record = self._records[request_id]

        active_auth = auth_context or self._auth_contexts.get(request_id)
        if active_auth is not None and auth_context is not None:
            ws_id = record.request.workspace_id or "default_workspace"
            site_id = str(record.request.target.site_context.site_id)
            conn_provider = record.request.target.site_context.provider
            AuthorizationManager.enforce(
                context=auth_context,
                target_workspace_id=ws_id,
                target_site_id=site_id,
                connector_type=conn_provider,
                resource_id=str(record.request.target.resource.resource_id),
                operation=ExecutionOperationType.GET_CHANGE_STATUS,
            )
        return record

    # -------------------------------------------------------------------------
    # Internal Helpers
    # -------------------------------------------------------------------------

    def _get_or_create_record(self, request: ExecutionRequest) -> ExecutionRecord:
        if request.request_id in self._records:
            return self._records[request.request_id]
        record = ExecutionRecord(
            request=request,
            state=ExecutionLifecycleState.PLANNED,
            history=[(ExecutionLifecycleState.PLANNED, _utc_now())],
        )
        self._records[request.request_id] = record
        self._idempotency_map[request.idempotency_key] = request.request_id
        return record
