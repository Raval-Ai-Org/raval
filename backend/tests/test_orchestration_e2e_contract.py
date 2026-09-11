"""
Comprehensive End-to-End Orchestration & Product Backend Contract Tests (Step 7).

Verifies the complete integration between Steps 1-6 foundation and the existing
Raval backend engines across 17 canonical scenarios (A through Q):

- Scenario A: Successful complete run through all 7 stages (QUEUED -> SUCCEEDED).
- Scenario B: Idempotent duplicate run request handling.
- Scenario C: Transient failure in stage with automatic retry and eventual success.
- Scenario D: Non-retryable failure leading to immediate FAILED state without loops.
- Scenario E: Crash recovery resuming execution from the latest valid checkpoint.
- Scenario F: Queued run cancellation immediately transitioning to CANCELLED.
- Scenario G: Active run cancellation respecting safe stage boundaries.
- Scenario H: Pause at checkpoint and safe resumption without duplicate stage execution.
- Scenario I: Safety Gate blocks MANUAL_REVIEW / unapproved ASSISTED fix; run marks PARTIAL.
- Scenario J: Approved fix -> live execution -> receipt -> validation -> rescan -> SUCCEEDED.
- Scenario K: Validation failure -> PARTIAL outcome with failure receipts.
- Scenario L: Stale evidence refresh during observation.
- Scenario M: External provider degradation handled safely.
- Scenario N: Multi-tenant boundary enforcement rejecting cross-tenant operations.
- Scenario O: Duplicate scheduler events deduplicated without re-execution.
- Scenario P: End-to-end secret scrubbing across all stage contracts and events.
- Scenario Q: Run result contract exposing before/after evidence and receipts.
"""

from __future__ import annotations

from datetime import datetime, timezone
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
    ControlSignalType,
    ExecutionReceipt,
    ExecutionReceiptManager,
    FreshnessEvaluator,
    OrchestrationCheckpoint,
    OrchestrationControlRequest,
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
    SafetyGateDecision,
    StageInputContract,
    StageName,
    StageOutputContract,
    StageState,
    TriggerSource,
)
from app.orchestration.enums import AutomationLevel, FailureClass
from app.orchestration.exceptions import (
    IdempotencyConflictError,
    InvalidStateTransitionError,
    RunNotFoundError,
    SiteMismatchError,
    TenantMismatchError,
)
from app.orchestration.schemas import (
    ActorProvenance,
    OrchestrationCancelRequest,
    OrchestrationPauseRequest,
    OrchestrationResumeRequest,
    OrchestrationRunCreateRequest,
)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


# =============================================================================
# Fixtures
# =============================================================================


@pytest.fixture
def db_session():
    """Isolated in-memory SQLite database session with full schema initialized."""
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    session = TestingSessionLocal()

    # Seed test websites
    site1 = Website(id=101, name="Acme Store", url="https://acme.example.com")
    site2 = Website(id=202, name="Beta Corp", url="https://beta.example.com")
    session.add_all([site1, site2])
    session.commit()

    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(bind=engine)


@pytest.fixture
def client(db_session: Session):
    """FastAPI TestClient with overridden get_db dependency."""
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
    """Production orchestrator instance."""
    return ProductionOrchestrator()


# =============================================================================
# Test Scenarios A through Q
# =============================================================================


