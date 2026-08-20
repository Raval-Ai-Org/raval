# Raval AI Search Intelligence
# Technology Stack Research & Decisions

## 1. Purpose

This document records the proposed technology stack for the Raval AI Search Intelligence module.

The purpose is to define the technologies required for:

- Website crawling
- JavaScript rendering
- HTML parsing
- Backend/API services
- Database
- AI API integration
- Background jobs
- Testing
- Authentication
- Security

Technology decisions should prioritize:

- Reliability
- Performance
- Maintainability
- Security
- Production SaaS suitability
- Cost efficiency
- Scalability

These decisions are for the independent `raval-geo-intelligence` project and should not introduce direct dependencies on the Raval AI production codebase during Day 1 development.

---

# 2. Website Crawling

## Proposed Technology

Crawlee

## Purpose

Crawlee will be responsible for the website crawling layer.

It will manage website URL discovery, crawling queues, request handling, and crawler execution.

## Why Crawlee

Crawlee is being considered because the Raval crawler will eventually need to:

- Crawl multiple pages
- Discover internal links
- Manage crawl queues
- Handle different website types
- Support browser-based crawling
- Scale beyond a simple single-page crawler

## Alternatives Considered

- Custom crawler
- Scrapy
- Direct HTTP requests

## Decision

Crawlee is the proposed crawling framework.

The final implementation should be validated against production crawling requirements, including crawl limits, retries, concurrency, robots.txt handling, SSRF protection, and resource usage.

---

# 3. JavaScript Rendering

## Proposed Technology

Playwright

## Purpose

Playwright will provide browser-based rendering for JavaScript-heavy websites.

## Why Playwright

Raval must support websites where important content is generated or modified by JavaScript.

The crawler should eventually be able to inspect both:

- Raw HTML
- Rendered DOM

Playwright provides browser automation capabilities that are suitable for this requirement.

## Alternatives Considered

- Selenium
- Puppeteer

## Decision

Playwright is the proposed browser-rendering technology.

It should be integrated with the crawler rather than treated as a separate crawling system.

---

# 4. HTML Parsing

## Proposed Technology

Cheerio

## Purpose

Cheerio will be used for efficient HTML parsing and extraction after HTML has been obtained from a website.

## Expected Usage

The parser may extract:

- Title
- Meta description
- Headings
- Links
- Images
- Alt text
- HTML elements
- Structured data
- Other page-level signals

## Alternatives Considered

- Browser DOM APIs
- JSDOM
- Custom HTML parsing

## Decision

Cheerio is the proposed HTML parsing library for lightweight HTML analysis.

Browser rendering should remain the responsibility of Playwright.

---

# 5. Backend / API

## Proposed Technology

Python + FastAPI

## Purpose

FastAPI will provide the backend API layer for the intelligence system.

## Expected Responsibilities

The backend may eventually coordinate:

- Crawl requests
- Analysis jobs
- Intelligence processing
- Database operations
- AI analysis
- Recommendations
- Validation
- Workspace-level operations

## Why FastAPI

Python is well suited to AI, data processing, NLP, and analytical workloads.

FastAPI provides a modern API framework suitable for service-oriented backend development.

## Alternatives Considered

- Node.js + TypeScript
- Django
- Flask

## Decision

Python + FastAPI is the proposed backend/API stack.

The final architecture should keep crawler-specific responsibilities modular so the crawler and backend can evolve independently.

---

# 6. Database

## Proposed Technology

PostgreSQL

## Purpose

PostgreSQL will store structured intelligence data.

Potential data areas include:

- Workspaces
- Websites
- Crawl runs
- Crawled pages
- Page evidence
- SEO observations
- AI benchmark questions
- AI runs
- AI answers
- Mentions
- Citations
- Competitor observations
- Opportunities
- Actions
- Validation runs

## Why PostgreSQL

Raval requires relationships between many entities and observations.

A relational database provides strong support for:

- Structured data
- Relationships
- Constraints
- Transactions
- Querying
- Multi-tenant data modeling

## Alternatives Considered

- MongoDB
- Other managed relational databases

## Decision

PostgreSQL is the proposed core database.

---

# 7. Supabase Evaluation

## Status

To be evaluated.

## Potential Usage

Supabase may be considered as a managed PostgreSQL platform and may provide useful services such as:

- Database hosting
- Authentication
- Row Level Security
- Storage
- API capabilities

## Important Consideration

The project should not become tightly coupled to Supabase-specific features unless those features are intentionally selected as part of the production architecture.

The underlying data model should remain maintainable and portable where practical.

---

# 8. AI API Integration

## Proposed Architecture

Centralized AI Gateway with provider adapters.

## Purpose

AI functionality will eventually be required for:

- AI answer analysis
- Entity analysis
- Content analysis
- Question intelligence
- Recommendation generation
- Other intelligence tasks

## Architecture

AI Gateway
|
+-- Provider Adapter A
|
+-- Provider Adapter B
|
+-- Provider Adapter C

## Important Rule

Individual intelligence modules should not create disconnected AI integrations.

AI access should be centralized through a controlled gateway.

## Decision

Use a provider-adapter architecture behind a centralized AI gateway.

Specific AI providers should be selected according to:

- API availability
- Terms of use
- Reliability
- Cost
- Latency
- Model quality
- Required capabilities

---

# 9. Background Jobs

## Requirement

Background job processing will be required for long-running operations.

Examples:

- Website crawling
- Large website analysis
- AI benchmark execution
- Re-crawling
- Periodic monitoring
- Analytics synchronization

## Proposed Direction

