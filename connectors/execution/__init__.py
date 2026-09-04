"""
Execution Subsystem Package (Task 11 Step 4).

Exposes:
- Execution requests, targets, records, results
- Safety decisions and Safety Gate
- Approval records and ApprovalManager
- Lifecycle state machine
- ExecutionEngine orchestrator
- Specialized execution exceptions
"""

from .approval import ApprovalManager, compute_proposal_hash
from .engine import ExecutionEngine
from .errors import (
    ApprovalRequiredError,
    DuplicateExecutionError,
    InvalidStateTransitionError,
    SafetyGateRejectedError,
    StaleApprovalError,
)
from .models import (
    ApprovalRecord,
    ExecutionLifecycleState,
    ExecutionRecord,
    ExecutionRequest,
    ExecutionResult,
    ExecutionTarget,
    FindingComparison,
    RegressionIndicator,
    RegressionSeverity,
    RescanTarget,
    RollbackVerificationResult,
    SafetyDecisionType,
    SafetyGateDecision,
    ScoreComparison,
    TargetedRescanResult,
    ValidationOutcome,
    ValidationReport,
)
from .rescan import TargetedRescanner
from .rollback import RollbackManager
from .safety_gate import SafetyGate
from .state_machine import ExecutionStateMachine
from .validation import ValidationEngine

__all__ = [
    # Models
    "ExecutionTarget",
    "ExecutionRequest",
    "ExecutionResult",
    "ExecutionRecord",
    "ApprovalRecord",
    "SafetyGateDecision",
    "SafetyDecisionType",
    "ExecutionLifecycleState",
    "ValidationOutcome",
    "RegressionSeverity",
    "RescanTarget",
    "TargetedRescanResult",
    "ScoreComparison",
    "FindingComparison",
    "RegressionIndicator",
    "ValidationReport",
    "RollbackVerificationResult",
    # Components
    "SafetyGate",
    "ExecutionStateMachine",
    "ApprovalManager",
    "ExecutionEngine",
    "TargetedRescanner",
    "ValidationEngine",
    "RollbackManager",
    "compute_proposal_hash",
    # Errors
    "SafetyGateRejectedError",
    "ApprovalRequiredError",
    "InvalidStateTransitionError",
    "StaleApprovalError",
    "DuplicateExecutionError",
]

