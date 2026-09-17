from fastapi.testclient import TestClient
import pytest
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.main import app
from app.models import Entity, PageResult, Scan, Website
from app.services import (
    create_entity,
    delete_entity,
    get_entity,
    get_page_entities,
    get_scan_entities,
    get_website_entities,
    update_entity,
)

client = TestClient(app)


def _setup_website_scan_and_page(
    db: Session,
    site_name: str = "Entity Test Site",
    url: str = "https://entity-test.com",
):
    website = Website(name=site_name, url=url)
    db.add(website)
    db.commit()
    db.refresh(website)

    scan = Scan(website_id=website.id, status="completed")
    db.add(scan)
    db.commit()
    db.refresh(scan)

    page = PageResult(scan_id=scan.id, url=f"{url}/about", status_code=200)
    db.add(page)
    db.commit()
    db.refresh(page)

    return website, scan, page


def test_create_entity_api():
    db = SessionLocal()
    try:
        website, scan, page = _setup_website_scan_and_page(db, "Create Entity Site", "https://create-ent.com")

        payload = {
            "name": "Acme Corporation",
            "entity_type": "Organization",
            "description": "Global manufacturer of anvils and contraptions",
            "confidence": 0.95,
            "same_as": ["https://wikidata.org/wiki/Q12345", "https://twitter.com/acme"],
            "properties": {"founder": "Wile E. Coyote", "headquarters": "Desert, AZ"},
            "relationships": [{"type": "competitor_of", "target": "RoadRunner Inc"}],
            "evidence": {"found_in_schema": "Organization", "html_selector": "header.branding"},
        }

        response = client.post(f"/api/v1/websites/{website.id}/entities", json=payload)
        assert response.status_code == 201
        data = response.json()

        assert data["id"] is not None
        assert data["website_id"] == website.id
        assert data["name"] == "Acme Corporation"
        assert data["entity_type"] == "organization"
        assert data["description"] == payload["description"]
        assert data["confidence"] == 0.95
        assert len(data["same_as"]) == 2
        assert data["properties"]["founder"] == "Wile E. Coyote"
        assert data["relationships"][0]["type"] == "competitor_of"
        assert data["evidence"]["found_in_schema"] == "Organization"

        # Check DB directly
        entity_db = db.get(Entity, data["id"])
        assert entity_db is not None
        assert entity_db.website_id == website.id
        assert entity_db.name == "Acme Corporation"
    finally:
        db.close()


def test_create_entity_with_page_and_scan():
    db = SessionLocal()
    try:
        website, scan, page = _setup_website_scan_and_page(db, "Page Entity Site", "https://page-ent.com")

        payload = {
            "name": "Super Anvil 3000",
            "entity_type": "product",
            "scan_id": scan.id,
            "page_id": page.id,
            "description": "Heavy-duty steel anvil",
            "confidence": 0.99,
        }

        response = client.post(f"/api/v1/websites/{website.id}/entities", json=payload)
        assert response.status_code == 201
        data = response.json()
        assert data["scan_id"] == scan.id
        assert data["page_id"] == page.id
    finally:
        db.close()


def test_filter_website_entities_by_type():
    db = SessionLocal()
    try:
        website, scan, page = _setup_website_scan_and_page(db, "Filter Site", "https://filter-ent.com")

        client.post(
            f"/api/v1/websites/{website.id}/entities",
            json={"name": "Org A", "entity_type": "organization"},
        )
        client.post(
            f"/api/v1/websites/{website.id}/entities",
            json={"name": "Product A", "entity_type": "product"},
        )
        client.post(
            f"/api/v1/websites/{website.id}/entities",
            json={"name": "Product B", "entity_type": "product"},
        )

        # Get all
        all_res = client.get(f"/api/v1/websites/{website.id}/entities")
        assert all_res.status_code == 200
        assert len(all_res.json()) == 3

        # Filter by product
        prod_res = client.get(f"/api/v1/websites/{website.id}/entities?entity_type=product")
        assert prod_res.status_code == 200
        prods = prod_res.json()
        assert len(prods) == 2
        for p in prods:
            assert p["entity_type"] == "product"
    finally:
        db.close()


def test_get_page_and_scan_entities():
    db = SessionLocal()
    try:
        website, scan, page = _setup_website_scan_and_page(db, "Scope Site", "https://scope-ent.com")

        create_res = client.post(
            f"/api/v1/websites/{website.id}/entities",
            json={
                "name": "Scoped Entity",
                "entity_type": "place",
                "scan_id": scan.id,
                "page_id": page.id,
            },
        )
        entity_id = create_res.json()["id"]

        # Query by page
        page_res = client.get(f"/api/v1/pages/{page.id}/entities")
        assert page_res.status_code == 200
        assert len(page_res.json()) == 1
        assert page_res.json()[0]["id"] == entity_id

        # Query by scan
        scan_res = client.get(f"/api/v1/scans/{scan.id}/entities")
        assert scan_res.status_code == 200
        assert len(scan_res.json()) == 1
        assert scan_res.json()[0]["id"] == entity_id
    finally:
        db.close()


def test_update_entity_api():
    db = SessionLocal()
    try:
        website, scan, page = _setup_website_scan_and_page(db, "Update Site", "https://update-ent.com")

        create_res = client.post(
            f"/api/v1/websites/{website.id}/entities",
            json={"name": "Initial Name", "entity_type": "organization", "confidence": 0.5},
        )
        entity_id = create_res.json()["id"]

        patch_res = client.patch(
            f"/api/v1/entities/{entity_id}",
            json={
                "name": "Updated Name",
                "confidence": 0.9,
                "description": "Added description",
            },
        )
        assert patch_res.status_code == 200
        updated = patch_res.json()
        assert updated["name"] == "Updated Name"
        assert updated["confidence"] == 0.9
        assert updated["description"] == "Added description"
        assert updated["entity_type"] == "organization"
    finally:
        db.close()


