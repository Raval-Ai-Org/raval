"""
Unit and integration tests for AI Search Provider Adapter Architecture (Task 10 Step 2).
"""

import time
from datetime import datetime, timezone
import pytest

from app.provider_adapter import (
    ALLOWED_PROVIDERS,
    BaseProviderAdapter,
    ClaudeAdapter,
    CopilotAdapter,
    GeminiAdapter,
    MockProviderAdapter,
    OpenAIAdapter,
    PerplexityAdapter,
    ProviderConfig,
    ProviderRegistry,
    ProviderRequest,
    ProviderResponse,
    ResponseStatus,
    UsageMetadata,
    provider_registry,
)


def test_allowed_providers_set():
    expected = {"mock", "openai", "perplexity", "gemini", "claude", "copilot"}
    assert ALLOWED_PROVIDERS == expected


def test_provider_registry_defaults():
    registry = ProviderRegistry()
    providers = registry.list_providers()
    provider_names = {p["provider_name"] for p in providers}
    assert provider_names == {"mock", "openai", "perplexity", "gemini", "claude", "copilot"}

    # Mock should be configured and marked as MOCK_ONLY
    mock_info = next(p for p in providers if p["provider_name"] == "mock")
    assert mock_info["is_mock"] is True
    assert mock_info["is_configured"] is True
    assert mock_info["status"] == "MOCK_ONLY"

    # Real providers without env vars should be NOT_CONFIGURED
    openai_info = next(p for p in providers if p["provider_name"] == "openai")
    assert openai_info["is_mock"] is False
    assert openai_info["status"] in ("CONFIGURED", "NOT_CONFIGURED")


def test_provider_registry_resolution_and_validation():
    registry = ProviderRegistry()
    mock_adapter = registry.get("mock")
    assert isinstance(mock_adapter, MockProviderAdapter)

    with pytest.raises(ValueError, match="Unknown AI provider 'unsupported_engine'"):
        registry.get("unsupported_engine")

    # Reject registering provider outside allowlist
    class BadAdapter(BaseProviderAdapter):
        @property
        def provider_name(self) -> str:
            return "rogue_ai"

        @property
        def default_model(self) -> str:
            return "v1"

        def _default_config(self) -> ProviderConfig:
            return ProviderConfig(provider_name="rogue_ai")

        def _call_provider(self, query_text, model, timeout_seconds):
            return "text", None, {}

    with pytest.raises(ValueError, match="not in the allowlist"):
        registry.register(BadAdapter())


def test_mock_provider_successful_execution():
    adapter = MockProviderAdapter(custom_response_text="Generative AI search result for testing.")
    req = ProviderRequest(
        query_id=101,
        query_text="What is Generative Engine Optimization?",
        query_set_id=1,
        website_id=1,
        provider="mock",
    )

    resp = adapter.execute_query(req)
    assert resp.status == ResponseStatus.SUCCESS
    assert resp.query_id == 101
    assert resp.provider == "mock"
    assert resp.response_text == "Generative AI search result for testing."
    assert resp.latency_ms >= 0
    assert resp.error_type is None
    assert resp.error_message is None
    assert resp.usage is not None
    assert resp.usage.total_tokens > 0
    assert resp.result_id.startswith("resp_101_mock_")


def test_mock_provider_timeout_handling():
    adapter = MockProviderAdapter(failure_mode="timeout")
    req = ProviderRequest(
        query_id=102,
        query_text="How to improve AI visibility?",
        query_set_id=1,
        website_id=1,
        provider="mock",
        max_retries=1,
    )

    resp = adapter.execute_query(req)
    assert resp.status == ResponseStatus.TIMEOUT
    assert resp.response_text == ""
    assert resp.error_type == "TIMEOUT"
    assert "timed out" in resp.error_message.lower()


