"""
Deterministic Failure & Recovery Matrix Engine (Task 12 Step 5).

Implements the complete deterministic failure and recovery protocol:
- Classifies incidents across all 13 pipeline stages and operational dependencies
- Strictly forbids blind re-application on ambiguous mutation states
- Enforces bounded retries with zero infinite loops
- Bridges with Task 11 worker recovery and rollback systems
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from enum import Enum
from typing import Any
from pydantic import BaseModel, ConfigDict, Field

from connectors.base.security import sanitize_payload, validate_safe_identifier
from .experiment import ExperimentDecision, ExperimentStatus
from .trace import PipelineStage, StageStatus

logger = logging.getLogger(__name__)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _generate_id(prefix: str = "fail") -> str:
    return f"{prefix}_{uuid.uuid4().hex[:16]}"


# =============================================================================
# 1. Enums
# =============================================================================

class FailureStage(str, Enum):
    """Pipeline or infrastructure layer where an operational failure occurred."""
    DISCOVERY = "DISCOVERY"
    CRAWL = "CRAWL"
    EXTRACTION = "EXTRACTION"
    INTELLIGENCE = "INTELLIGENCE"
    SCORE = "SCORE"
    FINDING = "FINDING"
    FIX_PLAN = "FIX_PLAN"
    SAFETY = "SAFETY"
    APPLY = "APPLY"
    VALIDATE = "VALIDATE"
    RESCAN = "RESCAN"
    COMPARE = "COMPARE"
    ROLLBACK = "ROLLBACK"
    CONNECTOR = "CONNECTOR"
    SECURITY = "SECURITY"
    WORKSPACE = "WORKSPACE"


class FailureClassification(str, Enum):
    """Nature and recoverability tier of the failure."""
    TRANSIENT_RECOVERABLE = "TRANSIENT_RECOVERABLE"
    TRANSIENT_NETWORK = "TRANSIENT_NETWORK"
    PERMANENT_UNRECOVERABLE = "PERMANENT_UNRECOVERABLE"
    AMBIGUOUS_MUTATION = "AMBIGUOUS_MUTATION"
    AMBIGUOUS_MUTATION_STATE = "AMBIGUOUS_MUTATION_STATE"
    VALIDATION_UNCERTAINTY = "VALIDATION_UNCERTAINTY"
    SECURITY_BLOCK = "SECURITY_BLOCK"
    SECURITY_VIOLATION = "SECURITY_VIOLATION"
    STALE_DEPENDENCY_GRAPH = "STALE_DEPENDENCY_GRAPH"
    TIMEOUT = "TIMEOUT"


# =============================================================================
# 2. Incident & Recovery Result Models
# =============================================================================

class FailureIncident(BaseModel):
    """Structured record of an operational failure or exception."""
    model_config = ConfigDict(extra="ignore")

    incident_id: str = Field(
        default_factory=lambda: _generate_id("inc"),
        description="Unique incident identifier",
    )
    execution_id: str = Field(default_factory=lambda: _generate_id("exec"), description="Parent execution ID")
    stage: FailureStage = Field(..., description="Stage where failure occurred")
    classification: FailureClassification = Field(..., description="Failure classification")
    error_message: str = Field(..., description="Sanitized, secret-redacted error description")
    error_code: str | None = Field(default=None, description="Standardized error code")
    is_recovered: bool = Field(default=False, description="True if safely recovered")
    is_retryable: bool = Field(default=False, description="True if safe to retry")
    actionable_remediation: str = Field(default="", description="Recommended remediation action")
    recovery_attempts: int = Field(default=0, description="Count of recovery attempts made")
    occurred_at: datetime = Field(default_factory=_utc_now)
    details: dict[str, Any] = Field(default_factory=dict)

    def model_post_init(self, __context: Any) -> None:
        validate_safe_identifier(self.incident_id, "incident_id")
        if self.execution_id:
            validate_safe_identifier(self.execution_id, "execution_id")
        if self.details:
            object.__setattr__(self, "details", sanitize_payload(self.details))


class RecoveryResult(BaseModel):
    """Actionable outcome of a failure recovery evaluation."""
    model_config = ConfigDict(extra="ignore")

    recovery_id: str = Field(
        default_factory=lambda: _generate_id("rec"),
        description="Unique recovery action identifier",
    )
    incident_id: str = Field(..., description="Associated FailureIncident ID")
    action_taken: str = Field(default="NONE", description="Action taken (e.g. RETRY, BLOCK_DOWNSTREAM, MARK_MANUAL_REVIEW)")
    suggested_action: str = Field(default="FAIL_AND_ALERT", description="Suggested recovery action")
    is_successful: bool = Field(default=False, description="True if recovery resolved the failure safely")
    should_retry: bool = Field(default=False, description="True if retry should be attempted")
    attempts_exhausted: bool = Field(default=False, description="True if max retries exceeded")
    should_escalate_to_full_rescan: bool = Field(default=False, description="True if full rescan is required")
    experiment_status: ExperimentStatus = Field(default=ExperimentStatus.FAILED)
    experiment_decision: ExperimentDecision = Field(default=ExperimentDecision.REVIEW)
    requires_manual_review: bool = Field(default=False, description="True if human intervention is required")
    reason: str = Field(default="", description="Deterministic rationale for recovery decision")
    details: dict[str, Any] = Field(default_factory=dict)


# =============================================================================
# 3. Failure & Recovery Manager
# =============================================================================

class FailureRecoveryManager:
    """
    Deterministic rule engine mapping runtime incidents to safe recovery paths.
    """

    MAX_RETRIES = 2

    @classmethod
    def classify_failure(
        cls,
        stage: FailureStage,
        error_message: str,
        attempt: int = 1,
        details: dict[str, Any] | None = None,
    ) -> FailureIncident:
        """
        Classifies an operational error deterministically.
        """
        err_lower = error_message.lower()
        classification = FailureClassification.PERMANENT_UNRECOVERABLE
        is_retryable = False
        remediation = "Inspect logs and verify environment configuration."

        if "ssrf" in err_lower or "security" in err_lower or "unauthorized" in err_lower or "isolation" in err_lower:
            classification = FailureClassification.SECURITY_VIOLATION
            is_retryable = False
            remediation = "Reject operation immediately and log security audit event."
        elif "stale" in err_lower or "hash mismatch" in err_lower or "graph" in err_lower:
            classification = FailureClassification.STALE_DEPENDENCY_GRAPH
            is_retryable = True
            remediation = "Escalate rescan scope to FULL_RESCAN to rebuild fresh dependency graph."
        elif "ambiguous" in err_lower or "unknown" in err_lower or "socket closed during write" in err_lower:
            classification = FailureClassification.AMBIGUOUS_MUTATION_STATE
            is_retryable = False
            remediation = "Halt execution and verify remote state. Do NOT blindly re-apply."
        elif "timeout" in err_lower or "timed out" in err_lower:
            classification = FailureClassification.TIMEOUT if stage == FailureStage.APPLY else FailureClassification.TRANSIENT_NETWORK
            is_retryable = attempt <= cls.MAX_RETRIES
            remediation = "Inspect connector connectivity and retry if within bounded retry limit."
        elif "connection" in err_lower or "network" in err_lower or "econnrefused" in err_lower or "read timed out" in err_lower:
            classification = FailureClassification.TRANSIENT_NETWORK
            is_retryable = attempt <= cls.MAX_RETRIES
            remediation = "Retry stage with exponential backoff up to max attempts."

        return FailureIncident(
            stage=stage,
            classification=classification,
            error_message=error_message,
            is_retryable=is_retryable,
            actionable_remediation=remediation,
            recovery_attempts=attempt,
            details=details or {},
        )

    @classmethod
    def handle_failure(
        cls,
        incident: FailureIncident,
    ) -> RecoveryResult:
        """
        Handles a FailureIncident and produces actionable recovery recommendations.
        """
        return cls.evaluate_incident(
            incident=incident,
            current_retry_count=incident.recovery_attempts,
        )

    @classmethod
    def evaluate_incident(
        cls,
        incident: FailureIncident,
        current_retry_count: int = 0,
        can_query_remote_status: bool = False,
        remote_status_applied: bool | None = None,
    ) -> RecoveryResult:
        """
        Evaluates a FailureIncident against the Failure/Recovery Matrix.
        """
        stage = incident.stage
        classification = incident.classification
        attempts_exhausted = current_retry_count > cls.MAX_RETRIES

        # 1. Security / Workspace / Auth Failures -> Immediate permanent reject
        if classification in (FailureClassification.SECURITY_BLOCK, FailureClassification.SECURITY_VIOLATION) or stage in (FailureStage.SECURITY, FailureStage.WORKSPACE):
            return RecoveryResult(
                incident_id=incident.incident_id,
                action_taken="REJECT_IMMEDIATELY",
                suggested_action="REJECT_AND_AUDIT",
                is_successful=False,
                should_retry=False,
                attempts_exhausted=False,
                experiment_status=ExperimentStatus.INVALID,
                experiment_decision=ExperimentDecision.NO_CHANGE,
                requires_manual_review=False,
                reason="Security policy or workspace isolation violation. Execution blocked permanently.",
            )

        # 2. Stale Dependency Graph -> Escalate to Full Rescan
        if classification == FailureClassification.STALE_DEPENDENCY_GRAPH or "stale" in incident.error_message.lower():
            return RecoveryResult(
                incident_id=incident.incident_id,
                action_taken="ESCALATE_TO_FULL_RESCAN",
                suggested_action="FULL_RESCAN",
                is_successful=True,
                should_retry=True,
                should_escalate_to_full_rescan=True,
                attempts_exhausted=False,
                experiment_status=ExperimentStatus.RUNNING,
                experiment_decision=ExperimentDecision.REVIEW,
                reason="Stale dependency graph detected; escalating scope to FULL_RESCAN.",
            )

        # 3. Ambiguous mutation state -> Never blind re-apply!
        if classification in (FailureClassification.AMBIGUOUS_MUTATION, FailureClassification.AMBIGUOUS_MUTATION_STATE):
            if can_query_remote_status and remote_status_applied is True:
                return RecoveryResult(
                    incident_id=incident.incident_id,
                    action_taken="RESUME_VALIDATION_AFTER_CONFIRMED_APPLY",
                    suggested_action="RESUME_VALIDATION",
                    is_successful=True,
                    should_retry=False,
                    experiment_status=ExperimentStatus.RUNNING,
                    experiment_decision=ExperimentDecision.REVIEW,
                    reason="Remote connector confirmed mutation applied; resuming post-apply validation.",
                )
            return RecoveryResult(
                incident_id=incident.incident_id,
                action_taken="MARK_MANUAL_REVIEW_REQUIRED",
                suggested_action="HALT_AND_VERIFY_STATE",
                is_successful=False,
                should_retry=False,
                attempts_exhausted=False,
                experiment_status=ExperimentStatus.FAILED,
                experiment_decision=ExperimentDecision.REVIEW,
                requires_manual_review=True,
                reason="Do not blindly re-apply. Mutation status is ambiguous following apply failure. Manual state verification required.",
            )

        # 4. Check bounded retries
        if attempts_exhausted:
            return RecoveryResult(
                incident_id=incident.incident_id,
                action_taken="FAIL_MAX_RETRIES_EXCEEDED",
                suggested_action="FAIL_AND_ALERT",
                is_successful=False,
                should_retry=False,
                attempts_exhausted=True,
                experiment_status=ExperimentStatus.FAILED,
                experiment_decision=ExperimentDecision.REVIEW,
                requires_manual_review=True,
                reason=f"Max retry limit ({cls.MAX_RETRIES}) exhausted for stage '{stage.value}'.",
            )

        # 5. Transient Crawl / Network / Apply Timeout
        if classification in (FailureClassification.TRANSIENT_RECOVERABLE, FailureClassification.TRANSIENT_NETWORK, FailureClassification.TIMEOUT):
            return RecoveryResult(
                incident_id=incident.incident_id,
                action_taken="BOUNDED_RETRY",
                suggested_action="RETRY_STAGE",
                is_successful=True,
                should_retry=True,
                attempts_exhausted=False,
                experiment_status=ExperimentStatus.RUNNING,
                experiment_decision=ExperimentDecision.REVIEW,
                reason=f"Transient failure in stage '{stage.value}'; bounded retry attempt {current_retry_count} initiated.",
            )

        # 6. Discovery Failure -> Fail safely, block downstream
        if stage == FailureStage.DISCOVERY:
            return RecoveryResult(
                incident_id=incident.incident_id,
                action_taken="FAIL_SAFELY_BLOCK_DOWNSTREAM",
                suggested_action="FAIL_AND_ALERT",
                is_successful=False,
                experiment_status=ExperimentStatus.FAILED,
                experiment_decision=ExperimentDecision.NO_CHANGE,
                reason="Site discovery failed; downstream crawl and analysis stages blocked.",
            )

        # 7. Crawl Failure -> Block downstream dependent stages
        if stage == FailureStage.CRAWL:
            return RecoveryResult(
                incident_id=incident.incident_id,
                action_taken="BLOCK_DOWNSTREAM_STAGES",
                suggested_action="FAIL_AND_ALERT",
                is_successful=False,
                experiment_status=ExperimentStatus.FAILED,
                experiment_decision=ExperimentDecision.NO_CHANGE,
                reason="Crawl failed; cannot proceed to extraction or scoring.",
            )

        # 8. Extraction Failure -> Preserve trace and fail affected stage
        if stage == FailureStage.EXTRACTION:
            return RecoveryResult(
                incident_id=incident.incident_id,
                action_taken="PRESERVE_TRACE_FAIL_STAGE",
                suggested_action="FAIL_AND_ALERT",
                is_successful=False,
                experiment_status=ExperimentStatus.FAILED,
                experiment_decision=ExperimentDecision.NO_CHANGE,
                reason="Page feature extraction failed; trace preserved and downstream stages blocked.",
            )

        # 9. Safety Failure -> Strict no mutation
        if stage == FailureStage.SAFETY:
            return RecoveryResult(
                incident_id=incident.incident_id,
                action_taken="ABORT_MUTATION_SAFETY_VIOLATION",
                suggested_action="FAIL_AND_ALERT",
                is_successful=False,
                experiment_status=ExperimentStatus.FAILED,
                experiment_decision=ExperimentDecision.NO_CHANGE,
                reason="Safety gate rejected change proposal; zero mutations permitted.",
            )

        # 10. Rescan Failure -> Mark INCONCLUSIVE / REVIEW
        if stage == FailureStage.RESCAN:
            return RecoveryResult(
                incident_id=incident.incident_id,
                action_taken="MARK_INCONCLUSIVE_REVIEW",
                suggested_action="MARK_INCONCLUSIVE",
                is_successful=False,
                experiment_status=ExperimentStatus.INCONCLUSIVE,
                experiment_decision=ExperimentDecision.REVIEW,
                requires_manual_review=True,
                reason="Targeted rescan failed to fetch or extract post-fix state; experiment is inconclusive.",
            )

        # 11. Rollback Failure -> Escalation to MANUAL_REVIEW_REQUIRED
        if stage == FailureStage.ROLLBACK:
            return RecoveryResult(
                incident_id=incident.incident_id,
                action_taken="ELEVATE_TO_MANUAL_REVIEW_REQUIRED",
                suggested_action="HALT_AND_ALERT_ADMIN",
                is_successful=False,
                experiment_status=ExperimentStatus.FAILED,
                experiment_decision=ExperimentDecision.ROLLBACK,
                requires_manual_review=True,
                reason="Automated rollback failed! Immediate human engineering intervention required.",
            )

        # Default fallback
        return RecoveryResult(
            incident_id=incident.incident_id,
            action_taken="GENERIC_FAILURE_FALLBACK",
            suggested_action="FAIL_AND_ALERT",
            is_successful=False,
            experiment_status=ExperimentStatus.FAILED,
            experiment_decision=ExperimentDecision.REVIEW,
            reason=f"Unclassified failure in stage '{stage.value}'; defaulting to review.",
        )