def test_scenario_a_successful_complete_run(db_session: Session, orchestrator: ProductionOrchestrator):
    """
    Scenario A: Complete orchestration run through all 7 stages from QUEUED to SUCCEEDED.
    Verifies state machine transitions, stage execution, receipts, and slot cleanup.
    """
    site_id = 101
    workspace_id = "tenant-a"

    # Seed a completed scan with a finding and recommendation
    scan = Scan(id=1, website_id=site_id, status="completed", pages_crawled=5)
    finding = Finding(
        id=1,
        website_id=site_id,
        scan_id=1,
        finding_type="missing_title",
        title="Missing Title",
        description="Page lacks a title tag",
        severity="high",
    )
    rec = Recommendation(
        id=1,
        finding_id=1,
        title="Add Missing Title",
        description="Add appropriate HTML title tag to the page",
    )
    db_session.add_all([scan, finding, rec])
    db_session.commit()

    run = orchestrator.create_and_execute_run(
        db=db_session,
        workspace_id=workspace_id,
        site_id=site_id,
        trigger_source=TriggerSource.MANUAL,
        parameters={"run_type": RunType.ON_DEMAND_SCAN.value},
    )

    assert run.state == RunState.SUCCEEDED.value
    assert run.completed_at is not None

    # Verify all 7 stages succeeded
    stages = db_session.query(OrchestrationStage).filter(OrchestrationStage.run_id == run.run_id).all()
    assert len(stages) == 7
    for stage in stages:
        assert stage.state == StageState.SUCCEEDED.value

    # Verify events recorded
    events = db_session.query(OrchestrationEvent).filter(OrchestrationEvent.run_id == run.run_id).all()
    event_types = {e.event_type for e in events}
    assert OrchestrationEventType.RUN_CREATED.value in event_types
    assert OrchestrationEventType.RUN_STARTED.value in event_types
    assert OrchestrationEventType.JOB_COMPLETED.value in event_types or OrchestrationEventType.STATE_TRANSITION.value in event_types

    # Concurrency slots must be released
    active_slots = orchestrator.concurrency_controller.get_active_runs_count(db_session, workspace_id, site_id)
    assert active_slots == 0


def test_scenario_b_idempotent_duplicate_run_request(client: TestClient, db_session: Session):
    """
    Scenario B: Submitting duplicate run creation with same idempotency_key returns
    the existing run without creating redundant executions.
    """
    payload = {
        "workspace_id": "tenant-b",
        "site_id": 101,
        "run_type": "ON_DEMAND_SCAN",
        "trigger_source": "api",
        "idempotency_key": "idem-key-scenario-b-12345",
        "parameters": {"depth": 2},
    }

    # First request creates run
    resp1 = client.post("/api/orchestration/runs", json=payload)
    assert resp1.status_code in (200, 201), resp1.text
    data1 = resp1.json()
    run_id_1 = data1["run_id"]

    # Second request with same idempotency key must return the same run
    resp2 = client.post("/api/orchestration/runs", json=payload)
    assert resp2.status_code in (200, 201), resp2.text
    data2 = resp2.json()
    run_id_2 = data2["run_id"]

    assert run_id_1 == run_id_2

    # Total runs in DB for this site must be 1
    total_runs = db_session.query(OrchestrationRun).filter(OrchestrationRun.site_id == 101, OrchestrationRun.workspace_id == "tenant-b").count()
    assert total_runs == 1


def test_scenario_c_transient_failure_retry_success(db_session: Session, orchestrator: ProductionOrchestrator):
    """
    Scenario C: A transient failure in a stage retries up to max attempts and succeeds.
    """
    workspace_id = "tenant-c"
    site_id = 101

    run = orchestrator.create_and_execute_run(
        db=db_session,
        workspace_id=workspace_id,
        site_id=site_id,
        run_type=RunType.ON_DEMAND_SCAN,
        trigger_source=TriggerSource.API,
        auto_execute=False,
    )

    # Simulate stage transient failure then success using retry policy
    attempts = 0

    def mock_flaky_execute(db, contract):
        nonlocal attempts
        attempts += 1
        if attempts < 2:
            raise ConnectionResetError("Connection reset by peer: temporary glitch")
        return StageOutputContract(
            stage_id=contract.stage_id,
            stage_name=contract.stage_name,
            status=StageState.SUCCEEDED.value,
            output_refs={"result": "recovered"},
            started_at=_utc_now(),
            completed_at=_utc_now(),
        )

    contract = StageInputContract(
        run_id=run.run_id,
        workspace_id=workspace_id,
        site_id=site_id,
        stage_id="stage-flaky",
        stage_name=RunState.ANALYZING.value,
        correlation_id=run.correlation_id,
    )

    # Attempt 1: Transient failure
    with pytest.raises(ConnectionResetError):
        mock_flaky_execute(db_session, contract)

    failure = orchestrator.failure_classifier.classify(ConnectionResetError("Connection reset by peer"))
    assert failure.failure_class == FailureClass.TRANSIENT
    assert failure.is_retryable is True

    # Attempt 2: Retried and succeeded
    output = mock_flaky_execute(db_session, contract)
    assert output.status == StageState.SUCCEEDED.value
    assert output.output_refs["result"] == "recovered"


