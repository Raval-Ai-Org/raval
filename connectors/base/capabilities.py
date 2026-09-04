"""
Connector Capabilities Model & Validation Subsystem (Task 11 Step 1).

Explicitly captures and validates what operations and resource types each connector supports.
Enforces that unsupported operations are rejected deterministically before execution.
"""

from __future__ import annotations

from typing import Any
from pydantic import BaseModel, ConfigDict, Field

from .enums import ConnectorCapability, ResourceType
from .errors import UnsupportedOperationError


class ConnectorCapabilities(BaseModel):
    """
    Structured, normalized declaration of capabilities supported by a connector.
    Guarantees that the execution engine never assumes an operation is available without verification.
    """
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    supported_capabilities: set[ConnectorCapability] = Field(
        default_factory=set,
        description="Set of operational capabilities supported by the connector",
    )
    supported_resource_types: set[ResourceType | str] = Field(
        default_factory=set,
        description="Set of resource categories this connector can interact with",
    )
    supports_preview: bool = Field(
        default=False,
        description="Whether the connector can generate dry-run diffs/previews before applying",
    )
    supports_rollback: bool = Field(
        default=False,
        description="Whether the connector supports automated rollback of previously applied changes",
    )
    supports_atomic_batch: bool = Field(
        default=False,
        description="Whether multiple resource mutations can be applied atomically in a single transaction",
    )
    supports_rate_limit_reporting: bool = Field(
        default=False,
        description="Whether the provider exposes rate limit quotas and resets in its responses",
    )
    max_payload_bytes: int | None = Field(
        default=None,
        description="Maximum allowed payload size in bytes, if constrained by provider",
    )
    rate_limit_per_minute: int | None = Field(
        default=None,
        description="Nominal requests per minute allowed by provider, if known",
    )
    metadata: dict[str, Any] = Field(
        default_factory=dict,
        description="Additional capability telemetry and feature flags",
    )

    def can_perform(self, capability: ConnectorCapability | str) -> bool:
        """
        Determines whether the specified capability is supported.
        """
        if isinstance(capability, str):
            try:
                cap_enum = ConnectorCapability(capability.upper())
            except ValueError:
                return False
        else:
            cap_enum = capability
        return cap_enum in self.supported_capabilities

    def has_capability(self, capability: ConnectorCapability | str) -> bool:
        """Alias for can_perform."""
        return self.can_perform(capability)

    def can_handle_resource(self, resource_type: ResourceType | str) -> bool:
        """
        Determines whether the specified resource type is supported.
        """
        if isinstance(resource_type, ResourceType):
            return resource_type in self.supported_resource_types or resource_type.value in self.supported_resource_types
        return resource_type in self.supported_resource_types

    def assert_capability(self, capability: ConnectorCapability | str) -> None:
        """
        Raises UnsupportedOperationError if the specified capability is not supported.
        """
        if not self.can_perform(capability):
            cap_name = capability.value if isinstance(capability, ConnectorCapability) else str(capability)
            raise UnsupportedOperationError(
                message=f"Connector does not support operation capability: '{cap_name}'",
                operation=cap_name,
                details={
                    "supported_capabilities": [c.value for c in self.supported_capabilities],
                },
            )

    @classmethod
    def read_only(
        cls,
        supported_resource_types: set[ResourceType | str] | None = None,
    ) -> ConnectorCapabilities:
        """Factory for creating a standard Read-Only connector capability profile."""
        return cls(
            supported_capabilities={
                ConnectorCapability.READ,
                ConnectorCapability.HEALTH_CHECK,
                ConnectorCapability.STATUS,
            },
            supported_resource_types=supported_resource_types or {
                ResourceType.WEBSITE_PAGE,
                ResourceType.ROBOTS_TXT,
                ResourceType.SITEMAP,
                ResourceType.STRUCTURED_DATA,
                ResourceType.META_TAGS,
            },
            supports_preview=False,
            supports_rollback=False,
            supports_atomic_batch=False,
            supports_rate_limit_reporting=True,
        )

    @classmethod
    def full_mutation(
        cls,
        supported_resource_types: set[ResourceType | str] | None = None,
        supports_rollback: bool = True,
    ) -> ConnectorCapabilities:
        """Factory for creating a full mutation-capable profile (e.g. GitHub/WordPress)."""
        return cls(
            supported_capabilities={
                ConnectorCapability.READ,
                ConnectorCapability.PREVIEW,
                ConnectorCapability.APPLY,
                ConnectorCapability.ROLLBACK if supports_rollback else ConnectorCapability.STATUS,
                ConnectorCapability.STATUS,
                ConnectorCapability.HEALTH_CHECK,
            },
            supported_resource_types=supported_resource_types or {
                ResourceType.WEBSITE_PAGE,
                ResourceType.CMS_POST,
                ResourceType.CMS_PAGE,
                ResourceType.GIT_FILE,
                ResourceType.ROBOTS_TXT,
                ResourceType.SITEMAP,
                ResourceType.STRUCTURED_DATA,
                ResourceType.META_TAGS,
            },
            supports_preview=True,
            supports_rollback=supports_rollback,
            supports_atomic_batch=False,
            supports_rate_limit_reporting=True,
        )
