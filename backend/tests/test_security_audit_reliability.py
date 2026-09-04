"""
Unit and Integration Test Suite for Task 11 — Step 6: Security, Audit & Reliability.

Comprehensive testing of:
1. Authorization & Multi-Tenant Workspace Isolation
2. Deep Secret & Credential Redaction
3. Immutable Append-Only Audit Logging & Provenance
4. Connector Rate Limiting & Bounded Backoff
5. Bounded Timeout Enforcement
6. Centralized Deterministic Retry Policy
7. Non-Mutating Connector Health Checks
8. Concurrency Protection & Granular Resource Locking
9. Idempotency on Repeated Apply & Rollback
10. Worker Failure Recovery & Ambiguous Mutation Resolution
11. Safe Error Handling & Normalization
12. Security Boundary & SSRF Protection
13. State Machine Guarantees
"""

import time
import pytest

from backend.app.fix_safety_classifier import SafetyTier
from connectors.audit.logger import AuditEventLedger, AuditIntegrityError, AuditLogger
from connectors.audit.models import AuditActionType, AuditEvent
from connectors.base.capabilities import ConnectorCapabilities
from connectors.base.enums import (
    AuthState,
    ConnectorCapability,
    ConnectorErrorCode,
    ExecutionOperationType,
    ExecutionStatus,
    HealthStatus,
    ResourceType,
)
from connectors.base.errors import (
    AuthenticationError,
    AuthorizationError,
    ConnectorErrorInfo,
    ConnectorException,
    ConnectorNetworkError,
    ConnectorTimeoutError,
    ConnectorValidationError,
    InvalidResourceError,
    ProviderAPIError,
    RateLimitExceededError,
    ResourceNotFoundError,
    UnsupportedOperationError,
)
from connectors.base.models import (
    ChangePreview,
    ChangeProposal,
    ChangeResult,
    ConnectorHealth,
    OperationId,
    RateLimitInfo,
    ResourceReference,
    SiteContext,
)
from connectors.base.security import (
    redact_secrets_from_string,
    sanitize_payload,
    validate_safe_identifier,
)
from connectors.execution.approval import ApprovalManager
from connectors.execution.engine import ExecutionEngine
from connectors.execution.errors import (
    ApprovalRequiredError,
    InvalidStateTransitionError,
    SafetyGateRejectedError,
    StaleApprovalError,
)
from connectors.execution.models import (
    ExecutionLifecycleState,
    ExecutionRecord,
    ExecutionRequest,
    ExecutionTarget,
    SafetyGateDecision,
    TargetedRescanResult,
    ValidationOutcome,
)
from connectors.execution.rescan import TargetedRescanner
from connectors.execution.state_machine import ExecutionStateMachine
from connectors.reliability.lock import (
    ConcurrencyConflictError,
    ResourceLock,
    ResourceLockManager,
)
from connectors.reliability.rate_limiter import ConnectorRateLimiter
from connectors.reliability.recovery import (
    RecoveryAction,
    RecoveryDecision,
    WorkerRecoveryManager,
)
from connectors.reliability.retry import (
    RetryPolicy,
    execute_with_retry,
)
from connectors.reliability.timeout import (
    execute_with_timeout,
)
from connectors.security.authz import (
    AuthorizationContext,
    AuthorizationDecision,
    AuthorizationManager,
    PermissionType,
)
from connectors.security.boundaries import SecurityBoundaryValidator
from connectors.security.scrubber import (
    DeepScrubber,
    redact_credentials_from_url,
    sanitize_nested_data,
)
from connectors.security.ssrf import (
    SSRFValidationError,
    SSRFValidator,
)
from connectors.testing.mock_connector import MockConnector


# =============================================================================
# Helper Fixtures
# =============================================================================

@pytest.fixture
def mock_site_context():
    return SiteContext(
        workspace_id="ws_acme",
        site_id=101,
        site_url="https://example.com",
        provider="mock",
        capabilities=ConnectorCapabilities.full_mutation(),
        auth_state=AuthState.CONNECTED,
    )


