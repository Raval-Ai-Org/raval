"""
Production Orchestration & Monitoring - Enums.

Defines canonical types and lifecycle states for orchestration runs, stages,
triggers, and events.
"""

from __future__ import annotations

from enum import Enum


class RunType(str, Enum):
    """Supported orchestration run execution archetypes."""

    ON_DEMAND_SCAN = "ON_DEMAND_SCAN"
    SCHEDULED_SCAN = "SCHEDULED_SCAN"
    CHANGE_TRIGGERED_SCAN = "CHANGE_TRIGGERED_SCAN"
    EVIDENCE_REFRESH = "EVIDENCE_REFRESH"
    VERIFICATION_RUN = "VERIFICATION_RUN"
    MONITORING_RUN = "MONITORING_RUN"
    RECOVERY_RUN = "RECOVERY_RUN"


class RunState(str, Enum):
    """
    Canonical orchestration run lifecycle states.
    """

    # Initial waiting state
    QUEUED = "QUEUED"

    # Active running states
    STARTING = "STARTING"
    SCANNING = "SCANNING"
    ANALYZING = "ANALYZING"
    OBSERVING = "OBSERVING"
    PLANNING = "PLANNING"
    EXECUTING = "EXECUTING"
    VERIFYING = "VERIFYING"
    MONITORING = "MONITORING"

    # Non-terminal waiting states
    RETRY_WAIT = "RETRY_WAIT"
    PAUSED = "PAUSED"

    # Terminal states
    SUCCEEDED = "SUCCEEDED"
    PARTIAL = "PARTIAL"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"

    @property
    def is_terminal(self) -> bool:
        """Returns True if the state is terminal (cannot transition further)."""
        return self in (
            RunState.SUCCEEDED,
            RunState.PARTIAL,
            RunState.FAILED,
            RunState.CANCELLED,
        )

    @property
    def is_active(self) -> bool:
        """Returns True if the run is actively executing an operational phase."""
        return self in (
            RunState.STARTING,
            RunState.SCANNING,
            RunState.ANALYZING,
            RunState.OBSERVING,
            RunState.PLANNING,
            RunState.EXECUTING,
            RunState.VERIFYING,
            RunState.MONITORING,
        )

    @property
    def allows_cancellation(self) -> bool:
        """
        Returns True if the run state safely allows cancellation.
        EXECUTING is disallowed to prevent leaving externally visible mutations in half-applied states.
        """
        if self.is_terminal:
            return False
        if self == RunState.EXECUTING:
            return False
        return True


class StageName(str, Enum):
    """Standardized orchestration stage types."""

    CRAWL_DISCOVERY = "CRAWL_DISCOVERY"
    CONTENT_EXTRACTION = "CONTENT_EXTRACTION"
    SIGNAL_ANALYSIS = "SIGNAL_ANALYSIS"
    SCORING = "SCORING"
    EVIDENCE_OBSERVATION = "EVIDENCE_OBSERVATION"
    VISIBILITY_METRICS = "VISIBILITY_METRICS"
    RECOMMENDATION_PLANNING = "RECOMMENDATION_PLANNING"
    APPROVAL_CHECK = "APPROVAL_CHECK"
    FIX_EXECUTION = "FIX_EXECUTION"
    VERIFICATION = "VERIFICATION"
    TARGETED_RESCAN = "TARGETED_RESCAN"
    DELTA_MEASUREMENT = "DELTA_MEASUREMENT"
    REGRESSION_GUARD = "REGRESSION_GUARD"
    MONITORING_CHECK = "MONITORING_CHECK"


class StageState(str, Enum):
    """Lifecycle states for individual orchestration stages within a run."""

    QUEUED = "QUEUED"
    RUNNING = "RUNNING"
    SUCCEEDED = "SUCCEEDED"
    FAILED = "FAILED"
    SKIPPED = "SKIPPED"
    CANCELLED = "CANCELLED"
    RETRY_WAIT = "RETRY_WAIT"
    PAUSED = "PAUSED"
    BLOCKED = "BLOCKED"

    @property
    def is_terminal(self) -> bool:
        """Returns True if the stage state is terminal."""
        return self in (
            StageState.SUCCEEDED,
            StageState.FAILED,
            StageState.SKIPPED,
            StageState.CANCELLED,
        )

    @property
    def is_active(self) -> bool:
        """Returns True if the stage is currently executing."""
        return self == StageState.RUNNING


