from fastapi.testclient import TestClient
import pytest

from app.database import SessionLocal
from app.main import app
from app.models import Finding, PageExtraction, PageResult, Scan, Website
from app.services import run_full_page_content_pipeline

client = TestClient(app)


def test_content_intelligence_pipeline_service_and_api():
    db = SessionLocal()
    try:
        # Create test website and scan
        website1 = Website(name="Pipeline Test Site", url="https://pipeline-test.com")
        website2 = Website(name="Other Site", url="https://other-site.com")
        db.add_all([website1, website2])
        db.commit()
        db.refresh(website1)
        db.refresh(website2)

        scan1 = Scan(website_id=website1.id, status="completed")
        scan2 = Scan(website_id=website2.id, status="completed")
        db.add_all([scan1, scan2])
        db.commit()
        db.refresh(scan1)
        db.refresh(scan2)

        html_content = """
        <html>
        <head><title>Quantum Computing Fundamentals</title></head>
        <body>
            <h1>Introduction to Quantum Computing</h1>
            <p>Quantum computing utilizes quantum mechanical phenomena such as superposition and entanglement.</p>
            <h2>How does a qubit work?</h2>
            <p>A qubit works by representing a linear combination of states zero and one simultaneously with high coherence.</p>
            <h2>What are current quantum limits?</h2>
            <p>According to research published in 2024, superconducting circuits achieve 99.9% gate fidelity.</p>
        </body>
        </html>
        """

        page1 = PageResult(
            scan_id=scan1.id,
            url="https://pipeline-test.com/quantum",
            status_code=200,
            content=html_content,
        )
        db.add(page1)
        db.commit()
        db.refresh(page1)

        extraction1 = PageExtraction(
            page_result_id=page1.id,
            scan_id=scan1.id,
            title_text="Quantum Computing Fundamentals",
            h1_count=1,
        )
        db.add(extraction1)
        db.commit()
        db.refresh(extraction1)

        # 1. Direct Service Call
        svc_result = run_full_page_content_pipeline(db, page1.id, persist_all=False)
        assert svc_result["page_id"] == page1.id
        assert svc_result["url"] == page1.url
        assert svc_result["quality_checks"]["is_valid_content"] is True
        assert svc_result["content_intelligence"]["overall_content_score"] > 0.50
        assert svc_result["findings_persisted_count"] == 0

        # 2. API Endpoint Call with persist_all=True
        res = client.post(f"/api/v1/pages/{page1.id}/run-content-pipeline?persist_all=true")
        assert res.status_code == 200
        data = res.json()
        assert data["page_id"] == page1.id
        assert data["content_intelligence"]["overall_content_score"] > 0.0
        assert "structure" in data["content_intelligence"]["component_summaries"]

        # 3. Verify Isolation & Persistence
        findings1 = db.query(Finding).filter(Finding.scan_id == scan1.id).all()
        assert len(findings1) >= 1
        for f in findings1:
            assert f.website_id == website1.id
            assert f.page_id == page1.id

        # Website 2 and Scan 2 must have zero leaked findings
        findings2 = db.query(Finding).filter(Finding.scan_id == scan2.id).all()
        assert len(findings2) == 0

        # 4. 404 Handling
        res404 = client.post("/api/v1/pages/999999/run-content-pipeline")
        assert res404.status_code == 404
    finally:
        db.close()


def test_pipeline_on_empty_page_does_not_crash():
    db = SessionLocal()
    try:
        website = Website(name="Empty Page Site", url="https://empty-test.com")
        db.add(website)
        db.commit()
        db.refresh(website)

        scan = Scan(website_id=website.id, status="completed")
        db.add(scan)
        db.commit()
        db.refresh(scan)

        page_empty = PageResult(
            scan_id=scan.id,
            url="https://empty-test.com/empty",
            status_code=200,
            content="",
        )
        db.add(page_empty)
        db.commit()
        db.refresh(page_empty)

        # Pipeline execution on empty page should complete cleanly without unhandled exception
        result = run_full_page_content_pipeline(db, page_empty.id, persist_all=False)
        assert result["quality_checks"]["is_valid_content"] is False
        assert result["content_intelligence"]["overall_content_score"] < 0.60
    finally:
        db.close()