@pytest.fixture
def mock_resource():
    return ResourceReference(
        resource_type=ResourceType.WEBSITE_PAGE,
        resource_id="/about",
        path="/about",
    )


@pytest.fixture
def mock_proposal(mock_resource):
    return ChangeProposal(
        action_type="update_content",
        target_resource=mock_resource,
        proposed_content="<html><head><title>Updated About</title></head></html>",
        change_summary="Update meta title",
    )


@pytest.fixture
def mock_connector(mock_site_context):
    return MockConnector(site_context=mock_site_context)


@pytest.fixture
def valid_auth_context():
    return AuthorizationContext(
        workspace_id="ws_acme",
        site_id="101",
        actor_id="user_admin_1",
        roles=["admin"],
        allowed_connectors=["mock", "wordpress", "github"],
        allowed_resource_patterns=["*"],
    )


# =============================================================================
# 1. Authorization & Multi-Tenant Workspace Isolation Tests
# =============================================================================

class TestAuthorizationAndIsolation:

    def test_missing_authorization_context_rejected(self):
        decision = AuthorizationManager.evaluate(
            context=None,
            target_workspace_id="ws_acme",
            target_site_id="101",
            connector_type="mock",
            resource_id="/about",
        )
        assert decision.is_authorized is False
        assert decision.denial_code == "MISSING_CONTEXT"

    def test_workspace_mismatch_rejected(self, valid_auth_context):
        # Context workspace is ws_acme, target is ws_evil
        decision = AuthorizationManager.evaluate(
            context=valid_auth_context,
            target_workspace_id="ws_evil",
            target_site_id="101",
            connector_type="mock",
            resource_id="/about",
        )
        assert decision.is_authorized is False
        assert decision.denial_code == "WORKSPACE_MISMATCH"
        assert "Workspace mismatch" in decision.reason

    def test_site_mismatch_rejected(self, valid_auth_context):
        # Context site is 101, target site is 999
        decision = AuthorizationManager.evaluate(
            context=valid_auth_context,
            target_workspace_id="ws_acme",
            target_site_id="999",
            connector_type="mock",
            resource_id="/about",
        )
        assert decision.is_authorized is False
        assert decision.denial_code == "SITE_MISMATCH"

    def test_connector_type_mismatch_rejected(self):
        restricted_context = AuthorizationContext(
            workspace_id="ws_acme",
            site_id="101",
            actor_id="user_1",
            allowed_connectors=["wordpress"],  # only wordpress allowed
        )
        decision = AuthorizationManager.evaluate(
            context=restricted_context,
            target_workspace_id="ws_acme",
            target_site_id="101",
            connector_type="github",  # attempting github
            resource_id="/about",
        )
        assert decision.is_authorized is False
        assert decision.denial_code == "CONNECTOR_MISMATCH"

    def test_resource_pattern_restriction_rejected(self):
        restricted_context = AuthorizationContext(
            workspace_id="ws_acme",
            site_id="101",
            actor_id="user_1",
            allowed_resource_patterns=["pages/*"],
        )
        decision = AuthorizationManager.evaluate(
            context=restricted_context,
            target_workspace_id="ws_acme",
            target_site_id="101",
            connector_type="mock",
            resource_id="posts/secret-post",  # does not match pages/*
        )
        assert decision.is_authorized is False
        assert decision.denial_code == "TARGET_MISMATCH"

    def test_unauthorized_apply_permission_denial(self):
        viewer_context = AuthorizationContext(
            workspace_id="ws_acme",
            site_id="101",
            actor_id="viewer_1",
            roles=["viewer"],
            permissions=[PermissionType.READ],  # only read permission
        )
        with pytest.raises(AuthorizationError) as exc_info:
            AuthorizationManager.enforce(
                context=viewer_context,
                target_workspace_id="ws_acme",
                target_site_id="101",
                connector_type="mock",
                resource_id="/about",
                operation=ExecutionOperationType.APPLY_CHANGE,
            )
        assert "PERMISSION_DENIED" in str(exc_info.value) or "lacks required permission" in str(exc_info.value)

    def test_unauthorized_rollback_permission_denial(self):
        viewer_context = AuthorizationContext(
            workspace_id="ws_acme",
            site_id="101",
            actor_id="viewer_1",
            roles=["viewer"],
            permissions=[PermissionType.READ],
        )
        with pytest.raises(AuthorizationError):
            AuthorizationManager.enforce(
                context=viewer_context,
                target_workspace_id="ws_acme",
                target_site_id="101",
                connector_type="mock",
                resource_id="/about",
                operation=ExecutionOperationType.ROLLBACK_CHANGE,
            )

    def test_engine_enforces_auth_context_on_create_and_apply(
        self, mock_site_context, mock_resource, mock_proposal, mock_connector
    ):
        engine = ExecutionEngine()
        invalid_auth = AuthorizationContext(
            workspace_id="ws_other",
            site_id="101",
            actor_id="intruder",
        )
        # Should raise AuthorizationError because workspace does not match
        with pytest.raises(AuthorizationError):
            engine.create_request(
                site_context=mock_site_context,
                resource=mock_resource,
                change_proposal=mock_proposal,
                auth_context=invalid_auth,
            )


