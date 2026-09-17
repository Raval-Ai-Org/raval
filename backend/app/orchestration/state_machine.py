"""
Production Orchestration & Monitoring - Centralized State Machine.

Encapsulates all run and stage lifecycle transition rules in a single,
pure, deterministic service. Rejecting invalid transitions deterministically,
protecting terminal states, enforcing retry safety, and guarding against
unsafe cancellations.
"""

from __future__ import annotations

import logging
from typing import Mapping

from .enums import RunState, StageState
from .exceptions import InvalidStateTransitionError, TerminalStateError

logger = logging.getLogger(__name__)


# Canonical Run Transition Graph
# Defines the exact set of legal target states reachable from any source state.
RUN_TRANSITION_GRAPH: Mapping[RunState, frozenset[RunState]] = {
    RunState.QUEUED: frozenset({
        RunState.STARTING,
        RunState.PAUSED,
        RunState.CANCELLED,
    }),
    RunState.STARTING: frozenset({
        RunState.SCANNING,
        RunState.ANALYZING,
        RunState.OBSERVING,
        RunState.MONITORING,
        RunState.RETRY_WAIT,
        RunState.PAUSED,
        RunState.FAILED,
        RunState.CANCELLED,
    }),
    RunState.SCANNING: frozenset({
        RunState.ANALYZING,
        RunState.RETRY_WAIT,
        RunState.PAUSED,
        RunState.PARTIAL,
        RunState.FAILED,
        RunState.CANCELLED,
    }),
    RunState.ANALYZING: frozenset({
        RunState.OBSERVING,
        RunState.PLANNING,
        RunState.MONITORING,
        RunState.RETRY_WAIT,
        RunState.PAUSED,
        RunState.PARTIAL,
        RunState.FAILED,
        RunState.CANCELLED,
    }),
    RunState.OBSERVING: frozenset({
        RunState.PLANNING,
        RunState.MONITORING,
        RunState.RETRY_WAIT,
        RunState.PAUSED,
        RunState.PARTIAL,
        RunState.FAILED,
        RunState.CANCELLED,
    }),
    RunState.PLANNING: frozenset({
        RunState.EXECUTING,
        RunState.VERIFYING,
        RunState.MONITORING,
        RunState.RETRY_WAIT,
        RunState.PAUSED,
        RunState.PARTIAL,
        RunState.FAILED,
        RunState.CANCELLED,
    }),
    RunState.EXECUTING: frozenset({
        RunState.VERIFYING,
        RunState.RETRY_WAIT,
        RunState.PARTIAL,
        RunState.FAILED,
        # Cancellation and pausing during live EXECUTING is strictly prohibited to prevent half-applied mutations.
    }),
    RunState.VERIFYING: frozenset({
        RunState.MONITORING,
        RunState.RETRY_WAIT,
        RunState.PAUSED,
        RunState.PARTIAL,
        RunState.FAILED,
        RunState.CANCELLED,
    }),
    RunState.MONITORING: frozenset({
        RunState.SUCCEEDED,
        RunState.PARTIAL,
        RunState.RETRY_WAIT,
        RunState.PAUSED,
        RunState.FAILED,
        RunState.CANCELLED,
    }),
    RunState.RETRY_WAIT: frozenset({
        # Resumption targets are dynamically resolved or validated against previous resumable states
        RunState.FAILED,
        RunState.CANCELLED,
    }),
    RunState.PAUSED: frozenset({
        # Resumption targets can be QUEUED, STARTING, previous active state, or cancelled/failed
        RunState.QUEUED,
        RunState.STARTING,
        RunState.CANCELLED,
        RunState.FAILED,
    }),
    # Terminal States: No further transitions allowed
    RunState.SUCCEEDED: frozenset(),
    RunState.PARTIAL: frozenset(),
    RunState.FAILED: frozenset(),
    RunState.CANCELLED: frozenset(),
}


# Canonical Stage Transition Graph
STAGE_TRANSITION_GRAPH: Mapping[StageState, frozenset[StageState]] = {
    StageState.QUEUED: frozenset({
        StageState.RUNNING,
        StageState.SKIPPED,
        StageState.CANCELLED,
        StageState.PAUSED,
        StageState.BLOCKED,
    }),
    StageState.BLOCKED: frozenset({
        StageState.QUEUED,
        StageState.SKIPPED,
        StageState.CANCELLED,
    }),
    StageState.RUNNING: frozenset({
        StageState.SUCCEEDED,
        StageState.FAILED,
        StageState.CANCELLED,
        StageState.RETRY_WAIT,
        StageState.PAUSED,
    }),
    StageState.RETRY_WAIT: frozenset({
        StageState.RUNNING,
        StageState.FAILED,
        StageState.CANCELLED,
    }),
    StageState.PAUSED: frozenset({
        StageState.RUNNING,
        StageState.CANCELLED,
        StageState.FAILED,
    }),
    # Terminal Stage States
    StageState.SUCCEEDED: frozenset(),
    StageState.FAILED: frozenset(),
    StageState.SKIPPED: frozenset(),
    StageState.CANCELLED: frozenset(),
}


