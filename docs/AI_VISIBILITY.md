# AI Visibility & Answer Monitoring Engine (Task 10)

## 1. Overview & Architecture

The **AI Visibility & Answer Monitoring Engine** enables continuous tracking, capture, evaluation, and diagnostic analysis of brand and website presence across major AI search providers and generative answer engines (OpenAI, Perplexity, Google Gemini, Anthropic Claude, Microsoft Copilot, and Deterministic Mock test engines).

```text
+--------------------------------------------------------------------------------+
|                         SITE INTELLIGENCE SOURCES                              |
|                                                                                |
|  +---------------------+  +--------------------+  +-------------------------+  |
|  |  Topic Intelligence |  | Entity Intelligence|  |  Question Intelligence  |  |
|  | (Primary/Supporting)|  | (Org, Brand, Prod) |  |   (Heading/FAQ Schema)  |  |
|  +----------+----------+  +---------+----------+  +------------+------------+  |
|             |                       |                          |               |
|             +-----------------------+--------------------------+               |
+-------------------------------------|------------------------------------------+
                                      v
+--------------------------------------------------------------------------------+
|                STEP 1: QUERY INTELLIGENCE & REUSABLE QUERY SETS                |
|                                                                                |
|  1. Candidate Generation Across 4 Intents (Informational, Commercial, etc.)    |
|  2. Bounded Natural-Language Wording Variant Expansion (MAX_VARIANTS_PER_SRC) |
|  3. Multi-Level Normalization (Casing, Whitespace, Contractions, Filler)      |
|  4. Deterministic Semantic Deduplication (Token-Set Jaccard & Canonical Key)   |
|  5. Provenance Linkage (Topic, Entity, Page) & Generation Source Tagging       |
|  6. Deterministic Priority & Confidence Assignment                             |
+-------------------------------------+------------------------------------------+
                                      v
+--------------------------------------------------------------------------------+
|                STEP 2: PROVIDER ADAPTERS & AI RESPONSE CAPTURE                 |
|                                                                                |
|  +---------------------+  +--------------------+  +-------------------------+  |
|  | OpenAI / GPT-4o     |  | Perplexity / Sonar |  | Google Gemini 1.5/2.0    |  |
|  +---------------------+  +--------------------+  +-------------------------+  |
|  | Anthropic Claude    |  | Microsoft Copilot  |  | Deterministic Mock      |  |
|  +----------+----------+  +---------+----------+  +------------+------------+  |
|             |                       |                          |               |
|             +-----------------------+--------------------------+               |
|                                     v                                          |
|        - Latency Measurement (ms) & Usage Token Tracking                       |
|        - Bounded Exponential Retries & Execution Timeouts                      |
|        - Normalized Response Status (SUCCESS, TIMEOUT, RATE_LIMITED, etc.)     |
|        - Persistent Auditable AIResponse Storage (`ai_responses`)              |
+--------------------------------------------------------------------------------+
```

---

## 2. Step 1: Query Intelligence Subsystem

### 2.1 Query Intent Categories
1. **`INFORMATIONAL`**: Conceptual questions, definitions, mechanisms (`"What is [topic]?"`, `"How does [topic] work?"`).
2. **`COMMERCIAL`**: Buying options, recommendations, platform selection (`"What are the best [topic] solutions?"`, `"Which platform should I choose for [use case]?"`).
3. **`COMPARISON`**: Brand vs competitor, differences (`"[Brand] vs top alternatives"`, `"What is the difference between [A] and [B]?"`).
4. **`PROBLEM_SOLVING`**: Troubleshooting, fixing issues, addressing content gaps (`"How to address missing [gap] in [topic]?"`, `"How to fix [issue]?"`).

### 2.2 Generation Sources
- **`TOPIC_INTELLIGENCE`**: Derived from topic extraction models (`TopicSemanticAnalyzer`).
- **`ENTITY_INTELLIGENCE`**: Derived from entity identification (`EntityAnalyzer`).
- **`QUESTION_INTELLIGENCE`**: Derived from heading queries and FAQ schema blocks (`QuestionAnalyzer`).
- **`CONTENT_INTELLIGENCE`**: Derived from content gap analysis and strengths (`ContentIntelligenceAnalyzer`).

### 2.3 Deduplication & Bounds
- **Level 1 Normalization**: Whitespace stripping, lowercasing, contraction expansion, filler prefix stripping (`"can you please tell me about"` $\rightarrow$ `""`).
- **Level 2 Deterministic Clustering**: Token-set Jaccard similarity ($\ge 0.85$ threshold), retaining primary candidate with alternate phrasings preserved in metadata.
- **Configurable Bounds**: `MAX_VARIANTS_PER_SOURCE` (default 3), `MAX_TOTAL_QUERIES` (default 250).

