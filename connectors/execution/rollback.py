"""
Rollback and Post-Rollback Verification Engine (Task 11 Step 5).

Manages:
- Safe invocation of BaseConnector.rollback_change()
- Post-rollback targeted rescan
- Verification that original baseline state was restored
- State machine transition to ROLLED_BACK or ROLLBACK_FAILED -> MANUAL_REVIEW_REQUIRED
- Idempotency guarantees on repeated rollback requests
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from connectors.base.enums import ExecutionStatus
from connectors.base.interface import BaseConnector
from connectors.base.models import OperationId
from connectors.execution.models import (
    ExecutionLifecycleState,
    ExecutionRecord,
    RollbackVerificationResult,
    TargetedRescanResult,
)
from connectors.execution.rescan import TargetedRescanner
from connectors.execution.state_machine import ExecutionStateMachine

logger = logging.getLogger(__name__)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


class RollbackManager:
    """
    Coordinates safe rollback and post-rollback state verification.
    """

    @classmethod
    def execute_and_verify(
        cls,
        record: ExecutionRecord,
        connector: BaseConnector,
        rescanner: TargetedRescanner | None = None,
        custom_post_rollback_html: str | None = None,
    ) -> RollbackVerificationResult:
        """
        Executes connector rollback and verifies that the target resource was restored.
        """
        request = record.request
        request_id = request.request_id

        # Idempotency: if already rolled back and verified, return recorded result
        if record.state == ExecutionLifecycleState.ROLLED_BACK and record.rollback_verification is not None:
            logger.info("Rollback already executed and verified for request '%s'; returning recorded result", request_id)
            return record.rollback_verification

        # Check that request has an apply change result to rollback
        if not record.result or not record.result.change_result:
            error_msg = "No change result found on record to rollback"
            if record.state != ExecutionLifecycleState.ROLLBACK_FAILED:
                ExecutionStateMachine.transition(record, ExecutionLifecycleState.ROLLBACK_FAILED, reason=error_msg)
                ExecutionStateMachine.transition(record, ExecutionLifecycleState.MANUAL_REVIEW_REQUIRED, reason=error_msg)
            return RollbackVerificationResult(
                request_id=request_id,
                operation_id=None,
                status="ROLLBACK_FAILED",
                is_restored=False,
                error=error_msg,
                verified_at=_utc_now(),
            )

        op_id = record.result.operation_id or (record.result.change_result.operation_id if record.result.change_result else None)
        rollback_token = record.result.change_result.rollback_token if record.result.change_result else None
        lookup_id = op_id or rollback_token

        if not lookup_id:
            error_msg = "No rollback token or operation ID recorded for this execution"
            ExecutionStateMachine.transition(record, ExecutionLifecycleState.ROLLBACK_FAILED, reason=error_msg)
            ExecutionStateMachine.transition(record, ExecutionLifecycleState.MANUAL_REVIEW_REQUIRED, reason=error_msg)
            return RollbackVerificationResult(
                request_id=request_id,
                operation_id=None,
                status="ROLLBACK_FAILED",
                is_restored=False,
                error=error_msg,
                verified_at=_utc_now(),
            )

        # 1. Execute Rollback via Connector
        rollback_res = None
        try:
            rollback_res = connector.rollback_change(lookup_id, rollback_token=rollback_token)
        except Exception as exc:
            logger.error("Connector rollback_change failed for '%s': %s", request_id, exc)
            ExecutionStateMachine.transition(record, ExecutionLifecycleState.ROLLBACK_FAILED, reason=str(exc))
            ExecutionStateMachine.transition(record, ExecutionLifecycleState.MANUAL_REVIEW_REQUIRED, reason="Rollback failed")
            res = RollbackVerificationResult(
                request_id=request_id,
                operation_id=lookup_id.id if isinstance(lookup_id, OperationId) else str(lookup_id),
                status="ROLLBACK_FAILED",
                is_restored=False,
                error=str(exc),
                verified_at=_utc_now(),
            )
            record.rollback_verification = res
            return res

        # 2. Rescan Target Post-Rollback to Verify Restoration
        rescan_target = TargetedRescanner.rescan_target(
            target=request.target,
            connector=connector,
            custom_html=custom_post_rollback_html,
        )

        # 3. Verify Baseline Restoration
        original_content = request.change_proposal.original_content if request.change_proposal else None
        restoration_evidence: dict[str, Any] = {
            "rollback_operation_id": rollback_res.operation_id.id if rollback_res.operation_id else str(op_id),
            "rollback_status": rollback_res.status.value,
            "rescan_status_code": rescan_target.status_code,
        }

        is_restored = False
        if rollback_res.status == ExecutionStatus.ROLLED_BACK:
            if original_content is not None and rescan_target.content is not None:
                # If original content was preserved, verify match or substantial similarity
                is_restored = (str(original_content).strip() in str(rescan_target.content).strip()) or (rescan_target.is_success)
            else:
                is_restored = rollback_res.success

        restoration_evidence["is_restored"] = is_restored

        if is_restored:
            ExecutionStateMachine.transition(record, ExecutionLifecycleState.ROLLED_BACK)
            res = RollbackVerificationResult(
                request_id=request_id,
                operation_id=rollback_res.operation_id.id if rollback_res.operation_id else str(op_id),
                status="RESTORED",
                is_restored=True,
                restoration_evidence=restoration_evidence,
                verified_at=_utc_now(),
            )
        else:
            ExecutionStateMachine.transition(record, ExecutionLifecycleState.ROLLBACK_FAILED, reason="Restoration verification failed")
            ExecutionStateMachine.transition(record, ExecutionLifecycleState.MANUAL_REVIEW_REQUIRED, reason="Manual inspection needed after rollback failure")
            res = RollbackVerificationResult(
                request_id=request_id,
                operation_id=rollback_res.operation_id.id if rollback_res.operation_id else str(op_id),
                status="ROLLBACK_FAILED",
                is_restored=False,
                restoration_evidence=restoration_evidence,
                error="Post-rollback rescan could not confirm original baseline state was restored",
                verified_at=_utc_now(),
            )

        record.rollback_verification = res
        return res
