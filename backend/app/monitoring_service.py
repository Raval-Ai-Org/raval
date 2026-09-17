"""
Monitoring Engine Service (Task 6.10)
Provides internal, deterministic intelligence metric tracking, delta calculations,
and historical change detection over time across Scans, Opportunities, and Validations.
Safety Boundary: Purely internal and deterministic. No external daemons or cloud cron jobs.
"""

from datetime import datetime
from typing import Any
from sqlalchemy.orm import Session

from .models import Finding, FixPlan, MonitoringRecord, Opportunity, PageResult, Recommendation, Scan, ValidationResult, Website
from .schemas import MonitoringRecordCreate


SUPPORTED_METRIC_CATEGORIES = {
    "intelligence",
    "seo",
    "aeo",
    "geo",
    "quality",
    "validation",
    "system",
}


def record_metric(
    db: Session,
    website_id: int,
    metric_name: str,
    current_value: float,
    scan_id: int | None = None,
    ai_run_id: int | None = None,
    target_type: str = "website",
    target_id: int | None = None,
    metric_category: str = "intelligence",
    previous_value: float | None = None,
    event_type: str | None = None,
    summary: str | None = None,
    details: dict[str, Any] | list[Any] | None = None,
) -> MonitoringRecord:
    """
    Records or updates a deterministic monitoring metric snapshot with delta computation.
    Idempotent: updates existing record for (website_id, scan_id, metric_name).
    """
    website = db.get(Website, website_id)
    if not website:
        raise ValueError(f"Website with id {website_id} not found")

    # If previous_value not provided, lookup the most recent record before this one
    if previous_value is None:
        prior_q = (
            db.query(MonitoringRecord)
            .filter(
                MonitoringRecord.website_id == website_id,
                MonitoringRecord.metric_name == metric_name,
            )
        )
        if scan_id is not None:
            prior_q = prior_q.filter(MonitoringRecord.scan_id != scan_id)
        prior_record = prior_q.order_by(MonitoringRecord.id.desc()).first()
        if prior_record:
            previous_value = prior_record.current_value

    # Compute delta
    delta = None
    change_detected = False
    if previous_value is not None:
        delta = round(current_value - previous_value, 4)
        change_detected = abs(delta) > 0.0001

    # Derive event type if not explicitly set
    if not event_type:
        if delta is not None and delta > 0:
            event_type = f"{metric_name}_increased"
        elif delta is not None and delta < 0:
            event_type = f"{metric_name}_decreased"
        else:
            event_type = "metric_steady"

    # Derive status
    status = "healthy"
    if metric_name in {"health_score", "validation_pass_rate"}:
        if current_value >= 0.80:
            status = "healthy"
        elif current_value >= 0.50:
            status = "warning"
        else:
            status = "critical"
    elif metric_name in {"open_findings_count", "critical_opportunities_count"}:
        if current_value == 0:
            status = "healthy"
        elif current_value <= 3:
            status = "warning"
        else:
            status = "critical"

    # Build summary
    if not summary:
        delta_str = f" (Delta: {delta:+0.2f})" if delta is not None else ""
        summary = f"Metric '{metric_name}' evaluated at {current_value:.2f}{delta_str} [Status: {status}]."

    # Idempotency check for (website_id, scan_id, metric_name)
    existing = None
    if scan_id is not None:
        existing = (
            db.query(MonitoringRecord)
            .filter(
                MonitoringRecord.website_id == website_id,
                MonitoringRecord.scan_id == scan_id,
                MonitoringRecord.metric_name == metric_name,
            )
            .first()
        )

    if existing:
        existing.current_value = current_value
        existing.previous_value = previous_value
        existing.delta = delta
        existing.change_detected = change_detected
        existing.status = status
        existing.event_type = event_type
        existing.summary = summary
        existing.details = details
        existing.recorded_at = datetime.utcnow()
        db.commit()
        db.refresh(existing)
        return existing

    record = MonitoringRecord(
        website_id=website_id,
        scan_id=scan_id,
        ai_run_id=ai_run_id,
        target_type=target_type,
        target_id=target_id,
        metric_name=metric_name,
        metric_category=metric_category,
        previous_value=previous_value,
        current_value=current_value,
        delta=delta,
        change_detected=change_detected,
        status=status,
        event_type=event_type,
        summary=summary,
        details=details,
        recorded_at=datetime.utcnow(),
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


def evaluate_scan_monitoring(
    db: Session,
    scan_id: int,
) -> list[MonitoringRecord]:
    """
    Evaluates monitoring metrics for a specific scan and compares with the previous scan.
    Produces deterministic delta and status indicators.
    """
    scan = db.get(Scan, scan_id)
    if not scan:
        raise ValueError(f"Scan with id {scan_id} not found")

    website_id = scan.website_id

    # 1. Findings metrics
    findings = db.query(Finding).filter(Finding.scan_id == scan_id).all()
    open_findings = [f for f in findings if f.status == "open"]
    open_findings_count = float(len(open_findings))

    # 2. Opportunities metrics
    opps = db.query(Opportunity).filter(Opportunity.scan_id == scan_id).all()
    critical_opps = [o for o in opps if str(o.priority).upper() == "CRITICAL"]
    critical_opps_count = float(len(critical_opps))

    # 3. Recommendations metrics
    recs = db.query(Recommendation).join(Finding).filter(Finding.scan_id == scan_id).all()
    resolved_recs = [r for r in recs if r.status == "resolved"]
    resolved_recs_count = float(len(resolved_recs))

    # 4. Validations metrics
    validations = db.query(ValidationResult).filter(ValidationResult.scan_id == scan_id).all()
    pass_vals = [v for v in validations if v.result == "PASS"]
    val_pass_rate = (len(pass_vals) / len(validations)) if validations else 1.0

    # 5. Composite Health Score:
    # 1.0 - (0.5 * min(open_findings_count, 10)/10 + 0.3 * min(critical_opps_count, 5)/5 - 0.2 * val_pass_rate)
    health_score = max(
        0.0,
        min(
            1.0,
            round(
                0.4 * val_pass_rate
                + 0.3 * (1.0 - min(open_findings_count, 10.0) / 10.0)
                + 0.3 * (1.0 - min(critical_opps_count, 5.0) / 5.0),
                2,
            ),
        ),
    )

    records: list[MonitoringRecord] = []

    # Record health score
    r_health = record_metric(
        db,
        website_id=website_id,
        scan_id=scan_id,
        metric_name="health_score",
        metric_category="intelligence",
        current_value=health_score,
        target_type="scan",
        target_id=scan_id,
        details={"pass_rate": val_pass_rate, "findings": open_findings_count},
    )
    records.append(r_health)

    # Record validation pass rate
    r_val = record_metric(
        db,
        website_id=website_id,
        scan_id=scan_id,
        metric_name="validation_pass_rate",
        metric_category="validation",
        current_value=round(val_pass_rate, 2),
        target_type="scan",
        target_id=scan_id,
    )
    records.append(r_val)

    # Record open findings count
    r_find = record_metric(
        db,
        website_id=website_id,
        scan_id=scan_id,
        metric_name="open_findings_count",
        metric_category="quality",
        current_value=open_findings_count,
        target_type="scan",
        target_id=scan_id,
    )
    records.append(r_find)

    # Record critical opportunities count
    r_opp = record_metric(
        db,
        website_id=website_id,
        scan_id=scan_id,
        metric_name="critical_opportunities_count",
        metric_category="seo",
        current_value=critical_opps_count,
        target_type="scan",
        target_id=scan_id,
    )
    records.append(r_opp)

    # Record resolved recommendations count
    r_rec = record_metric(
        db,
        website_id=website_id,
        scan_id=scan_id,
        metric_name="resolved_recommendations_count",
        metric_category="remediation",
        current_value=resolved_recs_count,
        target_type="scan",
        target_id=scan_id,
    )
    records.append(r_rec)

    return records


def evaluate_website_monitoring(
    db: Session,
    website_id: int,
) -> list[MonitoringRecord]:
    """
    Evaluates website-level monitoring by taking the latest scan or aggregating across active assets.
    """
    website = db.get(Website, website_id)
    if not website:
        raise ValueError(f"Website with id {website_id} not found")

    latest_scan = (
        db.query(Scan)
        .filter(Scan.website_id == website_id)
        .order_by(Scan.id.desc())
        .first()
    )

    if latest_scan:
        return evaluate_scan_monitoring(db, latest_scan.id)

    # No scans yet: record zero baseline
    r = record_metric(
        db,
        website_id=website_id,
        metric_name="health_score",
        current_value=1.0,
        summary="Baseline health score established (No scans recorded).",
    )
    return [r]


def get_monitoring_timeline(
    db: Session,
    website_id: int,
    metric_name: str | None = None,
    limit: int = 50,
) -> list[MonitoringRecord]:
    """
    Returns historical monitoring snapshots ordered chronologically.
    """
    website = db.get(Website, website_id)
    if not website:
        raise ValueError(f"Website with id {website_id} not found")

    query = db.query(MonitoringRecord).filter(MonitoringRecord.website_id == website_id)
    if metric_name:
        query = query.filter(MonitoringRecord.metric_name == metric_name.strip())

    return query.order_by(MonitoringRecord.recorded_at.desc(), MonitoringRecord.id.desc()).limit(limit).all()


def get_website_health_status(
    db: Session,
    website_id: int,
) -> dict[str, Any]:
    """
    Returns an aggregated high-level health report for a website based on recent monitoring records.
    """
    website = db.get(Website, website_id)
    if not website:
        raise ValueError(f"Website with id {website_id} not found")

    records = (
        db.query(MonitoringRecord)
        .filter(MonitoringRecord.website_id == website_id)
        .order_by(MonitoringRecord.recorded_at.desc(), MonitoringRecord.id.desc())
        .limit(20)
        .all()
    )

    latest_metrics: dict[str, float] = {}
    recent_events: list[str] = []

    for r in records:
        if r.metric_name not in latest_metrics:
            latest_metrics[r.metric_name] = r.current_value
        if r.change_detected and r.summary and len(recent_events) < 5:
            recent_events.append(r.summary)

    health_score = latest_metrics.get("health_score", 1.0)
    val_rate = latest_metrics.get("validation_pass_rate", 1.0)
    open_findings = int(latest_metrics.get("open_findings_count", 0))
    critical_opps = int(latest_metrics.get("critical_opportunities_count", 0))

    if health_score >= 0.80 and open_findings <= 2:
        health_status = "healthy"
    elif health_score >= 0.50:
        health_status = "warning"
    else:
        health_status = "critical"

    return {
        "website_id": website_id,
        "health_status": health_status,
        "health_score": health_score,
        "validation_pass_rate": val_rate,
        "open_findings_count": open_findings,
        "critical_opportunities_count": critical_opps,
        "recent_events": recent_events,
        "evaluated_at": datetime.utcnow(),
    }
