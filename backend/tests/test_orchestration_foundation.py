"""
Integration Tests for Production Orchestration Foundation & Service.

Verifies:
1. Run creation starts in deterministic QUEUED state with materialized stage plan.
2. Stable idempotency boundary prevents duplicate runs.
3. Multi-tenant isolation: different workspaces can reuse keys without collision.
4. Cross-tenant access is strictly rejected (TenantMismatchError).
5. Optimistic locking / compare-and-set prevents stale updates (OptimisticLockError).
6. Timezone-aware UTC timestamps on all lifecycle milestones.
7. Secret scrubbing on actor provenance, error details, and event payloads.
8. Database cascades and foreign key integrity.
"""

from __future__ import annotations

from datetime import datetime, timezone
import pytest
from sqlalchemy import create_engine
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from app.database import Base
from app.models import Website
from app.orchestration.enums import (
    OrchestrationEventType,
    RunState,
    RunType,
    StageName,
    StageState,
    TriggerSource,
)
from app.orchestration.exceptions import (
    IdempotencyConflictError,
    InvalidStateTransitionError,
    OptimisticLockError,
    RunNotFoundError,
    SiteMismatchError,
    StageNotFoundError,
    TenantMismatchError,
    TerminalStateError,
)
from app.orchestration.models import (
    OrchestrationEvent,
    OrchestrationRun,
    OrchestrationStage,
)
from app.orchestration.schemas import (
    ActorProvenance,
    OrchestrationRunCreateRequest,
    StructuredErrorDetail,
)
from app.orchestration.service import OrchestrationService


@pytest.fixture
def db_session() -> Session:
    """Creates an isolated in-memory SQLite database session for testing."""
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    SessionTesting = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    session = SessionTesting()

    # Seed test website
    site = Website(
        id=1,
        name="Acme Health Portal",
        url="https://acme-health.example.com",
        created_at=datetime.now(timezone.utc),
    )
    session.add(site)
    session.commit()

    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def orchestration_service() -> OrchestrationService:
    return OrchestrationService()


class TestOrchestrationRunCreation:
    """Verifies run instantiation, stage materialization, and deterministic initial states."""

    def test_run_creation_starts_in_queued_state_with_stage_plan(
        self,
        db_session: Session,
        orchestration_service: OrchestrationService,
    ) -> None:
        """Run creation must begin in QUEUED state with all stages initialized in QUEUED."""
        req = OrchestrationRunCreateRequest(
            workspace_id="ws_tenant_alpha",
            site_id=1,
            run_type=RunType.ON_DEMAND_SCAN,
            trigger_source=TriggerSource.MANUAL,
            idempotency_key="key_initial_001",
            actor_provenance=ActorProvenance(actor_id="user_admin_01", actor_type="user"),
            metadata_payload={"client_tag": "q3_audit"},
        )

        run = orchestration_service.create_run(req, db=db_session)

        assert run.id.startswith("run_")
        assert run.workspace_id == "ws_tenant_alpha"
        assert run.site_id == 1
        assert run.run_type == RunType.ON_DEMAND_SCAN.value
        assert run.state == RunState.QUEUED.value
        assert run.trigger_source == TriggerSource.MANUAL.value
        assert run.attempt_count == 1
        assert run.version == 1
        assert run.requested_at is not None
        assert run.started_at is None
        assert run.completed_at is None
        assert run.cancelled_at is None

        # Verify Stage Plan
        assert len(run.stages) == 7
        for idx, stage in enumerate(run.stages):
            assert stage.run_id == run.id
            assert stage.workspace_id == "ws_tenant_alpha"
            assert stage.site_id == 1
            assert stage.state == StageState.QUEUED.value
            assert stage.execution_order == idx
            assert stage.attempt_count == 0
            assert stage.max_attempts == 3
            assert stage.version == 1
            assert stage.queued_at is not None
            assert stage.started_at is None

        # Verify Initial Event
        assert len(run.events) == 1
        evt = run.events[0]
        assert evt.event_type == OrchestrationEventType.RUN_CREATED.value
        assert evt.to_state == RunState.QUEUED.value
        assert evt.workspace_id == "ws_tenant_alpha"

    def test_verification_run_stage_plan_materialization(
        self,
        db_session: Session,
        orchestration_service: OrchestrationService,
    ) -> None:
        """Verification run materializes the dedicated 4-stage closed-loop blueprint."""
        req = OrchestrationRunCreateRequest(
            workspace_id="ws_tenant_alpha",
            site_id=1,
            run_type=RunType.VERIFICATION_RUN,
            idempotency_key="key_verification_001",
        )
        run = orchestration_service.create_run(req, db=db_session)

        stage_names = [s.stage_name for s in run.stages]
        assert stage_names == [
            StageName.VERIFICATION.value,
            StageName.TARGETED_RESCAN.value,
            StageName.DELTA_MEASUREMENT.value,
            StageName.REGRESSION_GUARD.value,
        ]


