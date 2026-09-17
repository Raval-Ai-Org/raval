from fastapi.testclient import TestClient
import pytest

from app.database import SessionLocal
from app.entity_analyzer import (
    EntityAnalyzer,
    analyze_entities,
)
from app.main import app
from app.models import Entity, Finding, PageExtraction, PageResult, PageStructuredData, Scan, Website

client = TestClient(app)


def test_structured_data_entity_detection():
    structured_data = [
        {
            "@context": "https://schema.org",
            "@type": "Organization",
            "name": "Acme Technologies Inc",
            "url": "https://acme.com",
            "sameAs": [
                "https://www.wikidata.org/wiki/Q12345",
                "https://twitter.com/acme",
            ],
            "description": "Leading developer of enterprise intelligence tools",
        }
    ]

    title = "Acme Technologies Inc - Enterprise AI"
    headings = [{"level": 1, "text": "Acme Technologies Inc"}]
    text = "Acme Technologies Inc provides state of the art analytics."

    evidence = analyze_entities(
        text_content=text,
        title=title,
        headings=headings,
        structured_data_blocks=structured_data,
    )

    assert evidence.entity_count >= 1
    assert evidence.has_organization_entity is True
    assert evidence.structured_data_entity_count >= 1
    assert evidence.entity_consistency_valid is True

    ent = next(e for e in evidence.entities if "Acme Technologies Inc" in e["name"])
    assert ent["entity_type"] == "organization"
    assert ent["confidence"] >= 0.95
    assert "https://www.wikidata.org/wiki/Q12345" in ent["same_as"]
    assert ent["in_title"] is True
    assert ent["in_h1"] is True


def test_in_content_named_entity_heuristics():
    text = (
        "Global Logistics Corp was established in 2010. "
        "Global Logistics Corp offers freight transportation across Europe."
    )
    evidence = analyze_entities(text_content=text)

    assert evidence.entity_count >= 1
    org = next(e for e in evidence.entities if e["name"] == "Global Logistics Corp")
    assert org["entity_type"] == "organization"
    assert "content" in org["sources"]
    assert org["confidence"] >= 0.75


def test_empty_entities_detection():
    evidence = analyze_entities(text_content="Just standard generic plain text without entities.")
    assert evidence.entity_count == 0
    assert evidence.has_organization_entity is False
    assert any(f["type"] == "no_entities_detected" for f in evidence.findings)


def test_entity_consistency_issue():
    # Schema declares "MegaCorp Inc" but Title and H1 are about completely unrelated "Pancake Recipes"
    structured_data = [
        {
            "@context": "https://schema.org",
            "@type": "Organization",
            "name": "MegaCorp Inc",
        }
    ]
    title = "Delicious Fluffy Pancake Recipes"
    headings = [{"level": 1, "text": "Best Homemade Pancakes"}]
    text = "How to make golden fluffy pancakes for breakfast with syrup."

    evidence = analyze_entities(
        text_content=text,
        title=title,
        headings=headings,
        structured_data_blocks=structured_data,
    )

    assert evidence.entity_consistency_valid is False
    assert len(evidence.consistency_issues) > 0
    assert any(f["type"] == "entity_title_inconsistency" for f in evidence.findings)


def test_missing_authority_links_finding():
    # Organization in structured data has no sameAs links
    structured_data = [
        {
            "@context": "https://schema.org",
            "@type": "Organization",
            "name": "FreshStartup LLC",
        }
    ]
    evidence = analyze_entities(
        title="FreshStartup LLC",
        headings=[{"level": 1, "text": "FreshStartup LLC"}],
        structured_data_blocks=structured_data,
    )

    finding = next((f for f in evidence.findings if f["type"] == "entity_missing_authority_links"), None)
    assert finding is not None
    assert finding["severity"] == "low"


def test_entity_analysis_api_persistence_and_isolation():
    db = SessionLocal()
    try:
        # Create two websites for isolation test
        site_a = Website(name="Entity Site A", url="https://site-a.com")
        site_b = Website(name="Entity Site B", url="https://site-b.com")
        db.add_all([site_a, site_b])
        db.commit()
        db.refresh(site_a)
        db.refresh(site_b)

        scan_a = Scan(website_id=site_a.id, status="completed")
        scan_b = Scan(website_id=site_b.id, status="completed")
        db.add_all([scan_a, scan_b])
        db.commit()
        db.refresh(scan_a)
        db.refresh(scan_b)

        html_a = """
        <html>
        <head><title>Apex Systems Corp - Intelligent Solutions</title></head>
        <body>
            <h1>Apex Systems Corp</h1>
            <p>Apex Systems Corp develops enterprise data architecture.</p>
        </body>
        </html>
        """
        page_a = PageResult(
            scan_id=scan_a.id,
            url="https://site-a.com/about",
            status_code=200,
            content=html_a,
        )
        db.add(page_a)
        db.commit()
        db.refresh(page_a)

        extraction_a = PageExtraction(
            page_result_id=page_a.id,
            scan_id=scan_a.id,
            title_text="Apex Systems Corp - Intelligent Solutions",
            h1_count=1,
        )
        db.add(extraction_a)
        db.commit()
        db.refresh(extraction_a)

        # Call API with persist_entities=true
        res = client.get(f"/api/v1/pages/{page_a.id}/entity-analysis?persist_entities=true&persist_findings=true")
        assert res.status_code == 200
        data = res.json()
        assert data["entity_count"] >= 1
        assert data["has_organization_entity"] is True

        # Check entity persisted and isolated to site_a
        persisted_entities_a = db.query(Entity).filter(Entity.website_id == site_a.id).all()
        assert len(persisted_entities_a) >= 1
        assert any("Apex Systems Corp" in e.name for e in persisted_entities_a)
        assert persisted_entities_a[0].page_id == page_a.id
        assert persisted_entities_a[0].scan_id == scan_a.id

        # Check website_b has zero entities (strict website isolation)
        persisted_entities_b = db.query(Entity).filter(Entity.website_id == site_b.id).all()
        assert len(persisted_entities_b) == 0

        # Check findings persisted
        persisted_findings_a = db.query(Finding).filter(Finding.website_id == site_a.id).all()
        assert len(persisted_findings_a) >= 1

        # Check 404
        res404 = client.get("/api/v1/pages/999999/entity-analysis")
        assert res404.status_code == 404
    finally:
        db.close()
