# Raval AI GEO / AEO / SEO Intelligence

## Purpose

Raval AI GEO / AEO / SEO Intelligence is an independent module for analyzing website search visibility, content, entities, AI visibility, citations, competitors, recommendations, fixes, validation, and monitoring.

This project is being developed as a separate repository from the Raval AI production codebase.

The module is intentionally isolated during development so that its architecture, implementation, testing, and review can be completed independently before any future integration.

## What This Module Does

The planned system follows this overall workflow:

```text
Scan
  ↓
Understand
  ↓
Analyze
  ↓
Detect Issues
  ↓
Prioritize
  ↓
Recommend
  ↓
Fix
  ↓
Validate
  ↓
Monitor
```

The complete module is designed around the following major capabilities:

Website Crawler
Technical SEO Intelligence
Content Intelligence
Entity Intelligence
GEO/AEO Intelligence
AI Visibility Analysis
Citation Intelligence
Competitor Intelligence
Search Console & Analytics
Recommendation Engine
Automated Fix Engine
Validation
Continuous Monitoring

## Day 1 Scope

Day 1 focuses on understanding the complete module and establishing its isolated development foundation.

The Day 1 work includes:

Understanding the complete system
Creating the separate repository
Creating the initial project structure
Researching and recommending the technology stack
Designing the initial architecture
Documenting the architecture
Preparing the development foundation

The individual intelligence modules are not being fully implemented as part of the Day 1 foundation task.

## Day 2 Scope

Day 2 focuses on converting the documented architecture into a working backend foundation.

The Day 2 work includes:

- Implementing the initial FastAPI backend
- Creating the database connection layer
- Creating the initial Website and Scan models
- Implementing API request/response schemas
- Implementing service-layer business rules
- Implementing scan lifecycle validation
- Creating core API endpoints
- Running automated backend tests
- Verifying the API manually through Swagger UI

The Day 2 implementation is intentionally limited to the core foundation.

The full crawler, SEO intelligence, GEO/AEO analysis, AI benchmarking, competitor intelligence, recommendation engine, fix engine, and monitoring systems are future implementation areas.

## Project Structure
raval-geo-intelligence/
│
├── frontend/
├── backend/
├── crawler/
├── seo-engine/
├── entity-engine/
├── content-engine/
├── ai-benchmark/
├── citation-engine/
├── competitor-engine/
├── analytics/
├── opportunity-engine/
├── fix-engine/
├── connectors/
├── validation/
├── database/
├── tests/
├── docs/
│
├── README.md
└── .env.example

The folders establish the initial separation of responsibilities.

They do not imply that every module is implemented during Day 1.

## Technology Stack

The proposed technology stack is documented in:

docs/TECHNOLOGY_STACK.md

The architecture is documented in:

docs/ARCHITECTURE.md

The technology research considers:

Performance
Reliability
Maintainability
Security
Cost
Production SaaS suitability
Alternative technologies

## Architecture

The high-level system flow is:

Website
   ↓
Crawler
   ↓
Website Data
   ↓
SEO / Content / Entity Analysis
   ↓
GEO / AEO / AI Analysis
   ↓
Analytics & Competitor Data
   ↓
Unified Intelligence
   ↓
Recommendations
   ↓
Fix Generation
   ↓
Validation
   ↓
Monitoring

Detailed responsibilities, boundaries, data flow, and future integration approach are documented in:

docs/ARCHITECTURE.md

## Development Principle

This project is intentionally independent from the Raval AI production codebase.

There should be:

No direct dependency on the production codebase
No unnecessary copying of production code
No modification of Raval AI production code as part of this foundation task

Future integration should happen only after completion, testing, and review.

## Configuration

Environment-specific configuration will be provided through environment variables.

Real API keys, passwords, tokens, or other secrets must never be committed to the repository.

The example environment configuration is provided in:

.env.example

## Current Status

### Day 1 — Completed

- Independent project repository
- Git repository
- GitHub remote
- Initial project structure
- Architecture documentation
- Technology stack documentation
- Data model documentation
- ERD
- API/service boundary documentation
- Validation and technical decision documentation

### Day 2 — Completed

