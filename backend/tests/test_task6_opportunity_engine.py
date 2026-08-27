"""
Task 6.8 Opportunity Engine Comprehensive Tests
Verifies opportunity derivation from page intelligence, entity signals,
AI run citations, bounded scoring, and query filters.
"""

from fastapi.testclient import TestClient
import pytest
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.main import app
from app.models import AIRun, AIResult, Entity, Finding, Opportunity, PageResult, Question, QuestionSet, Scan, Website
from app.opportunity_service import (
    generate_opportunity_from_ai_run,
    generate_opportunity_from_finding,
    generate_opportunity_from_page_intelligence,
    list_opportunities,
)

client = TestClient(app)


def _setup_website_and_scan(db: Session, prefix: str = "Opp68"):
    website = Website(name=f"{prefix} Site", url=f"https://{prefix.lower()}.com")
    db.add(website)
    db.commit()
    db.refresh(website)

    scan = Scan(website_id=website.id, status="completed", pages_crawled=1)
    db.add(scan)
    db.commit()
    db.refresh(scan)

    page = PageResult(
        scan_id=scan.id,
        url=f"https://{prefix.lower()}.com/about",
        status_code=200,
        content_type="text/html",
    )
    db.add(page)
    db.commit()
    db.refresh(page)

    return website, scan, page


def test_generate_opportunity_from_page_intelligence():
    db = SessionLocal()
    try:
        website, scan, page = _setup_website_and_scan(db, "PageIntel")

        # Add entity lacking sameAs
        entity = Entity(
            website_id=website.id,
            page_id=page.id,
            name="Global AI Authority",
            entity_type="organization",
            description="Leading AI research institute",
            confidence=0.9,
            same_as=[],
        )
        db.add(entity)

        # Add finding
        finding = Finding(
            scan_id=scan.id,
            page_id=page.id,
            website_id=website.id,
            finding_type="missing_meta_description",
            category="seo",
            title="Missing Meta Description",
            description="Page is missing a meta description",
            severity="medium",
            status="open",
        )
        db.add(finding)
        db.commit()

        opps = generate_opportunity_from_page_intelligence(db, page.id)
        assert len(opps) >= 2
        types = {o.opportunity_type for o in opps}
        assert "entity_authority_enhancement" in types
        assert "meta_description_optimization" in types

        for o in opps:
            assert 0.0 <= o.priority_score <= 1.0
            assert o.priority in {"CRITICAL", "HIGH", "MEDIUM", "LOW"}
            assert o.website_id == website.id
    finally:
        db.close()


def test_generate_opportunity_from_ai_run():
    db = SessionLocal()
    try:
        website, scan, page = _setup_website_and_scan(db, "AIRunOpp")

        q_set = QuestionSet(website_id=website.id, name="Core Queries")
        db.add(q_set)
        db.commit()

        question = Question(
            question_set_id=q_set.id,
            text="What is GEO intelligence?",
            intent="informational",
            topic="geo_overview",
        )
        db.add(question)
        db.commit()

        ai_run = AIRun(
            website_id=website.id,
            question_id=question.id,
            provider="perplexity",
            model="sonar-medium",
            status="completed",
        )
        db.add(ai_run)
        db.commit()

        ai_result = AIResult(
            ai_run_id=ai_run.id,
            answer="GEO intelligence is the optimization of content for generative engines.",
            mentions_brand=True,
        )
        db.add(ai_result)
        db.commit()

        # Zero citations initially -> high impact opportunity
        opp = generate_opportunity_from_ai_run(db, ai_run.id)
        assert opp.category == "geo"
        assert "Perplexity" in opp.title
        assert opp.impact == 0.90
        assert 0.0 <= opp.priority_score <= 1.0

        # Repeated generation is idempotent
        opp_repeated = generate_opportunity_from_ai_run(db, ai_run.id)
        assert opp_repeated.id == opp.id
    finally:
        db.close()


def test_opportunity_query_filters_and_pagination():
    db = SessionLocal()
    try:
        website, scan, page = _setup_website_and_scan(db, "FilterOpp")

        for i in range(5):
            opp = Opportunity(
                website_id=website.id,
                scan_id=scan.id,
                title=f"Opp {i}",
                description=f"Description {i}",
                opportunity_type="technical_seo" if i % 2 == 0 else "content",
                category="technical_seo" if i % 2 == 0 else "content",
                impact=0.8,
                effort=0.2,
                confidence=0.9,
                priority_score=0.85,
                priority="HIGH",
                rationale=f"Deterministic prioritization rationale for opp {i}",
                status="identified",
            )
            db.add(opp)
        db.commit()

        results_all = list_opportunities(db, website_id=website.id)
        assert len(results_all) == 5

        tech_results = list_opportunities(db, website_id=website.id, category="technical_seo")
        assert len(tech_results) == 3

        paged_results = list_opportunities(db, website_id=website.id, limit=2, offset=0)
        assert len(paged_results) == 2
    finally:
        db.close()


def test_opportunity_api_endpoints_task6_8():
    db = SessionLocal()
    try:
        website, scan, page = _setup_website_and_scan(db, "APIOpp68")

        finding = Finding(
            scan_id=scan.id,
            page_id=page.id,
            website_id=website.id,
            finding_type="missing_h1",
            category="content",
            title="Missing H1",
            description="Page lacks an H1 heading",
            severity="high",
            status="open",
        )
        db.add(finding)
        db.commit()

        # Test POST /api/v1/pages/{page_id}/generate-opportunities
        res = client.post(f"/api/v1/pages/{page.id}/generate-opportunities")
        assert res.status_code == 200
        data = res.json()
        assert isinstance(data, list)
        assert len(data) >= 1

        # Test 404 for invalid page
        res_404 = client.post("/api/v1/pages/999999/generate-opportunities")
        assert res_404.status_code == 404
    finally:
        db.close()