Use a queue and worker architecture.

## Candidates to Evaluate

- Redis + worker system
- Celery
- RQ
- BullMQ
- Managed queue services

## Decision Status

Not finalized during the initial architecture stage.

The final decision should consider:

- Reliability
- Retry support
- Scheduling
- Monitoring
- Scalability
- Operational complexity
- Cost

---

# 10. Testing

## Proposed Technologies

### Python

pytest

### TypeScript / Node.js

Vitest

### Browser / End-to-End

Playwright

## Testing Requirements

Important logic should be testable.

Expected test areas include:

- Crawler
- HTML parsers
- URL handling
- SEO analysis
- Metrics
- Entity extraction
- AI analysis
- Database integration
- Recommendation logic
- Validation

---

# 11. Authentication

## Proposed Direction

OAuth-based authentication with workspace-level authorization.

## Requirements

The production architecture should support:

- User authentication
- Workspace isolation
- Permission checks
- Secure token handling
- Role/permission management

## Decision Status

Authentication provider is not finalized during Day 1.

---

# 12. Security

Security is a core architectural requirement.

The system may eventually access:

- Websites
- GitHub
- CMS platforms
- Search Console
- Analytics
- AI APIs

Important security requirements include:

- OAuth
- Encrypted tokens
- Workspace isolation
- Row Level Security where applicable
- SSRF protection
- Prompt injection defenses
- Rate limits
- Quotas
- Audit logs
- Secret management
- Permission checks
- Data retention controls

The AI system must not receive unrestricted execution access.

The preferred pattern is:

LLM
|
v
Structured Output
|
v
Validation
|
v
Policy Engine
|
v
Tool Execution

---

# 13. Environment Configuration

Secrets must never be committed to the repository.

Environment variables should be used for:

- Database credentials
- AI API keys
- OAuth credentials
- Service configuration
- Other secrets

A `.env.example` file will document required variables without containing real credentials.

---


# 14. Technology Decision Matrix

| Area | Selected / Proposed Technology | Primary Reason | Alternatives Considered | Decision Status |
|---|---|---|---|---|
| Website Crawling | Crawlee | Provides structured crawling, request management, queues, retries, and scalable crawling capabilities. | Scrapy, Custom Crawler, Direct HTTP Requests | Proposed |
| JavaScript Rendering | Playwright | Supports browser-based rendering for JavaScript-heavy websites and allows inspection of rendered pages. | Puppeteer, Selenium | Proposed |
| HTML Parsing | Cheerio | Lightweight and efficient HTML parsing and extraction after page retrieval. | JSDOM, Browser DOM APIs | Proposed |
| Crawler Runtime | Node.js + TypeScript | Strong ecosystem support for Crawlee and Playwright with type safety and maintainable crawler code. | Python | Proposed |
| Backend / API | Python + FastAPI | Suitable for API services, data processing, AI-related workloads, and analytical services. | Node.js + TypeScript, Django, Flask | Proposed |
| Database | PostgreSQL | Relational model, strong consistency, constraints, transactions, and suitability for structured intelligence data. | MongoDB, Other Managed SQL Databases | Proposed |
| Database Platform | Supabase | Potential managed PostgreSQL platform with authentication, storage, and Row Level Security capabilities. | Self-managed PostgreSQL, Other Managed PostgreSQL Platforms | Evaluation |
| AI Integration | Centralized AI Gateway + Provider Adapters | Prevents disconnected AI integrations and allows controlled provider/model selection. | Direct Provider Integration in Each Module | Proposed |
| Background Jobs | Queue + Worker Architecture | Required for long-running crawling, AI analysis, monitoring, and scheduled operations. | Celery, BullMQ, RQ, Managed Queue Services | To Evaluate |
| Backend Testing | pytest | Mature testing framework suitable for Python backend and analytical logic. | unittest | Proposed |
| TypeScript Testing | Vitest | Fast testing framework suitable for TypeScript/Node.js services. | Jest | Proposed |
| Browser / E2E Testing | Playwright | Reuses the browser automation ecosystem already proposed for rendering and supports end-to-end testing. | Cypress, Selenium | Proposed |
| Authentication | OAuth + Workspace Authorization | Supports secure user authentication and workspace-level access control. | Other Managed Auth Providers | To Finalize |
| Security | Defense-in-Depth Architecture | Required to protect workspace data, credentials, external integrations, crawling operations, and AI execution. | — | Required |

# 15. Decision-Making Criteria

Technology decisions will be evaluated using the following criteria:

1. Performance
2. Reliability
3. Maintainability
4. Security
5. Scalability
6. Production SaaS suitability
7. Operational complexity
8. Cost
9. Ecosystem maturity
10. Compatibility with the Raval AI architecture

A technology should not be selected only because it is popular. The final decision should be based on the requirements of the Raval Search Intelligence module.

# 16. Open Technical Questions

The following questions require confirmation before production implementation:

1. Which AI providers will be officially supported?
2. Which AI APIs are permitted for programmatic measurement?
3. Should Supabase be the production database platform?
4. Which background-job system should be selected?
5. Which authentication provider should be used?
6. What crawler limits should apply per workspace?
7. How should crawl scheduling and quotas be implemented?
8. Which external connectors are required for the MVP?
9. What data retention policy should apply to crawl and AI data?
10. Which environments will be used for development, staging, and production?

---

# 17. Day 1 Status

This document represents the initial technology research and proposal.

No production implementation decisions should be considered final until they have been reviewed against:

- Performance
- Reliability
- Security
- Maintainability
- Cost
- Scalability
- Production SaaS requirements