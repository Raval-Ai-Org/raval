"""
Score Explanation & Analytics Data Layer (Task 8 - Step 8.7)

Builds human-readable, structured score explanations on top of the deterministic
scoring engine and provides structured, analytics-ready page and historical data models.

Explanation Traceability Flow:
OVERALL SCORE -> CATEGORY -> RULE -> FINDING -> EVIDENCE -> DEDUCTION

Strict Invariants:
1. EVIDENCE != CONCLUSION: Explanations are strictly grounded in observed evidence.
2. AUDITABLE & EXPLAINABLE: Transparent breakdown of overall score, category scores,
   deductions, strengths, N/A rules, and UNKNOWN missing-data areas.
3. HISTORICAL PRESERVATION: Supports multi-scan historical coexistence without destructive overwriting.
"""

from copy import deepcopy
from datetime import datetime, timezone
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from .applicability_engine import ApplicabilityContext
from .priority_engine import PrioritizedRecommendation
from .scoring_engine import (
    CategoryScoreResult,
    DeterministicScoreResult,
    ScoreContribution,
    ScoringCategory,
)


class DeductionDetail(BaseModel):
    """Structured detail of a single score deduction."""
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    rule_id: str = Field(..., description="Rule identifier")
    category: str = Field(..., description="Category affected")
    point_deduction: float = Field(..., description="Overall score points deducted (positive value)")
    status: str = Field(..., description="Evaluation status (fail, warning)")
    reason: str = Field(..., description="Human-readable explanation of deduction")
    evidence_excerpt: Any | None = Field(default=None, description="Supporting evidence excerpt")
    finding_id: str | None = Field(default=None, description="Associated finding ID if applicable")
    remedy_hint: str | None = Field(default=None, description="Short remediation hint")


class CategoryExplanation(BaseModel):
    """Human-readable explanation for a specific category score."""
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    category: str = Field(..., description="Category key")
    name: str = Field(..., description="Display name")
    score: float = Field(..., description="Category score (0-100)")
    weight: float = Field(..., description="Category weight in overall score")
    total_points_lost: float = Field(default=0.0, description="Total points lost in category (100 - score)")
    status: str = Field(..., description="Health status (optimal, adequate, needs_improvement, deficient)")
    summary: str = Field(..., description="Category narrative summary")
    key_strengths: list[str] = Field(default_factory=list, description="Key passing rules/strengths in category")
    key_deductions: list[DeductionDetail] = Field(default_factory=list, description="Key point deductions in category")


class ScoreExplanationResponse(BaseModel):
    """
    Complete Structured Score Explanation Response Model.
    """
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    overall_score: float = Field(..., description="Calculated overall score (0-100)")
    status: str = Field(..., description="Overall health tier (optimal, adequate, needs_improvement, deficient)")
    summary: str = Field(..., description="High-level narrative summary of score and primary drivers")
    category_explanations: dict[str, CategoryExplanation] = Field(default_factory=dict, description="Explanations per category")
    deductions: list[DeductionDetail] = Field(default_factory=list, description="All active point deductions")
    strengths: list[dict[str, Any]] = Field(default_factory=list, description="Verified passing rules with evidence")
    na_rules: list[dict[str, Any]] = Field(default_factory=list, description="Rules marked N/A with rationale")
    unknown_rules: list[dict[str, Any]] = Field(default_factory=list, description="Rules marked UNKNOWN due to missing data")
    traceability_summary: dict[str, Any] = Field(default_factory=dict, description="Audit and provenance summary")
    metadata: dict[str, Any] = Field(default_factory=dict, description="Execution metadata")


class PageScoreAnalytics(BaseModel):
    """
    Analytics-ready structured data model for a page score evaluation.
    Suitable for relational persistence and historical comparison.
    """
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    page_id: int | None = Field(default=None, description="Page identifier")
    url: str | None = Field(default=None, description="Page URL")
    scan_id: int | None = Field(default=None, description="Scan / Run identifier")
    website_id: int | None = Field(default=None, description="Website identifier")
    overall_score: float = Field(..., description="Overall score (0-100)")
    status: str = Field(..., description="Health status (optimal, adequate, needs_improvement, deficient)")
    category_scores: dict[str, float] = Field(default_factory=dict, description="Category scores mapped by key")
    finding_counts: dict[str, int] = Field(default_factory=dict, description="Finding counts by category and severity")
    priority_counts: dict[str, int] = Field(default_factory=dict, description="Counts of Critical, High, Medium, Low, Info")
    recommendation_counts: dict[str, int] = Field(default_factory=dict, description="Counts of total, quick_wins, deep_fixes")
    applicability_counts: dict[str, int] = Field(default_factory=dict, description="Counts of pass, fail, warning, na, unknown")
    total_points_deducted: float = Field(default=0.0, description="Sum of overall points deducted")
    timestamp: str = Field(..., description="ISO 8601 evaluation timestamp")
    metadata: dict[str, Any] = Field(default_factory=dict, description="Auxiliary analytics metadata")


