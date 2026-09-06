"""
Experiment Contract & Hypothesis Models (Task 12 Step 5).

Defines strongly-typed, deterministic schemas for closed-loop optimization experiments:
SITE -> BASELINE -> CHANGE -> VALIDATE -> RESCAN -> COMPARE -> EXPERIMENT RESULT -> METRICS -> DECISION -> MONITOR
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from enum import Enum
from typing import Any
from pydantic import BaseModel, ConfigDict, Field

from connectors.base.security import sanitize_payload, validate_safe_identifier
from .impact_model import ChangeType

logger = logging.getLogger(__name__)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _generate_id(prefix: str = "exp") -> str:
    return f"{prefix}_{uuid.uuid4().hex[:16]}"


# =============================================================================
# 1. Enums
# =============================================================================

class ExperimentType(str, Enum):
    """Categorization of closed-loop experiments."""
    SINGLE_RESOURCE_FIX = "SINGLE_RESOURCE_FIX"
    RELATIONAL_BATCH_FIX = "RELATIONAL_BATCH_FIX"
    TEMPLATE_FIX = "TEMPLATE_FIX"
    GLOBAL_SITE_FIX = "GLOBAL_SITE_FIX"
    CANARY_VERIFICATION = "CANARY_VERIFICATION"
    REGRESSION_PROBE = "REGRESSION_PROBE"
    CONTROLLED_LAB = "CONTROLLED_LAB"


class ExperimentStatus(str, Enum):
    """Lifecycle execution status of an experiment."""
    PENDING = "PENDING"
    RUNNING = "RUNNING"
    SUCCEEDED = "SUCCEEDED"
    FAILED = "FAILED"
    INCONCLUSIVE = "INCONCLUSIVE"
    INVALID = "INVALID"
    CANCELLED = "CANCELLED"


class ExperimentDecision(str, Enum):
    """Actionable operational decision resulting from an experiment."""
    KEEP = "KEEP"
    ROLLBACK = "ROLLBACK"
    REVIEW = "REVIEW"
    NO_CHANGE = "NO_CHANGE"


class HypothesisResult(str, Enum):
    """Outcome of testing the hypothesis against observed evidence."""
    CONFIRMED = "CONFIRMED"
    NOT_CONFIRMED = "NOT_CONFIRMED"
    INCONCLUSIVE = "INCONCLUSIVE"
    INVALID = "INVALID"


class ObservationConfidence(str, Enum):
    """Delineates direct empirical observations from inferences."""
    OBSERVED = "OBSERVED"
    INFERRED = "INFERRED"
    NOT_MEASURED = "NOT_MEASURED"


# =============================================================================
# 2. Hypothesis Model
# =============================================================================

class Hypothesis(BaseModel):
    """
    Deterministic, testable hypothesis defining expected outcomes of a proposed change.
    """
    model_config = ConfigDict(extra="ignore")

    hypothesis_id: str = Field(
        default_factory=lambda: _generate_id("hyp"),
        description="Unique identifier for the hypothesis",
    )
    description: str = Field(
        default="Deterministic empirical hypothesis",
        description="Human-readable description of the expected empirical effect",
    )
    expected_outcome: str | None = Field(
        default=None,
        description="Alias for expected outcome or description",
    )
    target_resource: str = Field(
        default="/",
        description="Resource path or ID targeted by the hypothesis",
    )
    target_finding_ids: list[str] = Field(
        default_factory=list,
        description="Specific finding IDs targeted for resolution",
    )
    target_rule_ids: list[str] = Field(
        default_factory=list,
        description="Rule IDs targeted for verification",
    )
    expected_score_min_delta: float = Field(
        default=0.0,
        description="Minimum expected score improvement (e.g. +5.0)",
    )
    max_allowed_regression_delta: float = Field(
        default=0.0,
        description="Maximum allowed score drop (e.g. 0.0)",
    )
    expected_rescan_scope: str = Field(
        default="TARGETED_RESOURCE",
        description="Expected rescan scope: TARGETED_RESOURCE, RELATED_RESOURCES, FULL_SITE",
    )
    confidence_level: ObservationConfidence = Field(
        default=ObservationConfidence.OBSERVED,
        description="Confidence classification for hypothesis observation",
    )
    expected_change_type: ChangeType = Field(
        default=ChangeType.PAGE_METADATA,
        description="Expected categorization of the change",
    )
    expected_finding_resolutions: list[str] = Field(
        default_factory=list,
        description="Rule codes or finding IDs expected to transition OPEN -> RESOLVED",
    )
    expected_evidence_signals: dict[str, Any] = Field(
        default_factory=dict,
        description="Exact tag, markup, or metadata conditions expected in AFTER evidence",
    )
    expected_score_direction: str = Field(
        default="NON_NEGATIVE",
        description="Expected score direction: POSITIVE, NEUTRAL, NON_NEGATIVE",
    )
    acceptable_regression_boundary: dict[str, Any] = Field(
        default_factory=dict,
        description="Acceptable regression threshold",
    )
    metadata: dict[str, Any] = Field(
        default_factory=dict,
        description="Hypothesis context metadata",
    )

    def model_post_init(self, __context: Any) -> None:
        validate_safe_identifier(self.hypothesis_id, "hypothesis_id")
        if self.expected_outcome and not self.description:
            object.__setattr__(self, "description", self.expected_outcome)
        elif self.description and not self.expected_outcome:
            object.__setattr__(self, "expected_outcome", self.description)
        if self.metadata:
            object.__setattr__(self, "metadata", sanitize_payload(self.metadata))


# =============================================================================
# 3. Experiment Contract
# =============================================================================

class Experiment(BaseModel):
    """
    Complete contract representing a closed-loop optimization experiment session.
    """
    model_config = ConfigDict(extra="ignore")

    experiment_id: str = Field(
        default_factory=lambda: _generate_id("exp"),
        description="Unique experiment identifier",
    )
    execution_id: str = Field(
        default_factory=lambda: _generate_id("exec"),
        description="Associated pipeline execution trace identifier",
    )
    name: str = Field(
        default="Closed-Loop Optimization Experiment",
        description="Descriptive experiment title",
    )
    description: str = Field(
        default="",
        description="Detailed description or engineering purpose",
    )
    tags: list[str] = Field(
        default_factory=list,
        description="Categorization tags",
    )
    site_id: str = Field(
        default="default_site",
        description="Website or domain identifier",
    )
    site_url: str = Field(
        default="https://lab.local",
        description="Base site URL",
    )
    workspace_id: str | None = Field(
        default="default_ws",
        description="Tenant / Workspace ID for multi-tenant isolation",
    )
    experiment_type: ExperimentType = Field(
        default=ExperimentType.SINGLE_RESOURCE_FIX,
        description="Type of experiment executed",
    )
    hypothesis: Hypothesis = Field(
        default_factory=lambda: Hypothesis(description="Default hypothesis"),
        description="Testable hypothesis backing the experiment",
    )
    objective: str = Field(
        default="Remediate intentional defect and verify closed-loop resolution",
        description="High-level engineering or optimization objective",
    )
    target_resource: str = Field(
        default="/",
        description="Canonical path or ID of the primary resource tested",
    )
    change_type: ChangeType = Field(
        default=ChangeType.PAGE_METADATA,
        description="Category of change executed",
    )
    idempotency_key: str | None = Field(
        default=None,
        description="Deterministic idempotency token",
    )

    # Trace & Lineage References
    baseline_reference: dict[str, Any] = Field(
        default_factory=dict,
        description="Reference to BEFORE snapshot (evidence_id, snapshot_ref, timestamp)",
    )
    execution_reference: dict[str, Any] = Field(
        default_factory=dict,
        description="Reference to mutation (fix_plan_id, operation_id, applied_status)",
    )
    validation_reference: dict[str, Any] = Field(
        default_factory=dict,
        description="Reference to validation (validation_id, outcome, checks_passed)",
    )
    rescan_reference: dict[str, Any] = Field(
        default_factory=dict,
        description="Reference to targeted rescan (rescan_id, scope, rescanned_targets)",
    )
    comparison_reference: dict[str, Any] = Field(
        default_factory=dict,
        description="Reference to comparison (comparison_id, delta_ref, decision)",
    )

    # Status & Evaluation
    status: ExperimentStatus = Field(
        default=ExperimentStatus.PENDING,
        description="Current experiment execution status",
    )
    decision: ExperimentDecision = Field(
        default=ExperimentDecision.NO_CHANGE,
        description="Final deterministic decision: KEEP, ROLLBACK, REVIEW, NO_CHANGE",
    )
    failure_reason: str | None = Field(
        default=None,
        description="Safe error reason if experiment failed or became invalid",
    )
    created_at: datetime = Field(
        default_factory=_utc_now,
        description="Creation timestamp in UTC",
    )
    completed_at: datetime | None = Field(
        default=None,
        description="Completion timestamp in UTC",
    )
    provenance: dict[str, Any] = Field(
        default_factory=dict,
        description="Lineage trace and audit provenance",
    )
    metadata: dict[str, Any] = Field(
        default_factory=dict,
        description="Diagnostic telemetry",
    )

    def model_post_init(self, __context: Any) -> None:
        validate_safe_identifier(self.experiment_id, "experiment_id")
        validate_safe_identifier(self.execution_id, "execution_id")
        if self.workspace_id:
            validate_safe_identifier(self.workspace_id, "workspace_id")
        if self.idempotency_key:
            validate_safe_identifier(self.idempotency_key, "idempotency_key")
        if self.metadata:
            object.__setattr__(self, "metadata", sanitize_payload(self.metadata))
