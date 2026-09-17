"""
Production Orchestration & Monitoring - Refresh Decision Engine.

Determines whether stale or aging evidence should trigger an orchestration run,
evaluates rate and provider constraints, prevents duplicate refresh storms via
deterministic idempotency keys, and produces structured RefreshJobIntents.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
import hashlib
import logging
from typing import Any

from sqlalchemy.orm import Session

from .enums import EvidenceType, FreshnessState, RefreshDecisionType, RunState, RunType
from .freshness_evaluator import FreshnessEvaluation
from .models import OrchestrationRun
from .schemas import ActorProvenance

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


# Mapping from evidence type to canonical execution archetype
EVIDENCE_TYPE_TO_RUN_TYPE: dict[EvidenceType, RunType] = {
    EvidenceType.CRAWL: RunType.ON_DEMAND_SCAN,
    EvidenceType.PAGE_SEO: RunType.ON_DEMAND_SCAN,
    EvidenceType.SCORE: RunType.ON_DEMAND_SCAN,
    EvidenceType.AI_VISIBILITY: RunType.EVIDENCE_REFRESH,
    EvidenceType.AI_ANSWER: RunType.EVIDENCE_REFRESH,
    EvidenceType.CITATION: RunType.EVIDENCE_REFRESH,
    EvidenceType.COMPETITOR: RunType.ON_DEMAND_SCAN,
    EvidenceType.EXTERNAL_AUTHORITY: RunType.ON_DEMAND_SCAN,
    EvidenceType.SEARCH_PERFORMANCE: RunType.ON_DEMAND_SCAN,
    EvidenceType.VALIDATION: RunType.VERIFICATION_RUN,
    EvidenceType.EXECUTION_CHANGE: RunType.VERIFICATION_RUN,
}


@dataclass(frozen=True)
class RefreshJobIntent:
    """
    Structured intent representing a requested refresh execution.
    Can be enqueued into the existing OrchestrationService without logic duplication.
    """

    workspace_id: str
    site_id: int | None
    evidence_type: EvidenceType
    run_type: RunType
    idempotency_key: str
    priority: int
    reason: str
    requested_at: datetime
    provenance: ActorProvenance
    metadata_payload: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "workspace_id": self.workspace_id,
            "site_id": self.site_id,
            "evidence_type": self.evidence_type.value,
            "run_type": self.run_type.value,
            "idempotency_key": self.idempotency_key,
            "priority": self.priority,
            "reason": self.reason,
            "requested_at": self.requested_at.isoformat(),
            "provenance": self.provenance.model_dump(),
            "metadata_payload": self.metadata_payload,
        }


@dataclass(frozen=True)
class RefreshDecision:
    """
    Structured result of a refresh evaluation by the RefreshDecisionEngine.
    """

    decision: RefreshDecisionType
    evidence_type: EvidenceType
    reason: str
    job_intent: RefreshJobIntent | None = None
    decided_at: datetime = field(default_factory=_utc_now)
    active_run_id: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "decision": self.decision.value,
            "evidence_type": self.evidence_type.value,
            "reason": self.reason,
            "job_intent": self.job_intent.to_dict() if self.job_intent else None,
            "decided_at": self.decided_at.isoformat(),
            "active_run_id": self.active_run_id,
        }


class RefreshDecisionEngine:
    """
    Deterministic decision engine assessing whether evidence requires refresh,
    evaluating deduplication, site pause state, and upstream provider health.
    """

    @staticmethod
    def generate_idempotency_key(
        workspace_id: str | None = None,
        site_id: int | None = None,
        evidence_type: EvidenceType | str = EvidenceType.CRAWL,
        reference_time: datetime | None = None,
        bucket_seconds: int = 3600,
        tenant_id: str | None = None,
        as_of: datetime | None = None,
        bucket_window_seconds: int | None = None,
    ) -> str:
        """
        Generates a deterministic idempotency key based on workspace, site, evidence category,
        and time bucket (e.g. 1 hour window) to prevent duplicate refresh storms.
        """
        eff_ws = tenant_id or workspace_id or "default"
        eff_time = as_of or reference_time or _utc_now()
        eff_bucket = bucket_window_seconds or bucket_seconds
        etype = EvidenceType(evidence_type) if isinstance(evidence_type, str) else evidence_type
        ref_dt = _ensure_utc(eff_time)
        timestamp = int(ref_dt.timestamp())
        bucket = timestamp - (timestamp % eff_bucket)
        site_str = str(site_id) if site_id is not None else "global"
        raw_key = f"refresh:{eff_ws}:{site_str}:{etype.value}:{bucket}"
        hashed = hashlib.sha256(raw_key.encode("utf-8")).hexdigest()[:16]
        return f"refresh_{etype.value.lower()}_{site_str}_{hashed}"

    @classmethod
    def evaluate_decision(
        cls,
        evaluation: FreshnessEvaluation,
        workspace_id: str | None = None,
        site_id: int | None = None,
        is_site_paused: bool = False,
        provider_available: bool = True,
        is_provider_available: bool | None = None,
        active_run_id: str | None = None,
        active_runs: list[OrchestrationRun] | None = None,
        db: Session | None = None,
        provenance: ActorProvenance | None = None,
        force_refresh: bool = False,
        reference_time: datetime | None = None,
        tenant_id: str | None = None,
        as_of: datetime | None = None,
    ) -> RefreshDecision:
        """
        Evaluates whether a refresh job should be created for the evaluated evidence.
        """
        eff_ws = tenant_id or workspace_id or "default"
        now = _ensure_utc(as_of or reference_time or _utc_now())
        etype = evaluation.evidence_type
        prov = provenance or ActorProvenance(actor_id="freshness_controller", actor_type="system")
        eff_provider_available = (
            provider_available if is_provider_available is None else is_provider_available
        )

        # 1. Check Provider Availability
        if not eff_provider_available or evaluation.is_unavailable:
            return RefreshDecision(
                decision=RefreshDecisionType.REFRESH_UNAVAILABLE,
                evidence_type=etype,
                reason="Upstream provider or source is unavailable; refresh cannot proceed",
                decided_at=now,
            )

        # 2. Check Site / Workspace Pause Status
        if is_site_paused:
            return RefreshDecision(
                decision=RefreshDecisionType.REFRESH_BLOCKED,
                evidence_type=etype,
                reason=f"Site {site_id} is currently paused; refresh cannot be scheduled",
                decided_at=now,
            )

        # 3. Check Explicit Active Run ID
        if active_run_id:
            return RefreshDecision(
                decision=RefreshDecisionType.REFRESH_ALREADY_RUNNING,
                evidence_type=etype,
                reason=f"Active refresh run '{active_run_id}' is already running",
                decided_at=now,
                active_run_id=active_run_id,
            )

        # 4. Check Active Refresh Deduplication
        active_run = cls._find_active_refresh_run(
            workspace_id=eff_ws,
            site_id=site_id,
            evidence_type=etype,
            active_runs=active_runs,
            db=db,
        )
        if active_run:
            logger.info(
                "Refresh deduplicated: active run '%s' (state='%s') already covering evidence '%s'",
                active_run.id,
                active_run.state,
                etype.value,
            )
            return RefreshDecision(
                decision=RefreshDecisionType.REFRESH_ALREADY_RUNNING,
                evidence_type=etype,
                reason=f"Active refresh run '{active_run.id}' is already {active_run.state}",
                decided_at=now,
                active_run_id=active_run.id,
            )

        # 5. Check Freshness State & Force Refresh
        if not force_refresh:
            if evaluation.freshness_state == FreshnessState.FRESH:
                return RefreshDecision(
                    decision=RefreshDecisionType.NO_ACTION,
                    evidence_type=etype,
                    reason="Evidence is fresh; no refresh needed",
                    decided_at=now,
                )
            if evaluation.freshness_state == FreshnessState.AGING:
                return RefreshDecision(
                    decision=RefreshDecisionType.NO_ACTION,
                    evidence_type=etype,
                    reason="Evidence is aging but within TTL; no refresh needed",
                    decided_at=now,
                )
            if evaluation.freshness_state == FreshnessState.REFRESHING:
                return RefreshDecision(
                    decision=RefreshDecisionType.REFRESH_ALREADY_RUNNING,
                    evidence_type=etype,
                    reason="Evidence is already refreshing",
                    decided_at=now,
                )
            if evaluation.freshness_state == FreshnessState.UNAVAILABLE:
                return RefreshDecision(
                    decision=RefreshDecisionType.REFRESH_UNAVAILABLE,
                    evidence_type=etype,
                    reason="Evidence source is marked unavailable; refresh deferred",
                    decided_at=now,
                )

        # 6. Determine Decision Type and Priority
        if evaluation.freshness_state in (FreshnessState.EXPIRED, FreshnessState.UNKNOWN):
            decision_type = RefreshDecisionType.REFRESH_REQUIRED
            priority = 90
        elif evaluation.freshness_state == FreshnessState.STALE:
            decision_type = RefreshDecisionType.REFRESH_RECOMMENDED
            priority = 50
        else:
            # Forced refresh on FRESH or AGING
            decision_type = RefreshDecisionType.REFRESH_RECOMMENDED
            priority = 50

        target_run_type = EVIDENCE_TYPE_TO_RUN_TYPE.get(etype, RunType.ON_DEMAND_SCAN)
        idempotency_key = cls.generate_idempotency_key(
            workspace_id=eff_ws,
            site_id=site_id,
            evidence_type=etype,
            reference_time=now,
        )

        reason = (
            f"Forced refresh for {etype.value}"
            if force_refresh
            else (evaluation.stale_reason or f"Evidence {etype.value} is {evaluation.freshness_state.value}")
        )

        intent = RefreshJobIntent(
            workspace_id=eff_ws,
            site_id=site_id,
            evidence_type=etype,
            run_type=target_run_type,
            idempotency_key=idempotency_key,
            priority=priority,
            reason=reason,
            requested_at=now,
            provenance=prov,
            metadata_payload={
                "freshness_state": evaluation.freshness_state.value,
                "age_seconds": evaluation.age_seconds,
                "ttl_seconds": evaluation.ttl_seconds,
                "forced": force_refresh,
            },
        )

        return RefreshDecision(
            decision=decision_type,
            evidence_type=etype,
            reason=reason,
            job_intent=intent,
            decided_at=now,
        )

    @classmethod
    def _find_active_refresh_run(
        cls,
        workspace_id: str,
        site_id: int | None,
        evidence_type: EvidenceType,
        active_runs: list[OrchestrationRun] | None = None,
        db: Session | None = None,
    ) -> OrchestrationRun | None:
        """Finds any active or queued orchestration run covering this workspace, site, and evidence type."""
        active_states = {
            RunState.QUEUED.value,
            RunState.STARTING.value,
            RunState.SCANNING.value,
            RunState.ANALYZING.value,
            RunState.OBSERVING.value,
            RunState.PLANNING.value,
            RunState.EXECUTING.value,
            RunState.VERIFYING.value,
            RunState.MONITORING.value,
            RunState.RETRY_WAIT.value,
        }
        target_run_type = EVIDENCE_TYPE_TO_RUN_TYPE.get(evidence_type, RunType.ON_DEMAND_SCAN).value

        # Search provided list first
        if active_runs is not None:
            for r in active_runs:
                if (
                    r.workspace_id == workspace_id
                    and (site_id is None or r.site_id == site_id)
                    and r.state in active_states
                    and r.run_type == target_run_type
                ):
                    return r

        # Fallback to database query if available
        if db is not None:
            q = (
                db.query(OrchestrationRun)
                .filter(
                    OrchestrationRun.workspace_id == workspace_id,
                    OrchestrationRun.state.in_(active_states),
                    OrchestrationRun.run_type == target_run_type,
                )
            )
            if site_id is not None:
                q = q.filter(OrchestrationRun.site_id == site_id)
            return q.first()

        return None
