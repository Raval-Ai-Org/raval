"""
Change-Impact Model and Dependency Graph (Task 12 Step 4).

Represents deterministic relationships among web resources (links, canonicals,
sitemaps, entities, topics, shared templates) and classifies changes to identify
impacted resources with explicit, auditable reasons.
"""

from __future__ import annotations

import hashlib
import logging
from datetime import datetime, timezone
from enum import Enum
from typing import Any
from urllib.parse import urljoin, urlparse

from pydantic import BaseModel, ConfigDict, Field

from app.page_extractor import ExtractionResult
from connectors.base.security import sanitize_payload, validate_safe_identifier

logger = logging.getLogger(__name__)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _normalize_resource_id(res_id: str, base_url: str | None = None) -> str:
    """Normalizes a resource identifier or URL path."""
    if not res_id:
        return "/"
    res_id = res_id.strip()
    if res_id.startswith("http://") or res_id.startswith("https://"):
        parsed = urlparse(res_id)
        path = parsed.path or "/"
        return path if path.startswith("/") else f"/{path}"
    if not res_id.startswith("/"):
        return f"/{res_id}"
    return res_id


# =============================================================================
# 1. Enums
# =============================================================================

class RescanScope(str, Enum):
    """Deterministic scope levels for post-fix rescanning."""
    TARGETED_RESCAN = "TARGETED_RESCAN"
    RELATED_RESCAN = "RELATED_RESCAN"
    FULL_RESCAN = "FULL_RESCAN"


class ChangeType(str, Enum):
    """Categorization of fix / mutation changes."""
    PAGE_METADATA = "PAGE_METADATA"          # Title, description, robots meta, language
    HEADINGS = "HEADINGS"                    # H1, H2, heading hierarchy
    STRUCTURED_DATA = "STRUCTURED_DATA"      # JSON-LD Schema.org markup
    ACCESSIBILITY = "ACCESSIBILITY"          # Image alt text, aria attributes
    INTERNAL_LINKS = "INTERNAL_LINKS"        # Added/removed/changed internal anchor links
    CANONICAL = "CANONICAL"                  # Canonical link tag additions or updates
    SITEMAP = "SITEMAP"                      # Sitemap XML updates or resource inclusion
    ENTITY = "ENTITY"                        # Entity mention, definition, or schema reference
    CONTENT_TOPIC = "CONTENT_TOPIC"          # Content body, topic signals, direct answer blocks
    TEMPLATE_SHARED = "TEMPLATE_SHARED"      # Shared header, footer, navigation bar, sidebar
    SITE_WIDE_GLOBAL = "SITE_WIDE_GLOBAL"    # Global robots.txt, 301 rules, sitewide settings
    UNKNOWN = "UNKNOWN"                      # Unrecognized or unbounded change


class ImpactReason(str, Enum):
    """Deterministic, explainable reason why a resource is selected for rescan."""
    DIRECTLY_CHANGED = "DIRECTLY_CHANGED"
    INTERNAL_LINK_DEPENDENCY = "INTERNAL_LINK_DEPENDENCY"
    CANONICAL_DEPENDENCY = "CANONICAL_DEPENDENCY"
    SITEMAP_DEPENDENCY = "SITEMAP_DEPENDENCY"
    ENTITY_DEPENDENCY = "ENTITY_DEPENDENCY"
    CONTENT_DEPENDENCY = "CONTENT_DEPENDENCY"
    TOPIC_DEPENDENCY = "TOPIC_DEPENDENCY"
    TEMPLATE_DEPENDENCY = "TEMPLATE_DEPENDENCY"
    GLOBAL_CHANGE = "GLOBAL_CHANGE"
    UNKNOWN_DEPENDENCY_FALLBACK = "UNKNOWN_DEPENDENCY_FALLBACK"
    STALE_DEPENDENCY_FALLBACK = "STALE_DEPENDENCY_FALLBACK"
    MISSING_GRAPH_FALLBACK = "MISSING_GRAPH_FALLBACK"


class DependencyType(str, Enum):
    """Types of directional or relational dependencies between resources."""
    LINKS_TO = "LINKS_TO"
    LINKED_FROM = "LINKED_FROM"
    CANONICAL_TO = "CANONICAL_TO"
    CANONICAL_FROM = "CANONICAL_FROM"
    IN_SITEMAP = "IN_SITEMAP"
    SHARES_ENTITY = "SHARES_ENTITY"
    SHARES_TOPIC = "SHARES_TOPIC"
    USES_TEMPLATE = "USES_TEMPLATE"
    REDIRECTS_TO = "REDIRECTS_TO"


# =============================================================================
# 2. Dependency Graph Models
# =============================================================================

class DependencyEdge(BaseModel):
    """Directed relationship between two resources."""
    model_config = ConfigDict(extra="ignore")

    source: str = Field(..., description="Source resource ID or path")
    target: str = Field(..., description="Target resource ID or path")
    dependency_type: DependencyType = Field(..., description="Type of relationship")
    weight: float = Field(default=1.0, description="Strength or directness of relationship")
    metadata: dict[str, Any] = Field(default_factory=dict, description="Edge context metadata")


