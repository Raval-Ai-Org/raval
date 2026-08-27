"""Unit tests for webhook_out.py — HMAC signing, delivery, retry logic.

TDD tests covering:
1. Signed webhook delivery to configured endpoints
2. No webhooks configured (graceful no-op)
3. Timeout handling
4. Connection error handling
5. HTTP error responses
6. Delivery log recording (both success and failure)
"""

from __future__ import annotations

import os
import tempfile
from datetime import UTC, datetime

import httpx
import pytest
import respx
from sqlalchemy import text

# Set environment BEFORE app imports
with tempfile.NamedTemporaryFile(suffix=".test.db", delete=False) as _db_file:
    _TEST_DB = _db_file.name
os.environ["ENV"] = "testing"
os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{_TEST_DB}"
os.environ["DATABASE_URL_SYNC"] = f"sqlite:///{_TEST_DB}"
os.environ["SDE_API_TOKEN"] = "test-token-min-16chars"
os.environ["SDE_SIGNING_SECRET"] = "test-signing-secret-32-bytes-long-req"

from app.database import get_sync_engine, get_sync_session_maker
from app.models import Base, WebhookEndpoint
from app.security import sign_request
from app.services.webhook_out import WebhookService

WEBHOOK_URL = "http://example.com/webhook"


@pytest.fixture(autouse=True)
def setup_db():
    """Create tables on the app's single SQLite engine."""
    engine = get_sync_engine()
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)


def _seed_webhook(
    workspace_id: str = "workspace_001",
    url: str = WEBHOOK_URL,
    secret: str = "test-secret",
    wh_id: str = "wh-test-1",
) -> str:
    """Helper: seed a webhook endpoint using the app's session maker."""
    maker = get_sync_session_maker()
    with maker() as session:
        wh = WebhookEndpoint(
            id=wh_id,
            workspace_id=workspace_id,
            url=url,
            secret=secret,
            status="active",
            created_at=datetime.now(UTC),
            updated_at=datetime.now(UTC),
        )
        session.add(wh)
        session.commit()
    return wh_id


# ─── Tests ────────────────────────────────────────────────────────────


class TestWebhookService:
    """Tests for WebhookService."""

    def test_deliver_event_sends_signed_payload(self):
        """Webhook receives HMAC-signed payload with correct headers."""
        _seed_webhook()
        sent_headers = {}

        with respx.mock:

            def verify(request):
                sent_headers["signature"] = request.headers.get("X-Signature-256", "")
                sent_headers["event_type"] = request.headers.get("X-Event-Type", "")
                sent_headers["content_type"] = request.headers.get("Content-Type", "")
                sent_headers["body"] = request.content
                return httpx.Response(200)

            respx.post(WEBHOOK_URL).mock(side_effect=verify)

            service = WebhookService()
            results = service.deliver_event(
                workspace_id="workspace_001",
                event_type="post.published",
                payload={"post_id": "abc123", "status": "published"},
            )

        assert len(results) == 1
        assert results[0]["status"] == "delivered"
        assert results[0]["status_code"] == 200
        assert sent_headers["signature"] != ""
        assert sent_headers["event_type"] == "post.published"
        assert sent_headers["content_type"] == "application/json"

        # Verify signature is cryptographically correct
        body = sent_headers["body"]
        computed = sign_request(method="POST", path="/webhook", body=body, secret="test-secret")
        assert sent_headers["signature"] == computed

    def test_no_active_webhooks_returns_empty_list(self):
        """No webhooks for workspace → empty list, no crash."""
        # Seed a webhook for a DIFFERENT workspace
        _seed_webhook(workspace_id="other_workspace", wh_id="wh-other")

        service = WebhookService()
        results = service.deliver_event(
            workspace_id="workspace_001",
            event_type="post.published",
            payload={"post_id": "123"},
        )

        assert results == []

    def test_disabled_webhooks_ignored(self):
        """Disabled webhooks are not called."""
        maker = get_sync_session_maker()
        with maker() as session:
            session.add(
                WebhookEndpoint(
                    id="wh-disabled",
                    workspace_id="workspace_001",
                    url=WEBHOOK_URL,
                    secret="s",
                    status="disabled",
                    created_at=datetime.now(UTC),
                    updated_at=datetime.now(UTC),
                )
            )
            session.commit()

        service = WebhookService()
        results = service.deliver_event(
            workspace_id="workspace_001",
            event_type="post.published",
            payload={"post_id": "123"},
        )

        assert results == []

    def test_timeout_recorded_gracefully(self):
        """Timeout → result shows 'timeout' status, no crash."""
        _seed_webhook()

        with respx.mock:
            respx.post(WEBHOOK_URL).mock(side_effect=httpx.TimeoutException("timed out"))

            service = WebhookService()
            results = service.deliver_event(
                workspace_id="workspace_001",
                event_type="post.published",
                payload={"post_id": "abc123"},
            )

        assert len(results) == 1
        assert results[0]["status"] == "timeout"
        assert results[0]["status_code"] is None

    def test_connection_error_recorded_gracefully(self):
        """Connection refused → result shows 'error', no crash."""
        _seed_webhook()

        with respx.mock:
            respx.post(WEBHOOK_URL).mock(side_effect=httpx.ConnectError("Connection refused"))

            service = WebhookService()
            results = service.deliver_event(
                workspace_id="workspace_001",
                event_type="post.failed",
                payload={"post_id": "abc123"},
            )

        assert len(results) == 1
        assert results[0]["status"] == "error"
        assert "refused" in results[0].get("error", "").lower()

    def test_http_404_recorded_as_failed(self):
        """404 response → recorded as 'failed', not a crash."""
        _seed_webhook()

        with respx.mock:
            respx.post(WEBHOOK_URL).mock(return_value=httpx.Response(404))

            service = WebhookService()
            results = service.deliver_event(
                workspace_id="workspace_001",
                event_type="post.published",
                payload={"post_id": "abc123"},
            )

        assert len(results) == 1
        assert results[0]["status"] == "failed"
        assert results[0]["status_code"] == 404

    def test_delivery_log_created_on_success(self):
        """Successful delivery creates a DeliveryLog entry."""
        _seed_webhook()

        with respx.mock:
            respx.post(WEBHOOK_URL).mock(return_value=httpx.Response(200))
            service = WebhookService()
            service.deliver_event(
                workspace_id="workspace_001",
                event_type="post.published",
                payload={"post_id": "abc123"},
            )

        engine = get_sync_engine()
        with engine.connect() as conn:
            result = conn.execute(
                text(
                    "SELECT http_status, event_type FROM delivery_logs WHERE event_type = 'webhook.post.published'"
                )
            )
            logs = result.fetchall()
            assert len(logs) == 1
            assert logs[0].http_status == 200  # type: ignore[union-attr]

    def test_delivery_log_created_on_failure(self):
        """Failed delivery creates a DeliveryLog with error info."""
        _seed_webhook()

        with respx.mock:
            respx.post(WEBHOOK_URL).mock(side_effect=httpx.ConnectError("DNS resolution failed"))
            service = WebhookService()
            service.deliver_event(
                workspace_id="workspace_001",
                event_type="post.failed",
                payload={"post_id": "abc123"},
            )

        engine = get_sync_engine()
        with engine.connect() as conn:
            result = conn.execute(
                text(
                    "SELECT http_status, event_type FROM delivery_logs WHERE event_type = 'webhook.post.failed'"
                )
            )
            logs = result.fetchall()
            assert len(logs) == 1
            assert logs[0].http_status is None  # type: ignore[union-attr]