class TriggerSource(str, Enum):
    """Originator/trigger mechanism for an orchestration run."""

    MANUAL = "manual"
    SCHEDULER = "scheduler"
    WEBHOOK = "webhook"
    POLICY_EVENT = "policy_event"
    RECOVERY = "recovery"
    API = "api"
    FRESHNESS_CONTROLLER = "freshness_controller"


class OrchestrationEventType(str, Enum):
    """Structured event types emitted during orchestration lifecycle."""

    RUN_CREATED = "RUN_CREATED"
    STATE_TRANSITION = "STATE_TRANSITION"
    STAGE_STARTED = "STAGE_STARTED"
    STAGE_COMPLETED = "STAGE_COMPLETED"
    STAGE_FAILED = "STAGE_FAILED"
    STAGE_SKIPPED = "STAGE_SKIPPED"
    STAGE_BLOCKED = "STAGE_BLOCKED"
    STAGE_RETRY = "STAGE_RETRY"
    HEARTBEAT = "HEARTBEAT"
    RUN_CANCEL_REQUESTED = "RUN_CANCEL_REQUESTED"
    RUN_CANCELLED = "RUN_CANCELLED"
    RUN_PAUSE_REQUESTED = "RUN_PAUSE_REQUESTED"
    RUN_PAUSED = "RUN_PAUSED"
    RUN_RESUMED = "RUN_RESUMED"
    CHECKPOINT_CREATED = "CHECKPOINT_CREATED"
    CHECKPOINT_RESTORED = "CHECKPOINT_RESTORED"
    RUN_RECOVERED = "RUN_RECOVERED"
    ERROR_RECORDED = "ERROR_RECORDED"
    SCHEDULE_FIRED = "SCHEDULE_FIRED"
    SCHEDULE_PAUSED = "SCHEDULE_PAUSED"
    SCHEDULE_RESUMED = "SCHEDULE_RESUMED"
    RETRY_SCHEDULED = "RETRY_SCHEDULED"
    RETRY_RESUMED = "RETRY_RESUMED"
    RETRY_EXHAUSTED = "RETRY_EXHAUSTED"
    RECEIPT_RECORDED = "RECEIPT_RECORDED"
    RECEIPT_CONFIRMED = "RECEIPT_CONFIRMED"
    RECEIPT_AMBIGUOUS = "RECEIPT_AMBIGUOUS"
    WORKER_RECOVERED = "WORKER_RECOVERED"
    FRESHNESS_EVALUATED = "FRESHNESS_EVALUATED"
    EVIDENCE_MARKED_STALE = "EVIDENCE_MARKED_STALE"
    EVIDENCE_MARKED_EXPIRED = "EVIDENCE_MARKED_EXPIRED"
    REFRESH_REQUESTED = "REFRESH_REQUESTED"
    REFRESH_DEDUPLICATED = "REFRESH_DEDUPLICATED"
    REFRESH_STARTED = "REFRESH_STARTED"
    REFRESH_COMPLETED = "REFRESH_COMPLETED"
    REFRESH_FAILED = "REFRESH_FAILED"
    PROVIDER_UNAVAILABLE = "PROVIDER_UNAVAILABLE"
    MONITORING_STATUS_CHANGED = "MONITORING_STATUS_CHANGED"
    RUN_STARTED = "RUN_STARTED"
    RUN_STAGE_STARTED = "RUN_STAGE_STARTED"
    RUN_STAGE_COMPLETED = "RUN_STAGE_COMPLETED"
    RUN_STAGE_FAILED = "RUN_STAGE_FAILED"
    RUN_RETRY_SCHEDULED = "RUN_RETRY_SCHEDULED"
    JOB_ENQUEUED = "JOB_ENQUEUED"
    JOB_CLAIMED = "JOB_CLAIMED"
    JOB_STARTED = "JOB_STARTED"
    JOB_COMPLETED = "JOB_COMPLETED"
    JOB_FAILED = "JOB_FAILED"
    JOB_RETRY_WAIT = "JOB_RETRY_WAIT"
    LEASE_ACQUIRED = "LEASE_ACQUIRED"
    LEASE_RENEWED = "LEASE_RENEWED"
    LEASE_EXPIRED = "LEASE_EXPIRED"
    WORKER_HEARTBEAT = "WORKER_HEARTBEAT"
    WORKER_STALE = "WORKER_STALE"
    EVIDENCE_STALE = "EVIDENCE_STALE"
    POLICY_BLOCKED = "POLICY_BLOCKED"
    TENANT_LIMIT_REACHED = "TENANT_LIMIT_REACHED"
    ALERT_OPENED = "ALERT_OPENED"
    ALERT_ACKNOWLEDGED = "ALERT_ACKNOWLEDGED"
    ALERT_RESOLVED = "ALERT_RESOLVED"
    ALERT_REOPENED = "ALERT_REOPENED"


