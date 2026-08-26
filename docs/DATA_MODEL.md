# Raval AI GEO / AEO / SEO Intelligence
# Core Data Model

## 1. Purpose

This document defines the Day 2 core data model
for the Raval AI GEO / AEO / SEO Intelligence module.

The model is designed to support:
- historical scans
- traceable evidence
- findings and recommendations
- AI visibility measurements
- citations
- competitors
- connectors
- audit history

## 2. Design Principles

- Historical records should be preserved.
- Evidence must remain traceable.
- Derived intelligence must remain distinguishable from raw observations.
- IDs must remain stable.
- The model must be extensible.
- No fake SEO/GEO/AI data should be introduced.

## 3. Core Entities

### Workspace
Purpose:
Tenant boundary for Raval data.

### User
Purpose:
Represents a user belonging to a workspace.

### Website
Purpose:
Represents a website/project being analyzed.

### Scan
Purpose:
Represents a historical website scan execution.

### Page
Purpose:
Represents the persistent identity of a website URL.

### PageObservation
Purpose:
Represents what was observed for a page during a specific scan.

### Finding
Purpose:
Represents an issue or condition identified from observations.

### Recommendation
Purpose:
Represents a proposed action derived from a finding.

### Entity
Purpose:
Represents a business/product/person/etc. entity.

### QuestionSet
Purpose:
Represents a versioned AI/search benchmark.

### Question
Purpose:
Represents an individual benchmark question.

### AIRun
Purpose:
Represents an AI measurement execution.

### AIResult
Purpose:
Represents the output of an AI run.

### Citation
Purpose:
Represents a source referenced by an AI result.

### Competitor
Purpose:
Represents a competitor associated with a website.

### Connector
Purpose:
Represents an external integration.

### AuditLog
Purpose:
Represents an important system action or change.

## 4. Relationships

Workspace → Users
Workspace → Websites
Workspace → Connectors
Workspace → Audit Logs

Website → Scans
Website → Pages
Website → Findings
Website → Entities
Website → Question Sets
Website → Competitors

Scan → Page Observations
Page → Page Observations

Scan → Findings
Page → Findings

Finding → Recommendations

Question Set → Questions
Question → AI Runs
AI Run → AI Results
AI Result → Citations

## 5. Historical Data

Scan records are historical and should not be overwritten
by later scans.

Page identity is separated from page observations.

This allows the system to compare:
- previous scans
- current scans
- before/after changes

## 6. Evidence Traceability

Website
→ Scan
→ Page
→ Page Observation
→ Finding
→ Recommendation

AI measurement:

Website
→ Question Set
→ Question
→ AI Run
→ AI Result
→ Citation

## 7. ERD

See:

`ERD.png`


## Scan and Run States

Raval uses a common lifecycle model for long-running
operations such as website scans and AI benchmark runs.

### Supported States

- `queued`
- `running`
- `completed`
- `failed`
- `cancelled`

### State Flow

QUEUED → RUNNING → COMPLETED
                  → FAILED
                  → CANCELLED

QUEUED → CANCELLED

### Rules

1. Every new scan or AI run starts in `queued`.
2. A queued operation can transition to `running`.
3. A running operation can transition to `completed`,
   `failed`, or `cancelled`.
4. Completed, failed, and cancelled are terminal states.
5. Terminal records are not overwritten or reused.
6. A new execution creates a new scan/run record.
7. Failed operations should retain an error message.
8. Execution timestamps must be recorded.
9. Historical runs remain available for comparison
   and traceability.

## Day 2 Implemented Data Model

The Day 2 backend currently implements the initial Website and Scan entities.

### Website

The Website entity represents a website registered for analysis.

The current implementation stores the core website identity required by the backend API.

### Scan

The Scan entity represents a historical scan execution associated with a Website.

Each scan is stored as a separate record so that previous executions are preserved.

### Website → Scan Relationship

A Website can have multiple Scan records.

```text
Website
   │
   ├── Scan
   ├── Scan
   └── Scan

###Implemented Scan Lifecycle

The current backend enforces the scan lifecycle through the service layer:

queued
   ↓
running
   ↓
completed

The implementation also supports failure and cancellation states where applicable.

Invalid state transitions are rejected by the service layer.

### Data Integrity

The Day 2 backend uses multiple validation boundaries:

API Schema Validation
        ↓
Service Validation
        ↓
Database Constraints

This separation keeps request validation, business rules, and persistence integrity distinct.

### Implemented Task 5 Intelligence Models

The following intelligence and content analysis entities are fully implemented and verified in `backend/app/models.py`:
- `Finding`: Issue or condition derived from extraction/analysis observations, linked to `scan_id`, `website_id`, and optional `page_id`.
- `Recommendation`: Actionable remediation advice derived from a finding, linked to `finding_id`.
- `Entity`: Persistent brand, product, organization, or persona linked to `website_id`.
- `QuestionSet` & `Question`: Versioned benchmark questions and suites linked to `website_id`.
- `AIRun`, `AIResult`, `Citation`: AI visibility benchmark measurement executions, engine responses, and cited domain sources.
- `PageExtraction` & 13 Child Evidence Tables: Granular observable DOM signals.
- Content Intelligence Response Schemas: Structured Pydantic contracts across structure, topics, entities, Q&A, answers, readiness, gaps, quality, intent, semantic coverage, master intelligence summaries, and content quality checks.
