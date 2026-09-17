"""
Production Orchestration & Monitoring - Controlled End-to-End Orchestrator.

Implements the deterministic orchestration service coordinating:
QUEUED -> STARTING -> SCANNING -> ANALYZING -> OBSERVING -> PLANNING ->
EXECUTING -> VERIFYING -> MONITORING -> SUCCEEDED / PARTIAL / FAILED / CANCELLED.

Guarantees:
- Strict multi-tenant and site boundary enforcement
- Centralized state machine transitions and audit events
- Cooperative cancellation and pause checks at stage milestones
- Durable checkpoints and execution receipts
- Strict safety and approval gating on external mutations
- Failure classification and deterministic outcome resolution
- Concurrency slot acquisition and guaranteed release
"""

from __future__ import annotations

from datetime import datetime, timezone
import logging
from typing import Any
from uuid import uuid4

from sqlalchemy.orm import Session

from connectors.base.security import sanitize_payload

from .checkpoints import CheckpointManager
from .concurrency import ConcurrencyController
from .contracts import StageInputContract, StageOutputContract
from .control import ControlService
from .enums import (
    AlertSeverity,
    AutomationLevel,
    CancellationOutcome,
    CheckpointType,
    ControlSignalType,
    FailureClass,
    OrchestrationEventType,
    RunState,
    RunType,
    StageName,
    StageState,
    TriggerSource,
)
from .exceptions import (
    CancellationRejectedError,
    RunNotFoundError,
    SiteMismatchError,
    TenantMismatchError,
)
from .failure_classifier import FailureClassifier
from .handlers import (
    AnalysisHandler,
    ExecutionHandler,
    MonitoringHandler,
    ObservationHandler,
    PlanningHandler,
    ScanningHandler,
    VerificationHandler,
)
from .models import OrchestrationControlRequest, OrchestrationEvent, OrchestrationRun, OrchestrationStage
from .observability import ObservabilityService
from .policies import PolicyEvaluator, TenantPolicyRegistry
from .ports import validate_tenant_site_boundary
from .queue import OrchestrationQueue, QueueJob
from .receipts import ExecutionReceiptManager
from .retry_policy import RetryDecision, RetryEngine, RetryPolicy
from .schemas import ActorProvenance, OrchestrationRunCreateRequest
from .service import OrchestrationService

logger = logging.getLogger(__name__)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


