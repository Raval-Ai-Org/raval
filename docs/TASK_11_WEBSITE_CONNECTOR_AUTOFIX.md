# Task 11: Website Connector & Safe Auto-Fix Execution Engine

## 1. Overview

The **Raval AI Website Connector & Safe Auto-Fix Execution Engine** is the execution subsystem of the Raval AI GEO/AEO/SEO Intelligence platform. While Tasks 1–10 discover website issues, extract DOM and semantic structures, calculate deterministic scores, and generate structured `Finding`, `Recommendation`, and `FixPlan` models, Task 11 safely bridges these intelligence artifacts to external content repositories and CMS platforms.

The engine executes safe, deterministic, and reversible remediations while enforcing multi-layered safety gates, dry-run previews, human approvals, targeted post-mutation rescans, before/after evidence comparisons, regression detection, and automated rollback capabilities.

---

## 2. Architecture

The Task 11 architecture operates across decoupled, defense-in-depth layers:

```
+----------------------------------------------------------------------------------------------------+
|                                    UPSTREAM INTELLIGENCE PIPELINE                                  |
|   Crawling -> Extraction -> SEO/AEO Intelligence -> Deterministic Scoring -> Finding & FixPlan    |
+----------------------------------------------------------------------------------------------------+
                                                  |
                                                  v
+----------------------------------------------------------------------------------------------------+
|                                      TASK 11 EXECUTION ENGINE                                      |
+----------------------------------------------------------------------------------------------------+
| 1. Authorization & Tenant Isolation (Workspace boundaries, RBAC roles, target URI validation)     |
| 2. Rate Limiting, SSRF Protection & Secret Sanitization                                            |
| 3. Safety Gate Evaluation (AUTO_SAFE, ASSISTED, MANUAL_REVIEW)                                      |
| 4. Dry-Run Change Preview & Structured Evidence Computation                                        |
| 5. Concurrency Locks & Idempotency Key Tracking                                                    |
| 6. Connector Invocation (GitHub Git Workflow / WordPress REST API)                                 |
| 7. Post-Apply Verification & Targeted Delta Rescan (Single URL / Resource Scoping)                   |
| 8. Regression Detection & Automated Rollback / Manual Review Escalation                             |
| 9. Append-Only Tamper-Evident Audit Ledger (SHA-256 Chained Provenance)                            |
+----------------------------------------------------------------------------------------------------+
```

### Complete End-to-End Lifecycle:
```
Finding -> Root Cause -> Fix Plan -> Safety Gate -> Preview -> Approval -> Apply -> Validate -> Targeted Rescan -> Before/After Comparison -> Verified / Regression -> Keep / Rollback -> Audit
```

---

## 3. Connector Interface (`BaseWebsiteConnector`)

Every provider-specific connector inherits from `BaseWebsiteConnector` and provides an immutable contract across 9 core operations:

| Method | Signature | Description |
| :--- | :--- | :--- |
| `connect(credentials)` | `(dict) -> ConnectionResult` | Authenticates against the external provider and validates permission scope. |
| `disconnect()` | `() -> bool` | Safely revokes active sessions and clears transient credentials. |
| `health_check()` | `() -> HealthCheckResult` | Non-mutating probe verifying connectivity, API latency, and quota/rate-limit status. |
| `get_site_context()` | `() -> SiteContext` | Retrieves authenticated repository/site metadata, capabilities, and environment type. |
| `read_resource(ref)` | `(ResourceReference) -> ResourceContent` | Reads raw and structured content for a specific file, post, page, or media item. |
| `preview_change(prop)` | `(ChangeProposal) -> ChangePreview` | Generates a non-mutating dry run showing exact diffs, target fields, and rollback plan. |
| `apply_change(prop)` | `(ChangeProposal) -> ChangeResult` | Executes the approved mutation and returns an immutable `rollback_token`. |
| `rollback_change(prop, token)` | `(ChangeProposal, str) -> RollbackResult` | Restores the resource to its exact pre-mutation state using the snapshot or commit SHA. |
| `get_change_status(op_id)` | `(str) -> OperationStatusInfo` | Queries external operation status to resolve ambiguous or asynchronous executions. |

---

## 4. Supported Connectors

### A. GitHub Connector (`GitHubConnector`)
* **Underlying Mechanism**: Git Trees, Blobs, Commits, and Pull Request Branches.
* **Safe Branching Model**: All auto-fix mutations are committed to dedicated isolated branches (e.g., `raval-fix/<timestamp>-<hash>`) to prevent direct main/production branch corruption.
* **Rollback Mechanism**: Git Revert commits or tree-restoration commits referencing the exact pre-change commit SHA.
* **Limitations**:
  * Direct merges to protected branches without PR approval are restricted by GitHub repository rules.
  * Large binary assets and files exceeding 100MB are rejected by safety policies.
  * Repository configuration files (`.github/workflows`, `.env`, secret files) are denylisted.

