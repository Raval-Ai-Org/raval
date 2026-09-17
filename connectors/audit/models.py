"""
Audit Event Data Models and Actions (Task 11 Step 6).

Defines structured, sanitized, append-only audit event records capturing full mutation provenance:
- WHO: actor_id, workspace_id, site_id
- WHAT: requested_operation, resource_reference, before/after states, commit_id, pr_id
- WHERE: site_id, connector, target resource
- WHY: finding_id, recommendation_id, fix_plan_id
- WHICH: execution_id, operation_id
- WHEN: timestamp (UTC)
- VALIDATION & ROLLBACK: validation_result, rescan_result, rollback_result
"""

from __future__ import annotations

import hashlib
import json
import uuid
from datetime import datetime, timezone
from enum import Enum
from typing import Any
from pydantic import BaseModel, ConfigDict, Field

from connectors.base.security import validate_safe_identifier
from connectors.security.scrubber import DeepScrubber


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _generate_audit_id() -> str:
    return f"audit_{uuid.uuid4().hex[:16]}"


class AuditActionType(str, Enum):
    """Categorized audit actions across the fix execution lifecycle."""
    REQUEST_CREATED = "request_created"
    SAFETY_EVALUATED = "safety_evaluated"
    PREVIEW_GENERATED = "preview_generated"
    APPROVAL_GRANTED = "approval_granted"
    APPLY_INITIATED = "apply_initiated"
    APPLY_COMPLETED = "apply_completed"
    VALIDATION_INITIATED = "validation_initiated"
    VALIDATION_COMPLETED = "validation_completed"
    RESCAN_COMPLETED = "rescan_completed"
    REGRESSION_DETECTED = "regression_detected"
    ROLLBACK_INITIATED = "rollback_initiated"
    ROLLBACK_COMPLETED = "rollback_completed"
    EXECUTION_KEPT = "execution_kept"
    EXECUTION_FAILED = "execution_failed"
    EXECUTION_BLOCKED = "execution_blocked"
    SECURITY_VIOLATION = "security_violation"
    RATE_LIMITED = "rate_limited"


class AuditEvent(BaseModel):
    """
    Immutable, append-only audit event capturing full execution provenance.
    Guarantees zero sensitive credentials and deterministic hash verification.
    """
    model_config = ConfigDict(from_attributes=True, populate_by_name=True, extra="allow", frozen=True)

    audit_event_id: str = Field(
        default_factory=_generate_audit_id,
        description="Unique deterministic audit event identifier",
    )
    workspace_id: str = Field(
        ...,
        description="Workspace / Tenant ID",
    )
    site_id: str = Field(
        ...,
        description="Target site identifier",
    )
    actor_id: str = Field(
        ...,
        description="Actor or user initiating the action",
    )
    execution_id: str = Field(
        ...,
        description="Stable ExecutionRequest ID across the entire lifecycle",
    )
    action: AuditActionType | str = Field(
        ...,
        description="Type of lifecycle action recorded",
    )
    connector: str = Field(
        ...,
        description="Connector provider name (e.g. github, wordpress, generic)",
    )
    resource_reference: str = Field(
        ...,
        description="Target resource identifier or path",
    )
    requested_operation: str = Field(
        ...,
        description="Operation name (e.g. preview_change, apply_change, rollback_change)",
    )
    safety_tier: str = Field(
        default="auto_safe",
        description="Safety tier (auto_safe, assisted, manual_review)",
    )
    approval_state: str = Field(
        default="none",
        description="Approval state (none, approved, rejected, pending)",
    )
    lifecycle_state: str = Field(
        default="PLANNED",
        description="State machine lifecycle state",
    )
    timestamp: datetime = Field(
        default_factory=_utc_now,
        description="UTC timestamp of the audit event",
    )
    finding_id: int | None = Field(
        default=None,
        description="Associated Task 9 Finding ID",
    )
    recommendation_id: int | None = Field(
        default=None,
        description="Associated Task 9 Recommendation ID",
    )
    fix_plan_id: int | None = Field(
        default=None,
        description="Associated Task 9 FixPlan ID",
    )
    before_state_reference: str | None = Field(
        default=None,
        description="Hash, token, or identifier of state prior to mutation",
    )
    after_state_reference: str | None = Field(
        default=None,
        description="Hash, token, or identifier of state after mutation",
    )
    operation_id: str | None = Field(
        default=None,
        description="Underlying connector operation ID",
    )
    commit_id: str | None = Field(
        default=None,
        description="Git commit SHA if applicable",
    )
    pr_id: str | None = Field(
        default=None,
        description="Pull Request identifier / number if applicable",
    )
    validation_result: str | None = Field(
        default=None,
        description="Outcome of post-apply validation (VERIFIED, REGRESSION, etc.)",
    )
    rescan_result: str | None = Field(
        default=None,
        description="Outcome or summary of targeted rescan",
    )
    comparison_result: dict[str, Any] | None = Field(
        default=None,
        description="Summary of score/finding delta comparisons",
    )
    rollback_result: str | None = Field(
        default=None,
        description="Rollback status if executed (ROLLED_BACK, ROLLBACK_FAILED)",
    )
    error_classification: str | None = Field(
        default=None,
        description="Standardized error code if failure occurred",
    )
    previous_event_hash: str | None = Field(
        default=None,
        description="SHA-256 hash of the preceding event in the execution ledger",
    )
    details: dict[str, Any] = Field(
        default_factory=dict,
        description="Sanitized contextual diagnostic details",
    )

    def calculate_hash(self) -> str:
        """
        Computes a deterministic SHA-256 integrity hash over all event properties.
        """
        payload = {
            "audit_event_id": self.audit_event_id,
            "workspace_id": self.workspace_id,
            "site_id": self.site_id,
            "actor_id": self.actor_id,
            "execution_id": self.execution_id,
            "action": str(self.action),
            "connector": self.connector,
            "resource_reference": self.resource_reference,
            "requested_operation": self.requested_operation,
            "safety_tier": self.safety_tier,
            "approval_state": self.approval_state,
            "lifecycle_state": self.lifecycle_state,
            "timestamp": self.timestamp.isoformat(),
            "finding_id": self.finding_id,
            "recommendation_id": self.recommendation_id,
            "fix_plan_id": self.fix_plan_id,
            "before_state_reference": self.before_state_reference,
            "after_state_reference": self.after_state_reference,
            "operation_id": self.operation_id,
            "commit_id": self.commit_id,
            "pr_id": self.pr_id,
            "validation_result": self.validation_result,
            "rescan_result": self.rescan_result,
            "rollback_result": self.rollback_result,
            "error_classification": self.error_classification,
            "previous_event_hash": self.previous_event_hash,
        }
        encoded = json.dumps(payload, sort_keys=True).encode("utf-8")
        return hashlib.sha256(encoded).hexdigest()
