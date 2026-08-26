"""API tests for the Task 5 technical-SEO findings endpoints.

Uses the real SessionLocal to seed website/scan/pages with stored HTML and the
Task 4 extraction pipeline (no network), then exercises the six endpoints via
the FastAPI TestClient: analyze, scan findings (+filters/400), summary, page
findings, finding-by-id, and website findings — plus 404s and scan isolation.
"""

from fastapi.testclient import TestClient

from app.database import SessionLocal
from app.main import app
from app.models import PageResult, Scan, Website
from app.page_extractor import extract_scan_pages

client = TestClient(app)

BARE = "<html><head></head><body><p>bare page</p></body></html>"
CLEAN = """<!DOCTYPE html><html lang="en"><head>
<title>A clean descriptive page title</title>
<meta name="description" content="A sufficiently long and descriptive meta description that fits within the recommended length window for the clean fixture.">
<link rel="canonical" href="{url}">
<meta property="og:title" content="T"><meta property="og:description" content="D">
<meta property="og:image" content="http://x/i.png"><meta property="og:url" content="{url}">
<meta name="twitter:card" content="summary"></head>
<body><h1>Main</h1><p>Body.</p><a href="/a">a</a><a href="/b">b</a><a href="/c">c</a></body></html>"""


def _seed(site_url, pages, name):
    """Create website+scan+pages with extraction; return (website_id, scan_id, page_ids)."""
    db = SessionLocal()
    try:
        website = Website(name=name, url=site_url)
        db.add(website)
        db.commit()
        db.refresh(website)

        scan = Scan(website_id=website.id, status="completed", pages_crawled=len(pages))
        db.add(scan)
        db.commit()
        db.refresh(scan)

        page_ids = []
        for p in pages:
            pr = PageResult(
                scan_id=scan.id,
                url=p["url"],
                status_code=p.get("status", 200),
                content_type=p.get("content_type", "text/html"),
                content=p.get("html"),
                depth=1,
            )
            db.add(pr)
            db.commit()
            db.refresh(pr)
            page_ids.append(pr.id)

        extract_scan_pages(db, scan.id)
        return website.id, scan.id, page_ids
    finally:
        db.close()


# ---------------------------------------------------------------------------
def test_analyze_then_list_findings_with_aliases():
    website_id, scan_id, page_ids = _seed(
        "http://api-a.com", [{"url": "http://api-a.com/bare", "html": BARE}], "API Analyze"
    )
    resp = client.post(f"/api/v1/scans/{scan_id}/analyze")
    assert resp.status_code == 200
    summary = resp.json()
    assert summary["scoring"]["provisional"] is True
    assert summary["total_findings"] > 0
    assert summary["pages_analyzed"] == 1

    resp = client.get(f"/api/v1/scans/{scan_id}/findings")
    assert resp.status_code == 200
    findings = resp.json()
    assert findings
    for f in findings:
        assert f["scan_id"] == scan_id
        assert f["website_id"] == website_id
        # VALIDATION_RULES §9 aliases exposed in the response.
        assert f["page_id"] == f["page_result_id"]
        assert f["type"] == f["rule_id"]
        assert isinstance(f["evidence"], dict)
        assert f["recommendation"]
        assert f["status"] == "open"


def test_analyze_unknown_scan_returns_404():
    resp = client.post("/api/v1/scans/999999999/analyze")
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Scan not found"


def test_findings_filters_and_invalid_filter_400():
    _, scan_id, _ = _seed(
        "http://api-f.com", [{"url": "http://api-f.com/bad", "status": 500, "html": "err"}], "API Filters"
    )
    client.post(f"/api/v1/scans/{scan_id}/analyze")

    # Valid severity filter.
    resp = client.get(f"/api/v1/scans/{scan_id}/findings", params={"severity": "critical"})
    assert resp.status_code == 200
    data = resp.json()
    assert data and all(f["severity"] == "critical" for f in data)

    # Valid category filter (5xx is owned by http).
    resp = client.get(f"/api/v1/scans/{scan_id}/findings", params={"category": "http"})
    assert resp.status_code == 200
    assert all(f["category"] == "http" for f in resp.json())

    # Valid rule_id filter.
    resp = client.get(f"/api/v1/scans/{scan_id}/findings", params={"rule_id": "SEO-HTTP-001"})
    assert resp.status_code == 200
    assert all(f["rule_id"] == "SEO-HTTP-001" for f in resp.json())

    # Invalid severity / category -> 400.
    assert client.get(f"/api/v1/scans/{scan_id}/findings", params={"severity": "nope"}).status_code == 400
    assert client.get(f"/api/v1/scans/{scan_id}/findings", params={"category": "nope"}).status_code == 400


