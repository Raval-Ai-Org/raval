"""
AI Visibility Metrics and Historical Analytics Engine (Task 10 Step 6).
Computes deterministic, traceable observational metrics across captured AI provider responses
with failure-isolated denominators, multi-dimensional slicing, and historical period comparisons.
"""

from dataclasses import dataclass, field
from datetime import datetime, timezone
import math
from typing import Any, Sequence

from sqlalchemy.orm import Session

from .models import (
    AIResponse,
    AIVisibilityGap,
    AIVisibilityObservation,
    AIVisibilitySnapshot,
    Query,
    QuerySet,
    Website,
)


# ==========================================
# Data Structures
# ==========================================


@dataclass
class MetricRate:
    numerator: int
    denominator: int
    rate: float | None

    def to_dict(self) -> dict[str, Any]:
        return {
            "numerator": self.numerator,
            "denominator": self.denominator,
            "rate": round(self.rate, 4) if self.rate is not None else None,
        }


@dataclass
class TargetVsCompetitorStats:
    target_mentioned_count: int = 0
    target_cited_count: int = 0
    competitor_present_count: int = 0
    target_absent_competitor_present_count: int = 0
    target_present_competitor_absent_count: int = 0
    both_present_count: int = 0
    neither_present_count: int = 0

    def to_dict(self) -> dict[str, Any]:
        return {
            "target_mentioned_count": self.target_mentioned_count,
            "target_cited_count": self.target_cited_count,
            "competitor_present_count": self.competitor_present_count,
            "target_absent_competitor_present_count": self.target_absent_competitor_present_count,
            "target_present_competitor_absent_count": self.target_present_competitor_absent_count,
            "both_present_count": self.both_present_count,
            "neither_present_count": self.neither_present_count,
        }


@dataclass
class OperationalHealthMetrics:
    total_attempts: int = 0
    successful_responses: int = 0
    timeout_count: int = 0
    rate_limit_count: int = 0
    unavailable_count: int = 0
    error_count: int = 0
    success_rate: float | None = None
    avg_latency_ms: float | None = None
    total_input_tokens: int = 0
    total_output_tokens: int = 0
    total_tokens: int = 0

    def to_dict(self) -> dict[str, Any]:
        return {
            "total_attempts": self.total_attempts,
            "successful_responses": self.successful_responses,
            "timeout_count": self.timeout_count,
            "rate_limit_count": self.rate_limit_count,
            "unavailable_count": self.unavailable_count,
            "error_count": self.error_count,
            "success_rate": round(self.success_rate, 4) if self.success_rate is not None else None,
            "avg_latency_ms": round(self.avg_latency_ms, 1) if self.avg_latency_ms is not None else None,
            "total_input_tokens": self.total_input_tokens,
            "total_output_tokens": self.total_output_tokens,
            "total_tokens": self.total_tokens,
        }


@dataclass
class CompetitorMetricItem:
    competitor_name: str
    domain: str | None = None
    mention_count: int = 0
    citation_count: int = 0
    appearance_count: int = 0
    appearance_rate: float | None = None
    first_mention_position_avg: float | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "competitor_name": self.competitor_name,
            "domain": self.domain,
            "mention_count": self.mention_count,
            "citation_count": self.citation_count,
            "appearance_count": self.appearance_count,
            "appearance_rate": round(self.appearance_rate, 4) if self.appearance_rate is not None else None,
            "first_mention_position_avg": round(self.first_mention_position_avg, 1) if self.first_mention_position_avg is not None else None,
        }