---

## 3. Step 2: Provider Adapter Architecture & Response Capture

### 3.1 Base Provider Adapter Contract (`BaseProviderAdapter`)
All AI search provider adapters inherit from `BaseProviderAdapter` and provide:
- `provider_name`: Unique provider string (`"mock"`, `"openai"`, `"perplexity"`, `"gemini"`, `"claude"`, `"copilot"`).
- `default_model`: Default model identifier.
- `model_version`: Optional model version tag.
- `execute_query(request: ProviderRequest) -> ProviderResponse`: Execution method measuring latency, enforcing timeouts, executing bounded retries for transient errors, and normalizing output.

### 3.2 Normalized Request Structure (`ProviderRequest`)
```python
@dataclass
class ProviderRequest:
    query_id: int
    query_text: str
    query_set_id: int
    website_id: int
    provider: str
    model: str | None = None
    request_timestamp: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    timeout_seconds: float = 30.0
    max_retries: int = 2
    metadata: dict[str, Any] = field(default_factory=dict)
```

### 3.3 Normalized Response Structure (`ProviderResponse`)
```python
@dataclass
class ProviderResponse:
    result_id: str  # Unique deterministic ID: resp_{query_id}_{provider}_{timestamp_ms}
    query_id: int
    query_set_id: int
    website_id: int
    query_text: str
    provider: str
    model: str
    model_version: str | None
    status: ResponseStatus  # SUCCESS, TIMEOUT, RATE_LIMITED, UNAVAILABLE, ERROR
    response_text: str
    latency_ms: int
    error_type: str | None = None
    error_message: str | None = None
    usage: UsageMetadata | None = None  # input_tokens, output_tokens, total_tokens
    request_timestamp: datetime
    response_timestamp: datetime
    metadata_json: dict[str, Any]
```

### 3.4 Bounded Response Statuses
1. **`SUCCESS`**: AI provider completed query execution and returned valid response text.
2. **`TIMEOUT`**: Execution exceeded the configured timeout threshold.
3. **`RATE_LIMITED`**: Provider returned HTTP 429; includes Retry-After metadata when provided.
4. **`UNAVAILABLE`**: Missing credentials, disabled provider in configuration, or HTTP 502/503/504 errors.
5. **`ERROR`**: Non-retryable HTTP 4xx, server errors, or unexpected payload anomalies.

> [!IMPORTANT]
> A provider failure is strictly distinct from a valid empty answer. Failures set `status` to an error code and leave `response_text` empty, preserving diagnostic error details in `error_type` and `error_message`.

### 3.5 Bounded Retries & Exponential Backoff
- `MAX_RETRIES`: Default 2, maximum capped at 5.
- `BACKOFF_SECONDS`: Exponential backoff ($t_{\text{backoff}} = \text{base} \times 2^{\text{attempt}}$).
- Transient errors (`TIMEOUT`, `RATE_LIMITED`, HTTP 502/503/504) are retried up to the limit.
- Authentication failures (HTTP 401/403) or configuration errors fail immediately without wasteful retries.

### 3.6 Security & SSRF Protection
- **Allowlist Enforcement**: Only registered providers in `ALLOWED_PROVIDERS` (`"mock"`, `"openai"`, `"perplexity"`, `"gemini"`, `"claude"`, `"copilot"`) are allowed.
- **SSRF Prevention**: Outbound request URLs are strictly derived from trusted server configuration. Arbitrary client-provided target URLs are rejected.
- **Zero Credential Leaks**: API keys are retrieved from environment variables and are never logged, stored in responses, or returned via the API.

---

## 4. Current Provider Implementation Status

| Provider | Default Model | Config Source | Current Status | Description |
| :--- | :--- | :--- | :--- | :--- |
| **`mock`** | `mock-ai-search-v1` | Local simulation | **`MOCK_ONLY`** | Deterministic simulation adapter supporting custom text, latencies, tokens, and error modes (`timeout`, `rate_limit`, `unavailable`, `error`) |
| **`openai`** | `gpt-4o` | `OPENAI_API_KEY` | **`CONFIGURED`** / **`NOT_CONFIGURED`** | OpenAI Chat Completions adapter with token usage extraction |
| **`perplexity`**| `sonar` | `PERPLEXITY_API_KEY` | **`CONFIGURED`** / **`NOT_CONFIGURED`** | Perplexity Sonar search adapter with citation metadata capture |
| **`gemini`** | `gemini-1.5-pro` | `GEMINI_API_KEY` | **`CONFIGURED`** / **`NOT_CONFIGURED`** | Google Gemini Content Generation API adapter |
| **`claude`** | `claude-3-5-sonnet-20241022` | `ANTHROPIC_API_KEY` | **`CONFIGURED`** / **`NOT_CONFIGURED`** | Anthropic Messages API adapter |
| **`copilot`** | `copilot-search-v1` | `COPILOT_API_KEY` / `BING_API_KEY` | **`CONFIGURED`** / **`NOT_CONFIGURED`** | Microsoft Copilot / Bing Web Search adapter |

