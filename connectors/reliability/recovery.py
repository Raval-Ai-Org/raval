"""
Worker Failure Recovery & Ambiguous State Resolution (Task 11 Step 6).

Implements deterministic failure recovery protocols:
1. Inspects interrupted or stalled ExecutionRecords.
2. Identifies next safe recovery action per lifecycle state.
3. Strictly forbids blind re-application after ambiguous apply failures.
4. Elevates unconfirmable mutation states to MANUAL_REVIEW_REQUIRED.
"""

from __future__ import annotations

import logging
from enum import Enum
from typing import Any
from pydantic import BaseModel, ConfigDict, Field

from connectors.base.enums import ConnectorCapability, ExecutionStatus
from connectors.base.interface import BaseConnector
from connectors.execution.models import (
    ExecutionLifecycleState,
    ExecutionRecord,
)
from connectors.execution.state_machine import ExecutionStateMachine

logger = logging.getLogger(__name__)


class RecoveryAction(str, Enum):
    """Deterministic recovery recommendations for interrupted execution sessions."""
    RESTART_EVALUATION = "restart_evaluation"
    AWAIT_APPROVAL = "await_approval"
    RESUME_VALIDATION = "resume_validation"
    QUERY_CONNECTOR_STATUS = "query_connector_status"
    MARK_MANUAL_REVIEW = "mark_manual_review"
    RESUME_ROLLBACK = "resume_rollback"
    NOOP_COMPLETED = "noop_completed"


class RecoveryDecision(BaseModel):
    """
    Actionable decision output from worker failure recovery inspection.
    """
    model_config = ConfigDict(from_attributes=True, populate_by_name=True, extra="allow")

    request_id: str = Field(..., description="ExecutionRequest ID inspected")
    initial_state: ExecutionLifecycleState = Field(..., description="Lifecycle state when recovered")
    recommended_action: RecoveryAction = Field(..., description="Recommended safe action")
    reason: str = Field(..., description="Deterministic recovery rationale")
    target_state: ExecutionLifecycleState | None = Field(default=None, description="Resolved state if transitioned")
    requires_human_intervention: bool = Field(default=False, description="Whether manual review is mandatory")
    details: dict[str, Any] = Field(default_factory=dict, description="Diagnostic recovery details")


