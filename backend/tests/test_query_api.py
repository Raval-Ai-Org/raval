"""
API Endpoint Tests for QuerySet and Query Subsystem (Task 10 - Step 1)
"""

from fastapi.testclient import TestClient
import pytest
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.main import app
from app.models import Entity, PageExtraction, PageResult, Scan, Website

client = TestClient(app)


@pytest.fixture
def db_session():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _setup_api_site_and_scan(db: Session, prefix: str = "QueryApi"):
    website = Website(
        name=f"{prefix} Corp",
        url=f"https://{prefix.lower()}.com",
    )
    db.add(website)
    db.commit()
    db.refresh(website)

    scan = Scan(website_id=website.id, status="completed")
    db.add(scan)
    db.commit()
    db.refresh(scan)

    page = PageResult(
        scan_id=scan.id,
        url=f"https://{prefix.lower()}.com/products",
        status_code=200,
        content_type="text/html",
        content="""
        <html>
            <head><title>Enterprise AI Intelligence - QueryApi</title></head>
            <body>
                <h1>Enterprise AI Intelligence Platform</h1>
                <h2>What is Enterprise AI Visibility?</h2>
                <p>Enterprise AI visibility tracks brand citations and answers across LLMs.</p>
                <h2>How to optimize for ChatGPT and Claude?</h2>
                <p>Provide verified structured facts and clear domain authority.</p>
            </body>
        </html>
        """,
    )
    db.add(page)
    db.commit()
    db.refresh(page)

    entity = Entity(
        website_id=website.id,
        scan_id=scan.id,
        page_id=page.id,
        name="QueryApi Engine",
        entity_type="product",
        confidence=0.9,
    )
    db.add(entity)
    db.commit()
    db.refresh(entity)

    return website, scan, page, entity


# ==========================================
# 1. QuerySet Generation API Tests
# ==========================================


def test_generate_website_query_set_endpoint(db_session: Session):
    website, _, _, _ = _setup_api_site_and_scan(db_session, prefix="GenSite")

    payload = {
        "name": "Generated Site QuerySet",
        "description": "Auto generated via website endpoint",
        "version": "1.0",
        "max_variants_per_source": 3,
        "max_total_queries": 50,
        "include_topics": True,
        "include_entities": True,
        "include_questions": True,
        "include_content": True,
    }

    resp = client.post(f"/api/v1/websites/{website.id}/query-sets/generate", json=payload)
    assert resp.status_code == 201
    data = resp.json()

    assert data["website_id"] == website.id
    assert data["name"] == "Generated Site QuerySet"
    assert data["version"] == "1.0"
    assert data["status"] == "active"
    assert data["total_queries"] > 0
    assert len(data["queries"]) > 0

    first_query = data["queries"][0]
    assert "query_text" in first_query
    assert "intent" in first_query
    assert "priority" in first_query
    assert "confidence" in first_query
    assert "generation_source" in first_query
    assert first_query["active"] is True


def test_generate_scan_query_set_endpoint(db_session: Session):
    website, scan, _, _ = _setup_api_site_and_scan(db_session, prefix="GenScan")

    resp = client.post(f"/api/v1/scans/{scan.id}/query-sets/generate")
    assert resp.status_code == 201
    data = resp.json()

    assert data["website_id"] == website.id
    assert data["scan_id"] == scan.id
    assert data["total_queries"] > 0


def test_generate_query_set_general_endpoint(db_session: Session):
    website, scan, _, _ = _setup_api_site_and_scan(db_session, prefix="GenGen")

    resp = client.post(f"/api/v1/query-sets/generate?website_id={website.id}&scan_id={scan.id}")
    assert resp.status_code == 201
    data = resp.json()
    assert data["website_id"] == website.id


# ==========================================
# 2. QuerySet CRUD & Listing API Tests
# ==========================================


def test_create_and_list_query_sets_endpoint(db_session: Session):
    website, _, _, _ = _setup_api_site_and_scan(db_session, prefix="CrudSet")

    create_payload = {
        "name": "Manual Monitoring Set",
        "description": "Custom query set for testing",
        "version": "1.0",
        "status": "active",
        "website_id": website.id,
    }

    # Create empty query set
    resp = client.post(f"/api/v1/websites/{website.id}/query-sets", json=create_payload)
    assert resp.status_code == 201
    qs_data = resp.json()
    qs_id = qs_data["id"]

    # List website query sets
    list_resp = client.get(f"/api/v1/websites/{website.id}/query-sets")
    assert list_resp.status_code == 200
    sets = list_resp.json()
    assert any(s["id"] == qs_id for s in sets)

    # Get single query set
    get_resp = client.get(f"/api/v1/query-sets/{qs_id}")
    assert get_resp.status_code == 200
    assert get_resp.json()["id"] == qs_id

    # Update query set
    patch_resp = client.patch(f"/api/v1/query-sets/{qs_id}", json={"name": "Updated Set Name", "version": "1.1"})
    assert patch_resp.status_code == 200
    assert patch_resp.json()["name"] == "Updated Set Name"
    assert patch_resp.json()["version"] == "1.1"


# ==========================================
# 3. Query CRUD & Filtering API Tests
# ==========================================


