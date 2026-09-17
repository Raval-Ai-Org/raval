# Raval Scan & Run State Model

## Purpose

This document defines the lifecycle states for long-running website scans and AI benchmark runs.

The same lifecycle is used for both operation types so that status handling, timestamps, failures, cancellation, and historical execution remain consistent.

## Supported States

- `queued`
- `running`
- `completed`
- `failed`
- `cancelled`

## State Flow

```text
                 ┌──────────────┐
                 │    QUEUED    │
                 └──────┬───────┘
                    ┌───┴───┐
                    ▼       ▼
              ┌─────────┐  ┌───────────┐
              │ RUNNING │  │ CANCELLED │
              └────┬────┘  └───────────┘
               ┌───┼───┐
               ▼   ▼   ▼
        COMPLETED FAILED CANCELLED
```

## Transition Rules

| Current | Allowed next state(s) |
|---|---|
| `queued` | `running`, `cancelled` |
| `running` | `completed`, `failed`, `cancelled` |
| `completed` | none |
| `failed` | none |
| `cancelled` | none |

Terminal states are not reused. A new execution creates a new record.

## Scan State Requirements

The `scans` record should contain:

- `id`
- `website_id`
- `status`
- `started_at`
- `completed_at`
- `error_message`
- `created_at`
- `updated_at`

A new scan starts as `queued`.

`started_at` is populated when execution enters `running`.

`completed_at` is populated when the execution reaches a terminal state.

`error_message` is retained for failed executions.

## AI Run State Requirements

The `ai_runs` record should contain:

- `id`
- `website_id`
- `question_id`
- `provider`
- `model`
- `environment`
- `status`
- `started_at`
- `completed_at`
- `error_message`
- `created_at`

AI benchmark runs follow the same lifecycle as scans.

## Historical Execution Rule

Previous executions must not be overwritten.

For example:

```text
Website A
├── Scan 001 → completed
├── Scan 002 → failed
└── Scan 003 → running
```

The system keeps all three records so that current and historical execution can be compared and investigated.

## Failure Rule

A failed operation remains stored with its failure status and error information. Failure of one page, provider request, or operation should not automatically imply deletion of the historical record.

## Cancellation Rule

Cancellation is distinct from failure:

- `failed` means execution could not complete successfully because of an error.
- `cancelled` means execution was intentionally stopped.

## Implementation Boundary

At the current Day 2 foundation stage, this document defines the state contract. Runtime job execution, workers, queue integration, persistence models, and API endpoints will implement this contract in later implementation steps.
