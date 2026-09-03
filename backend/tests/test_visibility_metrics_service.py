"""
Integration tests for Step 6 Visibility Metrics Service.
Tests metric aggregation, multi-dimensional filtering, provider breakdown,
operational health, period comparisons, timeline generation, and snapshot persistence.
"""

from datetime import datetime, timedelta, timezone
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.app.database import Base
from backend.app.models import (
    AIResponse,
    AIVisibilityGap,
    AIVisibilityObservation,
    AIVisibilitySnapshot,
    PageResult,
    Query,
    QuerySet,
    Scan,
    Website,
)
from backend.app.visibility_metrics_service import VisibilityMetricsService


@pytest.fixture
def db_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine)
    session = session_factory()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def sample_dataset(db_session):
    now = datetime.now(timezone.utc)
    website = Website(name="Raval AI", url="https://raval.ai", created_at=now)
    db_session.add(website)
    db_session.commit()
    db_session.refresh(website)

    scan = Scan(website_id=website.id, status="completed", created_at=now)
    db_session.add(scan)
    db_session.commit()
    db_session.refresh(scan)

    page = PageResult(scan_id=scan.id, url="https://raval.ai/geo-guide", status_code=200, created_at=now)
    db_session.add(page)
    db_session.commit()
    db_session.refresh(page)

    query_set = QuerySet(website_id=website.id, name="Test Query Set", created_at=now)
    db_session.add(query_set)
    db_session.commit()
    db_session.refresh(query_set)

    q1 = Query(
        query_set_id=query_set.id,
        website_id=website.id,
        page_id=page.id,
        query_text="What is generative engine optimization?",
        intent="INFORMATIONAL",
        topic="GEO",
        priority="HIGH",
        created_at=now,
    )
    q2 = Query(
        query_set_id=query_set.id,
        website_id=website.id,
        page_id=page.id,
        query_text="Best GEO intelligence platform",
        intent="COMMERCIAL",
        topic="Platforms",
        priority="HIGH",
        created_at=now,
    )
    db_session.add_all([q1, q2])
    db_session.commit()
    db_session.refresh(q1)
    db_session.refresh(q2)

    # Response 1: OpenAI, SUCCESS, Target Mentioned + Cited (1st party), Relevant, No competitor
    r1 = AIResponse(
        query_id=q1.id,
        query_set_id=query_set.id,
        website_id=website.id,
        provider="openai",
        model="gpt-4o",
        status="SUCCESS",
        response_text="Raval AI provides cutting-edge GEO. Source: https://raval.ai/geo-guide",
        latency_ms=250,
        input_tokens=100,
        output_tokens=50,
        total_tokens=150,
        request_timestamp=now - timedelta(hours=2),
        created_at=now - timedelta(hours=2),
    )
    # Response 2: OpenAI, SUCCESS, Target Mentioned, Not Cited, Relevant, Competitor Present
    r2 = AIResponse(
        query_id=q1.id,
        query_set_id=query_set.id,
        website_id=website.id,
        provider="openai",
        model="gpt-4o",
        status="SUCCESS",
        response_text="Raval AI and SearchOptima are leading platforms in GEO.",
        latency_ms=300,
        input_tokens=120,
        output_tokens=60,
        total_tokens=180,
        request_timestamp=now - timedelta(hours=1),
        created_at=now - timedelta(hours=1),
    )
    # Response 3: Perplexity, SUCCESS, Target Absent, Irrelevant, Competitor Present
    r3 = AIResponse(
        query_id=q2.id,
        query_set_id=query_set.id,
        website_id=website.id,
        provider="perplexity",
        model="sonar",
        status="SUCCESS",
        response_text="SearchOptima is a leading search analytics tool.",
        latency_ms=400,
        input_tokens=150,
        output_tokens=80,
        total_tokens=230,
        request_timestamp=now - timedelta(minutes=30),
        created_at=now - timedelta(minutes=30),
    )
    # Response 4: Perplexity, TIMEOUT (Provider Failure)
    r4 = AIResponse(
        query_id=q2.id,
        query_set_id=query_set.id,
        website_id=website.id,
        provider="perplexity",
        model="sonar",
        status="TIMEOUT",
        response_text="",
        error_message="Gateway timeout after 5000ms",
        latency_ms=5000,
        input_tokens=0,
        output_tokens=0,
        total_tokens=0,
        request_timestamp=now - timedelta(minutes=10),
        created_at=now - timedelta(minutes=10),
    )
    db_session.add_all([r1, r2, r3, r4])
    db_session.commit()
    db_session.refresh(r1)
    db_session.refresh(r2)
    db_session.refresh(r3)
    db_session.refresh(r4)

    # Observations for Responses 1, 2, 3
    obs1 = AIVisibilityObservation(
        response_id=r1.id,
        query_id=q1.id,
        query_set_id=query_set.id,
        website_id=website.id,
        provider="openai",
        model="gpt-4o",
        target_mentioned=True,
        target_cited=True,
        first_party_cited=True,
        relevant_answer="RELEVANT",
        competitors_present=False,
        competitor_count=0,
        created_at=now,
    )
    obs2 = AIVisibilityObservation(
        response_id=r2.id,
        query_id=q1.id,
        query_set_id=query_set.id,
        website_id=website.id,
        provider="openai",
        model="gpt-4o",
        target_mentioned=True,
        target_cited=False,
        first_party_cited=False,
        relevant_answer="RELEVANT",
        competitors_present=True,
        competitor_count=1,
        competitor_signals_json=[{
            "competitor_name": "SearchOptima",
            "domain": "searchoptima.com",
            "mentioned": True,
            "cited": False,
            "first_mention_position": 13,
        }],
        created_at=now,
    )
    obs3 = AIVisibilityObservation(
        response_id=r3.id,
        query_id=q2.id,
        query_set_id=query_set.id,
        website_id=website.id,
        provider="perplexity",
        model="sonar",
        target_mentioned=False,
        target_cited=False,
        first_party_cited=False,
        relevant_answer="IRRELEVANT",
        competitors_present=True,
        competitor_count=1,
        competitor_signals_json=[{
            "competitor_name": "SearchOptima",
            "domain": "searchoptima.com",
            "mentioned": True,
            "cited": False,
            "first_mention_position": 0,
        }],
        created_at=now,
    )
    db_session.add_all([obs1, obs2, obs3])

    # Gaps for Response 2 & 3
    gap2 = AIVisibilityGap(
        response_id=r2.id,
        query_id=q1.id,
        query_set_id=query_set.id,
        website_id=website.id,
        gap_type="MENTION_WITHOUT_CITATION",
        severity="MEDIUM",
        reason="Target mentioned without citation",
        created_at=now,
    )
    gap3 = AIVisibilityGap(
        response_id=r3.id,
        query_id=q2.id,
        query_set_id=query_set.id,
        website_id=website.id,
        gap_type="COMPETITOR_PRESENT_TARGET_ABSENT",
        severity="HIGH",
        reason="Competitor present while target absent",
        created_at=now,
    )
    db_session.add_all([gap2, gap3])
    db_session.commit()

    return {
        "website": website,
        "query_set": query_set,
        "q1": q1,
        "q2": q2,
        "r1": r1,
        "r2": r2,
        "r3": r3,
        "r4": r4,
    }


