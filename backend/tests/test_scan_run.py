from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from app.database import SessionLocal
from app.main import app
from app.models import PageResult
from crawler.models import CrawledPage

client = TestClient(app)


def test_run_scan_endpoint():
    website_response = client.post(
        "/api/v1/websites",
        json={
            "name": "Run Test Website",
            "url": "https://example.com",
        },
    )

    assert website_response.status_code == 200

    website = website_response.json()

    scan_response = client.post(
        f"/api/v1/websites/{website['id']}/scans"
    )

    assert scan_response.status_code == 200

    scan = scan_response.json()

    with patch(
        "app.services.Crawler.crawl"
    ) as mock_crawl:
        mock_crawl.return_value = MagicMock(
            pages_crawled=1,
            pages_failed=0,
            pages_skipped=0,
        )

        response = client.post(
            f"/api/v1/scans/{scan['id']}/run"
        )

        print("\nSTATUS:", response.status_code)
        print("BODY:", response.text)

    assert response.status_code == 200

    assert response.json()["status"] == "completed"
    
    assert response.json()["pages_crawled"] == 1
    assert response.json()["pages_failed"] == 0
    assert response.json()["pages_skipped"] == 0

    mock_crawl.assert_called_once_with(
        "https://example.com/"
    )


def test_run_scan_marks_scan_failed_on_crawler_error():
    website_response = client.post(
        "/api/v1/websites",
        json={
            "name": "Failed Crawl Website",
            "url": "https://example.com",
        },
    )

    assert website_response.status_code == 200

    website = website_response.json()

    scan_response = client.post(
        f"/api/v1/websites/{website['id']}/scans"
    )

    assert scan_response.status_code == 200

    scan = scan_response.json()

    with patch(
        "app.services.Crawler.crawl",
        side_effect=RuntimeError(
            "Crawler test failure"
        ),
    ):
        response = client.post(
            f"/api/v1/scans/{scan['id']}/run"
        )

        print("\nSTATUS:", response.status_code)
        print("BODY:", response.text)

    assert response.status_code == 500

    scan_check = client.get(
        f"/api/v1/scans/{scan['id']}"
    )

    assert scan_check.status_code == 200

    saved_scan = scan_check.json()

    assert saved_scan["status"] == "failed"
    assert saved_scan["error_message"] == "Crawler test failure"


def test_run_scan_rejects_already_completed_scan():
    website_response = client.post(
        "/api/v1/websites",
        json={
            "name": "Completed Scan Test",
            "url": "https://example.com",
        },
    )

    assert website_response.status_code == 200

    website = website_response.json()

    scan_response = client.post(
        f"/api/v1/websites/{website['id']}/scans"
    )

    assert scan_response.status_code == 200

    scan = scan_response.json()

    with patch(
        "app.services.Crawler.crawl"
    ) as mock_crawl:
        mock_crawl.return_value = MagicMock(
            pages_crawled=1,
            pages_failed=0,
            pages_skipped=0,
        )

        first_response = client.post(
            f"/api/v1/scans/{scan['id']}/run"
        )

        print("\nFIRST STATUS:", first_response.status_code)
        print("FIRST BODY:", first_response.text)

    assert first_response.status_code == 200

    second_response = client.post(
        f"/api/v1/scans/{scan['id']}/run"
    )

    print("\nSECOND STATUS:", second_response.status_code)
    print("SECOND BODY:", second_response.text)

    assert second_response.status_code == 409

    mock_crawl.assert_called_once()
