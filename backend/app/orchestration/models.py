"""
Production Orchestration & Monitoring - Persistence Models.

Defines SQLAlchemy ORM models for OrchestrationRun, OrchestrationStage,
and OrchestrationEvent with multi-tenant isolation, idempotency indexes,
foreign keys, and optimistic locking tokens.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import TYPE_CHECKING, Any

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    JSON,
    String,
    TypeDecorator,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..database import Base
from .enums import (
    AlertSeverity,
    AlertStatus,
    AutomationLevel,
    CheckpointType,
    ControlSignalType,
    MonitoringSeverity,
    ReceiptStatus,
    RunState,
    RunType,
    ScheduleStatus,
    ScheduleType,
    StageState,
    TriggerSource,
)

if TYPE_CHECKING:
    from ..models import Website


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


class UTCDateTime(TypeDecorator):
    """
    Ensures datetime values are stored and retrieved as UTC-aware datetimes
    across SQLite and PostgreSQL engines.
    """

    impl = DateTime(timezone=True)
    cache_ok = True

    def process_bind_param(self, value: datetime | None, dialect: Any) -> datetime | None:
        if value is not None:
            if value.tzinfo is None:
                value = value.replace(tzinfo=timezone.utc)
            else:
                value = value.astimezone(timezone.utc)
        return value

    def process_result_value(self, value: datetime | None, dialect: Any) -> datetime | None:
        if value is not None:
            if value.tzinfo is None:
                value = value.replace(tzinfo=timezone.utc)
            else:
                value = value.astimezone(timezone.utc)
        return value


class OrchestrationRun(Base):
    """
    Persistent record representing an end-to-end orchestration run.
    """

    __tablename__ = "orchestration_runs"

    id: Mapped[str] = mapped_column(
        String(64),
        primary_key=True,
    )

    workspace_id: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
        index=True,
    )

    site_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("websites.id"),
        nullable=False,
        index=True,
    )

    run_type: Mapped[str] = mapped_column(
        String(32),
        nullable=False,
        index=True,
    )

    state: Mapped[str] = mapped_column(
        String(32),
        default=RunState.QUEUED.value,
        nullable=False,
        index=True,
    )

    trigger_source: Mapped[str] = mapped_column(
        String(32),
        default=TriggerSource.MANUAL.value,
        nullable=False,
    )

    idempotency_key: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
        index=True,
    )

    correlation_id: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
        index=True,
    )

    attempt_count: Mapped[int] = mapped_column(
        Integer,
        default=1,
        nullable=False,
    )

    recovery_info: Mapped[dict[str, Any] | None] = mapped_column(
        JSON,
        nullable=True,
    )

    actor_provenance: Mapped[dict[str, Any]] = mapped_column(
        JSON,
        default=dict,
        nullable=False,
    )

    outcome_summary: Mapped[dict[str, Any] | None] = mapped_column(
        JSON,
        nullable=True,
    )

    error_detail: Mapped[dict[str, Any] | None] = mapped_column(
        JSON,
        nullable=True,
    )

    version: Mapped[int] = mapped_column(
        Integer,
        default=1,
        nullable=False,
    )

    requested_at: Mapped[datetime] = mapped_column(
        UTCDateTime,
        default=_utc_now,
        nullable=False,
    )

    started_at: Mapped[datetime | None] = mapped_column(
        UTCDateTime,
        nullable=True,
    )

    completed_at: Mapped[datetime | None] = mapped_column(
        UTCDateTime,
        nullable=True,
    )

    cancelled_at: Mapped[datetime | None] = mapped_column(
        UTCDateTime,
        nullable=True,
    )

    paused_at: Mapped[datetime | None] = mapped_column(
        UTCDateTime,
        nullable=True,
    )

    metadata_payload: Mapped[dict[str, Any]] = mapped_column(
        JSON,
        default=dict,
        nullable=False,
    )

    # Relationships
    website = relationship(
        "Website",
        back_populates="orchestration_runs",
    )

    stages: Mapped[list[OrchestrationStage]] = relationship(
        "OrchestrationStage",
        back_populates="run",
        cascade="all, delete-orphan",
        order_by="OrchestrationStage.execution_order",
    )

    events: Mapped[list[OrchestrationEvent]] = relationship(
        "OrchestrationEvent",
        back_populates="run",
        cascade="all, delete-orphan",
        order_by="OrchestrationEvent.occurred_at",
    )

    receipts: Mapped[list[ExecutionReceipt]] = relationship(
        "ExecutionReceipt",
        back_populates="run",
        cascade="all, delete-orphan",
        order_by="ExecutionReceipt.created_at",
    )

    checkpoints: Mapped[list[OrchestrationCheckpoint]] = relationship(
        "OrchestrationCheckpoint",
        back_populates="run",
        cascade="all, delete-orphan",
        order_by="OrchestrationCheckpoint.sequence",
    )

    control_requests: Mapped[list[OrchestrationControlRequest]] = relationship(
        "OrchestrationControlRequest",
        back_populates="run",
        cascade="all, delete-orphan",
        order_by="OrchestrationControlRequest.requested_at",
    )

    __table_args__ = (
        UniqueConstraint(
            "workspace_id",
            "idempotency_key",
            name="uq_orchestration_run_workspace_idempotency",
        ),
        Index("ix_orchestration_run_workspace_site", "workspace_id", "site_id"),
        Index("ix_orchestration_run_state_created", "state", "requested_at"),
    )

    @property
    def run_id(self) -> str:
        return self.id


class OrchestrationStage(Base):
    """
    Persistent record representing an individual execution stage within a run.
    """

    __tablename__ = "orchestration_stages"

    id: Mapped[str] = mapped_column(
        String(64),
        primary_key=True,
    )

    run_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("orchestration_runs.id"),
        nullable=False,
        index=True,
    )

    workspace_id: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
        index=True,
    )

    site_id: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        index=True,
    )

    stage_name: Mapped[str] = mapped_column(
        String(64),
        nullable=False,
        index=True,
    )

    state: Mapped[str] = mapped_column(
        String(32),
        default=StageState.QUEUED.value,
        nullable=False,
        index=True,
    )

    execution_order: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
    )

    dependencies: Mapped[list[str]] = mapped_column(
        JSON,
        default=list,
        nullable=False,
    )

    idempotency_key: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
    )

    attempt_count: Mapped[int] = mapped_column(
        Integer,
        default=0,
        nullable=False,
    )

    max_attempts: Mapped[int] = mapped_column(
        Integer,
        default=3,
        nullable=False,
    )

    queued_at: Mapped[datetime] = mapped_column(
        UTCDateTime,
        default=_utc_now,
        nullable=False,
    )

    started_at: Mapped[datetime | None] = mapped_column(
        UTCDateTime,
        nullable=True,
    )

    completed_at: Mapped[datetime | None] = mapped_column(
        UTCDateTime,
        nullable=True,
    )

    last_heartbeat_at: Mapped[datetime | None] = mapped_column(
        UTCDateTime,
        nullable=True,
    )

    error_detail: Mapped[dict[str, Any] | None] = mapped_column(
        JSON,
        nullable=True,
    )

    output_summary: Mapped[dict[str, Any] | None] = mapped_column(
        JSON,
        nullable=True,
    )

    version: Mapped[int] = mapped_column(
        Integer,
        default=1,
        nullable=False,
    )

    # Relationships
    run = relationship(
        "OrchestrationRun",
        back_populates="stages",
    )

    events: Mapped[list[OrchestrationEvent]] = relationship(
        "OrchestrationEvent",
        back_populates="stage",
        cascade="all, delete-orphan",
        order_by="OrchestrationEvent.occurred_at",
    )

    receipts: Mapped[list[ExecutionReceipt]] = relationship(
        "ExecutionReceipt",
        back_populates="stage",
    )

    checkpoints: Mapped[list[OrchestrationCheckpoint]] = relationship(
        "OrchestrationCheckpoint",
        back_populates="stage",
        cascade="all, delete-orphan",
        order_by="OrchestrationCheckpoint.sequence",
    )

    __table_args__ = (
        UniqueConstraint(
            "run_id",
            "stage_name",
            name="uq_orchestration_stage_run_name",
        ),
        Index("ix_orchestration_stage_run_order", "run_id", "execution_order"),
    )

    @property
    def stage_id(self) -> str:
        return self.id


class OrchestrationEvent(Base):
    """
    Immutable audit event record emitted during run/stage state transitions and system operations.
    """

    __tablename__ = "orchestration_events"

    id: Mapped[str] = mapped_column(
        String(64),
        primary_key=True,
    )

    run_id: Mapped[str | None] = mapped_column(
        String(64),
        ForeignKey("orchestration_runs.id"),
        nullable=True,
        index=True,
    )

    stage_id: Mapped[str | None] = mapped_column(
        String(64),
        ForeignKey("orchestration_stages.id"),
        nullable=True,
        index=True,
    )

    workspace_id: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
        index=True,
    )

    site_id: Mapped[int | None] = mapped_column(
        Integer,
        nullable=True,
        index=True,
    )

    event_type: Mapped[str] = mapped_column(
        String(64),
        nullable=False,
        index=True,
    )

    from_state: Mapped[str | None] = mapped_column(
        String(32),
        nullable=True,
    )

    to_state: Mapped[str | None] = mapped_column(
        String(32),
        nullable=True,
    )

    job_id: Mapped[str | None] = mapped_column(
        String(64),
        nullable=True,
        index=True,
    )

    worker_id: Mapped[str | None] = mapped_column(
        String(64),
        nullable=True,
        index=True,
    )

    correlation_id: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
        index=True,
    )

    severity: Mapped[str] = mapped_column(
        String(32),
        default=AlertSeverity.INFO.value,
        nullable=False,
    )

    outcome: Mapped[str | None] = mapped_column(
        String(64),
        nullable=True,
    )

    duration_ms: Mapped[int | None] = mapped_column(
        Integer,
        nullable=True,
    )

    component: Mapped[str | None] = mapped_column(
        String(64),
        nullable=True,
    )

    details: Mapped[dict[str, Any]] = mapped_column(
        JSON,
        default=dict,
        nullable=False,
    )

    occurred_at: Mapped[datetime] = mapped_column(
        UTCDateTime,
        default=_utc_now,
        nullable=False,
    )

    # Relationships
    run = relationship(
        "OrchestrationRun",
        back_populates="events",
    )

    stage = relationship(
        "OrchestrationStage",
        back_populates="events",
    )

    __table_args__ = (
        Index("ix_orchestration_event_run_occurred", "run_id", "occurred_at"),
        Index("ix_orchestration_event_workspace_site", "workspace_id", "site_id"),
        Index("ix_orchestration_event_type", "event_type"),
        Index("ix_orchestration_event_occurred", "occurred_at"),
    )


class Schedule(Base):
    """
    Persistent recurring or on-demand scheduling entity.
    """

    __tablename__ = "orchestration_schedules"

    id: Mapped[str] = mapped_column(
        String(64),
        primary_key=True,
    )

    workspace_id: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
        index=True,
    )

    site_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("websites.id"),
        nullable=False,
        index=True,
    )

    name: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
    )

    status: Mapped[str] = mapped_column(
        String(32),
        default=ScheduleStatus.ACTIVE.value,
        nullable=False,
        index=True,
    )

    schedule_type: Mapped[str] = mapped_column(
        String(32),
        default=ScheduleType.INTERVAL.value,
        nullable=False,
    )

    cron_expression: Mapped[str | None] = mapped_column(
        String(128),
        nullable=True,
    )

    interval_seconds: Mapped[int | None] = mapped_column(
        Integer,
        nullable=True,
    )

    timezone: Mapped[str] = mapped_column(
        String(64),
        default="UTC",
        nullable=False,
    )

    next_run_at: Mapped[datetime | None] = mapped_column(
        UTCDateTime,
        nullable=True,
        index=True,
    )

    last_run_at: Mapped[datetime | None] = mapped_column(
        UTCDateTime,
        nullable=True,
    )

    minimum_interval_seconds: Mapped[int] = mapped_column(
        Integer,
        default=300,
        nullable=False,
    )

    run_type: Mapped[str] = mapped_column(
        String(32),
        default=RunType.SCHEDULED_SCAN.value,
        nullable=False,
    )

    configuration: Mapped[dict[str, Any]] = mapped_column(
        JSON,
        default=dict,
        nullable=False,
    )

    actor_provenance: Mapped[dict[str, Any]] = mapped_column(
        JSON,
        default=dict,
        nullable=False,
    )

    created_at: Mapped[datetime] = mapped_column(
        UTCDateTime,
        default=_utc_now,
        nullable=False,
    )

    updated_at: Mapped[datetime] = mapped_column(
        UTCDateTime,
        default=_utc_now,
        nullable=False,
    )

    version: Mapped[int] = mapped_column(
        Integer,
        default=1,
        nullable=False,
    )

    # Relationships
    website = relationship(
        "Website",
        back_populates="schedules",
    )

    __table_args__ = (
        Index("ix_orchestration_schedule_workspace_site", "workspace_id", "site_id"),
        Index("ix_orchestration_schedule_due", "status", "next_run_at"),
    )


class ExecutionReceipt(Base):
    """
    Durable execution receipt recording external operations/side-effects.
    Guarantees at-least-once + idempotency protection without claiming
    universal exactly-once execution for uncoordinated external systems.
    """

    __tablename__ = "orchestration_execution_receipts"

    id: Mapped[str] = mapped_column(
        String(64),
        primary_key=True,
    )

    workspace_id: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
        index=True,
    )

    site_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("websites.id"),
        nullable=False,
        index=True,
    )

    run_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("orchestration_runs.id"),
        nullable=False,
        index=True,
    )

    stage_id: Mapped[str | None] = mapped_column(
        String(64),
        ForeignKey("orchestration_stages.id"),
        nullable=True,
        index=True,
    )

    job_id: Mapped[str | None] = mapped_column(
        String(64),
        nullable=True,
        index=True,
    )

    worker_id: Mapped[str | None] = mapped_column(
        String(64),
        nullable=True,
    )

    operation_type: Mapped[str] = mapped_column(
        String(64),
        nullable=False,
    )

    idempotency_key: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
        index=True,
    )

    status: Mapped[str] = mapped_column(
        String(32),
        default=ReceiptStatus.PENDING.value,
        nullable=False,
        index=True,
    )

    external_reference: Mapped[str | None] = mapped_column(
        String(512),
        nullable=True,
    )

    @property
    def external_reference_id(self) -> str | None:
        return self.external_reference

    @external_reference_id.setter
    def external_reference_id(self, val: str | None) -> None:
        self.external_reference = val

    is_confirmed: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        nullable=False,
    )

    is_safe_to_retry: Mapped[bool] = mapped_column(
        Boolean,
        default=True,
        nullable=False,
    )

    attempt: Mapped[int] = mapped_column(
        Integer,
        default=1,
        nullable=False,
    )

    details: Mapped[dict[str, Any]] = mapped_column(
        JSON,
        default=dict,
        nullable=False,
    )

    created_at: Mapped[datetime] = mapped_column(
        UTCDateTime,
        default=_utc_now,
        nullable=False,
    )

    updated_at: Mapped[datetime] = mapped_column(
        UTCDateTime,
        default=_utc_now,
        nullable=False,
    )

    # Relationships
    run = relationship(
        "OrchestrationRun",
        back_populates="receipts",
    )

    stage = relationship(
        "OrchestrationStage",
        back_populates="receipts",
    )

    website = relationship(
        "Website",
    )

    __table_args__ = (
        UniqueConstraint(
            "workspace_id",
            "idempotency_key",
            name="uq_orchestration_receipt_workspace_idempotency",
        ),
        Index("ix_orchestration_receipt_workspace_site", "workspace_id", "site_id"),
        Index("ix_orchestration_receipt_run_stage", "run_id", "stage_id"),
    )


class OrchestrationCheckpoint(Base):
    """
    Durable checkpoint recording stage/step execution progress for safe resumption.
    Tenant/site scoped with monotonic sequence indexing.
    """

    __tablename__ = "orchestration_checkpoints"

    id: Mapped[str] = mapped_column(
        String(64),
        primary_key=True,
    )

    workspace_id: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
        index=True,
    )

    site_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("websites.id"),
        nullable=False,
        index=True,
    )

    run_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("orchestration_runs.id"),
        nullable=False,
        index=True,
    )

    stage_id: Mapped[str | None] = mapped_column(
        String(64),
        ForeignKey("orchestration_stages.id"),
        nullable=True,
        index=True,
    )

    sequence: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
    )

    checkpoint_type: Mapped[str] = mapped_column(
        String(32),
        default=CheckpointType.STAGE_BOUNDARY.value,
        nullable=False,
    )

    progress_cursor: Mapped[dict[str, Any]] = mapped_column(
        JSON,
        default=dict,
        nullable=False,
    )

    completed_work_summary: Mapped[dict[str, Any]] = mapped_column(
        JSON,
        default=dict,
        nullable=False,
    )

    remaining_work_summary: Mapped[dict[str, Any]] = mapped_column(
        JSON,
        default=dict,
        nullable=False,
    )

    worker_id: Mapped[str | None] = mapped_column(
        String(64),
        nullable=True,
    )

    is_safe_to_resume: Mapped[bool] = mapped_column(
        Boolean,
        default=True,
        nullable=False,
    )

    idempotency_context: Mapped[dict[str, Any]] = mapped_column(
        JSON,
        default=dict,
        nullable=False,
    )

    metadata_payload: Mapped[dict[str, Any]] = mapped_column(
        JSON,
        default=dict,
        nullable=False,
    )

    version: Mapped[int] = mapped_column(
        Integer,
        default=1,
        nullable=False,
    )

    created_at: Mapped[datetime] = mapped_column(
        UTCDateTime,
        default=_utc_now,
        nullable=False,
    )

    # Relationships
    run = relationship(
        "OrchestrationRun",
        back_populates="checkpoints",
    )

    stage = relationship(
        "OrchestrationStage",
        back_populates="checkpoints",
    )

    website = relationship(
        "Website",
    )

    __table_args__ = (
        UniqueConstraint("run_id", "sequence", name="uq_orchestration_checkpoint_run_seq"),
        Index("ix_orchestration_checkpoint_workspace_site", "workspace_id", "site_id"),
        Index("ix_orchestration_checkpoint_run_stage", "run_id", "stage_id"),
    )


class OrchestrationControlRequest(Base):
    """
    Durable cancellation or pause request tracking intent, requester provenance,
    acknowledgement by worker, and final outcome.
    """

    __tablename__ = "orchestration_control_requests"

    id: Mapped[str] = mapped_column(
        String(64),
        primary_key=True,
    )

    workspace_id: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
        index=True,
    )

    site_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("websites.id"),
        nullable=False,
        index=True,
    )

    run_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("orchestration_runs.id"),
        nullable=False,
        index=True,
    )

    signal_type: Mapped[str] = mapped_column(
        String(32),
        nullable=False,
        index=True,
    )

    requested_by: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
    )

    requested_at: Mapped[datetime] = mapped_column(
        UTCDateTime,
        default=_utc_now,
        nullable=False,
    )

    reason: Mapped[str | None] = mapped_column(
        String(512),
        nullable=True,
    )

    current_state_at_request: Mapped[str] = mapped_column(
        String(32),
        nullable=False,
    )

    is_acknowledged: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        nullable=False,
        index=True,
    )

    acknowledged_at: Mapped[datetime | None] = mapped_column(
        UTCDateTime,
        nullable=True,
    )

    acknowledged_by_worker: Mapped[str | None] = mapped_column(
        String(64),
        nullable=True,
    )

    outcome: Mapped[str | None] = mapped_column(
        String(64),
        nullable=True,
    )

    details: Mapped[dict[str, Any]] = mapped_column(
        JSON,
        default=dict,
        nullable=False,
    )

    # Relationships
    run = relationship(
        "OrchestrationRun",
        back_populates="control_requests",
    )

    website = relationship(
        "Website",
    )

    __table_args__ = (
        Index("ix_orchestration_control_workspace_site", "workspace_id", "site_id"),
        Index("ix_orchestration_control_run_pending", "run_id", "is_acknowledged"),
    )


class OrchestrationMonitoringObservation(Base):
    """
    Persistent audit record of an operational health observation across pipeline domains.
    """

    __tablename__ = "orchestration_monitoring_observations"

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
        autoincrement=True,
    )

    workspace_id: Mapped[str] = mapped_column(
        String(64),
        nullable=False,
        index=True,
    )

    site_id: Mapped[int | None] = mapped_column(
        ForeignKey("websites.id"),
        nullable=True,
        index=True,
    )

    monitoring_type: Mapped[str] = mapped_column(
        String(64),
        nullable=False,
        index=True,
    )

    status: Mapped[str] = mapped_column(
        String(32),
        nullable=False,
        index=True,
    )

    severity: Mapped[str] = mapped_column(
        String(32),
        default=MonitoringSeverity.INFO.value,
        nullable=False,
    )

    observed_at: Mapped[datetime] = mapped_column(
        UTCDateTime,
        default=_utc_now,
        nullable=False,
        index=True,
    )

    source_run_id: Mapped[str | None] = mapped_column(
        ForeignKey("orchestration_runs.id"),
        nullable=True,
        index=True,
    )

    source_job_id: Mapped[str | None] = mapped_column(
        String(64),
        nullable=True,
    )

    summary: Mapped[str] = mapped_column(
        String(512),
        nullable=False,
    )

    details: Mapped[dict[str, Any]] = mapped_column(
        JSON,
        default=dict,
        nullable=False,
    )

    # Relationships
    website = relationship(
        "Website",
    )

    run = relationship(
        "OrchestrationRun",
    )

    __table_args__ = (
        Index("ix_orchestration_monitoring_workspace_site", "workspace_id", "site_id"),
        Index("ix_orchestration_monitoring_type_observed", "monitoring_type", "observed_at"),
        Index("ix_orchestration_monitoring_status", "status"),
    )


class OrchestrationAlert(Base):
    """
    Persistent operational alert generated by deterministic rules or health monitoring.
    """

    __tablename__ = "orchestration_alerts"

    id: Mapped[str] = mapped_column(
        String(64),
        primary_key=True,
    )

    workspace_id: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
        index=True,
    )

    site_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("websites.id"),
        nullable=True,
        index=True,
    )

    alert_type: Mapped[str] = mapped_column(
        String(64),
        nullable=False,
        index=True,
    )

    severity: Mapped[str] = mapped_column(
        String(32),
        default=AlertSeverity.INFO.value,
        nullable=False,
        index=True,
    )

    status: Mapped[str] = mapped_column(
        String(32),
        default=AlertStatus.OPEN.value,
        nullable=False,
        index=True,
    )

    summary: Mapped[str] = mapped_column(
        String(512),
        nullable=False,
    )

    deduplication_key: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
        index=True,
    )

    occurrence_count: Mapped[int] = mapped_column(
        Integer,
        default=1,
        nullable=False,
    )

    source_run_id: Mapped[str | None] = mapped_column(
        String(64),
        ForeignKey("orchestration_runs.id"),
        nullable=True,
        index=True,
    )

    source_job_id: Mapped[str | None] = mapped_column(
        String(64),
        nullable=True,
    )

    source_stage_id: Mapped[str | None] = mapped_column(
        String(64),
        nullable=True,
    )

    details: Mapped[dict[str, Any]] = mapped_column(
        JSON,
        default=dict,
        nullable=False,
    )

    first_observed_at: Mapped[datetime] = mapped_column(
        UTCDateTime,
        default=_utc_now,
        nullable=False,
    )

    last_observed_at: Mapped[datetime] = mapped_column(
        UTCDateTime,
        default=_utc_now,
        nullable=False,
    )

    acknowledged_at: Mapped[datetime | None] = mapped_column(
        UTCDateTime,
        nullable=True,
    )

    acknowledged_by: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
    )

    resolved_at: Mapped[datetime | None] = mapped_column(
        UTCDateTime,
        nullable=True,
    )

    resolved_by: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
    )

    resolution_reason: Mapped[str | None] = mapped_column(
        String(512),
        nullable=True,
    )

    created_at: Mapped[datetime] = mapped_column(
        UTCDateTime,
        default=_utc_now,
        nullable=False,
    )

    # Relationships
    website = relationship(
        "Website",
    )

    run = relationship(
        "OrchestrationRun",
    )

    __table_args__ = (
        Index("ix_orchestration_alert_workspace_site", "workspace_id", "site_id"),
        Index("ix_orchestration_alert_status_severity", "status", "severity"),
        Index("ix_orchestration_alert_dedup", "deduplication_key", "status"),
    )


class TenantOrchestrationPolicy(Base):
    """
    Persistent tenant and site-level operational policy configuration.
    """

    __tablename__ = "tenant_orchestration_policies"

    id: Mapped[str] = mapped_column(
        String(64),
        primary_key=True,
    )

    workspace_id: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
        index=True,
    )

    site_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("websites.id"),
        nullable=True,
        index=True,
    )

    max_concurrent_runs: Mapped[int] = mapped_column(
        Integer,
        default=5,
        nullable=False,
    )

    max_concurrent_jobs: Mapped[int] = mapped_column(
        Integer,
        default=10,
        nullable=False,
    )

    max_concurrent_provider_calls: Mapped[int] = mapped_column(
        Integer,
        default=5,
        nullable=False,
    )

    max_crawl_jobs: Mapped[int] = mapped_column(
        Integer,
        default=3,
        nullable=False,
    )

    max_ai_probe_jobs: Mapped[int] = mapped_column(
        Integer,
        default=4,
        nullable=False,
    )

    max_refresh_jobs: Mapped[int] = mapped_column(
        Integer,
        default=3,
        nullable=False,
    )

    retry_budget_per_hour: Mapped[int] = mapped_column(
        Integer,
        default=20,
        nullable=False,
    )

    daily_operational_budget: Mapped[int] = mapped_column(
        Integer,
        default=100,
        nullable=False,
    )

    max_execution_duration_seconds: Mapped[int] = mapped_column(
        Integer,
        default=3600,
        nullable=False,
    )

    max_queue_age_seconds: Mapped[int] = mapped_column(
        Integer,
        default=1800,
        nullable=False,
    )

    allowed_automation_level: Mapped[str] = mapped_column(
        String(32),
        default=AutomationLevel.FULL.value,
        nullable=False,
    )

    is_monitoring_enabled: Mapped[bool] = mapped_column(
        Boolean,
        default=True,
        nullable=False,
    )

    min_alert_severity: Mapped[str] = mapped_column(
        String(32),
        default=AlertSeverity.INFO.value,
        nullable=False,
    )

    maintenance_window_cron: Mapped[str | None] = mapped_column(
        String(128),
        nullable=True,
    )

    maintenance_window_active: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        nullable=False,
    )

    custom_settings: Mapped[dict[str, Any]] = mapped_column(
        JSON,
        default=dict,
        nullable=False,
    )

    created_at: Mapped[datetime] = mapped_column(
        UTCDateTime,
        default=_utc_now,
        nullable=False,
    )

    updated_at: Mapped[datetime] = mapped_column(
        UTCDateTime,
        default=_utc_now,
        nullable=False,
    )

    version: Mapped[int] = mapped_column(
        Integer,
        default=1,
        nullable=False,
    )

    # Relationships
    website = relationship(
        "Website",
    )

    __table_args__ = (
        Index("ix_tenant_policy_workspace_site", "workspace_id", "site_id"),
    )



