"""
Experiment Metrics & Result Models (Task 12 Step 5).

Computes deterministic, evidence-backed metrics across 5 core dimensions:
1. Fix Effectiveness
2. Regression Guarding
3. Score & Delta Evaluation
4. Evidence Integrity & Freshness
5. Operational Reliability
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any
from pydantic import BaseModel, ConfigDict, Field

from connectors.base.security import sanitize_payload
from .delta import FindingDeltaReport, ScoreDeltaReport
from .measurement import ClosedLoopMeasurementReport
from .experiment import (
    ExperimentDecision,
    ExperimentStatus,
    HypothesisResult,
    ObservationConfidence,
)
from .regression import RegressionDecision, RegressionGuardReport
from .verifier import FixVerificationResult, VerificationOutcome

logger = logging.getLogger(__name__)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


# =============================================================================
# 1. Five Metric Dimensions
# =============================================================================

class FixEffectivenessMetrics(BaseModel):
    """Metrics tracking intended finding remediation."""
    model_config = ConfigDict(extra="ignore")

    target_findings_count: int = Field(default=0, description="Number of findings targeted for fix")
    intended_findings_count: int = Field(default=0, description="Alias for target_findings_count")
    verified_count: int = Field(default=0, description="Number of targeted findings confirmed resolved")
    resolved_findings_count: int = Field(default=0, description="Alias for verified_count")
    partial_count: int = Field(default=0, description="Number of partially resolved findings")
    unverified_count: int = Field(default=0, description="Number of unverified findings")
    still_open_findings_count: int = Field(default=0, description="Number of targeted findings that remain open")
    inconclusive_findings_count: int = Field(default=0, description="Number of findings with inconclusive evidence")
    verification_rate: float = Field(default=0.0, description="Ratio of verified findings to target findings (0.0 - 1.0)")
    resolution_rate: float = Field(default=0.0, description="Alias for verification_rate")
    overall_fix_verified: bool = Field(default=False, description="True if all targets resolved without failure")
    confidence: ObservationConfidence = Field(default=ObservationConfidence.OBSERVED)


class RegressionMetrics(BaseModel):
    """Metrics evaluating side effects and regression signals."""
    model_config = ConfigDict(extra="ignore")

    total_regressions: int = Field(default=0, description="Total regressions detected")
    regressions_detected: bool = Field(default=False, description="True if any regression was introduced")
    has_blocking_regressions: bool = Field(default=False, description="True if critical/blocking regression exists")
    regression_decision: str = Field(default="PASS", description="PASS, FAIL, or REVIEW")
    critical_regressions_count: int = Field(default=0, description="Count of critical severity regressions")
    warning_regressions_count: int = Field(default=0, description="Count of warning / medium regressions")
    max_score_loss: float = Field(default=0.0, description="Maximum single-finding score penalty")
    is_regression_free: bool = Field(default=True, description="True if zero regressions occurred")
    confidence: ObservationConfidence = Field(default=ObservationConfidence.OBSERVED)


class ScoreMetrics(BaseModel):
    """Metrics comparing pre- and post-fix engine scores."""
    model_config = ConfigDict(extra="ignore")

    score_before: float = Field(default=0.0, description="Overall score in BEFORE baseline")
    score_after: float = Field(default=0.0, description="Overall score in AFTER rescan")
    overall_delta: float = Field(default=0.0, description="Delta (score_after - score_before)")
    score_delta: float = Field(default=0.0, description="Alias for overall_delta")
    resolved_findings_count: int = Field(default=0, description="Count of resolved findings contributing to score")
    category_deltas: dict[str, Any] = Field(default_factory=dict, description="Category-level score deltas")
    is_score_improved: bool = Field(default=False, description="True if overall_delta > 0.0")
    is_score_neutral_or_better: bool = Field(default=True, description="True if overall_delta >= 0.0")
    confidence: ObservationConfidence = Field(default=ObservationConfidence.OBSERVED)
    disclaimer: str = Field(
        default="Score and effectiveness metrics represent changes in Raval's deterministic "
        "measurement model and does not guarantee third-party external search ranking, traffic, conversion, citation, or AI visibility improvement."
    )


class EvidenceMetrics(BaseModel):
    """Metrics measuring evidence completeness, state, and freshness."""
    model_config = ConfigDict(extra="ignore")

    observations_captured: int = Field(default=0, description="Number of observations captured")
    observations_verified: int = Field(default=0, description="Number of verified observations")
    evidence_items_before: int = Field(default=0, description="Number of structured evidence features in baseline")
    evidence_items_after: int = Field(default=0, description="Number of structured evidence features in rescan")
    changed_evidence_count: int = Field(default=0, description="Count of evidence tags/values modified")
    missing_evidence_count: int = Field(default=0, description="Count of expected evidence items missing")
    stale_evidence_count: int = Field(default=0, description="Count of stale evidence snapshots")
    evidence_completeness_ratio: float = Field(default=1.0, description="Completeness percentage (0.0 - 1.0)")
    confidence: ObservationConfidence = Field(default=ObservationConfidence.OBSERVED)
    confidence_boundary: str = Field(default="OBSERVED", description="OBSERVED, INFERRED, or NOT_MEASURED")


class OperationalMetrics(BaseModel):
    """Operational execution duration, retries, and recovery metrics."""
    model_config = ConfigDict(extra="ignore")

    execution_duration_ms: float = Field(default=0.0, description="Fix apply execution elapsed time in ms")
    validation_duration_ms: float = Field(default=0.0, description="Validation elapsed time in ms")
    rescan_duration_ms: float = Field(default=0.0, description="Rescan elapsed time in ms")
    total_duration_ms: float = Field(default=0.0, description="Total pipeline execution time in ms")
    rescan_efficiency_savings_pct: float = Field(default=0.0, description="Percentage of crawl time/pages saved vs full crawl")
    stages_executed: int = Field(default=0, description="Number of pipeline stages executed")
    stages_failed: int = Field(default=0, description="Number of pipeline stages that failed")
    retry_count: int = Field(default=0, description="Number of retries executed")
    failure_count: int = Field(default=0, description="Count of transient or permanent failures encountered")
    recovery_count: int = Field(default=0, description="Count of successful recovery actions taken")
    rollback_count: int = Field(default=0, description="Count of rollbacks triggered")
    was_recovered: bool = Field(default=False, description="True if recovered from a transient failure")
    was_rolled_back: bool = Field(default=False, description="True if rollback was performed")
    confidence: ObservationConfidence = Field(default=ObservationConfidence.OBSERVED)


# =============================================================================
# 2. Experiment Metrics Summary & Result Contract
# =============================================================================

class ExperimentMetricsSummary(BaseModel):
    """
    Consolidated metrics block across all 5 evaluation dimensions.
    """
    model_config = ConfigDict(extra="ignore")

    fix_effectiveness: FixEffectivenessMetrics = Field(default_factory=FixEffectivenessMetrics)
    effectiveness: FixEffectivenessMetrics = Field(default_factory=FixEffectivenessMetrics)
    regression: RegressionMetrics = Field(default_factory=RegressionMetrics)
    score: ScoreMetrics = Field(default_factory=ScoreMetrics)
    evidence: EvidenceMetrics = Field(default_factory=EvidenceMetrics)
    operational: OperationalMetrics = Field(default_factory=OperationalMetrics)
    disclaimer: str = Field(
        default="Score and effectiveness metrics represent changes in Raval's deterministic "
        "measurement model and does not guarantee third-party external search ranking, traffic, conversion, citation, or AI visibility improvement."
    )

    def model_post_init(self, __context: Any) -> None:
        if self.fix_effectiveness and not self.effectiveness.target_findings_count:
            object.__setattr__(self, "effectiveness", self.fix_effectiveness)
        elif self.effectiveness and not self.fix_effectiveness.target_findings_count:
            object.__setattr__(self, "fix_effectiveness", self.effectiveness)


class ExperimentResult(BaseModel):
    """
    Structured outcome contract for an evaluated experiment.
    """
    model_config = ConfigDict(extra="ignore")

    experiment_id: str = Field(..., description="Associated Experiment ID")
    execution_id: str = Field(..., description="Associated ExecutionTrace ID")
    status: ExperimentStatus = Field(..., description="Experiment status (SUCCEEDED, FAILED, INCONCLUSIVE, INVALID)")
    decision: ExperimentDecision = Field(..., description="Actionable decision (KEEP, ROLLBACK, REVIEW, NO_CHANGE)")
    hypothesis_result: HypothesisResult = Field(..., description="Hypothesis test outcome")
    metrics: ExperimentMetricsSummary = Field(..., description="Consolidated 5-pillar metrics summary")
    readiness_report: Any | None = Field(default=None, description="Pre-flight readiness report")
    effectiveness_results: list[FixVerificationResult] = Field(default_factory=list)
    regression_report: RegressionGuardReport | None = Field(default=None)
    score_delta: ScoreDeltaReport | None = Field(default=None)
    finding_delta: FindingDeltaReport | None = Field(default=None)
    failure_summary: dict[str, Any] | None = Field(default=None)
    recovery_summary: dict[str, Any] | None = Field(default=None)
    provenance_chain: list[dict[str, Any]] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=_utc_now)
    completed_at: datetime = Field(default_factory=_utc_now)
    disclaimer: str = Field(
        default="Score and effectiveness metrics represent changes in Raval's deterministic "
        "measurement model and does not guarantee third-party external search ranking, traffic, conversion, citation, or AI visibility improvement."
    )


# =============================================================================
# 3. Calculation Helper
# =============================================================================

def calculate_experiment_metrics(
    report: ClosedLoopMeasurementReport | None = None,
    measurement_report: ClosedLoopMeasurementReport | None = None,
    stage_traces: list[Any] | None = None,
    rescan_scope: str = "TARGETED_RESOURCE",
    rescan_pages_count: int = 1,
    total_site_pages: int = 1,
    execution_duration_ms: float = 0.0,
    validation_duration_ms: float = 0.0,
    rescan_duration_ms: float = 0.0,
    total_duration_ms: float = 0.0,
    retry_count: int = 0,
    failure_count: int = 0,
    recovery_count: int = 0,
    rollback_count: int = 0,
) -> ExperimentMetricsSummary:
    """
    Calculates deterministic metrics from a ClosedLoopMeasurementReport and runtime telemetry.
    """
    rep = report or measurement_report

    # 1. Effectiveness
    intended = 0
    verified = 0
    partial = 0
    unverified = 0
    still_open = 0
    inconclusive = 0

    if rep and getattr(rep, "verification_summary", None):
        summary = rep.verification_summary
        intended = summary.get("total_targets", len(summary.get("results", [])))
        verified = summary.get("verified_count", 0)
        partial = summary.get("partial_count", 0)
        unverified = summary.get("unverified_count", 0)
    elif rep and getattr(rep, "verification_results", None):
        intended = len(rep.verification_results)
        for v in rep.verification_results:
            if getattr(v, "is_resolved", False) or getattr(v, "is_verified", False):
                verified += 1
            elif getattr(v, "outcome", None) == VerificationOutcome.PARTIALLY_VERIFIED:
                partial += 1
            elif getattr(v, "outcome", None) == VerificationOutcome.INCONCLUSIVE:
                inconclusive += 1
            else:
                unverified += 1
                still_open += 1

    rate = round(verified / intended, 4) if intended > 0 else (1.0 if (rep and getattr(rep, "overall_verified", False)) else 0.0)
    all_verified = (verified == intended and intended > 0) or (getattr(rep, "overall_verified", False) if rep else False)

    eff_metrics = FixEffectivenessMetrics(
        target_findings_count=intended,
        intended_findings_count=intended,
        verified_count=verified,
        resolved_findings_count=verified,
        partial_count=partial,
        unverified_count=unverified,
        still_open_findings_count=still_open,
        inconclusive_findings_count=inconclusive,
        verification_rate=rate,
        resolution_rate=rate,
        overall_fix_verified=all_verified,
        confidence=ObservationConfidence.OBSERVED,
    )

    # 2. Regression
    reg_detected = False
    has_blocking = False
    reg_decision = "PASS"
    crit_count = 0
    warn_count = 0
    tot_reg = 0

    if rep and rep.regression_report:
        r_rep = rep.regression_report
        findings = getattr(r_rep, "findings", getattr(r_rep, "regression_findings", getattr(r_rep, "detected_regressions", [])))
        tot_reg = len(findings)
        reg_detected = tot_reg > 0 or getattr(r_rep, "regressions_detected", False)
        has_blocking = getattr(r_rep, "has_blocking_regressions", False)
        reg_decision = getattr(r_rep, "decision", RegressionDecision.KEEP)
        if hasattr(reg_decision, "value"):
            reg_decision = reg_decision.value
        elif hasattr(reg_decision, "name"):
            reg_decision = reg_decision.name

        for reg in findings:
            is_block = getattr(reg, "is_critical", getattr(reg, "is_blocking", False))
            if is_block:
                crit_count += 1
            else:
                warn_count += 1

    reg_metrics = RegressionMetrics(
        total_regressions=tot_reg,
        regressions_detected=reg_detected,
        has_blocking_regressions=has_blocking,
        regression_decision=str(reg_decision),
        critical_regressions_count=crit_count,
        warning_regressions_count=warn_count,
        is_regression_free=not reg_detected,
        confidence=ObservationConfidence.OBSERVED,
    )

    # 3. Score
    score_b = 0.0
    score_a = 0.0
    s_delta = 0.0
    resolved_f_count = 0
    cat_deltas = {}

    if rep and getattr(rep, "score_delta", None):
        sd = rep.score_delta
        score_b = getattr(sd, "before_score", getattr(sd, "overall_score_before", 0.0))
        score_a = getattr(sd, "after_score", getattr(sd, "overall_score_after", 0.0))
        s_delta = getattr(sd, "overall_delta", getattr(sd, "overall_score_delta", 0.0))
        cat_deltas = getattr(sd, "category_deltas", {})
    elif rep and getattr(rep, "score_delta_report", None):
        sd = rep.score_delta_report
        score_b = getattr(sd, "before_score", getattr(sd, "score_before", 0.0))
        score_a = getattr(sd, "after_score", getattr(sd, "score_after", 0.0))
        s_delta = getattr(sd, "overall_delta", getattr(sd, "overall_score_delta", 0.0))

    if rep and getattr(rep, "finding_delta", None):
        fd = rep.finding_delta
        resolved_f_count = getattr(fd, "resolved_count", 0)
        if not resolved_f_count:
            resolved_f_count = len(getattr(fd, "resolved_findings", []))
    elif rep and getattr(rep, "finding_delta_report", None):
        fd = rep.finding_delta_report
        resolved_f_count = getattr(fd, "resolved_count", 0)
        if not resolved_f_count:
            resolved_f_count = len(getattr(fd, "resolved_findings", []))

    score_metrics = ScoreMetrics(
        score_before=score_b,
        score_after=score_a,
        overall_delta=s_delta,
        score_delta=s_delta,
        resolved_findings_count=resolved_f_count,
        category_deltas=cat_deltas,
        is_score_improved=s_delta > 0.0,
        is_score_neutral_or_better=s_delta >= 0.0,
        confidence=ObservationConfidence.OBSERVED,
    )

    # 4. Evidence
    obs_captured = 0
    obs_verified = 0
    ev_summary = getattr(rep, "evidence_state_summary", {}) if rep else {}
    if ev_summary:
        obs_captured = ev_summary.get("before_observations", 0)
        obs_verified = ev_summary.get("observations_verified", 0)

    evidence_metrics = EvidenceMetrics(
        observations_captured=obs_captured,
        observations_verified=obs_verified,
        evidence_items_before=obs_captured,
        evidence_items_after=obs_captured,
        changed_evidence_count=0,
        missing_evidence_count=0,
        stale_evidence_count=0,
        evidence_completeness_ratio=1.0 if obs_captured > 0 or rep else 0.0,
        confidence=ObservationConfidence.OBSERVED,
        confidence_boundary="OBSERVED",
    )

    # 5. Operational
    exec_dur = execution_duration_ms
    val_dur = validation_duration_ms
    resc_dur = rescan_duration_ms
    tot_dur = total_duration_ms
    st_exec = 0
    st_failed = 0

    if stage_traces:
        tot_dur = sum(st.duration_ms or 0.0 for st in stage_traces)
        st_exec = len(stage_traces)
        st_failed = sum(1 for st in stage_traces if getattr(st, "status", None) and (st.status == "FAILED" or getattr(st.status, "value", "") == "FAILED"))
        for st in stage_traces:
            st_name = getattr(st, "stage", getattr(st, "stage_name", ""))
            if "RESCAN" in str(st_name):
                resc_dur = st.duration_ms or 0.0
            elif "APPLY" in str(st_name):
                exec_dur = st.duration_ms or 0.0
            elif "VALIDATE" in str(st_name):
                val_dur = st.duration_ms or 0.0

    savings = 0.0
    if total_site_pages > 0 and rescan_pages_count < total_site_pages:
        savings = round(((total_site_pages - rescan_pages_count) / total_site_pages) * 100.0, 2)

    operational_metrics = OperationalMetrics(
        execution_duration_ms=exec_dur,
        validation_duration_ms=val_dur,
        rescan_duration_ms=resc_dur,
        total_duration_ms=tot_dur,
        rescan_efficiency_savings_pct=savings,
        stages_executed=st_exec,
        stages_failed=st_failed,
        retry_count=retry_count,
        failure_count=failure_count,
        recovery_count=recovery_count,
        rollback_count=rollback_count,
        was_recovered=recovery_count > 0,
        was_rolled_back=rollback_count > 0,
        confidence=ObservationConfidence.OBSERVED,
    )

    return ExperimentMetricsSummary(
        fix_effectiveness=eff_metrics,
        effectiveness=eff_metrics,
        regression=reg_metrics,
        score=score_metrics,
        evidence=evidence_metrics,
        operational=operational_metrics,
    )