def test_run_scan_persists_crawl_summary_counts():
    website_response = client.post(
        "/api/v1/websites",
        json={
            "name": "Summary Counts Test",
            "url": "https://example.com",
        },
    )

    assert website_response.status_code == 200

    website = website_response.json()

    scan_response = client.post(
        f"/api/v1/websites/{website['id']}/scans"
    )

    assert scan_response.status_code == 200

    scan = scan_response.json()

    with patch(
        "app.services.Crawler.crawl"
    ) as mock_crawl:
        mock_crawl.return_value = MagicMock(
            pages_crawled=7,
            pages_failed=2,
            pages_skipped=3,
        )

        response = client.post(
            f"/api/v1/scans/{scan['id']}/run"
        )

    assert response.status_code == 200

    saved_scan = response.json()

    assert saved_scan["status"] == "completed"
    assert saved_scan["pages_crawled"] == 7
    assert saved_scan["pages_failed"] == 2
    assert saved_scan["pages_skipped"] == 3

    scan_check = client.get(
        f"/api/v1/scans/{scan['id']}"
    )

    assert scan_check.status_code == 200

    persisted_scan = scan_check.json()

    assert persisted_scan["pages_crawled"] == 7
    assert persisted_scan["pages_failed"] == 2
    assert persisted_scan["pages_skipped"] == 3

    mock_crawl.assert_called_once_with(
        "https://example.com/"
    )


def test_run_scan_persists_page_results():
    website_response = client.post(
        "/api/v1/websites",
        json={
            "name": "Page Results Test Website",
            "url": "https://example.com",
        },
    )

    assert website_response.status_code == 200

    website = website_response.json()

    scan_response = client.post(
        f"/api/v1/websites/{website['id']}/scans"
    )

    assert scan_response.status_code == 200

    scan = scan_response.json()

    crawled_pages = [
        CrawledPage(
            url="https://example.com/",
            depth=0,
            status_code=200,
            content_type="text/html; charset=utf-8",
            content="<html>Home</html>",
            error=None,
        ),
        CrawledPage(
            url="https://example.com/about",
            depth=1,
            status_code=200,
            content_type="text/html; charset=utf-8",
            content="<html>About</html>",
            error=None,
        ),
        CrawledPage(
            url="https://example.com/fail",
            depth=1,
            status_code=500,
            content_type="text/html",
            content="",
            error="Server error",
        ),
    ]

    with patch(
        "app.services.Crawler.crawl"
    ) as mock_crawl:
        mock_crawl.return_value = MagicMock(
            pages_crawled=2,
            pages_failed=1,
            pages_skipped=0,
            pages=crawled_pages,
        )

        response = client.post(
            f"/api/v1/scans/{scan['id']}/run"
        )

    assert response.status_code == 200

    db = SessionLocal()
    try:
        page_results = (
            db.query(PageResult)
            .filter(PageResult.scan_id == scan["id"])
            .order_by(PageResult.id)
            .all()
        )

        assert len(page_results) == 3

        assert page_results[0].url == "https://example.com/"
        assert page_results[0].depth == 0
        assert page_results[0].status_code == 200
        assert page_results[0].content_type == "text/html; charset=utf-8"
        assert page_results[0].error is None

        assert page_results[1].url == "https://example.com/about"
        assert page_results[1].depth == 1
        assert page_results[1].status_code == 200
        assert page_results[1].content_type == "text/html; charset=utf-8"
        assert page_results[1].error is None

        assert page_results[2].url == "https://example.com/fail"
        assert page_results[2].depth == 1
        assert page_results[2].status_code == 500
        assert page_results[2].content_type == "text/html"
        assert page_results[2].error == "Server error"

    finally:
        db.close()


