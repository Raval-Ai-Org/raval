"""
Production Orchestration & Monitoring - Schedule Service.

Implements high-level lifecycle operations for orchestration schedules:
- CRUD management with optimistic concurrency control (version checks)
- Deterministic calculation of next execution times
- Boundary validation across workspaces and sites
- Idempotent duplicate-fire protection
- Pause, resume, disable, and manual on-demand triggering
- Batch evaluation and enqueueing of due schedules
"""

from __future__ import annotations

from datetime import datetime, timezone
import logging
from typing import Any
from uuid import uuid4

from sqlalchemy.orm import Session

from connectors.base.security import sanitize_payload

from ..models import Website
from .enums import RunState, RunType, ScheduleStatus, ScheduleType, TriggerSource
from .exceptions import (
    InvalidScheduleExpressionError,
    InvalidTimezoneError,
    OptimisticLockError,
    ScheduleNotFoundError,
    SiteMismatchError,
    TenantMismatchError,
)
from .models import Schedule
from .queue import OrchestrationQueue, QueueJob
from .scheduler import (
    ABSOLUTE_MINIMUM_INTERVAL_SECONDS,
    DEFAULT_MINIMUM_INTERVAL_SECONDS,
    calculate_next_run_at,
    generate_run_now_idempotency_key,
    generate_schedule_idempotency_key,
    validate_cron_expression,
    validate_timezone,
)
from .schemas import (
    ActorProvenance,
    OrchestrationRunCreateRequest,
    ScheduleCreateRequest,
    ScheduleUpdateRequest,
)
from .service import OrchestrationService

logger = logging.getLogger(__name__)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


