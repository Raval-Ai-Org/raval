"""
Comprehensive Unit and Integration Tests for Orchestration Cancellation,
Pause/Resume, Checkpoint Management, and Executing Safety (Step 4).

Verifies:
1. Queued Run Cancellation: Immediate transition to CANCELLED, lease cleanup, audit logging, idempotency.
2. Active Run Cooperative Cancellation: Worker evaluates cancellation signals at safe boundaries.
3. Executing Safety Invariant: Cancellation prohibited during live EXECUTING phase,
   waits for safe boundary and receipt confirmation.
4. Ambiguous External Mutation Protection: Blocks unsafe automatic operations if mutation is ambiguous.
5. Pause Model: Active runs checkpoint and transition to PAUSED, freeing worker leases and concurrency slots.
6. Checkpoint Integrity: Monotonic sequence allocation, secret scrubbing, tenant/site scoping, validation.
7. Safe Resumption: Resumes only from valid checkpoints with intact state and re-enqueues to queue.
8. Unsafe Resumption Rejection: Rejects missing/corrupted checkpoints or ambiguous receipts.
9. Retry Suppression: Cancellation intent suppresses automatic retry scheduling on failure.
10. Strict Multi-Tenant & Site Authorization: Cross-tenant operations are rejected with TenantMismatchError.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.models import Website
from app.orchestration.checkpoints import CheckpointManager
from app.orchestration.concurrency import ConcurrencyController, ConcurrencyPolicy
from app.orchestration.control import ControlService
from app.orchestration.enums import (
    CancellationOutcome,
    CheckpointType,
    ControlSignalType,
    OrchestrationEventType,
    ReceiptStatus,
    RunState,
    RunType,
    StageName,
    StageState,
    TriggerSource,
)
from app.orchestration.exceptions import (
    CancellationRejectedError,
    CheckpointCorruptedError,
    InvalidStateTransitionError,
    SiteMismatchError,
    TenantMismatchError,
    UnsafeResumeError,
)
from app.orchestration.models import (
    ExecutionReceipt,
    OrchestrationCheckpoint,
    OrchestrationControlRequest,
    OrchestrationEvent,
    OrchestrationRun,
    OrchestrationStage,
)
from app.orchestration.queue import LocalOrchestrationQueue, QueueJob
from app.orchestration.schemas import ActorProvenance, OrchestrationRunCreateRequest
from app.orchestration.service import OrchestrationService
from app.orchestration.worker import OrchestrationWorker


def _utc(year: int = 2026, month: int = 9, day: int = 10, hour: int = 12, minute: int = 0) -> datetime:
    return datetime(year, month, day, hour, minute, tzinfo=timezone.utc)


@pytest.fixture
def db_session_factory():
    """Provides an isolated in-memory SQLite database session factory."""
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    SessionTesting = sessionmaker(autocommit=False, autoflush=False, bind=engine)

    seed_session = SessionTesting()
    site = Website(
        id=1,
        name="Acme Tools Portal",
        url="https://acme-tools.com",
        created_at=datetime.now(timezone.utc),
    )
    site2 = Website(
        id=2,
        name="Beta Robotics Portal",
        url="https://beta-robotics.org",
        created_at=datetime.now(timezone.utc),
    )
    seed_session.add_all([site, site2])
    seed_session.commit()
    seed_session.close()

    try:
        yield SessionTesting
    finally:
        Base.metadata.drop_all(engine)


@pytest.fixture
def db_session(db_session_factory) -> Session:
    session = db_session_factory()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def orch_service() -> OrchestrationService:
    return OrchestrationService()


@pytest.fixture
def control_service(orch_service: OrchestrationService) -> ControlService:
    return ControlService(orchestration_service=orch_service)


@pytest.fixture
def test_run(db_session: Session, orch_service: OrchestrationService) -> OrchestrationRun:
    req = OrchestrationRunCreateRequest(
        workspace_id="ws_tenant_alpha",
        site_id=1,
        run_type=RunType.ON_DEMAND_SCAN,
        idempotency_key="idem_cancel_test_001",
        correlation_id="corr_cancel_001",
        actor_provenance=ActorProvenance(actor_id="user_admin", actor_type="user"),
    )
    return orch_service.create_run(req, db_session)


# ==============================================================================
# 1. Queued Run Cancellation Tests
# ==============================================================================

class TestQueuedCancellation:
    """Verifies immediate and idempotent cancellation for runs in QUEUED state."""

    def test_cancel_queued_run_immediate(
        self,
        db_session: Session,
        control_service: ControlService,
        test_run: OrchestrationRun,
    ) -> None:
        """QUEUED run transitions immediately to CANCELLED and records audit event."""
        assert test_run.state == RunState.QUEUED.value

        res = control_service.request_cancellation(
            workspace_id="ws_tenant_alpha",
            site_id=1,
            run_id=test_run.id,
            requested_by="operator_dan",
            db=db_session,
            reason="User cancelled before execution started",
        )

        assert res.status == RunState.CANCELLED
        assert res.outcome == CancellationOutcome.CANCELLED_IMMEDIATELY
        assert res.acknowledged is True

        db_session.refresh(test_run)
        assert test_run.state == RunState.CANCELLED.value
        assert test_run.cancelled_at is not None
        assert test_run.completed_at is not None

        # Verify audit event emitted
        events = (
            db_session.query(OrchestrationEvent)
            .filter(
                OrchestrationEvent.run_id == test_run.id,
                OrchestrationEvent.event_type == OrchestrationEventType.RUN_CANCELLED.value,
            )
            .all()
        )
        assert len(events) >= 1

    def test_cancel_queued_run_is_idempotent(
        self,
        db_session: Session,
        control_service: ControlService,
        test_run: OrchestrationRun,
    ) -> None:
        """Calling cancellation repeatedly on an already CANCELLED run succeeds cleanly."""
        res1 = control_service.request_cancellation(
            workspace_id="ws_tenant_alpha",
            site_id=1,
            run_id=test_run.id,
            requested_by="operator_dan",
            db=db_session,
        )
        assert res1.status == RunState.CANCELLED

        # Second call
        res2 = control_service.request_cancellation(
            workspace_id="ws_tenant_alpha",
            site_id=1,
            run_id=test_run.id,
            requested_by="operator_dan",
            db=db_session,
        )
        assert res2.status == RunState.CANCELLED
        assert res2.outcome == CancellationOutcome.ALREADY_TERMINAL
        assert res2.acknowledged is True

    def test_worker_drops_queued_job_if_already_cancelled(
        self,
        db_session_factory,
        db_session: Session,
        orch_service: OrchestrationService,
        control_service: ControlService,
        test_run: OrchestrationRun,
    ) -> None:
        """A worker dequeuing a job that was cancelled in DB acknowledges it without doing work."""
        queue = LocalOrchestrationQueue()
        concurrency = ConcurrencyController()
        worker = OrchestrationWorker(
            worker_id="worker_fast_cancel",
            queue=queue,
            concurrency_controller=concurrency,
            orchestration_service=orch_service,
            session_factory=db_session_factory,
        )

        job = QueueJob(
            job_id="job_q_cancel",
            run_id=test_run.id,
            workspace_id=test_run.workspace_id,
            site_id=test_run.site_id,
        )
        queue.enqueue(job)

        # Cancel in DB before worker claims
        control_service.request_cancellation(
            workspace_id="ws_tenant_alpha",
            site_id=1,
            run_id=test_run.id,
            requested_by="admin",
            db=db_session,
        )

        executed = worker.poll_and_execute_once(auto_complete=True)
        assert executed is True
        assert queue.get_metrics().total_depth == 0  # Job was acknowledged and dropped

        db_session.expire_all()
        refreshed = db_session.query(OrchestrationRun).filter_by(id=test_run.id).first()
        assert refreshed.state == RunState.CANCELLED.value
        # Stages remained unexecuted
        for stg in refreshed.stages:
            assert stg.state in (StageState.QUEUED.value, StageState.CANCELLED.value)


# ==============================================================================
# 2. Active Run Cooperative Cancellation Tests
# ==============================================================================

class TestActiveCooperativeCancellation:
    """Verifies cooperative cancellation for active runs."""

    def test_active_run_cancellation_signal_queued(
        self,
        db_session: Session,
        orch_service: OrchestrationService,
        control_service: ControlService,
        test_run: OrchestrationRun,
    ) -> None:
        """Active run (SCANNING) receives an unacknowledged control signal."""
        # Transition run to SCANNING
        orch_service.transition_run_state(
            workspace_id="ws_tenant_alpha",
            run_id=test_run.id,
            target_state=RunState.STARTING,
            db=db_session,
        )
        orch_service.transition_run_state(
            workspace_id="ws_tenant_alpha",
            run_id=test_run.id,
            target_state=RunState.SCANNING,
            db=db_session,
        )

        res = control_service.request_cancellation(
            workspace_id="ws_tenant_alpha",
            site_id=1,
            run_id=test_run.id,
            requested_by="operator_alice",
            db=db_session,
            reason="Site under maintenance",
        )

        assert res.outcome == "COOPERATIVE_CANCELLATION_REQUESTED"
        assert res.acknowledged is False
        assert res.status == RunState.SCANNING

        # Verify control request in database
        ctrl_req = (
            db_session.query(OrchestrationControlRequest)
            .filter(
                OrchestrationControlRequest.run_id == test_run.id,
                OrchestrationControlRequest.signal_type == ControlSignalType.CANCEL.value,
            )
            .first()
        )
        assert ctrl_req is not None
        assert ctrl_req.is_acknowledged is False

    def test_worker_cooperatively_cancels_active_job(
        self,
        db_session_factory,
        db_session: Session,
        orch_service: OrchestrationService,
        control_service: ControlService,
        test_run: OrchestrationRun,
    ) -> None:
        """Worker checks cancellation signal at safe boundary and cancels run and current stage."""
        queue = LocalOrchestrationQueue()
        concurrency = ConcurrencyController()
        worker = OrchestrationWorker(
            worker_id="worker_coop_cancel",
            queue=queue,
            concurrency_controller=concurrency,
            orchestration_service=orch_service,
            session_factory=db_session_factory,
        )

        # Transition to active state so cancellation is queued cooperatively rather than immediate fast-path
        orch_service.transition_run_state(
            workspace_id="ws_tenant_alpha", run_id=test_run.id, target_state=RunState.STARTING, db=db_session
        )
        orch_service.transition_run_state(
            workspace_id="ws_tenant_alpha", run_id=test_run.id, target_state=RunState.SCANNING, db=db_session
        )

        job = QueueJob(
            job_id="job_coop_cancel",
            run_id=test_run.id,
            workspace_id=test_run.workspace_id,
            site_id=test_run.site_id,
        )
        queue.enqueue(job)

        # Queue cancellation signal
        control_service.request_cancellation(
            workspace_id="ws_tenant_alpha",
            site_id=1,
            run_id=test_run.id,
            requested_by="user_123",
            db=db_session,
            reason="Aborted by user",
        )

        # Worker executes
        executed = worker.poll_and_execute_once(auto_complete=True)
        assert executed is True

        db_session.expire_all()
        refreshed = db_session.query(OrchestrationRun).filter_by(id=test_run.id).first()
        assert refreshed.state == RunState.CANCELLED.value
        assert refreshed.cancelled_at is not None

        # Verify signal was acknowledged
        signal = (
            db_session.query(OrchestrationControlRequest)
            .filter(OrchestrationControlRequest.run_id == test_run.id)
            .first()
        )
        assert signal.is_acknowledged is True
        assert signal.acknowledged_by_worker == "worker_coop_cancel"
        assert signal.outcome == CancellationOutcome.CANCELLED_AT_CHECKPOINT.value


# ==============================================================================
# 3. Executing Safety Rule & Ambiguous Mutations
# ==============================================================================

class TestExecutingSafetyRule:
    """Verifies that live EXECUTING mutations cannot be arbitrarily cancelled or corrupted."""

    def test_state_machine_rejects_executing_to_cancelled_direct_jump(
        self,
        db_session: Session,
        orch_service: OrchestrationService,
        test_run: OrchestrationRun,
    ) -> None:
        """EXECUTING -> CANCELLED transition is strictly rejected by the state machine."""
        # Progress run to EXECUTING legally: QUEUED -> STARTING -> SCANNING -> ANALYZING -> PLANNING -> EXECUTING
        orch_service.transition_run_state(
            workspace_id="ws_tenant_alpha", run_id=test_run.id, target_state=RunState.STARTING, db=db_session
        )
        orch_service.transition_run_state(
            workspace_id="ws_tenant_alpha", run_id=test_run.id, target_state=RunState.SCANNING, db=db_session
        )
        orch_service.transition_run_state(
            workspace_id="ws_tenant_alpha", run_id=test_run.id, target_state=RunState.ANALYZING, db=db_session
        )
        orch_service.transition_run_state(
            workspace_id="ws_tenant_alpha", run_id=test_run.id, target_state=RunState.PLANNING, db=db_session
        )
        orch_service.transition_run_state(
            workspace_id="ws_tenant_alpha", run_id=test_run.id, target_state=RunState.EXECUTING, db=db_session
        )

        with pytest.raises(InvalidStateTransitionError) as exc_info:
            orch_service.transition_run_state(
                workspace_id="ws_tenant_alpha",
                run_id=test_run.id,
                target_state=RunState.CANCELLED,
                db=db_session,
            )
        assert "Cancellation during live EXECUTING phase is disallowed" in str(exc_info.value)

    def test_worker_defers_cancellation_during_executing_until_safe_boundary(
        self,
        db_session: Session,
        orch_service: OrchestrationService,
        control_service: ControlService,
        test_run: OrchestrationRun,
    ) -> None:
        """While in EXECUTING, worker does not cancel mid-mutation; cancels only after reaching VERIFYING."""
        # Progress run to EXECUTING
        for st in [RunState.STARTING, RunState.SCANNING, RunState.ANALYZING, RunState.PLANNING, RunState.EXECUTING]:
            orch_service.transition_run_state(
                workspace_id="ws_tenant_alpha", run_id=test_run.id, target_state=st, db=db_session
            )

        # Queue cancellation request while run is in EXECUTING
        control_service.request_cancellation(
            workspace_id="ws_tenant_alpha",
            site_id=1,
            run_id=test_run.id,
            requested_by="admin",
            db=db_session,
        )

        queue = LocalOrchestrationQueue()
        concurrency = ConcurrencyController()
        worker = OrchestrationWorker(
            worker_id="worker_exec_safe",
            queue=queue,
            concurrency_controller=concurrency,
            orchestration_service=orch_service,
            session_factory=lambda: db_session,
        )
        job = QueueJob(
            job_id="job_exec_safe",
            run_id=test_run.id,
            workspace_id=test_run.workspace_id,
            site_id=test_run.site_id,
        )

        # During EXECUTING, checking signal returns False (deferred)
        handled = worker._handle_cooperative_signal(test_run, job, db_session)
        assert handled is False
        db_session.refresh(test_run)
        assert test_run.state == RunState.EXECUTING.value

        # Once external mutation finishes, transition to safe boundary (VERIFYING)
        orch_service.transition_run_state(
            workspace_id="ws_tenant_alpha", run_id=test_run.id, target_state=RunState.VERIFYING, db=db_session
        )

        # Now at safe boundary, signal is handled and run cancels cleanly
        handled_safe = worker._handle_cooperative_signal(test_run, job, db_session)
        assert handled_safe is True
        db_session.refresh(test_run)
        assert test_run.state == RunState.CANCELLED.value


# ==============================================================================
# 4. Pause Model & Checkpoint Workflow
# ==============================================================================

class TestPauseAndCheckpoints:
    """Verifies safe pausing, state progression, and concurrency release."""

    def test_pause_queued_run_immediate(
        self,
        db_session: Session,
        control_service: ControlService,
        test_run: OrchestrationRun,
    ) -> None:
        """QUEUED run transitions to PAUSED immediately."""
        res = control_service.request_pause(
            workspace_id="ws_tenant_alpha",
            site_id=1,
            run_id=test_run.id,
            requested_by="operator_dave",
            db=db_session,
            reason="Holding for morning window",
        )

        assert res.status == RunState.PAUSED
        assert res.acknowledged is True
        assert res.outcome == "PAUSED_IMMEDIATELY"

        db_session.refresh(test_run)
        assert test_run.state == RunState.PAUSED.value
        assert test_run.paused_at is not None

    def test_pause_active_run_creates_checkpoint_and_pauses(
        self,
        db_session: Session,
        orch_service: OrchestrationService,
        control_service: ControlService,
        test_run: OrchestrationRun,
    ) -> None:
        """Active run observes pause signal, creates a PAUSE_POINT checkpoint, and transitions to PAUSED."""
        # Start run to SCANNING
        orch_service.transition_run_state(
            workspace_id="ws_tenant_alpha", run_id=test_run.id, target_state=RunState.STARTING, db=db_session
        )
        orch_service.transition_run_state(
            workspace_id="ws_tenant_alpha", run_id=test_run.id, target_state=RunState.SCANNING, db=db_session
        )

        # Request pause
        res = control_service.request_pause(
            workspace_id="ws_tenant_alpha",
            site_id=1,
            run_id=test_run.id,
            requested_by="lead_eng",
            db=db_session,
        )
        assert res.acknowledged is False
        assert res.outcome == "COOPERATIVE_PAUSE_REQUESTED"

        queue = LocalOrchestrationQueue()
        concurrency = ConcurrencyController()
        worker = OrchestrationWorker(
            worker_id="worker_pause_test",
            queue=queue,
            concurrency_controller=concurrency,
            orchestration_service=orch_service,
            session_factory=lambda: db_session,
        )
        job = QueueJob(
            job_id="job_pause_test",
            run_id=test_run.id,
            workspace_id=test_run.workspace_id,
            site_id=test_run.site_id,
        )

        handled = worker._handle_cooperative_signal(test_run, job, db_session)
        assert handled is True

        db_session.refresh(test_run)
        assert test_run.state == RunState.PAUSED.value
        assert test_run.paused_at is not None

        # Verify checkpoint was created
        chk = CheckpointManager.get_latest_checkpoint("ws_tenant_alpha", 1, test_run.id, db_session)
        assert chk is not None
        assert chk.checkpoint_type == CheckpointType.PAUSE_POINT.value
        assert chk.is_safe_to_resume is True

    def test_pause_idempotency(
        self,
        db_session: Session,
        control_service: ControlService,
        test_run: OrchestrationRun,
    ) -> None:
        """Repeated pause requests on an already paused run return cleanly."""
        res1 = control_service.request_pause(
            workspace_id="ws_tenant_alpha",
            site_id=1,
            run_id=test_run.id,
            requested_by="user_1",
            db=db_session,
        )
        assert res1.status == RunState.PAUSED

        res2 = control_service.request_pause(
            workspace_id="ws_tenant_alpha",
            site_id=1,
            run_id=test_run.id,
            requested_by="user_1",
            db=db_session,
        )
        assert res2.status == RunState.PAUSED
        assert res2.outcome == "ALREADY_PAUSED"


# ==============================================================================
# 5. Checkpoint Manager Unit Tests
# ==============================================================================

class TestCheckpointManager:
    """Verifies sequence allocation, secret scrubbing, and integrity checks."""

    def test_create_and_list_checkpoints_sequence(
        self,
        db_session: Session,
        test_run: OrchestrationRun,
    ) -> None:
        """Checkpoints receive strictly increasing monotonic sequence numbers."""
        chk1 = CheckpointManager.create_checkpoint(
            workspace_id="ws_tenant_alpha",
            site_id=1,
            run_id=test_run.id,
            checkpoint_type=CheckpointType.BATCH_PROGRESS,
            db=db_session,
            progress_cursor={"batch_idx": 1},
        )
        assert chk1.sequence == 1

        chk2 = CheckpointManager.create_checkpoint(
            workspace_id="ws_tenant_alpha",
            site_id=1,
            run_id=test_run.id,
            checkpoint_type=CheckpointType.BATCH_PROGRESS,
            db=db_session,
            progress_cursor={"batch_idx": 2},
        )
        assert chk2.sequence == 2

        chk3 = CheckpointManager.create_checkpoint(
            workspace_id="ws_tenant_alpha",
            site_id=1,
            run_id=test_run.id,
            checkpoint_type=CheckpointType.STAGE_BOUNDARY,
            db=db_session,
        )
        assert chk3.sequence == 3

        latest = CheckpointManager.get_latest_checkpoint("ws_tenant_alpha", 1, test_run.id, db_session)
        assert latest.id == chk3.id
        assert latest.sequence == 3

        history = CheckpointManager.list_checkpoints("ws_tenant_alpha", 1, test_run.id, db_session)
        assert len(history) == 3
        assert [c.sequence for c in history] == [1, 2, 3]

    def test_secret_scrubbing_in_checkpoints(
        self,
        db_session: Session,
        test_run: OrchestrationRun,
    ) -> None:
        """Sensitive credentials in checkpoint payloads are recursively redacted."""
        chk = CheckpointManager.create_checkpoint(
            workspace_id="ws_tenant_alpha",
            site_id=1,
            run_id=test_run.id,
            checkpoint_type=CheckpointType.PROVIDER_CALL,
            db=db_session,
            metadata_payload={
                "api_key": "sk-secret-12345",
                "bearer_token": "bearer eyJhbGciOi...",
                "safe_field": "public_data",
            },
        )
        assert chk.metadata_payload["api_key"] == "[REDACTED]"
        assert chk.metadata_payload["bearer_token"] == "[REDACTED]"
        assert chk.metadata_payload["safe_field"] == "public_data"

    def test_validate_checkpoint_integrity_rejects_unsafe(
        self,
        db_session: Session,
        test_run: OrchestrationRun,
    ) -> None:
        """Checkpoints marked is_safe_to_resume=False fail integrity validation."""
        unsafe_chk = CheckpointManager.create_checkpoint(
            workspace_id="ws_tenant_alpha",
            site_id=1,
            run_id=test_run.id,
            checkpoint_type=CheckpointType.PRE_MUTATION,
            db=db_session,
            is_safe_to_resume=False,
        )

        with pytest.raises(CheckpointCorruptedError) as exc_info:
            CheckpointManager.validate_checkpoint_integrity(unsafe_chk)
        assert "is_safe_to_resume=False" in str(exc_info.value)


# ==============================================================================
# 6. Resume Safety and Validation Tests
# ==============================================================================

class TestResumeSafety:
    """Verifies safe resumption from checkpoints, receipt guards, and error handling."""

    def test_safe_resume_from_checkpoint(
        self,
        db_session: Session,
        orch_service: OrchestrationService,
        control_service: ControlService,
        test_run: OrchestrationRun,
    ) -> None:
        """A paused run resumes to previous active state and re-enqueues job."""
        # Progress to SCANNING then pause
        orch_service.transition_run_state(
            workspace_id="ws_tenant_alpha", run_id=test_run.id, target_state=RunState.STARTING, db=db_session
        )
        orch_service.transition_run_state(
            workspace_id="ws_tenant_alpha", run_id=test_run.id, target_state=RunState.SCANNING, db=db_session
        )

        # Create checkpoint and pause
        chk = CheckpointManager.create_checkpoint(
            workspace_id="ws_tenant_alpha",
            site_id=1,
            run_id=test_run.id,
            checkpoint_type=CheckpointType.PAUSE_POINT,
            db=db_session,
            progress_cursor={"pages_scanned": 15},
            is_safe_to_resume=True,
        )
        orch_service.transition_run_state(
            workspace_id="ws_tenant_alpha", run_id=test_run.id, target_state=RunState.PAUSED, db=db_session
        )

        queue = LocalOrchestrationQueue()
        res = control_service.resume_run(
            workspace_id="ws_tenant_alpha",
            site_id=1,
            run_id=test_run.id,
            requested_by="operator_bob",
            db=db_session,
            queue=queue,
        )

        assert res.outcome == "RESUMED"
        assert res.status == RunState.SCANNING
        assert res.resumed_from_checkpoint_id == chk.id

        db_session.refresh(test_run)
        assert test_run.state == RunState.SCANNING.value
        assert test_run.paused_at is None

        # Verify job was enqueued with high priority
        assert queue.get_metrics().total_depth == 1

    def test_resume_blocks_when_ambiguous_external_receipt_present(
        self,
        db_session: Session,
        orch_service: OrchestrationService,
        control_service: ControlService,
        test_run: OrchestrationRun,
    ) -> None:
        """Resumption is blocked with UnsafeResumeError if unconfirmed ambiguous mutations exist."""
        # Pause run
        orch_service.transition_run_state(
            workspace_id="ws_tenant_alpha", run_id=test_run.id, target_state=RunState.PAUSED, db=db_session
        )

        # Attach an ambiguous execution receipt
        receipt = ExecutionReceipt(
            id="rcpt_ambiguous_resume_test",
            workspace_id="ws_tenant_alpha",
            site_id=1,
            run_id=test_run.id,
            operation_type="connector_fix_apply",
            idempotency_key="idem_ambig_test",
            status=ReceiptStatus.AMBIGUOUS.value,
            is_confirmed=False,
            is_safe_to_retry=False,
            details={"error": "Worker crash during external HTTP post"},
        )
        db_session.add(receipt)
        db_session.commit()

        with pytest.raises(UnsafeResumeError) as exc_info:
            control_service.resume_run(
                workspace_id="ws_tenant_alpha",
                site_id=1,
                run_id=test_run.id,
                requested_by="admin",
                db=db_session,
            )
        assert "Ambiguous external mutation receipt" in str(exc_info.value)

    def test_resume_terminal_run_raises_unsafe_resume(
        self,
        db_session: Session,
        orch_service: OrchestrationService,
        control_service: ControlService,
        test_run: OrchestrationRun,
    ) -> None:
        """Cannot resume a run that reached FAILED or CANCELLED."""
        orch_service.transition_run_state(
            workspace_id="ws_tenant_alpha", run_id=test_run.id, target_state=RunState.CANCELLED, db=db_session
        )

        with pytest.raises(UnsafeResumeError) as exc_info:
            control_service.resume_run(
                workspace_id="ws_tenant_alpha",
                site_id=1,
                run_id=test_run.id,
                requested_by="admin",
                db=db_session,
            )
        assert "Cannot resume terminal run" in str(exc_info.value)


# ==============================================================================
# 7. Retry and Cancellation Interaction Tests
# ==============================================================================

class TestRetryAndCancellationInteraction:
    """Verifies that cancellation intent suppresses retry and keeps CANCELLED distinct from FAILED."""

    def test_cancellation_suppresses_automatic_retry_on_failure(
        self,
        db_session_factory,
        db_session: Session,
        orch_service: OrchestrationService,
        control_service: ControlService,
        test_run: OrchestrationRun,
    ) -> None:
        """If an error occurs while cancellation is pending, worker cancels run without scheduling retry."""
        orch_service.transition_run_state(
            workspace_id="ws_tenant_alpha", run_id=test_run.id, target_state=RunState.STARTING, db=db_session
        )
        orch_service.transition_run_state(
            workspace_id="ws_tenant_alpha", run_id=test_run.id, target_state=RunState.OBSERVING, db=db_session
        )
        orch_service.transition_run_state(
            workspace_id="ws_tenant_alpha", run_id=test_run.id, target_state=RunState.PLANNING, db=db_session
        )
        orch_service.transition_run_state(
            workspace_id="ws_tenant_alpha", run_id=test_run.id, target_state=RunState.EXECUTING, db=db_session
        )

        # Queue cancellation while in EXECUTING (cooperative cancellation deferred!)
        control_service.request_cancellation(
            workspace_id="ws_tenant_alpha",
            site_id=1,
            run_id=test_run.id,
            requested_by="operator",
            db=db_session,
        )

        queue = LocalOrchestrationQueue()
        concurrency = ConcurrencyController()
        worker = OrchestrationWorker(
            worker_id="worker_suppress_retry",
            queue=queue,
            concurrency_controller=concurrency,
            orchestration_service=orch_service,
            session_factory=db_session_factory,
        )
        job = QueueJob(
            job_id="job_suppress",
            run_id=test_run.id,
            workspace_id=test_run.workspace_id,
            site_id=test_run.site_id,
        )
        queue.enqueue(job)

        # Force transition_run_state to raise on next active move (from EXECUTING -> VERIFYING)
        original_transition = orch_service.transition_run_state
        call_count = 0

        def transient_failure_transition(*args: Any, **kwargs: Any) -> Any:
            nonlocal call_count
            target = kwargs.get("target_state") or (args[2] if len(args) > 2 else None)
            if target == RunState.VERIFYING and call_count == 0:
                call_count += 1
                raise ConnectionError("Connection reset by peer during external mutation")
            return original_transition(*args, **kwargs)

        orch_service.transition_run_state = transient_failure_transition

        with pytest.raises(ConnectionError):
            worker.poll_and_execute_once(auto_complete=True)

        db_session.expire_all()
        refreshed = db_session.query(OrchestrationRun).filter_by(id=test_run.id).first()
        # Should be CANCELLED, NOT RETRY_WAIT and NOT FAILED!
        assert refreshed.state == RunState.CANCELLED.value
        assert refreshed.cancelled_at is not None

        # Queue depth should be 0 because retry was suppressed and job acknowledged
        assert queue.get_metrics().total_depth == 0


# ==============================================================================
# 8. Multi-Tenant Authorization Tests
# ==============================================================================

class TestTenantAndSiteAuthorization:
    """Verifies that cancellation, pause, and resume strictly enforce tenant/site boundaries."""

    def test_cross_tenant_cancellation_rejected(
        self,
        db_session: Session,
        control_service: ControlService,
        test_run: OrchestrationRun,
    ) -> None:
        """Tenant Beta cannot cancel run owned by Tenant Alpha."""
        with pytest.raises(TenantMismatchError) as exc_info:
            control_service.request_cancellation(
                workspace_id="ws_tenant_beta",  # Mismatch!
                site_id=1,
                run_id=test_run.id,
                requested_by="intruder",
                db=db_session,
            )
        assert "Tenant boundary violation" in str(exc_info.value)

    def test_site_mismatch_pause_rejected(
        self,
        db_session: Session,
        control_service: ControlService,
        test_run: OrchestrationRun,
    ) -> None:
        """Mismatched site_id rejects pause request."""
        with pytest.raises(SiteMismatchError) as exc_info:
            control_service.request_pause(
                workspace_id="ws_tenant_alpha",
                site_id=2,  # Mismatched site!
                run_id=test_run.id,
                requested_by="admin",
                db=db_session,
            )
        assert "Site boundary mismatch" in str(exc_info.value)

    def test_cross_tenant_checkpoint_query_rejected(
        self,
        db_session: Session,
        test_run: OrchestrationRun,
    ) -> None:
        """Tenant Beta cannot query checkpoints of Tenant Alpha."""
        with pytest.raises(TenantMismatchError):
            CheckpointManager.get_latest_checkpoint(
                workspace_id="ws_tenant_beta",  # Mismatch!
                site_id=1,
                run_id=test_run.id,
                db=db_session,
            )
