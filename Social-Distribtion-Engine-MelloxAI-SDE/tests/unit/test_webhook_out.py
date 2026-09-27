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

import json
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


class FakeQueue:
    """Stands in for the Celery queue: records each scheduled redelivery and
    runs it only when drained — after the current delivery has returned, the
    same ordering a worker gives (and no nested SQLite sessions)."""

    def __init__(self) -> None:
        self.scheduled: list[tuple[int, float]] = []
        self.pending: list[tuple] = []
        self.redeliveries: list[dict] = []

    def schedule(self, webhook_id, event_type, payload, post_id, post_target_id, attempt, delay):
        self.scheduled.append((attempt, delay))
        self.pending.append((webhook_id, event_type, payload, post_id, post_target_id, attempt))

    def drain(self) -> dict | None:
        """Run queued redeliveries until none remain; return the final outcome."""
        while self.pending:
            self.redeliveries.append(WebhookService().redeliver(*self.pending.pop(0)))
        return self.redeliveries[-1] if self.redeliveries else None


@pytest.fixture(autouse=True)
def queue(monkeypatch) -> FakeQueue:
    q = FakeQueue()
    monkeypatch.setattr(WebhookService, "_schedule_retry", staticmethod(q.schedule))
    return q


def _deliver(event_type: str = "post.published", payload: dict | None = None) -> list[dict]:
    return WebhookService().deliver_event(
        workspace_id="workspace_001",
        event_type=event_type,
        payload=payload or {"post_id": "abc123"},
    )


def _log_rows(event_type: str) -> list:
    engine = get_sync_engine()
    with engine.connect() as conn:
        return conn.execute(
            text("SELECT http_status, event_type FROM delivery_logs WHERE event_type = :e"),
            {"e": event_type},
        ).fetchall()


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
            results = _deliver(payload={"post_id": "abc123", "status": "published"})

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
        _seed_webhook(workspace_id="other_workspace", wh_id="wh-other")
        assert _deliver(payload={"post_id": "123"}) == []

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
        assert _deliver(payload={"post_id": "123"}) == []

    def test_timeout_recorded_gracefully(self, queue: FakeQueue):
        """Timeouts are retried on the queue, then reported as 'timeout'."""
        _seed_webhook()
        with respx.mock:
            respx.post(WEBHOOK_URL).mock(side_effect=httpx.TimeoutException("timed out"))
            results = _deliver()
            final = queue.drain()

        assert results[0]["status"] == "retry_scheduled"
        assert final is not None
        assert final["status"] == "timeout"
        assert final["status_code"] is None

    def test_connection_error_recorded_gracefully(self, queue: FakeQueue):
        """Connection refused → retried, then 'error', no crash."""
        _seed_webhook()
        with respx.mock:
            respx.post(WEBHOOK_URL).mock(side_effect=httpx.ConnectError("Connection refused"))
            _deliver(event_type="post.failed")
            final = queue.drain()

        assert final is not None
        assert final["status"] == "error"
        assert "refused" in final.get("error", "").lower()

    def test_http_404_recorded_as_failed(self):
        """404 response → recorded as 'failed', not a crash, not retried."""
        _seed_webhook()
        with respx.mock:
            respx.post(WEBHOOK_URL).mock(return_value=httpx.Response(404))
            results = _deliver()

        assert len(results) == 1
        assert results[0]["status"] == "failed"
        assert results[0]["status_code"] == 404

    def test_delivery_log_created_on_success(self):
        """Successful delivery creates a DeliveryLog entry."""
        _seed_webhook()
        with respx.mock:
            respx.post(WEBHOOK_URL).mock(return_value=httpx.Response(200))
            _deliver()

        logs = _log_rows("webhook.post.published")
        assert len(logs) == 1
        assert logs[0].http_status == 200  # type: ignore[union-attr]

    def test_delivery_log_created_once_on_final_failure(self, queue: FakeQueue):
        """A transient failure logs only its terminal outcome, with error info."""
        _seed_webhook()
        with respx.mock:
            respx.post(WEBHOOK_URL).mock(side_effect=httpx.ConnectError("DNS resolution failed"))
            _deliver(event_type="post.failed")
            queue.drain()

        logs = _log_rows("webhook.post.failed")
        assert len(logs) == 1
        assert logs[0].http_status is None  # type: ignore[union-attr]


class TestWebhookRetries:
    """T070 — transient webhook failures are retried up to MAX_RETRIES; 4xx and
    2xx are not. Retries are QUEUED with a countdown, never slept inline."""

    def test_transient_failure_is_queued_not_slept(self, queue: FakeQueue, monkeypatch):
        import time as time_module

        monkeypatch.setattr(
            time_module, "sleep", lambda *_: pytest.fail("webhook retry must not block the worker")
        )
        _seed_webhook()
        with respx.mock:
            route = respx.post(WEBHOOK_URL)
            route.mock(side_effect=[httpx.Response(503), httpx.Response(200, json={"ok": True})])
            results = _deliver(payload={"post_id": "abc"})
            assert route.call_count == 1  # nothing retried inline
            final = queue.drain()
        assert results[0]["status"] == "retry_scheduled"
        assert queue.scheduled == [(2, 5.0)]
        assert final is not None
        assert final["status"] == "delivered"
        assert final["status_code"] == 200
        assert route.call_count == 2

    def test_redelivery_is_resigned_with_a_fresh_timestamp(self, queue: FakeQueue):
        _seed_webhook()
        bodies: list[bytes] = []

        def capture(request):
            bodies.append(request.content)
            return httpx.Response(503) if len(bodies) == 1 else httpx.Response(200)

        with respx.mock:
            respx.post(WEBHOOK_URL).mock(side_effect=capture)
            _deliver(payload={"post_id": "abc"})
            queue.drain()

        stamps = [json.loads(b)["timestamp"] for b in bodies]
        assert len(stamps) == 2
        assert stamps[1] >= stamps[0]

    def test_no_retry_on_permanent_4xx(self, queue: FakeQueue):
        _seed_webhook()
        with respx.mock:
            route = respx.post(WEBHOOK_URL)
            route.mock(return_value=httpx.Response(404))
            results = _deliver(payload={"post_id": "abc"})
        assert route.call_count == 1  # 4xx is permanent — no retry
        assert queue.scheduled == []
        assert results[0]["status"] == "failed"
        assert results[0]["status_code"] == 404

    def test_exhausts_retries_on_persistent_5xx(self, queue: FakeQueue):
        _seed_webhook()
        with respx.mock:
            route = respx.post(WEBHOOK_URL)
            route.mock(return_value=httpx.Response(503))
            _deliver(event_type="post.failed", payload={"post_id": "abc"})
            final = queue.drain()
        assert route.call_count == 3  # MAX_RETRIES attempts
        assert [attempt for attempt, _ in queue.scheduled] == [2, 3]
        assert final is not None
        assert final["status"] == "failed"
        assert final["status_code"] == 503

    def test_success_is_not_retried(self, queue: FakeQueue):
        _seed_webhook()
        with respx.mock:
            route = respx.post(WEBHOOK_URL)
            route.mock(return_value=httpx.Response(200, json={"ok": True}))
            results = _deliver(payload={"post_id": "abc"})
        assert route.call_count == 1
        assert queue.scheduled == []
        assert results[0]["status"] == "delivered"