*Note: In test and development environments without active API keys, real adapters report `NOT_CONFIGURED` and safely return `UNAVAILABLE` with `MISSING_CREDENTIALS` error type without making unauthenticated outbound calls.*

---

## 5. Database Schema

### 5.1 `ai_responses` Table
| Column | Type | Description |
| :--- | :--- | :--- |
| `id` | `Integer` (PK) | Unique response record ID |
| `query_id` | `ForeignKey("queries.id")` | Associated Query |
| `query_set_id` | `ForeignKey("query_sets.id")` | Associated QuerySet |
| `website_id` | `ForeignKey("websites.id")` | Associated Website / workspace |
| `provider` | `String(100)` | Provider name (`mock`, `openai`, etc.) |
| `model` | `String(100)` | Model used for execution |
| `model_version` | `String(50)` (Nullable) | Model version tag |
| `status` | `String(50)` | `SUCCESS`, `TIMEOUT`, `RATE_LIMITED`, `UNAVAILABLE`, `ERROR` |
| `response_text` | `Text` | Captured raw answer text from AI provider |
| `latency_ms` | `Integer` | Execution time in milliseconds |
| `error_type` | `String(100)` (Nullable) | Standardized error type identifier |
| `error_message` | `Text` (Nullable) | Diagnostic error message |
| `input_tokens` | `Integer` (Nullable) | Input/prompt tokens consumed |
| `output_tokens` | `Integer` (Nullable) | Output/completion tokens generated |
| `total_tokens` | `Integer` (Nullable) | Total tokens consumed |
| `request_timestamp` | `DateTime` | Execution start timestamp (UTC) |
| `response_timestamp` | `DateTime` | Execution completion timestamp (UTC) |
| `metadata_json` | `JSON` (Nullable) | `result_id`, raw provider metadata, citations, finish reasons |
| `created_at` | `DateTime` | Record insertion timestamp (UTC) |

---

## 6. REST API Endpoints

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/v1/providers` | Lists registered providers and configuration readiness |
| `POST` | `/api/v1/queries/{query_id}/responses` | Executes a single query against a provider and persists response |
| `POST` | `/api/v1/query-sets/{query_set_id}/responses` | Batch executes active queries in a QuerySet |
| `GET` | `/api/v1/query-sets/{query_set_id}/responses` | Lists response history for a QuerySet (with `provider`, `status` filters) |
| `GET` | `/api/v1/queries/{query_id}/responses` | Lists response history for a specific query |
| `GET` | `/api/v1/responses/{response_id}` | Retrieves a single AI response record |

---

## 7. Sample Normalized Output

Serialized response from `POST /api/v1/queries/1/responses`:
```json
{
  "id": 1,
  "query_id": 1,
  "query_set_id": 1,
  "website_id": 1,
  "provider": "mock",
  "model": "mock-ai-search-v1",
  "model_version": "2026.1",
  "status": "SUCCESS",
  "response_text": "According to generative AI search sources, What is Generative Engine Optimization? represents a key domain topic. Platforms and tools offer specialized capabilities to address these requirements with structured data, clear authority, and citation support.",
  "latency_ms": 112,
  "error_type": null,
  "error_message": null,
  "input_tokens": 14,
  "output_tokens": 68,
  "total_tokens": 82,
  "request_timestamp": "2026-09-03T14:35:00Z",
  "response_timestamp": "2026-09-03T14:35:00.112Z",
  "metadata_json": {
    "result_id": "resp_1_mock_1756910100000",
    "mock_engine": "raval_mock_v1",
    "is_simulation": true,
    "topic": "Generative Engine Optimization"
  },
  "created_at": "2026-09-03T14:35:00Z"
}
```

---

## 8. Testing & Validation

- `backend/tests/test_provider_adapters.py` (12 unit tests covering base adapter, registry, timeout, rate-limit, unconfigured provider safety, and security/secret protection).
- `backend/tests/test_ai_response_service.py` (6 service-layer tests covering single and batch execution, historical persistence, query relationships, and site isolation).
- `backend/tests/test_ai_response_api.py` (5 API integration tests covering endpoints, batch execution, filtering, and error status codes).
- **Full Regression Test Suite**: **810 passed, 0 failed** in 73.36s (787 baseline + 23 Step 2 tests = 810 passed).
