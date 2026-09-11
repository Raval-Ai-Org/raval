"""
Production Orchestration & Monitoring - Observability & Metrics Engine.

Provides a centralized structured observability layer and operational metrics
calculation across runs, stages, queues, workers, and continuous monitoring.
"""

from __future__ import annotations

import math
import uuid
from datetime import datetime, timezone, timedelta
from typing import Any

from sqlalchemy import and_, func, select
from sqlalchemy.orm import Session

from connectors.base.security import sanitize_payload
from .enums import (
    AlertSeverity,
    FailureClass,
    OrchestrationEventType,
    RunState,
    StageState,
)
from .exceptions import TenantMismatchError, SiteMismatchError
from .models import (
    ExecutionReceipt,
    OrchestrationCheckpoint,
    OrchestrationControlRequest,
    OrchestrationEvent,
    OrchestrationRun,
    OrchestrationStage,
    _utc_now,
)
from .ports import validate_tenant_site_boundary


def _percentile(values: list[float], p: float) -> float:
    """Computes the p-th percentile (0.0 to 100.0) from a list of numbers."""
    if not values:
        return 0.0
    sorted_values = sorted(values)
    k = (len(sorted_values) - 1) * (p / 100.0)
    f = math.floor(k)
    c = math.ceil(k)
    if f == c:
        return float(sorted_values[int(k)])
    d0 = sorted_values[int(f)] * (c - k)
    d1 = sorted_values[int(c)] * (k - f)
    return round(float(d0 + d1), 2)


