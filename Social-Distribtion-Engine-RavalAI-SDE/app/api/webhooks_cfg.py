"""Webhook configuration API endpoints for registering and managing webhooks."""

from __future__ import annotations

from datetime import UTC

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import WorkspaceContext, get_current_workspace, get_db
from app.models import WebhookEndpoint
from app.schemas import WebhookConfigRequest, WebhookEndpointResponse

router = APIRouter(prefix="/api/v1/webhooks", tags=["webhooks"])


@router.post(
    "/config",
    response_model=WebhookEndpointResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Register a webhook endpoint",
    description=(
        "Register a URL to receive event notifications. "
        "Events like post.published and post.failed will be sent "
        "to this URL with HMAC-SHA256 signatures."
    ),
    responses={
        201: {"description": "Webhook registered successfully"},
        400: {"description": "Invalid webhook URL"},
        401: {"description": "Unauthorized"},
        409: {"description": "Webhook already registered for this URL"},
    },
)
async def register_webhook(
    request: WebhookConfigRequest,
    workspace: WorkspaceContext = Depends(get_current_workspace),
    db: AsyncSession = Depends(get_db),
) -> WebhookEndpointResponse:
    """Register a new webhook endpoint.

    Args:
        request: Webhook configuration (URL + optional secret)
        workspace: Authenticated workspace
        db: Database session

    Returns:
        WebhookEndpointResponse with the registered webhook details.

    """
    # Check if URL already registered
    stmt = select(WebhookEndpoint).where(
        WebhookEndpoint.workspace_id == workspace.workspace_id,
        WebhookEndpoint.url == request.url,
    )
    result = await db.execute(stmt)
    existing = result.scalar_one_or_none()

    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Webhook already registered: {request.url}",
        )

    # Create webhook
    import uuid
    from datetime import datetime

    from app.config import get_settings

    secret = request.secret or get_settings().WEBHOOK_DEFAULT_SECRET

    webhook = WebhookEndpoint(
        id=str(uuid.uuid4()),
        workspace_id=workspace.workspace_id,
        url=request.url,
        secret=secret,
        status="active",
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )
    db.add(webhook)
    await db.commit()
    await db.refresh(webhook)

    return WebhookEndpointResponse(
        webhook_id=webhook.id,
        workspace_id=webhook.workspace_id,
        url=webhook.url,
        status=webhook.status,
        created_at=webhook.created_at,
        updated_at=webhook.updated_at,
    )


@router.get(
    "/config",
    response_model=list[WebhookEndpointResponse],
    summary="List registered webhooks",
    description="List all webhook endpoints registered for the current workspace.",
    responses={
        200: {"description": "Webhooks listed successfully"},
        401: {"description": "Unauthorized"},
    },
)
async def list_webhooks(
    workspace: WorkspaceContext = Depends(get_current_workspace),
    db: AsyncSession = Depends(get_db),
) -> list[WebhookEndpointResponse]:
    """List all webhook endpoints for the current workspace.

    Args:
        workspace: Authenticated workspace
        db: Database session

    Returns:
        List of WebhookEndpointResponse objects.

    """
    stmt = select(WebhookEndpoint).where(
        WebhookEndpoint.workspace_id == workspace.workspace_id,
    )
    result = await db.execute(stmt)
    webhooks = result.scalars().all()

    return [
        WebhookEndpointResponse(
            webhook_id=wh.id,
            workspace_id=wh.workspace_id,
            url=wh.url,
            status=wh.status,
            created_at=wh.created_at,
            updated_at=wh.updated_at,
        )
        for wh in webhooks
    ]


@router.delete(
    "/config/{webhook_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Disable a webhook endpoint",
    description=("Disable a webhook endpoint. It will no longer receive event notifications."),
    responses={
        204: {"description": "Webhook disabled successfully"},
        401: {"description": "Unauthorized"},
        404: {"description": "Webhook not found"},
    },
)
async def disable_webhook(
    webhook_id: str,
    workspace: WorkspaceContext = Depends(get_current_workspace),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Disable a webhook endpoint.

    Args:
        webhook_id: Webhook endpoint ID
        workspace: Authenticated workspace
        db: Database session

    """
    stmt = select(WebhookEndpoint).where(
        WebhookEndpoint.id == webhook_id,
        WebhookEndpoint.workspace_id == workspace.workspace_id,
    )
    result = await db.execute(stmt)
    webhook = result.scalar_one_or_none()

    if not webhook:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Webhook not found: {webhook_id}",
        )

    from datetime import datetime

    webhook.status = "disabled"
    webhook.updated_at = datetime.now(UTC)
    await db.commit()
