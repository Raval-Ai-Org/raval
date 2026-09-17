from fastapi.testclient import TestClient
import pytest
from sqlalchemy.orm import Session

from app.content_structure_analyzer import (
    ContentStructureAnalyzer,
    analyze_content_structure,
    evaluate_title_h1_alignment,
)
from app.database import SessionLocal
from app.main import app
from app.models import PageExtraction, PageHeading, PageResult, Scan, Website

client = TestClient(app)


# 1. Normal structured article
def test_normal_structured_article():
    html = """
    <!DOCTYPE html>
    <html>
    <head><title>Comprehensive Guide to Solar Energy | EcoGuide</title></head>
    <body>
        <header>
            <h1>Comprehensive Guide to Solar Energy</h1>
        </header>
        <main>
            <p>Solar energy is one of the cleanest and most abundant renewable energy sources available today.</p>
            <h2>How Solar Panels Work</h2>
            <p>Photovoltaic cells absorb sunlight and generate direct electrical current.</p>
            <h3>Photovoltaic Cells</h3>
            <p>Silicon semiconductors form the core foundation of modern photovoltaic panels.</p>
            <h3>Inverters and Storage</h3>
            <p>Inverters convert DC electricity into alternating current used by household appliances.</p>
            <h2>Benefits of Solar Power</h2>
            <p>Switching to clean energy reduces household carbon footprints significantly.</p>
            <ul>
                <li>Lower electricity bills</li>
                <li>Reduced emissions</li>
                <li>Increased home valuation</li>
            </ul>
        </main>
    </body>
    </html>
    """
    evidence = analyze_content_structure(html, title="Comprehensive Guide to Solar Energy | EcoGuide")

    assert evidence.h1_count == 1
    assert evidence.has_h1 is True
    assert evidence.multiple_h1 is False
    assert evidence.missing_h1 is False
    assert evidence.heading_levels["h1"] == 1
    assert evidence.heading_levels["h2"] == 2
    assert evidence.heading_levels["h3"] == 2
    assert evidence.total_headings == 5

    # Hierarchy is valid
    assert evidence.heading_hierarchy_valid is True
    assert len(evidence.heading_level_skips) == 0

    # No repeated headings
    assert len(evidence.repeated_headings) == 0

    # Lists present
    assert evidence.list_present is True
    assert evidence.unordered_list_present is True
    assert evidence.ordered_list_present is False
    assert evidence.unordered_list_count == 1
    assert evidence.total_list_item_count == 3

    # Title / H1 alignment
    assert evidence.title_h1_alignment is not None
    assert evidence.title_h1_alignment["aligned"] is True
    assert evidence.title_h1_alignment["h1_in_title"] is True

    # No empty or thin sections
    assert len(evidence.empty_sections) == 0
    assert len(evidence.thin_sections) == 0
    assert len(evidence.long_text_blocks) == 0


# 2. Multiple heading levels
def test_multiple_heading_levels():
    html = """
    <html>
    <body>
        <h1>Main Topic</h1>
        <p>Introduction text here.</p>
        <h2>Sub Topic 1</h2>
        <p>Section 1 text here.</p>
        <h3>Sub-Sub Topic 1.1</h3>
        <p>Details text here.</p>
        <h4>Deep Topic 1.1.1</h4>
        <p>Deep details here.</p>
        <h5>Very Deep Topic 1.1.1.1</h5>
        <p>Fine grained details here.</p>
        <h2>Sub Topic 2</h2>
        <p>Section 2 text here.</p>
    </body>
    </html>
    """
    evidence = analyze_content_structure(html)

    assert evidence.heading_levels["h1"] == 1
    assert evidence.heading_levels["h2"] == 2
    assert evidence.heading_levels["h3"] == 1
    assert evidence.heading_levels["h4"] == 1
    assert evidence.heading_levels["h5"] == 1
    assert evidence.heading_levels["h6"] == 0
    assert evidence.total_headings == 6
    assert evidence.heading_hierarchy_valid is True
    assert len(evidence.heading_level_skips) == 0