def test_calculate_visibility_metrics_overall(db_session, sample_dataset):
    website = sample_dataset["website"]
    metrics = VisibilityMetricsService.calculate_visibility_metrics(
        db=db_session,
        website_id=website.id,
    )

    # Operational Health
    assert metrics.total_attempts == 4
    assert metrics.evaluable_responses == 3  # r4 excluded due to TIMEOUT
    assert metrics.failed_responses == 1
    assert metrics.operational_health.timeout_count == 1
    assert metrics.operational_health.success_rate == 0.75

    # Mention Metrics: r1, r2 mentioned -> 2 / 3
    assert metrics.mention_metrics.numerator == 2
    assert metrics.mention_metrics.denominator == 3
    assert round(metrics.mention_metrics.rate, 4) == 0.6667

    # Citation Metrics: r1 cited -> 1 / 3
    assert metrics.citation_metrics.numerator == 1
    assert metrics.citation_metrics.denominator == 3
    assert round(metrics.citation_metrics.rate, 4) == 0.3333

    # First Party Citation Metrics: r1 -> 1 / 3
    assert metrics.first_party_citation_metrics.numerator == 1
    assert metrics.first_party_citation_metrics.denominator == 3

    # Relevant Answer Metrics: r1, r2 RELEVANT, r3 IRRELEVANT -> 2 / 3
    assert metrics.relevant_answer_metrics.numerator == 2
    assert metrics.relevant_answer_metrics.denominator == 3

    # Competitor Appearance Metrics: r2, r3 -> 2 / 3
    assert metrics.competitor_appearance_metrics.numerator == 2
    assert metrics.competitor_appearance_metrics.denominator == 3

    # Target vs Competitor
    t_vs_c = metrics.target_vs_competitor
    assert t_vs_c.target_mentioned_count == 2
    assert t_vs_c.target_cited_count == 1
    assert t_vs_c.competitor_present_count == 2
    assert t_vs_c.target_absent_competitor_present_count == 1  # r3
    assert t_vs_c.target_present_competitor_absent_count == 1  # r1
    assert t_vs_c.both_present_count == 1  # r2

    # Top Competitors
    assert len(metrics.top_competitors) == 1
    assert metrics.top_competitors[0].competitor_name == "SearchOptima"
    assert metrics.top_competitors[0].appearance_count == 2

    # Gaps
    assert metrics.gap_summary["total_gaps"] == 2
    assert "MENTION_WITHOUT_CITATION" in metrics.gap_summary["gap_type_counts"]


