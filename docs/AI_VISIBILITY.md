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
+-------------------------------------+------------------------------------------+
                                      v
+--------------------------------------------------------------------------------+
|             STEP 3: MENTION & CITATION DETECTION ENGINE                        |
|                                                                                |
|  +-------------------------------------+  +---------------------------------+  |
|  |       Mention Detection Subsystem   |  |   Citation Extraction Subsystem |  |
|  | - Exact Brand Matching (1.0 conf)   |  | - Markdown & Plain Link Parsing |  |
|  | - Brand Alias Matching (0.95 conf)  |  | - Parameter & Fragment Stripping|  |
|  | - Domain Word Matching (1.0 conf)   |  | - Target Domain Classification  |  |
|  | - Product/Entity Match (0.90 conf)  |  | - Crawled Page Result Mapping   |  |
|  | - Context Snippet & Span Capture    |  | - Citation Position & Snippet   |  |
|  +------------------+------------------+  +----------------+----------------+  |
|                     |                                      |                   |
|                     +-------------------+------------------+                   |
|                                         v                                      |
|              - False-Positive Protection (Word Boundaries & Common-Word Guards)|
|              - Strict Distinction: Mentions != Citations                       |
|              - Zero Outbound HTTP Crawling (SSRF Prevention)                   |
|              - Persistent Storage in `ai_mentions` and `ai_citations`          |
+-------------------------------------+------------------------------------------+
                                      v
+--------------------------------------------------------------------------------+
|             STEP 4: VISIBILITY & COMPETITOR SIGNAL ENGINE                      |
|                                                                                |
|  +-------------------------------------+  +---------------------------------+  |
|  |     Observed Target Visibility      |  |    Competitor Presence Signals  |  |
|  | - `target_mentioned`: boolean       |  | - Configured Competitor Match   |  |
|  | - `target_cited`: boolean           |  | - Mention & Citation Evidence   |  |
|  | - `first_party_cited`: boolean      |  | - Earliest Observable Position  |  |
|  | - `relevant_answer`: enum           |  | - Competitor Safety Guards      |  |
|  | - Observable Mention/Citation Pos   |  | - Snippet Extraction & Provenance| |
|  +------------------+------------------+  +----------------+----------------+  |
|                     |                                      |                   |
|                     +-------------------+------------------+                   |
|                                         v                                      |
|              - Deterministic Traceable Evidence Summary                        |
|              - Persistent Storage in `ai_visibility_observations`              |
+-------------------------------------+------------------------------------------+
                                      v
+--------------------------------------------------------------------------------+
|             STEP 5: VISIBILITY GAP ANALYSIS & EXISTING FINDING LINKAGE         |
|                                                                                |
|  +-------------------------------------+  +---------------------------------+  |
|  |     Deterministic Gap Detection     |  |    Existing Finding Linkage     |  |
|  | - `TARGET_ABSENT`                   |  | - Match Type (`EXACT_QUESTION`, |  |
|  | - `MENTION_WITHOUT_CITATION`        |  |    `SAME_PAGE`, `SAME_CATEGORY`)|  |
|  | - `COMPETITOR_PRESENT_TARGET_ABSENT`|  | - Bounded Confidence (0.50-1.0) |  |
|  | - `TARGET_CITED_NOT_RELEVANT`       |  | - Explainable Reasons List      |  |
|  | - Provider Failure != Gap Guard     |  | - Zero Duplicate Finding Creation| |
|  +------------------+------------------+  +----------------+----------------+  |
|                     |                                      |                   |
|                     +-------------------+------------------+                   |
|                                         v                                      |
|              - Traceable Gap-to-Finding Connection                             |
|              - Persistent Storage in `ai_visibility_gaps` and links            |
+-------------------------------------+------------------------------------------+
                                      v
