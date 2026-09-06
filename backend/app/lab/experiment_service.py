"""
Experiment Service & Deterministic Decision Engine (Task 12 Step 5).

Coordinates the end-to-end experiment lifecycle:
Pre-Flight Readiness -> Concurrency Locking -> Pipeline Harness -> Closed-Loop Measurement -> Hypothesis Evaluation -> Metrics -> Decision
"""

from __future__ import annotations

import logging
import threading
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urljoin

from connectors.reliability.lock import ConcurrencyConflictError, ResourceLockManager

from .delta import FindingDeltaReport, ScoreDeltaReport
from .impact_model import ChangeType
from .measurement import ClosedLoopMeasurementReport
from .experiment import (
    Experiment,
    ExperimentDecision,
    ExperimentStatus,
    ExperimentType,
    Hypothesis,
    HypothesisResult,
    ObservationConfidence,
)
from .experiment_metrics import (
    ExperimentMetricsSummary,
    ExperimentResult,
    calculate_experiment_metrics,
)
from .failure_recovery import (
    FailureClassification,
    FailureIncident,
    FailureRecoveryManager,
    FailureStage,
    RecoveryResult,
)
from .harness import PipelineHarness, PipelineRunConfig
from .production_readiness import ProductionReadinessGuard, ProductionReadinessReport
from .regression import RegressionDecision, RegressionGuardReport
from .trace import PipelineStage, StageStatus, get_trace_registry
from .verifier import FixVerificationResult, VerificationOutcome

logger = logging.getLogger(__name__)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


