from fastapi.testclient import TestClient
import pytest

from app.answer_analyzer import (
    AnswerAnalyzer,
    analyze_answers,
    evaluate_answer_directness,
)
from app.database import SessionLocal
from app.main import app
from app.models import Finding, PageExtraction, PageResult, Scan, Website

client = TestClient(app)


def test_evaluate_answer_directness():
    # Direct answers
    dir1, score1 = evaluate_answer_directness("Yes, solar panels work on cloudy days.")
    assert dir1 == "direct"
    assert score1 >= 0.9

    dir2, score2 = evaluate_answer_directness("Solar energy is defined as electromagnetic radiation emitted by the sun.")
    assert dir2 == "direct"
    assert score2 >= 0.9

    # Indirect narrative
    indir, score3 = evaluate_answer_directness(
        "Throughout the history of renewable energy technology development, researchers have studied many atmospheric phenomena across diverse geographic locations worldwide."
    )
    assert indir == "indirect"
    assert score3 <= 0.6

    # Empty
    none_dir, score4 = evaluate_answer_directness("")
    assert none_dir == "none"
    assert score4 == 0.0


def test_question_with_clear_direct_answer():
    headings = [{"level": 2, "text": "How do solar panels work?"}]
    sections = [
        {
            "heading_text": "How do solar panels work?",
            "heading_level": 2,
            "word_count": 32,
            "is_empty": False,
            "is_thin": False,
            "has_lists": False,
            "paragraphs": [
                "Photovoltaic solar panels work by absorbing photons from sunlight and exciting electrons to generate direct current electricity."
            ],
        }
    ]

    evidence = analyze_answers(headings=headings, sections=sections)

    assert evidence.total_questions == 1
    assert evidence.answered_questions == 1
    assert evidence.unanswered_questions == 0
    assert evidence.direct_answers_count == 1
    assert evidence.overall_answer_rate == 1.0

    ans = evidence.answers[0]
    assert ans["has_answer"] is True
    assert ans["answer_presence"] == "confirmed"
    assert ans["directness"] == "direct"
    assert ans["answer_location"] == "adjacent_section"
    assert ans["snippet_optimal_length"] is True
    assert any(f["type"] == "snippet_optimized_answer" for f in evidence.findings)


def test_question_without_answer():
    headings = [{"level": 2, "text": "What are the common solar battery warranty exclusions?"}]
    sections = [
        {
            "heading_text": "What are the common solar battery warranty exclusions?",
            "heading_level": 2,
            "word_count": 2,
            "is_empty": False,
            "is_thin": True,
            "has_lists": False,
            "paragraphs": ["See below."],
        }
    ]

    evidence = analyze_answers(headings=headings, sections=sections)

    assert evidence.total_questions == 1
    assert evidence.answered_questions == 0
    assert evidence.unanswered_questions == 1

    ans = evidence.answers[0]
    assert ans["has_answer"] is False
    assert ans["answer_presence"] == "absent"
    assert any(f["type"] == "unanswered_question_detected" for f in evidence.findings)


def test_multiple_questions_mixed_status():
    headings = [
        {"level": 2, "text": "Why choose geothermal heat pumps?"},
        {"level": 2, "text": "How much does a geothermal system cost?"},
    ]
    sections = [
        {
            "heading_text": "Why choose geothermal heat pumps?",
            "heading_level": 2,
            "word_count": 28,
            "is_empty": False,
            "is_thin": False,
            "paragraphs": ["Geothermal systems provide steady heating efficiency by tapping constant underground ground temperatures year-round."],
        },
        {
            "heading_text": "How much does a geothermal system cost?",
            "heading_level": 2,
            "word_count": 0,
            "is_empty": True,
            "paragraphs": [],
        },
    ]

    evidence = analyze_answers(headings=headings, sections=sections)

    assert evidence.total_questions == 2
    assert evidence.answered_questions == 1
    assert evidence.unanswered_questions == 1
    assert evidence.overall_answer_rate == 0.5


def test_empty_and_edge_case_content():
    evidence = analyze_answers(text_content="", headings=[], sections=[])
    assert evidence.total_questions == 0
    assert evidence.answered_questions == 0
    assert evidence.overall_answer_rate == 0.0


def test_answer_analysis_api_persistence():
    db = SessionLocal()
    try:
        website = Website(name="Answer API Site", url="https://answer-api.com")
        db.add(website)
        db.commit()
        db.refresh(website)

        scan = Scan(website_id=website.id, status="completed")
        db.add(scan)
        db.commit()
        db.refresh(scan)

        html = """
        <html>
        <head><title>Heat Pump Efficiency FAQ</title></head>
        <body>
            <h1>Heat Pump Efficiency</h1>
            <h2>Is a heat pump worth it?</h2>
            <p>Yes, heat pumps typically reduce annual home heating costs by up to 50 percent.</p>
            <h2>What happens during freezing temperatures?</h2>
        </body>
        </html>
        """
        page = PageResult(
            scan_id=scan.id,
            url="https://answer-api.com/faq",
            status_code=200,
            content=html,
        )
        db.add(page)
        db.commit()
        db.refresh(page)

        extraction = PageExtraction(
            page_result_id=page.id,
            scan_id=scan.id,
            title_text="Heat Pump Efficiency FAQ",
            h1_count=1,
        )
        db.add(extraction)
        db.commit()
        db.refresh(extraction)

        # Call API with persist_findings=true
        res = client.get(f"/api/v1/pages/{page.id}/answer-analysis?persist_findings=true")
        assert res.status_code == 200
        data = res.json()

        assert data["total_questions"] >= 1
        persisted_findings = db.query(Finding).filter(Finding.page_id == page.id).all()
        assert len(persisted_findings) >= 1
        assert persisted_findings[0].website_id == website.id

        # 404 test
        res404 = client.get("/api/v1/pages/999999/answer-analysis")
        assert res404.status_code == 404
    finally:
        db.close()
