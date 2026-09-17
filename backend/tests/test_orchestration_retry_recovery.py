"""
Comprehensive Integration and Unit Tests for Orchestration Retry, Failure Classification,
Execution Receipts, and Worker Crash Recovery (Step 3).

Verifies:
1. Centralized Failure Classifier across all 10 canonical failure classes, HTTP status codes,
   Retry-After parsing, non-retryable rejection, and sensitive secret scrubbing.
2. Deterministic Bounded Retry Engine with exponential backoff, max delay ceiling,
   provider Retry-After override, attempt exhaustion, and clock injection.
3. State Machine RETRY_WAIT integration: legal transition into RETRY_WAIT, resumption
   back to previous active operational state, rejection of illegal cross-state transitions,
   and exhaustion into FAILED.
4. Execution Receipts & Idempotency: pending, confirmed, failed, and ambiguous receipts.
   Ambiguous mutation safety (is_safe_to_retry = False) blocking automated retry.
   Tenant isolation across workspaces.
5. Recovery Engine handling all 4 canonical crash/lease failure cases:
   - Case 1: Crashed during non-mutating active phase (reschedule retry or fail on exhaustion).
   - Case 2: Crashed while external mutation is PENDING (mark ambiguous, block retry, flag manual review).
   - Case 3: Crashed while in RETRY_WAIT (preserve schedule, reconcile lease).
   - Case 4: Stale lease with exhausted retries (transition to terminal FAILED).
6. Concurrency capacity reclamation on crash recovery.
7. End-to-end OrchestrationWorker retry loop and RETRY_WAIT resumption.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.database import Base
from app.models import Website
from app.orchestration.concurrency import ConcurrencyController, ConcurrencyPolicy
from app.orchestration.enums import (
    FailureClass,
    OrchestrationEventType,
    ReceiptStatus,
    RecoveryActionType,
    RunState,
    RunType,
    TriggerSource,
)
from app.orchestration.exceptions import (
    AmbiguousExecutionError,
    InvalidStateTransitionError,
    ReceiptConflictError,
    SiteMismatchError,
    TerminalStateError,
)
from app.orchestration.failure_classifier import FailureClassifier, StructuredFailure
from app.orchestration.models import ExecutionReceipt, OrchestrationRun
from app.orchestration.queue import LocalOrchestrationQueue, QueueJob
from app.orchestration.receipts import ExecutionReceiptManager
from app.orchestration.recovery import RecoveryService
from app.orchestration.retry_policy import RetryDecision, RetryEngine, RetryPolicy
from app.orchestration.schemas import (
    ActorProvenance,
    OrchestrationRunCreateRequest,
)
from app.orchestration.service import OrchestrationService
from app.orchestration.state_machine import OrchestrationStateMachine
from app.orchestration.worker import OrchestrationWorker


def _utc(year: int = 2026, month: int = 9, day: int = 10, hour: int = 12, minute: int = 0) -> datetime:
    return datetime(year, month, day, hour, minute, tzinfo=timezone.utc)


@pytest.fixture
def db_session_factory():
    """Returns a factory producing isolated in-memory SQLite database sessions."""
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    SessionTesting = sessionmaker(autocommit=False, autoflush=False, bind=engine)

    # Seed initial test site
    seed_session = SessionTesting()
    site = Website(
        id=1,
        name="Acme Health Portal",
        url="https://acme-health.example.com",
        created_at=_utc(),
    )
    site2 = Website(
        id=2,
        name="Beta Labs Portal",
        url="https://beta-labs.example.com",
        created_at=_utc(),
    )
    seed_session.add_all([site, site2])
    seed_session.commit()
    seed_session.close()

    try:
        yield SessionTesting
    finally:
        engine.dispose()


@pytest.fixture
def db_session(db_session_factory) -> Session:
    session = db_session_factory()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def orchestration_service() -> OrchestrationService:
    return OrchestrationService()


# ==============================================================================
# 1. FAILURE CLASSIFICATION TESTS
# ==============================================================================

class TestFailureClassification:
    """Verifies taxonomy classification across all 10 canonical failure classes."""

    def test_classify_transient_network_errors(self):
        classifier = FailureClassifier()

        res1 = classifier.classify(ConnectionError("Connection reset by peer"))
        assert res1.failure_class == FailureClass.TRANSIENT
        assert res1.is_retryable is True

        class FakeHttp503(Exception):
            status_code = 503

        res2 = classifier.classify(FakeHttp503("Service Unavailable"))
        assert res2.failure_class == FailureClass.TRANSIENT
        assert res2.is_retryable is True

    def test_classify_rate_limit_with_retry_after(self):
        classifier = FailureClassifier()

        class FakeRateLimit(Exception):
            status_code = 429
            retry_after = 45.0

        res = classifier.classify(FakeRateLimit("Too Many Requests"))
        assert res.failure_class == FailureClass.PROVIDER_RATE_LIMIT
        assert res.is_retryable is True
        assert res.retry_after_seconds == 45.0

    def test_classify_rate_limit_header_string(self):
        classifier = FailureClassifier()

        class FakeRateLimitWithHeader(Exception):
            status_code = 429
            headers = {"Retry-After": "60"}

        res = classifier.classify(FakeRateLimitWithHeader("Rate limit exceeded"))
        assert res.failure_class == FailureClass.PROVIDER_RATE_LIMIT
        assert res.is_retryable is True
        assert res.retry_after_seconds == 60.0

    def test_classify_timeout_errors(self):
        classifier = FailureClassifier()

        res = classifier.classify(TimeoutError("Read operation timed out after 30s"))
        assert res.failure_class == FailureClass.TIMEOUT
        assert res.is_retryable is True

        class FakeHttp408(Exception):
            status_code = 408

        res408 = classifier.classify(FakeHttp408("Request Timeout"))
        assert res408.failure_class == FailureClass.TIMEOUT
        assert res408.is_retryable is True

    def test_classify_authentication_errors_never_retryable(self):
        classifier = FailureClassifier()

        class FakeHttp401(Exception):
            status_code = 401

        res401 = classifier.classify(FakeHttp401("Unauthorized"))
        assert res401.failure_class == FailureClass.AUTHENTICATION
        assert res401.is_retryable is False

        class FakeHttp403(Exception):
            status_code = 403

        res403 = classifier.classify(FakeHttp403("Forbidden: invalid API key"))
        assert res403.failure_class == FailureClass.AUTHENTICATION
        assert res403.is_retryable is False

    def test_classify_configuration_and_policy_errors_never_retryable(self):
        classifier = FailureClassifier()

        res_cfg = classifier.classify(ValueError("Missing required crawler configuration parameter"))
        assert res_cfg.failure_class == FailureClass.CONFIGURATION
        assert res_cfg.is_retryable is False

        res_pol = classifier.classify(PermissionError("Action violates safety policy: disallowed destructive mutation"))
        assert res_pol.failure_class == FailureClass.UNSAFE_POLICY
        assert res_pol.is_retryable is False

    def test_classify_data_validation_errors_never_retryable(self):
        classifier = FailureClassifier()

        class FakeHttp422(Exception):
            status_code = 422

        res_val = classifier.classify(FakeHttp422("Unprocessable entity: schema validation failed"))
        assert res_val.failure_class == FailureClass.DATA_VALIDATION
        assert res_val.is_retryable is False

    def test_classify_worker_crash_and_lease_loss(self):
        classifier = FailureClassifier()

        res_crash = classifier.classify(RuntimeError("worker crash: SIGKILL or out of memory"))
        assert res_crash.failure_class == FailureClass.WORKER_CRASH
        assert res_crash.is_retryable is True

        res_lease = classifier.classify(RuntimeError("lease expired: worker heartbeat timeout"))
        assert res_lease.failure_class == FailureClass.LEASE_LOST
        assert res_lease.is_retryable is True

    def test_classify_unknown_fallback(self):
        classifier = FailureClassifier()

        res = classifier.classify(Exception("Something bizarre happened"))
        assert res.failure_class == FailureClass.UNKNOWN
        assert res.is_retryable is True

    def test_secret_scrubbing_in_failure_classification(self):
        classifier = FailureClassifier()

        leak_message = "Failed to connect using Bearer my_super_secret_token_12345 to endpoint"
        context = {
            "api_key": "raw_secret_key_abcdef",
            "password": "super_secret_password",
            "normal_field": "public_data",
        }
        res = classifier.classify(Exception(leak_message), context=context)

        # Message must have redacted token
        assert "my_super_secret_token_12345" not in res.message
        assert "[REDACTED]" in res.message or "Bearer [REDACTED]" in res.message

        # Context detail must have sanitized keys
        assert res.sanitized_detail["api_key"] == "[REDACTED]"
        assert res.sanitized_detail["password"] == "[REDACTED]"
        assert res.sanitized_detail["normal_field"] == "public_data"


# ==============================================================================
# 2. RETRY POLICY & BOUNDED BACKOFF TESTS
# ==============================================================================

class TestRetryEngineAndPolicy:
    """Verifies bounded backoff calculations, provider overrides, and exhaustion."""

    def test_exponential_backoff_calculation(self):
        engine = RetryEngine()
        policy = RetryPolicy(base_delay_seconds=2.0, exponential_factor=2.0, max_delay_seconds=60.0, max_attempts=5, jitter_enabled=False)
        failure = StructuredFailure(failure_class=FailureClass.TRANSIENT, is_retryable=True, error_code="NET", message="err")

        # Attempt 1 -> 2.0 * (2^0) = 2.0s
        d1 = engine.evaluate(failure, attempt_number=1, policy=policy)
        assert d1.should_retry is True
        assert d1.delay_seconds == 2.0

        # Attempt 2 -> 2.0 * (2^1) = 4.0s
        d2 = engine.evaluate(failure, attempt_number=2, policy=policy)
        assert d2.should_retry is True
        assert d2.delay_seconds == 4.0

        # Attempt 3 -> 2.0 * (2^2) = 8.0s
        d3 = engine.evaluate(failure, attempt_number=3, policy=policy)
        assert d3.should_retry is True
        assert d3.delay_seconds == 8.0

        # Attempt 4 -> 2.0 * (2^3) = 16.0s
        d4 = engine.evaluate(failure, attempt_number=4, policy=policy)
        assert d4.should_retry is True
        assert d4.delay_seconds == 16.0

    def test_backoff_capped_at_max_delay(self):
        engine = RetryEngine()
        policy = RetryPolicy(base_delay_seconds=5.0, exponential_factor=2.0, max_delay_seconds=25.0, max_retries=10, jitter_enabled=False)
        failure = StructuredFailure(failure_class=FailureClass.TIMEOUT, is_retryable=True, error_code="TIME", message="err")

        # Attempt 5 would be 5 * 16 = 80s -> must be capped at 25.0s
        decision = engine.evaluate(failure, attempt_number=5, policy=policy)
        assert decision.should_retry is True
        assert decision.delay_seconds == 25.0

    def test_provider_retry_after_override(self):
        engine = RetryEngine()
        policy = RetryPolicy(base_delay_seconds=2.0, max_delay_seconds=60.0, jitter_enabled=False)
        failure = StructuredFailure(
            failure_class=FailureClass.PROVIDER_RATE_LIMIT,
            is_retryable=True,
            error_code="RATE",
            message="err",
            retry_after_seconds=42.0,
        )

        decision = engine.evaluate(failure, attempt_number=1, policy=policy)
        assert decision.should_retry is True
        assert decision.delay_seconds == 42.0
        assert "Retry-After" in decision.reason

    def test_retry_after_capped_at_max_ceiling(self):
        engine = RetryEngine()
        policy = RetryPolicy(max_delay_seconds=30.0, jitter_enabled=False)
        failure = StructuredFailure(
            failure_class=FailureClass.PROVIDER_RATE_LIMIT,
            is_retryable=True,
            error_code="RATE",
            message="err",
            retry_after_seconds=300.0,  # 5 minutes requested by provider
        )

        decision = engine.evaluate(failure, attempt_number=1, policy=policy)
        assert decision.should_retry is True
        assert decision.delay_seconds == 30.0  # Capped at max_delay_seconds

    def test_attempt_exhaustion(self):
        engine = RetryEngine()
        policy = RetryPolicy(max_retries=3, jitter_enabled=False)
        failure = StructuredFailure(failure_class=FailureClass.TRANSIENT, is_retryable=True, error_code="NET", message="err")

        # Attempts 1, 2, 3 should retry
        assert engine.evaluate(failure, attempt_number=1, policy=policy).should_retry is True
        assert engine.evaluate(failure, attempt_number=2, policy=policy).should_retry is True
        assert engine.evaluate(failure, attempt_number=3, policy=policy).should_retry is True

        # Attempt 4 must be rejected
        exhausted = engine.evaluate(failure, attempt_number=4, policy=policy)
        assert exhausted.should_retry is False
        assert exhausted.delay_seconds == 0.0
        assert "Exceeded maximum retry limit" in exhausted.reason

    def test_non_retryable_failure_rejected_immediately(self):
        engine = RetryEngine()
        policy = RetryPolicy(max_retries=5)
        failure = StructuredFailure(
            failure_class=FailureClass.AUTHENTICATION,
            is_retryable=False,
            error_code="AUTH_401",
            message="Invalid token",
        )

        decision = engine.evaluate(failure, attempt_number=1, policy=policy)
        assert decision.should_retry is False
        assert decision.delay_seconds == 0.0
        assert "Non-retryable failure class" in decision.reason

    def test_clock_injection_deterministic_timestamp(self):
        fixed_now = _utc(2026, 9, 10, 15, 30)
        engine = RetryEngine(clock=lambda: fixed_now)
        policy = RetryPolicy(base_delay_seconds=10.0, exponential_factor=1.0, jitter_enabled=False)
        failure = StructuredFailure(failure_class=FailureClass.TIMEOUT, is_retryable=True, error_code="TIME", message="err")

        decision = engine.evaluate(failure, attempt_number=1, policy=policy)
        assert decision.next_retry_at == fixed_now + timedelta(seconds=10.0)


# ==============================================================================
# 3. STATE MACHINE & RETRY_WAIT INTEGRATION TESTS
# ==============================================================================

class TestStateMachineRetryWaitIntegration:
    """Verifies legal entry to RETRY_WAIT, resumption, and illegal transition rejection."""

    def test_active_state_to_retry_wait_transition(self, db_session: Session, orchestration_service: OrchestrationService):
        req = OrchestrationRunCreateRequest(
            workspace_id="ws_retry",
            site_id=1,
            run_type=RunType.ON_DEMAND_SCAN,
            trigger_source=TriggerSource.MANUAL,
            actor_provenance=ActorProvenance(actor_id="tester"),
        )
        run = orchestration_service.create_run(req, db_session)
        # Advance: QUEUED -> STARTING -> SCANNING
        orchestration_service.transition_run_state(req.workspace_id, run.id, RunState.STARTING, db=db_session)
        orchestration_service.transition_run_state(req.workspace_id, run.id, RunState.SCANNING, db=db_session)

        # SCANNING -> RETRY_WAIT
        run = orchestration_service.transition_run_state(
            workspace_id=req.workspace_id,
            run_id=run.id,
            target_state=RunState.RETRY_WAIT,
            db=db_session,
            reason="Transient failure scheduled for retry",
        )
        assert run.state == RunState.RETRY_WAIT.value
        # Check metadata stored resumable active state
        assert run.metadata_payload.get("resumable_active_state") == RunState.SCANNING.value

    def test_retry_wait_resumption_back_to_previous_state(self, db_session: Session, orchestration_service: OrchestrationService):
        req = OrchestrationRunCreateRequest(
            workspace_id="ws_resume",
            site_id=1,
            run_type=RunType.ON_DEMAND_SCAN,
            trigger_source=TriggerSource.MANUAL,
        )
        run = orchestration_service.create_run(req, db_session)
        orchestration_service.transition_run_state(req.workspace_id, run.id, RunState.STARTING, db=db_session)
        orchestration_service.transition_run_state(req.workspace_id, run.id, RunState.SCANNING, db=db_session)
        orchestration_service.transition_run_state(req.workspace_id, run.id, RunState.RETRY_WAIT, db=db_session)

        # Resumption: RETRY_WAIT -> SCANNING
        resumed_run = orchestration_service.transition_run_state(
            workspace_id=req.workspace_id,
            run_id=run.id,
            target_state=RunState.SCANNING,
            previous_active_state=RunState.SCANNING,
            db=db_session,
            reason="Resuming execution after retry backoff",
        )
        assert resumed_run.state == RunState.SCANNING.value

    def test_retry_wait_cross_state_illegal_transition_rejected(self, db_session: Session, orchestration_service: OrchestrationService):
        req = OrchestrationRunCreateRequest(
            workspace_id="ws_illegal",
            site_id=1,
            run_type=RunType.ON_DEMAND_SCAN,
            trigger_source=TriggerSource.MANUAL,
        )
        run = orchestration_service.create_run(req, db_session)
        orchestration_service.transition_run_state(req.workspace_id, run.id, RunState.STARTING, db=db_session)
        orchestration_service.transition_run_state(req.workspace_id, run.id, RunState.SCANNING, db=db_session)
        orchestration_service.transition_run_state(req.workspace_id, run.id, RunState.RETRY_WAIT, db=db_session)

        # Attempting to resume into OBSERVING when recorded previous state was SCANNING must be rejected
        with pytest.raises(InvalidStateTransitionError) as exc_info:
            orchestration_service.transition_run_state(
                workspace_id=req.workspace_id,
                run_id=run.id,
                target_state=RunState.OBSERVING,
                previous_active_state=RunState.SCANNING,
                db=db_session,
            )
        assert "RETRY_WAIT" in str(exc_info.value)

    def test_retry_wait_to_terminal_failed_or_cancelled(self, db_session: Session, orchestration_service: OrchestrationService):
        req = OrchestrationRunCreateRequest(
            workspace_id="ws_term",
            site_id=1,
            run_type=RunType.ON_DEMAND_SCAN,
            trigger_source=TriggerSource.MANUAL,
        )
        run = orchestration_service.create_run(req, db_session)
        orchestration_service.transition_run_state(req.workspace_id, run.id, RunState.STARTING, db=db_session)
        orchestration_service.transition_run_state(req.workspace_id, run.id, RunState.SCANNING, db=db_session)
        orchestration_service.transition_run_state(req.workspace_id, run.id, RunState.RETRY_WAIT, db=db_session)

        # RETRY_WAIT -> FAILED on exhaustion is legally permitted
        failed_run = orchestration_service.transition_run_state(
            workspace_id=req.workspace_id,
            run_id=run.id,
            target_state=RunState.FAILED,
            db=db_session,
            reason="Retries exhausted",
        )
        assert failed_run.state == RunState.FAILED.value
        assert failed_run.completed_at is not None


# ==============================================================================
# 4. EXECUTION RECEIPTS & IDEMPOTENCY SAFETY TESTS
# ==============================================================================

class TestExecutionReceiptsAndSafety:
    """Verifies durable idempotency execution receipts and ambiguity blocking."""

    def test_create_and_confirm_receipt(self, db_session: Session, orchestration_service: OrchestrationService):
        manager = ExecutionReceiptManager()
        req = OrchestrationRunCreateRequest(workspace_id="ws_rcpt", site_id=1)
        run = orchestration_service.create_run(req, db_session)

        receipt = manager.create_receipt(
            workspace_id="ws_rcpt",
            run_id=run.id,
            idempotency_key="idemp_key_1001",
            provider_name="github_connector",
            operation_type="create_pull_request",
            db=db_session,
            request_payload={"title": "Fix schema issue"},
        )
        assert receipt.status == ReceiptStatus.PENDING.value
        assert receipt.is_safe_to_retry is True

        # Confirm receipt
        confirmed = manager.confirm_receipt(
            workspace_id="ws_rcpt",
            idempotency_key="idemp_key_1001",
            external_reference_id="pr_98765",
            response_payload={"pr_url": "https://github.com/example/pr/98765"},
            db=db_session,
        )
        assert confirmed.status == ReceiptStatus.CONFIRMED.value
        assert confirmed.external_reference_id == "pr_98765"
        assert confirmed.is_safe_to_retry is True

    def test_duplicate_idempotency_key_raises_conflict(self, db_session: Session, orchestration_service: OrchestrationService):
        manager = ExecutionReceiptManager()
        req = OrchestrationRunCreateRequest(workspace_id="ws_rcpt", site_id=1)
        run = orchestration_service.create_run(req, db_session)

        manager.create_receipt(
            workspace_id="ws_rcpt",
            run_id=run.id,
            idempotency_key="unique_key_abc",
            provider_name="wordpress_connector",
            operation_type="publish_post",
            db=db_session,
        )

        with pytest.raises(ReceiptConflictError) as exc_info:
            manager.create_receipt(
                workspace_id="ws_rcpt",
                run_id=run.id,
                idempotency_key="unique_key_abc",
                provider_name="wordpress_connector",
                operation_type="publish_post",
                db=db_session,
            )
        assert "unique_key_abc" in str(exc_info.value)

    def test_ambiguous_mutation_blocks_automatic_retry(self, db_session: Session, orchestration_service: OrchestrationService):
        manager = ExecutionReceiptManager()
        req = OrchestrationRunCreateRequest(workspace_id="ws_ambig", site_id=1)
        run = orchestration_service.create_run(req, db_session)

        # Worker initiated external mutation
        receipt = manager.create_receipt(
            workspace_id="ws_ambig",
            run_id=run.id,
            idempotency_key="mutate_external_xyz",
            provider_name="cloud_connector",
            operation_type="apply_fix",
            db=db_session,
        )
        assert receipt.is_safe_to_retry is True

        # Worker crashed while PENDING -> Mark ambiguous
        ambig_receipt = manager.mark_receipt_ambiguous(
            workspace_id="ws_ambig",
            idempotency_key="mutate_external_xyz",
            db=db_session,
            reason="Worker died during external apply_fix before confirmation",
        )
        assert ambig_receipt.status == ReceiptStatus.AMBIGUOUS.value
        assert ambig_receipt.is_safe_to_retry is False

        # Query safety check must return False
        is_safe = manager.is_operation_safe_to_retry(
            workspace_id="ws_ambig",
            idempotency_key="mutate_external_xyz",
            db=db_session,
        )
        assert is_safe is False

    def test_tenant_isolation_in_execution_receipts(self, db_session: Session, orchestration_service: OrchestrationService):
        manager = ExecutionReceiptManager()
        req1 = OrchestrationRunCreateRequest(workspace_id="tenant_a", site_id=1)
        run1 = orchestration_service.create_run(req1, db_session)

        req2 = OrchestrationRunCreateRequest(workspace_id="tenant_b", site_id=2)
        run2 = orchestration_service.create_run(req2, db_session)

        # Tenant A creates receipt with key "shared_key"
        manager.create_receipt(
            workspace_id="tenant_a",
            run_id=run1.id,
            idempotency_key="shared_key",
            provider_name="prov_1",
            operation_type="op_1",
            db=db_session,
        )

        # Tenant B can create their own receipt with the SAME idempotency key without collision
        receipt_b = manager.create_receipt(
            workspace_id="tenant_b",
            run_id=run2.id,
            idempotency_key="shared_key",
            provider_name="prov_1",
            operation_type="op_1",
            db=db_session,
        )
        assert receipt_b.workspace_id == "tenant_b"

        # Tenant B cannot access Tenant A's receipt
        fetched_a_by_b = manager.get_receipt("tenant_b", "shared_key", db_session)
        assert fetched_a_by_b.workspace_id == "tenant_b"


# ==============================================================================
# 5. RECOVERY SERVICE TESTS (ALL 4 CANONICAL CASES)
# ==============================================================================

class TestRecoveryService:
    """Verifies the 4 worker crash & lease loss recovery cases."""

    def test_case1_active_worker_crash_reschedules_retry(self, db_session: Session, orchestration_service: OrchestrationService):
        queue = LocalOrchestrationQueue()
        concurrency = ConcurrencyController()
        recovery = RecoveryService(
            orchestration_service=orchestration_service,
            queue=queue,
            concurrency_controller=concurrency,
        )

        req = OrchestrationRunCreateRequest(workspace_id="ws_rec1", site_id=1)
        run = orchestration_service.create_run(req, db_session)
        orchestration_service.transition_run_state(req.workspace_id, run.id, RunState.STARTING, db=db_session)
        orchestration_service.transition_run_state(req.workspace_id, run.id, RunState.SCANNING, db=db_session)

        # Simulate active lease held by dead worker
        now = _utc()
        job = QueueJob(
            run_id=run.id,
            workspace_id=req.workspace_id,
            site_id=1,
            worker_id="dead_worker_1",
            lease_id="lease_dead_1",
            lease_expires_at=now - timedelta(seconds=10),
        )
        queue.enqueue(job)
        # Pre-occupy concurrency slot for this crashed worker
        concurrency.acquire(workspace_id=req.workspace_id, site_id=1)

        result = recovery.recover_stale_job(
            job_id=job.job_id,
            run_id=run.id,
            workspace_id=req.workspace_id,
            site_id=1,
            db=db_session,
            worker_id="dead_worker_1",
            as_of=now,
        )

        assert result.action_taken == RecoveryActionType.RESCHEDULE_RETRY
        assert result.new_state == RunState.RETRY_WAIT.value
        assert result.is_safe_to_retry is True

        # Verify DB state
        db_session.refresh(run)
        assert run.state == RunState.RETRY_WAIT.value
        assert run.recovery_info.get("retry_attempt") == 1

        # Verify concurrency slot was reclaimed
        status = concurrency.get_capacity_status(workspace_id=req.workspace_id, site_id=1)
        assert status["site"]["active"] == 0

    def test_case1_active_worker_crash_retries_exhausted(self, db_session: Session, orchestration_service: OrchestrationService):
        queue = LocalOrchestrationQueue()
        concurrency = ConcurrencyController()
        # Max retries = 1
        policy = RetryPolicy(max_retries=1)
        recovery = RecoveryService(
            orchestration_service=orchestration_service,
            queue=queue,
            concurrency_controller=concurrency,
            retry_policy=policy,
        )

        req = OrchestrationRunCreateRequest(workspace_id="ws_rec_exh", site_id=1)
        run = orchestration_service.create_run(req, db_session)
        orchestration_service.transition_run_state(req.workspace_id, run.id, RunState.STARTING, db=db_session)
        orchestration_service.transition_run_state(req.workspace_id, run.id, RunState.SCANNING, db=db_session)

        # Seed 1 prior failure so attempt 2 will exhaust
        run.recovery_info = {"failure_history": [{"failure_class": "WORKER_CRASH", "attempt": 1}]}
        db_session.commit()

        now = _utc()
        job = QueueJob(
            run_id=run.id,
            workspace_id=req.workspace_id,
            site_id=1,
            worker_id="dead_worker_2",
            lease_expires_at=now - timedelta(seconds=10),
        )
        queue.enqueue(job)

        result = recovery.recover_stale_job(
            job_id=job.job_id,
            run_id=run.id,
            workspace_id=req.workspace_id,
            site_id=1,
            db=db_session,
            as_of=now,
        )

        assert result.action_taken == RecoveryActionType.MARK_FAILED
        assert result.new_state == RunState.FAILED.value
        assert result.is_safe_to_retry is False

        db_session.refresh(run)
        assert run.state == RunState.FAILED.value
        assert run.recovery_info.get("retry_exhausted") is True

    def test_case2_crashed_during_pending_external_mutation(self, db_session: Session, orchestration_service: OrchestrationService):
        queue = LocalOrchestrationQueue()
        concurrency = ConcurrencyController()
        receipt_manager = ExecutionReceiptManager()
        recovery = RecoveryService(
            orchestration_service=orchestration_service,
            queue=queue,
            concurrency_controller=concurrency,
            receipt_manager=receipt_manager,
        )

        req = OrchestrationRunCreateRequest(workspace_id="ws_rec2", site_id=1)
        run = orchestration_service.create_run(req, db_session)
        orchestration_service.transition_run_state(req.workspace_id, run.id, RunState.STARTING, db=db_session)
        orchestration_service.transition_run_state(req.workspace_id, run.id, RunState.ANALYZING, db=db_session)
        orchestration_service.transition_run_state(req.workspace_id, run.id, RunState.PLANNING, db=db_session)
        orchestration_service.transition_run_state(req.workspace_id, run.id, RunState.EXECUTING, db=db_session)

        # External mutation was initiated and left in PENDING status when worker crashed
        receipt = receipt_manager.create_receipt(
            workspace_id=req.workspace_id,
            run_id=run.id,
            idempotency_key="commit_fix_pr_55",
            provider_name="github_connector",
            operation_type="create_pull_request",
            db=db_session,
        )

        now = _utc()
        job = QueueJob(
            run_id=run.id,
            workspace_id=req.workspace_id,
            site_id=1,
            worker_id="crashed_during_commit",
            lease_expires_at=now - timedelta(seconds=15),
        )
        queue.enqueue(job)

        result = recovery.recover_stale_job(
            job_id=job.job_id,
            run_id=run.id,
            workspace_id=req.workspace_id,
            site_id=1,
            db=db_session,
            as_of=now,
        )

        # Must reconcile ambiguous mutation
        assert result.action_taken == RecoveryActionType.RECONCILE_AMBIGUOUS_MUTATION
        assert result.is_safe_to_retry is False
        assert result.requires_manual_review is True
        assert result.new_state == RunState.FAILED.value

        # Receipt must now be AMBIGUOUS and unsafe to retry
        db_session.refresh(receipt)
        assert receipt.status == ReceiptStatus.AMBIGUOUS.value
        assert receipt.is_safe_to_retry is False

        # Run must be FAILED with manual review flag
        db_session.refresh(run)
        assert run.state == RunState.FAILED.value
        assert run.recovery_info.get("requires_manual_review") is True

    def test_case3_crashed_while_in_retry_wait(self, db_session: Session, orchestration_service: OrchestrationService):
        queue = LocalOrchestrationQueue()
        concurrency = ConcurrencyController()
        recovery = RecoveryService(
            orchestration_service=orchestration_service,
            queue=queue,
            concurrency_controller=concurrency,
        )

        req = OrchestrationRunCreateRequest(workspace_id="ws_rec3", site_id=1)
        run = orchestration_service.create_run(req, db_session)
        orchestration_service.transition_run_state(req.workspace_id, run.id, RunState.STARTING, db=db_session)
        orchestration_service.transition_run_state(req.workspace_id, run.id, RunState.SCANNING, db=db_session)
        orchestration_service.transition_run_state(req.workspace_id, run.id, RunState.RETRY_WAIT, db=db_session)

        now = _utc()
        job = QueueJob(
            run_id=run.id,
            workspace_id=req.workspace_id,
            site_id=1,
            worker_id="worker_crashed_waiting",
            lease_expires_at=now - timedelta(seconds=20),
        )
        queue.enqueue(job)

        result = recovery.recover_stale_job(
            job_id=job.job_id,
            run_id=run.id,
            workspace_id=req.workspace_id,
            site_id=1,
            db=db_session,
            as_of=now,
        )

        assert result.action_taken == RecoveryActionType.RECONCILE_LEASE
        assert result.new_state == RunState.RETRY_WAIT.value
        assert result.is_safe_to_retry is True

    def test_case4_non_retryable_stale_job(self, db_session: Session, orchestration_service: OrchestrationService):
        queue = LocalOrchestrationQueue()
        concurrency = ConcurrencyController()
        recovery = RecoveryService(
            orchestration_service=orchestration_service,
            queue=queue,
            concurrency_controller=concurrency,
        )

        req = OrchestrationRunCreateRequest(workspace_id="ws_rec4", site_id=1)
        run = orchestration_service.create_run(req, db_session)
        orchestration_service.transition_run_state(req.workspace_id, run.id, RunState.STARTING, db=db_session)
        orchestration_service.transition_run_state(req.workspace_id, run.id, RunState.SCANNING, db=db_session)

        # Mark last failure class as non-retryable
        run.recovery_info = {"last_failure_class": FailureClass.AUTHENTICATION.value}
        db_session.commit()

        now = _utc()
        job = QueueJob(
            run_id=run.id,
            workspace_id=req.workspace_id,
            site_id=1,
            worker_id="auth_fail_worker",
            lease_expires_at=now - timedelta(seconds=10),
        )
        queue.enqueue(job)

        result = recovery.recover_stale_job(
            job_id=job.job_id,
            run_id=run.id,
            workspace_id=req.workspace_id,
            site_id=1,
            db=db_session,
            as_of=now,
        )

        assert result.action_taken == RecoveryActionType.MARK_FAILED
        assert result.new_state == RunState.FAILED.value
        assert result.is_safe_to_retry is False


# ==============================================================================
# 6. WORKER POLL_AND_EXECUTE RETRY INTEGRATION TESTS
# ==============================================================================

class TestWorkerRetryIntegration:
    """Verifies that OrchestrationWorker handles exceptions, retries, and resumptions end-to-end."""

    def test_worker_catches_transient_error_and_transitions_to_retry_wait(
        self,
        db_session_factory,
        db_session: Session,
    ):
        service = OrchestrationService()
        queue = LocalOrchestrationQueue()
        concurrency = ConcurrencyController()

        worker = OrchestrationWorker(
            worker_id="worker_test_retry",
            queue=queue,
            concurrency_controller=concurrency,
            orchestration_service=service,
            session_factory=db_session_factory,
        )

        req = OrchestrationRunCreateRequest(workspace_id="ws_wrk", site_id=1)
        run = service.create_run(req, db_session)
        job = QueueJob(run_id=run.id, workspace_id="ws_wrk", site_id=1)
        queue.enqueue(job)

        # Monkeypatch transition_run_state to fail with ConnectionError during operational phase
        original_transition = service.transition_run_state

        def failing_transition(workspace_id, run_id, target_state, *args, **kwargs):
            if target_state == RunState.ANALYZING:
                raise ConnectionError("Upstream connection dropped")
            return original_transition(workspace_id, run_id, target_state, *args, **kwargs)

        service.transition_run_state = failing_transition

        # Worker attempts to execute; exception is raised and handled
        with pytest.raises(ConnectionError):
            worker.poll_and_execute_once()

        # Verify run state moved to RETRY_WAIT
        db_session.refresh(run)
        assert run.state == RunState.RETRY_WAIT.value
        assert run.recovery_info.get("retry_attempt") == 1
        assert run.recovery_info.get("last_failure_class") == FailureClass.TRANSIENT.value

        # Job was released back to queue with visibility delay
        assert queue.get_queue_depth() == 1
        # Concurrency slot was released
        status = concurrency.get_capacity_status("ws_wrk", 1)
        assert status["site"]["active"] == 0

    def test_worker_catches_non_retryable_error_and_transitions_to_failed(
        self,
        db_session_factory,
        db_session: Session,
    ):
        service = OrchestrationService()
        queue = LocalOrchestrationQueue()
        concurrency = ConcurrencyController()

        worker = OrchestrationWorker(
            worker_id="worker_test_fail",
            queue=queue,
            concurrency_controller=concurrency,
            orchestration_service=service,
            session_factory=db_session_factory,
        )

        req = OrchestrationRunCreateRequest(workspace_id="ws_wrk_fail", site_id=1)
        run = service.create_run(req, db_session)
        job = QueueJob(run_id=run.id, workspace_id="ws_wrk_fail", site_id=1)
        queue.enqueue(job)

        class FakeHttp401(Exception):
            status_code = 401

        original_transition = service.transition_run_state

        def failing_auth_transition(workspace_id, run_id, target_state, *args, **kwargs):
            if target_state == RunState.ANALYZING:
                raise FakeHttp401("Unauthorized: API token revoked")
            return original_transition(workspace_id, run_id, target_state, *args, **kwargs)

        service.transition_run_state = failing_auth_transition

        with pytest.raises(FakeHttp401):
            worker.poll_and_execute_once()

        db_session.refresh(run)
        assert run.state == RunState.FAILED.value
        assert run.recovery_info.get("retry_exhausted") is True
        assert run.recovery_info.get("last_failure_class") == FailureClass.AUTHENTICATION.value

        # Acknowledged/removed from queue since terminally failed
        assert queue.get_queue_depth() == 0

    def test_worker_resumes_from_retry_wait_to_success(
        self,
        db_session_factory,
        db_session: Session,
    ):
        service = OrchestrationService()
        queue = LocalOrchestrationQueue()
        concurrency = ConcurrencyController()

        worker = OrchestrationWorker(
            worker_id="worker_test_resume",
            queue=queue,
            concurrency_controller=concurrency,
            orchestration_service=service,
            session_factory=db_session_factory,
        )

        req = OrchestrationRunCreateRequest(workspace_id="ws_wrk_res", site_id=1)
        run = service.create_run(req, db_session)
        # Advance to SCANNING then RETRY_WAIT
        service.transition_run_state("ws_wrk_res", run.id, RunState.STARTING, db=db_session)
        service.transition_run_state("ws_wrk_res", run.id, RunState.SCANNING, db=db_session)
        service.transition_run_state("ws_wrk_res", run.id, RunState.RETRY_WAIT, db=db_session)

        # Enqueue job for resuming run
        job = QueueJob(run_id=run.id, workspace_id="ws_wrk_res", site_id=1)
        queue.enqueue(job)

        # Worker polls: should resume from RETRY_WAIT into SCANNING, then progress to SUCCEEDED
        executed = worker.poll_and_execute_once()
        assert executed is True

        db_session.refresh(run)
        assert run.state == RunState.SUCCEEDED.value
        assert queue.get_queue_depth() == 0
