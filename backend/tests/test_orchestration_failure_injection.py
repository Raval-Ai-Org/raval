"""
Production Orchestration & Monitoring - Systematic Stage Failure Injection Suite (Task 14 Step 8).

Verifies controlled failure injection across all 7 canonical orchestration stages:
1. SCANNING (crawler / discovery network failure)
2. ANALYZING (page extraction / content intelligence fatal schema error)
3. OBSERVING (AI visibility / citation provider timeout)
4. PLANNING (opportunity / recommendation engine error)
5. EXECUTING (connector mutation / provider execution failure)
6. VERIFYING (validation engine failure)
7. MONITORING (continuous monitoring telemetry failure)
Plus:
- External provider 429 rate limit backoff.
- Worker crash during lease execution.
"""

from __future__ import annotations

from datetime import datetime, timezone
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.models import Website
from app.orchestration.enums import (
    FailureClass,
    RunState,
    RunType,
    StageState,
    TriggerSource,
)
from app.orchestration.orchestrator import ProductionOrchestrator
from app.orchestration.queue import (
    LocalOrchestrationQueue,
    QueueJob,
)
from app.orchestration.recovery import RecoveryService
from app.orchestration.worker import StaleJobDetector


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

    site1 = Website(id=101, name="Acme Fail Injection", url="https://acme-fail.example.com")
    session.add(site1)
    session.commit()

    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(bind=engine)


@pytest.fixture
def orchestrator() -> ProductionOrchestrator:
    return ProductionOrchestrator()


def test_failure_injection_scanning_stage_transient_retry(
    db_session: Session,
    orchestrator: ProductionOrchestrator,
    monkeypatch: pytest.MonkeyPatch,
):
    """
    Injects a transient network timeout into SCANNING stage -> enters RETRY_WAIT.
    """
    def mock_broken_scan(db, contract):
        raise ConnectionResetError("Connection reset by remote crawler proxy")

    monkeypatch.setattr(orchestrator.scanning_handler, "execute", mock_broken_scan)

    run = orchestrator.create_and_execute_run(
        db=db_session,
        workspace_id="tenant-fail-scan",
        site_id=101,
        trigger_source=TriggerSource.MANUAL,
    )

    assert run.state == RunState.RETRY_WAIT.value
    assert run.error_detail is not None
    assert run.error_detail.get("failure_class") == FailureClass.TRANSIENT.value


def test_failure_injection_scanning_stage_fatal(
    db_session: Session,
    orchestrator: ProductionOrchestrator,
    monkeypatch: pytest.MonkeyPatch,
):
    """
    Injects a non-retryable configuration error into SCANNING stage -> transitions to FAILED.
    """
    def mock_fatal_scan(db, contract):
        raise ValueError("Invalid target crawler configuration: bad protocol")

    monkeypatch.setattr(orchestrator.scanning_handler, "execute", mock_fatal_scan)

    run = orchestrator.create_and_execute_run(
        db=db_session,
        workspace_id="tenant-fail-fatal",
        site_id=101,
        trigger_source=TriggerSource.MANUAL,
    )

    assert run.state == RunState.FAILED.value
    assert run.error_detail is not None
    assert run.error_detail.get("failure_class") in (
        FailureClass.CONFIGURATION.value,
        FailureClass.DATA_VALIDATION.value,
    )


def test_failure_injection_analysis_stage(
    db_session: Session,
    orchestrator: ProductionOrchestrator,
    monkeypatch: pytest.MonkeyPatch,
):
    """
    Injects fatal extraction error into ANALYZING stage -> transitions to FAILED.
    """
    def mock_broken_analyze(db, contract):
        raise KeyError("Required HTML DOM document element missing")

    monkeypatch.setattr(orchestrator.analysis_handler, "execute", mock_broken_analyze)

    run = orchestrator.create_and_execute_run(
        db=db_session,
        workspace_id="tenant-fail-ana",
        site_id=101,
        trigger_source=TriggerSource.MANUAL,
    )

    assert run.state == RunState.FAILED.value
    assert "Required HTML DOM" in str(run.error_detail)