+--------------------------------------------------------------------------------+
|             STEP 6: AI VISIBILITY METRICS & HISTORICAL ANALYTICS               |
|                                                                                |
|  +-------------------------------------+  +---------------------------------+  |
|  |    Observational Visibility Rates   |  |   Historical & Health Analytics |  |
|  | - Mention Rate (`target_mentioned`) |  | - Operational Health & Failures |  |
|  | - Citation Rate (`target_cited`)    |  | - Period-over-Period Comparison |  |
|  | - First-Party Citation Rate         |  |   (Absolute & % Relative Chg)   |  |
|  | - Relevant Answer Rate              |  | - Daily Metric Timelines        |  |
|  | - Competitor Appearance Rate        |  | - Persistent Snapshots          |  |
|  | - Target vs Competitor Matrix       |  |   (`ai_visibility_snapshots`)   |  |
|  +------------------+------------------+  +----------------+----------------+  |
|                     |                                      |                   |
|                     +-------------------+------------------+                   |
|                                         v                                      |
|              - Multi-Dimensional Slicing (Provider, Intent, Topic, Query)      |
|              - Failure-Isolated Denominators & Safe Null Handling              |
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

---

## 3. Step 2: Provider Adapter Architecture & Response Capture

### 3.1 Base Provider Adapter Contract (`BaseProviderAdapter`)
All AI search provider adapters inherit from `BaseProviderAdapter` and provide:
- `provider_name`: Unique provider string (`"mock"`, `"openai"`, `"perplexity"`, `"gemini"`, `"claude"`, `"copilot"`).
- `default_model`: Default model identifier.
- `model_version`: Optional model version tag.
- `execute_query(request: ProviderRequest) -> ProviderResponse`: Execution method measuring latency, enforcing timeouts, executing bounded retries for transient errors, and normalizing output.

---

## 4. Step 3: Mention & Citation Detection Subsystem

### 4.1 Match Types & Confidence
- **`EXACT_BRAND`** (Confidence: 1.0): Exact whole-word match against `website.name`.
- **`BRAND_ALIAS`** (Confidence: 0.95): Matches configured aliases and legal suffix variants.
- **`DOMAIN_MATCH`** (Confidence: 1.0): Matches target domain string in text.
- **`PRODUCT_ENTITY`** (Confidence: 0.90): Matches configured product/brand entities with `entity_id`.

---

## 5. Step 4: Visibility & Competitor Signal Subsystem

### 5.1 Target Visibility Signals
- **`target_mentioned` (bool)**: True if brand/alias/domain/entity was mentioned in text.
- **`target_cited` (bool)**: True if target domain was cited with URL evidence.
- **`first_party_cited` (bool)**: True if target's own domain was cited.
- **`relevant_answer` (enum)**: `RELEVANT`, `IRRELEVANT`, `UNKNOWN`.
- **`observable_mention_position` / `observable_citation_position`**: Earliest observable character and 1-indexed citation offsets.

---

## 6. Step 5: Visibility Gap Analysis & Finding Linkage Subsystem

### 6.1 Supported Gap Types
1. **`COMPETITOR_PRESENT_TARGET_ABSENT`**: Configured competitors appear in generative answer while target brand is completely absent.
2. **`TARGET_ABSENT`**: Target brand and domain are absent from the captured AI answer for a monitored query.
3. **`MENTION_WITHOUT_CITATION`**: Target brand is mentioned in the answer text, but no authoritative link or citation to the target domain was cited by the AI provider.
4. **`TARGET_CITED_NOT_RELEVANT`**: Target domain was cited, but the response content was classified as irrelevant to query intent.
5. **`INCONSISTENT_VISIBILITY`**: Multiple valid observations show inconsistent target visibility across providers.

### 6.2 Provider Failure ≠ Visibility Gap Safeguard
Provider failures (`TIMEOUT`, `RATE_LIMITED`, `UNAVAILABLE`, `ERROR`) or empty response payloads are strictly classified as **`NOT_EVALUABLE`**. They do **not** generate `TARGET_ABSENT` or any visibility gaps.

---

## 7. Step 6: AI Visibility Metrics & Historical Analytics Subsystem

### 7.1 Observational Visibility Metrics & Formulas