class ScheduleType(str, Enum):
    """Supported recurring or ad-hoc schedule mechanisms."""

    INTERVAL = "interval"
    CRON = "cron"
    ON_DEMAND = "on_demand"


class ScheduleStatus(str, Enum):
    """Lifecycle activation states for a schedule."""

    ACTIVE = "active"
    PAUSED = "paused"
    DISABLED = "disabled"


class FailureClass(str, Enum):
    """
    Centralized canonical failure taxonomy for orchestration errors.
    Used by the RetryEngine and RecoveryService to determine retryability.
    """

    TRANSIENT = "TRANSIENT"
    PROVIDER_RATE_LIMIT = "PROVIDER_RATE_LIMIT"
    TIMEOUT = "TIMEOUT"
    AUTHENTICATION = "AUTHENTICATION"
    CONFIGURATION = "CONFIGURATION"
    UNSAFE_POLICY = "UNSAFE_POLICY"
    DATA_VALIDATION = "DATA_VALIDATION"
    WORKER_CRASH = "WORKER_CRASH"
    LEASE_LOST = "LEASE_LOST"
    UNKNOWN = "UNKNOWN"

    @property
    def is_always_non_retryable(self) -> bool:
        """Returns True if this failure class should never be retried automatically."""
        return self in (
            FailureClass.AUTHENTICATION,
            FailureClass.CONFIGURATION,
            FailureClass.UNSAFE_POLICY,
            FailureClass.DATA_VALIDATION,
        )


class ReceiptStatus(str, Enum):
    """Lifecycle state of an external operation execution receipt."""

    PENDING = "PENDING"
    CONFIRMED = "CONFIRMED"
    FAILED = "FAILED"
    AMBIGUOUS = "AMBIGUOUS"
    SUCCESS = "CONFIRMED"
    VERIFIED = "CONFIRMED"
    APPLIED = "CONFIRMED"


class RecoveryActionType(str, Enum):
    """Resulting recovery action decided for a stale or failed job."""

    RETRY_SCHEDULED = "RETRY_SCHEDULED"
    RESCHEDULE_RETRY = "RESCHEDULE_RETRY"
    RESUMED = "RESUMED"
    EXHAUSTED = "EXHAUSTED"
    MARK_FAILED = "MARK_FAILED"
    AMBIGUOUS_BLOCKED = "AMBIGUOUS_BLOCKED"
    RECONCILE_AMBIGUOUS_MUTATION = "RECONCILE_AMBIGUOUS_MUTATION"
    TAKEOVER = "TAKEOVER"
    RECONCILE_LEASE = "RECONCILE_LEASE"


class CheckpointType(str, Enum):
    """Type/granularity of an execution checkpoint."""

    STAGE_BOUNDARY = "STAGE_BOUNDARY"
    BATCH_PROGRESS = "BATCH_PROGRESS"
    PROVIDER_CALL = "PROVIDER_CALL"
    PRE_MUTATION = "PRE_MUTATION"
    POST_MUTATION = "POST_MUTATION"
    PAUSE_POINT = "PAUSE_POINT"


class ControlSignalType(str, Enum):
    """Signal types for cooperative orchestration control."""

    CANCEL = "CANCEL"
    PAUSE = "PAUSE"
    RESUME = "RESUME"


