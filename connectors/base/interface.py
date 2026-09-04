"""
Provider-Neutral Connector Contract and Abstract Base Class (Task 11 Step 1).

Defines the universal interface that all external website connectors (Generic Read,
GitHub, WordPress, etc.) must implement.

Execution engine and higher-level orchestrators interact STRICTLY through this interface
without containing any provider-specific branching or leaks.
"""

from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from typing import Any

from .capabilities import ConnectorCapabilities
from .enums import AuthState, ConnectorCapability
from .errors import UnsupportedOperationError
from .models import (
    ChangePreview,
    ChangeProposal,
    ChangeResult,
    ConnectorHealth,
    OperationId,
    ResourceContent,
    ResourceReference,
    SiteContext,
)

logger = logging.getLogger(__name__)


class BaseConnector(ABC):
    """
    Abstract base class for website, CMS, and repository connectors.

    Every connector implementation MUST implement the 9 standard operations:
    1. connect()
    2. disconnect()
    3. health_check()
    4. get_site_context()
    5. read_resource()
    6. preview_change()
    7. apply_change()
    8. rollback_change()
    9. get_change_status()

    Unsupported operations must be explicitly declared via capabilities and
    raise UnsupportedOperationError when invoked.
    """

    def __init__(
        self,
        site_context: SiteContext,
    ) -> None:
        self._site_context = site_context

    @property
    def site_context(self) -> SiteContext:
        """The normalized SiteContext associated with this connector."""
        return self._site_context

    @property
    def provider_name(self) -> str:
        """The canonical name of this connector provider (e.g. 'generic_read', 'github', 'wordpress')."""
        return self._site_context.provider

    @property
    def capabilities(self) -> ConnectorCapabilities:
        """Declared operational capabilities and supported resource types of this connector."""
        return self._site_context.capabilities

    @property
    def auth_state(self) -> AuthState:
        """Current authentication state of this connector."""
        return self._site_context.auth_state

    def _ensure_capability(self, capability: ConnectorCapability) -> None:
        """
        Helper method to verify whether a capability is supported before proceeding.
        Raises UnsupportedOperationError if unsupported.
        """
        self.capabilities.assert_capability(capability)

    # =========================================================================
    # 1. Lifecycle & Authentication Operations
    # =========================================================================

    @abstractmethod
    def connect(
        self,
        credentials: dict[str, Any] | None = None,
    ) -> SiteContext:
        """
        Establishes connection and authenticates with target provider.

        Args:
            credentials: Optional dictionary containing provider credentials (API key, token, etc.).
                         Implementations MUST NOT store or log credentials in plaintext.

        Returns:
            Updated SiteContext with authenticated AuthState.

        Raises:
            AuthenticationError: If credentials or handshake fails.
            ConnectorTimeoutError: If the remote endpoint times out.
            ConnectorNetworkError: If the host is unreachable.
        """
        raise NotImplementedError

    @abstractmethod
    def disconnect(self) -> SiteContext:
        """
        Terminates the session and revokes/clears in-memory connection handles.

        Returns:
            Updated SiteContext with AuthState.DISCONNECTED.
        """
        raise NotImplementedError

    @abstractmethod
    def health_check(self) -> ConnectorHealth:
        """
        Performs a non-destructive diagnostic ping against the target provider.

        Returns:
            ConnectorHealth model indicating latency, reachable status, and diagnostics.
        """
        raise NotImplementedError

    @abstractmethod
    def get_site_context(self) -> SiteContext:
        """
        Retrieves the normalized site identity, capabilities, environment, and rate-limit metadata.

        Returns:
            Current normalized SiteContext.
        """
        raise NotImplementedError

    # =========================================================================
    # 2. Read Operations
    # =========================================================================

    @abstractmethod
    def read_resource(
        self,
        resource: ResourceReference,
    ) -> ResourceContent:
        """
        Fetches the normalized content of a target resource (HTML page, post, config, or file).

        Args:
            resource: Normalized ResourceReference specifying the target.

        Returns:
            ResourceContent containing the payload and metadata.

        Raises:
            ResourceNotFoundError: If the target does not exist.
            AuthorizationError: If read permissions are insufficient.
            RateLimitExceededError: If provider rate limits are exceeded.
        """
        raise NotImplementedError

    # =========================================================================
    # 3. Mutation & Rollback Operations
    # =========================================================================

    @abstractmethod
    def preview_change(
        self,
        proposal: ChangeProposal,
    ) -> ChangePreview:
        """
        Simulates proposed modifications and generates a dry-run preview diff without mutating.

        Args:
            proposal: Structured proposal detailing the planned change.

        Returns:
            ChangePreview with unified/structured diff and applicability status.

        Raises:
            UnsupportedOperationError: If connector is read-only or does not support previews.
            InvalidResourceError: If proposal targets an invalid or unsupported resource.
        """
        raise NotImplementedError

    @abstractmethod
    def apply_change(
        self,
        proposal: ChangeProposal,
    ) -> ChangeResult:
        """
        Applies a validated, approved change proposal to the target provider.

        Args:
            proposal: Structured proposal detailing the changes to be applied.

        Returns:
            ChangeResult containing the operation ID, status, resulting version, and rollback token.

        Raises:
            UnsupportedOperationError: If connector is read-only.
            AuthorizationError: If mutation permissions are insufficient.
            ConnectorValidationError: If pre-mutation safety bounds are violated.
        """
        raise NotImplementedError

    @abstractmethod
    def rollback_change(
        self,
        operation_id: OperationId | str,
        rollback_token: str | None = None,
    ) -> ChangeResult:
        """
        Reverts a previously applied change to restore the previous state.

        Args:
            operation_id: Unique operation identifier of the change to roll back.
            rollback_token: Optional state token / snapshot ID provided during apply_change.

        Returns:
            ChangeResult with status ROLLED_BACK or FAILED.

        Raises:
            UnsupportedOperationError: If rollback is unsupported by this provider.
            ResourceNotFoundError: If the target operation is not found.
        """
        raise NotImplementedError

    @abstractmethod
    def get_change_status(
        self,
        operation_id: OperationId | str,
    ) -> ChangeResult:
        """
        Queries the current status of an applied, pending, or asynchronous change operation.

        Args:
            operation_id: Normalized operation identifier to inspect.

        Returns:
            ChangeResult with current execution status and details.

        Raises:
            ResourceNotFoundError: If the operation identifier is not recognized.
        """
        raise NotImplementedError