class ImpactedResource(BaseModel):
    """Specific resource identified as impacted by a mutation."""
    model_config = ConfigDict(extra="ignore")

    resource_id: str = Field(..., description="Canonical resource ID or path (e.g. /about.html)")
    resource_url: str | None = Field(default=None, description="Resolved full URL if known")
    reason: ImpactReason = Field(..., description="Explainable impact reason")
    depth: int = Field(default=0, description="Dependency distance (0 for directly changed, 1 for direct link, etc.)")
    evidence: dict[str, Any] = Field(default_factory=dict, description="Structured evidence supporting selection")
    metadata: dict[str, Any] = Field(default_factory=dict, description="Diagnostic metadata")


class ChangeImpactGraph(BaseModel):
    """
    Deterministic, queryable in-memory dependency graph for a website.
    Maintains nodes (resources) and typed dependency edges.
    """
    model_config = ConfigDict(extra="ignore")

    graph_id: str = Field(default_factory=lambda: f"graph_{_utc_now().strftime('%Y%m%d%H%M%S')}")
    site_url: str = Field(..., description="Base site URL")
    workspace_id: str | None = Field(default=None, description="Associated workspace ID")
    nodes: dict[str, dict[str, Any]] = Field(default_factory=dict, description="Resource nodes mapping (path -> metadata)")
    edges: list[DependencyEdge] = Field(default_factory=list, description="Directed dependency edges")
    created_at: datetime = Field(default_factory=_utc_now, description="Graph generation timestamp (UTC)")
    is_valid: bool = Field(default=True, description="Whether the graph is healthy and usable")

    def is_stale(self, max_age_seconds: float = 3600.0) -> bool:
        """Determines if the dependency graph exceeds maximum acceptable age."""
        if not self.is_valid:
            return True
        age = (_utc_now() - self.created_at).total_seconds()
        return age > max_age_seconds

    def add_node(self, resource_id: str, attributes: dict[str, Any] | None = None) -> None:
        """Adds or updates a resource node in the graph."""
        norm_id = _normalize_resource_id(resource_id, self.site_url)
        attrs = attributes or {}
        if norm_id not in self.nodes:
            self.nodes[norm_id] = {
                "resource_id": norm_id,
                "added_at": _utc_now().isoformat(),
                **attrs,
            }
        else:
            self.nodes[norm_id].update(attrs)

    def add_edge(
        self,
        source: str,
        target: str,
        dependency_type: DependencyType,
        weight: float = 1.0,
        metadata: dict[str, Any] | None = None,
    ) -> None:
        """Adds a directed dependency edge between two resources."""
        norm_src = _normalize_resource_id(source, self.site_url)
        norm_tgt = _normalize_resource_id(target, self.site_url)

        self.add_node(norm_src)
        self.add_node(norm_tgt)

        # Avoid duplicate identical edges
        for existing in self.edges:
            if (
                existing.source == norm_src
                and existing.target == norm_tgt
                and existing.dependency_type == dependency_type
            ):
                existing.weight = weight
                existing.metadata.update(metadata or {})
                return

        self.edges.append(
            DependencyEdge(
                source=norm_src,
                target=norm_tgt,
                dependency_type=dependency_type,
                weight=weight,
                metadata=metadata or {},
            )
        )

    def get_dependencies(
        self,
        resource_id: str,
        dependency_types: list[DependencyType] | None = None,
        max_depth: int = 1,
    ) -> list[ImpactedResource]:
        """
        Queries all dependent or related resources connected to the given resource.
        """
        norm_id = _normalize_resource_id(resource_id, self.site_url)
        impacted: dict[str, ImpactedResource] = {}

        # The directly changed resource is always included at depth 0
        resolved_url = urljoin(self.site_url, norm_id)
        impacted[norm_id] = ImpactedResource(
            resource_id=norm_id,
            resource_url=resolved_url,
            reason=ImpactReason.DIRECTLY_CHANGED,
            depth=0,
            evidence={"source": norm_id, "direct": True},
        )

        allowed_types = set(dependency_types) if dependency_types else None
        visited: set[str] = {norm_id}
        current_layer: set[str] = {norm_id}

        for current_depth in range(1, max_depth + 1):
            next_layer: set[str] = set()
            for current_node in current_layer:
                for edge in self.edges:
                    if allowed_types and edge.dependency_type not in allowed_types:
                        continue

                    # Forward dependency (A links to B, A canonical to B, etc.)
                    if edge.source == current_node and edge.target not in visited:
                        reason = self._map_dep_type_to_reason(edge.dependency_type)
                        tgt_url = urljoin(self.site_url, edge.target)
                        impacted[edge.target] = ImpactedResource(
                            resource_id=edge.target,
                            resource_url=tgt_url,
                            reason=reason,
                            depth=current_depth,
                            evidence={
                                "related_from": current_node,
                                "dependency_type": edge.dependency_type.value,
                                "edge_metadata": edge.metadata,
                            },
                        )
                        visited.add(edge.target)
                        next_layer.add(edge.target)

                    # Reverse dependency (B links to A, B canonical to A, etc.)
                    elif edge.target == current_node and edge.source not in visited:
                        reason = self._map_dep_type_to_reason(edge.dependency_type)
                        src_url = urljoin(self.site_url, edge.source)
                        impacted[edge.source] = ImpactedResource(
                            resource_id=edge.source,
                            resource_url=src_url,
                            reason=reason,
                            depth=current_depth,
                            evidence={
                                "related_to": current_node,
                                "dependency_type": edge.dependency_type.value,
                                "edge_metadata": edge.metadata,
                            },
                        )
                        visited.add(edge.source)
                        next_layer.add(edge.source)

            current_layer = next_layer
            if not current_layer:
                break

        return list(impacted.values())

    @staticmethod
    def _map_dep_type_to_reason(dep_type: DependencyType) -> ImpactReason:
        """Maps a DependencyType enum to its corresponding explainable ImpactReason."""
        mapping = {
            DependencyType.LINKS_TO: ImpactReason.INTERNAL_LINK_DEPENDENCY,
            DependencyType.LINKED_FROM: ImpactReason.INTERNAL_LINK_DEPENDENCY,
            DependencyType.CANONICAL_TO: ImpactReason.CANONICAL_DEPENDENCY,
            DependencyType.CANONICAL_FROM: ImpactReason.CANONICAL_DEPENDENCY,
            DependencyType.IN_SITEMAP: ImpactReason.SITEMAP_DEPENDENCY,
            DependencyType.SHARES_ENTITY: ImpactReason.ENTITY_DEPENDENCY,
            DependencyType.SHARES_TOPIC: ImpactReason.CONTENT_DEPENDENCY,
            DependencyType.USES_TEMPLATE: ImpactReason.TEMPLATE_DEPENDENCY,
            DependencyType.REDIRECTS_TO: ImpactReason.INTERNAL_LINK_DEPENDENCY,
        }
        return mapping.get(dep_type, ImpactReason.INTERNAL_LINK_DEPENDENCY)

    @classmethod
    def build_from_crawl_and_extractions(
        cls,
        site_url: str,
        pages: dict[str, str] | list[Any],
        extractions: dict[str, ExtractionResult],
        sitemaps: list[str] | None = None,
        workspace_id: str | None = None,
        created_at: datetime | None = None,
    ) -> ChangeImpactGraph:
        """
        Constructs a queryable ChangeImpactGraph from crawled pages, extractions, and sitemaps.
        """
        graph = cls(
            site_url=site_url,
            workspace_id=workspace_id,
            created_at=created_at or _utc_now(),
        )

        parsed_site = urlparse(site_url)
        site_domain = parsed_site.netloc.lower()

        # 1. Add all page nodes
        page_urls: list[str] = []
        if isinstance(pages, dict):
            page_urls = list(pages.keys())
        elif isinstance(pages, list):
            for p in pages:
                if hasattr(p, "url"):
                    page_urls.append(p.url)
                elif isinstance(p, str):
                    page_urls.append(p)

        for p_url in page_urls:
            p_path = _normalize_resource_id(p_url, site_url)
            graph.add_node(p_path, {"url": urljoin(site_url, p_path)})

        # 2. Extract dependencies from ExtractionResults
        for ext_url, ext in extractions.items():
            src_path = _normalize_resource_id(ext_url, site_url)

            # A. Canonical links
            if ext.canonical_present and ext.canonicals:
                for can in ext.canonicals:
                    if can.url:
                        can_path = _normalize_resource_id(can.url, site_url)
                        if can_path != src_path:
                            graph.add_edge(
                                src_path,
                                can_path,
                                DependencyType.CANONICAL_TO,
                                weight=1.0,
                                metadata={"canonical_url": can.url, "self_ref": can.self_reference},
                            )

            # B. Language / attributes
            if hasattr(ext, "detected_language") and ext.detected_language:
                graph.add_node(src_path, {"language": ext.detected_language})

        # 3. Add sitemap dependencies if provided
        if sitemaps:
            for sitemap_url in sitemaps:
                smap_path = _normalize_resource_id(sitemap_url, site_url)
                graph.add_node(smap_path, {"is_sitemap": True, "url": sitemap_url})
                # Link all known pages to sitemap
                for p_url in page_urls:
                    p_path = _normalize_resource_id(p_url, site_url)
                    graph.add_edge(
                        p_path,
                        smap_path,
                        DependencyType.IN_SITEMAP,
                        weight=0.5,
                        metadata={"sitemap": smap_path},
                    )

        return graph
