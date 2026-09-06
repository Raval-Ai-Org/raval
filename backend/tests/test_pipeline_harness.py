"""
Comprehensive Test Suite for Task 12 Step 2: End-to-End Pipeline Harness & Execution Trace.

Verifies:
1. Happy path: All 13 stages execute in strict order and succeed.
2. Stage failure: Forced stage failure properly marks failing stage FAILED, dependent stages BLOCKED, and overall status FAILED.
3. Strict stage sequence (1 to 13).
4. Trace completeness: Valid stage execution IDs, timestamps, durations, inputs/outputs.
5. Unique IDs: Unique execution IDs and stage IDs across runs.
6. Repeated execution & idempotency: Multi-run isolation without state corruption.
7. Safe APPLY behavior: Dry-run default prevents mutations without approved test context.
8. Secret redaction: Sensitive tokens/keys are redacted in trace error messages.
9. Controlled Site Lab fixture integration: Harness runs against Static, SSR, Dynamic, and WordPress fixtures.
10. TraceRegistry persistence and lookup.
"""

import pytest
from datetime import datetime

from app.lab import (
    ORDERED_STAGES,
    STAGE_SEQUENCE_ORDER,
    ExecutionTrace,
    PipelineExecutionStatus,
    PipelineHarness,
    PipelineRunConfig,
    PipelineStage,
    StageStatus,
    StageTrace,
    build_dynamic_site_fixture,
    build_server_rendered_fixture,
    build_static_site_fixture,
    build_wordpress_fixture,
    get_trace_registry,
)


# ==============================================================================
# 1. HAPPY PATH & ORDERING TESTS
# ==============================================================================

class TestPipelineHarnessHappyPath:
    """Tests happy-path orchestration across all 13 stages."""

    @pytest.fixture(autouse=True)
    def setup(self):
        self.harness = PipelineHarness()
        self.registry = get_trace_registry()
        self.registry.clear()

    def test_1_full_pipeline_happy_path_all_13_stages(self):
        static_fix = build_static_site_fixture()
        config = PipelineRunConfig(
            site_url=static_fix.base_url,
            fixture=static_fix,
            dry_run=True,
        )

        trace = self.harness.run(config)

        # 1. Top-level assertions
        assert trace.execution_id.startswith("exec_")
        assert trace.overall_status == PipelineExecutionStatus.SUCCEEDED
        assert trace.started_at is not None
        assert trace.completed_at is not None
        assert trace.duration_ms is not None
        assert trace.duration_ms >= 0.0
        assert len(trace.stages) == 13

        # 2. Per-stage sequence and status verification
        for idx, stage_name in enumerate(ORDERED_STAGES, start=1):
            st = trace.stages[idx - 1]
            assert st.stage_name == stage_name
            assert st.sequence == idx
            assert st.status == StageStatus.SUCCEEDED
            assert st.execution_id == trace.execution_id
            assert st.stage_execution_id.startswith(f"stage_{stage_name.value.lower()}_")
            assert st.started_at is not None
            assert st.completed_at is not None
            assert st.duration_ms is not None and st.duration_ms >= 0.0
            assert isinstance(st.input_ref, dict)
            assert isinstance(st.output_ref, dict)

        # 3. Verify registry persistence
        stored = self.registry.get_trace(trace.execution_id)
        assert stored is not None
        assert stored.execution_id == trace.execution_id

    def test_2_strict_stage_sequence_order(self):
        expected_order = [
            PipelineStage.DISCOVERY,
            PipelineStage.CRAWL_RENDER,
            PipelineStage.EXTRACTION,
            PipelineStage.INTELLIGENCE,
            PipelineStage.SCORE,
            PipelineStage.FINDING,
            PipelineStage.FIX_PLAN,
            PipelineStage.CONNECTOR,
            PipelineStage.SAFETY,
            PipelineStage.APPLY,
            PipelineStage.VALIDATE,
            PipelineStage.RESCAN,
            PipelineStage.COMPARE,
        ]
        assert ORDERED_STAGES == expected_order
        for idx, st_name in enumerate(expected_order, start=1):
            assert STAGE_SEQUENCE_ORDER[st_name] == idx


