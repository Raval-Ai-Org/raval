from fastapi.testclient import TestClient
import pytest

from app.database import SessionLocal
from app.main import app
from app.models import Finding, PageExtraction, PageResult, Scan, Website
from app.question_analyzer import (
    QuestionAnalyzer,
    analyze_questions,
    is_question_text,
)

client = TestClient(app)


def test_is_question_text_detection():
    assert is_question_text("What is artificial intelligence?") is True
    assert is_question_text("How do solar panels work?") is True
    assert is_question_text("Can solar energy power an entire home?") is True
    assert is_question_text("Why renewable energy matters") is True
    assert is_question_text("Standard statement about technology") is False
    assert is_question_text("") is False


def test_question_heading_with_answer():
    headings = [{"level": 2, "text": "How do solar panels generate electricity?"}]
    sections = [
        {
            "heading_text": "How do solar panels generate electricity?",
            "heading_level": 2,
            "word_count": 35,
            "is_empty": False,
            "is_thin": False,
            "has_lists": False,
        }
    ]
    evidence = analyze_questions(headings=headings, sections=sections)

    assert evidence.question_count == 1
    assert evidence.answered_question_count == 1
    assert evidence.unanswered_question_count == 0
    assert evidence.answer_readiness_score == 1.0

    q = evidence.questions[0]
    assert q["has_answer"] is True
    assert q["missing_answer_signal"] is False


def test_unanswered_question_heading():
    # Question heading followed by an empty or thin section (< 5 words)
    headings = [{"level": 2, "text": "What are the hidden maintenance costs?"}]
    sections = [
        {
            "heading_text": "What are the hidden maintenance costs?",
            "heading_level": 2,
            "word_count": 2,
            "is_empty": False,
            "is_thin": True,
            "has_lists": False,
        }
    ]
    evidence = analyze_questions(headings=headings, sections=sections)

    assert evidence.question_count == 1
    assert evidence.answered_question_count == 0
    assert evidence.unanswered_question_count == 1
    assert evidence.answer_readiness_score == 0.0

    q = evidence.questions[0]
    assert q["has_answer"] is False
    assert q["missing_answer_signal"] is True

    unanswered_finding = next((f for f in evidence.findings if f["type"] == "unanswered_question_heading"), None)
    assert unanswered_finding is not None
    assert unanswered_finding["severity"] == "medium"


def test_in_content_explicit_questions():
    text = (
        "Homeowners often wonder about efficiency. Is solar installation worth the cost? "
        "Residential solar systems typically pay for themselves within seven years through electric bill savings. "
        "Does winter weather affect panel output? Snow can temporarily reduce generation until cleared."
    )
    evidence = analyze_questions(text_content=text)

    assert evidence.question_count >= 2
    assert evidence.answered_question_count >= 2
    assert all(q["source_type"] == "body" for q in evidence.questions)


def test_faq_schema_detection():
    structured_data = [
        {
            "@context": "https://schema.org",
            "@type": "FAQPage",
            "mainEntity": [
                {
                    "@type": "Question",
                    "name": "How long do solar batteries last?",
                    "acceptedAnswer": {
                        "@type": "Answer",
                        "text": "Modern lithium-ion solar batteries generally last between 10 and 15 years with normal usage.",
                    },
                },
                {
                    "@type": "Question",
                    "name": "Do solar panels work on cloudy days?",
                    "acceptedAnswer": {
                        "@type": "Answer",
                        "text": "Yes, panels continue to generate electricity using indirect and diffused ambient daylight.",
                    },
                },
            ],
        }
    ]

    evidence = analyze_questions(structured_data_blocks=structured_data)

    assert evidence.faq_schema_present is True
    assert evidence.question_count == 2
    assert evidence.answered_question_count == 2
    assert all(q["source_type"] == "faq_schema" for q in evidence.questions)


def test_faq_schema_opportunity_finding():
    # If 3 or more questions exist without FAQ schema, an opportunity finding is generated
    text = (
        "What is heat pump efficiency? Heat pumps move heat rather than creating it directly. "
        "How much energy do heat pumps save? Typically 30 to 50 percent compared to baseboard electric. "
        "Where should outdoor heat pump units be installed? In clear, well-ventilated exterior spaces."
    )
    evidence = analyze_questions(text_content=text)

    assert evidence.question_count >= 3
    assert evidence.faq_schema_present is False
    opp = next((f for f in evidence.findings if f["type"] == "faq_schema_opportunity"), None)
    assert opp is not None
    assert opp["severity"] == "low"


def test_question_analysis_api_persistence():
    db = SessionLocal()
    try:
        website = Website(name="Q&A Site", url="https://qa-site.com")
        db.add(website)
        db.commit()
        db.refresh(website)

        scan = Scan(website_id=website.id, status="completed")
        db.add(scan)
        db.commit()
        db.refresh(scan)

        html = """
        <html>
        <head><title>Heat Pump FAQ Guide</title></head>
        <body>
            <h1>Heat Pump Information</h1>
            <h2>Why choose a heat pump system?</h2>
            <p>Heat pumps offer dual heating and cooling in a single high efficiency unit.</p>
            <h2>What is the installation timeframe?</h2>
        </body>
        </html>
        """
        page = PageResult(
            scan_id=scan.id,
            url="https://qa-site.com/faq",
            status_code=200,
            content=html,
        )
        db.add(page)
        db.commit()
        db.refresh(page)

        extraction = PageExtraction(
            page_result_id=page.id,
            scan_id=scan.id,
            title_text="Heat Pump FAQ Guide",
            h1_count=1,
        )
        db.add(extraction)
        db.commit()
        db.refresh(extraction)

        # Call API with persist_findings=true
        res = client.get(f"/api/v1/pages/{page.id}/question-analysis?persist_findings=true")
        assert res.status_code == 200
        data = res.json()

        assert data["question_count"] >= 1
        persisted_findings = db.query(Finding).filter(Finding.page_id == page.id).all()
        assert len(persisted_findings) >= 1
        assert persisted_findings[0].website_id == website.id

        # 404 test
        res404 = client.get("/api/v1/pages/999999/question-analysis")
        assert res404.status_code == 404
    finally:
        db.close()
