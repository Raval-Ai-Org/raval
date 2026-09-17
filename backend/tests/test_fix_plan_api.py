from fastapi.testclient import TestClient
import pytest
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.main import app
from app.models import Finding, FixPlan, PageResult, Recommendation, Scan, Website

client = TestClient(app)


def _setup_entities(db: Session, prefix: str = "FpApi"):
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
        url=f"https://{prefix.lower()}.com/pricing",
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
        description="Pricing page lacks a title tag.",
        severity="high",
        status="open",
    )
    db.add(finding)
    db.commit()
    db.refresh(finding)

    rec = Recommendation(
        finding_id=finding.id,
        title="Add Pricing Title Tag",
        description="Insert descriptive title tag on pricing page.",
        priority="high",
        status="open",
        action_type="meta_tag_fix",
    )
    db.add(rec)
    db.commit()
    db.refresh(rec)

    return website, scan, page, finding, rec


def test_create_fix_plan_api_success():
    db = SessionLocal()
    try:
        website, scan, page, finding, rec = _setup_entities(db, "CreateApi")

        payload = {
            "recommendation_id": rec.id,
            "website_id": website.id,
            "scan_id": scan.id,
            "page_id": page.id,
            "finding_id": finding.id,
            "fix_type": "meta_tag_improvement",
            "title": "API Created Fix Plan",
            "description": "Fix plan created via POST /api/v1/fix-plans",
            "problem_statement": "Pricing page is missing title tag.",
            "proposed_action": "Add <title>Pricing | Acme</title>",
            "expected_outcome": "Resolves missing title issue.",
            "estimated_effort": "low",
            "risk_level": "low",
            "priority": "high",
            "status": "draft",
        }

        res = client.post("/api/v1/fix-plans", json=payload)
        assert res.status_code == 201
        data = res.json()
        assert data["id"] is not None
        assert data["title"] == "API Created Fix Plan"
        assert data["status"] == "draft"
        assert data["fix_type"] == "meta_tag_improvement"
    finally:
        db.close()


def test_create_fix_plan_api_validation_errors():
    # 1. Non-existent recommendation_id
    res = client.post(
        "/api/v1/fix-plans",
        json={
            "recommendation_id": 999999,
            "website_id": 1,
            "fix_type": "meta_tag_improvement",
            "title": "Title",
            "description": "Desc",
            "problem_statement": "Prob",
            "proposed_action": "Action",
            "expected_outcome": "Outcome",
        },
    )
    assert res.status_code == 404

    # 2. Missing required problem_statement
    res2 = client.post(
        "/api/v1/fix-plans",
        json={
            "recommendation_id": 1,
            "website_id": 1,
            "fix_type": "meta_tag_improvement",
            "title": "Title",
            "description": "Desc",
            "problem_statement": "",
            "proposed_action": "Action",
            "expected_outcome": "Outcome",
        },
    )
    assert res2.status_code == 400


def test_get_and_update_fix_plan_api():
    db = SessionLocal()
    try:
        website, scan, page, finding, rec = _setup_entities(db, "GetUpd")

        gen_res = client.post(f"/api/v1/recommendations/{rec.id}/generate-fix-plan")
        assert gen_res.status_code == 200
        plan_id = gen_res.json()["id"]

        # GET by ID
        get_res = client.get(f"/api/v1/fix-plans/{plan_id}")
        assert get_res.status_code == 200
        assert get_res.json()["id"] == plan_id

        # PATCH update
        patch_res = client.patch(
            f"/api/v1/fix-plans/{plan_id}",
            json={"title": "Updated Plan Title via API", "risk_level": "medium"},
        )
        assert patch_res.status_code == 200
        assert patch_res.json()["title"] == "Updated Plan Title via API"
        assert patch_res.json()["risk_level"] == "medium"
    finally:
        db.close()


def test_fix_plan_status_transition_api():
    db = SessionLocal()
    try:
        website, scan, page, finding, rec = _setup_entities(db, "StatusApi")

        gen_res = client.post(f"/api/v1/recommendations/{rec.id}/generate-fix-plan")
        plan_id = gen_res.json()["id"]

        # 1. draft -> ready_for_review
        res1 = client.post(
            f"/api/v1/fix-plans/{plan_id}/status",
            json={"status": "ready_for_review", "comment": "Ready for QA"},
        )
        assert res1.status_code == 200
        assert res1.json()["status"] == "ready_for_review"

        # 2. ready_for_review -> approved
        res2 = client.post(
            f"/api/v1/fix-plans/{plan_id}/status",
            json={"status": "approved", "comment": "Approved by reviewer"},
        )
        assert res2.status_code == 200
        assert res2.json()["status"] == "approved"

        # 3. approved -> completed
        res3 = client.post(
            f"/api/v1/fix-plans/{plan_id}/status",
            json={"status": "completed", "comment": "Deployed"},
        )
        assert res3.status_code == 200
        assert res3.json()["status"] == "completed"

        # 4. Invalid transition from completed
        res4 = client.post(
            f"/api/v1/fix-plans/{plan_id}/status",
            json={"status": "draft"},
        )
        assert res4.status_code == 400
    finally:
        db.close()


def test_delete_and_list_fix_plans_api():
    db = SessionLocal()
    try:
        website, scan, page, finding, rec = _setup_entities(db, "DelList")

        gen_res = client.post(f"/api/v1/recommendations/{rec.id}/generate-fix-plan")
        plan_id = gen_res.json()["id"]

        # List with filter
        list_res = client.get(f"/api/v1/fix-plans?recommendation_id={rec.id}")
        assert list_res.status_code == 200
        assert len(list_res.json()) >= 1

        # Recommendation fix-plans endpoint
        rfp_res = client.get(f"/api/v1/recommendations/{rec.id}/fix-plans")
        assert rfp_res.status_code == 200
        assert len(rfp_res.json()) >= 1

        # Delete
        del_res = client.delete(f"/api/v1/fix-plans/{plan_id}")
        assert del_res.status_code == 200
        assert del_res.json()["deleted_id"] == plan_id

        # 404 after delete
        assert client.get(f"/api/v1/fix-plans/{plan_id}").status_code == 404
    finally:
        db.close()


def test_batch_generate_fix_plans_endpoints():
    db = SessionLocal()
    try:
        website, scan, page, finding, rec = _setup_entities(db, "BatchApi")

        # 1. Batch for scan
        res_s = client.post(f"/api/v1/scans/{scan.id}/generate-fix-plans")
        assert res_s.status_code == 200
        assert res_s.json()["scan_id"] == scan.id
        assert res_s.json()["generated_count"] >= 1

        # 2. Batch for website
        res_w = client.post(f"/api/v1/websites/{website.id}/generate-fix-plans")
        assert res_w.status_code == 200
        assert res_w.json()["website_id"] == website.id
        assert res_w.json()["generated_count"] >= 1
    finally:
        db.close()
