"""Phase 9 — Celery worker publish/refresh regression tests (sync half).

Self-contained SQLite DB (own temp file) because the worker uses the sync
engine. Verifies Phase 9 fixes:
- T056  process_target actually awaits the async adapter publish
- T057  the worker decrypts the real token + passes author_urn
- T063  the worker cannot resolve another workspace's account
- T065  refresh_tokens really refreshes per platform (LinkedIn/X/Meta)
"""

from __future__ import annotations

import os
import tempfile
from datetime import UTC, datetime, timedelta

import pytest

# Set test env BEFORE any app imports (mirrors conftest + test_publisher.py).
with tempfile.NamedTemporaryFile(suffix=".worker.test.db", delete=False) as _db_file:
    _TEST_DB = _db_file.name
os.environ["ENV"] = "testing"
os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{_TEST_DB}"
os.environ["DATABASE_URL_SYNC"] = f"sqlite:///{_TEST_DB}"
os.environ["REDIS_URL"] = "redis://localhost:6379/1"
os.environ["SDE_API_TOKEN"] = "test-token-min-16chars"
os.environ["SDE_SIGNING_SECRET"] = "test-signing-secret-32-bytes-long-req"
os.environ["FERNET_KEY"] = "CjDXFzZ5c5GzBo2kYN-GYlYDYfN9Z5c5GzBo2kYN-GY="

from app.adapters.base import (  # noqa: E402
    ADAPTER_REGISTRY,
    BaseAdapter,
    PublishResult,
    PublishStatus,
)
from app.celery_app import celery_app  # noqa: E402
from app.database import get_sync_engine, get_sync_session_maker  # noqa: E402
from app.models import Account, Base, DeliveryLog, Post, PostTarget  # noqa: E402
from app.security import decrypt_token, encrypt_token  # noqa: E402
from app.services import scheduler_tasks  # noqa: E402

# NOTE: do NOT set task_always_eager globally here. This module calls
# process_target.apply(...) / refresh_tokens.apply(...) directly, which always
# run eagerly and return an EagerResult — no global config needed. A global
# `task_always_eager` mutation would leak into the async integration tests,
# where process_target.delay() inside the HTTP handler would try to run the
# worker body inline (asyncio.run in a running loop) → RuntimeError. Keeping
# the global celery app non-eager is what makes the whole suite order-independent.


def _clear_rows() -> None:
    """Delete this module's rows so tests are isolated in the shared DB.

    Uses unique ids per test, but the refresh task scans ALL active accounts,
    so earlier tests' expiring accounts would bleed into later tests without
    an explicit wipe.
    """
    maker = get_sync_session_maker()
    with maker() as session:
        session.query(DeliveryLog).delete()
        session.query(PostTarget).delete()
        session.query(Post).delete()
        session.query(Account).delete()
        session.commit()


@pytest.fixture(autouse=True)
def setup_sync_db():
    """Ensure worker tables exist and clear rows before each test.

    Uses ``get_sync_engine()`` (the same cached engine the worker's sync
    sessions use). A fresh ``create_engine(env_url)`` would point at a
    different SQLite file in this multi-env harness and cause
    ``no such table`` errors. Tables are NOT dropped here so the shared DB
    stays intact for other test modules.
    """
    engine = get_sync_engine()
    Base.metadata.create_all(engine)
    _clear_rows()
    return


def _seed_target(
    account_id: str,
    platform: str,
    token_value: str,
    author_urn: str | None = None,
    account_workspace: str = "workspace_001",
    post_workspace: str | None = None,
) -> str:
    """Seed an account + post + target and return the target id."""
    maker = get_sync_session_maker()
    now = datetime.now(UTC)
    post_ws = post_workspace or account_workspace
    metadata = {"author_urn": author_urn} if author_urn else None
    with maker() as session:
        acc = Account(
            id=account_id,
            workspace_id=account_workspace,
            brand_id="brand_001",
            platform=platform,
            platform_account_id=f"pid_{account_id}",
            platform_username=f"user_{account_id}",
            encrypted_access_token=encrypt_token(token_value),
            metadata_fields=metadata,
            status="active",
            created_at=now,
            updated_at=now,
        )
        session.add(acc)
        post = Post(
            id=f"post-{account_id}",
            workspace_id=post_ws,
            brand_id="brand_001",
            idempotency_key=f"ik-{account_id}",
            status="publishing",
            created_at=now,
            updated_at=now,
        )
        session.add(post)
        target = PostTarget(
            id=f"tgt-{account_id}",
            post_id=post.id,
            account_id=acc.id,
            status="publishing",
            content={"text": "hello", "media_urls": [], "metadata": {}},
            attempts=1,
            max_attempts=5,
            created_at=now,
            updated_at=now,
        )
        session.add(target)
        session.commit()
        return target.id


class _RecordingAdapter(BaseAdapter):
    """Adapter that records the (token, author_urn) it receives."""

    calls: list[tuple] = []

    def __init__(self) -> None:
        super().__init__(platform="testplat")

    async def publish(self, content, account_id, author_urn=None):  # type: ignore[no-untyped-def]  # noqa: ARG002
        type(self).calls.append((account_id, author_urn))
        return PublishResult(
            status=PublishStatus.PUBLISHED,
            platform_post_id="worker_123",
            attempts=1,
        )

    def validate_content(self, content) -> None:  # type: ignore[no-untyped-def]  # noqa: ARG002
        return None


