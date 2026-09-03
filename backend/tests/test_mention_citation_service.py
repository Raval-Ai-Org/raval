"""
Integration tests for MentionCitationService (Task 10 Step 3).
Tests database persistence, target identity construction, page mapping,
batch query set processing, and idempotency.
"""

from datetime import datetime, timezone
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.app.mention_citation_service import MentionCitationService
from backend.app.models import (
    AICitation,
    AIMention,
    AIResponse,
    Base,
    Entity,
    PageResult,
    Query,
    QuerySet,
    Scan,
    Website,
)


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
def sample_website(db_session):
    website = Website(
        name="Raval AI",
        url="https://raval.ai",
        created_at=datetime.now(timezone.utc),
    )
    db_session.add(website)
    db_session.commit()
    db_session.refresh(website)

    # Add a scan and page result
    scan = Scan(
        website_id=website.id,
        status="completed",
        created_at=datetime.now(timezone.utc),
    )
    db_session.add(scan)

    db_session.commit()
    db_session.refresh(scan)

    page = PageResult(
        scan_id=scan.id,
        url="https://raval.ai/docs/geo-guide",
        final_url="https://raval.ai/docs/geo-guide",
        status_code=200,
        content="Guide content",
        created_at=datetime.now(timezone.utc),
    )
    db_session.add(page)

    # Add an entity
    entity = Entity(
        website_id=website.id,
        name="Raval GEO Engine",
        entity_type="product",
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    db_session.add(entity)
    db_session.commit()
    db_session.refresh(page)
    db_session.refresh(entity)

    # Add QuerySet and Query
    qs = QuerySet(
        website_id=website.id,
        scan_id=scan.id,
        name="Core Queries",
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
        query_text="What is Raval AI GEO?",
        intent="INFORMATIONAL",
        generation_source="TOPIC_INTELLIGENCE",
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )

    db_session.add(q)
    db_session.commit()
    db_session.refresh(q)

    return {
        "website": website,
        "scan": scan,
        "page": page,
        "entity": entity,
        "query_set": qs,
        "query": q,
    }


def test_build_target_identity(db_session, sample_website):
    website = sample_website["website"]
    target = MentionCitationService.build_target_identity(
        db=db_session,
        website_id=website.id,
        custom_aliases=["Raval Platform"],
    )
    assert target.brand_name == "Raval AI"
    assert target.domain == "raval.ai"
    assert "Raval Platform" in target.aliases
    assert any(ent["name"] == "Raval GEO Engine" for ent in target.product_entities)


def test_process_and_persist_detection_single_response(db_session, sample_website):
    ws = sample_website["website"]
    qs = sample_website["query_set"]
    q = sample_website["query"]
    page = sample_website["page"]

    response = AIResponse(
        query_id=q.id,
        query_set_id=qs.id,
        website_id=ws.id,
        provider="mock",
        model="mock-ai-search-v1",
        status="SUCCESS",
        response_text=(
            "Raval AI provides cutting-edge optimization. The Raval GEO Engine tool "
            "is documented at https://raval.ai/docs/geo-guide?utm_source=ai with extra links at "
            "https://techradar.com/review."
        ),
        latency_ms=120,
        request_timestamp=datetime.now(timezone.utc),
        response_timestamp=datetime.now(timezone.utc),
        created_at=datetime.now(timezone.utc),
    )
    db_session.add(response)
    db_session.commit()
    db_session.refresh(response)

    res = MentionCitationService.process_and_persist_detection(
        db=db_session,
        response_id=response.id,
    )

    assert res.target_mentioned is True
    assert res.target_cited is True
    assert res.mentions_count >= 2  # "Raval AI" and "Raval GEO Engine"
    assert res.citations_count == 2
    assert res.target_citations_count == 1

    # Check persistence in database
    db_mentions = db_session.query(AIMention).filter(AIMention.response_id == response.id).all()
    assert len(db_mentions) == res.mentions_count

    db_citations = db_session.query(AICitation).filter(AICitation.response_id == response.id).all()
    assert len(db_citations) == 2

    target_citation = next(c for c in db_citations if c.is_target_domain)
    assert target_citation.page_id == page.id  # Matched to known PageResult
    assert target_citation.domain == "raval.ai"


def test_idempotent_re_detection(db_session, sample_website):
    ws = sample_website["website"]
    qs = sample_website["query_set"]
    q = sample_website["query"]

    response = AIResponse(
        query_id=q.id,
        query_set_id=qs.id,
        website_id=ws.id,
        provider="mock",
        model="mock-v1",
        status="SUCCESS",
        response_text="Raval AI overview at https://raval.ai/docs",
        latency_ms=100,
        request_timestamp=datetime.now(timezone.utc),
        response_timestamp=datetime.now(timezone.utc),
        created_at=datetime.now(timezone.utc),
    )
    db_session.add(response)
    db_session.commit()

    # Run detection once
    res1 = MentionCitationService.process_and_persist_detection(db_session, response.id)
    assert res1.mentions_count >= 1

    # Run detection again - should overwrite existing records without duplicate accumulation
    res2 = MentionCitationService.process_and_persist_detection(db_session, response.id)
    assert res2.mentions_count == res1.mentions_count

    count = db_session.query(AIMention).filter(AIMention.response_id == response.id).count()
    assert count == res1.mentions_count


def test_batch_process_query_set_detections(db_session, sample_website):
    ws = sample_website["website"]
    qs = sample_website["query_set"]
    q = sample_website["query"]

    # Create 2 responses
    r1 = AIResponse(
        query_id=q.id,
        query_set_id=qs.id,
        website_id=ws.id,
        provider="mock",
        model="mock-v1",
        status="SUCCESS",
        response_text="Raval AI is leading the field at https://raval.ai",
        latency_ms=80,
        request_timestamp=datetime.now(timezone.utc),
        response_timestamp=datetime.now(timezone.utc),
        created_at=datetime.now(timezone.utc),
    )
    r2 = AIResponse(
        query_id=q.id,
        query_set_id=qs.id,
        website_id=ws.id,
        provider="mock",
        model="mock-v1",
        status="SUCCESS",
        response_text="General LLM answer without any brand mention or citations.",
        latency_ms=90,
        request_timestamp=datetime.now(timezone.utc),
        response_timestamp=datetime.now(timezone.utc),
        created_at=datetime.now(timezone.utc),
    )
    db_session.add_all([r1, r2])
    db_session.commit()

    batch_results = MentionCitationService.batch_process_query_set_detections(
        db=db_session,
        query_set_id=qs.id,
    )
    assert len(batch_results) == 2
    assert batch_results[0].target_mentioned is True
    assert batch_results[1].target_mentioned is False


def test_list_mentions_and_citations_filtering(db_session, sample_website):
    ws = sample_website["website"]
    qs = sample_website["query_set"]
    q = sample_website["query"]

    resp = AIResponse(
        query_id=q.id,
        query_set_id=qs.id,
        website_id=ws.id,
        provider="mock",
        model="mock-v1",
        status="SUCCESS",
        response_text="Raval AI at https://raval.ai and competitor https://competitor.com",
        latency_ms=100,
        request_timestamp=datetime.now(timezone.utc),
        response_timestamp=datetime.now(timezone.utc),
        created_at=datetime.now(timezone.utc),
    )
    db_session.add(resp)
    db_session.commit()

    MentionCitationService.process_and_persist_detection(db_session, resp.id)

    # Filter mentions by match_type
    exact_mentions = MentionCitationService.list_mentions(
        db_session,
        website_id=ws.id,
        match_type="EXACT_BRAND",
    )
    assert len(exact_mentions) == 1
    assert exact_mentions[0].matched_text == "Raval AI"

    # Filter citations by target_only=True
    target_citations = MentionCitationService.list_citations(
        db_session,
        website_id=ws.id,
        target_only=True,
    )
    assert len(target_citations) == 1
    assert target_citations[0].is_target_domain is True

    # Filter citations by target_only=False
    external_citations = MentionCitationService.list_citations(
        db_session,
        website_id=ws.id,
        target_only=False,
    )
    assert len(external_citations) == 1
    assert external_citations[0].is_target_domain is False