| Metric Name | Numerator | Denominator | Formula |
| :--- | :--- | :--- | :--- |
| **`mention_rate`** | Successful responses with target mention | Evaluable successful responses | $\frac{\text{responses\_with\_target\_mention}}{\text{evaluable\_successful\_responses}}$ |
| **`citation_rate`** | Successful responses with target citation | Evaluable successful responses | $\frac{\text{responses\_with\_target\_citation}}{\text{evaluable\_successful\_responses}}$ |
| **`first_party_citation_rate`** | Successful responses with 1st-party citation | Evaluable successful responses | $\frac{\text{responses\_with\_first\_party\_citation}}{\text{evaluable\_successful\_responses}}$ |
| **`relevant_answer_rate`** | Responses classified as `RELEVANT` | Evaluable responses with known relevance | $\frac{\text{relevant\_answers}}{\text{evaluable\_answers\_with\_known\_relevance}}$ |
| **`competitor_appearance_rate`** | Responses with $\ge 1$ competitor | Evaluable successful responses | $\frac{\text{responses\_with\_competitor}}{\text{evaluable\_successful\_responses}}$ |

### 7.2 Strict Denominator Rules
- Provider failures (`TIMEOUT`, `RATE_LIMITED`, `UNAVAILABLE`, `ERROR`) are **strictly excluded** from visibility metric denominators.
- Valid successful responses containing no target mention **are** evaluable and count in the denominator (with $0$ in the numerator).
- **Safe Null Handling**: If `evaluable_successful_responses == 0`, all rates safely return `None` (null) rather than fabricated `0%` or division-by-zero errors.

### 7.3 Operational Health Separation
Operational provider health is tracked separately from visibility:
- `total_attempts: int`
- `successful_responses: int`
- `timeout_count: int`
- `rate_limit_count: int`
- `unavailable_count: int`
- `error_count: int`
- `success_rate: float | None` ($\frac{\text{successful\_responses}}{\text{total\_attempts}}$)
- `avg_latency_ms: float | None`
- `total_input_tokens`, `total_output_tokens`, `total_tokens: int`

### 7.4 Historical Comparison & Analytics
- **Period Comparisons**: Compares `current` vs `previous` time periods.
- **Absolute Change**: $\Delta = \text{current\_rate} - \text{previous\_rate}$
- **Relative Percentage Change**: $\% = \frac{\text{current\_rate} - \text{previous\_rate}}{\text{previous\_rate}} \times 100$ (safely returns `None` if previous rate is $0$ or null).
- **Timeline Series**: Daily aggregation of attempts, evaluable responses, mention rate, citation rate, and competitor appearance rate.

> [!IMPORTANT]
> **Observational Metrics vs Global Ranking**:
> AI visibility metrics represent empirical observations from captured provider responses. They do NOT imply global AI search market share, universal ranking, or guaranteed answer inclusion. Provider failure is an operational condition and is never treated as target invisibility.

---

## 8. Current Provider Implementation Status

| Provider | Default Model | Config Source | Current Status | Description |
| :--- | :--- | :--- | :--- | :--- |
| **`mock`** | `mock-ai-search-v1` | Local simulation | **`MOCK_ONLY`** | Deterministic simulation adapter supporting custom text, latencies, tokens, and error modes (`timeout`, `rate_limit`, `unavailable`, `error`) |
| **`openai`** | `gpt-4o` | `OPENAI_API_KEY` | **`CONFIGURED`** / **`NOT_CONFIGURED`** | OpenAI Chat Completions adapter with token usage extraction |
| **`perplexity`**| `sonar` | `PERPLEXITY_API_KEY` | **`CONFIGURED`** / **`NOT_CONFIGURED`** | Perplexity Sonar search adapter with citation metadata capture |
| **`gemini`** | `gemini-1.5-pro` | `GEMINI_API_KEY` | **`CONFIGURED`** / **`NOT_CONFIGURED`** | Google Gemini Content Generation API adapter |
| **`claude`** | `claude-3-5-sonnet-20241022` | `ANTHROPIC_API_KEY` | **`CONFIGURED`** / **`NOT_CONFIGURED`** | Anthropic Messages API adapter |
| **`copilot`** | `copilot-search-v1` | `COPILOT_API_KEY` / `BING_API_KEY` | **`CONFIGURED`** / **`NOT_CONFIGURED`** | Microsoft Copilot / Bing Web Search adapter |

