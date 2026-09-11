"""
Integration and Unit Tests for Orchestration Queue, Concurrency, Worker, and Stale Job Detection (Step 2).

Verifies:
1. Thread-safe LocalOrchestrationQueue with priority ordering, visibility delays, worker leases, and heartbeats.
2. ConcurrencyController multi-dimensional limits (workspace, site, provider) and non-destructive backpressure.
3. OrchestrationWorker execution harness with server-side tenant/site authorization, state machine progression,
   and clean resource cleanup.
4. Graceful shutdown without work dropping.
5. StaleJobDetector identification of expired leases strictly without premature auto-retry (Step 2 boundary).
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.database import Base
from app.models import Website
from app.orchestration.concurrency import ConcurrencyController, ConcurrencyPolicy
from app.orchestration.enums import RunState, RunType, TriggerSource
from app.orchestration.exceptions import SiteMismatchError
from app.orchestration.queue import (
    LocalOrchestrationQueue,
    QueueJob,
    QueueMetrics,
)
from app.orchestration.schemas import ActorProvenance, OrchestrationRunCreateRequest
from app.orchestration.service import OrchestrationService
from app.orchestration.worker import OrchestrationWorker, StaleJobDetector


@pytest.fixture
def db_session_factory():
    """Returns a factory producing isolated in-memory SQLite database sessions."""
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    SessionTesting = sessionmaker(autocommit=False, autoflush=False, bind=engine)

    # Seed initial test site
    seed_session = SessionTesting()
    site = Website(
        id=1,
        name="Acme Health Portal",
        url="https://acme-health.example.com",
        created_at=datetime.now(timezone.utc),
    )
    site2 = Website(
        id=2,
        name="Beta Labs Portal",
        url="https://beta-labs.example.com",
        created_at=datetime.now(timezone.utc),
    )
    seed_session.add_all([site, site2])
    seed_session.commit()
    seed_session.close()

    try:
        yield SessionTesting
    finally:
        Base.metadata.drop_all(bind=engine)


@pytest.fixture
def db_session(db_session_factory) -> Session:
    session = db_session_factory()
    try:
        yield session
    finally:
        session.close()


class TestLocalOrchestrationQueue:
    """Tests for the LocalOrchestrationQueue implementation."""

    def test_enqueue_and_dequeue_basic(self):
        queue = LocalOrchestrationQueue()
        job = QueueJob(
            run_id="run_test_1",
            workspace_id="ws_1",
            site_id=1,
            priority=5,
        )
        enqueued = queue.enqueue(job)
        assert enqueued.job_id == job.job_id
        assert queue.get_queue_depth() == 1

        # Dequeue with worker lease
        leased = queue.dequeue(worker_id="worker_alpha", lease_duration_seconds=30)
        assert leased is not None
        assert leased.job_id == job.job_id
        assert leased.worker_id == "worker_alpha"
        assert leased.lease_id is not None
        assert leased.lease_expires_at is not None
        assert leased.attempt_count == 1
        assert leased.is_leased is True

        # Second dequeue attempt while leased returns None
        empty = queue.dequeue(worker_id="worker_beta")
        assert empty is None

    def test_priority_ordering_dispatch(self):
        queue = LocalOrchestrationQueue()
        # Enqueue in mixed order: low (1), high (100), medium (50)
        now = datetime.now(timezone.utc)
        job_low = QueueJob(run_id="run_low", workspace_id="ws_1", site_id=1, priority=1, enqueued_at=now)
        job_high = QueueJob(run_id="run_high", workspace_id="ws_1", site_id=1, priority=100, enqueued_at=now)
        job_med = QueueJob(run_id="run_med", workspace_id="ws_1", site_id=1, priority=50, enqueued_at=now)

        queue.enqueue(job_low)
        queue.enqueue(job_high)
        queue.enqueue(job_med)

        # First dequeue must yield high priority
        d1 = queue.dequeue(worker_id="w1")
        assert d1.run_id == "run_high"

        # Second dequeue must yield medium priority
        d2 = queue.dequeue(worker_id="w1")
        assert d2.run_id == "run_med"

        # Third dequeue must yield low priority
        d3 = queue.dequeue(worker_id="w1")
        assert d3.run_id == "run_low"

    def test_fifo_ordering_for_identical_priority(self):
        queue = LocalOrchestrationQueue()
        now = datetime.now(timezone.utc)
        job1 = QueueJob(run_id="run_first", workspace_id="ws_1", site_id=1, priority=10, enqueued_at=now)
        job2 = QueueJob(run_id="run_second", workspace_id="ws_1", site_id=1, priority=10, enqueued_at=now + timedelta(seconds=1))

        queue.enqueue(job1)
        queue.enqueue(job2)

        d1 = queue.dequeue(worker_id="w1")
        d2 = queue.dequeue(worker_id="w1")
        assert d1.run_id == "run_first"
        assert d2.run_id == "run_second"

    def test_visibility_timeout_delay(self):
        queue = LocalOrchestrationQueue()
        now = datetime.now(timezone.utc)
        # Job invisible for 1 hour
        job = QueueJob(
            run_id="run_hidden",
            workspace_id="ws_1",
            site_id=1,
            visible_at=now + timedelta(hours=1),
        )
        queue.enqueue(job)

        # Dequeue must ignore invisible job
        assert queue.dequeue(worker_id="w1") is None
        assert queue.get_queue_depth() == 1

        # Now update visibility to the past
        job.visible_at = now - timedelta(seconds=1)
        # Should now be dequeued
        claimed = queue.dequeue(worker_id="w1")
        assert claimed is not None
        assert claimed.run_id == "run_hidden"

    def test_lease_extension_and_heartbeat(self):
        queue = LocalOrchestrationQueue()
        job = QueueJob(run_id="run_lease", workspace_id="ws_1", site_id=1)
        queue.enqueue(job)

        claimed = queue.dequeue(worker_id="w_heartbeat", lease_duration_seconds=10)
        old_expiry = claimed.lease_expires_at

        # Extend lease
        new_expiry = queue.extend_lease(job_id=claimed.job_id, worker_id="w_heartbeat", extension_seconds=60)
        assert new_expiry is not None
        assert new_expiry > old_expiry

        # Unauthorized worker cannot extend lease
        failed_ext = queue.extend_lease(job_id=claimed.job_id, worker_id="w_imposter", extension_seconds=60)
        assert failed_ext is None

    def test_acknowledge_removes_job(self):
        queue = LocalOrchestrationQueue()
        job = QueueJob(run_id="run_ack", workspace_id="ws_1", site_id=1)
        queue.enqueue(job)

        claimed = queue.dequeue(worker_id="w_ack")
        # Unauthorized ack fails
        assert queue.acknowledge(job_id=claimed.job_id, worker_id="w_other") is False
        assert queue.get_queue_depth() == 1

        # Legitimate ack succeeds and purges job
        assert queue.acknowledge(job_id=claimed.job_id, worker_id="w_ack") is True
        assert queue.get_queue_depth() == 0

    def test_release_resets_lease(self):
        queue = LocalOrchestrationQueue()
        job = QueueJob(run_id="run_rel", workspace_id="ws_1", site_id=1)
        queue.enqueue(job)

        claimed = queue.dequeue(worker_id="w_rel")
        assert claimed.is_leased is True

        # Release back to queue
        assert queue.release(job_id=claimed.job_id, worker_id="w_rel", delay_seconds=0) is True
        assert claimed.is_leased is False
        assert claimed.worker_id is None

        # Can be claimed by another worker
        claimed2 = queue.dequeue(worker_id="w_new")
        assert claimed2 is not None
        assert claimed2.worker_id == "w_new"

    def test_queue_metrics_and_depth(self):
        queue = LocalOrchestrationQueue()
        job1 = QueueJob(run_id="r1", workspace_id="ws_a", site_id=1)
        job2 = QueueJob(run_id="r2", workspace_id="ws_a", site_id=1)
        job3 = QueueJob(run_id="r3", workspace_id="ws_b", site_id=2)
        queue.enqueue(job1)
        queue.enqueue(job2)
        queue.enqueue(job3)

        # Claim one job
        queue.dequeue(worker_id="w_metrics")

        metrics = queue.get_metrics(workspace_id="ws_a")
        assert metrics.total_depth == 3
        assert metrics.active_leases == 1
        assert metrics.visible_waiting == 2
        assert metrics.workspace_depth == 2


class TestConcurrencyController:
    """Tests for ConcurrencyController capacity and backpressure."""

    def test_workspace_concurrency_limit_enforced(self):
        policy = ConcurrencyPolicy(
            max_active_runs_per_workspace=2,
            max_active_runs_per_site=5,
        )
        ctrl = ConcurrencyController(policy)

        # Acquire 2 slots for ws_limit
        assert ctrl.acquire(workspace_id="ws_limit", site_id=1) is True
        assert ctrl.acquire(workspace_id="ws_limit", site_id=2) is True

        # 3rd attempt must be rejected
        can, reason = ctrl.can_acquire(workspace_id="ws_limit", site_id=3)
        assert can is False
        assert "reached limit (2)" in reason
        assert ctrl.acquire(workspace_id="ws_limit", site_id=3) is False

        # Release 1 slot
        ctrl.release(workspace_id="ws_limit", site_id=1)
        # Now 3rd attempt can succeed
        assert ctrl.acquire(workspace_id="ws_limit", site_id=3) is True

    def test_site_concurrency_limit_enforced(self):
        policy = ConcurrencyPolicy(
            max_active_runs_per_workspace=10,
            max_active_runs_per_site=1,
        )
        ctrl = ConcurrencyController(policy)

        # Acquire 1 slot for site 42
        assert ctrl.acquire(workspace_id="ws_any", site_id=42) is True

        # 2nd attempt for same site must fail
        can, reason = ctrl.can_acquire(workspace_id="ws_any", site_id=42)
        assert can is False
        assert "Site '42'" in reason

        # Another site can succeed
        assert ctrl.acquire(workspace_id="ws_any", site_id=43) is True

    def test_provider_concurrency_limit(self):
        policy = ConcurrencyPolicy(max_active_calls_per_provider=2)
        ctrl = ConcurrencyController(policy)

        assert ctrl.acquire("ws", 1, provider="openai") is True
        assert ctrl.acquire("ws", 2, provider="openai") is True
        assert ctrl.acquire("ws", 3, provider="openai") is False

        # Different provider succeeds
        assert ctrl.acquire("ws", 4, provider="anthropic") is True

    def test_capacity_status_diagnostics(self):
        ctrl = ConcurrencyController(ConcurrencyPolicy(max_active_runs_per_workspace=3))
        ctrl.acquire(workspace_id="ws_diag", site_id=1)

        status = ctrl.get_capacity_status(workspace_id="ws_diag", site_id=1)
        assert status["workspace"]["active"] == 1
        assert status["workspace"]["available"] == 2
        assert status["site"]["active"] == 1


class TestOrchestrationWorkerExecution:
    """Tests for OrchestrationWorker end-to-end processing and state machine integration."""

    def test_worker_claims_and_executes_run_to_completion(self, db_session_factory, db_session: Session):
        service = OrchestrationService()
        queue = LocalOrchestrationQueue()
        concurrency = ConcurrencyController()
        worker = OrchestrationWorker(
            worker_id="worker_test_1",
            queue=queue,
            concurrency_controller=concurrency,
            orchestration_service=service,
            session_factory=db_session_factory,
        )

        # Create run in QUEUED state
        req = OrchestrationRunCreateRequest(
            workspace_id="ws_worker",
            site_id=1,
            run_type=RunType.ON_DEMAND_SCAN,
            trigger_source=TriggerSource.MANUAL,
            actor_provenance=ActorProvenance(actor_id="user_1", actor_type="user"),
        )
        run = service.create_run(req, db_session)
        assert run.state == RunState.QUEUED.value

        # Enqueue job
        job = QueueJob(
            run_id=run.id,
            workspace_id=run.workspace_id,
            site_id=run.site_id,
            run_type=run.run_type,
        )
        queue.enqueue(job)
        assert queue.get_queue_depth() == 1

        # Execute single poll cycle
        executed = worker.poll_and_execute_once(lease_duration_seconds=30, auto_complete=True)
        assert executed is True

        # Run must have completed to SUCCEEDED through state machine
        db_session.refresh(run)
        assert run.state == RunState.SUCCEEDED.value
        assert run.completed_at is not None

        # Queue job must be acknowledged and removed
        assert queue.get_queue_depth() == 0

        # Concurrency slots must be cleanly released
        cap = concurrency.get_capacity_status(workspace_id="ws_worker", site_id=1)
        assert cap["workspace"]["active"] == 0
        assert cap["site"]["active"] == 0

    def test_worker_backpressure_leaves_job_queued(self, db_session_factory, db_session: Session):
        service = OrchestrationService()
        queue = LocalOrchestrationQueue()
        # Restrict site capacity to 0 slots (immediate backpressure)
        concurrency = ConcurrencyController(ConcurrencyPolicy(max_active_runs_per_site=1))
        # Pre-occupy slot
        concurrency.acquire(workspace_id="ws_bp", site_id=1)

        worker = OrchestrationWorker(
            worker_id="worker_bp",
            queue=queue,
            concurrency_controller=concurrency,
            orchestration_service=service,
            session_factory=db_session_factory,
        )

        # Create run
        req = OrchestrationRunCreateRequest(
            workspace_id="ws_bp",
            site_id=1,
            run_type=RunType.ON_DEMAND_SCAN,
            trigger_source=TriggerSource.MANUAL,
            actor_provenance=ActorProvenance(actor_id="user_1", actor_type="user"),
        )
        run = service.create_run(req, db_session)
        job = QueueJob(run_id=run.id, workspace_id="ws_bp", site_id=1)
        queue.enqueue(job)

        # Worker attempts to poll: must hit backpressure
        executed = worker.poll_and_execute_once()
        assert executed is False

        # Job must STILL be in the queue (non-destructive backpressure)
        assert queue.get_queue_depth() == 1
        # Run must still be in QUEUED state (not aborted or corrupted)
        db_session.refresh(run)
        assert run.state == RunState.QUEUED.value

    def test_worker_server_side_site_validation_rejection(self, db_session_factory, db_session: Session):
        service = OrchestrationService()
        queue = LocalOrchestrationQueue()
        concurrency = ConcurrencyController()
        worker = OrchestrationWorker(
            worker_id="worker_val",
            queue=queue,
            concurrency_controller=concurrency,
            orchestration_service=service,
            session_factory=db_session_factory,
        )

        # Enqueue job targeting non-existent site 9999
        job = QueueJob(
            run_id="run_ghost",
            workspace_id="ws_ghost",
            site_id=9999,
        )
        queue.enqueue(job)

        with pytest.raises(SiteMismatchError) as exc_info:
            worker.poll_and_execute_once()
        assert "expected_site_id" in str(exc_info.value) or "9999" in str(exc_info.value)

    def test_worker_graceful_shutdown(self, db_session_factory):
        service = OrchestrationService()
        queue = LocalOrchestrationQueue()
        concurrency = ConcurrencyController()
        worker = OrchestrationWorker(
            worker_id="worker_graceful",
            queue=queue,
            concurrency_controller=concurrency,
            orchestration_service=service,
            session_factory=db_session_factory,
        )
        job = QueueJob(run_id="r_stop", workspace_id="ws_stop", site_id=1)
        queue.enqueue(job)

        # Trigger graceful stop
        worker.stop()
        assert worker.is_stopping is True

        # Polling must not accept work
        assert worker.poll_and_execute_once() is False
        assert queue.get_queue_depth() == 1


class TestStaleJobDetection:
    """Tests for StaleJobDetector lease timeout inspection."""

    def test_detect_expired_lease_as_stale(self):
        queue = LocalOrchestrationQueue()
        now = datetime.now(timezone.utc)

        # Job with expired lease
        job = QueueJob(
            run_id="run_stale_1",
            workspace_id="ws_1",
            site_id=1,
            worker_id="dead_worker",
            lease_id="lease_dead_123",
            lease_expires_at=now - timedelta(seconds=120),
        )
        queue.enqueue(job)

        # Active job with unexpired lease
        active_job = QueueJob(
            run_id="run_active",
            workspace_id="ws_1",
            site_id=1,
            worker_id="live_worker",
            lease_id="lease_live_456",
            lease_expires_at=now + timedelta(seconds=120),
        )
        queue.enqueue(active_job)

        # Detect stale jobs
        reports = StaleJobDetector.detect_stale_jobs(queue)
        assert len(reports) == 1
        stale = reports[0]
        assert stale.run_id == "run_stale_1"
        assert stale.worker_id == "dead_worker"
        assert "Lease expired" in stale.reason

    def test_stale_jobs_are_not_mutated_or_retried(self):
        """
        Step 2 Boundary Verification:
        StaleJobDetector must strictly identify stale jobs without mutating run state
        or automatically requeuing them. Recovery is reserved for Step 3.
        """
        queue = LocalOrchestrationQueue()
        now = datetime.now(timezone.utc)

        job = QueueJob(
            run_id="run_untouched",
            workspace_id="ws_1",
            site_id=1,
            worker_id="crashed_worker",
            lease_id="lease_crashed",
            lease_expires_at=now - timedelta(seconds=90),
            attempt_count=1,
        )
        queue.enqueue(job)

        # Run detection
        reports = StaleJobDetector.detect_stale_jobs(queue)
        assert len(reports) == 1

        # Verify job is unchanged in queue
        vis = queue.get_visibility()
        assert len(vis) == 1
        assert vis[0].attempt_count == 1
        assert vis[0].worker_id == "crashed_worker"
        assert vis[0].lease_id == "lease_crashed"
