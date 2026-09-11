"""
Comprehensive Unit and Integration Tests for Freshness Controller and Continuous Monitoring (Step 5).

Verifies:
1. Freshness Policy Validation: Enforces warning <= ttl <= expiration, positive intervals, registry overrides.
2. Canonical Defaults: All 11 EvidenceType categories have deterministic default TTL policies.
3. Exact Freshness Boundary Transitions: FRESH -> AGING -> STALE -> EXPIRED.
4. Edge Case Invariants:
   - Future timestamps (>1s skew) rejected with InvalidEvidenceTimestampError (no silent truncation).
   - Missing timestamps result in UNKNOWN / never observed (never treated as 0 or current).
   - Provider outages transition state to UNAVAILABLE.
   - Concurrent refresh transitions state to REFRESHING.
5. Refresh Decision Engine:
   - NO_ACTION for FRESH/AGING.
   - REFRESH_RECOMMENDED for STALE.
   - REFRESH_REQUIRED for EXPIRED.
   - REFRESH_ALREADY_RUNNING when an active run exists.
   - REFRESH_BLOCKED when site orchestration is paused.
   - REFRESH_UNAVAILABLE during provider outages.
   - Deterministic time-bucketed idempotency keys prevent duplicate refresh storms.
6. Continuous Monitoring Health & Observations:
   - All 9 monitoring domains evaluated.
   - Observations persisted to OrchestrationMonitoringObservation with tenant/site isolation.
   - Aggregate status calculation (HEALTHY, DEGRADED, FAILING, CRITICAL).
   - History retrieval with pagination and filtering.
7. Automated Refresh Dispatch:
   - FreshnessService triggers actual OrchestrationRun creation and queue enqueueing.
   - Deduplication prevents duplicate active jobs.
   - Full audit logging to OrchestrationEvent.
8. FastAPI HTTP Endpoints:
   - End-to-end API verification of all freshness and monitoring endpoints.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.main import app
from app.models import (
    AICitation,
    AIMonitoringRun,
    AIResponse,
    ExecutionReceipt,
    MonitoringRecord,
    OrchestrationCheckpoint,
    OrchestrationControlRequest,
    OrchestrationEvent,
    OrchestrationMonitoringObservation,
    OrchestrationRun,
    OrchestrationStage,
    PageResult,
    Scan,
    Schedule,
    ValidationResult,
    Website,
)
from app.orchestration.continuous_monitoring import ContinuousMonitoringService
from app.orchestration.enums import (
    EvidenceType,
    FreshnessState,
    MonitoringSeverity,
    MonitoringStatus,
    MonitoringType,
    OrchestrationEventType,
    RefreshDecisionType,
    RunState,
    RunType,
    TriggerSource,
)
from app.orchestration.exceptions import (
    InvalidEvidenceTimestampError,
    RefreshConflictError,
    SiteMismatchError,
    TenantMismatchError,
    UnsupportedEvidenceTypeError,
)
from app.orchestration.freshness_evaluator import FreshnessEvaluator
from app.orchestration.freshness_policy import (
    DEFAULT_EVIDENCE_POLICIES,
    EvidenceTTLPolicy,
    FreshnessPolicyRegistry,
)
from app.orchestration.freshness_service import FreshnessService
from app.orchestration.queue import LocalOrchestrationQueue
from app.orchestration.refresh_decision import (
    EVIDENCE_TYPE_TO_RUN_TYPE,
    RefreshDecisionEngine,
)
from app.orchestration.schemas import ActorProvenance
from app.orchestration.service import OrchestrationService


def _utc(
    year: int = 2026,
    month: int = 9,
    day: int = 10,
    hour: int = 12,
    minute: int = 0,
    second: int = 0,
) -> datetime:
    return datetime(year, month, day, hour, minute, second, tzinfo=timezone.utc)


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
    site1 = Website(
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
    seed_session.add_all([site1, site2])
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
def test_queue() -> LocalOrchestrationQueue:
    return LocalOrchestrationQueue()


@pytest.fixture
def test_orch_service() -> OrchestrationService:
    return OrchestrationService()


@pytest.fixture
def freshness_service(
    test_orch_service: OrchestrationService,
    test_queue: LocalOrchestrationQueue,
) -> FreshnessService:
    return FreshnessService(orchestration_service=test_orch_service, queue=test_queue)


@pytest.fixture
def monitoring_service() -> ContinuousMonitoringService:
    return ContinuousMonitoringService()


@pytest.fixture
def api_client(db_session_factory):
    from app.database import get_db

    def override_get_db():
        session = db_session_factory()
        try:
            yield session
        finally:
            session.close()

    app.dependency_overrides[get_db] = override_get_db
    client = TestClient(app)
    try:
        yield client
    finally:
        app.dependency_overrides.pop(get_db, None)


# ============================================================================
# 1. Freshness Policy & Registry Tests
# ============================================================================


class TestFreshnessPolicyAndRegistry:
    def test_policy_valid_construction(self):
        policy = EvidenceTTLPolicy(
            evidence_type=EvidenceType.PAGE_SEO,
            ttl_seconds=3600,
            warning_threshold_seconds=1800,
            expiration_threshold_seconds=7200,
        )
        assert policy.evidence_type == EvidenceType.PAGE_SEO
        assert policy.ttl_seconds == 3600
        assert policy.warning_threshold_seconds == 1800
        assert policy.expiration_threshold_seconds == 7200

    def test_policy_rejects_zero_or_negative_intervals(self):
        with pytest.raises(ValueError, match="positive"):
            EvidenceTTLPolicy(
                evidence_type=EvidenceType.PAGE_SEO,
                ttl_seconds=-10,
            )

    def test_policy_rejects_warning_greater_than_ttl(self):
        with pytest.raises(ValueError, match="warning_threshold_seconds.*cannot exceed ttl_seconds"):
            EvidenceTTLPolicy(
                evidence_type=EvidenceType.PAGE_SEO,
                ttl_seconds=1000,
                warning_threshold_seconds=2000,
            )

    def test_policy_rejects_ttl_greater_than_expiration(self):
        with pytest.raises(ValueError, match="ttl_seconds.*cannot exceed expiration_threshold_seconds"):
            EvidenceTTLPolicy(
                evidence_type=EvidenceType.PAGE_SEO,
                ttl_seconds=3000,
                warning_threshold_seconds=1000,
                expiration_threshold_seconds=2000,
            )

    def test_canonical_defaults_exist_for_all_evidence_types(self):
        for ev_type in EvidenceType:
            policy = FreshnessPolicyRegistry.get_policy(ev_type)
            assert policy is not None
            assert policy.evidence_type == ev_type
            assert policy.warning_threshold_seconds <= policy.ttl_seconds <= policy.expiration_threshold_seconds
            assert policy.ttl_seconds > 0

    def test_registry_site_and_tenant_override(self):
        custom_policy = EvidenceTTLPolicy(
            evidence_type=EvidenceType.CRAWL,
            ttl_seconds=7200,
            warning_threshold_seconds=3600,
            expiration_threshold_seconds=14400,
        )
        FreshnessPolicyRegistry.register_override(custom_policy, site_id=1, tenant_id="tenant_a")

        # Specific override matches
        resolved = FreshnessPolicyRegistry.get_policy(EvidenceType.CRAWL, site_id=1, tenant_id="tenant_a")
        assert resolved.ttl_seconds == 7200

        # Other site falls back to tenant or default
        other_site = FreshnessPolicyRegistry.get_policy(EvidenceType.CRAWL, site_id=2, tenant_id="tenant_a")
        assert other_site.ttl_seconds != 7200 or other_site == DEFAULT_EVIDENCE_POLICIES[EvidenceType.CRAWL]

        # Reset overrides
        FreshnessPolicyRegistry.reset_overrides()
        reverted = FreshnessPolicyRegistry.get_policy(EvidenceType.CRAWL, site_id=1, tenant_id="tenant_a")
        assert reverted == DEFAULT_EVIDENCE_POLICIES[EvidenceType.CRAWL]


# ============================================================================
# 2. Freshness Evaluator Boundary & Edge Case Tests
# ============================================================================


class TestFreshnessEvaluator:
    def setup_method(self):
        self.policy = EvidenceTTLPolicy(
            evidence_type=EvidenceType.CRAWL,
            ttl_seconds=3600,  # 1 hour
            warning_threshold_seconds=1800,  # 30 mins
            expiration_threshold_seconds=7200,  # 2 hours
        )
        self.as_of = _utc(2026, 9, 10, 12, 0, 0)

    def test_fresh_boundary(self):
        # Observed 15 mins ago (900s <= 1800s warning)
        observed = self.as_of - timedelta(minutes=15)
        eval_res = FreshnessEvaluator.evaluate(
            evidence_type=EvidenceType.CRAWL,
            observed_at=observed,
            policy=self.policy,
            as_of=self.as_of,
        )
        assert eval_res.state == FreshnessState.FRESH
        assert eval_res.age_seconds == 900
        assert not eval_res.refresh_recommended
        assert not eval_res.refresh_required

    def test_exact_warning_boundary_is_fresh(self):
        # Exactly 1800s ago
        observed = self.as_of - timedelta(seconds=1800)
        eval_res = FreshnessEvaluator.evaluate(
            evidence_type=EvidenceType.CRAWL,
            observed_at=observed,
            policy=self.policy,
            as_of=self.as_of,
        )
        assert eval_res.state == FreshnessState.FRESH
        assert eval_res.age_seconds == 1800

    def test_aging_boundary(self):
        # Observed 45 mins ago (1800s < 2700s <= 3600s ttl)
        observed = self.as_of - timedelta(minutes=45)
        eval_res = FreshnessEvaluator.evaluate(
            evidence_type=EvidenceType.CRAWL,
            observed_at=observed,
            policy=self.policy,
            as_of=self.as_of,
        )
        assert eval_res.state == FreshnessState.AGING
        assert eval_res.age_seconds == 2700
        assert not eval_res.refresh_recommended
        assert not eval_res.refresh_required

    def test_exact_ttl_boundary_is_aging(self):
        # Exactly 3600s ago
        observed = self.as_of - timedelta(seconds=3600)
        eval_res = FreshnessEvaluator.evaluate(
            evidence_type=EvidenceType.CRAWL,
            observed_at=observed,
            policy=self.policy,
            as_of=self.as_of,
        )
        assert eval_res.state == FreshnessState.AGING
        assert eval_res.age_seconds == 3600

    def test_stale_boundary(self):
        # Observed 90 mins ago (3600s < 5400s <= 7200s expiration)
        observed = self.as_of - timedelta(minutes=90)
        eval_res = FreshnessEvaluator.evaluate(
            evidence_type=EvidenceType.CRAWL,
            observed_at=observed,
            policy=self.policy,
            as_of=self.as_of,
        )
        assert eval_res.state == FreshnessState.STALE
        assert eval_res.age_seconds == 5400
        assert eval_res.refresh_recommended
        assert not eval_res.refresh_required
        assert eval_res.stale_reason is not None

    def test_exact_expiration_boundary_is_stale(self):
        # Exactly 7200s ago
        observed = self.as_of - timedelta(seconds=7200)
        eval_res = FreshnessEvaluator.evaluate(
            evidence_type=EvidenceType.CRAWL,
            observed_at=observed,
            policy=self.policy,
            as_of=self.as_of,
        )
        assert eval_res.state == FreshnessState.STALE
        assert eval_res.age_seconds == 7200
        assert eval_res.refresh_recommended
        assert not eval_res.refresh_required

    def test_expired_boundary(self):
        # Observed 150 mins ago (9000s > 7200s expiration)
        observed = self.as_of - timedelta(minutes=150)
        eval_res = FreshnessEvaluator.evaluate(
            evidence_type=EvidenceType.CRAWL,
            observed_at=observed,
            policy=self.policy,
            as_of=self.as_of,
        )
        assert eval_res.state == FreshnessState.EXPIRED
        assert eval_res.age_seconds == 9000
        assert eval_res.refresh_recommended
        assert eval_res.refresh_required

    def test_refreshing_override(self):
        observed = self.as_of - timedelta(minutes=150)
        eval_res = FreshnessEvaluator.evaluate(
            evidence_type=EvidenceType.CRAWL,
            observed_at=observed,
            policy=self.policy,
            as_of=self.as_of,
            is_currently_refreshing=True,
        )
        assert eval_res.state == FreshnessState.REFRESHING
        assert not eval_res.refresh_recommended  # Already refreshing
        assert not eval_res.refresh_required

    def test_provider_unavailable_override(self):
        observed = self.as_of - timedelta(minutes=150)
        eval_res = FreshnessEvaluator.evaluate(
            evidence_type=EvidenceType.CRAWL,
            observed_at=observed,
            policy=self.policy,
            as_of=self.as_of,
            is_provider_available=False,
        )
        assert eval_res.state == FreshnessState.UNAVAILABLE
        assert not eval_res.refresh_recommended
        assert not eval_res.refresh_required
        assert "unavailable" in eval_res.stale_reason.lower()

    def test_missing_timestamp_never_treated_as_zero_or_current(self):
        eval_res = FreshnessEvaluator.evaluate(
            evidence_type=EvidenceType.CRAWL,
            observed_at=None,
            policy=self.policy,
            as_of=self.as_of,
        )
        assert eval_res.state == FreshnessState.UNKNOWN
        assert eval_res.age_seconds is None
        assert eval_res.observed_at is None
        assert eval_res.refresh_recommended
        assert eval_res.refresh_required
        assert eval_res.metadata.get("never_observed") is True

    def test_future_timestamp_rejected_with_error(self):
        # 10 minutes in future (>1s tolerance)
        future_time = self.as_of + timedelta(minutes=10)
        with pytest.raises(InvalidEvidenceTimestampError, match="in the future"):
            FreshnessEvaluator.evaluate(
                evidence_type=EvidenceType.CRAWL,
                observed_at=future_time,
                policy=self.policy,
                as_of=self.as_of,
            )

    def test_small_future_skew_within_1s_accepted(self):
        # 500ms skew
        slight_future = self.as_of + timedelta(milliseconds=500)
        eval_res = FreshnessEvaluator.evaluate(
            evidence_type=EvidenceType.CRAWL,
            observed_at=slight_future,
            policy=self.policy,
            as_of=self.as_of,
        )
        assert eval_res.state == FreshnessState.FRESH
        assert eval_res.age_seconds == 0


# ============================================================================
# 3. Refresh Decision Engine Tests
# ============================================================================


class TestRefreshDecisionEngine:
    def setup_method(self):
        self.policy = EvidenceTTLPolicy(
            evidence_type=EvidenceType.AI_VISIBILITY,
            ttl_seconds=3600,
            warning_threshold_seconds=1800,
            expiration_threshold_seconds=7200,
        )
        self.as_of = _utc(2026, 9, 10, 12, 0, 0)

    def test_no_action_for_fresh(self):
        evaluation = FreshnessEvaluator.evaluate(
            evidence_type=EvidenceType.AI_VISIBILITY,
            observed_at=self.as_of - timedelta(minutes=10),
            policy=self.policy,
            as_of=self.as_of,
        )
        decision = RefreshDecisionEngine.evaluate_decision(
            evaluation=evaluation,
            tenant_id="tenant_1",
            site_id=1,
            as_of=self.as_of,
        )
        assert decision.decision == RefreshDecisionType.NO_ACTION
        assert decision.job_intent is None

    def test_refresh_recommended_for_stale(self):
        evaluation = FreshnessEvaluator.evaluate(
            evidence_type=EvidenceType.AI_VISIBILITY,
            observed_at=self.as_of - timedelta(minutes=70),
            policy=self.policy,
            as_of=self.as_of,
        )
        decision = RefreshDecisionEngine.evaluate_decision(
            evaluation=evaluation,
            tenant_id="tenant_1",
            site_id=1,
            as_of=self.as_of,
        )
        assert decision.decision == RefreshDecisionType.REFRESH_RECOMMENDED
        assert decision.job_intent is not None
        assert decision.job_intent.run_type == RunType.EVIDENCE_REFRESH
        assert decision.job_intent.priority == 50

    def test_refresh_required_for_expired(self):
        evaluation = FreshnessEvaluator.evaluate(
            evidence_type=EvidenceType.AI_VISIBILITY,
            observed_at=self.as_of - timedelta(hours=3),
            policy=self.policy,
            as_of=self.as_of,
        )
        decision = RefreshDecisionEngine.evaluate_decision(
            evaluation=evaluation,
            tenant_id="tenant_1",
            site_id=1,
            as_of=self.as_of,
        )
        assert decision.decision == RefreshDecisionType.REFRESH_REQUIRED
        assert decision.job_intent is not None
        assert decision.job_intent.priority == 90

    def test_refresh_blocked_when_site_paused(self):
        evaluation = FreshnessEvaluator.evaluate(
            evidence_type=EvidenceType.AI_VISIBILITY,
            observed_at=self.as_of - timedelta(hours=3),
            policy=self.policy,
            as_of=self.as_of,
        )
        decision = RefreshDecisionEngine.evaluate_decision(
            evaluation=evaluation,
            tenant_id="tenant_1",
            site_id=1,
            is_site_paused=True,
            as_of=self.as_of,
        )
        assert decision.decision == RefreshDecisionType.REFRESH_BLOCKED
        assert decision.job_intent is None
        assert "paused" in decision.reason.lower()

    def test_refresh_already_running_deduplication(self):
        evaluation = FreshnessEvaluator.evaluate(
            evidence_type=EvidenceType.AI_VISIBILITY,
            observed_at=self.as_of - timedelta(hours=3),
            policy=self.policy,
            as_of=self.as_of,
        )
        decision = RefreshDecisionEngine.evaluate_decision(
            evaluation=evaluation,
            tenant_id="tenant_1",
            site_id=1,
            active_run_id="run_active_123",
            as_of=self.as_of,
        )
        assert decision.decision == RefreshDecisionType.REFRESH_ALREADY_RUNNING
        assert decision.job_intent is None
        assert "run_active_123" in decision.reason

    def test_refresh_unavailable_on_provider_outage(self):
        evaluation = FreshnessEvaluator.evaluate(
            evidence_type=EvidenceType.AI_VISIBILITY,
            observed_at=self.as_of - timedelta(hours=3),
            policy=self.policy,
            as_of=self.as_of,
            is_provider_available=False,
        )
        decision = RefreshDecisionEngine.evaluate_decision(
            evaluation=evaluation,
            tenant_id="tenant_1",
            site_id=1,
            as_of=self.as_of,
        )
        assert decision.decision == RefreshDecisionType.REFRESH_UNAVAILABLE
        assert decision.job_intent is None

    def test_deterministic_idempotency_key_generation(self):
        key1 = RefreshDecisionEngine.generate_idempotency_key(
            tenant_id="tenant_1",
            site_id=1,
            evidence_type=EvidenceType.CRAWL,
            as_of=_utc(2026, 9, 10, 12, 14, 30),
            bucket_window_seconds=900,
        )
        key2 = RefreshDecisionEngine.generate_idempotency_key(
            tenant_id="tenant_1",
            site_id=1,
            evidence_type=EvidenceType.CRAWL,
            as_of=_utc(2026, 9, 10, 12, 14, 59),
            bucket_window_seconds=900,
        )
        key_different_bucket = RefreshDecisionEngine.generate_idempotency_key(
            tenant_id="tenant_1",
            site_id=1,
            evidence_type=EvidenceType.CRAWL,
            as_of=_utc(2026, 9, 10, 12, 31, 0),
            bucket_window_seconds=900,
        )
        assert key1 == key2  # Same 15-minute bucket
        assert key1 != key_different_bucket


# ============================================================================
# 4. Continuous Monitoring Service Tests
# ============================================================================


class TestContinuousMonitoringService:
    def test_observation_persistence_and_retrieval(self, db_session: Session, monitoring_service: ContinuousMonitoringService):
        obs = monitoring_service.record_observation(
            db_session,
            tenant_id="tenant_alpha",
            site_id=1,
            monitoring_type=MonitoringType.CRAWL_HEALTH,
            status=MonitoringStatus.HEALTHY,
            severity=MonitoringSeverity.INFO,
            message="All 50 crawled pages responded within SLA",
            metric_name="crawl_latency_ms",
            metric_value=245.5,
            threshold_value=1000.0,
            observed_at=_utc(2026, 9, 10, 12, 0, 0),
        )
        assert obs.id is not None
        assert obs.workspace_id == "tenant_alpha"
        assert obs.site_id == 1
        assert obs.monitoring_type == "CRAWL_HEALTH"
        assert obs.status == "HEALTHY"

        # Query history
        history = monitoring_service.get_monitoring_history(
            db_session,
            tenant_id="tenant_alpha",
            site_id=1,
        )
        assert history.total_count == 1
        assert len(history.observations) == 1
        assert history.observations[0].details.get("metric_value") == 245.5

    def test_tenant_boundary_enforcement(self, db_session: Session, monitoring_service: ContinuousMonitoringService):
        # Create observation for site 1
        monitoring_service.record_observation(
            db_session,
            tenant_id="tenant_alpha",
            site_id=1,
            monitoring_type=MonitoringType.ANALYSIS_HEALTH,
            status=MonitoringStatus.DEGRADED,
            severity=MonitoringSeverity.MEDIUM,
            message="Analysis queue delay",
        )

        # Cross-tenant query on the same site must fail
        with pytest.raises(TenantMismatchError):
            monitoring_service.get_site_monitoring_status(
                db_session,
                tenant_id="tenant_beta",
                site_id=1,
            )

    def test_nonexistent_site_raises_error(self, db_session: Session, monitoring_service: ContinuousMonitoringService):
        with pytest.raises(SiteMismatchError):
            monitoring_service.get_site_monitoring_status(
                db_session,
                tenant_id="default",
                site_id=99999,
            )

    def test_comprehensive_evaluation_across_all_domains(
        self, db_session: Session, monitoring_service: ContinuousMonitoringService
    ):
        status_res = monitoring_service.evaluate_site_monitoring(
            db_session,
            tenant_id="default",
            site_id=1,
            as_of=_utc(2026, 9, 10, 12, 0, 0),
        )
        assert status_res.site_id == 1
        assert status_res.workspace_id == "default"
        assert status_res.overall_status in ["HEALTHY", "DEGRADED", "FAILING", "CRITICAL", "UNKNOWN", "STALE"]
        assert len(status_res.domain_statuses) == 9

        # Ensure all 9 domain types are represented
        types_present = {d["monitoring_type"] for d in status_res.domain_statuses}
        for m_type in MonitoringType:
            assert m_type.value in types_present


# ============================================================================
# 5. Freshness Service & End-to-End Refresh Tests
# ============================================================================


class TestFreshnessServiceAndRefresh:
    def test_discover_observation_timestamp_from_models(
        self, db_session: Session, freshness_service: FreshnessService
    ):
        # 1. Add a Scan to DB
        scan = Scan(
            website_id=1,
            status="completed",
            pages_crawled=10,
            created_at=_utc(2026, 9, 10, 10, 0, 0),
            completed_at=_utc(2026, 9, 10, 10, 30, 0),
        )
        db_session.add(scan)
        db_session.commit()

        ts = freshness_service.discover_observation_timestamp(
            db_session,
            tenant_id="default",
            site_id=1,
            evidence_type=EvidenceType.CRAWL,
        )
        assert ts is not None
        assert ts.hour == 10
        assert ts.minute == 30

    def test_evaluate_site_freshness_overview(
        self, db_session: Session, freshness_service: FreshnessService
    ):
        # Empty site (never observed)
        overview = freshness_service.get_site_freshness_overview(
            db_session,
            tenant_id="default",
            site_id=1,
            as_of=_utc(2026, 9, 10, 12, 0, 0),
        )
        assert overview.site_id == 1
        assert len(overview.items) == len(EvidenceType)
        # Since nothing is observed yet, they should be UNKNOWN and stale_count should match
        assert overview.unknown_count == len(EvidenceType)
        assert overview.requires_refresh_count == len(EvidenceType)

    def test_trigger_refresh_runs_dispatch_and_deduplication(
        self,
        db_session: Session,
        freshness_service: FreshnessService,
        test_queue: LocalOrchestrationQueue,
    ):
        # Trigger refresh for CRAWL
        trigger_res = freshness_service.trigger_refresh_runs(
            db_session,
            tenant_id="default",
            site_id=1,
            evidence_types=[EvidenceType.CRAWL],
            force=True,
            as_of=_utc(2026, 9, 10, 12, 0, 0),
        )
        assert trigger_res.site_id == 1
        assert len(trigger_res.created_run_ids) == 1
        assert trigger_res.deduplicated_count == 0

        # Verify job was enqueued in queue
        assert test_queue.depth() == 1

        # Verify OrchestrationRun was persisted
        run_id = trigger_res.created_run_ids[0]
        run = db_session.query(OrchestrationRun).filter(OrchestrationRun.id == run_id).first()
        assert run is not None
        assert run.run_type == RunType.ON_DEMAND_SCAN
        assert run.state == RunState.QUEUED
        assert run.trigger_source == TriggerSource.FRESHNESS_CONTROLLER

        # Second trigger in the same timeframe must be deduplicated
        trigger_res_2 = freshness_service.trigger_refresh_runs(
            db_session,
            tenant_id="default",
            site_id=1,
            evidence_types=[EvidenceType.CRAWL],
            as_of=_utc(2026, 9, 10, 12, 5, 0),
        )
        assert len(trigger_res_2.created_run_ids) == 0
        assert trigger_res_2.deduplicated_count == 1
        assert test_queue.depth() == 1  # Queue did not receive a duplicate job!

    def test_audit_event_logged_on_trigger(
        self,
        db_session: Session,
        freshness_service: FreshnessService,
    ):
        freshness_service.trigger_refresh_runs(
            db_session,
            tenant_id="default",
            site_id=1,
            evidence_types=[EvidenceType.PAGE_SEO],
            force=True,
            as_of=_utc(2026, 9, 10, 12, 0, 0),
        )
        events = db_session.query(OrchestrationEvent).filter(
            OrchestrationEvent.event_type == OrchestrationEventType.REFRESH_REQUESTED,
        ).all()
        assert len(events) >= 1


# ============================================================================
# 6. FastAPI HTTP Endpoint Tests
# ============================================================================


class TestFreshnessAndMonitoringAPI:
    def test_evaluate_endpoint_fresh(self, api_client: TestClient):
        observed = _utc(2026, 9, 10, 11, 45, 0).isoformat()
        as_of = _utc(2026, 9, 10, 12, 0, 0).isoformat()
        response = api_client.post(
            "/api/orchestration/freshness/evaluate",
            json={
                "evidence_type": "CRAWL",
                "observed_at": observed,
                "as_of": as_of,
                "tenant_id": "default",
                "site_id": 1,
            },
        )
        assert response.status_code == 200
        data = response.json()
        assert data["evidence_type"] == "CRAWL"
        assert data["state"] == "fresh"
        assert data["age_seconds"] == 900
        assert not data["refresh_recommended"]

    def test_evaluate_endpoint_future_timestamp_fails(self, api_client: TestClient):
        observed = _utc(2026, 9, 10, 13, 0, 0).isoformat()
        as_of = _utc(2026, 9, 10, 12, 0, 0).isoformat()
        response = api_client.post(
            "/api/orchestration/freshness/evaluate",
            json={
                "evidence_type": "CRAWL",
                "observed_at": observed,
                "as_of": as_of,
            },
        )
        assert response.status_code == 400
        assert "future" in response.json()["detail"].lower()

    def test_site_freshness_overview_endpoint(self, api_client: TestClient):
        response = api_client.get("/api/orchestration/freshness/sites/1?tenant_id=default")
        assert response.status_code == 200
        data = response.json()
        assert data["site_id"] == 1
        assert len(data["items"]) == len(EvidenceType)

    def test_site_freshness_overview_nonexistent_site(self, api_client: TestClient):
        response = api_client.get("/api/orchestration/freshness/sites/9999?tenant_id=default")
        assert response.status_code == 404

    def test_refresh_decisions_endpoint(self, api_client: TestClient):
        response = api_client.post(
            "/api/orchestration/freshness/refresh-decisions",
            json={
                "tenant_id": "default",
                "site_id": 1,
                "evidence_types": ["CRAWL", "AI_VISIBILITY"],
                "force": True,
            },
        )
        assert response.status_code == 200
        data = response.json()
        assert data["site_id"] == 1
        assert len(data["decisions"]) == 2

    def test_refresh_triggers_endpoint(self, api_client: TestClient):
        response = api_client.post(
            "/api/orchestration/freshness/refresh-triggers",
            json={
                "tenant_id": "default",
                "site_id": 1,
                "evidence_types": ["CRAWL"],
                "force": True,
            },
        )
        assert response.status_code == 200
        data = response.json()
        assert data["site_id"] == 1
        assert len(data["created_run_ids"]) == 1

    def test_monitoring_status_endpoint(self, api_client: TestClient):
        response = api_client.get("/api/orchestration/monitoring/sites/1/status?tenant_id=default")
        assert response.status_code == 200
        data = response.json()
        assert data["site_id"] == 1
        assert "overall_status" in data
        assert len(data["domain_statuses"]) == 9

    def test_monitoring_history_endpoint(self, api_client: TestClient):
        response = api_client.get("/api/orchestration/monitoring/sites/1/history?tenant_id=default&limit=10")
        assert response.status_code == 200
        data = response.json()
        assert data["site_id"] == 1
        assert "observations" in data
        assert "total_count" in data

    def test_monitoring_evaluate_endpoint(self, api_client: TestClient):
        response = api_client.post("/api/orchestration/monitoring/sites/1/evaluate?tenant_id=default")
        assert response.status_code == 200
        data = response.json()
        assert data["site_id"] == 1
        assert len(data["domain_statuses"]) == 9
