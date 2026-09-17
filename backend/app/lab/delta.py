"""
Score & Finding Delta Engine (Task 12 Step 3).

Provides deterministic calculation of score deltas across categories and tracks
finding lifecycle transitions (OPEN -> RESOLVED, STILL_OPEN, INCONCLUSIVE, NEW_REGRESSION)
with full provenance and explicit disclaimers.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from enum import Enum
from typing import Any
from pydantic import BaseModel, ConfigDict, Field

from .verifier import FixVerificationResult, VerificationOutcome

logger = logging.getLogger(__name__)

SCORE_DISCLAIMER: str = (
    "Score improvement represents a change in Raval's deterministic measurement model "
    "and is NOT proof of external search ranking, traffic, conversion, citation, or AI visibility improvement."
)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


class ScoreDeltaReport(BaseModel):
    """
    Mathematical comparison of before and after intelligence scores.
    """

    model_config = ConfigDict(extra="ignore")

    before_score: float = Field(..., description="Overall model score before remediation")
    after_score: float = Field(..., description="Overall model score after remediation")
    overall_delta: float = Field(..., description="Net delta (after - before)")
    category_deltas: dict[str, dict[str, float]] = Field(
        default_factory=dict, description="Category-level before/after/delta values"
    )
    disclaimer: str = Field(default=SCORE_DISCLAIMER, description="Mandatory measurement model disclaimer")

    @property
    def overall_score_delta(self) -> float:
        return self.overall_delta

    @property
    def overall_score_before(self) -> float:
        return self.before_score

    @property
    def overall_score_after(self) -> float:
        return self.after_score
    
    @property
    def score_before(self) -> float:
        return self.before_score

    @property
    def score_after(self) -> float:
        return self.after_score


class FindingTransitionState(str, Enum):
    """Lifecycle transition state for an individual finding."""

    OPEN_TO_RESOLVED = "OPEN_TO_RESOLVED"
    OPEN_TO_STILL_OPEN = "OPEN_TO_STILL_OPEN"
    OPEN_TO_INCONCLUSIVE = "OPEN_TO_INCONCLUSIVE"
    NEW_REGRESSION = "NEW_REGRESSION"


class FindingDeltaItem(BaseModel):
    """
    Detailed transition tracking for an individual finding.
    """

    model_config = ConfigDict(extra="ignore")

    finding_id: str = Field(..., description="Finding identifier")
    rule_id: str = Field(..., description="Associated engine rule code")
    transition: FindingTransitionState = Field(..., description="Observed transition")
    severity_before: str | None = Field(default=None, description="Severity in baseline")
    severity_after: str | None = Field(default=None, description="Severity in after state")
    evidence_ref_before: str | None = Field(default=None, description="Baseline evidence reference ID")
    evidence_ref_after: str | None = Field(default=None, description="After evidence reference ID")
    execution_id: str = Field(default="exec_unknown", description="Execution ID")
    timestamp: datetime = Field(default_factory=_utc_now, description="UTC timestamp of transition evaluation")
    notes: str | None = Field(default=None, description="Additional context or explanation")


class FindingDeltaReport(BaseModel):
    """
    Aggregated report tracking all finding transitions.
    """

    model_config = ConfigDict(extra="ignore")

    total_evaluated: int = Field(default=0, description="Total count of findings evaluated")
    resolved_count: int = Field(default=0, description="Count of findings resolved")
    still_open_count: int = Field(default=0, description="Count of findings remaining open")
    inconclusive_count: int = Field(default=0, description="Count of inconclusive finding determinations")
    new_regressions_count: int = Field(default=0, description="Count of newly introduced regression findings")
    transitions: list[FindingDeltaItem] = Field(default_factory=list, description="List of finding transition records")

    @property
    def resolved_findings_count(self) -> int:
        return self.resolved_count

    @property
    def resolved_findings(self) -> list[FindingDeltaItem]:
        return [t for t in self.transitions if t.transition == FindingTransitionState.OPEN_TO_RESOLVED]


def calculate_score_delta(
    before_score_data: dict[str, Any] | None,
    after_score_data: dict[str, Any] | None,
) -> ScoreDeltaReport:
    """
    Computes exact before/after/delta for overall score and all category scores.
    """
    b_score = float(before_score_data.get("overall_score", 100.0)) if before_score_data else 100.0
    a_score = float(after_score_data.get("overall_score", 100.0)) if after_score_data else 100.0
    overall_delta = round(a_score - b_score, 2)

    b_cats = before_score_data.get("category_scores", {}) if before_score_data else {}
    a_cats = after_score_data.get("category_scores", {}) if after_score_data else {}

    all_cat_keys = set(b_cats.keys()).union(set(a_cats.keys()))
    category_deltas: dict[str, dict[str, float]] = {}

    for cat in sorted(all_cat_keys):
        b_val = float(b_cats.get(cat, 100.0))
        a_val = float(a_cats.get(cat, 100.0))
        category_deltas[cat] = {
            "before": round(b_val, 2),
            "after": round(a_val, 2),
            "delta": round(a_val - b_val, 2),
        }

    return ScoreDeltaReport(
        before_score=round(b_score, 2),
        after_score=round(a_score, 2),
        overall_delta=overall_delta,
        category_deltas=category_deltas,
        disclaimer=SCORE_DISCLAIMER,
    )


def calculate_finding_delta(
    findings_before: list[dict[str, Any]],
    findings_after: list[dict[str, Any]],
    verification_results: list[FixVerificationResult] | None = None,
    execution_id: str = "exec_unknown",
    baseline_evidence_id: str | None = None,
    after_evidence_id: str | None = None,
) -> FindingDeltaReport:
    """
    Computes finding transitions across before and after findings and verification outcomes.
    """
    verif_map = {v.finding_id: v for v in (verification_results or [])}
    after_rules = {f.get("rule_id") for f in findings_after if f.get("rule_id")}
    after_finding_ids = {f.get("finding_id") for f in findings_after if f.get("finding_id")}

    transitions: list[FindingDeltaItem] = []

    # 1. Process Baseline Findings
    for fnd in findings_before:
        fnd_id = fnd.get("finding_id", "FND-UNKNOWN")
        rule_id = fnd.get("rule_id", "RULE-UNKNOWN")
        sev_before = fnd.get("severity", "MEDIUM")

        verif = verif_map.get(fnd_id)
        if verif:
            if verif.outcome == VerificationOutcome.RESOLVED:
                trans = FindingTransitionState.OPEN_TO_RESOLVED
                notes = verif.explanation
            elif verif.outcome == VerificationOutcome.INCONCLUSIVE:
                trans = FindingTransitionState.OPEN_TO_INCONCLUSIVE
                notes = verif.explanation
            else:
                trans = FindingTransitionState.OPEN_TO_STILL_OPEN
                notes = verif.explanation
        else:
            # Re-evaluated by rule presence
            if rule_id not in after_rules and fnd_id not in after_finding_ids:
                trans = FindingTransitionState.OPEN_TO_RESOLVED
                notes = "Rule no longer active in post-remediation extractions."
            else:
                trans = FindingTransitionState.OPEN_TO_STILL_OPEN
                notes = "Rule remains active in post-remediation extractions."

        sev_after = None if trans == FindingTransitionState.OPEN_TO_RESOLVED else sev_before

        transitions.append(
            FindingDeltaItem(
                finding_id=fnd_id,
                rule_id=rule_id,
                transition=trans,
                severity_before=str(sev_before),
                severity_after=str(sev_after) if sev_after else None,
                evidence_ref_before=baseline_evidence_id,
                evidence_ref_after=after_evidence_id,
                execution_id=execution_id,
                notes=notes,
            )
        )

    # 2. Process Newly Introduced Regression Findings
    before_rules = {f.get("rule_id") for f in findings_before if f.get("rule_id")}
    for fnd in findings_after:
        rule_id = fnd.get("rule_id", "RULE-UNKNOWN")
        fnd_id = fnd.get("finding_id", "FND-NEW")
        if rule_id not in before_rules:
            transitions.append(
                FindingDeltaItem(
                    finding_id=fnd_id,
                    rule_id=rule_id,
                    transition=FindingTransitionState.NEW_REGRESSION,
                    severity_before=None,
                    severity_after=str(fnd.get("severity", "HIGH")),
                    evidence_ref_before=baseline_evidence_id,
                    evidence_ref_after=after_evidence_id,
                    execution_id=execution_id,
                    notes=f"New regression finding introduced for rule '{rule_id}'.",
                )
            )

    resolved = sum(1 for t in transitions if t.transition == FindingTransitionState.OPEN_TO_RESOLVED)
    still_open = sum(1 for t in transitions if t.transition == FindingTransitionState.OPEN_TO_STILL_OPEN)
    inconclusive = sum(1 for t in transitions if t.transition == FindingTransitionState.OPEN_TO_INCONCLUSIVE)
    regressions = sum(1 for t in transitions if t.transition == FindingTransitionState.NEW_REGRESSION)

    return FindingDeltaReport(
        total_evaluated=len(transitions),
        resolved_count=resolved,
        still_open_count=still_open,
        inconclusive_count=inconclusive,
        new_regressions_count=regressions,
        transitions=transitions,
    )
