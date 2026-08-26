from fastapi.testclient import TestClient
import pytest
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.main import app
from app.models import Finding, Recommendation, Scan, Website
from app.services import (
    ALLOWED_RECOMMENDATION_PRIORITIES,
    ALLOWED_RECOMMENDATION_STATUSES,
    create_finding,
    create_recommendation,
    get_finding_recommendations,
    get_recommendation,
    get_scan_recommendations,
    get_website_recommendations,
)

client = TestClient(app)


def _setup_website_scan_and_finding(
    db: Session,
    site_name: str = "Rec Test Site",
    url: str = "https://rec-test.com",
    finding_title: str = "Sample Finding",
):
    website = Website(name=site_name, url=url)
    db.add(website)
    db.commit()
    db.refresh(website)

    scan = Scan(website_id=website.id, status="completed", pages_crawled=1)
    db.add(scan)
    db.commit()
    db.refresh(scan)

    finding = Finding(
        website_id=website.id,
        scan_id=scan.id,
        finding_type="missing_title",
        title=finding_title,
        description="Missing title tag description",
        severity="high",
        status="open",
    )
    db.add(finding)
    db.commit()
    db.refresh(finding)

    return website, scan, finding


def test_create_recommendation_success():
    db = SessionLocal()
    try:
        website, scan, finding = _setup_website_scan_and_finding(db, "Create Rec Site", "https://rec1.com")

        payload = {
            "title": "Add a unique title tag",
            "description": "Ensure the document head contains a descriptive title tag between 50 and 60 characters.",
            "priority": "high",
            "status": "open",
            "impact": "Improves SERP click-through rate and relevance scoring",
            "action_type": "meta_tag_fix",
            "payload": {
                "suggested_tag": "<title>Home | Example Brand</title>",
                "target_length": 25,
            },
        }

        response = client.post(f"/api/v1/findings/{finding.id}/recommendations", json=payload)
        assert response.status_code == 201
        data = response.json()

        assert data["id"] is not None
        assert data["finding_id"] == finding.id
        assert data["title"] == payload["title"]
        assert data["description"] == payload["description"]
        assert data["priority"] == "high"
        assert data["status"] == "open"
        assert data["impact"] == payload["impact"]
        assert data["action_type"] == "meta_tag_fix"
        assert data["payload"] == payload["payload"]
        assert "created_at" in data

        # Verify DB persistence
        db_rec = db.get(Recommendation, data["id"])
        assert db_rec is not None
        assert db_rec.finding_id == finding.id
        assert db_rec.title == payload["title"]
        assert db_rec.finding.id == finding.id
    finally:
        db.close()


def test_finding_recommendations_retrieval():
    db = SessionLocal()
    try:
        website, scan, finding = _setup_website_scan_and_finding(db, "Retrieval Rec Site", "https://rec2.com")

        # Create two recommendations for the finding
        client.post(
            f"/api/v1/findings/{finding.id}/recommendations",
            json={
                "title": "Recommendation 1",
                "description": "First recommendation",
                "priority": "medium",
            },
        )
        client.post(
            f"/api/v1/findings/{finding.id}/recommendations",
            json={
                "title": "Recommendation 2",
                "description": "Second recommendation",
                "priority": "low",
            },
        )

        res = client.get(f"/api/v1/findings/{finding.id}/recommendations")
        assert res.status_code == 200
        recs = res.json()
        assert len(recs) == 2
        assert recs[0]["title"] == "Recommendation 1"
        assert recs[1]["title"] == "Recommendation 2"
        assert recs[0]["finding_id"] == finding.id
        assert recs[1]["finding_id"] == finding.id
    finally:
        db.close()


def test_get_single_recommendation():
    db = SessionLocal()
    try:
        website, scan, finding = _setup_website_scan_and_finding(db, "Single Rec Site", "https://rec3.com")

        create_res = client.post(
            f"/api/v1/findings/{finding.id}/recommendations",
            json={
                "title": "Single Rec",
                "description": "Detailed description",
                "priority": "critical",
            },
        )
        rec_id = create_res.json()["id"]

        get_res = client.get(f"/api/v1/recommendations/{rec_id}")
        assert get_res.status_code == 200
        assert get_res.json()["id"] == rec_id
        assert get_res.json()["priority"] == "critical"

        # Not found
        not_found = client.get("/api/v1/recommendations/999999")
        assert not_found.status_code == 404
    finally:
        db.close()