class CancellationOutcome(str, Enum):
    """Resulting outcome of a cancellation request."""

    CANCELLED_IMMEDIATELY = "CANCELLED_IMMEDIATELY"
    CANCELLED_AT_CHECKPOINT = "CANCELLED_AT_CHECKPOINT"
    CANCELLED_AFTER_STAGE = "CANCELLED_AFTER_STAGE"
    ALREADY_TERMINAL = "ALREADY_TERMINAL"
    BLOCKED_AMBIGUOUS = "BLOCKED_AMBIGUOUS"
    REJECTED = "REJECTED"


class FreshnessState(str, Enum):
    """Lifecycle freshness state of evidence or observations."""

    FRESH = "FRESH"
    AGING = "AGING"
    STALE = "STALE"
    EXPIRED = "EXPIRED"
    UNKNOWN = "UNKNOWN"
    REFRESHING = "REFRESHING"
    UNAVAILABLE = "UNAVAILABLE"

    @property
    def is_fresh(self) -> bool:
        """Returns True if the evidence is valid and not aging, stale, or expired."""
        return self == FreshnessState.FRESH

    @property
    def is_stale_or_expired(self) -> bool:
        """Returns True if the evidence has exceeded TTL or expiration thresholds."""
        return self in (FreshnessState.STALE, FreshnessState.EXPIRED)

    @property
    def is_actionable(self) -> bool:
        """Returns True if this state warrants consideration for refresh."""
        return self in (FreshnessState.AGING, FreshnessState.STALE, FreshnessState.EXPIRED, FreshnessState.UNKNOWN)


class EvidenceType(str, Enum):
    """Canonical categories of evidence collected and evaluated across the platform."""

    CRAWL = "CRAWL"
    PAGE_SEO = "PAGE_SEO"
    SCORE = "SCORE"
    AI_VISIBILITY = "AI_VISIBILITY"
    AI_ANSWER = "AI_ANSWER"
    CITATION = "CITATION"
    COMPETITOR = "COMPETITOR"
    EXTERNAL_AUTHORITY = "EXTERNAL_AUTHORITY"
    SEARCH_PERFORMANCE = "SEARCH_PERFORMANCE"
    VALIDATION = "VALIDATION"
    EXECUTION_CHANGE = "EXECUTION_CHANGE"


class RefreshDecisionType(str, Enum):
    """Decision outcome evaluated for potential evidence refresh."""

    NO_ACTION = "NO_ACTION"
    REFRESH_RECOMMENDED = "REFRESH_RECOMMENDED"
    REFRESH_REQUIRED = "REFRESH_REQUIRED"
    REFRESH_BLOCKED = "REFRESH_BLOCKED"
    REFRESH_ALREADY_RUNNING = "REFRESH_ALREADY_RUNNING"
    REFRESH_UNAVAILABLE = "REFRESH_UNAVAILABLE"


class MonitoringType(str, Enum):
    """Operational monitoring categories across the platform pipeline."""

    CRAWL_HEALTH = "CRAWL_HEALTH"
    ANALYSIS_HEALTH = "ANALYSIS_HEALTH"
    EVIDENCE_FRESHNESS = "EVIDENCE_FRESHNESS"
    AI_VISIBILITY_MONITORING = "AI_VISIBILITY_MONITORING"
    VALIDATION_HEALTH = "VALIDATION_HEALTH"
    FIX_EXECUTION_HEALTH = "FIX_EXECUTION_HEALTH"
    PROVIDER_HEALTH = "PROVIDER_HEALTH"
    SCHEDULE_HEALTH = "SCHEDULE_HEALTH"
    QUEUE_WORKER_HEALTH = "QUEUE_WORKER_HEALTH"


class MonitoringStatus(str, Enum):
    """Health classification for continuous monitoring observations."""

    HEALTHY = "HEALTHY"
    DEGRADED = "DEGRADED"
    FAILING = "FAILING"
    CRITICAL = "CRITICAL"
    STALE = "STALE"
    UNKNOWN = "UNKNOWN"


class MonitoringSeverity(str, Enum):
    """Severity tier for monitoring observations."""

    INFO = "INFO"
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"
    CRITICAL = "CRITICAL"


