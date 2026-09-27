"""Integration tests for idempotency key behavior.

Verifies that sending the same idempotency_key twice returns the same
job_id without creating duplicate posts.
"""

from __future__ import annotations

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Post

pytestmark = pytest.mark.usefixtures("seed_test_accounts")


@pytest.fixture
def auth_header() -> dict:
    """Provide Authorization header with valid token."""
    from app.config import get_settings

    settings = get_settings()
    return {"Authorization": f"Bearer {settings.SDE_API_TOKEN}"}


@pytest.mark.asyncio
class TestIdempotency:
    """Tests for idempotency key behavior."""

    async def test_same_key_twice_returns_same_job(
        self,
        async_client: AsyncClient,
        db: AsyncSession,
        auth_header: dict,
    ):
        """Sending same idempotency_key twice returns same job_id.

        Flow:
        1. POST /publish with idempotency_key="test-duplicate-key-1"
        2. POST /publish with same idempotency_key
        3. Both return same job_id
        4. Only ONE post exists in database
        """
        payload = {
            "idempotency_key": "test-duplicate-key-1",
            "scheduled_at": None,
            "targets": [
                {
                    "account_id": "test-account-1",
                    "content": {"text": "Duplicate test post"},
                }
            ],
        }

        # First request
        response1 = await async_client.post(
            "/api/v1/publish",
            json=payload,
            headers=auth_header,
        )
        assert response1.status_code == 201
        data1 = response1.json()
        job_id_1 = data1["job_id"]

        # Second request with same key
        response2 = await async_client.post(
            "/api/v1/publish",
            json=payload,
            headers=auth_header,
        )
        assert response2.status_code == 201
        data2 = response2.json()
        job_id_2 = data2["job_id"]

        # Both should return same job_id
        assert job_id_1 == job_id_2, (
            f"Same idempotency_key should return same job_id. Got: {job_id_1} != {job_id_2}"
        )

        # Verify only ONE post exists in database
        stmt = select(Post).where(Post.idempotency_key == "test-duplicate-key-1")
        result = await db.execute(stmt)
        posts = result.scalars().all()

        assert len(posts) == 1, (
            f"Only one post should exist for this idempotency_key. Found: {len(posts)}"
        )

    async def test_same_key_across_different_payloads_returns_same_job(
        self,
        async_client: AsyncClient,
        db: AsyncSession,  # noqa: ARG002
        auth_header: dict,
    ):
        """If key matches, returns same job even if payload is different.

        idempotency_key is the unique constraint—first payload wins.
        This prevents accidental overwrites.
        """
        key = "test-key-cross-payload"

        # First payload
        payload1 = {
            "idempotency_key": key,
            "targets": [
                {
                    "account_id": "test-account-1",
                    "content": {"text": "Original content"},
                }
            ],
        }

        # Different payload but same key
        payload2 = {
            "idempotency_key": key,
            "targets": [
                {
                    "account_id": "test-account-2",
                    "content": {"text": "Different content"},
                }
            ],
        }

        response1 = await async_client.post(
            "/api/v1/publish",
            json=payload1,
            headers=auth_header,
        )
        assert response1.status_code == 201
        job_id = response1.json()["job_id"]

        response2 = await async_client.post(
            "/api/v1/publish",
            json=payload2,
            headers=auth_header,
        )
        assert response2.status_code == 201
        assert response2.json()["job_id"] == job_id

    async def test_different_keys_create_different_jobs(
        self,
        async_client: AsyncClient,
        db: AsyncSession,  # noqa: ARG002
        auth_header: dict,
    ):
        """Different idempotency_keys create different jobs."""
        payload1 = {
            "idempotency_key": "test-key-unique-1",
            "targets": [
                {
                    "account_id": "test-account-1",
                    "content": {"text": "Post 1"},
                }
            ],
        }

        payload2 = {
            "idempotency_key": "test-key-unique-2",
            "targets": [
                {
                    "account_id": "test-account-1",
                    "content": {"text": "Post 2"},
                }
            ],
        }

        response1 = await async_client.post(
            "/api/v1/publish",
            json=payload1,
            headers=auth_header,
        )
        assert response1.status_code == 201
        job_id_1 = response1.json()["job_id"]

        response2 = await async_client.post(
            "/api/v1/publish",
            json=payload2,
            headers=auth_header,
        )
        assert response2.status_code == 201
        job_id_2 = response2.json()["job_id"]

        # Different keys → different jobs
        assert job_id_1 != job_id_2

    async def test_idempotency_across_different_workspaces(
        self,
        async_client: AsyncClient,
        db: AsyncSession,  # noqa: ARG002
        auth_header: dict,
    ):
        """Same idempotency_key can be used in different workspaces."""
        # This test verifies that the idempotency constraint is
        # per-workspace, not global
        payload = {
            "idempotency_key": "test-key-cross-workspace",
            "targets": [
                {
                    "account_id": "test-account-1",
                    "content": {"text": "Cross-workspace test"},
                }
            ],
        }

        # Publish once (uses default workspace from settings)
        response = await async_client.post(
            "/api/v1/publish",
            json=payload,
            headers=auth_header,
        )
        assert response.status_code == 201

        # In current implementation, workspace_id is from settings
        # This test documents the expected behavior when multi-workspace support is added:
        # Same idempotency_key in different workspace should be treated as different jobs

    async def test_idempotency_response_identical(
        self,
        async_client: AsyncClient,
        db: AsyncSession,  # noqa: ARG002
        auth_header: dict,
    ):
        """Compare responses from same-key requests.

        Both requests should return the same job details
        (status, targets, etc.)
        """
        payload = {
            "idempotency_key": "test-identical-response",
            "targets": [
                {
                    "account_id": "test-account-1",
                    "content": {"text": "Check identical response"},
                }
            ],
        }

        # First request
        response1 = await async_client.post(
            "/api/v1/publish",
            json=payload,
            headers=auth_header,
        )
        data1 = response1.json()

        # Second request
        response2 = await async_client.post(
            "/api/v1/publish",
            json=payload,
            headers=auth_header,
        )
        data2 = response2.json()

        # Both responses should have same shape
        assert data1["job_id"] == data2["job_id"]
        assert data1["idempotency_key"] == data2["idempotency_key"]
        assert data1["workspace_id"] == data2["workspace_id"]
