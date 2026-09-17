"""
API Integration Tests for Authority, Citation & Trust Intelligence
(Day 8 - Phase B - Step 11 ONLY)

Verifies FastAPI endpoints:
1. GET /api/v1/pages/{page_id}/authority-citation-trust
2. POST /api/v1/pages/{page_id}/authority-citation-trust
3. GET /api/v1/scans/{scan_id}/authority-citation-trust
4. POST /api/v1/scans/{scan_id}/authority-citation-trust
5. POST /api/v1/authority-citation-trust/analyze
6. 404 error handling for missing pages and scans
7. Safe handling of empty/weak page inputs
8. Step 2 canonical schema compatibility across all endpoints
9. Idempotency and database persistence of findings and recommendations
10. Evidence != Conclusion: No fabricated scores or AI guarantees
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.main import app
from app.models import Finding, PageExtraction, PageHeading, PageLink, PageResult, Recommendation, Scan, Website

client = TestClient(app)


def _setup_test_data(db: Session, prefix: str = "AuthApi"):
    website = Website(name=f"{prefix} Site", url=f"https://{prefix.lower()}.org")
    db.add(website)
    db.commit()
    db.refresh(website)

    scan = Scan(website_id=website.id, status="completed", pages_crawled=2)
    db.add(scan)
    db.commit()
    db.refresh(scan)

    # Page 1: Comprehensive authoritative page
    page1 = PageResult(
        scan_id=scan.id,
        url=f"https://{prefix.lower()}.org/papers/spin-resonance",
        content="""
        <html>
        <head><title>Quantum Spin Resonance in 2026</title></head>
        <body>
            <h1>Quantum Spin Resonance in 2026</h1>
            <p>Authored by Dr. Sarah Vance, PhD, Lead Researcher at Quantum Institute. Contact us at info@quantum-research.org.</p>
            <h2>Experimental Findings</h2>
            <p>Our benchmark trials demonstrated an efficiency improvement of 48.7% over previous superconducting models.</p>
            <h2>References and Data Sources</h2>
            <p>For foundational calculations, see the <a href="https://doi.org/10.1038/nature-sample" rel="noopener">Nature Superconducting Benchmark Dataset</a>.</p>
        </body>
        </html>
        """,
    )
    db.add(page1)
    db.commit()
    db.refresh(page1)

    # Add extraction record for page 1
    ext1 = PageExtraction(
        page_result_id=page1.id,
        scan_id=scan.id,
        html_available=True,
        clean_text_available=True,
        title_present=True,
        title_text="Quantum Spin Resonance in 2026",
        main_content_candidate="Authored by Dr. Sarah Vance, PhD, Lead Researcher at Quantum Institute. Our benchmark trials demonstrated an efficiency improvement of 48.7% over previous superconducting models.",
    )
    db.add(ext1)
    db.commit()
    db.refresh(ext1)

    h1 = PageHeading(page_extraction_id=ext1.id, level=1, text="Quantum Spin Resonance in 2026", position=0)
    h2 = PageHeading(page_extraction_id=ext1.id, level=2, text="Experimental Findings", position=1)
    h3 = PageHeading(page_extraction_id=ext1.id, level=2, text="References and Data Sources", position=2)
    db.add_all([h1, h2, h3])

    link1 = PageLink(
        page_extraction_id=ext1.id,
        destination_url="https://doi.org/10.1038/nature-sample",
        anchor_text="Nature Superconducting Benchmark Dataset",
        link_type="external",
        rel_raw="noopener",
        position=0,
    )
    db.add(link1)
    db.commit()

    # Page 2: Thin, weak page with claims but no sources
    page2 = PageResult(
        scan_id=scan.id,
        url=f"https://{prefix.lower()}.org/products/gizmo",
        content="""
        <html><body><p>We provide the greatest and fastest quantum solution in the world!</p></body></html>
        """,
    )
    db.add(page2)
    db.commit()
    db.refresh(page2)

    return website, scan, page1, page2


def test_1_get_page_authority_citation_trust_success():
    """Verify GET /api/v1/pages/{page_id}/authority-citation-trust returns complete Step 2 structure."""
    db = SessionLocal()
    _, _, page1, _ = _setup_test_data(db, prefix="GetPageApi")
    page_id = page1.id
    expected_url = page1.url
    db.close()

    response = client.get(f"/api/v1/pages/{page_id}/authority-citation-trust")
    assert response.status_code == 200
    data = response.json()

    assert data["url"] == expected_url
    assert "trust_signals" in data
    assert "authority_signals" in data
    assert "external_sources" in data
    assert "support_needed_claims" in data
    assert "source_associations" in data
    assert "citation_readiness" in data
    assert "findings" in data
    assert "recommendations" in data

    # Verify nested contracts
    assert data["citation_readiness"]["readiness_level"] in ("high", "moderate", "low")
    assert isinstance(data["external_sources"], list)
    assert len(data["external_sources"]) >= 1
    assert data["external_sources"][0]["domain"] == "doi.org"


def test_2_post_page_authority_citation_trust_persists_findings_and_recommendations():
    """Verify POST /api/v1/pages/{page_id}/authority-citation-trust evaluates and persists findings/recommendations."""
    db = SessionLocal()
    _, _, _, page2 = _setup_test_data(db, prefix="PostPageApi")
    page_id = page2.id
    db.close()

    response = client.post(f"/api/v1/pages/{page_id}/authority-citation-trust?persist=true")
    assert response.status_code == 200
    data = response.json()

    assert len(data["findings"]) >= 1
    assert len(data["recommendations"]) >= 1

    # Verify DB records
    db = SessionLocal()
    findings = db.query(Finding).filter(Finding.page_id == page_id).all()
    recommendations = db.query(Recommendation).all()
    assert len(findings) >= 1
    assert len(recommendations) >= 1
    db.close()


def test_3_get_scan_authority_citation_trust_all_pages():
    """Verify GET /api/v1/scans/{scan_id}/authority-citation-trust returns evaluation for all pages in scan."""
    db = SessionLocal()
    _, scan, page1, page2 = _setup_test_data(db, prefix="GetScanApi")
    scan_id = scan.id
    page1_url = page1.url
    page2_url = page2.url
    db.close()

    response = client.get(f"/api/v1/scans/{scan_id}/authority-citation-trust")
    assert response.status_code == 200
    data = response.json()

    assert isinstance(data, list)
    assert len(data) >= 2
    urls = [d["url"] for d in data]
    assert page1_url in urls
    assert page2_url in urls


def test_4_post_scan_authority_citation_trust_persists_all():
    """Verify POST /api/v1/scans/{scan_id}/authority-citation-trust persists findings across scan."""
    db = SessionLocal()
    _, scan, _, _ = _setup_test_data(db, prefix="PostScanApi")
    scan_id = scan.id
    db.close()

    response = client.post(f"/api/v1/scans/{scan_id}/authority-citation-trust?persist=true")
    assert response.status_code == 200
    data = response.json()

    assert isinstance(data, list)
    assert len(data) >= 2

    db = SessionLocal()
    findings_count = db.query(Finding).filter(Finding.scan_id == scan_id).count()
    assert findings_count >= 1
    db.close()


def test_5_direct_analyze_endpoint():
    """Verify POST /api/v1/authority-citation-trust/analyze evaluates raw HTML without DB."""
    payload = {
        "url": "https://external-lab.com/report",
        "html": """
        <html>
        <head><title>External Study 2026</title></head>
        <body>
            <h1>External Study 2026</h1>
            <p>Authored by Dr. Alice Baker (PhD). Contact: research@external-lab.com.</p>
            <p>Our quantitative measurements show 99.8% precision across 5,000 trials.</p>
            <p>Source data available at <a href="https://arxiv.org/abs/2601.12345">arXiv Paper</a>.</p>
        </body>
        </html>
        """,
    }
    response = client.post("/api/v1/authority-citation-trust/analyze", json=payload)
    assert response.status_code == 200
    data = response.json()

    assert data["url"] == "https://external-lab.com/report"
    assert isinstance(data["trust_signals"], list)
    assert len(data["trust_signals"]) >= 1
    assert isinstance(data["authority_signals"], list)
    assert len(data["support_needed_claims"]) >= 1
    assert data["citation_readiness"]["readiness_level"] in ("high", "moderate", "low")


def test_6_404_error_handling_for_missing_page_and_scan():
    """Verify 404 status code when page or scan does not exist."""
    resp_page = client.get("/api/v1/pages/999999/authority-citation-trust")
    assert resp_page.status_code == 404
    assert "not found" in resp_page.json()["detail"].lower()

    resp_scan = client.get("/api/v1/scans/999999/authority-citation-trust")
    assert resp_scan.status_code == 404
    assert "not found" in resp_scan.json()["detail"].lower()


def test_7_empty_weak_input_safety():
    """Verify direct analyze endpoint safely handles empty input without erroring."""
    payload = {"url": "https://empty-test.com", "html": "<html><body></body></html>"}
    response = client.post("/api/v1/authority-citation-trust/analyze", json=payload)
    assert response.status_code == 200
    data = response.json()

    assert data["citation_readiness"]["readiness_level"] == "low"
    assert data["citation_readiness"]["has_verifiable_sources"] is False
    assert len(data["findings"]) >= 1


def test_8_idempotent_repeated_persists():
    """Verify calling persist multiple times updates existing records without duplicate creation."""
    db = SessionLocal()
    _, _, _, page2 = _setup_test_data(db, prefix="IdempotentApi")
    page_id = page2.id
    db.close()

    # Call 1
    client.post(f"/api/v1/pages/{page_id}/authority-citation-trust?persist=true")
    db = SessionLocal()
    count_1 = db.query(Finding).filter(Finding.page_id == page_id).count()
    rec_count_1 = db.query(Recommendation).count()
    db.close()

    # Call 2
    client.post(f"/api/v1/pages/{page_id}/authority-citation-trust?persist=true")
    db = SessionLocal()
    count_2 = db.query(Finding).filter(Finding.page_id == page_id).count()
    rec_count_2 = db.query(Recommendation).count()
    db.close()

    assert count_1 == count_2
    assert rec_count_1 == rec_count_2


def test_9_no_fabricated_scores_or_guarantees():
    """Verify output contains no fake rank guarantees or ungrounded assertions."""
    db = SessionLocal()
    _, _, page1, _ = _setup_test_data(db, prefix="TruthApi")
    page_id = page1.id
    db.close()

    response = client.get(f"/api/v1/pages/{page_id}/authority-citation-trust")
    assert response.status_code == 200
    data = response.json()

    text_dump = str(data).lower()
    assert "guaranteed" not in text_dump
    assert "fake_score" not in text_dump


def test_10_get_and_post_website_authority_citation_trust():
    """Verify GET and POST /api/v1/websites/{website_id}/authority-citation-trust across website scans."""
    db = SessionLocal()
    website, scan, page1, page2 = _setup_test_data(db, prefix="WebLevelApi")
    website_id = website.id
    db.close()

    # GET website
    get_resp = client.get(f"/api/v1/websites/{website_id}/authority-citation-trust")
    assert get_resp.status_code == 200
    get_data = get_resp.json()
    assert isinstance(get_data, list)
    assert len(get_data) >= 2

    # POST website with persist=true
    post_resp = client.post(f"/api/v1/websites/{website_id}/authority-citation-trust?persist=true")
    assert post_resp.status_code == 200
    post_data = post_resp.json()
    assert isinstance(post_data, list)
    assert len(post_data) >= 2

    db = SessionLocal()
    findings = db.query(Finding).filter(Finding.website_id == website_id).all()
    assert len(findings) >= 1
    db.close()

