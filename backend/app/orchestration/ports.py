"""
Production Orchestration & Monitoring - Integration Ports (Protocols).

Defines clean boundary interfaces (Ports) to existing platform capabilities
(Tasks 1-12) without duplicating underlying logic or introducing runtime coupling.
"""

from __future__ import annotations

from typing import Any, Protocol, runtime_checkable


@runtime_checkable
class CrawlerPort(Protocol):
    """Port for URL discovery, robots checking, and page content fetching."""

    def discover_urls(self, base_url: str, max_depth: int = 2) -> list[str]:
        ...

    def fetch_page(self, url: str) -> dict[str, Any]:
        ...


@runtime_checkable
class ExtractorPort(Protocol):
    """Port for HTML parsing, metadata extraction, and unified signal generation."""

    def extract_page_signals(self, url: str, html: str) -> dict[str, Any]:
        ...


@runtime_checkable
class ScoringPort(Protocol):
    """Port for category score calculations (SEO, AEO, Authority, Trust, Transparency)."""

    def calculate_scores(
        self,
        signals: list[dict[str, Any]],
        evidence: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        ...


@runtime_checkable
class EvidenceObservationPort(Protocol):
    """Port for external AI engine queries, mention analysis, and citation verification."""

    def execute_query_set(
        self,
        website_id: int,
        query_set_id: int | None = None,
    ) -> list[dict[str, Any]]:
        ...

    def evaluate_visibility_metrics(
        self,
        website_id: int,
        observations: list[dict[str, Any]],
    ) -> dict[str, Any]:
        ...


@runtime_checkable
class RemediationPlanningPort(Protocol):
    """Port for finding generation, opportunity prioritization, and safe fix plan formulation."""

    def generate_fix_plans(
        self,
        website_id: int,
        findings: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        ...


@runtime_checkable
class ApprovalPolicyPort(Protocol):
    """Port for human/automated approval management, risk classification, and policy gating."""

    def evaluate_approval_policy(
        self,
        workspace_id: str,
        site_id: int | str,
        proposal: dict[str, Any],
    ) -> dict[str, Any]:
        ...

    def is_change_approved(
        self,
        proposal_id: str,
    ) -> bool:
        ...


@runtime_checkable
class ConnectorExecutionPort(Protocol):
    """Port for safe connector-based mutation execution (WordPress, GitHub)."""

    def execute_change_proposal(
        self,
        workspace_id: str,
        site_id: int | str,
        proposal: dict[str, Any],
        dry_run: bool = True,
    ) -> dict[str, Any]:
        ...


@runtime_checkable
class VerificationPort(Protocol):
    """Port for post-apply independent verification and defect resolution checks."""

    def verify_remediation(
        self,
        target_resource: str,
        expected_state: dict[str, Any],
    ) -> dict[str, Any]:
        ...


@runtime_checkable
class TargetedRescanPort(Protocol):
    """Port for impact-bounded rescans following technical remediations."""

    def compute_rescan_scope(
        self,
        impacted_resources: list[str],
        change_type: str,
    ) -> list[str]:
        ...


@runtime_checkable
class DeltaMeasurementPort(Protocol):
    """Port for before/after comparison, score deltas, and regression guard evaluation."""

    def compute_delta_and_guard(
        self,
        before_snapshot: dict[str, Any],
        after_snapshot: dict[str, Any],
    ) -> dict[str, Any]:
        ...


@runtime_checkable
class AuditLoggerPort(Protocol):
    """Port for recording immutable, secret-scrubbed audit trails across operations."""

    def log_event(
        self,
        workspace_id: str,
        site_id: int | str,
        event_type: str,
        payload: dict[str, Any],
    ) -> None:
        ...


def validate_tenant_site_boundary(
    db: Any,
    tenant_id: str,
    site_id: int | str,
) -> Any:
    """
    Validates that a site exists and belongs to the specified workspace / tenant.
    Raises SiteMismatchError if site does not exist.
    Raises TenantMismatchError if site belongs to a different tenant.
    """
    from ..models import Website
    from .exceptions import SiteMismatchError, TenantMismatchError
    from .models import OrchestrationRun, OrchestrationMonitoringObservation

    site = db.get(Website, int(site_id))
    if not site:
        raise SiteMismatchError(site_id, f"Website with id {site_id} not found")

    site_tenant = getattr(site, "workspace_id", None) or getattr(site, "tenant_id", None)
    if site_tenant and site_tenant != tenant_id:
        raise TenantMismatchError(tenant_id, site_tenant)

    foreign_run = (
        db.query(OrchestrationRun)
        .filter(
            OrchestrationRun.site_id == int(site_id),
            OrchestrationRun.workspace_id != tenant_id,
        )
        .first()
    )
    if foreign_run:
        raise TenantMismatchError(tenant_id, foreign_run.workspace_id)

    foreign_obs = (
        db.query(OrchestrationMonitoringObservation)
        .filter(
            OrchestrationMonitoringObservation.site_id == int(site_id),
            OrchestrationMonitoringObservation.workspace_id != tenant_id,
        )
        .first()
    )
    if foreign_obs:
        raise TenantMismatchError(tenant_id, foreign_obs.workspace_id)

    return site


__all__ = [
    "ApprovalPolicyPort",
    "AuditLoggerPort",
    "ConnectorExecutionPort",
    "CrawlerPort",
    "DeltaMeasurementPort",
    "EvidenceObservationPort",
    "ExtractorPort",
    "RemediationPlanningPort",
    "ScoringPort",
    "TargetedRescanPort",
    "VerificationPort",
    "validate_tenant_site_boundary",
]
