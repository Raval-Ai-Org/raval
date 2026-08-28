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

### Task 4 (Page Extraction Engine) — Completed
- Structured 13-domain DOM and metadata extraction (`page_extractor.py`):
  - Title, meta descriptions, headings (H1–H6), canonical URLs, robots directives, social metadata (OpenGraph & Twitter Card)
  - Schema.org structured data (JSON-LD & Microdata), breadcrumbs, images with alt text, links with anchor text, language/hreflang, clean text extraction, indexability checks

### Task 5 (Content Intelligence & AEO/GEO Engine) — Completed
- 11 specialized sub-analyzers (`content_engine.py`):
  - Content structure, topic & semantics, entity extraction, question detection, answer detection, answer-readiness scoring, content gap analysis, evidence quality & superlative detection, search intent inference, semantic coverage, master content intelligence synthesis, and defensive content quality checks

### Task 6 (Opportunity, Fix, Validation & Monitoring) — Completed
- Opportunity Engine, Prioritization & ROI scoring (`opportunity_service.py`)
- Recommendation Engine & Actionable Directives (`recommendation_service.py`)
- Fix / Action Planning Engine (`fix_service.py`)
- Validation Engine with simulation, feedback loop, and retry controls (`validation_service.py`)
- Continuous Health Monitoring & Drift Detection (`monitoring_service.py`)

### Task 7 (Authority, Citation & Trust Intelligence) — Completed
- Steps 1–2: Existing system audit & canonical data contracts (`authority_citation_schemas.py`)
- Step 3: Trust Signal Engine (`trust_engine.py`)
- Step 4: Authority Signal Engine (`authority_engine.py`)
- Step 5: External Source Detection Engine (`source_engine.py`)
- Step 6: Claim-Support Engine (`claim_support_engine.py`)
- Step 7: Source-Quality Engine (`source_quality_engine.py`)
- Step 8: First-Party Transparency Engine (`transparency_engine.py`)
- Step 9: Citation-Readiness Synthesis Engine (`citation_readiness_engine.py`)
- Step 10: Findings & Recommendations Layer with Deterministic `RULE_REGISTRY` (`authority_citation_recommendations.py`)
- Step 11: FastAPI API Integration across page, scan, website, and ad-hoc direct analysis endpoints (`main.py`)
- Step 12: Comprehensive Automated Regression Suite with False-Positive Protections (`test_authority_citation_automated_testing.py`)
- Step 13: Real-Site Validation across 5 page archetypes with safe offline fixtures (`test_authority_citation_real_site.py`)
- Step 14A: Comprehensive Documentation (`docs/AUTHORITY_CITATION_TRUST.md`)

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
Content Intelligence Analysis
      ↓
Authority, Citation & Trust Intelligence
      ↓
Findings & Recommendations Generation
      ↓
Opportunity & Fix Plan Creation
      ↓
Validation & Continuous Monitoring
```

## Current Boundary

The current implementation provides:
- High-performance website crawler engine with rate-limiting, robots.txt, and XML sitemap parsing.
- 13-domain structured Page Extraction Engine.
- Content Intelligence & AEO/GEO Engine featuring 11 specialized sub-analyzers.
- Authority, Citation & Trust Intelligence Engine featuring 7 modular signal engines, 13 deterministic rule types, explainable citation readiness synthesis, and 7 FastAPI endpoints.
- Opportunity, Fix Planning, Closed-Loop Validation, and Continuous Health Monitoring engines.
- **569 automated tests** passing across the full repository with 0 failures, 0 errors, and zero regressions.

## Repository

This project is maintained as a separate repository for the Raval AI GEO / AEO / SEO Intelligence module.

## Security

The project follows these basic security principles:
- Never commit API keys, passwords, or authentication tokens
- Use environment variables for secrets (`.env.example`)
- Keep external integrations behind controlled boundaries
- Validate external inputs
- Keep the architecture modular and deterministic
- Ensure all business and intelligence logic is fully testable

## Documentation

Core project documentation:

- `docs/ARCHITECTURE.md` — system architecture
- `docs/TRUST_AUTHORITY_CITATION_RULES.md` — Trust, Authority & Citation intelligence rules specification (Task 7)
- `docs/CONTENT_AEO_RULES.md` — Content AEO, GEO & SEO intelligence rules specification
- `docs/PAGE_EXTRACTION.md` — page extraction engine specification
- `docs/OPPORTUNITY_ENGINE.md` — opportunity and ROI scoring engine specification
- `docs/RECOMMENDATION_ENGINE.md` — recommendation engine specification
- `docs/FIX_ENGINE.md` — automated fix planning specification
- `docs/VALIDATION_ENGINE.md` — validation and closed-loop feedback engine specification
- `docs/MONITORING.md` — continuous health monitoring specification
- `docs/REAL_SITE_VERIFICATION.md` — real-site verification methodology
- `docs/DATA_MODEL.md` — core database/data model
- `docs/ERD.png` — entity relationship diagram
- `docs/TECHNOLOGY_STACK.md` — technology decisions
- `docs/TECHNICAL_QUESTIONS.md` — open technical questions
- `docs/API_BOUNDARIES.md` — API and service boundaries
- `docs/VALIDATION_RULES.md` — validation layers and backend validation rules
