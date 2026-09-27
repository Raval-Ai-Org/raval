"""SQLAlchemy ORM models for SDE database."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import (
    DateTime,
    ForeignKey,
    Integer,
    LargeBinary,
    String,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import JSON

from app.database import Base


def utc_now() -> datetime:
    """Return the current timezone-aware UTC datetime."""
    return datetime.now(UTC)


def generate_uuid() -> str:
    """Generate a string UUID."""
    return str(uuid.uuid4())


class Account(Base):
    """Platform connection details and encrypted OAuth credentials."""

    __tablename__ = "accounts"

    id: Mapped[str] = mapped_column(
        String(36),
        primary_key=True,
        default=generate_uuid,
    )
    workspace_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    brand_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    platform: Mapped[str] = mapped_column(
        String(32), nullable=False, index=True
    )  # "twitter", "linkedin", "facebook"
    platform_account_id: Mapped[str] = mapped_column(String(128), nullable=False)
    platform_username: Mapped[str] = mapped_column(String(128), nullable=False)

    # Encrypted OAuth tokens (using Fernet encryption)
    encrypted_access_token: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    encrypted_refresh_token: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    token_expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        index=True,
    )

    status: Mapped[str] = mapped_column(
        String(32), default="active", nullable=False, index=True
    )  # "active", "expired", "disconnected"
    metadata_fields: Mapped[dict[str, Any] | None] = mapped_column("metadata", JSON, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
        onupdate=utc_now,
        nullable=False,
    )

    # Relationships
    post_targets: Mapped[list[PostTarget]] = relationship(
        "PostTarget",
        back_populates="account",
        cascade="all, delete-orphan",
    )


class Post(Base):
    """Post entity containing core messaging structure."""

    __tablename__ = "posts"

    id: Mapped[str] = mapped_column(
        String(36),
        primary_key=True,
        default=generate_uuid,
    )
    workspace_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    brand_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    idempotency_key: Mapped[str] = mapped_column(
        String(128), nullable=False, unique=True, index=True
    )

    # Status tracks aggregate state
    status: Mapped[str] = mapped_column(
        String(32),
        default="pending",
        nullable=False,
        index=True,
    )  # "pending", "publishing", "published", "failed", "cancelled"

    scheduled_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        index=True,
    )
    published_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
        onupdate=utc_now,
        nullable=False,
    )

    # Relationships
    targets: Mapped[list[PostTarget]] = relationship(
        "PostTarget",
        back_populates="post",
        cascade="all, delete-orphan",
    )
    delivery_logs: Mapped[list[DeliveryLog]] = relationship(
        "DeliveryLog",
        back_populates="post",
        cascade="all, delete-orphan",
    )


class PostTarget(Base):
    """Platform-specific delivery targets for a Post."""

    __tablename__ = "post_targets"

    id: Mapped[str] = mapped_column(
        String(36),
        primary_key=True,
        default=generate_uuid,
    )
    post_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("posts.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    account_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("accounts.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    status: Mapped[str] = mapped_column(
        String(32),
        default="pending",
        nullable=False,
        index=True,
    )  # "pending", "publishing", "published", "failed", "cancelled"

    # Specific payload: e.g. {"text": "hello", "media_urls": [...]}
    content: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)

    # Remote platform metadata
    platform_post_id: Mapped[str | None] = mapped_column(String(256), nullable=True)
    platform_post_url: Mapped[str | None] = mapped_column(String(512), nullable=True)

    # Retry logic fields
    attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    max_attempts: Mapped[int] = mapped_column(Integer, default=5, nullable=False)
    next_attempt_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        index=True,
    )
    error_category: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
        onupdate=utc_now,
        nullable=False,
    )
    published_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    # Relationships
    post: Mapped[Post] = relationship("Post", back_populates="targets")
    account: Mapped[Account] = relationship("Account", back_populates="post_targets")
    delivery_logs: Mapped[list[DeliveryLog]] = relationship(
        "DeliveryLog",
        back_populates="post_target",
        cascade="all, delete-orphan",
    )


class ApiKey(Base):
    """Per-workspace API key for multi-tenant authentication (ADR-0001).

    Only the SHA-256 hash of the raw key is stored; the raw key is shown once
    at creation. Each key resolves a request to exactly one workspace.
    """

    __tablename__ = "api_keys"

    id: Mapped[str] = mapped_column(
        String(36),
        primary_key=True,
        default=generate_uuid,
    )
    workspace_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    brand_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    key_hash: Mapped[str] = mapped_column(
        String(64),
        nullable=False,
        unique=True,
        index=True,
    )
    label: Mapped[str] = mapped_column(String(128), nullable=False, default="default")
    revoked_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    last_used_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
        nullable=False,
    )


class WebhookEndpoint(Base):
    """Outbound webhook configurations for workspace updates."""

    __tablename__ = "webhook_endpoints"

    id: Mapped[str] = mapped_column(
        String(36),
        primary_key=True,
        default=generate_uuid,
    )
    workspace_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    url: Mapped[str] = mapped_column(String(512), nullable=False)
    secret: Mapped[str] = mapped_column(String(128), nullable=False)
    status: Mapped[str] = mapped_column(
        String(32), default="active", nullable=False, index=True
    )  # "active", "disabled"

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
        onupdate=utc_now,
        nullable=False,
    )


class DeliveryLog(Base):
    """Audit log of status updates and API executions."""

    __tablename__ = "delivery_logs"

    id: Mapped[str] = mapped_column(
        String(36),
        primary_key=True,
        default=generate_uuid,
    )
    post_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("posts.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    post_target_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey("post_targets.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    workspace_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    event_type: Mapped[str] = mapped_column(
        String(64), nullable=False, index=True
    )  # "queued", "publishing", "published", "failed", "retrying"

    # API context
    http_status: Mapped[int | None] = mapped_column(Integer, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    payload: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
        nullable=False,
    )

    # Relationships
    post: Mapped[Post] = relationship("Post", back_populates="delivery_logs")
    post_target: Mapped[PostTarget] = relationship("PostTarget", back_populates="delivery_logs")