# ==============================================================================
# 2. STAGE FAILURE & DOWNSTREAM BLOCKING TESTS
# ==============================================================================

class TestPipelineFailurePropagation:
    """Tests deterministic failure handling and downstream stage blocking."""

    @pytest.fixture(autouse=True)
    def setup(self):
        self.harness = PipelineHarness()

    def test_crawl_failure_blocks_downstream_stages(self):
        def failing_crawl(ctx, st):
            raise ConnectionError("DNS resolution failed for host")

        config = PipelineRunConfig(
            site_url="https://invalid-host.lab.local",
            custom_stage_handlers={PipelineStage.CRAWL_RENDER: failing_crawl},
            stop_on_first_failure=True,
        )

        trace = self.harness.run(config)

        assert trace.overall_status == PipelineExecutionStatus.FAILED
        assert "CRAWL_RENDER" in (trace.error_summary or "")

        discovery_st = trace.get_stage_trace(PipelineStage.DISCOVERY)
        crawl_st = trace.get_stage_trace(PipelineStage.CRAWL_RENDER)
        extraction_st = trace.get_stage_trace(PipelineStage.EXTRACTION)
        compare_st = trace.get_stage_trace(PipelineStage.COMPARE)

        assert discovery_st is not None and discovery_st.status == StageStatus.SUCCEEDED
        assert crawl_st is not None and crawl_st.status == StageStatus.FAILED
        assert crawl_st.error_code == "ConnectionError"
        assert "DNS resolution failed" in (crawl_st.error_message or "")

        # Downstream stages must be BLOCKED
        assert extraction_st is not None and extraction_st.status == StageStatus.BLOCKED
        assert extraction_st.blocked_by_stage == "CRAWL_RENDER"

        assert compare_st is not None and compare_st.status == StageStatus.BLOCKED
        assert compare_st.blocked_by_stage == "CRAWL_RENDER"

    def test_validation_failure_blocks_compare(self):
        def failing_validation(ctx, st):
            raise AssertionError("Pre-rescan validation check failed: syntax error detected")

        config = PipelineRunConfig(
            fixture=build_static_site_fixture(),
            custom_stage_handlers={PipelineStage.VALIDATE: failing_validation},
            stop_on_first_failure=True,
        )

        trace = self.harness.run(config)

        assert trace.overall_status == PipelineExecutionStatus.FAILED

        val_st = trace.get_stage_trace(PipelineStage.VALIDATE)
        compare_st = trace.get_stage_trace(PipelineStage.COMPARE)

        assert val_st is not None and val_st.status == StageStatus.FAILED
        assert compare_st is not None and compare_st.status == StageStatus.BLOCKED
        assert compare_st.blocked_by_stage == "VALIDATE"


# ==============================================================================
# 3. UNIQUE IDS & IDEMPOTENCY TESTS
# ==============================================================================

class TestUniqueIDsAndIdempotency:
    """Verifies ID isolation and idempotency across repeated runs."""

    @pytest.fixture(autouse=True)
    def setup(self):
        self.harness = PipelineHarness()
        self.registry = get_trace_registry()
        self.registry.clear()

    def test_unique_execution_and_stage_ids(self):
        fixture = build_static_site_fixture()
        trace_1 = self.harness.run(PipelineRunConfig(fixture=fixture))
        trace_2 = self.harness.run(PipelineRunConfig(fixture=fixture))

        assert trace_1.execution_id != trace_2.execution_id

        # Verify all stage IDs are unique
        stage_ids_1 = {s.stage_execution_id for s in trace_1.stages}
        stage_ids_2 = {s.stage_execution_id for s in trace_2.stages}

        assert len(stage_ids_1) == 13
        assert len(stage_ids_2) == 13
        assert stage_ids_1.isdisjoint(stage_ids_2)

    def test_repeated_execution_idempotency(self):
        fixture = build_static_site_fixture()
        traces = [
            self.harness.run(PipelineRunConfig(fixture=fixture))
            for _ in range(3)
        ]

        assert len(self.registry.list_traces()) == 3
        for t in traces:
            assert t.overall_status == PipelineExecutionStatus.SUCCEEDED
            assert len(t.stages) == 13


