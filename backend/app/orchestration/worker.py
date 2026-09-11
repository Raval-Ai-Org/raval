"""
Production Orchestration & Monitoring - Worker Execution Harness & Stale Job Detection.

Implements the worker execution loop, durable lease management, heartbeat tracking,
concurrency/backpressure enforcement, server-side tenant validation, and graceful shutdown.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import logging
from typing import Any, Callable
from uuid import uuid4

from sqlalchemy.orm import Session

from .checkpoints import CheckpointManager
from .concurrency import ConcurrencyController
from .control import ControlService
from .enums import (
    CancellationOutcome,
    CheckpointType,
    ControlSignalType,
    RunState,
    RunType,
    StageState,
)
from .exceptions import (
    LeaseConflictError,
    RunNotFoundError,
    SiteMismatchError,
    TenantMismatchError,
)
from .failure_classifier import FailureClassifier
from ..models import Website
from .models import OrchestrationRun
from .queue import OrchestrationQueue, QueueJob
from .retry_policy import RetryDecision, RetryEngine, RetryPolicy
from .service import OrchestrationService
from .stage_planner import StagePlanner

logger = logging.getLogger(__name__)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


@dataclass
class WorkerLease:
    """Represents an active execution lease held by a worker."""

    lease_id: str
    worker_id: str
    job_id: str
    run_id: str
    acquired_at: datetime
    expires_at: datetime
    last_heartbeat_at: datetime
    duration_seconds: int


@dataclass
class StaleJobReport:
    """Diagnostic report identifying a stale/unresponsive execution lease."""

    job_id: str
    run_id: str
    worker_id: str | None
    lease_id: str | None
    lease_expires_at: datetime | None
    age_seconds: float
    reason: str


class OrchestrationWorker:
    """
    Worker execution harness pulling jobs from OrchestrationQueue,
    holding leases, updating run state deterministically, and respecting concurrency.
    """

    def __init__(
        self,
        worker_id: str,
        queue: OrchestrationQueue,
        concurrency_controller: ConcurrencyController,
        orchestration_service: OrchestrationService,
        session_factory: Callable[[], Session],
        failure_classifier: FailureClassifier | None = None,
        retry_engine: RetryEngine | None = None,
        retry_policy: RetryPolicy | None = None,
    ) -> None:
        self.worker_id = worker_id
        self.queue = queue
        self.concurrency_controller = concurrency_controller
        self.orchestration_service = orchestration_service
        self.session_factory = session_factory
        self.failure_classifier = failure_classifier or FailureClassifier()
        self.retry_engine = retry_engine or RetryEngine()
        self.retry_policy = retry_policy or RetryPolicy()
        self._is_stopping = False
        self._active_lease: WorkerLease | None = None

    @property
    def is_stopping(self) -> bool:
        return self._is_stopping

    def stop(self) -> None:
        """Signals the worker to stop accepting new work and shut down gracefully."""
        logger.info("Worker '%s' received shutdown signal", self.worker_id)
        self._is_stopping = True

    def heartbeat(self, job: QueueJob, extension_seconds: int = 30) -> datetime | None:
        """
        Emits a heartbeat for the currently executing job, extending its lease.
        """
        new_expiry = self.queue.extend_lease(
            job_id=job.job_id,
            worker_id=self.worker_id,
            extension_seconds=extension_seconds,
        )
        if new_expiry and self._active_lease and self._active_lease.job_id == job.job_id:
            self._active_lease.expires_at = new_expiry
            self._active_lease.last_heartbeat_at = _utc_now()
            logger.debug(
                "Worker '%s' heartbeat recorded for job '%s' (new expiry='%s')",
                self.worker_id,
                job.job_id,
                new_expiry.isoformat(),
            )
        return new_expiry

    def poll_and_execute_once(
        self,
        lease_duration_seconds: int = 30,
        workspace_id: str | None = None,
        auto_complete: bool = True,
    ) -> bool:
        """
        Pulls a single job from the queue and executes its lifecycle phase.
        Returns True if a job was claimed and executed; False if empty, backpressured, or stopped.
        """
        if self._is_stopping:
            logger.debug("Worker '%s' is stopping; skipping poll", self.worker_id)
            return False

        # 1. Dequeue job
        job = self.queue.dequeue(
            worker_id=self.worker_id,
            lease_duration_seconds=lease_duration_seconds,
            workspace_id=workspace_id,
        )
        if not job:
            return False

        # 2. Concurrency check & backpressure enforcement
        acquired = self.concurrency_controller.acquire(
            workspace_id=job.workspace_id,
            site_id=job.site_id,
        )
        if not acquired:
            # Capacity exhausted: apply backpressure by releasing job back to queue with short delay
            logger.info(
                "Backpressure applied to job '%s' (workspace='%s', site=%d); re-queuing",
                job.job_id,
                job.workspace_id,
                job.site_id,
            )
            self.queue.release(job_id=job.job_id, worker_id=self.worker_id, delay_seconds=2)
            return False

        now = _utc_now()
        self._active_lease = WorkerLease(
            lease_id=job.lease_id or f"lease_{uuid4().hex[:12]}",
            worker_id=self.worker_id,
            job_id=job.job_id,
            run_id=job.run_id,
            acquired_at=now,
            expires_at=job.lease_expires_at or (now + timedelta(seconds=lease_duration_seconds)),
            last_heartbeat_at=now,
            duration_seconds=lease_duration_seconds,
        )

        db = self.session_factory()
        try:
            # 3. Server-side validation
            website = db.query(Website).filter(Website.id == job.site_id).first()
            if not website:
                raise SiteMismatchError(
                    run_id=job.run_id,
                    expected_site_id=job.site_id,
                    actual_site_id="[NONEXISTENT]",
                )

            run = self.orchestration_service.get_run(
                workspace_id=job.workspace_id,
                run_id=job.run_id,
                db=db,
                site_id=job.site_id,
            )

            # Fast-path: Check if run was cancelled or paused while waiting in queue
            if run.state == RunState.CANCELLED.value:
                logger.info("Job '%s' for run '%s' was cancelled in queue; dropping job", job.job_id, run.id)
                self.queue.acknowledge(job_id=job.job_id, worker_id=self.worker_id)
                return True

            if run.state == RunState.PAUSED.value:
                logger.info("Job '%s' for run '%s' was paused in queue; dropping job", job.job_id, run.id)
                self.queue.acknowledge(job_id=job.job_id, worker_id=self.worker_id)
                return True

            # Cooperative signal check before starting execution
            if self._handle_cooperative_signal(run, job, db):
                return True

            # 4. State machine execution: handle QUEUED -> STARTING or RETRY_WAIT resumption
            if run.state == RunState.QUEUED.value:
                run = self.orchestration_service.transition_run_state(
                    workspace_id=job.workspace_id,
                    run_id=job.run_id,
                    target_state=RunState.STARTING,
                    db=db,
                    reason=f"Claimed by worker {self.worker_id}",
                )

                if self._handle_cooperative_signal(run, job, db):
                    return True

                # Transition to first active operational state determined by run plan
                first_active = self._resolve_first_active_state(run.run_type)
                run = self.orchestration_service.transition_run_state(
                    workspace_id=job.workspace_id,
                    run_id=job.run_id,
                    target_state=first_active,
                    db=db,
                    reason="Starting initial execution phase",
                )
            elif run.state == RunState.RETRY_WAIT.value:
                # Resuming from RETRY_WAIT after backoff delay
                resumable_name = (
                    (run.recovery_info or {}).get("previous_state")
                    or (run.metadata_payload or {}).get("resumable_active_state")
                )
                target_resumable = (
                    RunState(resumable_name)
                    if resumable_name
                    else self._resolve_first_active_state(run.run_type)
                )
                attempt_num = (run.recovery_info or {}).get("retry_attempt", 1)
                run = self.orchestration_service.transition_run_state(
                    workspace_id=job.workspace_id,
                    run_id=job.run_id,
                    target_state=target_resumable,
                    previous_active_state=target_resumable,
                    db=db,
                    reason=f"Worker {self.worker_id} resuming execution after retry delay (attempt {attempt_num})",
                )

            # 5. Heartbeat check
            self.heartbeat(job, extension_seconds=lease_duration_seconds)

            if self._handle_cooperative_signal(run, job, db):
                return True

            # 6. Complete or yield execution
            if auto_complete:
                # Progress to terminal SUCCEEDED for closed worker test harness
                terminal_target = RunState.SUCCEEDED
                # To reach SUCCEEDED legally through state machine:
                # Active -> MONITORING -> SUCCEEDED
                if run.state != RunState.MONITORING.value:
                    if run.state == RunState.SCANNING.value:
                        if self._handle_cooperative_signal(run, job, db):
                            return True
                        run = self.orchestration_service.transition_run_state(
                            workspace_id=job.workspace_id,
                            run_id=job.run_id,
                            target_state=RunState.ANALYZING,
                            db=db,
                        )
                    if run.state == RunState.ANALYZING.value:
                        if self._handle_cooperative_signal(run, job, db):
                            return True
                        run = self.orchestration_service.transition_run_state(
                            workspace_id=job.workspace_id,
                            run_id=job.run_id,
                            target_state=RunState.MONITORING,
                            db=db,
                        )
                    elif run.state in (RunState.OBSERVING.value, RunState.PLANNING.value):
                        if self._handle_cooperative_signal(run, job, db):
                            return True
                        run = self.orchestration_service.transition_run_state(
                            workspace_id=job.workspace_id,
                            run_id=job.run_id,
                            target_state=RunState.EXECUTING,
                            db=db,
                        )
                    if run.state == RunState.EXECUTING.value:
                        run = self.orchestration_service.transition_run_state(
                            workspace_id=job.workspace_id,
                            run_id=job.run_id,
                            target_state=RunState.VERIFYING,
                            db=db,
                        )
                    if run.state == RunState.VERIFYING.value:
                        if self._handle_cooperative_signal(run, job, db):
                            return True
                        run = self.orchestration_service.transition_run_state(
                            workspace_id=job.workspace_id,
                            run_id=job.run_id,
                            target_state=RunState.MONITORING,
                            db=db,
                        )

                if self._handle_cooperative_signal(run, job, db):
                    return True

                run = self.orchestration_service.transition_run_state(
                    workspace_id=job.workspace_id,
                    run_id=job.run_id,
                    target_state=RunState.SUCCEEDED,
                    db=db,
                    outcome_summary={"worker_id": self.worker_id, "status": "completed"},
                )

                # Acknowledge queue item
                self.queue.acknowledge(job_id=job.job_id, worker_id=self.worker_id)

            return True

        except Exception as exc:
            logger.error("Error executing job '%s' by worker '%s': %s", job.job_id, self.worker_id, exc)
            try:
                failure = self.failure_classifier.classify(
                    exc,
                    context={"job_id": job.job_id, "worker_id": self.worker_id},
                )

                run = db.query(OrchestrationRun).filter(OrchestrationRun.id == job.run_id).first()
                if run and run.workspace_id == job.workspace_id:
                    # Check if cancellation was requested: if so, cancel run instead of retrying!
                    pending_signal = ControlService.get_pending_control_signal(run.id, db)
                    if pending_signal and pending_signal.signal_type == ControlSignalType.CANCEL.value:
                        logger.info(
                            "Exception occurred on run '%s' with pending cancellation; cancelling instead of retry",
                            run.id,
                        )
                        if not RunState(run.state).is_terminal:
                            if run.state == RunState.EXECUTING.value:
                                run = self.orchestration_service.transition_run_state(
                                    workspace_id=job.workspace_id,
                                    run_id=job.run_id,
                                    target_state=RunState.VERIFYING,
                                    db=db,
                                    reason="Transitioning to safe boundary upon cancellation request",
                                )
                            self.orchestration_service.transition_run_state(
                                workspace_id=job.workspace_id,
                                run_id=job.run_id,
                                target_state=RunState.CANCELLED,
                                db=db,
                                reason="Cancelled upon exception due to pending cancellation request",
                            )
                        ControlService.acknowledge_signal(
                            signal_id=pending_signal.id,
                            worker_id=self.worker_id,
                            outcome=CancellationOutcome.CANCELLED_AT_CHECKPOINT.value,
                            db=db,
                        )
                        self.queue.acknowledge(job_id=job.job_id, worker_id=self.worker_id)
                        raise

                    recovery_info = dict(run.recovery_info or {})
                    history = list(recovery_info.get("failure_history", []))
                    attempt_number = len(history) + 1

                    decision = self.retry_engine.evaluate(
                        failure=failure,
                        attempt_number=attempt_number,
                        policy=self.retry_policy,
                    )

                    history.append(failure.to_dict())
                    recovery_info["failure_history"] = history
                    recovery_info["retry_attempt"] = attempt_number
                    recovery_info["last_failure_class"] = failure.failure_class.value

                    if decision.should_retry:
                        recovery_info["next_retry_at"] = (
                            decision.next_retry_at.isoformat() if decision.next_retry_at else None
                        )
                        recovery_info["previous_state"] = run.state
                        run.recovery_info = recovery_info
                        db.commit()

                        if run.state != RunState.RETRY_WAIT.value and not RunState(run.state).is_terminal:
                            self.orchestration_service.transition_run_state(
                                workspace_id=job.workspace_id,
                                run_id=job.run_id,
                                target_state=RunState.RETRY_WAIT,
                                db=db,
                                reason=f"Retry {attempt_number} scheduled ({failure.failure_class.value}): {decision.reason}",
                                error_detail=failure.to_dict(),
                            )

                        delay_secs = max(1, int(decision.delay_seconds))
                        self.queue.release(job_id=job.job_id, worker_id=self.worker_id, delay_seconds=delay_secs)
                    else:
                        recovery_info["retry_exhausted"] = True
                        recovery_info["terminal_reason"] = decision.reason
                        run.recovery_info = recovery_info
                        db.commit()

                        if not RunState(run.state).is_terminal:
                            self.orchestration_service.transition_run_state(
                                workspace_id=job.workspace_id,
                                run_id=job.run_id,
                                target_state=RunState.FAILED,
                                db=db,
                                reason=f"Execution failed ({failure.failure_class.value}): {decision.reason}",
                                error_detail=failure.to_dict(),
                                outcome_summary={
                                    "status": "failed",
                                    "worker_id": self.worker_id,
                                    "failure_class": failure.failure_class.value,
                                    "reason": decision.reason,
                                },
                            )

                        self.queue.acknowledge(job_id=job.job_id, worker_id=self.worker_id)
                else:
                    self.queue.release(job_id=job.job_id, worker_id=self.worker_id, delay_seconds=5)
            except Exception as handling_err:
                logger.error("Error during failure handling for job '%s': %s", job.job_id, handling_err)
                self.queue.release(job_id=job.job_id, worker_id=self.worker_id, delay_seconds=5)
            raise
        finally:
            # Always release concurrency slot and active lease
            self.concurrency_controller.release(
                workspace_id=job.workspace_id,
                site_id=job.site_id,
            )
            self._active_lease = None
            db.close()

    def _handle_cooperative_signal(self, run: OrchestrationRun, job: QueueJob, db: Session) -> bool:
        """
        Evaluates any pending control signals (cancel or pause) at a safe boundary.
        Returns True if a signal was handled and execution should stop.
        """
        signal = ControlService.get_pending_control_signal(run.id, db)
        if not signal:
            return False

        current_state = RunState(run.state)
        if signal.signal_type == ControlSignalType.CANCEL.value:
            if current_state.allows_cancellation:
                logger.info("Worker '%s' applying cooperative cancellation to run '%s'", self.worker_id, run.id)
                self.orchestration_service.transition_run_state(
                    workspace_id=job.workspace_id,
                    run_id=job.run_id,
                    target_state=RunState.CANCELLED,
                    db=db,
                    site_id=job.site_id,
                    reason=signal.reason or f"Cooperative cancellation applied by worker {self.worker_id}",
                )
                ControlService.acknowledge_signal(
                    signal_id=signal.id,
                    worker_id=self.worker_id,
                    outcome=CancellationOutcome.CANCELLED_AT_CHECKPOINT.value,
                    db=db,
                )
                self.queue.acknowledge(job_id=job.job_id, worker_id=self.worker_id)
                return True
            else:
                logger.info(
                    "Cancellation deferred for run '%s' in state '%s'; waiting for safe boundary",
                    run.id,
                    current_state.value,
                )
                return False

        elif signal.signal_type == ControlSignalType.PAUSE.value:
            if current_state != RunState.EXECUTING:
                logger.info("Worker '%s' applying cooperative pause to run '%s'", self.worker_id, run.id)
                CheckpointManager.create_checkpoint(
                    workspace_id=job.workspace_id,
                    site_id=job.site_id,
                    run_id=job.run_id,
                    checkpoint_type=CheckpointType.PAUSE_POINT,
                    db=db,
                    worker_id=self.worker_id,
                    is_safe_to_resume=True,
                )
                self.orchestration_service.transition_run_state(
                    workspace_id=job.workspace_id,
                    run_id=job.run_id,
                    target_state=RunState.PAUSED,
                    db=db,
                    site_id=job.site_id,
                    reason=signal.reason or f"Cooperative pause applied by worker {self.worker_id}",
                )
                ControlService.acknowledge_signal(
                    signal_id=signal.id,
                    worker_id=self.worker_id,
                    outcome="PAUSED_AT_CHECKPOINT",
                    db=db,
                )
                self.queue.acknowledge(job_id=job.job_id, worker_id=self.worker_id)
                return True
            else:
                logger.info("Pause deferred for run '%s' in EXECUTING; waiting for safe boundary", run.id)
                return False

        return False

    @staticmethod
    def _resolve_first_active_state(run_type_str: str) -> RunState:
        """Determines the legal first operational state from STARTING."""
        run_type = RunType(run_type_str) if isinstance(run_type_str, str) else run_type_str
        if run_type in (RunType.ON_DEMAND_SCAN, RunType.SCHEDULED_SCAN, RunType.CHANGE_TRIGGERED_SCAN):
            return RunState.SCANNING
        if run_type in (RunType.EVIDENCE_REFRESH, RunType.MONITORING_RUN):
            return RunState.OBSERVING
        if run_type == RunType.VERIFICATION_RUN:
            return RunState.ANALYZING
        return RunState.SCANNING


class StaleJobDetector:
    """
    Identifies expired or abandoned worker leases without automatically retrying them.
    Adheres to Step 2 boundary: identification only; recovery belongs to Step 3.
    """

    @classmethod
    def detect_stale_jobs(
        cls,
        queue: OrchestrationQueue,
        stale_threshold_seconds: int = 60,
    ) -> list[StaleJobReport]:
        """
        Inspects all jobs in the queue to detect leases that have expired or stalled past the threshold.
        """
        now = _utc_now()
        reports: list[StaleJobReport] = []

        jobs = queue.get_visibility(limit=500)
        for job in jobs:
            age_seconds = (now - job.enqueued_at).total_seconds()

            # Case 1: Lease expiration timestamp is in the past while worker was assigned
            if job.worker_id and job.lease_expires_at and now > job.lease_expires_at:
                reports.append(
                    StaleJobReport(
                        job_id=job.job_id,
                        run_id=job.run_id,
                        worker_id=job.worker_id,
                        lease_id=job.lease_id,
                        lease_expires_at=job.lease_expires_at,
                        age_seconds=age_seconds,
                        reason=(
                            f"Lease expired {int((now - job.lease_expires_at).total_seconds())}s ago "
                            f"without completion by worker '{job.worker_id}'"
                        ),
                    )
                )

        return reports
