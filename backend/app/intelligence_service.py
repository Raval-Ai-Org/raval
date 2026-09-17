"""
Intelligence Service (Task 8 - Steps 8.6 - 8.8)

Centralized service coordinating the entire intelligence pipeline:
Applicability
-> Rule Evaluation
-> Finding
-> Score Deduction
-> Category Score
-> Overall Score
-> Priority
-> Recommendation
-> Explanation
-> Page Analytics
-> Site Aggregation
-> Historical Analytics
-> API
"""

from copy import deepcopy
from datetime import datetime, timezone
from typing import Any
from sqlalchemy.orm import Session
from sqlalchemy import desc

from .applicability_engine import ApplicabilityContext, evaluate_applicability
from .models import Finding, PageResult, Recommendation, Scan, Website
from .priority_engine import (
    FindingPriority,
    PrioritizedRecommendation,
    PriorityEngine,
    generate_prioritized_recommendations,
)
from .score_explanation import (
    PageScoreAnalytics,
    ScoreExplanationEngine,
    ScoreExplanationResponse,
    build_page_analytics,
    explain_score,
)
from .scoring_engine import (
    DeterministicScoreResult,
    DeterministicScoringEngine,
    calculate_deterministic_score,
)
from .signal_aggregator import aggregate_signals
from .site_aggregator import (
    SiteAggregator,
    SiteScoreSummary,
    aggregate_site_scores,
)
from .unified_signal import UnifiedSignal, UniversalSignalNormalizer, normalize_signal


def collect_signals_for_page(
    db: Session,
    page: PageResult,
) -> list[UnifiedSignal]:
    """
    Collects and normalizes all available signals and findings for a given PageResult.
    """
    raw_inputs: list[Any] = []

    # 1. Existing database findings for this page
    findings = db.query(Finding).filter(Finding.page_id == page.id).all()
    raw_inputs.extend(findings)

    # 2. Page Extraction Evidence if present
    if page.extraction:
        raw_inputs.append(page.extraction)

    # 3. Fallback / direct normalization of findings
    signals: list[UnifiedSignal] = []
    for item in raw_inputs:
        try:
            norm = normalize_signal(item)
            if isinstance(norm, list):
                signals.extend(norm)
            elif isinstance(norm, UnifiedSignal):
                signals.append(norm)
        except Exception:
            continue

    return signals


def evaluate_page_intelligence_score(
    db: Session,
    page_id: int,
    additional_signals: list[Any] | None = None,
) -> tuple[DeterministicScoreResult, ScoreExplanationResponse, list[PrioritizedRecommendation], PageScoreAnalytics]:
    """
    Evaluates a page result end-to-end and returns:
    - DeterministicScoreResult
    - ScoreExplanationResponse
    - list[PrioritizedRecommendation]
    - PageScoreAnalytics
    """
    page = db.get(PageResult, page_id)
    if not page:
        raise ValueError(f"PageResult with id {page_id} not found")

    # 1. Collect and normalize signals
    signals = collect_signals_for_page(db, page)
    if additional_signals:
        for s in additional_signals:
            norm = normalize_signal(s)
            if isinstance(norm, list):
                signals.extend(norm)
            elif isinstance(norm, UnifiedSignal):
                signals.append(norm)

    # 2. Build applicability context from page data
    context = ApplicabilityContext.from_page_data(
        url=page.url,
        text_content=page.content or "",
        raw_html=page.content or "",
        page_type=None,
    )

    # 3. Aggregate & deduplicate signals
    aggregated_collection = aggregate_signals(signals)

    # 4. Evaluate applicability
    evaluated_collection = evaluate_applicability(aggregated_collection.signals, context=context)
    if isinstance(evaluated_collection, list):
        evaluated_signals = evaluated_collection
    elif hasattr(evaluated_collection, "signals"):
        evaluated_signals = evaluated_collection.signals
    else:
        evaluated_signals = list(evaluated_collection)

    # 5. Calculate deterministic score
    score_result = calculate_deterministic_score(evaluated_signals, context=context)

    # 6. Generate prioritized recommendations (Quick Wins vs Deep Fixes)
    recommendations = generate_prioritized_recommendations(score_result, findings=page.findings)

    # 7. Build score explanation
    explanation = explain_score(score_result, context=context)

    # 8. Generate analytics record
    analytics = build_page_analytics(
        score_result=score_result,
        recommendations=recommendations,
        page_id=page.id,
        url=page.url,
        scan_id=page.scan_id,
        website_id=page.scan.website_id if page.scan else None,
    )

    return score_result, explanation, recommendations, analytics


