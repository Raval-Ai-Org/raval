"""Webhook service for sending signed event notifications to registered endpoints.

Delivers events to configured webhook URLs with HMAC-SHA256 signatures
so receivers can verify the payload integrity and authenticity.
"""

from __future__ import annotations

import json
import logging
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

import httpx
from sqlalchemy.orm import Session as SyncSession

from app.config import get_settings
from app.database import get_sync_session_maker
from app.models import DeliveryLog, WebhookEndpoint
from app.security import sign_request

logger = logging.getLogger(__name__)

# Default timeout for webhook delivery
WEBHOOK_TIMEOUT = 10.0  # seconds
MAX_RETRIES = 3


class WebhookService:
    """Service for delivering signed webhook events to registered endpoints.

    Uses HMAC-SHA256 signatures for payload integrity.
    Retries on transient failures (timeouts, 5xx).

    Example:
        >>> service = WebhookService()
        >>> service.deliver_event(
        ...     workspace_id="ws_001",
        ...     event_type="post.published",
        ...     payload={"post_id": "abc123", "status": "published"},
        ... )

    """

    def __init__(self) -> None:
        """Initialize webhook service."""
        self.settings = get_settings()

    def deliver_event(
        self,
        workspace_id: str,
        event_type: str,
        payload: dict[str, Any],
    ) -> list[dict[str, Any]]:
        """Deliver an event to all active webhook endpoints for a workspace.

        Args:
            workspace_id: Workspace to notify
            event_type: Type of event (e.g., "post.published", "post.failed")
            payload: Event payload data

        Returns:
            List of delivery results, one per webhook endpoint.

        Example:
            >>> results = service.deliver_event(
            ...     workspace_id="ws_001",
            ...     event_type="post.published",
            ...     payload={"post_id": "abc123", "status": "published"},
            ... )
            >>> results[0]
            {"webhook_id": "wh_1", "url": "https://...", "status": "delivered", "status_code": 200}

        """
        results: list[dict[str, Any]] = []
        maker = get_sync_session_maker()

        with maker() as session:
            # Get all active webhooks for this workspace
            webhooks = (
                session.query(WebhookEndpoint)
                .filter(
                    WebhookEndpoint.workspace_id == workspace_id,
                    WebhookEndpoint.status == "active",
                )
                .all()
            )

            if not webhooks:
                logger.debug("No active webhooks for workspace %s", workspace_id)
                return results

            # Tie post-event deliveries back to their post for traceability;
            # generic (non-post) events write NULL, allowed since migration 003.
            post_id = payload.get("post_id")
            post_target_id = payload.get("target_id")

            for webhook in webhooks:
                result = self._send_webhook(
                    session=session,
                    webhook=webhook,
                    event_type=event_type,
                    payload=payload,
                    post_id=post_id,
                    post_target_id=post_target_id,
                )
                results.append(result)

            session.commit()

        return results

    def _send_webhook(
        self,
        session: SyncSession,
        webhook: WebhookEndpoint,
        event_type: str,
        payload: dict[str, Any],
        post_id: str | None,
        post_target_id: str | None,
        attempt: int = 1,
    ) -> dict[str, Any]:
        """Send a signed webhook to a single endpoint (one attempt).

        Args:
            session: Database session
            webhook: Webhook endpoint to deliver to
            event_type: Event type identifier
            payload: Event payload
            post_id: ID of the post, if available
            post_target_id: ID of the post target, if available
            attempt: 1-based delivery attempt; below MAX_RETRIES a transient
                failure schedules the next attempt on the queue

        Returns:
            Dict with delivery result

        """
        now = datetime.now(UTC)

        # Build webhook payload
        body = {
            "event": event_type,
            "timestamp": now.isoformat(),
            "data": payload,
        }
        body_bytes = json.dumps(body, default=str).encode("utf-8")

        # Sign the request with HMAC-SHA256
        signature = sign_request(
            method="POST",
            path="/webhook",
            body=body_bytes,
            secret=webhook.secret,
        )

        headers = {
            "Content-Type": "application/json",
            "X-Signature-256": signature,
            "X-Event-Type": event_type,
            "User-Agent": "RavalAI-SDE-Webhook/1.0",
        }

        # ONE attempt per call. Transient failures (timeout, connection error,
        # 5xx) are re-enqueued as a Celery task with a countdown instead of
        # retried inline with time.sleep(): the old loop held a worker slot and
        # a DB session for up to ~33 s per slow receiver. Permanent 4xx and 2xx
        # are never retried. Each redelivery is re-signed with a fresh
        # timestamp, so it stays inside the receiver's replay window.
        last_status: int | None = None
        last_error_kind: str | None = None  # "timeout" | "error" | "http5xx"
        last_error_msg: str | None = None
        try:
            with httpx.Client(timeout=WEBHOOK_TIMEOUT) as client:
                response = client.post(webhook.url, content=body_bytes, headers=headers)
            status_code = response.status_code
            if 200 <= status_code < 300:
                self._record_delivery_log(
                    session=session,
                    post_id=post_id,
                    post_target_id=post_target_id,
                    workspace_id=webhook.workspace_id,
                    event_type=event_type,
                    status_code=status_code,
                    success=True,
                    error_message=None,
                    timestamp=now,
                )
                logger.info("Webhook %s delivered to %s: %d", webhook.id, webhook.url, status_code)
                return {
                    "webhook_id": webhook.id,
                    "url": webhook.url,
                    "status": "delivered",
                    "status_code": status_code,
                    "attempt": attempt,
                }
            if 400 <= status_code < 500:
                # Permanent — no retry (a bad URL/secret won't fix itself).
                self._record_delivery_log(
                    session=session,
                    post_id=post_id,
                    post_target_id=post_target_id,
                    workspace_id=webhook.workspace_id,
                    event_type=event_type,
                    status_code=status_code,
                    success=False,
                    error_message=None,
                    timestamp=now,
                )
                logger.warning("Webhook %s rejected with %d: %s", webhook.id, status_code, webhook.url)
                return {
                    "webhook_id": webhook.id,
                    "url": webhook.url,
                    "status": "failed",
                    "status_code": status_code,
                    "attempt": attempt,
                }
            last_status = status_code
            last_error_kind = "http5xx"
            last_error_msg = f"HTTP {status_code}"
        except httpx.TimeoutException:
            last_error_kind = "timeout"
            last_error_msg = "Timeout"
        except httpx.RequestError as e:
            last_error_kind = "error"
            last_error_msg = str(e)

        if attempt < MAX_RETRIES:
            delay = self._retry_delay(attempt)
            logger.info(
                "Webhook %s transient failure (%s) — redelivery %d/%d in %.0fs",
                webhook.id,
                last_error_msg,
                attempt + 1,
                MAX_RETRIES,
                delay,
            )
            self._schedule_retry(
                webhook_id=webhook.id,
                event_type=event_type,
                payload=payload,
                post_id=post_id,
                post_target_id=post_target_id,
                attempt=attempt + 1,
                delay=delay,
            )
            return {
                "webhook_id": webhook.id,
                "url": webhook.url,
                "status": "retry_scheduled",
                "status_code": last_status,
                "attempt": attempt,
            }

        # Exhausted retries on a transient failure — record + return a stable shape.
        logger.warning("Webhook %s failed after %d attempts: %s", webhook.id, MAX_RETRIES, last_error_msg)
        self._record_delivery_log(
            session=session,
            post_id=post_id,
            post_target_id=post_target_id,
            workspace_id=webhook.workspace_id,
            event_type=event_type,
            status_code=last_status,
            success=False,
            error_message=last_error_msg or f"Transient failure after {MAX_RETRIES} attempts",
            timestamp=now,
        )
        if last_error_kind == "timeout":
            return {"webhook_id": webhook.id, "url": webhook.url, "status": "timeout", "status_code": None}
        if last_error_kind == "error":
            return {"webhook_id": webhook.id, "url": webhook.url, "status": "error", "status_code": None, "error": last_error_msg}
        return {"webhook_id": webhook.id, "url": webhook.url, "status": "failed", "status_code": last_status, "error": last_error_msg}

    def redeliver(
        self,
        webhook_id: str,
        event_type: str,
        payload: dict[str, Any],
        post_id: str | None,
        post_target_id: str | None,
        attempt: int,
    ) -> dict[str, Any]:
        """Run one queued redelivery attempt (called by the Celery task)."""
        maker = get_sync_session_maker()
        with maker() as session:
            webhook = session.get(WebhookEndpoint, webhook_id)
            if webhook is None or webhook.status != "active":
                return {"webhook_id": webhook_id, "status": "skipped"}
            result = self._send_webhook(
                session=session,
                webhook=webhook,
                event_type=event_type,
                payload=payload,
                post_id=post_id,
                post_target_id=post_target_id,
                attempt=attempt,
            )
            session.commit()
            return result

    @staticmethod
    def _schedule_retry(
        webhook_id: str,
        event_type: str,
        payload: dict[str, Any],
        post_id: str | None,
        post_target_id: str | None,
        attempt: int,
        delay: float,
    ) -> None:
        """Enqueue the next attempt on the worker queue (non-blocking)."""
        # Imported lazily: scheduler_tasks imports this module.
        from app.services.scheduler_tasks import redeliver_webhook

        redeliver_webhook.apply_async(
            args=[webhook_id, event_type, payload, post_id, post_target_id, attempt],
            countdown=delay,
        )

    @staticmethod
    def _retry_delay(attempt: int) -> float:
        """Backoff before redelivery ``attempt + 1``: 5 s, 30 s, then capped at 120 s."""
        return {1: 5.0, 2: 30.0}.get(attempt, 120.0)

    @staticmethod
    def _record_delivery_log(
        session: SyncSession,
        workspace_id: str,
        event_type: str,
        status_code: int | None,
        success: bool,
        error_message: str | None,
        timestamp: datetime,
        post_id: str | None,
        post_target_id: str | None,
    ) -> None:
        """Record a webhook delivery attempt in the delivery log.

        Post events are tied back to their ``post_id``/``target_id`` when the
        payload carries them; generic events write NULL. ``post_id`` became
        nullable in migration 003 — a webhook delivery log is delivery metadata,
        not a post.
        """
        log = DeliveryLog(
            id=str(uuid4()),
            post_id=post_id,
            post_target_id=post_target_id,
            workspace_id=workspace_id,
            event_type=f"webhook.{event_type}",
            http_status=status_code,
            error_message=error_message if not success else None,
            created_at=timestamp,
        )
        session.add(log)
