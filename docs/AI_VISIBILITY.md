# AI Visibility & Answer Monitoring Engine — Query Intelligence Subsystem (Task 10 Step 1)

## 1. Overview & Architecture

The **Query Intelligence & Reusable Query Set Subsystem** is the foundational Step 1 of the Raval AI Visibility & Answer Monitoring Engine (Task 10). It converts site intelligence (Topics, Entities, Questions, and Content) into deterministic, explainable, and reusable monitoring query collections called **QuerySets**.

These query sets will serve as standard input vectors for subsequent Task 10 monitoring steps (Provider Adapters, Answer Capture, Citation Detection, and Visibility Gap Analysis).

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
|                     QUERY INTELLIGENCE SERVICE                                 |
|                                                                                |
|  1. Candidate Generation Across 4 Intents (Informational/Commercial/...)       |
|  2. Bounded Natural-Language Wording Variant Expansion (MAX_VARIANTS_PER_SRC) |
|  3. Multi-Level Normalization (Casing, Whitespace, Contractions, Filler)      |
|  4. Deterministic Semantic Deduplication (Token-Set Jaccard & Canonical Key)   |
|  5. Provenance Linkage (Topic, Entity, Page) & Generation Source Tagging       |
|  6. Deterministic Priority & Confidence Assignment                             |
+-------------------------------------+------------------------------------------+
                                      v