class AlertSeverity(str, Enum):
    """Severity tier for operational alerts."""

    INFO = "INFO"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"
    CRITICAL = "CRITICAL"


class AlertStatus(str, Enum):
    """Lifecycle status for operational alerts."""

    OPEN = "OPEN"
    ACKNOWLEDGED = "ACKNOWLEDGED"
    RESOLVED = "RESOLVED"


class AlertType(str, Enum):
    """Canonical operational alert types."""

    # CRITICAL
    REPEATED_ORCHESTRATION_FAILURE = "REPEATED_ORCHESTRATION_FAILURE"
    UNSAFE_EXECUTION_STATE = "UNSAFE_EXECUTION_STATE"
    TENANT_ISOLATION_VIOLATION = "TENANT_ISOLATION_VIOLATION"
    DATABASE_FAILURE = "DATABASE_FAILURE"

    # HIGH
    WORKER_FAILURE = "WORKER_FAILURE"
    PROVIDER_AUTHENTICATION_FAILURE = "PROVIDER_AUTHENTICATION_FAILURE"
    QUEUE_SATURATION = "QUEUE_SATURATION"
    REPEATED_STAGE_FAILURE = "REPEATED_STAGE_FAILURE"
    LEASE_RECOVERY_FAILURE = "LEASE_RECOVERY_FAILURE"

    # MEDIUM
    REPEATED_TRANSIENT_FAILURE = "REPEATED_TRANSIENT_FAILURE"
    STALE_EVIDENCE_PERSISTENT = "STALE_EVIDENCE_PERSISTENT"
    PROVIDER_DEGRADED = "PROVIDER_DEGRADED"
    SCHEDULE_MISSED = "SCHEDULE_MISSED"

    # INFO / RECOVERY
    WORKER_RECOVERED = "WORKER_RECOVERED"
    REFRESH_COMPLETED = "REFRESH_COMPLETED"
    DEPENDENCY_RECOVERED = "DEPENDENCY_RECOVERED"
    STALE_EVIDENCE_RESOLVED = "STALE_EVIDENCE_RESOLVED"


class AutomationLevel(str, Enum):
    """Permitted automation execution level for a tenant or site."""

    FULL = "FULL"
    SEMI_AUTOMATED = "SEMI_AUTOMATED"
    MANUAL_ONLY = "MANUAL_ONLY"


class PolicyRuleType(str, Enum):
    """Operational limits and policy rules."""

    MAX_CONCURRENT_RUNS = "MAX_CONCURRENT_RUNS"
    MAX_CONCURRENT_JOBS = "MAX_CONCURRENT_JOBS"
    MAX_CONCURRENT_PROVIDER_CALLS = "MAX_CONCURRENT_PROVIDER_CALLS"
    MAX_CRAWL_JOBS = "MAX_CRAWL_JOBS"
    MAX_AI_PROBE_JOBS = "MAX_AI_PROBE_JOBS"
    MAX_REFRESH_JOBS = "MAX_REFRESH_JOBS"
    RETRY_BUDGET_PER_HOUR = "RETRY_BUDGET_PER_HOUR"
    DAILY_OPERATIONAL_BUDGET = "DAILY_OPERATIONAL_BUDGET"
    MAX_EXECUTION_DURATION = "MAX_EXECUTION_DURATION"
    MAX_QUEUE_AGE = "MAX_QUEUE_AGE"
    AUTOMATION_LEVEL = "AUTOMATION_LEVEL"
    MAINTENANCE_WINDOW = "MAINTENANCE_WINDOW"


class HealthDimension(str, Enum):
    """Operational dimensions evaluated for system health."""

    SCHEDULER = "SCHEDULER"
    QUEUE = "QUEUE"
    WORKERS = "WORKERS"
    ORCHESTRATION = "ORCHESTRATION"
    FRESHNESS = "FRESHNESS"
    PROVIDERS = "PROVIDERS"
    DATABASE = "DATABASE"
    EXECUTION = "EXECUTION"


class SystemHealthStatus(str, Enum):
    """Canonical system health classification."""

    HEALTHY = "HEALTHY"
    DEGRADED = "DEGRADED"
    UNHEALTHY = "UNHEALTHY"
    UNKNOWN = "UNKNOWN"