### B. WordPress Connector (`WordPressConnector`)
* **Underlying Mechanism**: WordPress REST API (v2) using Application Passwords or OAuth.
* **Target Resources**: Posts (`/wp/v2/posts`), Pages (`/wp/v2/pages`), Custom Post Types, Media alt-text (`/wp/v2/media`), and SEO Meta fields (Yoast SEO, RankMath, Custom Meta).
* **Rollback Mechanism**: Restoration of pre-mutation JSON snapshots stored securely in the `rollback_token`.
* **Limitations**:
  * Core PHP files (`wp-config.php`, theme `.php`, plugin `.php`) cannot be mutated through the REST API connector.
  * Unauthenticated endpoints or sites lacking REST API support cannot be modified.
  * Database-level custom table modifications are unsupported.

---

## 5. Safety Model

Remediation safety is governed by the Three-Tier Model aligned with Task 9:

| Safety Tier | Definition | Auto-Execution Allowed? | Examples |
| :--- | :--- | :--- | :--- |
| **`AUTO_SAFE`** | Deterministic, reversible, low-risk structural or technical changes strictly derived from existing verified page evidence. | **Yes** (if rollback is supported) | Missing meta descriptions, heading structure fixes (H1/H2 reorganization), self-referencing canonical tag injection, missing image alt-text, verified JSON-LD syntax injection. |
| **`ASSISTED`** | Content drafting, expansion, or semantic adjustments that require human inspection and explicit approval. | **No** (Approval Required) | AEO direct answer blocks, content gap filling, FAQ expansions, entity optimization suggestions. |
| **`MANUAL_REVIEW`** | Modifications involving factual claims, statistics, author credentials, legal policies, or ambiguous targets. | **No** (Blocked from Auto-Apply) | Medical/legal claims, author bylines, pricing/terms updates, path-traversal risks, server configuration adjustments. |

### Conservative Degradation Rules:
* If a connector does not support automated rollback (`supports_rollback=False`), an `AUTO_SAFE` proposal is immediately degraded to `ASSISTED`.
* If a proposal involves restricted keywords (`credential`, `claim`, `statistical`, `legal`), it is permanently classified as `MANUAL_REVIEW`.

---

## 6. Execution Lifecycle State Machine

The execution engine enforces a strict, forward-progressing state machine. Illegal state transitions are rejected with `StateTransitionError`.

```
[PLANNED]
    │
    ▼
[SAFETY_CHECKED] ──── (Safety Rejection / High Risk) ────► [BLOCKED]
    │
    ▼
[PREVIEWED]
    │
    ▼
[APPROVED]
    │
    ▼
[APPLYING] ────────── (Network Timeout / Crash) ────────► [MANUAL_REVIEW_REQUIRED]
    │
    ▼
[APPLIED]
    │
    ▼
[VALIDATING] ◄─────── (Transient Rescan Error) ─────────► [RETRYING]
    │
    ├───────── (Passed Validation) ─────────────────────► [VERIFIED] ──► [KEPT]
    │
    └───────── (Regression Detected / Val Fail) ────────► [REGRESSION]
                                                              │
                                                              ▼
                                                        [ROLLING_BACK]
                                                              │
                                       ┌──────────────────────┴──────────────────────┐
                                       ▼                                             ▼
                                 [ROLLED_BACK]                            [MANUAL_REVIEW_REQUIRED]
                              (Rollback Verified)                            (Rollback Failed)
```

---

## 7. Change Preview & Dry-Run Evidence

Before any mutation is applied to an external site or repository, the engine generates a structured `ChangePreview`:

* **`request_id` / `idempotency_key`**: Complete provenance linking the request to the upstream `finding_id`, `recommendation_id`, and `fix_plan_id`.
* **`target_resource`**: Validated resource URI, type, and path.
* **`before_snapshot`**: Hash and content summary of the baseline state.
* **`after_snapshot`**: Hash and content preview of the intended post-change state.
* **`diff_representation`**: Unified diff or JSON attribute delta.
* **`validation_plan`**: Pre-computed assertions and checks to be evaluated post-apply.
* **`rollback_plan`**: Strategy and token structure for immediate restoration.

---

## 8. Post-Apply Validation

Following a successful connector apply operation, the `ValidationEngine` executes automated verification:

1. **Connector Acceptance**: Confirms external HTTP 200/201 response and commit/resource ID.
2. **Target Existence**: Confirms the modified resource exists and is reachable.
3. **Intended Mutation**: Confirms the expected content string or meta tag exists in the target resource.
4. **Unexpected Mutation Detection**: Scans the target resource to ensure untouched fields, scripts, and body content remain unaltered.
5. **Finding Re-Evaluation**: Re-runs the exact Task 4–10 intelligence rule against the rescan payload to ensure the finding transitions from `FAIL` to `PASS`.
6. **Score Delta Computation**: Evaluates category score improvements while ensuring zero degradation across unrelated categories.

---

## 9. Targeted Delta Rescan

Rather than initiating an expensive and noisy full-site crawl, Task 11 performs **Targeted Rescans**:
* **Single URL Scope**: Fetches only the exact URL or HTML document associated with the mutated resource.
* **DOM Re-Extraction**: Extracts titles, meta tags, heading hierarchies, OpenGraph tags, and JSON-LD schemas using existing extraction routines (`PageExtractor`).
* **Rule Engine Re-Run**: Directly passes the extracted DOM to rule evaluators (`TechnicalSEORules`, `ContentQualityRules`, `StructureRules`).

