from fastapi.testclient import TestClient
import pytest

from app.content_intelligence_analyzer import analyze_content_intelligence
from app.content_intelligence_rules import get_content_aeo_rules
from app.content_quality_checks import run_content_quality_checks
from app.database import SessionLocal
from app.main import app
from app.models import Finding, PageExtraction, PageResult, Scan, Website
from app.services import run_full_page_content_pipeline

client = TestClient(app)


def test_audit_rules_catalog_and_endpoint():
    """Verify that all AEO rules are defined and accessible via API."""
    all_rules = get_content_aeo_rules()
    assert len(all_rules) >= 15

    # API Endpoint check
    res = client.get("/api/v1/content-intelligence/rules")
    assert res.status_code == 200
    data = res.json()
    assert data["total_rules"] == len(all_rules)
    assert "structure" in data["categories"]
    assert "topic" in data["categories"]
    assert "quality_evidence" in data["categories"]

    # Category filter check
    res_filtered = client.get("/api/v1/content-intelligence/rules?category=structure")
    assert res_filtered.status_code == 200
    data_f = res_filtered.json()
    assert all(r["category"] == "structure" for r in data_f["rules"])
    assert data_f["total_rules"] >= 4


def test_audit_multi_tenant_website_and_scan_isolation():
    """Verify that findings and content intelligence never cross website or scan boundaries."""
    db = SessionLocal()
    try:
        w1 = Website(name="Tenant Alpha", url="https://alpha-tenant.com")
        w2 = Website(name="Tenant Beta", url="https://beta-tenant.com")
        db.add_all([w1, w2])
        db.commit()
        db.refresh(w1)
        db.refresh(w2)

        s1 = Scan(website_id=w1.id, status="completed")
        s2 = Scan(website_id=w2.id, status="completed")
        db.add_all([s1, s2])
        db.commit()
        db.refresh(s1)
        db.refresh(s2)

        p1 = PageResult(
            scan_id=s1.id,
            url="https://alpha-tenant.com/article",
            status_code=200,
            content="<html><body><h1>Alpha Heading</h1><p>Alpha tenant body content.</p></body></html>",
        )
        p2 = PageResult(
            scan_id=s2.id,
            url="https://beta-tenant.com/article",
            status_code=200,
            content="<html><body><h1>Beta Heading</h1><p>Beta tenant body content.</p></body></html>",
        )
        db.add_all([p1, p2])
        db.commit()
        db.refresh(p1)
        db.refresh(p2)

        # Run pipeline for p1 with findings persistence
        client.post(f"/api/v1/pages/{p1.id}/run-content-pipeline?persist_all=true")

        # Scan 1 findings must belong only to w1
        f1 = db.query(Finding).filter(Finding.scan_id == s1.id).all()
        assert len(f1) >= 1
        for f in f1:
            assert f.website_id == w1.id
            assert f.scan_id == s1.id
            assert f.page_id == p1.id

        # Scan 2 findings must be completely empty
        f2 = db.query(Finding).filter(Finding.scan_id == s2.id).all()
        assert len(f2) == 0

        # Website 2 must have zero findings
        w2_findings = db.query(Finding).filter(Finding.website_id == w2.id).all()
        assert len(w2_findings) == 0
    finally:
        db.close()


