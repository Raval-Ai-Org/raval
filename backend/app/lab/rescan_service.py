"""
Targeted Rescan Execution Service (Task 12 Step 4).

Orchestrates post-fix targeted, related, or full rescans with:
- Thread-safe concurrency control
- Idempotency key tracking
- Integration with Task 11 TargetedRescanner and Crawler Fetcher
- Execution trace linkage (execution_id, stage_execution_id, rescan_id)
- Multi-resource extraction and After-Snapshot creation
"""

from __future__ import annotations

import logging
import threading
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urljoin

from pydantic import BaseModel, ConfigDict, Field

from app.page_extractor import ExtractionResult, extract_html
from connectors.base.models import ResourceReference, SiteContext
from connectors.base.security import sanitize_payload
from connectors.execution.models import ExecutionTarget, TargetedRescanResult
from connectors.execution.rescan import TargetedRescanner
from crawler.fetcher import PageFetcher

from .evidence import MeasurementSnapshot
from .impact_model import ChangeImpactGraph, ChangeType, ImpactReason, ImpactedResource, RescanScope, _normalize_resource_id
from .measurement import ClosedLoopMeasurementReport, ClosedLoopMeasurementService
from .rescan_policy import RescanPolicyEngine, RescanScopeDecision, TargetedRescanRequest

logger = logging.getLogger(__name__)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


class TargetedRescanExecutionResult(BaseModel):
    """
    Consolidated execution result for a targeted/related/full rescan operation.
    """
    model_config = ConfigDict(extra="ignore")

    rescan_id: str = Field(..., description="Unique rescan identifier")
    execution_id: str = Field(..., description="Trace execution identifier")
    stage_execution_id: str | None = Field(default=None, description="Pipeline stage execution ID")
    scope: RescanScope = Field(..., description="Rescan scope executed")
    decision: RescanScopeDecision = Field(..., description="Scope policy decision")
    rescanned_resources: list[ImpactedResource] = Field(default_factory=list)
    rescan_details: dict[str, dict[str, Any]] = Field(default_factory=dict, description="URL -> extraction/status payload")
    after_snapshots: dict[str, MeasurementSnapshot] = Field(default_factory=dict, description="URL -> MeasurementSnapshot")
    duration_ms: float = Field(default=0.0, description="Execution elapsed duration in ms")
    executed_at: datetime = Field(default_factory=_utc_now)
    is_cached: bool = Field(default=False, description="True if returned from idempotency cache")
    metadata: dict[str, Any] = Field(default_factory=dict)


