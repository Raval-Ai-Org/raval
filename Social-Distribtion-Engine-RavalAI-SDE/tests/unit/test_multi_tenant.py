"""Phase 9 — multi-tenancy & engine-dogfooding regression tests (async half).

Uses the shared test SQLite database (conftest) and exercises the fixes from
``tasks.md`` Phase 9:
- T057/T060  publisher decrypts the real token + passes author_urn; webhooks fire
- T061        job responses report the real platform (not hardcoded "dryrun")
- T062        duplicate idempotency_key → 409
- T063        workspace-scoped account lookups
- T064        per-workspace API-key auth
- T058/T059  OAuth scope/PKCE correctness
- T066        durable OAuth state store
"""

from __future__ import annotations

import asyncio
import hashlib
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select

from app.adapters.base import ADAPTER_REGISTRY, BaseAdapter, PublishResult, PublishStatus
from app.models import Account, ApiKey
from app.security import encrypt_token
from app.services.publisher import DuplicatePostError, PublisherService


@pytest.fixture
def auth_header() -> dict:
    """Authorization header using the global ops token (dev path)."""
    from app.config import get_settings

    return {"Authorization": f"Bearer {get_settings().SDE_API_TOKEN}"}


async def _seed_account(
    db,
    *,
    account_id: str,
    workspace_id: str = "workspace_001",
    platform: str = "dryrun",
    token_value: str | None = None,
    author_urn: str | None = None,
) -> Account:
    """Seed an account row with an encrypted token and optional identity."""
    now = datetime.now(UTC)
    metadata = {"author_urn": author_urn} if author_urn else None
    acc = Account(
        id=account_id,
        workspace_id=workspace_id,
        brand_id="brand_001",
        platform=platform,
        platform_account_id=f"platform_{account_id}",
        platform_username=f"user_{account_id}",
        encrypted_access_token=encrypt_token(token_value or f"secret-{account_id}"),
        status="active",
        metadata_fields=metadata,
        created_at=now,
        updated_at=now,
    )
    db.add(acc)
    await db.commit()
    return acc


class _AsyncRecordingAdapter(BaseAdapter):
    """Adapter that records what it received and reports a successful publish."""

    calls: list[tuple] = []

    def __init__(self) -> None:
        super().__init__(platform="fakeplat")

    async def publish(self, content, account_id, author_urn=None):  # type: ignore[no-untyped-def]  # noqa: ARG002
        type(self).calls.append((account_id, author_urn))
        return PublishResult(
            status=PublishStatus.PUBLISHED,
            platform_post_id="pub_123",
            attempts=1,
        )

    def validate_content(self, content) -> None:  # type: ignore[no-untyped-def]  # noqa: ARG002
        return None


class TestPublisherTokenWiring:
    """T057 — the immediate path decrypts the token and passes author identity."""

    @pytest.mark.asyncio
    async def test_publisher_passes_decrypted_token_and_author_urn(self, db_session):
        ADAPTER_REGISTRY.register("fakeplat", _AsyncRecordingAdapter)
        await _seed_account(
            db_session,
            account_id="acc-token-1",
            platform="fakeplat",
            token_value="real-secret-token",
            author_urn="urn:li:person:abc123",
        )
        _AsyncRecordingAdapter.calls.clear()

        service = PublisherService()
        from app.schemas import PublishRequest, PublishTarget

        req = PublishRequest(
            idempotency_key="ik-token-1",
            targets=[
                PublishTarget(
                    account_id="acc-token-1",
                    content={"text": "hi", "media_urls": [], "metadata": {}},
                )
            ],
        )
        result = await service.publish(
            request=req, workspace_id="workspace_001", brand_id="brand_001", db=db_session
        )

        # Queue-first (T067): publish() only enqueues — the adapter is NOT
        # called inline. Find the enqueued target and drive the worker, which
        # decrypts the token + passes author identity.
        assert result["status"] == "publishing"

        from app.models import PostTarget
        from app.services.scheduler_tasks import process_target

        rows = (
            await db_session.execute(
                select(PostTarget).where(PostTarget.post_id == result["job_id"])
            )
        ).scalars().all()
        assert len(rows) == 1

        await asyncio.to_thread(process_target.apply, args=[rows[0].id])
        await db_session.rollback()  # drop stale snapshot; worker committed via sync session

        assert _AsyncRecordingAdapter.calls, "adapter.publish was never called"
        token_arg, author_urn_arg = _AsyncRecordingAdapter.calls[0]
        assert token_arg == "real-secret-token", (
            "decrypted token must be passed, not platform_account_id"
        )
        assert author_urn_arg == "urn:li:person:abc123"


class TestWorkspaceScoping:
    """T063 — account lookups are workspace-scoped (tenant isolation)."""

    @pytest.mark.asyncio
    async def test_account_from_other_workspace_is_rejected(self, db_session):
        await _seed_account(db_session, account_id="acc-ws-1", workspace_id="workspace_001")

        service = PublisherService()
        from app.schemas import PublishRequest, PublishTarget

        req = PublishRequest(
            idempotency_key="ik-ws-1",
            targets=[
                PublishTarget(
                    account_id="acc-ws-1",
                    content={"text": "x", "media_urls": [], "metadata": {}},
                )
            ],
        )
        with pytest.raises(ValueError, match="not found in this workspace"):
            await service.publish(
                request=req, workspace_id="workspace_999", brand_id="brand_001", db=db_session
            )