def test_delete_entity_api():
    db = SessionLocal()
    try:
        website, scan, page = _setup_website_scan_and_page(db, "Delete Site", "https://del-ent.com")

        create_res = client.post(
            f"/api/v1/websites/{website.id}/entities",
            json={"name": "To Delete", "entity_type": "service"},
        )
        entity_id = create_res.json()["id"]

        # Delete
        del_res = client.delete(f"/api/v1/entities/{entity_id}")
        assert del_res.status_code == 200

        # Query deleted entity -> 404
        get_res = client.get(f"/api/v1/entities/{entity_id}")
        assert get_res.status_code == 404
    finally:
        db.close()


def test_cross_website_isolation():
    db = SessionLocal()
    try:
        site_a, scan_a, page_a = _setup_website_scan_and_page(db, "Site A", "https://site-a-ent.com")
        site_b, scan_b, page_b = _setup_website_scan_and_page(db, "Site B", "https://site-b-ent.com")

        # Attempt to link Site B entity with scan from Site A
        cross_scan_res = client.post(
            f"/api/v1/websites/{site_b.id}/entities",
            json={"name": "Cross Scan Entity", "entity_type": "person", "scan_id": scan_a.id},
        )
        assert cross_scan_res.status_code == 400
        assert "belong" in cross_scan_res.json()["detail"].lower()

        # Attempt to link Site B entity with page from Site A
        cross_page_res = client.post(
            f"/api/v1/websites/{site_b.id}/entities",
            json={"name": "Cross Page Entity", "entity_type": "person", "page_id": page_a.id},
        )
        assert cross_page_res.status_code == 400
        assert "belong" in cross_page_res.json()["detail"].lower()
    finally:
        db.close()


def test_confidence_range_validation():
    db = SessionLocal()
    try:
        website, scan, page = _setup_website_scan_and_page(db, "Confidence Site", "https://conf-ent.com")

        # Confidence > 1.0
        res1 = client.post(
            f"/api/v1/websites/{website.id}/entities",
            json={"name": "High Conf", "entity_type": "person", "confidence": 1.5},
        )
        assert res1.status_code == 400

        # Confidence < 0.0
        res2 = client.post(
            f"/api/v1/websites/{website.id}/entities",
            json={"name": "Negative Conf", "entity_type": "person", "confidence": -0.1},
        )
        assert res2.status_code == 400
    finally:
        db.close()


def test_missing_resource_404s():
    # Unknown website
    res1 = client.post(
        "/api/v1/websites/999999/entities",
        json={"name": "Ghost Entity", "entity_type": "place"},
    )
    assert res1.status_code == 404

    # Unknown entity
    res2 = client.get("/api/v1/entities/999999")
    assert res2.status_code == 404

    # Unknown page
    res3 = client.get("/api/v1/pages/999999/entities")
    assert res3.status_code == 404

    # Unknown scan
    res4 = client.get("/api/v1/scans/999999/entities")
    assert res4.status_code == 404


def test_empty_name_or_type_validation():
    db = SessionLocal()
    try:
        website, scan, page = _setup_website_scan_and_page(db, "Empty Val Site", "https://empty-ent.com")

        # Empty name
        res1 = client.post(
            f"/api/v1/websites/{website.id}/entities",
            json={"name": "   ", "entity_type": "organization"},
        )
        assert res1.status_code == 400

        # Empty entity_type
        res2 = client.post(
            f"/api/v1/websites/{website.id}/entities",
            json={"name": "Valid Name", "entity_type": ""},
        )
        assert res2.status_code == 400
    finally:
        db.close()


def test_cascade_delete_on_website_delete():
    db = SessionLocal()
    try:
        website, scan, page = _setup_website_scan_and_page(db, "Cascade Site", "https://cascade-ent.com")

        entity = create_entity(
            db,
            website.id,
            {"name": "Cascade Entity", "entity_type": "organization"},
        )
        entity_id = entity.id

        # Delete website
        db.delete(website)
        db.commit()

        # Entity should be deleted
        assert db.get(Entity, entity_id) is None
    finally:
        db.close()


def test_direct_service_layer_entities():
    db = SessionLocal()
    try:
        website, scan, page = _setup_website_scan_and_page(db, "Service Site", "https://service-ent.com")

        # Create
        ent = create_entity(
            db,
            website.id,
            {"name": "Direct Service Entity", "entity_type": "service", "confidence": 0.8},
        )
        assert ent.id is not None

        # Fetch
        fetched = get_entity(db, ent.id)
        assert fetched.name == "Direct Service Entity"

        # Update
        updated = update_entity(db, ent.id, {"confidence": 0.95})
        assert updated.confidence == 0.95

        # Exceptions
        with pytest.raises(ValueError, match="Entity not found"):
            get_entity(db, 999999)

        with pytest.raises(ValueError, match="Website not found"):
            get_website_entities(db, 999999)

        with pytest.raises(ValueError, match="Page not found"):
            get_page_entities(db, 999999)

        with pytest.raises(ValueError, match="Scan not found"):
            get_scan_entities(db, 999999)

        with pytest.raises(ValueError, match="Entity not found"):
            update_entity(db, 999999, {"name": "Test"})

        with pytest.raises(ValueError, match="Entity not found"):
            delete_entity(db, 999999)
    finally:
        db.close()
