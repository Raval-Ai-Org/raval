"""
Service-layer tests for AI Search Response execution and persistence (Task 10 Step 2).
"""

from datetime import datetime, timezone
import pytest
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.models import AIResponse, Query, QuerySet, Scan, Website
from app.ai_response_service import AIResponseService
from app.provider_adapter import MockProviderAdapter, ProviderConfig, provider_registry


@pytest.fixture
def db_session():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _setup_test_site_and_queryset(db: Session, prefix: str = "RespSite"):
    website = Website(
        name=f"{prefix} Corp",
        url=f"https://{prefix.lower()}.example.com",
    )
    db.add(website)
    db.commit()
    db.refresh(website)

    scan = Scan(
        website_id=website.id,
        status="completed",
    )
    db.add(scan)
    db.commit()
    db.refresh(scan)

    query_set = QuerySet(
        website_id=website.id,
        scan_id=scan.id,
        name=f"{prefix} Query Set",
        description="Query Set for AI response testing",
        version="1.0",
        status="active",
    )
    db.add(query_set)
    db.commit()
    db.refresh(query_set)

    q1 = Query(
        query_set_id=query_set.id,
        website_id=website.id,
        query_text="What is Generative Engine Optimization?",
        intent="INFORMATIONAL",
        topic="Generative Engine Optimization",
        generation_source="TOPIC_INTELLIGENCE",
        priority="HIGH",
        confidence=0.95,
        version="1.0",
        active=True,
    )
    q2 = Query(
        query_set_id=query_set.id,
        website_id=website.id,
        query_text="RespSite Platform vs top alternatives",
        intent="COMPARISON",
        entity_name="RespSite Platform",
        generation_source="ENTITY_INTELLIGENCE",
        priority="HIGH",
        confidence=0.90,
        version="1.0",
        active=True,
    )
    q3 = Query(
        query_set_id=query_set.id,
        website_id=website.id,
        query_text="How to fix missing citations in AI search?",
        intent="PROBLEM_SOLVING",
        generation_source="QUESTION_INTELLIGENCE",
        priority="MEDIUM",
        confidence=0.85,
        version="1.0",
        active=False,  # Inactive query
    )
    db.add_all([q1, q2, q3])
    db.commit()
    db.refresh(q1)
    db.refresh(q2)
    db.refresh(q3)

    return website, scan, query_set, [q1, q2, q3]


def test_execute_query_response_single_success(db_session: Session):
    website, scan, query_set, queries = _setup_test_site_and_queryset(db_session, prefix="SingleResp")
    q1 = queries[0]

    resp = AIResponseService.execute_query_response(
        db=db_session,
        query_id=q1.id,
        provider="mock",
    )

    assert resp.id is not None
    assert resp.query_id == q1.id
    assert resp.query_set_id == query_set.id
    assert resp.website_id == website.id
    assert resp.provider == "mock"
    assert resp.status == "SUCCESS"
    assert len(resp.response_text) > 0
    assert resp.latency_ms >= 0
    assert resp.input_tokens is not None
    assert resp.output_tokens is not None
    assert resp.total_tokens is not None
    assert resp.metadata_json is not None
    assert "result_id" in resp.metadata_json

    # Check relationship navigation
    db_session.refresh(q1)
    assert len(q1.responses) == 1
    assert q1.responses[0].id == resp.id


def test_execute_query_response_simulated_error(db_session: Session):
    website, scan, query_set, queries = _setup_test_site_and_queryset(db_session, prefix="ErrorResp")
    q1 = queries[0]

    # Temporarily register a mock with timeout failure mode
    timeout_mock = MockProviderAdapter(failure_mode="timeout")
    original_mock = provider_registry.get("mock")
    try:
        provider_registry.register(timeout_mock)
        resp = AIResponseService.execute_query_response(
            db=db_session,
            query_id=q1.id,
            provider="mock",
        )
        assert resp.status == "TIMEOUT"
        assert resp.response_text == ""
        assert resp.error_type == "TIMEOUT"
        assert resp.error_message is not None
    finally:
        provider_registry.register(original_mock)


def test_batch_execute_query_set_responses(db_session: Session):
    website, scan, query_set, queries = _setup_test_site_and_queryset(db_session, prefix="BatchResp")

    # Default active_only=True (2 active queries out of 3)
    responses = AIResponseService.batch_execute_query_set_responses(
        db=db_session,
        query_set_id=query_set.id,
        provider="mock",
        active_only=True,
    )
    assert len(responses) == 2
    assert all(r.status == "SUCCESS" for r in responses)
    assert all(r.query_set_id == query_set.id for r in responses)

    # active_only=False (all 3 queries executed)
    all_responses = AIResponseService.batch_execute_query_set_responses(
        db=db_session,
        query_set_id=query_set.id,
        provider="mock",
        active_only=False,
    )
    assert len(all_responses) == 3


def test_repeated_executions_preserve_history(db_session: Session):
    website, scan, query_set, queries = _setup_test_site_and_queryset(db_session, prefix="HistoryResp")
    q1 = queries[0]

    resp1 = AIResponseService.execute_query_response(db=db_session, query_id=q1.id, provider="mock")
    resp2 = AIResponseService.execute_query_response(db=db_session, query_id=q1.id, provider="mock")

    assert resp1.id != resp2.id
    assert resp1.metadata_json["result_id"] != resp2.metadata_json["result_id"]

    db_session.refresh(q1)
    assert len(q1.responses) == 2
    response_ids = {r.id for r in q1.responses}
    assert resp1.id in response_ids
    assert resp2.id in response_ids


def test_list_responses_with_filters(db_session: Session):
    website, scan, query_set, queries = _setup_test_site_and_queryset(db_session, prefix="FilterResp")
    q1, q2, _ = queries

    r1 = AIResponseService.execute_query_response(db=db_session, query_id=q1.id, provider="mock")
    r2 = AIResponseService.execute_query_response(db=db_session, query_id=q2.id, provider="mock")

    # Filter by query_id
    q1_resps = AIResponseService.list_responses(db=db_session, query_id=q1.id)
    assert len(q1_resps) == 1
    assert q1_resps[0].id == r1.id

    # Filter by query_set_id
    qs_resps = AIResponseService.list_responses(db=db_session, query_set_id=query_set.id)
    assert len(qs_resps) == 2

    # Filter by status
    success_resps = AIResponseService.list_responses(db=db_session, status="SUCCESS")
    assert len(success_resps) >= 2


def test_execute_query_response_validation_errors(db_session: Session):
    # Non-existent query id raises ValueError
    with pytest.raises(ValueError, match="Query with id 999999 not found"):
        AIResponseService.execute_query_response(db=db_session, query_id=999999, provider="mock")

    # Unsupported provider raises ValueError
    website, scan, query_set, queries = _setup_test_site_and_queryset(db_session, prefix="UnsupSite")
    q1 = queries[0]
    with pytest.raises(ValueError, match="Unsupported provider 'invalid_provider'"):
        AIResponseService.execute_query_response(db=db_session, query_id=q1.id, provider="invalid_provider")
