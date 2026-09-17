"""
Production Orchestration & Monitoring - Queue Abstraction.

Defines the Queue contract and a thread-safe repository-local queue implementation
supporting priority ordering, worker leases, visibility timeouts, and backpressure.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
import logging
from threading import RLock
from typing import Any
from uuid import uuid4

logger = logging.getLogger(__name__)

DEFAULT_LEASE_DURATION_SECONDS: int = 30


@dataclass
class QueueMetrics:
    """Queue depth and worker load metrics."""

    total_depth: int
    active_leases: int
    visible_waiting: int
    workspace_depth: int | None = None


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


@dataclass
class QueueJob:
    """Represents an execution work item in the orchestration queue."""

    run_id: str
    workspace_id: str
    site_id: int
    job_id: str = field(default_factory=lambda: f"job_{uuid4().hex[:12]}")
    run_type: str | None = None
    priority: int = 10  # Higher value = processed sooner
    enqueued_at: datetime = field(default_factory=_utc_now)
    visible_at: datetime = field(default_factory=_utc_now)
    lease_id: str | None = None
    worker_id: str | None = None
    lease_expires_at: datetime | None = None
    attempt_count: int = 0
    payload: dict[str, Any] = field(default_factory=dict)

    @property
    def is_leased(self) -> bool:
        """Returns True if the job is actively leased by a worker and not expired."""
        if not self.lease_id or not self.lease_expires_at:
            return False
        return self.lease_expires_at > _utc_now()


class OrchestrationQueue(ABC):
    """
    Abstract Queue Contract for dispatching orchestration runs.
    Enables future drop-in replacement by distributed backends (Redis/Celery/SQS).
    """

    @abstractmethod
    def enqueue(self, job: QueueJob) -> QueueJob:
        """Adds a job to the queue."""
        ...

    @abstractmethod
    def dequeue(
        self,
        worker_id: str,
        lease_duration_seconds: int = DEFAULT_LEASE_DURATION_SECONDS,
        workspace_id: str | None = None,
    ) -> QueueJob | None:
        """
        Attempts to claim the next available highest-priority visible job for the worker.
        Returns None if the queue is empty or all jobs are leased / backpressured.
        """
        ...

    @abstractmethod
    def acknowledge(self, job_id: str, worker_id: str) -> bool:
        """
        Acknowledges successful completion and permanently removes the job from the queue.
        """
        ...

    @abstractmethod
    def release(
        self,
        job_id: str,
        worker_id: str,
        delay_seconds: int = 0,
    ) -> bool:
        """
        Releases an active lease, returning the job to the queue with an optional visibility delay.
        """
        ...

    @abstractmethod
    def extend_lease(
        self,
        job_id: str,
        worker_id: str,
        extension_seconds: int = DEFAULT_LEASE_DURATION_SECONDS,
    ) -> datetime | None:
        """
        Extends the lease expiration timestamp for an active worker heartbeat.
        """
        ...

    @abstractmethod
    def get_queue_depth(self, workspace_id: str | None = None) -> int:
        """Returns the number of unacknowledged jobs currently in the queue."""
        ...

    @abstractmethod
    def get_visibility(self, limit: int = 50) -> list[QueueJob]:
        """Returns a snapshot of jobs currently in the queue for visibility/inspection."""
        ...

    @abstractmethod
    def get_metrics(self, workspace_id: str | None = None) -> QueueMetrics:
        """Returns depth and active lease metrics."""
        ...

    @abstractmethod
    def purge(self) -> None:
        """Removes all jobs from the queue."""
        ...


class LocalOrchestrationQueue(OrchestrationQueue):
    """
    Thread-safe in-memory priority queue implementation.
    Safe for multi-threaded testing and single-node production deployment.
    """

    def __init__(self) -> None:
        self._lock = RLock()
        self._jobs: dict[str, QueueJob] = {}

    def enqueue(self, job: QueueJob) -> QueueJob:
        with self._lock:
            self._jobs[job.job_id] = job
            logger.debug(
                "Enqueued job '%s' (run_id='%s', priority=%d, workspace='%s')",
                job.job_id,
                job.run_id,
                job.priority,
                job.workspace_id,
            )
            return job

    def dequeue(
        self,
        worker_id: str,
        lease_duration_seconds: int = DEFAULT_LEASE_DURATION_SECONDS,
        workspace_id: str | None = None,
    ) -> QueueJob | None:
        with self._lock:
            now = _utc_now()
            # Candidate jobs: visible and either unleased or lease expired
            candidates: list[QueueJob] = []
            for job in self._jobs.values():
                if workspace_id is not None and job.workspace_id != workspace_id:
                    continue
                if job.visible_at > now:
                    continue
                if job.is_leased:
                    continue
                candidates.append(job)

            if not candidates:
                return None

            # Sort by priority descending, then enqueued_at ascending (FIFO for same priority)
            candidates.sort(key=lambda j: (-j.priority, j.enqueued_at))
            chosen = candidates[0]

            # Acquire lease
            chosen.lease_id = f"lease_{uuid4().hex[:12]}"
            chosen.worker_id = worker_id
            chosen.lease_expires_at = now + timedelta(seconds=lease_duration_seconds)
            chosen.attempt_count += 1

            logger.info(
                "Worker '%s' leased job '%s' (run_id='%s', lease_id='%s', expires_at='%s')",
                worker_id,
                chosen.job_id,
                chosen.run_id,
                chosen.lease_id,
                chosen.lease_expires_at.isoformat(),
            )
            return chosen

    def acknowledge(self, job_id: str, worker_id: str) -> bool:
        with self._lock:
            job = self._jobs.get(job_id)
            if not job:
                return False
            # Verify lease ownership
            if job.worker_id != worker_id:
                logger.warning(
                    "Cannot ack job '%s': owned by worker '%s', not '%s'",
                    job_id,
                    job.worker_id,
                    worker_id,
                )
                return False

            del self._jobs[job_id]
            logger.debug("Acknowledged and removed job '%s' by worker '%s'", job_id, worker_id)
            return True

    def release(
        self,
        job_id: str,
        worker_id: str,
        delay_seconds: int = 0,
    ) -> bool:
        with self._lock:
            job = self._jobs.get(job_id)
            if not job:
                return False

            if job.worker_id != worker_id and job.is_leased:
                logger.warning(
                    "Cannot release job '%s': lease held by '%s', not '%s'",
                    job_id,
                    job.worker_id,
                    worker_id,
                )
                return False

            now = _utc_now()
            job.lease_id = None
            job.worker_id = None
            job.lease_expires_at = None
            job.visible_at = now + timedelta(seconds=max(0, delay_seconds))
            logger.info("Released job '%s' back to queue (delay=%ds)", job_id, delay_seconds)
            return True

    def extend_lease(
        self,
        job_id: str,
        worker_id: str,
        extension_seconds: int = DEFAULT_LEASE_DURATION_SECONDS,
    ) -> datetime | None:
        with self._lock:
            job = self._jobs.get(job_id)
            if not job:
                return None
            if job.worker_id != worker_id:
                return None

            now = _utc_now()
            job.lease_expires_at = now + timedelta(seconds=extension_seconds)
            logger.debug(
                "Extended lease for job '%s' by worker '%s' to '%s'",
                job_id,
                worker_id,
                job.lease_expires_at.isoformat(),
            )
            return job.lease_expires_at

    def get_queue_depth(self, workspace_id: str | None = None) -> int:
        with self._lock:
            if workspace_id is None:
                return len(self._jobs)
            return sum(1 for j in self._jobs.values() if j.workspace_id == workspace_id)

    def depth(self, workspace_id: str | None = None) -> int:
        return self.get_queue_depth(workspace_id)

    def __len__(self) -> int:
        return self.get_queue_depth()

    def __bool__(self) -> bool:
        return True

    def get_visibility(self, limit: int = 50) -> list[QueueJob]:
        with self._lock:
            all_jobs = list(self._jobs.values())
            all_jobs.sort(key=lambda j: (-j.priority, j.enqueued_at))
            return all_jobs[:limit]

    def get_metrics(self, workspace_id: str | None = None) -> QueueMetrics:
        with self._lock:
            total = len(self._jobs)
            active = sum(1 for j in self._jobs.values() if j.is_leased)
            now = _utc_now()
            waiting = sum(1 for j in self._jobs.values() if not j.is_leased and j.visible_at <= now)
            ws_depth = sum(1 for j in self._jobs.values() if j.workspace_id == workspace_id) if workspace_id else None
            return QueueMetrics(
                total_depth=total,
                active_leases=active,
                visible_waiting=waiting,
                workspace_depth=ws_depth,
            )

    def purge(self) -> None:
        with self._lock:
            self._jobs.clear()
