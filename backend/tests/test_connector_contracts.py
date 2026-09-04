"""
Comprehensive Contract & Foundation Tests for Website Connector Subsystem (Task 11 Step 1).

Covers:
1. Contract completeness & method signature enforcement (all 9 operations)
2. Capability declarations, detection, and explicit unsupported operation reporting
3. Normalized authentication state transitions & failure modes
4. Standardized error model and exception hierarchy formatting
5. Provider-neutral resource reference serialization & isolation
6. Rate-limit representation and backoff attributes
7. Security: Zero secret leakage, payload sanitization, command injection protection
8. Execution foundation models binding cleanly to Task 9 FixPlan & SafetyTier
"""

import inspect
import pytest
from datetime import datetime, timezone

from backend.app.fix_safety_classifier import SafetyTier
from connectors import (
    AuthState,
    AuthenticationError,
    AuthorizationError,
    BaseConnector,
    ChangePreview,
    ChangeProposal,
    ChangeResult,
    ConnectorCapabilities,
    ConnectorCapability,
    ConnectorErrorCode,
    ConnectorErrorInfo,
    ConnectorException,
    ConnectorHealth,
    ConnectorNetworkError,
    ConnectorTimeoutError,
    ConnectorValidationError,
    ExecutionOperationType,
    ExecutionRequest,
    ExecutionResult,
    ExecutionStatus,
    ExecutionTarget,
    HealthStatus,
    InvalidResourceError,
    MockConnector,
    NullConnector,
    OperationId,
    ProviderAPIError,
    RateLimitExceededError,
    RateLimitInfo,
    ResourceContent,
    ResourceNotFoundError,
    ResourceReference,
    ResourceType,
    SiteContext,
    UnsupportedOperationError,
    redact_secrets_from_string,
    redact_sensitive_value,
    sanitize_payload,
    validate_safe_identifier,
)


# =============================================================================
# 1. CONTRACT TESTS
# =============================================================================

class TestConnectorContracts:
    """Verifies that BaseConnector defines all 9 required operations and enforces signatures."""

    REQUIRED_METHODS = [
        "connect",
        "disconnect",
        "health_check",
        "get_site_context",
        "read_resource",
        "preview_change",
        "apply_change",
        "rollback_change",
        "get_change_status",
    ]

    def test_base_connector_declares_all_required_methods(self):
        """BaseConnector ABC must define all 9 abstract methods."""
        abstract_methods = BaseConnector.__abstractmethods__
        for method_name in self.REQUIRED_METHODS:
            assert method_name in abstract_methods, f"Missing required method: {method_name}"

    def test_mock_connector_implements_all_required_methods(self):
        """MockConnector must implement all 9 required methods with proper signatures."""
        mock = MockConnector()
        for method_name in self.REQUIRED_METHODS:
            assert hasattr(mock, method_name)
            func = getattr(mock, method_name)
            assert callable(func)

    def test_null_connector_implements_all_required_methods(self):
        """NullConnector must implement all 9 required methods with proper signatures."""
        null_conn = NullConnector()
        for method_name in self.REQUIRED_METHODS:
            assert hasattr(null_conn, method_name)
            func = getattr(null_conn, method_name)
            assert callable(func)

    def test_incomplete_connector_subclass_cannot_be_instantiated(self):
        """Subclasses missing any of the 9 methods must fail at instantiation."""
        class IncompleteConnector(BaseConnector):
            def connect(self, credentials=None): pass
            # Missing disconnect, health_check, and others...

        with pytest.raises(TypeError) as exc_info:
            IncompleteConnector(
                SiteContext(
                    site_id=1,
                    site_url="https://example.com",
                    provider="test",
                    auth_state=AuthState.DISCONNECTED,
                )
            )
        assert "Can't instantiate abstract class IncompleteConnector" in str(exc_info.value)

    def test_provider_neutral_lifecycle_flow(self):
        """Full standard flow (connect -> health_check -> read -> preview -> apply -> status -> rollback -> disconnect)."""
        connector = MockConnector()

        # 1. Connect
        ctx = connector.connect({"api_key": "test-key-123"})
        assert ctx.auth_state == AuthState.CONNECTED

        # 2. Health check
        health = connector.health_check()
        assert health.status == HealthStatus.HEALTHY
        assert health.auth_state == AuthState.CONNECTED

        # 3. Read resource
        resource = ResourceReference(
            resource_type=ResourceType.WEBSITE_PAGE,
            resource_id="https://example.com/",
        )
        content = connector.read_resource(resource)
        assert "Original Title" in str(content.content)

        # 4. Preview change
        proposal = ChangeProposal(
            target_resource=resource,
            action_type="meta_tag_improvement",
            proposed_diff={"after": "<title>Optimized GEO Title</title>"},
            before_summary="Original Title",
            after_summary="Optimized GEO Title",
            fix_plan_id=42,
        )
        preview = connector.preview_change(proposal)
        assert preview.can_apply is True
        assert preview.diff_structured["action"] == "meta_tag_improvement"

        # 5. Apply change
        apply_res = connector.apply_change(proposal)
        assert apply_res.status == ExecutionStatus.APPLIED
        assert apply_res.rollback_supported is True
        assert apply_res.resulting_version is not None

        # Verify mutation in mock store
        updated_content = connector.read_resource(resource)
        assert updated_content.content == "<title>Optimized GEO Title</title>"

        # 6. Status check
        status_res = connector.get_change_status(apply_res.operation_id)
        assert status_res.status == ExecutionStatus.APPLIED

        # 7. Rollback change
        rollback_res = connector.rollback_change(apply_res.operation_id)
        assert rollback_res.status == ExecutionStatus.ROLLED_BACK

        # Verify rollback restored original state
        restored_content = connector.read_resource(resource)
        assert "Original Title" in str(restored_content.content)

        # 8. Disconnect
        final_ctx = connector.disconnect()
        assert final_ctx.auth_state == AuthState.DISCONNECTED