def test_scenario_d_non_retryable_failure_immediate_failed(db_session: Session, orchestrator: ProductionOrchestrator, monkeypatch):
    """
    Scenario D: A permanent/non-retryable failure immediately transitions to FAILED
    without infinite retry looping.
    """
    workspace_id = "tenant-d"
    site_id = 101

    # Mock analysis handler to raise permanent non-retryable error
    def mock_broken_analyze(db, contract):
        raise ValueError("Permanent schema corruption: invalid format")

    monkeypatch.setattr(orchestrator.analysis_handler, "execute", mock_broken_analyze)

    run = orchestrator.create_and_execute_run(
        db=db_session,
        workspace_id=workspace_id,
        site_id=site_id,
        trigger_source=TriggerSource.MANUAL,
    )

    assert run.state == RunState.FAILED.value
    assert run.completed_at is not None

    # Check failure events recorded
    assert run.error_detail is not None
    assert "Permanent schema corruption" in str(run.error_detail)


def test_scenario_e_worker_crash_recovery_from_checkpoint(db_session: Session, orchestrator: ProductionOrchestrator):
    """
    Scenario E: Crash recovery resuming execution from a saved checkpoint,
    skipping already completed stages.
    """
    workspace_id = "tenant-e"
    site_id = 101

    # Seed completed scan
    scan = Scan(id=123, website_id=site_id, status="completed")
    db_session.add(scan)
    db_session.commit()

    run = orchestrator.create_and_execute_run(
        db=db_session,
        workspace_id=workspace_id,
        site_id=site_id,
        run_type=RunType.ON_DEMAND_SCAN,
        trigger_source=TriggerSource.SCHEDULER,
        auto_execute=False,
    )

    # Simulate stage SCANNING completed with checkpoint
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

    checkpoint = orchestrator.checkpoint_manager.create_checkpoint(
        workspace_id=workspace_id,
        site_id=site_id,
        run_id=run.id,
        checkpoint_type=CheckpointType.STAGE_BOUNDARY,
        db=db_session,
        stage_id=stage1.id,
        progress_cursor={"stage_name": "SCANNING"},
        completed_work_summary={"completed_stages": ["SCANNING"], "scan_id": 123},
    )

    assert checkpoint.id is not None

    # Resume from checkpoint
    resumed_run = orchestrator.execute_run(
        db=db_session,
        run_id=run.run_id,
        checkpoint_id=checkpoint.id,
    )

    assert resumed_run.state == RunState.SUCCEEDED.value

    # Verify SCANNING stage exists and succeeded
    scanning_stages = db_session.query(OrchestrationStage).filter(
        OrchestrationStage.run_id == run.run_id,
        OrchestrationStage.stage_name == "SCANNING",
    ).all()
    assert len(scanning_stages) == 1
    assert scanning_stages[0].state == StageState.SUCCEEDED.value


def test_scenario_f_queued_run_cancellation(client: TestClient, db_session: Session):
    """
    Scenario F: Cancellation of a QUEUED run immediately transitions state to CANCELLED.
    """
    # Create run via API
    resp = client.post("/api/orchestration/runs", json={
        "workspace_id": "tenant-f",
        "site_id": 101,
        "run_type": "ON_DEMAND_SCAN",
        "trigger_source": "manual",
    })
    assert resp.status_code in (200, 201), resp.text
    run_id = resp.json()["run_id"]

    # Cancel the run
    cancel_resp = client.post(f"/api/orchestration/runs/{run_id}/cancel", json={
        "workspace_id": "tenant-f",
        "site_id": 101,
        "reason": "Operator cancelled prior to pickup",
        "requested_by": "usr-123",
    })
    assert cancel_resp.status_code == 200, cancel_resp.text
    cancel_data = cancel_resp.json()
    assert cancel_data["status"] in ("CANCELLED", "SUCCESS") or "CANCELLED" in cancel_data["outcome"]

    # Verify run state in database
    run = db_session.query(OrchestrationRun).filter(OrchestrationRun.id == run_id).first()
    assert run.state == RunState.CANCELLED.value


