"""
Production Orchestration & Monitoring - Health Evaluation Engine.

Provides deterministic, multi-dimensional system health evaluation and external
dependency tracking without mutating state or making live external HTTP calls.
"""

from __future__ import annotations

from datetime import datetime, timezone, timedelta
from typing import Any

from sqlalchemy import and_, func, select, text
from sqlalchemy.orm import Session

from .enums import (
    HealthDimension,
    MonitoringStatus,
    ReceiptStatus,
    RunState,
    ScheduleStatus,
    SystemHealthStatus,
)
from .exceptions import TenantMismatchError, SiteMismatchError
from .models import (
    ExecutionReceipt,
    OrchestrationEvent,
    OrchestrationMonitoringObservation,
    OrchestrationRun,
    Schedule,
    _utc_now,
)
from .ports import validate_tenant_site_boundary


class DependencyHealthTracker:
    """
    Evaluates health of external providers and dependencies grounded strictly
    in recorded execution receipts, monitoring observations, and run errors.
    """

    def evaluate_providers(
        self,
        db: Session,
        workspace_id: str,
        *,
        site_id: int | None = None,
        lookback_hours: int = 24,
    ) -> dict[str, Any]:
        """
        Evaluates health of configured external dependencies from recent execution receipts.
        """
        now = _utc_now()
        since = now - timedelta(hours=lookback_hours)

        # Query recent receipts for workspace
        query = select(ExecutionReceipt).where(
            and_(
                ExecutionReceipt.workspace_id == workspace_id,
                ExecutionReceipt.created_at >= since,
            )
        )
        if site_id is not None:
            query = query.where(ExecutionReceipt.site_id == site_id)

        receipts = list(db.scalars(query).all())

        # Group by provider / service
        providers: dict[str, dict[str, Any]] = {}

        # Default tracked providers
        default_providers = ["ai_provider", "crawler", "github", "wordpress", "analytics"]
        for p in default_providers:
            providers[p] = {
                "provider": p,
                "status": SystemHealthStatus.UNKNOWN.value,
                "total_operations": 0,
                "successful_operations": 0,
                "failed_operations": 0,
                "timeout_count": 0,
                "auth_failure_count": 0,
                "last_success_at": None,
                "last_failure_at": None,
                "failure_rate": 0.0,
                "reasons": [],
            }

        for r in receipts:
            provider_name = (
                (r.details or {}).get("provider_name")
                or (r.details or {}).get("provider")
                or r.operation_type
                or "unknown"
            )
            if provider_name not in providers:
                providers[provider_name] = {
                    "provider": provider_name,
                    "status": SystemHealthStatus.UNKNOWN.value,
                    "total_operations": 0,
                    "successful_operations": 0,
                    "failed_operations": 0,
                    "timeout_count": 0,
                    "auth_failure_count": 0,
                    "last_success_at": None,
                    "last_failure_at": None,
                    "failure_rate": 0.0,
                    "reasons": [],
                }

            entry = providers[provider_name]
            entry["total_operations"] += 1

            if r.status == ReceiptStatus.CONFIRMED.value:
                entry["successful_operations"] += 1
                if entry["last_success_at"] is None or r.created_at > entry["last_success_at"]:
                    entry["last_success_at"] = r.created_at.isoformat()
            elif r.status in (ReceiptStatus.FAILED.value, ReceiptStatus.AMBIGUOUS.value):
                entry["failed_operations"] += 1
                if entry["last_failure_at"] is None or r.created_at > entry["last_failure_at"]:
                    entry["last_failure_at"] = r.created_at.isoformat()

                # Check error details for timeout or auth signals
                details = r.details or {}
                error_str = str(details.get("error", "")).lower()
                if "auth" in error_str or "unauthorized" in error_str or "forbidden" in error_str:
                    entry["auth_failure_count"] += 1
                if "timeout" in error_str or "timed out" in error_str or "rate limit" in error_str:
                    entry["timeout_count"] += 1

        # Calculate statuses
        overall_status = SystemHealthStatus.HEALTHY.value
        has_degraded = False
        has_unhealthy = False

        for p_name, data in providers.items():
            total = data["total_operations"]
            if total == 0:
                data["status"] = SystemHealthStatus.UNKNOWN.value
                data["reasons"].append("No recent execution receipts observed")
                continue

            failed = data["failed_operations"]
            rate = failed / total
            data["failure_rate"] = round(rate, 3)

            if data["auth_failure_count"] > 0:
                data["status"] = SystemHealthStatus.UNHEALTHY.value
                data["reasons"].append(f"Authentication failure detected ({data['auth_failure_count']} occurrences)")
                has_unhealthy = True
            elif rate >= 0.5:
                data["status"] = SystemHealthStatus.UNHEALTHY.value
                data["reasons"].append(f"High failure rate: {round(rate * 100, 1)}%")
                has_unhealthy = True
            elif rate >= 0.15 or data["timeout_count"] > 0:
                data["status"] = SystemHealthStatus.DEGRADED.value
                if rate >= 0.15:
                    data["reasons"].append(f"Elevated failure rate: {round(rate * 100, 1)}%")
                if data["timeout_count"] > 0:
                    data["reasons"].append(f"Timeout/rate limit signals detected ({data['timeout_count']} occurrences)")
                has_degraded = True
            else:
                data["status"] = SystemHealthStatus.HEALTHY.value

        if has_unhealthy:
            overall_status = SystemHealthStatus.UNHEALTHY.value
        elif has_degraded:
            overall_status = SystemHealthStatus.DEGRADED.value

        return {
            "status": overall_status,
            "providers": providers,
            "lookback_hours": lookback_hours,
        }


