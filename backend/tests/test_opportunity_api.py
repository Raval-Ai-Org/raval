from fastapi.testclient import TestClient
import pytest
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.main import app
from app.models import Finding, Opportunity, PageResult, Recommendation, Scan, Website

client = TestClient(app)


def _setup_entities(db: Session, prefix: str = "ApiOp"):
    website = Website(name=f"{prefix} Site", url=f"https://{prefix.lower()}.com")
    db.add(website)
    db.commit()
    db.refresh(website)

    scan = Scan(website_id=website.id, status="completed")
    db.add(scan)
    db.commit()
    db.refresh(scan)

    page = PageResult(
        scan_id=scan.id,
        url=f"https://{prefix.lower()}.com/landing",
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
        description="Page has no title tag.",
        severity="high",
        status="open",
        evidence={"tag": "title"},
    )
    db.add(finding)
    db.commit()
    db.refresh(finding)

    rec = Recommendation(
        finding_id=finding.id,
        title="Add Title Tag",
        description="Add a 50-character title tag.",
        priority="high",
        status="open",
    )
    db.add(rec)
    db.commit()
    db.refresh(rec)

    return website, scan, page, finding, rec


def test_create_opportunity_api_success():
    db = SessionLocal()
    try:
        website, scan, page, finding, rec = _setup_entities(db, "CreateApi")

        payload = {
            "website_id": website.id,
            "scan_id": scan.id,
            "page_id": page.id,
            "finding_id": finding.id,
            "recommendation_id": rec.id,
            "title": "API Created Opportunity",
            "description": "Created via POST /api/v1/opportunities.",
            "opportunity_type": "title_tag_optimization",
            "category": "technical_seo",
            "impact": 0.85,
            "effort": 0.25,
            "confidence": 0.90,
        }

        response = client.post("/api/v1/opportunities", json=payload)
        assert response.status_code == 200
        data = response.json()
        assert data["id"] is not None
        assert data["website_id"] == website.id
        assert data["title"] == "API Created Opportunity"
        assert data["priority"] == "CRITICAL"
        assert data["priority_score"] >= 0.80
        assert "critical" in data["rationale"].lower()
    finally:
        db.close()


def test_create_opportunity_api_validation_errors():
    # 1. Missing required title
    res = client.post(
        "/api/v1/opportunities",
        json={
            "website_id": 1,
            "title": "",
            "description": "Desc",
            "opportunity_type": "type",
        },
    )
    assert res.status_code == 400

    # 2. Non-existent website_id
    res = client.post(
        "/api/v1/opportunities",
        json={
            "website_id": 999999,
            "title": "Valid Title",
            "description": "Desc",
            "opportunity_type": "type",
        },
    )
    assert res.status_code == 404


def test_get_opportunity_by_id_api():
    db = SessionLocal()
    try:
        website, scan, page, finding, _ = _setup_entities(db, "GetId")

        op = Opportunity(
            website_id=website.id,
            scan_id=scan.id,
            page_id=page.id,
            finding_id=finding.id,
            title="Fetch by ID",
            description="Detail fetch test.",
            opportunity_type="test_type",
            category="seo",
            priority="HIGH",
            rationale="Test",
        )
        db.add(op)
        db.commit()
        db.refresh(op)

        res = client.get(f"/api/v1/opportunities/{op.id}")
        assert res.status_code == 200
        assert res.json()["id"] == op.id
        assert res.json()["title"] == "Fetch by ID"

        res_404 = client.get("/api/v1/opportunities/999999")
        assert res_404.status_code == 404
    finally:
        db.close()


def test_update_opportunity_api():
    db = SessionLocal()
    try:
        website, scan, page, finding, _ = _setup_entities(db, "UpdateApi")

        op = Opportunity(
            website_id=website.id,
            scan_id=scan.id,
            title="Initial Title",
            description="Initial Desc",
            opportunity_type="test_type",
            category="seo",
            status="identified",
            impact=0.5,
            effort=0.5,
            confidence=0.8,
            priority_score=0.5,
            priority="MEDIUM",
            rationale="Initial",
        )
        db.add(op)
        db.commit()
        db.refresh(op)

        # Update status and impact
        patch_payload = {
            "status": "in_progress",
            "impact": 0.95,  # higher impact
        }
        res = client.patch(f"/api/v1/opportunities/{op.id}", json=patch_payload)
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "in_progress"
        assert data["impact"] == 0.95
        assert data["priority"] in ("CRITICAL", "HIGH")
    finally:
        db.close()


