"""Celery scheduler tasks for post publishing and token refresh.

This module implements the beat-driven scheduling system:
1. `tick_due_jobs` - Run by Celery Beat every 30s, claims due posts
2. `process_target` - Run by Celery Worker, publishes to one platform target
3. `refresh_tokens` - Run by Celery Beat daily, refreshes expiring tokens

Key Design Decisions:
- FOR UPDATE SKIP LOCKED: Atomic claim of due targets across multi workers
- acks_late: Task not acknowledged until complete (prevents lost jobs)
- Exponential backoff: Retries with increasing delays + jitter
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
from celery import Task
from celery.exceptions import SoftTimeLimitExceeded
from sqlalchemy import text
from sqlalchemy.orm import Session as SyncSession

from app.adapters.base import ADAPTER_REGISTRY, PublishContent
from app.adapters.dryrun import DryRunAdapter
from app.celery_app import celery_app
from app.config import Settings, get_settings
from app.database import get_sync_session_maker
from app.models import Account, DeliveryLog, Post, PostTarget
from app.security import decrypt_token, encrypt_token
from app.services.webhook_out import WebhookService

logger = logging.getLogger(__name__)

# ─── Constants ──────────────────────────────────────────────────────────
CLAIM_BATCH_SIZE = 100  # Max targets claimed per beat tick
MAX_RETRIES_DEFAULT = 5  # Default max retry attempts
INITIAL_RETRY_DELAY = 60  # Initial retry delay in seconds
MAX_RETRY_DELAY = 3600  # Max retry delay (1 hour)


# ─── Beat Tasks (Run on Schedule) ───────────────────────────────────────


@celery_app.task(  # type: ignore[untyped-decorator]
    name="scheduler.tick_due_jobs",
    bind=True,
    max_retries=1,
    acks_late=False,
)
def tick_due_jobs(self: Task) -> dict[str, Any]:  # type: ignore[no-any-unimported, misc]  # noqa: ARG001
    """Beat task: find and claim due post targets.

    Runs every 30 seconds (configured in Celery Beat schedule).
    Uses FOR UPDATE SKIP LOCKED for atomic claim across multiple workers.

    Returns:
        Dict with claim count and details.

    Example return:
        {"claimed": 5, "targets": ["tgt_1", "tgt_2", ...]}

    """
    now = datetime.now(UTC)
    claimed_targets = []

    try:
        maker = get_sync_session_maker()
        with maker() as session:
            # Atomically claim due targets using FOR UPDATE SKIP LOCKED
            # This prevents multiple workers from claiming the same target
            claim_sql = text("""
                UPDATE post_targets
                SET
                    status = 'publishing',
                    attempts = attempts + 1,
                    next_attempt_at = NULL,
                    updated_at = :now
                WHERE id IN (
                    SELECT id
                    FROM post_targets
                    WHERE (
                        status = 'pending'
                        OR (status = 'retrying' AND next_attempt_at <= :now)
                    )
                    ORDER BY next_attempt_at ASC NULLS FIRST
                    LIMIT :limit
                    FOR UPDATE SKIP LOCKED
                )
                RETURNING id, post_id, account_id
            """)

            result = session.execute(
                claim_sql,
                {
                    "now": now,
                    "limit": CLAIM_BATCH_SIZE,
                },
            )
            claimed = result.fetchall()

            # Record delivery log events for claimed targets
            for row in claimed:
                target_id, post_id, account_id = row

                # Record queued event
                delivery_log = DeliveryLog(
                    id=str(uuid.uuid4()),
                    post_id=post_id,
                    post_target_id=target_id,
                    workspace_id="",  # Will be resolved from post if needed
                    event_type="publishing",
                    created_at=now,
                )
                session.add(delivery_log)
                claimed_targets.append(target_id)

            session.commit()

            # Dispatch each claimed target to a worker task
            for target_id in claimed_targets:
                process_target.delay(target_id)

            logger.info(
                "Tick claimed %d targets",
                len(claimed_targets),
            )

    except Exception as e:
        logger.exception("Error in tick_due_jobs: %s", e)
        return {"claimed": 0, "error": str(e)}

    return {
        "claimed": len(claimed_targets),
        "targets": claimed_targets,
    }


# ─── Worker Tasks (Run Async) ───────────────────────────────────────────


@celery_app.task(  # type: ignore[untyped-decorator]
    name="scheduler.process_target",
    bind=True,
    max_retries=MAX_RETRIES_DEFAULT,
    acks_late=True,
    soft_time_limit=60,
    time_limit=90,
)
def process_target(self: Task, target_id: str) -> dict[str, Any]:  # type: ignore[no-any-unimported, misc]  # noqa: C901
    """Worker task: publish a post target to its platform.

    This is the core execution unit. Each post_target is processed
    independently, enabling parallel publishing to multiple platforms.

    Args:
        self: Celery task instance.
        target_id: UUID of the PostTarget to process.

    Returns:
        Dict with publishing result.

    Raises:
        SoftTimeLimitExceeded: If task runs longer than 60 seconds.

    """
    now = datetime.now(UTC)
    logger.info("Processing target %s (attempt %d)", target_id, self.request.retries + 1)

    try:
        maker = get_sync_session_maker()
        with maker() as session:
            # Load target with related post
            target = session.query(PostTarget).filter(PostTarget.id == target_id).first()

            if not target:
                logger.warning("Target %s not found", target_id)
                return {"target_id": target_id, "status": "not_found"}

            # Load related post first so the workspace is known.
            post = session.query(Post).filter(Post.id == target.post_id).first()

            if not post:
                _record_error(session, target, "Post not found", "fatal", now)
                return {"target_id": target_id, "status": "failed", "reason": "post_not_found"}

            # Load account (workspace-scoped so a cross-tenant account id can
            # never resolve to another workspace's credentials — see
            # MULTI_TENANCY.md FR-MT-03).
            account = (
                session.query(Account)
                .filter(
                    Account.id == target.account_id,
                    Account.workspace_id == post.workspace_id,
                )
                .first()
            )

            if not account or account.status != "active":
                error_msg = "Account not active" if account else "Account not found"
                _record_error(session, target, error_msg, "auth", now)
                _record_delivery_log(
                    session,
                    post.id,
                    target_id,
                    post.workspace_id,
                    "failed",
                    None,
                    error_msg,
                    now,
                )
                session.commit()
                return {"target_id": target_id, "status": "failed", "reason": error_msg}

            # Get adapter for platform
            try:
                if ADAPTER_REGISTRY.is_registered(account.platform):
                    adapter_class = ADAPTER_REGISTRY.get(account.platform)
                    adapter = adapter_class()
                else:
                    # Fall back to DryRun adapter for development
                    adapter = DryRunAdapter()
            except KeyError:
                error_msg = f"No adapter for platform: {account.platform}"
                _record_error(session, target, error_msg, "fatal", now)
                _record_delivery_log(
                    session,
                    post.id,
                    target_id,
                    post.workspace_id,
                    "failed",
                    None,
                    error_msg,
                    now,
                )
                session.commit()
                return {"target_id": target_id, "status": "failed", "reason": error_msg}

            # Validate content
            try:
                content = PublishContent(
                    text=target.content.get("text") if target.content else None,
                    media_urls=target.content.get("media_urls") if target.content else None,
                    metadata=target.content.get("metadata") if target.content else None,
                )
                adapter.validate_content(content)
            except ValueError as e:
                _record_error(session, target, str(e), "fatal", now)
                _record_delivery_log(
                    session,
                    post.id,
                    target_id,
                    post.workspace_id,
                    "failed",
                    400,
                    str(e),
                    now,
                )
                session.commit()
                return {"target_id": target_id, "status": "failed", "reason": str(e)}

            # Publish with the real (decrypted) OAuth token and author identity.
            try:
                token = decrypt_token(account.encrypted_access_token)
                metadata = account.metadata_fields or {}
                author_urn = metadata.get("author_urn")
                if account.platform == "facebook":
                    # Facebook adapter expects "page_id|access_token".
                    page_id = metadata.get("page_id", "me")
                    token = f"{page_id}|{token}"
                elif account.platform == "instagram":
                    # Instagram adapter expects "ig_user_id|access_token".
                    ig_user_id = metadata.get("ig_user_id")
                    if not ig_user_id:
                        # Permanent config error — fail the target, don't retry.
                        _record_error(
                            session,
                            target,
                            "Instagram account missing ig_user_id in metadata",
                            "fatal",
                            now,
                        )
                        _record_delivery_log(
                            session,
                            post.id,
                            target_id,
                            post.workspace_id,
                            "failed",
                            400,
                            "missing ig_user_id in metadata",
                            now,
                        )
                        target.status = "failed"
                        target.updated_at = now
                        session.commit()
                        _sync_post_status(session, post, now)
                        session.commit()
                        _deliver_webhook(
                            post.workspace_id,
                            _event_type_for("failed"),
                            {"post_id": post.id, "target_id": target_id, "status": "failed"},
                        )
                        return {
                            "target_id": target_id,
                            "status": "failed",
                            "platform_post_id": None,
                            "attempts": target.attempts,
                        }
                    token = f"{ig_user_id}|{token}"

                # adapter.publish is async; the Celery task is sync, so drive it
                # on a fresh loop. The earlier code called the coroutine without
                # awaiting it → AttributeError → every scheduled publish failed
                # transient and exhausted its retries.
                result = asyncio.run(
                    adapter.publish(
                        content=content,
                        account_id=token,
                        author_urn=author_urn,
                    )
                )

                if result.is_success():
                    target.status = "published"
                    target.platform_post_id = result.platform_post_id
                    target.platform_post_url = result.platform_post_url
                    target.published_at = now
                    target.error_category = None
                    target.last_error = None

                    _record_delivery_log(
                        session,
                        post.id,
                        target_id,
                        post.workspace_id,
                        "published",
                        None,
                        None,
                        now,
                    )

                    logger.info(
                        "Target %s published successfully (post_id: %s)",
                        target_id,
                        result.platform_post_id,
                    )
                else:
                    # Handle failure
                    error_cat = result.error.category.value if result.error else "unknown"
                    _record_error(
                        session,
                        target,
                        str(result.error) if result.error else "Unknown error",
                        error_cat,
                        now,
                    )
                    _record_delivery_log(
                        session,
                        post.id,
                        target_id,
                        post.workspace_id,
                        "failed",
                        None,
                        str(result.error) if result.error else None,
                        now,
                    )

                    # Schedule retry if retriable
                    if result.retryable and target.attempts < target.max_attempts:
                        backoff = _compute_backoff(target.attempts)
                        next_attempt = now + timedelta(seconds=backoff)
                        target.status = "retrying"
                        target.next_attempt_at = next_attempt
                        logger.info(
                            "Target %s will retry in %ds (attempt %d/%d)",
                            target_id,
                            backoff,
                            target.attempts,
                            target.max_attempts,
                        )
                    else:
                        target.status = "failed"
                        target.next_attempt_at = None
                        logger.warning(
                            "Target %s failed permanently (attempt %d/%d)",
                            target_id,
                            target.attempts,
                            target.max_attempts,
                        )

                target.updated_at = now
                session.commit()
                _sync_post_status(session, post, now)
                session.commit()

                # Notify the owning workspace (webhooks are workspace-scoped).
                _deliver_webhook(
                    post.workspace_id,
                    _event_type_for(target.status),
                    {
                        "post_id": post.id,
                        "target_id": target_id,
                        "status": target.status,
                        "platform_post_id": target.platform_post_id,
                    },
                )

                return {
                    "target_id": target_id,
                    "status": target.status,
                    "platform_post_id": target.platform_post_id,
                    "attempts": target.attempts,
                }

            except Exception as e:
                logger.exception("Error publishing target %s: %s", target_id, e)
                _record_error(session, target, str(e), "transient", now)
                _record_delivery_log(
                    session,
                    post.id,
                    target_id,
                    post.workspace_id,
                    "failed",
                    500,
                    str(e),
                    now,
                )

                # Schedule retry
                if target.attempts < target.max_attempts:
                    backoff = _compute_backoff(target.attempts)
                    target.status = "retrying"
                    target.next_attempt_at = now + timedelta(seconds=backoff)
                else:
                    target.status = "failed"

                target.updated_at = now
                session.commit()
                _sync_post_status(session, post, now)
                session.commit()

                _deliver_webhook(
                    post.workspace_id,
                    _event_type_for(target.status),
                    {
                        "post_id": post.id,
                        "target_id": target_id,
                        "status": target.status,
                        "error": str(e),
                    },
                )

                return {
                    "target_id": target_id,
                    "status": target.status,
                    "error": str(e),
                }

    except SoftTimeLimitExceeded:
        logger.error("Target %s processing timed out", target_id)
        # Re-raise to let Celery handle the timeout
        raise
    except Exception as e:
        logger.exception("Unexpected error processing target %s: %s", target_id, e)
        return {"target_id": target_id, "status": "error", "error": str(e)}


@celery_app.task(  # type: ignore[untyped-decorator]
    name="scheduler.refresh_tokens",
    bind=True,
    max_retries=1,
    acks_late=False,
)
def refresh_tokens(self: Task) -> dict[str, Any]:  # type: ignore[no-any-unimported, misc]  # noqa: ARG001
    """Beat task: proactively refresh expiring OAuth tokens.

    Runs daily at 03:00 UTC (configured in Celery Beat schedule).
    Checks for tokens expiring within the next 7 days and refreshes them.

    Returns:
        Dict with refresh results.

    """
    now = datetime.now(UTC)
    refreshed = 0
    failed = 0
    candidates = 0

    try:
        maker = get_sync_session_maker()
        with maker() as session:
            # Find tokens expiring within the next 7 days (and not yet expired)
            expiry_threshold = now + timedelta(days=7)
            accounts_to_refresh = (
                session.query(Account)
                .filter(
                    Account.status == "active",
                    Account.token_expires_at <= expiry_threshold,
                    Account.token_expires_at > now,
                )
                .all()
            )
            candidates = len(accounts_to_refresh)

            for account in accounts_to_refresh:
                try:
                    new_tokens = _refresh_platform_token(account)
                    if new_tokens is None:
                        raise ValueError("Platform returned no new tokens")
                    access_token, new_refresh, expires_at = new_tokens

                    account.encrypted_access_token = encrypt_token(access_token)
                    if new_refresh:
                        account.encrypted_refresh_token = encrypt_token(new_refresh)
                    account.token_expires_at = expires_at
                    account.updated_at = now
                    session.add(account)
                    refreshed += 1
                    logger.info(
                        "Refreshed token for account %s (%s), expires %s",
                        account.id,
                        account.platform,
                        expires_at,
                    )
                except Exception as e:
                    # Permanent refresh failure → surface, never silently drop posts
                    account.status = "expired"
                    account.updated_at = now
                    session.add(account)
                    failed += 1
                    logger.error(
                        "Failed to refresh token for account %s: %s",
                        account.id,
                        e,
                    )
                    _deliver_webhook(
                        account.workspace_id,
                        "account.expired",
                        {
                            "account_id": account.id,
                            "platform": account.platform,
                            "reason": str(e),
                        },
                    )

            session.commit()

    except Exception as e:
        logger.exception("Error in refresh_tokens: %s", e)
        return {
            "refreshed": refreshed,
            "failed": failed,
            "total_candidates": candidates,
            "error": str(e),
        }

    logger.info(
        "Token refresh: %d refreshed, %d failed, %d candidates",
        refreshed,
        failed,
        candidates,
    )
    return {
        "refreshed": refreshed,
        "failed": failed,
        "total_candidates": candidates,
    }


# ─── Beat Schedule Configuration ────────────────────────────────────────


def get_beat_schedule() -> dict[str, Any]:
    """Get the Celery Beat schedule configuration.

    Called during Celery Beat startup to configure periodic tasks.

    Returns:
        Dict suitable for Celery.conf.beat_schedule.

    """
    from app.config import get_settings

    settings = get_settings()

    return {
        "tick-due-jobs": {
            "task": "scheduler.tick_due_jobs",
            "schedule": settings.BEAT_INTERVAL_SECONDS,
            "options": {"expires": settings.BEAT_INTERVAL_SECONDS * 2},
        },
        "refresh-tokens": {
            "task": "scheduler.refresh_tokens",
            "schedule": timedelta(hours=24),
            "options": {"expires": 3600},
        },
    }


# ─── Helper Functions ───────────────────────────────────────────────────


def _compute_backoff(attempt: int) -> int:
    """Compute exponential backoff with jitter for retry delay.

    Args:
        attempt: Current attempt number (1-indexed).

    Returns:
        Delay in seconds for the next retry.

    Formula:
        delay = min(INITIAL_RETRY_DELAY * 2^(attempt-1), MAX_RETRY_DELAY)
        Then add ±10% jitter for randomized distribution.

    Example:
        Attempt 1: 60s
        Attempt 2: 300s
        Attempt 3: 900s
        Attempt 4: 1800s
        Attempt 5: 3600s

    """
    import random

    delay = min(
        INITIAL_RETRY_DELAY * (2 ** (attempt - 1)),
        MAX_RETRY_DELAY,
    )

    # Add ±10% jitter
    jitter = random.uniform(-0.1, 0.1)
    delay = int(delay * (1 + jitter))

    return max(delay, INITIAL_RETRY_DELAY)


def _record_error(
    session: SyncSession,  # noqa: ARG001
    target: PostTarget,
    error_msg: str,
    error_category: str,
    now: datetime,
) -> None:
    """Record a publish error on a target.

    Args:
        session: Database session
        target: PostTarget to update
        error_msg: Error description
        error_category: Error category (fatal, transient, auth, etc.)
        now: Current timestamp

    """
    target.error_category = error_category
    target.last_error = error_msg
    target.status = "failed" if error_category in ("fatal", "auth") else "retrying"
    target.updated_at = now


def _record_delivery_log(
    session: SyncSession,
    post_id: str,
    target_id: str | None,
    workspace_id: str,
    event_type: str,
    http_status: int | None,
    error_message: str | None,
    now: datetime,
) -> None:
    """Record a delivery log entry.

    Args:
        session: Database session
        post_id: Post ID
        target_id: Target ID (optional)
        workspace_id: Workspace ID
        event_type: Event type
        http_status: HTTP status code (optional)
        error_message: Error message (optional)
        now: Current timestamp

    """
    log = DeliveryLog(
        id=str(uuid.uuid4()),
        post_id=post_id,
        post_target_id=target_id,
        workspace_id=workspace_id,
        event_type=event_type,
        http_status=http_status,
        error_message=error_message,
        created_at=now,
    )
    session.add(log)


# ─── Webhook helpers ──────────────────────────────────────────────────────


def _event_type_for(status: str) -> str:
    """Map a target status to the webhook event name (FR-011)."""
    return {
        "published": "post.published",
        "failed": "post.failed",
        "retrying": "post.retrying",
    }.get(status, "post.updated")


def _deliver_webhook(workspace_id: str, event_type: str, payload: dict[str, Any]) -> None:
    """Best-effort webhook delivery; never lets a webhook failure break publishing."""
    try:
        WebhookService().deliver_event(workspace_id, event_type, payload)
    except Exception as e:  # noqa: BLE001 - webhook failure must not fail a post
        logger.error(
            "Webhook delivery failed for workspace %s event %s: %s",
            workspace_id,
            event_type,
            e,
        )


def _sync_post_status(session: SyncSession, post: Post, now: datetime) -> None:
    """Recompute the aggregate post status from its targets after a worker publish.

    The immediate path recomputes this in ``PublisherService._compute_post_status``;
    the scheduled/worker path must do the same, otherwise a post stays
    ``pending`` even after every target is published. Mirrors the immediate
    path's aggregation rules.
    """
    targets = session.query(PostTarget).filter(PostTarget.post_id == post.id).all()
    if not targets:
        return

    statuses = [t.status for t in targets]
    if all(s == "published" for s in statuses):
        post.status = "published"
        post.published_at = now
    elif any(s in ("publishing", "pending", "retrying") for s in statuses):
        post.status = "publishing"
    elif any(s == "failed" for s in statuses) and any(s == "published" for s in statuses):
        post.status = "partial_failed"
    elif all(s == "failed" for s in statuses):
        post.status = "failed"
    post.updated_at = now


# ─── Platform token refresh (ADR-0003) ────────────────────────────────────


def _refresh_platform_token(account: Account) -> tuple[str, str | None, datetime] | None:
    """Refresh an account's OAuth token using the platform-specific flow.

    Args:
        account: The account whose token needs refreshing.

    Returns:
        ``(access_token, refresh_token_or_None, expires_at)`` on success,
        or ``None`` if the platform returned no usable tokens.

    Raises:
        ValueError: If the platform has no refresh strategy.
        httpx.HTTPStatusError / httpx.RequestError: Propagated to the caller,
            which marks the account ``expired``.

    """
    settings = get_settings()
    if account.platform == "linkedin":
        return _refresh_linkedin(account, settings)
    if account.platform == "twitter":
        return _refresh_twitter(account, settings)
    if account.platform == "facebook":
        return _refresh_facebook(account, settings)
    if account.platform == "instagram":
        # Instagram uses Meta long-lived tokens — the same fb_exchange_token
        # grant refreshes them (T069). Without this, IG accounts auto-expire.
        return _refresh_facebook(account, settings)
    raise ValueError(f"No refresh strategy for platform: {account.platform}")


def _refresh_linkedin(account: Account, settings: Settings) -> tuple[str, str | None, datetime]:
    """Refresh a LinkedIn access token (OAuth 2.0 ``refresh_token`` grant)."""
    if not account.encrypted_refresh_token:
        raise ValueError("LinkedIn account has no refresh token")
    refresh_token = decrypt_token(account.encrypted_refresh_token)
    resp = httpx.post(
        "https://www.linkedin.com/oauth/v2/accessToken",
        data={
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
            "client_id": settings.LINKEDIN_CLIENT_ID,
            "client_secret": settings.LINKEDIN_CLIENT_SECRET,
        },
        timeout=30,
    )
    resp.raise_for_status()
    data = resp.json()
    new_refresh = data.get("refresh_token")
    expires_at = datetime.now(UTC) + timedelta(seconds=data.get("expires_in", 60 * 60 * 24))
    return data["access_token"], new_refresh, expires_at


def _refresh_twitter(account: Account, settings: Settings) -> tuple[str, str | None, datetime]:
    """Refresh a Twitter/X access token (OAuth 2.0 ``refresh_token`` grant)."""
    if not account.encrypted_refresh_token:
        raise ValueError("Twitter account has no refresh token")
    refresh_token = decrypt_token(account.encrypted_refresh_token)
    resp = httpx.post(
        "https://api.twitter.com/2/oauth2/token",
        data={"grant_type": "refresh_token", "refresh_token": refresh_token},
        auth=(settings.TWITTER_CLIENT_ID, settings.TWITTER_CLIENT_SECRET),
        timeout=30,
    )
    resp.raise_for_status()
    data = resp.json()
    new_refresh = data.get("refresh_token")
    expires_at = datetime.now(UTC) + timedelta(seconds=data.get("expires_in", 7200))
    return data["access_token"], new_refresh, expires_at


def _refresh_facebook(account: Account, settings: Settings) -> tuple[str, str | None, datetime]:
    """Extend a Meta/Facebook long-lived token (``fb_exchange_token`` grant)."""
    current_token = decrypt_token(account.encrypted_access_token)
    resp = httpx.get(
        "https://graph.facebook.com/v18.0/oauth/access_token",
        params={
            "grant_type": "fb_exchange_token",
            "client_id": settings.FACEBOOK_CLIENT_ID,
            "client_secret": settings.FACEBOOK_CLIENT_SECRET,
            "fb_exchange_token": current_token,
        },
        timeout=30,
    )
    resp.raise_for_status()
    data = resp.json()
    expires_at = datetime.now(UTC) + timedelta(seconds=data.get("expires_in", 60 * 60 * 24 * 60))
    return data["access_token"], None, expires_at
