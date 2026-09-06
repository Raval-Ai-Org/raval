"""
Deterministic Regression Guard (Task 12 Step 3).

Evaluates target resources and adjacent signals across technical, indexability,
structural, and content dimensions to detect unintended regressions post-fix,
producing exactly one actionable decision: KEEP, ROLLBACK, or REVIEW.
"""

from __future__ import annotations

import logging
from enum import Enum
from typing import Any
from pydantic import BaseModel, ConfigDict, Field

from .evidence import MeasurementSnapshot, ResourceObservation

logger = logging.getLogger(__name__)


class RegressionDecision(str, Enum):
    """Actionable decision produced by the Regression Guard."""

    KEEP = "KEEP"          # Fix achieved objective with zero critical regressions
    ROLLBACK = "ROLLBACK"  # Critical regression introduced; safe rollback required
    REVIEW = "REVIEW"      # Ambiguous evidence or non-critical regression requiring human review


class RegressionFinding(BaseModel):
    """Details of a single detected regression."""

    model_config = ConfigDict(extra="ignore")

    signal_name: str = Field(..., description="Name of the regressed signal (e.g. HTTP_STATUS, INDEXABILITY)")
    severity: str = Field(..., description="Severity level: CRITICAL, HIGH, MEDIUM, LOW")
    description: str = Field(..., description="Human and machine readable explanation")
    is_critical: bool = Field(default=False, description="True if this regression mandates automatic ROLLBACK")
    before_val: Any = Field(default=None, description="Observed value in baseline (BEFORE)")
    after_val: Any = Field(default=None, description="Observed value post-fix (AFTER)")


class RegressionGuardReport(BaseModel):
    """Complete report produced by the Regression Guard."""

    model_config = ConfigDict(extra="ignore")

    decision: RegressionDecision = Field(..., description="Final decision: KEEP, ROLLBACK, or REVIEW")
    regressions_detected: bool = Field(default=False, description="True if any regression was detected")
    critical_regressions_count: int = Field(default=0, description="Count of critical regressions")
    non_critical_regressions_count: int = Field(default=0, description="Count of non-critical regressions")
    findings: list[RegressionFinding] = Field(default_factory=list, description="List of detected regression findings")
    summary: str = Field(default="Regression evaluation completed.", description="Summary justification of the decision")
    safe_rollback_available: bool = Field(default=True, description="True if automated rollback is supported")

    @property
    def has_blocking_regressions(self) -> bool:
        """True if any critical regression exists or decision is ROLLBACK."""
        return self.critical_regressions_count > 0 or self.decision == RegressionDecision.ROLLBACK