- FastAPI backend foundation
- Database connection layer
- Initial Website and Scan models
- API schemas
- Service layer
- Scan lifecycle validation
- Core API endpoints
- Automated backend tests
- Manual API verification through Swagger UI

### Task 3 (Crawler Foundation & Scan Pipeline) — Completed

- Independent Python Crawler package (`crawler/`):
  - Strict configuration model (`CrawlerConfig`) with safety constraints
  - FIFO stateful queue (`CrawlQueue`) with deduplication and state tracking
  - Resilient HTTP fetcher (`PageFetcher`) with timeout, retry backoff, redirect capture, and error isolation
  - `robots.txt` rule evaluation and sitemap declaration extraction (`RobotsChecker`)
  - XML sitemap parser supporting URL sets and recursive sitemap indexes (`parse_sitemap_xml`)
  - HTML link discovery with URL normalization and domain boundary enforcement (`discover_links`)
  - Concurrency, rate limiting (request delay), and cooperative cancellation controls
- Backend Integration & Persistence:
  - `PageResult` database model linked to `Scan` (1-to-many relationship)
  - `run_scan()` service executing crawl, capturing page evidence, and updating scan lifecycle
  - `POST /api/v1/scans/{scan_id}/run` to trigger crawl executions
  - `GET /api/v1/scans/{scan_id}/pages` with scan isolation and evidence serialization
- Automated Testing Suite:
  - 131 automated tests passing across crawler units, integration, database persistence, and API routes

### Backend Verification

The following core flow has been successfully verified:

```text
Create Website
      ↓
Create Scan
      ↓
Run Scan (Crawler Execution)
      ↓
Persist Pages & Evidence
      ↓
completed
```

## Future Development

After the Task 4 Page Extraction Engine is completed, implementation can proceed incrementally according to the documented architecture.

Future implementation areas may include:

- Headless browser rendering (e.g. Playwright for complex client-side dynamic rendering)
- Technical SEO scoring engine
- Content intelligence & quality scoring
- Entity intelligence & knowledge graph mapping
- GEO/AEO visibility scoring
- AI visibility benchmarking & citations
- Competitor intelligence
- Search Console & Analytics connectors
- Opportunity & automated fix engine
- Continuous monitoring

### Current Boundary

The current implementation provides:
- A high-performance website crawler engine with polite rate-limiting, robots.txt, sitemap parsing, and scan lifecycle management.
- A comprehensive 13-domain structured Page Extraction Engine capturing titles, meta descriptions, headings, canonicals, robots directives, social metadata (OG/Twitter), JSON-LD, microdata, breadcrumbs, images, links, language/hreflang, clean content, and indexability evidence.
- A complete, deterministic Content Intelligence & AEO/GEO Engine featuring 11 specialized sub-analyzers: Content Structure, Topic & Semantics, Entity Extraction, Question Detection, Answer Detection, Answer-Readiness Scoring, Content Gap Analysis, Evidence Quality & Superlative Detection, Search Intent Inference, Semantic Coverage, Master Content Intelligence Synthesis, and Defensive Content Quality Checks.
- Finding and Recommendation foundations with multi-tenant and historical scan isolation.
- 350+ automated unit, integration, and real-site tests verifying the full pipeline.

## Repository

This project is maintained as a separate repository for the Raval AI GEO / AEO / SEO Intelligence module.

## Security

The project follows these basic security principles:

Never commit API keys
Never commit passwords
Never commit authentication tokens
Use environment variables for secrets
Keep external integrations behind controlled boundaries
Validate external inputs
Keep the architecture modular
Make important logic testable

## Documentation

Core project documentation:

- `docs/ARCHITECTURE.md` — system architecture
- `docs/CONTENT_AEO_RULES.md` — Content AEO, GEO & SEO intelligence rules specification
- `docs/PAGE_EXTRACTION.md` — page extraction engine specification
- `docs/DATA_MODEL.md` — core database/data model
- `docs/ERD.png` — entity relationship diagram
- `docs/TECHNOLOGY_STACK.md` — technology decisions
- `docs/TECHNICAL_QUESTIONS.md` — open technical questions
- `docs/API_BOUNDARIES.md` — initial API and service boundaries
- `docs/VALIDATION_RULES.md` — validation layers and backend validation rules