# =============================================================================
# 2. Secret & Credential Scrubbing Tests
# =============================================================================

class TestSecretScrubbing:

    def test_bearer_and_oauth_token_scrubbing(self):
        raw = "Header: Bearer ghp_1234567890abcdef1234567890abcdef1234 and sk-12345678901234567890abcdef"
        sanitized = redact_secrets_from_string(raw)
        assert "ghp_" not in sanitized
        assert "sk-" not in sanitized
        assert "[REDACTED]" in sanitized

    def test_nested_structure_secret_scrubbing(self):
        nested = {
            "token": "ghp_secrettoken1234567890123456789012",
            "headers": {
                "Authorization": "Bearer my_super_secret_bearer_token",
                "Cookie": "session_id=abcdef123456; wordpress_logged_in_abc=123",
            },
            "metadata": {
                "api_key": "AIzaSySecretApiKey1234567890123456",
                "nested_list": [
                    {"password": "my_db_password"},
                    "Connection string: mysql://root:secretpass@localhost/db",
                ],
            },
        }
        scrubbed = DeepScrubber.scrub(nested)
        assert scrubbed["token"] == "[REDACTED]"
        assert scrubbed["headers"]["Authorization"] == "[REDACTED]"
        assert "my_super_secret_bearer_token" not in str(scrubbed)
        assert scrubbed["metadata"]["api_key"] == "[REDACTED]"
        assert scrubbed["metadata"]["nested_list"][0]["password"] == "[REDACTED]"
        assert "secretpass" not in str(scrubbed)

    def test_url_credentials_redaction(self):
        url = "https://admin:SuperSecretPass123@api.wordpress.com/v2/posts"
        clean = redact_credentials_from_url(url)
        assert "SuperSecretPass123" not in clean
        assert "https://[REDACTED]:[REDACTED]@api.wordpress.com/v2/posts" == clean

    def test_audit_event_scrubs_injected_secrets(self):
        ledger = AuditEventLedger()
        event_dict = {
            "workspace_id": "ws_1",
            "site_id": "site_1",
            "actor_id": "actor_1",
            "execution_id": "exec_1",
            "action": AuditActionType.APPLY_INITIATED,
            "connector": "wordpress",
            "resource_reference": "post:1",
            "requested_operation": "apply_change",
            "details": {
                "auth_header": "Bearer secret_token_xyz12345",
                "password": "plain_password_here",
            },
        }
        event = ledger.append(event_dict)
        assert "plain_password_here" not in str(event.details)
        assert "secret_token_xyz12345" not in str(event.details)
        assert event.details["password"] == "[REDACTED]"

    def test_error_info_scrubs_injected_secrets(self):
        err = ConnectorErrorInfo.from_exception(
            Exception("Failed connecting to https://user:super_secret@cms.com with key sk-abcdef12345678901234")
        )
        assert "super_secret" not in err.message
        assert "sk-abcdef" not in err.message
        assert "[REDACTED]" in err.message


