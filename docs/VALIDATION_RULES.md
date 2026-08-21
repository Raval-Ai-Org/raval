# Raval Validation Rules & Technical Decisions

## 1. Purpose

This document defines validation rules and technical
decisions for the Raval core data and API foundation.

## 2. Validation Layers

Validation is applied across three layers:

```text
CLIENT
   ↓
API VALIDATION
   ↓
SERVICE VALIDATION
   ↓
DATABASE CONSTRAINTS
```

## 3. Website Validation

- Name is required.
- URL is required.
- URL must use a valid URL format.
- Workspace ownership is required.

## 4. Scan Validation

- Every scan belongs to an existing website.
- New scans start in `queued`.
- Scan status is controlled by the application lifecycle.
- Clients cannot directly set a scan to `completed`.

## 5. Scan State Validation

Allowed transitions:

QUEUED → RUNNING
QUEUED → CANCELLED

RUNNING → COMPLETED
RUNNING → FAILED
RUNNING → CANCELLED

Terminal states:

- completed
- failed
- cancelled

## 6. Timestamp Rules

Queued:
- created_at required
- started_at null
- completed_at null

Running:
- started_at required
- completed_at null

Completed:
- started_at required
- completed_at required
- error_message null

Failed:
- started_at required
- completed_at required
- error_message required

Cancelled:
- completed_at required

## 7. Foreign Key Rules

Foreign keys must reference existing parent records.

Examples:

- scan.website_id → websites.id
- finding.scan_id → scans.id
- finding.page_id → pages.id
- recommendation.finding_id → findings.id
- ai_run.question_id → questions.id
- ai_result.ai_run_id → ai_runs.id
- citation.ai_result_id → ai_results.id

## 8. Historical Data

Historical scans and AI runs are preserved.

A new execution creates a new record rather than
overwriting an earlier execution.

## 9. Findings

Required:

- website_id
- scan_id
- page_id
- type
- severity
- status

Severity values:

- info
- low
- medium
- high
- critical

## 10. Recommendations

Required:

- finding_id
- title
- description
- priority
- status

## 11. AI Run Validation

AI runs require:

- website_id
- question_id
- provider
- model
- environment

New AI runs start in `queued`.

## 12. API Errors

Validation errors use HTTP 400.

Missing resources use HTTP 404.

Invalid state transitions use HTTP 409.

## 13. No Fake Data

The system must not introduce fabricated SEO,
GEO, AI visibility, traffic, citation, or competitor data.

Unavailable information should be represented as
unavailable or null rather than invented.

## 14. Technical Decisions

- API version: `/api/v1`
- Stable internal identifiers are used for relationships.
- Historical executions are preserved.
- Lifecycle states are explicit and controlled.
- API and service responsibilities remain separated.
- Complexity is introduced only when required by the product.

