"""
Production Orchestration & Monitoring - Control Service.

Implements safe, cooperative cancellation, pause, and resume workflows.
Guarantees:
- Safe cancellation boundaries (never killing active side-effects mid-mutation)
- Executing safety rule (live EXECUTING operations must reach safe boundaries)
- Resumption validation against durable checkpoints and execution receipts
- Idempotent control operations
- Multi-tenant and site boundary enforcement
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import logging
from typing import Any
from uuid import uuid4

from sqlalchemy.orm import Session

from connectors.base.security import sanitize_payload
from .checkpoints import CheckpointManager
from .enums import (
    CancellationOutcome,
    ControlSignalType,
    OrchestrationEventType,
    ReceiptStatus,
    RunState,
    StageState,
)
from .exceptions import (
    CancellationRejectedError,
    RunNotFoundError,
    SiteMismatchError,
    TenantMismatchError,
    TerminalStateError,
    UnsafeResumeError,
)
from .models import (
    ExecutionReceipt,
    OrchestrationControlRequest,
    OrchestrationEvent,
    OrchestrationRun,
    OrchestrationStage,
)
from .queue import OrchestrationQueue, QueueJob
from .service import OrchestrationService

logger = logging.getLogger(__name__)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


@dataclass
class CancellationResult:
    """Outcome of a cancellation request."""

    run_id: str
    status: RunState | str
    outcome: CancellationOutcome | str
    acknowledged: bool
    message: str
    run: OrchestrationRun | None = None


@dataclass
class PauseResult:
    """Outcome of a pause request."""

    run_id: str
    status: RunState | str
    outcome: str
    acknowledged: bool
    message: str
    checkpoint_id: str | None = None
    run: OrchestrationRun | None = None


@dataclass
class ResumeResult:
    """Outcome of a resume request."""

    run_id: str
    status: RunState | str
    outcome: str
    message: str
    resumed_from_checkpoint_id: str | None = None
    run: OrchestrationRun | None = None


class ControlService:
    """
    Central service for cooperative run cancellation, pausing, and safe resumption.
    """

    def __init__(self, orchestration_service: OrchestrationService | None = None) -> None:
        self.orchestration_service = orchestration_service or OrchestrationService()
        self.checkpoint_manager = CheckpointManager

    def request_cancellation(
        self,
        workspace_id: str,
        site_id: int,
        run_id: str,
        requested_by: str,
        db: Session,
        reason: str | None = None,
        queue: OrchestrationQueue | None = None,
    ) -> CancellationResult:
        """
        Requests cancellation of an OrchestrationRun.
        - QUEUED or PAUSED runs are cancelled immediately.
        - Active runs receive a cooperative cancellation signal evaluated by workers at safe boundaries.
        - Terminal runs are safely no-ops (idempotent).
        """
        run = db.query(OrchestrationRun).filter(OrchestrationRun.id == run_id).first()
        if not run:
            raise RunNotFoundError(run_id=run_id, workspace_id=workspace_id)

        if run.workspace_id != workspace_id:
            raise TenantMismatchError(
                request_workspace_id=workspace_id,
                target_workspace_id=run.workspace_id,
                entity_id=run_id,
            )

        if run.site_id != site_id:
            raise SiteMismatchError(
                run_id=run_id,
                expected_site_id=run.site_id,
                actual_site_id=site_id,
            )

        current_state = RunState(run.state)
        now = _utc_now()

        # 1. Idempotent: Already CANCELLED
        if current_state == RunState.CANCELLED:
            logger.info("Run '%s' is already CANCELLED; idempotent no-op", run_id)
            return CancellationResult(
                run_id=run.id,
                status=RunState.CANCELLED,
                outcome=CancellationOutcome.ALREADY_TERMINAL,
                acknowledged=True,
                message="Run is already in CANCELLED state.",
                run=run,
            )

        # 2. Terminal State Check
        if current_state.is_terminal:
            logger.info("Run '%s' is already in terminal state '%s'; cancellation ignored", run_id, current_state.value)
            return CancellationResult(
                run_id=run.id,
                status=current_state,
                outcome=CancellationOutcome.ALREADY_TERMINAL,
                acknowledged=True,
                message=f"Run is already in terminal state '{current_state.value}'.",
                run=run,
            )

        # 3. QUEUED or PAUSED: Cancel Immediately
        if current_state in (RunState.QUEUED, RunState.PAUSED):
            run = self.orchestration_service.transition_run_state(
                workspace_id=workspace_id,
                run_id=run_id,
                target_state=RunState.CANCELLED,
                db=db,
                site_id=site_id,
                reason=reason or f"Immediate cancellation requested by {requested_by}",
                outcome_summary={
                    "cancelled_by": requested_by,
                    "reason": reason,
                    "from_state": current_state.value,
                },
            )

            # Record control request as immediately acknowledged
            ctrl_req = OrchestrationControlRequest(
                id=f"ctrl_{uuid4().hex[:16]}",
                workspace_id=workspace_id,
                site_id=site_id,
                run_id=run_id,
                signal_type=ControlSignalType.CANCEL.value,
                requested_by=requested_by,
                requested_at=now,
                reason=reason,
                current_state_at_request=current_state.value,
                is_acknowledged=True,
                acknowledged_at=now,
                acknowledged_by_worker="immediate_server",
                outcome=CancellationOutcome.CANCELLED_IMMEDIATELY.value,
                details=sanitize_payload({"cancelled_from": current_state.value}),
            )
            db.add(ctrl_req)

            # Also cancel any queued stages
            for stage in run.stages:
                if stage.state in (StageState.QUEUED.value, StageState.PAUSED.value):
                    self.orchestration_service.transition_stage_state(
                        workspace_id=workspace_id,
                        run_id=run_id,
                        stage_id=stage.id,
                        target_state=StageState.CANCELLED,
                        db=db,
                        site_id=site_id,
                        reason="Parent run cancelled",
                    )

            db.commit()
            db.refresh(run)

            return CancellationResult(
                run_id=run.id,
                status=RunState.CANCELLED,
                outcome=CancellationOutcome.CANCELLED_IMMEDIATELY,
                acknowledged=True,
                message=f"Run '{run_id}' in state '{current_state.value}' was cancelled immediately.",
                run=run,
            )

        # 4. Active Operational State: Cooperative Cancellation Signal
        # Persist unacknowledged cancellation signal for workers to check at safe boundary
        ctrl_req = OrchestrationControlRequest(
            id=f"ctrl_{uuid4().hex[:16]}",
            workspace_id=workspace_id,
            site_id=site_id,
            run_id=run_id,
            signal_type=ControlSignalType.CANCEL.value,
            requested_by=requested_by,
            requested_at=now,
            reason=reason,
            current_state_at_request=current_state.value,
            is_acknowledged=False,
            acknowledged_at=None,
            acknowledged_by_worker=None,
            outcome=None,
            details=sanitize_payload({"requested_by": requested_by, "reason": reason}),
        )
        db.add(ctrl_req)

        # Audit event
        event = OrchestrationEvent(
            id=f"evt_{uuid4().hex[:16]}",
            run_id=run_id,
            stage_id=None,
            workspace_id=workspace_id,
            site_id=site_id,
            event_type=OrchestrationEventType.RUN_CANCEL_REQUESTED.value,
            from_state=current_state.value,
            to_state=current_state.value,
            details=sanitize_payload({
                "requested_by": requested_by,
                "reason": reason,
                "signal_id": ctrl_req.id,
            }),
            occurred_at=now,
        )
        db.add(event)
        db.commit()

        logger.info(
            "Cooperative cancellation requested for active run '%s' in state '%s'",
            run_id,
            current_state.value,
        )

        return CancellationResult(
            run_id=run.id,
            status=current_state,
            outcome="COOPERATIVE_CANCELLATION_REQUESTED",
            acknowledged=False,
            message=(
                f"Cancellation signal queued for run '{run_id}'. "
                f"The worker will cooperatively cancel at the next safe boundary."
            ),
            run=run,
        )

    def request_pause(
        self,
        workspace_id: str,
        site_id: int,
        run_id: str,
        requested_by: str,
        db: Session,
        reason: str | None = None,
        queue: OrchestrationQueue | None = None,
    ) -> PauseResult:
        """
        Requests pause of an OrchestrationRun.
        - QUEUED runs transition to PAUSED immediately.
        - Active runs receive a cooperative pause signal to checkpoint and pause.
        - Terminal runs are rejected.
        """
        run = db.query(OrchestrationRun).filter(OrchestrationRun.id == run_id).first()
        if not run:
            raise RunNotFoundError(run_id=run_id, workspace_id=workspace_id)

        if run.workspace_id != workspace_id:
            raise TenantMismatchError(
                request_workspace_id=workspace_id,
                target_workspace_id=run.workspace_id,
                entity_id=run_id,
            )

        if run.site_id != site_id:
            raise SiteMismatchError(
                run_id=run_id,
                expected_site_id=run.site_id,
                actual_site_id=site_id,
            )

        current_state = RunState(run.state)
        now = _utc_now()

        # 1. Idempotent: Already PAUSED
        if current_state == RunState.PAUSED:
            logger.info("Run '%s' is already PAUSED; idempotent no-op", run_id)
            return PauseResult(
                run_id=run.id,
                status=RunState.PAUSED,
                outcome="ALREADY_PAUSED",
                acknowledged=True,
                message="Run is already paused.",
                run=run,
            )

        # 2. Terminal State Check
        if current_state.is_terminal:
            raise TerminalStateError(
                entity_type="OrchestrationRun",
                entity_id=run_id,
                terminal_state=current_state.value,
            )

        # 3. QUEUED: Pause Immediately
        if current_state == RunState.QUEUED:
            run = self.orchestration_service.transition_run_state(
                workspace_id=workspace_id,
                run_id=run_id,
                target_state=RunState.PAUSED,
                db=db,
                site_id=site_id,
                reason=reason or f"Queued pause requested by {requested_by}",
            )
            run.paused_at = now

            ctrl_req = OrchestrationControlRequest(
                id=f"ctrl_{uuid4().hex[:16]}",
                workspace_id=workspace_id,
                site_id=site_id,
                run_id=run_id,
                signal_type=ControlSignalType.PAUSE.value,
                requested_by=requested_by,
                requested_at=now,
                reason=reason,
                current_state_at_request=current_state.value,
                is_acknowledged=True,
                acknowledged_at=now,
                acknowledged_by_worker="immediate_server",
                outcome="PAUSED_IMMEDIATELY",
                details=sanitize_payload({"paused_from": current_state.value}),
            )
            db.add(ctrl_req)
            db.commit()
            db.refresh(run)

            return PauseResult(
                run_id=run.id,
                status=RunState.PAUSED,
                outcome="PAUSED_IMMEDIATELY",
                acknowledged=True,
                message=f"Queued run '{run_id}' paused immediately.",
                run=run,
            )

        # 4. Active Operational State: Cooperative Pause Signal
        ctrl_req = OrchestrationControlRequest(
            id=f"ctrl_{uuid4().hex[:16]}",
            workspace_id=workspace_id,
            site_id=site_id,
            run_id=run_id,
            signal_type=ControlSignalType.PAUSE.value,
            requested_by=requested_by,
            requested_at=now,
            reason=reason,
            current_state_at_request=current_state.value,
            is_acknowledged=False,
            acknowledged_at=None,
            acknowledged_by_worker=None,
            outcome=None,
            details=sanitize_payload({"requested_by": requested_by, "reason": reason}),
        )
        db.add(ctrl_req)

        event = OrchestrationEvent(
            id=f"evt_{uuid4().hex[:16]}",
            run_id=run_id,
            stage_id=None,
            workspace_id=workspace_id,
            site_id=site_id,
            event_type=OrchestrationEventType.RUN_PAUSE_REQUESTED.value,
            from_state=current_state.value,
            to_state=current_state.value,
            details=sanitize_payload({
                "requested_by": requested_by,
                "reason": reason,
                "signal_id": ctrl_req.id,
            }),
            occurred_at=now,
        )
        db.add(event)
        db.commit()

        logger.info(
            "Cooperative pause requested for active run '%s' in state '%s'",
            run_id,
            current_state.value,
        )

        return PauseResult(
            run_id=run.id,
            status=current_state,
            outcome="COOPERATIVE_PAUSE_REQUESTED",
            acknowledged=False,
            message=(
                f"Pause signal queued for run '{run_id}'. "
                f"The worker will checkpoint and pause at the next safe boundary."
            ),
            run=run,
        )

    def resume_run(
        self,
        workspace_id: str,
        site_id: int,
        run_id: str,
        requested_by: str,
        db: Session,
        queue: OrchestrationQueue | None = None,
    ) -> ResumeResult:
        """
        Resumes a PAUSED orchestration run from its latest valid checkpoint.
        Validates:
        1. Tenant & Site scope
        2. Must be in PAUSED state
        3. Checkpoint integrity & safety
        4. No ambiguous external execution receipts
        """
        run = db.query(OrchestrationRun).filter(OrchestrationRun.id == run_id).first()
        if not run:
            raise RunNotFoundError(run_id=run_id, workspace_id=workspace_id)

        if run.workspace_id != workspace_id:
            raise TenantMismatchError(
                request_workspace_id=workspace_id,
                target_workspace_id=run.workspace_id,
                entity_id=run_id,
            )

        if run.site_id != site_id:
            raise SiteMismatchError(
                run_id=run_id,
                expected_site_id=run.site_id,
                actual_site_id=site_id,
            )

        current_state = RunState(run.state)

        # 1. Idempotent: Already Active / Queued
        if current_state.is_active or current_state == RunState.QUEUED:
            return ResumeResult(
                run_id=run.id,
                status=current_state,
                outcome="ALREADY_ACTIVE",
                message=f"Run '{run_id}' is already in state '{current_state.value}'.",
                run=run,
            )

        # 2. Terminal Check
        if current_state.is_terminal:
            raise UnsafeResumeError(
                run_id=run_id,
                reason=f"Cannot resume terminal run in state '{current_state.value}'.",
            )

        # 3. Must be PAUSED
        if current_state != RunState.PAUSED:
            raise UnsafeResumeError(
                run_id=run_id,
                reason=f"Cannot resume run in state '{current_state.value}'; must be PAUSED.",
            )

        # 4. Check for Ambiguous External Receipts
        ambiguous_receipt = (
            db.query(ExecutionReceipt)
            .filter(
                ExecutionReceipt.run_id == run_id,
                ExecutionReceipt.workspace_id == workspace_id,
                (ExecutionReceipt.status == ReceiptStatus.AMBIGUOUS.value)
                | (ExecutionReceipt.is_safe_to_retry == False),  # noqa: E712
            )
            .first()
        )
        if ambiguous_receipt:
            raise UnsafeResumeError(
                run_id=run_id,
                reason=(
                    f"Ambiguous external mutation receipt '{ambiguous_receipt.id}' detected. "
                    f"Manual operator review is strictly required before resuming."
                ),
            )

        # 5. Retrieve & Validate Latest Checkpoint
        latest_chk = self.checkpoint_manager.get_latest_checkpoint(
            workspace_id=workspace_id,
            site_id=site_id,
            run_id=run_id,
            db=db,
        )
        if latest_chk:
            self.checkpoint_manager.validate_checkpoint_integrity(latest_chk)

        # 6. Determine Resumption Target State
        # Check metadata_payload for recorded resumable state
        resumable_name = (
            run.metadata_payload.get("resumable_active_state")
            or (run.recovery_info or {}).get("previous_state")
        )

        target_state: RunState
        if resumable_name:
            target_state = RunState(resumable_name)
        elif run.started_at is None:
            # Paused before ever starting
            target_state = RunState.QUEUED
        else:
            # Fallback to STARTING or first active stage
            target_state = RunState.STARTING

        # 7. Transition Run State
        run = self.orchestration_service.transition_run_state(
            workspace_id=workspace_id,
            run_id=run_id,
            target_state=target_state,
            previous_active_state=target_state if target_state.is_active else None,
            db=db,
            site_id=site_id,
            reason=f"Resumed by {requested_by}" + (f" from checkpoint {latest_chk.id}" if latest_chk else ""),
        )
        run.paused_at = None

        # 8. Resume any paused stages
        for stage in run.stages:
            if stage.state == StageState.PAUSED.value:
                self.orchestration_service.transition_stage_state(
                    workspace_id=workspace_id,
                    run_id=run_id,
                    stage_id=stage.id,
                    target_state=StageState.RUNNING,
                    db=db,
                    site_id=site_id,
                    reason="Resumed with parent run",
                )

        # 9. Audit Event
        now = _utc_now()
        event = OrchestrationEvent(
            id=f"evt_{uuid4().hex[:16]}",
            run_id=run_id,
            stage_id=None,
            workspace_id=workspace_id,
            site_id=site_id,
            event_type=OrchestrationEventType.RUN_RESUMED.value,
            from_state=RunState.PAUSED.value,
            to_state=target_state.value,
            details=sanitize_payload({
                "requested_by": requested_by,
                "resumed_to": target_state.value,
                "checkpoint_id": latest_chk.id if latest_chk else None,
            }),
            occurred_at=now,
        )
        db.add(event)
        db.commit()
        db.refresh(run)

        # 10. Re-enqueue to Queue if available
        if queue is not None:
            job = QueueJob(
                job_id=f"job_{uuid4().hex[:16]}",
                run_id=run.id,
                workspace_id=run.workspace_id,
                site_id=run.site_id,
                priority=10,  # High priority for resumed work
                enqueued_at=now,
            )
            queue.enqueue(job)
            logger.info("Resumed run '%s' re-enqueued to queue (job_id='%s')", run.id, job.job_id)

        return ResumeResult(
            run_id=run.id,
            status=target_state,
            outcome="RESUMED",
            message=f"Run '{run_id}' successfully resumed to '{target_state.value}'.",
            resumed_from_checkpoint_id=latest_chk.id if latest_chk else None,
            run=run,
        )

    @classmethod
    def get_pending_control_signal(
        cls,
        run_id: str,
        db: Session,
    ) -> OrchestrationControlRequest | None:
        """
        Retrieves the earliest unacknowledged control signal for a run.
        """
        return (
            db.query(OrchestrationControlRequest)
            .filter(
                OrchestrationControlRequest.run_id == run_id,
                OrchestrationControlRequest.is_acknowledged == False,  # noqa: E712
            )
            .order_by(OrchestrationControlRequest.requested_at.asc())
            .first()
        )

    @classmethod
    def acknowledge_signal(
        cls,
        signal_id: str,
        worker_id: str,
        outcome: str,
        db: Session,
    ) -> None:
        """
        Marks an OrchestrationControlRequest as acknowledged by a worker.
        """
        signal = (
            db.query(OrchestrationControlRequest)
            .filter(OrchestrationControlRequest.id == signal_id)
            .first()
        )
        if signal:
            signal.is_acknowledged = True
            signal.acknowledged_at = _utc_now()
            signal.acknowledged_by_worker = worker_id
            signal.outcome = outcome
            db.commit()
            logger.info(
                "Control signal '%s' acknowledged by worker '%s' with outcome '%s'",
                signal_id,
                worker_id,
                outcome,
            )
