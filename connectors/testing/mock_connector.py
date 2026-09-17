"""
In-Memory Mock and Null Connectors for Testing Connector Contracts (Task 11 Step 1).

Implements the full 9-operation BaseConnector contract in-memory without performing
any external HTTP requests, CMS updates, Git pushes, or real website mutations.

Supports configurable failure simulation:
- Authentication failures
- Timeout simulation
- Rate-limit simulation
- Unsupported capability assertions
- In-memory resource mutation and rollback verification
"""

from __future__ import annotations

import hashlib
import time
from datetime import datetime, timezone
from typing import Any

from connectors.base.capabilities import ConnectorCapabilities
from connectors.base.enums import (
    AuthState,
    ConnectorCapability,
    ConnectorErrorCode,
    ExecutionOperationType,
    ExecutionStatus,
    HealthStatus,
    ResourceType,
)
from connectors.base.errors import (
    AuthenticationError,
    ConnectorTimeoutError,
    InvalidResourceError,
    RateLimitExceededError,
    ResourceNotFoundError,
    UnsupportedOperationError,
)
from connectors.base.interface import BaseConnector
from connectors.base.models import (
    ChangePreview,
    ChangeProposal,
    ChangeResult,
    ConnectorHealth,
    OperationId,
    RateLimitInfo,
    ResourceContent,
    ResourceReference,
    SiteContext,
)
from connectors.base.security import sanitize_payload


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


