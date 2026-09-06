"""
End-to-End Pipeline Harness for Task 12 Step 2.

Orchestrates the 13 ordered pipeline stages, generates deterministic stage execution IDs,
enforces stage dependencies and failure propagation, guarantees safe dry-run defaults,
and records comprehensive execution traces.
"""

from __future__ import annotations

import logging
import uuid
from typing import Any, Callable
from pydantic import BaseModel, ConfigDict, Field

from connectors.base.security import redact_secrets_from_string

from .catalog import get_fixture
from .models import LabFixtureConfig
from .stages import (
    PipelineContext,
    execute_apply_stage,
    execute_compare_stage,
    execute_connector_stage,
    execute_crawl_render_stage,
    execute_discovery_stage,
    execute_extraction_stage,
    execute_finding_stage,
    execute_fix_plan_stage,
    execute_intelligence_stage,
    execute_rescan_stage,
    execute_safety_stage,
    execute_score_stage,
    execute_validate_stage,
)
from .trace import (
    STAGE_DEPENDENCIES,
    STAGE_SEQUENCE_ORDER,
    ExecutionTrace,
    PipelineExecutionStatus,
    PipelineStage,
    StageStatus,
    StageTrace,
    get_trace_registry,
)

logger = logging.getLogger(__name__)

# Default handlers table
DEFAULT_STAGE_HANDLERS: dict[PipelineStage, Callable[[PipelineContext, StageTrace], None]] = {
    PipelineStage.DISCOVERY: execute_discovery_stage,
    PipelineStage.CRAWL_RENDER: execute_crawl_render_stage,
    PipelineStage.EXTRACTION: execute_extraction_stage,
    PipelineStage.INTELLIGENCE: execute_intelligence_stage,
    PipelineStage.SCORE: execute_score_stage,
    PipelineStage.FINDING: execute_finding_stage,
    PipelineStage.FIX_PLAN: execute_fix_plan_stage,
    PipelineStage.CONNECTOR: execute_connector_stage,
    PipelineStage.SAFETY: execute_safety_stage,
    PipelineStage.APPLY: execute_apply_stage,
    PipelineStage.VALIDATE: execute_validate_stage,
    PipelineStage.RESCAN: execute_rescan_stage,
    PipelineStage.COMPARE: execute_compare_stage,
}

ORDERED_STAGES: list[PipelineStage] = [
    PipelineStage.DISCOVERY,
    PipelineStage.CRAWL_RENDER,
    PipelineStage.EXTRACTION,
    PipelineStage.INTELLIGENCE,
    PipelineStage.SCORE,
    PipelineStage.FINDING,
    PipelineStage.FIX_PLAN,
    PipelineStage.CONNECTOR,
    PipelineStage.SAFETY,
    PipelineStage.APPLY,
    PipelineStage.VALIDATE,
    PipelineStage.RESCAN,
    PipelineStage.COMPARE,
]


class PipelineRunConfig(BaseModel):
    """
    Configuration options for an End-to-End Pipeline Harness execution.
    """

    model_config = ConfigDict(extra="ignore", arbitrary_types_allowed=True)

    execution_id: str | None = Field(default=None, description="Optional custom execution ID")
    site_url: str = Field(default="https://lab.local", description="Target website URL")
    fixture_id: str | None = Field(default=None, description="Controlled Site Lab fixture ID if applicable")
    fixture: LabFixtureConfig | None = Field(default=None, description="Direct LabFixtureConfig instance")
    environment: str = Field(default="controlled_lab", description="Execution environment")
    dry_run: bool = Field(default=True, description="True if real production mutation is prohibited")
    allow_mutations: bool = Field(default=False, description="Explicit approval flag for test mutations")
    stop_on_first_failure: bool = Field(default=True, description="Block downstream stages on first failure")
    custom_stage_handlers: dict[PipelineStage, Any] = Field(
        default_factory=dict, description="Custom stage handler overrides for testing"
    )
    metadata: dict[str, Any] = Field(default_factory=dict, description="Arbitrary run metadata")


