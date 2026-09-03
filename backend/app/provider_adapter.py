"""
Provider Adapter Architecture & AI Search Response Capture Subsystem (Task 10 Step 2).

Provides an extensible, secure, and provider-agnostic interface to execute
queries from QuerySets against AI search engines (OpenAI, Perplexity, Gemini,
Claude, Copilot, and Mock providers), capturing raw and normalized response evidence,
measuring latency, tracking token usage, and handling errors/retries.
"""

from __future__ import annotations

import logging
import os
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any

import httpx

logger = logging.getLogger(__name__)


# ==========================================
# 1. Enums & Data Classes
# ==========================================


class ResponseStatus(str, Enum):
    SUCCESS = "SUCCESS"
    TIMEOUT = "TIMEOUT"
    RATE_LIMITED = "RATE_LIMITED"
    UNAVAILABLE = "UNAVAILABLE"
    ERROR = "ERROR"


ALLOWED_PROVIDERS: set[str] = {
    "mock",
    "openai",
    "perplexity",
    "gemini",
    "claude",
    "copilot",
}

DEFAULT_TIMEOUT_SECONDS: float = 30.0
DEFAULT_MAX_RETRIES: int = 2
DEFAULT_BACKOFF_SECONDS: float = 1.0


@dataclass
class UsageMetadata:
    """Usage / token consumption metadata provided by the AI provider."""
    input_tokens: int | None = None
    output_tokens: int | None = None
    total_tokens: int | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "input_tokens": self.input_tokens,
            "output_tokens": self.output_tokens,
            "total_tokens": self.total_tokens,
        }


@dataclass
class ProviderConfig:
    """Configuration settings for an AI Search Provider adapter."""
    provider_name: str
    enabled: bool = True
    api_key: str | None = None
    endpoint: str | None = None
    default_model: str = "default"
    timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS
    max_retries: int = DEFAULT_MAX_RETRIES
    backoff_seconds: float = DEFAULT_BACKOFF_SECONDS

    @property
    def is_configured(self) -> bool:
        """Returns True if the adapter has valid credentials configured or is mock."""
        if self.provider_name.lower() == "mock":
            return True
        return bool(self.api_key and len(self.api_key.strip()) > 0)


@dataclass
class ProviderRequest:
    """Normalized request structure passed to provider adapters."""
    query_id: int
    query_text: str
    query_set_id: int
    website_id: int
    provider: str
    model: str | None = None
    request_timestamp: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS
    max_retries: int = DEFAULT_MAX_RETRIES
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class ProviderResponse:
    """Normalized provider-independent response structure."""
    result_id: str
    query_id: int
    query_set_id: int
    website_id: int
    query_text: str
    provider: str
    model: str
    model_version: str | None
    status: ResponseStatus
    response_text: str
    latency_ms: int
    error_type: str | None = None
    error_message: str | None = None
    usage: UsageMetadata | None = None
    request_timestamp: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    response_timestamp: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    metadata_json: dict[str, Any] = field(default_factory=dict)


# ==========================================
# 2. Base Provider Adapter (ABC)
# ==========================================


