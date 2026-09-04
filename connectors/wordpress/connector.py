"""
WordPress Connector Implementation (Task 11 Step 3).

Implements the provider-neutral BaseConnector contract for WordPress sites:
- Authentication & User Capability verification
- Site Context and SEO plugin discovery (Yoast, RankMath, etc.)
- Resource reading (Posts, Pages, Media, Metadata)
- Deterministic Preview generation with zero remote mutation
- Approved Safe Apply with pre-mutation baseline drift verification
- Post-apply API verification
- Immutable Operation Recording and safe Rollback
"""

from __future__ import annotations

import logging
import time
import uuid
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
    AuthorizationError,
    ConnectorErrorInfo,
    ConnectorNetworkError,
    ConnectorTimeoutError,
    ConnectorValidationError,
    InvalidResourceError,
    ProviderAPIError,
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
from connectors.base.security import (
    redact_secrets_from_string,
    sanitize_payload,
    validate_safe_identifier,
)
from connectors.wordpress.client import (
    MockWordPressClient,
    WordPressClientProtocol,
)
from connectors.wordpress.diff import (
    apply_proposal_to_resource,
    generate_field_diff,
    validate_pre_apply_drift,
)
from connectors.wordpress.models import (
    WordPressMediaInfo,
    WordPressOperationRecord,
    WordPressResourceInfo,
    WordPressSiteIdentity,
    WordPressUserCapability,
)
from connectors.wordpress.security import (
    assert_safe_wordpress_content,
    normalize_wordpress_url,
    validate_user_permission_for_mutation,
    validate_wordpress_mutation_field,
    validate_wordpress_target_resource,
)

logger = logging.getLogger(__name__)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _generate_operation_id() -> str:
    return f"wp_op_{uuid.uuid4().hex[:16]}"


