from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.main import app
from app.models import (
    PageBreadcrumb,
    PageCanonical,
    PageExtraction,
    PageHeading,
    PageHreflang,
    PageImage,
    PageIndexabilityEvidence,
    PageLanguage,
    PageLink,
    PageMetaDescription,
    PageMicrodata,
    PageResult,
    PageRobots,
    PageSocialMetadata,
    PageStructuredData,
    Scan,
    Website,
)

client = TestClient(app)


def _create_test_website_and_scan(db: Session, name: str = "Test Site", url: str = "https://example.com"):
    website = Website(name=name, url=url)
    db.add(website)
    db.commit()
    db.refresh(website)

    scan = Scan(website_id=website.id, status="completed", pages_crawled=1)
    db.add(scan)
    db.commit()
    db.refresh(scan)

    return website, scan


def test_scan_pages_existing_endpoint_still_works():
    db = SessionLocal()
    try:
        website, scan = _create_test_website_and_scan(db, "Existing Page Test", "https://pages-test.com")
        page = PageResult(
            scan_id=scan.id,
            url="https://pages-test.com/about",
            status_code=200,
            content_type="text/html",
            depth=1,
        )
        db.add(page)
        db.commit()

        response = client.get(f"/api/v1/scans/{scan.id}/pages")
        assert response.status_code == 200
        data = response.json()
        assert len(data) == 1
        assert data[0]["url"] == "https://pages-test.com/about"
    finally:
        db.close()


def test_unknown_page_and_scan_returns_404():
    response = client.get("/api/v1/pages/9999999/intelligence")
    assert response.status_code == 404
    assert response.json()["detail"] == "Page not found"

    response = client.get("/api/v1/pages/9999999/extraction")
    assert response.status_code == 404
    assert response.json()["detail"] == "Page not found"

    response = client.get("/api/v1/pages/9999999/metadata")
    assert response.status_code == 404
    assert response.json()["detail"] == "Page not found"

    response = client.get("/api/v1/pages/9999999/headings")
    assert response.status_code == 404
    assert response.json()["detail"] == "Page not found"

    response = client.get("/api/v1/pages/9999999/structured-data")
    assert response.status_code == 404
    assert response.json()["detail"] == "Page not found"

    response = client.get("/api/v1/pages/9999999/links")
    assert response.status_code == 404
    assert response.json()["detail"] == "Page not found"

    response = client.get("/api/v1/pages/9999999/images")
    assert response.status_code == 404
    assert response.json()["detail"] == "Page not found"

    response = client.get("/api/v1/pages/9999999/indexability")
    assert response.status_code == 404
    assert response.json()["detail"] == "Page not found"

    response = client.get("/api/v1/scans/9999999/page-intelligence")
    assert response.status_code == 404
    assert response.json()["detail"] == "Scan not found"


def test_page_result_with_no_extraction_handled_cleanly():
    db = SessionLocal()
    try:
        website, scan = _create_test_website_and_scan(db, "No Extraction Site", "https://no-ext.com")
        page = PageResult(
            scan_id=scan.id,
            url="https://no-ext.com/page-1",
            status_code=200,
            content_type="text/html",
            depth=0,
        )
        db.add(page)
        db.commit()
        db.refresh(page)

        # Intelligence endpoint returns page info with null extraction and empty collections
        intel_resp = client.get(f"/api/v1/pages/{page.id}/intelligence")
        assert intel_resp.status_code == 200
        intel_data = intel_resp.json()
        assert intel_data["page_result_id"] == page.id
        assert intel_data["url"] == "https://no-ext.com/page-1"
        assert intel_data["extraction"] is None
        assert intel_data["headings"] == []
        assert intel_data["images"] == []
        assert intel_data["links"] == []
        assert intel_data["robots"] is None

        # Extraction-specific sub-endpoints return 404 ("Page extraction not found")
        ext_resp = client.get(f"/api/v1/pages/{page.id}/extraction")
        assert ext_resp.status_code == 404
        assert ext_resp.json()["detail"] == "Page extraction not found"

        meta_resp = client.get(f"/api/v1/pages/{page.id}/metadata")
        assert meta_resp.status_code == 404
        assert meta_resp.json()["detail"] == "Page extraction not found"

        headings_resp = client.get(f"/api/v1/pages/{page.id}/headings")
        assert headings_resp.status_code == 404
        assert headings_resp.json()["detail"] == "Page extraction not found"

        sd_resp = client.get(f"/api/v1/pages/{page.id}/structured-data")
        assert sd_resp.status_code == 404
        assert sd_resp.json()["detail"] == "Page extraction not found"

        links_resp = client.get(f"/api/v1/pages/{page.id}/links")
        assert links_resp.status_code == 404
        assert links_resp.json()["detail"] == "Page extraction not found"

        images_resp = client.get(f"/api/v1/pages/{page.id}/images")
        assert images_resp.status_code == 404
        assert images_resp.json()["detail"] == "Page extraction not found"

        idx_resp = client.get(f"/api/v1/pages/{page.id}/indexability")
        assert idx_resp.status_code == 404
        assert idx_resp.json()["detail"] == "Page extraction not found"
    finally:
        db.close()


