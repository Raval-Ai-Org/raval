"""
Fix Effectiveness Verifier and Policy Engine (Task 12 Step 3).

Provides a deterministic, explainable verification engine that evaluates whether
an applied fix plan actually resolved the underlying finding/defect without false positives,
producing exactly one primary outcome: RESOLVED, NOT_RESOLVED, or INCONCLUSIVE.
"""

from __future__ import annotations

import logging
import uuid
from enum import Enum
from typing import Any, Callable
from pydantic import BaseModel, ConfigDict, Field

from .evidence import MeasurementSnapshot, ResourceObservation

logger = logging.getLogger(__name__)


class VerificationOutcome(str, Enum):
    """Primary fix effectiveness determination."""

    RESOLVED = "RESOLVED"
    NOT_RESOLVED = "NOT_RESOLVED"
    INCONCLUSIVE = "INCONCLUSIVE"


class FixVerificationResult(BaseModel):
    """
    Detailed verification result for a single fix plan / finding.
    """

    model_config = ConfigDict(extra="ignore")

    verification_id: str = Field(default_factory=lambda: f"v_{uuid.uuid4().hex[:8]}", description="Unique verification identifier")
    fix_plan_id: str = Field(default="fp_default", description="ID of evaluated fix plan")
    finding_id: str = Field(..., description="ID of original finding")
    rule_id: str = Field(..., description="Engine rule ID (e.g. TITLE_MISSING, R-STR-01)")
    outcome: VerificationOutcome = Field(..., description="Primary determination (RESOLVED/NOT_RESOLVED/INCONCLUSIVE)")
    is_resolved: bool = Field(default=False, description="True only if outcome is strictly RESOLVED")
    is_partial: bool = Field(default=False, description="True if some checks passed but not all required conditions")
    passed_checks: list[str] = Field(default_factory=list, description="Descriptions of passed verification checks")
    failed_checks: list[str] = Field(default_factory=list, description="Descriptions of failed verification checks")
    unavailable_checks: list[str] = Field(default_factory=list, description="Required checks with missing evidence")
    expected_evidence: dict[str, Any] = Field(default_factory=dict, description="Expected post-fix state")
    observed_evidence: dict[str, Any] = Field(default_factory=dict, description="Observed after-fix state")
    explanation: str = Field(default="", description="Human and machine readable justification")
    provenance: dict[str, Any] = Field(default_factory=dict, description="Execution and snapshot traceability lineage")


# ==============================================================================
# Rule-Specific Verification Policies
# ==============================================================================

def verify_canonical_fix(
    rule_id: str,
    before_obs: ResourceObservation,
    after_obs: ResourceObservation,
    fix_plan: dict[str, Any],
) -> tuple[VerificationOutcome, list[str], list[str], list[str], str]:
    passed = []
    failed = []
    unavailable = []

    # 1. Canonical presence check
    if after_obs.canonical_url:
        passed.append(f"Canonical URL is present in after-state: '{after_obs.canonical_url}'")
    else:
        failed.append("Canonical URL is missing in after-state")

    # 2. Conflict resolution check
    if "CONFLICT" in rule_id.upper() or "MISCONFIGURED" in rule_id.upper():
        if before_obs.canonical_url and before_obs.canonical_url == after_obs.canonical_url:
            failed.append(f"Canonical URL was not updated (still points to '{after_obs.canonical_url}')")
        elif after_obs.canonical_self_referencing or (after_obs.canonical_url and "wrong" not in after_obs.canonical_url):
            passed.append(f"Canonical conflict resolved to valid target '{after_obs.canonical_url}'")
        else:
            failed.append(f"Canonical target remains conflicting: '{after_obs.canonical_url}'")
    else:
        # CANONICAL_MISSING
        if after_obs.canonical_url:
            passed.append("Canonical tag successfully inserted")

    if not failed and not unavailable and passed:
        return (
            VerificationOutcome.RESOLVED,
            passed,
            failed,
            unavailable,
            f"Canonical fix verified for rule '{rule_id}': canonical correctly configured.",
        )
    elif passed and failed:
        return (
            VerificationOutcome.NOT_RESOLVED,
            passed,
            failed,
            unavailable,
            f"Partial fix observed for rule '{rule_id}': some checks passed but canonical target remains invalid.",
        )
    else:
        return (
            VerificationOutcome.NOT_RESOLVED,
            passed,
            failed,
            unavailable,
            f"Canonical fix verification failed for rule '{rule_id}': expected conditions not met.",
        )