class MockConnector(BaseConnector):
    """
    Deterministic In-Memory Mock Connector for testing connector contracts and execution flows.
    """

    def __init__(
        self,
        site_context: SiteContext | None = None,
        initial_resources: dict[str, str | dict[str, Any]] | None = None,
        simulate_auth_failure: bool = False,
        simulate_timeout: bool = False,
        simulate_rate_limit: bool = False,
        simulate_latency_ms: float = 5.0,
    ) -> None:
        context = site_context or SiteContext(
            site_id=1,
            site_url="https://example.com",
            provider="mock",
            environment="test",
            auth_state=AuthState.DISCONNECTED,
            capabilities=ConnectorCapabilities.full_mutation(),
            last_health_status=HealthStatus.HEALTHY,
            rate_limit_info=RateLimitInfo(
                limit=1000,
                remaining=995,
                is_rate_limited=False,
            ),
            metadata={"mock_version": "1.0.0"},
        )
        super().__init__(context)
        self.resources: dict[str, str | dict[str, Any]] = initial_resources or {
            "https://example.com/": "<html><head><title>Original Title</title></head><body><h1>Original H1</h1></body></html>",
            "https://example.com/robots.txt": "User-agent: *\nAllow: /",
            "https://example.com/sitemap.xml": "<?xml version='1.0'?><urlset></urlset>",
        }
        self.applied_operations: dict[str, ChangeResult] = {}
        self.snapshots_before_mutation: dict[str, dict[str, Any]] = {}
        self.simulate_auth_failure = simulate_auth_failure
        self.simulate_timeout = simulate_timeout
        self.simulate_rate_limit = simulate_rate_limit
        self.simulate_latency_ms = simulate_latency_ms

    def _check_simulation_hazards(self, op_name: str) -> None:
        """Helper to trigger configured simulation flags."""
        if self.simulate_timeout:
            raise ConnectorTimeoutError(
                message=f"Mock connector timed out during '{op_name}'",
                timeout_seconds=5.0,
            )
        if self.simulate_rate_limit:
            raise RateLimitExceededError(
                message="Mock connector rate limit exceeded (429)",
                retry_after_seconds=30.0,
                provider_code="429",
            )

    # =========================================================================
    # 1. Lifecycle & Authentication
    # =========================================================================

    def connect(
        self,
        credentials: dict[str, Any] | None = None,
    ) -> SiteContext:
        self._check_simulation_hazards("connect")
        if self.simulate_auth_failure:
            self._site_context.auth_state = AuthState.AUTH_FAILED
            raise AuthenticationError(
                message="Mock connector authentication failed: Invalid test credentials",
                details={"provided_keys": list((credentials or {}).keys())},
            )

        self._site_context.auth_state = AuthState.CONNECTED
        self._site_context.last_health_status = HealthStatus.HEALTHY
        return self.get_site_context()

    def disconnect(self) -> SiteContext:
        self._site_context.auth_state = AuthState.DISCONNECTED
        return self.get_site_context()

    def health_check(self) -> ConnectorHealth:
        self._check_simulation_hazards("health_check")
        status = HealthStatus.HEALTHY if self._site_context.auth_state == AuthState.CONNECTED else HealthStatus.DEGRADED
        msg = "Mock connector operational" if status == HealthStatus.HEALTHY else "Mock connector disconnected"
        return ConnectorHealth(
            status=status,
            latency_ms=self.simulate_latency_ms,
            message=msg,
            auth_state=self._site_context.auth_state,
            details={"resource_count": len(self.resources)},
        )

    def get_site_context(self) -> SiteContext:
        return self._site_context.model_copy(deep=True)

    # =========================================================================
    # 2. Read Operations
    # =========================================================================

    def read_resource(
        self,
        resource: ResourceReference,
    ) -> ResourceContent:
        self._ensure_capability(ConnectorCapability.READ)
        self._check_simulation_hazards("read_resource")

        res_id = str(resource.resource_id)
        if res_id not in self.resources:
            raise ResourceNotFoundError(
                message=f"Resource '{res_id}' not found in mock store",
                resource_id=res_id,
            )

        content = self.resources[res_id]
        content_type = "text/html" if isinstance(content, str) and "<html" in content else "text/plain"
        if isinstance(content, dict):
            content_type = "application/json"

        return ResourceContent(
            resource=resource,
            content=content,
            content_type=content_type,
            encoding="utf-8",
            etag_or_version=f"v_{len(str(content))}",
            metadata={"mock_read": True},
            fetched_at=_utc_now(),
        )

    # =========================================================================
    # 3. Mutation & Rollback Operations
    # =========================================================================

    def preview_change(
        self,
        proposal: ChangeProposal,
    ) -> ChangePreview:
        self._ensure_capability(ConnectorCapability.PREVIEW)
        self._check_simulation_hazards("preview_change")

        res_id = str(proposal.target_resource.resource_id)
        existing_content = self.resources.get(res_id, "<!-- Resource empty or new -->")

        diff_unified = (
            f"--- a/{res_id}\n"
            f"+++ b/{res_id}\n"
            f"- {str(existing_content)[:80]}...\n"
            f"+ {str(proposal.proposed_diff or proposal.after_summary)[:80]}...\n"
        )
        diff_structured = {
            "target": res_id,
            "action": proposal.action_type,
            "before": proposal.before_summary or str(existing_content)[:100],
            "after": proposal.after_summary or str(proposal.proposed_diff),
        }
        before_hash = hashlib.sha256(str(existing_content).encode("utf-8")).hexdigest()
        after_val = proposal.proposed_content or proposal.suggested_content or proposal.proposed_diff or proposal.after_summary or ""
        after_hash = hashlib.sha256(str(after_val).encode("utf-8")).hexdigest()

        return ChangePreview(
            proposal=proposal,
            diff_unified=diff_unified,
            diff_structured=diff_structured,
            estimated_impact="Simulated preview generated successfully",
            before_state_hash=before_hash,
            after_state_hash=after_hash,
            can_apply=True,
            warnings=[],
            generated_at=_utc_now(),
        )

    def apply_change(
        self,
        proposal: ChangeProposal,
    ) -> ChangeResult:
        self._ensure_capability(ConnectorCapability.APPLY)
        self._check_simulation_hazards("apply_change")

        res_id = str(proposal.target_resource.resource_id)
        # Store snapshot for rollback
        previous_val = self.resources.get(res_id)
        rollback_token = f"snap_{int(time.time() * 1000)}"
        self.snapshots_before_mutation[rollback_token] = {
            "resource_id": res_id,
            "content": previous_val,
        }

        # Apply new content in-memory
        if isinstance(proposal.proposed_diff, dict) and "after" in proposal.proposed_diff:
            self.resources[res_id] = str(proposal.proposed_diff["after"])
        elif isinstance(proposal.proposed_diff, str):
            self.resources[res_id] = proposal.proposed_diff
        elif proposal.after_summary:
            self.resources[res_id] = proposal.after_summary
        else:
            self.resources[res_id] = f"Applied: {proposal.action_type}"

        op_id = OperationId(
            provider_operation_id=f"mock_op_{len(self.applied_operations) + 1}",
            operation_type=ExecutionOperationType.APPLY_CHANGE,
        )

        result = ChangeResult(
            operation_id=op_id,
            status=ExecutionStatus.APPLIED,
            target_resource=proposal.target_resource,
            applied_at=_utc_now(),
            rollback_supported=self.capabilities.supports_rollback,
            rollback_token=rollback_token,
            message=f"Successfully applied '{proposal.action_type}' to '{res_id}'",
            resulting_version=f"rev_{len(self.applied_operations) + 1}",
            metadata={"mock_applied": True},
        )
        self.applied_operations[op_id.id] = result
        return result

    def rollback_change(
        self,
        operation_id: OperationId | str,
        rollback_token: str | None = None,
    ) -> ChangeResult:
        self._ensure_capability(ConnectorCapability.ROLLBACK)
        self._check_simulation_hazards("rollback_change")

        op_key = operation_id.id if isinstance(operation_id, OperationId) else str(operation_id)
        applied_op = self.applied_operations.get(op_key)
        if applied_op is None and not rollback_token:
            raise ResourceNotFoundError(
                message=f"Operation '{op_key}' not found for rollback",
                resource_id=op_key,
            )

        token = rollback_token or (applied_op.rollback_token if applied_op else None)
        snapshot = self.snapshots_before_mutation.get(token) if token else None

        if snapshot:
            res_id = snapshot["resource_id"]
            if snapshot["content"] is not None:
                self.resources[res_id] = snapshot["content"]
            else:
                self.resources.pop(res_id, None)

        target_res = applied_op.target_resource if applied_op else ResourceReference(
            resource_type=ResourceType.WEBSITE_PAGE,
            resource_id="unknown",
        )

        op_id = OperationId(
            provider_operation_id=f"mock_rollback_{op_key}",
            operation_type=ExecutionOperationType.ROLLBACK_CHANGE,
        )

        rollback_result = ChangeResult(
            operation_id=op_id,
            status=ExecutionStatus.ROLLED_BACK,
            target_resource=target_res,
            rolled_back_at=_utc_now(),
            rollback_supported=True,
            rollback_token=token,
            message=f"Successfully rolled back operation '{op_key}'",
            resulting_version="restored",
            metadata={"rolled_back_operation_id": op_key},
        )
        self.applied_operations[op_id.id] = rollback_result
        return rollback_result

    def get_change_status(
        self,
        operation_id: OperationId | str,
    ) -> ChangeResult:
        self._ensure_capability(ConnectorCapability.STATUS)
        self._check_simulation_hazards("get_change_status")

        op_key = operation_id.id if isinstance(operation_id, OperationId) else str(operation_id)
        result = self.applied_operations.get(op_key)
        if result is None:
            raise ResourceNotFoundError(
                message=f"Operation '{op_key}' not found in mock store",
                resource_id=op_key,
            )
        return result.model_copy(deep=True)


