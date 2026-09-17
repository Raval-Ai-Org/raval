"""
Granular Resource Concurrency Protection and Distributed Locking (Task 11 Step 6).

Guarantees:
1. Deterministic locking scoped to (workspace_id, site_id, connector, resource_id).
2. Prevents overlapping mutations on the exact same resource by concurrent workers.
3. Completely avoids coarse global locks that would bottleneck unrelated tenants or sites.
4. Automatic expiration to prevent deadlocks from crashed processes.
"""

from __future__ import annotations

import logging
import threading
import time
from typing import Any

from connectors.base.enums import ConnectorErrorCode
from connectors.base.errors import ConnectorException

logger = logging.getLogger(__name__)


class ConcurrencyConflictError(ConnectorException):
    """Raised when a concurrent execution is already mutating the target resource."""

    def __init__(
        self,
        message: str = "Resource is currently locked by another concurrent execution",
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(
            message=message,
            code=ConnectorErrorCode.CONFLICT,
            details=details,
            retryable=True,
            retry_after_seconds=2.0,
        )


class ResourceLock:
    """
    RAII Context manager for acquiring and releasing a scoped resource lock.
    """

    def __init__(
        self,
        manager: ResourceLockManager,
        lock_key: str,
        owner_id: str,
        ttl_seconds: float = 30.0,
    ) -> None:
        self.manager = manager
        self.lock_key = lock_key
        self.owner_id = owner_id
        self.ttl_seconds = ttl_seconds
        self._acquired = False

    def __enter__(self) -> ResourceLock:
        self._acquired = self.manager.acquire(
            lock_key=self.lock_key,
            owner_id=self.owner_id,
            ttl_seconds=self.ttl_seconds,
        )
        if not self._acquired:
            raise ConcurrencyConflictError(
                message=f"Resource '{self.lock_key}' is locked by another execution",
                details={"lock_key": self.lock_key, "owner_id": self.owner_id},
            )
        return self

    def __exit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> None:
        if self._acquired:
            self.manager.release(self.lock_key, self.owner_id)
            self._acquired = False


class ResourceLockManager:
    """
    In-memory granular lock manager with TTL-based lease renewal and thread safety.
    """

    def __init__(self) -> None:
        self._locks: dict[str, tuple[str, float]] = {}  # lock_key -> (owner_id, expires_at)
        self._mutex = threading.Lock()

    @staticmethod
    def build_lock_key(workspace_id: str, site_id: str, connector: str, resource_id: str) -> str:
        """Builds a deterministic resource lock key."""
        clean_res = resource_id.strip().lower()
        return f"{workspace_id}:{site_id}:{connector.lower()}:{clean_res}"

    def acquire(self, lock_key: str, owner_id: str, ttl_seconds: float = 30.0) -> bool:
        """
        Attempts to acquire lease for the lock key. Returns True if acquired, False otherwise.
        """
        now = time.monotonic()
        with self._mutex:
            if lock_key in self._locks:
                current_owner, expires_at = self._locks[lock_key]
                if current_owner == owner_id:
                    # Same owner -> re-entrant / renew TTL
                    self._locks[lock_key] = (owner_id, now + ttl_seconds)
                    return True
                if now < expires_at:
                    # Lock held by someone else
                    return False

            # Lock is free or expired
            self._locks[lock_key] = (owner_id, now + ttl_seconds)
            return True

    def release(self, lock_key: str, owner_id: str) -> bool:
        """
        Releases the lock if held by the owner.
        """
        with self._mutex:
            if lock_key in self._locks:
                current_owner, _ = self._locks[lock_key]
                if current_owner == owner_id:
                    del self._locks[lock_key]
                    return True
            return False

    def is_locked(self, lock_key: str) -> bool:
        """Checks if a lock key is currently held and unexpired."""
        now = time.monotonic()
        with self._mutex:
            if lock_key in self._locks:
                _, expires_at = self._locks[lock_key]
                return now < expires_at
            return False

    def lock_resource(
        self,
        workspace_id: str,
        site_id: str,
        connector: str,
        resource_id: str,
        owner_id: str,
        ttl_seconds: float = 30.0,
    ) -> ResourceLock:
        """Helper to create a ResourceLock context manager."""
        lock_key = self.build_lock_key(workspace_id, site_id, connector, resource_id)
        return ResourceLock(
            manager=self,
            lock_key=lock_key,
            owner_id=owner_id,
            ttl_seconds=ttl_seconds,
        )
