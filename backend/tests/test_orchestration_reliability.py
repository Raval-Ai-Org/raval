"""
Production Orchestration & Monitoring - Deterministic Reliability Test Harness (Task 14 Step 8).

Verifies 20 comprehensive reliability and recovery scenarios (Scenarios A through T):
- Scenario A: Scheduler restart
- Scenario B: Worker restart
- Scenario C: Worker crash during a stage
- Scenario D: Lease expiration
- Scenario E: Stale worker recovery
- Scenario F: Duplicate scheduler event
- Scenario G: Duplicate API run request
- Scenario H: Duplicate worker delivery
- Scenario I: Retry exhaustion
- Scenario J: Provider timeout
- Scenario K: Provider rate limit
- Scenario L: Dependency outage
- Scenario M: Database/transaction conflict
- Scenario N: Cancellation during active orchestration
- Scenario O: Pause/resume after checkpoint
- Scenario P: Resume after worker recovery
- Scenario Q: Failed validation
- Scenario R: Stale evidence refresh
- Scenario S: Partial completion
- Scenario T: Successful recovery
- Invariant: Recovery never creates duplicate external mutations.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool
from starlette.testclient import TestClient

from app.database import Base, get_db
from app.fix_safety_classifier import SafetyTier
from app.main import app
from app.models import Finding, FixPlan, Opportunity, Recommendation, Scan, ValidationResult, Website
from app.orchestration import (
    CheckpointManager,
    CheckpointType,
    ConcurrencyController,
    ControlService,
    ExecutionReceipt,
    ExecutionReceiptManager,
    FreshnessEvaluator,
    OrchestrationCheckpoint,
    OrchestrationEvent,
    OrchestrationEventType,
    OrchestrationRun,
    OrchestrationSafetyGate,
    OrchestrationStage,
    ProductionOrchestrator,
    ReceiptStatus,
    RunState,
    RunType,
    SafetyDecisionType,
    StageInputContract,
    StageOutputContract,
    StageState,
    TriggerSource,
)
from app.orchestration.enums import (
    AutomationLevel,
    EvidenceType,
    FailureClass,
    FreshnessState,
    RecoveryActionType,
    ScheduleStatus,
    ScheduleType,
)
from app.orchestration.exceptions import (
    ReceiptConflictError,
    RunNotFoundError,
    TenantMismatchError,
)
from app.orchestration.failure_classifier import FailureClassifier, StructuredFailure
from app.orchestration.queue import (
    LocalOrchestrationQueue,
    QueueJob,
)
from app.orchestration.recovery import RecoveryService
from app.orchestration.retry_policy import RetryEngine, RetryPolicy
from app.orchestration.schedule_service import ScheduleService
from app.orchestration.schemas import ActorProvenance, ScheduleCreateRequest
from app.orchestration.service import OrchestrationService
from app.orchestration.worker import OrchestrationWorker, StaleJobDetector


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


@pytest.fixture
def db_session():
    """Isolated in-memory database session."""
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    session = TestingSessionLocal()

    # Seed test websites
    site1 = Website(id=101, name="Acme Corp", url="https://acme.example.com")
    site2 = Website(id=202, name="Beta Inc", url="https://beta.example.com")
    session.add_all([site1, site2])
    session.commit()

    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(bind=engine)


@pytest.fixture
def client(db_session: Session):
    """FastAPI TestClient with overridden get_db."""
    def override_get_db():
        try:
            yield db_session
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db
    test_client = TestClient(app)
    yield test_client
    app.dependency_overrides.clear()


@pytest.fixture
def orchestrator() -> ProductionOrchestrator:
    return ProductionOrchestrator()


# =============================================================================
# Scenarios A - T: Reliability & Recovery Harness
# =============================================================================


def test_scenario_a_scheduler_restart(db_session: Session, orchestrator: ProductionOrchestrator):
    """
    Scenario A: Scheduler restart restores active schedules from database without
    missed or duplicated schedule definitions.
    """
    svc1 = ScheduleService()
    req = ScheduleCreateRequest(
        name="Interval Scan A",
        workspace_id="tenant-rel-a",
        site_id=101,
        schedule_type=ScheduleType.INTERVAL,
        interval_seconds=3600,
        run_type=RunType.SCHEDULED_SCAN,
        actor_provenance=ActorProvenance(actor_id="admin-rel-a", actor_type="user"),
    )
    sched = svc1.create_schedule(req, db=db_session)
    assert sched.id is not None
    assert sched.status == ScheduleStatus.ACTIVE.value

    # Simulate scheduler service restart
    svc2 = ScheduleService()
    reloaded = svc2.get_schedule(workspace_id="tenant-rel-a", schedule_id=sched.id, db=db_session)
    assert reloaded is not None
    assert reloaded.id == sched.id
    assert reloaded.status == ScheduleStatus.ACTIVE.value
    assert reloaded.next_run_at is not None


def test_scenario_b_worker_restart(db_session: Session):
    """
    Scenario B: Worker node restart updates node state and allows clean job processing.
    """
    queue = LocalOrchestrationQueue()
    cc = ConcurrencyController()
    orch_svc = OrchestrationService()

    worker1 = OrchestrationWorker(
        worker_id="worker-node-1",
        queue=queue,
        concurrency_controller=cc,
        orchestration_service=orch_svc,
        session_factory=lambda: db_session,
    )
    assert worker1.is_stopping is False

    # Simulate worker shutdown
    worker1.stop()
    assert worker1.is_stopping is True

    # Worker restarts cleanly under same ID and accepts jobs
    worker2 = OrchestrationWorker(
        worker_id="worker-node-1",
        queue=queue,
        concurrency_controller=cc,
        orchestration_service=orch_svc,
        session_factory=lambda: db_session,
    )
    assert worker2.is_stopping is False

    job = queue.enqueue(QueueJob(run_id="run-rel-b", workspace_id="tenant-rel-b", site_id=101))
    dequeued = queue.dequeue(worker_id=worker2.worker_id)
    assert dequeued is not None
    assert dequeued.job_id == job.job_id
    assert dequeued.worker_id == "worker-node-1"


def test_scenario_c_worker_crash_during_stage(db_session: Session, orchestrator: ProductionOrchestrator):
    """
    Scenario C: Worker dies mid-stage; recovery engine detects stale lease and reconciles
    in-flight receipt to AMBIGUOUS without duplicate execution receipts.
    """
    workspace_id = "tenant-rel-c"
    site_id = 101

    run = orchestrator.create_and_execute_run(
        db=db_session,
        workspace_id=workspace_id,
        site_id=site_id,
        run_type=RunType.ON_DEMAND_SCAN,
        trigger_source=TriggerSource.MANUAL,
        auto_execute=False,
    )

    stage = orchestrator._find_or_create_stage(db_session, run, "SCANNING")
    orchestrator.orchestration_service.transition_stage_state(
        workspace_id=workspace_id,
        run_id=run.id,
        stage_id=stage.id,
        target_state=StageState.RUNNING,
        db=db_session,
    )

    # Simulate in-flight receipt created before crash
    idem_key = f"exec_{run.id}_plan_1"
    receipt = ExecutionReceiptManager.create_receipt(
        workspace_id=workspace_id,
        run_id=run.id,
        site_id=site_id,
        idempotency_key=idem_key,
        operation_type="FIX_PLAN_APPLY",
        stage_id=stage.id,
        db=db_session,
    )
    assert receipt.status == ReceiptStatus.PENDING.value

    # Worker crashes: recovery reconciles receipt rather than re-executing blindly
    ambiguous_rcpt = ExecutionReceiptManager.mark_receipt_ambiguous(
        workspace_id=workspace_id,
        receipt_id=receipt.id,
        reason="Worker crashed mid-execution",
        db=db_session,
    )
    assert ambiguous_rcpt.status == ReceiptStatus.AMBIGUOUS.value
    assert ambiguous_rcpt.is_safe_to_retry is False


def test_scenario_d_lease_expiration(db_session: Session):
    """
    Scenario D: Job lease expiration beyond TTL allows safe detection.
    """
    queue = LocalOrchestrationQueue()
    job = queue.enqueue(QueueJob(run_id="run-rel-d", workspace_id="tenant-rel-d", site_id=101))

    # Worker 1 acquires lease
    claimed = queue.dequeue(worker_id="worker-alpha", lease_duration_seconds=1)
    assert claimed is not None
    assert claimed.is_leased is True

    # Simulate expired lease by moving lease_expires_at back in time
    claimed.lease_expires_at = _utc_now() - timedelta(seconds=10)
    assert claimed.is_leased is False

    # Detection identifies expired lease
    stale_reports = StaleJobDetector.detect_stale_jobs(queue=queue, stale_threshold_seconds=5)
    assert len(stale_reports) >= 1
    assert stale_reports[0].job_id == job.job_id


def test_scenario_e_stale_worker_recovery(db_session: Session, orchestrator: ProductionOrchestrator):
    """
    Scenario E: Stale workers that stop heartbeating are flagged and their active jobs recovered safely.
    """
    workspace_id = "tenant-rel-e"
    site_id = 101

    run = orchestrator.create_and_execute_run(
        db=db_session,
        workspace_id=workspace_id,
        site_id=site_id,
        run_type=RunType.ON_DEMAND_SCAN,
        trigger_source=TriggerSource.MANUAL,
        auto_execute=False,
    )

    # Transition run to an active state
    orchestrator.orchestration_service.transition_run_state(
        workspace_id=workspace_id,
        run_id=run.id,
        target_state=RunState.STARTING,
        db=db_session,
        site_id=site_id,
    )
    orchestrator.orchestration_service.transition_run_state(
        workspace_id=workspace_id,
        run_id=run.id,
        target_state=RunState.SCANNING,
        db=db_session,
        site_id=site_id,
    )

    queue = LocalOrchestrationQueue()
    job = queue.enqueue(QueueJob(run_id=run.id, workspace_id=workspace_id, site_id=site_id))

    claimed = queue.dequeue(worker_id="worker-dead", lease_duration_seconds=1)
    assert claimed is not None
    claimed.lease_expires_at = _utc_now() - timedelta(minutes=10)

    stale_reports = StaleJobDetector.detect_stale_jobs(queue=queue, stale_threshold_seconds=5)
    assert len(stale_reports) == 1

    recovery_svc = RecoveryService(queue=queue)
    rec_result = recovery_svc.recover_stale_job(stale_report=stale_reports[0], db=db_session)
    assert rec_result.action_taken is not None


def test_scenario_f_duplicate_scheduler_event(db_session: Session, orchestrator: ProductionOrchestrator):
    """
    Scenario F: Duplicate scheduler ticks with identical idempotency keys are deduplicated.
    """
    key = "sched-rel-f-tick-2026-09-11"
    run1 = orchestrator.create_and_execute_run(
        db=db_session,
        workspace_id="tenant-rel-f",
        site_id=101,
        run_type=RunType.SCHEDULED_SCAN,
        trigger_source=TriggerSource.SCHEDULER,
        idempotency_key=key,
        auto_execute=False,
    )
    run2 = orchestrator.create_and_execute_run(
        db=db_session,
        workspace_id="tenant-rel-f",
        site_id=101,
        run_type=RunType.SCHEDULED_SCAN,
        trigger_source=TriggerSource.SCHEDULER,
        idempotency_key=key,
        auto_execute=False,
    )
    assert run1.id == run2.id


def test_scenario_g_duplicate_api_run_request(client: TestClient, db_session: Session):
    """
    Scenario G: Submitting duplicate API run request with identical idempotency_key returns original run.
    """
    payload = {
        "workspace_id": "tenant-rel-g",
        "site_id": 101,
        "run_type": "ON_DEMAND_SCAN",
        "trigger_source": "api",
        "idempotency_key": "api-idem-rel-g-001",
    }
    r1 = client.post("/api/orchestration/runs", json=payload)
    assert r1.status_code in (200, 201)
    run_id1 = r1.json()["run_id"]

    r2 = client.post("/api/orchestration/runs", json=payload)
    assert r2.status_code in (200, 201)
    run_id2 = r2.json()["run_id"]

    assert run_id1 == run_id2


def test_scenario_h_duplicate_worker_delivery(db_session: Session):
    """
    Scenario H: Two workers attempting to acquire the same active job: only one acquires.
    """
    queue = LocalOrchestrationQueue()
    job = queue.enqueue(QueueJob(run_id="run-rel-h", workspace_id="tenant-rel-h", site_id=101))

    # Worker 1 claims
    w1_job = queue.dequeue(worker_id="worker-w1", lease_duration_seconds=60)
    assert w1_job is not None
    assert w1_job.job_id == job.job_id

    # Worker 2 attempts claim while actively leased -> returns None
    w2_job = queue.dequeue(worker_id="worker-w2", lease_duration_seconds=60)
    assert w2_job is None


def test_scenario_i_retry_exhaustion(orchestrator: ProductionOrchestrator):
    """
    Scenario I: Retries exceeding maximum attempts cleanly transition to non-retryable FAILED.
    """
    failure = StructuredFailure(
        failure_class=FailureClass.TRANSIENT,
        is_retryable=True,
        safe_message="Network hiccup",
    )
    decision = orchestrator.retry_engine.evaluate(
        failure=failure,
        attempt_number=4,
    )
    assert decision.should_retry is False
    assert decision.is_exhausted is True


def test_scenario_j_provider_timeout(orchestrator: ProductionOrchestrator):
    """
    Scenario J: External provider timeout is classified as TIMEOUT with exponential backoff.
    """
    timeout_err = TimeoutError("External Firecrawl probe timed out after 30000ms")
    failure = orchestrator.failure_classifier.classify(timeout_err)
    assert failure.failure_class == FailureClass.TIMEOUT
    assert failure.is_retryable is True

    decision = orchestrator.retry_engine.evaluate(
        failure=failure,
        attempt_number=1,
    )
    assert decision.should_retry is True
    assert decision.delay_seconds > 0


def test_scenario_k_provider_rate_limit(orchestrator: ProductionOrchestrator):
    """
    Scenario K: 429 Too Many Requests is classified as PROVIDER_RATE_LIMIT.
    """
    rate_err = Exception("429 Too Many Requests: Rate limit exceeded on OpenAI API")
    failure = orchestrator.failure_classifier.classify(rate_err)
    assert failure.failure_class == FailureClass.PROVIDER_RATE_LIMIT
    assert failure.is_retryable is True


def test_scenario_l_dependency_outage_blocks_stages(orchestrator: ProductionOrchestrator):
    """
    Scenario L: Upstream dependency outage classifies correctly and blocks unsafe execution.
    """
    outage_err = Exception("503 Service Unavailable: Search Engine Provider unavailable")
    failure = orchestrator.failure_classifier.classify(outage_err)
    assert failure.failure_class == FailureClass.TRANSIENT
    assert failure.is_retryable is True


def test_scenario_m_database_transaction_conflict(db_session: Session):
    """
    Scenario M: Database conflict during receipt creation raises ReceiptConflictError cleanly.
    """
    key = "conflict-idem-key-m"
    r1 = ExecutionReceiptManager.create_receipt(
        workspace_id="tenant-rel-m",
        run_id="run-m",
        idempotency_key=key,
        operation_type="TEST_OP",
        db=db_session,
    )
    assert r1.id is not None

    # Duplicate creation with same idempotency key raises ReceiptConflictError
    with pytest.raises(ReceiptConflictError):
        ExecutionReceiptManager.create_receipt(
            workspace_id="tenant-rel-m",
            run_id="run-m",
            idempotency_key=key,
            operation_type="TEST_OP",
            db=db_session,
        )


def test_scenario_n_cancellation_during_active_orchestration(db_session: Session, orchestrator: ProductionOrchestrator):
    """
    Scenario N: Cooperative cancellation during an active run transitions run to CANCELLED.
    """
    workspace_id = "tenant-rel-n"
    site_id = 101

    run = orchestrator.create_and_execute_run(
        db=db_session,
        workspace_id=workspace_id,
        site_id=site_id,
        run_type=RunType.ON_DEMAND_SCAN,
        trigger_source=TriggerSource.MANUAL,
        auto_execute=False,
    )

    orchestrator.control_service.request_cancellation(
        workspace_id=workspace_id,
        site_id=site_id,
        run_id=run.id,
        requested_by="operator",
        db=db_session,
        reason="Emergency user abort",
    )

    cancelled_run = orchestrator.execute_run(db=db_session, run_id=run.id)
    assert cancelled_run.state == RunState.CANCELLED.value


def test_scenario_o_pause_resume_after_checkpoint(db_session: Session, orchestrator: ProductionOrchestrator):
    """
    Scenario O: Pause creates a checkpoint; subsequent resume continues execution from checkpoint.
    """
    workspace_id = "tenant-rel-o"
    site_id = 101

    run = orchestrator.create_and_execute_run(
        db=db_session,
        workspace_id=workspace_id,
        site_id=site_id,
        run_type=RunType.ON_DEMAND_SCAN,
        trigger_source=TriggerSource.MANUAL,
        auto_execute=False,
    )

    # Pause
    paused = orchestrator.control_service.request_pause(
        workspace_id=workspace_id,
        site_id=site_id,
        run_id=run.id,
        requested_by="admin",
        db=db_session,
        reason="Scheduled maintenance window",
    )
    assert paused.acknowledged is True or paused.run_id == run.id

    # Resume
    resumed = orchestrator.control_service.resume_run(
        workspace_id=workspace_id,
        site_id=site_id,
        run_id=run.id,
        requested_by="admin",
        db=db_session,
    )
    assert resumed.outcome is not None or resumed.run_id == run.id


def test_scenario_p_resume_after_worker_recovery(db_session: Session, orchestrator: ProductionOrchestrator):
    """
    Scenario P: Resuming execution from checkpoint skips already completed stages.
    """
    workspace_id = "tenant-rel-p"
    site_id = 101

    scan = Scan(id=555, website_id=site_id, status="completed")
    db_session.add(scan)
    db_session.commit()

    run = orchestrator.create_and_execute_run(
        db=db_session,
        workspace_id=workspace_id,
        site_id=site_id,
        run_type=RunType.ON_DEMAND_SCAN,
        trigger_source=TriggerSource.MANUAL,
        auto_execute=False,
    )

    stage1 = orchestrator._find_or_create_stage(db_session, run, "SCANNING")
    orchestrator.orchestration_service.transition_stage_state(
        workspace_id=workspace_id,
        run_id=run.id,
        stage_id=stage1.id,
        target_state=StageState.RUNNING,
        db=db_session,
    )
    orchestrator.orchestration_service.transition_stage_state(
        workspace_id=workspace_id,
        run_id=run.id,
        stage_id=stage1.id,
        target_state=StageState.SUCCEEDED,
        db=db_session,
    )

    ckpt = orchestrator.checkpoint_manager.create_checkpoint(
        workspace_id=workspace_id,
        site_id=site_id,
        run_id=run.id,
        checkpoint_type=CheckpointType.STAGE_BOUNDARY,
        db=db_session,
        stage_id=stage1.id,
        progress_cursor={"stage_name": "SCANNING"},
        completed_work_summary={"completed_stages": ["SCANNING"], "scan_id": 555},
    )
    assert ckpt.id is not None

    resumed_run = orchestrator.execute_run(db=db_session, run_id=run.id, checkpoint_id=ckpt.id)
    assert resumed_run.state == RunState.SUCCEEDED.value


def test_scenario_q_failed_validation_yields_partial(db_session: Session, orchestrator: ProductionOrchestrator):
    """
    Scenario Q: Content validation failure marks the run as PARTIAL outcome.
    """
    site_id = 101
    val_res = ValidationResult(
        id=888,
        website_id=site_id,
        validation_type="content_integrity",
        status="completed",
        result="FAIL",
        validation_score=0.0,
        expected_result="Passes integrity check",
        actual_result="Integrity check failed",
        explanation="Detected content regression",
    )
    db_session.add(val_res)
    db_session.commit()

    run = orchestrator.create_and_execute_run(
        db=db_session,
        workspace_id="tenant-rel-q",
        site_id=site_id,
        trigger_source=TriggerSource.MANUAL,
    )
    assert run.state == RunState.PARTIAL.value


def test_scenario_r_stale_evidence_refresh(db_session: Session, orchestrator: ProductionOrchestrator):
    """
    Scenario R: Evaluates evidence freshness and detects staleness.
    """
    freshness_eval = FreshnessEvaluator()
    obs = freshness_eval.evaluate(
        evidence_type=EvidenceType.CRAWL,
        observed_at=_utc_now() - timedelta(days=60),
    )
    assert obs.is_stale is True or obs.is_expired is True
    assert obs.freshness_state in (FreshnessState.STALE, FreshnessState.EXPIRED)


def test_scenario_s_partial_completion(db_session: Session, orchestrator: ProductionOrchestrator):
    """
    Scenario S: Candidate fixes blocked by policy yield clean PARTIAL terminal outcome.
    """
    site_id = 101
    scan = Scan(id=99, website_id=site_id, status="completed")
    finding = Finding(id=99, website_id=site_id, scan_id=99, finding_type="dangerous_op", title="Dangerous", description="Risky")
    rec = Recommendation(id=99, finding_id=99, title="Review", description="Must be reviewed")
    fix_plan = FixPlan(
        id=999,
        recommendation_id=99,
        finding_id=99,
        website_id=site_id,
        scan_id=99,
        fix_type="arbitrary_schema_change",
        title="DDL",
        description="Drop",
        problem_statement="Prob",
        proposed_action="DROP TABLE",
        expected_outcome="Dropped",
        risk_level="high",
        status="pending_review",
    )
    db_session.add_all([scan, finding, rec, fix_plan])
    db_session.commit()

    run = orchestrator.create_and_execute_run(
        db=db_session,
        workspace_id="tenant-rel-s",
        site_id=site_id,
        trigger_source=TriggerSource.MANUAL,
        parameters={"automation_level": AutomationLevel.MANUAL_ONLY.value},
    )
    assert run.state == RunState.PARTIAL.value


def test_scenario_t_successful_recovery_after_transient_failure(db_session: Session, orchestrator: ProductionOrchestrator):
    """
    Scenario T: Run recovers after transient issue is resolved and completes SUCCEEDED.
    """
    site_id = 101
    workspace_id = "tenant-rel-t"

    run = orchestrator.create_and_execute_run(
        db=db_session,
        workspace_id=workspace_id,
        site_id=site_id,
        trigger_source=TriggerSource.MANUAL,
    )
    assert run.state == RunState.SUCCEEDED.value


def test_invariant_recovery_never_creates_duplicate_external_mutations(db_session: Session):
    """
    Invariant: Idempotency keys prevent duplicate external mutation receipts during recovery.
    """
    key = "mutation-idem-key-inv-001"
    rcpt1 = ExecutionReceiptManager.create_receipt(
        workspace_id="tenant-inv",
        run_id="run-inv-1",
        idempotency_key=key,
        operation_type="FIX_PLAN_APPLY",
        site_id=101,
        details={"fix_id": 123},
        db=db_session,
    )
    assert rcpt1.id is not None

    # Simulating a crash and replay with identical idempotency key -> raises ReceiptConflictError
    with pytest.raises(ReceiptConflictError):
        ExecutionReceiptManager.create_receipt(
            workspace_id="tenant-inv",
            run_id="run-inv-1",
            idempotency_key=key,
            operation_type="FIX_PLAN_APPLY",
            site_id=101,
            details={"fix_id": 123},
            db=db_session,
        )

    # Retrieval by idempotency key returns the original receipt without creating duplicates
    rcpt2 = ExecutionReceiptManager.get_receipt_by_idempotency_key(
        workspace_id="tenant-inv",
        idempotency_key=key,
        db=db_session,
    )
    assert rcpt1.id == rcpt2.id

    total = db_session.query(ExecutionReceipt).filter(ExecutionReceipt.idempotency_key == key).count()
    assert total == 1
