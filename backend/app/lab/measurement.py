"""
Closed-Loop Measurement & Evidence Service (Task 12 Step 3).

Orchestrates the complete evidence lifecycle:
BASELINE -> FIX -> VALIDATE -> AFTER -> COMPARE -> EFFECTIVENESS DECISION -> REGRESSION DECISION
integrating the verifier, regression guard, score delta, and finding delta engines into
one comprehensive, explainable report.
"""

from __future__ import annotations

import logging
import uuid
from typing import Any
from pydantic import BaseModel, ConfigDict, Field

from app.page_extractor import ExtractionResult

from .delta import (
    FindingDeltaReport,
    ScoreDeltaReport,
    calculate_finding_delta,
    calculate_score_delta,
)
from .evidence import (
    EvidenceState,
    EvidenceStore,
    MeasurementSnapshot,
    ResourceObservation,
    capture_observation_from_extraction,
    get_evidence_store,
)
from .regression import RegressionDecision, RegressionGuard, RegressionGuardReport
from .verifier import (
    FixEffectivenessVerifier,
    FixVerificationResult,
    VerificationOutcome,
)

logger = logging.getLogger(__name__)


class ClosedLoopMeasurementReport(BaseModel):
    """
    Comprehensive closed-loop evidence and effectiveness measurement report.
    """

    model_config = ConfigDict(extra="ignore")

    execution_id: str = Field(..., description="Pipeline execution ID")
    site_id: str = Field(default="default_site", description="Website identity")
    resource_url: str = Field(..., description="Target resource URL")
    baseline_snapshot: MeasurementSnapshot = Field(..., description="Immutable baseline evidence snapshot")
    after_snapshot: MeasurementSnapshot | None = Field(default=None, description="Post-remediation evidence snapshot")
    verification_results: list[FixVerificationResult] = Field(
        default_factory=list, description="Per-finding fix verification outcomes"
    )
    regression_report: RegressionGuardReport = Field(..., description="Regression guard evaluation")
    score_delta: ScoreDeltaReport = Field(..., description="Score comparison and category deltas")
    finding_delta: FindingDeltaReport = Field(..., description="Finding transition tracking")
    final_decision: RegressionDecision = Field(..., description="Actionable final decision (KEEP, ROLLBACK, REVIEW)")
    provenance_chain: list[dict[str, Any]] = Field(default_factory=list, description="Full lineage trace")
    disclaimer: str = Field(
        default="Score improvement represents a change in Raval's deterministic measurement model "
        "and is NOT proof of external search ranking, traffic, conversion, citation, or AI visibility improvement."
    )

    @property
    def overall_verified(self) -> bool:
        """True if all verification results are resolved."""
        return bool(self.verification_results and all(v.is_resolved for v in self.verification_results))

    @property
    def score_delta_report(self) -> ScoreDeltaReport:
        return self.score_delta


