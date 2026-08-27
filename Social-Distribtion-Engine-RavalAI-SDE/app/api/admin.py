"""Admin endpoints for multi-tenant key management (ADR-0001).

The RavalAI platform mints one API key per workspace at onboarding; the SDE
stores only the SHA-256 hash. This router is gated by the global
``SDE_API_TOKEN`` (ops only) — workspace traffic itself uses per-workspace keys.
"""

from __future__ import annotations

import hashlib
import secrets
from datetime import UTC, datetime
from uuid import uuid4

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db, verify_api_token
from app.models import ApiKey

router = APIRouter(prefix="/api/v1/admin", tags=["admin"])


class CreateApiKeyRequest(BaseModel):
    """Request to mint a new per-workspace API key."""

    workspace_id: str = Field(..., min_length=1, max_length=64)
    brand_id: str = Field(..., min_length=1, max_length=64)
    label: str = Field(default="default", max_length=128)


class CreateApiKeyResponse(BaseModel):
    """Response containing the one-time raw key and its metadata."""

    api_key_id: str
    workspace_id: str
    brand_id: str
    api_key: str  # Shown once at creation; only the hash is stored.
    label: str
    created_at: datetime


@router.post(
    "/api-keys",
    response_model=CreateApiKeyResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a per-workspace API key",
    description=(
        "Mint a new API key for a workspace. The raw key is returned exactly "
        "once; only its SHA-256 hash is stored. Gated by the global "
        "SDE_API_TOKEN (ops only)."
    ),
)
async def create_api_key(
    request: CreateApiKeyRequest,
    token: str = Depends(verify_api_token),  # noqa: ARG001
    db: AsyncSession = Depends(get_db),
) -> CreateApiKeyResponse:
    """Create and persist a new workspace API key.

    Args:
        request: Workspace/brand the key belongs to.
        token: Validated global ops token (dependency).
        db: Database session.

    Returns:
        CreateApiKeyResponse with the raw key (shown once).

    """
    raw_key = secrets.token_urlsafe(32)
    key_hash = hashlib.sha256(raw_key.encode("utf-8")).hexdigest()
    now = datetime.now(UTC)

    api_key = ApiKey(
        id=str(uuid4()),
        workspace_id=request.workspace_id,
        brand_id=request.brand_id,
        key_hash=key_hash,
        label=request.label,
        created_at=now,
    )
    db.add(api_key)
    await db.commit()
    await db.refresh(api_key)

    return CreateApiKeyResponse(
        api_key_id=api_key.id,
        workspace_id=api_key.workspace_id,
        brand_id=api_key.brand_id,
        api_key=raw_key,
        label=api_key.label,
        created_at=api_key.created_at,
    )
