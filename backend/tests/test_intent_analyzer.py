from fastapi.testclient import TestClient
import pytest

from app.database import SessionLocal
from app.intent_analyzer import (
    IntentAnalyzer,
    analyze_intent,
)
from app.main import app
from app.models import Finding, PageExtraction, PageResult, Scan, Website

client = TestClient(app)


def test_informational_intent():
    title = "Complete Guide: Understanding Solar Panel Physics"
    headings = [{"level": 1, "text": "Tutorial: How Solar Cells Generate Electricity"}]
    text = "In this comprehensive guide, we explain the core principles, steps, and basic definitions of photovoltaic power."

    evidence = analyze_intent(text_content=text, title=title, headings=headings)
    assert evidence.primary_intent == "informational"
    assert evidence.confidence >= 0.50
    assert len(evidence.supporting_evidence) >= 1


def test_transactional_intent():
    title = "Buy High Efficiency Solar Panels Online - Instant Pricing"
    headings = [{"level": 1, "text": "Order Solar Panels Now with Free Shipping"}]
    text = "Add to cart today to lock in your special discount coupon. Checkout securely and get started."

    evidence = analyze_intent(text_content=text, title=title, headings=headings)
    assert evidence.primary_intent == "transactional"
    assert evidence.has_commercial_call_to_action is True
    assert evidence.confidence >= 0.50


def test_commercial_investigation_intent():
    title = "Best Heat Pumps of 2025: In-Depth Comparison & Reviews"
    headings = [
        {"level": 1, "text": "Top 10 Heat Pumps Tested and Rated"},
        {"level": 2, "text": "Brand A vs Brand B: Pros and Cons"},
    ]
    text = "Our buyer's guide provides an objective review comparing energy efficiency ratings and warranty terms."

    evidence = analyze_intent(text_content=text, title=title, headings=headings)
    assert evidence.primary_intent == "commercial_investigation"
    assert evidence.confidence >= 0.50


def test_qa_intent():
    title = "Frequently Asked Questions About Residential Heat Pumps"
    headings = [
        {"level": 2, "text": "How do heat pumps work in winter?"},
        {"level": 2, "text": "Are heat pumps noisy?"},
        {"level": 2, "text": "What is the average installation cost?"},
        {"level": 2, "text": "How long do heat pump compressors last?"},
    ]
    text = "Answers to your most frequent questions regarding heat pump systems."

    evidence = analyze_intent(
        text_content=text,
        title=title,
        headings=headings,
        question_count=4,
        faq_schema_present=True,
    )
    assert evidence.primary_intent == "qa_intent"
    assert evidence.confidence >= 0.50


def test_conflicting_signals_informational_title_with_transactional_body():
    title = "Informational Guide to Energy Storage"
    headings = [
        {"level": 1, "text": "Pricing and Checkout"},
        {"level": 2, "text": "Buy Solar Battery Online"},
    ]
    text = "Add to cart now. Limited time discount coupon. Schedule demo and purchase subscription."

    evidence = analyze_intent(text_content=text, title=title, headings=headings)
    assert len(evidence.conflicting_signals) >= 1
    assert any(f["type"] == "intent_mismatch_informational_vs_transactional" for f in evidence.findings)


def test_empty_and_default_intent():
    evidence = analyze_intent()
    assert evidence.primary_intent == "informational"
    assert evidence.confidence == 0.0


def test_intent_analysis_api_persistence():
    db = SessionLocal()
    try:
        website = Website(name="Intent Site", url="https://intent-site.com")
        db.add(website)
        db.commit()
        db.refresh(website)

        scan = Scan(website_id=website.id, status="completed")
        db.add(scan)
        db.commit()
        db.refresh(scan)

        html = """
        <html>
        <head><title>Best Solar Inverters Review & Comparison</title></head>
        <body>
            <h1>Top Rated Solar Inverters vs Microinverters</h1>
            <p>Our buyer's guide review compares pros and cons of string inverters versus microinverters.</p>
        </body>
        </html>
        """
        page = PageResult(
            scan_id=scan.id,
            url="https://intent-site.com/comparison",
            status_code=200,
            content=html,
        )
        db.add(page)
        db.commit()
        db.refresh(page)

        extraction = PageExtraction(
            page_result_id=page.id,
            scan_id=scan.id,
            title_text="Best Solar Inverters Review & Comparison",
            h1_count=1,
        )
        db.add(extraction)
        db.commit()
        db.refresh(extraction)

        res = client.get(f"/api/v1/pages/{page.id}/intent-analysis?persist_findings=true")
        assert res.status_code == 200
        data = res.json()

        assert data["primary_intent"] == "commercial_investigation"
        assert data["confidence"] > 0.0

        persisted = db.query(Finding).filter(Finding.page_id == page.id).all()
        assert len(persisted) >= 1
        assert persisted[0].website_id == website.id

        # 404 test
        res404 = client.get("/api/v1/pages/999999/intent-analysis")
        assert res404.status_code == 404
    finally:
        db.close()