class TestProcessTarget:
    """T056/T057/T063 — the worker's publish path."""

    def test_awaits_async_publish_with_decrypted_token_and_author(self):
        ADAPTER_REGISTRY.register("testplat", _RecordingAdapter)
        target_id = _seed_target(
            "acc-worker-1", "testplat", "super-secret-token", "urn:li:person:abc"
        )
        _RecordingAdapter.calls.clear()

        result = scheduler_tasks.process_target.apply(args=[target_id]).get()

        # If the coroutine were never awaited, publish would raise
        # AttributeError and the target would end "retrying"/"failed".
        assert _RecordingAdapter.calls, "adapter.publish was never awaited"
        token_arg, author_urn_arg = _RecordingAdapter.calls[0]
        assert token_arg == "super-secret-token"
        assert author_urn_arg == "urn:li:person:abc"

        assert result["status"] == "published"
        maker = get_sync_session_maker()
        with maker() as session:
            target = session.query(PostTarget).filter_by(id=target_id).first()
            assert target.status == "published"
            assert target.platform_post_id == "worker_123"
            # The aggregate post status must be recomputed by the worker too
            # (otherwise a scheduled post stays "pending" after publishing).
            post = session.query(Post).filter_by(id=target.post_id).first()
            assert post.status == "published"
            assert post.published_at is not None

    def test_cannot_resolve_other_workspaces_account(self):
        # Account lives in workspace_001 but the post (and thus target) belongs
        # to workspace_002 → the worker must NOT use the account's credentials.
        target_id = _seed_target(
            "acc-worker-2",
            "testplat",
            "secret",
            account_workspace="workspace_001",
            post_workspace="workspace_002",
        )
        _RecordingAdapter.calls.clear()

        result = scheduler_tasks.process_target.apply(args=[target_id]).get()

        assert result["status"] == "failed"
        assert not _RecordingAdapter.calls, "must not publish with another workspace's token"
        maker = get_sync_session_maker()
        with maker() as session:
            target = session.query(PostTarget).filter_by(id=target_id).first()
            assert target.status == "failed"


class _FakeResponse:
    """Minimal httpx response stand-in for refresh tests."""

    def __init__(self, data: dict) -> None:
        self._data = data

    def raise_for_status(self) -> None:
        return None

    def json(self) -> dict:
        return self._data


def _seed_expiring_account(account_id: str, platform: str, refresh_value: str | None):
    maker = get_sync_session_maker()
    now = datetime.now(UTC)
    with maker() as session:
        acc = Account(
            id=account_id,
            workspace_id="workspace_001",
            brand_id="brand_001",
            platform=platform,
            platform_account_id=f"pid-{account_id}",
            platform_username=f"user-{account_id}",
            encrypted_access_token=encrypt_token("old-access"),
            encrypted_refresh_token=encrypt_token(refresh_value) if refresh_value else None,
            token_expires_at=now + timedelta(days=1),  # within the 7-day window
            status="active",
            created_at=now,
            updated_at=now,
        )
        session.add(acc)
        session.commit()
        return acc.id


class TestRefreshTokens:
    """T065 — real per-platform token refresh (ADR-0003)."""

    def test_linkedin_refresh_updates_tokens(self, monkeypatch):
        acc_id = _seed_expiring_account("acc-refresh-1", "linkedin", "old-refresh")

        monkeypatch.setattr(
            scheduler_tasks.httpx,
            "post",
            lambda *a, **k: _FakeResponse(  # noqa: ARG005
                {
                    "access_token": "new-access",
                    "refresh_token": "new-refresh",
                    "expires_in": 3600,
                }
            ),
        )

        result = scheduler_tasks.refresh_tokens.apply().get()

        assert result["refreshed"] == 1
        maker = get_sync_session_maker()
        with maker() as session:
            acc = session.query(Account).filter_by(id=acc_id).first()
            assert decrypt_token(acc.encrypted_access_token) == "new-access"
            assert decrypt_token(acc.encrypted_refresh_token) == "new-refresh"
            assert acc.status == "active"

    def test_twitter_refresh_updates_tokens(self, monkeypatch):
        acc_id = _seed_expiring_account("acc-refresh-2", "twitter", "old-refresh")

        monkeypatch.setattr(
            scheduler_tasks.httpx,
            "post",
            lambda *a, **k: _FakeResponse(  # noqa: ARG005
                {
                    "access_token": "tw-new-access",
                    "refresh_token": "tw-new-refresh",
                    "expires_in": 7200,
                }
            ),
        )

        result = scheduler_tasks.refresh_tokens.apply().get()

        assert result["refreshed"] == 1
        maker = get_sync_session_maker()
        with maker() as session:
            acc = session.query(Account).filter_by(id=acc_id).first()
            assert decrypt_token(acc.encrypted_access_token) == "tw-new-access"

    def test_refresh_failure_marks_account_expired(self, monkeypatch):
        acc_id = _seed_expiring_account("acc-refresh-3", "linkedin", "old-refresh")

        def _boom(*_args, **_kwargs):
            raise RuntimeError("network down")

        monkeypatch.setattr(scheduler_tasks.httpx, "post", _boom)

        result = scheduler_tasks.refresh_tokens.apply().get()

        assert result["failed"] == 1
        maker = get_sync_session_maker()
        with maker() as session:
            acc = session.query(Account).filter_by(id=acc_id).first()
            assert acc.status == "expired", (
                "unrefreshable account must be surfaced, not silently broken"
            )