def test_query_crud_and_status_endpoints(db_session: Session):
    website, scan, page, entity = _setup_api_site_and_scan(db_session, prefix="QueryCrud")

    # Generate a query set first
    gen_resp = client.post(f"/api/v1/websites/{website.id}/query-sets/generate")
    assert gen_resp.status_code == 201
    qs_id = gen_resp.json()["id"]

    # Add custom query
    new_query_payload = {
        "query_text": "How does QueryCrud compare to traditional search?",
        "intent": "COMPARISON",
        "topic": "Search AI",
        "entity_id": entity.id,
        "entity_name": entity.name,
        "page_id": page.id,
        "generation_source": "ENTITY_INTELLIGENCE",
        "priority": "HIGH",
        "confidence": 0.92,
        "active": True,
    }

    add_resp = client.post(f"/api/v1/query-sets/{qs_id}/queries", json=new_query_payload)
    assert add_resp.status_code == 201
    q_data = add_resp.json()
    q_id = q_data["id"]
    assert q_data["query_text"] == new_query_payload["query_text"]
    assert q_data["intent"] == "COMPARISON"
    assert q_data["priority"] == "HIGH"

    # Get query by ID
    get_resp = client.get(f"/api/v1/queries/{q_id}")
    assert get_resp.status_code == 200
    assert get_resp.json()["id"] == q_id

    # Toggle query status (deactivate)
    status_resp = client.patch(f"/api/v1/queries/{q_id}/status", json={"active": False})
    assert status_resp.status_code == 200
    assert status_resp.json()["active"] is False

    # List queries with active_only=True vs active_only=False
    active_resp = client.get(f"/api/v1/query-sets/{qs_id}/queries?active_only=true")
    assert active_resp.status_code == 200
    assert all(q["id"] != q_id for q in active_resp.json())

    all_resp = client.get(f"/api/v1/query-sets/{qs_id}/queries?active_only=false")
    assert all_resp.status_code == 200
    assert any(q["id"] == q_id for q in all_resp.json())

    # Filter by intent
    comp_resp = client.get(f"/api/v1/query-sets/{qs_id}/queries?intent=COMPARISON")
    assert comp_resp.status_code == 200
    assert all(q["intent"] == "COMPARISON" for q in comp_resp.json())

    # Delete query
    del_resp = client.delete(f"/api/v1/queries/{q_id}")
    assert del_resp.status_code == 200
    assert del_resp.json()["status"] == "deleted"

    # Confirm 404 after deletion
    not_found_resp = client.get(f"/api/v1/queries/{q_id}")
    assert not_found_resp.status_code == 404


# ==========================================
# 4. Validation & Error Handling Tests
# ==========================================


def test_query_api_filters_and_partial_update(db_session: Session):
    website, scan, page, entity = _setup_api_site_and_scan(db_session, prefix="FilterSite")

    qs_resp = client.post(f"/api/v1/websites/{website.id}/query-sets/generate")
    assert qs_resp.status_code == 201
    qs_id = qs_resp.json()["id"]

    # Filter queries by priority
    high_resp = client.get(f"/api/v1/query-sets/{qs_id}/queries?priority=HIGH")
    assert high_resp.status_code == 200
    assert all(q["priority"] == "HIGH" for q in high_resp.json())

    # Filter queries by source
    topic_resp = client.get(f"/api/v1/query-sets/{qs_id}/queries?source=TOPIC_INTELLIGENCE")
    assert topic_resp.status_code == 200
    assert all(q["generation_source"] == "TOPIC_INTELLIGENCE" for q in topic_resp.json())

    # Update query text and priority
    first_q_id = qs_resp.json()["queries"][0]["id"]
    patch_resp = client.patch(
        f"/api/v1/queries/{first_q_id}",
        json={"query_text": "Updated query text for AI visibility?", "priority": "LOW", "confidence": 0.65},
    )
    assert patch_resp.status_code == 200
    updated = patch_resp.json()
    assert updated["query_text"] == "Updated query text for AI visibility?"
    assert updated["priority"] == "LOW"
    assert updated["confidence"] == 0.65


def test_query_api_validation_errors(db_session: Session):
    # Non-existent website 404
    resp = client.post("/api/v1/websites/999999/query-sets/generate")
    assert resp.status_code == 404

    # Non-existent scan 404
    resp = client.post("/api/v1/scans/999999/query-sets/generate")
    assert resp.status_code == 404

    # Non-existent queryset 404
    resp = client.get("/api/v1/query-sets/999999")
    assert resp.status_code == 404

    # Non-existent query 404
    resp = client.get("/api/v1/queries/999999")
    assert resp.status_code == 404

    # Empty query text in custom query should fail validation (422)
    website, _, _, _ = _setup_api_site_and_scan(db_session, prefix="ValSite")
    gen_resp = client.post(f"/api/v1/websites/{website.id}/query-sets/generate")
    qs_id = gen_resp.json()["id"]

    inv_resp = client.post(f"/api/v1/query-sets/{qs_id}/queries", json={"query_text": "", "intent": "INFORMATIONAL"})
    assert inv_resp.status_code == 422

