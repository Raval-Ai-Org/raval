from fastapi.testclient import TestClient
import pytest

from app.content_gap_analyzer import (
    ContentGapAnalyzer,
    analyze_content_gaps,
)
from app.database import SessionLocal
from app.main import app
from app.models import Finding, PageExtraction, PageResult, Recommendation, Scan, Website

client = TestClient(app)


def test_unanswered_question_gap_detection():
    answer_evidence = {
        "answers": [
            {
                "question_text": "What is the expected solar battery lifespan?",
                "question_source": "heading",
                "has_answer": False,
                "reason": "Section following heading is empty.",
            }
        ]
    }

    gaps = analyze_content_gaps(answer_evidence=answer_evidence)

    assert gaps.total_gaps == 1
    assert gaps.unanswered_question_gaps_count == 1
    gap = gaps.gaps[0]
    assert gap["gap_type"] == "unanswered_question"
    assert "lifespan" in gap["missing_element"]
    assert gap["severity"] == "medium"
    assert "recommended_action" in gap


def test_structural_and_topical_gaps():
    content_structure = {
        "empty_sections": [{"heading_text": "Pricing and Costs", "heading_level": 2}],
        "thin_sections": [{"heading_text": "Customer Reviews", "word_count": 3}],
    }
    topic_semantics = {
        "primary_topic": "heat pump installation",
        "primary_topic_in_h1": False,
        "semantic_depth": "thin",
        "total_words": 30,
    }

    gaps = analyze_content_gaps(
        content_structure=content_structure,
        topic_semantics=topic_semantics,
    )

    assert gaps.structural_gaps_count == 2
    assert gaps.topical_gaps_count >= 1

    gap_types = [g["gap_type"] for g in gaps.gaps]
    assert "empty_section" in gap_types
    assert "thin_section" in gap_types
    assert "topic_coverage" in gap_types


def test_entity_context_and_schema_gaps():
    entity_evidence = {
        "entity_count": 1,
        "has_organization_entity": True,
        "entities": [{"name": "Solaria Corp", "entity_type": "organization", "same_as": []}],
    }
    question_evidence = {
        "question_count": 4,
        "faq_schema_present": False,
    }

    gaps = analyze_content_gaps(
        entity_evidence=entity_evidence,
        question_evidence=question_evidence,
    )

    assert gaps.entity_gaps_count == 1
    assert gaps.schema_gaps_count == 1

    same_as_gap = next((g for g in gaps.gaps if g["gap_type"] == "entity_context"), None)
    assert same_as_gap is not None
    assert "sameas" in same_as_gap["missing_element"].lower()

    schema_gap = next((g for g in gaps.gaps if g["gap_type"] == "schema_opportunity"), None)
    assert schema_gap is not None
    assert "faqpage" in schema_gap["missing_element"].lower()


def test_duplicate_gap_prevention():
    # Feeding identical question twice should deduplicate
    answer_evidence = {
        "answers": [
            {"question_text": "How much does it cost?", "has_answer": False},
            {"question_text": "How much does it cost?", "has_answer": False},
        ]
    }
    gaps = analyze_content_gaps(answer_evidence=answer_evidence)
    assert gaps.total_gaps == 1


def test_content_gaps_api_persistence_and_recommendations():
    db = SessionLocal()
    try:
        website = Website(name="Gap Test Site", url="https://gap-test.com")
        db.add(website)
        db.commit()
        db.refresh(website)

        scan = Scan(website_id=website.id, status="completed")
        db.add(scan)
        db.commit()
        db.refresh(scan)

        html = """
        <html>
        <head><title>Solar Panel Buying Guide</title></head>
        <body>
            <h1>Solar Panels</h1>
            <h2>How much do solar panels cost?</h2>
            <h2>What are the financing options?</h2>
        </body>
        </html>
        """
        page = PageResult(
            scan_id=scan.id,
            url="https://gap-test.com/buying-guide",
            status_code=200,
            content=html,
        )
        db.add(page)
        db.commit()
        db.refresh(page)

        extraction = PageExtraction(
            page_result_id=page.id,
            scan_id=scan.id,
            title_text="Solar Panel Buying Guide",
            h1_count=1,
        )
        db.add(extraction)
        db.commit()
        db.refresh(extraction)

        # Call API with persist_findings=true and persist_recommendations=true
        res = client.get(f"/api/v1/pages/{page.id}/content-gaps?persist_findings=true&persist_recommendations=true")
        assert res.status_code == 200
        data = res.json()

        assert data["total_gaps"] >= 1
        persisted_findings = db.query(Finding).filter(Finding.page_id == page.id).all()
        assert len(persisted_findings) >= 1
        assert persisted_findings[0].website_id == website.id

        # Verify recommendation created and linked to finding
        persisted_recs = db.query(Recommendation).filter(Recommendation.finding_id == persisted_findings[0].id).all()
        assert len(persisted_recs) >= 1
        assert persisted_recs[0].action_type == "content_update"

        # 404 test
        res404 = client.get("/api/v1/pages/999999/content-gaps")
        assert res404.status_code == 404
    finally:
        db.close()
