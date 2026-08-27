"""Tests for publisher.py — publish orchestration, idempotency, error paths.

Covers:
1. Idempotency — same key returns same job
2. Different keys create different jobs
3. Account not found → proper error
4. Account inactive → proper error
5. Schedule creates pending post
"""

from __future__ import annotations

import asyncio
import os
import tempfile
from datetime import UTC, datetime

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

# Set env BEFORE app imports
with tempfile.NamedTemporaryFile(suffix=".test.db", delete=False) as _db_file:
    _TEST_DB = _db_file.name
os.environ["ENV"] = "testing"
os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{_TEST_DB}"
os.environ["DATABASE_URL_SYNC"] = f"sqlite:///{_TEST_DB}"
os.environ["SDE_API_TOKEN"] = "test-token-min-16chars"
os.environ["SDE_SIGNING_SECRET"] = "test-signing-secret-32-bytes-long-req"

from app.database import get_async_engine
from app.models import Account, Base
from app.schemas import PublishRequest, PublishTarget
from app.services.publisher import PublisherService


@pytest.fixture(autouse=True)
async def setup_db():
    """Create fresh tables for each test."""
    engine = get_async_engine()
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


def _make_session():
    """Create a test async session."""
    from app.database import get_async_session_maker

    return get_async_session_maker()


async def _seed_account(
    session: AsyncSession,
    account_id: str = "test-acc-1",
    platform: str = "dryrun",
    status: str = "active",
):
    """Helper to seed an account."""
    from cryptography.fernet import Fernet

    key = os.environ["FERNET_KEY"]
    cipher = Fernet(key.encode())
    token = cipher.encrypt(b"test_token")

    acc = Account(
        id=account_id,
        workspace_id="workspace_001",
        brand_id="brand_001",
        platform=platform,
        platform_account_id=f"platform_{account_id}",
        platform_username=f"user_{account_id}",
        encrypted_access_token=token,
        status=status,
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )
    session.add(acc)
    await session.commit()


def _make_content(text: str = "Hello") -> dict:
    return {"text": text, "media_urls": [], "metadata": {}}


