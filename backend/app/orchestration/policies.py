"""
Production Orchestration & Monitoring - Tenant Operational Policies Engine.

Provides tenant and site-level operational policy configuration, hard global
safety ceilings, and centralized deterministic policy evaluation.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime, timezone, timedelta
from typing import Any

from sqlalchemy import and_, func, select
from sqlalchemy.orm import Session

from connectors.base.security import sanitize_payload
from .enums import (
    AlertSeverity,
    AutomationLevel,
    OrchestrationEventType,
    PolicyRuleType,
    RunState,
)
from .exceptions import (
    GlobalCeilingExceededError,
    PolicyViolationError,
    SiteMismatchError,
    TenantMismatchError,
)
from .models import (
    OrchestrationEvent,
    OrchestrationRun,
    OrchestrationStage,
    TenantOrchestrationPolicy,
    _utc_now,
)
from .observability import ObservabilityService
from .ports import validate_tenant_site_boundary


# ==========================================
# HARD GLOBAL SAFETY CEILINGS
# No tenant or site override can ever exceed these limits.
# ==========================================
GLOBAL_CEILINGS = {
    "max_concurrent_runs": 50,
    "max_concurrent_jobs": 100,
    "max_concurrent_provider_calls": 25,
    "max_crawl_jobs": 20,
    "max_ai_probe_jobs": 25,
    "max_refresh_jobs": 20,
    "retry_budget_per_hour": 100,
    "daily_operational_budget": 1000,
    "max_execution_duration_seconds": 86400,
    "max_queue_age_seconds": 14400,
}

# ==========================================
# DEFAULT OPERATIONAL LIMITS
# Safe baseline applied when no tenant/site policy exists.
# ==========================================
DEFAULT_POLICY = {
    "max_concurrent_runs": 5,
    "max_concurrent_jobs": 10,
    "max_concurrent_provider_calls": 5,
    "max_crawl_jobs": 3,
    "max_ai_probe_jobs": 4,
    "max_refresh_jobs": 3,
    "retry_budget_per_hour": 20,
    "daily_operational_budget": 100,
    "max_execution_duration_seconds": 3600,
    "max_queue_age_seconds": 1800,
    "allowed_automation_level": AutomationLevel.FULL.value,
    "is_monitoring_enabled": True,
    "min_alert_severity": AlertSeverity.INFO.value,
    "maintenance_window_cron": None,
    "maintenance_window_active": False,
}


@dataclass(frozen=True)
class PolicyDecision:
    """Deterministic result of a policy evaluation check."""

    allowed: bool
    policy_rule: str
    limit_value: Any
    current_usage: Any
    requested_usage: Any
    reason: str
    workspace_id: str
    site_id: int | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "allowed": self.allowed,
            "policy_rule": self.policy_rule,
            "limit_value": self.limit_value,
            "current_usage": self.current_usage,
            "requested_usage": self.requested_usage,
            "reason": self.reason,
            "workspace_id": self.workspace_id,
            "site_id": self.site_id,
        }


class TenantPolicyRegistry:
    """
    Manages persistent tenant and site operational policies with fallback resolution
    (Site policy -> Workspace policy -> Safe system default) and global ceiling validation.
    """

    def get_effective_policy(
        self,
        db: Session,
        workspace_id: str,
        site_id: int | None = None,
    ) -> dict[str, Any]:
        """
        Resolves the effective policy for a workspace/site hierarchy.
        """
        if site_id is not None:
            validate_tenant_site_boundary(db, tenant_id=workspace_id, site_id=site_id)

        # 1. Check site-specific policy
        if site_id is not None:
            site_query = select(TenantOrchestrationPolicy).where(
                and_(
                    TenantOrchestrationPolicy.workspace_id == workspace_id,
                    TenantOrchestrationPolicy.site_id == site_id,
                )
            )
            site_policy = db.scalars(site_query).first()
            if site_policy:
                return self._model_to_dict(site_policy)

        # 2. Check workspace-level default policy (site_id is None)
        ws_query = select(TenantOrchestrationPolicy).where(
            and_(
                TenantOrchestrationPolicy.workspace_id == workspace_id,
                TenantOrchestrationPolicy.site_id.is_(None),
            )
        )
        ws_policy = db.scalars(ws_query).first()
        if ws_policy:
            return self._model_to_dict(ws_policy)

        # 3. Fallback to global safe defaults
        result = dict(DEFAULT_POLICY)
        result["workspace_id"] = workspace_id
        result["site_id"] = site_id
        result["is_default"] = True
        return result

    def upsert_policy(
        self,
        db: Session,
        workspace_id: str,
        policy_data: dict[str, Any],
        *,
        site_id: int | None = None,
    ) -> TenantOrchestrationPolicy:
        """
        Creates or updates a policy, validating strictly against global safety ceilings.
        """
        if site_id is not None:
            validate_tenant_site_boundary(db, tenant_id=workspace_id, site_id=site_id)

        # Validate against global ceilings
        for key, ceiling in GLOBAL_CEILINGS.items():
            if key in policy_data and policy_data[key] is not None:
                val = policy_data[key]
                if isinstance(val, (int, float)) and val > ceiling:
                    raise GlobalCeilingExceededError(key, requested_value=val, ceiling_value=ceiling)

        # Find existing
        query = select(TenantOrchestrationPolicy).where(
            TenantOrchestrationPolicy.workspace_id == workspace_id
        )
        if site_id is not None:
            query = query.where(TenantOrchestrationPolicy.site_id == site_id)
        else:
            query = query.where(TenantOrchestrationPolicy.site_id.is_(None))

        existing = db.scalars(query).first()
        now = _utc_now()

        if existing:
            for field, val in policy_data.items():
                if hasattr(existing, field) and field not in ("id", "created_at", "workspace_id", "site_id"):
                    setattr(existing, field, val)
            existing.updated_at = now
            existing.version += 1
            db.commit()
            db.refresh(existing)
            return existing

        # Create new
        new_id = f"pol_{uuid.uuid4().hex[:16]}"
        fields = {
            "id": new_id,
            "workspace_id": workspace_id,
            "site_id": site_id,
            "created_at": now,
            "updated_at": now,
        }
        for k, v in policy_data.items():
            if hasattr(TenantOrchestrationPolicy, k):
                fields[k] = v

        policy = TenantOrchestrationPolicy(**fields)
        db.add(policy)
        db.commit()
        db.refresh(policy)
        return policy

    def _model_to_dict(self, model: TenantOrchestrationPolicy) -> dict[str, Any]:
        return {
            "id": model.id,
            "workspace_id": model.workspace_id,
            "site_id": model.site_id,
            "max_concurrent_runs": model.max_concurrent_runs,
            "max_concurrent_jobs": model.max_concurrent_jobs,
            "max_concurrent_provider_calls": model.max_concurrent_provider_calls,
            "max_crawl_jobs": model.max_crawl_jobs,
            "max_ai_probe_jobs": model.max_ai_probe_jobs,
            "max_refresh_jobs": model.max_refresh_jobs,
            "retry_budget_per_hour": model.retry_budget_per_hour,
            "daily_operational_budget": model.daily_operational_budget,
            "max_execution_duration_seconds": model.max_execution_duration_seconds,
            "max_queue_age_seconds": model.max_queue_age_seconds,
            "allowed_automation_level": model.allowed_automation_level,
            "is_monitoring_enabled": model.is_monitoring_enabled,
            "min_alert_severity": model.min_alert_severity,
            "maintenance_window_cron": model.maintenance_window_cron,
            "maintenance_window_active": model.maintenance_window_active,
            "custom_settings": model.custom_settings or {},
            "created_at": model.created_at.isoformat() if model.created_at else None,
            "updated_at": model.updated_at.isoformat() if model.updated_at else None,
            "version": model.version,
            "is_default": False,
        }


class PolicyEvaluator:
    """
    Centralized deterministic evaluator for operational policies.
    """

    def __init__(self, registry: TenantPolicyRegistry | None = None, observability: ObservabilityService | None = None) -> None:
        self.registry = registry or TenantPolicyRegistry()
        self.observability = observability or ObservabilityService()

    def evaluate_run_creation(
        self,
        db: Session,
        workspace_id: str,
        *,
        site_id: int | None = None,
        is_automated: bool = False,
        enforce: bool = False,
    ) -> PolicyDecision:
        """
        Evaluates whether a new run can be started based on concurrent run limits,
        daily operational budget, maintenance windows, and automation level.
        """
        policy = self.registry.get_effective_policy(db, workspace_id, site_id=site_id)

        # 1. Maintenance Window Check
        if policy.get("maintenance_window_active", False):
            decision = PolicyDecision(
                allowed=False,
                policy_rule=PolicyRuleType.MAINTENANCE_WINDOW.value,
                limit_value="MAINTENANCE_ACTIVE",
                current_usage="ACTIVE",
                requested_usage="NEW_RUN",
                reason="Site/workspace is currently undergoing scheduled maintenance",
                workspace_id=workspace_id,
                site_id=site_id,
            )
            self._handle_denial(db, decision, enforce)
            return decision

        # 2. Automation Level Check
        allowed_auto = policy.get("allowed_automation_level", AutomationLevel.FULL.value)
        if is_automated and allowed_auto == AutomationLevel.MANUAL_ONLY.value:
            decision = PolicyDecision(
                allowed=False,
                policy_rule=PolicyRuleType.AUTOMATION_LEVEL.value,
                limit_value=allowed_auto,
                current_usage="AUTOMATED_TRIGGER",
                requested_usage="AUTOMATED_RUN",
                reason=f"Tenant policy allows {allowed_auto} only; automated run dispatch is prohibited",
                workspace_id=workspace_id,
                site_id=site_id,
            )
            self._handle_denial(db, decision, enforce)
            return decision

        # 3. Concurrent Runs Check
        max_runs = policy.get("max_concurrent_runs", 5)
        active_states = [
            RunState.STARTING.value,
            RunState.SCANNING.value,
            RunState.ANALYZING.value,
            RunState.OBSERVING.value,
            RunState.PLANNING.value,
            RunState.EXECUTING.value,
            RunState.VERIFYING.value,
            RunState.MONITORING.value,
            RunState.QUEUED.value,
            RunState.RETRY_WAIT.value,
        ]
        query = select(func.count(OrchestrationRun.id)).where(
            and_(
                OrchestrationRun.workspace_id == workspace_id,
                OrchestrationRun.state.in_(active_states),
            )
        )
        if site_id is not None:
            query = query.where(OrchestrationRun.site_id == site_id)
        current_active = db.scalar(query) or 0

        if current_active >= max_runs:
            decision = PolicyDecision(
                allowed=False,
                policy_rule=PolicyRuleType.MAX_CONCURRENT_RUNS.value,
                limit_value=max_runs,
                current_usage=current_active,
                requested_usage=current_active + 1,
                reason=f"Concurrent runs limit reached ({current_active}/{max_runs})",
                workspace_id=workspace_id,
                site_id=site_id,
            )
            self._handle_denial(db, decision, enforce)
            return decision

        # 4. Daily Operational Budget Check
        daily_budget = policy.get("daily_operational_budget", 100)
        since_today = _utc_now() - timedelta(hours=24)
        budget_query = select(func.count(OrchestrationRun.id)).where(
            and_(
                OrchestrationRun.workspace_id == workspace_id,
                OrchestrationRun.requested_at >= since_today,
            )
        )
        if site_id is not None:
            budget_query = budget_query.where(OrchestrationRun.site_id == site_id)
        runs_today = db.scalar(budget_query) or 0

        if runs_today >= daily_budget:
            decision = PolicyDecision(
                allowed=False,
                policy_rule=PolicyRuleType.DAILY_OPERATIONAL_BUDGET.value,
                limit_value=daily_budget,
                current_usage=runs_today,
                requested_usage=runs_today + 1,
                reason=f"Daily operational run budget exhausted ({runs_today}/{daily_budget})",
                workspace_id=workspace_id,
                site_id=site_id,
            )
            self._handle_denial(db, decision, enforce)
            return decision

        # Allowed
        return PolicyDecision(
            allowed=True,
            policy_rule="RUN_CREATION_CHECK",
            limit_value=max_runs,
            current_usage=current_active,
            requested_usage=current_active + 1,
            reason="All policy checks passed",
            workspace_id=workspace_id,
            site_id=site_id,
        )

    def evaluate_retry_budget(
        self,
        db: Session,
        workspace_id: str,
        *,
        site_id: int | None = None,
        enforce: bool = False,
    ) -> PolicyDecision:
        """
        Evaluates whether a retry can be scheduled based on the hourly retry budget.
        """
        policy = self.registry.get_effective_policy(db, workspace_id, site_id=site_id)
        max_retries_per_hour = policy.get("retry_budget_per_hour", 20)

        one_hour_ago = _utc_now() - timedelta(hours=1)
        retry_query = select(func.count(OrchestrationEvent.id)).where(
            and_(
                OrchestrationEvent.workspace_id == workspace_id,
                OrchestrationEvent.event_type == OrchestrationEventType.RETRY_SCHEDULED.value,
                OrchestrationEvent.occurred_at >= one_hour_ago,
            )
        )
        if site_id is not None:
            retry_query = retry_query.where(OrchestrationEvent.site_id == site_id)
        recent_retries = db.scalar(retry_query) or 0

        if recent_retries >= max_retries_per_hour:
            decision = PolicyDecision(
                allowed=False,
                policy_rule=PolicyRuleType.RETRY_BUDGET_PER_HOUR.value,
                limit_value=max_retries_per_hour,
                current_usage=recent_retries,
                requested_usage=recent_retries + 1,
                reason=f"Hourly retry budget exhausted ({recent_retries}/{max_retries_per_hour})",
                workspace_id=workspace_id,
                site_id=site_id,
            )
            self._handle_denial(db, decision, enforce)
            return decision

        return PolicyDecision(
            allowed=True,
            policy_rule=PolicyRuleType.RETRY_BUDGET_PER_HOUR.value,
            limit_value=max_retries_per_hour,
            current_usage=recent_retries,
            requested_usage=recent_retries + 1,
            reason="Retry budget available",
            workspace_id=workspace_id,
            site_id=site_id,
        )

    def _handle_denial(self, db: Session, decision: PolicyDecision, enforce: bool) -> None:
        """Records an audit event for policy denial and optionally raises PolicyViolationError."""
        try:
            self.observability.record_event(
                db,
                decision.workspace_id,
                OrchestrationEventType.POLICY_BLOCKED,
                site_id=decision.site_id,
                severity=AlertSeverity.HIGH,
                details=decision.to_dict(),
            )
        except Exception:
            pass

        if enforce:
            raise PolicyViolationError(
                rule=decision.policy_rule,
                reason=decision.reason,
                limit_value=decision.limit_value,
                current_usage=decision.current_usage,
                workspace_id=decision.workspace_id,
                site_id=decision.site_id,
            )