class NullConnector(BaseConnector):
    """
    Minimal Null Connector that declares only Read-Only capabilities and returns disconnected state.
    Used for disabled sites, unconfigured providers, or strictly non-mutating testing.
    """

    def __init__(
        self,
        site_id: int | str = 0,
        site_url: str = "https://unconfigured.local",
    ) -> None:
        context = SiteContext(
            site_id=site_id,
            site_url=site_url,
            provider="null",
            environment="none",
            auth_state=AuthState.DISCONNECTED,
            capabilities=ConnectorCapabilities.read_only(),
            last_health_status=HealthStatus.UNKNOWN,
        )
        super().__init__(context)

    def connect(self, credentials: dict[str, Any] | None = None) -> SiteContext:
        return self.get_site_context()

    def disconnect(self) -> SiteContext:
        return self.get_site_context()

    def health_check(self) -> ConnectorHealth:
        return ConnectorHealth(
            status=HealthStatus.UNKNOWN,
            latency_ms=0.0,
            message="Null connector: inactive",
            auth_state=AuthState.DISCONNECTED,
        )

    def get_site_context(self) -> SiteContext:
        return self._site_context.model_copy(deep=True)

    def read_resource(self, resource: ResourceReference) -> ResourceContent:
        self._ensure_capability(ConnectorCapability.READ)
        return ResourceContent(
            resource=resource,
            content="",
            content_type="text/plain",
            encoding="utf-8",
        )

    def preview_change(self, proposal: ChangeProposal) -> ChangePreview:
        self._ensure_capability(ConnectorCapability.PREVIEW)
        raise UnsupportedOperationError("NullConnector does not support change preview")

    def apply_change(self, proposal: ChangeProposal) -> ChangeResult:
        self._ensure_capability(ConnectorCapability.APPLY)
        raise UnsupportedOperationError("NullConnector does not support mutations")

    def rollback_change(
        self,
        operation_id: OperationId | str,
        rollback_token: str | None = None,
    ) -> ChangeResult:
        self._ensure_capability(ConnectorCapability.ROLLBACK)
        raise UnsupportedOperationError("NullConnector does not support rollback")

    def get_change_status(self, operation_id: OperationId | str) -> ChangeResult:
        self._ensure_capability(ConnectorCapability.STATUS)
        raise UnsupportedOperationError("NullConnector does not track change status")