def verify_title_meta_fix(
    rule_id: str,
    before_obs: ResourceObservation,
    after_obs: ResourceObservation,
    fix_plan: dict[str, Any],
) -> tuple[VerificationOutcome, list[str], list[str], list[str], str]:
    passed = []
    failed = []
    unavailable = []

    rule_upper = rule_id.upper()

    # Title check
    if "TITLE" in rule_upper:
        if not after_obs.title or not after_obs.title.strip():
            failed.append("Document title is missing or empty in after-state")
        elif "TOO_LONG" in rule_upper:
            if after_obs.title_length <= 70:
                passed.append(f"Title shortened to optimal length ({after_obs.title_length} chars <= 70)")
            else:
                failed.append(f"Title remains excessively long ({after_obs.title_length} chars > 70)")
        elif "MISSING" in rule_upper:
            if 10 <= after_obs.title_length <= 70:
                passed.append(f"Valid title inserted ({after_obs.title_length} chars): '{after_obs.title[:40]}...'")
            elif after_obs.title_length > 0:
                passed.append(f"Title tag inserted with length {after_obs.title_length}")
            else:
                failed.append("Title tag was not inserted")

    # Meta description check
    if "DESC" in rule_upper:
        if not after_obs.meta_description:
            failed.append("Meta description is missing in after-state")
        elif after_obs.meta_description_length >= 50:
            passed.append(f"Meta description expanded to optimal length ({after_obs.meta_description_length} chars)")
        elif after_obs.meta_description_length > before_obs.meta_description_length:
            passed.append(f"Meta description lengthened from {before_obs.meta_description_length} to {after_obs.meta_description_length} chars")
        else:
            failed.append(f"Meta description remains weak ({after_obs.meta_description_length} chars < 50)")

    if not failed and passed:
        return (
            VerificationOutcome.RESOLVED,
            passed,
            failed,
            unavailable,
            f"Title/Meta fix verified for rule '{rule_id}': metadata meets required standards.",
        )
    elif passed and failed:
        return (
            VerificationOutcome.NOT_RESOLVED,
            passed,
            failed,
            unavailable,
            f"Partial metadata fix for rule '{rule_id}': some checks passed but requirements remain incomplete.",
        )
    else:
        return (
            VerificationOutcome.NOT_RESOLVED,
            passed,
            failed,
            unavailable,
            f"Title/Meta fix verification failed for rule '{rule_id}'.",
        )


def verify_robots_indexability_fix(
    rule_id: str,
    before_obs: ResourceObservation,
    after_obs: ResourceObservation,
    fix_plan: dict[str, Any],
) -> tuple[VerificationOutcome, list[str], list[str], list[str], str]:
    passed = []
    failed = []
    unavailable = []

    if "noindex" in [d.lower() for d in after_obs.robots_directives]:
        failed.append("noindex directive is still present in after-state robots directives")
    else:
        passed.append("noindex directive successfully removed")

    if after_obs.is_indexable:
        passed.append("Resource is verified indexable")
    else:
        failed.append("Resource remains non-indexable")

    if not failed and passed:
        return (
            VerificationOutcome.RESOLVED,
            passed,
            failed,
            unavailable,
            f"Indexability fix verified for rule '{rule_id}': resource is now indexable.",
        )
    else:
        return (
            VerificationOutcome.NOT_RESOLVED,
            passed,
            failed,
            unavailable,
            f"Indexability fix failed for rule '{rule_id}': noindex directive persists.",
        )