def test_full_page_extraction_and_sub_endpoints():
    db = SessionLocal()
    try:
        website, scan = _create_test_website_and_scan(db, "Full Extraction Site", "https://full-ext.com")
        page = PageResult(
            scan_id=scan.id,
            url="https://full-ext.com/product",
            status_code=200,
            content_type="text/html",
            depth=1,
        )
        db.add(page)
        db.commit()
        db.refresh(page)

        extraction = PageExtraction(
            page_result_id=page.id,
            scan_id=scan.id,
            html_available=True,
            clean_text_available=True,
            word_count=520,
            detected_language="en",
            extraction_status="success",
        )
        db.add(extraction)
        db.commit()
        db.refresh(extraction)

        # Meta description
        meta_desc = PageMetaDescription(
            page_extraction_id=extraction.id,
            position=0,
            text="High quality enterprise analytics platform.",
            length=43,
            word_count=5,
            empty=False,
        )
        # Headings
        h1 = PageHeading(
            page_extraction_id=extraction.id,
            level=1,
            text="Enterprise AI Intelligence",
            position=0,
            empty=False,
        )
        h2 = PageHeading(
            page_extraction_id=extraction.id,
            level=2,
            text="Features Overview",
            position=1,
            empty=False,
        )
        # Canonical
        canonical = PageCanonical(
            page_extraction_id=extraction.id,
            position=0,
            url="https://full-ext.com/product",
            empty=False,
            valid=True,
            self_reference=True,
            cross_page=False,
        )
        # Robots
        robots = PageRobots(
            page_extraction_id=extraction.id,
            raw_content="index, follow",
            index=True,
            follow=True,
            noindex=False,
            nofollow=False,
        )
        # Social metadata
        og_title = PageSocialMetadata(
            page_extraction_id=extraction.id,
            platform="open_graph",
            property_name="og:title",
            content="Enterprise AI",
            position=0,
        )
        # Structured Data
        sd = PageStructuredData(
            page_extraction_id=extraction.id,
            block_position=0,
            raw_block='{"@context": "https://schema.org", "@type": "Product", "name": "AI Platform"}',
            parsed_json={"@context": "https://schema.org", "@type": "Product", "name": "AI Platform"},
            context="https://schema.org",
            types=["Product"],
            entity_names=["AI Platform"],
        )
        # Microdata
        microdata = PageMicrodata(
            page_extraction_id=extraction.id,
            item_position=0,
            item_type="https://schema.org/Product",
            properties={"name": "AI Platform"},
        )
        # Breadcrumbs
        bc = PageBreadcrumb(
            page_extraction_id=extraction.id,
            position=0,
            detection_method="json_ld",
            name="Home",
            url="https://full-ext.com",
        )
        # Image
        img = PageImage(
            page_extraction_id=extraction.id,
            position=0,
            url="https://full-ext.com/img/hero.png",
            alt="Hero diagram",
            width=800,
            height=600,
            file_type="png",
            loading="lazy",
            lazy_loaded=True,
        )
        # Link
        link = PageLink(
            page_extraction_id=extraction.id,
            position=0,
            source_url="https://full-ext.com/product",
            destination_url="https://full-ext.com/docs",
            anchor_text="Read Docs",
            link_type="internal",
            nofollow=False,
        )
        # Language
        lang = PageLanguage(
            page_extraction_id=extraction.id,
            html_lang="en-US",
            detected_language="en",
        )
        # Hreflang
        hreflang = PageHreflang(
            page_extraction_id=extraction.id,
            position=0,
            language_region="en-us",
            target_url="https://full-ext.com/product",
        )
        # Indexability
        idx = PageIndexabilityEvidence(
            page_extraction_id=extraction.id,
            http_status=200,
            robots_txt_allowed=True,
            page_noindex=False,
            page_nofollow=False,
            canonical_url="https://full-ext.com/product",
            redirected=False,
            final_url="https://full-ext.com/product",
            content_type="text/html",
        )

        db.add_all([
            meta_desc, h1, h2, canonical, robots, og_title,
            sd, microdata, bc, img, link, lang, hreflang, idx,
        ])
        db.commit()

        # 1. Extraction endpoint
        ext_resp = client.get(f"/api/v1/pages/{page.id}/extraction")
        assert ext_resp.status_code == 200
        assert ext_resp.json()["word_count"] == 520
        assert ext_resp.json()["detected_language"] == "en"

        # 2. Metadata endpoint
        meta_resp = client.get(f"/api/v1/pages/{page.id}/metadata")
        assert meta_resp.status_code == 200
        meta_data = meta_resp.json()
        assert meta_data["page_result_id"] == page.id
        assert len(meta_data["meta_descriptions"]) == 1
        assert meta_data["meta_descriptions"][0]["text"] == "High quality enterprise analytics platform."
        assert len(meta_data["social_metadata"]) == 1
        assert meta_data["social_metadata"][0]["property_name"] == "og:title"
        assert meta_data["robots"]["index"] is True
        assert meta_data["language"]["html_lang"] == "en-US"
        assert len(meta_data["canonicals"]) == 1

        # 3. Headings endpoint
        headings_resp = client.get(f"/api/v1/pages/{page.id}/headings")
        assert headings_resp.status_code == 200
        headings_data = headings_resp.json()
        assert len(headings_data) == 2
        assert headings_data[0]["level"] == 1
        assert headings_data[0]["text"] == "Enterprise AI Intelligence"
        assert headings_data[1]["level"] == 2

        # 4. Structured data endpoint
        sd_resp = client.get(f"/api/v1/pages/{page.id}/structured-data")
        assert sd_resp.status_code == 200
        sd_data = sd_resp.json()
        assert len(sd_data) == 1
        assert sd_data[0]["types"] == ["Product"]

        # 5. Links endpoint
        links_resp = client.get(f"/api/v1/pages/{page.id}/links")
        assert links_resp.status_code == 200
        links_data = links_resp.json()
        assert len(links_data) == 1
        assert links_data[0]["anchor_text"] == "Read Docs"

        # 6. Images endpoint
        images_resp = client.get(f"/api/v1/pages/{page.id}/images")
        assert images_resp.status_code == 200
        images_data = images_resp.json()
        assert len(images_data) == 1
        assert images_data[0]["alt"] == "Hero diagram"
        assert images_data[0]["lazy_loaded"] is True

        # 7. Indexability endpoint
        idx_resp = client.get(f"/api/v1/pages/{page.id}/indexability")
        assert idx_resp.status_code == 200
        idx_data = idx_resp.json()
        assert idx_data["http_status"] == 200
        assert idx_data["page_noindex"] is False

        # 8. Full Intelligence endpoint
        intel_resp = client.get(f"/api/v1/pages/{page.id}/intelligence")
        assert intel_resp.status_code == 200
        intel_data = intel_resp.json()
        assert intel_data["page_result_id"] == page.id
        assert intel_data["url"] == "https://full-ext.com/product"
        assert intel_data["extraction"]["word_count"] == 520
        assert len(intel_data["headings"]) == 2
        assert len(intel_data["images"]) == 1
        assert len(intel_data["links"]) == 1
        assert len(intel_data["structured_data"]) == 1
        assert len(intel_data["microdata"]) == 1
        assert len(intel_data["breadcrumbs"]) == 1
        assert intel_data["robots"]["follow"] is True

        # 9. Scan Page Intelligence endpoint
        scan_intel_resp = client.get(f"/api/v1/scans/{scan.id}/page-intelligence")
        assert scan_intel_resp.status_code == 200
        scan_intel_data = scan_intel_resp.json()
        assert len(scan_intel_data) == 1
        assert scan_intel_data[0]["page_result_id"] == page.id
    finally:
        db.close()


