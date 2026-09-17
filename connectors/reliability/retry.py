"""
Centralized Deterministic Retry Policy (Task 11 Step 6).

Implements:
1. Strict transient vs permanent error classification.
2. Exponential backoff with bounded delays and provider Retry-After awareness.
3. Hard upper bound on retry count to prevent infinite loops.
4. Non-retryable immediate fail-fast on auth, permission, security, validation, and traversal errors.
"""

from __future__ import annotations

import logging
import time
from typing import Any, Callable, TypeVar

from connectors.base.enums import ConnectorErrorCode
from connectors.base.errors import (
    AuthenticationError,
    AuthorizationError,
    ConnectorException,
    ConnectorNetworkError,
    ConnectorTimeoutError,
    ConnectorValidationError,
    InvalidResourceError,
    ProviderAPIError,
    RateLimitExceededError,
    ResourceNotFoundError,
    UnsupportedOperationError,
)

logger = logging.getLogger(__name__)

T = TypeVar("T")

# Standard transient error codes that are safe to retry
TRANSIENT_ERROR_CODES: tuple[ConnectorErrorCode, ...] = (
    ConnectorErrorCode.RATE_LIMITED,
    ConnectorErrorCode.TIMEOUT,
    ConnectorErrorCode.NETWORK_ERROR,
    ConnectorErrorCode.PROVIDER_ERROR,
)

# Permanent error codes that MUST NEVER be automatically retried
PERMANENT_ERROR_CODES: tuple[ConnectorErrorCode, ...] = (
    ConnectorErrorCode.AUTHENTICATION_FAILURE,
    ConnectorErrorCode.AUTHORIZATION_FAILURE,
    ConnectorErrorCode.UNSUPPORTED_OPERATION,
    ConnectorErrorCode.INVALID_RESOURCE,
    ConnectorErrorCode.RESOURCE_NOT_FOUND,
    ConnectorErrorCode.VALIDATION_FAILURE,
    ConnectorErrorCode.CONFLICT,
)


class RetryPolicy:
    """
    Configurable, deterministic retry policy for connector and network interactions.
    """

    def __init__(
        self,
        max_retries: int = 3,
        initial_backoff_seconds: float = 0.5,
        max_backoff_seconds: float = 10.0,
        backoff_multiplier: float = 2.0,
        enable_sleep: bool = True,
    ) -> None:
        self.max_retries = max(0, max_retries)
        self.initial_backoff_seconds = initial_backoff_seconds
        self.max_backoff_seconds = max_backoff_seconds
        self.backoff_multiplier = backoff_multiplier
        self.enable_sleep = enable_sleep

    def is_transient(self, exc: Exception) -> bool:
        """
        Deterministically classifies an exception as transient (retryable) or permanent.
        """
        # Specific exception types
        if isinstance(exc, (AuthenticationError, AuthorizationError, UnsupportedOperationError, InvalidResourceError, ResourceNotFoundError, ConnectorValidationError)):
            return False

        if isinstance(exc, (ConnectorNetworkError, ConnectorTimeoutError, RateLimitExceededError)):
            return True

        if isinstance(exc, ProviderAPIError):
            return exc.retryable

        if isinstance(exc, ConnectorException):
            if exc.code in PERMANENT_ERROR_CODES:
                return False
            if exc.code in TRANSIENT_ERROR_CODES:
                return True
            return exc.retryable

        # Standard Python network/timeout errors
        exc_str = str(exc).lower()
        if any(w in exc_str for w in ("timeout", "timed out", "connection reset", "connection refused", "502", "503", "504", "429")):
            return True

        return False

    def calculate_backoff(self, attempt: int, exc: Exception | None = None) -> float:
        """
        Calculates backoff delay in seconds, respecting provider Retry-After if available.
        """
        # If the exception has a specified retry_after_seconds, respect it within max bounds
        if exc and hasattr(exc, "retry_after_seconds") and getattr(exc, "retry_after_seconds") is not None:
            provider_wait = float(getattr(exc, "retry_after_seconds"))
            return min(provider_wait, self.max_backoff_seconds)

        backoff = self.initial_backoff_seconds * (self.backoff_multiplier ** (attempt - 1))
        return min(backoff, self.max_backoff_seconds)

    def execute(self, fn: Callable[..., T], *args: Any, **kwargs: Any) -> T:
        """
        Executes a callable with bounded retries according to this policy.
        """
        attempt = 1
        while True:
            try:
                return fn(*args, **kwargs)
            except Exception as exc:
                if attempt > self.max_retries or not self.is_transient(exc):
                    logger.debug(
                        "RetryPolicy exhausted or non-transient error on attempt %d: %s",
                        attempt,
                        str(exc),
                    )
                    raise

                wait_sec = self.calculate_backoff(attempt, exc)
                logger.info(
                    "Transient failure on attempt %d/%d (backoff %.2fs): %s",
                    attempt,
                    self.max_retries,
                    wait_sec,
                    str(exc),
                )
                if self.enable_sleep and wait_sec > 0:
                    time.sleep(wait_sec)
                attempt += 1


def execute_with_retry(
    fn: Callable[..., T],
    *args: Any,
    max_retries: int = 3,
    initial_backoff_seconds: float = 0.5,
    max_backoff_seconds: float = 10.0,
    enable_sleep: bool = True,
    **kwargs: Any,
) -> T:
    """
    Convenience function to execute a callable with the default retry policy.
    """
    policy = RetryPolicy(
        max_retries=max_retries,
        initial_backoff_seconds=initial_backoff_seconds,
        max_backoff_seconds=max_backoff_seconds,
        enable_sleep=enable_sleep,
    )
    return policy.execute(fn, *args, **kwargs)