def test_mock_provider_rate_limit_handling():
    adapter = MockProviderAdapter(failure_mode="rate_limit")
    req = ProviderRequest(
        query_id=103,
        query_text="Top tools for GEO?",
        query_set_id=1,
        website_id=1,
        provider="mock",
        max_retries=0,
    )

    resp = adapter.execute_query(req)
    assert resp.status == ResponseStatus.RATE_LIMITED
    assert resp.response_text == ""
    assert resp.error_type == "RATE_LIMITED"
    assert "rate limit" in resp.error_message.lower()


def test_mock_provider_unavailable_handling():
    adapter = MockProviderAdapter(failure_mode="unavailable")
    req = ProviderRequest(
        query_id=104,
        query_text="Brand vs Competitor",
        query_set_id=1,
        website_id=1,
        provider="mock",
        max_retries=0,
    )

    resp = adapter.execute_query(req)
    assert resp.status == ResponseStatus.UNAVAILABLE
    assert resp.response_text == ""
    assert resp.error_type == "UNAVAILABLE"


def test_mock_provider_error_handling():
    adapter = MockProviderAdapter(failure_mode="error")
    req = ProviderRequest(
        query_id=105,
        query_text="Pricing models?",
        query_set_id=1,
        website_id=1,
        provider="mock",
        max_retries=1,
    )

    resp = adapter.execute_query(req)
    assert resp.status == ResponseStatus.ERROR
    assert resp.response_text == ""
    assert resp.error_type == "HTTP_500"


def test_mock_provider_auth_error_non_retryable():
    adapter = MockProviderAdapter(failure_mode="auth_error")
    req = ProviderRequest(
        query_id=106,
        query_text="Test auth error",
        query_set_id=1,
        website_id=1,
        provider="mock",
        max_retries=3,
    )

    # Auth error should fail immediately without spinning through retries
    start = time.perf_counter()
    resp = adapter.execute_query(req)
    duration = time.perf_counter() - start
    assert resp.status == ResponseStatus.UNAVAILABLE
    assert resp.error_type == "AUTHENTICATION_FAILURE"
    assert duration < 1.0


def test_unconfigured_real_providers_safe_response():
    # When api_key is None, real adapters should return UNAVAILABLE / MISSING_CREDENTIALS safely
    unconfigured_openai = OpenAIAdapter(
        config=ProviderConfig(provider_name="openai", api_key=None)
    )
    req = ProviderRequest(
        query_id=201,
        query_text="Real provider test",
        query_set_id=1,
        website_id=1,
        provider="openai",
    )

    resp = unconfigured_openai.execute_query(req)
    assert resp.status == ResponseStatus.UNAVAILABLE
    assert resp.error_type == "MISSING_CREDENTIALS"
    assert "not configured" in resp.error_message.lower()
    assert resp.response_text == ""


def test_disabled_provider_response():
    disabled_mock = MockProviderAdapter(
        config=ProviderConfig(provider_name="mock", enabled=False)
    )
    req = ProviderRequest(
        query_id=202,
        query_text="Disabled provider test",
        query_set_id=1,
        website_id=1,
        provider="mock",
    )

    resp = disabled_mock.execute_query(req)
    assert resp.status == ResponseStatus.UNAVAILABLE
    assert resp.error_type == "PROVIDER_DISABLED"
    assert "disabled" in resp.error_message.lower()


def test_security_secrets_not_in_metadata_or_response():
    config = ProviderConfig(provider_name="mock", api_key="sk-secret-key-12345")
    adapter = MockProviderAdapter(config=config)
    req = ProviderRequest(
        query_id=203,
        query_text="Secret leak check",
        query_set_id=1,
        website_id=1,
        provider="mock",
    )
    resp = adapter.execute_query(req)

    # Verify secret is not leaked in response text or metadata
    assert "sk-secret" not in resp.response_text
    assert "sk-secret" not in str(resp.metadata_json)
    assert "sk-secret" not in str(resp.error_message or "")