class BaseProviderAdapter(ABC):
    """
    Abstract Base Class defining the contract for AI search provider adapters.
    Implements latency measurement, bounded retries, and error normalization.
    """

    def __init__(self, config: ProviderConfig | None = None) -> None:
        self.config = config or self._default_config()

    @property
    @abstractmethod
    def provider_name(self) -> str:
        """Unique provider identifier (e.g. 'openai', 'perplexity')."""
        pass

    @property
    @abstractmethod
    def default_model(self) -> str:
        """Default model name if none is explicitly specified."""
        pass

    @property
    def model_version(self) -> str | None:
        """Model version string if known; returns None otherwise."""
        return None

    @abstractmethod
    def _default_config(self) -> ProviderConfig:
        """Instantiate default configuration derived from environment variables."""
        pass

    def generate_result_id(self, query_id: int, provider: str, timestamp_ms: int) -> str:
        """Generate a deterministic, unique response identifier."""
        return f"resp_{query_id}_{provider}_{timestamp_ms}"

    def execute_query(self, request: ProviderRequest) -> ProviderResponse:
        """
        Executes a query against the AI provider with latency measurement,
        bounded retries, and normalized error handling.
        """
        if request.provider.lower() != self.provider_name.lower():
            raise ValueError(
                f"Adapter '{self.provider_name}' received request for provider '{request.provider}'"
            )

        model = request.model or self.config.default_model or self.default_model
        req_time = request.request_timestamp or datetime.now(timezone.utc)
        start_time = time.perf_counter()
        timestamp_ms = int(time.time() * 1000)
        result_id = self.generate_result_id(request.query_id, self.provider_name, timestamp_ms)

        # Check if provider is enabled
        if not self.config.enabled:
            latency_ms = int((time.perf_counter() - start_time) * 1000)
            return ProviderResponse(
                result_id=result_id,
                query_id=request.query_id,
                query_set_id=request.query_set_id,
                website_id=request.website_id,
                query_text=request.query_text,
                provider=self.provider_name,
                model=model,
                model_version=self.model_version,
                status=ResponseStatus.UNAVAILABLE,
                response_text="",
                latency_ms=latency_ms,
                error_type="PROVIDER_DISABLED",
                error_message=f"Provider '{self.provider_name}' is currently disabled in configuration.",
                request_timestamp=req_time,
                response_timestamp=datetime.now(timezone.utc),
            )

        # Check configuration / credentials
        if not self.config.is_configured:
            latency_ms = int((time.perf_counter() - start_time) * 1000)
            return ProviderResponse(
                result_id=result_id,
                query_id=request.query_id,
                query_set_id=request.query_set_id,
                website_id=request.website_id,
                query_text=request.query_text,
                provider=self.provider_name,
                model=model,
                model_version=self.model_version,
                status=ResponseStatus.UNAVAILABLE,
                response_text="",
                latency_ms=latency_ms,
                error_type="MISSING_CREDENTIALS",
                error_message=f"API key or credentials for provider '{self.provider_name}' are not configured.",
                request_timestamp=req_time,
                response_timestamp=datetime.now(timezone.utc),
            )

        max_retries = min(request.max_retries, self.config.max_retries, 5)
        timeout = request.timeout_seconds or self.config.timeout_seconds or DEFAULT_TIMEOUT_SECONDS
        last_error_type: str | None = None
        last_error_msg: str | None = None
        last_status: ResponseStatus = ResponseStatus.ERROR

        for attempt in range(max_retries + 1):
            try:
                raw_text, usage, meta = self._call_provider(
                    query_text=request.query_text,
                    model=model,
                    timeout_seconds=timeout,
                )
                latency_ms = int((time.perf_counter() - start_time) * 1000)
                return ProviderResponse(
                    result_id=result_id,
                    query_id=request.query_id,
                    query_set_id=request.query_set_id,
                    website_id=request.website_id,
                    query_text=request.query_text,
                    provider=self.provider_name,
                    model=model,
                    model_version=self.model_version,
                    status=ResponseStatus.SUCCESS,
                    response_text=raw_text,
                    latency_ms=latency_ms,
                    error_type=None,
                    error_message=None,
                    usage=usage,
                    request_timestamp=req_time,
                    response_timestamp=datetime.now(timezone.utc),
                    metadata_json=meta,
                )
            except httpx.TimeoutException as exc:
                last_status = ResponseStatus.TIMEOUT
                last_error_type = "TIMEOUT"
                last_error_msg = f"Request timed out after {timeout}s: {str(exc)}"
                logger.warning(
                    f"Provider '{self.provider_name}' timeout on attempt {attempt + 1}/{max_retries + 1}: {exc}"
                )
            except httpx.HTTPStatusError as exc:
                code = exc.response.status_code
                if code == 429:
                    last_status = ResponseStatus.RATE_LIMITED
                    last_error_type = "RATE_LIMITED"
                    retry_after = exc.response.headers.get("retry-after", "")
                    last_error_msg = f"HTTP 429 Rate limited. Retry-After: {retry_after}"
                elif code in (502, 503, 504):
                    last_status = ResponseStatus.UNAVAILABLE
                    last_error_type = "UNAVAILABLE"
                    last_error_msg = f"HTTP {code} Service temporarily unavailable."
                elif code in (401, 403):
                    # Authentication failure - non-retryable
                    latency_ms = int((time.perf_counter() - start_time) * 1000)
                    return ProviderResponse(
                        result_id=result_id,
                        query_id=request.query_id,
                        query_set_id=request.query_set_id,
                        website_id=request.website_id,
                        query_text=request.query_text,
                        provider=self.provider_name,
                        model=model,
                        model_version=self.model_version,
                        status=ResponseStatus.UNAVAILABLE,
                        response_text="",
                        latency_ms=latency_ms,
                        error_type="AUTHENTICATION_FAILURE",
                        error_message=f"HTTP {code} Authentication failed for provider '{self.provider_name}'.",
                        request_timestamp=req_time,
                        response_timestamp=datetime.now(timezone.utc),
                    )
                else:
                    last_status = ResponseStatus.ERROR
                    last_error_type = f"HTTP_{code}"
                    last_error_msg = f"HTTP error {code}: {exc.response.text[:200]}"
                logger.warning(
                    f"Provider '{self.provider_name}' HTTP {code} on attempt {attempt + 1}/{max_retries + 1}"
                )
            except Exception as exc:
                last_status = ResponseStatus.ERROR
                last_error_type = exc.__class__.__name__
                last_error_msg = str(exc)
                logger.warning(
                    f"Provider '{self.provider_name}' error on attempt {attempt + 1}/{max_retries + 1}: {exc}"
                )

            # Exponential backoff between attempts
            if attempt < max_retries:
                backoff = self.config.backoff_seconds * (2 ** attempt)
                time.sleep(min(backoff, 5.0))

        latency_ms = int((time.perf_counter() - start_time) * 1000)
        return ProviderResponse(
            result_id=result_id,
            query_id=request.query_id,
            query_set_id=request.query_set_id,
            website_id=request.website_id,
            query_text=request.query_text,
            provider=self.provider_name,
            model=model,
            model_version=self.model_version,
            status=last_status,
            response_text="",
            latency_ms=latency_ms,
            error_type=last_error_type or "UNKNOWN_ERROR",
            error_message=last_error_msg or "Execution failed after maximum retries.",
            request_timestamp=req_time,
            response_timestamp=datetime.now(timezone.utc),
        )

    @abstractmethod
    def _call_provider(
        self,
        query_text: str,
        model: str,
        timeout_seconds: float,
    ) -> tuple[str, UsageMetadata | None, dict[str, Any]]:
        """
        Internal implementation calling the specific provider API.
        Must return (response_text, usage_metadata, raw_metadata_dict).
        """
        pass


