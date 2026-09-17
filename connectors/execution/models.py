"""
Execution Foundation and Lifecycle Models (Task 11 Step 4).

Defines normalized data structures for:
- Execution requests, targets, and results
- Safety gate decisions and policy evaluations
- Approval records and proposal binding
- Execution lifecycle state tracking
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from enum import Enum
from typing import Any
from pydantic import BaseModel, ConfigDict, Field

from backend.app.fix_safety_classifier import SafetyTier
from connectors.base.enums import ConnectorCapability, ExecutionOperationType, ExecutionStatus
from connectors.base.errors import ConnectorErrorInfo
from connectors.base.models import (
    ChangePreview,
    ChangeProposal,
    ChangeResult,
    OperationId,
    ResourceContent,
    ResourceReference,
    SiteContext,
)
from connectors.base.security import redact_secrets_from_string, sanitize_payload, validate_safe_identifier


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _generate_id(prefix: str = "req") -> str:
    return f"{prefix}_{uuid.uuid4().hex[:16]}"


# =============================================================================
# 1. Lifecycle Enums
# =============================================================================

class SafetyDecisionType(str, Enum):
    """Deterministic Safety Gate evaluation decisions."""
    ALLOWED_AUTO = "allowed_auto"
    REQUIRES_APPROVAL = "requires_approval"
    BLOCKED = "blocked"


class ExecutionLifecycleState(str, Enum):
    """Deterministic state machine stages for fix execution."""
    PLANNED = "PLANNED"
    SAFETY_CHECKED = "SAFETY_CHECKED"
    PREVIEWED = "PREVIEWED"
    APPROVED = "APPROVED"
    APPLYING = "APPLYING"
    APPLIED = "APPLIED"
    VALIDATING = "VALIDATING"
    RESCANNING = "RESCANNING"
    VERIFIED = "VERIFIED"
    REGRESSION = "REGRESSION"
    KEPT = "KEPT"
    ROLLED_BACK = "ROLLED_BACK"
    ROLLBACK_FAILED = "ROLLBACK_FAILED"
    MANUAL_REVIEW_REQUIRED = "MANUAL_REVIEW_REQUIRED"
    FAILED = "FAILED"
    BLOCKED = "BLOCKED"
    REJECTED = "REJECTED"


class ValidationOutcome(str, Enum):
    """Deterministic outcome of post-apply validation."""
    RESOLVED = "RESOLVED"
    PARTIAL = "PARTIAL"
    UNRESOLVED = "UNRESOLVED"
    REGRESSION = "REGRESSION"
    UNABLE_TO_VALIDATE = "UNABLE_TO_VALIDATE"


class RegressionSeverity(str, Enum):
    """Severity of a detected post-apply regression."""
    NONE = "none"
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


# =============================================================================
# 2. Execution Target & Request Models
# =============================================================================

class ExecutionTarget(BaseModel):
    """
    Identifies the target environment and resource for a fix execution.
    """
    model_config = ConfigDict(from_attributes=True, populate_by_name=True, extra="allow")

    site_context: SiteContext = Field(
        ...,
        description="Target site context and environment specification",
    )
    resource: ResourceReference = Field(
        ...,
        description="Specific target resource reference on the site",
    )


class ExecutionRequest(BaseModel):
    """
    Structured request initiating an execution engine operation.
    Links directly to upstream Task 9 FixPlan, Recommendation, and SafetyTier.
    """
    model_config = ConfigDict(from_attributes=True, populate_by_name=True, extra="allow")

    request_id: str = Field(
        default_factory=lambda: _generate_id("req"),
        description="Unique execution request identifier",
    )
    workspace_id: str | None = Field(
        default=None,
        description="Tenant / Workspace ID associated with request",
    )
    operation: ExecutionOperationType = Field(
        ...,
        description="Operation to perform (preview_change, apply_change, rollback_change, etc.)",
    )
    target: ExecutionTarget = Field(
        ...,
        description="Target site and resource specification",
    )
    fix_plan_id: int | None = Field(
        default=None,
        description="Associated Task 9 FixPlan ID",
    )
    recommendation_id: int | None = Field(
        default=None,
        description="Associated Task 9 Recommendation ID",
    )
    finding_id: int | None = Field(
        default=None,
        description="Associated Task 9 Finding ID",
    )
    safety_tier: SafetyTier | str = Field(
        default=SafetyTier.AUTO_SAFE,
        description="Safety tier (auto_safe, assisted, manual_review)",
    )
    change_proposal: ChangeProposal | None = Field(
        default=None,
        description="Change proposal details (required for preview/apply operations)",
    )
    idempotency_key: str = Field(
        default_factory=lambda: uuid.uuid4().hex,
        description="Idempotency token to prevent accidental duplicate execution",
    )
    actor: str = Field(
        default="system",
        description="Actor or user initiating the execution request",
    )
    parameters: dict[str, Any] = Field(
        default_factory=dict,
        description="Sanitized execution parameters",
    )
    created_at: datetime = Field(
        default_factory=_utc_now,
        description="Timestamp when request was constructed (UTC)",
    )

    def model_post_init(self, __context: Any) -> None:
        validate_safe_identifier(self.request_id, "request_id")
        validate_safe_identifier(self.idempotency_key, "idempotency_key")
        if self.parameters:
            object.__setattr__(self, "parameters", sanitize_payload(self.parameters))


# =============================================================================
# 3. Safety Gate & Approval Models
# =============================================================================

class SafetyGateDecision(BaseModel):
    """
    Structured outcome of the Safety Gate deterministic evaluation.
    """
    model_config = ConfigDict(from_attributes=True, populate_by_name=True, extra="allow")

    decision: SafetyDecisionType = Field(
        ...,
        description="Safety decision: allowed_auto, requires_approval, or blocked",
    )
    safety_tier: SafetyTier = Field(
        ...,
        description="Assigned safety tier: auto_safe, assisted, or manual_review",
    )
    is_allowed: bool = Field(
        ...,
        description="Whether the operation is permitted to proceed (either auto or with approval)",
    )
    is_auto_executable: bool = Field(
        default=False,
        description="Whether the operation may execute automatically without prior human approval",
    )
    requires_approval: bool = Field(
        default=True,
        description="Whether explicit human approval is mandatory prior to apply",
    )
    reasons: list[str] = Field(
        default_factory=list,
        description="Explanatory reasons justifying the safety decision",
    )
    blocking_reasons: list[str] = Field(
        default_factory=list,
        description="Specific policy violations or risks blocking auto-execution or apply",
    )
    required_approval: str | None = Field(
        default=None,
        description="Description of required approval role or sign-off if needed",
    )
    required_capabilities: list[ConnectorCapability] = Field(
        default_factory=list,
        description="Connector capabilities mandatory for this operation",
    )
    rollback_required: bool = Field(
        default=True,
        description="Whether automated rollback capability is mandatory",
    )
    validation_required: bool = Field(
        default=True,
        description="Whether post-execution validation (Step 5) is required",
    )
    safe_bounds: dict[str, Any] = Field(
        default_factory=dict,
        description="Safety constraints (is_destructive, reversible, claim_sensitive)",
    )
    metadata: dict[str, Any] = Field(
        default_factory=dict,
        description="Diagnostic metadata and telemetry",
    )

    def model_post_init(self, __context: Any) -> None:
        if self.metadata:
            object.__setattr__(self, "metadata", sanitize_payload(self.metadata))


class ApprovalRecord(BaseModel):
    """
    Explicit, auditable human approval bound strictly to an execution request and proposal.
    """
    model_config = ConfigDict(from_attributes=True, populate_by_name=True, extra="allow")

    approval_id: str = Field(
        default_factory=lambda: _generate_id("appr"),
        description="Unique approval record identifier",
    )
    request_id: str = Field(
        ...,
        description="Identifier of the specific ExecutionRequest being approved",
    )
    fix_plan_id: int | None = Field(
        default=None,
        description="Exact FixPlan ID authorized",
    )
    target_resource_id: str = Field(
        ...,
        description="Canonical target resource ID authorized",
    )
    proposal_hash: str = Field(
        ...,
        description="Deterministic SHA-256 hash of the approved proposal content/parameters",
    )
    approved_by: str = Field(
        ...,
        description="Username, email, or identity of the human approver",
    )
    approver_role: str = Field(
        default="admin",
        description="Role of the approver (admin, editor, engineer)",
    )
    approved_at: datetime = Field(
        default_factory=_utc_now,
        description="Timestamp when approval was granted (UTC)",
    )
    comments: str | None = Field(
        default=None,
        description="Optional approval notes or sign-off commentary",
    )
    metadata: dict[str, Any] = Field(
        default_factory=dict,
        description="Sanitized approval context metadata",
    )

    def model_post_init(self, __context: Any) -> None:
        validate_safe_identifier(self.approval_id, "approval_id")
        validate_safe_identifier(self.request_id, "request_id")
        if self.comments:
            object.__setattr__(self, "comments", redact_secrets_from_string(self.comments))
        if self.metadata:
            object.__setattr__(self, "metadata", sanitize_payload(self.metadata))


# =============================================================================
# 4. Step 5 — Validation, Rescan, and Rollback Models
# =============================================================================

class RescanTarget(BaseModel):
    """Identifies the targeted page or endpoint to rescan."""
    model_config = ConfigDict(from_attributes=True, populate_by_name=True, extra="allow")

    url: str | None = Field(default=None, description="Resolved full URL of target page")
    resource_id: str = Field(..., description="Canonical target resource ID")
    resource_type: str = Field(default="website_page", description="Resource type")
    provider: str = Field(default="generic", description="Connector provider name")
    metadata: dict[str, Any] = Field(default_factory=dict, description="Diagnostic target context")


class TargetedRescanResult(BaseModel):
    """Structured output from fetching and extracting the affected resource."""
    model_config = ConfigDict(from_attributes=True, populate_by_name=True, extra="allow")

    rescan_id: str = Field(default_factory=lambda: _generate_id("rescan"))
    target: RescanTarget = Field(...)
    status_code: int | None = Field(default=None, description="HTTP status code if fetched via HTTP")
    content: str | None = Field(default=None, description="Raw fetched content or markup")
    extraction_result: dict[str, Any] | None = Field(default=None, description="Extracted features/metadata")
    fetched_at: datetime = Field(default_factory=_utc_now)
    evidence: dict[str, Any] = Field(default_factory=dict, description="Structured evidence payload")
    error: str | None = Field(default=None, description="Error message if fetch failed")

    @property
    def is_success(self) -> bool:
        return self.error is None and (self.status_code is None or self.status_code == 200) and self.content is not None


class ScoreComparison(BaseModel):
    """Before/after comparison of scoring metrics with full provenance."""
    model_config = ConfigDict(from_attributes=True, populate_by_name=True, extra="allow")

    category: str | None = Field(default=None, description="Scoring category evaluated")
    score_before: float | None = Field(default=None, description="Category score before fix")
    score_after: float | None = Field(default=None, description="Category score after fix")
    score_delta: float | None = Field(default=None, description="Delta (score_after - score_before)")
    is_applicable: bool = Field(default=True, description="Whether this score was applicable")
    provenance: dict[str, Any] = Field(default_factory=dict, description="Traceability provenance")


class FindingComparison(BaseModel):
    """Before/after comparison of finding status and evidence."""
    model_config = ConfigDict(from_attributes=True, populate_by_name=True, extra="allow")

    finding_id: int | None = Field(default=None, description="Task 9 finding ID")
    rule_id: str | None = Field(default=None, description="Intelligence rule ID evaluated")
    status_before: str = Field(default="FAIL", description="Finding status before mutation")
    status_after: str = Field(default="PASS", description="Finding status after validation")
    is_resolved: bool = Field(default=True, description="Whether the issue is resolved")
    evidence_before: dict[str, Any] = Field(default_factory=dict, description="Evidence prior to fix")
    evidence_after: dict[str, Any] = Field(default_factory=dict, description="Evidence after fix")


class RegressionIndicator(BaseModel):
    """Specific regression failure detected during validation."""
    model_config = ConfigDict(from_attributes=True, populate_by_name=True, extra="allow")

    indicator_type: str = Field(..., description="Type of regression (e.g. resource_missing, metadata_loss)")
    severity: RegressionSeverity = Field(default=RegressionSeverity.HIGH, description="Severity")
    message: str = Field(..., description="Human-readable explanation of regression")
    details: dict[str, Any] = Field(default_factory=dict, description="Diagnostic evidence")


class ValidationReport(BaseModel):
    """Comprehensive, auditable report produced by the Step 5 Validation Engine."""
    model_config = ConfigDict(from_attributes=True, populate_by_name=True, extra="allow")

    validation_id: str = Field(default_factory=lambda: _generate_id("val"))
    request_id: str = Field(..., description="Associated ExecutionRequest ID")
    operation_id: str | None = Field(default=None, description="Associated connector operation ID")
    outcome: ValidationOutcome = Field(..., description="Overall validation outcome")
    is_verified: bool = Field(default=False, description="True if verified and fix succeeded")
    is_regression: bool = Field(default=False, description="True if a regression was detected")
    regression_indicators: list[RegressionIndicator] = Field(default_factory=list)
    finding_comparison: FindingComparison | None = Field(default=None)
    score_comparison: ScoreComparison | None = Field(default=None)
    rescan_result: TargetedRescanResult | None = Field(default=None)
    checks_performed: list[str] = Field(default_factory=list)
    evidence: dict[str, Any] = Field(default_factory=dict)
    rollback_recommended: bool = Field(default=False)
    rollback_required: bool = Field(default=False)
    created_at: datetime = Field(default_factory=_utc_now)
    metadata: dict[str, Any] = Field(default_factory=dict)

    def model_post_init(self, __context: Any) -> None:
        if self.metadata:
            object.__setattr__(self, "metadata", sanitize_payload(self.metadata))


class RollbackVerificationResult(BaseModel):
    """Result of executing and verifying a rollback operation."""
    model_config = ConfigDict(from_attributes=True, populate_by_name=True, extra="allow")

    rollback_id: str = Field(default_factory=lambda: _generate_id("rb"))
    request_id: str = Field(..., description="Associated ExecutionRequest ID")
    operation_id: str | None = Field(default=None, description="Rollback operation ID")
    status: str = Field(default="ROLLED_BACK", description="Status (RESTORED, ROLLED_BACK, ROLLBACK_FAILED, MANUAL_REVIEW_REQUIRED)")
    is_restored: bool = Field(default=True, description="Whether original baseline was verified restored")
    restoration_evidence: dict[str, Any] = Field(default_factory=dict)
    error: str | None = Field(default=None)
    verified_at: datetime = Field(default_factory=_utc_now)
    metadata: dict[str, Any] = Field(default_factory=dict)


# =============================================================================
# 5. Execution Session & Result Models
# =============================================================================

class ExecutionResult(BaseModel):
    """
    Comprehensive outcome of an execution engine request.
    Consolidates change results, previews, validation reports, and sanitized diagnostics.
    """
    model_config = ConfigDict(from_attributes=True, populate_by_name=True, extra="allow")

    request_id: str = Field(
        ...,
        description="Identifier of the originating ExecutionRequest",
    )
    operation_id: OperationId | str | None = Field(
        default=None,
        description="Underlying connector operation identifier if initiated",
    )
    status: ExecutionStatus = Field(
        ...,
        description="Overall execution status (APPLIED, PREVIEWED, ROLLED_BACK, FAILED, etc.)",
    )
    lifecycle_state: ExecutionLifecycleState = Field(
        default=ExecutionLifecycleState.PLANNED,
        description="Lifecycle state reached",
    )
    operation: ExecutionOperationType = Field(
        ...,
        description="Operation executed",
    )
    target: ExecutionTarget = Field(
        ...,
        description="Target site and resource",
    )
    safety_decision: SafetyGateDecision | None = Field(
        default=None,
        description="Safety Gate evaluation result",
    )
    approval: ApprovalRecord | None = Field(
        default=None,
        description="Approval record if approved",
    )
    change_preview: ChangePreview | None = Field(
        default=None,
        description="Change preview output if preview was requested",
    )
    change_result: ChangeResult | None = Field(
        default=None,
        description="Mutation outcome if apply or rollback was executed",
    )
    validation_report: ValidationReport | None = Field(
        default=None,
        description="Validation report if post-apply validation was executed",
    )
    rollback_verification: RollbackVerificationResult | None = Field(
        default=None,
        description="Rollback verification result if rollback was executed",
    )
    resource_content: ResourceContent | None = Field(
        default=None,
        description="Resource content if read_resource was executed",
    )
    error: ConnectorErrorInfo | None = Field(
        default=None,
        description="Sanitized error details if execution failed",
    )
    started_at: datetime = Field(
        default_factory=_utc_now,
        description="Execution start timestamp (UTC)",
    )
    completed_at: datetime = Field(
        default_factory=_utc_now,
        description="Execution completion timestamp (UTC)",
    )
    duration_ms: float = Field(
        default=0.0,
        description="Execution elapsed duration in milliseconds",
    )
    metadata: dict[str, Any] = Field(
        default_factory=dict,
        description="Sanitized diagnostic metadata",
    )

    def model_post_init(self, __context: Any) -> None:
        if self.metadata:
            object.__setattr__(self, "metadata", sanitize_payload(self.metadata))


class ExecutionRecord(BaseModel):
    """
    Session tracking record for an execution request in the engine registry.
    """
    model_config = ConfigDict(from_attributes=True, populate_by_name=True, extra="allow")

    request: ExecutionRequest = Field(...)
    state: ExecutionLifecycleState = Field(default=ExecutionLifecycleState.PLANNED)
    safety_decision: SafetyGateDecision | None = Field(default=None)
    preview: ChangePreview | None = Field(default=None)
    approval: ApprovalRecord | None = Field(default=None)
    result: ExecutionResult | None = Field(default=None)
    validation_report: ValidationReport | None = Field(default=None)
    rollback_verification: RollbackVerificationResult | None = Field(default=None)
    history: list[tuple[ExecutionLifecycleState, datetime]] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=_utc_now)
    updated_at: datetime = Field(default_factory=_utc_now)

    def transition_to(self, new_state: ExecutionLifecycleState) -> None:
        """Records a lifecycle transition."""
        self.state = new_state
        self.history.append((new_state, _utc_now()))
        self.updated_at = _utc_now()

