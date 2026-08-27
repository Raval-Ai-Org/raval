"""Tests for the OAuth connect flow and Meta identity resolution.

Covers the authorize-only contract (US1) and the Meta-specific identity
resolution introduced by the instagram-adapter feature (US2/US3):

1. US1 — start/callback responses never expose credentials (FR-012/FR-MT-08).
2. US2 — facebook connect resolves a Page, not /me (metadata + Page token).
3. US3 — instagram connect resolves the IG account from the linked Page.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import httpx
import pytest
import respx

from app.api.accounts import (
    _resolve_instagram_account,
    _resolve_meta_identity,
    _resolve_primary_page,
)
from app.schemas import AccountResponse

# ─── US1: authorize-only — no credentials in any response (FR-012) ───────


class TestAuthorizeOnlyContract:
    """US1 — the connect contract never exposes credentials (FR-MT-08)."""

    def test_account_response_never_contains_credentials(self):
        """The public AccountResponse schema must not serialize token fields.

        ``token_expires_at`` is an expiry timestamp (not a secret) and is
        intentionally excluded from the "must not leak" check.
        """
        field_names = set(AccountResponse.model_fields)
        secrets = {"access_token", "refresh_token", "client_secret", "app_secret"}
        leaked = {name for name in field_names if any(s in name for s in secrets)}
        assert not leaked, f"Credential-like field leaked into AccountResponse: {leaked}"

    def test_account_response_has_only_expected_fields(self):
        """Authorize-only contract: identity + status only, no secrets."""
        assert set(AccountResponse.model_fields) == {
            "account_id",
            "workspace_id",
            "platform",
            "platform_account_id",
            "platform_username",
            "status",
            "token_expires_at",
            "created_at",
            "updated_at",
        }


# ─── US2: Facebook Page resolution ───────────────────────────────────────


class TestResolvePrimaryPage:
    """US2 — facebook connect must resolve a Page, not /me."""

    @respx.mock
    @pytest.mark.asyncio
    async def test_resolves_first_page(self):
        respx.get(url__regex=r"https://graph\.facebook\.com/v18\.0/me/accounts").mock(
            return_value=httpx.Response(
                200,
                json={
                    "data": [
                        {"id": "page_111", "name": "RavalAI", "access_token": "page_token_1"},
                        {"id": "page_222", "name": "Other", "access_token": "page_token_2"},
                    ]
                },
            )
        )
        page_id, page_name, page_token = await _resolve_primary_page("user_token")
        assert page_id == "page_111"
        assert page_name == "RavalAI"
        assert page_token == "page_token_1"

    @respx.mock
    @pytest.mark.asyncio
    async def test_no_page_raises(self):
        respx.get(url__regex=r"https://graph\.facebook\.com/v18\.0/me/accounts").mock(
            return_value=httpx.Response(200, json={"data": []})
        )
        with pytest.raises(ValueError, match="No Facebook Page found"):
            await _resolve_primary_page("user_token")


# ─── US3: Instagram identity resolution off the linked Page ──────────────


class TestResolveInstagramAccount:
    """US3 — IG user id resolves from the linked Page."""

    @respx.mock
    @pytest.mark.asyncio
    async def test_resolves_linked_ig_account(self):
        respx.get(url__regex=r"https://graph\.facebook\.com/v18\.0/page_111\?").mock(
            return_value=httpx.Response(
                200,
                json={"id": "page_111", "instagram_business_account": {"id": "ig_999"}},
            )
        )
        respx.get(url__regex=r"https://graph\.facebook\.com/v18\.0/ig_999\?").mock(
            return_value=httpx.Response(200, json={"username": "raval.ai"})
        )
        ig_id, ig_username = await _resolve_instagram_account("page_111", "page_token")
        assert ig_id == "ig_999"
        assert ig_username == "raval.ai"

    @respx.mock
    @pytest.mark.asyncio
    async def test_no_linked_ig_raises(self):
        respx.get(url__regex=r"https://graph\.facebook\.com/v18\.0/page_111\?").mock(
            return_value=httpx.Response(
                200,
                json={"id": "page_111"},  # no instagram_business_account
            )
        )
        with pytest.raises(ValueError, match="Professional account linked to a Facebook Page"):
            await _resolve_instagram_account("page_111", "page_token")


# ─── Meta identity resolution for the connect callback ───────────────────


class TestResolveMetaIdentity:
    """US2/US3 — connect resolves the durable Page/IG identity + Page token."""

    @staticmethod
    def _settings():
        return SimpleNamespace(
            FACEBOOK_CLIENT_ID="app_id",
            FACEBOOK_CLIENT_SECRET="app_secret",
        )

    @respx.mock
    @pytest.mark.asyncio
    async def test_facebook_resolves_page_identity(self):
        # long-lived exchange
        respx.get(url__regex=r"https://graph\.facebook\.com/v18\.0/oauth/access_token").mock(
            return_value=httpx.Response(200, json={"access_token": "long_token"})
        )
        # page list
        respx.get(url__regex=r"https://graph\.facebook\.com/v18\.0/me/accounts").mock(
            return_value=httpx.Response(
                200,
                json={
                    "data": [{"id": "page_111", "name": "RavalAI", "access_token": "page_token_1"}]
                },
            )
        )
        profile, token, metadata = await _resolve_meta_identity(
            "facebook", "short_token", self._settings()
        )
        assert profile["id"] == "page_111"
        assert profile["name"] == "RavalAI"
        assert token == "page_token_1"
        assert metadata == {"page_id": "page_111", "persona": "page"}

    @respx.mock
    @pytest.mark.asyncio
    async def test_instagram_resolves_ig_identity(self):
        respx.get(url__regex=r"https://graph\.facebook\.com/v18\.0/oauth/access_token").mock(
            return_value=httpx.Response(200, json={"access_token": "long_token"})
        )
        respx.get(url__regex=r"https://graph\.facebook\.com/v18\.0/me/accounts").mock(
            return_value=httpx.Response(
                200,
                json={
                    "data": [{"id": "page_111", "name": "RavalAI", "access_token": "page_token_1"}]
                },
            )
        )
        respx.get(url__regex=r"https://graph\.facebook\.com/v18\.0/page_111\?").mock(
            return_value=httpx.Response(
                200,
                json={"id": "page_111", "instagram_business_account": {"id": "ig_999"}},
            )
        )
        respx.get(url__regex=r"https://graph\.facebook\.com/v18\.0/ig_999\?").mock(
            return_value=httpx.Response(200, json={"username": "raval.ai"})
        )
        profile, token, metadata = await _resolve_meta_identity(
            "instagram", "short_token", self._settings()
        )
        assert profile["id"] == "ig_999"
        assert profile["username"] == "raval.ai"
        assert token == "page_token_1"
        assert metadata == {"ig_user_id": "ig_999", "page_id": "page_111", "persona": "page"}


# ─── T068: post-connect redirect (redirect_after) ─────────────────────────


class TestRedirectAfter:
    """T068 — the OAuth callback bounces the browser back to a TRUSTED origin
    when redirect_after was set at start; otherwise returns JSON (unchanged)."""

    @pytest.fixture
    def auth_header(self) -> dict:
        from app.config import get_settings

        settings = get_settings()
        return {"Authorization": f"Bearer {settings.SDE_API_TOKEN}"}

    def test_allowed_redirect_guard(self):
        from app.api.accounts import _is_allowed_redirect

        assert _is_allowed_redirect("https://raval.it.com/app") is True
        assert _is_allowed_redirect("http://localhost:3000/app?x=1") is True
        assert _is_allowed_redirect("https://evil.example.com/phish") is False
        assert _is_allowed_redirect("javascript:alert(1)") is False

    @pytest.mark.asyncio
    @patch("app.api.accounts._fetch_user_profile", new_callable=AsyncMock, return_value={"id": "u1", "username": "tester"})
    @patch("app.api.accounts._exchange_code_for_token", new_callable=AsyncMock, return_value={"access_token": "tok"})
    async def test_callback_redirects_to_redirect_after(
        self, mock_exchange, mock_profile, async_client, auth_header
    ):
        from unittest.mock import patch  # noqa: F811  (kept for clarity)

        start = await async_client.get(
            "/api/v1/oauth/twitter/start?redirect_after=https://raval.it.com/app",
            headers=auth_header,
        )
        assert start.status_code == 200, start.text
        state_token = start.json()["state_token"]

        cb = await async_client.get(
            f"/api/v1/oauth/twitter/callback?code=xyz&state={state_token}",
            headers=auth_header,
        )
        assert cb.status_code == 302, cb.text
        assert cb.headers["location"].startswith("https://raval.it.com/app?platform=twitter")

    @pytest.mark.asyncio
    @patch("app.api.accounts._fetch_user_profile", new_callable=AsyncMock, return_value={"id": "u2", "username": "t2"})
    @patch("app.api.accounts._exchange_code_for_token", new_callable=AsyncMock, return_value={"access_token": "tok"})
    async def test_callback_without_redirect_after_returns_json(
        self, mock_exchange, mock_profile, async_client, auth_header
    ):
        start = await async_client.get("/api/v1/oauth/twitter/start", headers=auth_header)
        state_token = start.json()["state_token"]

        cb = await async_client.get(
            f"/api/v1/oauth/twitter/callback?code=xyz&state={state_token}",
            headers=auth_header,
        )
        assert cb.status_code == 200, cb.text
        assert "account_id" in cb.json()  # unchanged JSON contract

    @pytest.mark.asyncio
    async def test_start_rejects_untrusted_redirect_after(self, async_client, auth_header):
        start = await async_client.get(
            "/api/v1/oauth/twitter/start?redirect_after=https://evil.example.com",
            headers=auth_header,
        )
        assert start.status_code == 400