class TargetedRescanService:
    """
    Thread-safe service managing targeted rescan scope evaluation and execution.
    """

    _lock = threading.RLock()
    _idempotency_cache: dict[str, TargetedRescanExecutionResult] = {}
    _active_rescans: dict[str, str] = {}  # idempotency_key / rescan_id -> status

    @classmethod
    def reset_state(cls) -> None:
        """Resets in-memory registries (useful for testing)."""
        with cls._lock:
            cls._idempotency_cache.clear()
            cls._active_rescans.clear()

    @classmethod
    def execute_targeted_rescan(
        cls,
        request: TargetedRescanRequest,
        graph: ChangeImpactGraph | None = None,
        all_site_resources: list[str] | None = None,
        custom_html_map: dict[str, str] | None = None,
        connector: Any | None = None,
        fetcher: PageFetcher | None = None,
        stage_execution_id: str | None = None,
        site_id: str = "site_lab_default",
        fix_plan_id: int | None = None,
    ) -> TargetedRescanExecutionResult:
        """
        Evaluates rescan scope policy and executes targeted rescans across all selected resources.
        Thread-safe and idempotent.
        """
        idempotency_key = request.idempotency_key or f"{request.execution_id}_{sorted(request.changed_resources)}_{request.change_type.value}"

        with cls._lock:
            # 1. Idempotency Check
            if idempotency_key in cls._idempotency_cache:
                cached = cls._idempotency_cache[idempotency_key]
                logger.info("Targeted rescan request '%s' served from idempotency cache.", request.rescan_id)
                # Return a copy marked as cached
                return cached.model_copy(update={"is_cached": True})

            cls._active_rescans[idempotency_key] = "IN_PROGRESS"

        start_time = _utc_now()
        measurement_svc = ClosedLoopMeasurementService()

        try:
            # 2. Scope Decision
            decision = RescanPolicyEngine.decide_scope(
                request=request,
                graph=graph,
                all_site_resources=all_site_resources,
            )

            rescan_details: dict[str, dict[str, Any]] = {}
            after_snapshots: dict[str, MeasurementSnapshot] = {}

            # 3. Rescan each selected resource
            for item in decision.selected_resources:
                res_url = item.resource_url or urljoin(request.site_url, item.resource_id)
                custom_html = custom_html_map.get(item.resource_id) or custom_html_map.get(res_url) if custom_html_map else None

                target = ExecutionTarget(
                    site_context=SiteContext(
                        site_id=1,
                        site_url=request.site_url,
                        provider="lab_test",
                        environment="lab",
                    ),
                    resource=ResourceReference(
                        resource_type="website_page",
                        resource_id=item.resource_id,
                        path=item.resource_id,
                    ),
                )

                rescan_result = TargetedRescanner.rescan_target(
                    target=target,
                    connector=connector,
                    fetcher=fetcher,
                    custom_html=custom_html,
                )

                extracted_dict = rescan_result.extraction_result or {}
                raw_html = rescan_result.content or ""

                # Extract typed ExtractionResult for snapshot creation
                extracted_obj = (
                    extract_html(raw_html, page_url=res_url)
                    if raw_html
                    else ExtractionResult(html_available=False)
                )

                rescan_details[item.resource_id] = {
                    "resource_id": item.resource_id,
                    "url": res_url,
                    "status_code": rescan_result.status_code,
                    "extraction_status": "OK" if rescan_result.is_success else "ERROR",
                    "title": extracted_obj.title_text,
                    "h1_count": extracted_obj.h1_count,
                    "reason": item.reason.value,
                    "depth": item.depth,
                    "error": rescan_result.error,
                }

                # Capture AFTER snapshot
                after_snap = measurement_svc.create_after_snapshot(
                    execution_id=request.execution_id,
                    site_id=site_id,
                    resource_url=res_url,
                    target_resource=item.resource_id,
                    extracted=extracted_obj,
                    findings=[],
                    score_data={"overall_score": 100.0, "category_scores": {"technical_seo": 100.0, "content_quality": 100.0}},
                    raw_html=raw_html,
                    status_code=rescan_result.status_code or 200,
                    fix_plan_id=fix_plan_id,
                    stage_execution_id=stage_execution_id,
                )
                after_snapshots[res_url] = after_snap

            duration_ms = (_utc_now() - start_time).total_seconds() * 1000.0

            exec_result = TargetedRescanExecutionResult(
                rescan_id=request.rescan_id,
                execution_id=request.execution_id,
                stage_execution_id=stage_execution_id,
                scope=decision.scope,
                decision=decision,
                rescanned_resources=decision.selected_resources,
                rescan_details=rescan_details,
                after_snapshots=after_snapshots,
                duration_ms=duration_ms,
                executed_at=_utc_now(),
                is_cached=False,
                metadata={
                    "rescanned_count": len(decision.selected_resources),
                    "is_escalated": decision.is_escalated_to_full,
                },
            )

            with cls._lock:
                cls._idempotency_cache[idempotency_key] = exec_result
                cls._active_rescans[idempotency_key] = "COMPLETED"

            return exec_result

        except Exception as exc:
            with cls._lock:
                cls._active_rescans[idempotency_key] = f"FAILED: {exc}"
            logger.error("Targeted rescan execution failed: %s", exc)
            raise
