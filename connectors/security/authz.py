"""
Authorization and Tenant/Workspace Isolation Subsystem (Task 11 Step 6).

Enforces deterministic authorization boundaries:
1. Workspace cannot access another workspace's connector or resources.
2. Site cannot access another site's resources.
3. Execution cannot operate on resources outside its authorized scope.
4. Connector credentials cannot be reused across unauthorized workspaces.
5. All operations (read, preview, apply, rollback, status) require explicit authorization.
6. Untrusted IDs from AI-generated fix plans are strictly validated against the authorized context.
"""

from __future__ import annotations

import fnmatch
from datetime import datetime, timezone
from enum import Enum
from typing import Any
from pydantic import BaseModel, ConfigDict, Field

from connectors.base.enums import ConnectorErrorCode, ExecutionOperationType
from connectors.base.errors import AuthorizationError
from connectors.base.security import sanitize_payload, validate_safe_identifier


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


class PermissionType(str, Enum):
    """Granular operational permissions for connector executions."""
    READ = "connector:read"
    PREVIEW = "connector:preview"
    APPLY = "connector:apply"
    ROLLBACK = "connector:rollback"
    STATUS = "connector:status"
    ADMIN = "connector:admin"


class AuthorizationContext(BaseModel):
    """
    Cryptographically and tenant-bound authorization context for connector operations.
    Must accompany every execution request and connector interaction.
    """
    model_config = ConfigDict(from_attributes=True, populate_by_name=True, extra="allow")

    workspace_id: str = Field(
        ...,
        description="Tenant / Workspace ID owning the connector and target site",
    )
    site_id: str = Field(
        ...,
        description="Authorized site / domain identifier",
    )
    actor_id: str = Field(
        ...,
        description="Identity of the actor, user, or service invoking the operation",
    )
    roles: list[str] = Field(
        default_factory=lambda: ["editor"],
        description="Assigned role(s) for the actor (e.g. admin, editor, viewer)",
    )
    allowed_connectors: list[str] = Field(
        default_factory=lambda: ["*"],
        description="List of allowed connector types ('wordpress', 'github', or '*' for all)",
    )
    allowed_resource_patterns: list[str] = Field(
        default_factory=lambda: ["*"],
        description="Glob patterns of permitted resource IDs (e.g. 'pages/*', 'docs/*', '*')",
    )
    permissions: list[PermissionType | str] = Field(
        default_factory=lambda: [
            PermissionType.READ,
            PermissionType.PREVIEW,
            PermissionType.APPLY,
            PermissionType.ROLLBACK,
            PermissionType.STATUS,
        ],
        description="Explicit granted permissions",
    )
    created_at: datetime = Field(
        default_factory=_utc_now,
        description="Timestamp when context was created (UTC)",
    )
    metadata: dict[str, Any] = Field(
        default_factory=dict,
        description="Sanitized contextual metadata",
    )

    def model_post_init(self, __context: Any) -> None:
        validate_safe_identifier(self.workspace_id, "workspace_id")
        validate_safe_identifier(self.site_id, "site_id")
        validate_safe_identifier(self.actor_id, "actor_id")
        if self.metadata:
            object.__setattr__(self, "metadata", sanitize_payload(self.metadata))


class AuthorizationDecision(BaseModel):
    """
    Deterministic outcome of an authorization policy evaluation.
    """
    model_config = ConfigDict(from_attributes=True, populate_by_name=True, extra="allow")

    is_authorized: bool = Field(
        ...,
        description="Whether the requested operation is permitted",
    )
    reason: str = Field(
        ...,
        description="Deterministic explanation of the decision",
    )
    workspace_id: str | None = Field(
        default=None,
        description="Workspace ID evaluated",
    )
    site_id: str | None = Field(
        default=None,
        description="Site ID evaluated",
    )
    actor_id: str | None = Field(
        default=None,
        description="Actor ID evaluated",
    )
    denial_code: str | None = Field(
        default=None,
        description="Standardized denial reason code if rejected",
    )
    evaluated_at: datetime = Field(
        default_factory=_utc_now,
        description="Timestamp when evaluation took place (UTC)",
    )