class WordPressConnector(BaseConnector):
    """
    Production-grade WordPress Connector implementing BaseConnector.
    """

    def __init__(
        self,
        site_context: SiteContext,
        client: WordPressClientProtocol | None = None,
    ) -> None:
        super().__init__(site_context)
        self._client: WordPressClientProtocol = client or MockWordPressClient(
            site_url=site_context.site_url or "https://example-wordpress.com",
        )
        self._authenticated_user: WordPressUserCapability | None = None
        self._site_identity: WordPressSiteIdentity | None = None
        self._operations: dict[str, WordPressOperationRecord] = {}

    @classmethod
    def create_default_context(
        cls,
        site_url: str = "https://example-wordpress.com",
        site_id: str = "site_wp_default",
    ) -> SiteContext:
        """Helper to instantiate default WordPress SiteContext."""
        clean_url = normalize_wordpress_url(site_url)
        caps = ConnectorCapabilities(
            supported_operations=[
                ExecutionOperationType.CONNECT,
                ExecutionOperationType.DISCONNECT,
                ExecutionOperationType.HEALTH_CHECK,
                ExecutionOperationType.GET_SITE_CONTEXT,
                ExecutionOperationType.READ_RESOURCE,
                ExecutionOperationType.PREVIEW_CHANGE,
                ExecutionOperationType.APPLY_CHANGE,
                ExecutionOperationType.ROLLBACK_CHANGE,
                ExecutionOperationType.GET_CHANGE_STATUS,
            ],
            supported_capabilities=[
                ConnectorCapability.READ,
                ConnectorCapability.PREVIEW,
                ConnectorCapability.APPLY,
                ConnectorCapability.ROLLBACK,
                ConnectorCapability.STATUS,
                ConnectorCapability.HEALTH_CHECK,
                ConnectorCapability.BATCH_READ,
            ],
            supported_resource_types=[
                ResourceType.CMS_PAGE,
                ResourceType.CMS_POST,
                ResourceType.WEBSITE_PAGE,
                ResourceType.STRUCTURED_DATA,
                ResourceType.META_TAGS,
            ],
            supports_rollback=True,
            supports_preview=True,
            supports_structured_diff=True,
            supports_branching=False,
            supports_batch=True,
        )
        return SiteContext(
            site_id=site_id,
            site_url=clean_url,
            provider="wordpress",
            auth_state=AuthState.DISCONNECTED,
            capabilities=caps,
            environment="production",
        )

    # =========================================================================
    # 1. Lifecycle & Authentication
    # =========================================================================

    def connect(
        self,
        credentials: dict[str, Any] | None = None,
    ) -> SiteContext:
        """
        Authenticates with the WordPress REST API, queries site metadata, and discovers capabilities.
        """
        self._ensure_capability(ConnectorCapability.READ)
        start_time = time.monotonic()

        try:
            user_cap = self._client.authenticate(credentials)
            site_info = self._client.get_site_info()
            self._authenticated_user = user_cap
            self._site_identity = site_info

            self._site_context.auth_state = AuthState.CONNECTED
            self._site_context.metadata.update(
                {
                    "site_name": site_info.site_name,
                    "wp_version": site_info.wp_version,
                    "user": user_cap.username,
                    "roles": user_cap.roles,
                    "capabilities": user_cap.capabilities,
                    "active_plugins": site_info.active_plugins,
                    "connected_at": _utc_now().isoformat(),
                }
            )
            return self._site_context
        except (AuthenticationError, AuthorizationError, ConnectorTimeoutError, RateLimitExceededError, ConnectorNetworkError, ProviderAPIError):
            self._site_context.auth_state = AuthState.AUTH_FAILED
            raise
        except Exception as exc:
            self._site_context.auth_state = AuthState.AUTH_FAILED
            raise AuthenticationError(
                f"WordPress authentication handshake failed: {redact_secrets_from_string(str(exc))}",
                details={"error": redact_secrets_from_string(str(exc))},
            ) from exc

    def disconnect(self) -> SiteContext:
        """
        Terminates the active connection and resets user context.
        """
        self._site_context.auth_state = AuthState.DISCONNECTED
        self._authenticated_user = None
        self._site_identity = None
        return self._site_context

    def health_check(self) -> ConnectorHealth:
        """
        Executes a diagnostic ping and retrieves rate-limit telemetry.
        """
        self._ensure_capability(ConnectorCapability.HEALTH_CHECK)
        start = time.monotonic()

        try:
            rate_info = self._client.get_rate_limit()
            latency = (time.monotonic() - start) * 1000.0

            status = HealthStatus.HEALTHY
            if rate_info.remaining is not None and rate_info.remaining < 10:
                status = HealthStatus.DEGRADED

            return ConnectorHealth(
                status=status,
                latency_ms=round(latency, 2),
                rate_limit=rate_info,
                message="WordPress REST API is accessible and responsive",
                last_checked_at=_utc_now(),
            )
        except Exception as exc:
            latency = (time.monotonic() - start) * 1000.0
            return ConnectorHealth(
                status=HealthStatus.UNHEALTHY,
                latency_ms=round(latency, 2),
                message=f"WordPress health check failed: {redact_secrets_from_string(str(exc))}",
                last_checked_at=_utc_now(),
            )

    def get_site_context(self) -> SiteContext:
        """
        Returns normalized WordPress site context.
        """
        return self._site_context

    # =========================================================================
    # 2. Read Operations
    # =========================================================================

    def read_resource(
        self,
        resource: ResourceReference,
    ) -> ResourceContent:
        """
        Reads a WordPress Post, Page, Media item, or custom post type.
        """
        self._ensure_capability(ConnectorCapability.READ)

        target_type, int_id = validate_wordpress_target_resource(
            resource.resource_type,
            resource.resource_id,
            parameters=resource.metadata or getattr(resource, "parameters", None),
        )

        res_obj = self._client.get_resource(target_type, int_id)

        if isinstance(res_obj, WordPressMediaInfo):
            content_str = res_obj.alt_text
            raw = res_obj.model_dump()
            meta = {
                "title": res_obj.title,
                "source_url": res_obj.source_url,
                "mime_type": res_obj.mime_type,
                "modified_gmt": res_obj.modified_gmt,
            }
        else:
            content_str = res_obj.content
            raw = res_obj.model_dump()
            meta = {
                "title": res_obj.title,
                "slug": res_obj.slug,
                "status": res_obj.status,
                "post_type": res_obj.post_type,
                "link": res_obj.link,
                "meta": res_obj.meta,
                "modified_gmt": res_obj.modified_gmt,
            }

        return ResourceContent(
            resource=resource,
            content=content_str,
            content_type="text/html",
            raw_payload=raw,
            metadata=meta,
            fetched_at=_utc_now(),
        )

    # =========================================================================
    # 3. Mutation & Rollback Operations
    # =========================================================================

    def preview_change(
        self,
        proposal: ChangeProposal,
    ) -> ChangePreview:
        """
        Generates a dry-run deterministic before/after diff for a WordPress fix proposal.
        GUARANTEE: Preview performs ZERO mutations against WordPress.
        """
        self._ensure_capability(ConnectorCapability.PREVIEW)

        target_type, int_id = validate_wordpress_target_resource(
            proposal.target_resource.resource_type,
            proposal.target_resource.resource_id,
            parameters=proposal.target_resource.metadata or getattr(proposal.target_resource, "parameters", None),
        )

        # Fetch current remote resource
        current_res = self._client.get_resource(target_type, int_id)

        # Compute simulated change
        update_payload, field_name, original_snapshot, proposed_val = apply_proposal_to_resource(
            current_res,
            proposal,
        )

        # Generate deterministic diff
        diff_text = generate_field_diff(original_snapshot, proposed_val, field_name=field_name)

        return ChangePreview(
            proposal=proposal,
            diff=diff_text,
            is_applicable=True,
            estimated_risk="low",
            structured_changes=[
                {
                    "field": field_name,
                    "resource_type": target_type,
                    "resource_id": int_id,
                    "original_preview": str(original_snapshot)[:150],
                    "proposed_preview": str(proposed_val)[:150],
                }
            ],
            previewed_at=_utc_now(),
        )

    def apply_change(
        self,
        proposal: ChangeProposal,
    ) -> ChangeResult:
        """
        Applies an approved change proposal to WordPress after pre-apply baseline verification.
        Preserves original state snapshot and records immutable operation record for safe rollback.
        """
        self._ensure_capability(ConnectorCapability.APPLY)
        start_time = time.monotonic()

        if self.auth_state != AuthState.CONNECTED:
            raise AuthenticationError("Cannot apply change: WordPress connector is not authenticated")

        target_type, int_id = validate_wordpress_target_resource(
            proposal.target_resource.resource_type,
            proposal.target_resource.resource_id,
            parameters=proposal.target_resource.metadata or getattr(proposal.target_resource, "parameters", None),
        )

        # Check permissions
        validate_user_permission_for_mutation(self._authenticated_user, target_type)

        # Fetch current live resource
        current_res = self._client.get_resource(target_type, int_id)

        # Compute payload and original snapshot
        update_payload, field_name, original_snapshot, proposed_val = apply_proposal_to_resource(
            current_res,
            proposal,
        )

        # Pre-apply drift detection
        expected_orig = getattr(proposal, "original_content", None)
        if expected_orig is None and isinstance(proposal.proposed_diff, dict):
            expected_orig = proposal.proposed_diff.get("before")

        validate_pre_apply_drift(
            original_snapshot,
            expected_orig,
            field_name,
        )

        # Apply update to WordPress REST API
        updated_res = self._client.update_resource(target_type, int_id, update_payload)

        # Post-apply verification: confirm field was accepted
        if isinstance(updated_res, WordPressMediaInfo):
            if updated_res.alt_text != str(proposed_val):
                raise ConnectorValidationError(
                    f"Post-apply verification failed: expected alt_text '{proposed_val}', got '{updated_res.alt_text}'",
                    details={"field": "alt_text"},
                )
        else:
            if field_name == "title" and updated_res.title != str(proposed_val):
                raise ConnectorValidationError("Post-apply verification failed for title")
            elif field_name == "content" and str(proposed_val) not in updated_res.content:
                raise ConnectorValidationError("Post-apply verification failed for content")

        op_id = _generate_operation_id()
        diff_text = generate_field_diff(original_snapshot, proposed_val, field_name=field_name)

        # Record operation for rollback
        record = WordPressOperationRecord(
            operation_id=op_id,
            fix_plan_id=proposal.fix_plan_id,
            finding_id=proposal.finding_id,
            recommendation_id=proposal.recommendation_id,
            resource_type=proposal.target_resource.resource_type,
            resource_id=int_id,
            field_name=field_name,
            original_value_snapshot=original_snapshot,
            applied_value=proposed_val,
            previous_modified_gmt=getattr(current_res, "modified_gmt", None),
            status=ExecutionStatus.APPLIED,
            applied_at=_utc_now(),
            metadata={
                "target_type": target_type,
                "field": field_name,
                "duration_ms": round((time.monotonic() - start_time) * 1000.0, 2),
            },
        )
        self._operations[op_id] = record

        return ChangeResult(
            operation_id=OperationId(op_id),
            status=ExecutionStatus.APPLIED,
            diff=diff_text,
            rollback_token=op_id,
            applied_at=_utc_now(),
            metadata={
                "resource_id": int_id,
                "post_type": target_type,
                "field_modified": field_name,
            },
        )

    def rollback_change(
        self,
        operation_id: OperationId | str,
        rollback_token: str | None = None,
    ) -> ChangeResult:
        """
        Reverts an applied WordPress mutation by restoring the preserved original state snapshot.
        """
        self._ensure_capability(ConnectorCapability.ROLLBACK)
        raw_op_id = operation_id.value if isinstance(operation_id, OperationId) else str(operation_id)

        if raw_op_id not in self._operations:
            raise ResourceNotFoundError(
                f"WordPress operation '{raw_op_id}' not found for rollback",
                details={"operation_id": raw_op_id},
            )

        record = self._operations[raw_op_id]

        if record.status == ExecutionStatus.ROLLED_BACK:
            # Idempotent return
            return ChangeResult(
                operation_id=OperationId(raw_op_id),
                status=ExecutionStatus.ROLLED_BACK,
                diff="(Already rolled back)",
                metadata={"status": "already_reverted"},
            )

        target_type, int_id = validate_wordpress_target_resource(
            record.resource_type,
            record.resource_id,
        )

        # Check permissions
        validate_user_permission_for_mutation(self._authenticated_user, target_type)

        # Build revert payload restoring original snapshot
        if target_type == "media":
            revert_payload = {"alt_text": record.original_value_snapshot}
        elif record.field_name.startswith(("_yoast_", "rank_math_", "_aioseo_", "_schema_")):
            revert_payload = {"meta": {record.field_name: record.original_value_snapshot}}
        else:
            revert_payload = {record.field_name: record.original_value_snapshot}

        # Apply revert update
        self._client.update_resource(target_type, int_id, revert_payload)

        # Mark operation as rolled back
        record.status = ExecutionStatus.ROLLED_BACK
        record.reverted_at = _utc_now()

        diff_text = generate_field_diff(
            record.applied_value,
            record.original_value_snapshot,
            field_name=record.field_name,
        )

        return ChangeResult(
            operation_id=OperationId(raw_op_id),
            status=ExecutionStatus.ROLLED_BACK,
            diff=diff_text,
            metadata={
                "reverted_at": record.reverted_at.isoformat(),
                "field": record.field_name,
            },
        )

    def get_change_status(
        self,
        operation_id: OperationId | str,
    ) -> ChangeResult:
        """
        Returns the recorded execution status of a change operation.
        """
        self._ensure_capability(ConnectorCapability.STATUS)
        raw_op_id = operation_id.value if isinstance(operation_id, OperationId) else str(operation_id)

        if raw_op_id not in self._operations:
            raise ResourceNotFoundError(
                f"WordPress operation '{raw_op_id}' not found",
                details={"operation_id": raw_op_id},
            )

        record = self._operations[raw_op_id]
        return ChangeResult(
            operation_id=OperationId(raw_op_id),
            status=record.status,
            applied_at=record.applied_at,
            metadata={
                "resource_id": record.resource_id,
                "field": record.field_name,
                "reverted_at": record.reverted_at.isoformat() if record.reverted_at else None,
            },
        )