# =============================================================================
# 3. Audit Logging & Immutable Integrity Tests
# =============================================================================

class TestAuditIntegrity:

    def test_audit_event_recording_and_provenance(self):
        ledger = AuditEventLedger()
        event = AuditLogger.record(
            workspace_id="ws_acme",
            site_id="101",
            actor_id="user_admin",
            execution_id="req_1001",
            action=AuditActionType.APPLY_COMPLETED,
            connector="wordpress",
            resource_reference="/seo-target",
            requested_operation="apply_change",
            safety_tier="auto_safe",
            finding_id=42,
            recommendation_id=10,
            fix_plan_id=5,
            before_state_reference="hash_before_123",
            after_state_reference="hash_after_456",
            operation_id="op_789",
            details={"status": "updated"},
            ledger=ledger,
        )

        assert event.workspace_id == "ws_acme"
        assert event.site_id == "101"
        assert event.actor_id == "user_admin"
        assert event.execution_id == "req_1001"
        assert event.finding_id == 42
        assert event.recommendation_id == 10
        assert event.fix_plan_id == 5
        assert event.before_state_reference == "hash_before_123"
        assert event.after_state_reference == "hash_after_456"

    def test_audit_ledger_immutable_rejection(self):
        ledger = AuditEventLedger()
        event = AuditLogger.record(
            workspace_id="ws_acme",
            site_id="101",
            actor_id="user_admin",
            execution_id="req_1001",
            action=AuditActionType.REQUEST_CREATED,
            connector="mock",
            resource_reference="/about",
            requested_operation="preview_change",
            ledger=ledger,
        )

        # Attempting to mutate or delete must raise AuditIntegrityError
        with pytest.raises(AuditIntegrityError):
            ledger.update_event(event.audit_event_id, {"action": "tampered"})

        with pytest.raises(AuditIntegrityError):
            ledger.delete_event(event.audit_event_id)

        # Attempting to overwrite the exact same event ID must raise AuditIntegrityError
        with pytest.raises(AuditIntegrityError):
            ledger.append(event)

    def test_audit_hash_chaining_integrity_verification(self):
        ledger = AuditEventLedger()
        AuditLogger.record(
            workspace_id="ws_acme",
            site_id="101",
            actor_id="user_1",
            execution_id="req_chain",
            action=AuditActionType.REQUEST_CREATED,
            connector="mock",
            resource_reference="/about",
            requested_operation="create",
            ledger=ledger,
        )
        AuditLogger.record(
            workspace_id="ws_acme",
            site_id="101",
            actor_id="user_1",
            execution_id="req_chain",
            action=AuditActionType.SAFETY_EVALUATED,
            connector="mock",
            resource_reference="/about",
            requested_operation="check_safety",
            ledger=ledger,
        )
        AuditLogger.record(
            workspace_id="ws_acme",
            site_id="101",
            actor_id="user_1",
            execution_id="req_chain",
            action=AuditActionType.APPLY_COMPLETED,
            connector="mock",
            resource_reference="/about",
            requested_operation="apply",
            ledger=ledger,
        )

        assert ledger.verify_integrity("req_chain") is True
        assert ledger.verify_integrity() is True


# =============================================================================
# 4. Rate Limiting Tests
# =============================================================================

