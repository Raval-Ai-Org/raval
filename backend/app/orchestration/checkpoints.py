"""
Production Orchestration & Monitoring - Checkpoint Management.

Implements durable, tenant-scoped checkpoints capturing stage and batch execution
progress at safe operational boundaries, enabling safe, non-destructive resumption.
"""

from __future__ import annotations

from datetime import datetime, timezone
import logging
from typing import Any
from uuid import uuid4

from sqlalchemy import func
from sqlalchemy.orm import Session

from connectors.base.security import sanitize_payload
from .enums import CheckpointType, OrchestrationEventType, RunState
from .exceptions import (
    CheckpointCorruptedError,
    RunNotFoundError,
    SiteMismatchError,
    StageNotFoundError,
    TenantMismatchError,
)
from .models import OrchestrationCheckpoint, OrchestrationEvent, OrchestrationRun, OrchestrationStage

logger = logging.getLogger(__name__)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


class CheckpointManager:
    """
    Manages creation, query, and validation of durable execution checkpoints.
    Enforces multi-tenant isolation, monotonic sequence ordering, and secret scrubbing.
    """

    @classmethod
    def create_checkpoint(
        cls,
        workspace_id: str,
        site_id: int,
        run_id: str,
        checkpoint_type: CheckpointType | str,
        db: Session,
        stage_id: str | None = None,
        progress_cursor: dict[str, Any] | None = None,
        completed_work_summary: dict[str, Any] | None = None,
        remaining_work_summary: dict[str, Any] | None = None,
        worker_id: str | None = None,
        is_safe_to_resume: bool = True,
        idempotency_context: dict[str, Any] | None = None,
        metadata_payload: dict[str, Any] | None = None,
    ) -> OrchestrationCheckpoint:
        """
        Creates and persists a durable OrchestrationCheckpoint.
        Automatically increments sequence per run.
        """
        # 1. Tenant & Site Validation
        run = db.query(OrchestrationRun).filter(OrchestrationRun.id == run_id).first()
        if not run:
            raise RunNotFoundError(run_id=run_id, workspace_id=workspace_id)

        if run.workspace_id != workspace_id:
            raise TenantMismatchError(
                request_workspace_id=workspace_id,
                target_workspace_id=run.workspace_id,
                entity_id=run_id,
            )

        if run.site_id != site_id:
            raise SiteMismatchError(
                run_id=run_id,
                expected_site_id=run.site_id,
                actual_site_id=site_id,
            )

        if stage_id:
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

        # 2. Monotonic Sequence Allocation
        max_seq = (
            db.query(func.max(OrchestrationCheckpoint.sequence))
            .filter(OrchestrationCheckpoint.run_id == run_id)
            .scalar()
        )
        next_seq = (max_seq or 0) + 1

        chk_type_val = (
            checkpoint_type.value
            if isinstance(checkpoint_type, CheckpointType)
            else str(checkpoint_type)
        )

        now = _utc_now()
        checkpoint_id = f"chk_{uuid4().hex[:16]}"

        # 3. Scrub secrets
        clean_completed = sanitize_payload(completed_work_summary or {})
        clean_remaining = sanitize_payload(remaining_work_summary or {})
        clean_idempotency = sanitize_payload(idempotency_context or {})
        clean_meta = sanitize_payload(metadata_payload or {})
        clean_cursor = sanitize_payload(progress_cursor or {})

        checkpoint = OrchestrationCheckpoint(
            id=checkpoint_id,
            workspace_id=workspace_id,
            site_id=site_id,
            run_id=run_id,
            stage_id=stage_id,
            sequence=next_seq,
            checkpoint_type=chk_type_val,
            progress_cursor=clean_cursor,
            completed_work_summary=clean_completed,
            remaining_work_summary=clean_remaining,
            worker_id=worker_id,
            is_safe_to_resume=is_safe_to_resume,
            idempotency_context=clean_idempotency,
            metadata_payload=clean_meta,
            version=1,
            created_at=now,
        )
        db.add(checkpoint)

        # 4. Audit Event
        event = OrchestrationEvent(
            id=f"evt_{uuid4().hex[:16]}",
            run_id=run_id,
            stage_id=stage_id,
            workspace_id=workspace_id,
            site_id=site_id,
            event_type=OrchestrationEventType.CHECKPOINT_CREATED.value,
            from_state=run.state,
            to_state=run.state,
            details=sanitize_payload({
                "checkpoint_id": checkpoint_id,
                "sequence": next_seq,
                "checkpoint_type": chk_type_val,
                "is_safe_to_resume": is_safe_to_resume,
                "worker_id": worker_id,
            }),
            occurred_at=now,
        )
        db.add(event)
        db.commit()
        db.refresh(checkpoint)

        logger.info(
            "Checkpoint '%s' created (seq=%d, type=%s, safe=%s) for run '%s'",
            checkpoint_id,
            next_seq,
            chk_type_val,
            is_safe_to_resume,
            run_id,
        )
        return checkpoint

    @classmethod
    def get_latest_checkpoint(
        cls,
        workspace_id: str,
        site_id: int,
        run_id: str,
        db: Session,
    ) -> OrchestrationCheckpoint | None:
        """
        Retrieves the highest-sequence checkpoint for a run, validating tenant ownership.
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

        if run.site_id != site_id:
            raise SiteMismatchError(
                run_id=run_id,
                expected_site_id=run.site_id,
                actual_site_id=site_id,
            )

        return (
            db.query(OrchestrationCheckpoint)
            .filter(
                OrchestrationCheckpoint.run_id == run_id,
                OrchestrationCheckpoint.workspace_id == workspace_id,
            )
            .order_by(OrchestrationCheckpoint.sequence.desc())
            .first()
        )

    @classmethod
    def list_checkpoints(
        cls,
        workspace_id: str,
        site_id: int,
        run_id: str,
        db: Session,
        stage_id: str | None = None,
        limit: int = 50,
    ) -> list[OrchestrationCheckpoint]:
        """
        Lists checkpoints for a run in chronological order.
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

        if run.site_id != site_id:
            raise SiteMismatchError(
                run_id=run_id,
                expected_site_id=run.site_id,
                actual_site_id=site_id,
            )

        query = db.query(OrchestrationCheckpoint).filter(
            OrchestrationCheckpoint.run_id == run_id,
            OrchestrationCheckpoint.workspace_id == workspace_id,
        )
        if stage_id:
            query = query.filter(OrchestrationCheckpoint.stage_id == stage_id)

        return query.order_by(OrchestrationCheckpoint.sequence.asc()).limit(limit).all()

    @classmethod
    def validate_checkpoint_integrity(cls, checkpoint: OrchestrationCheckpoint) -> None:
        """
        Verifies that a checkpoint is valid and safe for resumption.
        Raises CheckpointCorruptedError if invalid.
        """
        if not checkpoint.id or not checkpoint.run_id:
            raise CheckpointCorruptedError(
                checkpoint_id=getattr(checkpoint, "id", "[UNKNOWN]"),
                run_id=getattr(checkpoint, "run_id", "[UNKNOWN]"),
                reason="Missing primary identifiers",
            )
        if checkpoint.sequence <= 0:
            raise CheckpointCorruptedError(
                checkpoint_id=checkpoint.id,
                run_id=checkpoint.run_id,
                reason=f"Invalid non-positive sequence '{checkpoint.sequence}'",
            )
        if not checkpoint.is_safe_to_resume:
            raise CheckpointCorruptedError(
                checkpoint_id=checkpoint.id,
                run_id=checkpoint.run_id,
                reason="Checkpoint explicitly marked is_safe_to_resume=False",
            )

    @classmethod
    def get_checkpoint(
        cls,
        workspace_id: str,
        checkpoint_id: str,
        db: Session,
        run_id: str | None = None,
    ) -> OrchestrationCheckpoint | None:
        """Retrieves and verifies a checkpoint by ID and workspace."""
        query = db.query(OrchestrationCheckpoint).filter(
            OrchestrationCheckpoint.id == checkpoint_id,
            OrchestrationCheckpoint.workspace_id == workspace_id,
        )
        if run_id:
            query = query.filter(OrchestrationCheckpoint.run_id == run_id)
        ckpt = query.first()
        if ckpt:
            cls.validate_checkpoint_integrity(ckpt)
        return ckpt

    @classmethod
    def restore_checkpoint(
        cls,
        workspace_id: str,
        run_id: str,
        checkpoint_id: str,
        db: Session,
    ) -> OrchestrationCheckpoint | None:
        """Validates and restores a checkpoint for execution replay."""
        return cls.get_checkpoint(
            workspace_id=workspace_id,
            checkpoint_id=checkpoint_id,
            db=db,
            run_id=run_id,
        )
