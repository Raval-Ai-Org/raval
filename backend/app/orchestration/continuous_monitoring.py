"""
Production Orchestration & Monitoring - Continuous Monitoring Service.

Provides deterministic operational health tracking across 9 core pipeline areas:
Crawl, Analysis, Evidence Freshness, AI Visibility, Validation, Fix Execution,
Provider Health, Scheduler, and Queue/Worker Health.
"""

from __future__ import annotations

from datetime import datetime, timezone
import logging
from typing import Any
from uuid import uuid4

from sqlalchemy import desc
from sqlalchemy.orm import Session

from ..models import AIMonitoringRun, Scan, ValidationResult, Website
from .enums import (
    EvidenceType,
    FreshnessState,
    MonitoringSeverity,
    MonitoringStatus,
    MonitoringType,
    OrchestrationEventType,
    ReceiptStatus,
    ScheduleStatus,
)
from .exceptions import SiteMismatchError, TenantMismatchError
from .freshness_evaluator import FreshnessEvaluation, FreshnessEvaluator
from .models import (
    ExecutionReceipt,
    OrchestrationEvent,
    OrchestrationMonitoringObservation,
    Schedule,
)

logger = logging.getLogger(__name__)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _ensure_utc(dt: datetime | str) -> datetime:
    if isinstance(dt, str):
        try:
            dt = datetime.fromisoformat(dt)
        except Exception:
            dt = datetime.fromisoformat(dt.replace("Z", "+00:00"))
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


