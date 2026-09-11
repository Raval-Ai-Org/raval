"""
Integration and Unit Tests for Production Orchestration Scheduler (Step 2).

Verifies:
1. Pure standard library 5-part cron parsing, boundary checking, and error handling.
2. Deterministic calculation of next_run_at in canonical UTC across IANA timezones and DST transitions.
3. Minimum interval enforcement (>= 60s) preventing runaway schedules.
4. Stable schedule duplicate-fire protection via deterministic idempotency keys.
5. ScheduleService CRUD operations with tenant/site boundary checks and optimistic concurrency locking.
6. Pause, resume, and disable lifecycle transitions.
7. Manual on-demand triggers (trigger_run_now) with queue priority elevation.
8. Batch evaluation of due schedules (evaluate_due_schedules) and queue dispatch.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
import zoneinfo

from app.database import Base
from app.models import Website
from app.orchestration.enums import RunState, RunType, ScheduleStatus, ScheduleType
from app.orchestration.exceptions import (
    InvalidScheduleExpressionError,
    InvalidTimezoneError,
    OptimisticLockError,
    ScheduleNotFoundError,
    SiteMismatchError,
    TenantMismatchError,
)
from app.orchestration.models import Schedule
from app.orchestration.queue import LocalOrchestrationQueue
from app.orchestration.schedule_service import ScheduleService
from app.orchestration.scheduler import (
    ABSOLUTE_MINIMUM_INTERVAL_SECONDS,
    DEFAULT_MINIMUM_INTERVAL_SECONDS,
    calculate_next_cron_occurrence,
    calculate_next_interval_occurrence,
    calculate_next_run_at,
    generate_run_now_idempotency_key,
    generate_schedule_idempotency_key,
    validate_cron_expression,
    validate_timezone,
)
from app.orchestration.schemas import (
    ActorProvenance,
    ScheduleCreateRequest,
    ScheduleUpdateRequest,
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
    site2 = Website(
        id=2,
        name="Beta Labs",
        url="https://beta-labs.example.com",
        created_at=datetime.now(timezone.utc),
    )
    session.add_all([site, site2])
    session.commit()

    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(bind=engine)


class TestCronParsingAndValidation:
    """Tests for pure standard library cron expression parser."""

    def test_valid_cron_expressions(self):
        # All standard combinations
        valid_expressions = [
            "* * * * *",
            "0 0 * * *",
            "*/15 * * * *",
            "0 9-17 * * 1-5",
            "30 2 1,15 * *",
            "0 0 1 1 *",
            "15,45 8,20 * * 0,6",
        ]
        for expr in valid_expressions:
            parsed = validate_cron_expression(expr)
            assert parsed.raw_expression == expr
            assert len(parsed.minutes) > 0
            assert len(parsed.hours) > 0
            assert len(parsed.days_of_month) > 0
            assert len(parsed.months) > 0
            assert len(parsed.days_of_week) > 0

    def test_cron_day_of_week_mapping_7_to_0(self):
        # In cron, both 0 and 7 represent Sunday
        parsed = validate_cron_expression("0 0 * * 7")
        assert 0 in parsed.days_of_week
        assert 7 not in parsed.days_of_week

    def test_invalid_cron_field_count(self):
        invalid = [
            "* * * *",         # 4 fields
            "* * * * * *",     # 6 fields
            "",                # 0 fields
            "hourly",          # 1 field
        ]
        for expr in invalid:
            with pytest.raises(InvalidScheduleExpressionError) as exc_info:
                validate_cron_expression(expr)
            assert "exactly 5" in str(exc_info.value).lower()

    def test_invalid_cron_field_bounds_and_syntax(self):
        invalid_expressions = [
            ("60 * * * *", "minute"),
            ("* 24 * * *", "hour"),
            ("* * 32 * *", "day_of_month"),
            ("* * * 13 *", "month"),
            ("* * * * 8", "day_of_week"),
            ("*/0 * * * *", "minute"),
            ("*-5 * * * *", "minute"),
            ("10-5 * * * *", "minute"),
            ("abc * * * *", "minute"),
        ]
        for expr, _field in invalid_expressions:
            with pytest.raises(InvalidScheduleExpressionError):
                validate_cron_expression(expr)


class TestDeterministicNextExecutionCalculation:
    """Tests for calculate_next_run_at and timezone calculations."""

    def test_interval_schedule_calculation(self):
        base = datetime(2026, 3, 15, 12, 0, 0, tzinfo=timezone.utc)
        next_run = calculate_next_run_at(
            schedule_type=ScheduleType.INTERVAL,
            cron_expression=None,
            interval_seconds=3600,
            timezone_str="UTC",
            from_time=base,
        )
        assert next_run == base + timedelta(seconds=3600)
        assert next_run.tzinfo == timezone.utc

    def test_interval_minimum_threshold_enforcement(self):
        base = datetime(2026, 3, 15, 12, 0, 0, tzinfo=timezone.utc)
        # Attempt to schedule with 10s interval (below 60s minimum) raises InvalidScheduleExpressionError
        with pytest.raises(InvalidScheduleExpressionError) as exc_info:
            calculate_next_run_at(
                schedule_type=ScheduleType.INTERVAL,
                cron_expression=None,
                interval_seconds=10,
                timezone_str="UTC",
                from_time=base,
            )
        assert f"at least {ABSOLUTE_MINIMUM_INTERVAL_SECONDS}" in str(exc_info.value)

    def test_on_demand_returns_none(self):
        next_run = calculate_next_run_at(
            schedule_type=ScheduleType.ON_DEMAND,
            cron_expression=None,
            interval_seconds=None,
            timezone_str="UTC",
        )
        assert next_run is None

    def test_cron_daily_at_midnight_utc(self):
        base = datetime(2026, 3, 15, 12, 30, 0, tzinfo=timezone.utc)
        next_run = calculate_next_run_at(
            schedule_type=ScheduleType.CRON,
            cron_expression="0 0 * * *",
            interval_seconds=None,
            timezone_str="UTC",
            from_time=base,
        )
        expected = datetime(2026, 3, 16, 0, 0, 0, tzinfo=timezone.utc)
        assert next_run == expected

    def test_cron_in_different_timezones(self):
        base = datetime(2026, 6, 1, 10, 0, 0, tzinfo=timezone.utc)
        # Daily at 9 AM in America/New_York (EDT = UTC-4) -> 13:00 UTC
        next_run_ny = calculate_next_run_at(
            schedule_type=ScheduleType.CRON,
            cron_expression="0 9 * * *",
            interval_seconds=None,
            timezone_str="America/New_York",
            from_time=base,
        )
        # 2026-06-01 10:00 UTC is 06:00 EDT, so 09:00 EDT is at 13:00 UTC on the same day
        assert next_run_ny == datetime(2026, 6, 1, 13, 0, 0, tzinfo=timezone.utc)

        # Daily at 9 AM in Asia/Tokyo (JST = UTC+9) -> 00:00 UTC
        # At 2026-06-01 10:00 UTC, it's 19:00 JST on June 1. Next 9 AM JST is June 2 00:00 UTC.
        next_run_tokyo = calculate_next_run_at(
            schedule_type=ScheduleType.CRON,
            cron_expression="0 9 * * *",
            interval_seconds=None,
            timezone_str="Asia/Tokyo",
            from_time=base,
        )
        assert next_run_tokyo == datetime(2026, 6, 2, 0, 0, 0, tzinfo=timezone.utc)

    def test_cron_daylight_saving_transition_spring_forward(self):
        # US Spring Forward 2026: Sunday March 8, 2026 (EST UTC-5 -> EDT UTC-4)
        # March 7 12:00 UTC = 07:00 EST. Daily at 09:00 local time:
        # March 7 09:00 EST = 14:00 UTC
        # March 8 09:00 EDT = 13:00 UTC (clock moved forward 1 hour)
        base = datetime(2026, 3, 7, 16, 0, 0, tzinfo=timezone.utc)  # March 7 11:00 EST
        next_run = calculate_next_run_at(
            schedule_type=ScheduleType.CRON,
            cron_expression="0 9 * * *",
            interval_seconds=None,
            timezone_str="America/New_York",
            from_time=base,
        )
        assert next_run == datetime(2026, 3, 8, 13, 0, 0, tzinfo=timezone.utc)

    def test_cron_naive_timestamp_auto_converts_to_utc(self):
        naive_base = datetime(2026, 5, 1, 12, 0, 0)
        next_run = calculate_next_run_at(
            schedule_type=ScheduleType.INTERVAL,
            cron_expression=None,
            interval_seconds=120,
            timezone_str="UTC",
            minimum_interval_seconds=60,
            from_time=naive_base,
        )
        assert next_run.tzinfo == timezone.utc
        assert next_run == datetime(2026, 5, 1, 12, 2, 0, tzinfo=timezone.utc)


class TestTimezoneValidation:
    """Tests for IANA timezone identifier validation."""

    def test_valid_iana_timezones(self):
        for tz_str in ["UTC", "America/New_York", "Europe/London", "Asia/Tokyo", "Australia/Sydney"]:
            tz = validate_timezone(tz_str)
            assert isinstance(tz, zoneinfo.ZoneInfo)

    def test_invalid_or_empty_timezones(self):
        for invalid_tz in ["", "   ", "Mars/Curiosity", "Invalid/Timezone", "GMT+25"]:
            with pytest.raises(InvalidTimezoneError):
                validate_timezone(invalid_tz)


class TestIdempotencyKeyGeneration:
    """Tests for deterministic duplicate firing protection."""

    def test_schedule_idempotency_key_stability(self):
        fire_time = datetime(2026, 8, 20, 14, 30, 0, tzinfo=timezone.utc)
        key1 = generate_schedule_idempotency_key("sch_12345", fire_time)
        key2 = generate_schedule_idempotency_key("sch_12345", fire_time)
        assert key1 == key2
        assert key1 == "sched:sch_12345:20260820143000"

    def test_run_now_idempotency_key_with_token(self):
        key1 = generate_run_now_idempotency_key("sch_12345", "token_abc")
        key2 = generate_run_now_idempotency_key("sch_12345", "token_abc")
        assert key1 == key2
        assert key1 == "run_now:sch_12345:token_abc"


class TestScheduleServiceCRUD:
    """Tests for ScheduleService lifecycle operations."""

    def test_create_interval_schedule(self, db_session: Session):
        service = ScheduleService()
        req = ScheduleCreateRequest(
            workspace_id="ws_test",
            site_id=1,
            name="Hourly Health Scan",
            schedule_type=ScheduleType.INTERVAL,
            interval_seconds=3600,
            timezone="UTC",
            minimum_interval_seconds=300,
            run_type=RunType.SCHEDULED_SCAN,
            configuration={"depth": 3, "api_key": "SECRET_KEY_123"},
            actor_provenance=ActorProvenance(actor_id="admin_1", actor_type="user"),
        )
        schedule = service.create_schedule(req, db_session)
        assert schedule.id.startswith("sch_")
        assert schedule.workspace_id == "ws_test"
        assert schedule.site_id == 1
        assert schedule.status == ScheduleStatus.ACTIVE.value
        assert schedule.schedule_type == ScheduleType.INTERVAL.value
        assert schedule.interval_seconds == 3600
        assert schedule.next_run_at is not None
        assert schedule.version == 1
        # Check secret scrubbing in configuration
        assert schedule.configuration.get("api_key") == "[REDACTED]"

    def test_create_cron_schedule(self, db_session: Session):
        service = ScheduleService()
        req = ScheduleCreateRequest(
            workspace_id="ws_test",
            site_id=1,
            name="Daily Morning Audit",
            schedule_type=ScheduleType.CRON,
            cron_expression="0 6 * * *",
            timezone="America/New_York",
            run_type=RunType.SCHEDULED_SCAN,
        )
        schedule = service.create_schedule(req, db_session)
        assert schedule.schedule_type == ScheduleType.CRON.value
        assert schedule.cron_expression == "0 6 * * *"
        assert schedule.next_run_at is not None
        assert schedule.next_run_at.tzinfo == timezone.utc

    def test_create_schedule_rejects_missing_site(self, db_session: Session):
        service = ScheduleService()
        req = ScheduleCreateRequest(
            workspace_id="ws_test",
            site_id=9999,  # does not exist
            name="Ghost Site Schedule",
            interval_seconds=3600,
        )
        with pytest.raises(ValueError) as exc_info:
            service.create_schedule(req, db_session)
        assert "9999 not found" in str(exc_info.value)

    def test_create_schedule_rejects_invalid_timezone(self, db_session: Session):
        service = ScheduleService()
        req = ScheduleCreateRequest(
            workspace_id="ws_test",
            site_id=1,
            name="Bad TZ Schedule",
            timezone="Atlantis/Ocean",
            interval_seconds=3600,
        )
        with pytest.raises(InvalidTimezoneError):
            service.create_schedule(req, db_session)

    def test_get_schedule_tenant_and_site_isolation(self, db_session: Session):
        service = ScheduleService()
        req = ScheduleCreateRequest(
            workspace_id="tenant_a",
            site_id=1,
            name="Tenant A Schedule",
            interval_seconds=3600,
        )
        schedule = service.create_schedule(req, db_session)

        # Successful retrieval
        fetched = service.get_schedule("tenant_a", schedule.id, db_session)
        assert fetched.id == schedule.id

        # Cross-tenant access rejected
        with pytest.raises(TenantMismatchError):
            service.get_schedule("tenant_b", schedule.id, db_session)

        # Site mismatch rejected
        with pytest.raises(SiteMismatchError):
            service.get_schedule("tenant_a", schedule.id, db_session, site_id=2)

        # Nonexistent schedule
        with pytest.raises(ScheduleNotFoundError):
            service.get_schedule("tenant_a", "sch_nonexistent", db_session)

    def test_list_schedules_filtering(self, db_session: Session):
        service = ScheduleService()
        service.create_schedule(
            ScheduleCreateRequest(
                workspace_id="ws_list",
                site_id=1,
                name="S1",
                interval_seconds=3600,
            ),
            db_session,
        )
        service.create_schedule(
            ScheduleCreateRequest(
                workspace_id="ws_list",
                site_id=2,
                name="S2",
                interval_seconds=7200,
            ),
            db_session,
        )

        all_ws = service.list_schedules("ws_list", db_session)
        assert len(all_ws) == 2

        site1_only = service.list_schedules("ws_list", db_session, site_id=1)
        assert len(site1_only) == 1
        assert site1_only[0].site_id == 1

    def test_update_schedule_optimistic_locking(self, db_session: Session):
        service = ScheduleService()
        schedule = service.create_schedule(
            ScheduleCreateRequest(
                workspace_id="ws_opt",
                site_id=1,
                name="Initial Schedule",
                interval_seconds=3600,
            ),
            db_session,
        )
        assert schedule.version == 1

        # Successful update with matching version
        updated = service.update_schedule(
            "ws_opt",
            schedule.id,
            ScheduleUpdateRequest(name="Updated Name", expected_version=1),
            db_session,
        )
        assert updated.name == "Updated Name"
        assert updated.version == 2

        # Stale version update rejected
        with pytest.raises(OptimisticLockError) as exc_info:
            service.update_schedule(
                "ws_opt",
                schedule.id,
                ScheduleUpdateRequest(name="Stale Name", expected_version=1),
                db_session,
            )
        assert "expected version 1, found version 2" in str(exc_info.value)

    def test_pause_and_resume_schedule(self, db_session: Session):
        service = ScheduleService()
        schedule = service.create_schedule(
            ScheduleCreateRequest(
                workspace_id="ws_pause",
                site_id=1,
                name="Pausable Schedule",
                interval_seconds=3600,
            ),
            db_session,
        )
        assert schedule.status == ScheduleStatus.ACTIVE.value
        assert schedule.next_run_at is not None

        # Pause
        paused = service.pause_schedule("ws_pause", schedule.id, db_session)
        assert paused.status == ScheduleStatus.PAUSED.value
        assert paused.next_run_at is None
        assert paused.version == 2

        # Resume
        resumed = service.resume_schedule("ws_pause", schedule.id, db_session)
        assert resumed.status == ScheduleStatus.ACTIVE.value
        assert resumed.next_run_at is not None
        assert resumed.version == 3

    def test_disable_schedule(self, db_session: Session):
        service = ScheduleService()
        schedule = service.create_schedule(
            ScheduleCreateRequest(
                workspace_id="ws_disable",
                site_id=1,
                name="Disablable Schedule",
                interval_seconds=3600,
            ),
            db_session,
        )
        disabled = service.disable_schedule("ws_disable", schedule.id, db_session)
        assert disabled.status == ScheduleStatus.DISABLED.value
        assert disabled.next_run_at is None


class TestScheduleExecutionAndDuplicateProtection:
    """Tests for run triggering, due schedule evaluation, and duplicate protection."""

    def test_trigger_run_now_creates_run_and_enqueues(self, db_session: Session):
        queue = LocalOrchestrationQueue()
        service = ScheduleService()
        schedule = service.create_schedule(
            ScheduleCreateRequest(
                workspace_id="ws_trigger",
                site_id=1,
                name="Manual Run Trigger",
                interval_seconds=3600,
            ),
            db_session,
        )

        run = service.trigger_run_now("ws_trigger", schedule.id, db_session, queue=queue)
        assert run is not None
        assert run.state == RunState.QUEUED.value
        assert run.site_id == 1
        assert run.metadata_payload.get("triggered_on_demand") is True

        # Queue should hold the elevated priority job
        assert queue.get_queue_depth() == 1
        vis = queue.get_visibility()
        assert vis[0].priority == 1  # Elevated priority
        assert vis[0].run_id == run.id

    def test_trigger_run_now_rejects_disabled_schedule(self, db_session: Session):
        service = ScheduleService()
        schedule = service.create_schedule(
            ScheduleCreateRequest(
                workspace_id="ws_dis_trig",
                site_id=1,
                name="Disabled Trigger",
                interval_seconds=3600,
            ),
            db_session,
        )
        service.disable_schedule("ws_dis_trig", schedule.id, db_session)

        with pytest.raises(ValueError) as exc_info:
            service.trigger_run_now("ws_dis_trig", schedule.id, db_session)
        assert "disabled" in str(exc_info.value).lower()

    def test_evaluate_due_schedules_and_advances_next_run(self, db_session: Session):
        queue = LocalOrchestrationQueue()
        service = ScheduleService()
        now = datetime(2026, 4, 1, 10, 0, 0, tzinfo=timezone.utc)

        # Create schedule with next_run_at in the past
        schedule = service.create_schedule(
            ScheduleCreateRequest(
                workspace_id="ws_due",
                site_id=1,
                name="Due Schedule",
                interval_seconds=3600,
            ),
            db_session,
        )
        # Force next_run_at to past
        schedule.next_run_at = now - timedelta(minutes=10)
        db_session.commit()

        # Evaluate due schedules as of `now`
        runs = service.evaluate_due_schedules(db_session, queue=queue, as_of=now)
        assert len(runs) == 1
        created_run = runs[0]
        assert created_run.workspace_id == "ws_due"
        assert created_run.site_id == 1
        assert created_run.state == RunState.QUEUED.value

        # Queue has job
        assert queue.get_queue_depth() == 1

        # Schedule next_run_at must have advanced into the future (>= now + 3600)
        db_session.refresh(schedule)
        assert schedule.next_run_at >= now + timedelta(seconds=3600)
        assert schedule.last_run_at == now

    def test_duplicate_firing_protection_under_repeated_evaluation(self, db_session: Session):
        queue = LocalOrchestrationQueue()
        service = ScheduleService()
        now = datetime(2026, 4, 1, 10, 0, 0, tzinfo=timezone.utc)

        schedule = service.create_schedule(
            ScheduleCreateRequest(
                workspace_id="ws_dup",
                site_id=1,
                name="Dup Protection Schedule",
                interval_seconds=3600,
            ),
            db_session,
        )
        schedule.next_run_at = now
        db_session.commit()

        # First evaluation: creates run
        runs_first = service.evaluate_due_schedules(db_session, queue=queue, as_of=now)
        assert len(runs_first) == 1
        first_run_id = runs_first[0].id

        # Simulating concurrent runner evaluating with same window
        # Reset next_run_at to the exact same time window to simulate duplicate trigger
        schedule.next_run_at = now
        db_session.commit()

        # Second evaluation with the exact same fire timestamp
        runs_second = service.evaluate_due_schedules(db_session, queue=queue, as_of=now)
        assert len(runs_second) == 1
        # Must return the SAME run entity via idempotency replay, not a duplicate
        assert runs_second[0].id == first_run_id
