"""
Production Orchestration & Monitoring - Persistent Alert Engine.

Provides deterministic alert generation, deduplication, occurrence tracking,
lifecycle management (OPEN -> ACKNOWLEDGED -> RESOLVED), and rule evaluation.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone, timedelta
from typing import Any

from sqlalchemy import and_, func, select
from sqlalchemy.orm import Session

from connectors.base.security import sanitize_payload
from .enums import (
    AlertSeverity,
    AlertStatus,
    AlertType,
    MonitoringStatus,
    OrchestrationEventType,
    ReceiptStatus,
    RunState,
    StageState,
)
from .exceptions import AlertNotFoundError, InvalidAlertTransitionError
from .models import (
    ExecutionReceipt,
    OrchestrationAlert,
    OrchestrationEvent,
    OrchestrationMonitoringObservation,
    OrchestrationRun,
    OrchestrationStage,
    Schedule,
    _utc_now,
)
from .observability import ObservabilityService
from .ports import validate_tenant_site_boundary


class AlertService:
    """
    Service managing persistent operational alerts with deterministic deduplication keys.
    """

    def __init__(self) -> None:
        self.observability = ObservabilityService()

    def build_deduplication_key(
        self,
        workspace_id: str,
        alert_type: str | AlertType,
        site_id: int | None = None,
        resource: str | None = None,
    ) -> str:
        """
        Generates a deterministic deduplication key for grouping repeat occurrences.
        Format: alert:{workspace_id}:{site_id or 'all'}:{alert_type}:{resource or 'general'}
        """
        a_type_val = alert_type.value if isinstance(alert_type, AlertType) else str(alert_type)
        s_part = str(site_id) if site_id is not None else "all"
        r_part = str(resource) if resource is not None else "general"
        return f"alert:{workspace_id}:{s_part}:{a_type_val}:{r_part}"

    def record_or_update_alert(
        self,
        db: Session,
        workspace_id: str,
        alert_type: str | AlertType,
        severity: str | AlertSeverity,
        summary: str,
        *,
        site_id: int | None = None,
        resource: str | None = None,
        source_run_id: str | None = None,
        source_job_id: str | None = None,
        source_stage_id: str | None = None,
        details: dict[str, Any] | None = None,
    ) -> OrchestrationAlert:
        """
        Records a new alert or updates an existing OPEN/ACKNOWLEDGED alert with matching deduplication key.
        """
        if site_id is not None:
            validate_tenant_site_boundary(db, tenant_id=workspace_id, site_id=site_id)

        clean_details = sanitize_payload(details or {})
        alert_type_val = alert_type.value if isinstance(alert_type, AlertType) else str(alert_type)
        severity_val = severity.value if isinstance(severity, AlertSeverity) else str(severity)
        dedup_key = self.build_deduplication_key(workspace_id, alert_type_val, site_id=site_id, resource=resource)

        now = _utc_now()

        # Check for existing active alert with same deduplication key
        active_query = select(OrchestrationAlert).where(
            and_(
                OrchestrationAlert.workspace_id == workspace_id,
                OrchestrationAlert.deduplication_key == dedup_key,
                OrchestrationAlert.status.in_([AlertStatus.OPEN.value, AlertStatus.ACKNOWLEDGED.value]),
            )
        )
        existing_alert = db.scalars(active_query).first()

        if existing_alert:
            existing_alert.occurrence_count += 1
            existing_alert.last_observed_at = now
            existing_alert.summary = summary
            # Merge latest details
            merged_details = dict(existing_alert.details or {})
            merged_details.update(clean_details)
            merged_details["last_occurrence_summary"] = summary
            existing_alert.details = merged_details

            # Escalate severity if new occurrence has higher severity
            severity_ranks = {
                AlertSeverity.INFO.value: 1,
                AlertSeverity.MEDIUM.value: 2,
                AlertSeverity.HIGH.value: 3,
                AlertSeverity.CRITICAL.value: 4,
            }
            if severity_ranks.get(severity_val, 1) > severity_ranks.get(existing_alert.severity, 1):
                existing_alert.severity = severity_val

            db.commit()
            db.refresh(existing_alert)

            # Emit audit event
            self.observability.record_event(
                db,
                workspace_id,
                OrchestrationEventType.ALERT_OPENED,
                site_id=site_id,
                run_id=source_run_id,
                stage_id=source_stage_id,
                job_id=source_job_id,
                severity=existing_alert.severity,
                details={
                    "alert_id": existing_alert.id,
                    "action": "occurrence_incremented",
                    "occurrence_count": existing_alert.occurrence_count,
                    "deduplication_key": dedup_key,
                },
            )
            return existing_alert

        # Create new alert
        new_alert = OrchestrationAlert(
            id=f"alt_{uuid.uuid4().hex[:16]}",
            workspace_id=workspace_id,
            site_id=site_id,
            alert_type=alert_type_val,
            severity=severity_val,
            status=AlertStatus.OPEN.value,
            summary=summary,
            deduplication_key=dedup_key,
            occurrence_count=1,
            source_run_id=source_run_id,
            source_job_id=source_job_id,
            source_stage_id=source_stage_id,
            details=clean_details,
            first_observed_at=now,
            last_observed_at=now,
            created_at=now,
        )
        db.add(new_alert)
        db.commit()
        db.refresh(new_alert)

        # Emit audit event
        self.observability.record_event(
            db,
            workspace_id,
            OrchestrationEventType.ALERT_OPENED,
            site_id=site_id,
            run_id=source_run_id,
            stage_id=source_stage_id,
            job_id=source_job_id,
            severity=severity_val,
            details={
                "alert_id": new_alert.id,
                "action": "created",
                "alert_type": alert_type_val,
                "summary": summary,
                "deduplication_key": dedup_key,
            },
        )
        return new_alert

    def acknowledge_alert(
        self,
        db: Session,
        workspace_id: str,
        alert_id: str,
        acknowledged_by: str,
    ) -> OrchestrationAlert:
        """
        Acknowledges an OPEN alert, recording who acknowledged it and when.
        """
        alert = db.get(OrchestrationAlert, alert_id)
        if not alert or alert.workspace_id != workspace_id:
            raise AlertNotFoundError(alert_id, workspace_id=workspace_id)

        if alert.status == AlertStatus.RESOLVED.value:
            raise InvalidAlertTransitionError(alert_id, alert.status, AlertStatus.ACKNOWLEDGED.value, "Cannot acknowledge an already resolved alert")

        alert.status = AlertStatus.ACKNOWLEDGED.value
        alert.acknowledged_at = _utc_now()
        alert.acknowledged_by = acknowledged_by
        db.commit()
        db.refresh(alert)

        # Emit audit event
        self.observability.record_event(
            db,
            workspace_id,
            OrchestrationEventType.ALERT_ACKNOWLEDGED,
            site_id=alert.site_id,
            run_id=alert.source_run_id,
            severity=AlertSeverity.INFO,
            details={"alert_id": alert.id, "acknowledged_by": acknowledged_by},
        )
        return alert

    def resolve_alert(
        self,
        db: Session,
        workspace_id: str,
        alert_id: str,
        resolved_by: str,
        resolution_reason: str,
        *,
        evidence: dict[str, Any] | None = None,
    ) -> OrchestrationAlert:
        """
        Resolves an OPEN or ACKNOWLEDGED alert with explanation and recovery evidence.
        """
        alert = db.get(OrchestrationAlert, alert_id)
        if not alert or alert.workspace_id != workspace_id:
            raise AlertNotFoundError(alert_id, workspace_id=workspace_id)

        now = _utc_now()
        alert.status = AlertStatus.RESOLVED.value
        alert.resolved_at = now
        alert.resolved_by = resolved_by
        alert.resolution_reason = resolution_reason
        if evidence:
            clean_ev = sanitize_payload(evidence)
            alert_details = dict(alert.details or {})
            alert_details["resolution_evidence"] = clean_ev
            alert.details = alert_details

        db.commit()
        db.refresh(alert)

        # Emit audit event
        self.observability.record_event(
            db,
            workspace_id,
            OrchestrationEventType.ALERT_RESOLVED,
            site_id=alert.site_id,
            run_id=alert.source_run_id,
            severity=AlertSeverity.INFO,
            details={
                "alert_id": alert.id,
                "resolved_by": resolved_by,
                "resolution_reason": resolution_reason,
            },
        )
        return alert

    def list_alerts(
        self,
        db: Session,
        workspace_id: str,
        *,
        site_id: int | None = None,
        status: str | AlertStatus | None = None,
        severity: str | AlertSeverity | None = None,
        alert_type: str | AlertType | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> tuple[list[OrchestrationAlert], int]:
        """
        Queries alerts scoped strictly to workspace with optional filters.
        """
        if site_id is not None:
            validate_tenant_site_boundary(db, tenant_id=workspace_id, site_id=site_id)

        query = select(OrchestrationAlert).where(OrchestrationAlert.workspace_id == workspace_id)

        if site_id is not None:
            query = query.where(OrchestrationAlert.site_id == site_id)
        if status:
            stat_val = status.value if isinstance(status, AlertStatus) else str(status)
            query = query.where(OrchestrationAlert.status == stat_val)
        if severity:
            sev_val = severity.value if isinstance(severity, AlertSeverity) else str(severity)
            query = query.where(OrchestrationAlert.severity == sev_val)
        if alert_type:
            type_val = alert_type.value if isinstance(alert_type, AlertType) else str(alert_type)
            query = query.where(OrchestrationAlert.alert_type == type_val)

        total_query = select(func.count()).select_from(query.subquery())
        total = db.scalar(total_query) or 0

        query = query.order_by(OrchestrationAlert.last_observed_at.desc()).offset(offset).limit(limit)
        alerts = list(db.scalars(query).all())
        return alerts, total

    def get_alert(self, db: Session, workspace_id: str, alert_id: str) -> OrchestrationAlert | None:
        """
        Retrieves a single alert, strictly enforcing tenant ownership.
        """
        alert = db.get(OrchestrationAlert, alert_id)
        if not alert or alert.workspace_id != workspace_id:
            return None
        return alert


class AlertRulesEngine:
    """
    Deterministic evaluation engine executing operational alert rules across
    runs, stages, queues, providers, freshness, and continuous monitoring.
    """

    def __init__(self, alert_service: AlertService | None = None) -> None:
        self.alert_service = alert_service or AlertService()

    def evaluate_rules(
        self,
        db: Session,
        workspace_id: str,
        *,
        site_id: int | None = None,
    ) -> list[OrchestrationAlert]:
        """
        Executes all deterministic operational alert rules and auto-resolves recovered conditions.
        """
        if site_id is not None:
            validate_tenant_site_boundary(db, tenant_id=workspace_id, site_id=site_id)

        now = _utc_now()
        generated_alerts: list[OrchestrationAlert] = []

        # ==========================================
        # CRITICAL RULE 1: Repeated Orchestration Failure
        # Trigger: >= 3 consecutive failed runs for a site in last 24h
        # NOTE: CANCELLED runs are NOT considered failures!
        # ==========================================
        run_query = select(OrchestrationRun).where(
            and_(
                OrchestrationRun.workspace_id == workspace_id,
                OrchestrationRun.requested_at >= (now - timedelta(hours=24)),
            )
        )
        if site_id is not None:
            run_query = run_query.where(OrchestrationRun.site_id == site_id)
        run_query = run_query.order_by(OrchestrationRun.requested_at.desc()).limit(10)
        recent_runs = list(db.scalars(run_query).all())

        terminal_runs = [r for r in recent_runs if r.state in (RunState.SUCCEEDED.value, RunState.PARTIAL.value, RunState.FAILED.value)]
        consecutive_failures = 0
        for r in terminal_runs:
            if r.state == RunState.FAILED.value:
                consecutive_failures += 1
            else:
                break

        if consecutive_failures >= 3:
            alert = self.alert_service.record_or_update_alert(
                db,
                workspace_id,
                AlertType.REPEATED_ORCHESTRATION_FAILURE,
                AlertSeverity.CRITICAL,
                f"Repeated orchestration run failure ({consecutive_failures} consecutive failures detected)",
                site_id=site_id,
                resource="run_orchestrator",
                details={"consecutive_failures": consecutive_failures, "latest_run_id": terminal_runs[0].id},
            )
            generated_alerts.append(alert)
        elif terminal_runs and terminal_runs[0].state == RunState.SUCCEEDED.value:
            # Auto-recovery: if latest run succeeded, resolve open repeated failure alerts
            self._auto_resolve_matching_alerts(
                db,
                workspace_id,
                AlertType.REPEATED_ORCHESTRATION_FAILURE,
                site_id=site_id,
                reason="Orchestration pipeline recovered: latest run completed successfully",
                evidence={"latest_run_id": terminal_runs[0].id, "state": terminal_runs[0].state},
            )

        # ==========================================
        # CRITICAL RULE 2: Unsafe Execution State (Ambiguous Receipts)
        # Trigger: Ambiguous receipt on mutation operations
        # ==========================================
        ambiguous_query = select(ExecutionReceipt).where(
            and_(
                ExecutionReceipt.workspace_id == workspace_id,
                ExecutionReceipt.status == ReceiptStatus.AMBIGUOUS.value,
                ExecutionReceipt.created_at >= (now - timedelta(hours=24)),
            )
        )
        if site_id is not None:
            ambiguous_query = ambiguous_query.where(ExecutionReceipt.site_id == site_id)
        ambiguous_receipts = list(db.scalars(ambiguous_query).all())

        if ambiguous_receipts:
            alert = self.alert_service.record_or_update_alert(
                db,
                workspace_id,
                AlertType.UNSAFE_EXECUTION_STATE,
                AlertSeverity.CRITICAL,
                f"Unsafe execution state: {len(ambiguous_receipts)} ambiguous mutation receipt(s) detected",
                site_id=site_id,
                resource="mutation_guard",
                details={"ambiguous_receipt_ids": [r.id for r in ambiguous_receipts[:5]]},
            )
            generated_alerts.append(alert)

        # ==========================================
        # HIGH RULE 1: Provider Authentication Failure
        # Trigger: Receipt with auth failure error in last 6h
        # ==========================================
        receipt_query = select(ExecutionReceipt).where(
            and_(
                ExecutionReceipt.workspace_id == workspace_id,
                ExecutionReceipt.status.in_([ReceiptStatus.FAILED.value, ReceiptStatus.AMBIGUOUS.value]),
                ExecutionReceipt.created_at >= (now - timedelta(hours=6)),
            )
        )
        if site_id is not None:
            receipt_query = receipt_query.where(ExecutionReceipt.site_id == site_id)
        failed_receipts = list(db.scalars(receipt_query).all())

        auth_failed_providers: set[str] = set()
        for r in failed_receipts:
            err_str = str((r.details or {}).get("error", "")).lower()
            if "auth" in err_str or "unauthorized" in err_str or "forbidden" in err_str:
                p_name = (r.details or {}).get("provider_name") or (r.details or {}).get("provider") or r.operation_type or "unknown_provider"
                auth_failed_providers.add(p_name)

        for provider in auth_failed_providers:
            alert = self.alert_service.record_or_update_alert(
                db,
                workspace_id,
                AlertType.PROVIDER_AUTHENTICATION_FAILURE,
                AlertSeverity.HIGH,
                f"Provider authentication failure detected for '{provider}'",
                site_id=site_id,
                resource=provider,
                details={"provider": provider},
            )
            generated_alerts.append(alert)

        # ==========================================
        # MEDIUM RULE 1: Persistent Stale Evidence
        # Trigger: Continuous monitoring observation with status STALE or CRITICAL
        # ==========================================
        obs_query = select(OrchestrationMonitoringObservation).where(
            and_(
                OrchestrationMonitoringObservation.workspace_id == workspace_id,
                OrchestrationMonitoringObservation.monitoring_type == "EVIDENCE_FRESHNESS",
                OrchestrationMonitoringObservation.observed_at >= (now - timedelta(hours=24)),
            )
        ).order_by(OrchestrationMonitoringObservation.observed_at.desc())
        if site_id is not None:
            obs_query = obs_query.where(OrchestrationMonitoringObservation.site_id == site_id)
        latest_freshness = db.scalars(obs_query).first()

        if latest_freshness and latest_freshness.status in (MonitoringStatus.STALE.value, MonitoringStatus.CRITICAL.value):
            sev = AlertSeverity.HIGH if latest_freshness.status == MonitoringStatus.CRITICAL.value else AlertSeverity.MEDIUM
            alert = self.alert_service.record_or_update_alert(
                db,
                workspace_id,
                AlertType.STALE_EVIDENCE_PERSISTENT,
                sev,
                f"Persistent stale evidence detected: {latest_freshness.summary}",
                site_id=site_id,
                resource="evidence_freshness",
                details=latest_freshness.details,
            )
            generated_alerts.append(alert)
        elif latest_freshness and latest_freshness.status == MonitoringStatus.HEALTHY.value:
            # Auto-resolve stale evidence alert when fresh
            self._auto_resolve_matching_alerts(
                db,
                workspace_id,
                AlertType.STALE_EVIDENCE_PERSISTENT,
                site_id=site_id,
                reason="Freshness restored: latest observation indicates evidence is fresh",
                evidence=latest_freshness.details,
            )

        # ==========================================
        # MEDIUM RULE 2: Schedule Missed
        # Trigger: Active schedule overdue by > 30 minutes
        # ==========================================
        sched_query = select(Schedule).where(
            and_(
                Schedule.workspace_id == workspace_id,
                Schedule.status == "active",
                Schedule.next_run_at <= (now - timedelta(minutes=30)),
            )
        )
        if site_id is not None:
            sched_query = sched_query.where(Schedule.site_id == site_id)
        overdue_schedules = list(db.scalars(sched_query).all())

        for s in overdue_schedules:
            alert = self.alert_service.record_or_update_alert(
                db,
                workspace_id,
                AlertType.SCHEDULE_MISSED,
                AlertSeverity.MEDIUM,
                f"Schedule '{s.name}' ({s.id}) missed execution window by >30m",
                site_id=site_id,
                resource=s.id,
                details={"schedule_id": s.id, "next_run_at": s.next_run_at.isoformat() if s.next_run_at else None},
            )
            generated_alerts.append(alert)

        return generated_alerts

    def _auto_resolve_matching_alerts(
        self,
        db: Session,
        workspace_id: str,
        alert_type: AlertType,
        *,
        site_id: int | None = None,
        reason: str,
        evidence: dict[str, Any] | None = None,
    ) -> None:
        """
        Auto-resolves open alerts of a given type when recovery evidence is detected.
        """
        query = select(OrchestrationAlert).where(
            and_(
                OrchestrationAlert.workspace_id == workspace_id,
                OrchestrationAlert.alert_type == alert_type.value,
                OrchestrationAlert.status.in_([AlertStatus.OPEN.value, AlertStatus.ACKNOWLEDGED.value]),
            )
        )
        if site_id is not None:
            query = query.where(OrchestrationAlert.site_id == site_id)

        open_alerts = list(db.scalars(query).all())
        for a in open_alerts:
            self.alert_service.resolve_alert(
                db,
                workspace_id,
                a.id,
                resolved_by="system_auto_recovery",
                resolution_reason=reason,
                evidence=evidence,
            )
