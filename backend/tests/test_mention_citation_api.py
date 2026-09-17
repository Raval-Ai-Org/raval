"""
API integration tests for Mention & Citation Detection endpoints (Task 10 Step 3).
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

    page = PageResult(
        scan_id=scan.id,
        url="https://raval.ai/docs",
        final_url="https://raval.ai/docs",
        status_code=200,
        content="Docs content",
        created_at=datetime.now(timezone.utc),
    )
    db.add(page)

    entity = Entity(
        website_id=website.id,
        name="Raval GEO Intelligence",
        entity_type="product",
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    db.add(entity)

    qs = QuerySet(
        website_id=website.id,
        scan_id=scan.id,
        name="Detection Test Set",
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
        query_text="What is Raval AI?",
        intent="INFORMATIONAL",
        generation_source="TOPIC_INTELLIGENCE",
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
        response_text="Raval AI provides intelligence solutions. Documentation at https://raval.ai/docs.",
        latency_ms=150,
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



def test_detect_response_endpoint(test_app_and_db):
    client = test_app_and_db["client"]
    resp_id = test_app_and_db["response_id"]

    response = client.post(f"/api/v1/responses/{resp_id}/detect")
    assert response.status_code == 200
    data = response.json()
    assert data["response_id"] == resp_id
    assert data["target_mentioned"] is True
    assert data["target_cited"] is True
    assert data["mentions_count"] >= 1
    assert data["citations_count"] >= 1


def test_get_response_detection_endpoint(test_app_and_db):
    client = test_app_and_db["client"]
    resp_id = test_app_and_db["response_id"]

    # Run detection first
    client.post(f"/api/v1/responses/{resp_id}/detect")

    # Fetch detection result
    response = client.get(f"/api/v1/responses/{resp_id}/detection")
    assert response.status_code == 200
    data = response.json()
    assert data["response_id"] == resp_id
    assert len(data["mentions"]) >= 1
    assert len(data["citations"]) >= 1


def test_batch_detect_query_set_endpoint(test_app_and_db):
    client = test_app_and_db["client"]
    qs_id = test_app_and_db["query_set_id"]

    response = client.post(f"/api/v1/query-sets/{qs_id}/detect")
    assert response.status_code == 200
    data = response.json()
    assert data["query_set_id"] == qs_id
    assert data["total_processed"] == 1
    assert data["target_mentioned_count"] == 1


def test_list_mentions_and_citations_endpoints(test_app_and_db):
    client = test_app_and_db["client"]
    resp_id = test_app_and_db["response_id"]
    ws_id = test_app_and_db["website_id"]

    # Trigger detection
    client.post(f"/api/v1/responses/{resp_id}/detect")

    # List mentions for response
    m_resp = client.get(f"/api/v1/responses/{resp_id}/mentions")
    assert m_resp.status_code == 200
    assert len(m_resp.json()) >= 1

    # List citations for response
    c_resp = client.get(f"/api/v1/responses/{resp_id}/citations")
    assert c_resp.status_code == 200
    assert len(c_resp.json()) >= 1

    # List website-level mentions
    w_m_resp = client.get(f"/api/v1/websites/{ws_id}/mentions")
    assert w_m_resp.status_code == 200
    assert len(w_m_resp.json()) >= 1

    # List website-level citations
    w_c_resp = client.get(f"/api/v1/websites/{ws_id}/citations")
    assert w_c_resp.status_code == 200
    assert len(w_c_resp.json()) >= 1


def test_detection_not_found_endpoints(test_app_and_db):
    client = test_app_and_db["client"]

    # Response not found
    r1 = client.post("/api/v1/responses/99999/detect")
    assert r1.status_code == 404

    r2 = client.get("/api/v1/responses/99999/detection")
    assert r2.status_code == 404

    # QuerySet not found
    r3 = client.post("/api/v1/query-sets/99999/detect")
    assert r3.status_code == 404