# 3. Heading level skip
def test_heading_level_skip():
    # H1 followed immediately by H3 (skipping H2), then H3 followed by H5 (skipping H4)
    html = """
    <html>
    <body>
        <h1>Main Topic</h1>
        <p>Intro text.</p>
        <h3>Skipped Level Topic</h3>
        <p>This jumped straight from H1 to H3.</p>
        <h5>Another Skipped Topic</h5>
        <p>This jumped from H3 to H5.</p>
    </body>
    </html>
    """
    evidence = analyze_content_structure(html)

    assert evidence.heading_hierarchy_valid is False
    assert len(evidence.heading_level_skips) == 2

    skip1 = evidence.heading_level_skips[0]
    assert skip1["previous_level"] == 1
    assert skip1["current_level"] == 3
    assert skip1["skipped_levels"] == [2]

    skip2 = evidence.heading_level_skips[1]
    assert skip2["previous_level"] == 3
    assert skip2["current_level"] == 5
    assert skip2["skipped_levels"] == [4]


# 4. Repeated headings
def test_repeated_headings():
    html = """
    <html>
    <body>
        <h1>Product Review</h1>
        <h2>Overview</h2>
        <p>First overview section.</p>
        <h2>Features</h2>
        <p>Features list.</p>
        <h2>Overview</h2>
        <p>Duplicate overview section.</p>
        <h3>Overview</h3>
        <p>Another duplicate at H3.</p>
    </body>
    </html>
    """
    evidence = analyze_content_structure(html)

    assert len(evidence.repeated_headings) == 1
    rep = evidence.repeated_headings[0]
    assert rep["text"].lower() == "overview"
    assert rep["count"] == 3
    assert rep["levels"] == [2, 2, 3]


# 5. Thin and empty sections
def test_thin_and_empty_sections():
    html = """
    <html>
    <body>
        <h1>Article Title</h1>
        <p>Proper intro paragraph with enough words to be considered a substantial opening section.</p>
        <h2>Empty Section</h2>
        <h2>Thin Section</h2>
        <p>Only three words.</p>
        <h2>Normal Section</h2>
        <p>This section has plenty of words and paragraphs to qualify as normal healthy content for the reader.</p>
    </body>
    </html>
    """
    evidence = analyze_content_structure(html)

    assert len(evidence.empty_sections) == 1
    assert evidence.empty_sections[0]["heading_text"] == "Empty Section"

    assert len(evidence.thin_sections) == 1
    assert evidence.thin_sections[0]["heading_text"] == "Thin Section"
    assert evidence.thin_sections[0]["word_count"] == 3


# 6. Long text block
def test_long_text_block():
    long_paragraph = "word " * 160
    html = f"""
    <html>
    <body>
        <h1>Article</h1>
        <p>{long_paragraph}</p>
        <p>Short follow-up paragraph.</p>
    </body>
    </html>
    """
    evidence = analyze_content_structure(html)

    assert len(evidence.long_text_blocks) == 1
    assert evidence.long_text_blocks[0]["word_count"] == 160
    assert evidence.long_text_blocks[0]["paragraph_position"] == 1


# 7. Unordered list presence
def test_unordered_list_presence():
    html = """
    <html>
    <body>
        <h1>Checklist</h1>
        <ul>
            <li>Item A</li>
            <li>Item B</li>
            <li>Item C</li>
        </ul>
    </body>
    </html>
    """
    evidence = analyze_content_structure(html)

    assert evidence.list_present is True
    assert evidence.unordered_list_present is True
    assert evidence.ordered_list_present is False
    assert evidence.unordered_list_count == 1
    assert evidence.total_list_item_count == 3


# 8. Ordered list presence
def test_ordered_list_presence():
    html = """
    <html>
    <body>
        <h1>Step by Step Tutorial</h1>
        <ol>
            <li>Step 1: Download package</li>
            <li>Step 2: Run installation</li>
            <li>Step 3: Verify setup</li>
            <li>Step 4: Launch application</li>
        </ol>
    </body>
    </html>
    """
    evidence = analyze_content_structure(html)

    assert evidence.list_present is True
    assert evidence.unordered_list_present is False
    assert evidence.ordered_list_present is True
    assert evidence.ordered_list_count == 1
    assert evidence.total_list_item_count == 4