class ProductionOrchestrator:
    """
    Deterministic end-to-end production orchestrator coordinating all phases
    of the Raval AI Search Intelligence lifecycle.
    """

    def __init__(
        self,
        orchestration_service: OrchestrationService | None = None,
        observability: ObservabilityService | None = None,
        control_service: ControlService | None = None,
        concurrency_controller: ConcurrencyController | None = None,
        policy_evaluator: PolicyEvaluator | None = None,
        failure_classifier: FailureClassifier | None = None,
        retry_engine: RetryEngine | None = None,
        checkpoint_manager: CheckpointManager | None = None,
        receipt_manager: ExecutionReceiptManager | None = None,
    ) -> None:
        self.orchestration_service = orchestration_service or OrchestrationService()
        self.orch_service = self.orchestration_service
        self.observability = observability or ObservabilityService()
        self.observability_service = self.observability
        self.control_service = control_service or ControlService(self.orchestration_service)
        self.concurrency_controller = concurrency_controller or ConcurrencyController()
        self.policy_evaluator = policy_evaluator or PolicyEvaluator()
        self.failure_classifier = failure_classifier or FailureClassifier()
        self.retry_engine = retry_engine or RetryEngine()
        self.checkpoint_manager = checkpoint_manager or CheckpointManager
        self.receipt_manager = receipt_manager or ExecutionReceiptManager()

        # Instantiate stage handlers
        self.scanning_handler = ScanningHandler()
        self.analysis_handler = AnalysisHandler()
        self.observation_handler = ObservationHandler()
        self.planning_handler = PlanningHandler()
        self.execution_handler = ExecutionHandler(receipt_manager=self.receipt_manager, observability=self.observability)
        self.verification_handler = VerificationHandler()
        self.monitoring_handler = MonitoringHandler()

    def create_and_execute_run(
        self,
        db: Session,
        workspace_id: str,
        site_id: int,
        run_type: RunType | str = RunType.ON_DEMAND_SCAN,
        trigger_source: TriggerSource | str = TriggerSource.MANUAL,
        actor: dict[str, Any] | None = None,
        idempotency_key: str | None = None,
        correlation_id: str | None = None,
        parameters: dict[str, Any] | None = None,
        auto_execute: bool = True,
    ) -> OrchestrationRun:
        """
        Creates a new run with policy checks and optionally executes the full pipeline deterministically.
        """
        # 1. Tenant & Site Boundary Validation
        validate_tenant_site_boundary(db, tenant_id=workspace_id, site_id=site_id)

        # 2. Evaluate Policy
        is_automated = (
            trigger_source == TriggerSource.SCHEDULER
            or trigger_source == TriggerSource.POLICY_EVENT
            or str(getattr(trigger_source, "value", trigger_source)).lower()
            in ("scheduler", "scheduled", "policy_event", "event_driven")
        )
        self.policy_evaluator.evaluate_run_creation(
            db,
            workspace_id=workspace_id,
            site_id=site_id,
            is_automated=is_automated,
            enforce=True,
        )

        # 3. Create or reuse idempotent run
        run_type_enum = RunType(run_type) if isinstance(run_type, str) else run_type
        trigger_enum = TriggerSource(trigger_source) if isinstance(trigger_source, str) else trigger_source

        provenance = ActorProvenance(
            actor_type=actor.get("actor_type", "user") if actor else "user",
            actor_id=actor.get("actor_id", "system") if actor else "system",
        )

        req = OrchestrationRunCreateRequest(
            workspace_id=workspace_id,
            site_id=site_id,
            run_type=run_type_enum,
            trigger_source=trigger_enum,
            idempotency_key=idempotency_key,
            correlation_id=correlation_id,
            actor_provenance=provenance,
            metadata_payload=parameters or {},
        )

        run = self.orchestration_service.create_run(req, db)

        if auto_execute:
            if run.state in (RunState.SUCCEEDED.value, RunState.PARTIAL.value, RunState.FAILED.value, RunState.CANCELLED.value):
                # Idempotent replay: already completed terminal run
                logger.info("Run '%s' already terminal (%s); returning without re-execution", run.id, run.state)
                return run

            return self.execute_run(db, workspace_id, site_id, run.id, parameters=parameters)

        return run

    def execute_run(
        self,
        db: Session,
        workspace_id: str | None = None,
        site_id: int | None = None,
        run_id: str | None = None,
        checkpoint_id: str | None = None,
        parameters: dict[str, Any] | None = None,
        queue_job: QueueJob | None = None,
    ) -> OrchestrationRun:
        """
        Executes an existing run through the canonical state machine stages.
        """
        if run_id is None:
            raise ValueError("run_id must be provided to execute_run")

        target_run = db.query(OrchestrationRun).filter(OrchestrationRun.id == run_id).first()
        if not target_run:
            raise RunNotFoundError(run_id=run_id, workspace_id=workspace_id or "default")

        if workspace_id is None:
            workspace_id = target_run.workspace_id
        elif workspace_id != target_run.workspace_id:
            raise TenantMismatchError(
                request_workspace_id=workspace_id,
                target_workspace_id=target_run.workspace_id,
                entity_id=run_id,
            )

        if site_id is None:
            site_id = target_run.site_id
        elif site_id != target_run.site_id:
            raise SiteMismatchError(
                run_id=run_id,
                expected_site_id=target_run.site_id,
                actual_site_id=site_id,
            )

        validate_tenant_site_boundary(db, tenant_id=workspace_id, site_id=site_id)
        run = self.orchestration_service.get_run(workspace_id=workspace_id, run_id=run_id, db=db, site_id=site_id)

        # Fast-exit if already terminal
        if run.state in (RunState.SUCCEEDED.value, RunState.PARTIAL.value, RunState.FAILED.value, RunState.CANCELLED.value):
            return run

        # Acquire concurrency slot
        acquired = self.concurrency_controller.acquire(workspace_id=workspace_id, site_id=site_id)
        if not acquired:
            logger.warning("Concurrency capacity exhausted for workspace '%s', site %d", workspace_id, site_id)
            # Re-queue or fail based on policy
            return run

        stage_outputs: dict[str, Any] = {}
        had_partial_gaps = False
        partial_reasons: list[str] = []

        try:
            # 1. Transition to STARTING
            if run.state == RunState.QUEUED.value:
                run = self.orchestration_service.transition_run_state(
                    workspace_id=workspace_id,
                    run_id=run.id,
                    target_state=RunState.STARTING,
                    db=db,
                    reason="Orchestrator claiming run execution",
                )
                self.observability.record_event(
                    db,
                    workspace_id,
                    OrchestrationEventType.RUN_STARTED,
                    site_id=site_id,
                    run_id=run.id,
                    severity=AlertSeverity.INFO,
                    details={"run_type": run.run_type},
                )

            # Check cooperative signals before beginning stages
            if self._check_cooperative_signal(db, run):
                return run

            # Restore checkpoint state if provided
            if checkpoint_id:
                ckpt = self.checkpoint_manager.restore_checkpoint(
                    workspace_id=workspace_id,
                    run_id=run.id,
                    checkpoint_id=checkpoint_id,
                    db=db,
                )
                if ckpt and ckpt.completed_work_summary:
                    stage_outputs.update(ckpt.completed_work_summary)

            # Canonical lifecycle execution phases
            phases = [
                (RunState.SCANNING, "SCANNING", self.scanning_handler),
                (RunState.ANALYZING, "ANALYZING", self.analysis_handler),
                (RunState.OBSERVING, "OBSERVING", self.observation_handler),
                (RunState.PLANNING, "PLANNING", self.planning_handler),
                (RunState.EXECUTING, "EXECUTING", self.execution_handler),
                (RunState.VERIFYING, "VERIFYING", self.verification_handler),
                (RunState.MONITORING, "MONITORING", self.monitoring_handler),
            ]

            for state_target, phase_name, handler in phases:
                # Check for cancellation or pause requests at stage boundary
                if self._check_cooperative_signal(db, run):
                    return run

                # Locate or create the corresponding stage record
                stage = self._find_or_create_stage(db, run, phase_name)

                # If stage was already SUCCEEDED (e.g. resuming from checkpoint), skip re-execution
                if stage.state == StageState.SUCCEEDED.value:
                    logger.info("Stage '%s' in run '%s' already SUCCEEDED; skipping re-execution", phase_name, run.id)
                    if stage.output_summary:
                        refs = stage.output_summary.get("output_refs", {})
                        stage_outputs.update(refs)
                    continue

                # Transition run state
                run = self.orchestration_service.transition_run_state(
                    workspace_id=workspace_id,
                    run_id=run.id,
                    target_state=state_target,
                    db=db,
                    reason=f"Transitioning to phase {phase_name}",
                )

                # Transition stage to RUNNING
                self.orchestration_service.transition_stage_state(
                    workspace_id=workspace_id,
                    run_id=run.id,
                    stage_id=stage.id,
                    target_state=StageState.RUNNING,
                    db=db,
                )
                self.observability.record_event(
                    db,
                    workspace_id,
                    OrchestrationEventType.STAGE_STARTED,
                    site_id=site_id,
                    run_id=run.id,
                    stage_id=stage.id,
                    severity=AlertSeverity.INFO,
                    details={"stage_name": phase_name},
                )

                # Prepare input contract
                contract = StageInputContract(
                    run_id=run.id,
                    workspace_id=workspace_id,
                    site_id=site_id,
                    stage_id=stage.id,
                    stage_name=phase_name,
                    correlation_id=run.correlation_id,
                    input_refs=dict(stage_outputs),
                    parameters=parameters or {},
                )

                # Execute handler with failure classification
                try:
                    output_contract = handler.execute(db, contract)
                    stage_outputs.update(output_contract.output_refs)

                    # Update stage record with output contract
                    stage.output_summary = output_contract.to_dict()
                    stage.completed_at = output_contract.completed_at

                    # Check stage outcome
                    if output_contract.status == StageState.FAILED.value:
                        self.orchestration_service.transition_stage_state(
                            workspace_id=workspace_id,
                            run_id=run.id,
                            stage_id=stage.id,
                            target_state=StageState.FAILED,
                            db=db,
                            error_detail=output_contract.error_detail,
                        )
                        had_partial_gaps = True
                        partial_reasons.append(f"Stage {phase_name} reported failure")
                    else:
                        self.orchestration_service.transition_stage_state(
                            workspace_id=workspace_id,
                            run_id=run.id,
                            stage_id=stage.id,
                            target_state=StageState.SUCCEEDED,
                            db=db,
                        )

                    self.observability.record_event(
                        db,
                        workspace_id,
                        OrchestrationEventType.STAGE_COMPLETED,
                        site_id=site_id,
                        run_id=run.id,
                        stage_id=stage.id,
                        severity=AlertSeverity.INFO,
                        duration_ms=output_contract.duration_ms,
                        details={"stage_name": phase_name, "status": output_contract.status},
                    )

                    # Inspect partial gaps from execution or validation
                    if phase_name == "EXECUTING":
                        blocked = output_contract.output_refs.get("blocked_count", 0)
                        skipped = output_contract.output_refs.get("skipped_count", 0)
                        if blocked > 0 or skipped > 0:
                            had_partial_gaps = True
                            partial_reasons.append(f"Execution had {blocked} blocked and {skipped} skipped fixes")

                    if phase_name == "VERIFYING":
                        val_sum = output_contract.output_refs.get("validation_summary", {})
                        if val_sum.get("FAIL", 0) > 0:
                            had_partial_gaps = True
                            partial_reasons.append(f"Validation had {val_sum.get('FAIL')} failed items")

                    # Checkpoint milestone
                    self.checkpoint_manager.create_checkpoint(
                        workspace_id=workspace_id,
                        site_id=site_id,
                        run_id=run.id,
                        checkpoint_type=CheckpointType.STAGE_BOUNDARY,
                        db=db,
                        stage_id=stage.id,
                        progress_cursor={"stage_name": phase_name},
                        completed_work_summary=stage_outputs,
                    )

                except Exception as ex:
                    logger.exception("Error executing stage '%s' in run '%s': %s", phase_name, run.id, ex)
                    failure_rec = self.failure_classifier.classify(ex)

                    stage.error_detail = failure_rec.to_dict()
                    self.orchestration_service.transition_stage_state(
                        workspace_id=workspace_id,
                        run_id=run.id,
                        stage_id=stage.id,
                        target_state=StageState.FAILED,
                        db=db,
                        error_detail=failure_rec.to_dict(),
                    )
                    self.observability.record_event(
                        db,
                        workspace_id,
                        OrchestrationEventType.STAGE_FAILED,
                        site_id=site_id,
                        run_id=run.id,
                        stage_id=stage.id,
                        severity=AlertSeverity.CRITICAL,
                        details={"error": str(ex), "failure_class": failure_rec.failure_class.value},
                    )

                    # Check retry eligibility
                    if failure_rec.is_retryable and run.attempt_count < 3:
                        run = self.orchestration_service.transition_run_state(
                            workspace_id=workspace_id,
                            run_id=run.id,
                            target_state=RunState.RETRY_WAIT,
                            db=db,
                            reason=f"Transient failure in {phase_name}; retry scheduled",
                            error_detail=failure_rec.to_dict(),
                        )
                        self.observability.record_event(
                            db,
                            workspace_id,
                            OrchestrationEventType.RETRY_SCHEDULED,
                            site_id=site_id,
                            run_id=run.id,
                            stage_id=stage.id,
                            severity=AlertSeverity.MEDIUM,
                            details={"attempt": run.attempt_count},
                        )
                        return run
                    else:
                        # Non-retryable error -> transition run to FAILED
                        run = self.orchestration_service.transition_run_state(
                            workspace_id=workspace_id,
                            run_id=run.id,
                            target_state=RunState.FAILED,
                            db=db,
                            reason=f"Non-retryable failure in {phase_name}: {ex}",
                            error_detail=failure_rec.to_dict(),
                        )
                        self.observability.record_event(
                            db,
                            workspace_id,
                            OrchestrationEventType.JOB_FAILED,
                            site_id=site_id,
                            run_id=run.id,
                            severity=AlertSeverity.CRITICAL,
                            details={"error": str(ex)},
                        )
                        return run

            # All stages executed -> Resolve terminal outcome
            now = _utc_now()
            terminal_state = RunState.PARTIAL if had_partial_gaps else RunState.SUCCEEDED

            run.outcome_summary = sanitize_payload({
                "terminal_state": terminal_state.value,
                "stages_executed": len(phases),
                "partial_gaps": had_partial_gaps,
                "partial_reasons": partial_reasons,
                "output_data": stage_outputs,
                "completed_at": now.isoformat(),
            })

            run = self.orchestration_service.transition_run_state(
                workspace_id=workspace_id,
                run_id=run.id,
                target_state=terminal_state,
                db=db,
                reason="All orchestration stages completed cleanly" if not had_partial_gaps else "; ".join(partial_reasons),
            )

            self.observability.record_event(
                db,
                workspace_id,
                OrchestrationEventType.JOB_COMPLETED,
                site_id=site_id,
                run_id=run.id,
                severity=AlertSeverity.INFO,
                details={"outcome": terminal_state.value, "partial_gaps": had_partial_gaps},
            )

            return run

        finally:
            self.concurrency_controller.release(workspace_id=workspace_id, site_id=site_id)

    def _check_cooperative_signal(self, db: Session, run: OrchestrationRun) -> bool:
        """
        Checks if a cooperative cancellation or pause signal was received.
        Returns True if the run was transitioned and execution should stop.
        """
        ctrl_req = (
            db.query(OrchestrationControlRequest)
            .filter(
                OrchestrationControlRequest.run_id == run.id,
                OrchestrationControlRequest.is_acknowledged.is_(False),
            )
            .order_by(OrchestrationControlRequest.requested_at.asc())
            .first()
        )

        if not ctrl_req:
            return False

        sig_type = ctrl_req.signal_type
        if sig_type == ControlSignalType.CANCEL.value:
            # Cannot cancel if currently in EXECUTING state (protected by state machine)
            if run.state == RunState.EXECUTING.value:
                logger.warning("Cooperative cancel requested while run '%s' is EXECUTING; deferring to stage completion", run.id)
                return False

            ctrl_req.is_acknowledged = True
            ctrl_req.acknowledged_at = _utc_now()

            run = self.orchestration_service.transition_run_state(
                workspace_id=run.workspace_id,
                run_id=run.id,
                target_state=RunState.CANCELLED,
                db=db,
                reason=f"Cooperative cancellation acknowledged: {ctrl_req.reason}",
            )
            self.observability.record_event(
                db,
                run.workspace_id,
                OrchestrationEventType.RUN_CANCELLED,
                site_id=run.site_id,
                run_id=run.id,
                severity=AlertSeverity.INFO,
                details={"reason": ctrl_req.reason},
            )
            return True

        if sig_type == ControlSignalType.PAUSE.value:
            ctrl_req.is_acknowledged = True
            ctrl_req.acknowledged_at = _utc_now()

            # Save checkpoint before pausing
            self.checkpoint_manager.save_checkpoint(
                db=db,
                run_id=run.id,
                workspace_id=run.workspace_id,
                site_id=run.site_id,
                stage_name=run.state,
                checkpoint_type=CheckpointType.PAUSE_REQUEST,
                state_payload={"paused_at_state": run.state},
            )

            run = self.orchestration_service.transition_run_state(
                workspace_id=run.workspace_id,
                run_id=run.id,
                target_state=RunState.PAUSED,
                db=db,
                reason=f"Cooperative pause acknowledged: {ctrl_req.reason}",
            )
            self.observability.record_event(
                db,
                run.workspace_id,
                OrchestrationEventType.RUN_PAUSED,
                site_id=run.site_id,
                run_id=run.id,
                severity=AlertSeverity.INFO,
                details={"reason": ctrl_req.reason},
            )
            return True

        return False

    def _find_or_create_stage(self, db: Session, run: OrchestrationRun, stage_name: str) -> OrchestrationStage:
        """Finds an existing stage in the run plan or creates it dynamically."""
        stage = (
            db.query(OrchestrationStage)
            .filter(
                OrchestrationStage.run_id == run.id,
                OrchestrationStage.stage_name == stage_name,
            )
            .first()
        )
        if stage:
            return stage

        # Match and rename unstarted blueprint stage from initial run materialization
        phase_order = {
            "SCANNING": 0,
            "ANALYZING": 1,
            "OBSERVING": 2,
            "PLANNING": 3,
            "EXECUTING": 4,
            "VERIFYING": 5,
            "MONITORING": 6,
        }
        order_idx = phase_order.get(stage_name)
        if order_idx is not None:
            unstarted = (
                db.query(OrchestrationStage)
                .filter(
                    OrchestrationStage.run_id == run.id,
                    OrchestrationStage.execution_order == order_idx,
                    OrchestrationStage.state == StageState.QUEUED.value,
                )
                .first()
            )
            if not unstarted:
                # Check 1-indexed order
                unstarted = (
                    db.query(OrchestrationStage)
                    .filter(
                        OrchestrationStage.run_id == run.id,
                        OrchestrationStage.execution_order == (order_idx + 1),
                        OrchestrationStage.state == StageState.QUEUED.value,
                    )
                    .first()
                )
            if unstarted:
                unstarted.stage_name = stage_name
                unstarted.idempotency_key = f"{run.id}:{stage_name}"
                db.commit()
                db.refresh(unstarted)
                return unstarted

        # Create dynamically if plan didn't have this stage slot
        now = _utc_now()
        new_stage = OrchestrationStage(
            id=f"stg_{uuid4().hex[:16]}",
            run_id=run.id,
            workspace_id=run.workspace_id,
            site_id=run.site_id,
            stage_name=stage_name,
            state=StageState.QUEUED.value,
            execution_order=len(run.stages) + 1,
            dependencies=[],
            idempotency_key=f"{run.id}:{stage_name}",
            attempt_count=0,
            max_attempts=3,
            queued_at=now,
        )
        db.add(new_stage)
        db.commit()
        db.refresh(new_stage)
        return new_stage
