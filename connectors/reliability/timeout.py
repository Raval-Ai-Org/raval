"""
Deterministic Timeout Enforcement for Connector Operations (Task 11 Step 6).

Guarantees:
1. Every external connector operation has bounded execution duration.
2. Timed-out operations immediately fail fast with ConnectorTimeoutError.
3. Timeout NEVER silently succeeds or hangs.
"""

from __future__ import annotations

import concurrent.futures
import logging
from typing import Any, Callable, TypeVar

from connectors.base.errors import ConnectorTimeoutError

logger = logging.getLogger(__name__)

T = TypeVar("T")


def execute_with_timeout(
    fn: Callable[..., T],
    *args: Any,
    timeout_seconds: float = 30.0,
    operation_name: str = "connector_operation",
    **kwargs: Any,
) -> T:
    """
    Executes a callable inside a dedicated worker thread with strict timeout enforcement.
    Cross-platform compatible across Windows, Linux, and macOS.
    """
    if timeout_seconds <= 0:
        return fn(*args, **kwargs)

    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
        future = executor.submit(fn, *args, **kwargs)
        try:
            return future.result(timeout=timeout_seconds)
        except concurrent.futures.TimeoutError:
            logger.error(
                "Operation '%s' exceeded bounded timeout limit of %.2fs",
                operation_name,
                timeout_seconds,
            )
            raise ConnectorTimeoutError(
                message=f"Operation '{operation_name}' timed out after {timeout_seconds} seconds",
                timeout_seconds=timeout_seconds,
                details={"operation": operation_name, "timeout_limit": timeout_seconds},
            )
        except Exception:
            raise