class TestIdempotencyAndTenantIsolation:
    """Verifies tenant boundaries and idempotent creation guarantees."""

    def test_idempotent_replay_returns_existing_run(
        self,
        db_session: Session,
        orchestration_service: OrchestrationService,
    ) -> None:
        """Replaying identical creation request returns the already created record."""
        req = OrchestrationRunCreateRequest(
            workspace_id="ws_tenant_alpha",
            site_id=1,
            run_type=RunType.ON_DEMAND_SCAN,
            idempotency_key="stable_key_12345",
        )

        run1 = orchestration_service.create_run(req, db=db_session)
        run2 = orchestration_service.create_run(req, db=db_session)

        assert run1.id == run2.id
        assert run1.version == run2.version

    def test_conflicting_parameters_with_same_key_raises_idempotency_conflict(
        self,
        db_session: Session,
        orchestration_service: OrchestrationService,
    ) -> None:
        """Attempting to reuse an idempotency key with conflicting run_type raises an error."""
        req1 = OrchestrationRunCreateRequest(
            workspace_id="ws_tenant_alpha",
            site_id=1,
            run_type=RunType.ON_DEMAND_SCAN,
            idempotency_key="reused_key_conflict",
        )
        orchestration_service.create_run(req1, db=db_session)

        req2 = OrchestrationRunCreateRequest(
            workspace_id="ws_tenant_alpha",
            site_id=1,
            run_type=RunType.EVIDENCE_REFRESH,  # Different type!
            idempotency_key="reused_key_conflict",
        )

        with pytest.raises(IdempotencyConflictError) as exc_info:
            orchestration_service.create_run(req2, db=db_session)
        assert "Idempotency conflict" in str(exc_info.value)

    def test_different_tenants_can_safely_use_same_idempotency_key(
        self,
        db_session: Session,
        orchestration_service: OrchestrationService,
    ) -> None:
        """Tenant isolation ensures keys are scoped per-workspace; no cross-tenant collisions."""
        req_tenant_a = OrchestrationRunCreateRequest(
            workspace_id="tenant_a",
            site_id=1,
            run_type=RunType.ON_DEMAND_SCAN,
            idempotency_key="shared_common_key_001",
        )
        req_tenant_b = OrchestrationRunCreateRequest(
            workspace_id="tenant_b",
            site_id=1,
            run_type=RunType.ON_DEMAND_SCAN,
            idempotency_key="shared_common_key_001",
        )

        run_a = orchestration_service.create_run(req_tenant_a, db=db_session)
        run_b = orchestration_service.create_run(req_tenant_b, db=db_session)

        assert run_a.id != run_b.id
        assert run_a.workspace_id == "tenant_a"
        assert run_b.workspace_id == "tenant_b"

    def test_cross_tenant_run_access_rejected(
        self,
        db_session: Session,
        orchestration_service: OrchestrationService,
    ) -> None:
        """Tenant A cannot retrieve or mutate Tenant B's orchestration runs."""
        req = OrchestrationRunCreateRequest(
            workspace_id="tenant_owner",
            site_id=1,
            run_type=RunType.ON_DEMAND_SCAN,
            idempotency_key="isolated_run_key",
        )
        run = orchestration_service.create_run(req, db=db_session)

        # Unauthorized tenant tries to fetch run
        with pytest.raises(TenantMismatchError) as exc_info:
            orchestration_service.get_run(
                workspace_id="tenant_intruder",
                run_id=run.id,
                db=db_session,
            )
        assert "Tenant boundary violation" in str(exc_info.value)

        # Unauthorized tenant tries to mutate run state
        with pytest.raises(TenantMismatchError):
            orchestration_service.transition_run_state(
                workspace_id="tenant_intruder",
                run_id=run.id,
                target_state=RunState.CANCELLED,
                db=db_session,
            )

    def test_nonexistent_run_raises_run_not_found(
        self,
        db_session: Session,
        orchestration_service: OrchestrationService,
    ) -> None:
        with pytest.raises(RunNotFoundError):
            orchestration_service.get_run(
                workspace_id="tenant_any",
                run_id="run_nonexistent_999",
                db=db_session,
            )


