"""FastAPI dependency injection for authentication, database, and workspace context."""

from __future__ import annotations

from collections.abc import AsyncGenerator
from datetime import UTC

from fastapi import Header, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_async_db
from app.security import InvalidTokenError, validate_bearer_token


class WorkspaceContext:
    """Context object containing workspace and user information.

    Passed to route handlers via Depends(get_current_workspace).
    """

    def __init__(
        self,
        workspace_id: str,
        brand_id: str,
        user_id: str | None = None,
    ):
        """Initialize a workspace context."""
        self.workspace_id = workspace_id
        self.brand_id = brand_id
        self.user_id = user_id or "default_user"

    def __repr__(self) -> str:
        return (
            f"WorkspaceContext("
            f"workspace_id={self.workspace_id!r}, "
            f"brand_id={self.brand_id!r}, "
            f"user_id={self.user_id!r})"
        )


async def get_current_workspace(
    authorization: str | None = Header(None),
) -> WorkspaceContext:
    """Extract and validate workspace context from Authorization header.

    Validates Bearer token and extracts workspace information.
    Used as FastAPI dependency: @app.get("/...") def route(..., workspace = Depends(get_current_workspace))

    Args:
        authorization: Authorization header value (e.g., "Bearer token123")

    Returns:
        WorkspaceContext with workspace_id, brand_id, user_id

    Raises:
        HTTPException 401: If token is missing or invalid

    Example:
        @app.post("/api/v1/publish")
        async def publish(
            request: PublishRequest,
            workspace: WorkspaceContext = Depends(get_current_workspace),
        ):
            print(workspace.workspace_id)  # "workspace_001"

    """
    token = _extract_bearer_token(authorization)

    from app.config import get_settings

    settings = get_settings()

    # Ops/dev path: the single global SDE_API_TOKEN maps to the default
    # workspace (retained for ops and local development, ADR-0001).
    if token == settings.SDE_API_TOKEN:
        return WorkspaceContext(
            workspace_id=settings.DEFAULT_WORKSPACE_ID,
            brand_id=settings.DEFAULT_BRAND_ID,
            user_id="default_user",
        )

    # Multi-tenant path: hash the presented key and resolve its workspace.
    # Only the SHA-256 hash is stored; the raw key is never persisted.
    import hashlib
    from datetime import datetime

    from sqlalchemy import select

    from app.database import get_async_session_maker
    from app.models import ApiKey

    key_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
    maker = get_async_session_maker()
    async with maker() as session:
        result = await session.execute(
            select(ApiKey).where(
                ApiKey.key_hash == key_hash,
                ApiKey.revoked_at.is_(None),
            )
        )
        api_key = result.scalar_one_or_none()
        if api_key is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid or expired API key",
                headers={"WWW-Authenticate": "Bearer"},
            )
        api_key.last_used_at = datetime.now(UTC)
        await session.commit()
        return WorkspaceContext(
            workspace_id=api_key.workspace_id,
            brand_id=api_key.brand_id,
            user_id="api_key",
        )


def _extract_bearer_token(authorization: str | None) -> str:
    """Extract the raw bearer token from the Authorization header.

    Args:
        authorization: Authorization header value (e.g. ``Bearer <token>``).

    Returns:
        The raw token string.

    Raises:
        HTTPException 401: If the header is missing or malformed.

    """
    if not authorization:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing Authorization header",
            headers={"WWW-Authenticate": "Bearer"},
        )

    parts = authorization.split()
    if len(parts) != 2 or parts[0].lower() != "bearer":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid Authorization header format. Expected: Bearer <token>",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return parts[1]


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """FastAPI dependency providing async database session.

    Automatically closes session after route handler completes.

    Usage:
        @app.get("/...")
        async def route(db: AsyncSession = Depends(get_db)):
            result = await db.query(Post).first()

    Yields:
        AsyncSession for database operations

    """
    async for session in get_async_db():
        yield session


async def verify_api_token(
    authorization: str | None = Header(None),
) -> str:
    """Verify API token without extracting workspace context.

    Simpler version of get_current_workspace when you only need token validation.

    Args:
        authorization: Authorization header

    Returns:
        The validated token

    Raises:
        HTTPException 401: If token is invalid

    Example:
        @app.post("/api/v1/internal/task")
        async def internal_task(
            token: str = Depends(verify_api_token),
        ):
            print(f"Authenticated: {token}")

    """
    try:
        return validate_bearer_token(authorization)
    except InvalidTokenError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(e),
            headers={"WWW-Authenticate": "Bearer"},
        ) from e
