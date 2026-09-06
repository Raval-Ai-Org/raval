"""
Execution Trace Models and Status Registry for Task 12 Step 2.

Defines schemas for ordered pipeline stages, stage execution traces, top-level execution traces,
status enums, and a thread-safe in-memory trace registry.
"""

from __future__ import annotations

import logging
import threading
from datetime import datetime, timezone
from enum import Enum
from typing import Any
from pydantic import BaseModel, ConfigDict, Field

logger = logging.getLogger(__name__)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


class PipelineStage(str, Enum):
    """Ordered pipeline execution stages for Task 12 closed-loop intelligence."""

    DISCOVERY = "DISCOVERY"
    CRAWL_RENDER = "CRAWL_RENDER"
    EXTRACTION = "EXTRACTION"
    INTELLIGENCE = "INTELLIGENCE"
    SCORE = "SCORE"
    FINDING = "FINDING"
    FIX_PLAN = "FIX_PLAN"
    CONNECTOR = "CONNECTOR"
    SAFETY = "SAFETY"
    APPLY = "APPLY"
    VALIDATE = "VALIDATE"
    RESCAN = "RESCAN"
    COMPARE = "COMPARE"


# Strict deterministic sequence order mapping (1 to 13)
STAGE_SEQUENCE_ORDER: dict[PipelineStage, int] = {
    PipelineStage.DISCOVERY: 1,
    PipelineStage.CRAWL_RENDER: 2,
    PipelineStage.EXTRACTION: 3,
    PipelineStage.INTELLIGENCE: 4,
    PipelineStage.SCORE: 5,
    PipelineStage.FINDING: 6,
    PipelineStage.FIX_PLAN: 7,
    PipelineStage.CONNECTOR: 8,
    PipelineStage.SAFETY: 9,
    PipelineStage.APPLY: 10,
    PipelineStage.VALIDATE: 11,
    PipelineStage.RESCAN: 12,
    PipelineStage.COMPARE: 13,
}

# Explicit stage dependencies mapping
STAGE_DEPENDENCIES: dict[PipelineStage, list[PipelineStage]] = {
    PipelineStage.DISCOVERY: [],
    PipelineStage.CRAWL_RENDER: [PipelineStage.DISCOVERY],
    PipelineStage.EXTRACTION: [PipelineStage.CRAWL_RENDER],
    PipelineStage.INTELLIGENCE: [PipelineStage.EXTRACTION],
    PipelineStage.SCORE: [PipelineStage.INTELLIGENCE],
    PipelineStage.FINDING: [PipelineStage.INTELLIGENCE],
    PipelineStage.FIX_PLAN: [PipelineStage.FINDING],
    PipelineStage.CONNECTOR: [],
    PipelineStage.SAFETY: [PipelineStage.FIX_PLAN, PipelineStage.CONNECTOR],
    PipelineStage.APPLY: [PipelineStage.SAFETY],
    PipelineStage.VALIDATE: [PipelineStage.APPLY],
    PipelineStage.RESCAN: [PipelineStage.APPLY],
    PipelineStage.COMPARE: [PipelineStage.RESCAN, PipelineStage.EXTRACTION],
}


class StageStatus(str, Enum):
    """Deterministic lifecycle status for a single pipeline stage."""

    PENDING = "PENDING"
    RUNNING = "RUNNING"
    SUCCEEDED = "SUCCEEDED"
    FAILED = "FAILED"
    SKIPPED = "SKIPPED"
    BLOCKED = "BLOCKED"


class PipelineExecutionStatus(str, Enum):
    """Top-level pipeline execution status."""

    RUNNING = "RUNNING"
    SUCCEEDED = "SUCCEEDED"
    FAILED = "FAILED"
    PARTIAL = "PARTIAL"