class ContinuousMonitoringService:
    """
    Evaluates and records operational health across platform pipeline domains.
    Guarantees strict tenant and site isolation and generates traceable observation records.
    """

    # ==========================================================================
    # 1. Crawl Health Evaluation
    # ==========================================================================

    @staticmethod
    def evaluate_crawl_health(
        workspace_id: str,
        site_id: int,
        db: Session,
        now: datetime | None = None,
    ) -> OrchestrationMonitoringObservation:
        curr_now = _ensure_utc(now) if now else _utc_now()

        # Query latest scan for site
        latest_scan = (
            db.query(Scan)
            .filter(Scan.website_id == site_id)
            .order_by(desc(Scan.id))
            .first()
        )

        if not latest_scan:
            return OrchestrationMonitoringObservation(
                workspace_id=workspace_id,
                site_id=site_id,
                monitoring_type=MonitoringType.CRAWL_HEALTH.value,
                status=MonitoringStatus.UNKNOWN.value,
                severity=MonitoringSeverity.INFO.value,
                observed_at=curr_now,
                summary=f"No scan history observed for site {site_id}",
                details={"scan_count": 0},
            )

        status_lower = (latest_scan.status or "").lower()
        if status_lower in ("failed", "error"):
            return OrchestrationMonitoringObservation(
                workspace_id=workspace_id,
                site_id=site_id,
                monitoring_type=MonitoringType.CRAWL_HEALTH.value,
                status=MonitoringStatus.FAILING.value,
                severity=MonitoringSeverity.HIGH.value,
                observed_at=curr_now,
                summary=f"Latest crawl for site {site_id} (Scan #{latest_scan.id}) failed",
                details={
                    "scan_id": latest_scan.id,
                    "scan_status": latest_scan.status,
                    "completed_at": latest_scan.completed_at.isoformat() if latest_scan.completed_at else None,
                },
            )

        # Check age of successful crawl
        scan_time = _ensure_utc(latest_scan.completed_at or latest_scan.created_at)
        age_seconds = (curr_now - scan_time).total_seconds()

        if age_seconds > 172800:  # > 48h
            return OrchestrationMonitoringObservation(
                workspace_id=workspace_id,
                site_id=site_id,
                monitoring_type=MonitoringType.CRAWL_HEALTH.value,
                status=MonitoringStatus.STALE.value,
                severity=MonitoringSeverity.MEDIUM.value,
                observed_at=curr_now,
                summary=f"Crawl for site {site_id} is stale (age: {int(age_seconds / 3600)}h)",
                details={"scan_id": latest_scan.id, "age_seconds": age_seconds},
            )

        return OrchestrationMonitoringObservation(
            workspace_id=workspace_id,
            site_id=site_id,
            monitoring_type=MonitoringType.CRAWL_HEALTH.value,
            status=MonitoringStatus.HEALTHY.value,
            severity=MonitoringSeverity.INFO.value,
            observed_at=curr_now,
            summary=f"Crawl for site {site_id} is healthy (Scan #{latest_scan.id})",
            details={"scan_id": latest_scan.id, "age_seconds": age_seconds},
        )

    # ==========================================================================
    # 2. Analysis Health Evaluation
    # ==========================================================================

    @staticmethod
    def evaluate_analysis_health(
        workspace_id: str,
        site_id: int,
        db: Session,
        now: datetime | None = None,
    ) -> OrchestrationMonitoringObservation:
        curr_now = _ensure_utc(now) if now else _utc_now()

        # Check recent scans for missing page extraction or analysis completion
        recent_scans = (
            db.query(Scan)
            .filter(Scan.website_id == site_id)
            .order_by(desc(Scan.id))
            .limit(5)
            .all()
        )

        if not recent_scans:
            return OrchestrationMonitoringObservation(
                workspace_id=workspace_id,
                site_id=site_id,
                monitoring_type=MonitoringType.ANALYSIS_HEALTH.value,
                status=MonitoringStatus.UNKNOWN.value,
                severity=MonitoringSeverity.INFO.value,
                observed_at=curr_now,
                summary=f"No scans available to evaluate analysis health for site {site_id}",
                details={},
            )

        unanalyzed = [s.id for s in recent_scans if (s.status or "").lower() == "crawled" and not s.completed_at]
        if unanalyzed:
            return OrchestrationMonitoringObservation(
                workspace_id=workspace_id,
                site_id=site_id,
                monitoring_type=MonitoringType.ANALYSIS_HEALTH.value,
                status=MonitoringStatus.DEGRADED.value,
                severity=MonitoringSeverity.MEDIUM.value,
                observed_at=curr_now,
                summary=f"{len(unanalyzed)} crawl(s) pending signal analysis for site {site_id}",
                details={"pending_scan_ids": unanalyzed},
            )

        return OrchestrationMonitoringObservation(
            workspace_id=workspace_id,
            site_id=site_id,
            monitoring_type=MonitoringType.ANALYSIS_HEALTH.value,
            status=MonitoringStatus.HEALTHY.value,
            severity=MonitoringSeverity.INFO.value,
            observed_at=curr_now,
            summary=f"Analysis pipeline is healthy for site {site_id}",
            details={"evaluated_scans_count": len(recent_scans)},
        )

    # ==========================================================================
    # 3. Evidence Freshness Aggregation
    # ==========================================================================

    @staticmethod
    def evaluate_evidence_freshness(
        workspace_id: str,
        site_id: int | None,
        evaluations: list[FreshnessEvaluation],
        now: datetime | None = None,
    ) -> OrchestrationMonitoringObservation:
        curr_now = _ensure_utc(now) if now else _utc_now()

        if not evaluations:
            return OrchestrationMonitoringObservation(
                workspace_id=workspace_id,
                site_id=site_id,
                monitoring_type=MonitoringType.EVIDENCE_FRESHNESS.value,
                status=MonitoringStatus.UNKNOWN.value,
                severity=MonitoringSeverity.INFO.value,
                observed_at=curr_now,
                summary="No evidence categories evaluated",
                details={"evaluated_count": 0},
            )

        counts = {
            FreshnessState.FRESH: 0,
            FreshnessState.AGING: 0,
            FreshnessState.STALE: 0,
            FreshnessState.EXPIRED: 0,
            FreshnessState.UNKNOWN: 0,
            FreshnessState.REFRESHING: 0,
            FreshnessState.UNAVAILABLE: 0,
        }
        for ev in evaluations:
            counts[ev.freshness_state] = counts.get(ev.freshness_state, 0) + 1

        details = {k.value: v for k, v in counts.items()}
        details["total_categories"] = len(evaluations)

        if counts[FreshnessState.UNAVAILABLE] > 0:
            status = MonitoringStatus.DEGRADED
            severity = MonitoringSeverity.HIGH
            summary = f"{counts[FreshnessState.UNAVAILABLE]} evidence categories unavailable due to provider outages"
        elif counts[FreshnessState.EXPIRED] > 0:
            status = MonitoringStatus.CRITICAL
            severity = MonitoringSeverity.HIGH
            summary = f"{counts[FreshnessState.EXPIRED]} evidence categories expired beyond tolerance"
        elif counts[FreshnessState.STALE] > 0:
            status = MonitoringStatus.STALE
            severity = MonitoringSeverity.MEDIUM
            summary = f"{counts[FreshnessState.STALE]} evidence categories stale and awaiting refresh"
        elif counts[FreshnessState.AGING] > 0:
            status = MonitoringStatus.DEGRADED
            severity = MonitoringSeverity.LOW
            summary = f"{counts[FreshnessState.AGING]} evidence categories aging"
        else:
            status = MonitoringStatus.HEALTHY
            severity = MonitoringSeverity.INFO
            summary = "All evaluated evidence categories are fresh"

        return OrchestrationMonitoringObservation(
            workspace_id=workspace_id,
            site_id=site_id,
            monitoring_type=MonitoringType.EVIDENCE_FRESHNESS.value,
            status=status.value,
            severity=severity.value,
            observed_at=curr_now,
            summary=summary,
            details=details,
        )

    # ==========================================================================
    # 4. AI Visibility Monitoring
    # ==========================================================================

    @staticmethod
    def evaluate_ai_visibility_monitoring(
        workspace_id: str,
        site_id: int,
        db: Session,
        provider_healthy: bool = True,
        now: datetime | None = None,
    ) -> OrchestrationMonitoringObservation:
        curr_now = _ensure_utc(now) if now else _utc_now()

        if not provider_healthy:
            return OrchestrationMonitoringObservation(
                workspace_id=workspace_id,
                site_id=site_id,
                monitoring_type=MonitoringType.AI_VISIBILITY_MONITORING.value,
                status=MonitoringStatus.FAILING.value,
                severity=MonitoringSeverity.HIGH.value,
                observed_at=curr_now,
                summary=f"AI engine provider is reporting outages or errors for site {site_id}",
                details={"provider_healthy": False},
            )

        latest_run = (
            db.query(AIMonitoringRun)
            .filter(AIMonitoringRun.website_id == site_id)
            .order_by(desc(AIMonitoringRun.id))
            .first()
        )

        if not latest_run:
            return OrchestrationMonitoringObservation(
                workspace_id=workspace_id,
                site_id=site_id,
                monitoring_type=MonitoringType.AI_VISIBILITY_MONITORING.value,
                status=MonitoringStatus.UNKNOWN.value,
                severity=MonitoringSeverity.INFO.value,
                observed_at=curr_now,
                summary=f"No AI visibility monitoring runs found for site {site_id}",
                details={},
            )

        if (latest_run.status or "").upper() == "FAILED":
            return OrchestrationMonitoringObservation(
                workspace_id=workspace_id,
                site_id=site_id,
                monitoring_type=MonitoringType.AI_VISIBILITY_MONITORING.value,
                status=MonitoringStatus.FAILING.value,
                severity=MonitoringSeverity.HIGH.value,
                observed_at=curr_now,
                summary=f"Latest AI visibility run #{latest_run.id} failed",
                details={"ai_run_id": latest_run.id, "provider": latest_run.provider},
            )

        run_time = _ensure_utc(latest_run.completed_at or latest_run.created_at)
        age_seconds = (curr_now - run_time).total_seconds()

        if age_seconds > 43200:  # > 12h
            return OrchestrationMonitoringObservation(
                workspace_id=workspace_id,
                site_id=site_id,
                monitoring_type=MonitoringType.AI_VISIBILITY_MONITORING.value,
                status=MonitoringStatus.STALE.value,
                severity=MonitoringSeverity.MEDIUM.value,
                observed_at=curr_now,
                summary=f"AI visibility observation for site {site_id} is stale ({int(age_seconds / 3600)}h old)",
                details={"ai_run_id": latest_run.id, "age_seconds": age_seconds},
            )

        return OrchestrationMonitoringObservation(
            workspace_id=workspace_id,
            site_id=site_id,
            monitoring_type=MonitoringType.AI_VISIBILITY_MONITORING.value,
            status=MonitoringStatus.HEALTHY.value,
            severity=MonitoringSeverity.INFO.value,
            observed_at=curr_now,
            summary=f"AI visibility observations healthy for site {site_id} (Run #{latest_run.id})",
            details={"ai_run_id": latest_run.id, "age_seconds": age_seconds, "provider": latest_run.provider},
        )

    # ==========================================================================
    # 5. Validation Health
    # ==========================================================================

    @staticmethod
    def evaluate_validation_health(
        workspace_id: str,
        site_id: int,
        db: Session,
        now: datetime | None = None,
    ) -> OrchestrationMonitoringObservation:
        curr_now = _ensure_utc(now) if now else _utc_now()

        validations = (
            db.query(ValidationResult)
            .filter(ValidationResult.website_id == site_id)
            .order_by(desc(ValidationResult.id))
            .limit(10)
            .all()
        )

        if not validations:
            return OrchestrationMonitoringObservation(
                workspace_id=workspace_id,
                site_id=site_id,
                monitoring_type=MonitoringType.VALIDATION_HEALTH.value,
                status=MonitoringStatus.UNKNOWN.value,
                severity=MonitoringSeverity.INFO.value,
                observed_at=curr_now,
                summary=f"No validation results recorded for site {site_id}",
                details={},
            )

        passed = sum(1 for v in validations if (v.status or "").lower() in ("passed", "pass", "success"))
        total = len(validations)
        pass_rate = passed / total if total > 0 else 1.0

        if pass_rate < 0.50:
            status = MonitoringStatus.CRITICAL
            severity = MonitoringSeverity.CRITICAL
            summary = f"Validation pass rate critical ({int(pass_rate * 100)}%) for site {site_id}"
        elif pass_rate < 0.80:
            status = MonitoringStatus.DEGRADED
            severity = MonitoringSeverity.MEDIUM
            summary = f"Validation pass rate degraded ({int(pass_rate * 100)}%) for site {site_id}"
        else:
            status = MonitoringStatus.HEALTHY
            severity = MonitoringSeverity.INFO
            summary = f"Validation health satisfactory ({int(pass_rate * 100)}% pass rate)"

        return OrchestrationMonitoringObservation(
            workspace_id=workspace_id,
            site_id=site_id,
            monitoring_type=MonitoringType.VALIDATION_HEALTH.value,
            status=status.value,
            severity=severity.value,
            observed_at=curr_now,
            summary=summary,
            details={"sample_size": total, "passed_count": passed, "pass_rate": round(pass_rate, 2)},
        )

    # ==========================================================================
    # 6. Fix Execution Health
    # ==========================================================================

    @staticmethod
    def evaluate_fix_execution_health(
        workspace_id: str,
        site_id: int,
        db: Session,
        now: datetime | None = None,
    ) -> OrchestrationMonitoringObservation:
        curr_now = _ensure_utc(now) if now else _utc_now()

        receipts = (
            db.query(ExecutionReceipt)
            .filter(
                ExecutionReceipt.workspace_id == workspace_id,
                ExecutionReceipt.site_id == site_id,
            )
            .order_by(desc(ExecutionReceipt.created_at))
            .limit(20)
            .all()
        )

        if not receipts:
            return OrchestrationMonitoringObservation(
                workspace_id=workspace_id,
                site_id=site_id,
                monitoring_type=MonitoringType.FIX_EXECUTION_HEALTH.value,
                status=MonitoringStatus.HEALTHY.value,
                severity=MonitoringSeverity.INFO.value,
                observed_at=curr_now,
                summary=f"No external execution receipts recorded for site {site_id}",
                details={"receipt_count": 0},
            )

        ambiguous = [r.id for r in receipts if r.status == ReceiptStatus.AMBIGUOUS.value]
        if ambiguous:
            return OrchestrationMonitoringObservation(
                workspace_id=workspace_id,
                site_id=site_id,
                monitoring_type=MonitoringType.FIX_EXECUTION_HEALTH.value,
                status=MonitoringStatus.CRITICAL.value,
                severity=MonitoringSeverity.CRITICAL.value,
                observed_at=curr_now,
                summary=f"CRITICAL: {len(ambiguous)} ambiguous external mutation(s) require manual operator review",
                details={"ambiguous_receipt_ids": ambiguous},
            )

        failed = [r.id for r in receipts if r.status == ReceiptStatus.FAILED.value]
        if failed:
            return OrchestrationMonitoringObservation(
                workspace_id=workspace_id,
                site_id=site_id,
                monitoring_type=MonitoringType.FIX_EXECUTION_HEALTH.value,
                status=MonitoringStatus.DEGRADED.value,
                severity=MonitoringSeverity.HIGH.value,
                observed_at=curr_now,
                summary=f"{len(failed)} execution mutations failed recently on site {site_id}",
                details={"failed_receipt_ids": failed},
            )

        return OrchestrationMonitoringObservation(
            workspace_id=workspace_id,
            site_id=site_id,
            monitoring_type=MonitoringType.FIX_EXECUTION_HEALTH.value,
            status=MonitoringStatus.HEALTHY.value,
            severity=MonitoringSeverity.INFO.value,
            observed_at=curr_now,
            summary=f"Fix execution health is nominal for site {site_id}",
            details={"evaluated_receipts": len(receipts)},
        )

    # ==========================================================================
    # 7. Provider Health
    # ==========================================================================

    @staticmethod
    def evaluate_provider_health(
        workspace_id: str,
        site_id: int | None,
        provider: str,
        is_reachable: bool = True,
        is_rate_limited: bool = False,
        error_rate: float = 0.0,
        now: datetime | None = None,
    ) -> OrchestrationMonitoringObservation:
        curr_now = _ensure_utc(now) if now else _utc_now()

        if not is_reachable:
            return OrchestrationMonitoringObservation(
                workspace_id=workspace_id,
                site_id=site_id,
                monitoring_type=MonitoringType.PROVIDER_HEALTH.value,
                status=MonitoringStatus.CRITICAL.value,
                severity=MonitoringSeverity.CRITICAL.value,
                observed_at=curr_now,
                summary=f"Provider '{provider}' is unreachable or down",
                details={"provider": provider, "reachable": False},
            )

        if is_rate_limited:
            return OrchestrationMonitoringObservation(
                workspace_id=workspace_id,
                site_id=site_id,
                monitoring_type=MonitoringType.PROVIDER_HEALTH.value,
                status=MonitoringStatus.DEGRADED.value,
                severity=MonitoringSeverity.MEDIUM.value,
                observed_at=curr_now,
                summary=f"Provider '{provider}' is enforcing rate limits",
                details={"provider": provider, "rate_limited": True},
            )

        if error_rate > 0.20:
            return OrchestrationMonitoringObservation(
                workspace_id=workspace_id,
                site_id=site_id,
                monitoring_type=MonitoringType.PROVIDER_HEALTH.value,
                status=MonitoringStatus.FAILING.value,
                severity=MonitoringSeverity.HIGH.value,
                observed_at=curr_now,
                summary=f"Provider '{provider}' elevated error rate: {int(error_rate * 100)}%",
                details={"provider": provider, "error_rate": error_rate},
            )

        return OrchestrationMonitoringObservation(
            workspace_id=workspace_id,
            site_id=site_id,
            monitoring_type=MonitoringType.PROVIDER_HEALTH.value,
            status=MonitoringStatus.HEALTHY.value,
            severity=MonitoringSeverity.INFO.value,
            observed_at=curr_now,
            summary=f"Provider '{provider}' health nominal",
            details={"provider": provider, "error_rate": error_rate},
        )

    # ==========================================================================
    # 8. Schedule Health
    # ==========================================================================

    @staticmethod
    def evaluate_schedule_health(
        workspace_id: str,
        site_id: int | None,
        db: Session,
        now: datetime | None = None,
    ) -> OrchestrationMonitoringObservation:
        curr_now = _ensure_utc(now) if now else _utc_now()

        q = db.query(Schedule).filter(Schedule.workspace_id == workspace_id)
        if site_id is not None:
            q = q.filter(Schedule.site_id == site_id)
        schedules = q.all()

        if not schedules:
            return OrchestrationMonitoringObservation(
                workspace_id=workspace_id,
                site_id=site_id,
                monitoring_type=MonitoringType.SCHEDULE_HEALTH.value,
                status=MonitoringStatus.HEALTHY.value,
                severity=MonitoringSeverity.INFO.value,
                observed_at=curr_now,
                summary=f"No schedules configured for workspace '{workspace_id}'",
                details={"schedule_count": 0},
            )

        active = [s for s in schedules if s.status == ScheduleStatus.ACTIVE.value]
        # Check missed runs: next_run_at overdue by > 1 hour
        missed = [
            s.id
            for s in active
            if s.next_run_at and (curr_now - _ensure_utc(s.next_run_at)).total_seconds() > 3600
        ]

        if missed:
            return OrchestrationMonitoringObservation(
                workspace_id=workspace_id,
                site_id=site_id,
                monitoring_type=MonitoringType.SCHEDULE_HEALTH.value,
                status=MonitoringStatus.DEGRADED.value,
                severity=MonitoringSeverity.HIGH.value,
                observed_at=curr_now,
                summary=f"{len(missed)} schedule(s) missed execution windows (>1h overdue)",
                details={"missed_schedule_ids": missed},
            )

        return OrchestrationMonitoringObservation(
            workspace_id=workspace_id,
            site_id=site_id,
            monitoring_type=MonitoringType.SCHEDULE_HEALTH.value,
            status=MonitoringStatus.HEALTHY.value,
            severity=MonitoringSeverity.INFO.value,
            observed_at=curr_now,
            summary=f"All {len(active)} active schedule(s) are timely and healthy",
            details={"active_schedules_count": len(active)},
        )

    # ==========================================================================
    # 9. Queue & Worker Health
    # ==========================================================================

    @staticmethod
    def evaluate_queue_worker_health(
        workspace_id: str,
        site_id: int | None,
        queue_depth: int = 0,
        stale_lease_count: int = 0,
        active_workers: int = 1,
        capacity_saturated: bool = False,
        now: datetime | None = None,
    ) -> OrchestrationMonitoringObservation:
        curr_now = _ensure_utc(now) if now else _utc_now()

        if stale_lease_count > 0:
            return OrchestrationMonitoringObservation(
                workspace_id=workspace_id,
                site_id=site_id,
                monitoring_type=MonitoringType.QUEUE_WORKER_HEALTH.value,
                status=MonitoringStatus.FAILING.value,
                severity=MonitoringSeverity.HIGH.value,
                observed_at=curr_now,
                summary=f"{stale_lease_count} stale worker lease(s) detected without heartbeat",
                details={
                    "stale_lease_count": stale_lease_count,
                    "queue_depth": queue_depth,
                    "active_workers": active_workers,
                },
            )

        if capacity_saturated:
            return OrchestrationMonitoringObservation(
                workspace_id=workspace_id,
                site_id=site_id,
                monitoring_type=MonitoringType.QUEUE_WORKER_HEALTH.value,
                status=MonitoringStatus.DEGRADED.value,
                severity=MonitoringSeverity.MEDIUM.value,
                observed_at=curr_now,
                summary="Concurrency capacity is saturated; backpressure applied",
                details={"capacity_saturated": True, "queue_depth": queue_depth},
            )

        if queue_depth > 100:
            return OrchestrationMonitoringObservation(
                workspace_id=workspace_id,
                site_id=site_id,
                monitoring_type=MonitoringType.QUEUE_WORKER_HEALTH.value,
                status=MonitoringStatus.DEGRADED.value,
                severity=MonitoringSeverity.MEDIUM.value,
                observed_at=curr_now,
                summary=f"Queue backlog is high ({queue_depth} jobs queued)",
                details={"queue_depth": queue_depth, "active_workers": active_workers},
            )

        return OrchestrationMonitoringObservation(
            workspace_id=workspace_id,
            site_id=site_id,
            monitoring_type=MonitoringType.QUEUE_WORKER_HEALTH.value,
            status=MonitoringStatus.HEALTHY.value,
            severity=MonitoringSeverity.INFO.value,
            observed_at=curr_now,
            summary="Queue and worker health nominal",
            details={
                "queue_depth": queue_depth,
                "stale_lease_count": 0,
                "active_workers": active_workers,
                "capacity_saturated": False,
            },
        )

    # ==========================================================================
    # Persistence & Audit Trail
    # ==========================================================================

    @classmethod
    def record_observation(
        cls,
        *args: Any,
        **kwargs: Any,
    ) -> OrchestrationMonitoringObservation:
        """
        Persists a monitoring observation and logs an immutable audit event.
        Supports:
          record_observation(observation, db)
          record_observation(db, tenant_id=..., site_id=..., monitoring_type=..., status=..., severity=..., ...)
        """
        if args and isinstance(args[0], OrchestrationMonitoringObservation):
            observation = args[0]
            db = args[1] if len(args) > 1 else kwargs["db"]
        elif args and isinstance(args[0], Session):
            db = args[0]
            if len(args) > 1 and isinstance(args[1], OrchestrationMonitoringObservation):
                observation = args[1]
            elif "observation" in kwargs and isinstance(kwargs["observation"], OrchestrationMonitoringObservation):
                observation = kwargs["observation"]
            else:
                ws = kwargs.get("tenant_id") or kwargs.get("workspace_id") or "default"
                stype = kwargs.get("monitoring_type")
            if hasattr(stype, "value"):
                stype = stype.value
            sstatus = kwargs.get("status")
            if hasattr(sstatus, "value"):
                sstatus = sstatus.value
            sseverity = kwargs.get("severity")
            if hasattr(sseverity, "value"):
                sseverity = sseverity.value
            elif str(sseverity).lower() in ("warning", "warn"):
                sseverity = MonitoringSeverity.MEDIUM.value
            summary = kwargs.get("summary") or kwargs.get("message") or f"{stype} observation"
            details = kwargs.get("details") or {}
            if "metric_name" in kwargs:
                details["metric_name"] = kwargs["metric_name"]
            if "metric_value" in kwargs:
                details["metric_value"] = kwargs["metric_value"]
            if "threshold_value" in kwargs:
                details["threshold_value"] = kwargs["threshold_value"]
            observed_at = kwargs.get("observed_at") or _utc_now()
            observation = OrchestrationMonitoringObservation(
                workspace_id=ws,
                site_id=kwargs.get("site_id"),
                monitoring_type=stype,
                status=sstatus,
                severity=sseverity or MonitoringSeverity.INFO.value,
                observed_at=observed_at,
                source_run_id=kwargs.get("source_run_id"),
                source_job_id=kwargs.get("source_job_id"),
                summary=summary,
                details=details,
            )
        else:
            raise ValueError("Invalid arguments to record_observation")

        db.add(observation)
        db.commit()
        db.refresh(observation)

        if observation.source_run_id:
            try:
                event = OrchestrationEvent(
                    id=f"evt_{uuid4().hex[:16]}",
                    run_id=observation.source_run_id,
                    stage_id=None,
                    workspace_id=observation.workspace_id,
                    site_id=observation.site_id,
                    event_type=OrchestrationEventType.MONITORING_STATUS_CHANGED.value,
                    from_state=None,
                    to_state=observation.status,
                    details={
                        "observation_id": observation.id,
                        "monitoring_type": observation.monitoring_type,
                        "severity": observation.severity,
                        "summary": observation.summary,
                    },
                    occurred_at=_utc_now(),
                )
                db.add(event)
                db.commit()
            except Exception as exc:
                logger.warning("Failed to record OrchestrationEvent for observation: %s", exc)
                db.rollback()

        logger.info(
            "Recorded monitoring observation #%d for workspace='%s' (type='%s', status='%s', severity='%s')",
            observation.id,
            observation.workspace_id,
            observation.monitoring_type,
            observation.status,
            observation.severity,
        )
        return observation

    def get_latest_status(
        self,
        workspace_id: str,
        site_id: int | None,
        db: Session,
    ) -> list[OrchestrationMonitoringObservation]:
        """
        Returns the latest observation for each monitoring type within a workspace/site boundary.
        """
        if site_id is not None:
            site = db.get(Website, site_id)
            if not site:
                raise SiteMismatchError(site_id, f"Website with id {site_id} not found")

        q = (
            db.query(OrchestrationMonitoringObservation)
            .filter(OrchestrationMonitoringObservation.workspace_id == workspace_id)
        )
        if site_id is not None:
            q = q.filter(OrchestrationMonitoringObservation.site_id == site_id)

        all_obs = q.order_by(desc(OrchestrationMonitoringObservation.observed_at)).all()
        latest_map: dict[str, OrchestrationMonitoringObservation] = {}
        for obs in all_obs:
            if obs.monitoring_type not in latest_map:
                latest_map[obs.monitoring_type] = obs

        return list(latest_map.values())

    def get_site_monitoring_status(
        self,
        db: Session,
        workspace_id: str | None = None,
        tenant_id: str | None = None,
        site_id: int | None = None,
    ) -> Any:
        """
        Returns structured monitoring summary across pipeline domains for a site.
        """
        ws = tenant_id or workspace_id or "default"
        if site_id is not None:
            site = db.get(Website, site_id)
            if not site:
                raise SiteMismatchError(site_id, f"Website with id {site_id} not found")
            foreign_obs = (
                db.query(OrchestrationMonitoringObservation)
                .filter(
                    OrchestrationMonitoringObservation.site_id == site_id,
                    OrchestrationMonitoringObservation.workspace_id != ws,
                )
                .first()
            )
            if foreign_obs:
                raise TenantMismatchError(ws, foreign_obs.workspace_id)

        obs_list = self.get_latest_status(workspace_id=ws, site_id=site_id, db=db)
        statuses = {o.status.upper() for o in obs_list}
        if "CRITICAL" in statuses:
            overall = "CRITICAL"
        elif "FAILING" in statuses:
            overall = "FAILING"
        elif "DEGRADED" in statuses:
            overall = "DEGRADED"
        elif "STALE" in statuses:
            overall = "STALE"
        elif "UNKNOWN" in statuses:
            overall = "UNKNOWN"
        else:
            overall = "HEALTHY"

        from .schemas import MonitoringObservationResponse, MonitoringStatusResponse
        obs_responses = [
            MonitoringObservationResponse.model_validate(o) for o in obs_list
        ]
        domain_statuses = []
        for m_type in MonitoringType:
            match = next((o for o in obs_list if o.monitoring_type == m_type.value), None)
            domain_statuses.append({
                "monitoring_type": m_type.value,
                "status": match.status if match else "UNKNOWN",
                "severity": match.severity if match else "INFO",
            })

        return MonitoringStatusResponse(
            workspace_id=ws,
            site_id=site_id,
            observations=obs_responses,
            domain_statuses=domain_statuses,
            overall_status=overall,
        )

    def evaluate_site_monitoring(
        self,
        db: Session,
        workspace_id: str | None = None,
        tenant_id: str | None = None,
        site_id: int | None = None,
        as_of: datetime | None = None,
    ) -> Any:
        """Evaluates operational health across all monitoring domains and persists observations."""
        ws = tenant_id or workspace_id or "default"
        target_site_id = site_id or 1
        site = db.get(Website, target_site_id)
        if not site:
            raise SiteMismatchError(target_site_id, f"Website with id {target_site_id} not found")

        evals = [
            FreshnessEvaluator.evaluate(evidence_type=et, observed_at=None, as_of=as_of)
            for et in EvidenceType
        ]
        evaluators = [
            self.evaluate_crawl_health(workspace_id=ws, site_id=target_site_id, db=db, now=as_of),
            self.evaluate_analysis_health(workspace_id=ws, site_id=target_site_id, db=db, now=as_of),
            self.evaluate_evidence_freshness(workspace_id=ws, site_id=target_site_id, evaluations=evals, now=as_of),
            self.evaluate_ai_visibility_monitoring(workspace_id=ws, site_id=target_site_id, db=db, now=as_of),
            self.evaluate_validation_health(workspace_id=ws, site_id=target_site_id, db=db, now=as_of),
            self.evaluate_fix_execution_health(workspace_id=ws, site_id=target_site_id, db=db, now=as_of),
            self.evaluate_provider_health(workspace_id=ws, site_id=target_site_id, provider="google_search", now=as_of),
            self.evaluate_schedule_health(workspace_id=ws, site_id=target_site_id, db=db, now=as_of),
            self.evaluate_queue_worker_health(workspace_id=ws, site_id=target_site_id, now=as_of),
        ]
        for obs in evaluators:
            self.record_observation(obs, db)

        return self.get_site_monitoring_status(db, workspace_id=ws, site_id=target_site_id)

    def get_monitoring_history(
        self,
        *args: Any,
        **kwargs: Any,
    ) -> Any:
        """
        Returns paginated monitoring history.
        Supports:
          get_monitoring_history(workspace_id, site_id, db, limit, offset, monitoring_type) -> list[Obs]
          get_monitoring_history(db, workspace_id=..., tenant_id=..., site_id=..., limit=..., offset=...) -> MonitoringHistoryResponse
        """
        if args and isinstance(args[0], str):
            workspace_id = args[0]
            site_id = args[1] if len(args) > 1 else kwargs.get("site_id")
            db = args[2] if len(args) > 2 else kwargs["db"]
            limit = args[3] if len(args) > 3 else kwargs.get("limit", 50)
            offset = args[4] if len(args) > 4 else kwargs.get("offset", 0)
            m_type = args[5] if len(args) > 5 else kwargs.get("monitoring_type")

            q = (
                db.query(OrchestrationMonitoringObservation)
                .filter(OrchestrationMonitoringObservation.workspace_id == workspace_id)
            )
            if site_id is not None:
                q = q.filter(OrchestrationMonitoringObservation.site_id == site_id)
            if m_type is not None:
                q = q.filter(OrchestrationMonitoringObservation.monitoring_type == m_type)

            return q.order_by(desc(OrchestrationMonitoringObservation.observed_at)).offset(offset).limit(limit).all()

        db = args[0] if args else kwargs["db"]
        ws = kwargs.get("tenant_id") or kwargs.get("workspace_id") or "default"
        site_id = kwargs.get("site_id")
        limit = kwargs.get("limit", 50)
        offset = kwargs.get("offset", 0)
        m_type = kwargs.get("monitoring_type")

        if site_id is not None:
            site = db.get(Website, site_id)
            if not site:
                raise SiteMismatchError(site_id, f"Website with id {site_id} not found")
            foreign_obs = (
                db.query(OrchestrationMonitoringObservation)
                .filter(
                    OrchestrationMonitoringObservation.site_id == site_id,
                    OrchestrationMonitoringObservation.workspace_id != ws,
                )
                .first()
            )
            if foreign_obs:
                raise TenantMismatchError(ws, foreign_obs.workspace_id)

        q = db.query(OrchestrationMonitoringObservation).filter(
            OrchestrationMonitoringObservation.workspace_id == ws
        )
        if site_id is not None:
            q = q.filter(OrchestrationMonitoringObservation.site_id == site_id)
        if m_type is not None:
            q = q.filter(OrchestrationMonitoringObservation.monitoring_type == m_type)

        total_count = q.count()
        records = q.order_by(desc(OrchestrationMonitoringObservation.observed_at)).offset(offset).limit(limit).all()

        from .schemas import MonitoringHistoryResponse, MonitoringObservationResponse
        return MonitoringHistoryResponse(
            workspace_id=ws,
            site_id=site_id,
            total_count=total_count,
            observations=[MonitoringObservationResponse.model_validate(r) for r in records],
        )