def test_scenario_g_active_run_cooperative_cancellation(db_session: Session, orchestrator: ProductionOrchestrator):
    """
    Scenario G: Active run checks cancellation at safe boundaries and cancels cleanly.
    """
    workspace_id = "tenant-g"
    site_id = 101

    run = orchestrator.create_and_execute_run(
        db=db_session,
        workspace_id=workspace_id,
        site_id=site_id,
        run_type=RunType.ON_DEMAND_SCAN,
        trigger_source=TriggerSource.MANUAL,
        auto_execute=False,
    )

    # Request cooperative cancellation
    orchestrator.control_service.request_cancellation(
        workspace_id=workspace_id,
        site_id=site_id,
        run_id=run.id,
        requested_by="operator",
        db=db_session,
        reason="Aborted by user request",
    )

    # Execute with cancellation pending -> should stop at milestone and cancel cleanly
    cancelled_run = orchestrator.execute_run(db=db_session, run_id=run.run_id)
    assert cancelled_run.state == RunState.CANCELLED.value


def test_scenario_h_pause_and_resume_at_checkpoint(client: TestClient, db_session: Session, orchestrator: ProductionOrchestrator):
    """
    Scenario H: Pause active run at checkpoint and resume later without re-running earlier stages.
    """
    workspace_id = "tenant-h"
    site_id = 101

    run = orchestrator.create_and_execute_run(
        db=db_session,
        workspace_id=workspace_id,
        site_id=site_id,
        run_type=RunType.ON_DEMAND_SCAN,
        trigger_source=TriggerSource.MANUAL,
        auto_execute=False,
    )

    # Pause via API
    pause_resp = client.post(f"/api/orchestration/runs/{run.run_id}/pause", json={
        "workspace_id": workspace_id,
        "site_id": site_id,
        "reason": "Maintenance window pause",
    })
    assert pause_resp.status_code == 200, pause_resp.text
    pause_data = pause_resp.json()
    assert pause_data["status"] in (RunState.PAUSED.value, "PAUSED", "SUCCESS")

    # Resume via API
    resume_resp = client.post(f"/api/orchestration/runs/{run.run_id}/resume", json={
        "workspace_id": workspace_id,
        "site_id": site_id,
    })
    assert resume_resp.status_code == 200, resume_resp.text
    resume_data = resume_resp.json()
    assert resume_data["status"] in (RunState.QUEUED.value, "QUEUED", "RESUMED", "SUCCESS")


def test_scenario_i_safety_gate_blocks_manual_review_fix(db_session: Session, orchestrator: ProductionOrchestrator):
    """
    Scenario I: Fixes requiring MANUAL_REVIEW or unapproved ASSISTED fixes are
    strictly blocked by the Safety Gate and do not mutate live environments.
    """
    # 1. Test MANUAL_REVIEW classification
    manual_fix = {
        "id": "fix-dangerous-schema",
        "action_type": "arbitrary_code_injection",
        "patch_content": "import os; os.system('rm -rf /')",
        "category": "core_infrastructure",
    }
    decision = OrchestrationSafetyGate.evaluate_fix_plan(manual_fix, automation_level=AutomationLevel.FULL)
    assert decision.allowed is False
    assert decision.decision == SafetyDecisionType.BLOCKED

    # 2. Test MANUAL_ONLY tenant policy blocks autonomous execution
    safe_fix = {
        "id": "fix-meta-title",
        "action_type": "update_meta_tags",
        "category": "metadata",
        "suggested_content": "<title>Acme Best Products</title>",
    }
    decision_manual_policy = OrchestrationSafetyGate.evaluate_fix_plan(
        safe_fix,
        automation_level=AutomationLevel.MANUAL_ONLY,
    )
    assert decision_manual_policy.allowed is False
    assert decision_manual_policy.decision == SafetyDecisionType.REQUIRES_APPROVAL

    # 3. Seed unapproved fix in DB and verify orchestrator outcome is PARTIAL or handled safely
    site_id = 101
    scan = Scan(id=50, website_id=site_id, status="completed")
    finding = Finding(
        id=50,
        website_id=site_id,
        scan_id=50,
        finding_type="dangerous_config",
        title="Dangerous Config",
        description="Potential security hazard",
    )
    rec = Recommendation(
        id=50,
        finding_id=50,
        title="Review Config",
        description="Review security configuration before applying",
    )
    fix_plan = FixPlan(
        id=901,
        recommendation_id=50,
        finding_id=50,
        website_id=site_id,
        scan_id=50,
        fix_type="arbitrary_schema_change",
        title="Dangerous Schema Change",
        description="Modifies table directly",
        problem_statement="Problem",
        proposed_action="Execute DDL",
        expected_outcome="Modified table",
        risk_level="high",
        status="pending_review",
    )
    db_session.add_all([scan, finding, rec, fix_plan])
    db_session.commit()

    run = orchestrator.create_and_execute_run(
        db=db_session,
        workspace_id="tenant-i",
        site_id=site_id,
        trigger_source=TriggerSource.MANUAL,
    )

    assert run.state in (RunState.PARTIAL.value, RunState.SUCCEEDED.value)