# 9. Title and H1 alignment
def test_title_h1_alignment():
    # Direct substring / branding match
    title = "Best Running Shoes for Marathon Training | ShoeHub"
    h1 = "Best Running Shoes for Marathon Training"
    alignment = evaluate_title_h1_alignment(title, h1)

    assert alignment is not None
    assert alignment["aligned"] is True
    assert alignment["h1_in_title"] is True
    assert alignment["token_overlap_ratio"] == 1.0


# 10. Title and H1 mismatch
def test_title_h1_mismatch():
    title = "Customer Support and Contact Information | Brand"
    h1 = "Enterprise Cloud Security Pricing Plans"
    alignment = evaluate_title_h1_alignment(title, h1)

    assert alignment is not None
    assert alignment["aligned"] is False
    assert alignment["exact_match"] is False
    assert alignment["h1_in_title"] is False
    assert alignment["title_in_h1"] is False
    assert alignment["token_overlap_ratio"] < 0.5


# 11. False-positive prevention: upward heading traversal is valid
def test_false_positive_prevention_upward_heading():
    # In valid outlining: H1 -> H2 -> H3 -> H3 -> H2 (stepping back up from H3 to H2 is NOT a skip)
    html = """
    <html>
    <body>
        <h1>Main Topic</h1>
        <h2>Section 1</h2>
        <h3>Sub Section 1.1</h3>
        <h3>Sub Section 1.2</h3>
        <h2>Section 2</h2>
        <p>Back to H2 outline level.</p>
    </body>
    </html>
    """
    evidence = analyze_content_structure(html)

    assert evidence.heading_hierarchy_valid is True
    assert len(evidence.heading_level_skips) == 0


# 12. Multiple H1 detection
def test_multiple_h1_detection():
    html = """
    <html>
    <body>
        <h1>First Main Title</h1>
        <p>Text.</p>
        <h1>Second Main Title</h1>
        <p>More text.</p>
    </body>
    </html>
    """
    evidence = analyze_content_structure(html)

    assert evidence.h1_count == 2
    assert evidence.multiple_h1 is True
    assert evidence.has_h1 is True
    assert evidence.missing_h1 is False


# 13. Missing H1 detection
def test_missing_h1_detection():
    html = """
    <html>
    <body>
        <h2>Started with H2</h2>
        <p>Some text.</p>
    </body>
    </html>
    """
    evidence = analyze_content_structure(html)

    assert evidence.h1_count == 0
    assert evidence.has_h1 is False
    assert evidence.missing_h1 is True
    assert evidence.heading_hierarchy_valid is False
    assert len(evidence.heading_level_skips) == 1
    assert evidence.heading_level_skips[0]["type"] == "initial_level_skip"


# 14. Database and API Integration Test
def test_page_content_structure_endpoint():
    db = SessionLocal()
    try:
        website = Website(name="Structure API Site", url="https://structure-api.com")
        db.add(website)
        db.commit()
        db.refresh(website)

        scan = Scan(website_id=website.id, status="completed")
        db.add(scan)
        db.commit()
        db.refresh(scan)

        html_content = """
        <html>
        <head><title>API Structure Test Page</title></head>
        <body>
            <h1>API Structure Test Page</h1>
            <p>This is a paragraph with sufficient words to demonstrate API structural analysis.</p>
            <h2>Features List</h2>
            <ul>
                <li>High speed</li>
                <li>Reliable</li>
            </ul>
        </body>
        </html>
        """

        page = PageResult(
            scan_id=scan.id,
            url="https://structure-api.com/test",
            status_code=200,
            content=html_content,
        )
        db.add(page)
        db.commit()
        db.refresh(page)

        # Also create a PageExtraction record to simulate Task 4 output
        extraction = PageExtraction(
            page_result_id=page.id,
            scan_id=scan.id,
            title_text="API Structure Test Page",
            h1_count=1,
        )
        db.add(extraction)
        db.commit()
        db.refresh(extraction)

        response = client.get(f"/api/v1/pages/{page.id}/content-structure")
        assert response.status_code == 200
        data = response.json()

        assert data["h1_count"] == 1
        assert data["has_h1"] is True
        assert data["heading_hierarchy_valid"] is True
        assert data["list_present"] is True
        assert data["unordered_list_count"] == 1
        assert data["title_h1_alignment"]["aligned"] is True

        # Test 404 for unknown page
        res404 = client.get("/api/v1/pages/999999/content-structure")
        assert res404.status_code == 404
    finally:
        db.close()