def test_delete_opportunity_api():
    db = SessionLocal()
    try:
        website, scan, _, _, _ = _setup_entities(db, "DeleteApi")

        op = Opportunity(
            website_id=website.id,
            scan_id=scan.id,
            title="To Delete",
            description="Will be removed",
            opportunity_type="del_type",
            category="seo",
            priority="LOW",
            rationale="Del",
        )
        db.add(op)
        db.commit()
        op_id = op.id

        del_res = client.delete(f"/api/v1/opportunities/{op_id}")
        assert del_res.status_code == 200
        assert del_res.json()["deleted_id"] == op_id

        # Verify 404 on subsequent get
        assert client.get(f"/api/v1/opportunities/{op_id}").status_code == 404

        # Verify 404 on deleting non-existent ID
        assert client.delete("/api/v1/opportunities/999999").status_code == 404
    finally:
        db.close()


def test_list_and_filter_opportunities_api():
    db = SessionLocal()
    try:
        website, scan, page, finding, _ = _setup_entities(db, "FilterApi")

        op1 = Opportunity(
            website_id=website.id,
            scan_id=scan.id,
            finding_id=finding.id,
            title="SEO Op",
            description="Desc",
            opportunity_type="title_opt",
            category="technical_seo",
            status="identified",
            priority_score=0.9,
            priority="CRITICAL",
            rationale="Critical",
        )
        op2 = Opportunity(
            website_id=website.id,
            scan_id=scan.id,
            title="Content Op",
            description="Desc",
            opportunity_type="content_opt",
            category="content",
            status="in_progress",
            priority_score=0.45,
            priority="MEDIUM",
            rationale="Medium",
        )
        db.add_all([op1, op2])
        db.commit()

        # 1. Global list filtered by category
        res = client.get("/api/v1/opportunities?category=technical_seo")
        assert res.status_code == 200
        items = res.json()
        assert all(i["category"] == "technical_seo" for i in items)

        # 2. List by website
        res_web = client.get(f"/api/v1/websites/{website.id}/opportunities")
        assert res_web.status_code == 200
        assert len(res_web.json()) >= 2

        # 3. List by scan
        res_scan = client.get(f"/api/v1/scans/{scan.id}/opportunities")
        assert res_scan.status_code == 200
        assert len(res_scan.json()) >= 2

        # 4. List by finding
        res_finding = client.get(f"/api/v1/findings/{finding.id}/opportunities")
        assert res_finding.status_code == 200
        assert len(res_finding.json()) >= 1
    finally:
        db.close()


def test_batch_generate_endpoints():
    db = SessionLocal()
    try:
        website, scan, page, finding, rec = _setup_entities(db, "BatchApi")

        # 1. Generate from single finding
        res_f = client.post(f"/api/v1/findings/{finding.id}/generate-opportunities")
        assert res_f.status_code == 200
        assert res_f.json()["finding_id"] == finding.id

        # 2. Generate from single recommendation
        res_r = client.post(f"/api/v1/recommendations/{rec.id}/generate-opportunities")
        assert res_r.status_code == 200
        assert res_r.json()["recommendation_id"] == rec.id

        # 3. Batch generate for scan
        res_s = client.post(f"/api/v1/scans/{scan.id}/generate-opportunities")
        assert res_s.status_code == 200
        data_s = res_s.json()
        assert data_s["scan_id"] == scan.id
        assert data_s["generated_count"] >= 1

        # 4. Batch generate for website
        res_w = client.post(f"/api/v1/websites/{website.id}/generate-opportunities")
        assert res_w.status_code == 200
        data_w = res_w.json()
        assert data_w["website_id"] == website.id
        assert data_w["generated_count"] >= 1
    finally:
        db.close()
