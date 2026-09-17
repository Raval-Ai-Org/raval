"""
Production Orchestration & Monitoring - Approval & Safety Gate.

Guarantees:
- AUTO_SAFE: executes autonomously only when tenant policy permits.
- ASSISTED: requires explicit approval according to approval policy.
- MANUAL_REVIEW: strictly prohibited from autonomous execution.
- LLM outputs can NEVER directly mutate production environments.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from enum import Enum
import logging
from typing import TYPE_CHECKING, Any

from connectors.base.security import sanitize_payload
from ..fix_safety_classifier import SafetyTier, classify_fix_safety
from .enums import AutomationLevel

if TYPE_CHECKING:
    from connectors.execution.approval import ApprovalManager
    from connectors.execution.models import ApprovalRecord, ExecutionRequest


class SafetyDecisionType(str, Enum):
    """Deterministic Safety Gate evaluation decisions."""

    ALLOWED_AUTO = "allowed_auto"
    REQUIRES_APPROVAL = "requires_approval"
    BLOCKED = "blocked"


logger = logging.getLogger(__name__)


@dataclass
class SafetyGateDecision:
    """Deterministic evaluation outcome from the safety and approval gate."""

    decision: SafetyDecisionType
    safety_tier: SafetyTier
    allowed: bool
    reason: str
    fix_plan_id: str | None = None
    approval_record_id: str | None = None
    details: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return sanitize_payload({
            "decision": self.decision.value,
            "safety_tier": self.safety_tier.value,
            "allowed": self.allowed,
            "reason": self.reason,
            "fix_plan_id": self.fix_plan_id,
            "approval_record_id": self.approval_record_id,
            "details": self.details,
        })


class OrchestrationSafetyGate:
    """
    Evaluates candidate remediation fix plans against safety tier classification,
    tenant automation level policies, and approval records.
    """

    @classmethod
    def evaluate_fix_plan(
        cls,
        fix_plan: dict[str, Any],
        automation_level: str | AutomationLevel = AutomationLevel.FULL,
        approval_record: ApprovalRecord | None = None,
        execution_request: ExecutionRequest | None = None,
    ) -> SafetyGateDecision:
        """
        Evaluates a candidate fix plan for safe execution.
        """
        auto_level_val = (
            automation_level.value
            if isinstance(automation_level, AutomationLevel)
            else str(automation_level)
        )
        fix_plan_id = str(fix_plan.get("id") or fix_plan.get("fix_plan_id") or "")

        # Extract fields from fix_plan (dict or model instance)
        if isinstance(fix_plan, dict):
            finding_type = fix_plan.get("finding_type") or fix_plan.get("rule_id") or fix_plan.get("action_type")
            category = fix_plan.get("category")
            fix_type = fix_plan.get("fix_type") or fix_plan.get("action_type")
            severity = fix_plan.get("severity") or fix_plan.get("risk_level")
            proposed_action = fix_plan.get("proposed_action") or fix_plan.get("patch_content") or fix_plan.get("suggested_content")
        else:
            finding_type = getattr(fix_plan, "finding_type", getattr(fix_plan, "rule_id", getattr(fix_plan, "action_type", None)))
            category = getattr(fix_plan, "category", None)
            fix_type = getattr(fix_plan, "fix_type", getattr(fix_plan, "action_type", None))
            severity = getattr(fix_plan, "severity", getattr(fix_plan, "risk_level", None))
            proposed_action = getattr(fix_plan, "proposed_action", getattr(fix_plan, "patch_content", None))

        # 1. Classify safety tier
        try:
            classification = classify_fix_safety(
                finding_type=finding_type,
                category=category,
                fix_type=fix_type,
                severity=severity,
                proposed_action=proposed_action,
            )
            tier = getattr(classification, "safety_tier", getattr(classification, "tier", SafetyTier.MANUAL_REVIEW))
            tier_reason = classification.reason
        except Exception as ex:
            logger.warning("Error classifying fix plan '%s': %s; falling back to MANUAL_REVIEW", fix_plan_id, ex)
            tier = SafetyTier.MANUAL_REVIEW
            tier_reason = f"Classification error: {ex}; conservative fallback to MANUAL_REVIEW"

        # 2. Rule: MANUAL_REVIEW is strictly prohibited from autonomous execution
        if tier == SafetyTier.MANUAL_REVIEW:
            return SafetyGateDecision(
                decision=SafetyDecisionType.BLOCKED,
                safety_tier=tier,
                allowed=False,
                reason=f"Fix requires manual expert review: {tier_reason}",
                fix_plan_id=fix_plan_id,
                details={"tier_reason": tier_reason},
            )

        # 3. Rule: Tenant policy allows MANUAL_ONLY -> all fixes require approval
        if auto_level_val == AutomationLevel.MANUAL_ONLY.value:
            # Check if explicit approval record is provided and valid
            if approval_record and execution_request:
                from connectors.execution.approval import ApprovalManager
                valid, err = ApprovalManager.verify_approval(execution_request, approval_record)
                if valid:
                    return SafetyGateDecision(
                        decision=SafetyDecisionType.ALLOWED_AUTO,
                        safety_tier=tier,
                        allowed=True,
                        reason="Explicit approval verified under MANUAL_ONLY policy",
                        fix_plan_id=fix_plan_id,
                        approval_record_id=approval_record.request_id,
                        details={"approved_by": approval_record.approved_by},
                    )
            # Check if fix plan already marked approved
            if str(fix_plan.get("status", "")).lower() == "approved":
                return SafetyGateDecision(
                    decision=SafetyDecisionType.ALLOWED_AUTO,
                    safety_tier=tier,
                    allowed=True,
                    reason="Fix plan status is explicitly 'approved'",
                    fix_plan_id=fix_plan_id,
                )

            return SafetyGateDecision(
                decision=SafetyDecisionType.REQUIRES_APPROVAL,
                safety_tier=tier,
                allowed=False,
                reason="Tenant policy is set to MANUAL_ONLY; autonomous execution is blocked without operator approval",
                fix_plan_id=fix_plan_id,
            )

        # 4. Rule: AUTO_SAFE tier under permissive automation policy
        if tier == SafetyTier.AUTO_SAFE:
            return SafetyGateDecision(
                decision=SafetyDecisionType.ALLOWED_AUTO,
                safety_tier=tier,
                allowed=True,
                reason=f"Fix is classified as AUTO_SAFE and allowed by tenant policy: {tier_reason}",
                fix_plan_id=fix_plan_id,
                details={"tier_reason": tier_reason},
            )

        # 5. Rule: ASSISTED tier requires explicit approval
        if tier == SafetyTier.ASSISTED:
            # Check approval record binding if provided
            if approval_record and execution_request:
                from connectors.execution.approval import ApprovalManager
                valid, err = ApprovalManager.verify_approval(execution_request, approval_record)
                if valid:
                    return SafetyGateDecision(
                        decision=SafetyDecisionType.ALLOWED_AUTO,
                        safety_tier=tier,
                        allowed=True,
                        reason=f"ASSISTED fix approved by {approval_record.approved_by}",
                        fix_plan_id=fix_plan_id,
                        approval_record_id=approval_record.request_id,
                        details={"approved_by": approval_record.approved_by},
                    )
                else:
                    return SafetyGateDecision(
                        decision=SafetyDecisionType.BLOCKED,
                        safety_tier=tier,
                        allowed=False,
                        reason=f"Approval verification failed for ASSISTED fix: {err}",
                        fix_plan_id=fix_plan_id,
                    )

            # Check if fix plan marked approved in database model
            if str(fix_plan.get("status", "")).lower() == "approved":
                return SafetyGateDecision(
                    decision=SafetyDecisionType.ALLOWED_AUTO,
                    safety_tier=tier,
                    allowed=True,
                    reason="ASSISTED fix plan is explicitly marked 'approved'",
                    fix_plan_id=fix_plan_id,
                )

            return SafetyGateDecision(
                decision=SafetyDecisionType.REQUIRES_APPROVAL,
                safety_tier=tier,
                allowed=False,
                reason="Fix is ASSISTED; requires human review and explicit approval before execution",
                fix_plan_id=fix_plan_id,
            )

        # Conservative fallback
        return SafetyGateDecision(
            decision=SafetyDecisionType.BLOCKED,
            safety_tier=SafetyTier.MANUAL_REVIEW,
            allowed=False,
            reason="Unrecognized safety tier; conservative fallback to BLOCKED",
            fix_plan_id=fix_plan_id,
        )
