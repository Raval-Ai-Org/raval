from fastapi.testclient import TestClient
import pytest
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.fix_service import generate_fix_plan_from_recommendation
from app.main import app
from app.models import Finding, FixPlan, Opportunity, PageResult, Recommendation, Scan, ValidationResult, Website
from app.opportunity_service import generate_opportunity_from_finding
from app.recommendation_service import generate_recommendation_from_finding
from app.validation_service import apply_validation_feedback, validate_fix_plan

client = TestClient(app)


def _setup_pipeline_chain(db: Session, prefix: str = "Feedback"):
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
        url=f"https://{prefix.lower()}.com/service",
        status_code=200,
        content_type="text/html",
    )
    db.add(page)
    db.commit()
    db.refresh(page)

    finding = Finding(
        website_id=website.id,
        scan_id=scan.id,
        page_id=page.id,
        finding_type="missing_title",
        category="seo",
        title="Missing Title Tag",
        description="Service page has no title tag.",
        severity="high",
        status="open",
    )
    db.add(finding)
    db.commit()
    db.refresh(finding)

    opp = generate_opportunity_from_finding(db, finding.id)
    rec = generate_recommendation_from_finding(db, finding.id, opportunity_id=opp.id)
    plan = generate_fix_plan_from_recommendation(db, rec.id)

    return website, scan, page, finding, opp, rec, plan


def test_successful_validation_feedback_updates_statuses():
    db = SessionLocal()
    try:
        website, scan, page, finding, opp, rec, plan = _setup_pipeline_chain(db, "SuccessFb")

        # Initial state
        assert plan.status == "draft"
        assert rec.status == "open"

        # Validate with PASS condition
        val = validate_fix_plan(
            db,
            plan.id,
            simulated_after_state={"title": "Service Optimization Page Title | Acme"},
        )

        assert val.result == "PASS"

        db.refresh(plan)
        db.refresh(rec)

        # Fix plan marked completed upon successful validation
        assert plan.status == "completed"
        assert plan.safety_checks["validated"] is True
        assert plan.safety_checks["validation_result"] == "PASS"

        # Recommendation resolved
        assert rec.status == "resolved"
        assert rec.payload["validation_result"] == "PASS"

        # Next action in feedback
        assert "Remediation verified" in val.feedback["next_action"]
    finally:
        db.close()


def test_failed_validation_feedback_prevents_infinite_loop():
    db = SessionLocal()
    try:
        website, scan, page, finding, opp, rec, plan = _setup_pipeline_chain(db, "FailFb")

        # First failure
        val1 = validate_fix_plan(
            db,
            plan.id,
            simulated_after_state={"title": ""},  # empty -> FAIL
        )
        assert val1.result == "FAIL"

        db.refresh(plan)
        db.refresh(rec)
        assert plan.status == "ready_for_review"
        assert rec.status == "open"
        assert val1.feedback["remediation_cycles"] == 1
        assert "Re-examine diff payload" in val1.feedback["next_action"]

        # Second failure (simulates repeated re-validation cycle)
        val2 = validate_fix_plan(
            db,
            plan.id,
            simulated_after_state={"title": ""},
        )
        assert val2.result == "FAIL"
        assert val2.feedback["remediation_cycles"] == 2
    finally:
        db.close()


def test_partial_validation_feedback():
    db = SessionLocal()
    try:
        website, scan, page, finding, opp, rec, plan = _setup_pipeline_chain(db, "PartialFb")

        # Title present but too short (< 10 chars) -> PARTIAL
        val = validate_fix_plan(
            db,
            plan.id,
            simulated_after_state={"title": "Short"},
        )
        assert val.result == "PARTIAL"

        db.refresh(plan)
        db.refresh(rec)
        assert plan.status == "ready_for_review"
        assert rec.status == "in_progress"
        assert "partially successful" in val.feedback["next_action"]
    finally:
        db.close()


def test_traceability_chain_provenance():
    db = SessionLocal()
    try:
        website, scan, page, finding, opp, rec, plan = _setup_pipeline_chain(db, "Trace")

        val = validate_fix_plan(
            db,
            plan.id,
            simulated_after_state={"title": "Authoritative Complete Title Tag For Traceability"},
        )

        # Full provenance verification
        assert val.fix_plan_id == plan.id
        assert val.recommendation_id == rec.id
        assert val.opportunity_id == opp.id
        assert val.finding_id == finding.id
        assert val.website_id == website.id
        assert val.scan_id == scan.id
        assert val.page_id == page.id

        # Bidirectional check
        db.refresh(finding)
        assert any(v.id == val.id for v in finding.validations)
        db.refresh(opp)
        assert any(v.id == val.id for v in opp.validations)
        db.refresh(rec)
        assert any(v.id == val.id for v in rec.validations)
        db.refresh(plan)
        assert any(v.id == val.id for v in plan.validations)
    finally:
        db.close()


def test_validation_api_endpoints():
    db = SessionLocal()
    try:
        website, scan, page, finding, opp, rec, plan = _setup_pipeline_chain(db, "ApiVal")

        # 1. Validate FixPlan via API
        post_fp_res = client.post(
            f"/api/v1/fix-plans/{plan.id}/validate",
            json={"simulated_after_state": {"title": "Valid API Validated Title Tag (45 chars)"}},
        )
        assert post_fp_res.status_code == 200
        val_data = post_fp_res.json()
        assert val_data["result"] == "PASS"
        assert val_data["fix_plan_id"] == plan.id
        val_id = val_data["id"]

        # 2. Get Validation detail
        get_val_res = client.get(f"/api/v1/validations/{val_id}")
        assert get_val_res.status_code == 200
        assert get_val_res.json()["id"] == val_id

        # 3. List validations for fix plan
        fp_vals_res = client.get(f"/api/v1/fix-plans/{plan.id}/validations")
        assert fp_vals_res.status_code == 200
        assert len(fp_vals_res.json()) >= 1

        # 4. List validations for recommendation
        rec_vals_res = client.get(f"/api/v1/recommendations/{rec.id}/validations")
        assert rec_vals_res.status_code == 200
        assert len(rec_vals_res.json()) >= 1

        # 5. Validate Recommendation via API
        post_rec_res = client.post(
            f"/api/v1/recommendations/{rec.id}/validate",
            json={"simulated_after_state": {"title": "Valid Direct Recommendation Title Tag"}},
        )
        assert post_rec_res.status_code == 200
        assert post_rec_res.json()["result"] == "PASS"
    finally:
        db.close()