class TestRateLimiter:

    def test_provider_429_records_wait_and_blocks(self):
        limiter = ConnectorRateLimiter(max_backoff_seconds=30.0)
        scope = limiter.build_scope_key("ws_1", "101", "mock")

        limiter.record_provider_429(scope, retry_after_seconds=3.0)
        is_limited, wait_sec = limiter.is_rate_limited(scope)
        assert is_limited is True
        assert 1.0 <= wait_sec <= 3.0

        with pytest.raises(RateLimitExceededError) as exc_info:
            limiter.check_and_record_request(scope)
        assert "Rate limit active" in str(exc_info.value)

    def test_bounded_rpm_sliding_window(self):
        limiter = ConnectorRateLimiter()
        scope = "ws_test:site_test:custom"
        limiter.set_limit(scope, requests_per_minute=3)

        # First 3 should succeed
        limiter.check_and_record_request(scope)
        limiter.check_and_record_request(scope)
        limiter.check_and_record_request(scope)

        # 4th should be blocked by rate limiter
        with pytest.raises(RateLimitExceededError):
            limiter.check_and_record_request(scope)


# =============================================================================
# 5. Centralized Retry Policy Tests
# =============================================================================

class TestRetryPolicy:

    def test_transient_error_retries_and_succeeds(self):
        policy = RetryPolicy(max_retries=3, initial_backoff_seconds=0.01, enable_sleep=False)
        attempts = 0

        def flaky_func():
            nonlocal attempts
            attempts += 1
            if attempts < 3:
                raise ConnectorNetworkError("Temporary socket drop")
            return "SUCCESS"

        result = policy.execute(flaky_func)
        assert result == "SUCCESS"
        assert attempts == 3

    def test_permanent_error_fails_fast_without_retry(self):
        policy = RetryPolicy(max_retries=5, enable_sleep=False)
        attempts = 0

        def permanent_fail():
            nonlocal attempts
            attempts += 1
            raise AuthenticationError("Invalid API Token")

        with pytest.raises(AuthenticationError):
            policy.execute(permanent_fail)

        assert attempts == 1  # Did NOT retry

    def test_max_retries_exhaustion_raises_final_error(self):
        policy = RetryPolicy(max_retries=2, initial_backoff_seconds=0.01, enable_sleep=False)
        attempts = 0

        def always_timeout():
            nonlocal attempts
            attempts += 1
            raise ConnectorTimeoutError("Timeout")

        with pytest.raises(ConnectorTimeoutError):
            policy.execute(always_timeout)

        assert attempts == 3  # initial attempt + 2 retries = 3 total


# =============================================================================
# 6. Bounded Timeout Tests
# =============================================================================

class TestTimeoutEnforcement:

    def test_operation_exceeding_timeout_raises_deterministic_error(self):
        def slow_connector_call():
            time.sleep(0.5)
            return "DONE"

        with pytest.raises(ConnectorTimeoutError) as exc_info:
            execute_with_timeout(slow_connector_call, timeout_seconds=0.05, operation_name="read_page")

        assert "timed out after 0.05 seconds" in str(exc_info.value)
        assert exc_info.value.code == ConnectorErrorCode.TIMEOUT

    def test_operation_within_timeout_returns_normally(self):
        def fast_call():
            return "FAST_OK"

        res = execute_with_timeout(fast_call, timeout_seconds=2.0)
        assert res == "FAST_OK"


# =============================================================================
# 7. Connector Health Tests
# =============================================================================

class TestConnectorHealth:

    def test_healthy_connector_check_does_not_mutate(self, mock_connector):
        initial_resources = len(mock_connector.resources)
        health = mock_connector.health_check()
        assert health.status == HealthStatus.HEALTHY
        assert health.auth_state == AuthState.CONNECTED
        # Invariant: health check must NOT mutate resources
        assert len(mock_connector.resources) == initial_resources

    def test_unhealthy_connector_reporting(self, mock_site_context):
        bad_context = mock_site_context.model_copy(update={"auth_state": AuthState.AUTH_FAILED})
        conn = MockConnector(site_context=bad_context)
        health = conn.health_check()
        assert health.status in (HealthStatus.UNHEALTHY, HealthStatus.DEGRADED)
        assert health.auth_state == AuthState.AUTH_FAILED


# =============================================================================
# 8. Concurrency Protection & Granular Resource Locking Tests
# =============================================================================

