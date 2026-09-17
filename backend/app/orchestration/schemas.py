"""
Production Orchestration & Monitoring - Pydantic Schemas.

Defines validated data transfer schemas for run requests, stage execution,
state transitions, actor provenance, and structured error responses.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from pydantic import BaseModel, ConfigDict, Field, model_validator

from .enums import (
    CancellationOutcome,
    CheckpointType,
    ControlSignalType,
    FailureClass,
    OrchestrationEventType,
    ReceiptStatus,
    RecoveryActionType,
    RunState,
    RunType,
    ScheduleStatus,
    ScheduleType,
    StageName,
    StageState,
    TriggerSource,
)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


class ActorProvenance(BaseModel):
    """Structured actor identity and provenance details."""

    model_config = ConfigDict(extra="ignore")

    actor_id: str = Field(default="system", description="Identifier of the initiating user or service")
    actor_type: str = Field(default="user", description="Type of actor ('user', 'system', 'scheduler', 'webhook')")
    client_ip: str | None = Field(default=None, description="Client IP address if available (redacted if sensitive)")
    user_agent: str | None = Field(default=None, description="Client user agent string")
    metadata: dict[str, Any] = Field(default_factory=dict, description="Additional scrubbed context metadata")


class StructuredErrorDetail(BaseModel):
    """Structured, non-secret failure details."""

    model_config = ConfigDict(extra="ignore")

    error_code: str = Field(..., description="Machine-readable error classification code")
    message: str = Field(..., description="Human-readable sanitized error description")
    category: str | None = Field(default=None, description="High-level category (e.g., 'NETWORK', 'AUTH', 'SCHEMA')")
    details: dict[str, Any] = Field(default_factory=dict, description="Scrubbed contextual parameters")
    occurred_at: datetime = Field(default_factory=_utc_now, description="UTC timestamp of occurrence")


class OrchestrationRunCreateRequest(BaseModel):
    """Request payload to initiate a new orchestration run."""

    model_config = ConfigDict(extra="ignore")

    workspace_id: str = Field(..., description="Tenant workspace identifier")
    site_id: int = Field(..., description="Target site/website ID")
    run_type: RunType = Field(default=RunType.ON_DEMAND_SCAN, description="Execution archetype")
    trigger_source: TriggerSource = Field(default=TriggerSource.MANUAL, description="Run trigger mechanism")
    idempotency_key: str | None = Field(
        default=None, description="Client-provided or generated idempotency token"
    )
    correlation_id: str | None = Field(
        default=None, description="Distributed correlation tracking identifier"
    )
    actor_provenance: ActorProvenance = Field(
        default_factory=lambda: ActorProvenance(actor_id="system"),
        description="Actor provenance details",
    )
    metadata_payload: dict[str, Any] = Field(
        default_factory=dict, description="Arbitrary run metadata (scrubbed)"
    )


class RunStateTransitionRequest(BaseModel):
    """Request to transition the state of an orchestration run."""

    model_config = ConfigDict(extra="ignore")

    target_state: RunState = Field(..., description="Desired target state")
    expected_version: int | None = Field(
        default=None, description="Expected current entity version for optimistic locking"
    )
    reason: str | None = Field(default=None, description="Audit reason for the transition")
    error_detail: StructuredErrorDetail | dict[str, Any] | None = Field(
        default=None, description="Structured failure payload if entering error state"
    )
    outcome_summary: dict[str, Any] | None = Field(
        default=None, description="Final outcome metrics and summary if completing"
    )


class StageStateTransitionRequest(BaseModel):
    """Request to transition the state of an individual orchestration stage."""

    model_config = ConfigDict(extra="ignore")

    target_state: StageState = Field(..., description="Desired target stage state")
    expected_version: int | None = Field(
        default=None, description="Expected current stage version for optimistic locking"
    )
    reason: str | None = Field(default=None, description="Audit reason for the transition")
    error_detail: StructuredErrorDetail | dict[str, Any] | None = Field(
        default=None, description="Structured failure payload if entering error state"
    )
    output_summary: dict[str, Any] | None = Field(
        default=None, description="Stage output summary and artifact references"
    )


class OrchestrationStageResponse(BaseModel):
    """API and domain response model for an individual orchestration stage."""

    model_config = ConfigDict(from_attributes=True, extra="ignore")

    id: str
    run_id: str
    workspace_id: str
    site_id: int
    stage_name: StageName
    state: StageState
    execution_order: int
    dependencies: list[str] = Field(default_factory=list)
    idempotency_key: str
    attempt_count: int
    max_attempts: int
    queued_at: datetime
    started_at: datetime | None = None
    completed_at: datetime | None = None
    last_heartbeat_at: datetime | None = None
    error_detail: dict[str, Any] | None = None
    output_summary: dict[str, Any] | None = None
    version: int


class OrchestrationEventResponse(BaseModel):
    """API and domain response model for an immutable audit event."""

    model_config = ConfigDict(from_attributes=True, extra="ignore")

    id: str
    run_id: str
    stage_id: str | None = None
    workspace_id: str
    site_id: int
    event_type: str
    from_state: str | None = None
    to_state: str | None = None
    details: dict[str, Any] = Field(default_factory=dict)
    occurred_at: datetime


class OrchestrationRunResponse(BaseModel):
    """API and domain response model for an orchestration run."""

    model_config = ConfigDict(from_attributes=True, extra="ignore")

    id: str
    run_id: str | None = None
    workspace_id: str
    site_id: int
    run_type: RunType
    state: RunState
    trigger_source: TriggerSource
    idempotency_key: str
    correlation_id: str
    attempt_count: int
    recovery_info: dict[str, Any] | None = None
    actor_provenance: dict[str, Any] = Field(default_factory=dict)
    outcome_summary: dict[str, Any] | None = None
    error_detail: dict[str, Any] | None = None
    version: int
    requested_at: datetime
    started_at: datetime | None = None
    completed_at: datetime | None = None
    cancelled_at: datetime | None = None
    metadata_payload: dict[str, Any] = Field(default_factory=dict)
    stages: list[OrchestrationStageResponse] = Field(default_factory=list)

    @model_validator(mode="after")
    def populate_run_id(self) -> OrchestrationRunResponse:
        if not self.run_id:
            self.run_id = self.id
        return self


class ScheduleCreateRequest(BaseModel):
    """Payload to create a new recurring or on-demand schedule."""

    model_config = ConfigDict(extra="ignore")

    workspace_id: str = Field(..., description="Tenant workspace scope")
    site_id: int = Field(..., description="Target website ID")
    name: str = Field(..., description="Human-readable schedule label")
    schedule_type: ScheduleType = Field(default=ScheduleType.INTERVAL, description="Interval or cron")
    cron_expression: str | None = Field(default=None, description="5-part cron syntax (e.g. '0 9 * * 1-5')")
    interval_seconds: int | None = Field(default=None, description="Interval duration in seconds (min 60)")
    timezone: str = Field(default="UTC", description="IANA timezone name (e.g. 'America/New_York')")
    minimum_interval_seconds: int = Field(default=300, description="Minimum allowed firing frequency")
    run_type: RunType = Field(default=RunType.SCHEDULED_SCAN, description="Type of run to create upon firing")
    configuration: dict[str, Any] = Field(default_factory=dict, description="Execution parameters")
    actor_provenance: ActorProvenance = Field(
        default_factory=lambda: ActorProvenance(actor_id="system", actor_type="scheduler")
    )


class ScheduleUpdateRequest(BaseModel):
    """Payload to modify an existing schedule."""

    model_config = ConfigDict(extra="ignore")

    name: str | None = Field(default=None)
    status: ScheduleStatus | None = Field(default=None)
    schedule_type: ScheduleType | None = Field(default=None)
    cron_expression: str | None = Field(default=None)
    interval_seconds: int | None = Field(default=None)
    timezone: str | None = Field(default=None)
    minimum_interval_seconds: int | None = Field(default=None)
    run_type: RunType | None = Field(default=None)
    configuration: dict[str, Any] | None = Field(default=None)
    expected_version: int | None = Field(default=None, description="Optimistic locking token")


class ScheduleResponse(BaseModel):
    """API and domain representation of an orchestration schedule."""

    model_config = ConfigDict(from_attributes=True, extra="ignore")

    id: str
    workspace_id: str
    site_id: int
    name: str
    status: ScheduleStatus
    schedule_type: ScheduleType
    cron_expression: str | None = None
    interval_seconds: int | None = None
    timezone: str
    next_run_at: datetime | None = None
    last_run_at: datetime | None = None
    minimum_interval_seconds: int
    run_type: RunType
    configuration: dict[str, Any] = Field(default_factory=dict)
    actor_provenance: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime
    updated_at: datetime
    version: int


class QueueMetricsResponse(BaseModel):
    """Queue depth and worker load metrics."""

    model_config = ConfigDict(extra="ignore")

    total_queue_depth: int
    workspace_queue_depth: int | None = None
    active_leased_jobs: int
    visible_waiting_jobs: int


class CapacityStatusResponse(BaseModel):
    """Concurrency capacity and backpressure status."""

    model_config = ConfigDict(extra="ignore")

    workspace_id: str | None = None
    site_id: int | None = None
    active_runs: int
    limit: int
    available_slots: int
    backpressured: bool


class ExecutionReceiptResponse(BaseModel):
    """API representation of a durable idempotency execution receipt."""

    model_config = ConfigDict(from_attributes=True, extra="ignore")

    id: str
    workspace_id: str
    run_id: str
    stage_id: str | None = None
    idempotency_key: str
    provider_name: str
    operation_type: str
    status: ReceiptStatus
    external_reference_id: str | None = None
    is_safe_to_retry: bool
    response_payload: dict[str, Any] = Field(default_factory=dict)
    error_detail: dict[str, Any] | None = None
    created_at: datetime
    updated_at: datetime


class FailureReportResponse(BaseModel):
    """Sanitized failure diagnostic response."""

    model_config = ConfigDict(extra="ignore")

    failure_class: FailureClass
    is_retryable: bool
    error_code: str
    message: str
    sanitized_detail: dict[str, Any] = Field(default_factory=dict)
    retry_after_seconds: float | None = None
    occurred_at: datetime


class RetryDecisionResponse(BaseModel):
    """Response indicating the result of a retry policy evaluation."""

    model_config = ConfigDict(extra="ignore")

    should_retry: bool
    attempt_number: int
    delay_seconds: float
    next_retry_at: datetime | None = None
    failure_class: FailureClass
    reason: str


class RecoveryActionResponse(BaseModel):
    """API representation of an automated or manual recovery action taken."""

    model_config = ConfigDict(extra="ignore")

    run_id: str
    action_taken: RecoveryActionType
    previous_state: str
    new_state: str
    is_safe_to_retry: bool
    requires_manual_review: bool
    details: dict[str, Any] = Field(default_factory=dict)
    recovered_at: datetime


class CancellationRequest(BaseModel):
    """Payload to request cooperative cancellation of a run."""

    model_config = ConfigDict(extra="ignore")

    workspace_id: str
    site_id: int
    reason: str | None = None
    requested_by: str = "operator"


class CancellationResponse(BaseModel):
    """Result of a cancellation request."""

    model_config = ConfigDict(extra="ignore")

    run_id: str
    status: str
    outcome: str
    acknowledged: bool
    message: str


class PauseRequest(BaseModel):
    """Payload to request cooperative pause of a run."""

    model_config = ConfigDict(extra="ignore")

    workspace_id: str
    site_id: int
    reason: str | None = None
    requested_by: str = "operator"


class PauseResponse(BaseModel):
    """Result of a pause request."""

    model_config = ConfigDict(extra="ignore")

    run_id: str
    status: str
    outcome: str
    acknowledged: bool
    message: str
    checkpoint_id: str | None = None


class ResumeRequest(BaseModel):
    """Payload to request resumption of a paused run."""

    model_config = ConfigDict(extra="ignore")

    workspace_id: str
    site_id: int
    requested_by: str = "operator"


class ResumeResponse(BaseModel):
    """Result of a resume request."""

    model_config = ConfigDict(extra="ignore")

    run_id: str
    status: str
    outcome: str
    message: str
    resumed_from_checkpoint_id: str | None = None


class CheckpointResponse(BaseModel):
    """API representation of an orchestration checkpoint."""

    model_config = ConfigDict(from_attributes=True, extra="ignore")

    id: str
    run_id: str
    stage_id: str | None = None
    sequence: int
    checkpoint_type: str
    progress_cursor: dict[str, Any] = Field(default_factory=dict)
    completed_work_summary: dict[str, Any] = Field(default_factory=dict)
    remaining_work_summary: dict[str, Any] = Field(default_factory=dict)
    worker_id: str | None = None
    is_safe_to_resume: bool
    created_at: datetime
    version: int


class CheckpointListResponse(BaseModel):
    """List of checkpoints for a run."""

    model_config = ConfigDict(extra="ignore")

    run_id: str
    total_count: int
    checkpoints: list[CheckpointResponse]


# ==============================================================================
# Step 5: Freshness & Continuous Monitoring Schemas
# ==============================================================================

class FreshnessEvaluationRequest(BaseModel):
    """Payload to request freshness evaluation for an evidence category."""

    model_config = ConfigDict(extra="ignore")

    workspace_id: str = "default"
    tenant_id: str | None = None
    site_id: int = 1
    evidence_type: str
    observed_at: str | None = None
    as_of: datetime | str | None = None
    provider_available: bool = True
    is_provider_available: bool = True
    is_currently_refreshing: bool = False


class FreshnessEvaluationResponse(BaseModel):
    """Structured response representing the freshness evaluation of an evidence category."""

    model_config = ConfigDict(extra="ignore")

    evidence_type: str
    freshness_state: str = "fresh"
    state: str = "fresh"
    observed_at: str | None = None
    evaluated_at: str = ""
    age_seconds: float | None = None
    ttl_seconds: int = 0
    warning_threshold_seconds: int = 0
    expiration_threshold_seconds: int = 0
    remaining_seconds: float | None = None
    stale_reason: str | None = None
    refresh_recommendation: str = "NO_ACTION"
    refresh_recommended: bool = False
    refresh_required: bool = False
    is_stale: bool = False
    is_expired: bool = False
    is_unavailable: bool = False
    details: dict[str, Any] = Field(default_factory=dict)
    metadata: dict[str, Any] = Field(default_factory=dict)


class EvidenceFreshnessStatusResponse(BaseModel):
    """Evaluated freshness status across all evidence categories for a site."""

    model_config = ConfigDict(extra="ignore")

    workspace_id: str
    site_id: int
    evaluations: list[FreshnessEvaluationResponse]
    evaluated_at: str


class StaleEvidenceOverviewResponse(BaseModel):
    """Overview of stale and expired evidence across workspace sites."""

    model_config = ConfigDict(extra="ignore")

    workspace_id: str = "default"
    tenant_id: str | None = None
    site_id: int | None = None
    total_sites: int = 1
    total_categories_evaluated: int = 0
    fresh_count: int = 0
    aging_count: int = 0
    stale_count: int = 0
    expired_count: int = 0
    unknown_count: int = 0
    requires_refresh_count: int = 0
    items: list[dict[str, Any]] = Field(default_factory=list)
    site_summaries: list[dict[str, Any]] = Field(default_factory=list)
    evaluated_at: str


class RefreshDecisionRequest(BaseModel):
    """Payload to evaluate a refresh decision without triggering execution."""

    model_config = ConfigDict(extra="ignore")

    workspace_id: str = "default"
    tenant_id: str | None = None
    site_id: int
    evidence_type: str | None = None
    evidence_types: list[str] = Field(default_factory=list)
    force: bool = False
    force_refresh: bool = False
    provider_available: bool = True


class RefreshDecisionResponse(BaseModel):
    """Result of a refresh decision evaluation."""

    model_config = ConfigDict(extra="ignore")

    decision: str = "NO_ACTION"
    evidence_type: str = ""
    reason: str = ""
    decided_at: str = ""
    active_run_id: str | None = None
    job_intent: dict[str, Any] | None = None
    site_id: int | None = None
    decisions: list[dict[str, Any]] = Field(default_factory=list)


class RefreshTriggerRequest(BaseModel):
    """Payload to request fresh assessment and execution of necessary refresh jobs."""

    model_config = ConfigDict(extra="ignore")

    workspace_id: str = "default"
    tenant_id: str | None = None
    site_id: int
    evidence_type: str | None = None
    evidence_types: list[str] = Field(default_factory=list)
    force: bool = False
    force_refresh: bool = False
    requested_by: str = "operator"
    actor: ActorProvenance | None = None


class RefreshTriggerResponse(BaseModel):
    """Result of triggering refresh evaluation and enqueuing jobs."""

    model_config = ConfigDict(extra="ignore")

    workspace_id: str = "default"
    tenant_id: str | None = None
    site_id: int
    decisions: list[RefreshDecisionResponse] = Field(default_factory=list)
    created_runs_count: int = 0
    created_run_ids: list[str] = Field(default_factory=list)
    deduplicated_count: int = 0


class MonitoringObservationResponse(BaseModel):
    """Representation of an operational monitoring observation."""

    model_config = ConfigDict(from_attributes=True, extra="ignore")

    id: int
    workspace_id: str = "default"
    site_id: int | None = None
    monitoring_type: str
    status: str
    severity: str
    observed_at: datetime
    source_run_id: str | None = None
    source_job_id: str | None = None
    summary: str
    details: dict[str, Any] = Field(default_factory=dict)
    metric_name: str | None = None
    metric_value: float | None = None
    threshold_value: float | None = None


class MonitoringStatusResponse(BaseModel):
    """Summary of latest monitoring observations across pipeline domains."""

    model_config = ConfigDict(extra="ignore")

    workspace_id: str = "default"
    tenant_id: str | None = None
    site_id: int | None = None
    observations: list[MonitoringObservationResponse] = Field(default_factory=list)
    domain_statuses: list[dict[str, Any]] = Field(default_factory=list)
    overall_status: str


class MonitoringHistoryResponse(BaseModel):
    """Paginated monitoring observation history."""

    model_config = ConfigDict(extra="ignore")

    workspace_id: str = "default"
    tenant_id: str | None = None
    site_id: int | None = None
    total_count: int
    observations: list[MonitoringObservationResponse] = Field(default_factory=list)


# =====================================================================
# STEP 6: OBSERVABILITY, HEALTH, ALERTS, AND POLICIES SCHEMAS
# =====================================================================


class ObservabilityEventCreateRequest(BaseModel):
    """Payload to record an audit or observability event."""

    model_config = ConfigDict(extra="ignore")

    workspace_id: str = "default"
    site_id: int | None = None
    event_type: str
    run_id: str | None = None
    stage_id: str | None = None
    job_id: str | None = None
    worker_id: str | None = None
    correlation_id: str | None = None
    severity: str = "INFO"
    outcome: str | None = None
    duration_ms: int | None = None
    component: str | None = None
    from_state: str | None = None
    to_state: str | None = None
    details: dict[str, Any] = Field(default_factory=dict)


class ObservabilityEventResponse(BaseModel):
    """Representation of an immutable observability audit event."""

    model_config = ConfigDict(from_attributes=True, extra="ignore")

    id: str
    workspace_id: str
    site_id: int | None = None
    run_id: str | None = None
    stage_id: str | None = None
    job_id: str | None = None
    worker_id: str | None = None
    correlation_id: str | None = None
    event_type: str
    severity: str
    outcome: str | None = None
    duration_ms: int | None = None
    component: str | None = None
    from_state: str | None = None
    to_state: str | None = None
    details: dict[str, Any] = Field(default_factory=dict)
    occurred_at: datetime


class ObservabilityEventsListResponse(BaseModel):
    """Paginated list of observability audit events."""

    model_config = ConfigDict(extra="ignore")

    workspace_id: str
    total_count: int
    events: list[ObservabilityEventResponse] = Field(default_factory=list)


class OperationalMetricsResponse(BaseModel):
    """Deterministic operational metrics across runs, stages, wait times, retries, and refreshes."""

    model_config = ConfigDict(extra="ignore")

    workspace_id: str
    site_id: int | None = None
    window: dict[str, Any] = Field(default_factory=dict)
    run_counts: dict[str, int] = Field(default_factory=dict)
    run_durations: dict[str, Any] = Field(default_factory=dict)
    queue_wait_times: dict[str, Any] = Field(default_factory=dict)
    stage_metrics: dict[str, Any] = Field(default_factory=dict)
    total_retries: int = 0
    total_stage_failures: int = 0
    total_run_failures: int = 0
    checkpoint_count: int = 0
    cancellation_count: int = 0
    worker_recovery_count: int = 0
    stale_lease_count: int = 0
    freshness_refresh_count: int = 0


class SystemHealthResponse(BaseModel):
    """Multi-dimensional system health status report."""

    model_config = ConfigDict(extra="ignore")

    workspace_id: str
    site_id: int | None = None
    overall_status: str
    dimensions: dict[str, Any] = Field(default_factory=dict)
    evaluated_at: str


class QueueHealthResponse(BaseModel):
    """Operational queue health report."""

    model_config = ConfigDict(extra="ignore")

    workspace_id: str
    queue_depth: int
    status: str
    reasons: list[str] = Field(default_factory=list)
    evidence: dict[str, Any] = Field(default_factory=dict)


class WorkerHealthResponse(BaseModel):
    """Worker harness and active worker health report."""

    model_config = ConfigDict(extra="ignore")

    workspace_id: str
    worker_count: int
    healthy_workers: int
    stale_workers: int
    status: str
    reasons: list[str] = Field(default_factory=list)
    evidence: dict[str, Any] = Field(default_factory=dict)


class ProviderHealthResponse(BaseModel):
    """External dependencies and providers health report."""

    model_config = ConfigDict(extra="ignore")

    workspace_id: str
    status: str
    providers: dict[str, Any] = Field(default_factory=dict)
    lookback_hours: int = 24


class AlertResponse(BaseModel):
    """Representation of an operational alert."""

    model_config = ConfigDict(from_attributes=True, extra="ignore")

    id: str
    workspace_id: str
    site_id: int | None = None
    alert_type: str
    severity: str
    status: str
    summary: str
    deduplication_key: str
    occurrence_count: int = 1
    source_run_id: str | None = None
    source_job_id: str | None = None
    source_stage_id: str | None = None
    details: dict[str, Any] = Field(default_factory=dict)
    first_observed_at: datetime
    last_observed_at: datetime
    acknowledged_at: datetime | None = None
    acknowledged_by: str | None = None
    resolved_at: datetime | None = None
    resolved_by: str | None = None
    resolution_reason: str | None = None
    created_at: datetime


class AlertListResponse(BaseModel):
    """Paginated list of operational alerts."""

    model_config = ConfigDict(extra="ignore")

    workspace_id: str
    total_count: int
    alerts: list[AlertResponse] = Field(default_factory=list)


class AlertAcknowledgeRequest(BaseModel):
    """Payload to acknowledge an open alert."""

    model_config = ConfigDict(extra="ignore")

    workspace_id: str = "default"
    acknowledged_by: str = "operator"


class AlertResolveRequest(BaseModel):
    """Payload to resolve an alert with explanation and recovery evidence."""

    model_config = ConfigDict(extra="ignore")

    workspace_id: str = "default"
    resolved_by: str = "operator"
    resolution_reason: str
    evidence: dict[str, Any] | None = None


class TenantPolicyUpsertRequest(BaseModel):
    """Payload to create or update a tenant/site operational policy."""

    model_config = ConfigDict(extra="ignore")

    workspace_id: str = "default"
    site_id: int | None = None
    max_concurrent_runs: int | None = None
    max_concurrent_jobs: int | None = None
    max_concurrent_provider_calls: int | None = None
    max_crawl_jobs: int | None = None
    max_ai_probe_jobs: int | None = None
    max_refresh_jobs: int | None = None
    retry_budget_per_hour: int | None = None
    daily_operational_budget: int | None = None
    max_execution_duration_seconds: int | None = None
    max_queue_age_seconds: int | None = None
    allowed_automation_level: str | None = None
    is_monitoring_enabled: bool | None = None
    min_alert_severity: str | None = None
    maintenance_window_cron: str | None = None
    maintenance_window_active: bool | None = None
    custom_settings: dict[str, Any] | None = None


class TenantPolicyResponse(BaseModel):
    """Representation of an operational policy."""

    model_config = ConfigDict(from_attributes=True, extra="ignore")

    id: str | None = None
    workspace_id: str
    site_id: int | None = None
    max_concurrent_runs: int = 5
    max_concurrent_jobs: int = 10
    max_concurrent_provider_calls: int = 5
    max_crawl_jobs: int = 3
    max_ai_probe_jobs: int = 4
    max_refresh_jobs: int = 3
    retry_budget_per_hour: int = 20
    daily_operational_budget: int = 100
    max_execution_duration_seconds: int = 3600
    max_queue_age_seconds: int = 1800
    allowed_automation_level: str = "FULL"
    is_monitoring_enabled: bool = True
    min_alert_severity: str = "INFO"
    maintenance_window_cron: str | None = None
    maintenance_window_active: bool = False
    custom_settings: dict[str, Any] = Field(default_factory=dict)
    created_at: str | None = None
    updated_at: str | None = None
    version: int = 1
    is_default: bool = False


class PolicyEvaluationRequest(BaseModel):
    """Payload to test or evaluate an operational action against tenant policy."""

    model_config = ConfigDict(extra="ignore")

    workspace_id: str = "default"
    site_id: int | None = None
    operation: str = "CREATE_RUN"
    is_automated: bool = False


class PolicyEvaluationResponse(BaseModel):
    """Result of an operational policy check."""

    model_config = ConfigDict(extra="ignore")

    allowed: bool
    policy_rule: str
    limit_value: Any = None
    current_usage: Any = None
    requested_usage: Any = None
    reason: str
    workspace_id: str
    site_id: int | None = None


class OrchestrationRunResultResponse(BaseModel):
    """Comprehensive final outcome report for an orchestrated run."""

    model_config = ConfigDict(extra="ignore")

    run_id: str
    workspace_id: str
    site_id: int
    status: str
    outcome_summary: dict[str, Any] = Field(default_factory=dict)
    validation_result: dict[str, Any] | None = None
    receipts: list[dict[str, Any]] = Field(default_factory=list)
    stages_executed: list[str] = Field(default_factory=list)
    checkpoints_count: int = 0
    alerts_count: int = 0
    completed_at: str | None = None
    timing: dict[str, Any] = Field(default_factory=dict)


class OrchestrationFailureHistoryResponse(BaseModel):
    """Failure, retry, and recovery audit history for an orchestration run."""

    model_config = ConfigDict(extra="ignore")

    run_id: str
    workspace_id: str
    site_id: int
    failures: list[dict[str, Any]] = Field(default_factory=list)
    total_attempts: int = 1
    is_terminal_failure: bool = False
    recovery_info: dict[str, Any] | None = None


class OrchestrationCancelRequest(BaseModel):
    """Payload to request cancellation of an orchestration run."""

    model_config = ConfigDict(extra="ignore")

    workspace_id: str = "default"
    site_id: int | None = None
    requested_by: str = "operator"
    reason: str | None = None


class OrchestrationPauseRequest(BaseModel):
    """Payload to request cooperative pausing of an orchestration run."""

    model_config = ConfigDict(extra="ignore")

    workspace_id: str = "default"
    site_id: int | None = None
    requested_by: str = "operator"
    reason: str | None = None


class OrchestrationResumeRequest(BaseModel):
    """Payload to resume a paused orchestration run from a checkpoint."""

    model_config = ConfigDict(extra="ignore")

    workspace_id: str = "default"
    site_id: int | None = None
    requested_by: str = "operator"