class TestJobPlatformResolution:
    """T061 — job responses report the real platform, never hardcoded "dryrun"."""

    @pytest.mark.asyncio
    async def test_scheduled_job_reports_linkedin_platform(self, db_session):
        await _seed_account(
            db_session,
            account_id="acc-li-1",
            platform="linkedin",
            author_urn="urn:li:person:xyz",
        )
        service = PublisherService()
        from app.schemas import PublishRequest, PublishTarget

        future = datetime.now(UTC) + timedelta(hours=1)
        req = PublishRequest(
            idempotency_key="ik-li-1",
            scheduled_at=future,
            targets=[
                PublishTarget(
                    account_id="acc-li-1",
                    content={"text": "scheduled", "media_urls": [], "metadata": {}},
                )
            ],
        )
        result = await service.schedule(
            request=req, workspace_id="workspace_001", brand_id="brand_001", db=db_session
        )
        assert result["targets"][0]["platform"] == "linkedin"
        assert result["targets"][0]["platform"] != "dryrun"


class TestIdempotencyConflict:
    """T062 — duplicate idempotency_key races surface as HTTP 409."""

    @pytest.mark.asyncio
    async def test_duplicate_post_error_maps_to_409(self, monkeypatch, async_client, auth_header):
        from app.api import publish as publish_api

        async def _raise_duplicate(*args, **kwargs):  # noqa: ARG001
            raise DuplicatePostError("Duplicate idempotency_key: dup")

        monkeypatch.setattr(publish_api.PublisherService, "publish", _raise_duplicate)

        payload = {
            "idempotency_key": "dup-race",
            "targets": [{"account_id": "whatever", "content": {"text": "hi"}}],
        }
        resp = await async_client.post("/api/v1/publish", json=payload, headers=auth_header)
        assert resp.status_code == 409, f"expected 409, got {resp.status_code}: {resp.text}"


class TestApiKeyAuth:
    """T064 — per-workspace API keys resolve the authenticated workspace."""

    @staticmethod
    def _make_key(workspace_id: str) -> str:
        return f"key-{workspace_id}-{hashlib.sha256(workspace_id.encode()).hexdigest()}"

    @staticmethod
    def _hash(raw: str) -> str:
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()

    @pytest.mark.asyncio
    async def test_api_key_scopes_accounts_to_workspace(self, db_session, async_client):
        key_a = self._make_key("workspace_A")
        key_b = self._make_key("workspace_B")
        now = datetime.now(UTC)

        db_session.add(
            ApiKey(
                id="ak-a",
                workspace_id="workspace_A",
                brand_id="brand_A",
                key_hash=self._hash(key_a),
                label="wsA",
                created_at=now,
            )
        )
        db_session.add(
            ApiKey(
                id="ak-b",
                workspace_id="workspace_B",
                brand_id="brand_B",
                key_hash=self._hash(key_b),
                label="wsB",
                created_at=now,
            )
        )
        await db_session.commit()
        # An account that only workspace_A may see.
        await _seed_account(db_session, account_id="acc-ak-1", workspace_id="workspace_A")

        resp_a = await async_client.get(
            "/api/v1/accounts", headers={"Authorization": f"Bearer {key_a}"}
        )
        assert resp_a.status_code == 200
        ids_a = [a["account_id"] for a in resp_a.json()]
        assert "acc-ak-1" in ids_a

        resp_b = await async_client.get(
            "/api/v1/accounts", headers={"Authorization": f"Bearer {key_b}"}
        )
        assert resp_b.status_code == 200
        ids_b = [a["account_id"] for a in resp_b.json()]
        assert "acc-ak-1" not in ids_b, "workspace B must not see workspace A's account"

        resp_bad = await async_client.get(
            "/api/v1/accounts", headers={"Authorization": "Bearer not-a-real-key"}
        )
        assert resp_bad.status_code == 401


class TestOAuthScopes:
    """T058/T059 — OAuth URLs carry verified scopes and real PKCE."""

    @pytest.mark.asyncio
    async def test_linkedin_oauth_uses_verified_openid_scopes(self, async_client, auth_header):
        resp = await async_client.get("/api/v1/oauth/linkedin/start", headers=auth_header)
        assert resp.status_code == 200
        url = resp.json()["authorization_url"]
        assert "openid" in url
        assert "profile" in url
        assert "email" in url
        assert "w_member_social" in url
        assert "r_liteprofile" not in url, "deprecated scope must be gone"

    @pytest.mark.asyncio
    async def test_twitter_oauth_uses_real_pkce(self, async_client, auth_header):
        resp = await async_client.get("/api/v1/oauth/twitter/start", headers=auth_header)
        assert resp.status_code == 200
        url = resp.json()["authorization_url"]
        assert "code_challenge=" in url
        assert "code_challenge_method=S256" in url


class TestOAuthStateStore:
    """T066 — OAuth state persists durably (Redis-backed, in-memory fallback)."""

    @pytest.mark.asyncio
    async def test_state_roundtrip_and_consume(self):
        from app.api.accounts import _pop_oauth_state, _save_oauth_state

        state_hash = hashlib.sha256(b"state-token").hexdigest()
        payload = {"platform": "linkedin", "workspace_id": "workspace_001"}

        _save_oauth_state(state_hash, payload)
        popped = _pop_oauth_state(state_hash)
        assert popped == payload
        # Consumed exactly once.
        assert _pop_oauth_state(state_hash) is None
