"""Publish API endpoints for immediate and scheduled publishing."""

from __future__ import annotations

from datetime import UTC

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import WorkspaceContext, get_current_workspace, get_db
from app.schemas import JobResponse, PublishRequest
from app.services.publisher import DuplicatePostError, PublisherService

router = APIRouter(prefix="/api/v1", tags=["publish"])


@router.post(
    "/publish",
    response_model=JobResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Publish immediately",
    description=(
        "Publish a post immediately to one or more platforms. "
        "The post will be published right away using the specified accounts."
    ),
    responses={
        201: {"description": "Post published successfully"},
        400: {"description": "Invalid request (validation error)"},
        401: {"description": "Unauthorized (invalid or missing token)"},
        409: {"description": "Conflict (duplicate idempotency key)"},
        422: {"description": "Validation error (invalid content)"},
        500: {"description": "Internal server error"},
    },
)
async def publish_immediate(
    request: PublishRequest,
    workspace: WorkspaceContext = Depends(get_current_workspace),
    db: AsyncSession = Depends(get_db),
) -> JobResponse:
    """Publish a post immediately.

    Args:
        request: Publish request with content and targets
        workspace: Authenticated workspace context
        db: Database session

    Returns:
        JobResponse with job_id and status details

    Example:
        ```json
        {
          "job_id": "post_abc123",
          "workspace_id": "workspace_001",
          "idempotency_key": "unique-key-123",
          "status": "published",
          "targets": [...]
        }
        ```
    """
    # Validate scheduled_at is not in the future for immediate publish
    if request.scheduled_at is not None:
        from datetime import datetime, timedelta

        now = datetime.now(UTC)
        if request.scheduled_at > now + timedelta(seconds=10):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Use /schedule endpoint for future posts",
            )

    # Create publisher and publish
    publisher = PublisherService()
    publisher.register_adapters()

    try:
        result = await publisher.publish(
            request=request,
            workspace_id=workspace.workspace_id,
            brand_id=workspace.brand_id,
            db=db,
        )
        return JobResponse(**result)
    except DuplicatePostError as e:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(e),
        ) from e
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        ) from e


@router.post(
    "/schedule",
    response_model=JobResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Schedule a post for future publishing",
    description=(
        "Schedule a post to be published at a specific time in the future. "
        "The post will be queued and published when the scheduled time is reached."
    ),
    responses={
        201: {"description": "Post scheduled successfully"},
        400: {"description": "Invalid request (past time or validation error)"},
        401: {"description": "Unauthorized"},
        409: {"description": "Conflict (duplicate idempotency key)"},
        422: {"description": "Validation error"},
    },
)
async def schedule_post(
    request: PublishRequest,
    workspace: WorkspaceContext = Depends(get_current_workspace),
    db: AsyncSession = Depends(get_db),
) -> JobResponse:
    """Schedule a post for future publishing.

    Args:
        request: Publish request with content, targets, and scheduled_at
        workspace: Authenticated workspace context
        db: Database session

    Returns:
        JobResponse with job_id and scheduled status

    Example:
        ```json
        {
          "job_id": "post_abc123",
          "workspace_id": "workspace_001",
          "idempotency_key": "unique-key-123",
          "status": "pending",
          "scheduled_at": "2026-07-28T10:00:00Z",
          "targets": [...]
        }
        ```
    """
    from datetime import datetime

    now = datetime.now(UTC)

    # Validate scheduled_at is in the future
    if request.scheduled_at is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="scheduled_at is required for /schedule endpoint",
        )

    if request.scheduled_at <= now:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="scheduled_at must be in the future",
        )

    # Validate scheduled_at is not too far in the future (max 1 year)
    from datetime import timedelta

    if request.scheduled_at > now + timedelta(days=365):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="scheduled_at cannot be more than 1 year in the future",
        )

    # Create publisher and schedule (don't publish targets yet)
    publisher = PublisherService()
    publisher.register_adapters()

    try:
        result = await publisher.schedule(
            request=request,
            workspace_id=workspace.workspace_id,
            brand_id=workspace.brand_id,
            db=db,
        )
        return JobResponse(**result)
    except DuplicatePostError as e:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(e),
        ) from e
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        ) from e
