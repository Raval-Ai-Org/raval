"""
API integration tests for AI Search Provider & Response endpoints (Task 10 Step 2).
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.main import app
from app.models import Query, QuerySet, Scan, Website

client = TestClient(app)


@pytest.fixture
def db_session():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _setup_api_site_and_queryset(db: Session, prefix: str = "ApiRespSite"):
    website = Website(
        name=f"{prefix} Company",
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
        description="API Query Set for response tests",
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
        query_text="ApiRespSite vs top competitors",
        intent="COMPARISON",
        entity_name="ApiRespSite",
        generation_source="ENTITY_INTELLIGENCE",
        priority="HIGH",
        confidence=0.90,
        version="1.0",
        active=True,
    )
    db.add_all([q1, q2])
    db.commit()
    db.refresh(q1)
    db.refresh(q2)

    return website, scan, query_set, [q1, q2]


def test_list_providers_endpoint():
    resp = client.get("/api/v1/providers")
    assert resp.status_code == 200
    providers = resp.json()
    assert isinstance(providers, list)
    assert len(providers) >= 6
    names = {p["provider_name"] for p in providers}
    assert "mock" in names
    assert "openai" in names
    assert "perplexity" in names
    assert "gemini" in names
    assert "claude" in names
    assert "copilot" in names


def test_execute_query_response_endpoint(db_session: Session):
    website, scan, query_set, queries = _setup_api_site_and_queryset(db_session, prefix="SingleApi")
    q1 = queries[0]

    resp = client.post(
        f"/api/v1/queries/{q1.id}/responses",
        json={"provider": "mock", "model": "mock-ai-search-v1"},
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["query_id"] == q1.id
    assert data["query_set_id"] == query_set.id
    assert data["website_id"] == website.id
    assert data["provider"] == "mock"
    assert data["status"] == "SUCCESS"
    assert len(data["response_text"]) > 0
    assert data["latency_ms"] >= 0
    assert data["total_tokens"] is not None


def test_batch_execute_query_set_responses_endpoint(db_session: Session):
    website, scan, query_set, queries = _setup_api_site_and_queryset(db_session, prefix="BatchApi")

    resp = client.post(
        f"/api/v1/query-sets/{query_set.id}/responses",
        json={"provider": "mock", "active_only": True},
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["query_set_id"] == query_set.id
    assert data["provider"] == "mock"
    assert data["total_executed"] == 2
    assert data["success_count"] == 2
    assert data["failure_count"] == 0
    assert len(data["responses"]) == 2


def test_list_query_set_and_query_responses_endpoints(db_session: Session):
    website, scan, query_set, queries = _setup_api_site_and_queryset(db_session, prefix="ListApi")
    q1 = queries[0]

    # Execute one response
    post_resp = client.post(f"/api/v1/queries/{q1.id}/responses", json={"provider": "mock"})
    assert post_resp.status_code == 201
    response_id = post_resp.json()["id"]

    # List responses for query_set
    qs_resp = client.get(f"/api/v1/query-sets/{query_set.id}/responses")
    assert qs_resp.status_code == 200
    assert len(qs_resp.json()) >= 1

    # List responses for query
    q_resp = client.get(f"/api/v1/queries/{q1.id}/responses")
    assert q_resp.status_code == 200
    assert any(r["id"] == response_id for r in q_resp.json())

    # Get single response by ID
    single_resp = client.get(f"/api/v1/responses/{response_id}")
    assert single_resp.status_code == 200
    assert single_resp.json()["id"] == response_id


def test_api_error_handling(db_session: Session):
    # Non-existent query ID 404
    resp = client.post("/api/v1/queries/999999/responses", json={"provider": "mock"})
    assert resp.status_code == 404

    # Non-existent query set ID 404
    resp = client.post("/api/v1/query-sets/999999/responses", json={"provider": "mock"})
    assert resp.status_code == 404

    # Non-existent response ID 404
    resp = client.get("/api/v1/responses/999999")
    assert resp.status_code == 404

    # Unsupported provider 400
    website, scan, query_set, queries = _setup_api_site_and_queryset(db_session, prefix="BadProvApi")
    resp = client.post(
        f"/api/v1/queries/{queries[0].id}/responses",
        json={"provider": "unsupported_provider"},
    )
    assert resp.status_code == 400