class WorkerRecoveryManager:
    """
    Inspects and recovers execution records following process crash, restart, or worker failure.
    """

    @classmethod
    def inspect_and_recover(
        cls,
        record: ExecutionRecord,
        connector: BaseConnector | None = None,
    ) -> RecoveryDecision:
        """
        Evaluates an in-flight or stalled execution record and determines the next safe action.
        """
        state = record.state
        req_id = record.request.request_id

        # 1. State: PLANNED or SAFETY_CHECKED -> Safe to re-evaluate from start
        if state in (ExecutionLifecycleState.PLANNED, ExecutionLifecycleState.SAFETY_CHECKED):
            return RecoveryDecision(
                request_id=req_id,
                initial_state=state,
                recommended_action=RecoveryAction.RESTART_EVALUATION,
                reason="Execution failed before mutation; safe to restart safety check and preview",
            )

        # 2. State: PREVIEWED -> Awaiting approval or ready for apply
        if state == ExecutionLifecycleState.PREVIEWED:
            return RecoveryDecision(
                request_id=req_id,
                initial_state=state,
                recommended_action=RecoveryAction.AWAIT_APPROVAL,
                reason="Preview completed; awaiting explicit human approval or apply trigger",
            )

        # 3. State: APPROVED -> Ready to initiate apply
        if state == ExecutionLifecycleState.APPROVED:
            return RecoveryDecision(
                request_id=req_id,
                initial_state=state,
                recommended_action=RecoveryAction.RESTART_EVALUATION,
                reason="Approval is recorded; safe to initiate apply with existing approval token",
            )

        # 4. State: APPLYING -> Ambiguous external mutation status!
        if state == ExecutionLifecycleState.APPLYING:
            op_id = record.result.operation_id if record.result else None
            # If connector supports querying status and we have an operation ID
            if connector and op_id and connector.supports(ConnectorCapability.STATUS):
                try:
                    status_res = connector.get_change_status(op_id)
                    if status_res.status == ExecutionStatus.APPLIED:
                        ExecutionStateMachine.transition(record, ExecutionLifecycleState.APPLIED)
                        return RecoveryDecision(
                            request_id=req_id,
                            initial_state=state,
                            recommended_action=RecoveryAction.RESUME_VALIDATION,
                            target_state=ExecutionLifecycleState.APPLIED,
                            reason="Connector confirmed mutation succeeded; transitioning to APPLIED to resume validation",
                            details={"operation_id": str(op_id)},
                        )
                    elif status_res.status == ExecutionStatus.FAILED:
                        ExecutionStateMachine.transition(record, ExecutionLifecycleState.FAILED)
                        return RecoveryDecision(
                            request_id=req_id,
                            initial_state=state,
                            recommended_action=RecoveryAction.NOOP_COMPLETED,
                            target_state=ExecutionLifecycleState.FAILED,
                            reason="Connector confirmed mutation failed on remote target",
                            details={"operation_id": str(op_id)},
                        )
                except Exception as exc:
                    logger.warning("Failed to query connector status during recovery: %s", exc)

            # Cannot verify external status -> Must transition to MANUAL_REVIEW_REQUIRED (never reapply!)
            ExecutionStateMachine.transition(
                record,
                ExecutionLifecycleState.MANUAL_REVIEW_REQUIRED,
                reason="Worker crashed during APPLYING and remote state could not be verified",
            )
            return RecoveryDecision(
                request_id=req_id,
                initial_state=state,
                recommended_action=RecoveryAction.MARK_MANUAL_REVIEW,
                target_state=ExecutionLifecycleState.MANUAL_REVIEW_REQUIRED,
                requires_human_intervention=True,
                reason="External mutation status is ambiguous. Never blindly reapply. Manual review required.",
            )

        # 5. State: APPLIED -> Safe to resume post-apply validation
        if state == ExecutionLifecycleState.APPLIED:
            return RecoveryDecision(
                request_id=req_id,
                initial_state=state,
                recommended_action=RecoveryAction.RESUME_VALIDATION,
                reason="Mutation applied; safe to run post-apply validation and rescan",
            )

        # 6. State: VALIDATING or RESCANNING -> Safe to re-run validation pipeline
        if state in (ExecutionLifecycleState.VALIDATING, ExecutionLifecycleState.RESCANNING):
            return RecoveryDecision(
                request_id=req_id,
                initial_state=state,
                recommended_action=RecoveryAction.RESUME_VALIDATION,
                reason="Interrupted during validation/rescan; safe to re-execute verification pipeline",
            )

        # 7. State: REGRESSION -> Needs rollback
        if state == ExecutionLifecycleState.REGRESSION:
            return RecoveryDecision(
                request_id=req_id,
                initial_state=state,
                recommended_action=RecoveryAction.RESUME_ROLLBACK,
                reason="Regression confirmed; rollback required",
            )

        # 8. State: ROLLBACK_FAILED -> Requires manual review
        if state == ExecutionLifecycleState.ROLLBACK_FAILED:
            return RecoveryDecision(
                request_id=req_id,
                initial_state=state,
                recommended_action=RecoveryAction.MARK_MANUAL_REVIEW,
                requires_human_intervention=True,
                reason="Rollback failed; manual engineer intervention required",
            )

        # 9. Terminal states: VERIFIED, KEPT, ROLLED_BACK, FAILED, BLOCKED, REJECTED, MANUAL_REVIEW_REQUIRED
        return RecoveryDecision(
            request_id=req_id,
            initial_state=state,
            recommended_action=RecoveryAction.NOOP_COMPLETED,
            target_state=state,
            reason=f"Execution is in terminal state '{state.value}'; no recovery action needed",
        )