# ==========================================
# 3. Deterministic Mock Provider Adapter
# ==========================================


class MockProviderAdapter(BaseProviderAdapter):
    """
    Deterministic test adapter supporting controlled responses, simulated latencies,
    usage token generation, and reproducible failure modes (timeout, rate limit, error).
    """

    def __init__(
        self,
        config: ProviderConfig | None = None,
        custom_response_text: str | None = None,
        simulated_latency_ms: int = 100,
        failure_mode: str | None = None,
    ) -> None:
        super().__init__(config)
        self.custom_response_text = custom_response_text
        self.simulated_latency_ms = simulated_latency_ms
        self.failure_mode = failure_mode

    @property
    def provider_name(self) -> str:
        return "mock"

    @property
    def default_model(self) -> str:
        return "mock-ai-search-v1"

    @property
    def model_version(self) -> str | None:
        return "2026.1"

    def _default_config(self) -> ProviderConfig:
        return ProviderConfig(
            provider_name="mock",
            enabled=True,
            default_model="mock-ai-search-v1",
            timeout_seconds=10.0,
            max_retries=1,
            backoff_seconds=0.01,
        )

    def _call_provider(
        self,
        query_text: str,
        model: str,
        timeout_seconds: float,
    ) -> tuple[str, UsageMetadata | None, dict[str, Any]]:
        if self.simulated_latency_ms > 0:
            time.sleep(min(self.simulated_latency_ms / 1000.0, 0.05))

        mode = (self.failure_mode or "").lower()
        if mode == "timeout":
            raise httpx.TimeoutException("Simulated provider timeout exception")
        elif mode == "rate_limit":
            req = httpx.Request("POST", "https://mock.api/v1/search")
            resp = httpx.Response(429, request=req, headers={"retry-after": "60"})
            raise httpx.HTTPStatusError("Simulated rate limit", request=req, response=resp)
        elif mode == "unavailable":
            req = httpx.Request("POST", "https://mock.api/v1/search")
            resp = httpx.Response(503, request=req)
            raise httpx.HTTPStatusError("Simulated service unavailable", request=req, response=resp)
        elif mode == "error":
            req = httpx.Request("POST", "https://mock.api/v1/search")
            resp = httpx.Response(500, request=req)
            raise httpx.HTTPStatusError("Simulated server error", request=req, response=resp)
        elif mode == "auth_error":
            req = httpx.Request("POST", "https://mock.api/v1/search")
            resp = httpx.Response(401, request=req)
            raise httpx.HTTPStatusError("Simulated unauthorized", request=req, response=resp)

        if self.custom_response_text:
            text = self.custom_response_text
        else:
            text = (
                f"According to generative AI search sources, {query_text} represents a key "
                f"domain topic. Platforms and tools offer specialized capabilities to address "
                f"these requirements with structured data, clear authority, and citation support."
            )

        usage = UsageMetadata(
            input_tokens=len(query_text.split()) * 2,
            output_tokens=len(text.split()) * 2,
            total_tokens=(len(query_text.split()) + len(text.split())) * 2,
        )

        metadata = {
            "mock_engine": "raval_mock_v1",
            "is_simulation": True,
            "simulated_model": model,
        }

        return text, usage, metadata


