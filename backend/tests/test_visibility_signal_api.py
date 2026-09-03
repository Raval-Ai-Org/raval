"""
API integration tests for Visibility & Competitor Signal endpoints (Task 10 Step 4).
"""

from datetime import datetime, timezone
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.app.database import get_db
from backend.app.main import app
from backend.app.models import (
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
def test_app_and_db():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

    def override_get_db():
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    client = TestClient(app)

    db = TestingSessionLocal()
    website = Website(
        name="Raval AI",
        url="https://raval.ai",
        created_at=datetime.now(timezone.utc),
    )
    db.add(website)
    db.commit()
    db.refresh(website)

    scan = Scan(
        website_id=website.id,
        status="completed",
        created_at=datetime.now(timezone.utc),
    )
    db.add(scan)
    db.commit()
    db.refresh(scan)

    # Competitor Entity
    comp = Entity(
        website_id=website.id,
        name="MarketLeader",
        entity_type="competitor",
        properties={"domain": "marketleader.com"},
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    db.add(comp)

    qs = QuerySet(
        website_id=website.id,
        scan_id=scan.id,
        name="API Visibility QuerySet",
        status="ACTIVE",
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    db.add(qs)
    db.commit()
    db.refresh(qs)

    q = Query(
        query_set_id=qs.id,
        website_id=website.id,
        query_text="Raval AI vs MarketLeader",
        intent="COMPARISON",
        generation_source="ENTITY_INTELLIGENCE",
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    db.add(q)
    db.commit()
    db.refresh(q)

    resp = AIResponse(
        query_id=q.id,
        query_set_id=qs.id,
        website_id=website.id,
        provider="mock",
        model="mock-ai-search-v1",
        status="SUCCESS",
        response_text="Raval AI is leading in GEO. MarketLeader is another tool available at https://marketleader.com.",
        latency_ms=110,
        request_timestamp=datetime.now(timezone.utc),
        response_timestamp=datetime.now(timezone.utc),
        created_at=datetime.now(timezone.utc),
    )
    db.add(resp)
    db.commit()
    db.refresh(resp)

    website_id = website.id
    qs_id = qs.id
    query_id = q.id
    resp_id = resp.id
    db.close()

    yield {
        "client": client,
        "website_id": website_id,
        "query_set_id": qs_id,
        "query_id": query_id,
        "response_id": resp_id,
    }

    app.dependency_overrides.clear()


def test_evaluate_response_visibility_endpoint(test_app_and_db):
    client = test_app_and_db["client"]
    resp_id = test_app_and_db["response_id"]

    response = client.post(f"/api/v1/responses/{resp_id}/visibility")
    assert response.status_code == 200
    data = response.json()
    assert data["response_id"] == resp_id
    assert data["target_mentioned"] is True
    assert data["competitors_present"] is True
    assert data["competitor_count"] == 1
    assert data["competitors"][0]["competitor_name"] == "MarketLeader"


def test_get_response_visibility_endpoint(test_app_and_db):
    client = test_app_and_db["client"]
    resp_id = test_app_and_db["response_id"]

    # Evaluate first
    client.post(f"/api/v1/responses/{resp_id}/visibility")

    # Get observation
    response = client.get(f"/api/v1/responses/{resp_id}/visibility")
    assert response.status_code == 200
    data = response.json()
    assert data["response_id"] == resp_id
    assert data["target_mentioned"] is True


def test_batch_evaluate_query_set_visibility_endpoint(test_app_and_db):
    client = test_app_and_db["client"]
    qs_id = test_app_and_db["query_set_id"]

    response = client.post(f"/api/v1/query-sets/{qs_id}/visibility")
    assert response.status_code == 200
    data = response.json()
    assert data["query_set_id"] == qs_id
    assert data["total_evaluated"] == 1
    assert data["target_mentioned_count"] == 1


def test_list_query_set_and_query_visibility_endpoints(test_app_and_db):
    client = test_app_and_db["client"]
    resp_id = test_app_and_db["response_id"]
    qs_id = test_app_and_db["query_set_id"]
    q_id = test_app_and_db["query_id"]

    # Evaluate first
    client.post(f"/api/v1/responses/{resp_id}/visibility")

    # List for QuerySet
    qs_resp = client.get(f"/api/v1/query-sets/{qs_id}/visibility")
    assert qs_resp.status_code == 200
    assert len(qs_resp.json()) == 1

    # List for Query
    q_resp = client.get(f"/api/v1/queries/{q_id}/visibility")
    assert q_resp.status_code == 200
    assert len(q_resp.json()) == 1


def test_get_response_competitors_endpoint(test_app_and_db):
    client = test_app_and_db["client"]
    resp_id = test_app_and_db["response_id"]

    # Evaluate first
    client.post(f"/api/v1/responses/{resp_id}/visibility")

    response = client.get(f"/api/v1/responses/{resp_id}/competitors")
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 1
    assert data[0]["competitor_name"] == "MarketLeader"
    assert data[0]["mentioned"] is True