class SystemHealthService:
    """
    Centralized health evaluation across all 8 operational dimensions:
    SCHEDULER, QUEUE, WORKERS, ORCHESTRATION, FRESHNESS, PROVIDERS, DATABASE, EXECUTION.
    """

    def __init__(self) -> None:
        self.provider_tracker = DependencyHealthTracker()

    def evaluate_system_health(
        self,
        db: Session,
        workspace_id: str,
        *,
        site_id: int | None = None,
        queue_instance: Any = None,
        worker_harness: Any = None,
    ) -> dict[str, Any]:
        """
        Evaluates system health across all 8 canonical dimensions.
        """
        if site_id is not None:
            validate_tenant_site_boundary(db, tenant_id=workspace_id, site_id=site_id)

        now = _utc_now()
        dimensions: dict[str, dict[str, Any]] = {}

        # 1. DATABASE
        try:
            db.execute(text("SELECT 1"))
            dimensions[HealthDimension.DATABASE.value] = {
                "status": SystemHealthStatus.HEALTHY.value,
                "reasons": [],
                "evidence": {"connected": True, "engine": "active"},
            }
        except Exception as exc:
            dimensions[HealthDimension.DATABASE.value] = {
                "status": SystemHealthStatus.UNHEALTHY.value,
                "reasons": [f"Database connectivity failed: {str(exc)}"],
                "evidence": {"connected": False, "error": str(exc)},
            }

        # 2. SCHEDULER
        schedule_query = select(Schedule).where(
            and_(
                Schedule.workspace_id == workspace_id,
                Schedule.status == ScheduleStatus.ACTIVE.value,
            )
        )
        if site_id is not None:
            schedule_query = schedule_query.where(Schedule.site_id == site_id)
        schedules = list(db.scalars(schedule_query).all())

        missed_schedules = []
        for s in schedules:
            if s.next_run_at and s.next_run_at < (now - timedelta(minutes=30)):
                missed_schedules.append(s.id)

        if len(missed_schedules) > 2:
            dimensions[HealthDimension.SCHEDULER.value] = {
                "status": SystemHealthStatus.UNHEALTHY.value,
                "reasons": [f"Multiple active schedules overdue (>30m): {missed_schedules}"],
                "evidence": {"active_schedules": len(schedules), "missed_count": len(missed_schedules)},
            }
        elif len(missed_schedules) > 0:
            dimensions[HealthDimension.SCHEDULER.value] = {
                "status": SystemHealthStatus.DEGRADED.value,
                "reasons": [f"Overdue schedule detected: {missed_schedules}"],
                "evidence": {"active_schedules": len(schedules), "missed_count": len(missed_schedules)},
            }
        else:
            dimensions[HealthDimension.SCHEDULER.value] = {
                "status": SystemHealthStatus.HEALTHY.value,
                "reasons": [],
                "evidence": {"active_schedules": len(schedules), "missed_count": 0},
            }

        # 3. QUEUE
        # Check queued runs in DB and queue instance if available
        queued_runs_query = select(func.count(OrchestrationRun.id)).where(
            and_(
                OrchestrationRun.workspace_id == workspace_id,
                OrchestrationRun.state == RunState.QUEUED.value,
            )
        )
        if site_id is not None:
            queued_runs_query = queued_runs_query.where(OrchestrationRun.site_id == site_id)
        queued_run_count = db.scalar(queued_runs_query) or 0

        queue_depth = queued_run_count
        if queue_instance is not None and hasattr(queue_instance, "get_queue_depth"):
            try:
                queue_depth = queue_instance.get_queue_depth()
            except Exception:
                pass

        if queue_depth > 50:
            dimensions[HealthDimension.QUEUE.value] = {
                "status": SystemHealthStatus.UNHEALTHY.value,
                "reasons": [f"Severe queue backlog: {queue_depth} items pending"],
                "evidence": {"queue_depth": queue_depth, "queued_runs": queued_run_count},
            }
        elif queue_depth > 20:
            dimensions[HealthDimension.QUEUE.value] = {
                "status": SystemHealthStatus.DEGRADED.value,
                "reasons": [f"Elevated queue depth: {queue_depth} items pending"],
                "evidence": {"queue_depth": queue_depth, "queued_runs": queued_run_count},
            }
        else:
            dimensions[HealthDimension.QUEUE.value] = {
                "status": SystemHealthStatus.HEALTHY.value,
                "reasons": [],
                "evidence": {"queue_depth": queue_depth, "queued_runs": queued_run_count},
            }

        # 4. WORKERS
        worker_count = 0
        healthy_workers = 0
        stale_workers = 0

        if worker_harness is not None and hasattr(worker_harness, "get_worker_statuses"):
            try:
                statuses = worker_harness.get_worker_statuses()
                worker_count = len(statuses)
                for w in statuses:
                    if w.get("is_healthy", False):
                        healthy_workers += 1
                    else:
                        stale_workers += 1
            except Exception:
                pass
        else:
            # Fallback to worker heartbeat events in last 5 minutes
            heartbeat_query = select(OrchestrationEvent.worker_id).where(
                and_(
                    OrchestrationEvent.event_type.in_(["WORKER_HEARTBEAT", "HEARTBEAT"]),
                    OrchestrationEvent.occurred_at >= (now - timedelta(minutes=5)),
                )
            ).distinct()
            active_worker_ids = list(db.scalars(heartbeat_query).all())
            worker_count = len(active_worker_ids)
            healthy_workers = worker_count

        if queue_depth > 0 and healthy_workers == 0:
            dimensions[HealthDimension.WORKERS.value] = {
                "status": SystemHealthStatus.UNHEALTHY.value,
                "reasons": ["No healthy workers available while jobs are queued"],
                "evidence": {"worker_count": worker_count, "healthy_workers": healthy_workers, "stale_workers": stale_workers},
            }
        elif stale_workers > 0:
            dimensions[HealthDimension.WORKERS.value] = {
                "status": SystemHealthStatus.DEGRADED.value,
                "reasons": [f"Stale worker leases detected ({stale_workers} stale)"],
                "evidence": {"worker_count": worker_count, "healthy_workers": healthy_workers, "stale_workers": stale_workers},
            }
        else:
            dimensions[HealthDimension.WORKERS.value] = {
                "status": SystemHealthStatus.HEALTHY.value,
                "reasons": [],
                "evidence": {"worker_count": worker_count, "healthy_workers": healthy_workers, "stale_workers": 0},
            }

        # 5. ORCHESTRATION
        recent_runs_query = select(OrchestrationRun).where(
            and_(
                OrchestrationRun.workspace_id == workspace_id,
                OrchestrationRun.requested_at >= (now - timedelta(hours=12)),
            )
        )
        if site_id is not None:
            recent_runs_query = recent_runs_query.where(OrchestrationRun.site_id == site_id)
        recent_runs = list(db.scalars(recent_runs_query).all())

        terminal_runs = [r for r in recent_runs if r.state in (RunState.SUCCEEDED.value, RunState.PARTIAL.value, RunState.FAILED.value)]
        failed_runs = [r for r in terminal_runs if r.state == RunState.FAILED.value]

        if terminal_runs and (len(failed_runs) / len(terminal_runs)) >= 0.5:
            dimensions[HealthDimension.ORCHESTRATION.value] = {
                "status": SystemHealthStatus.UNHEALTHY.value,
                "reasons": [f"High orchestration run failure rate ({len(failed_runs)}/{len(terminal_runs)} runs failed)"],
                "evidence": {"total_recent_runs": len(recent_runs), "failed_runs": len(failed_runs)},
            }
        elif terminal_runs and (len(failed_runs) / len(terminal_runs)) >= 0.2:
            dimensions[HealthDimension.ORCHESTRATION.value] = {
                "status": SystemHealthStatus.DEGRADED.value,
                "reasons": [f"Elevated orchestration run failure rate ({len(failed_runs)}/{len(terminal_runs)} runs failed)"],
                "evidence": {"total_recent_runs": len(recent_runs), "failed_runs": len(failed_runs)},
            }
        else:
            dimensions[HealthDimension.ORCHESTRATION.value] = {
                "status": SystemHealthStatus.HEALTHY.value,
                "reasons": [],
                "evidence": {"total_recent_runs": len(recent_runs), "failed_runs": len(failed_runs)},
            }

        # 6. FRESHNESS
        obs_query = select(OrchestrationMonitoringObservation).where(
            and_(
                OrchestrationMonitoringObservation.workspace_id == workspace_id,
                OrchestrationMonitoringObservation.monitoring_type == "EVIDENCE_FRESHNESS",
                OrchestrationMonitoringObservation.observed_at >= (now - timedelta(hours=24)),
            )
        ).order_by(OrchestrationMonitoringObservation.observed_at.desc())
        if site_id is not None:
            obs_query = obs_query.where(OrchestrationMonitoringObservation.site_id == site_id)
        latest_freshness_obs = db.scalars(obs_query).first()

        if latest_freshness_obs:
            if latest_freshness_obs.status == MonitoringStatus.CRITICAL.value:
                dimensions[HealthDimension.FRESHNESS.value] = {
                    "status": SystemHealthStatus.UNHEALTHY.value,
                    "reasons": [f"Critical stale evidence detected: {latest_freshness_obs.summary}"],
                    "evidence": latest_freshness_obs.details,
                }
            elif latest_freshness_obs.status in (MonitoringStatus.DEGRADED.value, MonitoringStatus.STALE.value):
                dimensions[HealthDimension.FRESHNESS.value] = {
                    "status": SystemHealthStatus.DEGRADED.value,
                    "reasons": [f"Stale evidence detected: {latest_freshness_obs.summary}"],
                    "evidence": latest_freshness_obs.details,
                }
            else:
                dimensions[HealthDimension.FRESHNESS.value] = {
                    "status": SystemHealthStatus.HEALTHY.value,
                    "reasons": [],
                    "evidence": latest_freshness_obs.details,
                }
        else:
            dimensions[HealthDimension.FRESHNESS.value] = {
                "status": SystemHealthStatus.UNKNOWN.value,
                "reasons": ["No recent freshness monitoring observation found"],
                "evidence": {},
            }

        # 7. PROVIDERS
        provider_eval = self.provider_tracker.evaluate_providers(db, workspace_id, site_id=site_id)
        dimensions[HealthDimension.PROVIDERS.value] = {
            "status": provider_eval["status"],
            "reasons": [f"{p}: {', '.join(d['reasons'])}" for p, d in provider_eval["providers"].items() if d["reasons"] and d["status"] != SystemHealthStatus.HEALTHY.value],
            "evidence": provider_eval["providers"],
        }

        # 8. EXECUTION
        ambiguous_query = select(func.count(ExecutionReceipt.id)).where(
            and_(
                ExecutionReceipt.workspace_id == workspace_id,
                ExecutionReceipt.status == ReceiptStatus.AMBIGUOUS.value,
            )
        )
        if site_id is not None:
            ambiguous_query = ambiguous_query.where(ExecutionReceipt.site_id == site_id)
        ambiguous_count = db.scalar(ambiguous_query) or 0

        if ambiguous_count > 0:
            dimensions[HealthDimension.EXECUTION.value] = {
                "status": SystemHealthStatus.DEGRADED.value,
                "reasons": [f"Ambiguous execution receipts pending reconciliation ({ambiguous_count})"],
                "evidence": {"ambiguous_receipts": ambiguous_count},
            }
        else:
            dimensions[HealthDimension.EXECUTION.value] = {
                "status": SystemHealthStatus.HEALTHY.value,
                "reasons": [],
                "evidence": {"ambiguous_receipts": 0},
            }

        # Aggregate Overall Status
        has_unhealthy_dim = any(d["status"] == SystemHealthStatus.UNHEALTHY.value for d in dimensions.values())
        has_degraded_dim = any(d["status"] == SystemHealthStatus.DEGRADED.value for d in dimensions.values())

        if has_unhealthy_dim:
            overall = SystemHealthStatus.UNHEALTHY.value
        elif has_degraded_dim:
            overall = SystemHealthStatus.DEGRADED.value
        else:
            overall = SystemHealthStatus.HEALTHY.value

        return {
            "workspace_id": workspace_id,
            "site_id": site_id,
            "overall_status": overall,
            "dimensions": dimensions,
            "evaluated_at": now.isoformat(),
        }