# ==========================================
# 4. Production AI Provider Adapters
# ==========================================


class OpenAIAdapter(BaseProviderAdapter):
    """
    Adapter for OpenAI Chat/Search models (e.g. gpt-4o, gpt-4o-mini).
    Reads credentials from OPENAI_API_KEY.
    """

    @property
    def provider_name(self) -> str:
        return "openai"

    @property
    def default_model(self) -> str:
        return "gpt-4o"

    @property
    def model_version(self) -> str | None:
        return None

    def _default_config(self) -> ProviderConfig:
        return ProviderConfig(
            provider_name="openai",
            enabled=True,
            api_key=os.environ.get("OPENAI_API_KEY"),
            endpoint=os.environ.get("OPENAI_API_ENDPOINT", "https://api.openai.com/v1/chat/completions"),
            default_model="gpt-4o",
            timeout_seconds=30.0,
            max_retries=2,
            backoff_seconds=1.0,
        )

    def _call_provider(
        self,
        query_text: str,
        model: str,
        timeout_seconds: float,
    ) -> tuple[str, UsageMetadata | None, dict[str, Any]]:
        endpoint = self.config.endpoint or "https://api.openai.com/v1/chat/completions"
        headers = {
            "Authorization": f"Bearer {self.config.api_key}",
            "Content-Type": "application/json",
        }
        payload = {
            "model": model,
            "messages": [
                {
                    "role": "system",
                    "content": "You are an AI search engine answer assistant. Answer the search query thoroughly and accurately.",
                },
                {"role": "user", "content": query_text},
            ],
            "temperature": 0.2,
        }

        with httpx.Client(timeout=timeout_seconds) as client:
            resp = client.post(endpoint, json=payload, headers=headers)
            resp.raise_for_status()
            data = resp.json()

        choice = data.get("choices", [{}])[0]
        text = choice.get("message", {}).get("content", "")
        usage_data = data.get("usage", {})
        usage = UsageMetadata(
            input_tokens=usage_data.get("prompt_tokens"),
            output_tokens=usage_data.get("completion_tokens"),
            total_tokens=usage_data.get("total_tokens"),
        )
        metadata = {
            "openai_id": data.get("id"),
            "finish_reason": choice.get("finish_reason"),
            "model_reported": data.get("model"),
        }
        return text, usage, metadata


class PerplexityAdapter(BaseProviderAdapter):
    """
    Adapter for Perplexity Sonar search models (e.g. sonar, sonar-pro).
    Reads credentials from PERPLEXITY_API_KEY.
    """

    @property
    def provider_name(self) -> str:
        return "perplexity"

    @property
    def default_model(self) -> str:
        return "sonar"

    @property
    def model_version(self) -> str | None:
        return None

    def _default_config(self) -> ProviderConfig:
        return ProviderConfig(
            provider_name="perplexity",
            enabled=True,
            api_key=os.environ.get("PERPLEXITY_API_KEY"),
            endpoint="https://api.perplexity.ai/chat/completions",
            default_model="sonar",
            timeout_seconds=30.0,
            max_retries=2,
            backoff_seconds=1.0,
        )

    def _call_provider(
        self,
        query_text: str,
        model: str,
        timeout_seconds: float,
    ) -> tuple[str, UsageMetadata | None, dict[str, Any]]:
        endpoint = self.config.endpoint or "https://api.perplexity.ai/chat/completions"
        headers = {
            "Authorization": f"Bearer {self.config.api_key}",
            "Content-Type": "application/json",
        }
        payload = {
            "model": model,
            "messages": [{"role": "user", "content": query_text}],
        }

        with httpx.Client(timeout=timeout_seconds) as client:
            resp = client.post(endpoint, json=payload, headers=headers)
            resp.raise_for_status()
            data = resp.json()

        choice = data.get("choices", [{}])[0]
        text = choice.get("message", {}).get("content", "")
        usage_data = data.get("usage", {})
        usage = UsageMetadata(
            input_tokens=usage_data.get("prompt_tokens"),
            output_tokens=usage_data.get("completion_tokens"),
            total_tokens=usage_data.get("total_tokens"),
        )
        metadata = {
            "citations": data.get("citations", []),
            "perplexity_id": data.get("id"),
        }
        return text, usage, metadata


