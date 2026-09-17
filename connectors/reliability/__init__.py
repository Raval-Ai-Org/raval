"""
Reliability Subsystem for Raval AI Connectors (Task 11 Step 6).

Provides:
- Centralized deterministic retry policy with transient/permanent error classification
- Connector rate-limit tracking and bounded backoff
- Granular, scoped resource locking and concurrency conflict protection
- Bounded timeout execution wrappers
- Worker failure recovery and ambiguous state resolution
"""

from .lock import (
    ConcurrencyConflictError,
    ResourceLock,
    ResourceLockManager,
)
from .rate_limiter import (
    ConnectorRateLimiter,
    RateLimitExceededError,
)
from .recovery import (
    RecoveryAction,
    RecoveryDecision,
    WorkerRecoveryManager,
)
from .retry import (
    RetryPolicy,
    execute_with_retry,
)
from .timeout import (
    execute_with_timeout,
)

__all__ = [
    "ConcurrencyConflictError",
    "ResourceLock",
    "ResourceLockManager",
    "ConnectorRateLimiter",
    "RateLimitExceededError",
    "RecoveryAction",
    "RecoveryDecision",
    "WorkerRecoveryManager",
    "RetryPolicy",
    "execute_with_retry",
    "execute_with_timeout",
]