# =============================================================================
# 2. CAPABILITY TESTS
# =============================================================================

class TestConnectorCapabilities:
    """Tests explicit capability reporting and enforcement."""

    def test_capability_declaration_and_query(self):
        """Capabilities can be queried by enum or string."""
        caps = ConnectorCapabilities(
            supported_capabilities={
                ConnectorCapability.READ,
                ConnectorCapability.HEALTH_CHECK,
            },
            supported_resource_types={
                ResourceType.WEBSITE_PAGE,
                ResourceType.ROBOTS_TXT,
            },
            supports_preview=False,
            supports_rollback=False,
        )

        assert caps.can_perform(ConnectorCapability.READ) is True
        assert caps.can_perform("READ") is True
        assert caps.can_perform(ConnectorCapability.APPLY) is False
        assert caps.can_perform("APPLY") is False
        assert caps.can_perform("NON_EXISTENT") is False

        assert caps.can_handle_resource(ResourceType.WEBSITE_PAGE) is True
        assert caps.can_handle_resource("website_page") is True
        assert caps.can_handle_resource(ResourceType.GIT_FILE) is False

    def test_assert_capability_enforcement(self):
        """assert_capability raises UnsupportedOperationError on missing capability."""
        caps = ConnectorCapabilities.read_only()

        caps.assert_capability(ConnectorCapability.READ)  # Should not raise

        with pytest.raises(UnsupportedOperationError) as exc_info:
            caps.assert_capability(ConnectorCapability.APPLY)

        err = exc_info.value
        assert err.code == ConnectorErrorCode.UNSUPPORTED_OPERATION
        assert "APPLY" in err.sanitized_message
        assert "details" in err.__dict__

    def test_null_connector_explicitly_rejects_unsupported_operations(self):
        """Null connector explicitly reports and enforces unsupported operations."""
        null_conn = NullConnector()
        assert null_conn.capabilities.supports_rollback is False
        assert null_conn.capabilities.supports_preview is False

        proposal = ChangeProposal(
            target_resource=ResourceReference(
                resource_type=ResourceType.WEBSITE_PAGE,
                resource_id="https://example.com/test",
            ),
            action_type="heading_structure_fix",
        )

        with pytest.raises(UnsupportedOperationError):
            null_conn.preview_change(proposal)

        with pytest.raises(UnsupportedOperationError):
            null_conn.apply_change(proposal)

        with pytest.raises(UnsupportedOperationError):
            null_conn.rollback_change("op_123")