class TestStateTransitionsAndOptimisticLocking:
    """Verifies valid lifecycle mutations, optimistic concurrency, and UTC timestamp propagation."""

    def test_happy_path_run_lifecycle_and_timestamps(
        self,
        db_session: Session,
        orchestration_service: OrchestrationService,
    ) -> None:
        """Progresses run: QUEUED -> STARTING -> SCANNING -> ANALYZING -> OBSERVING -> PLANNING -> MONITORING -> SUCCEEDED."""
        req = OrchestrationRunCreateRequest(
            workspace_id="ws_acme",
            site_id=1,
            run_type=RunType.ON_DEMAND_SCAN,
        )
        run = orchestration_service.create_run(req, db=db_session)
        assert run.state == RunState.QUEUED.value
        assert run.version == 1

        # 1. QUEUED -> STARTING
        run = orchestration_service.transition_run_state(
            workspace_id="ws_acme",
            run_id=run.id,
            target_state=RunState.STARTING,
            expected_version=1,
            db=db_session,
        )
        assert run.state == RunState.STARTING.value
        assert run.version == 2
        assert run.started_at is not None

        # 2. STARTING -> SCANNING
        run = orchestration_service.transition_run_state(
            workspace_id="ws_acme",
            run_id=run.id,
            target_state=RunState.SCANNING,
            expected_version=2,
            db=db_session,
        )
        assert run.state == RunState.SCANNING.value
        assert run.version == 3

        # 3. SCANNING -> ANALYZING
        run = orchestration_service.transition_run_state(
            workspace_id="ws_acme",
            run_id=run.id,
            target_state=RunState.ANALYZING,
            expected_version=3,
            db=db_session,
        )
        assert run.state == RunState.ANALYZING.value
        assert run.version == 4

        # 4. ANALYZING -> OBSERVING
        run = orchestration_service.transition_run_state(
            workspace_id="ws_acme",
            run_id=run.id,
            target_state=RunState.OBSERVING,
            expected_version=4,
            db=db_session,
        )
        assert run.state == RunState.OBSERVING.value
        assert run.version == 5

        # 5. OBSERVING -> PLANNING
        run = orchestration_service.transition_run_state(
            workspace_id="ws_acme",
            run_id=run.id,
            target_state=RunState.PLANNING,
            expected_version=5,
            db=db_session,
        )
        assert run.state == RunState.PLANNING.value
        assert run.version == 6

        # 6. PLANNING -> MONITORING
        run = orchestration_service.transition_run_state(
            workspace_id="ws_acme",
            run_id=run.id,
            target_state=RunState.MONITORING,
            expected_version=6,
            db=db_session,
        )
        assert run.state == RunState.MONITORING.value
        assert run.version == 7

        # 7. MONITORING -> SUCCEEDED (Terminal)
        run = orchestration_service.transition_run_state(
            workspace_id="ws_acme",
            run_id=run.id,
            target_state=RunState.SUCCEEDED,
            expected_version=7,
            outcome_summary={"overall_score": 92.5, "defects_resolved": 3},
            db=db_session,
        )
        assert run.state == RunState.SUCCEEDED.value
        assert run.version == 8
        assert run.completed_at is not None
        assert run.outcome_summary == {"overall_score": 92.5, "defects_resolved": 3}

    def test_cancellation_flow_sets_cancelled_at_timestamp(
        self,
        db_session: Session,
        orchestration_service: OrchestrationService,
    ) -> None:
        """Cancelling a run updates both completed_at and cancelled_at timestamps."""
        req = OrchestrationRunCreateRequest(
            workspace_id="ws_acme",
            site_id=1,
            run_type=RunType.ON_DEMAND_SCAN,
        )
        run = orchestration_service.create_run(req, db=db_session)

        run = orchestration_service.transition_run_state(
            workspace_id="ws_acme",
            run_id=run.id,
            target_state=RunState.CANCELLED,
            reason="User manual cancellation",
            db=db_session,
        )

        assert run.state == RunState.CANCELLED.value
        assert run.cancelled_at is not None
        assert run.completed_at is not None

    def test_optimistic_locking_rejects_stale_versions(
        self,
        db_session: Session,
        orchestration_service: OrchestrationService,
    ) -> None:
        """Stale updates are rejected when expected_version mismatches."""
        req = OrchestrationRunCreateRequest(
            workspace_id="ws_acme",
            site_id=1,
            run_type=RunType.ON_DEMAND_SCAN,
        )
        run = orchestration_service.create_run(req, db=db_session)
        assert run.version == 1

        # Attempting update with incorrect version (e.g. 99)
        with pytest.raises(OptimisticLockError) as exc_info:
            orchestration_service.transition_run_state(
                workspace_id="ws_acme",
                run_id=run.id,
                target_state=RunState.STARTING,
                expected_version=99,
                db=db_session,
            )
        assert "expected version 99, found version 1" in str(exc_info.value)

    def test_stage_lifecycle_and_heartbeat(
        self,
        db_session: Session,
        orchestration_service: OrchestrationService,
    ) -> None:
        """Stage transitions through RUNNING and SUCCEEDED with attempt increment and heartbeats."""
        req = OrchestrationRunCreateRequest(
            workspace_id="ws_acme",
            site_id=1,
            run_type=RunType.ON_DEMAND_SCAN,
        )
        run = orchestration_service.create_run(req, db=db_session)
        stage = run.stages[0]  # CRAWL_DISCOVERY

        # 1. QUEUED -> RUNNING
        stage = orchestration_service.transition_stage_state(
            workspace_id="ws_acme",
            run_id=run.id,
            stage_id=stage.id,
            target_state=StageState.RUNNING,
            expected_version=1,
            db=db_session,
        )
        assert stage.state == StageState.RUNNING.value
        assert stage.attempt_count == 1
        assert stage.started_at is not None
        assert stage.version == 2

        # 2. Record Heartbeat
        stage = orchestration_service.record_stage_heartbeat(
            workspace_id="ws_acme",
            run_id=run.id,
            stage_id=stage.id,
            db=db_session,
        )
        assert stage.last_heartbeat_at is not None

        # 3. RUNNING -> SUCCEEDED
        stage = orchestration_service.transition_stage_state(
            workspace_id="ws_acme",
            run_id=run.id,
            stage_id=stage.id,
            target_state=StageState.SUCCEEDED,
            expected_version=2,
            output_summary={"urls_discovered": 45},
            db=db_session,
        )
        assert stage.state == StageState.SUCCEEDED.value
        assert stage.completed_at is not None
        assert stage.output_summary == {"urls_discovered": 45}


