"""DB-backed tests for technical-SEO analysis: persistence, provisional
scoring, idempotency, strict per-scan isolation, and the service retrieval
helpers.

Mirrors the existing suite's convention of using the real ``SessionLocal``
with unique per-test URLs. Pages are created with stored HTML ``content`` and
run through the Task 4 pipeline (``extract_scan_pages``) with no network, then
analyzed by ``findings_service``.
"""

import pytest

from app.database import SessionLocal
from app.models import PageResult, Scan, TechnicalSeoFinding, Website
from app.page_extractor import extract_scan_pages
from app import findings_service as fs

GOOD_HTML = """<!DOCTYPE html>
<html lang="en">
<head>
<title>{title}</title>
<meta name="description" content="A sufficiently long and descriptive meta description written to fit within the recommended length range for this test page.">
<link rel="canonical" href="{url}">
<meta property="og:title" content="T"><meta property="og:description" content="D">
<meta property="og:image" content="http://x/i.png"><meta property="og:url" content="{url}">
<meta name="twitter:card" content="summary">
</head>
<body><h1>Main</h1><h2>Sub</h2><p>Body.</p>
<a href="/a">a</a><a href="/b">b</a><a href="/c">c</a></body>
</html>"""


def _make_scan(db, site_url, pages, name="TS"):
    """pages: list of dicts with url + optional html/status/content_type/final_url/error."""
    website = Website(name=name, url=site_url)
    db.add(website)
    db.commit()
    db.refresh(website)

    scan = Scan(website_id=website.id, status="completed", pages_crawled=len(pages))
    db.add(scan)
    db.commit()
    db.refresh(scan)

    for p in pages:
        db.add(
            PageResult(
                scan_id=scan.id,
                url=p["url"],
                final_url=p.get("final_url"),
                status_code=p.get("status", 200),
                content_type=p.get("content_type", "text/html"),
                content=p.get("html"),
                depth=1,
                error=p.get("error"),
            )
        )
    db.commit()
    extract_scan_pages(db, scan.id)
    return website, scan


# ---------------------------------------------------------------------------
def test_analyze_persists_findings_with_full_evidence():
    db = SessionLocal()
    try:
        website, scan = _make_scan(
            db,
            "http://sc-ev.com",
            [{"url": "http://sc-ev.com/bare", "html": "<html><head></head><body><p>x</p></body></html>"}],
            name="Scoring Evidence",
        )
        summary = fs.analyze_scan_findings(db, scan.id)
        assert summary["total_findings"] > 0

        findings = fs.get_scan_findings(db, scan.id)
        assert findings
        for f in findings:
            assert f.website_id == website.id
            assert f.scan_id == scan.id
            assert f.page_result_id is not None
            assert f.rule_id and f.category and f.severity
            assert f.severity in {"info", "low", "medium", "high", "critical"}
            assert f.status == "open"
            assert isinstance(f.evidence, dict)
            assert f.recommendation
    finally:
        db.close()


def test_summary_shape_is_provisional():
    db = SessionLocal()
    try:
        _, scan = _make_scan(
            db,
            "http://sc-sum.com",
            [{"url": "http://sc-sum.com/p", "html": "<html><head></head><body><p>x</p></body></html>"}],
            name="Scoring Summary",
        )
        summary = fs.analyze_scan_findings(db, scan.id)
        assert summary["scan_id"] == scan.id
        assert summary["pages_analyzed"] == 1
        assert "counts_by_severity" in summary
        assert isinstance(summary["categories"], list)
        assert 0 <= summary["provisional_overall_health"] <= 100
        assert summary["scoring"]["provisional"] is True
        assert summary["scoring"]["version"]
        # Reading the summary back from persisted rows matches the analyze result.
        stored = fs.get_scan_findings_summary(db, scan.id)
        assert stored["total_findings"] == summary["total_findings"]
    finally:
        db.close()


def test_clean_page_scores_full_health():
    db = SessionLocal()
    try:
        url = "http://sc-clean.com/good"
        _, scan = _make_scan(
            db,
            "http://sc-clean.com",
            [{"url": url, "html": GOOD_HTML.format(title="A clean descriptive page title", url=url)}],
            name="Scoring Clean",
        )
        summary = fs.analyze_scan_findings(db, scan.id)
        assert summary["total_findings"] == 0
        assert summary["provisional_overall_health"] == 100
        assert summary["worst_category"] is None
    finally:
        db.close()


def test_reanalysis_is_idempotent():
    db = SessionLocal()
    try:
        _, scan = _make_scan(
            db,
            "http://sc-idem.com",
            [{"url": "http://sc-idem.com/p", "html": "<html><head></head><body><p>x</p></body></html>"}],
            name="Scoring Idempotent",
        )
        first = fs.analyze_scan_findings(db, scan.id)
        count1 = len(fs.get_scan_findings(db, scan.id))
        second = fs.analyze_scan_findings(db, scan.id)
        count2 = len(fs.get_scan_findings(db, scan.id))
        assert count1 == count2
        assert first["total_findings"] == second["total_findings"]
    finally:
        db.close()