def test_scan_history_isolation_for_same_website():
    # 1. Create one website
    website_response = client.post(
        "/api/v1/websites",
        json={
            "name": "Isolation Test Website",
            "url": "https://isolation-example.com",
        },
    )
    assert website_response.status_code == 200
    website = website_response.json()

    # 2. Create Scan #1
    scan1_response = client.post(
        f"/api/v1/websites/{website['id']}/scans"
    )
    assert scan1_response.status_code == 200
    scan1 = scan1_response.json()

    # 3. Mock Crawler.crawl with CrawledPage objects for Scan #1
    scan1_pages = [
        CrawledPage(
            url="https://isolation-example.com/",
            depth=0,
            status_code=200,
            content_type="text/html",
            content="<html>Home V1</html>",
            error=None,
        ),
        CrawledPage(
            url="https://isolation-example.com/v1-page",
            depth=1,
            status_code=200,
            content_type="text/html",
            content="<html>V1 Page</html>",
            error=None,
        ),
    ]

    # 4. Run Scan #1
    with patch("app.services.Crawler.crawl") as mock_crawl_1:
        mock_crawl_1.return_value = MagicMock(
            pages_crawled=2,
            pages_failed=0,
            pages_skipped=0,
            pages=scan1_pages,
        )
        run1_response = client.post(
            f"/api/v1/scans/{scan1['id']}/run"
        )
    assert run1_response.status_code == 200

    # 5. Create Scan #2 for the same website
    scan2_response = client.post(
        f"/api/v1/websites/{website['id']}/scans"
    )
    assert scan2_response.status_code == 200
    scan2 = scan2_response.json()

    # 6. Mock the crawler with a different result for Scan #2
    scan2_pages = [
        CrawledPage(
            url="https://isolation-example.com/",
            depth=0,
            status_code=200,
            content_type="text/html",
            content="<html>Home V2</html>",
            error=None,
        ),
        CrawledPage(
            url="https://isolation-example.com/v2-pricing",
            depth=1,
            status_code=200,
            content_type="text/html",
            content="<html>Pricing</html>",
            error=None,
        ),
        CrawledPage(
            url="https://isolation-example.com/v2-contact",
            depth=1,
            status_code=404,
            content_type="text/html",
            content="",
            error="404 Not Found",
        ),
    ]

    # 7. Run Scan #2
    with patch("app.services.Crawler.crawl") as mock_crawl_2:
        mock_crawl_2.return_value = MagicMock(
            pages_crawled=2,
            pages_failed=1,
            pages_skipped=0,
            pages=scan2_pages,
        )
        run2_response = client.post(
            f"/api/v1/scans/{scan2['id']}/run"
        )
    assert run2_response.status_code == 200

    # 8. Query database for PageResult records belonging to Scan #1 and Scan #2
    db = SessionLocal()
    try:
        scan1_results = (
            db.query(PageResult)
            .filter(PageResult.scan_id == scan1["id"])
            .order_by(PageResult.id)
            .all()
        )
        scan2_results = (
            db.query(PageResult)
            .filter(PageResult.scan_id == scan2["id"])
            .order_by(PageResult.id)
            .all()
        )

        # 9. Assert that each scan only has its own records
        assert len(scan1_results) == 2
        assert [r.url for r in scan1_results] == [
            "https://isolation-example.com/",
            "https://isolation-example.com/v1-page",
        ]
        for r in scan1_results:
            assert r.scan_id == scan1["id"]

        assert len(scan2_results) == 3
        assert [r.url for r in scan2_results] == [
            "https://isolation-example.com/",
            "https://isolation-example.com/v2-pricing",
            "https://isolation-example.com/v2-contact",
        ]
        for r in scan2_results:
            assert r.scan_id == scan2["id"]

        # 10. Assert that running Scan #2 did not overwrite or modify Scan #1's records
        assert scan1_results[0].url == "https://isolation-example.com/"
        assert scan1_results[0].status_code == 200
        assert scan1_results[0].error is None
        assert scan1_results[1].url == "https://isolation-example.com/v1-page"
        assert scan1_results[1].status_code == 200
        assert scan1_results[1].error is None

        scan1_ids = {r.id for r in scan1_results}
        scan2_ids = {r.id for r in scan2_results}
        assert scan1_ids.isdisjoint(scan2_ids)
    finally:
        db.close()