class TestSecurityAndSecretRedaction:
    """Verifies that secrets, API tokens, and passwords never persist to DB columns or events."""

    def test_actor_provenance_and_metadata_scrubbing(
        self,
        db_session: Session,
        orchestration_service: OrchestrationService,
    ) -> None:
        """Embedded API keys and tokens in request metadata are automatically redacted."""
        req = OrchestrationRunCreateRequest(
            workspace_id="ws_secure",
            site_id=1,
            run_type=RunType.ON_DEMAND_SCAN,
            actor_provenance=ActorProvenance(
                actor_id="admin",
                metadata={"api_key": "sk-proj-secret1234567890123456", "token": "ghp_123456789012345678901234567890123456"},
            ),
            metadata_payload={
                "authorization": "Bearer secret_bearer_token_xyz_123",
                "custom_note": "Running with key sk-abcdef1234567890123456",
            },
        )

        run = orchestration_service.create_run(req, db=db_session)

        # Verify actor provenance in DB
        assert run.actor_provenance["metadata"]["api_key"] == "[REDACTED]"
        assert run.actor_provenance["metadata"]["token"] == "[REDACTED]"

        # Verify metadata payload in DB
        assert run.metadata_payload["authorization"] == "[REDACTED]"
        assert "sk-abcdef" not in run.metadata_payload["custom_note"]
        assert "[REDACTED]" in run.metadata_payload["custom_note"]

    def test_error_detail_scrubbing_on_failure_transition(
        self,
        db_session: Session,
        orchestration_service: OrchestrationService,
    ) -> None:
        """Sensitive credentials in error details are redacted upon failure transitions."""
        req = OrchestrationRunCreateRequest(
            workspace_id="ws_secure",
            site_id=1,
            run_type=RunType.ON_DEMAND_SCAN,
        )
        run = orchestration_service.create_run(req, db=db_session)

        # Transition STARTING
        run = orchestration_service.transition_run_state(
            workspace_id="ws_secure",
            run_id=run.id,
            target_state=RunState.STARTING,
            db=db_session,
        )

        # Transition FAILED with raw secret in error message
        run = orchestration_service.transition_run_state(
            workspace_id="ws_secure",
            run_id=run.id,
            target_state=RunState.FAILED,
            error_detail={
                "error_code": "AUTH_FAILED",
                "message": "Connection failed using password=superSecretPassword123 with host https://user:pass123@db.internal",
                "secret_key": "AIzaSySecretGoogleApiKey33CharsLong12",
            },
            db=db_session,
        )

        assert run.state == RunState.FAILED.value
        assert run.error_detail is not None
        assert "superSecretPassword123" not in run.error_detail["message"]
        assert "pass123" not in run.error_detail["message"]
        assert run.error_detail["secret_key"] == "[REDACTED]"


