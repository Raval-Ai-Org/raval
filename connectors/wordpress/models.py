"""
WordPress Connector Models (Task 11 Step 3).

Defines normalized models for WordPress REST API identities, user capabilities,
posts/pages/media resource representations, and immutable operation records.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from pydantic import BaseModel, ConfigDict, Field

from connectors.base.enums import ExecutionStatus, ResourceType
from connectors.base.security import sanitize_payload, validate_safe_identifier


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


class WordPressSiteIdentity(BaseModel):
    """
    Normalized metadata describing a WordPress site target.
    """
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    site_url: str = Field(..., description="Canonical URL of the WordPress installation")
    rest_url: str = Field(..., description="Base URL of the WordPress REST API (/wp-json/wp/v2)")
    site_name: str = Field(default="WordPress Site", description="Title or name of the site")
    wp_version: str = Field(default="6.0", description="WordPress core version")
    timezone_string: str = Field(default="UTC", description="Site configured timezone")
    is_multisite: bool = Field(default=False, description="Whether the site is a WordPress network/multisite")
    active_plugins: list[str] = Field(default_factory=list, description="Sanitized list of detected active plugins (e.g. Yoast, RankMath)")
    metadata: dict[str, Any] = Field(default_factory=dict, description="Additional non-sensitive site metadata")

    def model_post_init(self, __context: Any) -> None:
        if self.metadata:
            object.__setattr__(self, "metadata", sanitize_payload(self.metadata))


class WordPressUserCapability(BaseModel):
    """
    Normalized permissions and capabilities for the authenticated WordPress user.
    """
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    user_id: int = Field(default=1, description="WordPress user ID")
    username: str = Field(default="user", description="WordPress username")
    roles: list[str] = Field(default_factory=lambda: ["administrator"], description="Assigned WordPress user roles")
    capabilities: list[str] = Field(
        default_factory=lambda: [
            "read",
            "edit_posts",
            "edit_pages",
            "publish_posts",
            "publish_pages",
            "edit_published_posts",
            "edit_published_pages",
            "upload_files",
            "manage_options",
        ],
        description="List of granular WordPress capabilities granted to this user",
    )

    def has_capability(self, capability: str) -> bool:
        """Check if user has a specific capability."""
        # Administrators typically have all standard capabilities
        if "administrator" in self.roles:
            return True
        return capability in self.capabilities

    def can_edit(self, post_type: str = "post") -> bool:
        """Check if user can edit resources of given post type."""
        if "administrator" in self.roles or "editor" in self.roles:
            return True
        if post_type in ("page", "cms_page"):
            return self.has_capability("edit_pages") or self.has_capability("edit_published_pages")
        return self.has_capability("edit_posts") or self.has_capability("edit_published_posts")

    def can_publish(self, post_type: str = "post") -> bool:
        """Check if user can publish/update live resources of given post type."""
        if "administrator" in self.roles or "editor" in self.roles:
            return True
        if post_type in ("page", "cms_page"):
            return self.has_capability("publish_pages")
        return self.has_capability("publish_posts")

    def can_manage_media(self) -> bool:
        """Check if user can upload/edit media."""
        if "administrator" in self.roles or "editor" in self.roles or "author" in self.roles:
            return True
        return self.has_capability("upload_files")


class WordPressResourceInfo(BaseModel):
    """
    Normalized payload for a WordPress Post, Page, or Custom Post Type.
    """
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: int = Field(..., description="Unique WordPress post/page ID")
    slug: str = Field(..., description="URL slug of the resource")
    title: str = Field(default="", description="Rendered or raw title")
    content: str = Field(default="", description="Rendered or raw post content HTML")
    excerpt: str = Field(default="", description="Post excerpt")
    post_type: str = Field(default="post", description="Post type (post, page, custom)")
    status: str = Field(default="publish", description="Publication status (publish, draft, pending, private)")
    link: str = Field(default="", description="Public permalink URL")
    meta: dict[str, Any] = Field(default_factory=dict, description="Custom post metadata dictionary (e.g. SEO fields)")
    modified_gmt: str | None = Field(default=None, description="ISO timestamp of last modification in GMT")
    author_id: int | None = Field(default=None, description="Author user ID")

    def model_post_init(self, __context: Any) -> None:
        if self.meta:
            object.__setattr__(self, "meta", sanitize_payload(self.meta))


class WordPressMediaInfo(BaseModel):
    """
    Normalized payload for a WordPress Media Attachment.
    """
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: int = Field(..., description="Unique media attachment ID")
    source_url: str = Field(..., description="URL to media asset")
    title: str = Field(default="", description="Media title")
    alt_text: str = Field(default="", description="Image alt text for accessibility and SEO")
    caption: str = Field(default="", description="Media caption")
    description: str = Field(default="", description="Media description")
    mime_type: str = Field(default="image/jpeg", description="MIME type")
    slug: str = Field(default="", description="Media slug")
    modified_gmt: str | None = Field(default=None, description="Last modification timestamp")


class WordPressOperationRecord(BaseModel):
    """
    Immutable audit record for a WordPress mutation, storing pre-mutation snapshots
    necessary for deterministic rollbacks.
    """
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    operation_id: str = Field(..., description="Unique operation identifier")
    fix_plan_id: int | None = Field(default=None, description="Linked Task 9 FixPlan ID")
    finding_id: int | None = Field(default=None, description="Linked Task 9 Finding ID")
    recommendation_id: int | None = Field(default=None, description="Linked Task 9 Recommendation ID")
    resource_type: ResourceType = Field(..., description="Target resource type")
    resource_id: int = Field(..., description="WordPress target post/page/media ID")
    field_name: str = Field(..., description="Mutated field name (title, content, meta, alt_text, etc.)")
    original_value_snapshot: Any = Field(..., description="Immutable snapshot of the pre-mutation value")
    applied_value: Any = Field(..., description="Value applied during mutation")
    previous_modified_gmt: str | None = Field(default=None, description="Pre-mutation modified timestamp")
    status: ExecutionStatus = Field(default=ExecutionStatus.APPLIED, description="Status of the operation")
    applied_at: datetime = Field(default_factory=_utc_now, description="Timestamp of mutation")
    reverted_at: datetime | None = Field(default=None, description="Timestamp of rollback if reverted")
    metadata: dict[str, Any] = Field(default_factory=dict, description="Additional execution diagnostics")

    def model_post_init(self, __context: Any) -> None:
        validate_safe_identifier(self.operation_id, "operation_id")
        if self.metadata:
            object.__setattr__(self, "metadata", sanitize_payload(self.metadata))
