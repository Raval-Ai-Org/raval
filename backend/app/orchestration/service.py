"""
Production Orchestration & Monitoring - Core Orchestration Service.

Implements the foundational lifecycle operations for OrchestrationRun,
OrchestrationStage, and OrchestrationEvent entities, enforcing:
- Centralized state machine validation
- Strict multi-tenant workspace & site isolation
- Stable idempotency barriers
- Recursive credential/secret scrubbing
- Optimistic concurrency control (version locking)
"""

from __future__ import annotations

from datetime import datetime, timezone
import logging
from typing import Any
from uuid import uuid4

from sqlalchemy.orm import Session

from connectors.base.security import sanitize_payload

scrub_secrets = sanitize_payload

from .enums import OrchestrationEventType, RunState, RunType, StageName, StageState, TriggerSource
from .exceptions import (
    IdempotencyConflictError,
    InvalidStateTransitionError,
    OptimisticLockError,
    RunNotFoundError,
    SiteMismatchError,
    StageNotFoundError,
    TenantMismatchError,
)
from .models import OrchestrationEvent, OrchestrationRun, OrchestrationStage
from .schemas import OrchestrationRunCreateRequest
from .stage_planner import StagePlanner
from .state_machine import OrchestrationStateMachine

logger = logging.getLogger(__name__)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


