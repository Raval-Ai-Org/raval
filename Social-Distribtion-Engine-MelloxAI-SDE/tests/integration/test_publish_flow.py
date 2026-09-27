"""Integration tests for the publish flow end-to-end.

Queue-first (T067): ``POST /publish`` creates the job and ENQUEUES each target
to the worker (``scheduler.process_target``) — it returns fast with the job in
"publishing" state; the worker performs the actual platform publish. So these
tests POST, then drive the worker for the job's targets, then assert the
terminal state — mirroring how the demo polls ``GET /jobs/{id}``.
"""

from __future__ import annotations

import asyncio

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import DeliveryLog, Post, PostTarget

pytestmark = pytest.mark.usefixtures("seed_test_accounts")


@pytest.fixture
def auth_header() -> dict:
    """Provide Authorization header with valid token."""
    from app.config import get_settings

    settings = get_settings()
    return {"Authorization": f"Bearer {settings.SDE_API_TOKEN}"}


async def run_worker_for_job(db: AsyncSession, job_id: str) -> None:
    """Run the publish worker for every target of a job (queue-first).

    ``process_target`` is a sync Celery task that uses ``asyncio.run()``
    internally, so it must run OUTSIDE this test's running event loop —
    ``asyncio.to_thread`` gives it a loop-free thread.

    The worker commits via its own sync session; this test session's snapshot
    is stale afterwards, so we roll back to end the read transaction before
    the caller re-reads terminal state.
    """
    from app.services.scheduler_tasks import process_target

    result = await db.execute(select(PostTarget.id).where(PostTarget.post_id == job_id))
    target_ids = [row[0] for row in result.all()]
    for target_id in target_ids:
        await asyncio.to_thread(process_target.apply, args=[target_id])
    await db.rollback()  # drop the stale snapshot; next reads see worker commits