class TestConcurrencyAndLocking:

    def test_same_resource_concurrent_mutation_blocked(self):
        lock_mgr = ResourceLockManager()
        # Acquire lock for resource /about on workspace ws_1
        acquired1 = lock_mgr.acquire(
            lock_key="ws_1:site_1:mock:/about",
            owner_id="exec_A",
            ttl_seconds=10.0,
        )
        assert acquired1 is True

        # Second concurrent execution attempting the same resource must fail
        acquired2 = lock_mgr.acquire(
            lock_key="ws_1:site_1:mock:/about",
            owner_id="exec_B",
            ttl_seconds=10.0,
        )
        assert acquired2 is False

        # Unrelated resource /contact on the same site must succeed (no global bottleneck!)
        acquired3 = lock_mgr.acquire(
            lock_key="ws_1:site_1:mock:/contact",
            owner_id="exec_C",
            ttl_seconds=10.0,
        )
        assert acquired3 is True

        # Release first lock
        lock_mgr.release("ws_1:site_1:mock:/about", "exec_A")
        # Now exec_B can acquire
        acquired2_retry = lock_mgr.acquire(
            lock_key="ws_1:site_1:mock:/about",
            owner_id="exec_B",
            ttl_seconds=10.0,
        )
        assert acquired2_retry is True

    def test_context_manager_raises_concurrency_conflict(self):
        lock_mgr = ResourceLockManager()
        lock_key = "ws_1:site_1:mock:/pricing"
        lock_mgr.acquire(lock_key, "owner_1", ttl_seconds=10.0)

        with pytest.raises(ConcurrencyConflictError):
            with ResourceLock(lock_mgr, lock_key, "owner_2"):
                pass


# =============================================================================
# 9. Idempotency Tests
# =============================================================================

class TestIdempotency:

    def test_repeated_apply_request_returns_existing_result_without_duplicate_mutation(
        self, mock_site_context, mock_resource, mock_proposal, mock_connector
    ):
        engine = ExecutionEngine()
        req = engine.create_request(
            site_context=mock_site_context,
            resource=mock_resource,
            operation=ExecutionOperationType.APPLY_CHANGE,
            safety_tier=SafetyTier.AUTO_SAFE,
            change_proposal=mock_proposal,
            idempotency_key="idemp_100",
        )

        res1 = engine.apply_execution(request=req, connector=mock_connector)
        assert res1.status == ExecutionStatus.APPLIED
        mutation_count_before = len(mock_connector.applied_operations)

        # Second identical call
        res2 = engine.apply_execution(request=req, connector=mock_connector)
        assert res2.status == ExecutionStatus.APPLIED
        assert res2.request_id == res1.request_id
        # Invariant: connector was NOT called a second time
        assert len(mock_connector.applied_operations) == mutation_count_before

    def test_repeated_rollback_is_idempotent(
        self, mock_site_context, mock_resource, mock_proposal, mock_connector
    ):
        engine = ExecutionEngine()
        req = engine.create_request(
            site_context=mock_site_context,
            resource=mock_resource,
            operation=ExecutionOperationType.APPLY_CHANGE,
            safety_tier=SafetyTier.AUTO_SAFE,
            change_proposal=mock_proposal,
        )
        engine.apply_execution(request=req, connector=mock_connector)

        # First rollback
        rb1 = engine.rollback_execution(request_id=req.request_id, connector=mock_connector)
        assert rb1.status == ExecutionStatus.ROLLED_BACK
        rb_count_before = len(mock_connector.applied_operations)

        # Second rollback
        rb2 = engine.rollback_execution(request_id=req.request_id, connector=mock_connector)
        assert rb2.status == ExecutionStatus.ROLLED_BACK
        assert len(mock_connector.applied_operations) == rb_count_before


# =============================================================================
# 10. Worker Failure Recovery & Ambiguous State Tests
# =============================================================================