class TestPublisherService:
    """Tests for PublisherService orchestration."""

    @pytest.mark.asyncio
    async def test_idempotency_same_key_returns_same_job(self):
        """Same idempotency_key returns same job_id."""
        maker = _make_session()
        async with maker() as session:
            await _seed_account(session)

        async with maker() as session:
            service = PublisherService()
            req = PublishRequest(
                idempotency_key="dup-test",
                targets=[PublishTarget(account_id="test-acc-1", content=_make_content())],
            )
            r1 = await service.publish(
                request=req, workspace_id="workspace_001", brand_id="brand_001", db=session
            )

        async with maker() as session:
            r2 = await service.publish(
                request=req, workspace_id="workspace_001", brand_id="brand_001", db=session
            )

        assert r1["job_id"] == r2["job_id"]

    @pytest.mark.asyncio
    async def test_different_keys_create_different_jobs(self):
        """Different keys return different job_ids."""
        maker = _make_session()
        async with maker() as session:
            await _seed_account(session)

        async with maker() as session:
            service = PublisherService()
            r1 = await service.publish(
                request=PublishRequest(
                    idempotency_key="key-a",
                    targets=[PublishTarget(account_id="test-acc-1", content=_make_content("A"))],
                ),
                workspace_id="workspace_001",
                brand_id="brand_001",
                db=session,
            )
            r2 = await service.publish(
                request=PublishRequest(
                    idempotency_key="key-b",
                    targets=[PublishTarget(account_id="test-acc-1", content=_make_content("B"))],
                ),
                workspace_id="workspace_001",
                brand_id="brand_001",
                db=session,
            )
        assert r1["job_id"] != r2["job_id"]

    @pytest.mark.asyncio
    async def test_account_not_found_raises_error(self):
        """Non-existent account raises ValueError."""
        maker = _make_session()
        async with maker() as session:
            service = PublisherService()
            with pytest.raises(ValueError, match="Account not found"):
                await service.publish(
                    request=PublishRequest(
                        idempotency_key="missing",
                        targets=[PublishTarget(account_id="ghost", content=_make_content())],
                    ),
                    workspace_id="workspace_001",
                    brand_id="brand_001",
                    db=session,
                )

    @pytest.mark.asyncio
    async def test_inactive_account_raises_error(self):
        """Inactive account raises ValueError."""
        maker = _make_session()
        async with maker() as session:
            await _seed_account(session, status="disconnected")

        async with maker() as session:
            service = PublisherService()
            with pytest.raises(ValueError, match="not active"):
                await service.publish(
                    request=PublishRequest(
                        idempotency_key="inactive-test",
                        targets=[PublishTarget(account_id="test-acc-1", content=_make_content())],
                    ),
                    workspace_id="workspace_001",
                    brand_id="brand_001",
                    db=session,
                )

    @pytest.mark.asyncio
    async def test_schedule_creates_pending_post(self):
        """Scheduled post is created with status=pending."""
        maker = _make_session()
        future = datetime.now(UTC).replace(hour=23, minute=59, second=0, microsecond=0)

        async with maker() as session:
            await _seed_account(session)

        async with maker() as session:
            service = PublisherService()
            result = await service.schedule(
                request=PublishRequest(
                    idempotency_key="sched-test",
                    scheduled_at=future,
                    targets=[
                        PublishTarget(account_id="test-acc-1", content=_make_content("Future"))
                    ],
                ),
                workspace_id="workspace_001",
                brand_id="brand_001",
                db=session,
            )
        assert result["status"] == "pending"
        assert result["scheduled_at"] is not None

    @pytest.mark.asyncio
    async def test_publish_enqueues_targets_to_worker_not_inline(self, monkeypatch):
        """Queue-first (T067): publish dispatches each target to the worker
        queue and returns immediately — it must NOT call the platform adapter
        synchronously inside the HTTP request.

        Proves the SDR's own queue-first doctrine: the handler creates the job
        and enqueues the targets; ``process_target`` (the Celery worker) does
        the actual publishing. Here the queue dispatch is stubbed so we can
        assert the enqueue happened without executing the worker body.
        """
        maker = _make_session()
        async with maker() as session:
            await _seed_account(session)

        # Record enqueued target ids instead of running the worker body.
        dispatched: list[str] = []
        monkeypatch.setattr(
            "app.services.scheduler_tasks.process_target.delay",
            lambda target_id: dispatched.append(target_id),
        )

        async with maker() as session:
            service = PublisherService()
            result = await service.publish(
                request=PublishRequest(
                    idempotency_key="queue-first-1",
                    targets=[PublishTarget(account_id="test-acc-1", content=_make_content())],
                ),
                workspace_id="workspace_001",
                brand_id="brand_001",
                db=session,
            )

        # Exactly one target was enqueued (no inline adapter call).
        assert len(dispatched) == 1
        # The job is accepted but NOT synchronously published — the worker
        # publishes it. Status is "publishing" (in-flight: targets pending,
        # worker will claim them) rather than the old synchronous "published".
        assert result["status"] == "publishing"

        # The target row exists and is still pending (worker hasn't run).
        from app.models import PostTarget

        async with maker() as session:
            stmt = select(PostTarget).where(PostTarget.post_id == result["job_id"])
            target = (await session.execute(stmt)).scalars().first()
        assert target is not None
        assert target.status == "pending"


