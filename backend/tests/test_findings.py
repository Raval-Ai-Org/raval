from fastapi.testclient import TestClient
import pytest
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.main import app
from app.models import Finding, PageResult, Scan, Website
from app.services import (
    ALLOWED_FINDING_SEVERITIES,
    ALLOWED_FINDING_STATUSES,
    create_finding,
    get_finding,
    get_page_findings,
    get_scan_findings,
)

client = TestClient(app)


def _setup_website_and_scan(db: Session, name: str = "Test Findings Site", url: str = "https://findings-test.com"):
    website = Website(name=name, url=url)
    db.add(website)
    db.commit()
    db.refresh(website)

    scan = Scan(website_id=website.id, status="completed", pages_crawled=1)
    db.add(scan)
    db.commit()
    db.refresh(scan)

    return website, scan


def _setup_page(db: Session, scan_id: int, url: str = "https://findings-test.com/about"):
    page = PageResult(
        scan_id=scan_id,
        url=url,
        status_code=200,
        content_type="text/html",
        depth=1,
    )
    db.add(page)
    db.commit()
    db.refresh(page)
    return page


def test_create_finding_success_with_page():
    db = SessionLocal()
    try:
        website, scan = _setup_website_and_scan(db, "Finding With Page Site", "https://finding1.com")
        page = _setup_page(db, scan.id, "https://finding1.com/page")

        payload = {
            "page_id": page.id,
            "type": "missing_meta_description",
            "category": "seo",
            "title": "Missing Meta Description",
            "description": "The page does not have a meta description tag.",
            "severity": "medium",
            "status": "open",
            "evidence": {"page_url": page.url, "meta_description_count": 0},
        }

        response = client.post(f"/api/v1/scans/{scan.id}/findings", json=payload)
        assert response.status_code == 201
        data = response.json()

        assert data["id"] is not None
        assert data["website_id"] == website.id
        assert data["scan_id"] == scan.id
        assert data["page_id"] == page.id
        assert data["finding_type"] == "missing_meta_description"
        assert data["type"] == "missing_meta_description"
        assert data["category"] == "seo"
        assert data["title"] == "Missing Meta Description"
        assert data["description"] == "The page does not have a meta description tag."
        assert data["severity"] == "medium"
        assert data["status"] == "open"
        assert data["evidence"] == {"page_url": page.url, "meta_description_count": 0}
        assert "created_at" in data

        # Verify DB persistence
        db_finding = db.get(Finding, data["id"])
        assert db_finding is not None
        assert db_finding.website_id == website.id
        assert db_finding.scan_id == scan.id
        assert db_finding.page_id == page.id
        assert db_finding.type == "missing_meta_description"
    finally:
        db.close()


def test_create_site_level_finding_without_page():
    db = SessionLocal()
    try:
        website, scan = _setup_website_and_scan(db, "Site Level Finding", "https://finding2.com")

        payload = {
            "page_id": None,
            "type": "missing_sitemap",
            "category": "technical_seo",
            "title": "No Sitemap Found",
            "description": "Robots.txt does not specify a sitemap URL.",
            "severity": "high",
            "status": "open",
            "evidence": {"robots_txt_checked": True},
        }

        response = client.post(f"/api/v1/scans/{scan.id}/findings", json=payload)
        assert response.status_code == 201
        data = response.json()

        assert data["id"] is not None
        assert data["scan_id"] == scan.id
        assert data["page_id"] is None
        assert data["severity"] == "high"

        # Verify DB persistence
        db_finding = db.get(Finding, data["id"])
        assert db_finding is not None
        assert db_finding.page_id is None
    finally:
        db.close()


def test_scan_isolation():
    db = SessionLocal()
    try:
        website, scan1 = _setup_website_and_scan(db, "Isolation Site", "https://isolation.com")
        scan2 = Scan(website_id=website.id, status="completed", pages_crawled=1)
        db.add(scan2)
        db.commit()
        db.refresh(scan2)

        # Finding for scan 1
        client.post(
            f"/api/v1/scans/{scan1.id}/findings",
            json={
                "type": "scan1_issue",
                "title": "Scan 1 Issue",
                "description": "Issue in scan 1",
                "severity": "low",
            },
        )

        # Finding for scan 2
        client.post(
            f"/api/v1/scans/{scan2.id}/findings",
            json={
                "type": "scan2_issue",
                "title": "Scan 2 Issue",
                "description": "Issue in scan 2",
                "severity": "critical",
            },
        )

        # Query scan 1 findings
        res1 = client.get(f"/api/v1/scans/{scan1.id}/findings")
        assert res1.status_code == 200
        findings1 = res1.json()
        assert len(findings1) == 1
        assert findings1[0]["finding_type"] == "scan1_issue"
        assert findings1[0]["scan_id"] == scan1.id

        # Query scan 2 findings
        res2 = client.get(f"/api/v1/scans/{scan2.id}/findings")
        assert res2.status_code == 200
        findings2 = res2.json()
        assert len(findings2) == 1
        assert findings2[0]["finding_type"] == "scan2_issue"
        assert findings2[0]["scan_id"] == scan2.id
    finally:
        db.close()


