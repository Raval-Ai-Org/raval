from fastapi.testclient import TestClient
import pytest

from app.database import SessionLocal
from app.main import app
from app.models import Finding, PageExtraction, PageResult, Scan, Website
from app.quality_analyzer import (
    QualityAnalyzer,
    analyze_quality,
)

client = TestClient(app)


def test_strong_evidence_content():
    text = (
        "According to research published by the National Renewable Energy Laboratory in 2023, "
        "modern bifacial solar panels demonstrate an average energy yield improvement of 12.5% "
        "and generate up to 450 kw across optimal installations."
    )
    links = [{"destination_url": "https://www.nrel.gov/research/solar.html"}]

    evidence = analyze_quality(text_content=text, links=links)

    assert evidence.has_quantitative_evidence is True
    assert evidence.data_points_count >= 2
    assert evidence.attributions_count >= 1
    assert evidence.citations_count >= 1
    assert evidence.unsupported_claims_count == 0
    assert evidence.evidence_strength == "strong"
    assert evidence.quality_score >= 0.75
    assert any(f["type"] == "strong_empirical_evidence" for f in evidence.findings)


def test_unsupported_superlative_claims():
    text = (
        "Our proprietary heating system is the best in the world and offers unrivaled performance for every homeowner. "
        "We deliver revolutionary perfection with guaranteed #1 reliability."
    )

    evidence = analyze_quality(text_content=text)

    assert evidence.has_quantitative_evidence is False
    assert evidence.unsupported_claims_count >= 2
    assert evidence.evidence_strength == "weak"
    assert evidence.quality_score < 0.50
    assert any(f["type"] == "unsupported_superlative_claims" for f in evidence.findings)


def test_empty_and_edge_case_content():
    evidence = analyze_quality(text_content="")
    assert evidence.quality_score == 0.0
    assert evidence.evidence_strength == "weak"
    assert any(f["type"] == "no_content_for_quality_evaluation" for f in evidence.findings)


def test_thin_sections_affect_quality():
    text = "We provide heat pumps."
    sections = [
        {"is_thin": True, "is_empty": False},
        {"is_thin": False, "is_empty": True},
    ]

    evidence = analyze_quality(text_content=text, sections=sections)
    assert evidence.thin_sections_count == 2


def test_quality_analysis_api_persistence():
    db = SessionLocal()
    try:
        website = Website(name="Quality Site", url="https://quality-site.com")
        db.add(website)
        db.commit()
        db.refresh(website)

        scan = Scan(website_id=website.id, status="completed")
        db.add(scan)
        db.commit()
        db.refresh(scan)

        html = """
        <html>
        <head><title>Heat Pump Performance</title></head>
        <body>
            <h1>Heat Pump Efficiency Report</h1>
            <p>According to data from the Department of Energy, ground source heat pumps achieve 300% efficiency in 2024.</p>
        </body>
        </html>
        """
        page = PageResult(
            scan_id=scan.id,
            url="https://quality-site.com/report",
            status_code=200,
            content=html,
        )
        db.add(page)
        db.commit()
        db.refresh(page)

        extraction = PageExtraction(
            page_result_id=page.id,
            scan_id=scan.id,
            title_text="Heat Pump Performance",
            h1_count=1,
        )
        db.add(extraction)
        db.commit()
        db.refresh(extraction)

        res = client.get(f"/api/v1/pages/{page.id}/quality-analysis?persist_findings=true")
        assert res.status_code == 200
        data = res.json()

        assert "quality_score" in data
        assert data["has_quantitative_evidence"] is True

        persisted = db.query(Finding).filter(Finding.page_id == page.id).all()
        assert len(persisted) >= 1
        assert persisted[0].website_id == website.id

        # 404 test
        res404 = client.get("/api/v1/pages/999999/quality-analysis")
        assert res404.status_code == 404
    finally:
        db.close()
