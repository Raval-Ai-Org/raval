"""Pydantic request/response schemas for API validation."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

# ============================================================================
# Request Models
# ============================================================================


class PublishRequest(BaseModel):
    """Request to immediately publish or schedule a post."""

    idempotency_key: str = Field(
        description="Unique key to prevent duplicate submissions",
        min_length=1,
        max_length=128,
    )
    scheduled_at: datetime | None = Field(
        default=None,
        description="Schedule for future publishing (UTC). If null, publish immediately.",
    )
    targets: list[PublishTarget] = Field(
        description="List of platforms and content per platform",
        min_length=1,
        max_length=10,
    )

    @field_validator("scheduled_at", mode="after")
    @classmethod
    def validate_scheduled_time(cls, v: datetime | None) -> datetime | None:
        """Ensure scheduled time is treated as UTC.

        If a naive datetime is provided, assume UTC.
        """
        if v is not None and v.tzinfo is None:
            v = v.replace(tzinfo=UTC)
        return v


class PublishTarget(BaseModel):
    """Platform-specific publishing target."""

    account_id: str = Field(
        description="Connected account ID on this platform",
        min_length=1,
        max_length=36,
    )
    content: PublishContent = Field(
        description="Platform-specific content (text, media, etc.)",
    )


class PublishContent(BaseModel):
    """Generic content container (platform-specific fields via JSON schema)."""

    text: str | None = Field(
        default=None,
        description="Post text content",
        max_length=63206,  # Facebook max
    )
    media_urls: list[str] | None = Field(
        default=None,
        description="URLs to media (images, videos)",
        max_length=20,
    )
    metadata: dict[str, Any] | None = Field(
        default=None,
        description="Platform-specific metadata",
    )

    @field_validator("text", mode="before")
    @classmethod
    def validate_text_not_empty(cls, v: str | None) -> str | None:
        """Ensure text is not empty if provided."""
        if v is not None and not v.strip():
            raise ValueError("text must not be empty or whitespace-only")
        return v


class CancelJobRequest(BaseModel):
    """Request to cancel a scheduled or pending post."""

    reason: str | None = Field(
        default=None,
        description="Reason for cancellation",
        max_length=500,
    )


# ============================================================================
# Response Models
# ============================================================================


class JobResponse(BaseModel):
    """Response containing job/post status and timeline."""

    job_id: str = Field(
        description="Unique post ID",
    )
    workspace_id: str = Field(
        description="Workspace that owns this post",
    )
    idempotency_key: str = Field(
        description="Idempotency key for deduplication",
    )
    status: Literal[
        "pending", "publishing", "published", "failed", "cancelled", "retrying", "partial_failed"
    ] = Field(
        description="Current post status",
    )
    scheduled_at: datetime | None = Field(
        description="Scheduled time (null if immediate)",
    )
    created_at: datetime = Field(
        description="Post creation timestamp",
    )
    updated_at: datetime = Field(
        description="Last update timestamp",
    )
    published_at: datetime | None = Field(
        description="Completion timestamp (if published/failed)",
    )
    targets: list[TargetStatus] = Field(
        description="Per-platform delivery status",
    )

    class Config:
        """Pydantic config."""

        from_attributes = True


class TargetStatus(BaseModel):
    """Delivery status for a single platform target."""

    target_id: str = Field(
        description="Target ID",
    )
    account_id: str = Field(
        description="Account ID on platform",
    )
    platform: str = Field(
        description="Platform name (twitter, linkedin, facebook)",
    )
    status: Literal[
        "pending", "publishing", "published", "failed", "cancelled", "retrying", "partial_failed"
    ] = Field(
        description="Delivery status",
    )
    platform_post_id: str | None = Field(
        description="Platform-assigned post ID (if published)",
    )
    platform_post_url: str | None = Field(
        description="Public URL to the post (if published)",
    )
    attempts: int = Field(
        description="Number of delivery attempts",
    )
    max_attempts: int = Field(
        description="Maximum allowed attempts before failure",
    )
    next_attempt_at: datetime | None = Field(
        description="When the next retry will occur (if pending)",
    )
    error_category: str | None = Field(
        description="Error classification (transient, auth, fatal, rate_limit)",
    )
    last_error: str | None = Field(
        description="Most recent error message",
    )
    created_at: datetime = Field(
        description="Target creation timestamp",
    )
    updated_at: datetime = Field(
        description="Last update timestamp",
    )
    published_at: datetime | None = Field(
        description="Publication timestamp (if published)",
    )

    class Config:
        """Pydantic config."""

        from_attributes = True


class ListJobsResponse(BaseModel):
    """Response containing a list of posts with pagination."""

    items: list[JobResponse] = Field(
        description="List of posts",
    )
    total: int = Field(
        description="Total count of matching posts",
    )
    page: int = Field(
        description="Current page number (1-indexed)",
    )
    page_size: int = Field(
        description="Items per page",
    )
    has_more: bool = Field(
        description="Whether there are more results beyond current page",
    )


class WebhookConfigRequest(BaseModel):
    """Request to register a webhook endpoint."""

    url: str = Field(
        description="HTTPS URL to deliver webhooks to",
        min_length=10,
        max_length=512,
    )
    secret: str | None = Field(
        default=None,
        description="Optional secret for HMAC signing",
        max_length=128,
    )

    @field_validator("url", mode="before")
    @classmethod
    def validate_url(cls, v: str) -> str:
        """Ensure URL is HTTPS."""
        if not v.startswith("https://"):
            raise ValueError("Webhook URL must use HTTPS")
        return v


class WebhookEndpointResponse(BaseModel):
    """Response containing webhook configuration."""

    webhook_id: str = Field(
        description="Webhook endpoint ID",
    )
    workspace_id: str = Field(
        description="Workspace that owns this webhook",
    )
    url: str = Field(
        description="Webhook URL",
    )
    status: Literal["active", "disabled"] = Field(
        description="Webhook status",
    )
    created_at: datetime = Field(
        description="Creation timestamp",
    )
    updated_at: datetime = Field(
        description="Last update timestamp",
    )

    class Config:
        """Pydantic config."""

        from_attributes = True


class HealthResponse(BaseModel):
    """Health check response."""

    status: Literal["healthy", "degraded", "unhealthy"] = Field(
        description="Overall health status",
    )
    timestamp: datetime = Field(
        description="Health check timestamp",
    )
    services: dict[str, bool] = Field(
        description="Service health: database, redis, workers",
    )
    details: str | None = Field(
        description="Additional health details or error info",
    )


class ErrorResponse(BaseModel):
    """Standard error response."""

    error_code: str = Field(
        description="Machine-readable error code",
    )
    detail: str = Field(
        description="Human-readable error message",
    )
    request_id: str | None = Field(
        description="Request ID for tracing",
    )
    timestamp: datetime = Field(
        description="Error timestamp",
    )


class OAuthStartResponse(BaseModel):
    """Response for starting an OAuth flow.

    Returns the authorization URL the frontend should redirect the user to,
    plus the state token for CSRF verification and its TTL in seconds.
    """

    authorization_url: str = Field(
        description="URL to redirect the user to for authorization",
    )
    state_token: str = Field(
        description="Opaque state token for CSRF protection; echo it back on callback",
    )
    expires_in: int = Field(
        description="State token validity window in seconds",
    )


class AccountResponse(BaseModel):
    """Response containing account information."""

    account_id: str = Field(
        description="Account ID",
    )
    workspace_id: str = Field(
        description="Workspace ID",
    )
    platform: str = Field(
        description="Platform name",
    )
    platform_account_id: str = Field(
        description="Platform's account ID",
    )
    platform_username: str = Field(
        description="Platform username",
    )
    status: Literal["active", "expired", "disconnected"] = Field(
        description="Account status",
    )
    token_expires_at: datetime | None = Field(
        description="Token expiration (if available)",
    )
    created_at: datetime = Field(
        description="Creation timestamp",
    )
    updated_at: datetime = Field(
        description="Last update timestamp",
    )

    class Config:
        """Pydantic config."""

        from_attributes = True