def test_page_association_and_retrieval():
    db = SessionLocal()
    try:
        website, scan = _setup_website_and_scan(db, "Page Assoc Site", "https://page-assoc.com")
        page_a = _setup_page(db, scan.id, "https://page-assoc.com/a")
        page_b = _setup_page(db, scan.id, "https://page-assoc.com/b")

        # Create finding for page A
        client.post(
            f"/api/v1/scans/{scan.id}/findings",
            json={
                "page_id": page_a.id,
                "type": "missing_h1",
                "title": "Page A Missing H1",
                "description": "Page A has no H1 tag.",
                "severity": "high",
            },
        )

        # Create finding for page B
        client.post(
            f"/api/v1/scans/{scan.id}/findings",
            json={
                "page_id": page_b.id,
                "type": "duplicate_title",
                "title": "Page B Duplicate Title",
                "description": "Page B has a duplicate title.",
                "severity": "medium",
            },
        )

        # Retrieve for page A
        res_a = client.get(f"/api/v1/pages/{page_a.id}/findings")
        assert res_a.status_code == 200
        data_a = res_a.json()
        assert len(data_a) == 1
        assert data_a[0]["title"] == "Page A Missing H1"
        assert data_a[0]["page_id"] == page_a.id

        # Retrieve for page B
        res_b = client.get(f"/api/v1/pages/{page_b.id}/findings")
        assert res_b.status_code == 200
        data_b = res_b.json()
        assert len(data_b) == 1
        assert data_b[0]["title"] == "Page B Duplicate Title"
        assert data_b[0]["page_id"] == page_b.id
    finally:
        db.close()


def test_get_single_finding():
    db = SessionLocal()
    try:
        website, scan = _setup_website_and_scan(db, "Single Finding Site", "https://single.com")

        create_res = client.post(
            f"/api/v1/scans/{scan.id}/findings",
            json={
                "type": "broken_link",
                "title": "Broken Link Detected",
                "description": "404 detected on internal link.",
                "severity": "medium",
            },
        )
        finding_id = create_res.json()["id"]

        get_res = client.get(f"/api/v1/findings/{finding_id}")
        assert get_res.status_code == 200
        assert get_res.json()["id"] == finding_id
        assert get_res.json()["finding_type"] == "broken_link"

        # Not found
        not_found_res = client.get("/api/v1/findings/999999")
        assert not_found_res.status_code == 404
    finally:
        db.close()


def test_historical_preservation():
    db = SessionLocal()
    try:
        website, scan1 = _setup_website_and_scan(db, "Historical Site", "https://historical.com")

        # Scan 1 finding
        res1 = client.post(
            f"/api/v1/scans/{scan1.id}/findings",
            json={
                "type": "issue_v1",
                "title": "V1 Issue",
                "description": "Initial scan issue",
                "severity": "low",
            },
        )
        finding1_id = res1.json()["id"]

        # Run Scan 2 later
        scan2 = Scan(website_id=website.id, status="queued")
        db.add(scan2)
        db.commit()
        db.refresh(scan2)

        # Update Scan 2 status to running then completed
        scan2.status = "completed"
        db.commit()

        # Scan 2 finding
        res2 = client.post(
            f"/api/v1/scans/{scan2.id}/findings",
            json={
                "type": "issue_v2",
                "title": "V2 Issue",
                "description": "Subsequent scan issue",
                "severity": "high",
            },
        )
        finding2_id = res2.json()["id"]

        # Verify Scan 1 finding is untouched and still linked to scan1
        f1_check = client.get(f"/api/v1/findings/{finding1_id}").json()
        assert f1_check["scan_id"] == scan1.id
        assert f1_check["finding_type"] == "issue_v1"

        # Verify Scan 2 finding is distinct
        f2_check = client.get(f"/api/v1/findings/{finding2_id}").json()
        assert f2_check["scan_id"] == scan2.id
        assert f2_check["finding_type"] == "issue_v2"

        # Verify Scan 1 list does not include Scan 2 finding
        s1_findings = client.get(f"/api/v1/scans/{scan1.id}/findings").json()
        assert len(s1_findings) == 1
        assert s1_findings[0]["id"] == finding1_id
    finally:
        db.close()


def test_validation_invalid_severity():
    db = SessionLocal()
    try:
        website, scan = _setup_website_and_scan(db, "Validation Sev Site", "https://val-sev.com")

        res = client.post(
            f"/api/v1/scans/{scan.id}/findings",
            json={
                "type": "some_type",
                "title": "Some Title",
                "description": "Some Description",
                "severity": "extreme",
            },
        )
        assert res.status_code == 400
        assert "severity" in res.json()["detail"].lower()
    finally:
        db.close()


