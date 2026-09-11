"""
Production Orchestration & Monitoring - Deterministic Stage Planner.

Generates explicit, ordered, and dependency-mapped stage execution blueprints
for each supported RunType.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Mapping

from .enums import RunType, StageName


@dataclass(frozen=True)
class StageBlueprint:
    """Immutable blueprint definition for an individual stage in a run plan."""

    stage_name: StageName
    execution_order: int
    dependencies: tuple[StageName, ...] = field(default_factory=tuple)
    max_attempts: int = 3


# Standard Blueprint Matrix by RunType
STAGE_PLAN_BLUEPRINTS: Mapping[RunType, tuple[StageBlueprint, ...]] = {
    RunType.ON_DEMAND_SCAN: (
        StageBlueprint(stage_name=StageName.CRAWL_DISCOVERY, execution_order=0, dependencies=()),
        StageBlueprint(
            stage_name=StageName.CONTENT_EXTRACTION,
            execution_order=1,
            dependencies=(StageName.CRAWL_DISCOVERY,),
        ),
        StageBlueprint(
            stage_name=StageName.SIGNAL_ANALYSIS,
            execution_order=2,
            dependencies=(StageName.CONTENT_EXTRACTION,),
        ),
        StageBlueprint(
            stage_name=StageName.SCORING,
            execution_order=3,
            dependencies=(StageName.SIGNAL_ANALYSIS,),
        ),
        StageBlueprint(
            stage_name=StageName.EVIDENCE_OBSERVATION,
            execution_order=4,
            dependencies=(StageName.SCORING,),
        ),
        StageBlueprint(
            stage_name=StageName.RECOMMENDATION_PLANNING,
            execution_order=5,
            dependencies=(StageName.SCORING, StageName.EVIDENCE_OBSERVATION),
        ),
        StageBlueprint(
            stage_name=StageName.MONITORING_CHECK,
            execution_order=6,
            dependencies=(StageName.RECOMMENDATION_PLANNING,),
        ),
    ),
    RunType.SCHEDULED_SCAN: (
        StageBlueprint(stage_name=StageName.CRAWL_DISCOVERY, execution_order=0, dependencies=()),
        StageBlueprint(
            stage_name=StageName.CONTENT_EXTRACTION,
            execution_order=1,
            dependencies=(StageName.CRAWL_DISCOVERY,),
        ),
        StageBlueprint(
            stage_name=StageName.SIGNAL_ANALYSIS,
            execution_order=2,
            dependencies=(StageName.CONTENT_EXTRACTION,),
        ),
        StageBlueprint(
            stage_name=StageName.SCORING,
            execution_order=3,
            dependencies=(StageName.SIGNAL_ANALYSIS,),
        ),
        StageBlueprint(
            stage_name=StageName.EVIDENCE_OBSERVATION,
            execution_order=4,
            dependencies=(StageName.SCORING,),
        ),
        StageBlueprint(
            stage_name=StageName.RECOMMENDATION_PLANNING,
            execution_order=5,
            dependencies=(StageName.SCORING, StageName.EVIDENCE_OBSERVATION),
        ),
        StageBlueprint(
            stage_name=StageName.MONITORING_CHECK,
            execution_order=6,
            dependencies=(StageName.RECOMMENDATION_PLANNING,),
        ),
    ),
    RunType.CHANGE_TRIGGERED_SCAN: (
        StageBlueprint(stage_name=StageName.TARGETED_RESCAN, execution_order=0, dependencies=()),
        StageBlueprint(
            stage_name=StageName.CONTENT_EXTRACTION,
            execution_order=1,
            dependencies=(StageName.TARGETED_RESCAN,),
        ),
        StageBlueprint(
            stage_name=StageName.SIGNAL_ANALYSIS,
            execution_order=2,
            dependencies=(StageName.CONTENT_EXTRACTION,),
        ),
        StageBlueprint(
            stage_name=StageName.SCORING,
            execution_order=3,
            dependencies=(StageName.SIGNAL_ANALYSIS,),
        ),
        StageBlueprint(
            stage_name=StageName.DELTA_MEASUREMENT,
            execution_order=4,
            dependencies=(StageName.SCORING,),
        ),
        StageBlueprint(
            stage_name=StageName.MONITORING_CHECK,
            execution_order=5,
            dependencies=(StageName.DELTA_MEASUREMENT,),
        ),
    ),
    RunType.EVIDENCE_REFRESH: (
        StageBlueprint(stage_name=StageName.EVIDENCE_OBSERVATION, execution_order=0, dependencies=()),
        StageBlueprint(
            stage_name=StageName.VISIBILITY_METRICS,
            execution_order=1,
            dependencies=(StageName.EVIDENCE_OBSERVATION,),
        ),
        StageBlueprint(
            stage_name=StageName.MONITORING_CHECK,
            execution_order=2,
            dependencies=(StageName.VISIBILITY_METRICS,),
        ),
    ),
    RunType.VERIFICATION_RUN: (
        StageBlueprint(stage_name=StageName.VERIFICATION, execution_order=0, dependencies=()),
        StageBlueprint(
            stage_name=StageName.TARGETED_RESCAN,
            execution_order=1,
            dependencies=(StageName.VERIFICATION,),
        ),
        StageBlueprint(
            stage_name=StageName.DELTA_MEASUREMENT,
            execution_order=2,
            dependencies=(StageName.TARGETED_RESCAN,),
        ),
        StageBlueprint(
            stage_name=StageName.REGRESSION_GUARD,
            execution_order=3,
            dependencies=(StageName.DELTA_MEASUREMENT,),
        ),
    ),
    RunType.MONITORING_RUN: (
        StageBlueprint(stage_name=StageName.EVIDENCE_OBSERVATION, execution_order=0, dependencies=()),
        StageBlueprint(
            stage_name=StageName.VISIBILITY_METRICS,
            execution_order=1,
            dependencies=(StageName.EVIDENCE_OBSERVATION,),
        ),
        StageBlueprint(
            stage_name=StageName.MONITORING_CHECK,
            execution_order=2,
            dependencies=(StageName.VISIBILITY_METRICS,),
        ),
    ),
    RunType.RECOVERY_RUN: (
        # Default fallback recovery plan; can be overridden dynamically based on previous uncompleted stages
        StageBlueprint(stage_name=StageName.SIGNAL_ANALYSIS, execution_order=0, dependencies=()),
        StageBlueprint(
            stage_name=StageName.SCORING,
            execution_order=1,
            dependencies=(StageName.SIGNAL_ANALYSIS,),
        ),
        StageBlueprint(
            stage_name=StageName.MONITORING_CHECK,
            execution_order=2,
            dependencies=(StageName.SCORING,),
        ),
    ),
}


class StagePlanner:
    """
    Deterministic stage plan generator.
    """

    @classmethod
    def generate_plan_for_run_type(cls, run_type: RunType) -> list[StageBlueprint]:
        """
        Returns an ordered list of StageBlueprints for the given run type.
        """
        blueprints = STAGE_PLAN_BLUEPRINTS.get(run_type)
        if not blueprints:
            raise ValueError(f"No stage plan configured for RunType '{run_type}'")
        return list(blueprints)
