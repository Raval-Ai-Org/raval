"""
Production Orchestration & Monitoring - Bounded Retry Policy & Backoff Engine.

Implements centralized, deterministic retry evaluation, exponential backoff calculation,
provider rate-limit retry-after override, and bounded maximum delay ceilings.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
import logging
from typing import Callable

from .enums import FailureClass
from .failure_classifier import StructuredFailure

logger = logging.getLogger(__name__)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


@dataclass
class RetryPolicy:
    """
    Configurable parameters governing retry eligibility and backoff timing.
    """

    max_attempts: int = 3
    base_delay_seconds: float = 5.0
    exponential_factor: float = 2.0
    max_delay_seconds: float = 300.0
    jitter_enabled: bool = False
    max_retries: int | None = None
    retryable_classes: set[FailureClass] = field(
        default_factory=lambda: {
            FailureClass.TRANSIENT,
            FailureClass.PROVIDER_RATE_LIMIT,
            FailureClass.TIMEOUT,
            FailureClass.WORKER_CRASH,
            FailureClass.LEASE_LOST,
            FailureClass.UNKNOWN,
        }
    )
    non_retryable_classes: set[FailureClass] = field(
        default_factory=lambda: {
            FailureClass.AUTHENTICATION,
            FailureClass.CONFIGURATION,
            FailureClass.UNSAFE_POLICY,
            FailureClass.DATA_VALIDATION,
        }
    )

    def __post_init__(self) -> None:
        if self.max_retries is not None:
            self.max_attempts = self.max_retries


@dataclass
class RetryDecision:
    """
    Actionable outcome of a retry policy evaluation.
    """

    should_retry: bool
    delay_seconds: float
    next_retry_at: datetime | None
    current_attempt: int
    max_attempts: int
    reason: str
    is_exhausted: bool

    @property
    def attempt_number(self) -> int:
        return self.current_attempt


class RetryEngine:
    """
    Pure deterministic evaluator computing retry decisions and backoff intervals.
    Can be used as a static/class utility or instantiated with an injected clock.
    """

    def __init__(self, clock: Callable[[], datetime] | None = None) -> None:
        self.clock = clock

    @classmethod
    def calculate_backoff(
        cls,
        attempt: int,
        policy: RetryPolicy,
        provider_retry_after: float | None = None,
    ) -> float:
        """
        Computes the backoff delay in seconds.
        Honors provider retry-after and bounds delay to policy.max_delay_seconds.
        """
        # If provider supplied an explicit Retry-After, honor it bounded by max ceiling
        if provider_retry_after is not None and provider_retry_after > 0:
            return min(float(provider_retry_after), policy.max_delay_seconds)

        exponent = max(0, attempt - 1)
        delay = policy.base_delay_seconds * (policy.exponential_factor ** exponent)
        return min(delay, policy.max_delay_seconds)

    def evaluate(
        self,
        failure: StructuredFailure | None = None,
        attempt_number: int | None = None,
        policy: RetryPolicy | None = None,
        attempt: int | None = None,
        as_of: datetime | None = None,
        clock: Callable[[], datetime] | None = None,
    ) -> RetryDecision:
        """
        Evaluates a StructuredFailure against a RetryPolicy to produce a deterministic RetryDecision.
        Supports both instance-level (engine.evaluate) and class-level (RetryEngine.evaluate) calls.
        """
        # Handle class-level invocation: RetryEngine.evaluate(failure, ...)
        if isinstance(self, StructuredFailure):
            # Positional shift: self is actually failure
            actual_failure = self
            effective_clock = clock
        else:
            actual_failure = failure
            effective_clock = clock or getattr(self, "clock", None)

        if actual_failure is None:
            raise ValueError("StructuredFailure must be provided to evaluate.")

        pol = policy or RetryPolicy()
        now = as_of or (effective_clock() if effective_clock else _utc_now())
        if now.tzinfo is None:
            now = now.replace(tzinfo=timezone.utc)

        cur_attempt = attempt_number if attempt_number is not None else (attempt if attempt is not None else actual_failure.attempt)

        # Check 1: Explicit non-retryable failure classes
        if (
            actual_failure.failure_class in pol.non_retryable_classes
            or actual_failure.failure_class.is_always_non_retryable
            or not actual_failure.is_retryable
        ):
            return RetryDecision(
                should_retry=False,
                delay_seconds=0.0,
                next_retry_at=None,
                current_attempt=cur_attempt,
                max_attempts=pol.max_attempts,
                reason=f"Non-retryable failure class '{actual_failure.failure_class.value}'.",
                is_exhausted=False,
            )

        # Check 2: Retryable class qualification
        if failure.failure_class not in pol.retryable_classes:
            return RetryDecision(
                should_retry=False,
                delay_seconds=0.0,
                next_retry_at=None,
                current_attempt=cur_attempt,
                max_attempts=pol.max_attempts,
                reason=f"Failure class '{failure.failure_class.value}' is not configured for retries.",
                is_exhausted=False,
            )

        # Check 3: Attempt exhaustion (attempt number exceeds policy limit)
        if cur_attempt > pol.max_attempts:
            return RetryDecision(
                should_retry=False,
                delay_seconds=0.0,
                next_retry_at=None,
                current_attempt=cur_attempt,
                max_attempts=pol.max_attempts,
                reason=f"Exceeded maximum retry limit ({cur_attempt}/{pol.max_attempts}).",
                is_exhausted=True,
            )

        # Check 4: Eligible for retry -> compute bounded backoff
        delay = self.calculate_backoff(
            attempt=cur_attempt,
            policy=pol,
            provider_retry_after=failure.retry_after_seconds,
        )
        next_retry = now + timedelta(seconds=delay)

        reason_note = (
            f"Retry attempt {cur_attempt} scheduled with Retry-After override ({delay:.1f}s)"
            if failure.retry_after_seconds
            else f"Retry attempt {cur_attempt} scheduled in {delay:.1f}s (failure: {failure.failure_class.value})"
        )

        return RetryDecision(
            should_retry=True,
            delay_seconds=delay,
            next_retry_at=next_retry,
            current_attempt=cur_attempt,
            max_attempts=pol.max_attempts,
            reason=reason_note,
            is_exhausted=False,
        )
