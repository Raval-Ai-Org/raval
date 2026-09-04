"""
Normalized Core Data Models for Website Connectors (Task 11 Step 1).

Defines strongly-typed, provider-agnostic representations for:
- Resource references and resource content
- Rate-limit telemetry
- Normalized operation identifiers
- Site context and health diagnostics
- Change proposals, diff previews, and execution outcomes
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any
from pydantic import BaseModel, ConfigDict, Field

from .capabilities import ConnectorCapabilities
from .enums import AuthState, ExecutionOperationType, ExecutionStatus, HealthStatus, ResourceType
from .errors import ConnectorErrorInfo
from .security import redact_secrets_from_string, sanitize_payload, validate_safe_identifier


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _generate_operation_id() -> str:
    return f"op_{uuid.uuid4().hex[:16]}"


# =====================================================================
# 1. Rate Limit Model
# =====================================================================

class RateLimitInfo(BaseModel):
    """
    Normalized rate-limit state reported by an external provider.
    Enables safe, adaptive backoff without exposing sensitive provider endpoints.
    """
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    limit: int | None = Field(
        default=None,
        description="Total allowed quota in current window",
    )
    remaining: int | None = Field(
        default=None,
        description="Remaining requests in current window",
    )
    reset_at: datetime | None = Field(
        default=None,
        description="Absolute UTC time when quota window resets",
    )
    reset_seconds: float | None = Field(
        default=None,
        description="Seconds remaining until quota resets",
    )
    retry_after_seconds: float | None = Field(
        default=None,
        description="Specific retry-after header value in seconds if throttled",
    )
    is_rate_limited: bool = Field(
        default=False,
        description="Whether the connector is currently rate-limited by provider",
    )
    metadata: dict[str, Any] = Field(
        default_factory=dict,
        description="Additional rate-limit details",
    )

    def model_post_init(self, __context: Any) -> None:
        """Sanitize metadata."""
        if self.metadata:
            object.__setattr__(self, "metadata", sanitize_payload(self.metadata))


# =====================================================================
# 2. Resource Reference Model
# =====================================================================

class ResourceReference(BaseModel):
    """
    Normalized pointer to a target resource on a website, CMS, or Git repo.
    Decouples execution logic from provider-specific paths or internal IDs.
    """
    model_config = ConfigDict(from_attributes=True, populate_by_name=True, extra="allow")

    resource_type: ResourceType | str = Field(
        ...,
        description="Category of resource (e.g. website_page, cms_post, git_file)",
    )
    resource_id: str | int = Field(
        ...,
        description="Canonical identifier, URL, post ID, or relative path",
    )
    path: str | None = Field(
        default=None,
        description="Optional relative or canonical path",
    )
    parameters: dict[str, Any] = Field(
        default_factory=dict,
        description="Optional query parameters or sub-resource selectors",
    )
    uri: str | None = Field(
        default=None,
        description="Optional full URI or permalink to the resource",
    )
    version_or_tag: str | None = Field(
        default=None,
        description="Revision identifier, Git commit SHA, etag, or update timestamp",
    )
    metadata: dict[str, Any] = Field(
        default_factory=dict,
        description="Provider-neutral resource metadata (title, content-type, etc.)",
    )

    def model_post_init(self, __context: Any) -> None:
        """Validate safety of resource_id and sanitize metadata."""
        validate_safe_identifier(str(self.resource_id), field_name="resource_id")
        if self.metadata:
            object.__setattr__(self, "metadata", sanitize_payload(self.metadata))

    @property
    def canonical_id(self) -> str:
        res_type = self.resource_type.value if isinstance(self.resource_type, ResourceType) else str(self.resource_type)
        return f"{res_type}:{self.resource_id}"


# =====================================================================
# 3. Operation ID Model
# =====================================================================

class OperationId(BaseModel):
    """
    Normalized identifier for tracking a mutation or async job.
    Supports provider-specific native IDs without leaking implementation details.
    """
    model_config = ConfigDict(from_attributes=True, populate_by_name=True, extra="allow")

    id: str = Field(
        default_factory=_generate_operation_id,
        description="Internal normalized unique operation identifier",
    )
    provider_operation_id: str | None = Field(
        default=None,
        description="Native provider ID (PR number, commit SHA, revision ID, transaction ID)",
    )
    operation_type: ExecutionOperationType | str = Field(
        default=ExecutionOperationType.APPLY_CHANGE,
        description="Operation type associated with this identifier",
    )
    created_at: datetime = Field(
        default_factory=_utc_now,
        description="Timestamp when the operation was initiated (UTC)",
    )

    def __init__(self, id: str | None = None, **data: Any) -> None:
        if id is not None and "id" not in data:
            data["id"] = id
        super().__init__(**data)

    @property
    def value(self) -> str:
        return self.id

    def __str__(self) -> str:
        return self.id

    def model_post_init(self, __context: Any) -> None:
        validate_safe_identifier(self.id, field_name="operation_id")
        if self.provider_operation_id:
            object.__setattr__(
                self,
                "provider_operation_id",
                redact_secrets_from_string(str(self.provider_operation_id)),
            )


# =====================================================================
# 4. Connector Health Model
# =====================================================================

class ConnectorHealth(BaseModel):
    """
    Health check diagnostic outcome for a connector target.
    """
    model_config = ConfigDict(from_attributes=True, populate_by_name=True, extra="allow")

    status: HealthStatus = Field(
        ...,
        description="Normalized health status (HEALTHY, DEGRADED, UNHEALTHY, UNKNOWN)",
    )
    latency_ms: float = Field(
        default=0.0,
        description="Observed round-trip ping/check latency in milliseconds",
    )
    message: str = Field(
        default="Healthy",
        description="Sanitized diagnostic message",
    )
    checked_at: datetime = Field(
        default_factory=_utc_now,
        description="Timestamp of the health check (UTC)",
    )
    last_checked_at: datetime = Field(
        default_factory=_utc_now,
        description="Alias timestamp of the health check (UTC)",
    )
    auth_state: AuthState = Field(
        default=AuthState.DISCONNECTED,
        description="Current authentication status of the connector",
    )
    rate_limit: RateLimitInfo | None = Field(
        default=None,
        description="Current rate-limit telemetry",
    )
    rate_limit_info: RateLimitInfo | None = Field(
        default=None,
        description="Alias rate-limit telemetry",
    )
    details: dict[str, Any] = Field(
        default_factory=dict,
        description="Sanitized diagnostic details",
    )

    def model_post_init(self, __context: Any) -> None:
        object.__setattr__(self, "message", redact_secrets_from_string(self.message))
        if self.details:
            object.__setattr__(self, "details", sanitize_payload(self.details))


# =====================================================================
# 5. Site Context Model
# =====================================================================

class SiteContext(BaseModel):
    """
    Normalized representation of a connected target website / environment.
    Carries identity, provider metadata, and declared capabilities without secrets.
    """
    model_config = ConfigDict(from_attributes=True, populate_by_name=True, extra="allow")

    workspace_id: str | int | None = Field(
        default="default_workspace",
        description="Tenant / Workspace identifier",
    )
    site_id: int | str = Field(
        ...,
        description="Internal reference ID (e.g. website_id from database)",
    )
    site_url: str = Field(
        ...,
        description="Canonical base URL of the website",
    )
    provider: str = Field(
        ...,
        description="Connector provider name (e.g. 'generic_read', 'github', 'wordpress')",
    )
    environment: str = Field(
        default="production",
        description="Target deployment environment (production, staging, development)",
    )
    auth_state: AuthState = Field(
        default=AuthState.DISCONNECTED,
        description="Current authentication state",
    )
    capabilities: ConnectorCapabilities = Field(
        default_factory=ConnectorCapabilities.read_only,
        description="Capabilities supported for this site target",
    )
    last_health_status: HealthStatus = Field(
        default=HealthStatus.UNKNOWN,
        description="Most recently evaluated health status",
    )
    rate_limit_info: RateLimitInfo | None = Field(
        default=None,
        description="Current rate-limit quotas and status",
    )
    metadata: dict[str, Any] = Field(
        default_factory=dict,
        description="Sanitized site-level attributes (CMS version, theme, repository branch, etc.)",
    )

    def model_post_init(self, __context: Any) -> None:
        object.__setattr__(self, "provider", validate_safe_identifier(str(self.provider), "provider"))
        if self.metadata:
            object.__setattr__(self, "metadata", sanitize_payload(self.metadata))


# =====================================================================
# 6. Resource Content Model
# =====================================================================

class ResourceContent(BaseModel):
    """
    Normalized content fetched from a target resource.
    """
    model_config = ConfigDict(from_attributes=True, populate_by_name=True, extra="allow")

    resource: ResourceReference = Field(
        ...,
        description="Resource reference identifying the target",
    )
    content: str | bytes | dict[str, Any] = Field(
        ...,
        description="Resource payload (HTML string, JSON structure, raw text, or bytes)",
    )
    content_type: str = Field(
        default="text/html",
        description="MIME content type of the retrieved payload",
    )
    raw_payload: dict[str, Any] | None = Field(
        default=None,
        description="Raw provider payload if available",
    )
    encoding: str = Field(
        default="utf-8",
        description="Text encoding of the payload",
    )
    etag_or_version: str | None = Field(
        default=None,
        description="Cache tag, Git SHA, or revision identifier",
    )
    metadata: dict[str, Any] = Field(
        default_factory=dict,
        description="Sanitized response headers or metadata",
    )
    fetched_at: datetime = Field(
        default_factory=_utc_now,
        description="Timestamp when the content was fetched (UTC)",
    )

    def model_post_init(self, __context: Any) -> None:
        if self.metadata:
            object.__setattr__(self, "metadata", sanitize_payload(self.metadata))


# =====================================================================
# 7. Change Proposal & Mutation Models
# =====================================================================

class ChangeProposal(BaseModel):
    """
    Structured proposal describing an intended remediation or mutation.
    Binds cleanly to existing Task 9 FixPlan and Recommendation structures.
    """
    model_config = ConfigDict(from_attributes=True, populate_by_name=True, extra="allow")

    target_resource: ResourceReference = Field(
        ...,
        description="Target resource to be modified",
    )
    action_type: str = Field(
        ...,
        description="Type of remediation (meta_tag_improvement, structured_data_injection, etc.)",
    )
    description: str | None = Field(
        default=None,
        description="Summary or description of the intended change",
    )
    proposed_diff: Any = Field(
        default=None,
        description="Structured diff payload or new proposed content",
    )
    suggested_content: Any = Field(
        default=None,
        description="Proposed replacement content, schema snippet, or string value",
    )
    proposed_content: Any = Field(
        default=None,
        description="Alias for suggested_content",
    )
    original_content: Any = Field(
        default=None,
        description="Expected original content baseline for drift validation",
    )
    parameters: dict[str, Any] = Field(
        default_factory=dict,
        description="Action-specific parameters (meta_key, meta_value, selector, etc.)",
    )
    before_summary: str | None = Field(
        default=None,
        description="Summary description of before-state",
    )
    after_summary: str | None = Field(
        default=None,
        description="Summary description of desired after-state",
    )
    safe_bounds: dict[str, Any] = Field(
        default_factory=dict,
        description="Safety bounds (is_destructive, reversible, allowed_selectors)",
    )
    fix_plan_id: int | None = Field(
        default=None,
        description="Reference to Task 9 FixPlan ID",
    )
    recommendation_id: int | None = Field(
        default=None,
        description="Reference to Task 9 Recommendation ID",
    )
    finding_id: int | None = Field(
        default=None,
        description="Reference to Task 9 Finding ID",
    )
    metadata: dict[str, Any] = Field(
        default_factory=dict,
        description="Additional proposal metadata",
    )

    def model_post_init(self, __context: Any) -> None:
        if self.metadata:
            object.__setattr__(self, "metadata", sanitize_payload(self.metadata))


class ChangePreview(BaseModel):
    """
    Simulated dry-run preview of a change proposal before application.
    """
    model_config = ConfigDict(from_attributes=True, populate_by_name=True, extra="allow")

    proposal: ChangeProposal = Field(
        ...,
        description="Change proposal under evaluation",
    )
    diff_unified: str | None = Field(
        default=None,
        description="Unified diff format (git-style) showing additions/deletions",
    )
    diff_structured: dict[str, Any] | list[Any] | None = Field(
        default=None,
        description="Structured key-by-key before/after representation",
    )
    diff: str | None = Field(
        default=None,
        description="Unified diff text alias",
    )
    is_applicable: bool = Field(
        default=True,
        description="Whether the connector confirms this change is applicable",
    )
    can_apply: bool = Field(
        default=True,
        description="Alias for is_applicable",
    )
    estimated_impact: str | None = Field(
        default=None,
        description="Estimated operational or SEO impact summary",
    )
    estimated_risk: str | None = Field(
        default=None,
        description="Estimated risk level (low, medium, high)",
    )
    before_state_hash: str | None = Field(
        default=None,
        description="Hash of target state prior to mutation",
    )
    after_state_hash: str | None = Field(
        default=None,
        description="Hash of target state after proposed mutation",
    )
    structured_changes: list[dict[str, Any]] | dict[str, Any] | None = Field(
        default=None,
        description="Detailed list or dictionary of atomic change records",
    )
    warnings: list[str] = Field(
        default_factory=list,
        description="Non-fatal warnings or review recommendations",
    )
    generated_at: datetime = Field(
        default_factory=_utc_now,
        description="Timestamp when preview was generated (UTC)",
    )
    previewed_at: datetime = Field(
        default_factory=_utc_now,
        description="Timestamp when preview was completed (UTC)",
    )


class ChangeResult(BaseModel):
    """
    Outcome of applying, rolling back, or querying a change on an external provider.
    """
    model_config = ConfigDict(from_attributes=True, populate_by_name=True, extra="allow")

    operation_id: OperationId | str = Field(
        ...,
        description="Normalized operation tracking identifier",
    )
    status: ExecutionStatus = Field(
        ...,
        description="Resulting execution status (APPLIED, ROLLED_BACK, FAILED, etc.)",
    )
    target_resource: ResourceReference | None = Field(
        default=None,
        description="Target resource that was acted upon",
    )
    diff: str | None = Field(
        default=None,
        description="Diff text or summary of changes applied or reverted",
    )
    applied_at: datetime | None = Field(
        default=None,
        description="Timestamp when change was applied (UTC)",
    )
    rolled_back_at: datetime | None = Field(
        default=None,
        description="Timestamp when change was rolled back (UTC)",
    )
    reverted_at: datetime | None = Field(
        default=None,
        description="Alias timestamp when change was rolled back (UTC)",
    )
    rollback_supported: bool = Field(
        default=False,
        description="Whether automated rollback is available for this change",
    )
    rollback_token: str | None = Field(
        default=None,
        description="Opaque internal token or snapshot ID enabling rollback",
    )
    message: str = Field(
        default="Operation completed",
        description="Sanitized descriptive status message",
    )
    error: ConnectorErrorInfo | None = Field(
        default=None,
        description="Normalized error info if operation failed",
    )
    resulting_version: str | None = Field(
        default=None,
        description="New version tag, Git commit SHA, or revision ID after mutation",
    )
    metadata: dict[str, Any] = Field(
        default_factory=dict,
        description="Sanitized provider response telemetry",
    )

    def model_post_init(self, __context: Any) -> None:
        object.__setattr__(self, "message", redact_secrets_from_string(self.message))
        if self.metadata:
            object.__setattr__(self, "metadata", sanitize_payload(self.metadata))