def test_scan_page_results_endpoint_and_evidence_fields():
    website_response = client.post(
        "/api/v1/websites",
        json={
            "name": "Full Evidence Test",
            "url": "https://evidence-example.com",
        },
    )
    assert website_response.status_code == 200
    website = website_response.json()

    scan_response = client.post(
        f"/api/v1/websites/{website['id']}/scans"
    )
    assert scan_response.status_code == 200
    scan = scan_response.json()

    crawled_pages = [
        CrawledPage(
            url="https://evidence-example.com/",
            depth=0,
            status_code=200,
            content_type="text/html; charset=utf-8",
            content="<html><head><title>Evidence</title></head><body>Welcome</body></html>",
            error=None,
        ),
        CrawledPage(
            url="https://evidence-example.com/about",
            depth=1,
            status_code=200,
            content_type="text/html",
            content="<html><body>About us</body></html>",
            error=None,
        ),
        CrawledPage(
            url="https://evidence-example.com/api/failed",
            depth=1,
            status_code=500,
            content_type="text/html",
            content="",
            error="HTTP 500",
        ),
    ]

    with patch("app.services.Crawler.crawl") as mock_crawl:
        mock_crawl.return_value = MagicMock(
            pages_crawled=2,
            pages_failed=1,
            pages_skipped=0,
            pages=crawled_pages,
        )
        run_response = client.post(f"/api/v1/scans/{scan['id']}/run")

    assert run_response.status_code == 200
    run_json = run_response.json()
    assert run_json["pages_crawled"] == 2
    assert run_json["pages_failed"] == 1
    assert run_json["pages_skipped"] == 0

    # Test GET /api/v1/scans/{scan_id}/pages endpoint
    pages_response = client.get(f"/api/v1/scans/{scan['id']}/pages")
    assert pages_response.status_code == 200
    pages_data = pages_response.json()
    assert len(pages_data) == 3

    p1 = pages_data[0]
    assert p1["scan_id"] == scan["id"]
    assert p1["url"] == "https://evidence-example.com/"
    assert p1["depth"] == 0
    assert p1["status_code"] == 200
    assert p1["content_type"] == "text/html; charset=utf-8"
    assert "Evidence" in p1["content"]
    assert p1["error"] is None

    p2 = pages_data[1]
    assert p2["scan_id"] == scan["id"]
    assert p2["url"] == "https://evidence-example.com/about"
    assert p2["depth"] == 1
    assert p2["status_code"] == 200
    assert "About us" in p2["content"]

    p3 = pages_data[2]
    assert p3["scan_id"] == scan["id"]
    assert p3["url"] == "https://evidence-example.com/api/failed"
    assert p3["depth"] == 1
    assert p3["status_code"] == 500
    assert p3["error"] == "HTTP 500"

    # Test 404 for unknown scan pages
    missing_pages_response = client.get("/api/v1/scans/999999/pages")
    assert missing_pages_response.status_code == 404
    assert missing_pages_response.json()["detail"] == "Scan not found"


def test_get_scan_pages_nonexistent_scan_returns_404():
    response = client.get("/api/v1/scans/888888/pages")
    assert response.status_code == 404
    assert response.json()["detail"] == "Scan not found"


def test_get_scan_pages_empty_scan_returns_empty_list():
    website_response = client.post(
        "/api/v1/websites",
        json={
            "name": "Empty Scan Test",
            "url": "https://empty-example.com",
        },
    )
    assert website_response.status_code == 200
    website = website_response.json()

    scan_response = client.post(
        f"/api/v1/websites/{website['id']}/scans"
    )
    assert scan_response.status_code == 200
    scan = scan_response.json()

    # Before running, scan has no pages
    pages_response = client.get(f"/api/v1/scans/{scan['id']}/pages")
    assert pages_response.status_code == 200
    assert pages_response.json() == []


