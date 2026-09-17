"""
Production Orchestration & Monitoring - Worker Recovery & Failure Handling Engine.

Implements crash recovery for stale worker leases, ambiguous external side effect guards,
concurrency slot reclamation, and scheduled re-admission from RETRY_WAIT states.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import logging
from typing import Any

from sqlalchemy.orm import Session

from .concurrency import ConcurrencyController
from .enums import (
    FailureClass,
    OrchestrationEventType,
    ReceiptStatus,
    RecoveryActionType,
    RunState,
)
from .exceptions import RunNotFoundError
from .failure_classifier import FailureClassifier, StructuredFailure
from .models import ExecutionReceipt, OrchestrationEvent, OrchestrationRun
from .queue import OrchestrationQueue, QueueJob
from .receipts import ExecutionReceiptManager
from .retry_policy import RetryDecision, RetryEngine, RetryPolicy
from .service import OrchestrationService
from .worker import StaleJobReport

logger = logging.getLogger(__name__)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


@dataclass
class RecoveryResult:
    """Diagnostic outcome of a stale job recovery evaluation."""

    action: RecoveryActionType
    run_id: str
    job_id: str
    workspace_id: str
    site_id: int
    is_safe_to_retry: bool
    reason: str
    details: dict[str, Any]

    @property
    def action_taken(self) -> RecoveryActionType:
        return self.action

    @property
    def new_state(self) -> str:
        return self.details.get("new_state", "")

    @property
    def requires_manual_review(self) -> bool:
        return bool(self.details.get("requires_manual_review", False))


class RecoveryService:
    """
    Central recovery orchestrator handling worker crashes, lease expirations,
    external mutation reconciliation, and RETRY_WAIT re-admission.
    """

    def __init__(
        self,
        orchestration_service: OrchestrationService | None = None,
        queue: OrchestrationQueue | None = None,
        concurrency_controller: ConcurrencyController | None = None,
        receipt_manager: ExecutionReceiptManager | None = None,
        retry_policy: RetryPolicy | None = None,
    ) -> None:
        self.orchestration_service = orchestration_service or OrchestrationService()
        self.queue = queue
        self.concurrency_controller = concurrency_controller
        self.receipt_manager = receipt_manager or ExecutionReceiptManager()
        self.retry_policy = retry_policy or RetryPolicy()

    def recover_stale_job(
        self,
        stale_report: StaleJobReport | None = None,
        db: Session | None = None,
        queue: OrchestrationQueue | None = None,
        concurrency_controller: ConcurrencyController | None = None,
        job_id: str | None = None,
        run_id: str | None = None,
        workspace_id: str | None = None,
        site_id: int | None = None,
        worker_id: str | None = None,
        as_of: datetime | None = None,
        **kwargs,
    ) -> RecoveryResult:
        """
        Evaluates and recovers a stale/abandoned worker lease.
        Enforces strict safety guards against blind duplicate external mutations.
        """
        if db is None and "db" in kwargs:
            db = kwargs["db"]
        if db is None:
            raise ValueError("Database session 'db' is required.")

        resolved_run_id = run_id or (stale_report.run_id if stale_report else None)
        resolved_job_id = job_id or (stale_report.job_id if stale_report else f"job_{resolved_run_id}")
        resolved_worker_id = worker_id or (stale_report.worker_id if stale_report else "")

        if stale_report is None:
            stale_report = StaleJobReport(
                job_id=resolved_job_id,
                run_id=resolved_run_id or "unknown",
                worker_id=resolved_worker_id,
                lease_id=None,
                lease_expires_at=None,
                age_seconds=0.0,
                reason="Worker crash or lease expired",
            )

        eff_queue = queue or self.queue
        eff_concurrency = concurrency_controller or self.concurrency_controller
        now = as_of or _utc_now()

        run = db.query(OrchestrationRun).filter(OrchestrationRun.id == stale_report.run_id).first()
        if not run:
            logger.warning("Stale job '%s' references missing run '%s'", stale_report.job_id, stale_report.run_id)
            if eff_queue:
                eff_queue.purge()
            return RecoveryResult(
                action=RecoveryActionType.MARK_FAILED,
                run_id=stale_report.run_id,
                job_id=stale_report.job_id,
                workspace_id=workspace_id or "unknown",
                site_id=site_id or 0,
                is_safe_to_retry=False,
                reason="Run entity not found in database; orphan job purged.",
                details={"new_state": "FAILED"},
            )

        ws_id = run.workspace_id
        st_id = run.site_id

        # Reclaim any leaked concurrency counter held by the dead worker
        if eff_concurrency:
            eff_concurrency.release(workspace_id=ws_id, site_id=st_id)

        # Inspect execution receipts for this run
        receipts = (
            db.query(ExecutionReceipt)
            .filter(
                ExecutionReceipt.workspace_id == ws_id,
                ExecutionReceipt.run_id == run.id,
            )
            .all()
        )

        pending_receipts = [r for r in receipts if r.status == ReceiptStatus.PENDING.value]

        # =========================================================================
        # Case 2: Worker crashed while an external side effect was in-flight
        # =========================================================================
        if pending_receipts:
            for pending in pending_receipts:
                ExecutionReceiptManager.mark_receipt_ambiguous(
                    workspace_id=ws_id,
                    receipt_id=pending.id,
                    reason=(
                        f"Worker '{stale_report.worker_id}' lease expired while external mutation "
                        f"was in-flight. Ambiguity prevents automatic retry."
                    ),
                    db=db,
                )

            rec_info = dict(run.recovery_info or {})
            rec_info["requires_manual_review"] = True
            rec_info["ambiguity_reason"] = "Pending receipts found on crash"
            run.recovery_info = rec_info
            db.commit()

            if not RunState(run.state).is_terminal:
                run = self.orchestration_service.transition_run_state(
                    workspace_id=ws_id,
                    run_id=run.id,
                    target_state=RunState.FAILED,
                    db=db,
                    reason="Ambiguous external execution state during worker crash.",
                    error_detail={
                        "error_code": "ERR_AMBIGUOUS_MUTATION",
                        "requires_manual_review": True,
                        "pending_receipt_ids": [r.id for r in pending_receipts],
                    },
                )

            if eff_queue and stale_report.worker_id:
                eff_queue.acknowledge(job_id=stale_report.job_id, worker_id=stale_report.worker_id)

            logger.error(
                "Blocked ambiguous recovery for run '%s' (pending receipts: %s)",
                run.id,
                [r.id for r in pending_receipts],
            )
            return RecoveryResult(
                action=RecoveryActionType.RECONCILE_AMBIGUOUS_MUTATION,
                run_id=run.id,
                job_id=stale_report.job_id,
                workspace_id=ws_id,
                site_id=st_id,
                is_safe_to_retry=False,
                reason="Ambiguous external mutation in-flight during crash. Requires manual review.",
                details={
                    "new_state": RunState.FAILED.value,
                    "requires_manual_review": True,
                    "pending_receipts": [r.id for r in pending_receipts],
                },
            )

        # =========================================================================
        # Case 3: Worker crashed while in RETRY_WAIT
        # =========================================================================
        if run.state == RunState.RETRY_WAIT.value:
            if eff_queue:
                eff_queue.release(
                    job_id=stale_report.job_id,
                    worker_id=stale_report.worker_id or "",
                    delay_seconds=0,
                )
            return RecoveryResult(
                action=RecoveryActionType.RECONCILE_LEASE,
                run_id=run.id,
                job_id=stale_report.job_id,
                workspace_id=ws_id,
                site_id=st_id,
                is_safe_to_retry=True,
                reason="Job lease reconciled while run remains in RETRY_WAIT schedule.",
                details={"new_state": RunState.RETRY_WAIT.value},
            )

        # =========================================================================
        # Case 4: Non-retryable failure class check
        # =========================================================================
        last_failure_class = (run.recovery_info or {}).get("last_failure_class")
        if last_failure_class:
            try:
                fc_enum = FailureClass(last_failure_class)
                if fc_enum.is_always_non_retryable or fc_enum in self.retry_policy.non_retryable_classes:
                    if not RunState(run.state).is_terminal:
                        run = self.orchestration_service.transition_run_state(
                            workspace_id=ws_id,
                            run_id=run.id,
                            target_state=RunState.FAILED,
                            db=db,
                            reason=f"Stale lease on non-retryable failure class ({last_failure_class}).",
                        )
                    if eff_queue:
                        eff_queue.acknowledge(job_id=stale_report.job_id, worker_id=stale_report.worker_id or "")
                    return RecoveryResult(
                        action=RecoveryActionType.MARK_FAILED,
                        run_id=run.id,
                        job_id=stale_report.job_id,
                        workspace_id=ws_id,
                        site_id=st_id,
                        is_safe_to_retry=False,
                        reason=f"Non-retryable failure class '{last_failure_class}'.",
                        details={"new_state": RunState.FAILED.value},
                    )
            except ValueError:
                pass

        # =========================================================================
        # Case 1: Worker crashed during active operational phase (SCANNING, etc.)
        # =========================================================================
        rec_info = dict(run.recovery_info or {})
        history = list(rec_info.get("failure_history", []))
        attempt_count = len(history) + 1

        failure = FailureClassifier.classify(
            exc=RuntimeError(f"Worker crash or lease expired: {stale_report.reason}"),
            context={
                "source": "worker_recovery",
                "attempt": attempt_count,
                "workspace_id": ws_id,
                "site_id": st_id,
                "run_id": run.id,
                "job_id": stale_report.job_id,
            },
        )

        decision = RetryEngine().evaluate(
            failure=failure,
            attempt_number=attempt_count,
            policy=self.retry_policy,
            as_of=now,
        )

        if decision.should_retry and not RunState(run.state).is_terminal:
            previous_active_state = run.state

            # Transition to RETRY_WAIT
            run = self.orchestration_service.transition_run_state(
                workspace_id=ws_id,
                run_id=run.id,
                target_state=RunState.RETRY_WAIT,
                db=db,
                reason=decision.reason,
            )

            history.append({
                "attempt": attempt_count,
                "timestamp": now.isoformat(),
                "failure_class": failure.failure_class.value,
                "error_code": failure.error_code,
                "message": failure.safe_message,
            })

            rec_info.update({
                "previous_state": previous_active_state,
                "failure_class": failure.failure_class.value,
                "error_code": failure.error_code,
                "retry_attempt": attempt_count,
                "next_retry_at": decision.next_retry_at.isoformat() if decision.next_retry_at else None,
                "retry_delay_seconds": decision.delay_seconds,
                "failure_history": history,
            })
            run.recovery_info = rec_info
            run.updated_at = now
            db.commit()

            if eff_queue:
                eff_queue.release(
                    job_id=stale_report.job_id,
                    worker_id=stale_report.worker_id or "",
                    delay_seconds=int(decision.delay_seconds),
                )

            return RecoveryResult(
                action=RecoveryActionType.RESCHEDULE_RETRY,
                run_id=run.id,
                job_id=stale_report.job_id,
                workspace_id=ws_id,
                site_id=st_id,
                is_safe_to_retry=True,
                reason=decision.reason,
                details={
                    "new_state": RunState.RETRY_WAIT.value,
                    "next_retry_at": decision.next_retry_at.isoformat() if decision.next_retry_at else None,
                },
            )

        # Retry Exhausted -> FAILED
        rec_info["retry_exhausted"] = True
        run.recovery_info = rec_info
        db.commit()

        if not RunState(run.state).is_terminal:
            run = self.orchestration_service.transition_run_state(
                workspace_id=ws_id,
                run_id=run.id,
                target_state=RunState.FAILED,
                db=db,
                reason=decision.reason,
                error_detail={
                    "error_code": "ERR_RETRY_EXHAUSTED",
                    "attempts": attempt_count,
                    "max_attempts": self.retry_policy.max_attempts,
                    "last_error": failure.safe_message,
                },
            )

        if eff_queue and stale_report.worker_id:
            eff_queue.acknowledge(job_id=stale_report.job_id, worker_id=stale_report.worker_id)

        return RecoveryResult(
            action=RecoveryActionType.MARK_FAILED,
            run_id=run.id,
            job_id=stale_report.job_id,
            workspace_id=ws_id,
            site_id=st_id,
            is_safe_to_retry=False,
            reason=decision.reason,
            details={
                "new_state": RunState.FAILED.value,
                "attempts": attempt_count,
                "max_attempts": self.retry_policy.max_attempts,
            },
        )

    def process_retry_wait_admissions(
        self,
        db: Session,
        queue: OrchestrationQueue,
        as_of: datetime | None = None,
    ) -> list[OrchestrationRun]:
        """
        Scans all runs in RETRY_WAIT whose next_retry_at <= as_of,
        advances their state back to previous_active_state, and enqueues jobs.
        """
        eval_time = as_of or _utc_now()
        if eval_time.tzinfo is None:
            eval_time = eval_time.replace(tzinfo=timezone.utc)

        runs_in_retry_wait = (
            db.query(OrchestrationRun)
            .filter(OrchestrationRun.state == RunState.RETRY_WAIT.value)
            .all()
        )

        resumed_runs: list[OrchestrationRun] = []
        for run in runs_in_retry_wait:
            rec_info = run.recovery_info or {}
            next_retry_str = rec_info.get("next_retry_at")
            if not next_retry_str:
                continue

            try:
                next_retry = datetime.fromisoformat(next_retry_str)
            except (ValueError, TypeError):
                continue

            if next_retry.tzinfo is None:
                next_retry = next_retry.replace(tzinfo=timezone.utc)

            if next_retry <= eval_time:
                # Due for re-admission!
                prev_state_val = rec_info.get("previous_state", RunState.STARTING.value)
                target_state = RunState(prev_state_val)

                # Transition RETRY_WAIT -> previous_active_state
                run = self.orchestration_service.transition_run_state(
                    workspace_id=run.workspace_id,
                    run_id=run.id,
                    target_state=target_state,
                    db=db,
                    reason="Scheduled retry window arrived; re-admitting run.",
                )

                # Increment attempt count
                run.attempt_count += 1
                db.commit()

                # Enqueue or re-arm job
                job = QueueJob(
                    run_id=run.id,
                    workspace_id=run.workspace_id,
                    site_id=run.site_id,
                    run_type=run.run_type,
                    attempt_count=run.attempt_count,
                    priority=5,
                    enqueued_at=_utc_now(),
                    visible_at=_utc_now(),
                    payload={"is_retry": True, "attempt": run.attempt_count},
                )
                queue.enqueue(job)

                logger.info(
                    "Re-admitted run '%s' from RETRY_WAIT to '%s' (attempt %d)",
                    run.id,
                    target_state.value,
                    run.attempt_count,
                )
                resumed_runs.append(run)

        return resumed_runs