---

## 9. Database Schema

### 9.1 `ai_visibility_snapshots` Table
| Column | Type | Description |
| :--- | :--- | :--- |
| `id` | `Integer` (PK) | Unique snapshot record ID |
| `website_id` | `ForeignKey("websites.id")` | Associated Website |
| `query_set_id` | `ForeignKey("query_sets.id")` (Nullable) | Associated QuerySet |
| `provider` | `String(100)` (Nullable) | Provider identifier |
| `period_start` | `DateTime` | Snapshot window start |
| `period_end` | `DateTime` | Snapshot window end |
| `evaluable_responses` | `Integer` | Count of evaluable responses |
| `total_attempts` | `Integer` | Total execution attempts |
| `mention_count` | `Integer` | Total target mentions |
| `citation_count` | `Integer` | Total target citations |
| `first_party_citation_count`| `Integer` | Total first-party citations |
| `competitor_appearance_count`| `Integer` | Total competitor appearances |
| `mention_rate` | `Float` (Nullable) | Mention rate |
| `citation_rate` | `Float` (Nullable) | Citation rate |
| `first_party_citation_rate` | `Float` (Nullable) | First-party citation rate |
| `competitor_appearance_rate`| `Float` (Nullable) | Competitor appearance rate |
| `metrics_json` | `JSON` (Nullable) | Full metrics summary & breakdowns |
| `created_at` | `DateTime` | Snapshot creation timestamp (UTC) |

---

## 10. REST API Endpoints

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/v1/websites/{website_id}/visibility-metrics` | Retrieves comprehensive visibility metrics with multi-dimensional filters |
| `GET` | `/api/v1/query-sets/{query_set_id}/visibility-metrics` | Retrieves aggregated visibility metrics for a QuerySet |
| `GET` | `/api/v1/queries/{query_id}/visibility-metrics` | Retrieves visibility metrics for a single Query |
| `GET` | `/api/v1/websites/{website_id}/provider-metrics` | Retrieves separate visibility metrics broken down by AI provider |
| `GET` | `/api/v1/websites/{website_id}/operational-health` | Retrieves operational provider health metrics (success rates, errors, tokens) |
| `GET` | `/api/v1/websites/{website_id}/visibility-history` | Compares visibility metrics between current and previous periods |
| `GET` | `/api/v1/websites/{website_id}/visibility-timeline` | Retrieves daily timeline of visibility metrics |
| `POST` | `/api/v1/query-sets/{query_set_id}/snapshots` | Computes current metrics and persists a historical snapshot record |
| `GET` | `/api/v1/query-sets/{query_set_id}/snapshots` | Lists historical snapshot records for a QuerySet |

---

## 11. Sample Serialized Visibility Metrics Output

Serialized output from `GET /api/v1/websites/1/visibility-metrics`:
```json
{
  "website_id": 1,
  "query_set_id": null,
  "query_id": null,
  "provider": null,
  "model": null,
  "total_attempts": 4,
  "evaluable_responses": 3,
  "failed_responses": 1,
  "mention_metrics": {
    "numerator": 2,
    "denominator": 3,
    "rate": 0.6667
  },
  "citation_metrics": {
    "numerator": 1,
    "denominator": 3,
    "rate": 0.3333
  },
  "first_party_citation_metrics": {
    "numerator": 1,
    "denominator": 3,
    "rate": 0.3333
  },
  "relevant_answer_metrics": {
    "numerator": 2,
    "denominator": 3,
    "rate": 0.6667
  },
  "competitor_appearance_metrics": {
    "numerator": 2,
    "denominator": 3,
    "rate": 0.6667
  },
  "target_vs_competitor": {
    "target_mentioned_count": 2,
    "target_cited_count": 1,
    "competitor_present_count": 2,
    "target_absent_competitor_present_count": 1,
    "target_present_competitor_absent_count": 1,
    "both_present_count": 1,
    "neither_present_count": 0
  },
  "operational_health": {
    "total_attempts": 4,
    "successful_responses": 3,
    "timeout_count": 1,
    "rate_limit_count": 0,
    "unavailable_count": 0,
    "error_count": 0,
    "success_rate": 0.75,
    "avg_latency_ms": 316.7,
    "total_input_tokens": 370,
    "total_output_tokens": 190,
    "total_tokens": 560
  },
  "top_competitors": [
    {
      "competitor_name": "SearchOptima",
      "domain": "searchoptima.com",
      "mention_count": 2,
      "citation_count": 0,
      "appearance_count": 2,
      "appearance_rate": 0.6667,
      "first_mention_position_avg": 6.5
    }
  ],
  "gap_summary": {
    "total_gaps": 2,
    "gap_type_counts": {
      "MENTION_WITHOUT_CITATION": 1,
      "COMPETITOR_PRESENT_TARGET_ABSENT": 1
    }
  },
  "calculated_at": "2026-09-03T20:45:00Z"
}
```

---

## 7. Step 7: Monitoring Pipeline & API Layer

### 7.1 Architecture & Lifecycle

```text
QuerySet (Active Queries)
   │
   ▼
