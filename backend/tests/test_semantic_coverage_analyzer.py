from fastapi.testclient import TestClient
import pytest

from app.database import SessionLocal
from app.main import app
from app.models import Finding, PageExtraction, PageResult, Scan, Website
from app.semantic_coverage_analyzer import (
    SemanticCoverageAnalyzer,
    analyze_semantic_coverage,
)

client = TestClient(app)


def test_high_semantic_coverage():
    topic_evidence = {
        "primary_topic": "heat pumps",
        "supporting_topics": ["energy efficiency", "ground source", "air source"],
        "semantic_depth": "deep",
    }
    entity_evidence = {
        "entity_count": 2,
        "has_organization_entity": True,
        "entity_consistency_valid": True,
        "entities": [{"name": "Carrier Global", "entity_type": "organization"}],
    }
    question_evidence = {
        "question_count": 3,
        "answered_question_count": 3,
    }
    answer_evidence = {
        "total_questions": 3,
        "answered_questions": 3,
    }
    content_structure = {
        "section_count": 4,
        "has_h1": True,
        "empty_sections": [],
        "thin_sections": [],
    }

    evidence = analyze_semantic_coverage(
        topic_evidence=topic_evidence,
        entity_evidence=entity_evidence,
        question_evidence=question_evidence,
        answer_evidence=answer_evidence,
        content_structure=content_structure,
    )

    assert evidence.semantic_coverage_score >= 0.75
    assert evidence.breadth_level == "comprehensive"
    assert len(evidence.covered_concepts) >= 4
    assert len(evidence.missing_concepts) == 0
    assert any(f["type"] == "comprehensive_semantic_coverage" for f in evidence.findings)


def test_low_semantic_coverage_due_to_missing_concepts():
    topic_evidence = {
        "primary_topic": None,
        "supporting_topics": [],
        "semantic_depth": "thin",
    }
    entity_evidence = {
        "entity_count": 0,
        "has_organization_entity": False,
    }
    question_evidence = {
        "question_count": 5,
        "answered_question_count": 0,
    }
    answer_evidence = {
        "total_questions": 5,
        "answered_questions": 0,
    }
    content_structure = {
        "section_count": 0,
        "has_h1": False,
        "empty_sections": [{"heading_text": "Overview"}],
        "thin_sections": [],
    }

    evidence = analyze_semantic_coverage(
        topic_evidence=topic_evidence,
        entity_evidence=entity_evidence,
        question_evidence=question_evidence,
        answer_evidence=answer_evidence,
        content_structure=content_structure,
    )

    assert evidence.semantic_coverage_score < 0.45
    assert evidence.breadth_level == "narrow"
    assert len(evidence.missing_concepts) >= 2
    assert any(f["type"] == "narrow_semantic_coverage" for f in evidence.findings)


def test_empty_and_default_semantic_coverage():
    evidence = analyze_semantic_coverage()
    assert evidence.semantic_coverage_score > 0.0
    assert "topic_concept_score" in evidence.component_scores
    assert "question_coverage_score" in evidence.component_scores


def test_semantic_coverage_api_persistence():
    db = SessionLocal()
    try:
        website = Website(name="Coverage Site", url="https://coverage-site.com")
        db.add(website)
        db.commit()
        db.refresh(website)

        scan = Scan(website_id=website.id, status="completed")
        db.add(scan)
        db.commit()
        db.refresh(scan)

        html = """
        <html>
        <head><title>Commercial Solar Architecture Guide</title></head>
        <body>
            <h1>Commercial Solar Architecture</h1>
            <p>Commercial solar systems require photovoltaic inverters and power optimizers for optimal energy distribution.</p>
            <h2>How do commercial inverters work?</h2>
            <p>Commercial inverters convert direct current power from solar arrays into alternating current for grid synchronization.</p>
        </body>
        </html>
        """
        page = PageResult(
            scan_id=scan.id,
            url="https://coverage-site.com/architecture",
            status_code=200,
            content=html,
        )
        db.add(page)
        db.commit()
        db.refresh(page)

        extraction = PageExtraction(
            page_result_id=page.id,
            scan_id=scan.id,
            title_text="Commercial Solar Architecture Guide",
            h1_count=1,
        )
        db.add(extraction)
        db.commit()
        db.refresh(extraction)

        res = client.get(f"/api/v1/pages/{page.id}/semantic-coverage?persist_findings=true")
        assert res.status_code == 200
        data = res.json()

        assert "semantic_coverage_score" in data
        assert data["breadth_level"] in ("comprehensive", "moderate", "narrow")

        persisted = db.query(Finding).filter(Finding.page_id == page.id).all()
        assert len(persisted) >= 1
        assert persisted[0].website_id == website.id

        # 404 test
        res404 = client.get("/api/v1/pages/999999/semantic-coverage")
        assert res404.status_code == 404
    finally:
        db.close()