class OrchestrationStateMachine:
    """
    Pure, centralized, deterministic state machine validator.
    """

    @classmethod
    def get_allowed_run_transitions(
        cls,
        from_state: RunState,
        previous_active_state: RunState | None = None,
    ) -> set[RunState]:
        """
        Returns the set of legally allowed next states from the given run state.
        """
        base_allowed = set(RUN_TRANSITION_GRAPH.get(from_state, frozenset()))

        # For RETRY_WAIT and PAUSED, if a specific previous resumable state is provided, it can be resumed
        if from_state in (RunState.RETRY_WAIT, RunState.PAUSED) and previous_active_state is not None:
            if previous_active_state.is_active or previous_active_state == RunState.STARTING:
                base_allowed.add(previous_active_state)

        return base_allowed

    @classmethod
    def validate_run_transition(
        cls,
        from_state: RunState | str,
        to_state: RunState | str,
        previous_active_state: RunState | str | None = None,
        run_id: str = "run_unknown",
    ) -> None:
        """
        Validates that a proposed transition for an OrchestrationRun is legal.
        Raises InvalidStateTransitionError or TerminalStateError if illegal.
        """
        if isinstance(from_state, str):
            try:
                from_state = RunState(from_state)
            except ValueError:
                raise InvalidStateTransitionError(
                    entity_type="OrchestrationRun",
                    entity_id=run_id,
                    from_state=str(from_state),
                    to_state=str(to_state),
                    reason=f"Unknown source run state '{from_state}'",
                )

        if isinstance(to_state, str):
            try:
                to_state = RunState(to_state)
            except ValueError:
                raise InvalidStateTransitionError(
                    entity_type="OrchestrationRun",
                    entity_id=run_id,
                    from_state=from_state.value,
                    to_state=str(to_state),
                    reason=f"Unknown target run state '{to_state}'",
                )

        if isinstance(previous_active_state, str) and previous_active_state:
            try:
                previous_active_state = RunState(previous_active_state)
            except ValueError:
                previous_active_state = None

        # 1. Terminal State Check
        if from_state.is_terminal:
            raise TerminalStateError(
                entity_type="OrchestrationRun",
                entity_id=run_id,
                terminal_state=from_state.value,
            )

        # 2. Same-state transition (no-op) rejection to avoid cycle corruption
        if from_state == to_state:
            raise InvalidStateTransitionError(
                entity_type="OrchestrationRun",
                entity_id=run_id,
                from_state=from_state.value,
                to_state=to_state.value,
                reason="Self-transition to the identical state is invalid",
            )

        # 3. Graph Validation
        allowed = cls.get_allowed_run_transitions(from_state, previous_active_state)
        if to_state not in allowed:
            # Check for specific failure reasons to provide actionable error messages
            reason = None
            if from_state == RunState.EXECUTING and to_state == RunState.CANCELLED:
                reason = "Cancellation during live EXECUTING phase is disallowed to protect against half-applied mutations."
            elif from_state == RunState.EXECUTING and to_state == RunState.PAUSED:
                reason = "Pausing during live EXECUTING phase is disallowed to protect against half-applied mutations."
            elif from_state in (RunState.RETRY_WAIT, RunState.PAUSED) and to_state.is_active:
                reason = f"{from_state.value} cannot transition to '{to_state.value}' because it does not match recorded resumable state '{previous_active_state.value if previous_active_state else 'None'}'."

            raise InvalidStateTransitionError(
                entity_type="OrchestrationRun",
                entity_id=run_id,
                from_state=from_state.value,
                to_state=to_state.value,
                allowed_states=[s.value for s in allowed],
                reason=reason,
            )

    @classmethod
    def get_allowed_stage_transitions(cls, from_state: StageState) -> set[StageState]:
        """
        Returns the set of legally allowed next states for an OrchestrationStage.
        """
        return set(STAGE_TRANSITION_GRAPH.get(from_state, frozenset()))

    @classmethod
    def validate_stage_transition(
        cls,
        from_state: StageState | str,
        to_state: StageState | str,
        stage_id: str = "stg_unknown",
    ) -> None:
        """
        Validates that a proposed transition for an OrchestrationStage is legal.
        """
        if isinstance(from_state, str):
            try:
                from_state = StageState(from_state)
            except ValueError:
                raise InvalidStateTransitionError(
                    entity_type="OrchestrationStage",
                    entity_id=stage_id,
                    from_state=str(from_state),
                    to_state=str(to_state),
                    reason=f"Unknown source stage state '{from_state}'",
                )

        if isinstance(to_state, str):
            try:
                to_state = StageState(to_state)
            except ValueError:
                raise InvalidStateTransitionError(
                    entity_type="OrchestrationStage",
                    entity_id=stage_id,
                    from_state=from_state.value,
                    to_state=str(to_state),
                    reason=f"Unknown target stage state '{to_state}'",
                )

        if from_state.is_terminal:
            raise TerminalStateError(
                entity_type="OrchestrationStage",
                entity_id=stage_id,
                terminal_state=from_state.value,
            )

        if from_state == to_state:
            raise InvalidStateTransitionError(
                entity_type="OrchestrationStage",
                entity_id=stage_id,
                from_state=from_state.value,
                to_state=to_state.value,
                reason="Self-transition to the identical stage state is invalid",
            )

        allowed = cls.get_allowed_stage_transitions(from_state)
        if to_state not in allowed:
            raise InvalidStateTransitionError(
                entity_type="OrchestrationStage",
                entity_id=stage_id,
                from_state=from_state.value,
                to_state=to_state.value,
                allowed_states=[s.value for s in allowed],
            )
