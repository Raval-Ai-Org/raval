"""Job status and management API endpoints."""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import WorkspaceContext, get_current_workspace, get_db
from app.models import Account, DeliveryLog, Post, PostTarget
from app.schemas import JobResponse

router = APIRouter(prefix="/api/v1/jobs", tags=["jobs"])


@router.get(
    "/{job_id}",
    response_model=JobResponse,
    summary="Get job details",
    description=(
        "Retrieve full details of a publish job including "
        "all targets, delivery status, and timeline."
    ),
    responses={
        200: {"description": "Job details retrieved successfully"},
        401: {"description": "Unauthorized"},
        404: {"description": "Job not found"},
    },
)
async def get_job(
    job_id: str,
    workspace: WorkspaceContext = Depends(get_current_workspace),
    db: AsyncSession = Depends(get_db),
) -> JobResponse:
    """Get full details of a publish job.

    Args:
        job_id: UUID of the job
        workspace: Authenticated workspace context
        db: Database session

    Returns:
        JobResponse with full job details and timeline

    Example:
        GET /api/v1/jobs/post_abc123

    """
    # Fetch post with targets loaded
    stmt = (
        select(Post)
        .options(selectinload(Post.targets))
        .where(
            Post.id == job_id,
            Post.workspace_id == workspace.workspace_id,
        )
    )
    result = await db.execute(stmt)
    post = result.scalar_one_or_none()

    if not post:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Job not found: {job_id}",
        )

    # Fetch delivery logs (timeline)
    timeline_stmt = (
        select(DeliveryLog).where(DeliveryLog.post_id == job_id).order_by(DeliveryLog.created_at)
    )
    timeline_result = await db.execute(timeline_stmt)
    timeline = timeline_result.scalars().all()

    # Resolve each target's real platform from its account (FR-MT-10)
    platform_map: dict[str, str] = {}
    if post.targets:
        account_stmt = select(Account.id, Account.platform).where(
            Account.id.in_([t.account_id for t in post.targets])
        )
        account_result = await db.execute(account_stmt)
        platform_map = {row[0]: row[1] for row in account_result.all()}

    # Build response
    targets_list = []
    for target in post.targets:
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
                "next_attempt_at": _format_dt(target.next_attempt_at),
                "error_category": target.error_category,
                "last_error": target.last_error,
                "created_at": _format_dt(target.created_at),
                "updated_at": _format_dt(target.updated_at),
                "published_at": _format_dt(target.published_at),
            }
        )

    # Build timeline
    timeline_list = [
        {
            "event_type": log.event_type,
            "created_at": _format_dt(log.created_at),
            "details": {
                "http_status": log.http_status,
                "error_message": log.error_message,
            }
            if log.http_status or log.error_message
            else None,
        }
        for log in timeline
    ]

    return JobResponse(
        job_id=post.id,
        workspace_id=post.workspace_id,
        idempotency_key=post.idempotency_key,
        status=post.status,
        scheduled_at=_format_dt(post.scheduled_at),
        created_at=_format_dt(post.created_at),
        updated_at=_format_dt(post.updated_at),
        published_at=_format_dt(post.published_at),
        targets=targets_list,
        timeline=timeline_list,
    )