def test_summary_endpoint_shape():
    _, scan_id, _ = _seed(
        "http://api-s.com", [{"url": "http://api-s.com/bare", "html": BARE}], "API Summary"
    )
    client.post(f"/api/v1/scans/{scan_id}/analyze")
    resp = client.get(f"/api/v1/scans/{scan_id}/findings/summary")
    assert resp.status_code == 200
    summary = resp.json()
    assert summary["scan_id"] == scan_id
    assert summary["scoring"]["provisional"] is True
    assert 0 <= summary["provisional_overall_health"] <= 100
    assert isinstance(summary["categories"], list)

    assert client.get("/api/v1/scans/999999999/findings/summary").status_code == 404


def test_page_findings_and_clean_page_empty():
    _, scan_id, page_ids = _seed(
        "http://api-p.com",
        [
            {"url": "http://api-p.com/bare", "html": BARE},
            {"url": "http://api-p.com/clean", "html": CLEAN.format(url="http://api-p.com/clean")},
        ],
        "API Page",
    )
    client.post(f"/api/v1/scans/{scan_id}/analyze")
    bare_id, clean_id = page_ids[0], page_ids[1]

    resp = client.get(f"/api/v1/pages/{bare_id}/findings")
    assert resp.status_code == 200 and len(resp.json()) > 0

    # Clean page -> no findings -> [].
    resp = client.get(f"/api/v1/pages/{clean_id}/findings")
    assert resp.status_code == 200 and resp.json() == []

    assert client.get("/api/v1/pages/999999999/findings").status_code == 404


def test_get_finding_by_id_and_404():
    _, scan_id, _ = _seed(
        "http://api-id.com", [{"url": "http://api-id.com/bare", "html": BARE}], "API Finding Id"
    )
    client.post(f"/api/v1/scans/{scan_id}/analyze")
    first = client.get(f"/api/v1/scans/{scan_id}/findings").json()[0]

    resp = client.get(f"/api/v1/findings/{first['id']}")
    assert resp.status_code == 200
    assert resp.json()["id"] == first["id"]

    resp = client.get("/api/v1/findings/999999999")
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Finding not found"


def test_website_findings_and_404():
    website_id, scan_id, _ = _seed(
        "http://api-w.com", [{"url": "http://api-w.com/bare", "html": BARE}], "API Website"
    )
    client.post(f"/api/v1/scans/{scan_id}/analyze")

    resp = client.get(f"/api/v1/websites/{website_id}/findings")
    assert resp.status_code == 200
    data = resp.json()
    assert data and all(f["website_id"] == website_id for f in data)

    assert client.get("/api/v1/websites/999999999/findings").status_code == 404


def test_two_scan_isolation_via_api():
    _, scan1, _ = _seed("http://api-i1.com", [{"url": "http://api-i1.com/bare", "html": BARE}], "API Iso 1")
    _, scan2, _ = _seed("http://api-i2.com", [{"url": "http://api-i2.com/bare", "html": BARE}], "API Iso 2")
    client.post(f"/api/v1/scans/{scan1}/analyze")
    client.post(f"/api/v1/scans/{scan2}/analyze")

    d1 = client.get(f"/api/v1/scans/{scan1}/findings").json()
    d2 = client.get(f"/api/v1/scans/{scan2}/findings").json()
    assert d1 and d2
    assert all(f["scan_id"] == scan1 for f in d1)
    assert all(f["scan_id"] == scan2 for f in d2)
