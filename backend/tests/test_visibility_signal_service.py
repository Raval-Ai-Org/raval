"""
Integration tests for VisibilitySignalService (Task 10 Step 4).
Tests persistence in ai_visibility_observations, competitor entity discovery,
idempotency, and batch QuerySet evaluation.
"""

from datetime import datetime, timezone
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.app.models import (
    AICitation,
    AIMention,
    AIResponse,
    AIVisibilityObservation,
    Base,
    Entity,
    PageResult,
    Query,
    QuerySet,
    Scan,
    Website,
)
from backend.app.visibility_signal_service import VisibilitySignalService


@pytest.fixture
def db_session():
    """Provides an isolated in-memory SQLite database session."""
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    session = TestingSessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def test_setup(db_session):
    website = Website(
        name="Raval AI",
        url="https://raval.ai",
        created_at=datetime.now(timezone.utc),
    )
    db_session.add(website)
    db_session.commit()
    db_session.refresh(website)

    scan = Scan(
        website_id=website.id,
        status="completed",
        created_at=datetime.now(timezone.utc),
    )
    db_session.add(scan)
    db_session.commit()
    db_session.refresh(scan)

    # Add Competitor Entity
    comp_entity = Entity(
        website_id=website.id,
        name="SearchOptima",
        entity_type="competitor",
        properties={"domain": "searchoptima.com", "aliases": ["OptimaAI"]},
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    db_session.add(comp_entity)

    qs = QuerySet(
        website_id=website.id,
        scan_id=scan.id,
        name="Visibility Test QuerySet",
        status="ACTIVE",
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    db_session.add(qs)
    db_session.commit()
    db_session.refresh(qs)

    q = Query(
        query_set_id=qs.id,
        website_id=website.id,
        query_text="Compare Raval AI and SearchOptima",
        intent="COMPARISON",
        generation_source="ENTITY_INTELLIGENCE",
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    db_session.add(q)
    db_session.commit()
    db_session.refresh(q)

    # Response with both target and competitor
    resp1 = AIResponse(
        query_id=q.id,
        query_set_id=qs.id,
        website_id=website.id,
        provider="mock",
        model="mock-ai-search-v1",
        status="SUCCESS",
        response_text=(
            "Raval AI leads in GEO capabilities. SearchOptima offers traditional rank tracking. "
            "Visit https://raval.ai/docs and https://searchoptima.com for comparisons."
        ),
        latency_ms=130,
        request_timestamp=datetime.now(timezone.utc),
        response_timestamp=datetime.now(timezone.utc),
        created_at=datetime.now(timezone.utc),
    )
    db_session.add(resp1)
    db_session.commit()
    db_session.refresh(resp1)

    return {
        "website": website,
        "query_set": qs,
        "query": q,
        "response": resp1,
        "competitor_entity": comp_entity,
    }


def test_process_and_persist_observation(db_session, test_setup):
    resp = test_setup["response"]
    obs = VisibilitySignalService.process_and_persist_observation(
        db=db_session,
        response_id=resp.id,
    )

    assert obs.target_mentioned is True
    assert obs.target_cited is True
    assert obs.first_party_cited is True
    assert obs.competitors_present is True
    assert obs.competitor_count == 1
    assert obs.competitors[0].competitor_name == "SearchOptima"
    assert obs.competitors[0].mentioned is True
    assert obs.competitors[0].cited is True

    # Check persistence in database
    db_obs = db_session.query(AIVisibilityObservation).filter(AIVisibilityObservation.response_id == resp.id).first()
    assert db_obs is not None
    assert db_obs.target_mentioned is True
    assert db_obs.competitors_present is True
    assert db_obs.competitor_count == 1
    assert isinstance(db_obs.competitor_signals_json, list)


def test_idempotent_re_evaluation(db_session, test_setup):
    resp = test_setup["response"]

    # Evaluate once
    obs1 = VisibilitySignalService.process_and_persist_observation(db_session, resp.id)
    # Evaluate again
    obs2 = VisibilitySignalService.process_and_persist_observation(db_session, resp.id)

    assert obs1.target_mentioned == obs2.target_mentioned
    assert obs1.competitor_count == obs2.competitor_count

    # Exactly 1 record in database (no duplicate rows)
    count = db_session.query(AIVisibilityObservation).filter(AIVisibilityObservation.response_id == resp.id).count()
    assert count == 1


def test_batch_process_query_set_visibility(db_session, test_setup):
    ws = test_setup["website"]
    qs = test_setup["query_set"]
    q = test_setup["query"]

    # Add a second response with no mentions
    resp2 = AIResponse(
        query_id=q.id,
        query_set_id=qs.id,
        website_id=ws.id,
        provider="mock",
        model="mock-v1",
        status="SUCCESS",
        response_text="General information without target brand or competitor.",
        latency_ms=90,
        request_timestamp=datetime.now(timezone.utc),
        response_timestamp=datetime.now(timezone.utc),
        created_at=datetime.now(timezone.utc),
    )
    db_session.add(resp2)
    db_session.commit()

    results = VisibilitySignalService.batch_process_query_set_visibility(
        db=db_session,
        query_set_id=qs.id,
    )
    assert len(results) == 2
    assert results[0].target_mentioned is True
    assert results[1].target_mentioned is False


def test_list_visibility_observations_filtering(db_session, test_setup):
    ws = test_setup["website"]
    qs = test_setup["query_set"]
    resp = test_setup["response"]

    VisibilitySignalService.process_and_persist_observation(db_session, resp.id)

    # Filter target_mentioned=True
    obs_list = VisibilitySignalService.list_visibility_observations(
        db=db_session,
        website_id=ws.id,
        target_mentioned=True,
    )
    assert len(obs_list) == 1

    # Filter competitors_present=True
    comp_list = VisibilitySignalService.list_visibility_observations(
        db=db_session,
        website_id=ws.id,
        competitors_present=True,
    )
    assert len(comp_list) == 1