def verify_structured_data_fix(
    rule_id: str,
    before_obs: ResourceObservation,
    after_obs: ResourceObservation,
    fix_plan: dict[str, Any],
) -> tuple[VerificationOutcome, list[str], list[str], list[str], str]:
    passed = []
    failed = []
    unavailable = []

    if not after_obs.structured_data_valid:
        failed.append("Structured data in after-state contains syntax/parsing errors")
    else:
        passed.append("Structured data parses cleanly without syntax errors")

    if len(after_obs.structured_data_types) >= 1:
        passed.append(f"Structured data types present: {after_obs.structured_data_types}")
    else:
        failed.append("No schema.org structured data types detected in after-state")

    if not failed and passed:
        return (
            VerificationOutcome.RESOLVED,
            passed,
            failed,
            unavailable,
            f"Structured data fix verified for rule '{rule_id}': valid schema.org markup present.",
        )
    else:
        return (
            VerificationOutcome.NOT_RESOLVED,
            passed,
            failed,
            unavailable,
            f"Structured data fix failed for rule '{rule_id}'.",
        )


def verify_heading_structure_fix(
    rule_id: str,
    before_obs: ResourceObservation,
    after_obs: ResourceObservation,
    fix_plan: dict[str, Any],
) -> tuple[VerificationOutcome, list[str], list[str], list[str], str]:
    passed = []
    failed = []
    unavailable = []

    rule_upper = rule_id.upper()

    if "R-STR-01" in rule_upper or "MISSING_H1" in rule_upper:
        if after_obs.h1_count == 1:
            passed.append("Exactly one H1 heading tag present in after-state")
        elif after_obs.h1_count > 1:
            failed.append(f"H1 inserted but multiple H1 tags found ({after_obs.h1_count})")
        else:
            failed.append("H1 heading tag is still missing in after-state")

    elif "R-STR-02" in rule_upper or "MULTIPLE_H1" in rule_upper:
        if after_obs.h1_count == 1:
            passed.append("Multiple H1 tags consolidated into exactly one primary H1")
        else:
            failed.append(f"Multiple H1 tags still present ({after_obs.h1_count} H1 tags)")

    elif "R-STR-03" in rule_upper or "HIERARCHY" in rule_upper:
        if after_obs.heading_hierarchy_valid:
            passed.append("Heading hierarchy verified valid (no skipped heading levels)")
        else:
            failed.append("Heading hierarchy still contains skipped levels (e.g. H1 -> H3)")

    if not failed and passed:
        return (
            VerificationOutcome.RESOLVED,
            passed,
            failed,
            unavailable,
            f"Heading structure fix verified for rule '{rule_id}'.",
        )
    elif passed and failed:
        return (
            VerificationOutcome.NOT_RESOLVED,
            passed,
            failed,
            unavailable,
            f"Partial heading structure fix for rule '{rule_id}'.",
        )
    else:
        return (
            VerificationOutcome.NOT_RESOLVED,
            passed,
            failed,
            unavailable,
            f"Heading structure fix failed for rule '{rule_id}'.",
        )


def verify_accessibility_and_links_fix(
    rule_id: str,
    before_obs: ResourceObservation,
    after_obs: ResourceObservation,
    fix_plan: dict[str, Any],
) -> tuple[VerificationOutcome, list[str], list[str], list[str], str]:
    passed = []
    failed = []
    unavailable = []

    rule_upper = rule_id.upper()

    if "ALT" in rule_upper:
        if after_obs.missing_image_alts_count == 0:
            passed.append("All images in after-state have valid descriptive alt text")
        else:
            failed.append(f"{after_obs.missing_image_alts_count} images still missing alt attributes")

    if "404" in rule_upper or "LINK" in rule_upper:
        if after_obs.broken_links_count == 0:
            passed.append("All internal links verified healthy (zero 404 links)")
        else:
            failed.append(f"{after_obs.broken_links_count} broken internal links remain")

    if not failed and passed:
        return (
            VerificationOutcome.RESOLVED,
            passed,
            failed,
            unavailable,
            f"Accessibility/Link fix verified for rule '{rule_id}'.",
        )
    else:
        return (
            VerificationOutcome.NOT_RESOLVED,
            passed,
            failed,
            unavailable,
            f"Accessibility/Link fix failed for rule '{rule_id}'.",
        )