@router.get(
    "",
    response_model=list[JobResponse],
    summary="List jobs",
    description=(
        "List publish jobs with optional filters. "
        "Supports filtering by status, date range, and pagination."
    ),
    responses={
        200: {"description": "Jobs listed successfully"},
        401: {"description": "Unauthorized"},
    },
)
async def list_jobs(
    status_filter: str | None = Query(None, alias="status", description="Filter by post status"),
    limit: int = Query(20, ge=1, le=100, description="Max jobs to return"),
    offset: int = Query(0, ge=0, description="Number of jobs to skip"),
    workspace: WorkspaceContext = Depends(get_current_workspace),
    db: AsyncSession = Depends(get_db),
) -> list[JobResponse]:
    """List publish jobs with optional filtering.

    Args:
        status_filter: Optional status filter (published, pending, failed, etc.)
        limit: Max results (1-100, default 20)
        offset: Pagination offset
        workspace: Authenticated workspace context
        db: Database session

    Returns:
        List of JobResponse objects

    Example:
        GET /api/v1/jobs?status=published&limit=10
        GET /api/v1/jobs?offset=20&limit=50

    """
    # Build query
    conditions = [Post.workspace_id == workspace.workspace_id]

    if status_filter:
        conditions.append(Post.status == status_filter)

    stmt = (
        select(Post)
        .options(selectinload(Post.targets))
        .where(and_(*conditions))
        .order_by(Post.created_at.desc())
        .offset(offset)
        .limit(limit)
    )

    result = await db.execute(stmt)
    posts = result.scalars().all()

    # Resolve real platform per account across all returned posts (FR-MT-10)
    all_account_ids = {t.account_id for post in posts for t in post.targets}
    platform_map: dict[str, str] = {}
    if all_account_ids:
        account_stmt = select(Account.id, Account.platform).where(Account.id.in_(all_account_ids))
        account_result = await db.execute(account_stmt)
        platform_map = {row[0]: row[1] for row in account_result.all()}

    # Build responses
    responses = []
    for post in posts:
        targets_list = []
        for target in post.targets:
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
                    "next_attempt_at": _format_dt(target.next_attempt_at),
                    "error_category": target.error_category,
                    "last_error": target.last_error,
                    "created_at": _format_dt(target.created_at),
                    "updated_at": _format_dt(target.updated_at),
                    "published_at": _format_dt(target.published_at),
                }
            )

        responses.append(
            JobResponse(
                job_id=post.id,
                workspace_id=post.workspace_id,
                idempotency_key=post.idempotency_key,
                status=post.status,
                scheduled_at=_format_dt(post.scheduled_at),
                created_at=_format_dt(post.created_at),
                updated_at=_format_dt(post.updated_at),
                published_at=_format_dt(post.published_at),
                targets=targets_list,
            )
        )

    return responses


@router.delete(
    "/{job_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Cancel a pending job",
    description=("Cancel a pending or publishing job. Already published jobs cannot be cancelled."),
    responses={
        204: {"description": "Job cancelled successfully"},
        400: {"description": "Job is already published / cannot be cancelled"},
        401: {"description": "Unauthorized"},
        404: {"description": "Job not found"},
    },
)
async def cancel_job(
    job_id: str,
    workspace: WorkspaceContext = Depends(get_current_workspace),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Cancel a pending or publishing job.

    Args:
        job_id: UUID of the job to cancel
        workspace: Authenticated workspace context
        db: Database session

    Raises:
        HTTPException 404: If job not found
        HTTPException 400: If job cannot be cancelled (already published)

    Example:
        DELETE /api/v1/jobs/post_abc123

    """
    # Fetch post
    stmt = select(Post).where(
        Post.id == job_id,
        Post.workspace_id == workspace.workspace_id,
    )
    result = await db.execute(stmt)
    post = result.scalar_one_or_none()

    if not post:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Job not found: {job_id}",
        )

    # Check if cancellable
    if post.status in ("published", "failed"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot cancel job with status: {post.status}",
        )

    # Cancel the job
    now = datetime.now(UTC)
    post.status = "cancelled"
    post.updated_at = now

    # Cancel all pending targets
    targets_stmt = select(PostTarget).where(
        PostTarget.post_id == job_id,
        PostTarget.status.in_(["pending", "publishing", "retrying"]),
    )
    targets_result = await db.execute(targets_stmt)
    targets = targets_result.scalars().all()

    for target in targets:
        target.status = "cancelled"
        target.updated_at = now

    # Record cancellation event in delivery logs
    from app.models import DeliveryLog

    log = DeliveryLog(
        id=str(__import__("uuid").uuid4()),
        post_id=job_id,
        post_target_id=None,
        workspace_id=workspace.workspace_id,
        event_type="cancelled",
        error_message="Job cancelled by user",
        created_at=now,
    )
    db.add(log)

    await db.commit()


def _format_dt(dt: datetime | None) -> str | None:
    """Format datetime to ISO string.

    Args:
        dt: Datetime to format

    Returns:
        ISO formatted string or None

    """
    if dt is None:
        return None
    return dt.isoformat()