class OrchestrationService:
    """
    Central service for orchestration lifecycle, persistence, and state transitions.
    """

    def __init__(self) -> None:
        self.state_machine = OrchestrationStateMachine

    def create_run(
        self,
        request: OrchestrationRunCreateRequest,
        db: Session,
    ) -> OrchestrationRun:
        """
        Creates a new OrchestrationRun in deterministic QUEUED state with its
        ordered stage plan, respecting idempotency and multi-tenant isolation.
        """
        workspace_id = request.workspace_id.strip()
        if not workspace_id:
            raise ValueError("workspace_id cannot be empty")

        site_id = request.site_id
        if site_id <= 0:
            raise ValueError("site_id must be a positive integer")

        idempotency_key = (
            request.idempotency_key.strip()
            if request.idempotency_key
            else f"idem_{uuid4().hex}"
        )

        # 1. Idempotency Check scoped strictly to (workspace_id, idempotency_key)
        existing_run = (
            db.query(OrchestrationRun)
            .filter(
                OrchestrationRun.workspace_id == workspace_id,
                OrchestrationRun.idempotency_key == idempotency_key,
            )
            .first()
        )

        if existing_run:
            # Check for parameter conflict
            if (
                existing_run.site_id != site_id
                or existing_run.run_type != request.run_type.value
            ):
                raise IdempotencyConflictError(
                    idempotency_key=idempotency_key,
                    existing_run_id=existing_run.id,
                    message=(
                        f"Idempotency conflict: key '{idempotency_key}' in workspace '{workspace_id}' "
                        f"is already used by run '{existing_run.id}' with different parameters "
                        f"(existing site={existing_run.site_id}, type={existing_run.run_type}; "
                        f"requested site={site_id}, type={request.run_type.value})."
                    ),
                )
            logger.info(
                "Idempotent replay: returning existing OrchestrationRun '%s' for key '%s'",
                existing_run.id,
                idempotency_key,
            )
            return existing_run

        # 2. Generate Deterministic Identifiers
        run_id = f"run_{uuid4().hex[:16]}"
        correlation_id = request.correlation_id or f"corr_{uuid4().hex[:16]}"

        # 3. Scrub secrets from actor provenance and metadata
        clean_actor = sanitize_payload(request.actor_provenance.model_dump())
        clean_metadata = sanitize_payload(request.metadata_payload)

        # 4. Initialize Run Record
        now = _utc_now()
        run = OrchestrationRun(
            id=run_id,
            workspace_id=workspace_id,
            site_id=site_id,
            run_type=request.run_type.value,
            state=RunState.QUEUED.value,
            trigger_source=request.trigger_source.value,
            idempotency_key=idempotency_key,
            correlation_id=correlation_id,
            attempt_count=1,
            recovery_info=None,
            actor_provenance=clean_actor,
            outcome_summary=None,
            error_detail=None,
            version=1,
            requested_at=now,
            started_at=None,
            completed_at=None,
            cancelled_at=None,
            metadata_payload=clean_metadata,
        )

        # 5. Materialize Ordered Stage Plan
        stage_blueprints = StagePlanner.generate_plan_for_run_type(request.run_type)
        stages: list[OrchestrationStage] = []
        for bp in stage_blueprints:
            stage_id = f"stg_{uuid4().hex[:16]}"
            stage_idem_key = f"{run_id}:{bp.stage_name.value}"
            stage = OrchestrationStage(
                id=stage_id,
                run_id=run_id,
                workspace_id=workspace_id,
                site_id=site_id,
                stage_name=bp.stage_name.value,
                state=StageState.QUEUED.value,
                execution_order=bp.execution_order,
                dependencies=[d.value for d in bp.dependencies],
                idempotency_key=stage_idem_key,
                attempt_count=0,
                max_attempts=bp.max_attempts,
                queued_at=now,
                started_at=None,
                completed_at=None,
                last_heartbeat_at=None,
                error_detail=None,
                output_summary=None,
                version=1,
            )
            stages.append(stage)

        run.stages = stages

        # 6. Record Initial Event
        initial_event = OrchestrationEvent(
            id=f"evt_{uuid4().hex[:16]}",
            run_id=run_id,
            stage_id=None,
            workspace_id=workspace_id,
            site_id=site_id,
            event_type=OrchestrationEventType.RUN_CREATED.value,
            from_state=None,
            to_state=RunState.QUEUED.value,
            details=scrub_secrets({
                "run_type": request.run_type.value,
                "trigger_source": request.trigger_source.value,
                "stage_count": len(stages),
                "actor": clean_actor,
            }),
            occurred_at=now,
        )
        run.events = [initial_event]

        db.add(run)
        db.commit()
        db.refresh(run)

        logger.info(
            "Created OrchestrationRun '%s' (type=%s, stages=%d) for workspace '%s'",
            run.id,
            run.run_type,
            len(run.stages),
            workspace_id,
        )
        return run

    def get_run(
        self,
        workspace_id: str,
        run_id: str,
        db: Session,
        site_id: int | None = None,
    ) -> OrchestrationRun:
        """
        Retrieves an OrchestrationRun by ID, strictly enforcing tenant isolation and site scoping.
        """
        run = db.query(OrchestrationRun).filter(OrchestrationRun.id == run_id).first()
        if not run:
            raise RunNotFoundError(run_id=run_id, workspace_id=workspace_id)

        if run.workspace_id != workspace_id:
            raise TenantMismatchError(
                request_workspace_id=workspace_id,
                target_workspace_id=run.workspace_id,
                entity_id=run_id,
            )

        if site_id is not None and run.site_id != site_id:
            raise SiteMismatchError(
                run_id=run_id,
                expected_site_id=run.site_id,
                actual_site_id=site_id,
            )
        return run

    def list_runs(
        self,
        workspace_id: str,
        site_id: int | None,
        db: Session,
        limit: int = 50,
        offset: int = 0,
    ) -> list[OrchestrationRun]:
        """
        Lists all runs for a given workspace/tenant, optionally filtered by site_id.
        """
        query = db.query(OrchestrationRun).filter(
            OrchestrationRun.workspace_id == workspace_id
        )
        if site_id is not None:
            query = query.filter(OrchestrationRun.site_id == site_id)

        return (
            query.order_by(OrchestrationRun.requested_at.desc())
            .offset(offset)
            .limit(limit)
            .all()
        )

    def get_stage(
        self,
        workspace_id: str,
        run_id: str,
        stage_id: str,
        db: Session,
        site_id: int | None = None,
    ) -> OrchestrationStage:
        """
        Retrieves a stage within a run, validating tenant and site ownership.
        """
        # Validates tenant & site access on the parent run
        self.get_run(workspace_id=workspace_id, run_id=run_id, db=db, site_id=site_id)

        stage = (
            db.query(OrchestrationStage)
            .filter(
                OrchestrationStage.id == stage_id,
                OrchestrationStage.run_id == run_id,
            )
            .first()
        )
        if not stage:
            raise StageNotFoundError(stage_id=stage_id, run_id=run_id)

        if site_id is not None and stage.site_id != site_id:
            raise SiteMismatchError(
                run_id=run_id,
                expected_site_id=stage.site_id,
                actual_site_id=site_id,
            )

        return stage

    def transition_run_state(
        self,
        workspace_id: str,
        run_id: str,
        target_state: RunState | str,
        db: Session,
        expected_version: int | None = None,
        site_id: int | None = None,
        reason: str | None = None,
        error_detail: dict[str, Any] | None = None,
        outcome_summary: dict[str, Any] | None = None,
        previous_active_state: RunState | str | None = None,
    ) -> OrchestrationRun:
        """
        Performs a centralized, validated state transition on an OrchestrationRun.
        """
        run = self.get_run(workspace_id=workspace_id, run_id=run_id, db=db, site_id=site_id)

        # 1. Optimistic Locking Check
        if expected_version is not None and run.version != expected_version:
            raise OptimisticLockError(
                entity_type="OrchestrationRun",
                entity_id=run_id,
                expected_version=expected_version,
                actual_version=run.version,
            )

        # 2. State Machine Validation
        current_state = RunState(run.state)
        target_state_enum = RunState(target_state) if isinstance(target_state, str) else target_state

        # Resolve previous active state if resuming from RETRY_WAIT or PAUSED
        resolved_prev = previous_active_state
        if current_state in (RunState.RETRY_WAIT, RunState.PAUSED) and resolved_prev is None:
            # Inspect metadata for recorded resumable state
            recorded = run.metadata_payload.get("resumable_active_state")
            if recorded:
                resolved_prev = RunState(recorded)

        self.state_machine.validate_run_transition(
            from_state=current_state,
            to_state=target_state_enum,
            previous_active_state=resolved_prev,
            run_id=run_id,
        )

        # 3. Apply State Mutation & Timestamp Tracking
        now = _utc_now()
        from_state_val = run.state
        run.state = target_state_enum.value

        # Track first active start time
        if target_state_enum.is_active and run.started_at is None:
            run.started_at = now

        # Track entering RETRY_WAIT or PAUSED by recording resumable state
        if target_state_enum in (RunState.RETRY_WAIT, RunState.PAUSED):
            meta = dict(run.metadata_payload)
            meta["resumable_active_state"] = from_state_val
            run.metadata_payload = meta
            if target_state_enum == RunState.PAUSED:
                run.paused_at = now

        # Clear paused_at when resuming out of PAUSED
        if from_state_val == RunState.PAUSED.value and target_state_enum != RunState.PAUSED:
            run.paused_at = None

        # Track terminal completion times
        if target_state_enum.is_terminal:
            run.completed_at = now
            if target_state_enum == RunState.CANCELLED:
                run.cancelled_at = now

        # 4. Attach scrubbed error or outcome summaries
        if error_detail is not None:
            run.error_detail = scrub_secrets(error_detail)

        if outcome_summary is not None:
            run.outcome_summary = scrub_secrets(outcome_summary)

        # 5. Increment version
        run.version += 1

        # 6. Record State Transition Event
        event_type = OrchestrationEventType.STATE_TRANSITION.value
        if target_state_enum == RunState.CANCELLED:
            event_type = OrchestrationEventType.RUN_CANCELLED.value
        elif target_state_enum == RunState.PAUSED:
            event_type = OrchestrationEventType.RUN_PAUSED.value
        elif from_state_val == RunState.PAUSED.value and target_state_enum.is_active:
            event_type = OrchestrationEventType.RUN_RESUMED.value

        event = OrchestrationEvent(
            id=f"evt_{uuid4().hex[:16]}",
            run_id=run.id,
            stage_id=None,
            workspace_id=run.workspace_id,
            site_id=run.site_id,
            event_type=event_type,
            from_state=from_state_val,
            to_state=target_state_enum.value,
            details=scrub_secrets({
                "reason": reason,
                "version": run.version,
                "error_present": error_detail is not None,
            }),
            occurred_at=now,
        )
        db.add(event)
        db.commit()
        db.refresh(run)

        logger.info(
            "OrchestrationRun '%s' transitioned: %s -> %s (version=%d)",
            run.id,
            from_state_val,
            run.state,
            run.version,
        )
        return run

    def transition_stage_state(
        self,
        workspace_id: str,
        run_id: str,
        stage_id: str,
        target_state: StageState | str,
        db: Session,
        expected_version: int | None = None,
        site_id: int | None = None,
        reason: str | None = None,
        error_detail: dict[str, Any] | None = None,
        output_summary: dict[str, Any] | None = None,
    ) -> OrchestrationStage:
        """
        Performs a centralized, validated state transition on an OrchestrationStage.
        """
        stage = self.get_stage(
            workspace_id=workspace_id,
            run_id=run_id,
            stage_id=stage_id,
            db=db,
            site_id=site_id,
        )

        if expected_version is not None and stage.version != expected_version:
            raise OptimisticLockError(
                entity_type="OrchestrationStage",
                entity_id=stage_id,
                expected_version=expected_version,
                actual_version=stage.version,
            )

        current_state = StageState(stage.state)
        target_state_enum = StageState(target_state) if isinstance(target_state, str) else target_state

        self.state_machine.validate_stage_transition(
            from_state=current_state,
            to_state=target_state_enum,
            stage_id=stage_id,
        )

        now = _utc_now()
        from_state_val = stage.state
        stage.state = target_state_enum.value

        if target_state_enum == StageState.RUNNING:
            if stage.started_at is None:
                stage.started_at = now
            stage.attempt_count += 1
            stage.last_heartbeat_at = now

        if target_state_enum.is_terminal:
            stage.completed_at = now

        if error_detail is not None:
            stage.error_detail = scrub_secrets(error_detail)

        if output_summary is not None:
            stage.output_summary = scrub_secrets(output_summary)

        stage.version += 1

        event = OrchestrationEvent(
            id=f"evt_{uuid4().hex[:16]}",
            run_id=run_id,
            stage_id=stage_id,
            workspace_id=workspace_id,
            site_id=stage.site_id,
            event_type=(
                OrchestrationEventType.STAGE_STARTED.value
                if target_state_enum == StageState.RUNNING
                else (
                    OrchestrationEventType.STAGE_COMPLETED.value
                    if target_state_enum == StageState.SUCCEEDED
                    else OrchestrationEventType.STATE_TRANSITION.value
                )
            ),
            from_state=from_state_val,
            to_state=target_state_enum.value,
            details=scrub_secrets({
                "stage_name": stage.stage_name,
                "attempt_count": stage.attempt_count,
                "reason": reason,
                "version": stage.version,
            }),
            occurred_at=now,
        )
        db.add(event)
        db.commit()
        db.refresh(stage)

        logger.info(
            "OrchestrationStage '%s' (%s) transitioned: %s -> %s (v=%d)",
            stage.id,
            stage.stage_name,
            from_state_val,
            stage.state,
            stage.version,
        )
        return stage

    def record_stage_heartbeat(
        self,
        workspace_id: str,
        run_id: str,
        stage_id: str,
        db: Session,
        site_id: int | None = None,
    ) -> OrchestrationStage:
        """
        Updates the heartbeat timestamp for an actively running stage.
        """
        stage = self.get_stage(
            workspace_id=workspace_id,
            run_id=run_id,
            stage_id=stage_id,
            db=db,
            site_id=site_id,
        )
        stage.last_heartbeat_at = _utc_now()
        db.commit()
        db.refresh(stage)
        return stage