class RegressionGuard:
    """
    Evaluates before and after measurement snapshots to guard against regressions.
    """

    def evaluate(
        self,
        baseline_snapshot: MeasurementSnapshot | None,
        after_snapshot: MeasurementSnapshot | None,
        new_critical_rule_ids: list[str] | None = None,
    ) -> RegressionGuardReport:
        findings: list[RegressionFinding] = []

        # 1. Check for Missing Evidence -> REVIEW
        if baseline_snapshot is None or after_snapshot is None:
            return RegressionGuardReport(
                decision=RegressionDecision.REVIEW,
                regressions_detected=False,
                critical_regressions_count=0,
                non_critical_regressions_count=0,
                findings=[
                    RegressionFinding(
                        signal_name="EVIDENCE_AVAILABILITY",
                        severity="MEDIUM",
                        description="Baseline or After measurement snapshot is missing. Requires manual review.",
                        is_critical=False,
                    )
                ],
                summary="Missing evidence prevents deterministic regression evaluation; flagging for REVIEW.",
                safe_rollback_available=True,
            )

        before = baseline_snapshot.observation
        after = after_snapshot.observation

        # 2. HTTP Status Check
        if before.http_status == 200 and after.http_status >= 400:
            findings.append(
                RegressionFinding(
                    signal_name="HTTP_STATUS_COLLAPSE",
                    severity="CRITICAL",
                    description=f"HTTP status collapsed from {before.http_status} to {after.http_status}",
                    is_critical=True,
                    before_val=before.http_status,
                    after_val=after.http_status,
                )
            )

        # 3. Indexability Destruction (noindex introduced)
        if before.is_indexable and not after.is_indexable:
            findings.append(
                RegressionFinding(
                    signal_name="INDEXABILITY_DESTROYED",
                    severity="CRITICAL",
                    description="Resource was indexable in baseline but has 'noindex' directive in after-state.",
                    is_critical=True,
                    before_val=before.robots_directives,
                    after_val=after.robots_directives,
                )
            )

        # 4. Canonical Corruption
        if before.canonical_url and not after.canonical_url and before.canonical_self_referencing:
            findings.append(
                RegressionFinding(
                    signal_name="CANONICAL_REMOVED",
                    severity="HIGH",
                    description="Previously valid canonical URL was removed.",
                    is_critical=False,
                    before_val=before.canonical_url,
                    after_val=after.canonical_url,
                )
            )

        # 5. Content Loss (>50% body word count loss)
        if before.content_word_count > 50 and after.content_word_count < (before.content_word_count * 0.5):
            findings.append(
                RegressionFinding(
                    signal_name="SEVERE_CONTENT_LOSS",
                    severity="CRITICAL",
                    description=f"Body word count dropped severely from {before.content_word_count} to {after.content_word_count} words (>50% loss).",
                    is_critical=True,
                    before_val=before.content_word_count,
                    after_val=after.content_word_count,
                )
            )

        # 6. Structured Data Corruption
        if before.structured_data_valid and not after.structured_data_valid:
            findings.append(
                RegressionFinding(
                    signal_name="STRUCTURED_DATA_CORRUPTED",
                    severity="HIGH",
                    description="Previously valid schema.org structured data now contains syntax/parsing errors.",
                    is_critical=False,
                    before_val=before.structured_data_types,
                    after_val=after.structured_data_types,
                )
            )

        # 7. Heading Structure Destruction
        if before.h1_count == 1 and after.h1_count == 0:
            findings.append(
                RegressionFinding(
                    signal_name="PRIMARY_H1_REMOVED",
                    severity="HIGH",
                    description="Previously present H1 tag was removed.",
                    is_critical=False,
                    before_val=before.h1_count,
                    after_val=after.h1_count,
                )
            )

        # 8. New Critical Findings Introduced
        if new_critical_rule_ids:
            for rule in new_critical_rule_ids:
                findings.append(
                    RegressionFinding(
                        signal_name="NEW_CRITICAL_RULE_TRIGGERED",
                        severity="CRITICAL",
                        description=f"Remediation introduced a new critical finding for rule '{rule}'.",
                        is_critical=True,
                        before_val=None,
                        after_val=rule,
                    )
                )

        # Decision Synthesis
        critical_count = sum(1 for f in findings if f.is_critical)
        non_critical_count = sum(1 for f in findings if not f.is_critical)
        has_regressions = len(findings) > 0

        if critical_count > 0:
            decision = RegressionDecision.ROLLBACK
            summary = f"Critical regression(s) detected ({critical_count} critical issues); automated ROLLBACK required."
        elif non_critical_count > 0:
            decision = RegressionDecision.REVIEW
            summary = f"Non-critical regression(s) detected ({non_critical_count} issues); human REVIEW required."
        else:
            decision = RegressionDecision.KEEP
            summary = "No regressions detected; fix verified clean. Safe to KEEP."

        return RegressionGuardReport(
            decision=decision,
            regressions_detected=has_regressions,
            critical_regressions_count=critical_count,
            non_critical_regressions_count=non_critical_count,
            findings=findings,
            summary=summary,
            safe_rollback_available=True,
        )