# ==============================================================================
# 4. SAFE APPLY BEHAVIOR & SECURITY REDACTION TESTS
# ==============================================================================

class TestSafeApplyAndRedaction:
    """Verifies safe mutation defaults and secret redaction."""

    @pytest.fixture(autouse=True)
    def setup(self):
        self.harness = PipelineHarness()

    def test_dry_run_default_prevents_real_mutations(self):
        fixture = build_static_site_fixture()
        # Default dry_run=True
        trace = self.harness.run(PipelineRunConfig(fixture=fixture, dry_run=True, allow_mutations=False))

        apply_st = trace.get_stage_trace(PipelineStage.APPLY)
        assert apply_st is not None
        assert apply_st.output_ref.get("mode") == "DRY_RUN"

    def test_secret_redaction_in_trace_errors(self):
        def stage_with_secret_leak(ctx, st):
            secret_token = "ghp_1234567890abcdef1234567890abcdef1234"
            api_key = "sk-proj-9876543210secretapikeyvalue"
            raise ValueError(f"Failed to authenticate with token {secret_token} and key {api_key}")

        config = PipelineRunConfig(
            fixture=build_static_site_fixture(),
            custom_stage_handlers={PipelineStage.CONNECTOR: stage_with_secret_leak}
        )

        trace = self.harness.run(config)

        connector_st = trace.get_stage_trace(PipelineStage.CONNECTOR)
        assert connector_st is not None
        assert connector_st.status == StageStatus.FAILED
        error_msg = connector_st.error_message or ""

        # Raw secrets must be redacted
        assert "ghp_1234567890abcdef1234567890abcdef1234" not in error_msg
        assert "sk-proj-9876543210secretapikeyvalue" not in error_msg
        assert "[REDACTED]" in error_msg


# ==============================================================================
# 5. CONTROLLED SITE LAB FIXTURES INTEGRATION
# ==============================================================================

class TestControlledSiteLabIntegration:
    """Verifies harness execution across all 4 Controlled Site Lab fixtures."""

    @pytest.fixture(autouse=True)
    def setup(self):
        self.harness = PipelineHarness()

    def test_harness_with_static_fixture(self):
        fix = build_static_site_fixture()
        trace = self.harness.run(PipelineRunConfig(fixture=fix))
        assert trace.overall_status == PipelineExecutionStatus.SUCCEEDED
        assert trace.fixture_id == "static_site_01"

    def test_harness_with_server_rendered_fixture(self):
        fix = build_server_rendered_fixture()
        trace = self.harness.run(PipelineRunConfig(fixture=fix))
        assert trace.overall_status == PipelineExecutionStatus.SUCCEEDED
        assert trace.fixture_id == "server_rendered_site_01"

    def test_harness_with_dynamic_spa_fixture(self):
        fix = build_dynamic_site_fixture()
        trace = self.harness.run(PipelineRunConfig(fixture=fix))
        assert trace.overall_status == PipelineExecutionStatus.SUCCEEDED
        assert trace.fixture_id == "dynamic_browser_site_01"

    def test_harness_with_wordpress_fixture(self):
        fix = build_wordpress_fixture()
        trace = self.harness.run(PipelineRunConfig(fixture=fix))
        assert trace.overall_status == PipelineExecutionStatus.SUCCEEDED
        assert trace.fixture_id == "wordpress_site_01"


# ==============================================================================
# 6. SERIALIZATION & REGISTRY TESTS
# ==============================================================================

