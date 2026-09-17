"""
Execution State Machine for Safe Fix Execution (Task 11 Step 4).

Enforces deterministic lifecycle transitions:
PLANNED -> SAFETY_CHECKED -> PREVIEWED -> APPROVED -> APPLYING -> APPLIED

Guarantees:
- Illegal state jumps are strictly rejected
- Failures can never silently become success
- Terminated or blocked states cannot transition to execution
"""

from __future__ import annotations

from typing import Set

from connectors.execution.errors import InvalidStateTransitionError
from connectors.execution.models import ExecutionLifecycleState, ExecutionRecord


# Allowed forward and terminal transitions
VALID_TRANSITIONS: dict[ExecutionLifecycleState, Set[ExecutionLifecycleState]] = {
    ExecutionLifecycleState.PLANNED: {
        ExecutionLifecycleState.SAFETY_CHECKED,
        ExecutionLifecycleState.BLOCKED,
        ExecutionLifecycleState.REJECTED,
        ExecutionLifecycleState.FAILED,
    },
    ExecutionLifecycleState.SAFETY_CHECKED: {
        ExecutionLifecycleState.PREVIEWED,
        ExecutionLifecycleState.BLOCKED,
        ExecutionLifecycleState.REJECTED,
        ExecutionLifecycleState.FAILED,
    },
    ExecutionLifecycleState.PREVIEWED: {
        ExecutionLifecycleState.APPROVED,
        ExecutionLifecycleState.APPLYING,  # Permitted for AUTO_SAFE only
        ExecutionLifecycleState.BLOCKED,
        ExecutionLifecycleState.REJECTED,
        ExecutionLifecycleState.FAILED,
    },
    ExecutionLifecycleState.APPROVED: {
        ExecutionLifecycleState.APPLYING,
        ExecutionLifecycleState.REJECTED,
        ExecutionLifecycleState.FAILED,
    },
    ExecutionLifecycleState.APPLYING: {
        ExecutionLifecycleState.APPLIED,
        ExecutionLifecycleState.MANUAL_REVIEW_REQUIRED,
        ExecutionLifecycleState.FAILED,
    },
    ExecutionLifecycleState.APPLIED: {
        ExecutionLifecycleState.VALIDATING,
        ExecutionLifecycleState.ROLLED_BACK,
        ExecutionLifecycleState.ROLLBACK_FAILED,
        ExecutionLifecycleState.MANUAL_REVIEW_REQUIRED,
        ExecutionLifecycleState.FAILED,
    },
    ExecutionLifecycleState.VALIDATING: {
        ExecutionLifecycleState.RESCANNING,
        ExecutionLifecycleState.VERIFIED,
        ExecutionLifecycleState.REGRESSION,
        ExecutionLifecycleState.MANUAL_REVIEW_REQUIRED,
        ExecutionLifecycleState.FAILED,
    },
    ExecutionLifecycleState.RESCANNING: {
        ExecutionLifecycleState.VERIFIED,
        ExecutionLifecycleState.REGRESSION,
        ExecutionLifecycleState.MANUAL_REVIEW_REQUIRED,
        ExecutionLifecycleState.FAILED,
    },
    ExecutionLifecycleState.VERIFIED: {
        ExecutionLifecycleState.KEPT,
        ExecutionLifecycleState.REGRESSION,
        ExecutionLifecycleState.ROLLED_BACK,
        ExecutionLifecycleState.ROLLBACK_FAILED,
        ExecutionLifecycleState.MANUAL_REVIEW_REQUIRED,
        ExecutionLifecycleState.FAILED,
    },
    ExecutionLifecycleState.KEPT: {
        ExecutionLifecycleState.ROLLED_BACK,
        ExecutionLifecycleState.ROLLBACK_FAILED,
        ExecutionLifecycleState.MANUAL_REVIEW_REQUIRED,
        ExecutionLifecycleState.FAILED,
    },
    ExecutionLifecycleState.REGRESSION: {
        ExecutionLifecycleState.ROLLED_BACK,
        ExecutionLifecycleState.ROLLBACK_FAILED,
        ExecutionLifecycleState.MANUAL_REVIEW_REQUIRED,
        ExecutionLifecycleState.FAILED,
    },
    ExecutionLifecycleState.ROLLBACK_FAILED: {
        ExecutionLifecycleState.MANUAL_REVIEW_REQUIRED,
        ExecutionLifecycleState.FAILED,
    },
    ExecutionLifecycleState.MANUAL_REVIEW_REQUIRED: set(),  # Terminal state
    ExecutionLifecycleState.ROLLED_BACK: set(),             # Terminal state
    ExecutionLifecycleState.FAILED: set(),                  # Terminal state
    ExecutionLifecycleState.BLOCKED: set(),                 # Terminal state
    ExecutionLifecycleState.REJECTED: set(),                # Terminal state
}


class ExecutionStateMachine:
    """
    State machine validator for Fix Execution lifecycles.
    """

    @classmethod
    def can_transition(
        cls,
        current_state: ExecutionLifecycleState,
        target_state: ExecutionLifecycleState,
    ) -> bool:
        """Returns True if transition from current_state to target_state is permitted."""
        return target_state in VALID_TRANSITIONS.get(current_state, set())

    @classmethod
    def transition(
        cls,
        record: ExecutionRecord,
        target_state: ExecutionLifecycleState,
        reason: str | None = None,
    ) -> ExecutionLifecycleState:
        """
        Transitions the record to target_state if valid; raises InvalidStateTransitionError otherwise.
        """
        current_state = record.state
        if not cls.can_transition(current_state, target_state):
            raise InvalidStateTransitionError(
                current_state=current_state.value,
                target_state=target_state.value,
                message=f"Illegal execution transition: cannot move from '{current_state.value}' to '{target_state.value}'"
                + (f" ({reason})" if reason else ""),
            )

        record.transition_to(target_state)
        return target_state
