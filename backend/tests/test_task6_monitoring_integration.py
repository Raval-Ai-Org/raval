"""
Task 6.10 Monitoring & Complete Pipeline Integration Tests
Verifies monitoring metric calculations, delta tracking, idempotency,
health summary, timeline, and end-to-end downstream intelligence pipeline.
"""

from fastapi.testclient import TestClient
import pytest
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.main import app
from app.models import Finding, FixPlan, MonitoringRecord, Opportunity, PageResult, Recommendation, Scan, ValidationResult, Website
from app.monitoring_service import (
    evaluate_scan_monitoring,
    evaluate_website_monitoring,
    get_monitoring_timeline,
    get_website_health_status,
    record_metric,
)
from app.pipeline_service import (
    get_pipeline_summary,
    run_end_to_end_intelligence_pipeline,
)

client = TestClient(app)


def _setup_website_and_scan(db: Session, prefix: str = "Mon610"):
    website = Website(name=f"{prefix} Site", url=f"https://{prefix.lower()}.com")
    db.add(website)
    db.commit()
    db.refresh(website)

    scan = Scan(website_id=website.id, status="completed", pages_crawled=1)
    db.add(scan)
    db.commit()
    db.refresh(scan)

    page = PageResult(
        scan_id=scan.id,
        url=f"https://{prefix.lower()}.com/page",
        status_code=200,
        content_type="text/html",
    )
    db.add(page)
    db.commit()
    db.refresh(page)

    return website, scan, page


def test_record_metric_and_delta_calculation():
    db = SessionLocal()
    try:
        website, scan, page = _setup_website_and_scan(db, "DeltaMon")

        # Initial metric
        r1 = record_metric(
            db,
            website_id=website.id,
            metric_name="health_score",
            current_value=0.70,
        )
        assert r1.current_value == 0.70
        assert r1.previous_value is None
        assert r1.delta is None
        assert r1.status == "warning"

        # Subsequent metric: improves to 0.85
        r2 = record_metric(
            db,
            website_id=website.id,
            metric_name="health_score",
            current_value=0.85,
        )
        assert r2.current_value == 0.85
        assert r2.previous_value == 0.70
        assert r2.delta == 0.15
        assert r2.change_detected is True
        assert r2.status == "healthy"
        assert r2.event_type == "health_score_increased"
    finally:
        db.close()


def test_evaluate_scan_monitoring_and_idempotency():
    db = SessionLocal()
    try:
        website, scan, page = _setup_website_and_scan(db, "ScanMon")

        # Add 2 findings
        f1 = Finding(
            scan_id=scan.id,
            website_id=website.id,
            page_id=page.id,
            finding_type="missing_title",
            category="seo",
            title="Missing Title",
            description="Article has no title tag",
            severity="high",
            status="open",
        )
        f2 = Finding(
            scan_id=scan.id,
            website_id=website.id,
            page_id=page.id,
            finding_type="missing_h1",
            category="content",
            title="Missing H1",
            description="Article has no H1 heading",
            severity="medium",
            status="open",
        )
        db.add_all([f1, f2])
        db.commit()

        records = evaluate_scan_monitoring(db, scan.id)
        assert len(records) >= 4
        metrics = {r.metric_name: r for r in records}
        assert "health_score" in metrics
        assert "open_findings_count" in metrics
        assert metrics["open_findings_count"].current_value == 2.0

        # Running evaluate_scan_monitoring again updates in-place without duplicating
        records_second = evaluate_scan_monitoring(db, scan.id)
        total_records = db.query(MonitoringRecord).filter(MonitoringRecord.scan_id == scan.id).count()
        assert total_records == len(records)
    finally:
        db.close()


def test_get_website_health_status_and_timeline():
    db = SessionLocal()
    try:
        website, scan, page = _setup_website_and_scan(db, "HealthStatus")

        # Record some metrics
        record_metric(db, website_id=website.id, metric_name="health_score", current_value=0.92)
        record_metric(db, website_id=website.id, metric_name="validation_pass_rate", current_value=1.0)
        record_metric(db, website_id=website.id, metric_name="open_findings_count", current_value=0.0)

        health_summary = get_website_health_status(db, website.id)
        assert health_summary["website_id"] == website.id
        assert health_summary["health_status"] == "healthy"
        assert health_summary["health_score"] == 0.92
        assert health_summary["validation_pass_rate"] == 1.0

        timeline = get_monitoring_timeline(db, website.id)
        assert len(timeline) == 3
    finally:
        db.close()


def test_end_to_end_pipeline_with_monitoring_stage():
    """
    Verifies full execution of all Task 6 downstream stages:
    Scan -> Findings -> Opportunities -> Prioritization -> Recommendations -> Fix Plans -> Validation -> Monitoring
    """
    db = SessionLocal()
    try:
        website, scan, page = _setup_website_and_scan(db, "E2EMon")

        # Seed finding
        finding = Finding(
            scan_id=scan.id,
            page_id=page.id,
            website_id=website.id,
            finding_type="missing_meta_description",
            category="seo",
            title="Missing Meta Description",
            description="Missing meta description tag",
            severity="medium",
            status="open",
        )
        db.add(finding)
        db.commit()

        pipeline_result = run_end_to_end_intelligence_pipeline(
            db,
            website_id=website.id,
            scan_id=scan.id,
            run_validations=True,
        )

        assert pipeline_result["status"] == "completed"
        counts = pipeline_result["stage_counts"]
        assert counts["findings"] == 1
        assert counts["opportunities"] >= 1
        assert counts["recommendations"] >= 1
        assert counts["fix_plans"] >= 1
        assert counts["validations"] >= 1
        assert counts["monitoring"] >= 1

        # Check monitoring records created
        assert len(pipeline_result["monitoring_records"]) >= 1

        # Check pipeline summary
        summary = get_pipeline_summary(db, website_id=website.id, scan_id=scan.id)
        assert summary["health_status"] in {"healthy", "warning", "critical"}
        assert summary["stage_counts"]["monitoring"] >= 1
    finally:
        db.close()


def test_monitoring_api_endpoints():
    db = SessionLocal()
    try:
        website, scan, page = _setup_website_and_scan(db, "APIMon")

        # 1. Trigger scan monitoring
        res_scan = client.post(f"/api/v1/scans/{scan.id}/monitoring")
        assert res_scan.status_code == 200
        scan_records = res_scan.json()
        assert isinstance(scan_records, list)
        assert len(scan_records) >= 1

        # 2. Trigger website monitoring
        res_web = client.post(f"/api/v1/websites/{website.id}/monitoring")
        assert res_web.status_code == 200

        # 3. Get timeline
        res_tl = client.get(f"/api/v1/websites/{website.id}/monitoring-timeline")
        assert res_tl.status_code == 200
        tl_data = res_tl.json()
        assert tl_data["website_id"] == website.id
        assert len(tl_data["records"]) >= 1

        # 4. Get health summary
        res_health = client.get(f"/api/v1/websites/{website.id}/health-summary")
        assert res_health.status_code == 200
        h_data = res_health.json()
        assert "health_status" in h_data
        assert "health_score" in h_data
    finally:
        db.close()