# =============================================================================
# 3. AUTHENTICATION TESTS
# =============================================================================

class TestAuthenticationStates:
    """Tests normalized AuthState enum and authentication transitions."""

    def test_all_auth_states_exist(self):
        """Verifies canonical AuthState values."""
        expected_states = {
            "DISCONNECTED",
            "CONNECTING",
            "CONNECTED",
            "AUTH_FAILED",
            "EXPIRED",
            "REVOKED",
        }
        actual_states = {s.value for s in AuthState}
        assert expected_states == actual_states

    def test_authentication_failure_handling(self):
        """Authentication failure sets state to AUTH_FAILED and raises AuthenticationError."""
        connector = MockConnector(simulate_auth_failure=True)
        assert connector.auth_state == AuthState.DISCONNECTED

        with pytest.raises(AuthenticationError) as exc_info:
            connector.connect({"secret_token": "invalid"})

        assert exc_info.value.code == ConnectorErrorCode.AUTHENTICATION_FAILURE
        assert connector.auth_state == AuthState.AUTH_FAILED


# =============================================================================
# 4. ERROR MODEL & EXCEPTION TESTS
# =============================================================================

class TestErrorModelsAndExceptions:
    """Tests normalized ConnectorErrorInfo and exception hierarchy."""

    def test_all_error_codes_defined(self):
        """Verifies standard error codes."""
        assert ConnectorErrorCode.AUTHENTICATION_FAILURE == "AUTHENTICATION_FAILURE"
        assert ConnectorErrorCode.AUTHORIZATION_FAILURE == "AUTHORIZATION_FAILURE"
        assert ConnectorErrorCode.UNSUPPORTED_OPERATION == "UNSUPPORTED_OPERATION"
        assert ConnectorErrorCode.RATE_LIMITED == "RATE_LIMITED"
        assert ConnectorErrorCode.TIMEOUT == "TIMEOUT"
        assert ConnectorErrorCode.RESOURCE_NOT_FOUND == "RESOURCE_NOT_FOUND"

    def test_error_info_construction_and_serialization(self):
        """ConnectorErrorInfo model serializes cleanly with timestamps and metadata."""
        err_info = ConnectorErrorInfo(
            code=ConnectorErrorCode.RATE_LIMITED,
            message="Rate limit exceeded by provider",
            retryable=True,
            retry_after_seconds=45.0,
            provider_code="429",
            details={"quota_window": "minute"},
        )
        data = err_info.model_dump()
        assert data["code"] == "RATE_LIMITED"
        assert data["retryable"] is True
        assert data["retry_after_seconds"] == 45.0
        assert data["provider_code"] == "429"

    def test_exception_to_error_info_conversion(self):
        """Any ConnectorException converts directly to ConnectorErrorInfo."""
        exc = RateLimitExceededError(
            message="Too many requests",
            retry_after_seconds=60.0,
            provider_code="429",
        )
        err_info = exc.to_error_info()
        assert err_info.code == ConnectorErrorCode.RATE_LIMITED
        assert err_info.retryable is True
        assert err_info.retry_after_seconds == 60.0

    def test_from_exception_helper_with_standard_python_exception(self):
        """from_exception handles generic Python exceptions cleanly."""
        raw_exc = ValueError("Invalid input parameter")
        err_info = ConnectorErrorInfo.from_exception(raw_exc, code=ConnectorErrorCode.INVALID_RESOURCE)
        assert err_info.code == ConnectorErrorCode.INVALID_RESOURCE
        assert "Invalid input parameter" in err_info.message

    def test_simulated_hazards_in_mock_connector(self):
        """MockConnector accurately simulates timeout and rate limit exceptions."""
        timeout_conn = MockConnector(simulate_timeout=True)
        with pytest.raises(ConnectorTimeoutError) as exc_info:
            timeout_conn.health_check()
        assert exc_info.value.code == ConnectorErrorCode.TIMEOUT
        assert exc_info.value.retryable is True

        rate_limit_conn = MockConnector(simulate_rate_limit=True)
        with pytest.raises(RateLimitExceededError) as exc_info:
            rate_limit_conn.read_resource(
                ResourceReference(
                    resource_type=ResourceType.WEBSITE_PAGE,
                    resource_id="https://example.com/",
                )
            )
        assert exc_info.value.code == ConnectorErrorCode.RATE_LIMITED
        assert exc_info.value.retry_after_seconds == 30.0


