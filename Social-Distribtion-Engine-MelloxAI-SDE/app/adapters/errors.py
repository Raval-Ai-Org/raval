"""Error taxonomy and failure classification for platform adapters."""

from __future__ import annotations

from enum import StrEnum
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    pass


class ErrorCategory(StrEnum):
    """Classification of failures for retry/escalation decisions."""

    TRANSIENT = "transient"  # Retry with backoff
    AUTH = "auth"  # Token invalid/expired; needs re-auth
    RATE_LIMIT = "rate_limit"  # API rate limit; retry with longer backoff
    FATAL = "fatal"  # Unrecoverable (content validation, account deleted, etc.)
    MEDIA = "media"  # Media processing failure (upload, format, etc.)
    UNKNOWN = "unknown"  # Unclassified; treat as transient


class PublishError(Exception):
    """Base error for publishing failures."""

    def __init__(
        self,
        message: str,
        category: ErrorCategory = ErrorCategory.UNKNOWN,
        http_status: int | None = None,
        platform_error_code: str | None = None,
        retryable: bool | None = None,
    ) -> None:
        """Initialize a PublishError.

        Args:
            message: Human-readable error description
            category: Error classification for retry logic
            http_status: HTTP status code (if from API)
            platform_error_code: Platform-specific error code
            retryable: Override retryability (uses category default if None)

        """
        super().__init__(message)
        self.message = message
        self.category = category
        self.http_status = http_status
        self.platform_error_code = platform_error_code
        # If retryable is not explicitly set, infer from category
        if retryable is not None:
            self.retryable = retryable
        else:
            self.retryable = category in (
                ErrorCategory.TRANSIENT,
                ErrorCategory.RATE_LIMIT,
            )

    def __str__(self) -> str:
        """Return the string representation."""
        parts = [self.message]
        if self.platform_error_code:
            parts.append(f"(platform_code={self.platform_error_code})")
        if self.http_status:
            parts.append(f"(http={self.http_status})")
        return " ".join(parts)


class TransientError(PublishError):
    """Transient failure; safe to retry (e.g., 5xx, timeout, connection reset)."""

    def __init__(
        self,
        message: str,
        http_status: int | None = None,
        platform_error_code: str | None = None,
    ) -> None:
        """Initialize a TransientError."""
        super().__init__(
            message=message,
            category=ErrorCategory.TRANSIENT,
            http_status=http_status,
            platform_error_code=platform_error_code,
            retryable=True,
        )


class AuthError(PublishError):
    """Authentication failure; token invalid, expired, or revoked."""

    def __init__(
        self,
        message: str,
        http_status: int | None = None,
        platform_error_code: str | None = None,
    ) -> None:
        """Initialize an AuthError."""
        super().__init__(
            message=message,
            category=ErrorCategory.AUTH,
            http_status=http_status,
            platform_error_code=platform_error_code,
            retryable=False,
        )


class RateLimitError(PublishError):
    """API rate limit exceeded; retry with exponential backoff."""

    def __init__(
        self,
        message: str,
        retry_after_seconds: int | None = None,
        platform_error_code: str | None = None,
    ) -> None:
        """Initialize a RateLimitError.

        Args:
            message: Error description
            retry_after_seconds: Suggested retry delay (from API)
            platform_error_code: Platform error code

        """
        super().__init__(
            message=message,
            category=ErrorCategory.RATE_LIMIT,
            http_status=429,
            platform_error_code=platform_error_code,
            retryable=True,
        )
        self.retry_after_seconds = retry_after_seconds


class FatalContentError(PublishError):
    """Content validation failure; cannot be published (fatal)."""

    def __init__(
        self,
        message: str,
        field: str | None = None,
        platform_error_code: str | None = None,
    ) -> None:
        """Initialize a FatalContentError.

        Args:
            message: Error description
            field: Field name that failed validation
            platform_error_code: Platform error code

        """
        super().__init__(
            message=message,
            category=ErrorCategory.FATAL,
            platform_error_code=platform_error_code,
            retryable=False,
        )
        self.field = field


class MediaError(PublishError):
    """Media processing failure (upload, format, size, etc.)."""

    def __init__(
        self,
        message: str,
        media_url: str | None = None,
        platform_error_code: str | None = None,
        retryable: bool = False,
    ) -> None:
        """Initialize a MediaError.

        Args:
            message: Error description
            media_url: URL of the problematic media
            platform_error_code: Platform error code
            retryable: Whether this error can be retried

        """
        super().__init__(
            message=message,
            category=ErrorCategory.MEDIA,
            platform_error_code=platform_error_code,
            retryable=retryable,
        )
        self.media_url = media_url


class AccountDisconnectedError(PublishError):
    """Account has been disconnected (user revoked auth)."""

    def __init__(
        self,
        message: str,
        platform_error_code: str | None = None,
    ) -> None:
        """Initialize an AccountDisconnectedError."""
        super().__init__(
            message=message,
            category=ErrorCategory.AUTH,
            platform_error_code=platform_error_code,
            retryable=False,
        )


def classify_http_error(http_status: int, body: str | None = None) -> ErrorCategory:  # noqa: ARG001
    """Classify an HTTP error status into a retry category.

    Args:
        http_status: HTTP status code
        body: Optional response body (for platform-specific parsing)

    Returns:
        ErrorCategory indicating how to handle this error

    """
    # 2xx: Success (should not call this)
    if 200 <= http_status < 300:
        return ErrorCategory.UNKNOWN

    # 4xx: Client errors
    if 400 <= http_status < 500:
        if http_status == 401:
            return ErrorCategory.AUTH  # Unauthorized
        if http_status == 403:
            return ErrorCategory.AUTH  # Forbidden (auth issue)
        if http_status == 404:
            return ErrorCategory.FATAL  # Not found (resource deleted)
        if http_status == 429:
            return ErrorCategory.RATE_LIMIT  # Too many requests
        if http_status == 422:
            return ErrorCategory.FATAL  # Unprocessable entity (validation)
        # Generic 4xx
        return ErrorCategory.FATAL

    # 5xx: Server errors (transient)
    if 500 <= http_status < 600:
        return ErrorCategory.TRANSIENT

    # Unknown
    return ErrorCategory.UNKNOWN