Monitoring Pipeline (`MonitoringPipelineService`)
   │
   ├── 1. Lifecycle State: CREATED ──> RUNNING
   │
   ├── 2. Provider Adapter Execution (Bounded loop over active queries)
   │      ├── Success: Capture response in `ai_responses`
   │      │     └── Detection ──> Visibility Signals ──> Gap Analysis & Linkage
   │      └── Failure (Timeout, Rate-Limit, Error): Capture failure in `ai_responses`
   │
   ├── 3. Observational Metrics Calculation (`VisibilityMetricsService`)
   │
   └── 4. Lifecycle Completion:
          ├── 0 failures: COMPLETED
          ├── Mixed: PARTIAL
          └── 0 successes: FAILED
```

> **Important Boundary Distinction**:
> A monitoring run is an execution container for observed provider responses. It does not represent a guaranteed AI ranking or future visibility outcome.

### 7.2 Database Schema: `ai_monitoring_runs`

| Column | Type | Description |
|---|---|---|
| `id` | `INTEGER PK` | Unique monitoring run identifier |
| `website_id` | `INTEGER FK` | Reference to `websites.id` |
| `query_set_id` | `INTEGER FK` | Reference to `query_sets.id` |
| `provider` | `VARCHAR(100)` | Target provider (e.g. `mock`, `openai`, `perplexity`) |
| `model` | `VARCHAR(100)` | Target model name if specified |
| `status` | `VARCHAR(50)` | `CREATED`, `RUNNING`, `COMPLETED`, `PARTIAL`, `FAILED` |
| `total_queries` | `INTEGER` | Total active queries in query set |
| `attempted_queries` | `INTEGER` | Count of executed query attempts |
| `successful_responses` | `INTEGER` | Successful provider responses |
| `failed_responses` | `INTEGER` | Failed provider responses |
| `detected_mentions` | `INTEGER` | Total brand/alias mentions detected |
| `detected_citations` | `INTEGER` | Total citations detected |
| `detected_gaps` | `INTEGER` | Total visibility gaps identified |
| `mention_rate` | `FLOAT` | Target brand mention rate across evaluable responses |
| `citation_rate` | `FLOAT` | Target citation rate across evaluable responses |
| `error_message` | `TEXT` | Failure message if run failed entirely |
| `execution_metadata_json` | `JSON` | Run metadata, response IDs, metrics summary, errors |
| `started_at` | `DATETIME` | Run start timestamp |
| `completed_at` | `DATETIME` | Run completion timestamp |
| `created_at` | `DATETIME` | Run creation timestamp |

### 7.3 REST API Endpoints

- `POST /api/v1/query-sets/{query_set_id}/monitor`: Trigger an end-to-end monitoring run.
- `GET /api/v1/monitoring-runs/{run_id}`: Inspect run status, progress, and summary counts.
- `GET /api/v1/monitoring-runs/{run_id}/results`: Retrieve comprehensive itemized results with detections, observations, gaps, linked findings, and summary metrics.
- `GET /api/v1/websites/{website_id}/monitoring-runs`: List historical runs for a website.
- `GET /api/v1/query-sets/{query_set_id}/monitoring-runs`: List historical runs for a query set.

---

## 8. Step 8: Security, Validation, and Operational Boundaries

### 8.1 Security Architecture & SSRF Protection
- **No Inbound Secrets**: Provider API keys and credentials reside strictly server-side in secure configuration. No client request may inject credentials or alter provider destination hosts.
- **SSRF Prevention**: Citation URLs detected in provider responses are recorded and normalized purely as string/text evidence. The system **never** performs automatic outbound HTTP requests to extracted URLs.
- **Workspace & Site Isolation**: All queries, responses, observations, gaps, and monitoring runs enforce foreign-key boundaries against `websites.id`. Cross-website data leakage is blocked.
- **Credential Sanitization**: Serialized API responses and log outputs are audited to guarantee zero leakage of tokens, authorization headers, or secrets.

### 8.2 Bounded Execution & Rate Limiting
- **Bounded Queries**: Monitoring runs execute only against active queries (`Query.active.is_(True)`).
- **Finite Retries**: Provider adapter requests employ bounded retries ($\le 3$) with exponential backoff and absolute timeout clamps.
- **Deterministic Lifecycle**: Every monitoring run has bounded progress tracking ($0 \le \text{attempted} \le \text{total}$) and guarantees terminal transition to `COMPLETED`, `PARTIAL`, or `FAILED`.

### 8.3 Provider Fixture Validation (Cases A through J)
The monitoring engine is verified against 10 deterministic response scenarios:
- **Case A (Mention + Citation)**: Target brand mentioned and target domain cited ($0$ gaps).
- **Case B (Mention Only)**: Target mentioned without URL citation ($\rightarrow \text{MENTION\_WITHOUT\_CITATION}$ gap).
- **Case C (Competitor Present, Target Absent)**: Target absent while configured competitor appears ($\rightarrow \text{COMPETITOR\_PRESENT\_TARGET\_ABSENT}$ gap).
- **Case D (Target Absent, No Competitor)**: General response without target or competitor ($\rightarrow \text{TARGET\_ABSENT}$ gap).
- **Case E (Citation Only)**: Target domain cited without textual brand name ($\rightarrow \text{target\_cited} = \text{True}$).
- **Case F (Conservative Brand Matching)**: Unrelated same-name geographic or generic entities correctly rejected.
- **Case G (Timeout)**: Provider timeout isolated; response marked `TIMEOUT`; strictly excluded from visibility gap creation and rate denominators.
- **Case H (Rate Limit)**: Provider HTTP 429 response isolated; marked `RATE_LIMITED`.
- **Case I (Unavailable)**: Provider disabled or unconfigured; marked `UNAVAILABLE`.
- **Case J (Valid General Response)**: Valid response with no target presence counts as evaluable (denominator $+1$, numerator $0$).

### 8.4 Known Limitations & Non-Goals
> **Core Principles & Disclaimers**:
> 1. **Observational Evidence**: AI visibility observations reflect captured provider responses at specific points in time. They do not constitute guaranteed search rankings, global share-of-voice, or future visibility assurances.
> 2. **Operational Failure Isolation**: Provider timeouts and API errors represent operational conditions and are **never** treated as evidence that the target was invisible to AI search engines.
> 3. **Separation from Task 8 Scoring**: Task 8's deterministic readiness score (`/100`) remains distinct from observational visibility rates.