class PipelineHarness:
    """
    Orchestration harness that executes the 13 pipeline stages in sequence and generates ExecutionTraces.
    """

    def __init__(self) -> None:
        self.registry = get_trace_registry()
        self.context: PipelineContext | None = None

    def run(self, config: PipelineRunConfig | None = None, **kwargs: Any) -> ExecutionTrace:
        """
        Executes the complete 13-stage pipeline with strict ordering, error handling, and trace generation.
        """
        if config is None:
            config = PipelineRunConfig(**kwargs)

        # 1. Resolve Execution ID
        exec_id = config.execution_id or f"exec_{uuid.uuid4().hex[:16]}"

        # 2. Resolve Fixture if specified by ID
        resolved_fixture = config.fixture
        if not resolved_fixture and config.fixture_id:
            resolved_fixture = get_fixture(config.fixture_id)

        site_url = config.site_url
        if resolved_fixture and not config.site_url:
            site_url = resolved_fixture.base_url

        # 3. Initialize Top-Level Execution Trace
        trace = ExecutionTrace(
            execution_id=exec_id,
            site_id=config.metadata.get("site_id", "default_site"),
            site_url=site_url,
            fixture_id=config.fixture_id or (resolved_fixture.fixture_id if resolved_fixture else None),
            environment=config.environment,
            dry_run=config.dry_run,
            overall_status=PipelineExecutionStatus.RUNNING,
            metadata=config.metadata,
        )

        # 4. Pre-allocate all 13 stage traces in strict order
        stage_trace_map: dict[PipelineStage, StageTrace] = {}
        for stage in ORDERED_STAGES:
            stage_exec_id = f"stage_{stage.value.lower()}_{uuid.uuid4().hex[:12]}"
            st = StageTrace(
                stage_execution_id=stage_exec_id,
                execution_id=exec_id,
                stage_name=stage,
                sequence=STAGE_SEQUENCE_ORDER[stage],
                status=StageStatus.PENDING,
            )
            stage_trace_map[stage] = st
            trace.stages.append(st)

        # 5. Initialize Pipeline Context
        ctx = PipelineContext(
            site_url=site_url,
            fixture=resolved_fixture,
            dry_run=config.dry_run,
            allow_mutations=config.allow_mutations,
            custom_stage_handlers=config.custom_stage_handlers,
        )
        self.context = ctx

        # 6. Execute Stages in Order
        first_failed_stage: PipelineStage | None = None

        for stage in ORDERED_STAGES:
            st = stage_trace_map[stage]

            # Dependency check
            dependencies = STAGE_DEPENDENCIES.get(stage, [])
            failing_dependency = next(
                (dep for dep in dependencies if stage_trace_map[dep].status in (StageStatus.FAILED, StageStatus.BLOCKED)),
                None,
            )

            if failing_dependency or (config.stop_on_first_failure and first_failed_stage is not None):
                root_cause = first_failed_stage.value if first_failed_stage else (
                    stage_trace_map[failing_dependency].blocked_by_stage or failing_dependency.value
                )
                st.mark_blocked(
                    blocked_by=root_cause,
                    reason=f"Blocked due to upstream failure in stage '{root_cause}'",
                )
                continue

            # Check if custom override provided
            handler = (
                config.custom_stage_handlers.get(stage)
                or DEFAULT_STAGE_HANDLERS.get(stage)
            )

            if not handler:
                st.mark_skipped(reason=f"No execution handler registered for stage {stage.value}")
                continue

            # Execute Stage Handler
            st.mark_running()
            try:
                handler(ctx, st)
                if st.status == StageStatus.RUNNING:
                    st.mark_succeeded()
            except Exception as exc:
                clean_error = redact_secrets_from_string(str(exc))
                error_type = type(exc).__name__
                st.mark_failed(
                    error_message=clean_error,
                    error_code=error_type,
                    is_retryable=False,
                )
                if first_failed_stage is None:
                    first_failed_stage = stage
                logger.warning(
                    "Pipeline stage %s failed during execution %s: %s",
                    stage.value,
                    exec_id,
                    clean_error,
                )

        # 7. Finalize Trace & Register
        trace.finalize()
        self.registry.record_trace(trace)

        return trace