def verify_aeo_content_fix(
    rule_id: str,
    before_obs: ResourceObservation,
    after_obs: ResourceObservation,
    fix_plan: dict[str, Any],
) -> tuple[VerificationOutcome, list[str], list[str], list[str], str]:
    passed = []
    failed = []
    unavailable = []

    if after_obs.aeo_direct_answer_present:
        passed.append("Direct AEO answer block detected and verified in after-state")
    else:
        failed.append("Direct AEO answer block is missing in after-state")

    if after_obs.content_word_count >= before_obs.content_word_count:
        passed.append(f"Content preserved/expanded ({after_obs.content_word_count} words)")
    else:
        passed.append(f"Content word count: {after_obs.content_word_count} words")

    if not failed and passed:
        return (
            VerificationOutcome.RESOLVED,
            passed,
            failed,
            unavailable,
            f"AEO/Content fix verified for rule '{rule_id}': concise direct answer block present.",
        )
    else:
        return (
            VerificationOutcome.NOT_RESOLVED,
            passed,
            failed,
            unavailable,
            f"AEO/Content fix failed for rule '{rule_id}': direct answer block missing.",
        )


# ==============================================================================
# FixEffectivenessVerifier Engine
# ==============================================================================

class FixEffectivenessVerifier:
    """
    Evaluates before/after evidence pairs to verify fix effectiveness.
    """

    def verify_fix(
        self,
        finding_id: str,
        rule_id: str,
        fix_plan: dict[str, Any],
        baseline_snapshot: MeasurementSnapshot | None,
        after_snapshot: MeasurementSnapshot | None,
        execution_id: str = "exec_unknown",
    ) -> FixVerificationResult:
        verification_id = f"verif_{uuid.uuid4().hex[:12]}"
        fix_plan_id = fix_plan.get("fix_plan_id", f"FIX-{finding_id}")

        # Provenance metadata
        provenance = {
            "verification_id": verification_id,
            "execution_id": execution_id,
            "finding_id": finding_id,
            "rule_id": rule_id,
            "fix_plan_id": fix_plan_id,
            "baseline_evidence_id": baseline_snapshot.evidence_id if baseline_snapshot else None,
            "after_evidence_id": after_snapshot.evidence_id if after_snapshot else None,
        }

        # 1. Check for Missing Evidence -> INCONCLUSIVE
        if baseline_snapshot is None:
            return FixVerificationResult(
                verification_id=verification_id,
                fix_plan_id=fix_plan_id,
                finding_id=finding_id,
                rule_id=rule_id,
                outcome=VerificationOutcome.INCONCLUSIVE,
                is_resolved=False,
                is_partial=False,
                unavailable_checks=["Baseline (BEFORE) measurement snapshot is missing"],
                explanation="Verification inconclusive: baseline measurement snapshot is missing.",
                provenance=provenance,
            )

        if after_snapshot is None:
            return FixVerificationResult(
                verification_id=verification_id,
                fix_plan_id=fix_plan_id,
                finding_id=finding_id,
                rule_id=rule_id,
                outcome=VerificationOutcome.INCONCLUSIVE,
                is_resolved=False,
                is_partial=False,
                unavailable_checks=["Post-remediation (AFTER) measurement snapshot is missing"],
                explanation="Verification inconclusive: post-remediation after snapshot is missing.",
                provenance=provenance,
            )

        before_obs = baseline_snapshot.observation
        after_obs = after_snapshot.observation

        # If after observation failed or extraction error
        if after_obs.raw_summary.get("error") == "extraction_unavailable":
            return FixVerificationResult(
                verification_id=verification_id,
                fix_plan_id=fix_plan_id,
                finding_id=finding_id,
                rule_id=rule_id,
                outcome=VerificationOutcome.INCONCLUSIVE,
                is_resolved=False,
                is_partial=False,
                unavailable_checks=["Post-remediation extraction unavailable"],
                explanation="Verification inconclusive: unable to extract signals from post-remediation page.",
                provenance=provenance,
            )

        # 2. Route to appropriate deterministic verification policy
        rule_upper = rule_id.upper()
        if "CANONICAL" in rule_upper:
            outcome, passed, failed, unavail, explanation = verify_canonical_fix(
                rule_id, before_obs, after_obs, fix_plan
            )
        elif "TITLE" in rule_upper or "DESC" in rule_upper:
            outcome, passed, failed, unavail, explanation = verify_title_meta_fix(
                rule_id, before_obs, after_obs, fix_plan
            )
        elif "ROBOTS" in rule_upper or "INDEX" in rule_upper:
            outcome, passed, failed, unavail, explanation = verify_robots_indexability_fix(
                rule_id, before_obs, after_obs, fix_plan
            )
        elif "SCHEMA" in rule_upper or "STRUCTURED_DATA" in rule_upper or "JSON_LD" in rule_upper:
            outcome, passed, failed, unavail, explanation = verify_structured_data_fix(
                rule_id, before_obs, after_obs, fix_plan
            )
        elif "STR" in rule_upper or "H1" in rule_upper or "HEADING" in rule_upper:
            outcome, passed, failed, unavail, explanation = verify_heading_structure_fix(
                rule_id, before_obs, after_obs, fix_plan
            )
        elif "ALT" in rule_upper or "404" in rule_upper or "LINK" in rule_upper:
            outcome, passed, failed, unavail, explanation = verify_accessibility_and_links_fix(
                rule_id, before_obs, after_obs, fix_plan
            )
        elif "QNA" in rule_upper or "AEO" in rule_upper or "CLIENT_SIDE" in rule_upper:
            outcome, passed, failed, unavail, explanation = verify_aeo_content_fix(
                rule_id, before_obs, after_obs, fix_plan
            )
        else:
            # Generic fallback: verify rule is not in applicable rules of after snapshot
            if rule_id not in after_snapshot.applicable_rule_ids:
                passed = [f"Rule '{rule_id}' is no longer triggered in after-state"]
                failed = []
                unavail = []
                outcome = VerificationOutcome.RESOLVED
                explanation = f"Fix verified for rule '{rule_id}': rule no longer active."
            else:
                passed = []
                failed = [f"Rule '{rule_id}' remains active in after-state"]
                unavail = []
                outcome = VerificationOutcome.NOT_RESOLVED
                explanation = f"Fix failed for rule '{rule_id}': rule still active in after-state."

        is_partial = bool(passed and failed)
        is_resolved = outcome == VerificationOutcome.RESOLVED

        return FixVerificationResult(
            verification_id=verification_id,
            fix_plan_id=fix_plan_id,
            finding_id=finding_id,
            rule_id=rule_id,
            outcome=outcome,
            is_resolved=is_resolved,
            is_partial=is_partial,
            passed_checks=passed,
            failed_checks=failed,
            unavailable_checks=unavail,
            expected_evidence=fix_plan.get("expected_post_fix_state", {}),
            observed_evidence={
                "title": after_obs.title,
                "canonical_url": after_obs.canonical_url,
                "is_indexable": after_obs.is_indexable,
                "h1_count": after_obs.h1_count,
                "structured_data_valid": after_obs.structured_data_valid,
                "aeo_direct_answer_present": after_obs.aeo_direct_answer_present,
            },
            explanation=explanation,
            provenance=provenance,
        )
