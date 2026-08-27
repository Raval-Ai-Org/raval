from fastapi.testclient import TestClient
import pytest
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.main import app
from app.models import Finding, FixPlan, Opportunity, PageResult, Recommendation, Scan, ValidationResult, Website
from app.pipeline_service import get_pipeline_summary, run_end_to_end_intelligence_pipeline

client = TestClient(app)


def _setup_website_and_scan(db: Session, prefix: str = "PipeInt"):
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
        url=f"https://{prefix.lower()}.com/article",
        status_code=200,
        content_type="text/html",
    )
    db.add(page)
    db.commit()
    db.refresh(page)

    return website, scan, page


def test_case_a_full_pipeline_with_pass_validation():
    db = SessionLocal()
    try:
        website, scan, page = _setup_website_and_scan(db, "CaseA")

        # Create finding
        finding = Finding(
            website_id=website.id,
            scan_id=scan.id,
            page_id=page.id,
            finding_type="missing_title",
            category="seo",
            title="Missing Title Tag",
            description="Article has no title tag.",
            severity="high",
            status="open",
        )
        db.add(finding)
        db.commit()

        # Run complete pipeline
        report = run_end_to_end_intelligence_pipeline(
            db,
            website_id=website.id,
            scan_id=scan.id,
            run_validations=True,
        )

        assert report["website_id"] == website.id
        assert report["scan_id"] == scan.id
        assert report["status"] == "completed"

        # Stage counts
        counts = report["stage_counts"]
        assert counts["findings"] >= 1
        assert counts["opportunities"] >= 1
        assert counts["recommendations"] >= 1
        assert counts["fix_plans"] >= 1
        assert counts["validations"] >= 1

        # Summary
        val_sum = report["validation_summary"]
        assert sum(val_sum.values()) == counts["validations"]
    finally:
        db.close()


def test_case_b_full_pipeline_with_fail_validation():
    db = SessionLocal()
    try:
        website, scan, page = _setup_website_and_scan(db, "CaseB")

        # Create an unresolved technical SEO finding
        finding = Finding(
            website_id=website.id,
            scan_id=scan.id,
            page_id=page.id,
            finding_type="server_error_500",
            category="technical_seo",
            title="Server 500 Error",
            description="Internal server error detected.",
            severity="critical",
            status="open",
        )
        db.add(finding)
        db.commit()

        report = run_end_to_end_intelligence_pipeline(
            db,
            website_id=website.id,
            scan_id=scan.id,
            run_validations=True,
        )

        assert report["stage_counts"]["fix_plans"] >= 1
        assert report["stage_counts"]["validations"] >= 1
    finally:
        db.close()


def test_case_c_empty_findings_safe_handling():
    db = SessionLocal()
    try:
        website, scan, page = _setup_website_and_scan(db, "CaseC")

        # No findings created in scan
        report = run_end_to_end_intelligence_pipeline(
            db,
            website_id=website.id,
            scan_id=scan.id,
            run_validations=True,
        )

        assert report["stage_counts"]["findings"] == 0
        assert report["stage_counts"]["opportunities"] == 0
        assert report["stage_counts"]["recommendations"] == 0
        assert report["stage_counts"]["fix_plans"] == 0
        assert report["stage_counts"]["validations"] == 0
        assert report["status"] == "completed"
    finally:
        db.close()


def test_case_d_no_opportunities_safe_handling():
    db = SessionLocal()
    try:
        website, scan, page = _setup_website_and_scan(db, "CaseD")

        # Website with no scans or findings
        report = run_end_to_end_intelligence_pipeline(
            db,
            website_id=website.id,
            scan_id=None,
            run_validations=True,
        )

        assert report["stage_counts"]["findings"] == 0
        assert report["stage_counts"]["opportunities"] == 0
    finally:
        db.close()


def test_case_e_repeated_execution_idempotency():
    db = SessionLocal()
    try:
        website, scan, page = _setup_website_and_scan(db, "CaseE")

        finding = Finding(
            website_id=website.id,
            scan_id=scan.id,
            page_id=page.id,
            finding_type="missing_title",
            category="seo",
            title="Missing Title",
            description="No title tag found.",
            severity="high",
            status="open",
        )
        db.add(finding)
        db.commit()

        # Run 1
        report1 = run_end_to_end_intelligence_pipeline(db, website.id, scan.id)
        opp_count_1 = report1["stage_counts"]["opportunities"]
        rec_count_1 = report1["stage_counts"]["recommendations"]
        fp_count_1 = report1["stage_counts"]["fix_plans"]

        # Run 2 (Repeated execution)
        report2 = run_end_to_end_intelligence_pipeline(db, website.id, scan.id)
        opp_count_2 = report2["stage_counts"]["opportunities"]
        rec_count_2 = report2["stage_counts"]["recommendations"]
        fp_count_2 = report2["stage_counts"]["fix_plans"]

        # Counts must remain stable (no runaway duplicates)
        assert opp_count_1 == opp_count_2
        assert rec_count_1 == rec_count_2
        assert fp_count_1 == fp_count_2
    finally:
        db.close()


def test_case_f_invalid_and_mismatched_references():
    db = SessionLocal()
    try:
        website, scan, page = _setup_website_and_scan(db, "CaseF")

        # 1. Non-existent website
        with pytest.raises(ValueError, match="Website with id 999999 not found"):
            run_end_to_end_intelligence_pipeline(db, website_id=999999)

        # 2. Non-existent scan
        with pytest.raises(ValueError, match="Scan with id 999999 not found"):
            run_end_to_end_intelligence_pipeline(db, website_id=website.id, scan_id=999999)

        # 3. Scan belonging to another website
        other_site = Website(name="Other Site", url="https://other.com")
        db.add(other_site)
        db.commit()

        with pytest.raises(ValueError, match="does not belong to Website"):
            run_end_to_end_intelligence_pipeline(db, website_id=other_site.id, scan_id=scan.id)
    finally:
        db.close()


def test_case_g_api_pipeline_endpoints():
    db = SessionLocal()
    try:
        website, scan, page = _setup_website_and_scan(db, "CaseG")

        finding = Finding(
            website_id=website.id,
            scan_id=scan.id,
            page_id=page.id,
            finding_type="missing_title",
            category="seo",
            title="Missing Title",
            description="No title tag found.",
            severity="high",
            status="open",
        )
        db.add(finding)
        db.commit()

        # 1. POST /api/v1/scans/{id}/run-pipeline
        res_s = client.post(f"/api/v1/scans/{scan.id}/run-pipeline", json={"run_validations": True})
        assert res_s.status_code == 200
        data_s = res_s.json()
        assert data_s["scan_id"] == scan.id
        assert data_s["status"] == "completed"
        assert data_s["stage_counts"]["findings"] >= 1

        # 2. GET /api/v1/scans/{id}/pipeline-summary
        sum_s = client.get(f"/api/v1/scans/{scan.id}/pipeline-summary")
        assert sum_s.status_code == 200
        assert sum_s.json()["scan_id"] == scan.id
        assert 0.0 <= sum_s.json()["health_score"] <= 1.0

        # 3. POST /api/v1/websites/{id}/run-pipeline
        res_w = client.post(f"/api/v1/websites/{website.id}/run-pipeline", json={"run_validations": True})
        assert res_w.status_code == 200
        assert res_w.json()["website_id"] == website.id

        # 4. GET /api/v1/websites/{id}/pipeline-summary
        sum_w = client.get(f"/api/v1/websites/{website.id}/pipeline-summary")
        assert sum_w.status_code == 200
        assert sum_w.json()["website_id"] == website.id
    finally:
        db.close()