def evaluate_site_intelligence_summary(
    db: Session,
    website_id: int,
    scan_id: int | None = None,
) -> SiteScoreSummary:
    """
    Aggregates intelligence across all pages of a website for a given scan (or the latest completed scan).
    """
    website = db.get(Website, website_id)
    if not website:
        raise ValueError(f"Website with id {website_id} not found")

    target_scan = None
    if scan_id is not None:
        target_scan = db.get(Scan, scan_id)
        if not target_scan or target_scan.website_id != website_id:
            raise ValueError(f"Scan with id {scan_id} for website {website_id} not found")
    else:
        # Get latest completed scan, or latest scan overall
        target_scan = (
            db.query(Scan)
            .filter(Scan.website_id == website_id)
            .order_by(desc(Scan.id))
            .first()
        )

    if not target_scan:
        # No scans performed yet -> Return safe 0-page baseline
        return aggregate_site_scores([], website_id=website_id, scan_id=None)

    # Fetch all pages for target scan
    pages = (
        db.query(PageResult)
        .filter(PageResult.scan_id == target_scan.id)
        .all()
    )

    page_analytics_list: list[PageScoreAnalytics] = []
    all_recommendations: list[PrioritizedRecommendation] = []

    for page in pages:
        try:
            _, _, recs, analytics = evaluate_page_intelligence_score(db, page.id)
            page_analytics_list.append(analytics)
            all_recommendations.extend(recs)
        except Exception:
            continue

    # Fetch previous scan summary for historical delta comparison if exists
    prev_scan = (
        db.query(Scan)
        .filter(Scan.website_id == website_id, Scan.id < target_scan.id)
        .order_by(desc(Scan.id))
        .first()
    )

    previous_summary = None
    if prev_scan:
        prev_pages = db.query(PageResult).filter(PageResult.scan_id == prev_scan.id).all()
        prev_analytics_list: list[PageScoreAnalytics] = []
        for pp in prev_pages:
            try:
                _, _, _, p_analytics = evaluate_page_intelligence_score(db, pp.id)
                prev_analytics_list.append(p_analytics)
            except Exception:
                continue
        if prev_analytics_list:
            previous_summary = aggregate_site_scores(prev_analytics_list, website_id=website_id, scan_id=prev_scan.id)

    return aggregate_site_scores(
        pages_analytics=page_analytics_list,
        website_id=website_id,
        scan_id=target_scan.id,
        all_recommendations=all_recommendations,
        previous_summary=previous_summary,
    )


def get_site_score_history(
    db: Session,
    website_id: int,
) -> list[dict[str, Any]]:
    """
    Fetches historical site-level scores across all scans for a given website.
    """
    website = db.get(Website, website_id)
    if not website:
        raise ValueError(f"Website with id {website_id} not found")

    scans = (
        db.query(Scan)
        .filter(Scan.website_id == website_id)
        .order_by(Scan.id.asc())
        .all()
    )

    history: list[dict[str, Any]] = []
    for scan in scans:
        pages = db.query(PageResult).filter(PageResult.scan_id == scan.id).all()
        page_analytics: list[PageScoreAnalytics] = []
        for p in pages:
            try:
                _, _, _, a = evaluate_page_intelligence_score(db, p.id)
                page_analytics.append(a)
            except Exception:
                continue

        summary = aggregate_site_scores(page_analytics, website_id=website_id, scan_id=scan.id)
        cat_scores = {
            k: v.average_score for k, v in summary.category_summaries.items()
        }
        history.append({
            "scan_id": scan.id,
            "timestamp": scan.completed_at.isoformat() if scan.completed_at else summary.timestamp,
            "overall_score": summary.overall_site_score,
            "site_status": summary.site_status,
            "category_scores": cat_scores,
        })

    return history
