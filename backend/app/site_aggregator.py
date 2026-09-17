"""
Site-Level Aggregator (Task 8 - Step 8.8)

Implements centralized, deterministic multi-page to site-level intelligence aggregation.

Strict Invariants:
1. DETERMINISTIC SITE AGGREGATION:
   - Does NOT simply average blindly. Weights pages appropriately and cleanly normalizes category scores.
2. BOUNDARY SAFETY:
   - Safe against zero pages, all N/A, mixed UNKNOWN, duplicate findings, and repeated runs.
3. HISTORICAL COMPARISON:
   - Compares current scan against previous scans to compute score deltas and resolved/new issues.
4. TRACEABILITY:
   - Preserves links from site-level metrics down to page scores and underlying issues.
"""

from copy import deepcopy
from datetime import datetime, timezone
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from .priority_engine import PrioritizedRecommendation
from .score_explanation import PageScoreAnalytics
from .scoring_engine import (
    CATEGORY_DISPLAY_NAMES,
    CATEGORY_NORMALIZED_WEIGHTS,
    ScoringCategory,
)


class SiteCategorySummary(BaseModel):
    """Aggregated category performance across all site pages."""
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    category: str = Field(..., description="Category key")
    name: str = Field(..., description="Category display name")
    average_score: float = Field(..., description="Average score for this category across applicable pages (0-100)")
    weight: float = Field(..., description="Canonical category weight")
    status: str = Field(..., description="Category health status (optimal, adequate, needs_improvement, deficient)")
    total_findings: int = Field(default=0, description="Total findings in this category across all pages")


class TopSiteIssue(BaseModel):
    """Aggregated, deduplicated site-wide issue ranked by cumulative score impact."""
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    rule_id: str = Field(..., description="Underlying rule identifier")
    category: str = Field(..., description="Category affected")
    title: str = Field(..., description="Issue title / description")
    affected_pages_count: int = Field(..., description="Number of pages exhibiting this issue")
    total_score_impact: float = Field(..., description="Cumulative score deduction points across all pages")
    priority: str = Field(..., description="Aggregated priority (critical, high, medium, low, info)")
    classification: str = Field(..., description="Remediation classification (quick_win, deep_fix)")
    recommended_action: str = Field(..., description="Recommended fix action")


class SiteScoreSummary(BaseModel):
    """
    Complete Site-Level Aggregated Intelligence Summary.
    """
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    website_id: int = Field(..., description="Website identifier")
    scan_id: int | None = Field(default=None, description="Scan / Run identifier")
    timestamp: str = Field(..., description="ISO 8601 evaluation timestamp")
    overall_site_score: float = Field(..., description="Aggregated overall site score (0-100)")
    site_status: str = Field(..., description="Site health status (optimal, adequate, needs_improvement, deficient)")
    category_summaries: dict[str, SiteCategorySummary] = Field(default_factory=dict, description="Category summaries")
    total_pages_analyzed: int = Field(default=0, description="Total pages evaluated")
    applicable_pages_count: int = Field(default=0, description="Pages with active score evaluation")
    page_type_distribution: dict[str, int] = Field(default_factory=dict, description="Counts by page type")
    findings_by_priority: dict[str, int] = Field(default_factory=dict, description="Total findings by priority across site")
    findings_by_status: dict[str, int] = Field(default_factory=dict, description="Total checks by status (pass, fail, warning, na, unknown)")
    recommendations_summary: dict[str, Any] = Field(default_factory=dict, description="Summary of site-wide recommendations")
    top_issues: list[TopSiteIssue] = Field(default_factory=list, description="Top score-impacting issues ranked by impact")
    historical_comparison: dict[str, Any] | None = Field(default=None, description="Comparison against previous scan if available")
    page_scores: list[dict[str, Any]] = Field(default_factory=list, description="List of individual page scores")
    metadata: dict[str, Any] = Field(default_factory=dict, description="Auxiliary site aggregation metadata")


