import pytest
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.models import (
    PageBreadcrumb,
    PageCanonical,
    PageExtraction,
    PageHeading,
    PageHreflang,
    PageImage,
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
from app.page_extractor import extract_html, extract_page, extract_scan_pages


# ==============================================================================
# TITLE FIXTURES (1 - 8)
# ==============================================================================

def test_1_normal_title():
    html_doc = """<html lang="en">
    <head><title>Raval AI - Advanced GEO and SEO Intelligence Platform</title></head>
    <body><h1>Welcome</h1></body>
    </html>"""
    res = extract_html(html_doc)
    assert res.title_present is True
    assert res.title_text == "Raval AI - Advanced GEO and SEO Intelligence Platform"
    assert res.title_length == len("Raval AI - Advanced GEO and SEO Intelligence Platform")
    assert res.title_word_count == 9
    assert res.title_empty is False
    assert res.title_too_short is False
    assert res.title_too_long is False
    assert res.title_duplicate is False
    assert res.title_count == 1


def test_2_missing_title():
    html_doc = """<html><head></head><body><h1>No Title</h1></body></html>"""
    res = extract_html(html_doc)
    assert res.title_present is False
    assert res.title_text is None
    assert res.title_length == 0
    assert res.title_word_count == 0
    assert res.title_empty is True
    assert res.title_count == 0


def test_3_empty_title():
    html_doc = """<html><head><title>   </title></head><body><h1>Empty Title</h1></body></html>"""
    res = extract_html(html_doc)
    assert res.title_present is True
    assert res.title_text == ""
    assert res.title_length == 0
    assert res.title_word_count == 0
    assert res.title_empty is True
    assert res.title_count == 1


def test_4_very_short_title():
    html_doc = """<html><head><title>Hi</title></head><body><h1>Short</h1></body></html>"""
    res = extract_html(html_doc)
    assert res.title_present is True
    assert res.title_text == "Hi"
    assert res.title_length == 2
    assert res.title_too_short is True
    assert res.title_too_long is False


def test_5_very_long_title():
    long_title = "A" * 75
    html_doc = f"<html><head><title>{long_title}</title></head><body><h1>Long</h1></body></html>"
    res = extract_html(html_doc)
    assert res.title_present is True
    assert res.title_length == 75
    assert res.title_too_short is False
    assert res.title_too_long is True


def test_6_duplicate_title_across_two_pages_in_same_scan():
    db = SessionLocal()
    try:
        website = Website(name="Duplicate Title Site", url="https://dup-title.com")
        db.add(website)
        db.commit()
        db.refresh(website)

        scan = Scan(website_id=website.id, status="completed", pages_crawled=2)
        db.add(scan)
        db.commit()
        db.refresh(scan)

        p1 = PageResult(
            scan_id=scan.id,
            url="https://dup-title.com/page1",
            content="<html><head><title>Identical Title</title></head><body><h1>Page 1</h1></body></html>",
        )
        p2 = PageResult(
            scan_id=scan.id,
            url="https://dup-title.com/page2",
            content="<html><head><title>Identical Title</title></head><body><h1>Page 2</h1></body></html>",
        )
        db.add_all([p1, p2])
        db.commit()

        extractions = extract_scan_pages(db, scan.id)
        assert len(extractions) == 2
        assert extractions[0].title_duplicate is True
        assert extractions[1].title_duplicate is True
    finally:
        db.close()


def test_7_same_title_across_different_scans_not_duplicate():
    db = SessionLocal()
    try:
        website = Website(name="Cross Scan Site", url="https://cross-scan.com")
        db.add(website)
        db.commit()
        db.refresh(website)

        scan1 = Scan(website_id=website.id, status="completed", pages_crawled=1)
        scan2 = Scan(website_id=website.id, status="completed", pages_crawled=1)
        db.add_all([scan1, scan2])
        db.commit()
        db.refresh(scan1)
        db.refresh(scan2)

        p1 = PageResult(
            scan_id=scan1.id,
            url="https://cross-scan.com/home",
            content="<html><head><title>Unique Within Each Scan</title></head><body><h1>Home</h1></body></html>",
        )
        p2 = PageResult(
            scan_id=scan2.id,
            url="https://cross-scan.com/home",
            content="<html><head><title>Unique Within Each Scan</title></head><body><h1>Home</h1></body></html>",
        )
        db.add_all([p1, p2])
        db.commit()

        ext1 = extract_scan_pages(db, scan1.id)
        ext2 = extract_scan_pages(db, scan2.id)

        assert len(ext1) == 1
        assert len(ext2) == 1
        assert ext1[0].title_duplicate is False
        assert ext2[0].title_duplicate is False
    finally:
        db.close()


def test_8_multiple_title_elements():
    html_doc = """<html>
    <head>
    <title>First Title</title>
    <title>Second Title</title>
    </head>
    <body><h1>Multi Title</h1></body>
    </html>"""
    res = extract_html(html_doc)
    assert res.title_present is True
    assert res.title_text == "First Title"
    assert res.title_count == 2
    assert res.title_duplicate is True


# ==============================================================================
# META DESCRIPTION FIXTURES (9 - 16)
# ==============================================================================

def test_9_normal_description():
    desc_str = "Comprehensive AI and search intelligence platform for enterprise visibility and analytics."
    html_doc = f"""<html>
    <head><meta name="description" content="{desc_str}"></head>
    <body><h1>Description</h1></body>
    </html>"""
    res = extract_html(html_doc)
    assert res.meta_description_present is True
    assert res.meta_description_count == 1
    assert len(res.meta_descriptions) == 1
    item = res.meta_descriptions[0]
    assert item.text == desc_str
    assert item.length == len(desc_str)
    assert item.word_count == 11
    assert item.empty is False
    assert item.too_short is False
    assert item.too_long is False
    assert item.duplicate_within_page is False


def test_10_missing_description():
    html_doc = "<html><head><title>Test</title></head><body><h1>No Description</h1></body></html>"
    res = extract_html(html_doc)
    assert res.meta_description_present is False
    assert res.meta_description_count == 0
    assert len(res.meta_descriptions) == 0


def test_11_empty_description():
    html_doc = '<html><head><meta name="description" content="   "></head><body><h1>Empty</h1></body></html>'
    res = extract_html(html_doc)
    assert res.meta_description_present is True
    assert res.meta_description_count == 1
    assert res.meta_descriptions[0].empty is True
    assert res.meta_descriptions[0].length == 0


def test_12_multiple_descriptions():
    html_doc = """<html>
    <head>
    <meta name="description" content="First description tag.">
    <meta name="description" content="Second description tag.">
    </head>
    <body><h1>Multi Desc</h1></body>
    </html>"""
    res = extract_html(html_doc)
    assert res.meta_description_present is True
    assert res.meta_description_count == 2
    assert len(res.meta_descriptions) == 2
    assert res.meta_descriptions[0].text == "First description tag."
    assert res.meta_descriptions[1].text == "Second description tag."


def test_13_duplicate_descriptions_within_same_page():
    html_doc = """<html>
    <head>
    <meta name="description" content="Identical description">
    <meta name="description" content="Identical description">
    </head>
    <body><h1>Dup Desc</h1></body>
    </html>"""
    res = extract_html(html_doc)
    assert res.meta_description_count == 2
    assert res.meta_descriptions[0].duplicate_within_page is True
    assert res.meta_descriptions[1].duplicate_within_page is True


def test_14_duplicate_description_across_same_scan():
    db = SessionLocal()
    try:
        website = Website(name="Dup Desc Site", url="https://dup-desc.com")
        db.add(website)
        db.commit()
        db.refresh(website)

        scan = Scan(website_id=website.id, status="completed", pages_crawled=2)
        db.add(scan)
        db.commit()
        db.refresh(scan)

        p1 = PageResult(
            scan_id=scan.id,
            url="https://dup-desc.com/1",
            content='<html><head><meta name="description" content="Shared cross-page description"></head><body><h1>P1</h1></body></html>',
        )
        p2 = PageResult(
            scan_id=scan.id,
            url="https://dup-desc.com/2",
            content='<html><head><meta name="description" content="Shared cross-page description"></head><body><h1>P2</h1></body></html>',
        )
        db.add_all([p1, p2])
        db.commit()

        extractions = extract_scan_pages(db, scan.id)
        assert len(extractions) == 2
        assert extractions[0].meta_descriptions[0].duplicate_in_scan is True
        assert extractions[1].meta_descriptions[0].duplicate_in_scan is True
    finally:
        db.close()


def test_15_same_description_across_different_scans_not_duplicate():
    db = SessionLocal()
    try:
        website = Website(name="Cross Scan Desc", url="https://cross-scan-desc.com")
        db.add(website)
        db.commit()
        db.refresh(website)

        scan1 = Scan(website_id=website.id, status="completed", pages_crawled=1)
        scan2 = Scan(website_id=website.id, status="completed", pages_crawled=1)
        db.add_all([scan1, scan2])
        db.commit()
        db.refresh(scan1)
        db.refresh(scan2)

        p1 = PageResult(
            scan_id=scan1.id,
            url="https://cross-scan-desc.com/1",
            content='<html><head><meta name="description" content="Unique per scan description"></head><body><h1>P1</h1></body></html>',
        )
        p2 = PageResult(
            scan_id=scan2.id,
            url="https://cross-scan-desc.com/1",
            content='<html><head><meta name="description" content="Unique per scan description"></head><body><h1>P2</h1></body></html>',
        )
        db.add_all([p1, p2])
        db.commit()

        ext1 = extract_scan_pages(db, scan1.id)
        ext2 = extract_scan_pages(db, scan2.id)

        assert ext1[0].meta_descriptions[0].duplicate_in_scan is False
        assert ext2[0].meta_descriptions[0].duplicate_in_scan is False
    finally:
        db.close()


def test_16_description_short_and_long_detection():
    short_doc = '<html><head><meta name="description" content="Too short"></head><body><h1>Short</h1></body></html>'
    res_short = extract_html(short_doc)
    assert res_short.meta_descriptions[0].too_short is True
    assert res_short.meta_descriptions[0].too_long is False

    long_text = "Word " * 45
    long_doc = f'<html><head><meta name="description" content="{long_text}"></head><body><h1>Long</h1></body></html>'
    res_long = extract_html(long_doc)
    assert res_long.meta_descriptions[0].too_short is False
    assert res_long.meta_descriptions[0].too_long is True


# ==============================================================================
# HEADING FIXTURES (17 - 21)
# ==============================================================================

def test_17_normal_h1_h2_h3():
    html_doc = """<html>
    <body>
    <h1>Main Heading</h1>
    <h2>Section 1</h2>
    <h3>Detail 1.1</h3>
    <h2>Section 2</h2>
    </body>
    </html>"""
    res = extract_html(html_doc)
    assert len(res.headings) == 4
    assert res.h1_count == 1
    assert res.missing_h1 is False
    assert res.multiple_h1 is False
    assert res.heading_hierarchy_issue is False


def test_18_missing_h1():
    html_doc = "<html><body><h2>Subheading Only</h2><h3>Detail</h3></body></html>"
    res = extract_html(html_doc)
    assert res.h1_count == 0
    assert res.missing_h1 is True
    assert res.heading_hierarchy_issue is True


def test_19_multiple_h1():
    html_doc = "<html><body><h1>First H1</h1><p>Content</p><h1>Second H1</h1></body></html>"
    res = extract_html(html_doc)
    assert res.h1_count == 2
    assert res.missing_h1 is False
    assert res.multiple_h1 is True


def test_20_empty_heading():
    html_doc = "<html><body><h1>   </h1><h2>Valid H2</h2></body></html>"
    res = extract_html(html_doc)
    assert len(res.headings) == 2
    assert res.headings[0].empty is True
    assert res.headings[0].text == ""
    assert res.headings[1].empty is False
    assert res.headings[1].text == "Valid H2"


def test_21_hierarchy_jump():
    html_doc = "<html><body><h1>Title</h1><h4>Jumped from H1 to H4</h4></body></html>"
    res = extract_html(html_doc)
    assert res.heading_hierarchy_issue is True
    assert any("Skipped heading level" in d.get("issue", "") for d in (res.heading_hierarchy_details or []))


# ==============================================================================
# CANONICAL FIXTURES (22 - 27)
# ==============================================================================

def test_22_normal_self_canonical():
    page_url = "https://example.com/pricing"
    html_doc = '<html lang="en"><head><link rel="canonical" href="https://example.com/pricing"></head><body><h1>Pricing</h1></body></html>'
    res = extract_html(html_doc, page_url=page_url)
    assert res.canonical_present is True
    assert res.canonical_count == 1
    assert res.canonical_multiple is False
    assert res.canonical_conflict is False
    assert len(res.canonicals) == 1
    item = res.canonicals[0]
    assert item.url == "https://example.com/pricing"
    assert item.valid is True
    assert item.empty is False
    assert item.self_reference is True
    assert item.cross_page is False


def test_23_missing_canonical():
    html_doc = "<html><head><title>No Canonical</title></head><body><h1>Hello</h1></body></html>"
    res = extract_html(html_doc, page_url="https://example.com/home")
    assert res.canonical_present is False
    assert res.canonical_count == 0
    assert res.canonical_multiple is False
    assert res.canonical_conflict is False
    assert len(res.canonicals) == 0


def test_24_multiple_canonicals():
    html_doc = """<html>
    <head>
    <link rel="canonical" href="https://example.com/target-a">
    <link rel="canonical" href="https://example.com/target-b">
    </head>
    <body><h1>Multi Canonical</h1></body>
    </html>"""
    res = extract_html(html_doc, page_url="https://example.com/source")
    assert res.canonical_present is True
    assert res.canonical_count == 2
    assert res.canonical_multiple is True
    assert res.canonical_conflict is True
    assert len(res.canonicals) == 2


def test_25_empty_canonical():
    html_doc = '<html><head><link rel="canonical" href="   "></head><body><h1>Empty Canonical</h1></body></html>'
    res = extract_html(html_doc, page_url="https://example.com/empty")
    assert res.canonical_present is True
    assert res.canonical_count == 1
    assert res.canonicals[0].empty is True
    assert res.canonicals[0].valid is False


def test_26_invalid_canonical():
    html_doc = '<html><head><link rel="canonical" href="http://"></head><body><h1>Invalid</h1></body></html>'
    res = extract_html(html_doc, page_url="https://example.com/test")
    assert res.canonical_present is True
    assert res.canonicals[0].valid is False


def test_27_cross_page_canonical():
    html_doc = '<html lang="en"><head><link rel="canonical" href="https://example.com/canonical-master"></head><body><h1>Duplicate</h1></body></html>'
    res = extract_html(html_doc, page_url="https://example.com/page-variant")
    assert res.canonical_present is True
    assert res.canonicals[0].self_reference is False
    assert res.canonicals[0].cross_page is True
    assert res.canonicals[0].url == "https://example.com/canonical-master"


# ==============================================================================
# ROBOTS FIXTURES (28 - 34)
# ==============================================================================

def test_28_robots_noindex():
    html_doc = '<html><head><meta name="robots" content="noindex, follow"></head><body><h1>Noindex</h1></body></html>'
    res = extract_html(html_doc)
    assert res.robots is not None
    assert res.robots.noindex is True
    assert res.robots.index is False
    assert res.robots.follow is True
    assert res.robots.nofollow is False


def test_29_robots_nofollow():
    html_doc = '<html><head><meta name="robots" content="index, nofollow"></head><body><h1>Nofollow</h1></body></html>'
    res = extract_html(html_doc)
    assert res.robots is not None
    assert res.robots.index is True
    assert res.robots.noindex is False
    assert res.robots.follow is False
    assert res.robots.nofollow is True


def test_30_robots_noarchive():
    html_doc = '<html><head><meta name="robots" content="noarchive"></head><body><h1>Noarchive</h1></body></html>'
    res = extract_html(html_doc)
    assert res.robots is not None
    assert res.robots.noarchive is True


def test_31_robots_nosnippet():
    html_doc = '<html><head><meta name="robots" content="nosnippet"></head><body><h1>Nosnippet</h1></body></html>'
    res = extract_html(html_doc)
    assert res.robots is not None
    assert res.robots.nosnippet is True


def test_32_multiple_robots_directives():
    html_doc = """<html>
    <head>
    <meta name="robots" content="noindex, nofollow, noarchive, nosnippet">
    </head>
    <body><h1>All Directives</h1></body>
    </html>"""
    res = extract_html(html_doc)
    assert res.robots is not None
    assert res.robots.noindex is True
    assert res.robots.nofollow is True
    assert res.robots.noarchive is True
    assert res.robots.nosnippet is True


def test_33_unknown_robots_directive():
    html_doc = '<html><head><meta name="robots" content="noindex, custom-directive, max-snippet:50"></head><body><h1>Custom</h1></body></html>'
    res = extract_html(html_doc)
    assert res.robots is not None
    assert res.robots.noindex is True
    assert "custom-directive" in res.robots.other_directives
    assert "max-snippet:50" in res.robots.other_directives


def test_34_empty_robots_content():
    html_doc = '<html><head><meta name="robots" content=""></head><body><h1>Empty Robots</h1></body></html>'
    res = extract_html(html_doc)
    assert res.robots is not None
    assert res.robots.raw_content == ""
    assert res.robots.noindex is False
    assert res.robots.nofollow is False


# ==============================================================================
# OPEN GRAPH FIXTURES (35 - 38)
# ==============================================================================

def test_35_all_required_og_fields():
    html_doc = """<html>
    <head>
    <meta property="og:title" content="Raval Open Graph Title">
    <meta property="og:description" content="Raval Open Graph Description">
    <meta property="og:image" content="https://example.com/og.png">
    <meta property="og:url" content="https://example.com/page">
    <meta property="og:type" content="website">
    <meta property="og:site_name" content="Raval AI">
    </head>
    <body><h1>OG Content</h1></body>
    </html>"""
    res = extract_html(html_doc)
    og_meta = [m for m in res.social_metadata if m.platform == "open_graph"]
    assert len(og_meta) == 6
    names = {m.property_name for m in og_meta}
    assert names == {
        "og:title",
        "og:description",
        "og:image",
        "og:url",
        "og:type",
        "og:site_name",
    }
    for m in og_meta:
        assert m.empty is False
        assert m.duplicate is False


def test_36_missing_og_fields():
    html_doc = "<html><head><title>No OG</title></head><body><h1>Hello</h1></body></html>"
    res = extract_html(html_doc)
    og_meta = [m for m in res.social_metadata if m.platform == "open_graph"]
    assert len(og_meta) == 0


def test_37_duplicate_og_property():
    html_doc = """<html>
    <head>
    <meta property="og:title" content="First OG Title">
    <meta property="og:title" content="Second OG Title">
    </head>
    <body><h1>Dup OG</h1></body>
    </html>"""
    res = extract_html(html_doc)
    og_meta = [m for m in res.social_metadata if m.platform == "open_graph" and m.property_name == "og:title"]
    assert len(og_meta) == 2
    assert og_meta[0].duplicate is True
    assert og_meta[1].duplicate is True


def test_38_empty_og_content():
    html_doc = '<html><head><meta property="og:title" content=""></head><body><h1>Empty OG</h1></body></html>'
    res = extract_html(html_doc)
    og_meta = [m for m in res.social_metadata if m.platform == "open_graph" and m.property_name == "og:title"]
    assert len(og_meta) == 1
    assert og_meta[0].empty is True


# ==============================================================================
# TWITTER / X FIXTURES (39 - 42)
# ==============================================================================

def test_39_all_required_twitter_fields():
    html_doc = """<html>
    <head>
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="Raval Twitter Card Title">
    <meta name="twitter:description" content="Raval Twitter Description">
    <meta name="twitter:image" content="https://example.com/card.png">
    </head>
    <body><h1>Twitter Content</h1></body>
    </html>"""
    res = extract_html(html_doc)
    tw_meta = [m for m in res.social_metadata if m.platform == "twitter"]
    assert len(tw_meta) == 4
    names = {m.property_name for m in tw_meta}
    assert names == {
        "twitter:card",
        "twitter:title",
        "twitter:description",
        "twitter:image",
    }
    for m in tw_meta:
        assert m.empty is False
        assert m.duplicate is False


def test_40_missing_twitter_fields():
    html_doc = "<html><head><title>No Twitter</title></head><body><h1>Hello</h1></body></html>"
    res = extract_html(html_doc)
    tw_meta = [m for m in res.social_metadata if m.platform == "twitter"]
    assert len(tw_meta) == 0


def test_41_duplicate_twitter_property():
    html_doc = """<html>
    <head>
    <meta name="twitter:title" content="First Title">
    <meta name="twitter:title" content="Second Title">
    </head>
    <body><h1>Dup Twitter</h1></body>
    </html>"""
    res = extract_html(html_doc)
    tw_meta = [m for m in res.social_metadata if m.platform == "twitter" and m.property_name == "twitter:title"]
    assert len(tw_meta) == 2
    assert tw_meta[0].duplicate is True
    assert tw_meta[1].duplicate is True


def test_42_empty_twitter_content():
    html_doc = '<html><head><meta name="twitter:description" content=""></head><body><h1>Empty Twitter</h1></body></html>'
    res = extract_html(html_doc)
    tw_meta = [m for m in res.social_metadata if m.platform == "twitter" and m.property_name == "twitter:description"]
    assert len(tw_meta) == 1
    assert tw_meta[0].empty is True


# ==============================================================================
# JSON-LD / STRUCTURED DATA FIXTURES (43 - 56)
# ==============================================================================

def test_43_valid_single_json_ld_object():
    html_doc = """<html>
    <head>
    <script type="application/ld+json">
    {
        "@context": "https://schema.org",
        "@type": "WebPage",
        "name": "About Us",
        "url": "https://example.com/about"
    }
    </script>
    </head>
    <body><h1>About</h1></body>
    </html>"""
    res = extract_html(html_doc)
    assert len(res.structured_data) == 1
    sd = res.structured_data[0]
    assert sd.context == "https://schema.org"
    assert sd.types == ["WebPage"]
    assert sd.entity_names == ["About Us"]
    assert sd.entity_urls == ["https://example.com/about"]
    assert sd.parse_error is None


def test_44_valid_multiple_json_ld_blocks():
    html_doc = """<html>
    <head>
    <script type="application/ld+json">
    {"@context": "https://schema.org", "@type": "Organization", "name": "Raval AI"}
    </script>
    <script type="application/ld+json">
    {"@context": "https://schema.org", "@type": "Product", "name": "AI Intelligence"}
    </script>
    </head>
    <body><h1>Home</h1></body>
    </html>"""
    res = extract_html(html_doc)
    assert len(res.structured_data) == 2
    assert res.structured_data[0].block_position == 0
    assert res.structured_data[0].types == ["Organization"]
    assert res.structured_data[1].block_position == 1
    assert res.structured_data[1].types == ["Product"]


def test_45_json_ld_array():
    html_doc = """<html>
    <head>
    <script type="application/ld+json">
    [
        {"@context": "https://schema.org", "@type": "LocalBusiness", "name": "Store 1"},
        {"@context": "https://schema.org", "@type": "LocalBusiness", "name": "Store 2"}
    ]
    </script>
    </head>
    <body><h1>Stores</h1></body>
    </html>"""
    res = extract_html(html_doc)
    assert len(res.structured_data) == 1
    sd = res.structured_data[0]
    assert sd.types == ["LocalBusiness"]
    assert sd.entity_names == ["Store 1", "Store 2"]


def test_46_nested_json_ld_object():
    html_doc = """<html>
    <head>
    <script type="application/ld+json">
    {
        "@context": "https://schema.org",
        "@type": "Article",
        "name": "AI Trends 2026",
        "author": {
            "@type": "Person",
            "name": "John Doe",
            "url": "https://example.com/authors/john"
        }
    }
    </script>
    </head>
    <body><h1>Article</h1></body>
    </html>"""
    res = extract_html(html_doc)
    assert len(res.structured_data) == 1
    sd = res.structured_data[0]
    assert "Article" in sd.types
    assert "Person" in sd.types
    assert "AI Trends 2026" in sd.entity_names
    assert "John Doe" in sd.entity_names
    assert "https://example.com/authors/john" in sd.entity_urls


def test_47_nested_json_ld_arrays():
    html_doc = """<html>
    <head>
    <script type="application/ld+json">
    {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        "mainEntity": [
            {
                "@type": "Question",
                "name": "What is GEO?",
                "acceptedAnswer": {
                    "@type": "Answer",
                    "text": "Generative Engine Optimization."
                }
            }
        ]
    }
    </script>
    </head>
    <body><h1>FAQ</h1></body>
    </html>"""
    res = extract_html(html_doc)
    assert len(res.structured_data) == 1
    sd = res.structured_data[0]
    assert "FAQPage" in sd.types
    assert "Question" in sd.types
    assert "Answer" in sd.types
    assert "What is GEO?" in sd.entity_names


def test_48_json_ld_organization_product_article():
    html_doc = """<html>
    <head>
    <script type="application/ld+json">
    {"@context": "https://schema.org", "@type": "Organization", "name": "Corp Inc", "url": "https://corp.com"}
    </script>
    </head>
    <body><h1>Corp</h1></body>
    </html>"""
    res = extract_html(html_doc)
    sd = res.structured_data[0]
    assert sd.types == ["Organization"]
    assert sd.entity_names == ["Corp Inc"]
    assert sd.entity_urls == ["https://corp.com"]


def test_49_json_ld_unknown_schema_type():
    html_doc = """<html>
    <head>
    <script type="application/ld+json">
    {"@context": "https://schema.org", "@type": "CustomEnterpriseSchemaXYZ", "name": "Custom Asset"}
    </script>
    </head>
    <body><h1>Custom</h1></body>
    </html>"""
    res = extract_html(html_doc)
    assert len(res.structured_data) == 1
    assert res.structured_data[0].types == ["CustomEnterpriseSchemaXYZ"]
    assert res.structured_data[0].entity_names == ["Custom Asset"]


def test_50_invalid_json_ld_does_not_crash_scan():
    html_doc = """<html>
    <head>
    <script type="application/ld+json">
    { malformed json, unquoted keys: 123
    </script>
    </head>
    <body><h1>Malformed JSON-LD</h1></body>
    </html>"""
    res = extract_html(html_doc)
    assert len(res.structured_data) == 1
    sd = res.structured_data[0]
    assert sd.parse_error is not None
    assert sd.parsed_json is None
    assert "{ malformed json" in sd.raw_block


# ==============================================================================
# MICRODATA FIXTURES (51 - 56)
# ==============================================================================

def test_51_microdata_itemscope_itemtype():
    html_doc = """<html><body>
    <div itemscope itemtype="https://schema.org/Product">
        <span itemprop="name">Raval GEO Pro</span>
        <span itemprop="price">$99</span>
    </div>
    </body></html>"""
    res = extract_html(html_doc)
    assert len(res.microdata) == 1
    m = res.microdata[0]
    assert m.item_type == "https://schema.org/Product"
    assert m.properties.get("name") == "Raval GEO Pro"
    assert m.properties.get("price") == "$99"


def test_52_multiple_microdata_items_and_itemid():
    html_doc = """<html><body>
    <div itemscope itemtype="https://schema.org/Person" itemid="https://example.com/person/1">
        <span itemprop="name">Alice</span>
    </div>
    <div itemscope itemtype="https://schema.org/Person" itemid="https://example.com/person/2">
        <span itemprop="name">Bob</span>
    </div>
    </body></html>"""
    res = extract_html(html_doc)
    assert len(res.microdata) == 2
    assert res.microdata[0].item_id == "https://example.com/person/1"
    assert res.microdata[0].properties.get("name") == "Alice"
    assert res.microdata[1].item_id == "https://example.com/person/2"
    assert res.microdata[1].properties.get("name") == "Bob"


def test_53_microdata_missing_itemtype_and_malformed():
    html_doc = """<html><body>
    <div itemscope>
        <span itemprop="genericProp">Value</span>
    </div>
    </body></html>"""
    res = extract_html(html_doc)
    assert len(res.microdata) == 1
    assert res.microdata[0].item_type is None
    assert res.microdata[0].properties.get("genericProp") == "Value"


# ==============================================================================
# BREADCRUMB FIXTURES (57 - 60)
# ==============================================================================

def test_57_schema_org_breadcrumb_list():
    html_doc = """<html>
    <head>
    <script type="application/ld+json">
    {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        "itemListElement": [
            {
                "@type": "ListItem",
                "position": 1,
                "name": "Home",
                "item": "https://example.com"
            },
            {
                "@type": "ListItem",
                "position": 2,
                "name": "Products",
                "item": "https://example.com/products"
            }
        ]
    }
    </script>
    </head>
    <body><h1>Breadcrumb Test</h1></body>
    </html>"""
    res = extract_html(html_doc, page_url="https://example.com")
    assert len(res.breadcrumbs) == 2
    assert res.breadcrumbs[0].position == 1
    assert res.breadcrumbs[0].name == "Home"
    assert res.breadcrumbs[0].url == "https://example.com"
    assert res.breadcrumbs[0].detection_method == "schema_org"
    assert res.breadcrumbs[1].position == 2
    assert res.breadcrumbs[1].name == "Products"
    assert res.breadcrumbs[1].url == "https://example.com/products"


def test_58_semantic_html_breadcrumbs():
    html_doc = """<html><body>
    <nav aria-label="breadcrumb">
        <ol class="breadcrumb">
            <li class="breadcrumb-item"><a href="/">Home</a></li>
            <li class="breadcrumb-item"><a href="/solutions">Solutions</a></li>
            <li class="breadcrumb-item active">AI Engine</li>
        </ol>
    </nav>
    <h1>Page</h1>
    </body></html>"""
    res = extract_html(html_doc, page_url="https://example.com/solutions/ai")
    assert len(res.breadcrumbs) >= 2
    assert res.breadcrumbs[0].detection_method == "semantic_html"
    assert res.breadcrumbs[0].name == "Home"
    assert res.breadcrumbs[0].url == "https://example.com/"
    assert res.breadcrumbs[1].name == "Solutions"
    assert res.breadcrumbs[1].url == "https://example.com/solutions"


def test_59_uncertain_nav_not_breadcrumbs():
    html_doc = """<html><body>
    <header>
        <nav class="main-navigation-menu">
            <a href="/about">About Us</a>
            <a href="/contact">Contact</a>
        </nav>
    </header>
    <h1>Main</h1>
    </body></html>"""
    res = extract_html(html_doc, page_url="https://example.com/home")
    # Generic nav menu must not be classified as breadcrumbs
    assert len(res.breadcrumbs) == 0


# ==============================================================================
# IMAGE FIXTURES (61 - 70)
# ==============================================================================

def test_61_normal_image_with_alt_and_dimensions():
    html_doc = """<html><body>
    <img src="/img/diagram.png" alt="Architecture Diagram" width="800" height="600" loading="lazy">
    </body></html>"""
    res = extract_html(html_doc, page_url="https://example.com")
    assert len(res.images) == 1
    assert res.image_count == 1
    assert res.images_without_alt == 0
    img = res.images[0]
    assert img.url == "https://example.com/img/diagram.png"
    assert img.alt == "Architecture Diagram"
    assert img.alt_missing is False
    assert img.alt_empty is False
    assert img.width == 800
    assert img.height == 600
    assert img.file_type == "png"
    assert img.loading == "lazy"
    assert img.lazy_loaded is True


def test_62_missing_alt_vs_empty_alt():
    html_doc = """<html><body>
    <img src="/img/no-alt.jpg">
    <img src="/img/empty-alt.jpg" alt="">
    </body></html>"""
    res = extract_html(html_doc, page_url="https://example.com")
    assert len(res.images) == 2
    assert res.image_count == 2
    assert res.images_without_alt == 1  # only first image has missing alt

    assert res.images[0].alt_missing is True
    assert res.images[0].alt_empty is False

    assert res.images[1].alt_missing is False
    assert res.images[1].alt_empty is True
    assert res.images[1].alt == ""


def test_63_multiple_images_relative_and_no_src():
    html_doc = """<html><body>
    <img src="banner.webp" alt="Banner">
    <img data-src="deferred.svg" alt="Deferred Vector">
    <img alt="Missing Src">
    </body></html>"""
    res = extract_html(html_doc, page_url="https://example.com/subpage/")
    assert len(res.images) == 3
    assert res.images[0].url == "https://example.com/subpage/banner.webp"
    assert res.images[0].file_type == "webp"
    assert res.images[1].url == "https://example.com/subpage/deferred.svg"
    assert res.images[1].file_type == "svg"
    assert res.images[1].lazy_loaded is True
    assert res.images[2].url is None


# ==============================================================================
# LINK FIXTURES (71 - 80)
# ==============================================================================

def test_71_internal_vs_external_links():
    html_doc = """<html><body>
    <a href="/pricing" rel="nofollow">Pricing</a>
    <a href="https://example.com/about">About</a>
    <a href="https://external-partner.com/deal" rel="sponsored ugc">Partner Deal</a>
    <a href="https://other.org/docs" rel="nofollow noopener">Docs</a>
    </body></html>"""
    res = extract_html(html_doc, page_url="https://example.com/home")
    assert len(res.links) == 4

    l1 = res.links[0]
    assert l1.destination_url == "https://example.com/pricing"
    assert l1.link_type == "internal"
    assert l1.anchor_text == "Pricing"
    assert l1.nofollow is True

    l2 = res.links[1]
    assert l2.destination_url == "https://example.com/about"
    assert l2.link_type == "internal"

    l3 = res.links[2]
    assert l3.destination_url == "https://external-partner.com/deal"
    assert l3.link_type == "external"
    assert l3.sponsored is True
    assert l3.ugc is True

    l4 = res.links[3]
    assert l4.destination_url == "https://other.org/docs"
    assert l4.link_type == "external"
    assert l4.nofollow is True


# ==============================================================================
# LANGUAGE / HREFLANG FIXTURES (81 - 88)
# ==============================================================================

def test_81_html_lang_and_missing_lang():
    doc_lang = '<html lang="en-GB"><head><title>UK</title></head><body><h1>UK</h1></body></html>'
    res_lang = extract_html(doc_lang)
    assert res_lang.html_lang == "en-GB"
    assert res_lang.detected_language == "en-GB"

    doc_nolang = '<html><head><title>None</title></head><body><h1>None</h1></body></html>'
    res_nolang = extract_html(doc_nolang)
    assert res_nolang.html_lang is None
    assert res_nolang.detected_language is None


def test_82_hreflang_declarations_duplicates_and_conflicts():
    html_doc = """<html>
    <head>
    <link rel="alternate" hreflang="en" href="https://example.com/en">
    <link rel="alternate" hreflang="en-US" href="https://example.com/en-us">
    <link rel="alternate" hreflang="x-default" href="https://example.com/">
    <link rel="alternate" hreflang="en" href="https://example.com/en">
    <link rel="alternate" hreflang="fr" href="https://example.com/fr1">
    <link rel="alternate" hreflang="fr" href="https://example.com/fr2">
    </head>
    <body><h1>Hreflang Test</h1></body>
    </html>"""
    res = extract_html(html_doc, page_url="https://example.com")
    assert len(res.hreflang) == 6

    # en duplicate check
    en_items = [h for h in res.hreflang if h.language_region == "en"]
    assert len(en_items) == 2
    assert en_items[0].duplicate_declaration is True

    # x-default check
    xdef = [h for h in res.hreflang if h.language_region == "x-default"][0]
    assert xdef.target_url == "https://example.com/"

    # fr conflict check
    fr_items = [h for h in res.hreflang if h.language_region == "fr"]
    assert len(fr_items) == 2
    assert fr_items[0].conflicting_declaration is True
    assert fr_items[1].conflicting_declaration is True


# ==============================================================================
# CLEAN CONTENT FIXTURES (89 - 95)
# ==============================================================================

def test_89_clean_content_stripping_and_normalization():
    html_doc = """<html>
    <head>
    <style>body { font-size: 14px; }</style>
    <script>const x = "invisible";</script>
    </head>
    <body>
    <noscript>No script message</noscript>
    <svg><text>Vector text</text></svg>
    <h1>Visible Header</h1>
    <p>   This is   the main visible text content.   </p>
    <div>More clean text.</div>
    </body>
    </html>"""
    res = extract_html(html_doc)
    assert "invisible" not in res.clean_text
    assert "font-size" not in res.clean_text
    assert "Vector text" not in res.clean_text
    assert "Visible Header This is the main visible text content. More clean text." == res.clean_text
    assert res.word_count == 12
    assert res.clean_text_available is True


def test_90_empty_and_none_content_safe():
    res_empty = extract_html("")
    assert res_empty.html_available is False
    assert res_empty.clean_text_available is False
    assert res_empty.word_count == 0

    res_none = extract_html(None)
    assert res_none.html_available is False
    assert res_none.clean_text_available is False
    assert res_none.word_count == 0


# ==============================================================================
# PERSISTENCE & IDEMPOTENCY ACROSS ALL DOMAINS
# ==============================================================================

def test_extract_page_full_pipeline_persistence_all_domains():
    db = SessionLocal()
    try:
        website = Website(name="Full Master Test", url="https://master-test.com")
        db.add(website)
        db.commit()
        db.refresh(website)

        scan = Scan(website_id=website.id, status="completed", pages_crawled=1)
        db.add(scan)
        db.commit()
        db.refresh(scan)

        raw_html = """<html lang="en">
        <head>
        <title>Master Analytics Platform</title>
        <meta name="description" content="All-in-one GEO, AEO, and SEO enterprise intelligence suite.">
        <link rel="canonical" href="https://master-test.com/analytics">
        <meta name="robots" content="index, follow">
        <meta property="og:title" content="Master Analytics">
        <meta name="twitter:card" content="summary_large_image">
        <link rel="alternate" hreflang="en-US" href="https://master-test.com/analytics">
        <script type="application/ld+json">
        {
            "@context": "https://schema.org",
            "@type": "SoftwareApplication",
            "name": "Raval Intelligence Suite",
            "url": "https://master-test.com/analytics"
        }
        </script>
        </head>
        <body>
        <nav aria-label="breadcrumb">
            <a href="/">Home</a> &gt; <a href="/analytics">Analytics</a>
        </nav>
        <h1>Master Analytics</h1>
        <h2>Features</h2>
        <p>Real-time search engine visibility tracking.</p>
        <img src="/assets/hero.webp" alt="Hero Graph" width="1200" height="630" loading="lazy">
        <a href="/pricing" rel="nofollow">See Pricing</a>
        <div itemscope itemtype="https://schema.org/Product">
            <span itemprop="name">Enterprise Plan</span>
        </div>
        </body>
        </html>"""

        page_result = PageResult(
            scan_id=scan.id,
            url="https://master-test.com/analytics",
            status_code=200,
            content_type="text/html",
            content=raw_html,
        )
        db.add(page_result)
        db.commit()
        db.refresh(page_result)

        # 1. First extraction
        ext = extract_page(db, page_result)
        assert ext.id is not None
        assert ext.title_text == "Master Analytics Platform"
        assert ext.canonical_present is True
        assert ext.image_count == 1
        assert ext.images_without_alt == 0
        assert len(ext.structured_data) == 1
        assert ext.structured_data[0].types == ["SoftwareApplication"]
        assert len(ext.microdata) == 1
        assert len(ext.breadcrumbs) == 2
        assert len(ext.images) == 1
        assert ext.images[0].file_type == "webp"
        assert len(ext.links) == 3
        assert len(ext.hreflang) == 1
        assert ext.language.html_lang == "en"

        # Check indexability evidence persistence
        assert ext.indexability_evidence is not None
        idx_ev = ext.indexability_evidence
        assert idx_ev.http_status == 200
        assert idx_ev.robots_txt_allowed is None
        assert idx_ev.page_noindex is False
        assert idx_ev.page_nofollow is False
        assert idx_ev.canonical_url == "https://master-test.com/analytics"
        assert idx_ev.redirected is False
        assert idx_ev.content_type == "text/html"
        assert idx_ev.evidence_summary["has_content"] is True

        ext_id = ext.id

        # 2. Re-extraction idempotency test
        ext2 = extract_page(db, page_result)
        assert ext2.id == ext_id

        # Verify DB counts remain identical without duplication
        db.refresh(ext2)
        assert len(ext2.structured_data) == 1
        assert len(ext2.microdata) == 1
        assert len(ext2.breadcrumbs) == 2
        assert len(ext2.images) == 1
        assert len(ext2.links) == 3
        assert len(ext2.hreflang) == 1
        assert ext2.indexability_evidence is not None
    finally:
        db.close()


def test_indexability_evidence_redirect_and_noindex():
    db = SessionLocal()
    try:
        website = Website(name="Redirect Site", url="https://orig.com")
        db.add(website)
        db.commit()
        db.refresh(website)

        scan = Scan(website_id=website.id, status="completed", pages_crawled=1)
        db.add(scan)
        db.commit()
        db.refresh(scan)

        page_result = PageResult(
            scan_id=scan.id,
            url="https://orig.com/old-page",
            final_url="https://orig.com/new-page",
            status_code=200,
            content_type="text/html",
            content='<html><head><meta name="robots" content="noindex, nofollow"><link rel="canonical" href="https://orig.com/canonical-dest"></head><body><h1>Moved</h1></body></html>',
        )
        db.add(page_result)
        db.commit()

        ext = extract_page(db, page_result)
        assert ext.indexability_evidence is not None
        ev = ext.indexability_evidence
        assert ev.redirected is True
        assert ev.final_url == "https://orig.com/new-page"
        assert ev.page_noindex is True
        assert ev.page_nofollow is True
        assert ev.canonical_url == "https://orig.com/canonical-dest"
        assert ev.evidence_summary["redirected"] is True
        assert ev.evidence_summary["robots_noindex"] is True
    finally:
        db.close()


def test_non_html_content_type_skipped():
    res_pdf = extract_html("%PDF-1.4 binary data", content_type="application/pdf")
    assert res_pdf.html_available is False
    assert res_pdf.extraction_status == "skipped_non_html"

    res_img = extract_html("binary image content", content_type="image/png")
    assert res_img.html_available is False
    assert res_img.extraction_status == "skipped_non_html"


def test_extract_scan_pages_error_isolation():
    db = SessionLocal()
    try:
        website = Website(name="Error Isolation Site", url="https://iso-test.com")
        db.add(website)
        db.commit()
        db.refresh(website)

        scan = Scan(website_id=website.id, status="completed", pages_crawled=3)
        db.add(scan)
        db.commit()
        db.refresh(scan)

        # Page 1: Normal valid page
        p1 = PageResult(
            scan_id=scan.id,
            url="https://iso-test.com/p1",
            status_code=200,
            content_type="text/html",
            content="<html><head><title>Good Page</title></head><body><h1>Good</h1></body></html>",
        )
        # Page 2: Crawl failed error page
        p2 = PageResult(
            scan_id=scan.id,
            url="https://iso-test.com/p2",
            status_code=500,
            content_type="text/html",
            content=None,
            error="Connection timed out",
        )
        # Page 3: Another normal valid page
        p3 = PageResult(
            scan_id=scan.id,
            url="https://iso-test.com/p3",
            status_code=200,
            content_type="text/html",
            content="<html><head><title>Good Page 2</title></head><body><h1>Good 2</h1></body></html>",
        )
        db.add_all([p1, p2, p3])
        db.commit()

        extractions = extract_scan_pages(db, scan.id)
        assert len(extractions) == 3

        assert extractions[0].extraction_status == "success"
        assert extractions[0].title_text == "Good Page"

        assert extractions[1].extraction_status == "failed_crawl"
        assert extractions[1].extraction_error == "Connection timed out"

        assert extractions[2].extraction_status == "success"
        assert extractions[2].title_text == "Good Page 2"
    finally:
        db.close()


def test_controlled_real_site_verification():
    """
    Deterministic real-site HTML verification fixture.
    Validates end-to-end extraction against a real-world enterprise page structure without network requests.
    """
    real_html = """<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="utf-8">
        <title>Google Cloud Platform: Cloud Computing Services &amp; AI Solutions</title>
        <meta name="description" content="Explore Google Cloud products and solutions including generative AI, scalable computing, data analytics, and modern security infrastructure.">
        <link rel="canonical" href="https://cloud.google.com/">
        <meta name="robots" content="index, follow">
        <meta property="og:title" content="Google Cloud Platform Solutions">
        <meta property="og:description" content="Scalable cloud solutions and AI tools.">
        <meta property="og:image" content="https://cloud.google.com/images/share.jpg">
        <meta property="og:url" content="https://cloud.google.com/">
        <meta property="og:type" content="website">
        <meta name="twitter:card" content="summary_large_image">
        <meta name="twitter:title" content="Google Cloud Overview">
        <link rel="alternate" hreflang="es" href="https://cloud.google.com/es">
        <link rel="alternate" hreflang="de" href="https://cloud.google.com/de">
        <script type="application/ld+json">
        {
            "@context": "https://schema.org",
            "@type": "Organization",
            "name": "Google Cloud",
            "url": "https://cloud.google.com"
        }
        </script>
    </head>
    <body>
        <nav aria-label="breadcrumb">
            <a href="/">Home</a> &gt; <a href="/products">Products</a>
        </nav>
        <h1>Cloud Computing Services</h1>
        <h2>Infrastructure &amp; Modernization</h2>
        <p>Build, modernize, and scale applications on premier cloud infrastructure.</p>
        <img src="/static/hero-diagram.svg" alt="Google Cloud Architecture" width="1024" height="768" loading="lazy">
        <img src="/static/icon-check.png" alt="" width="24" height="24">
        <a href="/solutions" rel="nofollow">Explore Solutions</a>
        <a href="https://partner-portal.com" rel="external noopener">Partners</a>
    </body>
    </html>"""

    res = extract_html(real_html, page_url="https://cloud.google.com/")

    # 1. Title verification
    assert res.title_present is True
    assert res.title_text == "Google Cloud Platform: Cloud Computing Services & AI Solutions"
    assert res.title_length > 30

    # 2. Meta description verification
    assert res.meta_description_present is True
    assert "Explore Google Cloud products and solutions" in res.meta_descriptions[0].text

    # 3. Headings verification
    assert res.h1_count == 1
    assert res.missing_h1 is False
    assert res.headings[0].text == "Cloud Computing Services"
    assert res.headings[1].text == "Infrastructure & Modernization"

    # 4. Canonical verification
    assert res.canonical_present is True
    assert res.canonicals[0].url == "https://cloud.google.com/"
    assert res.canonicals[0].self_reference is True

    # 5. Robots verification
    assert res.robots is not None
    assert res.robots.index is True
    assert res.robots.follow is True
    assert res.robots.noindex is False

    # 6. Open Graph & Twitter verification
    og_items = {m.property_name: m.content for m in res.social_metadata if m.platform == "open_graph"}
    assert og_items.get("og:title") == "Google Cloud Platform Solutions"
    assert og_items.get("og:image") == "https://cloud.google.com/images/share.jpg"

    tw_items = {m.property_name: m.content for m in res.social_metadata if m.platform == "twitter"}
    assert tw_items.get("twitter:card") == "summary_large_image"

    # 7. JSON-LD verification
    assert len(res.structured_data) == 1
    assert res.structured_data[0].types == ["Organization"]
    assert res.structured_data[0].entity_names == ["Google Cloud"]
    assert res.structured_data[0].entity_urls == ["https://cloud.google.com"]

    # 8. Breadcrumb verification
    assert len(res.breadcrumbs) == 2
    assert res.breadcrumbs[0].name == "Home"
    assert res.breadcrumbs[1].name == "Products"

    # 9. Images verification
    assert res.image_count == 2
    assert res.images_without_alt == 0
    assert res.images[0].url == "https://cloud.google.com/static/hero-diagram.svg"
    assert res.images[0].alt == "Google Cloud Architecture"
    assert res.images[0].file_type == "svg"
    assert res.images[0].lazy_loaded is True
    assert res.images[1].alt_empty is True

    # 10. Links verification
    assert len(res.links) == 4
    dest_urls = [l.destination_url for l in res.links]
    assert "https://cloud.google.com/solutions" in dest_urls
    assert "https://partner-portal.com" in dest_urls

    # 11. Language & Hreflang verification
    assert res.html_lang == "en"
    assert len(res.hreflang) == 2
    assert {h.language_region for h in res.hreflang} == {"es", "de"}

    # 12. Clean text verification
    assert "Cloud Computing Services" in res.clean_text
    assert "Build, modernize, and scale" in res.clean_text
    assert res.word_count > 10