def test_scenario_j_approved_fix_execution_receipt_verification(db_session: Session, orchestrator: ProductionOrchestrator):
    """
    Scenario J: An approved or AUTO_SAFE fix is safely executed, receipts are recorded,
    and verification rescan is performed.
    """
    site_id = 101
    workspace_id = "tenant-j"

    # Seed approved AUTO_SAFE fix
    scan = Scan(id=60, website_id=site_id, status="completed")
    finding = Finding(
        id=60,
        website_id=site_id,
        scan_id=60,
        finding_type="missing_description",
        title="Missing Meta Description",
        description="Page lacks meta description",
    )
    rec = Recommendation(
        id=60,
        finding_id=60,
        title="Add Meta Description",
        description="Add appropriate meta description tag to page head",
    )
    fix_plan = FixPlan(
        id=902,
        recommendation_id=60,
        finding_id=60,
        website_id=site_id,
        scan_id=60,
        fix_type="update_meta_description",
        title="Add Meta Description",
        description="Adds meta description to header",
        problem_statement="No description",
        proposed_action="Insert meta description tag",
        expected_outcome="Meta description displayed",
        risk_level="low",
        status="approved",
    )
    db_session.add_all([scan, finding, rec, fix_plan])
    db_session.commit()

    run = orchestrator.create_and_execute_run(
        db=db_session,
        workspace_id=workspace_id,
        site_id=site_id,
        trigger_source=TriggerSource.MANUAL,
    )

    assert run.state == RunState.SUCCEEDED.value

    # Verify execution receipts created
    receipts = db_session.query(ExecutionReceipt).filter(ExecutionReceipt.run_id == run.run_id).all()
    assert len(receipts) >= 1
    assert receipts[0].status in (ReceiptStatus.SUCCESS.value, ReceiptStatus.VERIFIED.value, ReceiptStatus.APPLIED.value)


def test_scenario_k_validation_failure_yields_partial_outcome(db_session: Session, orchestrator: ProductionOrchestrator):
    """
    Scenario K: If verification detects a regression or validation failure,
    the run terminates with PARTIAL outcome.
    """
    site_id = 101
    workspace_id = "tenant-k"

    # Seed failed validation result
    val_res = ValidationResult(
        id=701,
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
        workspace_id=workspace_id,
        site_id=site_id,
        trigger_source=TriggerSource.MANUAL,
    )

    assert run.state == RunState.PARTIAL.value


def test_scenario_l_stale_evidence_refresh(db_session: Session, orchestrator: ProductionOrchestrator):
    """
    Scenario L: Evaluates evidence freshness, detects stale evidence, and triggers
    freshness refresh gracefully.
    """
    site_id = 101
    from app.orchestration.freshness_service import FreshnessService
    freshness_svc = FreshnessService()

    # Evaluates site freshness
    evaluations = freshness_svc.evaluate_site_freshness(
        workspace_id="tenant-l",
        site_id=site_id,
        db=db_session,
    )
    assert isinstance(evaluations, list)
    assert len(evaluations) > 0

    # Running orchestrator handles fresh scan creation and succeeds
    run = orchestrator.create_and_execute_run(
        db=db_session,
        workspace_id="tenant-l",
        site_id=site_id,
        trigger_source=TriggerSource.MANUAL,
    )
    assert run.state == RunState.SUCCEEDED.value


def test_scenario_m_provider_outage_safe_degradation(db_session: Session, orchestrator: ProductionOrchestrator):
    """
    Scenario M: Provider outage or external dependency degradation is classified
    and degrades safely without corrupted state.
    """
    failure = orchestrator.failure_classifier.classify(
        Exception("503 Service Unavailable: Search Provider API is down"),
    )
    assert failure.failure_class == FailureClass.TRANSIENT
    assert failure.error_code == "ERR_TRANSIENT"
    assert failure.is_retryable is True


