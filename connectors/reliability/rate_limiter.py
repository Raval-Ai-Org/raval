"""
Connector-Level Rate Limiter and Bounded Throttling (Task 11 Step 6).

Implements:
1. Multi-tenant scoped rate limiting (workspace + connector or connector + site).
2. Provider 429 and Retry-After header integration.
3. Bounded sliding window tracking to prevent provider overload.
4. Guaranteed termination (no infinite loops or hangs).
"""

from __future__ import annotations

import logging
import time
from collections import deque
from typing import Any

from connectors.base.errors import RateLimitExceededError

logger = logging.getLogger(__name__)


class ConnectorRateLimiter:
    """
    Scoped rate limiter maintaining sliding request windows and backoff periods per scope.
    """

    def __init__(
        self,
        default_requests_per_minute: int = 60,
        max_backoff_seconds: float = 30.0,
    ) -> None:
        self.default_rpm = default_requests_per_minute
        self.max_backoff_seconds = max_backoff_seconds
        self._request_timestamps: dict[str, deque[float]] = {}
        self._rate_limited_until: dict[str, float] = {}
        self._custom_limits: dict[str, int] = {}

    @staticmethod
    def build_scope_key(workspace_id: str, site_id: str, connector: str) -> str:
        """Constructs a deterministic scope key."""
        return f"{workspace_id}:{site_id}:{connector.lower()}"

    def set_limit(self, scope_key: str, requests_per_minute: int) -> None:
        """Sets custom RPM for a specific scope."""
        self._custom_limits[scope_key] = max(1, requests_per_minute)

    def is_rate_limited(self, scope_key: str) -> tuple[bool, float]:
        """
        Checks if the scope is currently active under a rate-limit backoff.
        Returns (is_limited, remaining_wait_seconds).
        """
        now = time.monotonic()
        blocked_until = self._rate_limited_until.get(scope_key, 0.0)
        if now < blocked_until:
            remaining = blocked_until - now
            return True, round(remaining, 2)
        return False, 0.0

    def check_and_record_request(self, scope_key: str) -> None:
        """
        Records a new request attempt under the scope window.
        Raises RateLimitExceededError if the window limit is exceeded.
        """
        now = time.monotonic()

        # Check explicit provider backoff
        is_limited, wait_sec = self.is_rate_limited(scope_key)
        if is_limited:
            raise RateLimitExceededError(
                message=f"Rate limit active for scope '{scope_key}'. Retry after {wait_sec}s",
                retry_after_seconds=wait_sec,
                details={"scope_key": scope_key, "remaining_wait_seconds": wait_sec},
            )

        limit = self._custom_limits.get(scope_key, self.default_rpm)
        window = self._request_timestamps.setdefault(scope_key, deque())

        # Purge timestamps older than 60 seconds
        cutoff = now - 60.0
        while window and window[0] < cutoff:
            window.popleft()

        if len(window) >= limit:
            wait_time = max(1.0, 60.0 - (now - window[0]))
            self.record_provider_429(scope_key, retry_after_seconds=wait_time)
            raise RateLimitExceededError(
                message=f"Request limit of {limit} rpm exceeded for '{scope_key}'",
                retry_after_seconds=round(wait_time, 2),
                details={"scope_key": scope_key, "limit_rpm": limit},
            )

        window.append(now)

    def record_provider_429(self, scope_key: str, retry_after_seconds: float = 5.0) -> None:
        """
        Registers an upstream HTTP 429 response from the external connector provider.
        """
        clamped_wait = min(max(1.0, retry_after_seconds), self.max_backoff_seconds)
        now = time.monotonic()
        self._rate_limited_until[scope_key] = now + clamped_wait
        logger.warning(
            "Recorded provider 429 for scope '%s': blocked for %.2fs",
            scope_key,
            clamped_wait,
        )

    def reset_scope(self, scope_key: str) -> None:
        """Resets rate limiting metrics for a scope (useful for testing)."""
        self._request_timestamps.pop(scope_key, None)
        self._rate_limited_until.pop(scope_key, None)
