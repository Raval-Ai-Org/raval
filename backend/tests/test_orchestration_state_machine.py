"""
Unit Tests for Centralized Orchestration State Machine and Stage Planner.

Verifies:
1. Every allowed run transition.
2. Representative invalid transitions.
3. Terminal states cannot transition further.
4. CANCELLED is distinct from FAILED.
5. Cancellation prohibited during EXECUTING phase.
6. RETRY_WAIT can only resume to explicitly recorded safe state.
7. Stage state machine transitions and terminal protection.
8. Deterministic stage blueprints for all 7 RunTypes.
"""

from __future__ import annotations

import pytest

from app.orchestration.enums import RunState, RunType, StageName, StageState
from app.orchestration.exceptions import (
    InvalidStateTransitionError,
    TerminalStateError,
)
from app.orchestration.stage_planner import StagePlanner
from app.orchestration.state_machine import (
    RUN_TRANSITION_GRAPH,
    STAGE_TRANSITION_GRAPH,
    OrchestrationStateMachine,
)


class TestRunStateMachineTransitions:
    """Validates the canonical run transition graph."""

    def test_every_allowed_run_transition(self) -> None:
        """Every edge in RUN_TRANSITION_GRAPH must pass validation."""
        for from_state, allowed_targets in RUN_TRANSITION_GRAPH.items():
            for to_state in allowed_targets:
                # Should not raise exception
                OrchestrationStateMachine.validate_run_transition(
                    from_state=from_state,
                    to_state=to_state,
                    run_id="test_run_001",
                )

    def test_retry_wait_resumption_to_recorded_state(self) -> None:
        """RETRY_WAIT can safely resume to a recorded active state."""
        # Resuming to SCANNING when previous state was SCANNING
        OrchestrationStateMachine.validate_run_transition(
            from_state=RunState.RETRY_WAIT,
            to_state=RunState.SCANNING,
            previous_active_state=RunState.SCANNING,
            run_id="test_run_retry",
        )

        # Resuming to ANALYZING when previous state was ANALYZING
        OrchestrationStateMachine.validate_run_transition(
            from_state=RunState.RETRY_WAIT,
            to_state=RunState.ANALYZING,
            previous_active_state=RunState.ANALYZING,
            run_id="test_run_retry",
        )

        # Resuming to FAILED or CANCELLED is always allowed
        OrchestrationStateMachine.validate_run_transition(
            from_state=RunState.RETRY_WAIT,
            to_state=RunState.FAILED,
            run_id="test_run_retry",
        )
        OrchestrationStateMachine.validate_run_transition(
            from_state=RunState.RETRY_WAIT,
            to_state=RunState.CANCELLED,
            run_id="test_run_retry",
        )

    def test_retry_wait_rejects_unrecorded_arbitrary_resumption(self) -> None:
        """RETRY_WAIT cannot jump to an arbitrary unrecorded active state."""
        with pytest.raises(InvalidStateTransitionError) as exc_info:
            OrchestrationStateMachine.validate_run_transition(
                from_state=RunState.RETRY_WAIT,
                to_state=RunState.EXECUTING,
                previous_active_state=RunState.SCANNING,  # Mismatch!
                run_id="test_run_retry_fail",
            )
        assert "RETRY_WAIT cannot transition to 'EXECUTING'" in str(exc_info.value)

    def test_representative_invalid_run_transitions(self) -> None:
        """Illegal state jumps must be deterministically rejected."""
        invalid_pairs = [
            (RunState.QUEUED, RunState.SCANNING),
            (RunState.QUEUED, RunState.SUCCEEDED),
            (RunState.QUEUED, RunState.PLANNING),
            (RunState.STARTING, RunState.SUCCEEDED),
            (RunState.SCANNING, RunState.EXECUTING),
            (RunState.SCANNING, RunState.SUCCEEDED),
            (RunState.OBSERVING, RunState.SCANNING),
            (RunState.VERIFYING, RunState.SCANNING),
        ]

        for from_state, to_state in invalid_pairs:
            with pytest.raises(InvalidStateTransitionError) as exc_info:
                OrchestrationStateMachine.validate_run_transition(
                    from_state=from_state,
                    to_state=to_state,
                    run_id="test_invalid",
                )
            assert exc_info.value.from_state == from_state.value
            assert exc_info.value.to_state == to_state.value

    def test_terminal_states_cannot_transition_further(self) -> None:
        """Terminal states (SUCCEEDED, PARTIAL, FAILED, CANCELLED) are strictly immutable."""
        terminal_states = [
            RunState.SUCCEEDED,
            RunState.PARTIAL,
            RunState.FAILED,
            RunState.CANCELLED,
        ]

        for term in terminal_states:
            for target in RunState:
                with pytest.raises(TerminalStateError) as exc_info:
                    OrchestrationStateMachine.validate_run_transition(
                        from_state=term,
                        to_state=target,
                        run_id="test_terminal",
                    )
                assert term.value in str(exc_info.value)

    def test_self_transition_is_rejected(self) -> None:
        """Transitioning from state X to state X is invalid."""
        for state in [RunState.QUEUED, RunState.SCANNING, RunState.PLANNING]:
            with pytest.raises(InvalidStateTransitionError) as exc_info:
                OrchestrationStateMachine.validate_run_transition(
                    from_state=state,
                    to_state=state,
                    run_id="test_self",
                )
            assert "Self-transition" in str(exc_info.value)

    def test_cancellation_distinct_from_failure(self) -> None:
        """CANCELLED and FAILED are distinct terminal states with separate semantics."""
        assert RunState.CANCELLED != RunState.FAILED
        assert RunState.CANCELLED.is_terminal
        assert RunState.FAILED.is_terminal

        # Queued run can be cancelled
        OrchestrationStateMachine.validate_run_transition(
            from_state=RunState.QUEUED,
            to_state=RunState.CANCELLED,
        )

        # Scanning run can be cancelled
        OrchestrationStateMachine.validate_run_transition(
            from_state=RunState.SCANNING,
            to_state=RunState.CANCELLED,
        )

        # Scanning run can also fail
        OrchestrationStateMachine.validate_run_transition(
            from_state=RunState.SCANNING,
            to_state=RunState.FAILED,
        )

    def test_cancellation_disallowed_during_live_executing(self) -> None:
        """Cancellation during EXECUTING is forbidden to prevent half-applied external changes."""
        assert not RunState.EXECUTING.allows_cancellation
        with pytest.raises(InvalidStateTransitionError) as exc_info:
            OrchestrationStateMachine.validate_run_transition(
                from_state=RunState.EXECUTING,
                to_state=RunState.CANCELLED,
                run_id="test_executing",
            )
        assert "Cancellation during live EXECUTING phase is disallowed" in str(exc_info.value)