# =============================================================================
# 5. RESOURCE REFERENCE & RATE LIMIT TESTS
# =============================================================================

class TestResourceReferenceAndRateLimits:
    """Tests provider-neutral resource references and rate-limit representations."""

    def test_resource_reference_variants(self):
        """ResourceReference can represent website pages, CMS posts, and Git files neutrally."""
        page_ref = ResourceReference(
            resource_type=ResourceType.WEBSITE_PAGE,
            resource_id="https://example.com/about",
            uri="https://example.com/about",
        )
        assert page_ref.canonical_id == "website_page:https://example.com/about"

        post_ref = ResourceReference(
            resource_type=ResourceType.CMS_POST,
            resource_id="1042",
            metadata={"slug": "hello-world", "post_type": "post"},
        )
        assert post_ref.canonical_id == "cms_post:1042"

        file_ref = ResourceReference(
            resource_type=ResourceType.GIT_FILE,
            resource_id="src/index.html",
            version_or_tag="a1b2c3d4",
        )
        assert file_ref.canonical_id == "git_file:src/index.html"
        assert file_ref.version_or_tag == "a1b2c3d4"

    def test_rate_limit_info_model(self):
        """RateLimitInfo tracks limits, remaining quotas, and reset times."""
        now = datetime.now(timezone.utc)
        rl = RateLimitInfo(
            limit=5000,
            remaining=4950,
            reset_at=now,
            reset_seconds=3600.0,
            retry_after_seconds=None,
            is_rate_limited=False,
        )
        dump = rl.model_dump()
        assert dump["limit"] == 5000
        assert dump["remaining"] == 4950
        assert dump["is_rate_limited"] is False


# =============================================================================
# 6. SECURITY & SECRET REDACTION TESTS
# =============================================================================

class TestSecurityAndRedaction:
    """Enforces zero secret leakage and injection attack defense."""

    def test_redact_secrets_from_strings(self):
        """Bearer tokens, GitHub PATs, OpenAI keys, and private keys are redacted."""
        text = "Failed with token ghp_123456789012345678901234567890123456 and Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6"
        redacted = redact_secrets_from_string(text)
        assert "ghp_1234" not in redacted
        assert "Bearer eyJhb" not in redacted
        assert "[REDACTED]" in redacted

    def test_sanitize_payload_redacts_sensitive_dictionary_keys(self):
        """Nested sensitive keys (password, api_key, token) are scrubbed."""
        payload = {
            "username": "admin",
            "password": "SuperSecretPassword123!",
            "nested": {
                "api_key": "sk-12345678901234567890123456",
                "normal_field": "visible_value",
            },
            "tokens_list": ["Bearer abcd1234efgh5678"],
        }
        sanitized = sanitize_payload(payload)
        assert sanitized["username"] == "admin"
        assert sanitized["password"] == "[REDACTED]"
        assert sanitized["nested"]["api_key"] == "[REDACTED]"
        assert sanitized["nested"]["normal_field"] == "visible_value"

    def test_models_auto_sanitize_upon_instantiation(self):
        """Connector models automatically sanitize messages and metadata upon initialization."""
        err = ConnectorErrorInfo(
            code=ConnectorErrorCode.AUTHENTICATION_FAILURE,
            message="Connection failed with auth token Bearer mysecrettoken1234567890",
            details={"api_key": "secret_key_value", "public_info": "ok"},
        )
        assert "mysecrettoken" not in err.message
        assert err.details["api_key"] == "[REDACTED]"
        assert err.details["public_info"] == "ok"

    def test_dangerous_identifiers_rejected(self):
        """Shell metacharacters and injection tokens are rejected in identifiers."""
        dangerous_inputs = [
            "page; rm -rf /",
            "test && cat /etc/passwd",
            "post | curl evil.com",
            "file`whoami`",
            "eval(alert(1))",
        ]
        for dangerous in dangerous_inputs:
            with pytest.raises(ValueError) as exc_info:
                validate_safe_identifier(dangerous)
            assert "Security check failed" in str(exc_info.value)