def test_website_and_scan_recommendations_isolation():
    db = SessionLocal()
    try:
        # Website A / Scan 1
        site_a, scan_1, finding_1 = _setup_website_scan_and_finding(db, "Site A", "https://site-a.com")
        # Website B / Scan 2
        site_b, scan_2, finding_2 = _setup_website_scan_and_finding(db, "Site B", "https://site-b.com")

        # Rec for Site A
        client.post(
            f"/api/v1/findings/{finding_1.id}/recommendations",
            json={"title": "Rec A", "description": "Fix for Site A", "priority": "high"},
        )

        # Rec for Site B
        client.post(
            f"/api/v1/findings/{finding_2.id}/recommendations",
            json={"title": "Rec B", "description": "Fix for Site B", "priority": "low"},
        )

        # Query recommendations for Site A
        res_site_a = client.get(f"/api/v1/websites/{site_a.id}/recommendations")
        assert res_site_a.status_code == 200
        recs_a = res_site_a.json()
        assert len(recs_a) == 1
        assert recs_a[0]["title"] == "Rec A"

        # Query recommendations for Site B
        res_site_b = client.get(f"/api/v1/websites/{site_b.id}/recommendations")
        assert res_site_b.status_code == 200
        recs_b = res_site_b.json()
        assert len(recs_b) == 1
        assert recs_b[0]["title"] == "Rec B"

        # Query recommendations for Scan 1
        res_scan_1 = client.get(f"/api/v1/scans/{scan_1.id}/recommendations")
        assert res_scan_1.status_code == 200
        scan_1_recs = res_scan_1.json()
        assert len(scan_1_recs) == 1
        assert scan_1_recs[0]["title"] == "Rec A"

        # Query recommendations for Scan 2
        res_scan_2 = client.get(f"/api/v1/scans/{scan_2.id}/recommendations")
        assert res_scan_2.status_code == 200
        scan_2_recs = res_scan_2.json()
        assert len(scan_2_recs) == 1
        assert scan_2_recs[0]["title"] == "Rec B"
    finally:
        db.close()


def test_website_findings_endpoint():
    db = SessionLocal()
    try:
        site, scan1, finding1 = _setup_website_scan_and_finding(db, "Website Findings Site", "https://site-find.com")

        # Create scan 2 for same website
        scan2 = Scan(website_id=site.id, status="completed", pages_crawled=1)
        db.add(scan2)
        db.commit()
        db.refresh(scan2)

        finding2 = Finding(
            website_id=site.id,
            scan_id=scan2.id,
            finding_type="broken_anchor",
            title="Broken Anchor",
            description="Anchor has no target",
            severity="low",
            status="open",
        )
        db.add(finding2)
        db.commit()

        res = client.get(f"/api/v1/websites/{site.id}/findings")
        assert res.status_code == 200
        findings = res.json()
        assert len(findings) == 2
        types = {f["finding_type"] for f in findings}
        assert "missing_title" in types
        assert "broken_anchor" in types
    finally:
        db.close()


def test_validation_invalid_priority():
    db = SessionLocal()
    try:
        website, scan, finding = _setup_website_scan_and_finding(db, "Val Priority Site", "https://val-pri.com")

        res = client.post(
            f"/api/v1/findings/{finding.id}/recommendations",
            json={
                "title": "Invalid Priority Test",
                "description": "Should fail",
                "priority": "super_urgent",
            },
        )
        assert res.status_code == 400
        assert "priority" in res.json()["detail"].lower()
    finally:
        db.close()


def test_validation_invalid_status():
    db = SessionLocal()
    try:
        website, scan, finding = _setup_website_scan_and_finding(db, "Val Status Site", "https://val-stat.com")

        res = client.post(
            f"/api/v1/findings/{finding.id}/recommendations",
            json={
                "title": "Invalid Status Test",
                "description": "Should fail",
                "status": "not_a_valid_status",
            },
        )
        assert res.status_code == 400
        assert "status" in res.json()["detail"].lower()
    finally:
        db.close()


def test_validation_empty_fields():
    db = SessionLocal()
    try:
        website, scan, finding = _setup_website_scan_and_finding(db, "Val Empty Site", "https://val-empty.com")

        # Empty title
        res1 = client.post(
            f"/api/v1/findings/{finding.id}/recommendations",
            json={
                "title": "   ",
                "description": "Some description",
            },
        )
        assert res1.status_code == 400
        assert "title" in res1.json()["detail"].lower()

        # Empty description
        res2 = client.post(
            f"/api/v1/findings/{finding.id}/recommendations",
            json={
                "title": "Valid Title",
                "description": "   ",
            },
        )
        assert res2.status_code == 400
        assert "description" in res2.json()["detail"].lower()
    finally:
        db.close()


