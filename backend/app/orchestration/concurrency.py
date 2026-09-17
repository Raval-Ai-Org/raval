"""
Production Orchestration & Monitoring - Concurrency Controller.

Enforces configurable multi-dimensional limits (workspace, site, provider),
tracks active in-flight operational loads, and applies backpressure when capacity is exhausted.
"""

from __future__ import annotations

from dataclasses import dataclass
import logging
from threading import RLock
from typing import Any

from .exceptions import ConcurrencyExceededError

logger = logging.getLogger(__name__)


@dataclass
class ConcurrencyPolicy:
    """Configurable concurrency thresholds across platform dimensions."""

    max_active_runs_per_workspace: int = 3
    max_active_runs_per_site: int = 1
    max_active_calls_per_provider: int = 5


@dataclass
class CapacityStatus:
    """Diagnostic capacity status for a workspace or site."""

    active_runs: int
    limit: int
    available_slots: int
    backpressured: bool
    workspace_id: str | None = None
    site_id: int | None = None


class ConcurrencyController:
    """
    Thread-safe concurrency coordinator and backpressure detector.
    """

    def __init__(self, policy: ConcurrencyPolicy | None = None) -> None:
        self._policy = policy or ConcurrencyPolicy()
        self._lock = RLock()
        # active count trackers
        self._workspace_counts: dict[str, int] = {}
        self._site_counts: dict[int, int] = {}
        self._provider_counts: dict[str, int] = {}

    def can_acquire(
        self,
        workspace_id: str,
        site_id: int,
        provider: str | None = None,
    ) -> tuple[bool, str | None]:
        """
        Checks if capacity is available across workspace, site, and optional provider dimensions.
        Returns (True, None) if capacity is available, or (False, reason) if capacity is exhausted.
        """
        with self._lock:
            ws_active = self._workspace_counts.get(workspace_id, 0)
            if ws_active >= self._policy.max_active_runs_per_workspace:
                return (
                    False,
                    f"Workspace '{workspace_id}' active runs ({ws_active}) reached limit ({self._policy.max_active_runs_per_workspace})",
                )

            site_active = self._site_counts.get(site_id, 0)
            if site_active >= self._policy.max_active_runs_per_site:
                return (
                    False,
                    f"Site '{site_id}' active runs ({site_active}) reached limit ({self._policy.max_active_runs_per_site})",
                )

            if provider:
                prov_active = self._provider_counts.get(provider, 0)
                if prov_active >= self._policy.max_active_calls_per_provider:
                    return (
                        False,
                        f"Provider '{provider}' active calls ({prov_active}) reached limit ({self._policy.max_active_calls_per_provider})",
                    )

            return True, None

    def acquire(
        self,
        workspace_id: str,
        site_id: int,
        provider: str | None = None,
    ) -> bool:
        """
        Attempts to atomically reserve execution capacity across dimensions.
        Returns True if acquired; returns False if backpressured.
        """
        with self._lock:
            allowed, reason = self.can_acquire(workspace_id=workspace_id, site_id=site_id, provider=provider)
            if not allowed:
                logger.info("Backpressure applied: %s", reason)
                return False

            self._workspace_counts[workspace_id] = self._workspace_counts.get(workspace_id, 0) + 1
            self._site_counts[site_id] = self._site_counts.get(site_id, 0) + 1
            if provider:
                self._provider_counts[provider] = self._provider_counts.get(provider, 0) + 1

            logger.debug(
                "Acquired concurrency slot: workspace='%s' (%d/%d), site=%d (%d/%d)",
                workspace_id,
                self._workspace_counts[workspace_id],
                self._policy.max_active_runs_per_workspace,
                site_id,
                self._site_counts[site_id],
                self._policy.max_active_runs_per_site,
            )
            return True

    def release(
        self,
        workspace_id: str,
        site_id: int,
        provider: str | None = None,
    ) -> None:
        """
        Releases previously acquired execution capacity.
        """
        with self._lock:
            if workspace_id in self._workspace_counts:
                self._workspace_counts[workspace_id] = max(0, self._workspace_counts[workspace_id] - 1)
                if self._workspace_counts[workspace_id] == 0:
                    del self._workspace_counts[workspace_id]

            if site_id in self._site_counts:
                self._site_counts[site_id] = max(0, self._site_counts[site_id] - 1)
                if self._site_counts[site_id] == 0:
                    del self._site_counts[site_id]

            if provider and provider in self._provider_counts:
                self._provider_counts[provider] = max(0, self._provider_counts[provider] - 1)
                if self._provider_counts[provider] == 0:
                    del self._provider_counts[provider]

            logger.debug("Released concurrency slot: workspace='%s', site=%d", workspace_id, site_id)

    def get_capacity_status(
        self,
        workspace_id: str | None = None,
        site_id: int | None = None,
    ) -> dict[str, Any]:
        """
        Returns a diagnostic snapshot of current active load vs policy limits.
        """
        with self._lock:
            status: dict[str, Any] = {
                "policy": {
                    "max_active_runs_per_workspace": self._policy.max_active_runs_per_workspace,
                    "max_active_runs_per_site": self._policy.max_active_runs_per_site,
                    "max_active_calls_per_provider": self._policy.max_active_calls_per_provider,
                },
                "global_active_workspaces": len(self._workspace_counts),
                "global_active_sites": len(self._site_counts),
            }
            if workspace_id:
                ws_act = self._workspace_counts.get(workspace_id, 0)
                status["workspace"] = {
                    "workspace_id": workspace_id,
                    "active": ws_act,
                    "limit": self._policy.max_active_runs_per_workspace,
                    "available": max(0, self._policy.max_active_runs_per_workspace - ws_act),
                }
            if site_id is not None:
                site_act = self._site_counts.get(site_id, 0)
                status["site"] = {
                    "site_id": site_id,
                    "active": site_act,
                    "limit": self._policy.max_active_runs_per_site,
                    "available": max(0, self._policy.max_active_runs_per_site - site_act),
                }
            return status

    def get_active_runs_count(
        self,
        db: Any = None,
        workspace_id: str | None = None,
        site_id: int | None = None,
    ) -> int:
        """
        Returns the current active in-flight runs count for the given workspace and/or site.
        """
        with self._lock:
            if site_id is not None:
                return self._site_counts.get(site_id, 0)
            if workspace_id is not None:
                return self._workspace_counts.get(workspace_id, 0)
            return sum(self._workspace_counts.values())

    def reset(self) -> None:
        """Resets all active counters (for test teardown)."""
        with self._lock:
            self._workspace_counts.clear()
            self._site_counts.clear()
            self._provider_counts.clear()