def test_provider_metrics_breakdown(db_session, sample_dataset):
    website = sample_dataset["website"]
    breakdown = VisibilityMetricsService.calculate_provider_metrics_breakdown(
        db=db_session,
        website_id=website.id,
    )

    assert "openai" in breakdown
    assert "perplexity" in breakdown

    openai_m = breakdown["openai"]
    assert openai_m.total_attempts == 2
    assert openai_m.evaluable_responses == 2
    assert openai_m.mention_metrics.rate == 1.0
    assert openai_m.citation_metrics.rate == 0.5
    assert openai_m.operational_health.success_rate == 1.0

    perp_m = breakdown["perplexity"]
    assert perp_m.total_attempts == 2
    assert perp_m.evaluable_responses == 1  # 1 timeout excluded
    assert perp_m.failed_responses == 1
    assert perp_m.mention_metrics.rate == 0.0
    assert perp_m.operational_health.success_rate == 0.5


def test_query_and_intent_filtering(db_session, sample_dataset):
    website = sample_dataset["website"]
    q1 = sample_dataset["q1"]

    # Filter by query_id
    q1_metrics = VisibilityMetricsService.calculate_visibility_metrics(
        db=db_session,
        website_id=website.id,
        query_id=q1.id,
    )
    assert q1_metrics.total_attempts == 2
    assert q1_metrics.evaluable_responses == 2
    assert q1_metrics.mention_metrics.rate == 1.0

    # Filter by intent COMMERCIAL
    comm_metrics = VisibilityMetricsService.calculate_visibility_metrics(
        db=db_session,
        website_id=website.id,
        intent="COMMERCIAL",
    )
    assert comm_metrics.total_attempts == 2  # r3, r4
    assert comm_metrics.evaluable_responses == 1  # r3 (r4 timed out)
    assert comm_metrics.mention_metrics.rate == 0.0


def test_period_comparison(db_session, sample_dataset):
    website = sample_dataset["website"]
    now = datetime.now(timezone.utc)

    # Compare current (last 4 hours) vs previous (earlier empty period)
    comparison = VisibilityMetricsService.compare_visibility_periods(
        db=db_session,
        website_id=website.id,
        current_start=now - timedelta(hours=4),
        current_end=now + timedelta(hours=1),
        previous_start=now - timedelta(days=2),
        previous_end=now - timedelta(days=1),
    )

    assert comparison.current.evaluable_responses == 3
    assert comparison.previous.evaluable_responses == 0
    # Absolute change and relative percentage handling
    assert comparison.absolute_change["mention_rate"] is None  # previous was None
    assert comparison.relative_change_pct["mention_rate"] is None


def test_timeline_generation(db_session, sample_dataset):
    website = sample_dataset["website"]
    timeline = VisibilityMetricsService.generate_visibility_timeline(
        db=db_session,
        website_id=website.id,
    )

    assert len(timeline) >= 1
    today_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    pt = [p for p in timeline if p.date == today_str][0]
    assert pt.total_attempts == 4
    assert pt.evaluable_responses == 3
    assert round(pt.mention_rate, 4) == 0.6667
    assert round(pt.citation_rate, 4) == 0.3333


def test_create_and_list_snapshots(db_session, sample_dataset):
    website = sample_dataset["website"]
    query_set = sample_dataset["query_set"]

    snapshot = VisibilityMetricsService.create_and_persist_snapshot(
        db=db_session,
        website_id=website.id,
        query_set_id=query_set.id,
        provider="openai",
    )

    assert snapshot.id is not None
    assert snapshot.evaluable_responses == 2
    assert snapshot.mention_count == 2
    assert snapshot.citation_count == 1
    assert snapshot.mention_rate == 1.0

    snapshots = VisibilityMetricsService.list_snapshots(
        db=db_session,
        website_id=website.id,
        query_set_id=query_set.id,
    )
    assert len(snapshots) == 1
    assert snapshots[0].id == snapshot.id