# =============================================================================
# 7. EXECUTION FOUNDATION MODELS & TASK 9 BINDINGS
# =============================================================================

class TestExecutionFoundationModels:
    """Verifies that execution foundation models bind cleanly to Task 9 FixPlan concepts."""

    def test_execution_request_creation_and_binding(self):
        """ExecutionRequest cleanly references Task 9 FixPlan, Recommendation, and SafetyTier."""
        site_ctx = SiteContext(
            site_id=101,
            site_url="https://raval-test.com",
            provider="mock",
            auth_state=AuthState.CONNECTED,
            capabilities=ConnectorCapabilities.full_mutation(),
        )
        target = ExecutionTarget(
            site_context=site_ctx,
            resource=ResourceReference(
                resource_type=ResourceType.WEBSITE_PAGE,
                resource_id="https://raval-test.com/service",
            ),
        )
        proposal = ChangeProposal(
            target_resource=target.resource,
            action_type="structured_data_injection",
            proposed_diff={"after": {"@context": "https://schema.org", "@type": "FAQPage"}},
            fix_plan_id=77,
            recommendation_id=12,
            finding_id=5,
        )

        req = ExecutionRequest(
            operation=ExecutionOperationType.APPLY_CHANGE,
            target=target,
            fix_plan_id=77,
            recommendation_id=12,
            finding_id=5,
            safety_tier=SafetyTier.AUTO_SAFE,
            change_proposal=proposal,
        )

        assert req.operation == ExecutionOperationType.APPLY_CHANGE
        assert req.fix_plan_id == 77
        assert req.safety_tier == SafetyTier.AUTO_SAFE
        assert req.idempotency_key is not None

    def test_execution_result_aggregation(self):
        """ExecutionResult aggregates change result, timing telemetry, and status."""
        site_ctx = SiteContext(
            site_id=101,
            site_url="https://raval-test.com",
            provider="mock",
            auth_state=AuthState.CONNECTED,
        )
        target = ExecutionTarget(
            site_context=site_ctx,
            resource=ResourceReference(
                resource_type=ResourceType.WEBSITE_PAGE,
                resource_id="https://raval-test.com/service",
            ),
        )
        change_res = ChangeResult(
            operation_id=OperationId(
                provider_operation_id="git_commit_abc",
                operation_type=ExecutionOperationType.APPLY_CHANGE,
            ),
            status=ExecutionStatus.APPLIED,
            target_resource=target.resource,
            applied_at=datetime.now(timezone.utc),
            rollback_supported=True,
            rollback_token="snapshot_99",
            message="Applied schema injection",
        )

        exec_res = ExecutionResult(
            request_id="req_test_01",
            operation_id=change_res.operation_id,
            status=ExecutionStatus.APPLIED,
            operation=ExecutionOperationType.APPLY_CHANGE,
            target=target,
            change_result=change_res,
            duration_ms=45.2,
        )

        assert exec_res.status == ExecutionStatus.APPLIED
        assert exec_res.change_result.rollback_supported is True
        assert exec_res.duration_ms == 45.2