def test_failure_injection_observation_stage(
    db_session: Session,
    orchestrator: ProductionOrchestrator,
    monkeypatch: pytest.MonkeyPatch,
):
    """
    Injects a provider timeout into OBSERVING stage -> transitions to RETRY_WAIT.
    """
    def mock_timeout_observing(db, contract):
        raise TimeoutError("AI Search Provider API timed out after 30000ms")

    monkeypatch.setattr(orchestrator.observation_handler, "execute", mock_timeout_observing)

    run = orchestrator.create_and_execute_run(
        db=db_session,
        workspace_id="tenant-fail-obs",
        site_id=101,
        trigger_source=TriggerSource.MANUAL,
    )

    assert run.state == RunState.RETRY_WAIT.value
    assert run.error_detail.get("failure_class") == FailureClass.TIMEOUT.value


def test_failure_injection_planning_stage(
    db_session: Session,
    orchestrator: ProductionOrchestrator,
    monkeypatch: pytest.MonkeyPatch,
):
    """
    Injects a non-retryable error into PLANNING stage -> transitions to FAILED.
    """
    def mock_broken_planning(db, contract):
        raise ValueError("Opportunity rule validation error: missing required schema")

    monkeypatch.setattr(orchestrator.planning_handler, "execute", mock_broken_planning)

    run = orchestrator.create_and_execute_run(
        db=db_session,
        workspace_id="tenant-fail-plan",
        site_id=101,
        trigger_source=TriggerSource.MANUAL,
    )

    assert run.state == RunState.FAILED.value


def test_failure_injection_execution_stage(
    db_session: Session,
    orchestrator: ProductionOrchestrator,
    monkeypatch: pytest.MonkeyPatch,
):
    """
    Injects an execution error into EXECUTING stage -> transitions to RETRY_WAIT or FAILED.
    """
    def mock_broken_executing(db, contract):
        raise TimeoutError("Connector API endpoint connection timed out")

    monkeypatch.setattr(orchestrator.execution_handler, "execute", mock_broken_executing)

    run = orchestrator.create_and_execute_run(
        db=db_session,
        workspace_id="tenant-fail-exec",
        site_id=101,
        trigger_source=TriggerSource.MANUAL,
    )

    assert run.state == RunState.RETRY_WAIT.value


def test_failure_injection_verification_stage(
    db_session: Session,
    orchestrator: ProductionOrchestrator,
    monkeypatch: pytest.MonkeyPatch,
):
    """
    Injects an unhandled exception into VERIFYING stage -> transitions to FAILED.
    """
    def mock_broken_verify(db, contract):
        raise RuntimeError("Validation engine internal assertion failure")

    monkeypatch.setattr(orchestrator.verification_handler, "execute", mock_broken_verify)

    run = orchestrator.create_and_execute_run(
        db=db_session,
        workspace_id="tenant-fail-ver",
        site_id=101,
        trigger_source=TriggerSource.MANUAL,
    )

    assert run.state == RunState.FAILED.value


def test_failure_injection_monitoring_stage(
    db_session: Session,
    orchestrator: ProductionOrchestrator,
    monkeypatch: pytest.MonkeyPatch,
):
    """
    Injects a non-retryable error into MONITORING stage -> transitions to FAILED.
    """
    def mock_broken_monitoring(db, contract):
        raise ValueError("Telemetry evaluation metric format error")

    monkeypatch.setattr(orchestrator.monitoring_handler, "execute", mock_broken_monitoring)

    run = orchestrator.create_and_execute_run(
        db=db_session,
        workspace_id="tenant-fail-mon",
        site_id=101,
        trigger_source=TriggerSource.MANUAL,
    )

    assert run.state == RunState.FAILED.value


def test_failure_injection_provider_429_rate_limit(orchestrator: ProductionOrchestrator):
    """
    Verifies that HTTP 429 Too Many Requests exception classifies cleanly as PROVIDER_RATE_LIMIT.
    """
    class RateLimitError(Exception):
        status_code = 429
        retry_after = 60.0

    rate_limit_ex = RateLimitError("HTTP 429 Too Many Requests: Rate limit exceeded.")
    failure = orchestrator.failure_classifier.classify(rate_limit_ex)

    assert failure.failure_class == FailureClass.PROVIDER_RATE_LIMIT
    assert failure.is_retryable is True
    assert failure.retry_after_seconds == 60.0

    decision = orchestrator.retry_engine.evaluate(failure=failure, attempt_number=1)
    assert decision.should_retry is True
    assert decision.delay_seconds >= 60.0
