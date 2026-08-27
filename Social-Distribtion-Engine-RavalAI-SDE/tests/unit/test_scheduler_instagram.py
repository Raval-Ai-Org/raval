"""T069 — Instagram worker + token-refresh fixes (SETUP-ONLY: no live IG).

Two regressions fixed:
1. The worker passed the RAW token to the Instagram adapter (which requires
   ``ig_user_id|access_token``) → every scheduled IG publish failed fatal.
2. ``_refresh_platform_token`` had no Instagram strategy → IG accounts
   auto-expired (the daily refresh marked them expired).

Both are verified here with mocks — no live Instagram account is used.
"""

from __future__ import annotations

import pytest
from datetime import UTC, datetime, timedelta

from app.adapters.base import ADAPTER_REGISTRY, BaseAdapter, PublishResult, PublishStatus
from app.config import get_settings
from app.database import get_sync_engine, get_sync_session_maker
from app.models import Account, Base, DeliveryLog, Post, PostTarget
from app.security import encrypt_token
from app.services import scheduler_tasks
from app.services.scheduler_tasks import _refresh_platform_token


def _clear_rows() -> None:
    maker = get_sync_session_maker()
    with maker() as session:
        session.query(DeliveryLog).delete()
        session.query(PostTarget).delete()
        session.query(Post).delete()
        session.query(Account).delete()
        session.commit()


@pytest.fixture(autouse=True)
def setup_sync_db():
    engine = get_sync_engine()
    Base.metadata.create_all(engine)
    _clear_rows()
    return


def _seed_ig_target(account_id: str, ig_user_id: str, token_value: str) -> str:
    maker = get_sync_session_maker()
    now = datetime.now(UTC)
    with maker() as session:
        acc = Account(
            id=account_id,
            workspace_id="workspace_001",
            brand_id="brand_001",
            platform="instagram",
            platform_account_id="ig_" + ig_user_id,
            platform_username="user_ig",
            encrypted_access_token=encrypt_token(token_value),
            metadata_fields={"ig_user_id": ig_user_id},
            status="active",
            created_at=now,
            updated_at=now,
        )
        session.add(acc)
        post = Post(
            id=f"post-{account_id}",
            workspace_id="workspace_001",
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
            content={"text": "IG caption", "media_urls": ["https://cdn.example.com/x.jpg"], "metadata": {}},
            attempts=1,
            max_attempts=5,
            created_at=now,
            updated_at=now,
        )
        session.add(target)
        session.commit()
        return target.id


class _RecordingIgAdapter(BaseAdapter):
    """Records the token the worker hands to the IG adapter."""

    calls: list[str] = []

    def __init__(self) -> None:
        super().__init__(platform="instagram")

    async def publish(self, content, account_id, author_urn=None):  # type: ignore[no-untyped-def]  # noqa: ARG002
        type(self).calls.append(account_id)
        return PublishResult(status=PublishStatus.PUBLISHED, platform_post_id="ig_post_1", attempts=1)

    def validate_content(self, content) -> None:  # type: ignore[no-untyped-def]  # noqa: ARG002
        return None


class TestInstagramWorkerTokenFormat:
    def test_worker_passes_ig_user_id_pipe_token_to_adapter(self):
        ADAPTER_REGISTRY.register("instagram", _RecordingIgAdapter)
        target_id = _seed_ig_target("acc-ig-1", "ig_999", "super-secret-token")
        _RecordingIgAdapter.calls.clear()

        result = scheduler_tasks.process_target.apply(args=[target_id]).get()

        assert _RecordingIgAdapter.calls, "IG adapter.publish was never called"
        assert _RecordingIgAdapter.calls[0] == "ig_999|super-secret-token"
        assert result["status"] == "published"

    def test_worker_fails_cleanly_when_ig_user_id_missing(self):
        ADAPTER_REGISTRY.register("instagram", _RecordingIgAdapter)
        maker = get_sync_session_maker()
        now = datetime.now(UTC)
        with maker() as session:
            acc = Account(
                id="acc-ig-missing",
                workspace_id="workspace_001",
                brand_id="brand_001",
                platform="instagram",
                platform_account_id="ig_x",
                platform_username="u",
                encrypted_access_token=encrypt_token("tok"),
                metadata_fields={},  # no ig_user_id
                status="active",
                created_at=now,
                updated_at=now,
            )
            session.add(acc)
            post = Post(id="post-ig-missing", workspace_id="workspace_001", brand_id="brand_001", idempotency_key="ik-m", status="publishing", created_at=now, updated_at=now)
            session.add(post)
            target = PostTarget(id="tgt-ig-missing", post_id=post.id, account_id=acc.id, status="publishing", content={"text": "c", "media_urls": [], "metadata": {}}, attempts=1, max_attempts=5, created_at=now, updated_at=now)
            session.add(target)
            session.commit()
            target_id = target.id

        result = scheduler_tasks.process_target.apply(args=[target_id]).get()
        assert result["status"] == "failed"


class TestInstagramRefreshStrategy:
    def test_refresh_platform_token_handles_instagram(self, monkeypatch):
        """IG refresh must NOT raise 'No refresh strategy' — it uses the Meta grant."""

        captured: dict[str, object] = {}

        def fake_refresh_facebook(account, settings):
            captured["called"] = True
            captured["platform"] = account.platform
            return "new_long_token", None, datetime.now(UTC) + timedelta(days=60)

        monkeypatch.setattr(scheduler_tasks, "_refresh_facebook", fake_refresh_facebook)
        maker = get_sync_session_maker()
        with maker() as session:
            acc = Account(
                id="acc-ig-refresh",
                workspace_id="workspace_001",
                brand_id="brand_001",
                platform="instagram",
                platform_account_id="ig_y",
                platform_username="u",
                encrypted_access_token=encrypt_token("old_token"),
                status="active",
                created_at=datetime.now(UTC),
                updated_at=datetime.now(UTC),
            )
            session.add(acc)
            session.commit()

        token, _refresh, _expires = _refresh_platform_token(acc)
        assert captured.get("called") is True
        assert captured.get("platform") == "instagram"
        assert token == "new_long_token"