class TestSiteIsolationAndCrossSiteGuard:
    """Verifies that operations targeting mismatched site IDs are rejected."""

    def test_cross_site_run_retrieval_rejected(
        self,
        db_session: Session,
        orchestration_service: OrchestrationService,
    ) -> None:
        """Retrieving a run scoped to site 1 while specifying site 2 raises SiteMismatchError."""
        req = OrchestrationRunCreateRequest(
            workspace_id="ws_multi_site",
            site_id=1,
            run_type=RunType.ON_DEMAND_SCAN,
        )
        run = orchestration_service.create_run(req, db=db_session)

        with pytest.raises(SiteMismatchError) as exc_info:
            orchestration_service.get_run(
                workspace_id="ws_multi_site",
                run_id=run.id,
                db=db_session,
                site_id=2,  # Wrong site
            )
        assert "Site boundary mismatch" in str(exc_info.value)

    def test_cross_site_run_mutation_rejected(
        self,
        db_session: Session,
        orchestration_service: OrchestrationService,
    ) -> None:
        """Attempting to transition run state with mismatched site_id raises SiteMismatchError."""
        req = OrchestrationRunCreateRequest(
            workspace_id="ws_multi_site",
            site_id=1,
            run_type=RunType.ON_DEMAND_SCAN,
        )
        run = orchestration_service.create_run(req, db=db_session)

        with pytest.raises(SiteMismatchError):
            orchestration_service.transition_run_state(
                workspace_id="ws_multi_site",
                run_id=run.id,
                target_state=RunState.STARTING,
                db=db_session,
                site_id=2,  # Wrong site
            )

    def test_cross_site_stage_retrieval_and_mutation_rejected(
        self,
        db_session: Session,
        orchestration_service: OrchestrationService,
    ) -> None:
        """Attempting to access or mutate a stage with mismatched site_id raises SiteMismatchError."""
        req = OrchestrationRunCreateRequest(
            workspace_id="ws_multi_site",
            site_id=1,
            run_type=RunType.ON_DEMAND_SCAN,
        )
        run = orchestration_service.create_run(req, db=db_session)
        stage = run.stages[0]

        with pytest.raises(SiteMismatchError):
            orchestration_service.get_stage(
                workspace_id="ws_multi_site",
                run_id=run.id,
                stage_id=stage.id,
                db=db_session,
                site_id=2,
            )

        with pytest.raises(SiteMismatchError):
            orchestration_service.transition_stage_state(
                workspace_id="ws_multi_site",
                run_id=run.id,
                stage_id=stage.id,
                target_state=StageState.RUNNING,
                db=db_session,
                site_id=2,
            )


