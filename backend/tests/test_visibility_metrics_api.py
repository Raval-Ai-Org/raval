"""
Integration tests for Step 6 AI Visibility Metrics REST API Endpoints.
Tests API responses, status codes, query filtering, provider metrics, operational health,
period comparisons, timeline endpoints, and snapshot creation/retrieval.
"""

from datetime import datetime, timezone
from fastapi.testclient import TestClient
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.app.database import Base, get_db
from backend.app.main import app
from backend.app.models import (
    AIResponse,
    AIVisibilityObservation,
    PageResult,
    Query,
    QuerySet,
    Scan,
    Website,
)


@pytest.fixture
def api_test_setup():
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
    now = datetime.now(timezone.utc)
    website = Website(name="Raval AI", url="https://raval.ai", created_at=now)
    db.add(website)
    db.commit()
    db.refresh(website)

    scan = Scan(website_id=website.id, status="completed", created_at=now)
    db.add(scan)
    db.commit()
    db.refresh(scan)

    page = PageResult(scan_id=scan.id, url="https://raval.ai/docs/geo", status_code=200, created_at=now)
    db.add(page)
    db.commit()
    db.refresh(page)

    query_set = QuerySet(website_id=website.id, name="Monitoring Set 1", created_at=now)
    db.add(query_set)
    db.commit()
    db.refresh(query_set)

    query = Query(
        query_set_id=query_set.id,
        website_id=website.id,
        page_id=page.id,
        query_text="How to monitor AI citations for brand?",
        intent="INFORMATIONAL",
        topic="Monitoring",
        priority="HIGH",
        created_at=now,
    )
    db.add(query)
    db.commit()
    db.refresh(query)

    resp1 = AIResponse(
        query_id=query.id,
        query_set_id=query_set.id,
        website_id=website.id,
        provider="mock",
        model="mock-ai-search-v1",
        status="SUCCESS",
        response_text="Raval AI is the top answer engine monitoring platform. See https://raval.ai/docs/geo",
        latency_ms=120,
        input_tokens=50,
        output_tokens=30,
        total_tokens=80,
        request_timestamp=now,
        created_at=now,
    )
    db.add(resp1)
    db.commit()
    db.refresh(resp1)

    obs1 = AIVisibilityObservation(
        response_id=resp1.id,
        query_id=query.id,
        query_set_id=query_set.id,
        website_id=website.id,
        provider="mock",
        model="mock-ai-search-v1",
        target_mentioned=True,
        target_cited=True,
        first_party_cited=True,
        relevant_answer="RELEVANT",
        competitors_present=False,
        competitor_count=0,
        created_at=now,
    )
    db.add(obs1)
    db.commit()
    website_id = website.id
    query_set_id = query_set.id
    query_id = query.id
    response_id = resp1.id
    db.close()

    yield {
        "client": client,
        "website_id": website_id,
        "query_set_id": query_set_id,
        "query_id": query_id,
        "response_id": response_id,
    }

    app.dependency_overrides.clear()



def test_get_website_visibility_metrics_api(api_test_setup):
    client = api_test_setup["client"]
    website_id = api_test_setup["website_id"]

    resp = client.get(f"/api/v1/websites/{website_id}/visibility-metrics")
    assert resp.status_code == 200
    data = resp.json()

    assert data["website_id"] == website_id
    assert data["total_attempts"] == 1
    assert data["evaluable_responses"] == 1
    assert data["mention_metrics"]["rate"] == 1.0
    assert data["citation_metrics"]["rate"] == 1.0
    assert data["operational_health"]["success_rate"] == 1.0


def test_get_query_set_and_query_visibility_metrics_api(api_test_setup):
    client = api_test_setup["client"]
    query_set_id = api_test_setup["query_set_id"]
    query_id = api_test_setup["query_id"]

    # QuerySet endpoint
    qs_resp = client.get(f"/api/v1/query-sets/{query_set_id}/visibility-metrics")
    assert qs_resp.status_code == 200
    qs_data = qs_resp.json()
    assert qs_data["query_set_id"] == query_set_id
    assert qs_data["mention_metrics"]["rate"] == 1.0

    # Query endpoint
    q_resp = client.get(f"/api/v1/queries/{query_id}/visibility-metrics")
    assert q_resp.status_code == 200
    q_data = q_resp.json()
    assert q_data["query_id"] == query_id
    assert q_data["mention_metrics"]["rate"] == 1.0


def test_get_provider_metrics_api(api_test_setup):
    client = api_test_setup["client"]
    website_id = api_test_setup["website_id"]

    resp = client.get(f"/api/v1/websites/{website_id}/provider-metrics")
    assert resp.status_code == 200
    data = resp.json()
    assert data["website_id"] == website_id
    assert "mock" in data["providers"]
    assert data["providers"]["mock"]["mention_metrics"]["rate"] == 1.0


def test_get_operational_health_api(api_test_setup):
    client = api_test_setup["client"]
    website_id = api_test_setup["website_id"]

    resp = client.get(f"/api/v1/websites/{website_id}/operational-health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["total_attempts"] == 1
    assert data["successful_responses"] == 1
    assert data["success_rate"] == 1.0
    assert data["total_tokens"] == 80


def test_get_visibility_history_and_timeline_api(api_test_setup):
    client = api_test_setup["client"]
    website_id = api_test_setup["website_id"]

    # Visibility history (period comparison)
    hist_resp = client.get(f"/api/v1/websites/{website_id}/visibility-history")
    assert hist_resp.status_code == 200
    hist_data = hist_resp.json()
    assert "current" in hist_data
    assert "previous" in hist_data
    assert "absolute_change" in hist_data

    # Visibility timeline
    time_resp = client.get(f"/api/v1/websites/{website_id}/visibility-timeline")
    assert time_resp.status_code == 200
    time_data = time_resp.json()
    assert "timeline" in time_data
    assert len(time_data["timeline"]) >= 1


def test_snapshots_create_and_list_api(api_test_setup):
    client = api_test_setup["client"]
    query_set_id = api_test_setup["query_set_id"]

    # Create snapshot
    post_resp = client.post(f"/api/v1/query-sets/{query_set_id}/snapshots")
    assert post_resp.status_code == 200
    snap_data = post_resp.json()
    assert snap_data["query_set_id"] == query_set_id
    assert snap_data["mention_rate"] == 1.0

    # List snapshots
    get_resp = client.get(f"/api/v1/query-sets/{query_set_id}/snapshots")
    assert get_resp.status_code == 200
    list_data = get_resp.json()
    assert len(list_data) == 1
    assert list_data[0]["id"] == snap_data["id"]



def test_api_404_handling(api_test_setup):
    client = api_test_setup["client"]

    # Non-existent website
    resp1 = client.get("/api/v1/websites/99999/visibility-metrics")
    assert resp1.status_code == 404

    # Non-existent query-set
    resp2 = client.get("/api/v1/query-sets/99999/visibility-metrics")
    assert resp2.status_code == 404

    # Non-existent query
    resp3 = client.get("/api/v1/queries/99999/visibility-metrics")
    assert resp3.status_code == 404