class TestStageStateMachineTransitions:
    """Validates the stage transition rules."""

    def test_every_allowed_stage_transition(self) -> None:
        """Every edge in STAGE_TRANSITION_GRAPH must pass validation."""
        for from_state, allowed_targets in STAGE_TRANSITION_GRAPH.items():
            for to_state in allowed_targets:
                OrchestrationStateMachine.validate_stage_transition(
                    from_state=from_state,
                    to_state=to_state,
                    stage_id="stg_001",
                )

    def test_stage_terminal_states_cannot_transition(self) -> None:
        """Completed/terminal stages cannot silently return to active states."""
        terminal_stages = [
            StageState.SUCCEEDED,
            StageState.FAILED,
            StageState.SKIPPED,
            StageState.CANCELLED,
        ]

        for term in terminal_stages:
            for target in StageState:
                with pytest.raises(TerminalStateError):
                    OrchestrationStateMachine.validate_stage_transition(
                        from_state=term,
                        to_state=target,
                        stage_id="stg_term",
                    )

    def test_invalid_stage_transitions(self) -> None:
        """Invalid stage state jumps are rejected."""
        invalid_pairs = [
            (StageState.QUEUED, StageState.SUCCEEDED),
            (StageState.QUEUED, StageState.FAILED),
            (StageState.RUNNING, StageState.BLOCKED),
            (StageState.RETRY_WAIT, StageState.SUCCEEDED),
        ]

        for from_state, to_state in invalid_pairs:
            with pytest.raises(InvalidStateTransitionError):
                OrchestrationStateMachine.validate_stage_transition(
                    from_state=from_state,
                    to_state=to_state,
                    stage_id="stg_invalid",
                )


class TestDeterministicStagePlanner:
    """Validates deterministic blueprint generation for all RunTypes."""

    @pytest.mark.parametrize("run_type", list(RunType))
    def test_stage_plan_determinism_and_ordering(self, run_type: RunType) -> None:
        """Every run type produces a non-empty, strictly ordered, deterministic stage plan."""
        plan_1 = StagePlanner.generate_plan_for_run_type(run_type)
        plan_2 = StagePlanner.generate_plan_for_run_type(run_type)

        assert len(plan_1) > 0
        assert len(plan_1) == len(plan_2)

        # Ordering must start at 0 and be strictly consecutive
        orders = [bp.execution_order for bp in plan_1]
        assert orders == list(range(len(plan_1)))

        # Blueprints must be identical
        for bp1, bp2 in zip(plan_1, plan_2):
            assert bp1.stage_name == bp2.stage_name
            assert bp1.execution_order == bp2.execution_order
            assert bp1.dependencies == bp2.dependencies
            assert bp1.max_attempts == bp2.max_attempts

    def test_on_demand_scan_plan_structure(self) -> None:
        """Verifies expected stages in an ON_DEMAND_SCAN."""
        plan = StagePlanner.generate_plan_for_run_type(RunType.ON_DEMAND_SCAN)
        stage_names = [bp.stage_name for bp in plan]
        assert stage_names == [
            StageName.CRAWL_DISCOVERY,
            StageName.CONTENT_EXTRACTION,
            StageName.SIGNAL_ANALYSIS,
            StageName.SCORING,
            StageName.EVIDENCE_OBSERVATION,
            StageName.RECOMMENDATION_PLANNING,
            StageName.MONITORING_CHECK,
        ]

    def test_verification_run_plan_structure(self) -> None:
        """Verifies expected stages in a VERIFICATION_RUN."""
        plan = StagePlanner.generate_plan_for_run_type(RunType.VERIFICATION_RUN)
        stage_names = [bp.stage_name for bp in plan]
        assert stage_names == [
            StageName.VERIFICATION,
            StageName.TARGETED_RESCAN,
            StageName.DELTA_MEASUREMENT,
            StageName.REGRESSION_GUARD,
        ]
