"""
Production Orchestration & Monitoring - E2E Integration Test Suite.

Re-exports all 17 end-to-end contract scenarios from test_orchestration_e2e_contract.py.
"""

from __future__ import annotations

try:
    from backend.tests.test_orchestration_e2e_contract import (
        db_session,
        client,
        orchestrator,
        test_scenario_a_successful_complete_run,
        test_scenario_b_idempotent_duplicate_run_request,
        test_scenario_c_transient_failure_retry_success,
        test_scenario_d_non_retryable_failure_immediate_failed,
        test_scenario_e_worker_crash_recovery_from_checkpoint,
        test_scenario_f_queued_run_cancellation,
        test_scenario_g_active_run_cooperative_cancellation,
        test_scenario_h_pause_and_resume_at_checkpoint,
        test_scenario_i_safety_gate_blocks_manual_review_fix,
        test_scenario_j_approved_fix_execution_receipt_verification,
        test_scenario_k_validation_failure_yields_partial_outcome,
        test_scenario_l_stale_evidence_refresh,
        test_scenario_m_provider_outage_safe_degradation,
        test_scenario_n_multi_tenant_isolation_enforcement,
        test_scenario_o_duplicate_scheduler_event_deduplication,
        test_scenario_p_observability_and_secret_scrubbing,
        test_scenario_q_run_result_endpoint_contract,
    )
except ImportError:
    from test_orchestration_e2e_contract import (
        db_session,
        client,
        orchestrator,
        test_scenario_a_successful_complete_run,
        test_scenario_b_idempotent_duplicate_run_request,
        test_scenario_c_transient_failure_retry_success,
        test_scenario_d_non_retryable_failure_immediate_failed,
        test_scenario_e_worker_crash_recovery_from_checkpoint,
        test_scenario_f_queued_run_cancellation,
        test_scenario_g_active_run_cooperative_cancellation,
        test_scenario_h_pause_and_resume_at_checkpoint,
        test_scenario_i_safety_gate_blocks_manual_review_fix,
        test_scenario_j_approved_fix_execution_receipt_verification,
        test_scenario_k_validation_failure_yields_partial_outcome,
        test_scenario_l_stale_evidence_refresh,
        test_scenario_m_provider_outage_safe_degradation,
        test_scenario_n_multi_tenant_isolation_enforcement,
        test_scenario_o_duplicate_scheduler_event_deduplication,
        test_scenario_p_observability_and_secret_scrubbing,
        test_scenario_q_run_result_endpoint_contract,
    )

__all__ = [
    "db_session",
    "client",
    "orchestrator",
    "test_scenario_a_successful_complete_run",
    "test_scenario_b_idempotent_duplicate_run_request",
    "test_scenario_c_transient_failure_retry_success",
    "test_scenario_d_non_retryable_failure_immediate_failed",
    "test_scenario_e_worker_crash_recovery_from_checkpoint",
    "test_scenario_f_queued_run_cancellation",
    "test_scenario_g_active_run_cooperative_cancellation",
    "test_scenario_h_pause_and_resume_at_checkpoint",
    "test_scenario_i_safety_gate_blocks_manual_review_fix",
    "test_scenario_j_approved_fix_execution_receipt_verification",
    "test_scenario_k_validation_failure_yields_partial_outcome",
    "test_scenario_l_stale_evidence_refresh",
    "test_scenario_m_provider_outage_safe_degradation",
    "test_scenario_n_multi_tenant_isolation_enforcement",
    "test_scenario_o_duplicate_scheduler_event_deduplication",
    "test_scenario_p_observability_and_secret_scrubbing",
    "test_scenario_q_run_result_endpoint_contract",
]