class TestWorkerRecovery:

    def test_crash_during_planned_or_safety_checked_allows_restart(self, mock_site_context, mock_resource):
        req = ExecutionRequest(
            operation=ExecutionOperationType.APPLY_CHANGE,
            target=ExecutionTarget(site_context=mock_site_context, resource=mock_resource),
        )
        record = ExecutionRecord(request=req, state=ExecutionLifecycleState.SAFETY_CHECKED)

        decision = WorkerRecoveryManager.inspect_and_recover(record)
        assert decision.recommended_action == RecoveryAction.RESTART_EVALUATION
        assert decision.requires_human_intervention is False

    def test_crash_during_applying_ambiguous_state_transitions_to_manual_review(
        self, mock_site_context, mock_resource, mock_proposal, mock_connector
    ):
        req = ExecutionRequest(
            operation=ExecutionOperationType.APPLY_CHANGE,
            target=ExecutionTarget(site_context=mock_site_context, resource=mock_resource),
            change_proposal=mock_proposal,
        )
        # Simulate worker died mid-apply while in APPLYING state
        record = ExecutionRecord(request=req, state=ExecutionLifecycleState.APPLYING)

        decision = WorkerRecoveryManager.inspect_and_recover(record, connector=mock_connector)
        # Must NEVER blindly re-apply!
        assert decision.recommended_action == RecoveryAction.MARK_MANUAL_REVIEW
        assert decision.target_state == ExecutionLifecycleState.MANUAL_REVIEW_REQUIRED
        assert decision.requires_human_intervention is True
        assert record.state == ExecutionLifecycleState.MANUAL_REVIEW_REQUIRED

    def test_crash_during_validation_allows_resuming_validation(
        self, mock_site_context, mock_resource, mock_proposal
    ):
        req = ExecutionRequest(
            operation=ExecutionOperationType.APPLY_CHANGE,
            target=ExecutionTarget(site_context=mock_site_context, resource=mock_resource),
            change_proposal=mock_proposal,
        )
        record = ExecutionRecord(request=req, state=ExecutionLifecycleState.VALIDATING)

        decision = WorkerRecoveryManager.inspect_and_recover(record)
        assert decision.recommended_action == RecoveryAction.RESUME_VALIDATION


# =============================================================================
# 11. Security Boundary & SSRF Protection Tests
# =============================================================================

class TestSecurityBoundariesAndSSRF:

    def test_ssrf_rejects_localhost_and_private_ips(self):
        blocked_urls = [
            "http://localhost/admin",
            "http://127.0.0.1:8080/metrics",
            "http://169.254.169.254/latest/meta-data/",
            "http://10.0.0.1/internal-api",
            "http://192.168.1.1/router",
            "http://172.16.0.5/secret",
            "http://[::1]/",
            "ftp://example.com/file",
            "file:///etc/passwd",
            "gopher://example.com:70/",
        ]
        for url in blocked_urls:
            with pytest.raises(SSRFValidationError):
                SSRFValidator.validate_url(url)

    def test_ssrf_allows_legitimate_public_urls(self):
        valid_urls = [
            "https://example.com/about",
            "https://my-store.com/products/shoes",
            "http://public-site.org/sitemap.xml",
        ]
        for url in valid_urls:
            validated = SSRFValidator.validate_url(url)
            assert validated == url

    def test_security_boundary_rejects_path_traversal(self):
        traversal_paths = [
            "../../../etc/passwd",
            "..\\..\\Windows\\System32",
            "/etc/shadow",
            "pages/../../secret.txt",
        ]
        for path in traversal_paths:
            with pytest.raises(ConnectorValidationError):
                SecurityBoundaryValidator.validate_resource_path(path)

    def test_security_boundary_rejects_dangerous_shell_and_php_injections(self):
        dangerous_paths = [
            "post-title; rm -rf /",
            "page && sudo reboot",
            "test | cat /etc/passwd",
            "script.sh",
            "evil.php",
            "binary.exe",
        ]
        for p in dangerous_paths:
            with pytest.raises((ConnectorValidationError, UnsupportedOperationError)):
                SecurityBoundaryValidator.validate_resource_path(p)

    def test_security_boundary_rejects_executable_php_and_eval_in_payloads(self):
        bad_payloads = [
            "<?php system('id'); ?>",
            "Hello world <script>eval('alert(1)')</script>",
            "Update: eval(base64_decode('...'))",
        ]
        for payload in bad_payloads:
            with pytest.raises(ConnectorValidationError):
                SecurityBoundaryValidator.validate_content_payload(payload)


