"""
Production Orchestration & Monitoring - Test Suite for Step 6.
Tests observability, operational metrics, health evaluation, alerting engine,
deterministic deduplication, tenant policies, and multi-tenant isolation.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone, timedelta
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.main import app
from app.models import Website
from app.orchestration.alerting import AlertRulesEngine, AlertService
from app.orchestration.enums import (
    AlertSeverity,
    AlertStatus,
    AlertType,
    AutomationLevel,
    HealthDimension,
    MonitoringSeverity,
    MonitoringStatus,
    OrchestrationEventType,
    ReceiptStatus,
    RunState,
    StageName,
    StageState,
    SystemHealthStatus,
)
from app.orchestration.exceptions import (
    AlertNotFoundError,
    GlobalCeilingExceededError,
    InvalidAlertTransitionError,
    PolicyViolationError,
    SiteMismatchError,
    TenantMismatchError,
)
from app.orchestration.health import DependencyHealthTracker, SystemHealthService
from app.orchestration.models import (
    ExecutionReceipt,
    OrchestrationAlert,
    OrchestrationCheckpoint,
    OrchestrationControlRequest,
    OrchestrationEvent,
    OrchestrationMonitoringObservation,
    OrchestrationRun,
    OrchestrationStage,
    Schedule,
    TenantOrchestrationPolicy,
)
from app.orchestration.observability import ObservabilityService, OperationalMetricsService
from app.orchestration.policies import (
    DEFAULT_POLICY,
    GLOBAL_CEILINGS,
    PolicyDecision,
    PolicyEvaluator,
    TenantPolicyRegistry,
)


@pytest.fixture
def db_session():
    """Isolated in-memory SQLite session with full schema initialized."""
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    session = TestingSessionLocal()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(bind=engine)


@pytest.fixture
def client(db_session: Session):
    """FastAPI TestClient with overridden database dependency."""
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
def sample_site(db_session: Session) -> Website:
    """Fixture website for tenant 'ws-test'."""
    site = Website(
        id=101,
        name="Test Site 101",
        url="https://site101.example.com",
    )
    db_session.add(site)
    db_session.commit()
    db_session.refresh(site)
    return site


@pytest.fixture
def other_site(db_session: Session) -> Website:
    """Fixture website for a different tenant."""
    site = Website(
        id=202,
        name="Other Site 202",
        url="https://site202.example.com",
    )
    db_session.add(site)
    db_session.commit()
    db_session.refresh(site)
    return site


# =====================================================================
# 1. OBSERVABILITY & EVENT MODEL TESTS
# =====================================================================


class TestObservabilityEvents:
    def test_record_and_get_event(self, db_session: Session, sample_site: Website):
        svc = ObservabilityService()
        event = svc.record_event(
            db_session,
            workspace_id="ws-test",
            event_type=OrchestrationEventType.RUN_CREATED,
            site_id=sample_site.id,
            run_id="run-1",
            correlation_id="corr-123",
            severity=AlertSeverity.INFO,
            details={"step": 1, "api_key": "sk-secret12345"},
        )
        assert event.id.startswith("evt_")
        assert event.workspace_id == "ws-test"
        assert event.site_id == sample_site.id
        assert event.run_id == "run-1"
        assert event.correlation_id == "corr-123"
        # Secret redaction check
        assert event.details.get("api_key") != "sk-secret12345"
        assert "REDACTED" in str(event.details.get("api_key"))

        # Retrieve event
        fetched = svc.get_event(db_session, "ws-test", event.id)
        assert fetched is not None
        assert fetched.id == event.id

        # Cross-tenant isolation check
        other_fetched = svc.get_event(db_session, "ws-other", event.id)
        assert other_fetched is None

    def test_list_events_with_filters_and_pagination(self, db_session: Session, sample_site: Website):
        svc = ObservabilityService()
        for i in range(5):
            svc.record_event(
                db_session,
                workspace_id="ws-test",
                event_type=OrchestrationEventType.JOB_ENQUEUED,
                site_id=sample_site.id,
                job_id=f"job-{i}",
                correlation_id="corr-batch-1",
            )
        svc.record_event(
            db_session,
            workspace_id="ws-test",
            event_type=OrchestrationEventType.ALERT_OPENED,
            site_id=sample_site.id,
            severity=AlertSeverity.HIGH,
        )

        # Filter by event_type
        jobs, total_jobs = svc.list_events(
            db_session, "ws-test", event_type=OrchestrationEventType.JOB_ENQUEUED
        )
        assert total_jobs == 5
        assert len(jobs) == 5

        # Filter by severity
        alerts, total_alerts = svc.list_events(
            db_session, "ws-test", severity=AlertSeverity.HIGH
        )
        assert total_alerts == 1
        assert alerts[0].event_type == OrchestrationEventType.ALERT_OPENED.value

        # Pagination
        paged, _ = svc.list_events(db_session, "ws-test", limit=2, offset=0)
        assert len(paged) == 2


# =====================================================================
# 2. OPERATIONAL METRICS TESTS
# =====================================================================


class TestOperationalMetrics:
    def test_operational_metrics_calculation(self, db_session: Session, sample_site: Website):
        now = datetime.now(timezone.utc)
        # Create completed successful run
        r1 = OrchestrationRun(
            id="run-succ",
            workspace_id="ws-test",
            site_id=sample_site.id,
            run_type="ON_DEMAND_SCAN",
            state=RunState.SUCCEEDED.value,
            idempotency_key="idemp-1",
            correlation_id="corr-1",
            requested_at=now - timedelta(seconds=100),
            started_at=now - timedelta(seconds=90),
            completed_at=now - timedelta(seconds=30),
        )
        # Create failed run
        r2 = OrchestrationRun(
            id="run-fail",
            workspace_id="ws-test",
            site_id=sample_site.id,
            run_type="ON_DEMAND_SCAN",
            state=RunState.FAILED.value,
            idempotency_key="idemp-2",
            correlation_id="corr-2",
            requested_at=now - timedelta(seconds=50),
            started_at=now - timedelta(seconds=45),
            completed_at=now - timedelta(seconds=10),
        )
        # Create cancelled run (intentional cancellation)
        r3 = OrchestrationRun(
            id="run-canc",
            workspace_id="ws-test",
            site_id=sample_site.id,
            run_type="ON_DEMAND_SCAN",
            state=RunState.CANCELLED.value,
            idempotency_key="idemp-3",
            correlation_id="corr-3",
            requested_at=now - timedelta(seconds=20),
            started_at=now - timedelta(seconds=15),
            completed_at=now - timedelta(seconds=5),
        )
        db_session.add_all([r1, r2, r3])

        # Add stage
        s1 = OrchestrationStage(
            id="stg-1",
            run_id=r1.id,
            workspace_id="ws-test",
            site_id=sample_site.id,
            stage_name=StageName.CRAWL_DISCOVERY.value,
            execution_order=1,
            state=StageState.SUCCEEDED.value,
            idempotency_key="stg-idemp-1",
            attempt_count=1,
            started_at=now - timedelta(seconds=90),
            completed_at=now - timedelta(seconds=60),
        )
        db_session.add(s1)
        db_session.commit()

        # Add events
        obs = ObservabilityService()
        obs.record_event(db_session, "ws-test", OrchestrationEventType.WORKER_RECOVERED, site_id=sample_site.id)
        obs.record_event(db_session, "ws-test", OrchestrationEventType.REFRESH_COMPLETED, site_id=sample_site.id)

        metrics_svc = OperationalMetricsService()
        res = metrics_svc.compute_metrics(
            db_session,
            "ws-test",
            site_id=sample_site.id,
            start_time=now - timedelta(hours=1),
            end_time=now + timedelta(minutes=1),
        )

        assert res["run_counts"]["total"] == 3
        assert res["run_counts"]["succeeded"] == 1
        assert res["run_counts"]["failed"] == 1
        assert res["run_counts"]["cancelled"] == 1
        assert res["worker_recovery_count"] == 1
        assert res["freshness_refresh_count"] == 1
        assert res["run_durations"]["sample_count"] == 3
        assert res["run_durations"]["avg_seconds"] > 0
        assert res["queue_wait_times"]["avg_seconds"] > 0


# =====================================================================
# 3. HEALTH EVALUATION TESTS
# =====================================================================


class TestHealthEvaluation:
    def test_system_health_healthy(self, db_session: Session, sample_site: Website):
        health_svc = SystemHealthService()
        res = health_svc.evaluate_system_health(db_session, "ws-test", site_id=sample_site.id)

        assert res["overall_status"] in (SystemHealthStatus.HEALTHY.value, SystemHealthStatus.UNKNOWN.value)
        assert res["dimensions"][HealthDimension.DATABASE.value]["status"] == SystemHealthStatus.HEALTHY.value
        assert res["dimensions"][HealthDimension.DATABASE.value]["evidence"]["connected"] is True

    def test_dependency_health_from_receipts(self, db_session: Session, sample_site: Website):
        now = datetime.now(timezone.utc)
        # Create successful receipts for ai_provider
        rec1 = ExecutionReceipt(
            id="rec-1",
            run_id="run-1",
            stage_id="stg-1",
            workspace_id="ws-test",
            site_id=sample_site.id,
            operation_type="probe",
            idempotency_key="rec-key-1",
            status=ReceiptStatus.CONFIRMED.value,
            details={"provider_name": "ai_provider"},
            created_at=now - timedelta(minutes=10),
        )
        # Create auth failure receipt for crawler
        rec2 = ExecutionReceipt(
            id="rec-2",
            run_id="run-1",
            stage_id="stg-1",
            workspace_id="ws-test",
            site_id=sample_site.id,
            operation_type="fetch",
            idempotency_key="rec-key-2",
            status=ReceiptStatus.FAILED.value,
            details={"provider_name": "crawler", "error": "401 Unauthorized API access forbidden"},
            created_at=now - timedelta(minutes=5),
        )
        db_session.add_all([rec1, rec2])
        db_session.commit()

        tracker = DependencyHealthTracker()
        eval_res = tracker.evaluate_providers(db_session, "ws-test", site_id=sample_site.id)

        # Crawler should be UNHEALTHY due to auth failure
        assert eval_res["providers"]["crawler"]["status"] == SystemHealthStatus.UNHEALTHY.value
        assert "Authentication failure detected" in eval_res["providers"]["crawler"]["reasons"][0]
        # AI provider should be HEALTHY
        assert eval_res["providers"]["ai_provider"]["status"] == SystemHealthStatus.HEALTHY.value

    def test_execution_health_with_ambiguous_receipt(self, db_session: Session, sample_site: Website):
        rec = ExecutionReceipt(
            id="rec-ambig",
            run_id="run-1",
            stage_id="stg-1",
            workspace_id="ws-test",
            site_id=sample_site.id,
            operation_type="mutation",
            idempotency_key="rec-ambig-key",
            status=ReceiptStatus.AMBIGUOUS.value,
            details={"provider_name": "wordpress"},
        )
        db_session.add(rec)
        db_session.commit()

        health_svc = SystemHealthService()
        res = health_svc.evaluate_system_health(db_session, "ws-test", site_id=sample_site.id)
        assert res["dimensions"][HealthDimension.EXECUTION.value]["status"] == SystemHealthStatus.DEGRADED.value
        assert res["dimensions"][HealthDimension.EXECUTION.value]["evidence"]["ambiguous_receipts"] == 1


# =====================================================================
# 4. ALERTS & DEDUPLICATION TESTS
# =====================================================================


class TestAlertsAndRules:
    def test_alert_creation_and_deduplication(self, db_session: Session, sample_site: Website):
        alert_svc = AlertService()
        # First observation
        a1 = alert_svc.record_or_update_alert(
            db_session,
            "ws-test",
            AlertType.QUEUE_SATURATION,
            AlertSeverity.HIGH,
            "Queue depth exceeded threshold",
            site_id=sample_site.id,
            resource="queue_primary",
            details={"depth": 45},
        )
        assert a1.id.startswith("alt_")
        assert a1.occurrence_count == 1
        assert a1.status == AlertStatus.OPEN.value

        # Repeat observation within same window
        a2 = alert_svc.record_or_update_alert(
            db_session,
            "ws-test",
            AlertType.QUEUE_SATURATION,
            AlertSeverity.HIGH,
            "Queue depth still elevated",
            site_id=sample_site.id,
            resource="queue_primary",
            details={"depth": 52},
        )
        # Should deduplicate into the same alert record
        assert a2.id == a1.id
        assert a2.occurrence_count == 2
        assert a2.details.get("depth") == 52

    def test_alert_lifecycle_acknowledge_and_resolve(self, db_session: Session, sample_site: Website):
        alert_svc = AlertService()
        a = alert_svc.record_or_update_alert(
            db_session,
            "ws-test",
            AlertType.WORKER_FAILURE,
            AlertSeverity.HIGH,
            "Worker worker-1 heartbeat missed",
            site_id=sample_site.id,
            resource="worker-1",
        )
        assert a.status == AlertStatus.OPEN.value

        # Acknowledge
        ack = alert_svc.acknowledge_alert(db_session, "ws-test", a.id, acknowledged_by="devops_oncall")
        assert ack.status == AlertStatus.ACKNOWLEDGED.value
        assert ack.acknowledged_by == "devops_oncall"
        assert ack.acknowledged_at is not None

        # Resolve
        res = alert_svc.resolve_alert(
            db_session,
            "ws-test",
            a.id,
            resolved_by="devops_oncall",
            resolution_reason="Worker restarted and verified healthy",
            evidence={"heartbeats_received": 10},
        )
        assert res.status == AlertStatus.RESOLVED.value
        assert res.resolution_reason == "Worker restarted and verified healthy"

        # Cannot acknowledge a resolved alert
        with pytest.raises(InvalidAlertTransitionError):
            alert_svc.acknowledge_alert(db_session, "ws-test", a.id, acknowledged_by="devops_oncall")

    def test_critical_rule_repeated_orchestration_failure(self, db_session: Session, sample_site: Website):
        now = datetime.now(timezone.utc)
        # Add 3 consecutive failed runs
        for i in range(3):
            r = OrchestrationRun(
                id=f"run-fail-{i}",
                workspace_id="ws-test",
                site_id=sample_site.id,
                run_type="ON_DEMAND_SCAN",
                state=RunState.FAILED.value,
                idempotency_key=f"idemp-f-{i}",
                correlation_id=f"corr-f-{i}",
                requested_at=now - timedelta(minutes=30 - i * 5),
            )
            db_session.add(r)
        db_session.commit()

        engine = AlertRulesEngine()
        alerts = engine.evaluate_rules(db_session, "ws-test", site_id=sample_site.id)

        crit_alerts = [a for a in alerts if a.alert_type == AlertType.REPEATED_ORCHESTRATION_FAILURE.value]
        assert len(crit_alerts) == 1
        assert crit_alerts[0].severity == AlertSeverity.CRITICAL.value

        # Auto-recovery: Now add a successful run
        succ_run = OrchestrationRun(
            id="run-recovery-succ",
            workspace_id="ws-test",
            site_id=sample_site.id,
            run_type="ON_DEMAND_SCAN",
            state=RunState.SUCCEEDED.value,
            idempotency_key="idemp-recovery",
            correlation_id="corr-recovery",
            requested_at=now + timedelta(minutes=1),
        )
        db_session.add(succ_run)
        db_session.commit()

        # Re-evaluate rules -> alert should be auto-resolved
        engine.evaluate_rules(db_session, "ws-test", site_id=sample_site.id)
        refetched_alert = db_session.get(OrchestrationAlert, crit_alerts[0].id)
        assert refetched_alert.status == AlertStatus.RESOLVED.value
        assert "Orchestration pipeline recovered" in refetched_alert.resolution_reason

    def test_cancellation_and_pause_never_produce_failure_alerts(self, db_session: Session, sample_site: Website):
        now = datetime.now(timezone.utc)
        # Add cancelled run and paused run
        r_canc = OrchestrationRun(
            id="run-cancellation",
            workspace_id="ws-test",
            site_id=sample_site.id,
            run_type="ON_DEMAND_SCAN",
            state=RunState.CANCELLED.value,
            idempotency_key="idemp-canc",
            correlation_id="corr-canc",
            requested_at=now - timedelta(minutes=10),
        )
        r_pause = OrchestrationRun(
            id="run-pause",
            workspace_id="ws-test",
            site_id=sample_site.id,
            run_type="ON_DEMAND_SCAN",
            state=RunState.PAUSED.value,
            idempotency_key="idemp-pause",
            correlation_id="corr-pause",
            requested_at=now - timedelta(minutes=5),
        )
        db_session.add_all([r_canc, r_pause])
        db_session.commit()

        engine = AlertRulesEngine()
        alerts = engine.evaluate_rules(db_session, "ws-test", site_id=sample_site.id)

        # There should be NO repeated orchestration failure alert triggered by cancelled/paused runs
        failure_alerts = [a for a in alerts if a.alert_type == AlertType.REPEATED_ORCHESTRATION_FAILURE.value]
        assert len(failure_alerts) == 0


    def test_alert_rules_unsafe_execution_state_ambiguous_receipt(self, db_session: Session, sample_site: Website):
        now = datetime.now(timezone.utc)
        r = OrchestrationRun(
            id="run-test-amb",
            workspace_id="ws-test",
            site_id=sample_site.id,
            run_type="ON_DEMAND_SCAN",
            state=RunState.EXECUTING.value,
            idempotency_key="idemp-run-amb",
            correlation_id="corr-amb",
            requested_at=now - timedelta(minutes=15),
        )
        db_session.add(r)
        db_session.commit()

        amb_receipt = ExecutionReceipt(
            id="rcpt-amb-1",
            run_id=r.id,
            workspace_id="ws-test",
            site_id=sample_site.id,
            idempotency_key="idemp-rcpt-amb",
            status=ReceiptStatus.AMBIGUOUS.value,
            operation_type="DNS_RECORD_UPDATE",
            details={"error": "Connection timed out during write commit"},
            created_at=now - timedelta(minutes=10),
        )
        db_session.add(amb_receipt)
        db_session.commit()

        engine = AlertRulesEngine()
        alerts = engine.evaluate_rules(db_session, "ws-test", site_id=sample_site.id)

        crit_alerts = [a for a in alerts if a.alert_type == AlertType.UNSAFE_EXECUTION_STATE.value]
        assert len(crit_alerts) == 1
        assert crit_alerts[0].severity == AlertSeverity.CRITICAL.value
        assert "ambiguous mutation receipt(s) detected" in crit_alerts[0].summary

    def test_alert_rules_provider_authentication_failure(self, db_session: Session, sample_site: Website):
        now = datetime.now(timezone.utc)
        r = OrchestrationRun(
            id="run-test-auth",
            workspace_id="ws-test",
            site_id=sample_site.id,
            run_type="ON_DEMAND_SCAN",
            state=RunState.EXECUTING.value,
            idempotency_key="idemp-run-auth",
            correlation_id="corr-auth",
            requested_at=now - timedelta(minutes=20),
        )
        db_session.add(r)
        db_session.commit()

        failed_receipt = ExecutionReceipt(
            id="rcpt-auth-fail-1",
            run_id=r.id,
            workspace_id="ws-test",
            site_id=sample_site.id,
            idempotency_key="idemp-rcpt-auth",
            status=ReceiptStatus.FAILED.value,
            operation_type="AI_PROBE_CALL",
            details={"error": "Unauthorized 401: Invalid API Key", "provider_name": "perplexity"},
            created_at=now - timedelta(minutes=15),
        )
        db_session.add(failed_receipt)
        db_session.commit()

        engine = AlertRulesEngine()
        alerts = engine.evaluate_rules(db_session, "ws-test", site_id=sample_site.id)

        auth_alerts = [a for a in alerts if a.alert_type == AlertType.PROVIDER_AUTHENTICATION_FAILURE.value]
        assert len(auth_alerts) == 1
        assert auth_alerts[0].severity == AlertSeverity.HIGH.value
        assert "perplexity" in auth_alerts[0].summary
        assert auth_alerts[0].details.get("provider") == "perplexity"

    def test_alert_rules_stale_evidence_and_auto_resolution(self, db_session: Session, sample_site: Website):
        now = datetime.now(timezone.utc)
        obs_stale = OrchestrationMonitoringObservation(
            workspace_id="ws-test",
            site_id=sample_site.id,
            monitoring_type="EVIDENCE_FRESHNESS",
            status=MonitoringStatus.STALE.value,
            severity=MonitoringSeverity.MEDIUM.value,
            summary="Evidence age 35 days exceeds TTL",
            details={"age_days": 35, "ttl_days": 30},
            observed_at=now - timedelta(minutes=20),
        )
        db_session.add(obs_stale)
        db_session.commit()

        engine = AlertRulesEngine()
        alerts = engine.evaluate_rules(db_session, "ws-test", site_id=sample_site.id)

        stale_alerts = [a for a in alerts if a.alert_type == AlertType.STALE_EVIDENCE_PERSISTENT.value]
        assert len(stale_alerts) == 1
        assert stale_alerts[0].severity == AlertSeverity.MEDIUM.value
        assert stale_alerts[0].status == AlertStatus.OPEN.value

        # Fresh observation arrives
        obs_fresh = OrchestrationMonitoringObservation(
            workspace_id="ws-test",
            site_id=sample_site.id,
            monitoring_type="EVIDENCE_FRESHNESS",
            status=MonitoringStatus.HEALTHY.value,
            severity=MonitoringSeverity.INFO.value,
            summary="Evidence refreshed successfully",
            details={"age_days": 0, "ttl_days": 30},
            observed_at=now + timedelta(minutes=5),
        )
        db_session.add(obs_fresh)
        db_session.commit()

        # Re-evaluate
        engine.evaluate_rules(db_session, "ws-test", site_id=sample_site.id)
        refetched = db_session.get(OrchestrationAlert, stale_alerts[0].id)
        assert refetched.status == AlertStatus.RESOLVED.value
        assert "Freshness restored" in refetched.resolution_reason


# =====================================================================
# 5. TENANT POLICIES & CEILINGS TESTS
# =====================================================================


class TestTenantPolicies:
    def test_default_policy_and_upsert(self, db_session: Session, sample_site: Website):
        registry = TenantPolicyRegistry()
        eff = registry.get_effective_policy(db_session, "ws-test", site_id=sample_site.id)
        assert eff["is_default"] is True
        assert eff["max_concurrent_runs"] == DEFAULT_POLICY["max_concurrent_runs"]

        # Upsert site policy override
        created = registry.upsert_policy(
            db_session,
            "ws-test",
            {"max_concurrent_runs": 8, "max_concurrent_jobs": 15},
            site_id=sample_site.id,
        )
        assert created.max_concurrent_runs == 8

        eff_updated = registry.get_effective_policy(db_session, "ws-test", site_id=sample_site.id)
        assert eff_updated["is_default"] is False
        assert eff_updated["max_concurrent_runs"] == 8

    def test_global_safety_ceiling_rejection(self, db_session: Session, sample_site: Website):
        registry = TenantPolicyRegistry()
        # Attempt to set max_concurrent_runs to 100, which exceeds ceiling of 50
        with pytest.raises(GlobalCeilingExceededError) as exc_info:
            registry.upsert_policy(
                db_session,
                "ws-test",
                {"max_concurrent_runs": 100},
                site_id=sample_site.id,
            )
        assert "exceeds hard global safety ceiling" in str(exc_info.value)

    def test_policy_evaluator_concurrent_runs_limit(self, db_session: Session, sample_site: Website):
        evaluator = PolicyEvaluator()
        # Set limit to 2 concurrent runs
        registry = TenantPolicyRegistry()
        registry.upsert_policy(db_session, "ws-test", {"max_concurrent_runs": 2}, site_id=sample_site.id)

        # 0 active runs -> allowed
        dec1 = evaluator.evaluate_run_creation(db_session, "ws-test", site_id=sample_site.id)
        assert dec1.allowed is True

        # Create 2 active runs
        r1 = OrchestrationRun(
            id="run-act-1",
            workspace_id="ws-test",
            site_id=sample_site.id,
            run_type="ON_DEMAND_SCAN",
            state=RunState.SCANNING.value,
            idempotency_key="id-1",
            correlation_id="c-1",
        )
        r2 = OrchestrationRun(
            id="run-act-2",
            workspace_id="ws-test",
            site_id=sample_site.id,
            run_type="ON_DEMAND_SCAN",
            state=RunState.ANALYZING.value,
            idempotency_key="id-2",
            correlation_id="c-2",
        )
        db_session.add_all([r1, r2])
        db_session.commit()

        # 2 active runs -> denied
        dec2 = evaluator.evaluate_run_creation(db_session, "ws-test", site_id=sample_site.id)
        assert dec2.allowed is False
        assert "Concurrent runs limit reached" in dec2.reason

        # Enforce=True raises PolicyViolationError
        with pytest.raises(PolicyViolationError):
            evaluator.evaluate_run_creation(db_session, "ws-test", site_id=sample_site.id, enforce=True)

    def test_policy_evaluator_retry_budget_exhaustion(self, db_session: Session, sample_site: Website):
        evaluator = PolicyEvaluator()
        registry = TenantPolicyRegistry()
        # Set hourly retry budget to 2
        registry.upsert_policy(db_session, "ws-test", {"retry_budget_per_hour": 2}, site_id=sample_site.id)

        obs_svc = ObservabilityService()
        now = datetime.now(timezone.utc)

        # Record 1 retry event -> allowed
        obs_svc.record_event(
            db_session,
            "ws-test",
            OrchestrationEventType.RETRY_SCHEDULED,
            site_id=sample_site.id,
            occurred_at=now - timedelta(minutes=10),
        )
        dec1 = evaluator.evaluate_retry_budget(db_session, "ws-test", site_id=sample_site.id)
        assert dec1.allowed is True

        # Record 2nd retry event -> budget reached (2/2)
        obs_svc.record_event(
            db_session,
            "ws-test",
            OrchestrationEventType.RETRY_SCHEDULED,
            site_id=sample_site.id,
            occurred_at=now - timedelta(minutes=5),
        )
        dec2 = evaluator.evaluate_retry_budget(db_session, "ws-test", site_id=sample_site.id)
        assert dec2.allowed is False
        assert "Hourly retry budget exhausted (2/2)" in dec2.reason

        # Enforce raises PolicyViolationError
        with pytest.raises(PolicyViolationError):
            evaluator.evaluate_retry_budget(db_session, "ws-test", site_id=sample_site.id, enforce=True)

    def test_policy_evaluator_daily_operational_budget(self, db_session: Session, sample_site: Website):
        evaluator = PolicyEvaluator()
        registry = TenantPolicyRegistry()
        # Set daily budget to 3 runs
        registry.upsert_policy(db_session, "ws-test", {"daily_operational_budget": 3}, site_id=sample_site.id)

        now = datetime.now(timezone.utc)
        # Create 3 runs in the past 2 hours
        for i in range(3):
            r = OrchestrationRun(
                id=f"run-budget-{i}",
                workspace_id="ws-test",
                site_id=sample_site.id,
                run_type="ON_DEMAND_SCAN",
                state=RunState.SUCCEEDED.value,
                idempotency_key=f"idemp-b-{i}",
                correlation_id=f"corr-b-{i}",
                requested_at=now - timedelta(hours=1, minutes=i * 5),
            )
            db_session.add(r)
        db_session.commit()

        # Run creation denied due to daily budget
        dec = evaluator.evaluate_run_creation(db_session, "ws-test", site_id=sample_site.id)
        assert dec.allowed is False
        assert "Daily operational run budget exhausted (3/3)" in dec.reason

        with pytest.raises(PolicyViolationError):
            evaluator.evaluate_run_creation(db_session, "ws-test", site_id=sample_site.id, enforce=True)

    def test_maintenance_window_policy(self, db_session: Session, sample_site: Website):
        evaluator = PolicyEvaluator()
        registry = TenantPolicyRegistry()
        registry.upsert_policy(
            db_session,
            "ws-test",
            {"maintenance_window_active": True},
            site_id=sample_site.id,
        )

        dec = evaluator.evaluate_run_creation(db_session, "ws-test", site_id=sample_site.id)
        assert dec.allowed is False
        assert "undergoing scheduled maintenance" in dec.reason

    def test_automation_level_policy(self, db_session: Session, sample_site: Website):
        evaluator = PolicyEvaluator()
        registry = TenantPolicyRegistry()
        registry.upsert_policy(
            db_session,
            "ws-test",
            {"allowed_automation_level": AutomationLevel.MANUAL_ONLY.value},
            site_id=sample_site.id,
        )

        # Automated trigger attempted
        dec = evaluator.evaluate_run_creation(db_session, "ws-test", site_id=sample_site.id, is_automated=True)
        assert dec.allowed is False
        assert "automated run dispatch is prohibited" in dec.reason


# =====================================================================
# 6. REST API ENDPOINTS & TENANT ISOLATION TESTS
# =====================================================================


class TestAPIEndpointsAndTenantIsolation:
    def test_observability_events_api(self, client: TestClient, sample_site: Website):
        # Post event
        create_resp = client.post(
            "/api/orchestration/observability/events",
            json={
                "workspace_id": "ws-test",
                "site_id": sample_site.id,
                "event_type": "RUN_CREATED",
                "severity": "INFO",
                "details": {"source": "test_api"},
            },
        )
        assert create_resp.status_code == 200
        data = create_resp.json()
        assert data["event_type"] == "RUN_CREATED"

        # List events
        list_resp = client.get("/api/orchestration/observability/events?workspace_id=ws-test")
        assert list_resp.status_code == 200
        assert list_resp.json()["total_count"] >= 1

        # Cross-tenant list isolation
        other_list = client.get("/api/orchestration/observability/events?workspace_id=ws-other")
        assert other_list.status_code == 200
        assert other_list.json()["total_count"] == 0

    def test_health_api(self, client: TestClient, sample_site: Website):
        sys_resp = client.get(f"/api/orchestration/health/system?workspace_id=ws-test&site_id={sample_site.id}")
        assert sys_resp.status_code == 200
        sys_data = sys_resp.json()
        assert "dimensions" in sys_data
        assert "DATABASE" in sys_data["dimensions"]

        queue_resp = client.get(f"/api/orchestration/health/queue?workspace_id=ws-test&site_id={sample_site.id}")
        assert queue_resp.status_code == 200
        assert "queue_depth" in queue_resp.json()

        worker_resp = client.get(f"/api/orchestration/health/workers?workspace_id=ws-test&site_id={sample_site.id}")
        assert worker_resp.status_code == 200
        assert "worker_count" in worker_resp.json()

        provider_resp = client.get(f"/api/orchestration/health/providers?workspace_id=ws-test&site_id={sample_site.id}")
        assert provider_resp.status_code == 200
        assert "providers" in provider_resp.json()

    def test_alerts_api(self, client: TestClient, db_session: Session, sample_site: Website):
        alert_svc = AlertService()
        a = alert_svc.record_or_update_alert(
            db_session,
            "ws-test",
            AlertType.QUEUE_SATURATION,
            AlertSeverity.HIGH,
            "Queue saturation detected",
            site_id=sample_site.id,
        )

        # List alerts
        list_resp = client.get("/api/orchestration/alerts?workspace_id=ws-test")
        assert list_resp.status_code == 200
        assert list_resp.json()["total_count"] == 1

        # Get alert by ID
        get_resp = client.get(f"/api/orchestration/alerts/{a.id}?workspace_id=ws-test")
        assert get_resp.status_code == 200
        assert get_resp.json()["summary"] == "Queue saturation detected"

        # Acknowledge
        ack_resp = client.post(
            f"/api/orchestration/alerts/{a.id}/acknowledge",
            json={"workspace_id": "ws-test", "acknowledged_by": "operator_bob"},
        )
        assert ack_resp.status_code == 200
        assert ack_resp.json()["status"] == "ACKNOWLEDGED"

        # Resolve
        res_resp = client.post(
            f"/api/orchestration/alerts/{a.id}/resolve",
            json={
                "workspace_id": "ws-test",
                "resolved_by": "operator_bob",
                "resolution_reason": "Cleared queue backlog",
                "evidence": {"queue_depth": 0},
            },
        )
        assert res_resp.status_code == 200
        assert res_resp.json()["status"] == "RESOLVED"

    def test_cross_tenant_unauthorized_alert_modification(self, client: TestClient, db_session: Session, sample_site: Website):
        alert_svc = AlertService()
        a = alert_svc.record_or_update_alert(
            db_session,
            "ws-test",
            AlertType.QUEUE_SATURATION,
            AlertSeverity.HIGH,
            "Queue saturation detected",
            site_id=sample_site.id,
        )

        # Attempt to acknowledge from different workspace via service -> raises AlertNotFoundError
        with pytest.raises(AlertNotFoundError):
            alert_svc.acknowledge_alert(db_session, "ws-intruder", a.id, acknowledged_by="intruder")

        # Attempt to acknowledge via REST API -> returns 404
        ack_bad = client.post(
            f"/api/orchestration/alerts/{a.id}/acknowledge",
            json={"workspace_id": "ws-intruder", "acknowledged_by": "intruder"},
        )
        assert ack_bad.status_code == 404

        # Attempt to resolve via REST API from intruder workspace -> returns 404
        res_bad = client.post(
            f"/api/orchestration/alerts/{a.id}/resolve",
            json={
                "workspace_id": "ws-intruder",
                "resolved_by": "intruder",
                "resolution_reason": "Unauthorized tampering",
            },
        )
        assert res_bad.status_code == 404

    def test_tenant_policies_api(self, client: TestClient, sample_site: Website):
        # Get default
        get_resp = client.get(f"/api/orchestration/policies?workspace_id=ws-test&site_id={sample_site.id}")
        assert get_resp.status_code == 200
        assert get_resp.json()["max_concurrent_runs"] == 5

        # Upsert
        put_resp = client.put(
            "/api/orchestration/policies",
            json={
                "workspace_id": "ws-test",
                "site_id": sample_site.id,
                "max_concurrent_runs": 12,
            },
        )
        assert put_resp.status_code == 200
        assert put_resp.json()["max_concurrent_runs"] == 12

        # Evaluate policy API
        eval_resp = client.post(
            "/api/orchestration/policies/evaluate",
            json={
                "workspace_id": "ws-test",
                "site_id": sample_site.id,
                "operation": "CREATE_RUN",
            },
        )
        assert eval_resp.status_code == 200
        assert eval_resp.json()["allowed"] is True
