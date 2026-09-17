"""
Production Orchestration & Monitoring - Stage Input/Output Contracts.

Defines explicit, typed, and secret-scrubbed input/output contracts for
orchestration stages, preventing large payload bloat in state tables by storing
durable references and metadata summaries.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Any

from connectors.base.security import sanitize_payload


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


@dataclass
class StageInputContract:
    """
    Explicit input contract passed into an orchestration stage handler.
    """

    run_id: str
    workspace_id: str
    site_id: int
    stage_id: str
    stage_name: str
    correlation_id: str
    input_refs: dict[str, Any] = field(default_factory=dict)
    parameters: dict[str, Any] = field(default_factory=dict)
    checkpoint_ref: str | None = None
    created_at: datetime = field(default_factory=_utc_now)

    def to_dict(self) -> dict[str, Any]:
        data = asdict(self)
        data["created_at"] = self.created_at.isoformat()
        return sanitize_payload(data)


@dataclass
class StageOutputContract:
    """
    Explicit output contract returned by an orchestration stage handler.
    """

    stage_id: str
    stage_name: str
    status: str
    output_refs: dict[str, Any] = field(default_factory=dict)
    evidence_refs: dict[str, Any] = field(default_factory=dict)
    error_detail: dict[str, Any] | None = None
    started_at: datetime = field(default_factory=_utc_now)
    completed_at: datetime = field(default_factory=_utc_now)
    duration_ms: int = 0
    details: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        data = asdict(self)
        data["started_at"] = self.started_at.isoformat()
        data["completed_at"] = self.completed_at.isoformat()
        return sanitize_payload(data)