---

## 10. Regression Detection

A regression is declared, and the execution is transitioned to `REGRESSION`, if any of the following deterministic conditions occur:

* **Resource Unavailability**: The rescan returns HTTP 4xx, 5xx, or an empty document.
* **Intended Fix Absent**: The expected string, meta tag, or markup is not present in the live DOM.
* **Content Loss**: The length of the page content decreases unexpectedly (>20% loss without explicit truncation intent).
* **Structural Degradation**: New structural errors are introduced (e.g., multiple `<h1>` tags introduced, heading levels skipped).
* **Score Drop**: The category score drops below the pre-mutation baseline.

---

## 11. Automated Rollback & Verification

When a regression is detected or when an operator requests a manual undo:

1. **Rollback Invocation**: The engine calls `connector.rollback_change(proposal, rollback_token)`.
2. **Targeted Baseline Rescan**: The resource is refetched to verify that the original baseline content and hashes match the pre-mutation state.
3. **State Transition**:
   * If restoration is confirmed: Transitions to `ROLLED_BACK`.
   * If restoration fails or drifts: Transitions to `MANUAL_REVIEW_REQUIRED` with high-priority alert logging.

---

## 12. Security & Hardening Controls

| Security Control | Implementation Details |
| :--- | :--- |
| **Tenant & Workspace Isolation** | Every execution request requires a validated `AuthorizationContext`. Mismatches between actor workspace, site workspace, or connector target raise `AuthorizationError`. |
| **Least Privilege & Scopes** | Scopes (`apply_change`, `rollback_change`, `preview_change`, `read_resource`) are strictly checked prior to connector invocation. |
| **Secret Sanitization** | `sanitize_payload()` scrubs API keys, Bearer tokens, GitHub Personal Access Tokens (`ghp_`), WordPress application passwords, and URI embedded credentials from all logs, previews, validation reports, and audit entries. |
| **SSRF Prevention** | `assert_safe_external_url()` blocks loopback (`127.0.0.1`, `localhost`), private RFC 1918 subnets (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), link-local metadata addresses (`169.254.169.254`), and non-HTTP(S) schemes. |
| **Path Traversal & Shell Defense** | Rejects `..`, absolute root paths, `.env`, `.git/`, `.htaccess`, `wp-config.php`, and command execution tokens (`curl`, `eval`, `passthru`, `system`, `shell_exec`). |
| **Rate Limiting & Retries** | Bounded requests per minute (RPM) sliding window with jittered exponential backoff for transient 429/503 errors. Permanent 401/403/404 errors fail fast. |
| **Concurrency Locking** | In-memory and distributed resource locking prevents simultaneous competing mutations against the same file or post. |
| **Idempotency** | Duplicate requests sharing an `idempotency_key` return existing cached results without executing duplicate Git commits or WordPress mutations. |

---

## 13. Audit Ledger & Cryptographic Traceability

The `AuditLedger` records an append-only sequence of immutable events for every lifecycle action:

* **Event Properties**: `event_id`, `timestamp`, `workspace_id`, `site_id`, `actor_id`, `execution_id`, `finding_id`, `recommendation_id`, `fix_plan_id`, `action`, `resource_id`, `payload_hash`, `previous_event_hash`, `event_hash`.
* **Hash Chaining**: Each event calculates `event_hash = SHA256(event_id + prev_hash + action + payload_hash)`. Any modification or deletion of an audit record invalidates subsequent event hashes, providing tamper-evident compliance.

---

## 14. Reliability & Recovery

* **Worker Crashes during `PLANNED` / `SAFETY_CHECKED`**: Safely restartable.
* **Worker Crashes during `APPLYING`**: External connector status is queried via `get_change_status(op_id)`. If status is unknown or ambiguous, the engine immediately transitions to `MANUAL_REVIEW_REQUIRED` to prevent blind, duplicate mutations.
* **Worker Crashes during `VALIDATING`**: Safely resumes validation and rescan without re-applying the mutation.

---

## 15. Explicit Limitations & Non-Goals

1. **Supported Connectors**: Only Git/GitHub repositories and WordPress REST API platforms are supported. Custom CMS platforms without REST interfaces are unsupported.
2. **Restricted Mutation Types**: Direct PHP code generation, arbitrary JavaScript script injection, database schema migrations, and server configuration files cannot be auto-fixed.
3. **Connector Rollback Boundaries**: WordPress rollback relies on JSON snapshots; if an external third-party author modifies the same post concurrently, rollback may conflict and require manual review.
4. **Fixture-Based E2E Testing**: End-to-end tests use deterministic in-memory mock repositories and REST clients to guarantee safety and avoid production vandalism.
5. **No Commercial or SEO Guarantees**:
   * Execution correctness does **NOT** guarantee search engine ranking improvements.
   * Execution correctness does **NOT** guarantee AI citation inclusion or generative answer visibility.
   * Execution correctness does **NOT** guarantee organic traffic, leads, or revenue increases.
   * Passing tests demonstrate functional software correctness, not business outcomes.
