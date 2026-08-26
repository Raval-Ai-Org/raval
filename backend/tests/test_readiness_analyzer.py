from fastapi.testclient import TestClient
import pytest

from app.database import SessionLocal
from app.main import app
from app.models import Finding, PageExtraction, PageResult, Scan, Website
from app.readiness_analyzer import (
    ReadinessAnalyzer,
    analyze_readiness,
)

client = TestClient(app)


def test_high_readiness_content():
    content_structure = {
        "heading_hierarchy_valid": True,
        "has_h1": True,
        "list_present": True,
        "thin_sections": [],
        "empty_sections": [],
    }
    topic_semantics = {
        "primary_topic": "solar panels",
        "primary_topic_in_title": True,
        "primary_topic_in_h1": True,
        "semantic_depth": "deep",
    }
    entity_evidence = {
        "entity_count": 2,
        "has_organization_entity": True,
        "entity_consistency_valid": True,
    }
    question_evidence = {
        "question_count": 3,
        "answered_question_count": 3,
        "faq_schema_present": True,
    }
    answer_evidence = {
        "total_questions": 3,
        "answered_questions": 3,
        "direct_answers_count": 3,
    }

    readiness = analyze_readiness(
        content_structure=content_structure,
        topic_semantics=topic_semantics,
        entity_evidence=entity_evidence,
        question_evidence=question_evidence,
        answer_evidence=answer_evidence,
    )

    assert readiness.readiness_score >= 0.75
    assert readiness.readiness_level == "high"
    assert len(readiness.positive_signals) >= 4
    assert len(readiness.negative_signals) == 0
    assert any(f["type"] == "high_answer_readiness" for f in readiness.findings)


def test_low_readiness_content_due_to_unanswered_questions():
    content_structure = {
        "heading_hierarchy_valid": False,
        "has_h1": False,
        "list_present": False,
        "thin_sections": [{"heading": "Cost"}],
        "empty_sections": [{"heading": "Specs"}],
    }
    topic_semantics = {
        "primary_topic": "crypto",
        "primary_topic_in_title": False,
        "primary_topic_in_h1": False,
        "semantic_depth": "thin",
    }
    entity_evidence = {
        "entity_count": 0,
        "has_organization_entity": False,
        "entity_consistency_valid": False,
    }
    question_evidence = {
        "question_count": 4,
        "answered_question_count": 0,
        "faq_schema_present": False,
    }
    answer_evidence = {
        "total_questions": 4,
        "answered_questions": 0,
        "direct_answers_count": 0,
    }

    readiness = analyze_readiness(
        content_structure=content_structure,
        topic_semantics=topic_semantics,
        entity_evidence=entity_evidence,
        question_evidence=question_evidence,
        answer_evidence=answer_evidence,
    )

    assert readiness.readiness_score < 0.45
    assert readiness.readiness_level == "low"
    assert len(readiness.negative_signals) >= 4
    assert any(f["type"] == "low_answer_readiness" for f in readiness.findings)


def test_empty_and_default_readiness():
    readiness = analyze_readiness()
    assert readiness.readiness_score > 0.0
    assert "qa_readiness" in readiness.component_scores
    assert "structural_clarity" in readiness.component_scores


def test_answer_readiness_api_persistence():
    db = SessionLocal()
    try:
        website = Website(name="Readiness Site", url="https://readiness-site.com")
        db.add(website)
        db.commit()
        db.refresh(website)

        scan = Scan(website_id=website.id, status="completed")
        db.add(scan)
        db.commit()
        db.refresh(scan)

        html = """
        <html>
        <head><title>Electric Vehicle Charging Guide | AutoEco</title></head>
        <body>
            <h1>Electric Vehicle Charging Guide</h1>
            <p>Electric vehicle charging is categorized into Level 1, Level 2, and DC Fast charging systems.</p>
            <h2>How long does it take to charge an electric car?</h2>
            <p>Typically, a Level 2 home charger charges an electric car battery from empty in 4 to 8 hours.</p>
            <ul>
                <li>Level 1: 120V household outlet</li>
                <li>Level 2: 240V dedicated circuit</li>
                <li>DC Fast: Commercial rapid charging</li>
            </ul>
        </body>
        </html>
        """
        page = PageResult(
            scan_id=scan.id,
            url="https://readiness-site.com/ev-guide",
            status_code=200,
            content=html,
        )
        db.add(page)
        db.commit()
        db.refresh(page)

        extraction = PageExtraction(
            page_result_id=page.id,
            scan_id=scan.id,
            title_text="Electric Vehicle Charging Guide | AutoEco",
            h1_count=1,
        )
        db.add(extraction)
        db.commit()
        db.refresh(extraction)

        # Call API with persist_findings=true
        res = client.get(f"/api/v1/pages/{page.id}/answer-readiness?persist_findings=true")
        assert res.status_code == 200
        data = res.json()

        assert "readiness_score" in data
        assert data["readiness_level"] in ("high", "moderate", "low")
        assert len(data["positive_signals"]) > 0

        persisted_findings = db.query(Finding).filter(Finding.page_id == page.id).all()
        assert len(persisted_findings) >= 1
        assert persisted_findings[0].website_id == website.id

        # 404 test
        res404 = client.get("/api/v1/pages/999999/answer-readiness")
        assert res404.status_code == 404
    finally:
        db.close()