+--------------------------------------------------------------------------------+
|                     PERSISTENT STORAGE & QUERY SETS                            |
|                                                                                |
|    QuerySet (id, website_id, scan_id, name, version, status, timestamps)       |
|       |                                                                        |
|       +--> Query 1 (id, query_text, intent, source, priority, confidence, ...) |
|       +--> Query 2 (id, query_text, intent, source, priority, confidence, ...) |
|       +--> Query N ...                                                         |
+--------------------------------------------------------------------------------+
```

---

## 2. Data Models

### 2.1 QuerySet Model (`query_sets` table)
Represents a reusable, versioned collection of search/monitoring queries associated with a website and optional scan run.

| Field | Type | Description |
| :--- | :--- | :--- |
| `id` | `Integer` (PK) | Unique primary key identifier |
| `website_id` | `ForeignKey("websites.id")` | Associated website / workspace |
| `scan_id` | `ForeignKey("scans.id")` (Nullable) | Associated scan run if generated from a crawl |
| `name` | `String(255)` | Descriptive name of the QuerySet |
| `description` | `Text` (Nullable) | Human-readable explanation and context |
| `version` | `String(50)` | Version identifier (e.g., `"1.0"`, `"2.0"`) |
| `status` | `String(50)` | QuerySet lifecycle status (`"active"`, `"archived"`, `"draft"`) |
| `created_at` | `DateTime` | Creation timestamp in UTC |
| `updated_at` | `DateTime` | Last update timestamp in UTC |

**Relationships:**
- `website`: Belongs to `Website`
- `scan`: Optional relationship to `Scan`
- `queries`: One-to-many relationship with `Query` (`cascade="all, delete-orphan"`)

### 2.2 Query Model (`queries` table)
Represents a single persistent, traceable search query within a `QuerySet`.

| Field | Type | Description |
| :--- | :--- | :--- |
| `id` | `Integer` (PK) | Unique primary key identifier |
| `query_set_id` | `ForeignKey("query_sets.id")` | Parent QuerySet ID |
| `website_id` | `ForeignKey("websites.id")` | Website / workspace isolation key |
| `query_text` | `Text` | The formatted search query / prompt text |
| `intent` | `String(50)` | Query intent category (`INFORMATIONAL`, `COMMERCIAL`, `COMPARISON`, `PROBLEM_SOLVING`) |
| `topic_id` | `String(255)` (Nullable) | Canonical slug or ID of the originating topic |
| `topic` | `String(255)` (Nullable) | Topic text name |
| `entity_id` | `ForeignKey("entities.id")` (Nullable) | FK to persistent `Entity` record if derived from an entity |
| `entity_name` | `String(255)` (Nullable) | Name of the associated entity |
| `page_id` | `ForeignKey("page_results.id")` (Nullable) | FK to originating `PageResult` |
| `generation_source` | `String(100)` | Generation source (`TOPIC_INTELLIGENCE`, `ENTITY_INTELLIGENCE`, `QUESTION_INTELLIGENCE`, `CONTENT_INTELLIGENCE`) |
| `priority` | `String(20)` | Deterministic priority (`HIGH`, `MEDIUM`, `LOW`) |
| `confidence` | `Float` | Deterministic generation confidence ($0.0 \le c \le 1.0$) |
| `version` | `String(50)` | Query version string matching QuerySet version |
| `active` | `Boolean` | Active monitoring flag (`True` or `False`) |
| `metadata_json` | `JSON` (Nullable) | Source type, raw templates, variant history, and evidence details |
| `created_at` | `DateTime` | Creation timestamp in UTC |
| `updated_at` | `DateTime` | Last update timestamp in UTC |

---

## 3. Query Intent Categories

The system classifies every query deterministically into one of four required categories:

1. **`INFORMATIONAL`**:
   - Focus: Foundational understanding, definitions, concepts, and how mechanisms operate.
   - Patterns: `"What is [topic]?"`, `"How does [topic] work?"`, `"What are the key benefits of [topic]?"`
2. **`COMMERCIAL`**:
   - Focus: Buying criteria, product/service discovery, vendor selection, pricing, and reviews.
   - Patterns: `"What are the best [topic] solutions?"`, `"Which [platform] should I choose for [use case]?"`, `"Pricing and features for [entity]"`
3. **`COMPARISON`**:
   - Focus: Contrasting alternatives, competitor positioning, and differential analysis.
   - Patterns: `"[Brand] vs top alternatives"`, `"What is the difference between [A] and [B]?"`, `"Which is better for [use case]: [Brand] or competitors?"`
4. **`PROBLEM_SOLVING`**:
   - Focus: Troubleshooting, fixing errors, addressing gaps, optimization, and remediation.
   - Patterns: `"How to solve common [topic] challenges?"`, `"What is the best way to optimize [topic]?"`, `"How to address missing [gap] in [topic]?"`

---

## 4. Query Generation Sources & Linkage

Queries preserve complete provenance back to existing Task 5–9 engines:

- **`TOPIC_INTELLIGENCE`**:
  - Ingests `primary_topic`, `supporting_topics`, and keywords from `TopicSemanticAnalyzer`.
  - Generates Informational, Commercial, and Problem-Solving queries.
  - Preserves `topic` and `topic_id`.
- **`ENTITY_INTELLIGENCE`**:
  - Ingests Organization, Brand, and Product entities from `EntityAnalyzer` and persistent `Entity` records.
  - Generates Brand Overview, Commercial, and Comparison queries.
  - Preserves `entity_id` and `entity_name`.
- **`QUESTION_INTELLIGENCE`**:
  - Ingests detected questions from headings, FAQ schemas (`PageStructuredData`), and content sections from `QuestionAnalyzer`.
  - Preserves `has_answer`, `source_type`, and `original_question`.
- **`CONTENT_INTELLIGENCE`**:
  - Ingests content gaps, unanswered questions, and key strengths from `ContentIntelligenceAnalyzer`.
  - Preserves `finding_type` and links to the relevant `page_id`.

> [!IMPORTANT]
> Missing linkages strictly remain `null`/`None` rather than being fabricated. If a query is derived purely from a topic without an entity, `entity_id` and `entity_name` remain `None`.

---

## 5. Bounded Wording Variants & Multi-Level Deduplication

To prevent combinatorial explosion and avoid flooding monitoring runs with duplicate queries, the generator enforces strict bounds and deterministic deduplication.

### 5.1 Bounded Variants
- `MAX_VARIANTS_PER_SOURCE` (Default: `3`, configurable $1 \le N \le 10$).
- `MAX_TOTAL_QUERIES` (Default: `250`, configurable $1 \le N \le 1000$).
- Deterministic template variations without unbounded combinatorial permutation.

### 5.2 Multi-Level Deduplication Algorithm
1. **Level 1 — Exact Normalization**:
   - Whitespace stripping and multi-space collapsing.
   - Lowercasing.
   - Contraction expansion (`"what's"` $\rightarrow$ `"what is"`, `"can't"` $\rightarrow$ `"cannot"`).
   - Conversational filler prefix stripping (`"can you please explain"`, `"tell me about"`, `"i want to know"`).
   - Punctuation removal for signature comparison.
2. **Level 2 — Deterministic Semantic Deduplication**:
   - Stop-word filtering (`STOP_WORDS` standard token set).
   - Token-set Jaccard similarity metric and subset ratio calculation.
   - Threshold $\ge 0.85$ matches are grouped into a single canonical query.
   - The query with highest priority and confidence is retained as the primary query; alternate phrasings are preserved in `metadata_json["variants"]`.
   - 100% deterministic and local (no external LLM/API calls).

---

## 6. Deterministic Priority & Confidence Scoring

### 6.1 Priority Scale (`HIGH`, `MEDIUM`, `LOW`)
- **`HIGH`**:
  - Commercial/Comparison queries for primary brand/product entities.
  - Questions found in page title or H1 tags.
  - FAQ schema questions with verified answer presence.
  - Core primary topic with confidence $\ge 0.7$ present in title and H1.
- **`MEDIUM`**:
  - Informational queries on primary topics.
  - Supporting topics and secondary entities.
  - Standard H2/H3 detected questions.
  - Content gap remediation queries.
- **`LOW`**:
  - Keyword cluster topics with lower confidence ($< 0.5$).
  - Broad background questions and generic content strengths.

### 6.2 Generation Confidence ($0.0 \le \text{confidence} \le 1.0$)
Confidence measures **derivation validity from source intelligence**, bounded strictly between 0.0 and 1.0. Grounded signals (presence in structured data, titles, or explicit headings) boost confidence.

---

## 7. Versioning & Active/Inactive Lifecycle

- **Versioning**: Each `QuerySet` has an immutable version (e.g., `"1.0"`, `"1.1"`, `"2.0"`). Creating a new generation creates a distinct `QuerySet` record with its own `Query` records without overwriting or deleting historical sets.
- **Active State Toggle**: Individual queries can be deactivated (`active=False`). Deactivated queries remain persisted in the database for historical auditability and reproducibility of past monitoring runs.

---

## 8. REST API Endpoints

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/api/v1/websites/{website_id}/query-sets/generate` | Generates a reusable QuerySet from website intelligence |
| `POST` | `/api/v1/scans/{scan_id}/query-sets/generate` | Generates a reusable QuerySet from a specific scan crawl |
| `POST` | `/api/v1/query-sets/generate` | General generation endpoint accepting `website_id` and optional `scan_id` |
| `POST` | `/api/v1/websites/{website_id}/query-sets` | Creates a custom/empty QuerySet |
| `GET` | `/api/v1/websites/{website_id}/query-sets` | Lists QuerySets for a website |
| `GET` | `/api/v1/query-sets` | Lists QuerySets with optional status/version filters |
| `GET` | `/api/v1/query-sets/{query_set_id}` | Retrieves QuerySet detail with summary counts |
| `PATCH` | `/api/v1/query-sets/{query_set_id}` | Updates QuerySet metadata (name, description, status, version) |
| `GET` | `/api/v1/query-sets/{query_set_id}/queries` | Lists queries with filters (`active_only`, `intent`, `priority`, `source`) |
| `POST` | `/api/v1/query-sets/{query_set_id}/queries` | Adds a custom query to a QuerySet |
| `GET` | `/api/v1/queries/{query_id}` | Retrieves a single query record |
| `PATCH` | `/api/v1/queries/{query_id}` | Updates query fields (text, intent, priority, confidence) |
| `PATCH` | `/api/v1/queries/{query_id}/status` | Toggles query active/inactive state |
| `DELETE` | `/api/v1/queries/{query_id}` | Deletes a query record |