def test_duplicate_title_is_scan_isolated():
    db = SessionLocal()
    try:
        # Scan A: two pages share a title -> cross-page duplicate.
        title_a = "Isolation Shared Title AAA"
        _, scan_a = _make_scan(
            db,
            "http://iso-a.com",
            [
                {"url": "http://iso-a.com/1", "html": GOOD_HTML.format(title=title_a, url="http://iso-a.com/1")},
                {"url": "http://iso-a.com/2", "html": GOOD_HTML.format(title=title_a, url="http://iso-a.com/2")},
            ],
            name="Isolation A",
        )
        # Scan B: same title text, but only one page -> NOT a duplicate in B.
        _, scan_b = _make_scan(
            db,
            "http://iso-b.com",
            [{"url": "http://iso-b.com/1", "html": GOOD_HTML.format(title=title_a, url="http://iso-b.com/1")}],
            name="Isolation B",
        )

        fs.analyze_scan_findings(db, scan_a.id)
        fs.analyze_scan_findings(db, scan_b.id)

        a_rules = {f.rule_id for f in fs.get_scan_findings(db, scan_a.id)}
        b_rules = {f.rule_id for f in fs.get_scan_findings(db, scan_b.id)}
        assert "SEO-DUP-001" in a_rules
        assert "SEO-DUP-001" not in b_rules

        # Re-analyzing A must not create or delete any of B's findings.
        b_before = len(fs.get_scan_findings(db, scan_b.id))
        fs.analyze_scan_findings(db, scan_a.id)
        assert len(fs.get_scan_findings(db, scan_b.id)) == b_before
    finally:
        db.close()


def test_broken_internal_link_persisted_from_scan_evidence():
    db = SessionLocal()
    try:
        linker = (
            '<html lang="en"><head><title>Linker page title here</title>'
            '<link rel="canonical" href="http://brk.com/p"></head><body><h1>h</h1>'
            '<a href="http://brk.com/dead">x</a></body></html>'
        )
        _, scan = _make_scan(
            db,
            "http://brk.com",
            [
                {"url": "http://brk.com/p", "html": linker},
                {"url": "http://brk.com/dead", "status": 404, "html": "<html><body>gone</body></html>"},
            ],
            name="Broken Link",
        )
        fs.analyze_scan_findings(db, scan.id)
        linker_page = (
            db.query(PageResult)
            .filter(PageResult.scan_id == scan.id, PageResult.url == "http://brk.com/p")
            .one()
        )
        rules = {f.rule_id for f in fs.get_page_findings(db, linker_page.id)}
        assert "SEO-LINK-004" in rules
    finally:
        db.close()


def test_filters_and_get_finding():
    db = SessionLocal()
    try:
        _, scan = _make_scan(
            db,
            "http://sc-filt.com",
            [{"url": "http://sc-filt.com/bad", "status": 500, "html": "err"}],
            name="Scoring Filters",
        )
        fs.analyze_scan_findings(db, scan.id)

        criticals = fs.get_scan_findings(db, scan.id, severity="critical")
        assert criticals and all(f.severity == "critical" for f in criticals)
        # HTTP 5xx is owned by the http category.
        http = fs.get_scan_findings(db, scan.id, category="http")
        assert http and all(f.category == "http" for f in http)

        one = criticals[0]
        fetched = fs.get_finding(db, one.id)
        assert fetched.id == one.id

        with pytest.raises(ValueError, match="Finding not found"):
            fs.get_finding(db, 999_999_999)
    finally:
        db.close()


def test_analyze_page_findings_reruns_single_page():
    db = SessionLocal()
    try:
        _, scan = _make_scan(
            db,
            "http://sc-page.com",
            [{"url": "http://sc-page.com/p", "html": "<html><head></head><body><p>x</p></body></html>"}],
            name="Scoring Page",
        )
        fs.analyze_scan_findings(db, scan.id)
        page = db.query(PageResult).filter(PageResult.scan_id == scan.id).first()
        before = len(fs.get_page_findings(db, page.id))
        fs.analyze_page_findings(db, page.id)
        after = len(fs.get_page_findings(db, page.id))
        assert before == after and after > 0
    finally:
        db.close()


def test_unknown_ids_raise_not_found():
    db = SessionLocal()
    try:
        with pytest.raises(ValueError, match="Scan not found"):
            fs.analyze_scan_findings(db, 999_999_999)
        with pytest.raises(ValueError, match="Scan not found"):
            fs.get_scan_findings(db, 999_999_999)
        with pytest.raises(ValueError, match="Page not found"):
            fs.get_page_findings(db, 999_999_999)
        with pytest.raises(ValueError, match="Website not found"):
            fs.get_website_findings(db, 999_999_999)
    finally:
        db.close()
