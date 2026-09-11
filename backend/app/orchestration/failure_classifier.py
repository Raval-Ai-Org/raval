"""
Production Orchestration & Monitoring - Centralized Failure Classification.

Classifies runtime, provider, network, worker, policy, and data errors into a
canonical deterministic failure taxonomy without exposing secrets or credentials.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
import logging
from typing import Any

from connectors.base.security import redact_secrets_from_string, sanitize_payload

from .enums import FailureClass

import re

logger = logging.getLogger(__name__)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


class StructuredFailure:
    """
    Standardized, secret-scrubbed diagnostic representation of an orchestration failure.
    """

    def __init__(
        self,
        failure_class: FailureClass,
        error_code: str = "ERR_UNKNOWN",
        safe_message: str | None = None,
        is_retryable: bool = True,
        source: str = "orchestration",
        timestamp: datetime | None = None,
        attempt: int = 1,
        workspace_id: str = "default",
        site_id: int = 0,
        run_id: str | None = None,
        stage_id: str | None = None,
        job_id: str | None = None,
        correlation_id: str | None = None,
        underlying_error_type: str | None = None,
        retry_after_seconds: float | None = None,
        details: dict[str, Any] | None = None,
        message: str | None = None,
        sanitized_detail: dict[str, Any] | None = None,
    ) -> None:
        self.failure_class = failure_class
        self.error_code = error_code
        self.safe_message = message or safe_message or "Unknown failure"
        self.is_retryable = is_retryable
        self.source = source
        self.timestamp = timestamp or _utc_now()
        self.attempt = attempt
        self.workspace_id = workspace_id
        self.site_id = site_id
        self.run_id = run_id
        self.stage_id = stage_id
        self.job_id = job_id
        self.correlation_id = correlation_id
        self.underlying_error_type = underlying_error_type
        self.retry_after_seconds = retry_after_seconds
        self.details = sanitized_detail if sanitized_detail is not None else (details or {})

    @property
    def message(self) -> str:
        return self.safe_message

    @property
    def sanitized_detail(self) -> dict[str, Any]:
        return self.details

    def to_dict(self) -> dict[str, Any]:
        """Returns a serializable dictionary representation."""
        return {
            "failure_class": self.failure_class.value,
            "error_code": self.error_code,
            "safe_message": self.safe_message,
            "is_retryable": self.is_retryable,
            "source": self.source,
            "timestamp": self.timestamp.isoformat(),
            "attempt": self.attempt,
            "workspace_id": self.workspace_id,
            "site_id": self.site_id,
            "run_id": self.run_id,
            "stage_id": self.stage_id,
            "job_id": self.job_id,
            "correlation_id": self.correlation_id,
            "underlying_error_type": self.underlying_error_type,
            "retry_after_seconds": self.retry_after_seconds,
            "details": self.details,
        }


class FailureClassifier:
    """
    Deterministic rule engine mapping exceptions and error payloads into
    the canonical FailureClass taxonomy.
    """

    @classmethod
    def classify(
        cls,
        exc: Exception | str | dict[str, Any],
        context: dict[str, Any] | None = None,
    ) -> StructuredFailure:
        """
        Classifies an exception or error payload deterministically.
        Extracts HTTP status codes, provider retry-after headers, and redacts secrets.
        """
        ctx = dict(context or {})
        source = str(ctx.get("source", ctx.get("stage_name", "orchestration_core")))
        attempt = int(ctx.get("attempt", ctx.get("attempt_count", 1)))
        workspace_id = str(ctx.get("workspace_id", "default"))
        site_id = int(ctx.get("site_id", 0))
        run_id = ctx.get("run_id")
        stage_id = ctx.get("stage_id")
        job_id = ctx.get("job_id")
        correlation_id = ctx.get("correlation_id")

        raw_message = ""
        underlying_type: str | None = None
        status_code: int | None = None
        retry_after: float | None = None
        raw_details: dict[str, Any] = {}

        # Include context items into raw details for sanitization
        if ctx:
            raw_details.update(ctx)

        if isinstance(exc, Exception):
            underlying_type = exc.__class__.__name__
            raw_message = str(exc)
            # Check for HTTP status code on response or exception attribute
            if hasattr(exc, "status_code"):
                status_code = getattr(exc, "status_code")
            elif hasattr(exc, "response") and hasattr(getattr(exc, "response"), "status_code"):
                status_code = getattr(getattr(exc, "response"), "status_code")

            # Extract Retry-After attribute or header
            if hasattr(exc, "retry_after"):
                try:
                    retry_after = float(getattr(exc, "retry_after"))
                except (ValueError, TypeError):
                    retry_after = None
            elif hasattr(exc, "headers") and hasattr(getattr(exc, "headers"), "get"):
                headers = getattr(exc, "headers")
                ra = headers.get("Retry-After") or headers.get("retry-after")
                if ra:
                    try:
                        retry_after = float(ra)
                    except (ValueError, TypeError):
                        retry_after = None
            elif hasattr(exc, "response") and hasattr(getattr(exc, "response"), "headers"):
                headers = getattr(getattr(exc, "response"), "headers")
                ra = headers.get("Retry-After") if hasattr(headers, "get") else None
                if not ra and hasattr(headers, "get"):
                    ra = headers.get("retry-after")
                if ra:
                    try:
                        retry_after = float(ra)
                    except (ValueError, TypeError):
                        retry_after = None

            # Collect details dictionary if exception has one
            if hasattr(exc, "details") and isinstance(getattr(exc, "details"), dict):
                raw_details.update(getattr(exc, "details"))

        elif isinstance(exc, dict):
            raw_message = str(exc.get("message", exc.get("error", "Unknown error")))
            underlying_type = str(exc.get("error_type", exc.get("type", "ErrorDict")))
            status_code = exc.get("status_code", exc.get("code"))
            if "retry_after" in exc:
                try:
                    retry_after = float(exc["retry_after"])
                except (ValueError, TypeError):
                    retry_after = None
            raw_details.update(exc)
        else:
            raw_message = str(exc)
            underlying_type = "StringError"

        # Explicit context overrides for status_code or retry_after
        if "status_code" in ctx and status_code is None:
            status_code = ctx["status_code"]
        if "retry_after_seconds" in ctx and retry_after is None:
            try:
                retry_after = float(ctx["retry_after_seconds"])
            except (ValueError, TypeError):
                retry_after = None

        msg_lower = raw_message.lower()

        # Deterministic Classification Rules (ordered by specificity)
        # 1. Provider Rate Limit (retryable)
        if (
            status_code == 429
            or "rate limit" in msg_lower
            or "too many requests" in msg_lower
            or "quota exceeded" in msg_lower
            or "rate_limited" in msg_lower
            or underlying_type in ("RateLimitError", "RateLimitExceeded")
        ):
            failure_class = FailureClass.PROVIDER_RATE_LIMIT
            error_code = "ERR_RATE_LIMIT"
            is_retryable = True

        # 2. Unsafe Policy / Security Gate (strictly non-retryable)
        elif (
            "safety gate" in msg_lower
            or "unsafe policy" in msg_lower
            or "safety policy" in msg_lower
            or "policy violation" in msg_lower
            or "blocked by safety gate" in msg_lower
            or "disallowed" in msg_lower
            or underlying_type in ("SafetyGateRejectedError", "PermissionError")
        ):
            failure_class = FailureClass.UNSAFE_POLICY
            error_code = "ERR_POLICY_REJECTED"
            is_retryable = False

        # 3. Authentication / Authorization (strictly non-retryable)
        elif (
            status_code in (401, 403)
            or "unauthorized" in msg_lower
            or "forbidden" in msg_lower
            or "authentication" in msg_lower
            or "credentials" in msg_lower
            or "token" in msg_lower
            or underlying_type in ("AuthenticationError", "AuthorizationError")
        ):
            failure_class = FailureClass.AUTHENTICATION
            error_code = "ERR_AUTHENTICATION"
            is_retryable = False

        # 4. Configuration (strictly non-retryable)
        elif (
            "config" in msg_lower
            or "configuration" in msg_lower
            or "missing required" in msg_lower
            or underlying_type == "ConfigurationError"
        ):
            failure_class = FailureClass.CONFIGURATION
            error_code = "ERR_CONFIGURATION"
            is_retryable = False

        # 5. Worker Crash (retryable)
        elif (
            "worker crash" in msg_lower
            or "sigkill" in msg_lower
            or "process died" in msg_lower
            or "worker terminated" in msg_lower
            or "worker disconnected" in msg_lower
            or "out of memory" in msg_lower
            or underlying_type == "WorkerCrashError"
        ):
            failure_class = FailureClass.WORKER_CRASH
            error_code = "ERR_WORKER_CRASH"
            is_retryable = True

        # 6. Lease Lost (retryable)
        elif (
            "lease lost" in msg_lower
            or "lease expired" in msg_lower
            or "lease conflict" in msg_lower
            or underlying_type == "LeaseConflictError"
        ):
            failure_class = FailureClass.LEASE_LOST
            error_code = "ERR_LEASE_LOST"
            is_retryable = True

        # 7. Timeout (transient retryable)
        elif (
            status_code in (408, 504)
            or "timeout" in msg_lower
            or "timed out" in msg_lower
            or "deadline exceeded" in msg_lower
            or (underlying_type and "timeout" in underlying_type.lower())
        ):
            failure_class = FailureClass.TIMEOUT
            error_code = "ERR_TIMEOUT"
            is_retryable = True

        # 8. Data Validation (strictly non-retryable)
        elif (
            status_code == 422
            or "validation" in msg_lower
            or "invalid payload" in msg_lower
            or "invalid data" in msg_lower
            or "unprocessable" in msg_lower
            or underlying_type in ("ValidationError", "ValueError", "KeyError")
        ):
            failure_class = FailureClass.DATA_VALIDATION
            error_code = "ERR_DATA_VALIDATION"
            is_retryable = False

        # 9. Transient Network / Upstream Server Error (retryable)
        elif (
            status_code in (500, 502, 503)
            or "connection reset" in msg_lower
            or "connection refused" in msg_lower
            or "connection dropped" in msg_lower
            or "network error" in msg_lower
            or "econnrefused" in msg_lower
            or "bad gateway" in msg_lower
            or "service unavailable" in msg_lower
            or (underlying_type and ("network" in underlying_type.lower() or "connect" in underlying_type.lower()))
        ):
            failure_class = FailureClass.TRANSIENT
            error_code = "ERR_TRANSIENT"
            is_retryable = True

        # 10. Unknown (fallback retryable)
        else:
            failure_class = FailureClass.UNKNOWN
            error_code = "ERR_UNKNOWN"
            is_retryable = True

        # Double check non-retryable constraint
        if failure_class.is_always_non_retryable:
            is_retryable = False

        # Redact secrets from error message and details
        clean_message = redact_secrets_from_string(raw_message)
        clean_message = re.sub(r"Bearer\s+[A-Za-z0-9_\-\.]+", "Bearer [REDACTED]", clean_message, flags=re.IGNORECASE)
        clean_details = sanitize_payload(raw_details)

        return StructuredFailure(
            failure_class=failure_class,
            error_code=error_code,
            safe_message=clean_message,
            is_retryable=is_retryable,
            source=source,
            timestamp=_utc_now(),
            attempt=attempt,
            workspace_id=workspace_id,
            site_id=site_id,
            run_id=run_id,
            stage_id=stage_id,
            job_id=job_id,
            correlation_id=correlation_id,
            underlying_error_type=underlying_type,
            retry_after_seconds=retry_after,
            details=clean_details,
        )