class TestWebhookRetries:
    """T070 — transient webhook failures are retried up to MAX_RETRIES; 4xx and
    2xx are not. (Backoff patched to 0 for fast tests.)"""

    @pytest.fixture(autouse=True)
    def no_backoff(self, monkeypatch):
        monkeypatch.setattr(WebhookService, "_retry_delay", staticmethod(lambda attempt: 0.0))

    def test_retries_transient_5xx_then_succeeds(self):
        _seed_webhook()
        with respx.mock:
            route = respx.post(WEBHOOK_URL)
            route.mock(side_effect=[httpx.Response(503), httpx.Response(200, json={"ok": True})])
            service = WebhookService()
            results = service.deliver_event(workspace_id="workspace_001", event_type="post.published", payload={"post_id": "abc"})
        assert route.call_count == 2  # 503 → retried → 200
        assert results[0]["status"] == "delivered"
        assert results[0]["status_code"] == 200

    def test_no_retry_on_permanent_4xx(self):
        _seed_webhook()
        with respx.mock:
            route = respx.post(WEBHOOK_URL)
            route.mock(return_value=httpx.Response(404))
            service = WebhookService()
            results = service.deliver_event(workspace_id="workspace_001", event_type="post.published", payload={"post_id": "abc"})
        assert route.call_count == 1  # 4xx is permanent — no retry
        assert results[0]["status"] == "failed"
        assert results[0]["status_code"] == 404

    def test_exhausts_retries_on_persistent_5xx(self):
        _seed_webhook()
        with respx.mock:
            route = respx.post(WEBHOOK_URL)
            route.mock(return_value=httpx.Response(503))
            service = WebhookService()
            results = service.deliver_event(workspace_id="workspace_001", event_type="post.failed", payload={"post_id": "abc"})
        assert route.call_count == 3  # MAX_RETRIES attempts
        assert results[0]["status"] == "failed"
        assert results[0]["status_code"] == 503

    def test_success_is_not_retried(self):
        _seed_webhook()
        with respx.mock:
            route = respx.post(WEBHOOK_URL)
            route.mock(return_value=httpx.Response(200, json={"ok": True}))
            service = WebhookService()
            results = service.deliver_event(workspace_id="workspace_001", event_type="post.published", payload={"post_id": "abc"})
        assert route.call_count == 1
        assert results[0]["status"] == "delivered"