def test_audit_historical_scan_preservation():
    """Verify that completing a subsequent scan does not mutate prior historical scan data."""
    db = SessionLocal()
    try:
        site = Website(name="Historical Site", url="https://history-test.com")
        db.add(site)
        db.commit()
        db.refresh(site)

        # First scan
        scan1 = Scan(website_id=site.id, status="completed")
        db.add(scan1)
        db.commit()
        db.refresh(scan1)

        page1 = PageResult(
            scan_id=scan1.id,
            url="https://history-test.com/home",
            status_code=200,
            content="<html><body><h1>Version 1 Title</h1><p>Initial release content.</p></body></html>",
        )
        db.add(page1)
        db.commit()
        db.refresh(page1)

        client.post(f"/api/v1/pages/{page1.id}/run-content-pipeline?persist_all=true")
        count_scan1 = db.query(Finding).filter(Finding.scan_id == scan1.id).count()
        assert count_scan1 >= 1

        # Second scan for same site
        scan2 = Scan(website_id=site.id, status="completed")
        db.add(scan2)
        db.commit()
        db.refresh(scan2)

        page2 = PageResult(
            scan_id=scan2.id,
            url="https://history-test.com/home",
            status_code=200,
            content="<html><body><h1>Version 2 Title</h1><p>Second release with changed content.</p></body></html>",
        )
        db.add(page2)
        db.commit()
        db.refresh(page2)

        client.post(f"/api/v1/pages/{page2.id}/run-content-pipeline?persist_all=true")

        # Scan 1 count must remain exactly the same
        count_scan1_after = db.query(Finding).filter(Finding.scan_id == scan1.id).count()
        assert count_scan1_after == count_scan1

        # Scan 2 findings are isolated
        count_scan2 = db.query(Finding).filter(Finding.scan_id == scan2.id).count()
        assert count_scan2 >= 1
    finally:
        db.close()


def test_audit_deterministic_scoring_bounds():
    """Verify that all analyzer scores are deterministic and strictly clamped to [0.0, 1.0]."""
    text = "Machine learning algorithms optimize predictive models. In 2024, benchmark accuracy reached 98.5%."
    html = "<html><body><h1>Machine Learning</h1><p>" + text + "</p></body></html>"

    res1 = analyze_content_intelligence(raw_html=html, text_content=text, title="Machine Learning")
    res2 = analyze_content_intelligence(raw_html=html, text_content=text, title="Machine Learning")

    # Pure determinism check
    assert res1.overall_content_score == res2.overall_content_score
    assert res1.answer_readiness_score == res2.answer_readiness_score
    assert res1.evidence_quality_score == res2.evidence_quality_score
    assert res1.semantic_coverage_score == res2.semantic_coverage_score

    # Strict bounds
    for s in (res1.overall_content_score, res1.answer_readiness_score, res1.evidence_quality_score, res1.semantic_coverage_score):
        assert 0.0 <= s <= 1.0

    assert res1.content_status in ("optimal", "needs_improvement", "deficient")


def test_audit_resilience_on_malformed_and_extreme_inputs():
    """Verify that extreme, empty, and malformed inputs never raise unhandled exceptions."""
    extreme_inputs = [
        "",
        "   ",
        None,
        "<html><head><title>Unclosed",
        "<<<<>>>>////\\\\",
        "Binary text \x00\x01\x02\x03\x04\x05 null bytes",
        "<p>" + ("long word " * 2000) + "</p>",  # high volume
    ]

    for val in extreme_inputs:
        # Must not raise
        qc = run_content_quality_checks(raw_html=val, text_content=val)
        assert isinstance(qc.is_valid_content, bool)

        ci = analyze_content_intelligence(raw_html=val, text_content=val)
        assert 0.0 <= ci.overall_content_score <= 1.0
        assert ci.content_status in ("optimal", "needs_improvement", "deficient")


def test_audit_api_404_error_contract():
    """Verify consistent 404 responses for missing resources across Task 5 endpoints."""
    endpoints = [
        "/api/v1/pages/999999/content-structure",
        "/api/v1/pages/999999/topic-analysis",
        "/api/v1/pages/999999/entity-analysis",
        "/api/v1/pages/999999/question-analysis",
        "/api/v1/pages/999999/answer-analysis",
        "/api/v1/pages/999999/answer-readiness",
        "/api/v1/pages/999999/content-gaps",
        "/api/v1/pages/999999/quality-analysis",
        "/api/v1/pages/999999/intent-analysis",
        "/api/v1/pages/999999/semantic-coverage",
        "/api/v1/pages/999999/content-intelligence",
        "/api/v1/pages/999999/content-quality-checks",
        "/api/v1/scans/999999/content-intelligence",
    ]

    for ep in endpoints:
        res = client.get(ep)
        assert res.status_code == 404
        assert "not found" in res.json()["detail"].lower()

    # POST pipeline 404 check
    res_post = client.post("/api/v1/pages/999999/run-content-pipeline")
    assert res_post.status_code == 404
