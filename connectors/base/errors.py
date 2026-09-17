"""
Normalized Connector Error Models and Exception Hierarchy (Task 11 Step 1).

Provides typed error reporting, categorized exceptions, and automatic secret redaction.
No secrets or raw credentials may ever be leaked in error messages or telemetry.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from pydantic import BaseModel, ConfigDict, Field

from .enums import ConnectorErrorCode
from .security import redact_secrets_from_string, sanitize_payload


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


class ConnectorErrorInfo(BaseModel):
    """
    Normalized error payload representing failures across any external connector.
    Guarantees that sensitive details (passwords, tokens, API keys) are sanitized.
    """
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    code: ConnectorErrorCode = Field(
        ...,
        description="Standardized connector error code",
    )
    message: str = Field(
        ...,
        description="Sanitized, human-readable error description without secrets",
    )
    details: dict[str, Any] = Field(
        default_factory=dict,
        description="Sanitized contextual error attributes",
    )
    retryable: bool = Field(
        default=False,
        description="Whether this failure is considered transient and safe to retry",
    )
    retry_after_seconds: float | None = Field(
        default=None,
        description="Suggested backoff duration in seconds if specified by provider",
    )
    provider_code: str | None = Field(
        default=None,
        description="Native provider-specific error code or HTTP status code",
    )
    timestamp: datetime = Field(
        default_factory=_utc_now,
        description="Timestamp when the error occurred (UTC)",
    )

    def model_post_init(self, __context: Any) -> None:
        """Sanitize message and details upon instantiation."""
        sanitized_msg = redact_secrets_from_string(self.message)
        if sanitized_msg != self.message:
            object.__setattr__(self, "message", sanitized_msg)
        sanitized_details = sanitize_payload(self.details)
        if isinstance(sanitized_details, dict):
            object.__setattr__(self, "details", sanitized_details)

    @classmethod
    def from_exception(
        cls,
        exc: Exception,
        code: ConnectorErrorCode = ConnectorErrorCode.UNKNOWN_ERROR,
        provider_code: str | None = None,
        retryable: bool = False,
        retry_after_seconds: float | None = None,
        details: dict[str, Any] | None = None,
    ) -> ConnectorErrorInfo:
        """Helper to safely construct a normalized error info from any Python exception."""
        if isinstance(exc, ConnectorException):
            return exc.to_error_info()
        
        return cls(
            code=code,
            message=redact_secrets_from_string(str(exc)),
            details=sanitize_payload(details or {}),
            retryable=retryable,
            retry_after_seconds=retry_after_seconds,
            provider_code=provider_code,
        )


# =====================================================================
# Exception Hierarchy
# =====================================================================

class ConnectorException(Exception):
    """Base exception for all connector-related failures."""

    def __init__(
        self,
        message: str,
        code: ConnectorErrorCode = ConnectorErrorCode.UNKNOWN_ERROR,
        details: dict[str, Any] | None = None,
        retryable: bool = False,
        retry_after_seconds: float | None = None,
        provider_code: str | None = None,
    ) -> None:
        self.code = code
        self.raw_message = message
        self.sanitized_message = redact_secrets_from_string(message)
        self.details = sanitize_payload(details or {})
        self.retryable = retryable
        self.retry_after_seconds = retry_after_seconds
        self.provider_code = provider_code
        self.timestamp = _utc_now()
        super().__init__(self.sanitized_message)

    def to_error_info(self) -> ConnectorErrorInfo:
        """Converts this exception into a normalized ConnectorErrorInfo model."""
        return ConnectorErrorInfo(
            code=self.code,
            message=self.sanitized_message,
            details=self.details,
            retryable=self.retryable,
            retry_after_seconds=self.retry_after_seconds,
            provider_code=self.provider_code,
            timestamp=self.timestamp,
        )


class AuthenticationError(ConnectorException):
    """Raised when connector authentication fails or credentials are invalid."""

    def __init__(
        self,
        message: str = "Connector authentication failed",
        details: dict[str, Any] | None = None,
        provider_code: str | None = None,
    ) -> None:
        super().__init__(
            message=message,
            code=ConnectorErrorCode.AUTHENTICATION_FAILURE,
            details=details,
            retryable=False,
            provider_code=provider_code,
        )


class AuthorizationError(ConnectorException):
    """Raised when connector lacks permissions for the requested resource/operation."""

    def __init__(
        self,
        message: str = "Connector lacks required authorization",
        details: dict[str, Any] | None = None,
        provider_code: str | None = None,
    ) -> None:
        super().__init__(
            message=message,
            code=ConnectorErrorCode.AUTHORIZATION_FAILURE,
            details=details,
            retryable=False,
            provider_code=provider_code,
        )


class UnsupportedOperationError(ConnectorException):
    """Raised when an operation is not supported by the connector's declared capabilities."""

    def __init__(
        self,
        message: str = "Operation is not supported by this connector",
        operation: str | None = None,
        details: dict[str, Any] | None = None,
    ) -> None:
        merged_details = details or {}
        if operation:
            merged_details["unsupported_operation"] = operation
        super().__init__(
            message=message,
            code=ConnectorErrorCode.UNSUPPORTED_OPERATION,
            details=merged_details,
            retryable=False,
        )


