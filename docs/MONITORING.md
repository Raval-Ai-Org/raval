# Monitoring Engine & Pipeline Integration Guide (Task 6.10)

## 1. Executive Overview
The **Monitoring Engine** provides continuous internal intelligence metric tracking, delta evaluations, and historical event detection over time for domains audited by Raval AI GEO Intelligence. It operates strictly on database-persisted signals from Scans, Opportunities, Fix Plans, and Validations.

### Architectural Principles
- **Purely Internal & Deterministic**: Metric evaluation is calculated on stored relational records without external daemons, cloud cron tasks, or third-party monitoring dependencies.
- **Idempotent Snapshotting**: Evaluating a scan or website repeatedly updates the latest record in place for that execution context, preventing duplicate time-series clutter.
- **Explainable Health Scoring**: System health is computed with bounded $[0.0, 1.0]$ scores factoring validation pass rates, open finding volume, and critical opportunity severity.

---

## 2. Core Downstream Pipeline Flow
The Monitoring Engine is the culminating stage of the intelligence pipeline:

$$\text{Scan} \to \text{Understand} \to \text{Analyze} \to \text{Findings} \to \text{Recommendations} \to \text{Opportunities} \to \text{Fixes} \to \text{Validation} \to \text{Monitoring}$$

---

## 3. Data Model: `MonitoringRecord`
Table: `monitoring_records`

| Column | Type | Nullable | Description |
|---|---|---|---|
| `id` | Integer (PK) | No | Primary Key |
| `website_id` | Integer (FK) | No | Associated Website |
| `scan_id` | Integer (FK) | Yes | Associated Scan (if scan-scoped) |
| `ai_run_id` | Integer (FK) | Yes | Associated AI Run (if benchmark-scoped) |
| `target_type` | String(100) | No | Target entity (`scan`, `website`, `page`, `validation`) |
| `target_id` | Integer | Yes | Foreign identifier of specific target |
| `metric_name` | String(100) | No | Name of tracked metric (e.g. `health_score`, `validation_pass_rate`) |
| `metric_category` | String(100) | No | Domain category (`intelligence`, `seo`, `aeo`, `geo`, `quality`, `validation`) |
| `previous_value` | Float | Yes | Metric value from the prior evaluation context |
| `current_value` | Float | No | Current evaluated metric value |
| `delta` | Float | Yes | $\text{current\_value} - \text{previous\_value}$ |
| `change_detected` | Boolean | No | True if $|\text{delta}| > 0.0001$ |
| `status` | String(50) | No | Health status (`healthy`, `warning`, `critical`, `improved`, `degraded`) |
| `event_type` | String(100) | Yes | Event categorization (`health_score_increased`, `new_critical_finding`, etc.) |
| `summary` | Text | No | Human-readable metric summary |
| `details` | JSON | Yes | Contextual diagnostics (pass rates, counts) |
| `recorded_at` | DateTime | No | UTC timestamp of snapshot |

---

## 4. Deterministic Metrics & Formulas

### 4.1 Composite Health Score
$$\text{HealthScore} = \max\left(0.0, \min\left(1.0, 0.4 \cdot \text{ValPassRate} + 0.3 \cdot \left(1 - \frac{\min(\text{OpenFindings}, 10)}{10}\right) + 0.3 \cdot \left(1 - \frac{\min(\text{CriticalOpps}, 5)}{5}\right)\right)\right)$$

### 4.2 Status Classifications
- **Healthy**: $\text{HealthScore} \ge 0.80$ and $\text{OpenFindings} \le 2$
- **Warning**: $0.50 \le \text{HealthScore} < 0.80$
- **Critical**: $\text{HealthScore} < 0.50$

---

## 5. API Reference

### 5.1 Trigger Scan Monitoring
`POST /api/v1/scans/{scan_id}/monitoring`
Evaluates all deterministic metrics for a scan and produces `MonitoringRecord` entries comparing with the prior scan.

### 5.2 Trigger Website Monitoring
`POST /api/v1/websites/{website_id}/monitoring`
Aggregates active intelligence indicators across the latest scan of a website.

### 5.3 Fetch Monitoring Timeline
`GET /api/v1/websites/{website_id}/monitoring-timeline?metric_name={name}&limit={limit}`
Returns chronological monitoring snapshots.

### 5.4 Fetch Website Health Summary
`GET /api/v1/websites/{website_id}/health-summary`
Returns high-level status badge (`healthy`, `warning`, `critical`), composite health score, validation pass rate, open findings count, and recent event logs.

---

## 6. End-to-End Intelligence Pipeline Integration
`POST /api/v1/scans/{scan_id}/run-pipeline`
Executes all 7 downstream stages in a single unified transactional flow:
1. Scan Ingestion
2. Findings Extraction
3. Opportunity Prioritization
4. Recommendation Synthesis
5. Fix Plan Construction
6. Validation Engine Execution
7. Monitoring Metric Snapshotting