class GeminiAdapter(BaseProviderAdapter):
    """
    Adapter for Google Gemini models (e.g. gemini-1.5-pro, gemini-2.0-flash).
    Reads credentials from GEMINI_API_KEY.
    """

    @property
    def provider_name(self) -> str:
        return "gemini"

    @property
    def default_model(self) -> str:
        return "gemini-1.5-pro"

    @property
    def model_version(self) -> str | None:
        return None

    def _default_config(self) -> ProviderConfig:
        return ProviderConfig(
            provider_name="gemini",
            enabled=True,
            api_key=os.environ.get("GEMINI_API_KEY"),
            endpoint="https://generativelanguage.googleapis.com/v1beta/models",
            default_model="gemini-1.5-pro",
            timeout_seconds=30.0,
            max_retries=2,
            backoff_seconds=1.0,
        )

    def _call_provider(
        self,
        query_text: str,
        model: str,
        timeout_seconds: float,
    ) -> tuple[str, UsageMetadata | None, dict[str, Any]]:
        api_key = self.config.api_key or ""
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
        payload = {
            "contents": [{"parts": [{"text": query_text}]}],
        }

        with httpx.Client(timeout=timeout_seconds) as client:
            resp = client.post(url, json=payload)
            resp.raise_for_status()
            data = resp.json()

        candidates = data.get("candidates", [{}])
        parts = candidates[0].get("content", {}).get("parts", [{}]) if candidates else [{}]
        text = parts[0].get("text", "")
        usage_meta = data.get("usageMetadata", {})
        usage = UsageMetadata(
            input_tokens=usage_meta.get("promptTokenCount"),
            output_tokens=usage_meta.get("candidatesTokenCount"),
            total_tokens=usage_meta.get("totalTokenCount"),
        )
        metadata = {
            "finish_reason": candidates[0].get("finishReason") if candidates else None,
        }
        return text, usage, metadata


class ClaudeAdapter(BaseProviderAdapter):
    """
    Adapter for Anthropic Claude models (e.g. claude-3-5-sonnet-20241022).
    Reads credentials from ANTHROPIC_API_KEY.
    """

    @property
    def provider_name(self) -> str:
        return "claude"

    @property
    def default_model(self) -> str:
        return "claude-3-5-sonnet-20241022"

    @property
    def model_version(self) -> str | None:
        return "20241022"

    def _default_config(self) -> ProviderConfig:
        return ProviderConfig(
            provider_name="claude",
            enabled=True,
            api_key=os.environ.get("ANTHROPIC_API_KEY"),
            endpoint="https://api.anthropic.com/v1/messages",
            default_model="claude-3-5-sonnet-20241022",
            timeout_seconds=30.0,
            max_retries=2,
            backoff_seconds=1.0,
        )

    def _call_provider(
        self,
        query_text: str,
        model: str,
        timeout_seconds: float,
    ) -> tuple[str, UsageMetadata | None, dict[str, Any]]:
        endpoint = self.config.endpoint or "https://api.anthropic.com/v1/messages"
        headers = {
            "x-api-key": self.config.api_key or "",
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
        }
        payload = {
            "model": model,
            "max_tokens": 1024,
            "messages": [{"role": "user", "content": query_text}],
        }

        with httpx.Client(timeout=timeout_seconds) as client:
            resp = client.post(endpoint, json=payload, headers=headers)
            resp.raise_for_status()
            data = resp.json()

        content_blocks = data.get("content", [{}])
        text = content_blocks[0].get("text", "") if content_blocks else ""
        usage_data = data.get("usage", {})
        usage = UsageMetadata(
            input_tokens=usage_data.get("input_tokens"),
            output_tokens=usage_data.get("output_tokens"),
            total_tokens=(usage_data.get("input_tokens", 0) or 0) + (usage_data.get("output_tokens", 0) or 0),
        )
        metadata = {
            "claude_id": data.get("id"),
            "stop_reason": data.get("stop_reason"),
        }
        return text, usage, metadata


