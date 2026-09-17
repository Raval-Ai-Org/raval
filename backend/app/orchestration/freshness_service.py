"""
Production Orchestration & Monitoring - Freshness Service.

High-level orchestration coordinator for evidence freshness evaluation,
stale evidence overview, and automated refresh job dispatching through
the canonical orchestration state machine and priority queue.
"""

from __future__ import annotations

from datetime import datetime, timezone
import logging
from typing import Any
from uuid import uuid4

from sqlalchemy import desc
from sqlalchemy.orm import Session

from ..models import (
    AICitation,
    AIMention,
    AIMonitoringRun,
    AIResponse,
    MonitoringRecord,
    PageResult,
    Scan,
    ValidationResult,
    Website,
)
from .continuous_monitoring import ContinuousMonitoringService
from .enums import (
    EvidenceType,
    FreshnessState,
    OrchestrationEventType,
    RefreshDecisionType,
    RunState,
    RunType,
    TriggerSource,
)
from .exceptions import SiteMismatchError, TenantMismatchError
from .freshness_evaluator import FreshnessEvaluation, FreshnessEvaluator
from .freshness_policy import FreshnessPolicyRegistry
from .models import ExecutionReceipt, OrchestrationEvent, OrchestrationRun
from .queue import OrchestrationQueue, QueueJob
from .refresh_decision import RefreshDecision, RefreshDecisionEngine, RefreshJobIntent
from .schemas import (
    ActorProvenance,
    EvidenceFreshnessStatusResponse,
    OrchestrationRunCreateRequest,
    RefreshDecisionResponse,
    RefreshTriggerResponse,
    StaleEvidenceOverviewResponse,
)
from .service import OrchestrationService

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


