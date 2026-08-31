"""
Unit and Integration Tests for Site-Level Aggregation & APIs (Task 8 - Step 8.8)
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.main import app
from app.models import Finding, PageResult, Scan, Website
from app.priority_engine import PrioritizedRecommendation
from app.score_explanation import PageScoreAnalytics
from app.site_aggregator import (
    SiteAggregator,
    SiteCategorySummary,
    SiteScoreSummary,
    TopSiteIssue,
    aggregate_site_scores,
)


@pytest.fixture
def db_session():
    """Isolated SQLite in-memory database fixture for API and database tests."""
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()
        Base.metadata.drop_all(bind=engine)


@pytest.fixture
def client(db_session):
    """TestClient with overridden get_db dependency."""
    def override_get_db():
        try:
            yield db_session
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


class TestSiteAggregationUnit:
    """Unit tests for SiteAggregator logic and edge cases."""

    def test_zero_pages_safe_boundary(self):
        aggregator = SiteAggregator()
        summary = aggregator.aggregate_site_pages(pages_analytics=[], website_id=1, scan_id=1)

        assert isinstance(summary, SiteScoreSummary)
        assert summary.website_id == 1
        assert summary.overall_site_score == 100.0
        assert summary.site_status == "optimal"
        assert summary.total_pages_analyzed == 0
        assert len(summary.top_issues) == 0

    def test_single_page_aggregation(self):
        aggregator = SiteAggregator()
        page1 = PageScoreAnalytics(
            page_id=1,
            url="https://example.com/",
            scan_id=1,
            website_id=1,
            overall_score=85.0,
            status="optimal",
            category_scores={
                "trust_transparency": 90.0,
                "authority_citations": 80.0,
                "content_quality": 85.0,
                "content_structure": 90.0,
                "semantic_readiness": 80.0,
            },
            finding_counts={"trust_transparency": 1},
            priority_counts={"medium": 1},
            recommendation_counts={"total": 1, "quick_wins": 1, "deep_fixes": 0},
            applicability_counts={"pass": 4, "fail": 1, "warning": 0, "na": 0, "unknown": 0},
            total_points_deducted=15.0,
            timestamp="2026-08-31T00:00:00Z",
        )

        recs = [
            PrioritizedRecommendation(
                recommendation_id="rec_1",
                rule_id="trust_byline_present",
                category="trust_transparency",
                priority="medium",
                classification="quick_win",
                title="Add Byline",
                explanation="Missing byline",
                recommended_action="Add byline to header",
                score_impact=10.0,
            )
        ]

        summary = aggregator.aggregate_site_pages([page1], website_id=1, scan_id=1, all_recommendations=recs)

        assert summary.total_pages_analyzed == 1
        assert summary.overall_site_score == 84.75  # Weighted sum: 90*0.2 + 80*0.25 + 85*0.25 + 90*0.15 + 80*0.15 = 18 + 20 + 21.25 + 13.5 + 12 = 84.75
        assert len(summary.top_issues) == 1
        assert summary.top_issues[0].rule_id == "trust_byline_present"
        assert summary.top_issues[0].affected_pages_count == 1

    def test_multi_page_aggregation_and_top_issues(self):
        aggregator = SiteAggregator()

        page1 = PageScoreAnalytics(
            page_id=1,
            url="https://example.com/p1",
            overall_score=80.0,
            status="optimal",
            category_scores={"content_structure": 70.0, "trust_transparency": 90.0},
            finding_counts={"content_structure": 1},
            priority_counts={"high": 1},
            recommendation_counts={"total": 1, "quick_wins": 1, "deep_fixes": 0},
            applicability_counts={"pass": 5, "fail": 1, "warning": 0, "na": 0, "unknown": 0},
            total_points_deducted=20.0,
            timestamp="2026-08-31T00:00:00Z",
        )

        page2 = PageScoreAnalytics(
            page_id=2,
            url="https://example.com/p2",
            overall_score=60.0,
            status="needs_improvement",
            category_scores={"content_structure": 70.0, "trust_transparency": 50.0},
            finding_counts={"content_structure": 1, "trust_transparency": 1},
            priority_counts={"high": 2},
            recommendation_counts={"total": 2, "quick_wins": 1, "deep_fixes": 1},
            applicability_counts={"pass": 3, "fail": 2, "warning": 0, "na": 0, "unknown": 0},
            total_points_deducted=40.0,
            timestamp="2026-08-31T00:00:00Z",
        )

        recs = [
            PrioritizedRecommendation(
                recommendation_id="rec_p1_h1",
                rule_id="r-str-01",
                category="content_structure",
                priority="high",
                classification="quick_win",
                title="Add H1 Heading",
                explanation="No H1 tag",
                recommended_action="Add H1",
                score_impact=15.0,
            ),
            PrioritizedRecommendation(
                recommendation_id="rec_p2_h1",
                rule_id="r-str-01",
                category="content_structure",
                priority="high",
                classification="quick_win",
                title="Add H1 Heading",
                explanation="No H1 tag",
                recommended_action="Add H1",
                score_impact=15.0,
            ),
            PrioritizedRecommendation(
                recommendation_id="rec_p2_trust",
                rule_id="trust_contact_info_present",
                category="trust_transparency",
                priority="high",
                classification="deep_fix",
                title="Add Contact Details",
                explanation="No contact info",
                recommended_action="Add contact footer",
                score_impact=20.0,
            ),
        ]

        summary = aggregator.aggregate_site_pages([page1, page2], website_id=1, scan_id=1, all_recommendations=recs)

        assert summary.total_pages_analyzed == 2
        assert len(summary.top_issues) == 2

        # r-str-01 affected 2 pages with 30.0 cumulative score impact -> Top Issue #1
        top_issue = summary.top_issues[0]
        assert top_issue.rule_id == "r-str-01"
        assert top_issue.affected_pages_count == 2
        assert top_issue.total_score_impact == 30.0

    def test_historical_comparison(self):
        aggregator = SiteAggregator()

        # Previous Scan
        prev_summary = SiteScoreSummary(
            website_id=1,
            scan_id=1,
            timestamp="2026-08-01T00:00:00Z",
            overall_site_score=65.0,
            site_status="adequate",
            category_summaries={},
            total_pages_analyzed=1,
            top_issues=[
                TopSiteIssue(
                    rule_id="old_issue",
                    category="trust_transparency",
                    title="Old Issue",
                    affected_pages_count=1,
                    total_score_impact=15.0,
                    priority="high",
                    classification="quick_win",
                    recommended_action="Fix old issue",
                )
            ],
        )

        # Current Scan (Improved score to 85.0, resolved old_issue)
        current_pages = [
            PageScoreAnalytics(
                page_id=1,
                url="https://example.com/",
                overall_score=85.0,
                status="optimal",
                category_scores={"trust_transparency": 85.0},
                total_points_deducted=15.0,
                timestamp="2026-08-31T00:00:00Z",
            )
        ]

        summary = aggregator.aggregate_site_pages(
            current_pages,
            website_id=1,
            scan_id=2,
            previous_summary=prev_summary,
        )

        assert summary.historical_comparison is not None
        assert summary.historical_comparison["previous_site_score"] == 65.0
        assert summary.historical_comparison["score_delta"] > 0
        assert summary.historical_comparison["score_improved"] is True
        assert summary.historical_comparison["resolved_issues_count"] == 1


class TestSiteAndScoreAPIs:
    """Integration tests for FastAPI score, explanation, recommendation, and history endpoints."""

    def test_page_score_and_recommendation_endpoints(self, client, db_session):
        # 1. Seed Website, Scan, PageResult, Finding
        website = Website(name="Test Corp", url="https://testcorp.com")
        db_session.add(website)
        db_session.commit()

        scan = Scan(website_id=website.id, status="completed")
        db_session.add(scan)
        db_session.commit()

        page = PageResult(
            scan_id=scan.id,
            url="https://testcorp.com/guide",
            content="<html><body><p>Article body</p></body></html>",
        )
        db_session.add(page)
        db_session.commit()

        finding = Finding(
            website_id=website.id,
            scan_id=scan.id,
            page_id=page.id,
            finding_type="missing_h1",
            category="content",
            title="Missing H1 Heading",
            description="No H1 heading found",
            severity="high",
            evidence={"headings": []},
            status="open",
        )
        db_session.add(finding)
        db_session.commit()

        # 2. Test GET /api/v1/scores/pages/{page_id}
        res_score = client.get(f"/api/v1/scores/pages/{page.id}")
        assert res_score.status_code == 200
        score_data = res_score.json()
        assert "overall_score" in score_data
        assert "category_explanations" in score_data
        assert "deductions" in score_data
        assert score_data["overall_score"] < 100.0

        # 3. Test GET /api/v1/scores/pages/{page_id}/recommendations
        res_recs = client.get(f"/api/v1/scores/pages/{page.id}/recommendations")
        assert res_recs.status_code == 200
        recs_data = res_recs.json()
        assert recs_data["page_id"] == page.id
        assert recs_data["total_recommendations"] >= 1
        assert len(recs_data["recommendations"]) >= 1
        assert recs_data["recommendations"][0]["classification"] in ("quick_win", "deep_fix")

    def test_site_summary_findings_and_history_endpoints(self, client, db_session):
        website = Website(name="Site AI", url="https://siteai.com")
        db_session.add(website)
        db_session.commit()

        scan = Scan(website_id=website.id, status="completed")
        db_session.add(scan)
        db_session.commit()

        page = PageResult(
            scan_id=scan.id,
            url="https://siteai.com/home",
            content="<h1>Site AI</h1><p>Home content</p>",
        )
        db_session.add(page)
        db_session.commit()

        # 1. Test GET /api/v1/scores/websites/{website_id}
        res_site = client.get(f"/api/v1/scores/websites/{website.id}")
        assert res_site.status_code == 200
        site_data = res_site.json()
        assert site_data["website_id"] == website.id
        assert site_data["total_pages_analyzed"] == 1
        assert "category_summaries" in site_data

        # 2. Test GET /api/v1/scores/websites/{website_id}/findings
        res_findings = client.get(f"/api/v1/scores/websites/{website.id}/findings")
        assert res_findings.status_code == 200
        findings_data = res_findings.json()
        assert findings_data["website_id"] == website.id
        assert "findings_by_priority" in findings_data
        assert "findings_by_status" in findings_data

        # 3. Test GET /api/v1/scores/websites/{website_id}/recommendations
        res_recs = client.get(f"/api/v1/scores/websites/{website.id}/recommendations")
        assert res_recs.status_code == 200
        assert isinstance(res_recs.json(), list)

        # 4. Test GET /api/v1/scores/websites/{website_id}/history
        res_hist = client.get(f"/api/v1/scores/websites/{website.id}/history")
        assert res_hist.status_code == 200
        hist_data = res_hist.json()
        assert hist_data["website_id"] == website.id
        assert hist_data["total_scans"] >= 1
        assert len(hist_data["history"]) >= 1

    def test_api_404_not_found_safety(self, client):
        res_page = client.get("/api/v1/scores/pages/999999")
        assert res_page.status_code == 404

        res_site = client.get("/api/v1/scores/websites/999999")
        assert res_site.status_code == 404