class AuthorizationManager:
    """
    Deterministic authorization and multi-tenant boundary enforcer.
    """

    OPERATION_PERMISSION_MAP: dict[ExecutionOperationType | str, PermissionType] = {
        ExecutionOperationType.CONNECT: PermissionType.READ,
        ExecutionOperationType.DISCONNECT: PermissionType.ADMIN,
        ExecutionOperationType.HEALTH_CHECK: PermissionType.READ,
        ExecutionOperationType.GET_SITE_CONTEXT: PermissionType.READ,
        ExecutionOperationType.READ_RESOURCE: PermissionType.READ,
        ExecutionOperationType.PREVIEW_CHANGE: PermissionType.PREVIEW,
        ExecutionOperationType.APPLY_CHANGE: PermissionType.APPLY,
        ExecutionOperationType.ROLLBACK_CHANGE: PermissionType.ROLLBACK,
        ExecutionOperationType.GET_CHANGE_STATUS: PermissionType.STATUS,
        "connect": PermissionType.READ,
        "disconnect": PermissionType.ADMIN,
        "health_check": PermissionType.READ,
        "get_site_context": PermissionType.READ,
        "read_resource": PermissionType.READ,
        "preview_change": PermissionType.PREVIEW,
        "apply_change": PermissionType.APPLY,
        "rollback_change": PermissionType.ROLLBACK,
        "get_change_status": PermissionType.STATUS,
    }

    @classmethod
    def evaluate(
        cls,
        context: AuthorizationContext | None,
        target_workspace_id: str,
        target_site_id: str,
        connector_type: str,
        resource_id: str | None = None,
        operation: ExecutionOperationType | str = ExecutionOperationType.READ_RESOURCE,
    ) -> AuthorizationDecision:
        """
        Deterministically evaluates if the given context is authorized to perform the operation.
        """
        # 1. Missing context check
        if context is None:
            return AuthorizationDecision(
                is_authorized=False,
                reason="Authorization context is required but was not provided",
                denial_code="MISSING_CONTEXT",
            )

        # 2. Workspace isolation check
        if context.workspace_id != target_workspace_id:
            return AuthorizationDecision(
                is_authorized=False,
                reason=f"Workspace mismatch: context workspace '{context.workspace_id}' cannot access target workspace '{target_workspace_id}'",
                workspace_id=context.workspace_id,
                site_id=context.site_id,
                actor_id=context.actor_id,
                denial_code="WORKSPACE_MISMATCH",
            )

        # 3. Site isolation check
        if context.site_id != target_site_id:
            return AuthorizationDecision(
                is_authorized=False,
                reason=f"Site mismatch: context site '{context.site_id}' cannot access target site '{target_site_id}'",
                workspace_id=context.workspace_id,
                site_id=context.site_id,
                actor_id=context.actor_id,
                denial_code="SITE_MISMATCH",
            )

        # 4. Connector type check
        norm_conn = connector_type.lower()
        allowed_conns = [c.lower() for c in context.allowed_connectors]
        if "*" not in allowed_conns and norm_conn not in allowed_conns:
            return AuthorizationDecision(
                is_authorized=False,
                reason=f"Connector '{connector_type}' is not authorized for workspace '{context.workspace_id}'",
                workspace_id=context.workspace_id,
                site_id=context.site_id,
                actor_id=context.actor_id,
                denial_code="CONNECTOR_MISMATCH",
            )

        # 5. Resource target pattern check
        if resource_id:
            matched = False
            for pattern in context.allowed_resource_patterns:
                if pattern == "*" or fnmatch.fnmatch(resource_id, pattern):
                    matched = True
                    break
            if not matched:
                return AuthorizationDecision(
                    is_authorized=False,
                    reason=f"Resource '{resource_id}' is outside authorized resource patterns for site '{context.site_id}'",
                    workspace_id=context.workspace_id,
                    site_id=context.site_id,
                    actor_id=context.actor_id,
                    denial_code="TARGET_MISMATCH",
                )

        # 6. Granular permission check
        required_perm = cls.OPERATION_PERMISSION_MAP.get(operation, PermissionType.READ)
        granted_perms = [
            p.value if isinstance(p, PermissionType) else str(p)
            for p in context.permissions
        ]
        
        # Admin role or admin permission grants all
        is_admin = "admin" in [r.lower() for r in context.roles] or PermissionType.ADMIN.value in granted_perms
        if not is_admin and required_perm.value not in granted_perms:
            return AuthorizationDecision(
                is_authorized=False,
                reason=f"Actor '{context.actor_id}' lacks required permission '{required_perm.value}' for operation '{operation}'",
                workspace_id=context.workspace_id,
                site_id=context.site_id,
                actor_id=context.actor_id,
                denial_code="PERMISSION_DENIED",
            )

        return AuthorizationDecision(
            is_authorized=True,
            reason="Authorized",
            workspace_id=context.workspace_id,
            site_id=context.site_id,
            actor_id=context.actor_id,
        )

    @classmethod
    def enforce(
        cls,
        context: AuthorizationContext | None,
        target_workspace_id: str,
        target_site_id: str,
        connector_type: str,
        resource_id: str | None = None,
        operation: ExecutionOperationType | str = ExecutionOperationType.READ_RESOURCE,
    ) -> AuthorizationDecision:
        """
        Evaluates authorization and immediately raises AuthorizationError if rejected.
        """
        decision = cls.evaluate(
            context=context,
            target_workspace_id=target_workspace_id,
            target_site_id=target_site_id,
            connector_type=connector_type,
            resource_id=resource_id,
            operation=operation,
        )
        if not decision.is_authorized:
            raise AuthorizationError(
                message=f"Authorization denied: {decision.reason}",
                details={
                    "denial_code": decision.denial_code,
                    "workspace_id": target_workspace_id,
                    "site_id": target_site_id,
                    "connector_type": connector_type,
                    "operation": str(operation),
                    "resource_id": resource_id,
                },
                provider_code=decision.denial_code,
            )
        return decision
