"""
Targeted Rescan Policy Engine (Task 12 Step 4).

Determines the smallest safe post-fix rescan scope (TARGETED_RESCAN, RELATED_RESCAN,
or FULL_RESCAN) based on deterministic change-impact evidence. Adheres strictly to
the Safety First Principle: if safe impact cannot be bounded, escalates to FULL_RESCAN.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urljoin, urlparse

from pydantic import BaseModel, ConfigDict, Field

from connectors.base.security import (
    redact_secrets_from_string,
    sanitize_payload,
    validate_safe_identifier,
)

from .impact_model import (
    ChangeImpactGraph,
    ChangeType,
    DependencyType,
    ImpactReason,
    ImpactedResource,
    RescanScope,
    _normalize_resource_id,
)

logger = logging.getLogger(__name__)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _generate_id(prefix: str = "rescan") -> str:
    return f"{prefix}_{uuid.uuid4().hex[:16]}"


def _validate_safe_url(url: str, site_url: str) -> None:
    """Validates URL against basic SSRF and scheme safety checks."""
    if not url:
        return
    parsed = urlparse(url)
    if parsed.scheme and parsed.scheme not in ("http", "https"):
        raise ValueError(f"Forbidden or unsafe URL scheme: {parsed.scheme}")
    
    # Check hostname doesn't target localhost/loopback when site_url is remote
    site_parsed = urlparse(site_url)
    if site_parsed.netloc and parsed.netloc:
        if parsed.netloc.lower() != site_parsed.netloc.lower():
            # Disallow cross-domain scanning
            raise ValueError(f"Cross-host target forbidden: {parsed.netloc} != {site_parsed.netloc}")


# =============================================================================
# 1. Request & Decision Models
# =============================================================================

class TargetedRescanRequest(BaseModel):
    """
    Structured request specifying the change context to evaluate rescan scope.
    """
    model_config = ConfigDict(extra="ignore")

    rescan_id: str = Field(
        default_factory=lambda: _generate_id("rescan"),
        description="Unique rescan request identifier",
    )
    execution_id: str = Field(
        ...,
        description="Trace execution identifier",
    )
    workspace_id: str | None = Field(
        default=None,
        description="Tenant / Workspace ID for multi-tenant isolation",
    )
    site_url: str = Field(
        ...,
        description="Base site URL",
    )
    changed_resources: list[str] = Field(
        ...,
        description="List of directly mutated resource IDs or URL paths (e.g. ['/about.html'])",
    )
    change_type: ChangeType = Field(
        default=ChangeType.PAGE_METADATA,
        description="Categorization of the change performed",
    )
    changed_fields: list[str] = Field(
        default_factory=list,
        description="Specific fields modified (e.g. ['title', 'meta_description'])",
    )
    requested_scope: RescanScope | None = Field(
        default=None,
        description="Explicit user/system override scope if specified",
    )
    idempotency_key: str | None = Field(
        default=None,
        description="Idempotency key to safely handle repeated requests",
    )
    max_graph_age_seconds: float = Field(
        default=3600.0,
        description="Maximum acceptable age of the dependency graph before escalation to FULL_RESCAN",
    )
    max_related_resources: int = Field(
        default=20,
        description="Maximum bounded size of related resources before escalating to FULL_RESCAN",
    )
    created_at: datetime = Field(
        default_factory=_utc_now,
        description="Request construction timestamp (UTC)",
    )
    metadata: dict[str, Any] = Field(
        default_factory=dict,
        description="Diagnostic and audit metadata",
    )

    def model_post_init(self, __context: Any) -> None:
        validate_safe_identifier(self.rescan_id, "rescan_id")
        validate_safe_identifier(self.execution_id, "execution_id")
        if self.workspace_id:
            validate_safe_identifier(self.workspace_id, "workspace_id")
        if self.idempotency_key:
            validate_safe_identifier(self.idempotency_key, "idempotency_key")
        if self.metadata:
            object.__setattr__(self, "metadata", sanitize_payload(self.metadata))


class RescanScopeDecision(BaseModel):
    """
    Deterministic, explainable decision specifying the post-fix rescan scope and targets.
    """
    model_config = ConfigDict(extra="ignore")

    decision_id: str = Field(
        default_factory=lambda: _generate_id("dec"),
        description="Unique decision identifier",
    )
    rescan_id: str = Field(
        ...,
        description="Associated TargetedRescanRequest ID",
    )
    execution_id: str = Field(
        ...,
        description="Associated execution trace ID",
    )
    scope: RescanScope = Field(
        ...,
        description="Determined rescan scope (TARGETED_RESCAN, RELATED_RESCAN, or FULL_RESCAN)",
    )
    selected_resources: list[ImpactedResource] = Field(
        default_factory=list,
        description="Deterministic list of resources to rescan with explicit reasons",
    )
    primary_reason: str = Field(
        ...,
        description="High-level policy explanation for the decision",
    )
    reasons_by_resource: dict[str, ImpactReason] = Field(
        default_factory=dict,
        description="Direct mapping of resource ID -> ImpactReason",
    )
    dependency_evidence: dict[str, Any] = Field(
        default_factory=dict,
        description="Evidence and relationship subgraph backing the decision",
    )
    is_escalated_to_full: bool = Field(
        default=False,
        description="True if scope was escalated to FULL_RESCAN due to safety policy or staleness",
    )
    escalation_reason: str | None = Field(
        default=None,
        description="Specific safety trigger causing escalation to FULL_RESCAN",
    )
    graph_freshness_seconds: float | None = Field(
        default=None,
        description="Age of dependency graph in seconds at decision time",
    )
    created_at: datetime = Field(
        default_factory=_utc_now,
        description="Timestamp when decision was evaluated (UTC)",
    )
    metadata: dict[str, Any] = Field(
        default_factory=dict,
        description="Diagnostic telemetry",
    )


# =============================================================================
# 2. Rescan Policy Engine
# =============================================================================

class RescanPolicyEngine:
    """
    Deterministic rule engine evaluating change-impact graphs and requests
    to produce explainable rescan scope decisions.
    """

    @classmethod
    def decide_scope(
        cls,
        request: TargetedRescanRequest,
        graph: ChangeImpactGraph | None = None,
        all_site_resources: list[str] | None = None,
    ) -> RescanScopeDecision:
        """
        Determines the smallest safe rescan scope for a given mutation request.
        """
        # 1. Security & Workspace Isolation
        for res in request.changed_resources:
            _validate_safe_url(res, request.site_url)

        if graph is not None and graph.workspace_id and request.workspace_id:
            if graph.workspace_id != request.workspace_id:
                raise ValueError(
                    f"Workspace isolation violation: graph belongs to '{graph.workspace_id}', "
                    f"request is for '{request.workspace_id}'"
                )

        known_resources = list(all_site_resources) if all_site_resources else []
        if graph and graph.nodes:
            for n in graph.nodes.keys():
                if n not in known_resources:
                    known_resources.append(n)

        # 2. Check for Missing Graph -> Escalate to FULL_RESCAN
        if graph is None or not graph.is_valid:
            logger.info("Dependency graph is missing or invalid. Escalating to FULL_RESCAN.")
            return cls._build_full_rescan_fallback(
                request=request,
                all_resources=known_resources,
                reason=ImpactReason.MISSING_GRAPH_FALLBACK,
                escalation_reason="MISSING_GRAPH_FALLBACK",
                primary_explanation="Dependency graph is unavailable or invalid; safe bounded scope cannot be determined.",
            )

        # 3. Check for Stale Graph -> Escalate to FULL_RESCAN
        graph_age = (_utc_now() - graph.created_at).total_seconds()
        if graph.is_stale(max_age_seconds=request.max_graph_age_seconds):
            logger.info("Dependency graph is stale (age=%.1fs > max=%.1fs). Escalating to FULL_RESCAN.", graph_age, request.max_graph_age_seconds)
            return cls._build_full_rescan_fallback(
                request=request,
                all_resources=known_resources,
                reason=ImpactReason.STALE_DEPENDENCY_FALLBACK,
                escalation_reason="STALE_DEPENDENCY_FALLBACK",
                primary_explanation=f"Dependency graph is stale ({graph_age:.1f}s old); escalating to FULL_RESCAN for correctness.",
                graph_age=graph_age,
            )

        # 4. Check for Global / Template Changes -> FULL_RESCAN
        if request.change_type in (ChangeType.TEMPLATE_SHARED, ChangeType.SITE_WIDE_GLOBAL):
            reason = (
                ImpactReason.TEMPLATE_DEPENDENCY
                if request.change_type == ChangeType.TEMPLATE_SHARED
                else ImpactReason.GLOBAL_CHANGE
            )
            return cls._build_full_rescan_fallback(
                request=request,
                all_resources=known_resources,
                reason=reason,
                escalation_reason=None,
                primary_explanation=f"Change type '{request.change_type.value}' affects site-wide components; full rescan required.",
                graph_age=graph_age,
            )

        # 5. Check for Unknown Change Type -> Escalate to FULL_RESCAN
        if request.change_type == ChangeType.UNKNOWN:
            return cls._build_full_rescan_fallback(
                request=request,
                all_resources=known_resources,
                reason=ImpactReason.UNKNOWN_DEPENDENCY_FALLBACK,
                escalation_reason="UNKNOWN_DEPENDENCY_FALLBACK",
                primary_explanation="Unknown change type cannot safely bound impact scope; escalating to FULL_RESCAN.",
                graph_age=graph_age,
            )

        # 6. Local Page Changes -> TARGETED_RESCAN
        if request.change_type in (
            ChangeType.PAGE_METADATA,
            ChangeType.HEADINGS,
            ChangeType.STRUCTURED_DATA,
            ChangeType.ACCESSIBILITY,
        ):
            selected: list[ImpactedResource] = []
            reasons: dict[str, ImpactReason] = {}
            for res_path in request.changed_resources:
                norm_res = _normalize_resource_id(res_path, request.site_url)
                full_url = urljoin(request.site_url, norm_res)
                item = ImpactedResource(
                    resource_id=norm_res,
                    resource_url=full_url,
                    reason=ImpactReason.DIRECTLY_CHANGED,
                    depth=0,
                    evidence={
                        "change_type": request.change_type.value,
                        "changed_fields": request.changed_fields,
                    },
                )
                selected.append(item)
                reasons[norm_res] = ImpactReason.DIRECTLY_CHANGED

            return RescanScopeDecision(
                rescan_id=request.rescan_id,
                execution_id=request.execution_id,
                scope=RescanScope.TARGETED_RESCAN,
                selected_resources=selected,
                primary_reason=f"Localized {request.change_type.value} change affects only directly modified resource(s).",
                reasons_by_resource=reasons,
                dependency_evidence={"impacted_count": len(selected), "change_type": request.change_type.value},
                is_escalated_to_full=False,
                graph_freshness_seconds=graph_age,
            )

        # 7. Relational / Dependency Changes -> RELATED_RESCAN
        dep_types = cls._map_change_type_to_dependencies(request.change_type)
        all_impacted_map: dict[str, ImpactedResource] = {}

        for res_path in request.changed_resources:
            norm_res = _normalize_resource_id(res_path, request.site_url)
            dep_list = graph.get_dependencies(norm_res, dependency_types=dep_types, max_depth=1)
            for imp in dep_list:
                if imp.resource_id not in all_impacted_map or imp.depth < all_impacted_map[imp.resource_id].depth:
                    all_impacted_map[imp.resource_id] = imp

        selected = sorted(list(all_impacted_map.values()), key=lambda x: (x.depth, x.resource_id))

        # Check Boundedness
        if len(selected) > request.max_related_resources:
            logger.info(
                "Impacted resources count (%d) exceeds max_related_resources (%d). Escalating to FULL_RESCAN.",
                len(selected),
                request.max_related_resources,
            )
            return cls._build_full_rescan_fallback(
                request=request,
                all_resources=known_resources,
                reason=ImpactReason.UNKNOWN_DEPENDENCY_FALLBACK,
                escalation_reason="UNBOUNDED_DEPENDENCY_SET",
                primary_explanation=f"Related impact set ({len(selected)} pages) exceeded safe bound ({request.max_related_resources}); escalating to FULL_RESCAN.",
                graph_age=graph_age,
            )

        reasons = {item.resource_id: item.reason for item in selected}
        scope = RescanScope.RELATED_RESCAN if len(selected) > len(request.changed_resources) else RescanScope.TARGETED_RESCAN

        return RescanScopeDecision(
            rescan_id=request.rescan_id,
            execution_id=request.execution_id,
            scope=scope,
            selected_resources=selected,
            primary_reason=f"Change type '{request.change_type.value}' impacted {len(selected)} resource(s) via deterministic dependency analysis.",
            reasons_by_resource=reasons,
            dependency_evidence={
                "change_type": request.change_type.value,
                "dependency_types_checked": [dt.value for dt in (dep_types or [])],
                "impacted_count": len(selected),
            },
            is_escalated_to_full=False,
            graph_freshness_seconds=graph_age,
        )

    @classmethod
    def _map_change_type_to_dependencies(cls, change_type: ChangeType) -> list[DependencyType] | None:
        """Maps a ChangeType to relevant DependencyTypes to query in the graph."""
        if change_type == ChangeType.INTERNAL_LINKS:
            return [DependencyType.LINKS_TO, DependencyType.LINKED_FROM, DependencyType.REDIRECTS_TO]
        if change_type == ChangeType.CANONICAL:
            return [DependencyType.CANONICAL_TO, DependencyType.CANONICAL_FROM]
        if change_type == ChangeType.SITEMAP:
            return [DependencyType.IN_SITEMAP]
        if change_type == ChangeType.ENTITY:
            return [DependencyType.SHARES_ENTITY]
        if change_type == ChangeType.CONTENT_TOPIC:
            return [DependencyType.SHARES_TOPIC]
        return None

    @classmethod
    def _build_full_rescan_fallback(
        cls,
        request: TargetedRescanRequest,
        all_resources: list[str],
        reason: ImpactReason,
        escalation_reason: str | None,
        primary_explanation: str,
        graph_age: float | None = None,
    ) -> RescanScopeDecision:
        """Constructs a FULL_RESCAN decision with explicit per-resource reasons."""
        target_list = all_resources if all_resources else request.changed_resources
        # Ensure at least changed_resources are in target list
        combined_targets = list(set(target_list + request.changed_resources))
        combined_targets.sort()

        selected: list[ImpactedResource] = []
        reasons: dict[str, ImpactReason] = {}

        for res in combined_targets:
            norm_res = _normalize_resource_id(res, request.site_url)
            full_url = urljoin(request.site_url, norm_res)
            res_reason = (
                ImpactReason.DIRECTLY_CHANGED
                if res in request.changed_resources
                else reason
            )
            item = ImpactedResource(
                resource_id=norm_res,
                resource_url=full_url,
                reason=res_reason,
                depth=0 if res in request.changed_resources else 1,
                evidence={"escalation_reason": escalation_reason, "fallback": True},
            )
            selected.append(item)
            reasons[norm_res] = res_reason

        return RescanScopeDecision(
            rescan_id=request.rescan_id,
            execution_id=request.execution_id,
            scope=RescanScope.FULL_RESCAN,
            selected_resources=selected,
            primary_reason=primary_explanation,
            reasons_by_resource=reasons,
            dependency_evidence={
                "total_site_resources": len(selected),
                "escalation_reason": escalation_reason,
            },
            is_escalated_to_full=escalation_reason is not None,
            escalation_reason=escalation_reason,
            graph_freshness_seconds=graph_age,
        )
