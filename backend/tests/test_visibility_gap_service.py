"""
Integration tests for VisibilityGapService (Task 10 Step 5).
Tests persistence in ai_visibility_gaps and ai_gap_finding_links,
exact question, same page, same category matching, duplicate prevention, and batch operations.
"""

from datetime import datetime, timezone
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.app.models import (
    AIGapFindingLink,
    AIResponse,
    AIVisibilityGap,
    AIVisibilityObservation,
    Base,
    Finding,
    PageResult,
    Query,
    QuerySet,
    Scan,
    Website,
)
from backend.app.visibility_gap_service import VisibilityGapService


@pytest.fixture
def db_session():
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

    page = PageResult(
        scan_id=scan.id,
        url="https://raval.ai/docs/geo-guide",
        status_code=200,
        created_at=datetime.now(timezone.utc),
    )

    db_session.add(page)
    db_session.commit()
    db_session.refresh(page)

    # 1. Existing Authority / Citation Finding
    f_authority = Finding(
        website_id=website.id,
        scan_id=scan.id,
        page_id=page.id,
        finding_type="missing_citation_sources",
        category="authority",
        title="Missing authoritative citations and external references",
        description="The target page lacks clear citation pathways and third-party authority signals.",
        severity="medium",
        status="open",
        created_at=datetime.now(timezone.utc),
    )
    db_session.add(f_authority)

    # 2. Existing Content / Question Finding
    f_content = Finding(
        website_id=website.id,
        scan_id=scan.id,
        page_id=page.id,
        finding_type="unanswered_high_value_question",
        category="content",
        title="How does Raval AI optimize answer engine citations?",
        description="Content does not directly answer how Raval AI optimizes answer engine citations.",
        severity="high",
        status="open",
        created_at=datetime.now(timezone.utc),
    )
    db_session.add(f_content)

    # 3. Unrelated Finding
    f_unrelated = Finding(
        website_id=website.id,
        scan_id=scan.id,
        finding_type="missing_cookie_banner",
        category="compliance",
        title="Missing EU Cookie Banner Consent",
        description="Cookie consent banner is missing on the legal disclaimer page.",
        severity="low",
        status="open",
        created_at=datetime.now(timezone.utc),
    )
    db_session.add(f_unrelated)

    qs = QuerySet(
        website_id=website.id,
        scan_id=scan.id,
        name="Gap Analysis QuerySet",
        status="ACTIVE",
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    db_session.add(qs)
    db_session.commit()
    db_session.refresh(qs)

    q1 = Query(
        query_set_id=qs.id,
        website_id=website.id,
        query_text="How does Raval AI optimize answer engine citations?",
        intent="INFORMATIONAL",
        priority="HIGH",
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    db_session.add(q1)

    q2 = Query(
        query_set_id=qs.id,
        website_id=website.id,
        query_text="Best GEO platforms comparison",
        intent="COMMERCIAL",
        priority="HIGH",
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    db_session.add(q2)
    db_session.commit()
    db_session.refresh(q1)
    db_session.refresh(q2)

    # Response 1: Target Absent for q1
    resp1 = AIResponse(
        query_id=q1.id,
        query_set_id=qs.id,
        website_id=website.id,
        provider="mock",
        model="mock-v1",
        status="SUCCESS",
        response_text="General information about search engines.",
        latency_ms=100,
        request_timestamp=datetime.now(timezone.utc),
        response_timestamp=datetime.now(timezone.utc),
        created_at=datetime.now(timezone.utc),
    )
    db_session.add(resp1)

    # Response 2: Mention Without Citation for q2
    resp2 = AIResponse(
        query_id=q2.id,
        query_set_id=qs.id,
        website_id=website.id,
        provider="mock",
        model="mock-v1",
        status="SUCCESS",
        response_text="Raval AI is a top GEO platform with advanced features.",
        latency_ms=110,
        request_timestamp=datetime.now(timezone.utc),
        response_timestamp=datetime.now(timezone.utc),
        created_at=datetime.now(timezone.utc),
    )
    db_session.add(resp2)
    db_session.commit()
    db_session.refresh(resp1)
    db_session.refresh(resp2)

    return {
        "website": website,
        "page": page,
        "scan": scan,
        "findings": {"authority": f_authority, "content": f_content, "unrelated": f_unrelated},
        "query_set": qs,
        "queries": {"q1": q1, "q2": q2},
        "responses": {"resp1": resp1, "resp2": resp2},
    }


def test_process_and_persist_gaps_target_absent_and_linkage(db_session, test_setup):
    resp1 = test_setup["responses"]["resp1"]
    f_content = test_setup["findings"]["content"]

    gaps = VisibilityGapService.process_and_persist_gaps(db_session, resp1.id)
    assert len(gaps) == 1
    assert gaps[0].gap_type == "TARGET_ABSENT"

    # Verify finding link
    db_links = db_session.query(AIGapFindingLink).filter(AIGapFindingLink.gap_id == gaps[0].id).all()
    assert len(db_links) >= 1
    content_link = next((l for l in db_links if l.finding_id == f_content.id), None)
    assert content_link is not None
    assert content_link.match_type in ("EXACT_QUESTION", "SAME_CATEGORY")
    assert content_link.confidence >= 0.70


def test_process_and_persist_gaps_mention_without_citation_linkage(db_session, test_setup):
    resp2 = test_setup["responses"]["resp2"]
    f_authority = test_setup["findings"]["authority"]

    gaps = VisibilityGapService.process_and_persist_gaps(db_session, resp2.id)
    assert len(gaps) == 1
    assert gaps[0].gap_type == "MENTION_WITHOUT_CITATION"

    # Verify finding link to authority finding
    db_links = db_session.query(AIGapFindingLink).filter(AIGapFindingLink.gap_id == gaps[0].id).all()
    authority_link = next((l for l in db_links if l.finding_id == f_authority.id), None)
    assert authority_link is not None
    assert authority_link.match_type == "SAME_CATEGORY"


def test_unrelated_finding_not_linked(db_session, test_setup):
    resp1 = test_setup["responses"]["resp1"]
    f_unrelated = test_setup["findings"]["unrelated"]

    gaps = VisibilityGapService.process_and_persist_gaps(db_session, resp1.id)
    db_links = db_session.query(AIGapFindingLink).filter(AIGapFindingLink.gap_id == gaps[0].id).all()
    unrelated_link = next((l for l in db_links if l.finding_id == f_unrelated.id), None)
    assert unrelated_link is None


def test_idempotent_re_evaluation_no_duplicates(db_session, test_setup):
    resp1 = test_setup["responses"]["resp1"]

    gaps1 = VisibilityGapService.process_and_persist_gaps(db_session, resp1.id)
    gaps2 = VisibilityGapService.process_and_persist_gaps(db_session, resp1.id)

    assert len(gaps1) == len(gaps2)
    # Total gaps in database for resp1 remains exactly 1
    total_gaps = db_session.query(AIVisibilityGap).filter(AIVisibilityGap.response_id == resp1.id).count()
    assert total_gaps == 1


def test_batch_process_query_set_gaps(db_session, test_setup):
    qs = test_setup["query_set"]

    gaps = VisibilityGapService.batch_process_query_set_gaps(db_session, qs.id)
    assert len(gaps) == 2


def test_get_finding_linked_gaps(db_session, test_setup):
    resp1 = test_setup["responses"]["resp1"]
    f_content = test_setup["findings"]["content"]

    VisibilityGapService.process_and_persist_gaps(db_session, resp1.id)

    linked_gaps = VisibilityGapService.get_finding_linked_gaps(db_session, f_content.id)
    assert len(linked_gaps) >= 1
    assert linked_gaps[0].response_id == resp1.id