def test_scan_page_relationship_and_historical_traceability():
    db = SessionLocal()
    try:
        website, scan1 = _create_test_website_and_scan(db, "Trace Site", "https://trace-site.com")
        scan2 = Scan(website_id=website.id, status="completed", pages_crawled=1)
        db.add(scan2)
        db.commit()
        db.refresh(scan2)

        page1 = PageResult(scan_id=scan1.id, url="https://trace-site.com/home", status_code=200)
        page2 = PageResult(scan_id=scan2.id, url="https://trace-site.com/home", status_code=200)
        db.add_all([page1, page2])
        db.commit()
        db.refresh(page1)
        db.refresh(page2)

        ext1 = PageExtraction(page_result_id=page1.id, scan_id=scan1.id, word_count=100)
        ext2 = PageExtraction(page_result_id=page2.id, scan_id=scan2.id, word_count=200)
        db.add_all([ext1, ext2])
        db.commit()

        # Scan 1 pages intelligence
        resp1 = client.get(f"/api/v1/scans/{scan1.id}/page-intelligence")
        assert resp1.status_code == 200
        data1 = resp1.json()
        assert len(data1) == 1
        assert data1[0]["scan_id"] == scan1.id
        assert data1[0]["page_result_id"] == page1.id
        assert data1[0]["extraction"]["word_count"] == 100

        # Scan 2 pages intelligence
        resp2 = client.get(f"/api/v1/scans/{scan2.id}/page-intelligence")
        assert resp2.status_code == 200
        data2 = resp2.json()
        assert len(data2) == 1
        assert data2[0]["scan_id"] == scan2.id
        assert data2[0]["page_result_id"] == page2.id
        assert data2[0]["extraction"]["word_count"] == 200
    finally:
        db.close()