class ObservabilityService:
    """
    Centralized service for emitting and querying immutable audit and observability events.
    """

    def record_event(
        self,
        db: Session,
        workspace_id: str,
        event_type: str | OrchestrationEventType,
        *,
        site_id: int | None = None,
        run_id: str | None = None,
        stage_id: str | None = None,
        job_id: str | None = None,
        worker_id: str | None = None,
        correlation_id: str | None = None,
        severity: str | AlertSeverity = AlertSeverity.INFO,
        outcome: str | None = None,
        duration_ms: int | None = None,
        component: str | None = None,
        from_state: str | None = None,
        to_state: str | None = None,
        details: dict[str, Any] | None = None,
        occurred_at: datetime | None = None,
    ) -> OrchestrationEvent:
        """
        Records an immutable audit event with secret sanitization and tenant boundary checks.
        """
        if site_id is not None:
            validate_tenant_site_boundary(db, tenant_id=workspace_id, site_id=site_id)

        clean_details = sanitize_payload(details or {})
        evt_type_val = event_type.value if isinstance(event_type, OrchestrationEventType) else str(event_type)
        severity_val = severity.value if isinstance(severity, AlertSeverity) else str(severity)

        event = OrchestrationEvent(
            id=f"evt_{uuid.uuid4().hex[:16]}",
            workspace_id=workspace_id,
            site_id=site_id,
            run_id=run_id,
            stage_id=stage_id,
            job_id=job_id,
            worker_id=worker_id,
            correlation_id=correlation_id,
            event_type=evt_type_val,
            severity=severity_val,
            outcome=outcome,
            duration_ms=duration_ms,
            component=component,
            from_state=from_state,
            to_state=to_state,
            details=clean_details,
            occurred_at=occurred_at or _utc_now(),
        )
        db.add(event)
        db.commit()
        db.refresh(event)
        return event

    def list_events(
        self,
        db: Session,
        workspace_id: str,
        *,
        site_id: int | None = None,
        run_id: str | None = None,
        stage_id: str | None = None,
        job_id: str | None = None,
        worker_id: str | None = None,
        correlation_id: str | None = None,
        event_type: str | OrchestrationEventType | None = None,
        severity: str | AlertSeverity | None = None,
        start_time: datetime | None = None,
        end_time: datetime | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> tuple[list[OrchestrationEvent], int]:
        """
        Queries audit events scoped to a workspace with optional filters and pagination.
        """
        if site_id is not None:
            validate_tenant_site_boundary(db, tenant_id=workspace_id, site_id=site_id)

        query = select(OrchestrationEvent).where(OrchestrationEvent.workspace_id == workspace_id)

        if site_id is not None:
            query = query.where(OrchestrationEvent.site_id == site_id)
        if run_id:
            query = query.where(OrchestrationEvent.run_id == run_id)
        if stage_id:
            query = query.where(OrchestrationEvent.stage_id == stage_id)
        if job_id:
            query = query.where(OrchestrationEvent.job_id == job_id)
        if worker_id:
            query = query.where(OrchestrationEvent.worker_id == worker_id)
        if correlation_id:
            query = query.where(OrchestrationEvent.correlation_id == correlation_id)
        if event_type:
            evt_str = event_type.value if isinstance(event_type, OrchestrationEventType) else str(event_type)
            query = query.where(OrchestrationEvent.event_type == evt_str)
        if severity:
            sev_str = severity.value if isinstance(severity, AlertSeverity) else str(severity)
            query = query.where(OrchestrationEvent.severity == sev_str)
        if start_time:
            query = query.where(OrchestrationEvent.occurred_at >= start_time)
        if end_time:
            query = query.where(OrchestrationEvent.occurred_at <= end_time)

        # Count total matches
        count_query = select(func.count()).select_from(query.subquery())
        total = db.scalar(count_query) or 0

        # Paginate ordered descending by occurrence
        query = query.order_by(OrchestrationEvent.occurred_at.desc()).offset(offset).limit(limit)
        events = list(db.scalars(query).all())
        return events, total

    def get_event(self, db: Session, workspace_id: str, event_id: str) -> OrchestrationEvent | None:
        """
        Retrieves a single audit event, enforcing workspace ownership.
        """
        event = db.get(OrchestrationEvent, event_id)
        if not event or event.workspace_id != workspace_id:
            return None
        return event


class OperationalMetricsService:
    """
    Computes deterministic operational metrics across runs, stages, wait times,
    retries, worker recoveries, and freshness refreshes.
    """

    def compute_metrics(
        self,
        db: Session,
        workspace_id: str,
        *,
        site_id: int | None = None,
        start_time: datetime | None = None,
        end_time: datetime | None = None,
    ) -> dict[str, Any]:
        """
        Computes comprehensive operational metrics for the specified workspace/site in the given time window.
        """
        if site_id is not None:
            validate_tenant_site_boundary(db, tenant_id=workspace_id, site_id=site_id)

        now = _utc_now()
        if end_time is None:
            end_time = now
        if start_time is None:
            start_time = end_time - timedelta(hours=24)

        # 1. Run Counts and State Breakdown
        run_query = select(OrchestrationRun).where(
            and_(
                OrchestrationRun.workspace_id == workspace_id,
                OrchestrationRun.requested_at >= start_time,
                OrchestrationRun.requested_at <= end_time,
            )
        )
        if site_id is not None:
            run_query = run_query.where(OrchestrationRun.site_id == site_id)

        runs = list(db.scalars(run_query).all())

        run_counts: dict[str, int] = {
            "total": len(runs),
            "succeeded": 0,
            "partial": 0,
            "failed": 0,
            "cancelled": 0,
            "queued": 0,
            "active": 0,
            "retry_wait": 0,
            "paused": 0,
        }

        run_durations: list[float] = []
        queue_wait_times: list[float] = []

        for r in runs:
            if r.state == RunState.SUCCEEDED.value:
                run_counts["succeeded"] += 1
            elif r.state == RunState.PARTIAL.value:
                run_counts["partial"] += 1
            elif r.state == RunState.FAILED.value:
                run_counts["failed"] += 1
            elif r.state == RunState.CANCELLED.value:
                run_counts["cancelled"] += 1
            elif r.state == RunState.QUEUED.value:
                run_counts["queued"] += 1
            elif r.state == RunState.RETRY_WAIT.value:
                run_counts["retry_wait"] += 1
            elif r.state == RunState.PAUSED.value:
                run_counts["paused"] += 1
            else:
                run_counts["active"] += 1

            # Run duration
            if r.started_at and r.completed_at:
                dur = (r.completed_at - r.started_at).total_seconds()
                if dur >= 0:
                    run_durations.append(dur)

            # Queue wait time
            if r.started_at and r.requested_at:
                wait = (r.started_at - r.requested_at).total_seconds()
                if wait >= 0:
                    queue_wait_times.append(wait)

        run_duration_stats = {
            "min_seconds": round(min(run_durations), 2) if run_durations else None,
            "max_seconds": round(max(run_durations), 2) if run_durations else None,
            "avg_seconds": round(sum(run_durations) / len(run_durations), 2) if run_durations else 0.0,
            "p95_seconds": _percentile(run_durations, 95.0),
            "sample_count": len(run_durations),
        }

        queue_wait_stats = {
            "min_seconds": round(min(queue_wait_times), 2) if queue_wait_times else None,
            "max_seconds": round(max(queue_wait_times), 2) if queue_wait_times else None,
            "avg_seconds": round(sum(queue_wait_times) / len(queue_wait_times), 2) if queue_wait_times else 0.0,
            "p95_seconds": _percentile(queue_wait_times, 95.0),
            "sample_count": len(queue_wait_times),
        }

        # 2. Stage Metrics & Breakdown
        run_ids = [r.id for r in runs]
        stages: list[OrchestrationStage] = []
        if run_ids:
            stage_query = select(OrchestrationStage).where(OrchestrationStage.run_id.in_(run_ids))
            stages = list(db.scalars(stage_query).all())

        stage_durations_by_name: dict[str, list[float]] = {}
        all_stage_durations: list[float] = []
        total_retries = 0
        total_stage_failures = 0

        for s in stages:
            total_retries += s.attempt_count
            if s.state == StageState.FAILED.value:
                total_stage_failures += 1

            if s.started_at and s.completed_at:
                dur = (s.completed_at - s.started_at).total_seconds()
                if dur >= 0:
                    all_stage_durations.append(dur)
                    stage_durations_by_name.setdefault(s.stage_name, []).append(dur)

        stage_metrics_breakdown: dict[str, dict[str, Any]] = {}
        for s_name, d_list in stage_durations_by_name.items():
            stage_metrics_breakdown[s_name] = {
                "min_seconds": round(min(d_list), 2) if d_list else None,
                "max_seconds": round(max(d_list), 2) if d_list else None,
                "avg_seconds": round(sum(d_list) / len(d_list), 2) if d_list else 0.0,
                "p95_seconds": _percentile(d_list, 95.0),
                "count": len(d_list),
            }

        stage_duration_stats = {
            "min_seconds": round(min(all_stage_durations), 2) if all_stage_durations else None,
            "max_seconds": round(max(all_stage_durations), 2) if all_stage_durations else None,
            "avg_seconds": round(sum(all_stage_durations) / len(all_stage_durations), 2) if all_stage_durations else 0.0,
            "p95_seconds": _percentile(all_stage_durations, 95.0),
            "sample_count": len(all_stage_durations),
            "by_stage": stage_metrics_breakdown,
        }

        # 3. Checkpoint, Cancellation, Recovery, and Refresh Events
        event_query = select(OrchestrationEvent.event_type, func.count(OrchestrationEvent.id)).where(
            and_(
                OrchestrationEvent.workspace_id == workspace_id,
                OrchestrationEvent.occurred_at >= start_time,
                OrchestrationEvent.occurred_at <= end_time,
            )
        )
        if site_id is not None:
            event_query = event_query.where(OrchestrationEvent.site_id == site_id)
        event_query = event_query.group_by(OrchestrationEvent.event_type)
        event_counts = dict(db.execute(event_query).all())

        # Checkpoints in window
        checkpoint_query = select(func.count(OrchestrationCheckpoint.id)).where(
            and_(
                OrchestrationCheckpoint.workspace_id == workspace_id,
                OrchestrationCheckpoint.created_at >= start_time,
                OrchestrationCheckpoint.created_at <= end_time,
            )
        )
        if site_id is not None:
            checkpoint_query = checkpoint_query.where(OrchestrationCheckpoint.site_id == site_id)
        checkpoint_count = db.scalar(checkpoint_query) or 0

        # Cancellations in window
        cancellation_query = select(func.count(OrchestrationControlRequest.id)).where(
            and_(
                OrchestrationControlRequest.workspace_id == workspace_id,
                OrchestrationControlRequest.requested_at >= start_time,
                OrchestrationControlRequest.requested_at <= end_time,
            )
        )
        if site_id is not None:
            cancellation_query = cancellation_query.where(OrchestrationControlRequest.site_id == site_id)
        cancellation_count = db.scalar(cancellation_query) or 0

        # Worker recovery and stale lease counts
        worker_recovery_count = event_counts.get(OrchestrationEventType.WORKER_RECOVERED.value, 0)
        stale_lease_count = (
            event_counts.get(OrchestrationEventType.LEASE_EXPIRED.value, 0)
            + event_counts.get("LEASE_LOST", 0)
        )
        freshness_refresh_count = event_counts.get(OrchestrationEventType.REFRESH_COMPLETED.value, 0)

        return {
            "workspace_id": workspace_id,
            "site_id": site_id,
            "window": {
                "start_time": start_time.isoformat(),
                "end_time": end_time.isoformat(),
            },
            "run_counts": run_counts,
            "run_durations": run_duration_stats,
            "queue_wait_times": queue_wait_stats,
            "stage_metrics": stage_duration_stats,
            "total_retries": total_retries,
            "total_stage_failures": total_stage_failures,
            "total_run_failures": run_counts["failed"],
            "checkpoint_count": checkpoint_count,
            "cancellation_count": cancellation_count,
            "worker_recovery_count": worker_recovery_count,
            "stale_lease_count": stale_lease_count,
            "freshness_refresh_count": freshness_refresh_count,
        }