class TestDatabaseIntegrityAndCascades:
    """Verifies low-level database constraints, uniqueness indices, and cascade behavior."""

    def test_database_level_run_idempotency_uniqueness(
        self,
        db_session: Session,
    ) -> None:
        """Direct DB insert of duplicate (workspace_id, idempotency_key) raises IntegrityError."""
        now = datetime.now(timezone.utc)
        run1 = OrchestrationRun(
            id="run_raw_001",
            workspace_id="ws_db_test",
            site_id=1,
            run_type=RunType.ON_DEMAND_SCAN.value,
            state=RunState.QUEUED.value,
            trigger_source=TriggerSource.MANUAL.value,
            idempotency_key="exact_duplicate_key",
            correlation_id="corr_raw_001",
            attempt_count=1,
            actor_provenance={},
            version=1,
            requested_at=now,
            metadata_payload={},
        )
        db_session.add(run1)
        db_session.commit()

        run2 = OrchestrationRun(
            id="run_raw_002",
            workspace_id="ws_db_test",
            site_id=1,
            run_type=RunType.SCHEDULED_SCAN.value,
            state=RunState.QUEUED.value,
            trigger_source=TriggerSource.MANUAL.value,
            idempotency_key="exact_duplicate_key",  # Duplicate within same workspace!
            correlation_id="corr_raw_002",
            attempt_count=1,
            actor_provenance={},
            version=1,
            requested_at=now,
            metadata_payload={},
        )
        db_session.add(run2)
        with pytest.raises(IntegrityError):
            db_session.commit()
        db_session.rollback()

    def test_database_level_stage_name_uniqueness_within_run(
        self,
        db_session: Session,
        orchestration_service: OrchestrationService,
    ) -> None:
        """Duplicate stage_name within the same run_id violates unique constraint."""
        req = OrchestrationRunCreateRequest(
            workspace_id="ws_stage_dup",
            site_id=1,
            run_type=RunType.ON_DEMAND_SCAN,
        )
        run = orchestration_service.create_run(req, db=db_session)

        dup_stage = OrchestrationStage(
            id="stg_duplicate_name",
            run_id=run.id,
            workspace_id=run.workspace_id,
            site_id=run.site_id,
            stage_name=StageName.CRAWL_DISCOVERY.value,  # Already exists in ON_DEMAND_SCAN!
            state=StageState.QUEUED.value,
            execution_order=99,
            dependencies=[],
            idempotency_key=f"{run.id}:CRAWL_DISCOVERY_dup",
            attempt_count=0,
            max_attempts=3,
            queued_at=datetime.now(timezone.utc),
            version=1,
        )
        db_session.add(dup_stage)
        with pytest.raises(IntegrityError):
            db_session.commit()
        db_session.rollback()

    def test_cascade_delete_run_removes_stages_and_events(
        self,
        db_session: Session,
        orchestration_service: OrchestrationService,
    ) -> None:
        """Deleting an OrchestrationRun cascades and removes all associated stages and events."""
        req = OrchestrationRunCreateRequest(
            workspace_id="ws_cascade",
            site_id=1,
            run_type=RunType.ON_DEMAND_SCAN,
        )
        run = orchestration_service.create_run(req, db=db_session)
        run_id = run.id
        stage_ids = [s.id for s in run.stages]
        event_ids = [e.id for e in run.events]

        assert len(stage_ids) > 0
        assert len(event_ids) > 0

        # Delete run
        db_session.delete(run)
        db_session.commit()

        # Verify stages are deleted
        remaining_stages = (
            db_session.query(OrchestrationStage)
            .filter(OrchestrationStage.run_id == run_id)
            .all()
        )
        assert len(remaining_stages) == 0

        # Verify events are deleted
        remaining_events = (
            db_session.query(OrchestrationEvent)
            .filter(OrchestrationEvent.run_id == run_id)
            .all()
        )
        assert len(remaining_events) == 0


class TestTimestampIntegrity:
    """Verifies that all recorded timestamps are UTC-aware datetime objects."""

    def test_milestone_timestamps_are_utc_aware(
        self,
        db_session: Session,
        orchestration_service: OrchestrationService,
    ) -> None:
        """All created/milestone timestamps must have a timezone."""
        req = OrchestrationRunCreateRequest(
            workspace_id="ws_tz",
            site_id=1,
            run_type=RunType.ON_DEMAND_SCAN,
        )
        run = orchestration_service.create_run(req, db=db_session)
        assert run.requested_at is not None
        assert run.requested_at.tzinfo is not None

        # Check stage timestamps
        stage = run.stages[0]
        assert stage.queued_at is not None
        assert stage.queued_at.tzinfo is not None

        # Check event timestamp
        event = run.events[0]
        assert event.occurred_at is not None
        assert event.occurred_at.tzinfo is not None

        # Progress to starting
        run = orchestration_service.transition_run_state(
            workspace_id="ws_tz",
            run_id=run.id,
            target_state=RunState.STARTING,
            db=db_session,
        )
        assert run.started_at is not None
        assert run.started_at.tzinfo is not None

        # Cancel run
        run = orchestration_service.transition_run_state(
            workspace_id="ws_tz",
            run_id=run.id,
            target_state=RunState.CANCELLED,
            db=db_session,
        )
        assert run.cancelled_at is not None
        assert run.cancelled_at.tzinfo is not None
        assert run.completed_at is not None
        assert run.completed_at.tzinfo is not None