class ResourceNotFoundError(ConnectorException):
    """Raised when a specified resource cannot be located on the target provider."""

    def __init__(
        self,
        message: str = "Resource not found on target provider",
        resource_id: str | None = None,
        details: dict[str, Any] | None = None,
        provider_code: str | None = None,
    ) -> None:
        merged_details = details or {}
        if resource_id:
            merged_details["resource_id"] = resource_id
        super().__init__(
            message=message,
            code=ConnectorErrorCode.RESOURCE_NOT_FOUND,
            details=merged_details,
            retryable=False,
            provider_code=provider_code,
        )


class InvalidResourceError(ConnectorException):
    """Raised when resource reference or payload is malformed or invalid."""

    def __init__(
        self,
        message: str = "Invalid resource specification",
        details: dict[str, Any] | None = None,
        provider_code: str | None = None,
    ) -> None:
        super().__init__(
            message=message,
            code=ConnectorErrorCode.INVALID_RESOURCE,
            details=details,
            retryable=False,
            provider_code=provider_code,
        )


class RateLimitExceededError(ConnectorException):
    """Raised when provider rate limit is exceeded."""

    def __init__(
        self,
        message: str = "Provider rate limit exceeded",
        retry_after_seconds: float | None = None,
        details: dict[str, Any] | None = None,
        provider_code: str | None = None,
    ) -> None:
        super().__init__(
            message=message,
            code=ConnectorErrorCode.RATE_LIMITED,
            details=details,
            retryable=True,
            retry_after_seconds=retry_after_seconds,
            provider_code=provider_code,
        )


class ConnectorTimeoutError(ConnectorException):
    """Raised when a connector operation times out."""

    def __init__(
        self,
        message: str = "Connector operation timed out",
        timeout_seconds: float | None = None,
        details: dict[str, Any] | None = None,
    ) -> None:
        merged_details = details or {}
        if timeout_seconds:
            merged_details["timeout_seconds"] = timeout_seconds
        super().__init__(
            message=message,
            code=ConnectorErrorCode.TIMEOUT,
            details=merged_details,
            retryable=True,
        )


class ProviderAPIError(ConnectorException):
    """Raised when external provider returns an upstream API or server error."""

    def __init__(
        self,
        message: str = "External provider API error",
        provider_code: str | None = None,
        retryable: bool = False,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(
            message=message,
            code=ConnectorErrorCode.PROVIDER_ERROR,
            details=details,
            retryable=retryable,
            provider_code=provider_code,
        )


class ConnectorNetworkError(ConnectorException):
    """Raised on network connection drop, DNS failure, or socket error."""

    def __init__(
        self,
        message: str = "Network connection to provider failed",
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(
            message=message,
            code=ConnectorErrorCode.NETWORK_ERROR,
            details=details,
            retryable=True,
        )


class ConnectorValidationError(ConnectorException):
    """Raised when pre- or post-execution validation checks fail."""

    def __init__(
        self,
        message: str = "Connector validation check failed",
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(
            message=message,
            code=ConnectorErrorCode.VALIDATION_FAILURE,
            details=details,
            retryable=False,
        )