@dataclass
class VisibilityMetricsSummary:
    website_id: int
    query_set_id: int | None = None
    query_id: int | None = None
    provider: str | None = None
    model: str | None = None
    total_attempts: int = 0
    evaluable_responses: int = 0
    failed_responses: int = 0
    mention_metrics: MetricRate = field(default_factory=lambda: MetricRate(0, 0, None))
    citation_metrics: MetricRate = field(default_factory=lambda: MetricRate(0, 0, None))
    first_party_citation_metrics: MetricRate = field(default_factory=lambda: MetricRate(0, 0, None))
    relevant_answer_metrics: MetricRate = field(default_factory=lambda: MetricRate(0, 0, None))
    competitor_appearance_metrics: MetricRate = field(default_factory=lambda: MetricRate(0, 0, None))
    target_vs_competitor: TargetVsCompetitorStats = field(default_factory=TargetVsCompetitorStats)
    operational_health: OperationalHealthMetrics = field(default_factory=OperationalHealthMetrics)
    top_competitors: list[CompetitorMetricItem] = field(default_factory=list)
    gap_summary: dict[str, Any] = field(default_factory=dict)
    response_ids: list[int] = field(default_factory=list)
    period_start: datetime | None = None
    period_end: datetime | None = None
    calculated_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    def to_dict(self) -> dict[str, Any]:
        return {
            "website_id": self.website_id,
            "query_set_id": self.query_set_id,
            "query_id": self.query_id,
            "provider": self.provider,
            "model": self.model,
            "total_attempts": self.total_attempts,
            "evaluable_responses": self.evaluable_responses,
            "failed_responses": self.failed_responses,
            "mention_metrics": self.mention_metrics.to_dict(),
            "citation_metrics": self.citation_metrics.to_dict(),
            "first_party_citation_metrics": self.first_party_citation_metrics.to_dict(),
            "relevant_answer_metrics": self.relevant_answer_metrics.to_dict(),
            "competitor_appearance_metrics": self.competitor_appearance_metrics.to_dict(),
            "target_vs_competitor": self.target_vs_competitor.to_dict(),
            "operational_health": self.operational_health.to_dict(),
            "top_competitors": [c.to_dict() for c in self.top_competitors],
            "gap_summary": self.gap_summary,
            "response_ids": self.response_ids,
            "period_start": self.period_start.isoformat() if self.period_start else None,
            "period_end": self.period_end.isoformat() if self.period_end else None,
            "calculated_at": self.calculated_at.isoformat(),
        }


@dataclass
class PeriodComparison:
    current: VisibilityMetricsSummary
    previous: VisibilityMetricsSummary
    absolute_change: dict[str, float | None] = field(default_factory=dict)
    relative_change_pct: dict[str, float | None] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "current": self.current.to_dict(),
            "previous": self.previous.to_dict(),
            "absolute_change": self.absolute_change,
            "relative_change_pct": self.relative_change_pct,
        }


@dataclass
class TimelinePoint:
    date: str
    total_attempts: int
    evaluable_responses: int
    mention_rate: float | None
    citation_rate: float | None
    first_party_citation_rate: float | None
    competitor_appearance_rate: float | None

    def to_dict(self) -> dict[str, Any]:
        return {
            "date": self.date,
            "total_attempts": self.total_attempts,
            "evaluable_responses": self.evaluable_responses,
            "mention_rate": round(self.mention_rate, 4) if self.mention_rate is not None else None,
            "citation_rate": round(self.citation_rate, 4) if self.citation_rate is not None else None,
            "first_party_citation_rate": round(self.first_party_citation_rate, 4) if self.first_party_citation_rate is not None else None,
            "competitor_appearance_rate": round(self.competitor_appearance_rate, 4) if self.competitor_appearance_rate is not None else None,
        }


# ==========================================
# Calculation Helpers
# ==========================================


def compute_metric_rate(numerator: int, denominator: int) -> MetricRate:
    """Computes bounded rate and returns MetricRate with safe null handling."""
    if denominator > 0:
        return MetricRate(
            numerator=numerator,
            denominator=denominator,
            rate=numerator / denominator,
        )
    return MetricRate(numerator=numerator, denominator=denominator, rate=None)


def calculate_change(
    current_val: float | None,
    previous_val: float | None,
) -> tuple[float | None, float | None]:
    """
    Computes (absolute_change, relative_change_pct) safely.
    If previous_val is 0 or None, relative change is None.
    """
    if current_val is None or previous_val is None:
        return None, None

    abs_change = round(current_val - previous_val, 4)
    if previous_val > 0:
        rel_change_pct = round(((current_val - previous_val) / previous_val) * 100, 2)
    else:
        rel_change_pct = None

    return abs_change, rel_change_pct


# ==========================================
# Service Layer
# ==========================================


