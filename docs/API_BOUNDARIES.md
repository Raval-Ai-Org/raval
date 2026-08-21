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

## 11. Day 2 Implemented API

The Day 2 backend implements the initial Website and Scan API flow.

### Implemented Endpoints

The current backend provides the core endpoints required for the initial execution flow.

#### Website

```text
POST /api/v1/websites

Creates a website record.

#### Scan
POST /api/v1/websites/{website_id}/scans

Creates a scan associated with a website.

#### Scan Status
GET /api/v1/scans/{scan_id}

Returns the current scan information and lifecycle status.

#### Scan State Update

The backend supports controlled scan state transitions through the service layer.

### Request Flow

The implemented API follows:

Client
   ↓
FastAPI Router
   ↓
Request Schema
   ↓
Service Layer
   ↓
Database
   ↓
Response Schema
   ↓
Client

### Service Boundary

The API layer is responsible for HTTP concerns and request/response validation.

The service layer owns application-level business rules.

The database layer is responsible for persistence and database-level integrity.

This separation prevents API routes from containing all application logic.

### Validation Boundary

The implemented API uses three validation layers:

API Validation
      ↓
Service Validation
      ↓
Database Constraints

API validation validates request structure and data types.

Service validation enforces business rules and valid scan lifecycle transitions.

Database constraints provide persistence-level integrity.

### Scan Lifecycle

The implemented scan flow supports:

QUEUED
   ↓
RUNNING
   ↓
COMPLETED

Failure and cancellation states are also supported by the documented lifecycle model.

Invalid scan transitions are rejected by the service layer.

###Testing

The implemented API and service flow are covered by automated backend tests.

Current verification result:

5 passed

The core tests cover website creation, scan creation, lifecycle transitions, invalid transitions, and core API behavior.

### Implementation Boundary

The current API is a core foundation.

The following API areas remain future implementation work:

Page observations
Findings
Recommendations
AI runs
AI results
Citations
Competitors
Connectors
Monitoring