def test_api_with_page_extractor_pipeline():
    from app.page_extractor import extract_page

    db = SessionLocal()
    try:
        website, scan = _create_test_website_and_scan(db, "Pipeline Test Site", "https://pipe-test.com")
        raw_html = """<html lang="en">
        <head>
        <title>Pricing & Plans | Raval AI Intelligence</title>
        <meta name="description" content="Discover powerful GEO and SEO intelligence tools and pricing plans.">
        <link rel="canonical" href="https://pipe-test.com/pricing">
        <meta name="robots" content="index, follow, noarchive">
        <meta property="og:title" content="Raval AI Pricing">
        <meta property="og:type" content="website">
        <meta property="og:image" content="https://pipe-test.com/og.jpg">
        <meta name="twitter:card" content="summary_large_image">
        <meta name="twitter:title" content="Raval AI Pricing Card">
        <link rel="alternate" hreflang="en-GB" href="https://pipe-test.com/uk/pricing">
        <script type="application/ld+json">
        {
            "@context": "https://schema.org",
            "@type": "Product",
            "name": "Raval Pro",
            "url": "https://pipe-test.com/pricing"
        }
        </script>
        </head>
        <body>
        <nav aria-label="breadcrumb">
            <a href="/">Home</a> &gt; <a href="/pricing">Pricing</a>
        </nav>
        <h1>Pricing Matrix</h1>
        <h2>Starter Tier</h2>
        <p>Affordable AI search intelligence for growing brands.</p>
        <img src="/img/pricing-table.png" alt="Pricing Table" width="600" height="400">
        <a href="https://external-checkout.com/buy" rel="nofollow">Checkout Now</a>
        <div itemscope itemtype="https://schema.org/Offer">
            <span itemprop="price">$49</span>
        </div>
        </body>
        </html>"""

        page = PageResult(
            scan_id=scan.id,
            url="https://pipe-test.com/pricing",
            status_code=200,
            content_type="text/html",
            content=raw_html,
        )
        db.add(page)
        db.commit()
        db.refresh(page)

        # Run extraction
        extract_page(db, page)

        # Verify via Intelligence endpoint
        intel_resp = client.get(f"/api/v1/pages/{page.id}/intelligence")
        assert intel_resp.status_code == 200
        intel = intel_resp.json()
        assert intel["extraction"]["title_text"] == "Pricing & Plans | Raval AI Intelligence"
        assert intel["extraction"]["title_present"] is True
        assert intel["extraction"]["canonical_present"] is True
        assert intel["extraction"]["image_count"] == 1
        assert intel["extraction"]["images_without_alt"] == 0
        assert len(intel["canonicals"]) == 1
        assert intel["canonicals"][0]["url"] == "https://pipe-test.com/pricing"
        assert intel["canonicals"][0]["self_reference"] is True
        assert intel["robots"]["index"] is True
        assert intel["robots"]["follow"] is True
        assert intel["robots"]["noarchive"] is True
        assert len(intel["meta_descriptions"]) == 1
        assert "GEO and SEO intelligence" in intel["meta_descriptions"][0]["text"]
        assert len(intel["headings"]) == 2
        assert intel["headings"][0]["text"] == "Pricing Matrix"
        assert len(intel["social_metadata"]) == 5
        assert len(intel["structured_data"]) == 1
        assert intel["structured_data"][0]["types"] == ["Product"]
        assert len(intel["microdata"]) == 1
        assert len(intel["breadcrumbs"]) == 2
        assert len(intel["images"]) == 1
        assert intel["images"][0]["alt"] == "Pricing Table"
        assert len(intel["links"]) == 3
        assert len(intel["hreflang"]) == 1
        assert intel["language"]["html_lang"] == "en"

        # Verify via Metadata endpoint
        meta_resp = client.get(f"/api/v1/pages/{page.id}/metadata")
        assert meta_resp.status_code == 200
        meta = meta_resp.json()
        assert meta["title_present"] is True
        assert meta["title_text"] == "Pricing & Plans | Raval AI Intelligence"
        assert meta["robots"]["noarchive"] is True
        assert len(meta["canonicals"]) == 1
        assert len(meta["social_metadata"]) == 5
        assert len(meta["hreflang"]) == 1

        # Verify via Dedicated Endpoints
        sd_resp = client.get(f"/api/v1/pages/{page.id}/structured-data")
        assert sd_resp.status_code == 200
        assert len(sd_resp.json()) == 1

        links_resp = client.get(f"/api/v1/pages/{page.id}/links")
        assert links_resp.status_code == 200
        assert len(links_resp.json()) == 3

        images_resp = client.get(f"/api/v1/pages/{page.id}/images")
        assert images_resp.status_code == 200
        assert len(images_resp.json()) == 1

        # Verify via Indexability endpoint
        idx_resp = client.get(f"/api/v1/pages/{page.id}/indexability")
        assert idx_resp.status_code == 200
        idx_data = idx_resp.json()
        assert idx_data["http_status"] == 200
        assert idx_data["page_noindex"] is False
        assert idx_data["canonical_url"] == "https://pipe-test.com/pricing"
        assert idx_data["evidence_summary"]["has_content"] is True

        # Verify via Extraction endpoint
        ext_resp = client.get(f"/api/v1/pages/{page.id}/extraction")
        assert ext_resp.status_code == 200
        ext = ext_resp.json()
        assert ext["canonical_present"] is True
        assert ext["canonical_count"] == 1
        assert ext["canonical_conflict"] is False
        assert ext["missing_h1"] is False
        assert ext["image_count"] == 1

        # Verify via Scan Page Intelligence endpoint
        scan_intel_resp = client.get(f"/api/v1/scans/{scan.id}/page-intelligence")
        assert scan_intel_resp.status_code == 200
        scan_intel = scan_intel_resp.json()
        assert len(scan_intel) == 1
        assert scan_intel[0]["indexability_evidence"]["http_status"] == 200
    finally:
        db.close()