class ExperimentEngine:
    """
    Deterministic rule engine evaluating experiment hypotheses and outcomes against observed evidence.
    """

    @classmethod
    def evaluate_hypothesis(
        cls,
        hypothesis: Hypothesis,
        measurement_report: ClosedLoopMeasurementReport | None,
    ) -> tuple[HypothesisResult, str]:
        """
        Evaluates whether an empirical hypothesis was confirmed by closed-loop measurements.
        """
        if not measurement_report:
            return HypothesisResult.INCONCLUSIVE, "No measurement report available for evaluation."

        # Check for blocking regressions
        reg_rep = measurement_report.regression_report
        if reg_rep and reg_rep.has_blocking_regressions:
            return HypothesisResult.NOT_CONFIRMED, "Blocking regressions detected in regression guard report."

        # Check targeted finding resolutions
        target_ids = hypothesis.target_finding_ids
        target_rules = hypothesis.target_rule_ids

        v_summary = getattr(measurement_report, "verification_summary", None)
        if v_summary:
            results = v_summary.get("results", [])
            for r in results:
                f_id = getattr(r, "finding_id", "")
                r_id = getattr(r, "rule_id", "")
                outcome = getattr(r, "outcome", None)
                is_ver = getattr(r, "is_resolved", getattr(r, "is_verified", False))
                if (f_id in target_ids or r_id in target_rules) and not is_ver:
                    return HypothesisResult.NOT_CONFIRMED, f"Target finding '{f_id or r_id}' was not verified (outcome: {outcome})."
        else:
            v_results = getattr(measurement_report, "verification_results", [])
            for r in v_results:
                f_id = getattr(r, "finding_id", "")
                r_id = getattr(r, "rule_id", "")
                outcome = getattr(r, "outcome", None)
                is_ver = getattr(r, "is_resolved", getattr(r, "is_verified", False))
                if (f_id in target_ids or r_id in target_rules) and not is_ver:
                    return HypothesisResult.NOT_CONFIRMED, f"Target finding '{f_id or r_id}' was not verified (outcome: {outcome})."

        # Check score delta expectations
        s_delta = 0.0
        if getattr(measurement_report, "score_delta", None):
            s_delta = measurement_report.score_delta.overall_delta
        elif getattr(measurement_report, "score_delta_report", None):
            s_delta = getattr(measurement_report.score_delta_report, "overall_delta", getattr(measurement_report.score_delta_report, "overall_score_delta", 0.0))

        if hypothesis.expected_score_min_delta > 0 and s_delta < hypothesis.expected_score_min_delta:
            return HypothesisResult.NOT_CONFIRMED, f"Score delta {s_delta:+.1f} fell short of expected +{hypothesis.expected_score_min_delta}."

        if hypothesis.max_allowed_regression_delta < 0 and s_delta < hypothesis.max_allowed_regression_delta:
            return HypothesisResult.NOT_CONFIRMED, f"Score delta {s_delta:+.1f} exceeded maximum allowed drop {hypothesis.max_allowed_regression_delta}."

        return HypothesisResult.CONFIRMED, f"All targeted findings resolved with zero blocking regressions. Score delta {s_delta:+.1f}."

    @classmethod
    def evaluate_decision(
        cls,
        hyp_result: HypothesisResult,
        has_blocking_regressions: bool = False,
        all_targets_verified: bool = True,
        score_delta: float = 0.0,
        has_ambiguous_mutations: bool = False,
    ) -> tuple[ExperimentDecision, str]:
        """
        Determines the safe operational decision based on hypothesis test and safety signals.
        """
        if has_ambiguous_mutations:
            return ExperimentDecision.ROLLBACK, "Ambiguous mutation state detected. Rollback triggered to ensure consistency."

        if has_blocking_regressions:
            return ExperimentDecision.ROLLBACK, "Blocking regression detected. Rollback triggered to protect site integrity."

        if hyp_result == HypothesisResult.CONFIRMED and all_targets_verified and score_delta >= 0.0:
            return ExperimentDecision.KEEP, "Hypothesis confirmed and fix verified without regressions."

        if hyp_result == HypothesisResult.NOT_CONFIRMED or not all_targets_verified:
            return ExperimentDecision.REVIEW, "Manual review required: targeted findings not fully resolved or hypothesis not confirmed."

        if hyp_result == HypothesisResult.INCONCLUSIVE:
            return ExperimentDecision.REVIEW, "Manual review required: inconclusive evidence post-apply."

        return ExperimentDecision.NO_CHANGE, "No change performed."

    @classmethod
    def evaluate_experiment_outcome(
        cls,
        experiment: Experiment,
        measurement_reports: list[ClosedLoopMeasurementReport] | None,
        incident: FailureIncident | None = None,
    ) -> tuple[ExperimentStatus, ExperimentDecision, HypothesisResult]:
        """
        Computes deterministic (ExperimentStatus, ExperimentDecision, HypothesisResult) tuple.
        """
        # 1. Check for blocking incidents
        if incident:
            if incident.classification in (FailureClassification.SECURITY_BLOCK, FailureClassification.SECURITY_VIOLATION):
                return ExperimentStatus.INVALID, ExperimentDecision.NO_CHANGE, HypothesisResult.INVALID
            if incident.stage == FailureStage.RESCAN:
                return ExperimentStatus.INCONCLUSIVE, ExperimentDecision.REVIEW, HypothesisResult.INCONCLUSIVE
            return ExperimentStatus.FAILED, ExperimentDecision.REVIEW, HypothesisResult.NOT_CONFIRMED

        # 2. Check for missing measurement reports
        if isinstance(measurement_reports, ClosedLoopMeasurementReport):
            reports: list[ClosedLoopMeasurementReport] = [measurement_reports]
        elif isinstance(measurement_reports, list):
            reports = measurement_reports
        else:
            reports = []

        if not reports:
            return ExperimentStatus.INCONCLUSIVE, ExperimentDecision.REVIEW, HypothesisResult.INCONCLUSIVE

        # Find report relevant to target resource
        target_report: ClosedLoopMeasurementReport | None = None
        for rep in reports:
            r_url = getattr(rep, "resource_url", getattr(rep, "site_url", ""))
            if experiment.target_resource in r_url or r_url.endswith(experiment.target_resource.lstrip("/")):
                target_report = rep
                break
        if not target_report:
            target_report = reports[0]

        # 3. Check for Regression Guard ROLLBACK
        final_dec = getattr(target_report, "final_decision", None)
        if final_dec == RegressionDecision.ROLLBACK:
            return ExperimentStatus.FAILED, ExperimentDecision.ROLLBACK, HypothesisResult.NOT_CONFIRMED

        # 4. Check for Regression Guard REVIEW
        if final_dec == RegressionDecision.REVIEW:
            return ExperimentStatus.INCONCLUSIVE, ExperimentDecision.REVIEW, HypothesisResult.INCONCLUSIVE

        # 5. Evaluate Hypothesis
        hyp_res, _ = cls.evaluate_hypothesis(experiment.hypothesis, target_report)

        has_blocking = False
        if target_report.regression_report:
            has_blocking = getattr(target_report.regression_report, "has_blocking_regressions", False)

        all_ver = getattr(target_report, "overall_verified", True)
        s_delta = 0.0
        if getattr(target_report, "score_delta", None):
            s_delta = getattr(target_report.score_delta, "overall_delta", getattr(target_report.score_delta, "overall_score_delta", 0.0))
        elif getattr(target_report, "score_delta_report", None):
            s_delta = getattr(target_report.score_delta_report, "overall_delta", getattr(target_report.score_delta_report, "overall_score_delta", 0.0))

        dec, _ = cls.evaluate_decision(
            hyp_result=hyp_res,
            has_blocking_regressions=has_blocking,
            all_targets_verified=all_ver,
            score_delta=s_delta,
        )

        status = ExperimentStatus.SUCCEEDED if dec == ExperimentDecision.KEEP else (
            ExperimentStatus.FAILED if dec == ExperimentDecision.ROLLBACK else ExperimentStatus.INCONCLUSIVE
        )

        return status, dec, hyp_res