class TestInstagramPublishComposite:
    """Instagram account_id composite (ig_user_id|token) reaches the adapter.

    The publisher builds ``{ig_user_id}|{token}`` from account metadata
    (T017), and the InstagramAdapter parses it back for the endpoint path.
    """

    @pytest.mark.asyncio
    @pytest.mark.respx
    async def test_instagram_composite_and_publish(self):
        import httpx
        import respx

        from app.adapters import register_default_adapters

        register_default_adapters()
        maker = _make_session()

        # Seed an instagram account with ig_user_id in metadata.
        async with maker() as session:
            from cryptography.fernet import Fernet

            cipher = Fernet(os.environ["FERNET_KEY"].encode())
            acc = Account(
                id="ig-acc-1",
                workspace_id="workspace_001",
                brand_id="brand_001",
                platform="instagram",
                platform_account_id="ig_123",
                platform_username="raval.ai",
                encrypted_access_token=cipher.encrypt(b"page_token"),
                status="active",
                metadata_fields={"ig_user_id": "ig_123", "page_id": "page_111", "persona": "page"},
                created_at=datetime.now(UTC),
                updated_at=datetime.now(UTC),
            )
            session.add(acc)
            await session.commit()

        # Mock the two-stage Meta publish (media -> media_publish -> permalink).
        with respx.mock:
            respx.post(url__regex=r"https://graph\.facebook\.com/v18\.0/ig_123/media$").mock(
                return_value=httpx.Response(200, json={"id": "creation_abc"})
            )
            respx.post(url__regex=r"https://graph\.facebook\.com/v18\.0/ig_123/media_publish").mock(
                return_value=httpx.Response(200, json={"id": "media_789"})
            )
            respx.get(url__regex=r"https://graph\.facebook\.com/v18\.0/media_789").mock(
                return_value=httpx.Response(
                    200, json={"permalink": "https://www.instagram.com/p/ABC123/"}
                )
            )

            # Queue-first (T067): publish() enqueues; the worker performs the
            # Meta two-stage publish with the ig_user_id|token composite.
            async with maker() as session:
                service = PublisherService()
                result = await service.publish(
                    request=PublishRequest(
                        idempotency_key="ig-composite-test",
                        scheduled_at=None,
                        targets=[
                            PublishTarget(
                                account_id="ig-acc-1",
                                content={
                                    "text": "Hello Instagram!",
                                    "media_urls": ["https://example.com/img.jpg"],
                                    "metadata": {},
                                },
                            )
                        ],
                    ),
                    workspace_id="workspace_001",
                    brand_id="brand_001",
                    db=session,
                )
                assert result["status"] == "publishing"

                # Drive the worker (in a thread: it uses asyncio.run internally).
                from app.models import PostTarget
                from app.services.scheduler_tasks import process_target

                rows = (
                    await session.execute(
                        select(PostTarget).where(PostTarget.post_id == result["job_id"])
                    )
                ).scalars().all()
                assert len(rows) == 1
                target_id = rows[0].id  # capture before rollback expires the instance
                await asyncio.to_thread(process_target.apply, args=[target_id])
                await session.rollback()  # drop stale snapshot; worker committed sync-side

                # Reload the target for its terminal state.
                refreshed = (
                    await session.execute(
                        select(PostTarget).where(PostTarget.id == target_id)
                    )
                ).scalars().first()
                assert refreshed.status == "published"
                assert refreshed.platform_post_id == "media_789"
                assert refreshed.platform_post_url == "https://www.instagram.com/p/ABC123/"

    @pytest.mark.asyncio
    @pytest.mark.respx
    async def test_facebook_composite_and_publish(self):
        """Facebook account_id composite (page_id|token) reaches the adapter."""
        import httpx
        import respx

        from app.adapters import register_default_adapters

        register_default_adapters()
        maker = _make_session()

        async with maker() as session:
            from cryptography.fernet import Fernet

            cipher = Fernet(os.environ["FERNET_KEY"].encode())
            acc = Account(
                id="fb-acc-1",
                workspace_id="workspace_001",
                brand_id="brand_001",
                platform="facebook",
                platform_account_id="page_111",
                platform_username="raval_ai",
                encrypted_access_token=cipher.encrypt(b"page_token"),
                status="active",
                metadata_fields={"page_id": "page_111", "persona": "page"},
                created_at=datetime.now(UTC),
                updated_at=datetime.now(UTC),
            )
            session.add(acc)
            await session.commit()

        with respx.mock:
            respx.post(url__regex=r"https://graph\.facebook\.com/v18\.0/page_111/feed").mock(
                return_value=httpx.Response(200, json={"id": "page_111_456"})
            )

            # Queue-first (T067): publish() enqueues; the worker performs the
            # Facebook publish with the page_id|token composite.
            async with maker() as session:
                service = PublisherService()
                result = await service.publish(
                    request=PublishRequest(
                        idempotency_key="fb-composite-test",
                        scheduled_at=None,
                        targets=[
                            PublishTarget(
                                account_id="fb-acc-1",
                                content={
                                    "text": "Hello Facebook!",
                                    "media_urls": [],
                                    "metadata": {},
                                },
                            )
                        ],
                    ),
                    workspace_id="workspace_001",
                    brand_id="brand_001",
                    db=session,
                )
                assert result["status"] == "publishing"

                from app.models import PostTarget
                from app.services.scheduler_tasks import process_target

                rows = (
                    await session.execute(
                        select(PostTarget).where(PostTarget.post_id == result["job_id"])
                    )
                ).scalars().all()
                assert len(rows) == 1
                target_id = rows[0].id  # capture before rollback expires the instance
                await asyncio.to_thread(process_target.apply, args=[target_id])
                await session.rollback()  # drop stale snapshot; worker committed sync-side

                refreshed = (
                    await session.execute(
                        select(PostTarget).where(PostTarget.id == target_id)
                    )
                ).scalars().first()
                assert refreshed.status == "published"
                assert refreshed.platform_post_id == "page_111_456"

    @pytest.mark.asyncio
    async def test_instagram_missing_ig_user_id_fails_cleanly(self):
        """An instagram account missing ig_user_id metadata fails, not hangs."""
        maker = _make_session()
        from cryptography.fernet import Fernet

        cipher = Fernet(os.environ["FERNET_KEY"].encode())
        acc = Account(
            id="ig-acc-2",
            workspace_id="workspace_001",
            brand_id="brand_001",
            platform="instagram",
            platform_account_id="ig_456",
            platform_username="broken",
            encrypted_access_token=cipher.encrypt(b"page_token"),
            status="active",
            metadata_fields={},  # no ig_user_id
            created_at=datetime.now(UTC),
            updated_at=datetime.now(UTC),
        )
        async with maker() as session:
            session.add(acc)
            await session.commit()

        async with maker() as session:
            service = PublisherService()
            result = await service.publish(
                request=PublishRequest(
                    idempotency_key="ig-missing-metadata",
                    scheduled_at=None,
                    targets=[
                        PublishTarget(
                            account_id="ig-acc-2",
                            content={
                                "text": "x",
                                "media_urls": ["https://example.com/i.jpg"],
                                "metadata": {},
                            },
                        )
                    ],
                ),
                workspace_id="workspace_001",
                brand_id="brand_001",
                db=session,
            )
            assert result["status"] == "publishing"  # queue-first: accepted

            # The missing-ig_user_id failure surfaces in the WORKER, not publish().
            from app.models import PostTarget
            from app.services.scheduler_tasks import process_target

            rows = (
                await session.execute(
                    select(PostTarget).where(PostTarget.post_id == result["job_id"])
                )
            ).scalars().all()
            assert len(rows) == 1
            target_id = rows[0].id  # capture before rollback expires the instance
            await asyncio.to_thread(process_target.apply, args=[target_id])
            await session.rollback()  # drop stale snapshot; worker committed sync-side

            refreshed = (
                await session.execute(
                    select(PostTarget).where(PostTarget.id == target_id)
                )
            ).scalars().first()
            assert refreshed.status in ("failed", "retrying")
            assert refreshed.error_category in ("transient", "fatal")
