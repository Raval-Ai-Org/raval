"""
Production Orchestration & Monitoring - Multi-Tenant Concurrency & Isolation Suite (Task 14 Step 8).

Verifies:
1. Workspace-level concurrency limits and non-destructive backpressure.
2. Site-level concurrency limits protecting individual customer sites.
3. Provider-level rate-limiting concurrency ceilings.
4. Multi-tenant isolation: Tenant A saturated load never starves Tenant B.
5. Queue-level workspace scoping preventing cross-tenant job claiming.
6. Deterministic priority and FIFO dispatch fairness.
7. Capacity status diagnostics and thread-safe slot allocation.
8. Multi-threaded atomic slot reservation and release.
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.models import Website
from app.orchestration.concurrency import (
    CapacityStatus,
    ConcurrencyController,
    ConcurrencyPolicy,
)
from app.orchestration.enums import RunType
from app.orchestration.orchestrator import ProductionOrchestrator
from app.orchestration.queue import (
    LocalOrchestrationQueue,
    QueueJob,
)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


@pytest.fixture
def db_session():
    """Isolated in-memory database session."""
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    session = TestingSessionLocal()

    site1 = Website(id=101, name="Acme Corp", url="https://acme.example.com")
    site2 = Website(id=202, name="Beta Inc", url="https://beta.example.com")
    site3 = Website(id=303, name="Gamma LLC", url="https://gamma.example.com")
    session.add_all([site1, site2, site3])
    session.commit()

    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(bind=engine)


def test_workspace_concurrency_limit_enforcement():
    """
    Verifies that workspace-level concurrency limit applies backpressure
    when saturated and recovers when capacity is released.
    """
    policy = ConcurrencyPolicy(
        max_active_runs_per_workspace=2,
        max_active_runs_per_site=5,
    )
    cc = ConcurrencyController(policy=policy)
    workspace_id = "tenant-conc-ws"

    # Acquire up to limit
    assert cc.acquire(workspace_id=workspace_id, site_id=101) is True
    assert cc.acquire(workspace_id=workspace_id, site_id=202) is True

    # Third acquisition exceeds workspace limit (2)
    can_acq, reason = cc.can_acquire(workspace_id=workspace_id, site_id=303)
    assert can_acq is False
    assert "reached limit" in str(reason)
    assert cc.acquire(workspace_id=workspace_id, site_id=303) is False

    # Release one slot
    cc.release(workspace_id=workspace_id, site_id=101)
    assert cc.acquire(workspace_id=workspace_id, site_id=303) is True


def test_site_concurrency_limit_enforcement():
    """
    Verifies that site-level concurrency limit protects individual sites from
    overlapping concurrent runs even if the workspace has remaining headroom.
    """
    policy = ConcurrencyPolicy(
        max_active_runs_per_workspace=10,
        max_active_runs_per_site=1,
    )
    cc = ConcurrencyController(policy=policy)
    workspace_id = "tenant-conc-site"
    site_id = 101

    # First run on site 101 succeeds
    assert cc.acquire(workspace_id=workspace_id, site_id=site_id) is True

    # Second run on same site 101 is backpressured
    can_acq, reason = cc.can_acquire(workspace_id=workspace_id, site_id=site_id)
    assert can_acq is False
    assert "reached limit" in str(reason)
    assert cc.acquire(workspace_id=workspace_id, site_id=site_id) is False

    # Different site 202 in the same workspace succeeds
    assert cc.acquire(workspace_id=workspace_id, site_id=202) is True


def test_provider_concurrency_limit_enforcement():
    """
    Verifies that external provider call limits throttle provider access
    across disparate workspaces.
    """
    policy = ConcurrencyPolicy(
        max_active_runs_per_workspace=10,
        max_active_runs_per_site=10,
        max_active_calls_per_provider=2,
    )
    cc = ConcurrencyController(policy=policy)

    assert cc.acquire(workspace_id="ws-1", site_id=101, provider="openai") is True
    assert cc.acquire(workspace_id="ws-2", site_id=202, provider="openai") is True

    # 3rd concurrent call to openai is backpressured
    assert cc.acquire(workspace_id="ws-3", site_id=303, provider="openai") is False

    # Call to different provider succeeds
    assert cc.acquire(workspace_id="ws-3", site_id=303, provider="firecrawl") is True

    # Release openai slot and retry
    cc.release(workspace_id="ws-1", site_id=101, provider="openai")
    assert cc.acquire(workspace_id="ws-3", site_id=303, provider="openai") is True


def test_multi_tenant_isolation_no_starvation():
    """
    Verifies that Tenant A saturating its operational capacity has zero impact
    on Tenant B's ability to schedule and execute jobs.
    """
    policy = ConcurrencyPolicy(
        max_active_runs_per_workspace=2,
        max_active_runs_per_site=2,
    )
    cc = ConcurrencyController(policy=policy)

    tenant_a = "tenant-saturated"
    tenant_b = "tenant-isolated"

    # Tenant A completely saturates its capacity
    assert cc.acquire(workspace_id=tenant_a, site_id=101) is True
    assert cc.acquire(workspace_id=tenant_a, site_id=202) is True
    assert cc.acquire(workspace_id=tenant_a, site_id=303) is False

    # Tenant B is completely unblocked and can acquire all its permitted slots
    assert cc.acquire(workspace_id=tenant_b, site_id=101) is True
    assert cc.acquire(workspace_id=tenant_b, site_id=202) is True
    # Tenant B also respects its own boundary
    assert cc.acquire(workspace_id=tenant_b, site_id=303) is False


def test_queue_workspace_scoping():
    """
    Verifies that worker queue dequeuing scoped to a workspace strictly prevents
    cross-tenant job leakage.
    """
    queue = LocalOrchestrationQueue()

    # Enqueue jobs for Tenant X and Tenant Y
    job_x = queue.enqueue(QueueJob(run_id="run-x-1", workspace_id="tenant-x", site_id=101))
    job_y = queue.enqueue(QueueJob(run_id="run-y-1", workspace_id="tenant-y", site_id=202))

    # Worker scoped strictly to Tenant X
    dequeued_x = queue.dequeue(worker_id="worker-x-only", workspace_id="tenant-x")
    assert dequeued_x is not None
    assert dequeued_x.workspace_id == "tenant-x"
    assert dequeued_x.job_id == job_x.job_id

    # Second dequeue for Tenant X returns None because no more Tenant X jobs exist
    dequeued_x2 = queue.dequeue(worker_id="worker-x-only", workspace_id="tenant-x")
    assert dequeued_x2 is None

    # Worker scoped to Tenant Y retrieves its job cleanly
    dequeued_y = queue.dequeue(worker_id="worker-y-only", workspace_id="tenant-y")
    assert dequeued_y is not None
    assert dequeued_y.workspace_id == "tenant-y"
    assert dequeued_y.job_id == job_y.job_id


def test_queue_priority_and_fifo_fairness():
    """
    Verifies that highest priority jobs are dequeued first, with FIFO ordering
    preserved for jobs with identical priority.
    """
    queue = LocalOrchestrationQueue()

    j_normal_1 = queue.enqueue(QueueJob(run_id="run-norm-1", workspace_id="tenant-fair", site_id=101, priority=10))
    j_high = queue.enqueue(QueueJob(run_id="run-high", workspace_id="tenant-fair", site_id=101, priority=50))
    j_normal_2 = queue.enqueue(QueueJob(run_id="run-norm-2", workspace_id="tenant-fair", site_id=101, priority=10))

    # High priority is dequeued first
    d1 = queue.dequeue(worker_id="worker-1")
    assert d1 is not None
    assert d1.job_id == j_high.job_id

    # Normal 1 was enqueued before Normal 2 -> FIFO order
    d2 = queue.dequeue(worker_id="worker-1")
    assert d2 is not None
    assert d2.job_id == j_normal_1.job_id

    # Normal 2 is dequeued next
    d3 = queue.dequeue(worker_id="worker-1")
    assert d3 is not None
    assert d3.job_id == j_normal_2.job_id


def test_non_destructive_backpressure_preserves_queue():
    """
    Verifies that backpressured jobs remain safely durable in the queue
    without data loss or drop.
    """
    queue = LocalOrchestrationQueue()
    job = queue.enqueue(QueueJob(run_id="run-durable", workspace_id="tenant-dur", site_id=101))

    # Verify initial queue depth
    assert queue.get_queue_depth(workspace_id="tenant-dur") == 1

    # Worker claims and releases back with delay
    claimed = queue.dequeue(worker_id="worker-1", lease_duration_seconds=30)
    assert claimed is not None

    queue.release(job_id=job.job_id, worker_id="worker-1", delay_seconds=0)

    # Job is still available in queue
    assert queue.get_queue_depth(workspace_id="tenant-dur") == 1
    reclaimed = queue.dequeue(worker_id="worker-2")
    assert reclaimed is not None
    assert reclaimed.job_id == job.job_id


def test_capacity_status_diagnostics():
    """
    Verifies that ConcurrencyController reports accurate telemetry diagnostics.
    """
    policy = ConcurrencyPolicy(
        max_active_runs_per_workspace=3,
        max_active_runs_per_site=2,
    )
    cc = ConcurrencyController(policy=policy)
    workspace_id = "tenant-diag"
    site_id = 101

    status_empty = cc.get_capacity_status(workspace_id=workspace_id, site_id=site_id)
    assert status_empty["workspace"]["active"] == 0
    assert status_empty["workspace"]["available"] == 3
    assert status_empty["site"]["active"] == 0
    assert status_empty["site"]["available"] == 2

    cc.acquire(workspace_id=workspace_id, site_id=site_id)
    status_one = cc.get_capacity_status(workspace_id=workspace_id, site_id=site_id)
    assert status_one["workspace"]["active"] == 1
    assert status_one["workspace"]["available"] == 2
    assert status_one["site"]["active"] == 1
    assert status_one["site"]["available"] == 1

    cc.acquire(workspace_id=workspace_id, site_id=site_id)
    # Site limit is 2 -> now site is saturated
    status_site_sat = cc.get_capacity_status(workspace_id=workspace_id, site_id=site_id)
    assert status_site_sat["site"]["available"] == 0
    assert status_site_sat["site"]["active"] == 2


def test_multi_threaded_atomic_slot_allocation():
    """
    Verifies thread safety of ConcurrencyController under concurrent multi-threaded requests.
    """
    policy = ConcurrencyPolicy(
        max_active_runs_per_workspace=4,
        max_active_runs_per_site=10,
    )
    cc = ConcurrencyController(policy=policy)
    workspace_id = "tenant-threaded"

    results: list[bool] = []

    def attempt_acquire(worker_num: int):
        return cc.acquire(workspace_id=workspace_id, site_id=101 + worker_num)

    with ThreadPoolExecutor(max_workers=10) as executor:
        futures = [executor.submit(attempt_acquire, i) for i in range(10)]
        for f in futures:
            results.append(f.result())

    # Exactly 4 should succeed, 6 should fail
    successes = sum(1 for r in results if r is True)
    failures = sum(1 for r in results if r is False)
    assert successes == 4
    assert failures == 6