class FreshnessService:
    """
    Coordinates evidence freshness assessment, stale detection, and refresh dispatch.
    Ensures that stale evidence is never silently treated as current or zero.
    """

    def __init__(
        self,
        evaluator: FreshnessEvaluator | None = None,
        decision_engine: RefreshDecisionEngine | None = None,
        policy_registry: FreshnessPolicyRegistry | None = None,
        orchestration_service: OrchestrationService | None = None,
        monitoring_service: ContinuousMonitoringService | None = None,
        queue: OrchestrationQueue | None = None,
    ) -> None:
        self.policy_registry = policy_registry or FreshnessPolicyRegistry()
        self.evaluator = evaluator or FreshnessEvaluator(policy_registry=self.policy_registry)
        self.decision_engine = decision_engine or RefreshDecisionEngine()
        self.orchestration_service = orchestration_service or OrchestrationService()
        self.monitoring_service = monitoring_service or ContinuousMonitoringService()
        self.queue = queue

    def _validate_site(self, workspace_id: str, site_id: int, db: Session) -> Website:
        """Validates site existence and ownership within tenant boundary."""
        site = db.get(Website, site_id)
        if not site:
            raise SiteMismatchError(site_id, f"Website with id {site_id} not found")
        # In current schema Website does not have workspace_id column;
        # if a website has workspace metadata or linkage, validate here
        return site

    def get_latest_observation_timestamps(
        self,
        site_id: int,
        db: Session,
    ) -> dict[EvidenceType, datetime | None]:
        """
        Extracts the most recent observation timestamps across platform tables for a site.
        """
        timestamps: dict[EvidenceType, datetime | None] = {}

        # 1. CRAWL & PAGE_SEO
        latest_scan = (
            db.query(Scan)
            .filter(Scan.website_id == site_id)
            .order_by(desc(Scan.id))
            .first()
        )
        if latest_scan:
            scan_ts = _ensure_utc(latest_scan.completed_at or latest_scan.created_at)
            timestamps[EvidenceType.CRAWL] = scan_ts
            # Page SEO
            latest_page = (
                db.query(PageResult)
                .filter(PageResult.scan_id == latest_scan.id)
                .order_by(desc(PageResult.id))
                .first()
            )
            timestamps[EvidenceType.PAGE_SEO] = (
                _ensure_utc(latest_page.created_at) if latest_page and latest_page.created_at else scan_ts
            )
        else:
            timestamps[EvidenceType.CRAWL] = None
            timestamps[EvidenceType.PAGE_SEO] = None

        # 2. SCORE & SEARCH_PERFORMANCE
        latest_metric = (
            db.query(MonitoringRecord)
            .filter(MonitoringRecord.website_id == site_id)
            .order_by(desc(MonitoringRecord.id))
            .first()
        )
        if latest_metric and latest_metric.recorded_at:
            metric_ts = _ensure_utc(latest_metric.recorded_at)
            timestamps[EvidenceType.SCORE] = metric_ts
            timestamps[EvidenceType.SEARCH_PERFORMANCE] = metric_ts
        else:
            timestamps[EvidenceType.SCORE] = timestamps.get(EvidenceType.CRAWL)
            timestamps[EvidenceType.SEARCH_PERFORMANCE] = None

        # 3. AI_VISIBILITY
        latest_ai_run = (
            db.query(AIMonitoringRun)
            .filter(AIMonitoringRun.website_id == site_id)
            .order_by(desc(AIMonitoringRun.id))
            .first()
        )
        if latest_ai_run:
            timestamps[EvidenceType.AI_VISIBILITY] = _ensure_utc(
                latest_ai_run.completed_at or latest_ai_run.created_at
            )
        else:
            timestamps[EvidenceType.AI_VISIBILITY] = None

        # 4. AI_ANSWER & CITATION
        latest_answer = db.query(AIResponse).order_by(desc(AIResponse.id)).first()
        timestamps[EvidenceType.AI_ANSWER] = (
            _ensure_utc(latest_answer.created_at) if latest_answer and latest_answer.created_at else None
        )

        latest_citation = db.query(AICitation).order_by(desc(AICitation.id)).first()
        timestamps[EvidenceType.CITATION] = (
            _ensure_utc(latest_citation.created_at) if latest_citation and latest_citation.created_at else None
        )

        # 5. VALIDATION
        latest_val = (
            db.query(ValidationResult)
            .filter(ValidationResult.website_id == site_id)
            .order_by(desc(ValidationResult.id))
            .first()
        )
        timestamps[EvidenceType.VALIDATION] = (
            _ensure_utc(latest_val.created_at) if latest_val and latest_val.created_at else None
        )

        # 6. EXECUTION_CHANGE
        latest_rcpt = (
            db.query(ExecutionReceipt)
            .filter(ExecutionReceipt.site_id == site_id)
            .order_by(desc(ExecutionReceipt.created_at))
            .first()
        )
        timestamps[EvidenceType.EXECUTION_CHANGE] = (
            _ensure_utc(latest_rcpt.created_at) if latest_rcpt and latest_rcpt.created_at else None
        )

        # 7. COMPETITOR & EXTERNAL_AUTHORITY
        timestamps[EvidenceType.COMPETITOR] = timestamps.get(EvidenceType.CRAWL)
        timestamps[EvidenceType.EXTERNAL_AUTHORITY] = timestamps.get(EvidenceType.CRAWL)

        return timestamps

    def evaluate_site_freshness(
        self,
        workspace_id: str,
        site_id: int,
        db: Session,
        provider_available: bool = True,
        reference_time: datetime | None = None,
    ) -> list[FreshnessEvaluation]:
        """
        Evaluates the freshness state across all evidence categories for a given website.
        """
        self._validate_site(workspace_id, site_id, db)
        obs_times = self.get_latest_observation_timestamps(site_id, db)
        now = _ensure_utc(reference_time) if reference_time else _utc_now()

        evaluations: list[FreshnessEvaluation] = []
        for etype in EvidenceType:
            obs_dt = obs_times.get(etype)
            evaluation = self.evaluator.evaluate(
                evidence_type=etype,
                observed_at=obs_dt,
                current_time=now,
                provider_available=provider_available,
                workspace_id=workspace_id,
                site_id=site_id,
            )
            evaluations.append(evaluation)

        # Record summary observation in ContinuousMonitoringService
        mon_obs = self.monitoring_service.evaluate_evidence_freshness(
            workspace_id=workspace_id,
            site_id=site_id,
            evaluations=evaluations,
            now=now,
        )
        self.monitoring_service.record_observation(mon_obs, db)

        return evaluations

    def evaluate_and_refresh_site(
        self,
        workspace_id: str,
        site_id: int,
        db: Session,
        queue: OrchestrationQueue | None = None,
        force_refresh: bool = False,
        provider_available: bool = True,
        provenance: ActorProvenance | None = None,
        reference_time: datetime | None = None,
    ) -> list[RefreshDecision]:
        """
        Evaluates site evidence freshness and creates orchestrated refresh runs for any
        stale or expired categories, avoiding duplicate runs.
        """
        self._validate_site(workspace_id, site_id, db)
        now = _ensure_utc(reference_time) if reference_time else _utc_now()
        prov = provenance or ActorProvenance(actor_id="freshness_service", actor_type="system")

        evaluations = self.evaluate_site_freshness(
            workspace_id=workspace_id,
            site_id=site_id,
            db=db,
            provider_available=provider_available,
            reference_time=now,
        )

        decisions: list[RefreshDecision] = []
        for ev in evaluations:
            decision = self.decision_engine.evaluate_decision(
                evaluation=ev,
                workspace_id=workspace_id,
                site_id=site_id,
                is_site_paused=False,
                provider_available=provider_available,
                db=db,
                provenance=prov,
                force_refresh=force_refresh,
                reference_time=now,
            )
            decisions.append(decision)

            # If refresh requested/required and intent provided, dispatch run via orchestrator
            if (
                decision.decision in (RefreshDecisionType.REFRESH_REQUIRED, RefreshDecisionType.REFRESH_RECOMMENDED)
                and decision.job_intent is not None
            ):
                intent = decision.job_intent
                run_req = OrchestrationRunCreateRequest(
                    workspace_id=intent.workspace_id,
                    site_id=intent.site_id,
                    run_type=intent.run_type,
                    trigger_source=TriggerSource.POLICY_EVENT,
                    idempotency_key=intent.idempotency_key,
                    actor_provenance=intent.provenance,
                    metadata_payload=intent.metadata_payload,
                )
                run = self.orchestration_service.create_run(run_req, db)
                logger.info(
                    "Created refresh run '%s' (run_type='%s', idempotency_key='%s') for evidence '%s'",
                    run.id,
                    run.run_type,
                    run.idempotency_key,
                    ev.evidence_type.value,
                )

                # Enqueue into priority queue if queue provided
                if queue is not None:
                    job = QueueJob(
                        run_id=run.id,
                        workspace_id=run.workspace_id,
                        site_id=run.site_id,
                        run_type=run.run_type,
                        priority=intent.priority,
                    )
                    queue.enqueue(job)

                # Emit audit event
                event = OrchestrationEvent(
                    id=f"evt_{uuid4().hex[:16]}",
                    run_id=run.id,
                    stage_id=None,
                    workspace_id=run.workspace_id,
                    site_id=run.site_id,
                    event_type=OrchestrationEventType.REFRESH_REQUESTED.value,
                    from_state=None,
                    to_state=run.state,
                    details={
                        "evidence_type": ev.evidence_type.value,
                        "idempotency_key": intent.idempotency_key,
                        "priority": intent.priority,
                        "reason": decision.reason,
                    },
                    occurred_at=_utc_now(),
                )
                db.add(event)
                db.commit()

        return decisions

    def get_stale_evidence_overview(
        self,
        workspace_id: str,
        db: Session,
        site_id: int | None = None,
    ) -> dict[str, Any]:
        """
        Scans sites within the workspace and returns an overview of stale and expired evidence.
        """
        query = db.query(Website)
        if site_id is not None:
            query = query.filter(Website.id == site_id)
        sites = query.all()

        stale_count = 0
        expired_count = 0
        aging_count = 0
        fresh_count = 0
        total_evaluations = 0
        site_summaries: list[dict[str, Any]] = []

        for s in sites:
            evals = self.evaluate_site_freshness(workspace_id=workspace_id, site_id=s.id, db=db)
            stale_types: list[str] = []
            expired_types: list[str] = []

            for ev in evals:
                total_evaluations += 1
                if ev.freshness_state == FreshnessState.EXPIRED:
                    expired_count += 1
                    expired_types.append(ev.evidence_type.value)
                elif ev.freshness_state == FreshnessState.STALE:
                    stale_count += 1
                    stale_types.append(ev.evidence_type.value)
                elif ev.freshness_state == FreshnessState.AGING:
                    aging_count += 1
                elif ev.freshness_state == FreshnessState.FRESH:
                    fresh_count += 1

            site_summaries.append({
                "site_id": s.id,
                "site_name": s.name,
                "stale_categories": stale_types,
                "expired_categories": expired_types,
                "is_healthy": (len(stale_types) == 0 and len(expired_types) == 0),
            })

        return {
            "workspace_id": workspace_id,
            "total_sites": len(sites),
            "total_categories_evaluated": total_evaluations,
            "fresh_count": fresh_count,
            "aging_count": aging_count,
            "stale_count": stale_count,
            "expired_count": expired_count,
            "site_summaries": site_summaries,
            "evaluated_at": _utc_now().isoformat(),
        }

    def discover_observation_timestamp(
        self,
        db: Session,
        tenant_id: str = "default",
        site_id: int = 1,
        evidence_type: EvidenceType | str = EvidenceType.CRAWL,
    ) -> datetime | None:
        etype = EvidenceType(evidence_type) if isinstance(evidence_type, str) else evidence_type
        timestamps = self.get_latest_observation_timestamps(site_id, db)
        return timestamps.get(etype)

    def get_site_freshness_overview(
        self,
        db: Session,
        tenant_id: str = "default",
        site_id: int | None = None,
        workspace_id: str | None = None,
        as_of: datetime | None = None,
    ) -> StaleEvidenceOverviewResponse:
        ws = tenant_id or workspace_id or "default"
        target_site_id = site_id or 1
        self._validate_site(ws, target_site_id, db)
        evals = self.evaluate_site_freshness(
            workspace_id=ws,
            site_id=target_site_id,
            db=db,
            reference_time=as_of,
        )

        stale_count = 0
        expired_count = 0
        aging_count = 0
        fresh_count = 0
        unknown_count = 0
        items: list[dict[str, Any]] = []

        for ev in evals:
            items.append(ev.to_dict())
            if ev.freshness_state == FreshnessState.EXPIRED:
                expired_count += 1
            elif ev.freshness_state == FreshnessState.STALE:
                stale_count += 1
            elif ev.freshness_state == FreshnessState.AGING:
                aging_count += 1
            elif ev.freshness_state == FreshnessState.FRESH:
                fresh_count += 1
            elif ev.freshness_state == FreshnessState.UNKNOWN:
                unknown_count += 1

        requires_refresh = stale_count + expired_count + unknown_count
        now_str = (as_of or _utc_now()).isoformat()

        return StaleEvidenceOverviewResponse(
            workspace_id=ws,
            tenant_id=ws,
            site_id=target_site_id,
            total_sites=1,
            total_categories_evaluated=len(evals),
            fresh_count=fresh_count,
            aging_count=aging_count,
            stale_count=stale_count,
            expired_count=expired_count,
            unknown_count=unknown_count,
            requires_refresh_count=requires_refresh,
            items=items,
            site_summaries=[{
                "site_id": target_site_id,
                "fresh_count": fresh_count,
                "stale_count": stale_count,
                "expired_count": expired_count,
                "unknown_count": unknown_count,
            }],
            evaluated_at=now_str,
        )

    def evaluate_refresh_decisions(
        self,
        db: Session,
        tenant_id: str = "default",
        site_id: int = 1,
        evidence_types: list[EvidenceType | str] | None = None,
        force: bool = False,
        workspace_id: str | None = None,
        as_of: datetime | None = None,
    ) -> RefreshDecisionResponse:
        ws = tenant_id or workspace_id or "default"
        self._validate_site(ws, site_id, db)
        now = _ensure_utc(as_of) if as_of else _utc_now()

        all_types = (
            [EvidenceType(e) if isinstance(e, str) else e for e in evidence_types]
            if evidence_types
            else list(EvidenceType)
        )

        decisions_list: list[dict[str, Any]] = []
        obs_times = self.get_latest_observation_timestamps(site_id, db)
        overall_decision = "NO_ACTION"

        for etype in all_types:
            obs_dt = obs_times.get(etype)
            evaluation = self.evaluator.evaluate(
                evidence_type=etype,
                observed_at=obs_dt,
                current_time=now,
                workspace_id=ws,
                site_id=site_id,
            )
            decision = self.decision_engine.evaluate_decision(
                evaluation=evaluation,
                workspace_id=ws,
                site_id=site_id,
                force_refresh=force,
                reference_time=now,
            )
            dec_dict = decision.to_dict()
            decisions_list.append(dec_dict)
            if decision.decision == RefreshDecisionType.REFRESH_REQUIRED:
                overall_decision = "REFRESH_REQUIRED"
            elif decision.decision == RefreshDecisionType.REFRESH_RECOMMENDED and overall_decision != "REFRESH_REQUIRED":
                overall_decision = "REFRESH_RECOMMENDED"

        return RefreshDecisionResponse(
            decision=overall_decision,
            evidence_type=all_types[0].value if all_types else "",
            reason=f"Evaluated {len(decisions_list)} evidence categories",
            decided_at=now.isoformat(),
            site_id=site_id,
            decisions=decisions_list,
        )

    def trigger_refresh_runs(
        self,
        db: Session,
        tenant_id: str = "default",
        site_id: int = 1,
        evidence_types: list[EvidenceType | str] | None = None,
        force: bool = False,
        actor: ActorProvenance | None = None,
        workspace_id: str | None = None,
        as_of: datetime | None = None,
    ) -> RefreshTriggerResponse:
        ws = tenant_id or workspace_id or "default"
        self._validate_site(ws, site_id, db)
        now = _ensure_utc(as_of) if as_of else _utc_now()
        prov = actor or ActorProvenance(actor_id="freshness_service", actor_type="system")

        all_types = (
            [EvidenceType(e) if isinstance(e, str) else e for e in evidence_types]
            if evidence_types
            else list(EvidenceType)
        )

        created_run_ids: list[str] = []
        deduplicated_count = 0
        decisions: list[RefreshDecisionResponse] = []
        obs_times = self.get_latest_observation_timestamps(site_id, db)

        for etype in all_types:
            obs_dt = obs_times.get(etype)
            evaluation = self.evaluator.evaluate(
                evidence_type=etype,
                observed_at=obs_dt,
                current_time=now,
                workspace_id=ws,
                site_id=site_id,
            )
            decision = self.decision_engine.evaluate_decision(
                evaluation=evaluation,
                workspace_id=ws,
                site_id=site_id,
                force_refresh=force,
                reference_time=now,
                provenance=prov,
            )

            dec_resp = RefreshDecisionResponse(
                decision=decision.decision.value,
                evidence_type=etype.value,
                reason=decision.reason,
                decided_at=now.isoformat(),
                active_run_id=decision.active_run_id,
                job_intent=decision.job_intent.to_dict() if decision.job_intent else None,
            )
            decisions.append(dec_resp)

            if decision.decision in (RefreshDecisionType.REFRESH_REQUIRED, RefreshDecisionType.REFRESH_RECOMMENDED):
                if decision.job_intent:
                    intent = decision.job_intent
                    existing_run = (
                        db.query(OrchestrationRun)
                        .filter(
                            OrchestrationRun.workspace_id == ws,
                            OrchestrationRun.site_id == site_id,
                            OrchestrationRun.idempotency_key == intent.idempotency_key,
                        )
                        .first()
                    )
                    if existing_run:
                        deduplicated_count += 1
                        continue

                    run_req = OrchestrationRunCreateRequest(
                        workspace_id=intent.workspace_id,
                        site_id=intent.site_id,
                        run_type=intent.run_type,
                        trigger_source=TriggerSource.FRESHNESS_CONTROLLER,
                        idempotency_key=intent.idempotency_key,
                        actor_provenance=prov,
                        metadata_payload=intent.metadata_payload,
                    )
                    run = self.orchestration_service.create_run(run_req, db)
                    created_run_ids.append(run.id)

                    if self.queue is not None:
                        job = QueueJob(
                            run_id=run.id,
                            workspace_id=run.workspace_id,
                            site_id=run.site_id,
                            run_type=run.run_type,
                            priority=intent.priority,
                        )
                        self.queue.enqueue(job)

                    event = OrchestrationEvent(
                        id=f"evt_{uuid4().hex[:16]}",
                        run_id=run.id,
                        stage_id=None,
                        workspace_id=run.workspace_id,
                        site_id=run.site_id,
                        event_type=OrchestrationEventType.REFRESH_REQUESTED.value,
                        from_state=None,
                        to_state=run.state,
                        details={
                            "evidence_type": etype.value,
                            "idempotency_key": intent.idempotency_key,
                            "priority": intent.priority,
                            "reason": decision.reason,
                        },
                        occurred_at=_utc_now(),
                    )
                    db.add(event)
                    db.commit()
            elif decision.decision == RefreshDecisionType.REFRESH_ALREADY_RUNNING:
                deduplicated_count += 1

        return RefreshTriggerResponse(
            workspace_id=ws,
            tenant_id=ws,
            site_id=site_id,
            decisions=decisions,
            created_runs_count=len(created_run_ids),
            created_run_ids=created_run_ids,
            deduplicated_count=deduplicated_count,
        )
