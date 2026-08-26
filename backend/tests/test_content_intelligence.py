from fastapi.testclient import TestClient
import pytest

from app.content_intelligence_analyzer import (
    ContentIntelligenceAnalyzer,
    analyze_content_intelligence,
)
from app.database import SessionLocal
from app.main import app
from app.models import Finding, PageExtraction, PageResult, Scan, Website

client = TestClient(app)


def test_positive_content_intelligence_profile():
    html = """
    <html>
    <head><title>Guide to Solar Inverters | CleanEnergy Corp</title></head>
    <body>
        <h1>Complete Guide to Solar Inverters</h1>
        <p>Solar inverters are essential power conversion units for modern solar systems.</p>
        <h2>How do solar inverters work?</h2>
        <p>Solar inverters work by converting direct current from photovoltaic panels into alternating current with 98% conversion efficiency.</p>
        <h2>What are the main types of inverters?</h2>
        <ul>
            <li>String Inverters: Economical centralized systems</li>
            <li>Microinverters: Panel-level module electronics</li>
        </ul>
        <p>According to reports published in 2024, string inverters provide 15-year warranty protection.</p>
    </body>
    </html>
    """
    headings = [
        {"level": 1, "text": "Complete Guide to Solar Inverters"},
        {"level": 2, "text": "How do solar inverters work?"},
        {"level": 2, "text": "What are the main types of inverters?"},
    ]

    summary = analyze_content_intelligence(
        raw_html=html,
        text_content="Complete Guide to Solar Inverters. Solar inverters work by converting direct current with 98% conversion efficiency.",
        title="Guide to Solar Inverters | CleanEnergy Corp",
        headings=headings,
    )

    assert summary.overall_content_score >= 0.50
    assert summary.content_status in ("optimal", "needs_improvement")
    assert len(summary.key_strengths) >= 1
    assert "structure" in summary.component_summaries
    assert "readiness" in summary.component_summaries
    assert "quality" in summary.component_summaries


def test_thin_content_intelligence_profile():
    summary = analyze_content_intelligence(
        raw_html="<html><body><p>Hello world</p></body></html>",
        text_content="Hello world",
        title=None,
        headings=[],
    )

    assert summary.overall_content_score < 0.55
    assert summary.content_status in ("needs_improvement", "deficient")
    assert len(summary.critical_issues) >= 1



def test_content_intelligence_api_endpoint_and_isolation():
    db = SessionLocal()
    try:
        website_a = Website(name="Intel Site A", url="https://intel-a.com")
        website_b = Website(name="Intel Site B", url="https://intel-b.com")
        db.add_all([website_a, website_b])
        db.commit()
        db.refresh(website_a)
        db.refresh(website_b)

        scan_a = Scan(website_id=website_a.id, status="completed")
        scan_b = Scan(website_id=website_b.id, status="completed")
        db.add_all([scan_a, scan_b])
        db.commit()
        db.refresh(scan_a)
        db.refresh(scan_b)

        page_a = PageResult(
            scan_id=scan_a.id,
            url="https://intel-a.com/page1",
            status_code=200,
            content="<html><body><h1>Solar Guide</h1><p>Clean energy generation overview.</p></body></html>",
        )
        db.add(page_a)
        db.commit()
        db.refresh(page_a)

        extraction_a = PageExtraction(
            page_result_id=page_a.id,
            scan_id=scan_a.id,
            title_text="Solar Guide",
            h1_count=1,
        )
        db.add(extraction_a)
        db.commit()
        db.refresh(extraction_a)

        # Call page content-intelligence API with persist_findings=true
        res = client.get(f"/api/v1/pages/{page_a.id}/content-intelligence?persist_findings=true")
        assert res.status_code == 200
        data = res.json()
        assert data["overall_content_score"] > 0.0
        assert data["url"] == page_a.url

        # Check isolation: findings belong only to website_a and scan_a
        findings_a = db.query(Finding).filter(Finding.scan_id == scan_a.id).all()
        assert len(findings_a) >= 1
        for f in findings_a:
            assert f.website_id == website_a.id

        findings_b = db.query(Finding).filter(Finding.scan_id == scan_b.id).all()
        assert len(findings_b) == 0

        # Scan-level aggregation API endpoint
        scan_res = client.get(f"/api/v1/scans/{scan_a.id}/content-intelligence")
        assert scan_res.status_code == 200
        scan_data = scan_res.json()
        assert scan_data["scan_id"] == scan_a.id
        assert scan_data["total_pages_analyzed"] == 1
        assert scan_data["average_content_score"] > 0.0

        # 404 tests
        res404_page = client.get("/api/v1/pages/999999/content-intelligence")
        assert res404_page.status_code == 404

        res404_scan = client.get("/api/v1/scans/999999/content-intelligence")
        assert res404_scan.status_code == 404
    finally:
        db.close()