# =============================================================================
# 12. State Machine Reliability & Transition Guarantees
# =============================================================================

class TestStateMachineReliability:

    def test_illegal_transition_raises_error(self, mock_site_context, mock_resource):
        req = ExecutionRequest(
            operation=ExecutionOperationType.APPLY_CHANGE,
            target=ExecutionTarget(site_context=mock_site_context, resource=mock_resource),
        )
        record = ExecutionRecord(request=req, state=ExecutionLifecycleState.PLANNED)

        # Cannot jump straight from PLANNED to VERIFIED or KEPT!
        with pytest.raises(InvalidStateTransitionError):
            ExecutionStateMachine.transition(record, ExecutionLifecycleState.VERIFIED)

        with pytest.raises(InvalidStateTransitionError):
            ExecutionStateMachine.transition(record, ExecutionLifecycleState.KEPT)

    def test_failed_state_cannot_silently_transition_to_verified(self, mock_site_context, mock_resource):
        req = ExecutionRequest(
            operation=ExecutionOperationType.APPLY_CHANGE,
            target=ExecutionTarget(site_context=mock_site_context, resource=mock_resource),
        )
        record = ExecutionRecord(request=req, state=ExecutionLifecycleState.FAILED)

        with pytest.raises(InvalidStateTransitionError):
            ExecutionStateMachine.transition(record, ExecutionLifecycleState.VERIFIED)

    def test_unauthorized_status_query_denied(self, mock_site_context, mock_resource, mock_proposal):
        engine = ExecutionEngine()
        auth_owner = AuthorizationContext(
            workspace_id="ws_acme",
            site_id="101",
            actor_id="admin_1",
        )
        req = engine.create_request(
            site_context=mock_site_context,
            resource=mock_resource,
            change_proposal=mock_proposal,
            auth_context=auth_owner,
        )

        intruder_auth = AuthorizationContext(
            workspace_id="ws_evil",
            site_id="101",
            actor_id="intruder",
        )
        with pytest.raises(AuthorizationError):
            engine.get_execution(req.request_id, auth_context=intruder_auth)

    def test_backoff_calculation_exponential(self):
        policy = RetryPolicy(
            max_retries=5,
            initial_backoff_seconds=1.0,
            backoff_multiplier=2.0,
            max_backoff_seconds=10.0,
        )
        assert policy.calculate_backoff(1) == 1.0
        assert policy.calculate_backoff(2) == 2.0
        assert policy.calculate_backoff(3) == 4.0
        assert policy.calculate_backoff(4) == 8.0
        assert policy.calculate_backoff(5) == 10.0  # Clamped to max_backoff_seconds

    def test_rescan_and_rollback_recovery_states(self, mock_site_context, mock_resource):
        req = ExecutionRequest(
            operation=ExecutionOperationType.APPLY_CHANGE,
            target=ExecutionTarget(site_context=mock_site_context, resource=mock_resource),
        )
        # Rescan failure
        rec_rescan = ExecutionRecord(request=req, state=ExecutionLifecycleState.RESCANNING)
        dec_rescan = WorkerRecoveryManager.inspect_and_recover(rec_rescan)
        assert dec_rescan.recommended_action == RecoveryAction.RESUME_VALIDATION

        # Rollback failure
        rec_rb = ExecutionRecord(request=req, state=ExecutionLifecycleState.ROLLBACK_FAILED)
        dec_rb = WorkerRecoveryManager.inspect_and_recover(rec_rb)
        assert dec_rb.recommended_action == RecoveryAction.MARK_MANUAL_REVIEW
        assert dec_rb.requires_human_intervention is True