class ScoreExplanationEngine:
    """
    Score Explanation & Analytics Engine (Step 8.7).
    """

    def build_explanation(
        self,
        score_result: DeterministicScoreResult,
        context: ApplicabilityContext | None = None,
    ) -> ScoreExplanationResponse:
        """
        Builds a comprehensive, evidence-grounded score explanation.
        """
        category_explanations: dict[str, CategoryExplanation] = {}
        all_deductions: list[DeductionDetail] = []
        strengths: list[dict[str, Any]] = []
        na_rules: list[dict[str, Any]] = []
        unknown_rules: list[dict[str, Any]] = []

        # 1. Process each category and build category explanations
        for cat_key, cat_res in score_result.category_scores.items():
            cat_strengths: list[str] = []
            cat_deductions: list[DeductionDetail] = []

            for contrib in cat_res.contributions:
                rule_clean = contrib.rule_id.replace("_", " ").title()

                if contrib.is_skipped:
                    if contrib.skip_reason == "not_applicable":
                        na_rules.append({
                            "rule_id": contrib.rule_id,
                            "category": cat_key,
                            "reason": contrib.rationale,
                            "source_module": contrib.source_module,
                        })
                    elif contrib.skip_reason == "insufficient_data":
                        unknown_rules.append({
                            "rule_id": contrib.rule_id,
                            "category": cat_key,
                            "reason": contrib.rationale,
                            "source_module": contrib.source_module,
                        })
                    continue

                if contrib.status in ("pass", "passed", "verified", "detected", "supported"):
                    strengths.append({
                        "rule_id": contrib.rule_id,
                        "category": cat_key,
                        "title": f"Verified {rule_clean}",
                        "evidence": deepcopy(contrib.evidence),
                        "source_module": contrib.source_module,
                    })
                    cat_strengths.append(f"Verified {rule_clean}")

                elif contrib.is_penalized:
                    point_loss = round(abs(contrib.overall_point_impact), 2)
                    deduction = DeductionDetail(
                        rule_id=contrib.rule_id,
                        category=cat_key,
                        point_deduction=point_loss,
                        status=contrib.status,
                        reason=contrib.rationale,
                        evidence_excerpt=deepcopy(contrib.evidence),
                        finding_id=contrib.finding_id,
                        remedy_hint=f"Resolve condition for rule '{contrib.rule_id}' to recover {point_loss} overall score points.",
                    )
                    cat_deductions.append(deduction)
                    all_deductions.append(deduction)

            # Determine category health status tier
            if cat_res.score >= 80.0:
                cat_status = "optimal"
            elif cat_res.score >= 65.0:
                cat_status = "adequate"
            elif cat_res.score >= 50.0:
                cat_status = "needs_improvement"
            else:
                cat_status = "deficient"

            # Formulate category summary narrative
            total_points_lost = round(100.0 - cat_res.score, 2)
            if cat_res.score >= 90.0:
                cat_narrative = f"Strong compliance in {cat_res.name} with {len(cat_strengths)} verified requirements."
            elif cat_res.score >= 70.0:
                cat_narrative = f"Good performance in {cat_res.name}, with {len(cat_deductions)} minor areas for optimization."
            elif cat_res.score >= 50.0:
                cat_narrative = f"Moderate performance in {cat_res.name}. Incurred {total_points_lost} points lost across {len(cat_deductions)} issues."
            else:
                cat_narrative = f"Critical gaps in {cat_res.name}. Significant point deductions ({total_points_lost} points lost) detected."

            category_explanations[cat_key] = CategoryExplanation(
                category=cat_key,
                name=cat_res.name,
                score=cat_res.score,
                weight=cat_res.weight,
                total_points_lost=total_points_lost,
                status=cat_status,
                summary=cat_narrative,
                key_strengths=cat_strengths[:5],
                key_deductions=cat_deductions,
            )

        # 2. Sort all deductions by point deduction impact descending
        all_deductions.sort(key=lambda d: d.point_deduction, reverse=True)

        # 3. Formulate Overall Narrative Summary
        total_lost = round(100.0 - score_result.overall_score, 2)
        if score_result.overall_score >= 80.0:
            overall_summary = (
                f"Page achieved an Optimal score of {score_result.overall_score}/100. "
                f"Demonstrates strong compliance across {len(strengths)} verified intelligence rules."
            )
        elif score_result.overall_score >= 65.0:
            overall_summary = (
                f"Page achieved an Adequate score of {score_result.overall_score}/100. "
                f"Total deduction of {total_lost} points across {len(all_deductions)} actionable issues."
            )
        elif score_result.overall_score >= 50.0:
            overall_summary = (
                f"Page achieved a Needs Improvement score of {score_result.overall_score}/100. "
                f"Key areas for remediation identified in {len(all_deductions)} rules."
            )
        else:
            overall_summary = (
                f"Page achieved a Deficient score of {score_result.overall_score}/100. "
                f"Substantial structural gaps and non-compliant signals detected ({len(all_deductions)} deductions)."
            )

        # 4. Provenance / Audit Summary
        traceability_summary = {
            "total_signals_evaluated": score_result.total_signals_evaluated,
            "total_rules_applicable": score_result.total_rules_applicable,
            "total_penalties_applied": score_result.total_penalties_applied,
            "total_duplicates_prevented": score_result.total_duplicates_prevented,
            "total_na_rules": len(na_rules),
            "total_unknown_rules": len(unknown_rules),
            "total_strengths": len(strengths),
        }

        return ScoreExplanationResponse(
            overall_score=score_result.overall_score,
            status=score_result.status,
            summary=overall_summary,
            category_explanations=category_explanations,
            deductions=all_deductions,
            strengths=strengths,
            na_rules=na_rules,
            unknown_rules=unknown_rules,
            traceability_summary=traceability_summary,
            metadata=deepcopy(score_result.metadata),
        )

    def generate_page_analytics(
        self,
        score_result: DeterministicScoreResult,
        recommendations: list[PrioritizedRecommendation] | None = None,
        page_id: int | None = None,
        url: str | None = None,
        scan_id: int | None = None,
        website_id: int | None = None,
    ) -> PageScoreAnalytics:
        """
        Generates a structured, analytics-ready record for historical storage and comparison.
        """
        recs = recommendations or []

        # Category scores map
        cat_scores = {
            cat_key: cat_res.score
            for cat_key, cat_res in score_result.category_scores.items()
        }

        # Applicability status counts
        pass_count = sum(c.passed_count for c in score_result.category_scores.values())
        fail_count = sum(c.failed_count for c in score_result.category_scores.values())
        warn_count = sum(c.warning_count for c in score_result.category_scores.values())
        na_count = sum(c.na_count for c in score_result.category_scores.values())
        unk_count = sum(c.unknown_count for c in score_result.category_scores.values())

        applicability_counts = {
            "pass": pass_count,
            "fail": fail_count,
            "warning": warn_count,
            "na": na_count,
            "unknown": unk_count,
        }

        # Priority counts from recommendations
        priority_counts = {
            "critical": sum(1 for r in recs if r.priority == "critical"),
            "high": sum(1 for r in recs if r.priority == "high"),
            "medium": sum(1 for r in recs if r.priority == "medium"),
            "low": sum(1 for r in recs if r.priority == "low"),
            "info": sum(1 for r in recs if r.priority == "info"),
        }

        # Recommendation counts
        quick_wins = sum(1 for r in recs if r.classification == "quick_win")
        deep_fixes = sum(1 for r in recs if r.classification == "deep_fix")
        rec_counts = {
            "total": len(recs),
            "quick_wins": quick_wins,
            "deep_fixes": deep_fixes,
        }

        # Finding counts by category
        finding_counts: dict[str, int] = {}
        for c in score_result.traceability_chain:
            if c.is_penalized and not c.is_skipped:
                finding_counts[c.category] = finding_counts.get(c.category, 0) + 1

        total_points_deducted = round(100.0 - score_result.overall_score, 2)
        timestamp = datetime.now(timezone.utc).isoformat()

        return PageScoreAnalytics(
            page_id=page_id,
            url=url,
            scan_id=scan_id,
            website_id=website_id,
            overall_score=score_result.overall_score,
            status=score_result.status,
            category_scores=cat_scores,
            finding_counts=finding_counts,
            priority_counts=priority_counts,
            recommendation_counts=rec_counts,
            applicability_counts=applicability_counts,
            total_points_deducted=total_points_deducted,
            timestamp=timestamp,
            metadata=deepcopy(score_result.metadata),
        )


# Global singleton instance & convenience functions
_DEFAULT_EXPLANATION_ENGINE = ScoreExplanationEngine()


def explain_score(
    score_result: DeterministicScoreResult,
    context: ApplicabilityContext | None = None,
) -> ScoreExplanationResponse:
    """Convenience helper to build a score explanation."""
    return _DEFAULT_EXPLANATION_ENGINE.build_explanation(score_result, context=context)


def build_page_analytics(
    score_result: DeterministicScoreResult,
    recommendations: list[PrioritizedRecommendation] | None = None,
    page_id: int | None = None,
    url: str | None = None,
    scan_id: int | None = None,
    website_id: int | None = None,
) -> PageScoreAnalytics:
    """Convenience helper to generate page analytics."""
    return _DEFAULT_EXPLANATION_ENGINE.generate_page_analytics(
        score_result=score_result,
        recommendations=recommendations,
        page_id=page_id,
        url=url,
        scan_id=scan_id,
        website_id=website_id,
    )
