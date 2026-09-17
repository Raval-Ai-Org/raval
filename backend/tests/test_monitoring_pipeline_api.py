"""
API integration tests for Step 7 Monitoring Pipeline Endpoints.
Tests run initiation, progress inspection, detailed results retrieval, historical listing, and error handling.
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

    query_set = QuerySet(website_id=website.id, name="Daily Monitoring", created_at=now)
    db.add(query_set)
    db.commit()
    db.refresh(query_set)

    query = Query(
        query_set_id=query_set.id,
        website_id=website.id,
        page_id=page.id,
        query_text="How to monitor AI answer engines?",
        intent="INFORMATIONAL",
        topic="Monitoring",
        priority="HIGH",
        active=True,
        created_at=now,
    )

    db.add(query)
    db.commit()
    db.refresh(query)

    website_id = website.id
    query_set_id = query_set.id
    query_id = query.id
    db.close()

    yield {
        "client": client,
        "website_id": website_id,
        "query_set_id": query_set_id,
        "query_id": query_id,
    }

    app.dependency_overrides.clear()


def test_start_monitoring_run_api(api_test_setup):
    client = api_test_setup["client"]
    query_set_id = api_test_setup["query_set_id"]

    payload = {
        "provider": "mock",
        "mock_responses": ["Raval AI is the leader in answer engine monitoring."],
    }
    resp = client.post(f"/api/v1/query-sets/{query_set_id}/monitor", json=payload)
    assert resp.status_code == 200
    data = resp.json()

    assert data["id"] is not None
    assert data["query_set_id"] == query_set_id
    assert data["status"] == "COMPLETED"
    assert data["total_queries"] == 1
    assert data["successful_responses"] == 1
    assert data["mention_rate"] == 1.0


def test_get_monitoring_run_and_results_api(api_test_setup):
    client = api_test_setup["client"]
    query_set_id = api_test_setup["query_set_id"]

    # Start run
    payload = {
        "provider": "mock",
        "mock_responses": ["Raval AI answers queries. Source: https://raval.ai/docs/geo"],
    }
    start_resp = client.post(f"/api/v1/query-sets/{query_set_id}/monitor", json=payload)
    assert start_resp.status_code == 200
    run_id = start_resp.json()["id"]

    # Get status
    run_resp = client.get(f"/api/v1/monitoring-runs/{run_id}")
    assert run_resp.status_code == 200
    run_data = run_resp.json()
    assert run_data["id"] == run_id
    assert run_data["status"] == "COMPLETED"

    # Get detailed results
    res_resp = client.get(f"/api/v1/monitoring-runs/{run_id}/results")
    assert res_resp.status_code == 200
    res_data = res_resp.json()
    assert res_data["run_id"] == run_id
    assert len(res_data["items"]) == 1
    assert res_data["items"][0]["target_mentioned"] is True
    assert res_data["items"][0]["target_cited"] is True


def test_list_monitoring_runs_api(api_test_setup):
    client = api_test_setup["client"]
    website_id = api_test_setup["website_id"]
    query_set_id = api_test_setup["query_set_id"]

    # Start two runs
    client.post(f"/api/v1/query-sets/{query_set_id}/monitor", json={"provider": "mock", "mock_responses": ["Run 1"]})
    client.post(f"/api/v1/query-sets/{query_set_id}/monitor", json={"provider": "mock", "mock_responses": ["Run 2"]})

    # List by website
    web_resp = client.get(f"/api/v1/websites/{website_id}/monitoring-runs")
    assert web_resp.status_code == 200
    web_data = web_resp.json()
    assert len(web_data) >= 2

    # List by query_set
    qs_resp = client.get(f"/api/v1/query-sets/{query_set_id}/monitoring-runs")
    assert qs_resp.status_code == 200
    qs_data = qs_resp.json()
    assert len(qs_data) >= 2


def test_api_404_error_handling(api_test_setup):
    client = api_test_setup["client"]

    # Non-existent query set to monitor
    resp1 = client.post("/api/v1/query-sets/99999/monitor", json={})
    assert resp1.status_code == 404

    # Non-existent monitoring run
    resp2 = client.get("/api/v1/monitoring-runs/99999")
    assert resp2.status_code == 404

    # Non-existent monitoring run results
    resp3 = client.get("/api/v1/monitoring-runs/99999/results")
    assert resp3.status_code == 404

    # Non-existent website runs
    resp4 = client.get("/api/v1/websites/99999/monitoring-runs")
    assert resp4.status_code == 404