class ScheduleService:
    """
    Service responsible for managing recurring and on-demand orchestration schedules.
    """

    def __init__(self, orchestration_service: OrchestrationService | None = None) -> None:
        self.orchestration_service = orchestration_service or OrchestrationService()

    def create_schedule(
        self,
        request: ScheduleCreateRequest,
        db: Session,
    ) -> Schedule:
        """
        Creates a new Schedule entity with deterministic next_run_at calculation
        and tenant/site boundary verification.
        """
        workspace_id = request.workspace_id.strip()
        if not workspace_id:
            raise ValueError("workspace_id cannot be empty")

        if request.site_id <= 0:
            raise ValueError("site_id must be a positive integer")

        # Validate that the site exists
        website = db.query(Website).filter(Website.id == request.site_id).first()
        if not website:
            raise ValueError(f"Website with id {request.site_id} not found")

        # Validate timezone identifier
        validate_timezone(request.timezone)

        # Enforce minimum interval threshold
        min_interval = max(request.minimum_interval_seconds, ABSOLUTE_MINIMUM_INTERVAL_SECONDS)

        # Validate schedule expressions based on schedule_type
        if request.schedule_type == ScheduleType.CRON:
            if not request.cron_expression:
                raise InvalidScheduleExpressionError(
                    "", "cron", "cron_expression is required for CRON schedules"
                )
            validate_cron_expression(request.cron_expression)
        elif request.schedule_type == ScheduleType.INTERVAL:
            if request.interval_seconds is None or request.interval_seconds < ABSOLUTE_MINIMUM_INTERVAL_SECONDS:
                raise InvalidScheduleExpressionError(
                    str(request.interval_seconds),
                    "interval",
                    f"interval_seconds must be >= {ABSOLUTE_MINIMUM_INTERVAL_SECONDS}s",
                )

        now = _utc_now()

        # Compute next run time
        next_run_at: datetime | None = None
        if request.schedule_type != ScheduleType.ON_DEMAND:
            next_run_at = calculate_next_run_at(
                schedule_type=request.schedule_type,
                cron_expression=request.cron_expression,
                interval_seconds=request.interval_seconds,
                timezone_str=request.timezone,
                minimum_interval_seconds=min_interval,
                from_time=now,
            )

        # Scrub sensitive configurations
        clean_configuration = sanitize_payload(request.configuration)
        clean_actor = sanitize_payload(request.actor_provenance.model_dump())

        schedule_id = f"sch_{uuid4().hex[:16]}"
        schedule = Schedule(
            id=schedule_id,
            workspace_id=workspace_id,
            site_id=request.site_id,
            name=request.name.strip(),
            status=ScheduleStatus.ACTIVE.value,
            schedule_type=request.schedule_type.value,
            cron_expression=request.cron_expression,
            interval_seconds=request.interval_seconds,
            timezone=request.timezone.strip(),
            next_run_at=next_run_at,
            last_run_at=None,
            minimum_interval_seconds=min_interval,
            run_type=request.run_type.value,
            configuration=clean_configuration,
            actor_provenance=clean_actor,
            created_at=now,
            updated_at=now,
            version=1,
        )

        db.add(schedule)
        db.commit()
        db.refresh(schedule)

        logger.info(
            "Created schedule '%s' (type=%s, next_run_at=%s) for workspace '%s', site=%d",
            schedule.id,
            schedule.schedule_type,
            schedule.next_run_at,
            workspace_id,
            request.site_id,
        )
        return schedule

    def get_schedule(
        self,
        workspace_id: str,
        schedule_id: str,
        db: Session,
        site_id: int | None = None,
    ) -> Schedule:
        """
        Retrieves a schedule by ID with strict tenant and optional site boundary enforcement.
        """
        schedule = db.query(Schedule).filter(Schedule.id == schedule_id).first()
        if not schedule:
            raise ScheduleNotFoundError(schedule_id=schedule_id, workspace_id=workspace_id)

        if schedule.workspace_id != workspace_id:
            raise TenantMismatchError(
                request_workspace_id=workspace_id,
                target_workspace_id=schedule.workspace_id,
                entity_id=schedule_id,
            )

        if site_id is not None and schedule.site_id != site_id:
            raise SiteMismatchError(
                run_id=schedule_id,
                expected_site_id=schedule.site_id,
                actual_site_id=site_id,
            )

        return schedule

    def list_schedules(
        self,
        workspace_id: str,
        db: Session,
        site_id: int | None = None,
        status: ScheduleStatus | str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[Schedule]:
        """
        Lists schedules for a workspace, optionally filtered by site and status.
        """
        query = db.query(Schedule).filter(Schedule.workspace_id == workspace_id)
        if site_id is not None:
            query = query.filter(Schedule.site_id == site_id)
        if status is not None:
            status_val = status.value if isinstance(status, ScheduleStatus) else status
            query = query.filter(Schedule.status == status_val)

        return query.order_by(Schedule.created_at.desc()).offset(offset).limit(limit).all()

    def update_schedule(
        self,
        workspace_id: str,
        schedule_id: str,
        request: ScheduleUpdateRequest,
        db: Session,
    ) -> Schedule:
        """
        Updates an existing schedule with optimistic locking and next_run_at recalculation.
        """
        schedule = self.get_schedule(workspace_id, schedule_id, db)

        # Optimistic locking check
        if request.expected_version is not None and schedule.version != request.expected_version:
            raise OptimisticLockError(
                entity_type="Schedule",
                entity_id=schedule_id,
                expected_version=request.expected_version,
                actual_version=schedule.version,
            )

        now = _utc_now()
        timing_changed = False

        if request.name is not None:
            schedule.name = request.name.strip()

        if request.timezone is not None and request.timezone.strip() != schedule.timezone:
            validate_timezone(request.timezone.strip())
            schedule.timezone = request.timezone.strip()
            timing_changed = True

        if request.schedule_type is not None and request.schedule_type.value != schedule.schedule_type:
            schedule.schedule_type = request.schedule_type.value
            timing_changed = True

        if request.cron_expression is not None:
            if schedule.schedule_type == ScheduleType.CRON.value:
                validate_cron_expression(request.cron_expression)
            schedule.cron_expression = request.cron_expression
            timing_changed = True

        if request.interval_seconds is not None:
            if schedule.schedule_type == ScheduleType.INTERVAL.value:
                if request.interval_seconds < ABSOLUTE_MINIMUM_INTERVAL_SECONDS:
                    raise InvalidScheduleExpressionError(
                        str(request.interval_seconds),
                        "interval",
                        f"interval_seconds must be >= {ABSOLUTE_MINIMUM_INTERVAL_SECONDS}s",
                    )
            schedule.interval_seconds = request.interval_seconds
            timing_changed = True

        if request.minimum_interval_seconds is not None:
            schedule.minimum_interval_seconds = max(
                request.minimum_interval_seconds, ABSOLUTE_MINIMUM_INTERVAL_SECONDS
            )
            timing_changed = True

        if request.run_type is not None:
            schedule.run_type = request.run_type.value

        if request.status is not None:
            old_status = schedule.status
            schedule.status = request.status.value
            if old_status != schedule.status:
                timing_changed = True

        if request.configuration is not None:
            schedule.configuration = sanitize_payload(request.configuration)

        # Recalculate next_run_at if timing/expression or status changed
        if timing_changed:
            if (
                schedule.status == ScheduleStatus.ACTIVE.value
                and schedule.schedule_type != ScheduleType.ON_DEMAND.value
            ):
                schedule.next_run_at = calculate_next_run_at(
                    schedule_type=schedule.schedule_type,
                    cron_expression=schedule.cron_expression,
                    interval_seconds=schedule.interval_seconds,
                    timezone_str=schedule.timezone,
                    minimum_interval_seconds=schedule.minimum_interval_seconds,
                    from_time=now,
                )
            else:
                schedule.next_run_at = None

        schedule.version += 1
        schedule.updated_at = now

        db.commit()
        db.refresh(schedule)

        logger.info(
            "Updated schedule '%s' to version %d (status=%s, next_run_at=%s)",
            schedule.id,
            schedule.version,
            schedule.status,
            schedule.next_run_at,
        )
        return schedule

    def pause_schedule(
        self,
        workspace_id: str,
        schedule_id: str,
        db: Session,
        expected_version: int | None = None,
    ) -> Schedule:
        """Pauses an active schedule, nullifying next_run_at."""
        update_req = ScheduleUpdateRequest(
            status=ScheduleStatus.PAUSED,
            expected_version=expected_version,
        )
        return self.update_schedule(workspace_id, schedule_id, update_req, db)

    def resume_schedule(
        self,
        workspace_id: str,
        schedule_id: str,
        db: Session,
        expected_version: int | None = None,
    ) -> Schedule:
        """Resumes a paused schedule, recalculating next_run_at."""
        update_req = ScheduleUpdateRequest(
            status=ScheduleStatus.ACTIVE,
            expected_version=expected_version,
        )
        return self.update_schedule(workspace_id, schedule_id, update_req, db)

    def disable_schedule(
        self,
        workspace_id: str,
        schedule_id: str,
        db: Session,
        expected_version: int | None = None,
    ) -> Schedule:
        """Disables a schedule completely."""
        update_req = ScheduleUpdateRequest(
            status=ScheduleStatus.DISABLED,
            expected_version=expected_version,
        )
        return self.update_schedule(workspace_id, schedule_id, update_req, db)

    def trigger_run_now(
        self,
        workspace_id: str,
        schedule_id: str,
        db: Session,
        queue: OrchestrationQueue | None = None,
        request_token: str | None = None,
    ) -> Any:
        """
        Manually triggers an immediate run from a schedule configuration.
        Elevates priority in the queue.
        """
        schedule = self.get_schedule(workspace_id, schedule_id, db)
        if schedule.status == ScheduleStatus.DISABLED.value:
            raise ValueError(f"Cannot trigger disabled schedule '{schedule_id}'")

        now = _utc_now()
        idempotency_key = generate_run_now_idempotency_key(schedule.id, request_token)

        run_req = OrchestrationRunCreateRequest(
            workspace_id=schedule.workspace_id,
            site_id=schedule.site_id,
            run_type=RunType(schedule.run_type),
            trigger_source=TriggerSource.SCHEDULER,
            idempotency_key=idempotency_key,
            correlation_id=f"corr_manual_{schedule.id}_{uuid4().hex[:8]}",
            actor_provenance=ActorProvenance(
                actor_id="system_scheduler",
                actor_type="manual_trigger",
            ),
            metadata_payload={
                **(schedule.configuration or {}),
                "schedule_id": schedule.id,
                "schedule_name": schedule.name,
                "triggered_on_demand": True,
            },
        )

        run = self.orchestration_service.create_run(run_req, db)

        # Update last_run_at timestamp on schedule
        schedule.last_run_at = now
        schedule.updated_at = now
        schedule.version += 1
        db.commit()

        if queue is not None and run.state == RunState.QUEUED.value:
            queue_job = QueueJob(
                run_id=run.id,
                workspace_id=run.workspace_id,
                site_id=run.site_id,
                run_type=run.run_type,
                priority=1,  # Elevated priority for manual triggers
                enqueued_at=now,
                payload={"schedule_id": schedule.id},
            )
            queue.enqueue(queue_job)
            logger.info("Enqueued manual run '%s' for schedule '%s' with priority 1", run.id, schedule.id)

        return run

    def evaluate_due_schedules(
        self,
        db: Session,
        queue: OrchestrationQueue | None = None,
        as_of: datetime | None = None,
    ) -> list[Any]:
        """
        Evaluates all active schedules where next_run_at <= as_of.
        Creates OrchestrationRun instances with deterministic idempotency keys,
        advances next_run_at, and enqueues jobs for worker execution.
        """
        eval_time = as_of or _utc_now()
        if eval_time.tzinfo is None:
            eval_time = eval_time.replace(tzinfo=timezone.utc)

        due_schedules = (
            db.query(Schedule)
            .filter(
                Schedule.status == ScheduleStatus.ACTIVE.value,
                Schedule.next_run_at.isnot(None),
                Schedule.next_run_at <= eval_time,
            )
            .all()
        )

        runs: list[Any] = []
        for schedule in due_schedules:
            fire_window = schedule.next_run_at or eval_time
            idempotency_key = generate_schedule_idempotency_key(schedule.id, fire_window)

            run_req = OrchestrationRunCreateRequest(
                workspace_id=schedule.workspace_id,
                site_id=schedule.site_id,
                run_type=RunType(schedule.run_type),
                trigger_source=TriggerSource.SCHEDULER,
                idempotency_key=idempotency_key,
                correlation_id=f"corr_{schedule.id}_{fire_window.strftime('%Y%m%d%H%M%S')}",
                actor_provenance=ActorProvenance(
                    actor_id="system_scheduler",
                    actor_type="scheduled_evaluation",
                ),
                metadata_payload={
                    **(schedule.configuration or {}),
                    "schedule_id": schedule.id,
                    "schedule_name": schedule.name,
                },
            )

            # Create run idempotently
            run = self.orchestration_service.create_run(run_req, db)
            runs.append(run)

            # Advance next_run_at to the next future occurrence strictly > eval_time
            if schedule.schedule_type != ScheduleType.ON_DEMAND.value:
                schedule.next_run_at = calculate_next_run_at(
                    schedule_type=schedule.schedule_type,
                    cron_expression=schedule.cron_expression,
                    interval_seconds=schedule.interval_seconds,
                    timezone_str=schedule.timezone,
                    minimum_interval_seconds=schedule.minimum_interval_seconds,
                    from_time=eval_time,
                )
            else:
                schedule.next_run_at = None

            schedule.last_run_at = eval_time
            schedule.updated_at = _utc_now()
            schedule.version += 1
            db.commit()

            # Enqueue to queue if provided and run is QUEUED
            if queue is not None and run.state == RunState.QUEUED.value:
                queue_job = QueueJob(
                    run_id=run.id,
                    workspace_id=run.workspace_id,
                    site_id=run.site_id,
                    run_type=run.run_type,
                    priority=0,
                    enqueued_at=_utc_now(),
                    payload={"schedule_id": schedule.id},
                )
                queue.enqueue(queue_job)
                logger.info(
                    "Enqueued scheduled run '%s' for schedule '%s'",
                    run.id,
                    schedule.id,
                )

        return runs