def test_validation_nonexistent_finding():
    res = client.post(
        "/api/v1/findings/999999/recommendations",
        json={
            "title": "Valid Title",
            "description": "Valid Description",
        },
    )
    assert res.status_code == 404
    assert "finding" in res.json()["detail"].lower()


def test_historical_preservation():
    db = SessionLocal()
    try:
        website, scan1, finding1 = _setup_website_scan_and_finding(db, "Historical Rec Site", "https://hist-rec.com")

        # Rec for scan 1
        rec1_res = client.post(
            f"/api/v1/findings/{finding1.id}/recommendations",
            json={"title": "Historical Rec 1", "description": "Original fix", "priority": "medium"},
        )
        rec1_id = rec1_res.json()["id"]

        # Run Scan 2 later
        scan2 = Scan(website_id=website.id, status="completed", pages_crawled=1)
        db.add(scan2)
        db.commit()
        db.refresh(scan2)

        finding2 = Finding(
            website_id=website.id,
            scan_id=scan2.id,
            finding_type="missing_canonical",
            title="Scan 2 Finding",
            description="Second scan finding",
            severity="low",
            status="open",
        )
        db.add(finding2)
        db.commit()
        db.refresh(finding2)

        rec2_res = client.post(
            f"/api/v1/findings/{finding2.id}/recommendations",
            json={"title": "Historical Rec 2", "description": "New fix", "priority": "low"},
        )
        rec2_id = rec2_res.json()["id"]

        # Verify Scan 1 recommendation remains preserved
        rec1_fetched = client.get(f"/api/v1/recommendations/{rec1_id}").json()
        assert rec1_fetched["finding_id"] == finding1.id
        assert rec1_fetched["title"] == "Historical Rec 1"

        # Verify Scan 2 recommendation is distinct
        rec2_fetched = client.get(f"/api/v1/recommendations/{rec2_id}").json()
        assert rec2_fetched["finding_id"] == finding2.id
        assert rec2_fetched["title"] == "Historical Rec 2"
    finally:
        db.close()


def test_cascade_deletion_on_finding_delete():
    db = SessionLocal()
    try:
        website, scan, finding = _setup_website_scan_and_finding(db, "Cascade Rec Site", "https://cascade-rec.com")

        rec = create_recommendation(
            db,
            finding.id,
            {
                "title": "Cascade Rec",
                "description": "Should be deleted when finding is deleted",
                "priority": "low",
            },
        )
        rec_id = rec.id

        # Delete finding
        db.delete(finding)
        db.commit()

        # Verify recommendation is cascaded
        assert db.get(Recommendation, rec_id) is None
    finally:
        db.close()


def test_direct_service_layer_validation():
    db = SessionLocal()
    try:
        website, scan, finding = _setup_website_scan_and_finding(db, "Service Rec Site", "https://service-rec.com")

        rec = create_recommendation(
            db,
            finding.id,
            {
                "title": "Direct Service Rec",
                "description": "Testing service layer directly",
                "priority": "info",
                "status": "in_progress",
            },
        )
        assert rec.id is not None
        assert rec.finding_id == finding.id

        fetched = get_recommendation(db, rec.id)
        assert fetched.id == rec.id

        finding_recs = get_finding_recommendations(db, finding.id)
        assert len(finding_recs) == 1
        assert finding_recs[0].id == rec.id

        site_recs = get_website_recommendations(db, website.id)
        assert len(site_recs) == 1
        assert site_recs[0].id == rec.id

        scan_recs = get_scan_recommendations(db, scan.id)
        assert len(scan_recs) == 1
        assert scan_recs[0].id == rec.id

        # Unknown IDs raise ValueError
        with pytest.raises(ValueError, match="Recommendation not found"):
            get_recommendation(db, 999999)

        with pytest.raises(ValueError, match="Finding not found"):
            get_finding_recommendations(db, 999999)

        with pytest.raises(ValueError, match="Website not found"):
            get_website_recommendations(db, 999999)

        with pytest.raises(ValueError, match="Scan not found"):
            get_scan_recommendations(db, 999999)
    finally:
        db.close()