class TestTraceSerializationAndRegistry:
    """Verifies trace model serialization, deserialization, and registry operations."""

    @pytest.fixture(autouse=True)
    def setup(self):
        self.harness = PipelineHarness()
        self.registry = get_trace_registry()
        self.registry.clear()

    def test_trace_model_dump_and_json_roundtrip(self):
        fix = build_static_site_fixture()
        trace = self.harness.run(PipelineRunConfig(fixture=fix))

        dumped = trace.model_dump()
        assert isinstance(dumped, dict)
        assert dumped["execution_id"] == trace.execution_id
        assert len(dumped["stages"]) == 13
        assert dumped["overall_status"] == "SUCCEEDED"

        # Reconstruct model from dict
        reconstructed = ExecutionTrace.model_validate(dumped)
        assert reconstructed.execution_id == trace.execution_id
        assert reconstructed.overall_status == PipelineExecutionStatus.SUCCEEDED
        assert len(reconstructed.stages) == 13

    def test_registry_lookup_and_clearing(self):
        fix = build_static_site_fixture()
        t1 = self.harness.run(PipelineRunConfig(fixture=fix))
        t2 = self.harness.run(PipelineRunConfig(fixture=fix))

        assert self.registry.get_trace(t1.execution_id) is not None
        assert self.registry.get_trace(t2.execution_id) is not None
        assert len(self.registry.list_traces()) == 2

        self.registry.clear()
        assert len(self.registry.list_traces()) == 0
        assert self.registry.get_trace(t1.execution_id) is None


# ==============================================================================
# 7. GRANULAR FAILURE SCENARIOS
# ==============================================================================

class TestGranularFailureScenarios:
    """Tests failure injection across multiple intermediate stages."""

    @pytest.fixture(autouse=True)
    def setup(self):
        self.harness = PipelineHarness()

    def test_intelligence_failure_blocks_downstream(self):
        def failing_intel(ctx, st):
            raise RuntimeError("Signal calculation model out of memory")

        trace = self.harness.run(
            PipelineRunConfig(
                fixture=build_static_site_fixture(),
                custom_stage_handlers={PipelineStage.INTELLIGENCE: failing_intel},
                stop_on_first_failure=True,
            )
        )

        assert trace.overall_status == PipelineExecutionStatus.FAILED
        intel_st = trace.get_stage_trace(PipelineStage.INTELLIGENCE)
        score_st = trace.get_stage_trace(PipelineStage.SCORE)
        finding_st = trace.get_stage_trace(PipelineStage.FINDING)
        apply_st = trace.get_stage_trace(PipelineStage.APPLY)

        assert intel_st.status == StageStatus.FAILED
        assert score_st.status == StageStatus.BLOCKED
        assert finding_st.status == StageStatus.BLOCKED
        assert apply_st.status == StageStatus.BLOCKED
        assert score_st.blocked_by_stage == "INTELLIGENCE"

    def test_fix_plan_failure_blocks_safety_and_apply(self):
        def failing_fix_plan(ctx, st):
            raise ValueError("No valid remediation action available for finding")

        trace = self.harness.run(
            PipelineRunConfig(
                fixture=build_static_site_fixture(),
                custom_stage_handlers={PipelineStage.FIX_PLAN: failing_fix_plan},
                stop_on_first_failure=True,
            )
        )

        assert trace.overall_status == PipelineExecutionStatus.FAILED
        fix_st = trace.get_stage_trace(PipelineStage.FIX_PLAN)
        safety_st = trace.get_stage_trace(PipelineStage.SAFETY)
        apply_st = trace.get_stage_trace(PipelineStage.APPLY)

        assert fix_st.status == StageStatus.FAILED
        assert safety_st.status == StageStatus.BLOCKED
        assert apply_st.status == StageStatus.BLOCKED
        assert safety_st.blocked_by_stage == "FIX_PLAN"


# ==============================================================================
# 8. CONCURRENT PIPELINE RUNS
# ==============================================================================

class TestConcurrentPipelineRuns:
    """Tests thread-safety and trace isolation across concurrent runs."""

    def test_concurrent_executions_thread_safe(self):
        import concurrent.futures

        harness = PipelineHarness()
        registry = get_trace_registry()
        registry.clear()

        fixtures = [
            build_static_site_fixture(),
            build_server_rendered_fixture(),
            build_dynamic_site_fixture(),
            build_wordpress_fixture(),
        ]

        def run_pipeline(fix):
            return harness.run(PipelineRunConfig(fixture=fix))

        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
            traces = list(executor.map(run_pipeline, fixtures))

        assert len(traces) == 4
        assert len(registry.list_traces()) == 4

        exec_ids = {t.execution_id for t in traces}
        assert len(exec_ids) == 4

        for t in traces:
            assert t.overall_status == PipelineExecutionStatus.SUCCEEDED
            assert len(t.stages) == 13