class StageTrace(BaseModel):
    """
    Detailed telemetry record for an individual stage execution.
    """

    model_config = ConfigDict(extra="ignore")

    stage_execution_id: str = Field(..., description="Unique deterministic identifier for this stage run")
    execution_id: str = Field(..., description="Parent execution trace ID")
    stage_name: PipelineStage = Field(..., description="Stage enum identifier")
    sequence: int = Field(..., description="Ordinal execution sequence (1-13)")
    status: StageStatus = Field(default=StageStatus.PENDING, description="Current stage status")
    started_at: datetime | None = Field(default=None, description="Start timestamp in UTC")
    completed_at: datetime | None = Field(default=None, description="Completion timestamp in UTC")
    duration_ms: float | None = Field(default=None, description="Elapsed execution time in milliseconds")
    input_ref: dict[str, Any] = Field(default_factory=dict, description="Compact input reference/summary")
    output_ref: dict[str, Any] = Field(default_factory=dict, description="Compact output reference/summary")
    error_code: str | None = Field(default=None, description="Error code or exception class")
    error_message: str | None = Field(default=None, description="Safe redacted error message")
    is_retryable: bool | None = Field(default=None, description="Whether the stage failure is retryable")
    blocked_by_stage: str | None = Field(
        default=None, description="Name of upstream stage that triggered BLOCKED status"
    )

    def mark_running(self) -> None:
        self.status = StageStatus.RUNNING
        self.started_at = _utc_now()

    def mark_succeeded(self, output_ref: dict[str, Any] | None = None) -> None:
        self.status = StageStatus.SUCCEEDED
        self.completed_at = _utc_now()
        if self.started_at:
            self.duration_ms = max(
                0.0, round((self.completed_at - self.started_at).total_seconds() * 1000.0, 2)
            )
        if output_ref:
            self.output_ref = output_ref

    def mark_failed(
        self,
        error_message: str,
        error_code: str | None = None,
        is_retryable: bool | None = None,
    ) -> None:
        self.status = StageStatus.FAILED
        self.completed_at = _utc_now()
        if self.started_at:
            self.duration_ms = max(
                0.0, round((self.completed_at - self.started_at).total_seconds() * 1000.0, 2)
            )
        self.error_message = error_message
        self.error_code = error_code or "STAGE_EXECUTION_ERROR"
        self.is_retryable = is_retryable

    def mark_blocked(self, blocked_by: str, reason: str | None = None) -> None:
        self.status = StageStatus.BLOCKED
        self.blocked_by_stage = blocked_by
        self.error_message = reason or f"Blocked due to upstream failure in stage '{blocked_by}'"
        self.completed_at = _utc_now()
        self.duration_ms = 0.0

    def mark_skipped(self, reason: str | None = None) -> None:
        self.status = StageStatus.SKIPPED
        self.error_message = reason or "Stage skipped according to execution policy"
        self.completed_at = _utc_now()
        self.duration_ms = 0.0


class ExecutionTrace(BaseModel):
    """
    Top-level telemetry trace representing a complete end-to-end pipeline run.
    """

    model_config = ConfigDict(extra="ignore")

    execution_id: str = Field(..., description="Unique deterministic execution identifier")
    site_id: str = Field(default="default_site", description="Target website or resource identifier")
    site_url: str = Field(default="https://lab.local", description="Target website URL")
    fixture_id: str | None = Field(default=None, description="Controlled Site Lab fixture ID if applicable")
    environment: str = Field(default="controlled_lab", description="Execution environment")
    dry_run: bool = Field(default=True, description="True if real production mutation is prohibited")
    started_at: datetime = Field(default_factory=_utc_now, description="Execution start timestamp in UTC")
    completed_at: datetime | None = Field(default=None, description="Execution finish timestamp in UTC")
    duration_ms: float | None = Field(default=None, description="Total duration in milliseconds")
    overall_status: PipelineExecutionStatus = Field(
        default=PipelineExecutionStatus.RUNNING, description="Overall execution status"
    )
    stages: list[StageTrace] = Field(default_factory=list, description="Ordered stage traces (1-13)")
    error_summary: str | None = Field(default=None, description="Summary of root failure if any")
    metadata: dict[str, Any] = Field(default_factory=dict, description="Arbitrary run metadata")

    def get_stage_trace(self, stage_name: PipelineStage) -> StageTrace | None:
        """Retrieves a specific stage trace by its enum name."""
        for s in self.stages:
            if s.stage_name == stage_name:
                return s
        return None

    def finalize(self) -> None:
        """Computes final status and duration based on individual stage outcomes."""
        self.completed_at = _utc_now()
        self.duration_ms = max(
            0.0, round((self.completed_at - self.started_at).total_seconds() * 1000.0, 2)
        )

        has_failed = any(s.status == StageStatus.FAILED for s in self.stages)
        has_blocked = any(s.status == StageStatus.BLOCKED for s in self.stages)
        all_succeeded = all(
            s.status in (StageStatus.SUCCEEDED, StageStatus.SKIPPED) for s in self.stages
        )

        if all_succeeded:
            self.overall_status = PipelineExecutionStatus.SUCCEEDED
        elif has_failed or has_blocked:
            failed_stages = [s.stage_name.value for s in self.stages if s.status == StageStatus.FAILED]
            if failed_stages:
                self.overall_status = PipelineExecutionStatus.FAILED
                self.error_summary = f"Pipeline failed at stage(s): {', '.join(failed_stages)}"
            else:
                self.overall_status = PipelineExecutionStatus.PARTIAL
                self.error_summary = "Pipeline completed with blocked or skipped stages"
        else:
            self.overall_status = PipelineExecutionStatus.PARTIAL


class TraceRegistry:
    """
    Thread-safe in-memory registry for querying and persisting ExecutionTrace records.
    """

    def __init__(self) -> None:
        self._traces: dict[str, ExecutionTrace] = {}
        self._lock = threading.Lock()

    def record_trace(self, trace: ExecutionTrace) -> None:
        with self._lock:
            self._traces[trace.execution_id] = trace

    def get_trace(self, execution_id: str) -> ExecutionTrace | None:
        with self._lock:
            return self._traces.get(execution_id)

    def list_traces(self) -> list[ExecutionTrace]:
        with self._lock:
            return list(self._traces.values())

    def clear(self) -> None:
        with self._lock:
            self._traces.clear()


# Master singleton registry
_GLOBAL_REGISTRY: TraceRegistry = TraceRegistry()


def get_trace_registry() -> TraceRegistry:
    """Returns the master TraceRegistry singleton."""
    return _GLOBAL_REGISTRY