class ExperimentService:
    """
    Thread-safe orchestrator managing experiment registration, pre-flight checks,
    execution, metrics calculation, and results caching.
    """

    _lock = threading.RLock()
    _lock_manager = ResourceLockManager()
    _experiments: dict[str, Experiment] = {}
    _results: dict[str, ExperimentResult] = {}
    _run_cache: dict[str, ExperimentResult] = {}
    _experiment_cache: dict[str, ExperimentResult] = {}
    _active_experiments: dict[str, Experiment] = {}

    @classmethod
    def reset_state(cls) -> None:
        """Resets all in-memory registries (useful for testing)."""
        with cls._lock:
            cls._experiments.clear()
            cls._results.clear()
            cls._run_cache.clear()
            cls._experiment_cache.clear()
            cls._active_experiments.clear()

    @classmethod
    def create_experiment(
        cls,
        workspace_id: str,
        site_id: str,
        name: str,
        description: str = "",
        experiment_type: ExperimentType = ExperimentType.CONTROLLED_LAB,
        target_resource: str = "/",
        hypothesis: Hypothesis | None = None,
        tags: list[str] | None = None,
        change_type: ChangeType = ChangeType.PAGE_METADATA,
    ) -> Experiment:
        """
        Creates, validates, and registers a new optimization Experiment contract.
        """
        with cls._lock:
            hyp = hypothesis or Hypothesis(description="Default empirical hypothesis", target_resource=target_resource)
            exp = Experiment(
                workspace_id=workspace_id,
                site_id=site_id,
                name=name,
                description=description,
                experiment_type=experiment_type,
                target_resource=target_resource,
                hypothesis=hyp,
                tags=tags or [],
                change_type=change_type,
            )
            cls._experiments[exp.experiment_id] = exp
            return exp

    @classmethod
    def get_experiment(cls, experiment_id: str) -> Experiment | None:
        """Retrieves a registered Experiment by ID."""
        with cls._lock:
            return cls._experiments.get(experiment_id)

    @classmethod
    def get_experiment_result(cls, experiment_id: str) -> ExperimentResult | None:
        """Retrieves results of an executed experiment."""
        with cls._lock:
            return cls._results.get(experiment_id)

    @classmethod
    def run_experiment(
        cls,
        experiment: Experiment | str | None = None,
        run_config: PipelineRunConfig | None = None,
        fixture: Any | None = None,
        dry_run: bool = True,
        allow_mutations: bool = False,
        authenticated: bool = True,
        experiment_id: str | None = None,
    ) -> ExperimentResult:
        """
        Executes a complete closed-loop experiment session.
        """
        start_time = _utc_now()

        exp_target = experiment or experiment_id
        if not exp_target:
            raise ValueError("Must provide either 'experiment' or 'experiment_id'.")

        # Resolve Experiment instance
        exp_obj: Experiment
        if isinstance(exp_target, str):
            with cls._lock:
                found = cls._experiments.get(exp_target)
                if not found:
                    raise ValueError(f"Experiment '{exp_target}' not found.")
                exp_obj = found
        else:
            exp_obj = exp_target
            with cls._lock:
                cls._experiments[exp_obj.experiment_id] = exp_obj

        workspace_id = exp_obj.workspace_id or (run_config.workspace_id if run_config else "default_ws")
        site_id = exp_obj.site_id or "default_site"
        res_key = exp_obj.target_resource
        site_url = run_config.site_url if run_config else exp_obj.site_url
        is_dry_run = run_config.dry_run if run_config else dry_run

        idempotency_key = (
            exp_obj.idempotency_key
            or f"exp_{workspace_id}_{site_id}_{res_key}_{exp_obj.change_type.value if hasattr(exp_obj.change_type, 'value') else exp_obj.change_type}"
        )

        with cls._lock:
            # 1. Idempotency Cache Check
            if idempotency_key in cls._run_cache:
                logger.info("Serving experiment '%s' from run cache.", exp_obj.experiment_id)
                return cls._run_cache[idempotency_key]

            # 2. Resource Lock Acquisition
            lock_key = ResourceLockManager.build_lock_key(
                workspace_id=workspace_id,
                site_id=site_id,
                connector="lab_harness",
                resource_id=res_key,
            )
            acquired = cls._lock_manager.acquire(lock_key, owner_id=exp_obj.experiment_id, ttl_seconds=60.0)
            if not acquired:
                # Active concurrent execution detected!
                incident = FailureIncident(
                    execution_id=exp_obj.execution_id,
                    stage=FailureStage.APPLY,
                    classification=FailureClassification.AMBIGUOUS_MUTATION,
                    error_message=f"Resource '{res_key}' is actively locked by concurrent experiment",
                )
                rec_res = FailureRecoveryManager.evaluate_incident(incident)
                metrics = calculate_experiment_metrics(failure_count=1)
                result = ExperimentResult(
                    experiment_id=exp_obj.experiment_id,
                    execution_id=exp_obj.execution_id,
                    status=ExperimentStatus.FAILED,
                    decision=ExperimentDecision.REVIEW,
                    hypothesis_result=HypothesisResult.NOT_CONFIRMED,
                    metrics=metrics,
                    failure_summary={"incident_id": incident.incident_id, "error": incident.error_message},
                    recovery_summary={"recovery_id": rec_res.recovery_id, "action": rec_res.action_taken},
                )
                cls._results[exp_obj.experiment_id] = result
                return result

            cls._active_experiments[exp_obj.experiment_id] = exp_obj

        try:
            # 3. Pre-Flight Production Readiness Guard
            readiness = ProductionReadinessGuard.evaluate(
                workspace_id=workspace_id,
                target_url=site_url,
                resource_id=res_key,
                is_dry_run=is_dry_run,
                authenticated=authenticated,
            )

            if not readiness.is_ready:
                incident = FailureIncident(
                    execution_id=exp_obj.execution_id,
                    stage=FailureStage.SECURITY if any("SEC" in f for f in readiness.blocking_failures) else FailureStage.WORKSPACE,
                    classification=FailureClassification.SECURITY_BLOCK,
                    error_message=f"Pre-flight production readiness failed: {', '.join(readiness.blocking_failures)}",
                )
                rec_res = FailureRecoveryManager.evaluate_incident(incident)
                metrics = calculate_experiment_metrics(failure_count=1)

                result = ExperimentResult(
                    experiment_id=exp_obj.experiment_id,
                    execution_id=exp_obj.execution_id,
                    status=rec_res.experiment_status,
                    decision=rec_res.experiment_decision,
                    hypothesis_result=HypothesisResult.INVALID,
                    metrics=metrics,
                    readiness_report=readiness,
                    failure_summary={"blocking_failures": readiness.blocking_failures},
                    recovery_summary={"recovery_id": rec_res.recovery_id, "action": rec_res.action_taken},
                )
                with cls._lock:
                    cls._run_cache[idempotency_key] = result
                    cls._results[exp_obj.experiment_id] = result
                return result

            # 4. Pipeline Execution via PipelineHarness
            harness = PipelineHarness()
            cfg = run_config or PipelineRunConfig(
                execution_id=exp_obj.execution_id,
                workspace_id=workspace_id,
                site_url=site_url,
                fixture=fixture,
                dry_run=is_dry_run,
                allow_mutations=allow_mutations,
                metadata={"site_id": site_id, "experiment_id": exp_obj.experiment_id},
            )

            trace = harness.run(cfg)

            # Check for pipeline-level stage failures
            incident = None
            if trace.overall_status != StageStatus.SUCCEEDED and getattr(trace.overall_status, "value", "") != "SUCCEEDED":
                failing_stage = PipelineStage.DISCOVERY
                err_msg = "Pipeline stage failed"
                for st in trace.stages:
                    if st.status == StageStatus.FAILED:
                        failing_stage = getattr(st, "stage_name", getattr(st, "stage", PipelineStage.DISCOVERY))
                        err_msg = st.error_message or err_msg
                        break

                fail_st_map = {
                    PipelineStage.DISCOVERY: FailureStage.DISCOVERY,
                    PipelineStage.CRAWL_RENDER: FailureStage.CRAWL,
                    PipelineStage.EXTRACTION: FailureStage.EXTRACTION,
                    PipelineStage.INTELLIGENCE: FailureStage.INTELLIGENCE,
                    PipelineStage.SCORE: FailureStage.SCORE,
                    PipelineStage.FINDING: FailureStage.FINDING,
                    PipelineStage.FIX_PLAN: FailureStage.FIX_PLAN,
                    PipelineStage.CONNECTOR: FailureStage.CONNECTOR,
                    PipelineStage.SAFETY: FailureStage.SAFETY,
                    PipelineStage.APPLY: FailureStage.APPLY,
                    PipelineStage.VALIDATE: FailureStage.VALIDATE,
                    PipelineStage.RESCAN: FailureStage.RESCAN,
                    PipelineStage.COMPARE: FailureStage.COMPARE,
                }
                incident = FailureIncident(
                    execution_id=exp_obj.execution_id,
                    stage=fail_st_map.get(failing_stage, FailureStage.DISCOVERY),
                    classification=FailureClassification.PERMANENT_UNRECOVERABLE,
                    error_message=err_msg,
                )

            # 5. Extract Closed-Loop Reports & Telemetry
            measurement_reports = getattr(harness.context, "measurement_reports", [])
            target_report = measurement_reports[0] if measurement_reports else None

            # 6. Evaluate Experiment Outcome
            status, decision, hyp_result = ExperimentEngine.evaluate_experiment_outcome(
                experiment=exp_obj,
                measurement_reports=measurement_reports,
                incident=incident,
            )

            # 7. Compute Metrics
            apply_trace = trace.get_stage_trace(PipelineStage.APPLY)
            val_trace = trace.get_stage_trace(PipelineStage.VALIDATE)
            rescan_trace = trace.get_stage_trace(PipelineStage.RESCAN)

            exec_dur = apply_trace.duration_ms or 0.0 if apply_trace else 0.0
            val_dur = val_trace.duration_ms or 0.0 if val_trace else 0.0
            rescan_dur = rescan_trace.duration_ms or 0.0 if rescan_trace else 0.0
            total_dur = trace.duration_ms or ((_utc_now() - start_time).total_seconds() * 1000.0)

            metrics = calculate_experiment_metrics(
                report=target_report,
                execution_duration_ms=exec_dur,
                validation_duration_ms=val_dur,
                rescan_duration_ms=rescan_dur,
                total_duration_ms=total_dur,
                failure_count=1 if incident else 0,
                rollback_count=1 if decision == ExperimentDecision.ROLLBACK else 0,
            )

            # 8. Construct Final ExperimentResult
            exp_obj.status = status
            exp_obj.decision = decision
            exp_obj.completed_at = _utc_now()

            provenance = [
                {"event": "experiment_created", "experiment_id": exp_obj.experiment_id, "timestamp": exp_obj.created_at.isoformat()},
                {"event": "readiness_checked", "is_ready": readiness.is_ready, "report_id": readiness.report_id},
                {"event": "trace_completed", "execution_id": trace.execution_id, "duration_ms": trace.duration_ms},
                {"event": "decision_evaluated", "status": status.value, "decision": decision.value, "hypothesis_result": hyp_result.value},
            ]

            result = ExperimentResult(
                experiment_id=exp_obj.experiment_id,
                execution_id=exp_obj.execution_id,
                status=status,
                decision=decision,
                hypothesis_result=hyp_result,
                metrics=metrics,
                readiness_report=readiness,
                effectiveness_results=getattr(target_report, "verification_results", []) if target_report else [],
                regression_report=getattr(target_report, "regression_report", None) if target_report else None,
                score_delta=getattr(target_report, "score_delta", None) if target_report else None,
                finding_delta=getattr(target_report, "finding_delta", None) if target_report else None,
                failure_summary={"incident_id": incident.incident_id, "stage": incident.stage.value, "error": incident.error_message} if incident else None,
                recovery_summary={"recovery_status": "NONE_NEEDED" if not incident else "HANDLED"},
                provenance_chain=provenance,
                created_at=exp_obj.created_at,
                completed_at=_utc_now(),
            )

            with cls._lock:
                cls._run_cache[idempotency_key] = result
                cls._results[exp_obj.experiment_id] = result
                cls._active_experiments.pop(exp_obj.experiment_id, None)

            return result

        finally:
            # Release resource lock
            cls._lock_manager.release(lock_key, owner_id=exp_obj.experiment_id)