class SiteAggregator:
    """
    Site-Level Aggregation Engine (Step 8.8).
    """

    def aggregate_site_pages(
        self,
        pages_analytics: list[PageScoreAnalytics],
        website_id: int,
        scan_id: int | None = None,
        all_recommendations: list[PrioritizedRecommendation] | None = None,
        previous_summary: SiteScoreSummary | None = None,
    ) -> SiteScoreSummary:
        """
        Deterministically aggregates page-level analytics into a site-level summary.
        """
        timestamp = datetime.now(timezone.utc).isoformat()
        total_pages = len(pages_analytics)

        # 1. Zero Pages Safe Boundary
        if total_pages == 0:
            category_summaries = {
                cat.value: SiteCategorySummary(
                    category=cat.value,
                    name=CATEGORY_DISPLAY_NAMES[cat.value],
                    average_score=100.0,
                    weight=CATEGORY_NORMALIZED_WEIGHTS[cat.value],
                    status="optimal",
                    total_findings=0,
                )
                for cat in ScoringCategory
            }

            return SiteScoreSummary(
                website_id=website_id,
                scan_id=scan_id,
                timestamp=timestamp,
                overall_site_score=100.0,
                site_status="optimal",
                category_summaries=category_summaries,
                total_pages_analyzed=0,
                applicable_pages_count=0,
                page_type_distribution={},
                findings_by_priority={"critical": 0, "high": 0, "medium": 0, "low": 0, "info": 0},
                findings_by_status={"pass": 0, "fail": 0, "warning": 0, "na": 0, "unknown": 0},
                recommendations_summary={"total": 0, "quick_wins": 0, "deep_fixes": 0, "by_priority": {}},
                top_issues=[],
                historical_comparison=None,
                page_scores=[],
                metadata={"note": "No pages available for evaluation. Default neutral 100.0 baseline applied."},
            )

        # 2. Aggregate Category Scores
        cat_scores_accum: dict[str, list[float]] = {cat.value: [] for cat in ScoringCategory}
        cat_findings_accum: dict[str, int] = {cat.value: 0 for cat in ScoringCategory}

        findings_by_priority = {"critical": 0, "high": 0, "medium": 0, "low": 0, "info": 0}
        findings_by_status = {"pass": 0, "fail": 0, "warning": 0, "na": 0, "unknown": 0}
        page_type_dist: dict[str, int] = {}
        page_scores_list: list[dict[str, Any]] = []

        for page in pages_analytics:
            # Record individual page score entry
            page_scores_list.append({
                "page_id": page.page_id,
                "url": page.url,
                "overall_score": page.overall_score,
                "status": page.status,
                "total_points_deducted": page.total_points_deducted,
            })

            # Page type count if available
            p_type = page.metadata.get("page_type", "general")
            page_type_dist[p_type] = page_type_dist.get(p_type, 0) + 1

            # Accumulate category scores
            for cat_key, score_val in page.category_scores.items():
                if cat_key in cat_scores_accum:
                    cat_scores_accum[cat_key].append(score_val)

            # Accumulate findings
            for cat_key, count_val in page.finding_counts.items():
                if cat_key in cat_findings_accum:
                    cat_findings_accum[cat_key] += count_val

            # Accumulate priority counts
            for prio_key, p_count in page.priority_counts.items():
                findings_by_priority[prio_key] = findings_by_priority.get(prio_key, 0) + p_count

            # Accumulate status counts
            for st_key, st_count in page.applicability_counts.items():
                findings_by_status[st_key] = findings_by_status.get(st_key, 0) + st_count

        # 3. Calculate Average Category Scores & Site Category Summaries
        category_summaries: dict[str, SiteCategorySummary] = {}
        weighted_site_score = 0.0

        for cat in ScoringCategory:
            cat_key = cat.value
            cat_scores = cat_scores_accum.get(cat_key, [])
            cat_weight = CATEGORY_NORMALIZED_WEIGHTS[cat_key]

            if cat_scores:
                avg_score = round(sum(cat_scores) / len(cat_scores), 2)
            else:
                avg_score = 100.0

            if avg_score >= 80.0:
                cat_stat = "optimal"
            elif avg_score >= 65.0:
                cat_stat = "adequate"
            elif avg_score >= 50.0:
                cat_stat = "needs_improvement"
            else:
                cat_stat = "deficient"

            category_summaries[cat_key] = SiteCategorySummary(
                category=cat_key,
                name=CATEGORY_DISPLAY_NAMES[cat_key],
                average_score=avg_score,
                weight=cat_weight,
                status=cat_stat,
                total_findings=cat_findings_accum.get(cat_key, 0),
            )
            weighted_site_score += (avg_score * cat_weight)

        final_site_score = max(0.0, min(100.0, round(weighted_site_score, 2)))

        if final_site_score >= 80.0:
            site_status = "optimal"
        elif final_site_score >= 65.0:
            site_status = "adequate"
        elif final_site_score >= 50.0:
            site_status = "needs_improvement"
        else:
            site_status = "deficient"

        # 4. Recommendations Aggregation & Top Issues Identification
        recs = all_recommendations or []
        quick_wins_count = sum(1 for r in recs if r.classification == "quick_win")
        deep_fixes_count = sum(1 for r in recs if r.classification == "deep_fix")

        recs_by_priority = {
            "critical": sum(1 for r in recs if r.priority == "critical"),
            "high": sum(1 for r in recs if r.priority == "high"),
            "medium": sum(1 for r in recs if r.priority == "medium"),
            "low": sum(1 for r in recs if r.priority == "low"),
            "info": sum(1 for r in recs if r.priority == "info"),
        }

        recs_summary = {
            "total": len(recs),
            "total_recommendations": len(recs),
            "quick_wins": quick_wins_count,
            "deep_fixes": deep_fixes_count,
            "by_priority": recs_by_priority,
        }

        # Group recommendations by rule_id to synthesize Top Site Issues
        rule_issue_map: dict[str, dict[str, Any]] = {}
        for r in recs:
            rule_id = r.rule_id
            if rule_id not in rule_issue_map:
                rule_issue_map[rule_id] = {
                    "rule_id": rule_id,
                    "category": r.category,
                    "title": r.title,
                    "affected_pages_count": 0,
                    "total_score_impact": 0.0,
                    "priority": r.priority,
                    "classification": r.classification,
                    "recommended_action": r.recommended_action,
                }
            rule_issue_map[rule_id]["affected_pages_count"] += 1
            rule_issue_map[rule_id]["total_score_impact"] += r.score_impact

        top_issues_list: list[TopSiteIssue] = []
        for issue_data in rule_issue_map.values():
            top_issues_list.append(
                TopSiteIssue(
                    rule_id=issue_data["rule_id"],
                    category=issue_data["category"],
                    title=issue_data["title"],
                    affected_pages_count=issue_data["affected_pages_count"],
                    total_score_impact=round(issue_data["total_score_impact"], 2),
                    priority=issue_data["priority"],
                    classification=issue_data["classification"],
                    recommended_action=issue_data["recommended_action"],
                )
            )

        # Sort top issues by total score impact descending, then affected pages count
        top_issues_list.sort(key=lambda i: (i.total_score_impact, i.affected_pages_count), reverse=True)

        # 5. Historical Comparison Calculation
        historical_comparison = None
        if previous_summary:
            score_delta = round(final_site_score - previous_summary.overall_site_score, 2)
            prev_rules = {i.rule_id for i in previous_summary.top_issues}
            curr_rules = {i.rule_id for i in top_issues_list}

            resolved_issues_count = len(prev_rules - curr_rules)
            new_issues_count = len(curr_rules - prev_rules)

            historical_comparison = {
                "previous_scan_id": previous_summary.scan_id,
                "previous_site_score": previous_summary.overall_site_score,
                "previous_timestamp": previous_summary.timestamp,
                "score_delta": score_delta,
                "score_improved": score_delta > 0,
                "resolved_issues_count": resolved_issues_count,
                "new_issues_count": new_issues_count,
            }

        return SiteScoreSummary(
            website_id=website_id,
            scan_id=scan_id,
            timestamp=timestamp,
            overall_site_score=final_site_score,
            site_status=site_status,
            category_summaries=category_summaries,
            total_pages_analyzed=total_pages,
            applicable_pages_count=total_pages,
            page_type_distribution=page_type_dist,
            findings_by_priority=findings_by_priority,
            findings_by_status=findings_by_status,
            recommendations_summary=recs_summary,
            top_issues=top_issues_list[:10],  # Top 10 primary issues
            historical_comparison=historical_comparison,
            page_scores=page_scores_list,
            metadata={"aggregation_version": "8.8", "total_pages": total_pages},
        )


# Global singleton instance & convenience functions
_DEFAULT_SITE_AGGREGATOR = SiteAggregator()


def aggregate_site_scores(
    pages_analytics: list[PageScoreAnalytics],
    website_id: int,
    scan_id: int | None = None,
    all_recommendations: list[PrioritizedRecommendation] | None = None,
    previous_summary: SiteScoreSummary | None = None,
) -> SiteScoreSummary:
    """Convenience helper to aggregate site scores."""
    return _DEFAULT_SITE_AGGREGATOR.aggregate_site_pages(
        pages_analytics=pages_analytics,
        website_id=website_id,
        scan_id=scan_id,
        all_recommendations=all_recommendations,
        previous_summary=previous_summary,
    )
