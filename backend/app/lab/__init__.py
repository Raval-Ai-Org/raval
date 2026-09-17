"""
Raval AI Controlled Site Lab & End-to-End Pipeline Harness Package (Task 12).

Provides realistic, deterministic test fixtures (Static, SSR, Dynamic, WordPress), local HTTP testing server,
centralized defect catalog, End-to-End Pipeline Harness with full execution tracing across 13 ordered stages,
and closed-loop measurement / fix effectiveness verification / regression guarding (Task 12 Step 3).
"""

from .catalog import (
    build_default_catalog,
    export_catalog_dict,
    export_catalog_json,
    get_all_defects,
    get_all_fixtures,
    get_defect,
    get_defects_by_category,
    get_defects_by_rule,
    get_fixture,
    get_fixtures_by_type,
    get_lab_catalog,
    load_catalog_json,
)
from .delta import (
    SCORE_DISCLAIMER,
    FindingDeltaItem,
    FindingDeltaReport,
    FindingTransitionState,
    ScoreDeltaReport,
    calculate_finding_delta,
    calculate_score_delta,
)
from .evidence import (
    EvidenceState,
    EvidenceStore,
    MeasurementSnapshot,
    ResourceObservation,
    capture_observation_from_extraction,
    get_evidence_store,
)
from .fixtures import (
    WordPressLabEnvironment,
    build_dynamic_site_fixture,
    build_server_rendered_fixture,
    build_static_site_fixture,
    build_wordpress_fixture,
)
from .harness import (
    ORDERED_STAGES,
    PipelineHarness,
    PipelineRunConfig,
)
from .impact_model import (
    ChangeImpactGraph,
    ChangeType,
    DependencyEdge,
    DependencyType,
    ImpactReason,
    ImpactedResource,
    RescanScope,
)
from .measurement import (
    ClosedLoopMeasurementReport,
    ClosedLoopMeasurementService,
)
from .models import (
    DefectCategory,
    DefectSeverity,
    ExpectedPageState,
    IntentionalDefect,
    LabCatalog,
    LabFixtureConfig,
    LabFixtureType,
)
from .regression import (
    RegressionDecision,
    RegressionFinding,
    RegressionGuard,
    RegressionGuardReport,
)
from .rescan_policy import (
    RescanPolicyEngine,
    RescanScopeDecision,
    TargetedRescanRequest,
)
from .rescan_service import (
    TargetedRescanExecutionResult,
    TargetedRescanService,
)
from .server import LabTestServer
from .stages import PipelineContext
from .trace import (
    STAGE_DEPENDENCIES,
    STAGE_SEQUENCE_ORDER,
    ExecutionTrace,
    PipelineExecutionStatus,
    PipelineStage,
    StageStatus,
    StageTrace,
    TraceRegistry,
    get_trace_registry,
)
from .verifier import (
    FixEffectivenessVerifier,
    FixVerificationResult,
    VerificationOutcome,
)
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
    EvidenceMetrics,
    ExperimentMetricsSummary,
    ExperimentResult,
    FixEffectivenessMetrics,
    OperationalMetrics,
    RegressionMetrics,
    ScoreMetrics,
    calculate_experiment_metrics,
)
from .failure_recovery import (
    FailureClassification,
    FailureIncident,
    FailureRecoveryManager,
    FailureStage,
    RecoveryResult,
)
from .production_readiness import (
    ProductionReadinessGuard,
    ProductionReadinessReport,
    ReadinessCategory,
    ReadinessCheckItem,
    ReadinessSeverity,
)
from .experiment_service import (
    ExperimentEngine,
    ExperimentService,
)

__all__ = [
    # Models & Fixtures (Step 1)
    "DefectCategory",
    "DefectSeverity",
    "IntentionalDefect",
    "ExpectedPageState",
    "LabFixtureConfig",
    "LabFixtureType",
    "LabCatalog",
    "build_static_site_fixture",
    "build_server_rendered_fixture",
    "build_dynamic_site_fixture",
    "build_wordpress_fixture",
    "WordPressLabEnvironment",
    # Catalog utilities (Step 1)
    "build_default_catalog",
    "get_lab_catalog",
    "get_fixture",
    "get_all_fixtures",
    "get_fixtures_by_type",
    "get_all_defects",
    "get_defect",
    "get_defects_by_category",
    "get_defects_by_rule",
    "export_catalog_dict",
    "export_catalog_json",
    "load_catalog_json",
    "LabTestServer",
    # Pipeline Harness & Tracing (Step 2)
    "PipelineStage",
    "StageStatus",
    "PipelineExecutionStatus",
    "StageTrace",
    "ExecutionTrace",
    "TraceRegistry",
    "get_trace_registry",
    "PipelineContext",
    "PipelineRunConfig",
    "PipelineHarness",
    "ORDERED_STAGES",
    "STAGE_SEQUENCE_ORDER",
    "STAGE_DEPENDENCIES",
    # Closed-Loop Measurement, Evidence, Verification & Regression Guard (Step 3)
    "EvidenceState",
    "ResourceObservation",
    "MeasurementSnapshot",
    "EvidenceStore",
    "get_evidence_store",
    "capture_observation_from_extraction",
    "VerificationOutcome",
    "FixVerificationResult",
    "FixEffectivenessVerifier",
    "RegressionDecision",
    "RegressionFinding",
    "RegressionGuardReport",
    "RegressionGuard",
    "ScoreDeltaReport",
    "FindingTransitionState",
    "FindingDeltaItem",
    "FindingDeltaReport",
    "calculate_score_delta",
    "calculate_finding_delta",
    "SCORE_DISCLAIMER",
    "ClosedLoopMeasurementReport",
    "ClosedLoopMeasurementService",
    # Targeted Rescan & Change-Impact Model (Step 4)
    "RescanScope",
    "ChangeType",
    "ImpactReason",
    "DependencyType",
    "DependencyEdge",
    "ImpactedResource",
    "ChangeImpactGraph",
    "TargetedRescanRequest",
    "RescanScopeDecision",
    "RescanPolicyEngine",
    "TargetedRescanExecutionResult",
    "TargetedRescanService",
    # Experiment Framework & Production Readiness (Step 5)
    "ExperimentType",
    "ExperimentStatus",
    "ExperimentDecision",
    "HypothesisResult",
    "ObservationConfidence",
    "Hypothesis",
    "Experiment",
    "FixEffectivenessMetrics",
    "RegressionMetrics",
    "ScoreMetrics",
    "EvidenceMetrics",
    "OperationalMetrics",
    "ExperimentMetricsSummary",
    "ExperimentResult",
    "calculate_experiment_metrics",
    "FailureStage",
    "FailureClassification",
    "FailureIncident",
    "RecoveryResult",
    "FailureRecoveryManager",
    "ReadinessCategory",
    "ReadinessSeverity",
    "ReadinessCheckItem",
    "ProductionReadinessReport",
    "ProductionReadinessGuard",
    "ExperimentEngine",
    "ExperimentService",
]
