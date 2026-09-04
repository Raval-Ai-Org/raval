"""
Execution Engine and Safety Gate Error Classes (Task 11 Step 4).

Defines structured exceptions for safety gate rejections, approval requirements,
invalid lifecycle state transitions, stale approvals, and duplicate executions.
"""

from __future__ import annotations

from typing import Any

from connectors.base.enums import ConnectorErrorCode
from connectors.base.errors import ConnectorException


class SafetyGateRejectedError(ConnectorException):
    """Raised when an execution request fails Safety Gate policy checks."""

    def __init__(
        self,
        message: str = "Execution request rejected by Safety Gate",
        blocking_reasons: list[str] | None = None,
        details: dict[str, Any] | None = None,
    ) -> None:
        merged_details = details or {}
        if blocking_reasons:
            merged_details["blocking_reasons"] = blocking_reasons
        super().__init__(
            message=message,
            code=ConnectorErrorCode.VALIDATION_FAILURE,
            details=merged_details,
            retryable=False,
        )


class ApprovalRequiredError(ConnectorException):
    """Raised when an ASSISTED execution request attempts apply without explicit approval."""

    def __init__(
        self,
        message: str = "Execution requires explicit human approval before apply",
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(
            message=message,
            code=ConnectorErrorCode.AUTHORIZATION_FAILURE,
            details=details,
            retryable=False,
        )


class InvalidStateTransitionError(ConnectorException):
    """Raised when an execution session attempts an illegal state transition."""

    def __init__(
        self,
        current_state: str,
        target_state: str,
        message: str | None = None,
        details: dict[str, Any] | None = None,
    ) -> None:
        msg = message or f"Cannot transition execution from '{current_state}' to '{target_state}'"
        merged_details = details or {}
        merged_details.update({"current_state": current_state, "target_state": target_state})
        super().__init__(
            message=msg,
            code=ConnectorErrorCode.VALIDATION_FAILURE,
            details=merged_details,
            retryable=False,
        )


class StaleApprovalError(ConnectorException):
    """Raised when an approval is invalid because the underlying proposal or target has changed."""

    def __init__(
        self,
        message: str = "Approval is stale or invalidated because proposal content has changed",
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(
            message=message,
            code=ConnectorErrorCode.VALIDATION_FAILURE,
            details=details,
            retryable=False,
        )


class DuplicateExecutionError(ConnectorException):
    """Raised when a conflicting concurrent execution request is detected."""

    def __init__(
        self,
        request_id: str,
        message: str = "Duplicate or conflicting execution request detected",
        details: dict[str, Any] | None = None,
    ) -> None:
        merged_details = details or {}
        merged_details["request_id"] = request_id
        super().__init__(
            message=message,
            code=ConnectorErrorCode.CONFLICT,
            details=merged_details,
            retryable=False,
        )