class VisibilityMetricsService:
    """
    Deterministic calculation engine for AI visibility metrics, operational health,
    and historical comparisons.
    """

    @staticmethod
    def calculate_visibility_metrics(
        db: Session,
        website_id: int,
        query_set_id: int | None = None,
        query_id: int | None = None,
        provider: str | None = None,
        model: str | None = None,
        intent: str | None = None,
        topic: str | None = None,
        entity_id: int | None = None,
        page_id: int | None = None,
        start_date: datetime | None = None,
        end_date: datetime | None = None,
    ) -> VisibilityMetricsSummary:
        """
        Calculates comprehensive, deterministic visibility metrics for given filters.
        """
        # Query matching AIResponses
        q = db.query(AIResponse).filter(AIResponse.website_id == website_id)

        if query_set_id is not None:
            q = q.filter(AIResponse.query_set_id == query_set_id)
        if query_id is not None:
            q = q.filter(AIResponse.query_id == query_id)
        if provider is not None:
            q = q.filter(AIResponse.provider == provider)
        if model is not None:
            q = q.filter(AIResponse.model == model)
        if start_date is not None:
            q = q.filter(AIResponse.request_timestamp >= start_date)
        if end_date is not None:
            q = q.filter(AIResponse.request_timestamp <= end_date)

        # Filters involving Query attributes (intent, topic, entity_id, page_id)
        if intent or topic or entity_id or page_id:
            q = q.join(Query, AIResponse.query_id == Query.id)
            if intent:
                q = q.filter(Query.intent == intent)
            if topic:
                q = q.filter(Query.topic == topic)
            if entity_id:
                q = q.filter(Query.entity_id == entity_id)
            if page_id:
                q = q.filter(Query.page_id == page_id)

        responses: list[AIResponse] = q.all()
        response_ids = [r.id for r in responses]

        # 1. Operational Health Metrics
        total_attempts = len(responses)
        successful_responses = 0
        timeout_count = 0
        rate_limit_count = 0
        unavailable_count = 0
        error_count = 0
        latencies: list[int] = []
        input_tokens = 0
        output_tokens = 0
        total_tokens = 0

        evaluable_response_ids: list[int] = []

        for resp in responses:
            status = (resp.status or "SUCCESS").upper()
            if status == "SUCCESS" and resp.response_text:
                successful_responses += 1
                evaluable_response_ids.append(resp.id)
            elif status == "TIMEOUT":
                timeout_count += 1
            elif status == "RATE_LIMITED":
                rate_limit_count += 1
            elif status == "UNAVAILABLE":
                unavailable_count += 1
            else:
                error_count += 1

            if resp.latency_ms is not None and resp.latency_ms > 0:
                latencies.append(resp.latency_ms)
            if resp.input_tokens:
                input_tokens += resp.input_tokens
            if resp.output_tokens:
                output_tokens += resp.output_tokens
            if resp.total_tokens:
                total_tokens += resp.total_tokens

        success_rate = (successful_responses / total_attempts) if total_attempts > 0 else None
        avg_latency = (sum(latencies) / len(latencies)) if latencies else None

        op_health = OperationalHealthMetrics(
            total_attempts=total_attempts,
            successful_responses=successful_responses,
            timeout_count=timeout_count,
            rate_limit_count=rate_limit_count,
            unavailable_count=unavailable_count,
            error_count=error_count,
            success_rate=success_rate,
            avg_latency_ms=avg_latency,
            total_input_tokens=input_tokens,
            total_output_tokens=output_tokens,
            total_tokens=total_tokens,
        )

        failed_responses = total_attempts - successful_responses
        evaluable_count = len(evaluable_response_ids)

        if evaluable_count == 0:
            return VisibilityMetricsSummary(
                website_id=website_id,
                query_set_id=query_set_id,
                query_id=query_id,
                provider=provider,
                model=model,
                total_attempts=total_attempts,
                evaluable_responses=0,
                failed_responses=failed_responses,
                operational_health=op_health,
                response_ids=response_ids,
                period_start=start_date,
                period_end=end_date,
            )

        # 2. Fetch Observations for Evaluable Responses Only
        obs_records: list[AIVisibilityObservation] = (
            db.query(AIVisibilityObservation)
            .filter(AIVisibilityObservation.response_id.in_(evaluable_response_ids))
            .all()
        )

        target_mentions = 0
        target_citations = 0
        first_party_citations = 0
        relevant_answers = 0
        relevance_evaluable = 0
        competitor_appearances = 0

        target_absent_comp_present = 0
        target_present_comp_absent = 0
        both_present = 0
        neither_present = 0

        competitor_map: dict[str, dict[str, Any]] = {}

        for obs in obs_records:
            t_m = obs.target_mentioned
            t_c = obs.target_cited
            fp_c = obs.first_party_cited
            comp_p = obs.competitors_present

            if t_m:
                target_mentions += 1
            if t_c:
                target_citations += 1
            if fp_c:
                first_party_citations += 1

            rel = (obs.relevant_answer or "UNKNOWN").upper()
            if rel in ("RELEVANT", "IRRELEVANT"):
                relevance_evaluable += 1
                if rel == "RELEVANT":
                    relevant_answers += 1

            if comp_p:
                competitor_appearances += 1

            # Combinations
            t_present = t_m or t_c
            if t_present and comp_p:
                both_present += 1
            elif t_present and not comp_p:
                target_present_comp_absent += 1
            elif not t_present and comp_p:
                target_absent_comp_present += 1
            else:
                neither_present += 1

            # Competitor detailed signals
            comp_signals = obs.competitor_signals_json or []
            if isinstance(comp_signals, list):
                for cs in comp_signals:
                    if isinstance(cs, dict) and "competitor_name" in cs:
                        c_name = cs["competitor_name"]
                        if c_name not in competitor_map:
                            competitor_map[c_name] = {
                                "competitor_name": c_name,
                                "domain": cs.get("domain"),
                                "mention_count": 0,
                                "citation_count": 0,
                                "appearance_count": 0,
                                "positions": [],
                            }
                        if cs.get("mentioned"):
                            competitor_map[c_name]["mention_count"] += 1
                        if cs.get("cited"):
                            competitor_map[c_name]["citation_count"] += 1
                        competitor_map[c_name]["appearance_count"] += 1
                        pos = cs.get("first_mention_position")
                        if pos is not None:
                            competitor_map[c_name]["positions"].append(pos)

        # 3. Compute Rates
        mention_metrics = compute_metric_rate(target_mentions, evaluable_count)
        citation_metrics = compute_metric_rate(target_citations, evaluable_count)
        first_party_citation_metrics = compute_metric_rate(first_party_citations, evaluable_count)
        relevant_answer_metrics = compute_metric_rate(relevant_answers, relevance_evaluable)
        competitor_appearance_metrics = compute_metric_rate(competitor_appearances, evaluable_count)

        target_vs_comp = TargetVsCompetitorStats(
            target_mentioned_count=target_mentions,
            target_cited_count=target_citations,
            competitor_present_count=competitor_appearances,
            target_absent_competitor_present_count=target_absent_comp_present,
            target_present_competitor_absent_count=target_present_comp_absent,
            both_present_count=both_present,
            neither_present_count=neither_present,
        )

        # Competitor list
        top_competitors: list[CompetitorMetricItem] = []
        for c_data in competitor_map.values():
            app_rate = (c_data["appearance_count"] / evaluable_count) if evaluable_count > 0 else None
            avg_pos = (sum(c_data["positions"]) / len(c_data["positions"])) if c_data["positions"] else None
            top_competitors.append(
                CompetitorMetricItem(
                    competitor_name=c_data["competitor_name"],
                    domain=c_data["domain"],
                    mention_count=c_data["mention_count"],
                    citation_count=c_data["citation_count"],
                    appearance_count=c_data["appearance_count"],
                    appearance_rate=app_rate,
                    first_mention_position_avg=avg_pos,
                )
            )
        top_competitors.sort(key=lambda x: x.appearance_count, reverse=True)

        # 4. Gap summary
        gaps: list[AIVisibilityGap] = (
            db.query(AIVisibilityGap)
            .filter(AIVisibilityGap.response_id.in_(evaluable_response_ids))
            .all()
        )
        gap_counts: dict[str, int] = {}
        for g in gaps:
            gap_counts[g.gap_type] = gap_counts.get(g.gap_type, 0) + 1

        gap_summary = {
            "total_gaps": len(gaps),
            "gap_type_counts": gap_counts,
        }

        return VisibilityMetricsSummary(
            website_id=website_id,
            query_set_id=query_set_id,
            query_id=query_id,
            provider=provider,
            model=model,
            total_attempts=total_attempts,
            evaluable_responses=evaluable_count,
            failed_responses=failed_responses,
            mention_metrics=mention_metrics,
            citation_metrics=citation_metrics,
            first_party_citation_metrics=first_party_citation_metrics,
            relevant_answer_metrics=relevant_answer_metrics,
            competitor_appearance_metrics=competitor_appearance_metrics,
            target_vs_competitor=target_vs_comp,
            operational_health=op_health,
            top_competitors=top_competitors,
            gap_summary=gap_summary,
            response_ids=response_ids,
            period_start=start_date,
            period_end=end_date,
        )

    @staticmethod
    def calculate_provider_metrics_breakdown(
        db: Session,
        website_id: int,
        query_set_id: int | None = None,
        start_date: datetime | None = None,
        end_date: datetime | None = None,
    ) -> dict[str, VisibilityMetricsSummary]:
        """
        Calculates separate visibility metrics for each distinct provider observed.
        """
        q = db.query(AIResponse.provider).filter(AIResponse.website_id == website_id)
        if query_set_id is not None:
            q = q.filter(AIResponse.query_set_id == query_set_id)
        if start_date is not None:
            q = q.filter(AIResponse.request_timestamp >= start_date)
        if end_date is not None:
            q = q.filter(AIResponse.request_timestamp <= end_date)

        distinct_providers = [p[0] for p in q.distinct().all() if p[0]]

        breakdown: dict[str, VisibilityMetricsSummary] = {}
        for prov in distinct_providers:
            breakdown[prov] = VisibilityMetricsService.calculate_visibility_metrics(
                db=db,
                website_id=website_id,
                query_set_id=query_set_id,
                provider=prov,
                start_date=start_date,
                end_date=end_date,
            )

        return breakdown

    @staticmethod
    def compare_visibility_periods(
        db: Session,
        website_id: int,
        query_set_id: int | None = None,
        provider: str | None = None,
        current_start: datetime | None = None,
        current_end: datetime | None = None,
        previous_start: datetime | None = None,
        previous_end: datetime | None = None,
    ) -> PeriodComparison:
        """
        Compares visibility metrics between current and previous time periods.
        Computes absolute changes and relative percentage changes safely.
        """
        curr = VisibilityMetricsService.calculate_visibility_metrics(
            db=db,
            website_id=website_id,
            query_set_id=query_set_id,
            provider=provider,
            start_date=current_start,
            end_date=current_end,
        )
        prev = VisibilityMetricsService.calculate_visibility_metrics(
            db=db,
            website_id=website_id,
            query_set_id=query_set_id,
            provider=provider,
            start_date=previous_start,
            end_date=previous_end,
        )

        abs_diffs: dict[str, float | None] = {}
        rel_diffs: dict[str, float | None] = {}

        metrics_to_compare = [
            ("mention_rate", curr.mention_metrics.rate, prev.mention_metrics.rate),
            ("citation_rate", curr.citation_metrics.rate, prev.citation_metrics.rate),
            ("first_party_citation_rate", curr.first_party_citation_metrics.rate, prev.first_party_citation_metrics.rate),
            ("relevant_answer_rate", curr.relevant_answer_metrics.rate, prev.relevant_answer_metrics.rate),
            ("competitor_appearance_rate", curr.competitor_appearance_metrics.rate, prev.competitor_appearance_metrics.rate),
            ("success_rate", curr.operational_health.success_rate, prev.operational_health.success_rate),
        ]

        for name, c_val, p_val in metrics_to_compare:
            abs_chg, rel_chg = calculate_change(c_val, p_val)
            abs_diffs[name] = abs_chg
            rel_diffs[name] = rel_chg

        return PeriodComparison(
            current=curr,
            previous=prev,
            absolute_change=abs_diffs,
            relative_change_pct=rel_diffs,
        )

    @staticmethod
    def generate_visibility_timeline(
        db: Session,
        website_id: int,
        query_set_id: int | None = None,
        provider: str | None = None,
        start_date: datetime | None = None,
        end_date: datetime | None = None,
    ) -> list[TimelinePoint]:
        """
        Generates daily aggregated timeline points of visibility metrics.
        """
        q = db.query(AIResponse).filter(AIResponse.website_id == website_id)
        if query_set_id is not None:
            q = q.filter(AIResponse.query_set_id == query_set_id)
        if provider is not None:
            q = q.filter(AIResponse.provider == provider)
        if start_date is not None:
            q = q.filter(AIResponse.request_timestamp >= start_date)
        if end_date is not None:
            q = q.filter(AIResponse.request_timestamp <= end_date)

        responses: list[AIResponse] = q.order_by(AIResponse.request_timestamp.asc()).all()
        if not responses:
            return []

        # Group responses by ISO date string (YYYY-MM-DD)
        date_groups: dict[str, list[AIResponse]] = {}
        for r in responses:
            dt = r.request_timestamp or r.created_at
            day_str = dt.strftime("%Y-%m-%d")
            if day_str not in date_groups:
                date_groups[day_str] = []
            date_groups[day_str].append(r)

        timeline: list[TimelinePoint] = []
        for day_str, day_responses in date_groups.items():
            total = len(day_responses)
            evaluable_ids = [r.id for r in day_responses if (r.status or "SUCCESS").upper() == "SUCCESS" and r.response_text]
            eval_count = len(evaluable_ids)

            if eval_count == 0:
                timeline.append(
                    TimelinePoint(
                        date=day_str,
                        total_attempts=total,
                        evaluable_responses=0,
                        mention_rate=None,
                        citation_rate=None,
                        first_party_citation_rate=None,
                        competitor_appearance_rate=None,
                    )
                )
                continue

            day_obs: list[AIVisibilityObservation] = (
                db.query(AIVisibilityObservation)
                .filter(AIVisibilityObservation.response_id.in_(evaluable_ids))
                .all()
            )

            m_count = sum(1 for o in day_obs if o.target_mentioned)
            c_count = sum(1 for o in day_obs if o.target_cited)
            fp_count = sum(1 for o in day_obs if o.first_party_cited)
            comp_count = sum(1 for o in day_obs if o.competitors_present)

            timeline.append(
                TimelinePoint(
                    date=day_str,
                    total_attempts=total,
                    evaluable_responses=eval_count,
                    mention_rate=m_count / eval_count,
                    citation_rate=c_count / eval_count,
                    first_party_citation_rate=fp_count / eval_count,
                    competitor_appearance_rate=comp_count / eval_count,
                )
            )

        return timeline

    @staticmethod
    def create_and_persist_snapshot(
        db: Session,
        website_id: int,
        query_set_id: int | None = None,
        provider: str | None = None,
        period_start: datetime | None = None,
        period_end: datetime | None = None,
    ) -> AIVisibilitySnapshot:
        """
        Computes current metrics and persists a historical snapshot record in `ai_visibility_snapshots`.
        """
        now = datetime.now(timezone.utc)
        p_start = period_start or now
        p_end = period_end or now

        summary = VisibilityMetricsService.calculate_visibility_metrics(
            db=db,
            website_id=website_id,
            query_set_id=query_set_id,
            provider=provider,
            start_date=period_start,
            end_date=period_end,
        )

        snapshot = AIVisibilitySnapshot(
            website_id=website_id,
            query_set_id=query_set_id,
            provider=provider,
            period_start=p_start,
            period_end=p_end,
            evaluable_responses=summary.evaluable_responses,
            total_attempts=summary.total_attempts,
            mention_count=summary.mention_metrics.numerator,
            citation_count=summary.citation_metrics.numerator,
            first_party_citation_count=summary.first_party_citation_metrics.numerator,
            competitor_appearance_count=summary.competitor_appearance_metrics.numerator,
            mention_rate=summary.mention_metrics.rate,
            citation_rate=summary.citation_metrics.rate,
            first_party_citation_rate=summary.first_party_citation_metrics.rate,
            competitor_appearance_rate=summary.competitor_appearance_metrics.rate,
            metrics_json=summary.to_dict(),
            created_at=now,
        )
        db.add(snapshot)
        db.commit()
        db.refresh(snapshot)
        return snapshot

    @staticmethod
    def list_snapshots(
        db: Session,
        website_id: int,
        query_set_id: int | None = None,
        limit: int = 100,
        offset: int = 0,
    ) -> list[AIVisibilitySnapshot]:
        """Lists historical visibility snapshots for a website or query set."""
        q = db.query(AIVisibilitySnapshot).filter(AIVisibilitySnapshot.website_id == website_id)
        if query_set_id is not None:
            q = q.filter(AIVisibilitySnapshot.query_set_id == query_set_id)
        return q.order_by(AIVisibilitySnapshot.created_at.desc()).offset(offset).limit(limit).all()