class ClosedLoopMeasurementService:
    """
    Service coordinating baseline capture, after capture, verification, regression guarding,
    and closed-loop report generation.
    """

    def __init__(self, store: EvidenceStore | None = None) -> None:
        self.store = store or get_evidence_store()
        self.verifier = FixEffectivenessVerifier()
        self.regression_guard = RegressionGuard()

    def create_baseline_snapshot(
        self,
        execution_id: str,
        site_id: str,
        resource_url: str,
        target_resource: str,
        extracted: ExtractionResult | None,
        findings: list[dict[str, Any]] | None = None,
        score_data: dict[str, Any] | None = None,
        raw_html: str | None = None,
        status_code: int = 200,
        fix_plan_id: str | None = None,
        stage_execution_id: str | None = None,
    ) -> MeasurementSnapshot:
        """
        Creates and stores an immutable baseline (BEFORE) snapshot.
        """
        evidence_id = f"ev_before_{uuid.uuid4().hex[:12]}"
        observation = capture_observation_from_extraction(
            extracted=extracted,
            page_url=resource_url,
            status_code=status_code,
            raw_html=raw_html,
        )

        findings_list = findings or []
        finding_ids = [f["finding_id"] for f in findings_list if "finding_id" in f]
        rule_ids = [f["rule_id"] for f in findings_list if "rule_id" in f]

        scores = score_data or {}
        overall_score = float(scores.get("overall_score", 100.0))
        cat_scores = scores.get("category_scores", {})

        provenance = {
            "evidence_id": evidence_id,
            "execution_id": execution_id,
            "stage_execution_id": stage_execution_id,
            "resource_url": resource_url,
            "state": "BEFORE",
            "findings_count": len(finding_ids),
        }

        snapshot = MeasurementSnapshot(
            evidence_id=evidence_id,
            execution_id=execution_id,
            stage_execution_id=stage_execution_id,
            site_id=site_id,
            resource_url=resource_url,
            target_resource=target_resource,
            evidence_state=EvidenceState.BEFORE,
            observation=observation,
            applicable_finding_ids=finding_ids,
            applicable_rule_ids=rule_ids,
            overall_score=overall_score,
            category_scores=cat_scores,
            fix_plan_id=fix_plan_id,
            provenance_ref=provenance,
        )

        self.store.record_snapshot(snapshot)
        return snapshot

    def create_after_snapshot(
        self,
        execution_id: str,
        site_id: str,
        resource_url: str,
        target_resource: str,
        extracted: ExtractionResult | None,
        findings: list[dict[str, Any]] | None = None,
        score_data: dict[str, Any] | None = None,
        raw_html: str | None = None,
        status_code: int = 200,
        fix_plan_id: str | None = None,
        stage_execution_id: str | None = None,
    ) -> MeasurementSnapshot:
        """
        Creates and stores a post-remediation (AFTER) snapshot.
        """
        evidence_id = f"ev_after_{uuid.uuid4().hex[:12]}"
        observation = capture_observation_from_extraction(
            extracted=extracted,
            page_url=resource_url,
            status_code=status_code,
            raw_html=raw_html,
        )

        findings_list = findings or []
        finding_ids = [f["finding_id"] for f in findings_list if "finding_id" in f]
        rule_ids = [f["rule_id"] for f in findings_list if "rule_id" in f]

        scores = score_data or {}
        overall_score = float(scores.get("overall_score", 100.0))
        cat_scores = scores.get("category_scores", {})

        provenance = {
            "evidence_id": evidence_id,
            "execution_id": execution_id,
            "stage_execution_id": stage_execution_id,
            "resource_url": resource_url,
            "state": "AFTER",
            "findings_count": len(finding_ids),
        }

        snapshot = MeasurementSnapshot(
            evidence_id=evidence_id,
            execution_id=execution_id,
            stage_execution_id=stage_execution_id,
            site_id=site_id,
            resource_url=resource_url,
            target_resource=target_resource,
            evidence_state=EvidenceState.AFTER,
            observation=observation,
            applicable_finding_ids=finding_ids,
            applicable_rule_ids=rule_ids,
            overall_score=overall_score,
            category_scores=cat_scores,
            fix_plan_id=fix_plan_id,
            provenance_ref=provenance,
        )

        self.store.record_snapshot(snapshot)
        return snapshot

    def evaluate_closed_loop(
        self,
        execution_id: str,
        baseline_snapshot: MeasurementSnapshot,
        after_snapshot: MeasurementSnapshot | None,
        fix_plans: list[dict[str, Any]],
        findings_before: list[dict[str, Any]],
        findings_after: list[dict[str, Any]],
        scores_before: dict[str, Any],
        scores_after: dict[str, Any],
    ) -> ClosedLoopMeasurementReport:
        """
        Performs the complete deterministic before/after evaluation, fix verification,
        regression guarding, and score/finding delta calculation.
        """
        # 1. Verify Fix Effectiveness
        verification_results: list[FixVerificationResult] = []
        for plan in fix_plans:
            fnd_id = plan.get("finding_id", "FND-UNKNOWN")
            rule_id = plan.get("rule_id", "RULE-UNKNOWN")
            res = self.verifier.verify_fix(
                finding_id=fnd_id,
                rule_id=rule_id,
                fix_plan=plan,
                baseline_snapshot=baseline_snapshot,
                after_snapshot=after_snapshot,
                execution_id=execution_id,
            )
            verification_results.append(res)

        # 2. Evaluate Regression Guard
        new_crit_rules = []
        if after_snapshot:
            before_rules = set(baseline_snapshot.applicable_rule_ids)
            for r in after_snapshot.applicable_rule_ids:
                if r not in before_rules and ("CRITICAL" in r.upper() or "NOINDEX" in r.upper()):
                    new_crit_rules.append(r)

        regression_report = self.regression_guard.evaluate(
            baseline_snapshot=baseline_snapshot,
            after_snapshot=after_snapshot,
            new_critical_rule_ids=new_crit_rules,
        )

        # 3. Compute Score Delta
        score_delta = calculate_score_delta(
            before_score_data=scores_before,
            after_score_data=scores_after,
        )

        # 4. Compute Finding Delta
        finding_delta = calculate_finding_delta(
            findings_before=findings_before,
            findings_after=findings_after,
            verification_results=verification_results,
            execution_id=execution_id,
            baseline_evidence_id=baseline_snapshot.evidence_id,
            after_evidence_id=after_snapshot.evidence_id if after_snapshot else None,
        )

        # 5. Synthesize Final Decision
        # If regression guard detected critical issues -> ROLLBACK
        # If regression guard says REVIEW -> REVIEW
        # If any fix is NOT_RESOLVED or INCONCLUSIVE -> REVIEW or KEEP depending on regressions
        if regression_report.decision == RegressionDecision.ROLLBACK:
            final_decision = RegressionDecision.ROLLBACK
        elif regression_report.decision == RegressionDecision.REVIEW:
            final_decision = RegressionDecision.REVIEW
        else:
            # Check verification outcomes
            has_inconclusive = any(v.outcome == VerificationOutcome.INCONCLUSIVE for v in verification_results)
            all_resolved = all(v.outcome == VerificationOutcome.RESOLVED for v in verification_results)
            if has_inconclusive:
                final_decision = RegressionDecision.REVIEW
            elif all_resolved:
                final_decision = RegressionDecision.KEEP
            else:
                final_decision = RegressionDecision.REVIEW

        # 6. Assemble Provenance Chain
        provenance_chain = [
            {"step": "BASELINE_CAPTURE", "evidence_id": baseline_snapshot.evidence_id, "captured_at": baseline_snapshot.captured_at.isoformat()},
            {"step": "FIX_PLANS_EVALUATED", "count": len(fix_plans)},
            {"step": "AFTER_CAPTURE", "evidence_id": after_snapshot.evidence_id if after_snapshot else None, "captured_at": after_snapshot.captured_at.isoformat() if after_snapshot else None},
            {"step": "VERIFICATIONS", "resolved_count": sum(1 for v in verification_results if v.is_resolved)},
            {"step": "REGRESSION_DECISION", "decision": regression_report.decision.value},
            {"step": "SCORE_DELTA", "overall_delta": score_delta.overall_delta},
        ]

        return ClosedLoopMeasurementReport(
            execution_id=execution_id,
            site_id=baseline_snapshot.site_id,
            resource_url=baseline_snapshot.resource_url,
            baseline_snapshot=baseline_snapshot,
            after_snapshot=after_snapshot,
            verification_results=verification_results,
            regression_report=regression_report,
            score_delta=score_delta,
            finding_delta=finding_delta,
            final_decision=final_decision,
            provenance_chain=provenance_chain,
        )