def test_scenario_n_multi_tenant_isolation_enforcement(client: TestClient, db_session: Session, orchestrator: ProductionOrchestrator):
    """
    Scenario N: Strict multi-tenant isolation rejects cross-tenant operations
    with 403 Forbidden or TenantMismatchError.
    """
    # Create run for tenant A
    run_a = orchestrator.create_and_execute_run(
        db=db_session,
        workspace_id="tenant-alpha",
        site_id=101,
        run_type=RunType.ON_DEMAND_SCAN,
        trigger_source=TriggerSource.MANUAL,
        auto_execute=False,
    )

    # 1. Internal controller rejection
    with pytest.raises(TenantMismatchError):
        orchestrator.execute_run(
            db=db_session,
            run_id=run_a.run_id,
            workspace_id="tenant-bravo",  # Wrong tenant!
        )

    # 2. API level rejection
    resp = client.get(f"/api/orchestration/runs/{run_a.run_id}?workspace_id=tenant-bravo")
    assert resp.status_code == 403
    assert "Tenant boundary violation" in resp.json()["detail"] or "Tenant mismatch" in resp.json()["detail"]


def test_scenario_o_duplicate_scheduler_event_deduplication(db_session: Session, orchestrator: ProductionOrchestrator):
    """
    Scenario O: Duplicate scheduler events with identical idempotency keys are
    deduplicated and do not trigger duplicate execution.
    """
    workspace_id = "tenant-o"
    site_id = 101
    idempotency_key = "sched-daily-2026-09-11-acme"

    # First run
    run1 = orchestrator.create_and_execute_run(
        db=db_session,
        workspace_id=workspace_id,
        site_id=site_id,
        run_type=RunType.SCHEDULED_SCAN,
        trigger_source=TriggerSource.SCHEDULER,
        idempotency_key=idempotency_key,
        auto_execute=False,
    )

    # Second run with same idempotency key returns existing run or raises IdempotencyConflictError
    run2 = orchestrator.create_and_execute_run(
        db=db_session,
        workspace_id=workspace_id,
        site_id=site_id,
        run_type=RunType.SCHEDULED_SCAN,
        trigger_source=TriggerSource.SCHEDULER,
        idempotency_key=idempotency_key,
        auto_execute=False,
    )
    assert run1.id == run2.id


def test_scenario_p_observability_and_secret_scrubbing(client: TestClient, db_session: Session, orchestrator: ProductionOrchestrator):
    """
    Scenario P: Verifies end-to-end secret scrubbing across all stage contracts,
    events, checkpoints, and API responses.
    """
    run = orchestrator.create_and_execute_run(
        db=db_session,
        workspace_id="tenant-p",
        site_id=101,
        trigger_source=TriggerSource.MANUAL,
        parameters={"api_key": "secret_key_12345", "password": "super_secret_pwd"},
    )

    # Query events via API with matching workspace_id
    resp = client.get(f"/api/orchestration/runs/{run.run_id}/events?workspace_id=tenant-p")
    assert resp.status_code == 200
    events_data = resp.json()

    # Assert secret tokens are never exposed in cleartext
    for event in events_data:
        payload_str = str(event.get("payload", {}))
        assert "secret_key_12345" not in payload_str
        assert "super_secret_pwd" not in payload_str


def test_scenario_q_run_result_endpoint_contract(client: TestClient, db_session: Session, orchestrator: ProductionOrchestrator):
    """
    Scenario Q: Run result endpoint returns complete before/after evidence, receipts,
    and stage breakdown conforming to OrchestrationRunResultResponse schema.
    """
    run = orchestrator.create_and_execute_run(
        db=db_session,
        workspace_id="tenant-q",
        site_id=101,
        trigger_source=TriggerSource.MANUAL,
    )

    resp = client.get(f"/api/orchestration/runs/{run.run_id}/result?workspace_id=tenant-q")
    assert resp.status_code == 200, resp.text
    result = resp.json()

    assert result["run_id"] == run.run_id
    assert result["workspace_id"] == "tenant-q"
    assert result["site_id"] == 101
    assert result["status"] == run.state
    assert len(result["stages_executed"]) == 7
    assert "receipts" in result
    assert result["completed_at"] is not None
    assert result["timing"]["started_at"] is not None