class CopilotAdapter(BaseProviderAdapter):
    """
    Adapter for Microsoft Copilot / Bing search integrations.
    Reads credentials from COPILOT_API_KEY or BING_API_KEY.
    """

    @property
    def provider_name(self) -> str:
        return "copilot"

    @property
    def default_model(self) -> str:
        return "copilot-search-v1"

    @property
    def model_version(self) -> str | None:
        return None

    def _default_config(self) -> ProviderConfig:
        return ProviderConfig(
            provider_name="copilot",
            enabled=True,
            api_key=os.environ.get("COPILOT_API_KEY") or os.environ.get("BING_API_KEY"),
            endpoint="https://api.bing.microsoft.com/v7.0/search",
            default_model="copilot-search-v1",
            timeout_seconds=30.0,
            max_retries=2,
            backoff_seconds=1.0,
        )

    def _call_provider(
        self,
        query_text: str,
        model: str,
        timeout_seconds: float,
    ) -> tuple[str, UsageMetadata | None, dict[str, Any]]:
        endpoint = self.config.endpoint or "https://api.bing.microsoft.com/v7.0/search"
        headers = {
            "Ocp-Apim-Subscription-Key": self.config.api_key or "",
        }
        params = {"q": query_text, "textFormat": "Raw"}

        with httpx.Client(timeout=timeout_seconds) as client:
            resp = client.get(endpoint, params=params, headers=headers)
            resp.raise_for_status()
            data = resp.json()

        web_pages = data.get("webPages", {}).get("value", [])
        snippets = [p.get("snippet", "") for p in web_pages[:5] if p.get("snippet")]
        text = " ".join(snippets)
        metadata = {
            "total_estimated_matches": data.get("webPages", {}).get("totalEstimatedMatches"),
        }
        return text, None, metadata


# ==========================================
# 5. Provider Registry
# ==========================================


class ProviderRegistry:
    """
    Centralized registry for discovering, configuring, and resolving
    AI search provider adapters.
    """

    def __init__(self) -> None:
        self._adapters: dict[str, BaseProviderAdapter] = {}
        self._register_defaults()

    def _register_defaults(self) -> None:
        """Register default adapter instances."""
        self.register(MockProviderAdapter())
        self.register(OpenAIAdapter())
        self.register(PerplexityAdapter())
        self.register(GeminiAdapter())
        self.register(ClaudeAdapter())
        self.register(CopilotAdapter())

    def register(self, adapter: BaseProviderAdapter) -> None:
        """Register a provider adapter."""
        name = adapter.provider_name.lower().strip()
        if name not in ALLOWED_PROVIDERS:
            raise ValueError(
                f"Provider '{name}' is not in the allowlist of supported providers: {ALLOWED_PROVIDERS}"
            )
        self._adapters[name] = adapter

    def get(self, provider_name: str) -> BaseProviderAdapter:
        """Resolve an adapter by provider name."""
        name = provider_name.lower().strip()
        if name not in self._adapters:
            raise ValueError(
                f"Unknown AI provider '{provider_name}'. Supported providers: {list(self._adapters.keys())}"
            )
        return self._adapters[name]

    def list_providers(self) -> list[dict[str, Any]]:
        """List registered providers with configuration and availability status (no secrets)."""
        result = []
        for name, adapter in sorted(self._adapters.items()):
            is_mock = name == "mock"
            is_configured = adapter.config.is_configured
            status = "MOCK_ONLY" if is_mock else ("CONFIGURED" if is_configured else "NOT_CONFIGURED")
            result.append(
                {
                    "provider_name": adapter.provider_name,
                    "default_model": adapter.default_model,
                    "model_version": adapter.model_version,
                    "enabled": adapter.config.enabled,
                    "is_configured": is_configured,
                    "is_mock": is_mock,
                    "status": status,
                    "timeout_seconds": adapter.config.timeout_seconds,
                    "max_retries": adapter.config.max_retries,
                }
            )
        return result


# Global default registry instance
provider_registry = ProviderRegistry()
