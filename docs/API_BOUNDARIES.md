# Raval Core API Boundaries

## 1. Purpose

This document defines the initial API/service boundaries
for the Raval AI GEO / AEO / SEO Intelligence foundation.

The API provides stable boundaries between clients,
application services, and future workers/connectors.

## 2. API Version

All initial endpoints use:

/api/v1

## 3. Website Management

POST /api/v1/websites
GET /api/v1/websites
GET /api/v1/websites/{website_id}

## 4. Scan Management

POST /api/v1/websites/{website_id}/scans
GET /api/v1/websites/{website_id}/scans
GET /api/v1/scans/{scan_id}
POST /api/v1/scans/{scan_id}/cancel

Scan operations are asynchronous and use the lifecycle
defined in SCAN_AND_RUN_STATES.md.

## 5. Pages

GET /api/v1/websites/{website_id}/pages
GET /api/v1/pages/{page_id}
GET /api/v1/scans/{scan_id}/page-observations

## 6. Findings

GET /api/v1/websites/{website_id}/findings
GET /api/v1/findings/{finding_id}

## 7. Recommendations

GET /api/v1/websites/{website_id}/recommendations
GET /api/v1/findings/{finding_id}/recommendations
GET /api/v1/recommendations/{recommendation_id}

## 8. AI Runs

POST /api/v1/websites/{website_id}/ai-runs
GET /api/v1/ai-runs/{run_id}
GET /api/v1/ai-runs/{run_id}/result
GET /api/v1/ai-results/{result_id}/citations

AI runs are asynchronous and use the same lifecycle
state model as scans.

## 9. Service Boundaries

The initial service boundaries are:

- WebsiteService
- ScanService
- PageService
- FindingService
- RecommendationService
- AIRunService

## 10. Design Rules

- API clients should not directly access database tables.
- Long-running operations return an execution identifier.
- Scan and AI execution status is queried separately.
- Historical executions are preserved.
- Findings remain traceable to their scan and page.
- AI results remain traceable to their question and run.
- API versioning begins at v1.

## 11. Implemented API & Execution Flow

The backend implements the core Website, Scan, and Crawled Page API flow.

### Implemented Endpoints

The current backend provides the core endpoints required for website management, scan execution, and page evidence inspection:

#### Website
- `POST /api/v1/websites` — Creates a website record.

#### Scan Lifecycle
- `POST /api/v1/websites/{website_id}/scans` — Creates a new scan associated with a website (initial state: `queued`).
- `GET /api/v1/scans/{scan_id}` — Returns scan details, counts (`pages_crawled`, `pages_failed`, `pages_skipped`), and lifecycle state.
- `POST /api/v1/scans/{scan_id}/run` — Executes the website crawler for the scan, persists page-level evidence, and completes the scan.

#### Crawled Pages Evidence
- `GET /api/v1/scans/{scan_id}/pages` — Returns all crawled page records belonging to the scan with strict scan isolation (URL, final URL, HTTP status code, content type, depth, parent URL, errors, timestamp).
- `GET /api/v1/scans/{scan_id}/page-intelligence` — Returns the list of crawled PageResults for the scan together with their persisted extraction evidence.

#### Page Extraction & Structured Page Intelligence
- `GET /api/v1/pages/{page_id}/intelligence` — Returns full aggregated intelligence for a single page (raw PageResult attributes + nested PageExtraction evidence models).
- `GET /api/v1/pages/{page_id}/extraction` — Returns the core `PageExtraction` status record for the page.
- `GET /api/v1/pages/{page_id}/metadata` — Returns page title extraction fields, meta descriptions, social metadata (Open Graph / Twitter), language, hreflang, canonicals, and robots directives.
- `GET /api/v1/pages/{page_id}/headings` — Returns extracted heading structure (`PageHeading` records: h1–h6, text, position, empty).
- `GET /api/v1/pages/{page_id}/structured-data` — Returns extracted JSON-LD blocks and parsed entity schemas.
- `GET /api/v1/pages/{page_id}/links` — Returns extracted internal and external link records.
- `GET /api/v1/pages/{page_id}/images` — Returns extracted image records (URL, alt text, missing/empty flags, dimensions, lazy loading).
- `GET /api/v1/pages/{page_id}/indexability` — Returns extracted indexability evidence (`PageIndexabilityEvidence` record).

### Error Handling & 404 Behavior Contract
- **Unknown Page ID (`page_id`)**: Returns HTTP 404 with `{"detail": "Page not found"}`.
- **Unknown Scan ID (`scan_id`)**: Returns HTTP 404 with `{"detail": "Scan not found"}`.
- **Existing Page without Extraction**:
  - `GET /api/v1/pages/{page_id}/intelligence` returns HTTP 200 with `extraction: null` and empty collections (`[]`) for child models.
  - Dedicated extraction endpoints (`/extraction`, `/metadata`, `/headings`, `/structured-data`, `/links`, `/images`, `/indexability`) return HTTP 404 with `{"detail": "Page extraction not found"}`.
- **Exceptions**: Database errors and stack traces are suppressed; clear HTTP client error responses are returned.

### Architectural Separation: Evidence vs Scoring
- `PageResult` is the raw crawl evidence layer.
- `PageExtraction` is the structured page extraction evidence layer.
- Extraction APIs are strictly read-only access endpoints and do NOT compute SEO, GEO, AEO, or indexability scores.

### Request Flow

The implemented API follows:

```text
Client
   ↓
FastAPI Router
   ↓
Request Schema Validation
   ↓
Service Layer (Crawler Execution / Page Intelligence / Business Logic)
   ↓
Database (Websites, Scans, PageResults, PageExtractions & Children)
   ↓
Response Schema
   ↓
Client
```

### Service Boundary

The API layer is responsible for HTTP concerns, parameter parsing, and schema validation.

The service layer owns business logic, scan state transitions, crawler invocation, and page extraction intelligence aggregation.

The database layer is responsible for persistence and referential integrity (foreign keys linking `PageResult` to `Scan`, `PageExtraction` to `PageResult`, and child extraction tables to `PageExtraction`).

### Testing

The implemented API, crawler engine, service flows, and page extraction intelligence are thoroughly verified by automated tests:

- Automated test suites verify unit logic, crawler integration, database persistence, scan isolation, extraction sub-endpoints, and full nested page intelligence.

### Implementation Boundary

The current API covers website creation, scan execution, the crawler pipeline, page evidence persistence, automated HTML extraction execution, structured page extraction evidence retrieval, and indexability signal persistence across all 13 extraction domains.

The following API areas remain future implementation work:
- SEO, GEO, and AEO scoring algorithms
- Automated recommendations and fixes
- AI visibility benchmark runs & citations
- External connectors & monitoring
