"""
Monitoring Pipeline Orchestration Service (Task 10 Step 7).
End-to-end monitoring execution connecting QuerySet -> Provider Adapter -> Response Capture
-> Mention/Citation Detection -> Visibility Signals -> Visibility Gaps -> Visibility Metrics -> Results.
"""

from datetime import datetime, timezone
from enum import Enum
from typing import Any, Sequence

from sqlalchemy.orm import Session

from .ai_response_service import AIResponseService
from .mention_citation_service import MentionCitationService
from .models import (
    AICitation,
    AIMention,
    AIMonitoringRun,
    AIResponse,
    AIVisibilityGap,
    AIVisibilityObservation,
    Finding,
    Query,
    QuerySet,
    Website,
)
from .visibility_gap_service import VisibilityGapService
from .visibility_metrics_service import VisibilityMetricsService
from .visibility_signal_service import VisibilitySignalService


class MonitoringRunStatus(str, Enum):
    CREATED = "CREATED"
    RUNNING = "RUNNING"
    COMPLETED = "COMPLETED"
    PARTIAL = "PARTIAL"
    FAILED = "FAILED"


class MonitoringPipelineService:
    """
    Orchestrates end-to-end monitoring runs across reusable query sets.
    """

    @staticmethod
    def start_monitoring_run(
        db: Session,
        query_set_id: int,
        provider: str = "mock",
        model: str | None = None,
        query_ids: list[int] | None = None,
        mock_responses: list[str] | None = None,
    ) -> AIMonitoringRun:
        """
        Executes an end-to-end monitoring run over active queries in a QuerySet.
        """
        query_set = db.get(QuerySet, query_set_id)
        if not query_set:
            raise ValueError(f"QuerySet with ID {query_set_id} not found")

        # 1. Create run in CREATED state
        now = datetime.now(timezone.utc)
        run = AIMonitoringRun(
            website_id=query_set.website_id,
            query_set_id=query_set.id,
            provider=provider,
            model=model,
            status=MonitoringRunStatus.CREATED.value,
            created_at=now,
        )
        db.add(run)
        db.commit()
        db.refresh(run)

        # 2. Transition to RUNNING
        run.status = MonitoringRunStatus.RUNNING.value
        run.started_at = datetime.now(timezone.utc)
        db.commit()

        # 3. Load active queries
        q_filter = db.query(Query).filter(
            Query.query_set_id == query_set_id,
            Query.active.is_(True),
        )

        if query_ids:
            q_filter = q_filter.filter(Query.id.in_(query_ids))

        active_queries: list[Query] = q_filter.order_by(Query.id.asc()).all()
        run.total_queries = len(active_queries)

        # 4. Handle empty active query set
        if run.total_queries == 0:
            run.attempted_queries = 0
            run.successful_responses = 0
            run.failed_responses = 0
            run.status = MonitoringRunStatus.COMPLETED.value
            run.completed_at = datetime.now(timezone.utc)
            run.execution_metadata_json = {
                "message": "No active queries found in query set",
                "response_ids": [],
            }
            db.commit()
            db.refresh(run)
            return run

        attempted = 0
        successful = 0
        failed = 0
        mentions_count = 0
        citations_count = 0
        gaps_count = 0
        response_ids: list[int] = []
        errors: list[dict[str, Any]] = []

        # 5. Bounded Query Execution Loop
        for i, q in enumerate(active_queries):
            attempted += 1
            mock_text = None
            if mock_responses and len(mock_responses) > 0:
                mock_text = mock_responses[i % len(mock_responses)]

            try:
                # Step 2: Provider Execution & Response Capture
                resp = AIResponseService.execute_query_response(
                    db=db,
                    query_id=q.id,
                    provider=provider,
                    model=model,
                    mock_custom_text=mock_text,
                )

                response_ids.append(resp.id)

                resp_status = (resp.status or "SUCCESS").upper()
                if resp_status == "SUCCESS" and resp.response_text:
                    successful += 1

                    # Step 3: Mention & Citation Detection
                    det_result = MentionCitationService.process_and_persist_detection(
                        db=db,
                        response_id=resp.id,
                    )
                    mentions_count += len(det_result.mentions)
                    citations_count += len(det_result.citations)

                    # Step 4: Visibility & Competitor Signals
                    VisibilitySignalService.process_and_persist_observation(
                        db=db,
                        response_id=resp.id,
                    )

                    # Step 5: Visibility Gap Analysis & Finding Linkage
                    gap_records = VisibilityGapService.process_and_persist_gaps(
                        db=db,
                        response_id=resp.id,
                    )
                    gaps_count += len(gap_records)
                else:
                    failed += 1
                    errors.append({
                        "query_id": q.id,
                        "query_text": q.query_text,
                        "status": resp.status,
                        "error": resp.error_message or "Provider returned empty or failed response",
                    })

            except Exception as e:
                failed += 1
                errors.append({
                    "query_id": q.id,
                    "query_text": q.query_text,
                    "status": "ERROR",
                    "error": str(e),
                })

        db.commit()

        # 6. Step 6: Observational Metrics Calculation
        metrics_summary = VisibilityMetricsService.calculate_visibility_metrics(
            db=db,
            website_id=query_set.website_id,
            query_set_id=query_set.id,
            provider=provider,
            start_date=run.started_at,
        )

        # 7. Final Status & Summary Update
        run.attempted_queries = attempted
        run.successful_responses = successful
        run.failed_responses = failed
        run.detected_mentions = mentions_count
        run.detected_citations = citations_count
        run.detected_gaps = gaps_count
        run.mention_rate = metrics_summary.mention_metrics.rate
        run.citation_rate = metrics_summary.citation_metrics.rate
        run.completed_at = datetime.now(timezone.utc)

        if failed == 0:
            run.status = MonitoringRunStatus.COMPLETED.value
        elif successful > 0:
            run.status = MonitoringRunStatus.PARTIAL.value
        else:
            run.status = MonitoringRunStatus.FAILED.value
            run.error_message = "All queries in monitoring run failed"

        run.execution_metadata_json = {
            "response_ids": response_ids,
            "errors": errors,
            "metrics": metrics_summary.to_dict(),
        }

        db.commit()
        db.refresh(run)
        return run

    @staticmethod
    def get_monitoring_run(
        db: Session,
        run_id: int,
    ) -> AIMonitoringRun | None:
        """Retrieves a monitoring run by ID."""
        return db.get(AIMonitoringRun, run_id)

    @staticmethod
    def get_monitoring_run_results(
        db: Session,
        run_id: int,
    ) -> dict[str, Any]:
        """
        Retrieves comprehensive itemized results for a monitoring run.
        """
        run = db.get(AIMonitoringRun, run_id)
        if not run:
            raise ValueError(f"AIMonitoringRun with ID {run_id} not found")

        meta = run.execution_metadata_json or {}
        response_ids = meta.get("response_ids", [])

        responses: list[AIResponse] = []
        if response_ids:
            responses = (
                db.query(AIResponse)
                .filter(AIResponse.id.in_(response_ids))
                .order_by(AIResponse.id.asc())
                .all()
            )

        items: list[dict[str, Any]] = []
        for r in responses:
            q = db.get(Query, r.query_id)
            mentions = db.query(AIMention).filter(AIMention.response_id == r.id).all()
            citations = db.query(AICitation).filter(AICitation.response_id == r.id).all()
            obs = db.query(AIVisibilityObservation).filter(AIVisibilityObservation.response_id == r.id).first()
            gaps = db.query(AIVisibilityGap).filter(AIVisibilityGap.response_id == r.id).all()

            gap_details = []
            for g in gaps:
                linked = []
                for link in g.finding_links:
                    f = db.get(Finding, link.finding_id)
                    linked.append({
                        "finding_id": link.finding_id,
                        "match_type": link.match_type,
                        "confidence": link.confidence,
                        "reasons": link.reasons_json or [],
                        "finding_title": f.title if f else None,
                        "finding_category": f.category if f else None,
                    })
                gap_details.append({
                    "id": g.id,
                    "gap_type": g.gap_type,
                    "severity": g.severity,
                    "reason": g.reason,
                    "evidence": g.evidence_json or {},
                    "linked_findings": linked,
                })

            item = {
                "response_id": r.id,
                "query_id": q.id if q else r.query_id,
                "query_text": q.query_text if q else None,
                "intent": q.intent if q else None,
                "topic": q.topic if q else None,
                "priority": q.priority if q else None,
                "provider": r.provider,
                "model": r.model,
                "status": r.status,
                "latency_ms": r.latency_ms,
                "total_tokens": r.total_tokens,
                "target_mentioned": obs.target_mentioned if obs else False,
                "target_cited": obs.target_cited if obs else False,
                "first_party_cited": obs.first_party_cited if obs else False,
                "relevant_answer": obs.relevant_answer if obs else "UNKNOWN",
                "competitors_present": obs.competitors_present if obs else False,
                "competitor_signals": obs.competitor_signals_json if obs else [],
                "mentions_count": len(mentions),
                "citations_count": len(citations),
                "gaps": gap_details,
            }
            items.append(item)

        return {
            "run_id": run.id,
            "website_id": run.website_id,
            "query_set_id": run.query_set_id,
            "provider": run.provider,
            "model": run.model,
            "status": run.status,
            "total_queries": run.total_queries,
            "attempted_queries": run.attempted_queries,
            "successful_responses": run.successful_responses,
            "failed_responses": run.failed_responses,
            "detected_mentions": run.detected_mentions,
            "detected_citations": run.detected_citations,
            "detected_gaps": run.detected_gaps,
            "mention_rate": run.mention_rate,
            "citation_rate": run.citation_rate,
            "error_message": run.error_message,
            "metrics": meta.get("metrics", {}),
            "errors": meta.get("errors", []),
            "items": items,
            "started_at": run.started_at.isoformat() if run.started_at else None,
            "completed_at": run.completed_at.isoformat() if run.completed_at else None,
            "created_at": run.created_at.isoformat(),
        }

    @staticmethod
    def list_monitoring_runs(
        db: Session,
        website_id: int,
        query_set_id: int | None = None,
        status: str | None = None,
        limit: int = 100,
        offset: int = 0,
    ) -> list[AIMonitoringRun]:
        """Lists historical monitoring runs with filtering and pagination."""
        q = db.query(AIMonitoringRun).filter(AIMonitoringRun.website_id == website_id)
        if query_set_id is not None:
            q = q.filter(AIMonitoringRun.query_set_id == query_set_id)
        if status is not None:
            q = q.filter(AIMonitoringRun.status == status.upper())
        return q.order_by(AIMonitoringRun.created_at.desc()).offset(offset).limit(limit).all()