@pytest.mark.asyncio
class TestPublishFlow:
    """End-to-end tests for the publish workflow."""

    async def test_happy_path_immediate_publish(
        self,
        async_client: AsyncClient,
        db: AsyncSession,
        auth_header: dict,
    ):
        """Test successful immediate publish flow (queue-first, T067).

        Flow: POST /publish → 201 + job accepted (status publishing) → run the
        worker for the job's targets → post in DB with status=published.
        """
        payload = {
            "idempotency_key": "test-happy-path-001",
            "scheduled_at": None,
            "targets": [
                {
                    "account_id": "test-account-1",
                    "content": {
                        "text": "Hello world!",
                        "media_urls": [],
                        "metadata": {},
                    },
                }
            ],
        }

        response = await async_client.post(
            "/api/v1/publish",
            json=payload,
            headers=auth_header,
        )

        assert response.status_code == 201, (
            f"Expected 201, got {response.status_code}: {response.text}"
        )
        data = response.json()

        # Verify response structure
        assert "job_id" in data
        assert "workspace_id" in data
        assert "status" in data
        assert "targets" in data
        assert "idempotency_key" in data

        job_id = data["job_id"]
        assert data["idempotency_key"] == "test-happy-path-001"
        # Queue-first: the job is accepted, not yet published (worker will do it).
        assert data["status"] == "publishing"

        # The job + target exist and the target is pending (worker hasn't run).
        stmt = select(Post).where(Post.id == job_id)
        result = await db.execute(stmt)
        post = result.scalar_one_or_none()
        assert post is not None
        assert post.idempotency_key == "test-happy-path-001"

        targets_stmt = select(PostTarget).where(PostTarget.post_id == job_id)
        targets_result = await db.execute(targets_stmt)
        targets = targets_result.scalars().all()
        assert len(targets) == 1
        assert targets[0].status == "pending"

        # Drive the worker (queue-first: the handler only enqueued).
        await run_worker_for_job(db, job_id)

        # Terminal state: post + target published with a platform link.
        result = await db.execute(select(Post).where(Post.id == job_id))
        post = result.scalar_one_or_none()
        assert post is not None
        assert post.status == "published"

        targets_result = await db.execute(select(PostTarget).where(PostTarget.post_id == job_id))
        targets = targets_result.scalars().all()
        assert len(targets) == 1
        assert targets[0].status == "published"
        assert targets[0].platform_post_id is not None

    async def test_validation_failure_returns_422(
        self,
        async_client: AsyncClient,
        auth_header: dict,
    ):
        """Test that invalid content returns 422 validation error."""
        payload = {
            "idempotency_key": "test-validation-fail",
            "scheduled_at": None,
            "targets": [
                {
                    "account_id": "test-account-1",
                    "content": {
                        "text": "",  # Empty text and no media = invalid
                        "media_urls": [],
                    },
                }
            ],
        }

        response = await async_client.post(
            "/api/v1/publish",
            json=payload,
            headers=auth_header,
        )

        assert response.status_code == 422
        data = response.json()
        assert "detail" in data

    async def test_multi_platform_dispatch(
        self,
        async_client: AsyncClient,
        db: AsyncSession,
        auth_header: dict,
    ):
        """Test publishing to multiple platforms (queue-first, T067).

        POST /publish targeting 3 accounts → 3 targets created → run the worker
        → each target published with a unique platform link + delivery logs.
        """
        payload = {
            "idempotency_key": "test-multi-platform",
            "scheduled_at": None,
            "targets": [
                {
                    "account_id": "test-account-1",
                    "content": {"text": "Post for platform 1"},
                },
                {
                    "account_id": "test-account-2",
                    "content": {"text": "Post for platform 2"},
                },
                {
                    "account_id": "test-account-3",
                    "content": {"text": "Post for platform 3"},
                },
            ],
        }

        response = await async_client.post(
            "/api/v1/publish",
            json=payload,
            headers=auth_header,
        )

        assert response.status_code == 201
        data = response.json()
        job_id = data["job_id"]

        # Verify 3 targets created (accepted, pending)
        assert len(data["targets"]) == 3

        # Drive the worker for all 3 targets (queue-first).
        await run_worker_for_job(db, job_id)

        # Verify each target published with a unique platform_post_id
        targets_stmt = select(PostTarget).where(PostTarget.post_id == job_id)
        targets_result = await db.execute(targets_stmt)
        targets = targets_result.scalars().all()
        assert len(targets) == 3
        post_ids = [t.platform_post_id for t in targets]
        assert all(p is not None for p in post_ids)
        assert len(set(post_ids)) == 3, "Each target should have unique platform_post_id"

        # Verify delivery logs exist for each target (queued + publishing + published)
        logs_stmt = select(DeliveryLog).where(DeliveryLog.post_id == job_id)
        logs_result = await db.execute(logs_stmt)
        logs = logs_result.scalars().all()
        assert len(logs) >= 1  # At least queued event

    async def test_error_injection_force_429(
        self,
        async_client: AsyncClient,
        db: AsyncSession,  # noqa: ARG002
        auth_header: dict,
    ):
        """Test rate limit error handling (FORCE_429 magic string, queue-first).

        POST with FORCE_429 → job accepted → worker → target retrying with
        rate_limit category.
        """
        payload = {
            "idempotency_key": "test-force-429",
            "targets": [
                {
                    "account_id": "test-account-1",
                    "content": {"text": "Hello FORCE_429"},  # Magic string triggers 429
                },
            ],
        }

        response = await async_client.post(
            "/api/v1/publish",
            json=payload,
            headers=auth_header,
        )

        assert response.status_code == 201
        job_id = response.json()["job_id"]

        # Drive the worker — the FORCE_429 error only surfaces there.
        await run_worker_for_job(db, job_id)

        targets_result = await db.execute(select(PostTarget).where(PostTarget.post_id == job_id))
        target = targets_result.scalars().first()
        assert target is not None
        # Target should be in retrying state (429 is retriable)
        assert target.status in ("retrying", "failed")
        assert target.error_category == "rate_limit"
        assert target.next_attempt_at is not None

    async def test_error_injection_force_401(
        self,
        async_client: AsyncClient,
        db: AsyncSession,  # noqa: ARG002
        auth_header: dict,
    ):
        """Test auth error handling (FORCE_401 magic string, queue-first).

        POST with FORCE_401 → job accepted → worker → target failed with
        error_category=auth, no retry.
        """
        payload = {
            "idempotency_key": "test-force-401",
            "targets": [
                {
                    "account_id": "test-account-1",
                    "content": {"text": "Hello FORCE_401"},
                },
            ],
        }

        response = await async_client.post(
            "/api/v1/publish",
            json=payload,
            headers=auth_header,
        )

        assert response.status_code == 201
        job_id = response.json()["job_id"]

        # Drive the worker — the FORCE_401 error only surfaces there.
        await run_worker_for_job(db, job_id)

        targets_result = await db.execute(select(PostTarget).where(PostTarget.post_id == job_id))
        target = targets_result.scalars().first()
        assert target is not None
        assert target.status == "failed"
        assert target.error_category == "auth"
        assert target.next_attempt_at is None  # Auth errors don't retry

    async def test_error_injection_force_500(
        self,
        async_client: AsyncClient,
        db: AsyncSession,
        auth_header: dict,
    ):
        """Test server error handling (FORCE_500 magic string, queue-first).

        POST with FORCE_500 → job accepted → worker → target retrying with
        transient category, retry scheduled.
        """
        payload = {
            "idempotency_key": "test-force-500",
            "targets": [
                {
                    "account_id": "test-account-1",
                    "content": {"text": "Hello FORCE_500"},
                },
            ],
        }

        response = await async_client.post(
            "/api/v1/publish",
            json=payload,
            headers=auth_header,
        )

        assert response.status_code == 201
        job_id = response.json()["job_id"]

        # Drive the worker — the FORCE_500 error only surfaces there.
        await run_worker_for_job(db, job_id)

        targets_result = await db.execute(select(PostTarget).where(PostTarget.post_id == job_id))
        target = targets_result.scalars().first()
        assert target is not None
        assert target.status == "retrying"
        assert target.error_category == "transient"
        assert target.next_attempt_at is not None

    async def test_missing_auth_header_returns_401(
        self,
        async_client: AsyncClient,
    ):
        """Test that missing Authorization header returns 401."""
        payload = {
            "idempotency_key": "test-no-auth",
            "targets": [
                {
                    "account_id": "test-account-1",
                    "content": {"text": "Hello"},
                },
            ],
        }

        response = await async_client.post(
            "/api/v1/publish",
            json=payload,
            # No headers = no Authorization
        )

        assert response.status_code == 401

    async def test_invalid_auth_token_returns_401(
        self,
        async_client: AsyncClient,
    ):
        """Test that invalid token returns 401."""
        payload = {
            "idempotency_key": "test-invalid-token",
            "targets": [
                {
                    "account_id": "test-account-1",
                    "content": {"text": "Hello"},
                },
            ],
        }

        response = await async_client.post(
            "/api/v1/publish",
            json=payload,
            headers={"Authorization": "Bearer invalid-token-xyz"},
        )

        assert response.status_code == 401

    async def test_partial_failure_multi_target(
        self,
        async_client: AsyncClient,
        db: AsyncSession,  # noqa: ARG002
        auth_header: dict,
    ):
        """Test handling when some targets succeed and some fail.

        POST 3 targets: 1 succeeds, 2 fail → post status=partial_failed
        """
        payload = {
            "idempotency_key": "test-partial-failure",
            "targets": [
                {
                    "account_id": "test-account-1",
                    "content": {"text": "Success"},
                },
                {
                    "account_id": "test-account-2",
                    "content": {"text": "Fail FORCE_401"},
                },
                {
                    "account_id": "test-account-3",
                    "content": {"text": "Fail FORCE_500"},
                },
            ],
        }

        response = await async_client.post(
            "/api/v1/publish",
            json=payload,
            headers=auth_header,
        )

        assert response.status_code == 201
        data = response.json()
        job_id = data["job_id"]

        # Queue-first: the job is accepted (not yet published).
        assert data["status"] == "publishing"

        # Drive the worker — the mixed success/failure surfaces there.
        await run_worker_for_job(db, job_id)

        # Verify targets have mixed statuses (published + failed/retrying).
        targets_result = await db.execute(select(PostTarget).where(PostTarget.post_id == job_id))
        statuses = [t.status for t in targets_result.scalars().all()]
        assert len(statuses) == 3
        assert "published" in statuses
        assert any(s in ("failed", "retrying") for s in statuses)

        # Post status reflects partial success: "partial_failed" once every
        # target is terminal, or "publishing" while a retrying target is in
        # flight (the FORCE_500 target retries). Never a blanket "published".
        post_result = await db.execute(select(Post).where(Post.id == job_id))
        assert post_result.scalar_one().status in ("partial_failed", "publishing")
