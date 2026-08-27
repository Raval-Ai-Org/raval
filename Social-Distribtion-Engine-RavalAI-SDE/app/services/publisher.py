"""Publisher service - orchestration layer for post publishing.

This service coordinates the entire publish workflow:
1. Validate content per platform rules
2. Call adapter to publish
3. Record delivery log entry
4. Update post target status
5. Compute post status from target statuses
6. Return result with timeline
"""

from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.adapters.base import ADAPTER_REGISTRY, BaseAdapter, PublishContent
from app.models import Account, DeliveryLog, Post, PostTarget
from app.schemas import PublishRequest, PublishTarget
from app.security import decrypt_token
from app.services.scheduler_tasks import process_target
from app.services.webhook_out import WebhookService


class DuplicatePostError(Exception):
    """Raised when a duplicate ``idempotency_key`` races with an existing post.

    Maps to HTTP 409 in the API layer (FR-MT-09).
    """

    pass


logger = logging.getLogger(__name__)


def _event_type_for(status: str) -> str:
    """Map a target status to the webhook event name (FR-011)."""
    return {
        "published": "post.published",
        "failed": "post.failed",
        "retrying": "post.retrying",
    }.get(status, "post.updated")


class PublisherService:
    """Orchestration service for publishing posts to social platforms.

    Coordinates validation, adapter calls, database updates, and status tracking.

    Example:
        >>> publisher = PublisherService()
        >>> result = await publisher.publish(
        ...     request=PublishRequest(...),
        ...     workspace_id="ws_001",
        ...     db=session,
        ... )
        >>> result.post_id
        'post_abc123'

    """

    def __init__(self) -> None:
        """Initialize publisher service."""
        # Register default adapters
        # These will be registered when app starts
        pass

    def register_adapters(self) -> None:
        """Register all available platform adapters.

        Should be called on application startup.
        """
        from app.adapters.dryrun import DryRunAdapter

        # Register DryRun adapter for testing
        if not ADAPTER_REGISTRY.is_registered("dryrun"):
            ADAPTER_REGISTRY.register("dryrun", DryRunAdapter)

    async def publish(
        self,
        request: PublishRequest,
        workspace_id: str,
        brand_id: str,
        db: AsyncSession,
    ) -> dict[str, Any]:
        """Execute publish workflow for a request.

        This is the main entry point for immediate publishing.

        Args:
            request: Validated publish request
            workspace_id: Workspace identifier
            brand_id: Brand identifier
            db: Database session

        Returns:
            Dict with job details including:
                - post_id
                - workspace_id
                - idempotency_key
                - status
                - scheduled_at
                - created_at
                - updated_at
                - published_at
                - targets (list of target statuses)

        Raises:
            ValueError: If request validation fails

        """
        # Check idempotency - return existing post if found
        existing_post = await self._check_idempotency(
            workspace_id=workspace_id,
            idempotency_key=request.idempotency_key,
            db=db,
        )

        if existing_post:
            return await self._build_job_response(existing_post, db)

        # Create post record
        post_id = str(uuid4())
        now = datetime.now(UTC)

        post = Post(
            id=post_id,
            workspace_id=workspace_id,
            brand_id=brand_id,
            idempotency_key=request.idempotency_key,
            status="pending",
            scheduled_at=request.scheduled_at,
            created_at=now,
            updated_at=now,
        )
        db.add(post)

        # Create post targets (one per account)
        targets = []
        for target_req in request.targets:
            target_id = str(uuid4())

            # Get account to determine platform (workspace-scoped — a request
            # can never resolve another workspace's account; FR-MT-03)
            account = await self._get_account(target_req.account_id, workspace_id, db)

            target = PostTarget(
                id=target_id,
                post_id=post_id,
                account_id=target_req.account_id,
                status="pending",
                content=target_req.content.model_dump(),
                attempts=0,
                max_attempts=5,
                created_at=now,
                updated_at=now,
            )
            db.add(target)
            targets.append((target, target_req, account))

        try:
            await db.commit()
        except IntegrityError:
            # Concurrent duplicate idempotency_key: the unique constraint won
            # the race → surface as 409, not a 500 (FR-MT-09).
            await db.rollback()
            raise DuplicatePostError(
                f"Duplicate idempotency_key: {request.idempotency_key}"
            ) from None
        await db.refresh(post)

        # Record initial "queued" event
        await self._record_delivery_log(
            post_id=post_id,
            post_target_id=None,
            workspace_id=workspace_id,
            event_type="queued",
            http_status=None,
            error_message=None,
            db=db,
        )

        # Queue-first (T067): dispatch each target to the worker queue instead
        # of blocking the HTTP handler on platform API calls. The Celery worker
        # (`process_target`) performs the actual publish; delivery status flows
        # back via webhooks / GET /jobs/{id}. In eager (test) mode the task runs
        # synchronously here, so the reload below reflects the published state.
        for target, _target_req, _account in targets:
            process_target.delay(target.id)

        # Reload post with targets for response
        await db.refresh(post, ["targets"])

        # Compute post status from target statuses
        post = await self._compute_post_status(post, db)

        return await self._build_job_response(post, db)

    async def schedule(
        self,
        request: PublishRequest,
        workspace_id: str,
        brand_id: str,
        db: AsyncSession,
    ) -> dict[str, Any]:
        """Schedule a post for future publishing without executing targets.

        Creates the post record with status='pending' and leaves it for
        the Celery beat scheduler to claim and publish at the scheduled time.

        Args:
            request: Validated publish request with scheduled_at
            workspace_id: Workspace identifier
            brand_id: Brand identifier
            db: Database session

        Returns:
            Dict with job details (status='pending')

        """
        # Check idempotency
        existing_post = await self._check_idempotency(
            workspace_id=workspace_id,
            idempotency_key=request.idempotency_key,
            db=db,
        )

        if existing_post:
            return await self._build_job_response(existing_post, db)

        # Create post record
        post_id = str(uuid4())
        now = datetime.now(UTC)

        post = Post(
            id=post_id,
            workspace_id=workspace_id,
            brand_id=brand_id,
            idempotency_key=request.idempotency_key,
            status="pending",
            scheduled_at=request.scheduled_at,
            created_at=now,
            updated_at=now,
        )
        db.add(post)

        # Create post targets (one per account) — leave as "pending"
        for target_req in request.targets:
            target_id = str(uuid4())
            target = PostTarget(
                id=target_id,
                post_id=post_id,
                account_id=target_req.account_id,
                status="pending",
                content=target_req.content.model_dump(),
                attempts=0,
                max_attempts=5,
                created_at=now,
                updated_at=now,
            )
            db.add(target)

        try:
            await db.commit()
        except IntegrityError:
            # Concurrent duplicate idempotency_key → 409 (FR-MT-09)
            await db.rollback()
            raise DuplicatePostError(
                f"Duplicate idempotency_key: {request.idempotency_key}"
            ) from None
        await db.refresh(post)

        # Record "scheduled" event
        await self._record_delivery_log(
            post_id=post_id,
            post_target_id=None,
            workspace_id=workspace_id,
            event_type="scheduled",
            http_status=None,
            error_message=None,
            db=db,
        )

        # Reload with targets
        await db.refresh(post, ["targets"])

        return await self._build_job_response(post, db)

    async def _check_idempotency(
        self,
        workspace_id: str,
        idempotency_key: str,
        db: AsyncSession,
    ) -> Post | None:
        """Check if a post with this idempotency key already exists.

        Args:
            workspace_id: Workspace identifier
            idempotency_key: Unique key for deduplication
            db: Database session

        Returns:
            Existing Post if found, None otherwise

        """
        stmt = select(Post).where(
            Post.workspace_id == workspace_id,
            Post.idempotency_key == idempotency_key,
        )
        result = await db.execute(stmt)
        return result.scalar_one_or_none()

    async def _get_account(
        self,
        account_id: str,
        workspace_id: str,
        db: AsyncSession,
    ) -> Account:
        """Get an account by ID, scoped to the owning workspace.

        Args:
            account_id: Account identifier
            workspace_id: Workspace that must own the account (tenant isolation)
            db: Database session

        Returns:
            Account if found

        Raises:
            ValueError: If account not found, not active, or not in this workspace

        """
        stmt = select(Account).where(
            Account.id == account_id,
            Account.workspace_id == workspace_id,
        )
        result = await db.execute(stmt)
        account = result.scalar_one_or_none()

        if not account:
            raise ValueError(f"Account not found in this workspace: {account_id}")

        if account.status != "active":
            raise ValueError(f"Account is not active: {account_id}")

        return account

    async def _publish_targets(  # noqa: C901
        self,
        post: Post,
        targets: list[tuple[PostTarget, PublishTarget, Account]],
        db: AsyncSession,
    ) -> None:
        """Publish content to each target.

        Args:
            post: Post record
            targets: List of (PostTarget, PublishTarget, Account) tuples
            db: Database session

        """
        now = datetime.now(UTC)

        for target, target_req, account in targets:
            # Update target status to publishing
            target.status = "publishing"
            target.attempts += 1
            target.updated_at = now

            # Record publishing event
            await self._record_delivery_log(
                post_id=post.id,
                post_target_id=target.id,
                workspace_id=post.workspace_id,
                event_type="publishing",
                http_status=None,
                error_message=None,
                db=db,
            )

            # Get adapter for platform
            try:
                adapter = self._get_adapter(account.platform)
            except KeyError:
                error_msg = f"Unknown platform: {account.platform}"
                await self._handle_publish_error(
                    target=target,
                    error_msg=error_msg,
                    error_category="fatal",
                    db=db,
                )
                continue

            # Convert schema content to the adapter content contract before
            # validation so adapters never see the API schema type.
            adapter_content = PublishContent(
                text=target_req.content.text,
                media_urls=target_req.content.media_urls,
                metadata=target_req.content.metadata,
            )

            # Validate content
            try:
                adapter.validate_content(adapter_content)
            except ValueError as e:
                await self._handle_publish_error(
                    target=target,
                    error_msg=str(e),
                    error_category="fatal",
                    db=db,
                )
                continue

            # Publish via adapter — with the real (decrypted) OAuth token and
            # author identity (FR-MT-03). The old code passed
            # ``platform_account_id`` as the token, so adapters never saw a
            # usable credential.
            try:
                # For now, use DryRun if no real adapter
                from app.adapters.dryrun import DryRunAdapter

                if not ADAPTER_REGISTRY.is_registered(account.platform):
                    adapter = DryRunAdapter()

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
                        raise ValueError(
                            "Instagram account is missing ig_user_id metadata; re-connect the account"
                        )
                    token = f"{ig_user_id}|{token}"

                result = await adapter.publish(
                    content=adapter_content,
                    account_id=token,
                    author_urn=author_urn,
                )

                # Handle result
                if result.is_success():
                    target.status = "published"
                    target.platform_post_id = result.platform_post_id
                    target.platform_post_url = result.platform_post_url
                    target.published_at = now
                    target.error_category = None
                    target.last_error = None
                else:
                    target.error_category = result.error.category.value if result.error else None
                    target.last_error = result.error.message if result.error else None
                    target.status = "failed" if not result.retryable else "retrying"

                    # Schedule retry if applicable
                    if result.retryable:
                        from datetime import timedelta

                        target.next_attempt_at = now + timedelta(
                            seconds=60 * (2 ** (target.attempts - 1))
                        )

            except Exception as e:
                await self._handle_publish_error(
                    target=target,
                    error_msg=str(e),
                    error_category="transient",
                    db=db,
                )
                await self._deliver_target_webhook(post, target)
                continue

            await db.commit()
            await db.refresh(target)
            await self._deliver_target_webhook(post, target)

    async def _deliver_target_webhook(self, post: Post, target: PostTarget) -> None:
        """Deliver a workspace-scoped webhook for a target outcome (FR-011).

        Runs the sync webhook client in a worker thread so the async event
        loop is never blocked. Webhook failures are logged, never fatal.
        """
        if target.status not in ("published", "failed", "retrying"):
            return
        try:
            await asyncio.to_thread(
                WebhookService().deliver_event,
                post.workspace_id,
                _event_type_for(target.status),
                {
                    "post_id": post.id,
                    "target_id": target.id,
                    "status": target.status,
                    "platform_post_id": target.platform_post_id,
                },
            )
        except Exception as e:  # noqa: BLE001 - webhooks must not break publishing
            logger.error(
                "Webhook delivery failed for post %s target %s: %s",
                post.id,
                target.id,
                e,
            )

    async def _handle_publish_error(
        self,
        target: PostTarget,
        error_msg: str,
        error_category: str,
        db: AsyncSession,
    ) -> None:
        """Handle publish error.

        Args:
            target: PostTarget record
            error_msg: Error message
            error_category: Error category (transient, auth, fatal, etc.)
            db: Database session

        """
        now = datetime.now(UTC)

        target.status = "failed"
        target.error_category = error_category
        target.last_error = error_msg
        target.updated_at = now

        # Record failure event
        await self._record_delivery_log(
            post_id=target.post_id,
            post_target_id=target.id,
            workspace_id=target.post.workspace_id if target.post else "",
            event_type="failed",
            http_status=None,
            error_message=error_msg,
            db=db,
        )

    async def _compute_post_status(self, post: Post, db: AsyncSession) -> Post:
        """Compute post status from target statuses.

        Args:
            post: Post record with loaded targets
            db: Database session

        Returns:
            Updated post with computed status

        """
        now = datetime.now(UTC)

        # Reload targets
        stmt = select(PostTarget).where(PostTarget.post_id == post.id)
        result = await db.execute(stmt)
        targets = result.scalars().all()

        # Compute status
        published_count = sum(1 for t in targets if t.status == "published")
        failed_count = sum(1 for t in targets if t.status == "failed")
        pending_count = sum(1 for t in targets if t.status == "pending")
        retrying_count = sum(1 for t in targets if t.status == "retrying")
        publishing_count = sum(1 for t in targets if t.status == "publishing")

        if publishing_count > 0 or retrying_count > 0 or pending_count > 0:
            post.status = "publishing"
        elif failed_count == len(targets):
            post.status = "failed"
        elif published_count > 0 and failed_count > 0:
            post.status = "partial_failed"
        elif published_count == len(targets):
            post.status = "published"
            post.published_at = now
        else:
            post.status = "pending"

        post.updated_at = now
        await db.commit()
        await db.refresh(post)

        return post

    async def _record_delivery_log(
        self,
        post_id: str,
        post_target_id: str | None,
        workspace_id: str,
        event_type: str,
        http_status: int | None,
        error_message: str | None,
        db: AsyncSession,
    ) -> None:
        """Record a delivery log entry.

        Args:
            post_id: Post ID
            post_target_id: Target ID (if applicable)
            workspace_id: Workspace ID
            event_type: Event type (queued, publishing, published, failed, retrying)
            http_status: HTTP status code (if applicable)
            error_message: Error message (if applicable)
            db: Database session

        """
        log = DeliveryLog(
            id=str(uuid4()),
            post_id=post_id,
            post_target_id=post_target_id,
            workspace_id=workspace_id,
            event_type=event_type,
            http_status=http_status,
            error_message=error_message,
            created_at=datetime.now(UTC),
        )
        db.add(log)
        await db.commit()

    def _get_adapter(self, platform: str) -> BaseAdapter:
        """Get adapter for platform.

        Args:
            platform: Platform name

        Returns:
            Adapter instance

        Raises:
            KeyError: If platform not registered

        """
        adapter_class = ADAPTER_REGISTRY.get(platform)
        return adapter_class()

    async def _build_job_response(
        self,
        post: Post,
        db: AsyncSession,
    ) -> dict[str, Any]:
        """Build job response dict from post.

        Args:
            post: Post record
            db: Database session

        Returns:
            Job response dict

        """
        # Load targets
        stmt = select(PostTarget).where(PostTarget.post_id == post.id)
        result = await db.execute(stmt)
        targets = result.scalars().all()

        # Resolve each target's real platform from its account (FR-MT-10).
        # The old code hardcoded "dryrun", which mislabeled every job.
        platform_map: dict[str, str] = {}
        if targets:
            account_stmt = select(Account.id, Account.platform).where(
                Account.id.in_([t.account_id for t in targets])
            )
            account_result = await db.execute(account_stmt)
            platform_map = {row[0]: row[1] for row in account_result.all()}

        # Build targets list
        targets_list = []
        for target in targets:
            targets_list.append(
                {
                    "target_id": target.id,
                    "account_id": target.account_id,
                    "platform": platform_map.get(target.account_id, "unknown"),
                    "status": target.status,
                    "platform_post_id": target.platform_post_id,
                    "platform_post_url": target.platform_post_url,
                    "attempts": target.attempts,
                    "max_attempts": target.max_attempts,
                    "next_attempt_at": target.next_attempt_at.isoformat()
                    if target.next_attempt_at
                    else None,
                    "error_category": target.error_category,
                    "last_error": target.last_error,
                    "created_at": target.created_at.isoformat() if target.created_at else None,
                    "updated_at": target.updated_at.isoformat() if target.updated_at else None,
                    "published_at": target.published_at.isoformat()
                    if target.published_at
                    else None,
                }
            )

        return {
            "job_id": post.id,
            "workspace_id": post.workspace_id,
            "idempotency_key": post.idempotency_key,
            "status": post.status,
            "scheduled_at": post.scheduled_at.isoformat() if post.scheduled_at else None,
            "created_at": post.created_at.isoformat() if post.created_at else None,
            "updated_at": post.updated_at.isoformat() if post.updated_at else None,
            "published_at": post.published_at.isoformat() if post.published_at else None,
            "targets": targets_list,
        }