---

## 9. Sample Output

Example serialized QuerySet response from `POST /api/v1/websites/1/query-sets/generate`:

```json
{
  "id": 1,
  "website_id": 1,
  "scan_id": 1,
  "name": "Acme AI Monitoring Query Set",
  "description": "Auto-generated reusable query set derived from site intelligence for https://acme.ai.",
  "version": "1.0",
  "status": "active",
  "total_queries": 14,
  "active_queries": 14,
  "created_at": "2026-09-03T14:20:00Z",
  "updated_at": "2026-09-03T14:20:00Z",
  "queries": [
    {
      "id": 1,
      "query_set_id": 1,
      "website_id": 1,
      "query_text": "What is Generative Engine Optimization?",
      "intent": "INFORMATIONAL",
      "topic_id": "generative-engine-optimization",
      "topic": "Generative Engine Optimization",
      "entity_id": null,
      "entity_name": null,
      "page_id": 1,
      "generation_source": "TOPIC_INTELLIGENCE",
      "priority": "HIGH",
      "confidence": 0.95,
      "version": "1.0",
      "active": true,
      "metadata_json": {
        "source_type": "primary_topic",
        "in_title": true,
        "in_h1": true,
        "variants": [
          "How does Generative Engine Optimization work?",
          "Can you explain what Generative Engine Optimization is?"
        ]
      },
      "created_at": "2026-09-03T14:20:00Z",
      "updated_at": "2026-09-03T14:20:00Z"
    },
    {
      "id": 2,
      "query_set_id": 1,
      "website_id": 1,
      "query_text": "Acme Platform vs top alternatives",
      "intent": "COMPARISON",
      "topic_id": null,
      "topic": "Generative Engine Optimization",
      "entity_id": 1,
      "entity_name": "Acme Platform",
      "page_id": 1,
      "generation_source": "ENTITY_INTELLIGENCE",
      "priority": "HIGH",
      "confidence": 0.92,
      "version": "1.0",
      "active": true,
      "metadata_json": {
        "entity_type": "product",
        "source_type": "entity_comparison"
      },
      "created_at": "2026-09-03T14:20:00Z",
      "updated_at": "2026-09-03T14:20:00Z"
    },
    {
      "id": 3,
      "query_set_id": 1,
      "website_id": 1,
      "query_text": "How to optimize content for AI engines?",
      "intent": "PROBLEM_SOLVING",
      "topic_id": null,
      "topic": "Generative Engine Optimization",
      "entity_id": null,
      "entity_name": null,
      "page_id": 1,
      "generation_source": "QUESTION_INTELLIGENCE",
      "priority": "HIGH",
      "confidence": 0.95,
      "version": "1.0",
      "active": true,
      "metadata_json": {
        "source_type": "faq_schema",
        "has_answer": true
      },
      "created_at": "2026-09-03T14:20:00Z",
      "updated_at": "2026-09-03T14:20:00Z"
    }
  ]
}
```

---

## 10. Scope Boundaries & Current Limitations

- **Step 1 Only**: This subsystem exclusively generates, deduplicates, and stores queries and query sets.
- **No Provider Calls**: External LLM/AI search provider calls (OpenAI, Perplexity, Gemini, Claude, Copilot) are **not** implemented in this step.
- **No Response/Citation Capture**: Live answer fetching, mention detection, and citation extraction belong to subsequent steps of Task 10.
- **Local Deterministic Deduplication**: Semantic deduplication relies on canonical lexical and token-set similarity rather than heavy embedding vectors or third-party cloud APIs.

---

## 11. Testing & Validation

Automated test suites:
- `backend/tests/test_query_intelligence.py` (Unit tests for normalization, intent categorization, bounded variant generators, 4 source generators, 2-level deduplication, versioning, provenance, and active state management).
- `backend/tests/test_query_api.py` (Integration tests for all REST API endpoints, filter query parameters, status updates, and HTTP 4xx validation errors).

**Test Results:**
- 21/21 Query Intelligence & API tests passing.
- 787/787 full suite tests passing with 0 failures and 0 regressions.