def test_validation_invalid_status():
    db = SessionLocal()
    try:
        website, scan = _setup_website_and_scan(db, "Validation Status Site", "https://val-status.com")

        res = client.post(
            f"/api/v1/scans/{scan.id}/findings",
            json={
                "type": "some_type",
                "title": "Some Title",
                "description": "Some Description",
                "status": "bogus_status",
            },
        )
        assert res.status_code == 400
        assert "status" in res.json()["detail"].lower()
    finally:
        db.close()


def test_validation_empty_fields():
    db = SessionLocal()
    try:
        website, scan = _setup_website_and_scan(db, "Validation Empty Site", "https://val-empty.com")

        # Empty title
        res = client.post(
            f"/api/v1/scans/{scan.id}/findings",
            json={
                "type": "some_type",
                "title": "   ",
                "description": "Some Description",
            },
        )
        assert res.status_code == 400
        assert "title" in res.json()["detail"].lower()

        # Empty description
        res2 = client.post(
            f"/api/v1/scans/{scan.id}/findings",
            json={
                "type": "some_type",
                "title": "Valid Title",
                "description": "",
            },
        )
        assert res2.status_code == 400
        assert "description" in res2.json()["detail"].lower()
    finally:
        db.close()


def test_validation_nonexistent_scan():
    res = client.post(
        "/api/v1/scans/999999/findings",
        json={
            "type": "some_type",
            "title": "Valid Title",
            "description": "Valid Description",
        },
    )
    assert res.status_code == 404
    assert "scan" in res.json()["detail"].lower()


def test_validation_nonexistent_page():
    db = SessionLocal()
    try:
        website, scan = _setup_website_and_scan(db, "Val Nonexistent Page Site", "https://val-nopage.com")

        res = client.post(
            f"/api/v1/scans/{scan.id}/findings",
            json={
                "page_id": 999999,
                "type": "some_type",
                "title": "Valid Title",
                "description": "Valid Description",
            },
        )
        assert res.status_code == 404
        assert "page" in res.json()["detail"].lower()
    finally:
        db.close()


def test_validation_page_scan_mismatch():
    db = SessionLocal()
    try:
        website, scan1 = _setup_website_and_scan(db, "Mismatch Site", "https://mismatch.com")
        page1 = _setup_page(db, scan1.id, "https://mismatch.com/p1")

        scan2 = Scan(website_id=website.id, status="completed", pages_crawled=0)
        db.add(scan2)
        db.commit()
        db.refresh(scan2)

        # Attempt to attach page1 (belonging to scan1) to finding in scan2
        res = client.post(
            f"/api/v1/scans/{scan2.id}/findings",
            json={
                "page_id": page1.id,
                "type": "cross_scan_issue",
                "title": "Invalid Cross-Scan Page",
                "description": "This should fail",
            },
        )
        assert res.status_code == 400
        assert "belong" in res.json()["detail"].lower()
    finally:
        db.close()


def test_service_layer_direct_validation():
    db = SessionLocal()
    try:
        website, scan = _setup_website_and_scan(db, "Service Layer Site", "https://service-layer.com")

        # Direct service call
        finding = create_finding(
            db,
            scan.id,
            {
                "type": "direct_service",
                "title": "Direct Service Finding",
                "description": "Testing service layer directly",
                "severity": "info",
                "status": "open",
            },
        )
        assert finding.id is not None
        assert finding.scan_id == scan.id
        assert finding.website_id == website.id

        # Direct retrieval
        findings = get_scan_findings(db, scan.id)
        assert len(findings) == 1
        assert findings[0].id == finding.id

        fetched = get_finding(db, finding.id)
        assert fetched.id == finding.id

        # Unknown scan in service layer
        with pytest.raises(ValueError, match="Scan not found"):
            get_scan_findings(db, 999999)

        # Unknown page in service layer
        with pytest.raises(ValueError, match="Page not found"):
            get_page_findings(db, 999999)

        # Unknown finding in service layer
        with pytest.raises(ValueError, match="Finding not found"):
            get_finding(db, 999999)
    finally:
        db.close()


def test_findings_cascade_on_scan_delete():
    db = SessionLocal()
    try:
        website, scan = _setup_website_and_scan(db, "Cascade Site", "https://cascade.com")
        finding = create_finding(
            db,
            scan.id,
            {
                "type": "cascade_test",
                "title": "Cascade Test",
                "description": "Should be deleted when scan is deleted",
                "severity": "low",
            },
        )
        finding_id = finding.id

        # Delete scan
        db.delete(scan)
        db.commit()

        # Verify finding is cascaded
        assert db.get(Finding, finding_id) is None
    finally:
        db.close()
