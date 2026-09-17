"""
Production Orchestration & Monitoring - Exceptions.

Defines a strongly typed exception hierarchy for orchestration errors,
state machine rejections, tenant boundary violations, and optimistic lock conflicts.
"""

from __future__ import annotations

from typing import Any


class OrchestrationError(Exception):
    """Base exception for all orchestration failures."""

    def __init__(self, message: str, details: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.details = details or {}


class InvalidStateTransitionError(OrchestrationError):
    """Raised when attempting an unauthorized or invalid state transition."""

    def __init__(
        self,
        entity_type: str,
        entity_id: str,
        from_state: str,
        to_state: str,
        allowed_states: list[str] | None = None,
        reason: str | None = None,
    ) -> None:
        msg = (
            f"Invalid {entity_type} state transition from '{from_state}' to '{to_state}' "
            f"for id '{entity_id}'."
        )
        if reason:
            msg += f" Reason: {reason}"
        details: dict[str, Any] = {
            "entity_type": entity_type,
            "entity_id": entity_id,
            "from_state": from_state,
            "to_state": to_state,
            "allowed_states": allowed_states or [],
        }
        if reason:
            details["reason"] = reason
        super().__init__(msg, details=details)
        self.entity_type = entity_type
        self.entity_id = entity_id
        self.from_state = from_state
        self.to_state = to_state
        self.allowed_states = allowed_states or []


class TerminalStateError(InvalidStateTransitionError):
    """Raised when attempting to transition an entity that has already reached a terminal state."""

    def __init__(self, entity_type: str, entity_id: str, terminal_state: str) -> None:
        super().__init__(
            entity_type=entity_type,
            entity_id=entity_id,
            from_state=terminal_state,
            to_state="[ANY]",
            allowed_states=[],
            reason=f"Entity is already in terminal state '{terminal_state}' and cannot transition further.",
        )


class TenantMismatchError(OrchestrationError):
    """Raised when an operation attempts to access or mutate an orchestration entity outside its tenant boundary."""

    def __init__(
        self,
        request_workspace_id: str,
        target_workspace_id: str,
        entity_id: str | None = None,
    ) -> None:
        eid = entity_id or "unknown"
        msg = (
            f"Tenant boundary violation: workspace '{request_workspace_id}' cannot "
            f"access entity '{eid}' owned by workspace '{target_workspace_id}'."
        )
        super().__init__(
            msg,
            details={
                "request_workspace_id": request_workspace_id,
                "target_workspace_id": target_workspace_id,
                "entity_id": eid,
            },
        )
        self.request_workspace_id = request_workspace_id
        self.target_workspace_id = target_workspace_id
        self.entity_id = eid


class SiteMismatchError(OrchestrationError):
    """Raised when an operation targets a site that does not match the orchestration run scope."""

    def __init__(
        self,
        run_id: str | int,
        expected_site_id: int | str | None = None,
        actual_site_id: int | str | None = None,
    ) -> None:
        if expected_site_id is None and actual_site_id is None:
            msg = f"Site boundary mismatch or site not found: '{run_id}'."
        elif actual_site_id is None:
            msg = f"Site boundary mismatch for site '{run_id}': {expected_site_id}."
        else:
            msg = (
                f"Site boundary mismatch: run '{run_id}' is scoped to site '{expected_site_id}', "
                f"got target site '{actual_site_id}'."
            )
        super().__init__(
            msg,
            details={
                "run_id": str(run_id),
                "expected_site_id": str(expected_site_id) if expected_site_id is not None else None,
                "actual_site_id": str(actual_site_id) if actual_site_id is not None else None,
            },
        )
        self.run_id = str(run_id)
        self.expected_site_id = expected_site_id
        self.actual_site_id = actual_site_id


class RunNotFoundError(OrchestrationError):
    """Raised when an orchestration run is not found in the specified workspace scope."""

    def __init__(self, run_id: str, workspace_id: str | None = None) -> None:
        msg = f"Orchestration run '{run_id}' not found"
        if workspace_id:
            msg += f" in workspace '{workspace_id}'"
        super().__init__(msg, details={"run_id": run_id, "workspace_id": workspace_id})
        self.run_id = run_id
        self.workspace_id = workspace_id


class StageNotFoundError(OrchestrationError):
    """Raised when an orchestration stage is not found."""

    def __init__(self, stage_id: str, run_id: str | None = None) -> None:
        msg = f"Orchestration stage '{stage_id}' not found"
        if run_id:
            msg += f" in run '{run_id}'"
        super().__init__(msg, details={"stage_id": stage_id, "run_id": run_id})
        self.stage_id = stage_id
        self.run_id = run_id


class OptimisticLockError(OrchestrationError):
    """Raised when a concurrent update modifies the entity before the current transaction completes."""

    def __init__(
        self,
        entity_type: str,
        entity_id: str,
        expected_version: int,
        actual_version: int,
    ) -> None:
        msg = (
            f"Optimistic lock conflict on {entity_type} '{entity_id}': "
            f"expected version {expected_version}, found version {actual_version}."
        )
        super().__init__(
            msg,
            details={
                "entity_type": entity_type,
                "entity_id": entity_id,
                "expected_version": expected_version,
                "actual_version": actual_version,
            },
        )


class IdempotencyConflictError(OrchestrationError):
    """Raised when a creation request reuses an idempotency key with conflicting parameters."""

    def __init__(
        self,
        idempotency_key: str,
        existing_run_id: str,
        message: str | None = None,
    ) -> None:
        msg = (
            message
            or f"Idempotency conflict: key '{idempotency_key}' already exists for run '{existing_run_id}' with different parameters."
        )
        super().__init__(
            msg,
            details={
                "idempotency_key": idempotency_key,
                "existing_run_id": existing_run_id,
            },
        )


class StageDependencyError(OrchestrationError):
    """Raised when attempting to execute a stage whose upstream dependencies have not completed successfully."""

    def __init__(
        self,
        stage_id: str,
        unmet_dependencies: list[str],
    ) -> None:
        msg = (
            f"Stage '{stage_id}' cannot start: unmet dependencies: {unmet_dependencies}"
        )
        super().__init__(
            msg,
            details={
                "stage_id": stage_id,
                "unmet_dependencies": unmet_dependencies,
            },
        )


class InvalidTimezoneError(OrchestrationError):
    """Raised when an invalid or unparseable timezone identifier is provided."""

    def __init__(self, timezone_name: str, reason: str | None = None) -> None:
        msg = f"Invalid timezone '{timezone_name}'."
        if reason:
            msg += f" Reason: {reason}"
        super().__init__(msg, details={"timezone": timezone_name, "reason": reason})
        self.timezone_name = timezone_name


class InvalidScheduleExpressionError(OrchestrationError):
    """Raised when an invalid cron expression or interval definition is provided."""

    def __init__(self, expression: str, schedule_type: str, reason: str | None = None) -> None:
        msg = f"Invalid {schedule_type} expression '{expression}'."
        if reason:
            msg += f" Reason: {reason}"
        super().__init__(
            msg,
            details={"expression": expression, "schedule_type": schedule_type, "reason": reason},
        )
        self.expression = expression
        self.schedule_type = schedule_type


class ScheduleNotFoundError(OrchestrationError):
    """Raised when a schedule is not found within the authorized workspace/site scope."""

    def __init__(self, schedule_id: str, workspace_id: str | None = None) -> None:
        msg = f"Schedule '{schedule_id}' not found"
        if workspace_id:
            msg += f" in workspace '{workspace_id}'"
        super().__init__(msg, details={"schedule_id": schedule_id, "workspace_id": workspace_id})
        self.schedule_id = schedule_id
        self.workspace_id = workspace_id


class LeaseConflictError(OrchestrationError):
    """Raised when attempting to acquire or mutate a lease held by another active worker."""

    def __init__(self, job_id: str, current_worker_id: str | None, requesting_worker_id: str) -> None:
        msg = (
            f"Lease conflict on job '{job_id}': held by worker '{current_worker_id}', "
            f"cannot be acquired by worker '{requesting_worker_id}'."
        )
        super().__init__(
            msg,
            details={
                "job_id": job_id,
                "current_worker_id": current_worker_id,
                "requesting_worker_id": requesting_worker_id,
            },
        )
        self.job_id = job_id
        self.current_worker_id = current_worker_id
        self.requesting_worker_id = requesting_worker_id


class ConcurrencyExceededError(OrchestrationError):
    """Raised when active execution capacity is exhausted for a workspace, site, or provider."""

    def __init__(
        self,
        dimension: str,
        limit_value: int,
        current_active: int,
        entity_key: str,
    ) -> None:
        msg = (
            f"Concurrency limit reached for {dimension} '{entity_key}': "
            f"current active ({current_active}) >= limit ({limit_value}). Job will be backpressured."
        )
        super().__init__(
            msg,
            details={
                "dimension": dimension,
                "limit_value": limit_value,
                "current_active": current_active,
                "entity_key": entity_key,
            },
        )
        self.dimension = dimension
        self.limit_value = limit_value
        self.current_active = current_active
        self.entity_key = entity_key


class AmbiguousExecutionError(OrchestrationError):
    """Raised when an operation's external completion status is unconfirmed and cannot be safely retried."""

    def __init__(self, run_id: str, stage_id: str | None, receipt_id: str, operation_type: str) -> None:
        msg = (
            f"Ambiguous execution state on run '{run_id}', stage '{stage_id}', receipt '{receipt_id}' "
            f"for operation '{operation_type}'. Automatic retry is blocked to prevent duplicate external side effects."
        )
        super().__init__(
            msg,
            details={
                "run_id": run_id,
                "stage_id": stage_id,
                "receipt_id": receipt_id,
                "operation_type": operation_type,
            },
        )
        self.run_id = run_id
        self.stage_id = stage_id
        self.receipt_id = receipt_id
        self.operation_type = operation_type


class RetryExhaustedError(OrchestrationError):
    """Raised when an operation exceeds its configured maximum retry attempts."""

    def __init__(self, entity_type: str, entity_id: str, attempts: int, max_attempts: int, last_error: str | None = None) -> None:
        msg = (
            f"Retry attempts exhausted for {entity_type} '{entity_id}': "
            f"made {attempts} attempts (max {max_attempts}). Last error: {last_error or 'none'}"
        )
        super().__init__(
            msg,
            details={
                "entity_type": entity_type,
                "entity_id": entity_id,
                "attempts": attempts,
                "max_attempts": max_attempts,
                "last_error": last_error,
            },
        )
        self.entity_type = entity_type
        self.entity_id = entity_id
        self.attempts = attempts
        self.max_attempts = max_attempts


class UnsafeRecoveryError(OrchestrationError):
    """Raised when recovery cannot be safely performed on a run or stage."""

    def __init__(self, entity_id: str, reason: str) -> None:
        msg = f"Unsafe recovery rejected for '{entity_id}': {reason}"
        super().__init__(msg, details={"entity_id": entity_id, "reason": reason})
        self.entity_id = entity_id
        self.reason = reason


class ReceiptConflictError(OrchestrationError):
    """Raised when creating an execution receipt with an existing idempotency key but conflicting parameters."""

    def __init__(self, idempotency_key: str, existing_receipt_id: str) -> None:
        msg = (
            f"Execution receipt conflict: key '{idempotency_key}' is already bound to "
            f"receipt '{existing_receipt_id}'."
        )
        super().__init__(
            msg,
            details={"idempotency_key": idempotency_key, "existing_receipt_id": existing_receipt_id},
        )
        self.idempotency_key = idempotency_key
        self.existing_receipt_id = existing_receipt_id


class UnsafeResumeError(OrchestrationError):
    """Raised when attempting to resume a run that is corrupted, has unsafe checkpoints, or has unconfirmed side effects."""

    def __init__(self, run_id: str, reason: str) -> None:
        msg = f"Cannot safely resume orchestration run '{run_id}': {reason}"
        super().__init__(msg, details={"run_id": run_id, "reason": reason})
        self.run_id = run_id
        self.reason = reason


class CancellationRejectedError(OrchestrationError):
    """Raised when a cancellation request cannot be accepted due to terminal or invalid state."""

    def __init__(self, run_id: str, reason: str) -> None:
        msg = f"Cancellation request rejected for run '{run_id}': {reason}"
        super().__init__(msg, details={"run_id": run_id, "reason": reason})
        self.run_id = run_id
        self.reason = reason


class CheckpointCorruptedError(OrchestrationError):
    """Raised when a checkpoint's payload, sequence, or integrity validation fails."""

    def __init__(self, checkpoint_id: str, run_id: str, reason: str) -> None:
        msg = f"Checkpoint '{checkpoint_id}' for run '{run_id}' is corrupted: {reason}"
        super().__init__(msg, details={"checkpoint_id": checkpoint_id, "run_id": run_id, "reason": reason})
        self.checkpoint_id = checkpoint_id
        self.run_id = run_id
        self.reason = reason


class InvalidEvidenceTimestampError(OrchestrationError):
    """Raised when an evidence timestamp is invalid (e.g. future timestamp or malformed format)."""

    def __init__(self, evidence_type: str, observed_at: str, reason: str) -> None:
        msg = f"Invalid evidence timestamp for '{evidence_type}' ('{observed_at}'): {reason}"
        super().__init__(msg, details={"evidence_type": evidence_type, "observed_at": observed_at, "reason": reason})
        self.evidence_type = evidence_type
        self.observed_at = observed_at
        self.reason = reason


class UnsupportedEvidenceTypeError(OrchestrationError):
    """Raised when an unknown or unconfigured evidence type is requested."""

    def __init__(self, evidence_type: str) -> None:
        msg = f"Unsupported or unknown evidence type: '{evidence_type}'"
        super().__init__(msg, details={"evidence_type": evidence_type})
        self.evidence_type = evidence_type


class RefreshConflictError(OrchestrationError):
    """Raised when an unresolvable conflict occurs during refresh decision or dispatch."""

    def __init__(self, workspace_id: str, site_id: int | str, evidence_type: str, reason: str) -> None:
        msg = f"Refresh conflict for site {site_id} ({evidence_type}): {reason}"
        super().__init__(
            msg,
            details={
                "workspace_id": workspace_id,
                "site_id": site_id,
                "evidence_type": evidence_type,
                "reason": reason,
            },
        )
        self.workspace_id = workspace_id
        self.site_id = site_id
        self.evidence_type = evidence_type
        self.reason = reason


class PolicyViolationError(OrchestrationError):
    """Raised when an orchestration operation is blocked by tenant operational policy or safety limits."""

    def __init__(
        self,
        rule: str,
        reason: str,
        limit_value: Any = None,
        current_usage: Any = None,
        workspace_id: str | None = None,
        site_id: int | str | None = None,
    ) -> None:
        msg = f"Policy violation on rule '{rule}': {reason}"
        details: dict[str, Any] = {
            "rule": rule,
            "reason": reason,
            "limit_value": limit_value,
            "current_usage": current_usage,
            "workspace_id": workspace_id,
            "site_id": site_id,
        }
        super().__init__(msg, details=details)
        self.rule = rule
        self.reason = reason
        self.limit_value = limit_value
        self.current_usage = current_usage
        self.workspace_id = workspace_id
        self.site_id = site_id


class GlobalCeilingExceededError(OrchestrationError):
    """Raised when a tenant policy configuration exceeds hard global system safety limits."""

    def __init__(self, setting: str, requested_value: Any, ceiling_value: Any) -> None:
        msg = f"Requested value {requested_value} for '{setting}' exceeds hard global safety ceiling of {ceiling_value}."
        super().__init__(
            msg,
            details={
                "setting": setting,
                "requested_value": requested_value,
                "ceiling_value": ceiling_value,
            },
        )
        self.setting = setting
        self.requested_value = requested_value
        self.ceiling_value = ceiling_value


class AlertNotFoundError(OrchestrationError):
    """Raised when an alert cannot be found for the specified workspace and ID."""

    def __init__(self, alert_id: str, workspace_id: str | None = None) -> None:
        msg = f"Alert '{alert_id}' not found."
        if workspace_id:
            msg += f" (workspace: '{workspace_id}')"
        super().__init__(msg, details={"alert_id": alert_id, "workspace_id": workspace_id})
        self.alert_id = alert_id
        self.workspace_id = workspace_id


class InvalidAlertTransitionError(OrchestrationError):
    """Raised on invalid alert state transition (e.g. attempting to acknowledge a resolved alert)."""

    def __init__(self, alert_id: str, from_status: str, to_status: str, reason: str | None = None) -> None:
        msg = f"Cannot transition alert '{alert_id}' from status '{from_status}' to '{to_status}'."
        if reason:
            msg += f" Reason: {reason}"
        super().__init__(msg, details={"alert_id": alert_id, "from_status": from_status, "to_status": to_status, "reason": reason})
        self.alert_id = alert_id
        self.from_status = from_status
        self.to_status = to_status
        self.reason = reason