def test_get_scan_pages_isolation_and_historical_consistency_via_api():
    # 1. Create website
    website_response = client.post(
        "/api/v1/websites",
        json={
            "name": "API Isolation Website",
            "url": "https://api-isolation.com",
        },
    )
    assert website_response.status_code == 200
    website = website_response.json()

    # 2. Create Scan A
    scan_a_res = client.post(f"/api/v1/websites/{website['id']}/scans")
    assert scan_a_res.status_code == 200
    scan_a = scan_a_res.json()

    pages_a = [
        CrawledPage(
            url="https://api-isolation.com/page-a1",
            depth=0,
            status_code=200,
            content_type="text/html",
            content="<html>A1</html>",
            error=None,
        ),
        CrawledPage(
            url="https://api-isolation.com/page-a2",
            depth=1,
            status_code=200,
            content_type="text/html",
            content="<html>A2</html>",
            error=None,
        ),
    ]

    with patch("app.services.Crawler.crawl") as mock_crawl_a:
        mock_crawl_a.return_value = MagicMock(
            pages_crawled=2,
            pages_failed=0,
            pages_skipped=0,
            pages=pages_a,
        )
        run_a = client.post(f"/api/v1/scans/{scan_a['id']}/run")
    assert run_a.status_code == 200

    # 3. Create Scan B on same website
    scan_b_res = client.post(f"/api/v1/websites/{website['id']}/scans")
    assert scan_b_res.status_code == 200
    scan_b = scan_b_res.json()

    pages_b = [
        CrawledPage(
            url="https://api-isolation.com/page-b1",
            depth=0,
            status_code=200,
            content_type="text/html",
            content="<html>B1</html>",
            error=None,
        ),
        CrawledPage(
            url="https://api-isolation.com/page-b2-failed",
            depth=1,
            status_code=404,
            content_type="text/html",
            content="",
            error="404 Not Found",
        ),
        CrawledPage(
            url="https://api-isolation.com/page-b3",
            depth=1,
            status_code=200,
            content_type="text/html",
            content="<html>B3</html>",
            error=None,
        ),
    ]

    with patch("app.services.Crawler.crawl") as mock_crawl_b:
        mock_crawl_b.return_value = MagicMock(
            pages_crawled=2,
            pages_failed=1,
            pages_skipped=0,
            pages=pages_b,
        )
        run_b = client.post(f"/api/v1/scans/{scan_b['id']}/run")
    assert run_b.status_code == 200

    # 4. Fetch Scan A pages via API
    get_pages_a = client.get(f"/api/v1/scans/{scan_a['id']}/pages")
    assert get_pages_a.status_code == 200
    pages_a_data = get_pages_a.json()
    assert len(pages_a_data) == 2
    assert [p["url"] for p in pages_a_data] == [
        "https://api-isolation.com/page-a1",
        "https://api-isolation.com/page-a2",
    ]
    for p in pages_a_data:
        assert p["scan_id"] == scan_a["id"]

    # 5. Fetch Scan B pages via API
    get_pages_b = client.get(f"/api/v1/scans/{scan_b['id']}/pages")
    assert get_pages_b.status_code == 200
    pages_b_data = get_pages_b.json()
    assert len(pages_b_data) == 3
    assert [p["url"] for p in pages_b_data] == [
        "https://api-isolation.com/page-b1",
        "https://api-isolation.com/page-b2-failed",
        "https://api-isolation.com/page-b3",
    ]
    for p in pages_b_data:
        assert p["scan_id"] == scan_b["id"]
    assert pages_b_data[1]["status_code"] == 404
    assert pages_b_data[1]["error"] == "404 Not Found"

    # 6. Verify scan summaries match persisted page results
    scan_a_get = client.get(f"/api/v1/scans/{scan_a['id']}")
    assert scan_a_get.status_code == 200
    assert scan_a_get.json()["pages_crawled"] == 2
    assert scan_a_get.json()["pages_failed"] == 0

    scan_b_get = client.get(f"/api/v1/scans/{scan_b['id']}")
    assert scan_b_get.status_code == 200
    assert scan_b_get.json()["pages_crawled"] == 2
    assert scan_b_get.json()["pages_failed"] == 1




