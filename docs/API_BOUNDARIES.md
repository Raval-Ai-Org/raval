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

### Request Flow

The implemented API follows:

```text
Client
   ↓
FastAPI Router
   ↓
Request Schema Validation
   ↓
Service Layer (Crawler Execution / Business Logic)
   ↓
Database (Websites, Scans, PageResults)
   ↓
Response Schema
   ↓
Client
```

### Service Boundary

The API layer is responsible for HTTP concerns, parameter parsing, and schema validation.

The service layer owns business logic, scan state transitions, and crawler invocation.

The database layer is responsible for persistence and referential integrity (foreign keys linking `PageResult` to `Scan`, and `Scan` to `Website`).

### Testing

The implemented API, crawler engine, and service flows are thoroughly verified by automated tests:

- **131 tests passing** across unit tests, service tests, database persistence tests, and API integration tests.

### Implementation Boundary

The current API covers the website creation, scan execution, crawler pipeline, and page evidence persistence.

The following API areas remain future implementation work:
- Structured page observations & entity extraction
- SEO & content findings
- Automated recommendations
- AI visibility benchmark runs & citations
- External connectors & monitoring
