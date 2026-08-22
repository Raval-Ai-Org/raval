from unittest.mock import Mock, patch

from crawler.config import CrawlerConfig
from crawler.crawler import Crawler
from crawler.queue import URLState



def test_crawler_fetches_start_url():
    config = CrawlerConfig(
        max_pages=10,
        max_depth=1,
        allowed_domains=["example.com"],
        respect_robots_txt=False,
    )

    response = Mock()
    response.success = True
    response.status_code = 200
    response.content = """
        <html>
            <a href="/about">About</a>
        </html>
    """
    response.error = None

    with patch(
        "crawler.crawler.PageFetcher.fetch",
        return_value=response,
    ):
        crawler = Crawler(config)

        result = crawler.crawl(
            "https://example.com/"
        )

    assert result.pages_crawled == 2
    assert result.pages_failed == 0

    start = crawler.queue.get(
        "https://example.com/"
    )

    about = crawler.queue.get(
        "https://example.com/about"
    )

    assert start is not None
    assert about is not None

    assert start.state == URLState.COMPLETED
    assert about.state == URLState.COMPLETED


def test_crawler_respects_max_depth():
    config = CrawlerConfig(
        max_pages=10,
        max_depth=0,
        allowed_domains=["example.com"],
        respect_robots_txt=False,
    )

    response = Mock()
    response.success = True
    response.status_code = 200
    response.content = """
        <html>
            <a href="/about">About</a>
        </html>
    """
    response.error = None

    with patch(
        "crawler.crawler.PageFetcher.fetch",
        return_value=response,
    ):
        crawler = Crawler(config)

        result = crawler.crawl(
            "https://example.com/"
        )

    assert result.pages_crawled == 1
    assert crawler.queue.get(
        "https://example.com/about"
    ) is None


def test_crawler_records_failed_fetch():
    config = CrawlerConfig(
        max_pages=10,
        max_depth=1,
        allowed_domains=["example.com"],
        respect_robots_txt=False,
    )

    response = Mock()
    response.success = False
    response.status_code = None
    response.content = ""
    response.error = "connection failed"

    with patch(
        "crawler.crawler.PageFetcher.fetch",
        return_value=response,
    ):
        crawler = Crawler(config)

        result = crawler.crawl(
            "https://example.com/"
        )

    assert result.pages_crawled == 0
    assert result.pages_failed == 1

    item = crawler.queue.get(
        "https://example.com/"
    )

    assert item is not None
    assert item.state == URLState.FAILED
    assert item.error == "connection failed"
def test_crawler_respects_max_pages():
    config = CrawlerConfig(
        max_pages=2,
        max_depth=3,
        allowed_domains=["example.com"],
        respect_robots_txt=False,
    )

    response = Mock()
    response.success = True
    response.status_code = 200
    response.content = """
        <html>
            <a href="/page1">Page 1</a>
            <a href="/page2">Page 2</a>
            <a href="/page3">Page 3</a>
        </html>
    """
    response.error = None

    with patch(
        "crawler.crawler.PageFetcher.fetch",
        return_value=response,
    ):
        crawler = Crawler(config)

        result = crawler.crawl(
            "https://example.com/"
        )

    assert result.pages_crawled <= 2
def test_crawler_records_crawled_page():
    config = CrawlerConfig(
        max_pages=5,
        max_depth=0,
        allowed_domains=["example.com"],
        respect_robots_txt=False,
    )

    response = Mock()
    response.success = True
    response.status_code = 200
    response.content = "<html><body>Hello</body></html>"
    response.content_type = "text/html"
    response.error = None

    with patch(
        "crawler.crawler.PageFetcher.fetch",
        return_value=response,
    ):
        crawler = Crawler(config)

        result = crawler.crawl(
            "https://example.com/"
        )

    assert len(result.pages) == 1

    page = result.pages[0]

    assert page.url == "https://example.com/"
    assert page.depth == 0
    assert page.status_code == 200
    assert page.content_type == "text/html"
    assert page.content == "<html><body>Hello</body></html>"
    assert page.error is None
    assert page.success is True
def test_crawler_does_not_discover_links_from_non_html():
    config = CrawlerConfig(
        max_pages=5,
        max_depth=1,
        allowed_domains=["example.com"],
        respect_robots_txt=False,
    )

    response = Mock()
    response.success = True
    response.status_code = 200
    response.content_type = "application/pdf"
    response.content = (
        '<a href="/should-not-crawl">Should not crawl</a>'
    )
    response.error = None

    with patch(
        "crawler.crawler.PageFetcher.fetch",
        return_value=response,
    ):
        crawler = Crawler(config)

        result = crawler.crawl(
            "https://example.com/file.pdf"
        )

    assert result.pages_crawled == 1
    assert len(result.pages) == 1
    assert len(result.urls) == 1

    assert (
        result.urls[0].url
        == "https://example.com/file.pdf"
    )
def test_crawler_discovers_links_from_html():
    config = CrawlerConfig(
        max_pages=5,
        max_depth=1,
        allowed_domains=["example.com"],
        respect_robots_txt=False,
    )

    responses = {
        "https://example.com/": Mock(
            success=True,
            status_code=200,
            content_type="text/html",
            content='<a href="/about">About</a>',
            error=None,
        ),
        "https://example.com/about": Mock(
            success=True,
            status_code=200,
            content_type="text/html",
            content="<html><body>About</body></html>",
            error=None,
        ),
    }

    def fake_fetch(url):
        return responses[url]

    with patch(
        "crawler.crawler.PageFetcher.fetch",
        side_effect=fake_fetch,
    ):
        crawler = Crawler(config)

        result = crawler.crawl(
            "https://example.com/"
        )

    assert result.pages_crawled == 2
    assert len(result.pages) == 2

    urls = [page.url for page in result.pages]

    assert "https://example.com/" in urls
    assert "https://example.com/about" in urls
def test_crawler_continues_after_failed_page():
    config = CrawlerConfig(
        max_pages=5,
        max_depth=1,
        allowed_domains=["example.com"],
        respect_robots_txt=False,
    )

    failed_response = Mock(
        success=False,
        status_code=500,
        content_type="text/html",
        content="",
        error="Server error",
    )

    successful_response = Mock(
        success=True,
        status_code=200,
        content_type="text/html",
        content="<html><body>OK</body></html>",
        error=None,
    )

    responses = {
        "https://example.com/": failed_response,
        "https://example.com/about": successful_response,
    }

    def fake_fetch(url):
        return responses[url]

    with patch(
        "crawler.crawler.PageFetcher.fetch",
        side_effect=fake_fetch,
    ):
        crawler = Crawler(config)

        crawler.queue.add_with_robots(
            "https://example.com/about",
            1,
            crawler.robots,
        )

        result = crawler.crawl(
            "https://example.com/"
        )

    assert result.pages_failed == 1
    assert result.pages_crawled == 1
    assert len(result.pages) == 2

    failed_page = next(
        page
        for page in result.pages
        if page.url == "https://example.com/"
    )

    successful_page = next(
        page
        for page in result.pages
        if page.url == "https://example.com/about"
    )

    assert failed_page.error == "Server error"
    assert failed_page.success is False
    assert successful_page.success is True


def test_crawler_never_crawls_more_than_max_pages():
    config = CrawlerConfig(
        max_pages=3,
        max_depth=5,
        allowed_domains=["example.com"],
        respect_robots_txt=False,
    )

    # Page returns 10 new unique links every time
    def fake_fetch(url):
        mock_resp = Mock()
        mock_resp.success = True
        mock_resp.status_code = 200
        mock_resp.content_type = "text/html"
        mock_resp.error = None
        # Generate 10 links
        links_html = "".join(f'<a href="/page_{i}">Link {i}</a>' for i in range(10))
        mock_resp.content = f"<html><body>{links_html}</body></html>"
        return mock_resp

    with patch(
        "crawler.crawler.PageFetcher.fetch",
        side_effect=fake_fetch,
    ):
        crawler = Crawler(config)
        result = crawler.crawl("https://example.com/")

    assert result.pages_crawled <= config.max_pages
    assert len(result.pages) <= config.max_pages
    assert result.pages_crawled == 3
    assert len(result.pages) == 3


def test_crawler_never_crawls_deeper_than_max_depth():
    config = CrawlerConfig(
        max_pages=20,
        max_depth=2,
        allowed_domains=["example.com"],
        respect_robots_txt=False,
    )

    # Chain: / -> /d1 -> /d2 -> /d3 -> /d4
    responses = {
        "https://example.com/": Mock(
            success=True,
            status_code=200,
            content_type="text/html",
            content='<a href="/d1">Depth 1</a>',
            error=None,
        ),
        "https://example.com/d1": Mock(
            success=True,
            status_code=200,
            content_type="text/html",
            content='<a href="/d2">Depth 2</a>',
            error=None,
        ),
        "https://example.com/d2": Mock(
            success=True,
            status_code=200,
            content_type="text/html",
            content='<a href="/d3">Depth 3</a>',
            error=None,
        ),
        "https://example.com/d3": Mock(
            success=True,
            status_code=200,
            content_type="text/html",
            content='<a href="/d4">Depth 4</a>',
            error=None,
        ),
    }

    fetched_urls = []

    def fake_fetch(url):
        fetched_urls.append(url)
        return responses[url]

    with patch(
        "crawler.crawler.PageFetcher.fetch",
        side_effect=fake_fetch,
    ):
        crawler = Crawler(config)
        result = crawler.crawl("https://example.com/")

    # Only depths 0, 1, 2 should be crawled
    assert result.pages_crawled == 3
    assert len(result.pages) == 3

    page_urls = [p.url for p in result.pages]
    assert "https://example.com/" in page_urls
    assert "https://example.com/d1" in page_urls
    assert "https://example.com/d2" in page_urls
    assert "https://example.com/d3" not in page_urls
    assert "https://example.com/d4" not in page_urls

    for page in result.pages:
        assert page.depth <= config.max_depth

    assert "https://example.com/d3" not in fetched_urls
    assert "https://example.com/d4" not in fetched_urls


def test_crawler_handles_timeout_as_failed_request_without_crashing():
    config = CrawlerConfig(
        max_pages=5,
        max_depth=1,
        timeout_seconds=2.0,
        retry_count=1,
        allowed_domains=["example.com"],
        respect_robots_txt=False,
    )

    timeout_response = Mock()
    timeout_response.success = False
    timeout_response.status_code = None
    timeout_response.content = ""
    timeout_response.content_type = ""
    timeout_response.error = "Connection timed out after 2.0s"

    ok_response = Mock()
    ok_response.success = True
    ok_response.status_code = 200
    ok_response.content_type = "text/html"
    ok_response.content = "<html><body>Home</body></html>"
    ok_response.error = None

    responses = {
        "https://example.com/slow": timeout_response,
        "https://example.com/": ok_response,
    }

    def fake_fetch(url):
        return responses[url]

    with patch(
        "crawler.crawler.PageFetcher.fetch",
        side_effect=fake_fetch,
    ):
        crawler = Crawler(config)
        crawler.queue.add_with_robots(
            "https://example.com/slow",
            1,
            crawler.robots,
        )
        result = crawler.crawl("https://example.com/")

    assert result.pages_failed == 1
    assert result.pages_crawled == 1
    assert len(result.pages) == 2

    failed_page = next(
        p for p in result.pages if p.url == "https://example.com/slow"
    )
    assert failed_page.error == "Connection timed out after 2.0s"
    assert failed_page.success is False

    success_page = next(
        p for p in result.pages if p.url == "https://example.com/"
    )
    assert success_page.success is True


def test_crawler_handles_http_404_as_failed_page():
    config = CrawlerConfig(max_pages=5, max_depth=1, allowed_domains=["example.com"], respect_robots_txt=False)
    responses = {
        "https://example.com/": Mock(
            success=True, status_code=200, content_type="text/html",
            content='<a href="/missing">Missing</a><a href="/about">About</a>', error=None
        ),
        "https://example.com/missing": Mock(
            success=False, status_code=404, content_type="text/html", content="404", error="HTTP 404"
        ),
        "https://example.com/about": Mock(
            success=True, status_code=200, content_type="text/html", content="About", error=None
        ),
    }

    with patch("crawler.crawler.PageFetcher.fetch", side_effect=lambda url: responses[url]):
        crawler = Crawler(config)
        result = crawler.crawl("https://example.com/")

    assert result.pages_failed == 1
    assert result.pages_crawled == 2
    assert len(result.pages) == 3

    missing_page = next(p for p in result.pages if p.url == "https://example.com/missing")
    assert missing_page.status_code == 404
    assert missing_page.error == "HTTP 404"
    assert missing_page.success is False


def test_crawler_handles_http_429_rate_limited():
    config = CrawlerConfig(max_pages=5, max_depth=1, allowed_domains=["example.com"], respect_robots_txt=False)
    responses = {
        "https://example.com/": Mock(
            success=False, status_code=429, content_type="text/plain", content="Rate limited", error="HTTP 429"
        ),
    }

    with patch("crawler.crawler.PageFetcher.fetch", side_effect=lambda url: responses[url]):
        crawler = Crawler(config)
        result = crawler.crawl("https://example.com/")

    assert result.pages_failed == 1
    assert result.pages_crawled == 0
    assert len(result.pages) == 1
    assert result.pages[0].status_code == 429
    assert result.pages[0].error == "HTTP 429"


def test_crawler_handles_http_500_502_503():
    config = CrawlerConfig(max_pages=5, max_depth=1, allowed_domains=["example.com"], respect_robots_txt=False)
    responses = {
        "https://example.com/": Mock(
            success=True, status_code=200, content_type="text/html",
            content='<a href="/err500">500</a><a href="/err502">502</a><a href="/err503">503</a>', error=None
        ),
        "https://example.com/err500": Mock(
            success=False, status_code=500, content_type="text/html", content="", error="HTTP 500"
        ),
        "https://example.com/err502": Mock(
            success=False, status_code=502, content_type="text/html", content="", error="HTTP 502"
        ),
        "https://example.com/err503": Mock(
            success=False, status_code=503, content_type="text/html", content="", error="HTTP 503"
        ),
    }

    with patch("crawler.crawler.PageFetcher.fetch", side_effect=lambda url: responses[url]):
        crawler = Crawler(config)
        result = crawler.crawl("https://example.com/")

    assert result.pages_failed == 3
    assert result.pages_crawled == 1
    assert len(result.pages) == 4

    p500 = next(p for p in result.pages if p.url == "https://example.com/err500")
    assert p500.status_code == 500
    assert p500.error == "HTTP 500"

    p502 = next(p for p in result.pages if p.url == "https://example.com/err502")
    assert p502.status_code == 502
    assert p502.error == "HTTP 502"

    p503 = next(p for p in result.pages if p.url == "https://example.com/err503")
    assert p503.status_code == 503
    assert p503.error == "HTTP 503"


def test_crawler_handles_dns_and_ssl_errors_without_crashing():
    config = CrawlerConfig(max_pages=5, max_depth=1, allowed_domains=["example.com"], respect_robots_txt=False)
    responses = {
        "https://example.com/": Mock(
            success=True, status_code=200, content_type="text/html",
            content='<a href="/dns-err">DNS</a><a href="/ssl-err">SSL</a>', error=None
        ),
        "https://example.com/dns-err": Mock(
            success=False, status_code=None, content_type="", content="", error="DNS lookup failed"
        ),
        "https://example.com/ssl-err": Mock(
            success=False, status_code=None, content_type="", content="", error="SSL: CERTIFICATE_VERIFY_FAILED"
        ),
    }

    with patch("crawler.crawler.PageFetcher.fetch", side_effect=lambda url: responses[url]):
        crawler = Crawler(config)
        result = crawler.crawl("https://example.com/")

    assert result.pages_failed == 2
    assert result.pages_crawled == 1
    assert len(result.pages) == 3

    dns_page = next(p for p in result.pages if p.url == "https://example.com/dns-err")
    assert dns_page.error == "DNS lookup failed"
    assert dns_page.status_code is None

    ssl_page = next(p for p in result.pages if p.url == "https://example.com/ssl-err")
    assert ssl_page.error == "SSL: CERTIFICATE_VERIFY_FAILED"
    assert ssl_page.status_code is None


def test_failed_page_does_not_prevent_subsequent_queued_pages_from_crawling():
    config = CrawlerConfig(max_pages=5, max_depth=1, allowed_domains=["example.com"], respect_robots_txt=False)
    responses = {
        "https://example.com/": Mock(
            success=True, status_code=200, content_type="text/html",
            content='<a href="/page1">1</a><a href="/broken">Broken</a><a href="/page2">2</a>', error=None
        ),
        "https://example.com/page1": Mock(
            success=True, status_code=200, content_type="text/html", content="OK 1", error=None
        ),
        "https://example.com/broken": Mock(
            success=False, status_code=None, content_type="", content="", error="Connection dropped"
        ),
        "https://example.com/page2": Mock(
            success=True, status_code=200, content_type="text/html", content="OK 2", error=None
        ),
    }

    with patch("crawler.crawler.PageFetcher.fetch", side_effect=lambda url: responses[url]):
        crawler = Crawler(config)
        result = crawler.crawl("https://example.com/")

    assert result.pages_crawled == 3
    assert result.pages_failed == 1
    assert len(result.pages) == 4

    urls_crawled = [p.url for p in result.pages if p.success]
    assert "https://example.com/" in urls_crawled
    assert "https://example.com/page1" in urls_crawled
    assert "https://example.com/page2" in urls_crawled

    broken_page = next(p for p in result.pages if p.url == "https://example.com/broken")
    assert broken_page.success is False
    assert broken_page.error == "Connection dropped"


def test_crawler_respects_request_delay_seconds():
    config = CrawlerConfig(
        max_pages=5,
        max_depth=1,
        request_delay_seconds=0.75,
        allowed_domains=["example.com"],
        respect_robots_txt=False,
    )
    responses = {
        "https://example.com/": Mock(
            success=True, status_code=200, content_type="text/html",
            content='<a href="/page1">1</a><a href="/page2">2</a>', error=None
        ),
        "https://example.com/page1": Mock(
            success=True, status_code=200, content_type="text/html", content="1", error=None
        ),
        "https://example.com/page2": Mock(
            success=True, status_code=200, content_type="text/html", content="2", error=None
        ),
    }

    with patch("crawler.crawler.time.sleep") as mock_sleep, \
         patch("crawler.crawler.PageFetcher.fetch", side_effect=lambda url: responses[url]):
        crawler = Crawler(config)
        result = crawler.crawl("https://example.com/")

    assert result.pages_crawled == 3
    # Initial request has no delay; subsequent 2 requests each trigger a delay
    assert mock_sleep.call_count == 2
    mock_sleep.assert_called_with(0.75)


def test_crawler_never_exceeds_max_concurrency():
    config = CrawlerConfig(
        max_pages=10,
        max_depth=1,
        max_concurrency=2,
        allowed_domains=["example.com"],
        respect_robots_txt=False,
    )
    responses = {
        "https://example.com/": Mock(
            success=True, status_code=200, content_type="text/html",
            content='<a href="/page1">1</a><a href="/page2">2</a><a href="/page3">3</a>', error=None
        ),
        "https://example.com/page1": Mock(
            success=True, status_code=200, content_type="text/html", content="1", error=None
        ),
        "https://example.com/page2": Mock(
            success=True, status_code=200, content_type="text/html", content="2", error=None
        ),
        "https://example.com/page3": Mock(
            success=True, status_code=200, content_type="text/html", content="3", error=None
        ),
    }

    active_requests = 0
    max_observed_concurrency = 0

    def fake_fetch(url):
        nonlocal active_requests, max_observed_concurrency
        active_requests += 1
        max_observed_concurrency = max(max_observed_concurrency, active_requests)
        active_requests -= 1
        return responses[url]

    with patch("crawler.crawler.PageFetcher.fetch", side_effect=fake_fetch):
        crawler = Crawler(config)
        result = crawler.crawl("https://example.com/")

    assert result.pages_crawled == 4
    assert max_observed_concurrency <= config.max_concurrency


def test_crawler_cancellation_stops_crawl_safely():
    config = CrawlerConfig(
        max_pages=10,
        max_depth=1,
        allowed_domains=["example.com"],
        respect_robots_txt=False,
    )
    responses = {
        "https://example.com/": Mock(
            success=True, status_code=200, content_type="text/html",
            content='<a href="/page1">1</a><a href="/page2">2</a><a href="/page3">3</a>', error=None
        ),
        "https://example.com/page1": Mock(
            success=True, status_code=200, content_type="text/html", content="1", error=None
        ),
        "https://example.com/page2": Mock(
            success=True, status_code=200, content_type="text/html", content="2", error=None
        ),
        "https://example.com/page3": Mock(
            success=True, status_code=200, content_type="text/html", content="3", error=None
        ),
    }

    crawler = Crawler(config)

    def fake_fetch(url):
        if url == "https://example.com/page1":
            crawler.cancel()
        return responses[url]

    with patch("crawler.crawler.PageFetcher.fetch", side_effect=fake_fetch):
        result = crawler.crawl("https://example.com/")

    assert crawler.is_cancelled is True
    # Start URL and page1 crawled, then cancellation stopped page2 and page3
    assert result.pages_crawled == 2
    assert len(result.pages) == 2

    crawled_urls = [p.url for p in result.pages]
    assert "https://example.com/" in crawled_urls
    assert "https://example.com/page1" in crawled_urls
    assert "https://example.com/page2" not in crawled_urls
    assert "https://example.com/page3" not in crawled_urls

    # Verify uncrawled URLs are not marked as completed
    page2_item = crawler.queue.get("https://example.com/page2")
    assert page2_item is not None
    assert page2_item.state == URLState.QUEUED

    page3_item = crawler.queue.get("https://example.com/page3")
    assert page3_item is not None
    assert page3_item.state == URLState.QUEUED


def test_crawler_cancellation_callback_stops_crawl():
    config = CrawlerConfig(
        max_pages=10,
        max_depth=1,
        allowed_domains=["example.com"],
        respect_robots_txt=False,
    )
    responses = {
        "https://example.com/": Mock(
            success=True, status_code=200, content_type="text/html",
            content='<a href="/page1">1</a><a href="/page2">2</a>', error=None
        ),
        "https://example.com/page1": Mock(
            success=True, status_code=200, content_type="text/html", content="1", error=None
        ),
        "https://example.com/page2": Mock(
            success=True, status_code=200, content_type="text/html", content="2", error=None
        ),
    }

    cancel_flag = False

    def is_cancelled():
        return cancel_flag

    def fake_fetch(url):
        nonlocal cancel_flag
        if url == "https://example.com/":
            cancel_flag = True
        return responses[url]

    with patch("crawler.crawler.PageFetcher.fetch", side_effect=fake_fetch):
        crawler = Crawler(config)
        result = crawler.crawl("https://example.com/", is_cancelled=is_cancelled)

    assert result.pages_crawled == 1
    assert len(result.pages) == 1
    assert crawler.queue.get("https://example.com/page1").state == URLState.QUEUED


def test_crawler_cancellation_before_start_does_not_crash():
    config = CrawlerConfig(
        max_pages=5,
        max_depth=1,
        allowed_domains=["example.com"],
        respect_robots_txt=False,
    )
    crawler = Crawler(config)
    crawler.cancel()

    with patch("crawler.crawler.PageFetcher.fetch") as mock_fetch:
        result = crawler.crawl("https://example.com/")

    assert result.pages_crawled == 0
    assert len(result.pages) == 0
    assert mock_fetch.call_count == 0


def test_crawler_crawls_multiple_allowed_domains():
    config = CrawlerConfig(
        max_pages=10,
        max_depth=2,
        allowed_domains=["example.com", "docs.example.org", "cdn.partner.io"],
        respect_robots_txt=False,
    )
    responses = {
        "https://example.com/": Mock(
            success=True, status_code=200, content_type="text/html",
            content='<a href="https://docs.example.org/guide">Docs</a><a href="https://cdn.partner.io/script">CDN</a><a href="https://external.com/blocked">Blocked</a>',
            error=None,
        ),
        "https://docs.example.org/guide": Mock(
            success=True, status_code=200, content_type="text/html", content="Guide", error=None
        ),
        "https://cdn.partner.io/script": Mock(
            success=True, status_code=200, content_type="text/html", content="CDN content", error=None
        ),
    }

    with patch("crawler.crawler.PageFetcher.fetch", side_effect=lambda url: responses[url]):
        crawler = Crawler(config)
        result = crawler.crawl("https://example.com/")

    assert result.pages_crawled == 3
    assert len(result.pages) == 3

    crawled_urls = [p.url for p in result.pages]
    assert "https://example.com/" in crawled_urls
    assert "https://docs.example.org/guide" in crawled_urls
    assert "https://cdn.partner.io/script" in crawled_urls
    assert "https://external.com/blocked" not in crawled_urls


def test_crawler_ignores_external_domains_and_crawls_internal_links():
    config = CrawlerConfig(
        max_pages=5,
        max_depth=1,
        allowed_domains=["example.com"],
        respect_robots_txt=False,
    )
    responses = {
        "https://example.com/": Mock(
            success=True, status_code=200, content_type="text/html",
            content='<a href="/internal-page">Internal</a><a href="https://twitter.com/acct">Twitter</a><a href="https://fakeexample.com/phish">Fake</a>',
            error=None,
        ),
        "https://example.com/internal-page": Mock(
            success=True, status_code=200, content_type="text/html", content="Internal Page", error=None
        ),
    }

    with patch("crawler.crawler.PageFetcher.fetch", side_effect=lambda url: responses[url]):
        crawler = Crawler(config)
        result = crawler.crawl("https://example.com/")

    assert result.pages_crawled == 2
    assert len(result.pages) == 2

    crawled_urls = [p.url for p in result.pages]
    assert "https://example.com/" in crawled_urls
    assert "https://example.com/internal-page" in crawled_urls
    assert "https://twitter.com/acct" not in crawled_urls
    assert "https://fakeexample.com/phish" not in crawled_urls


def test_crawler_empty_allowed_domains_crawls_start_url():
    config = CrawlerConfig(
        max_pages=5,
        max_depth=1,
        allowed_domains=[],
        respect_robots_txt=False,
    )
    response = Mock(
        success=True, status_code=200, content_type="text/html",
        content='<a href="/about">About</a>', error=None
    )

    with patch("crawler.crawler.PageFetcher.fetch", return_value=response):
        crawler = Crawler(config)
        result = crawler.crawl("https://example.com/")

    # Start URL is crawled; empty allowed_domains discovers no internal links
    assert result.pages_crawled == 1
    assert len(result.pages) == 1
    assert result.pages[0].url == "https://example.com/"


def test_crawler_fragments_do_not_cause_duplicate_crawling():
    config = CrawlerConfig(
        max_pages=10,
        max_depth=1,
        allowed_domains=["example.com"],
        respect_robots_txt=False,
    )
    responses = {
        "https://example.com/": Mock(
            success=True, status_code=200, content_type="text/html",
            content='<a href="/about#team">Team</a><a href="/about#history">History</a><a href="/about/">About</a>',
            error=None,
        ),
        "https://example.com/about": Mock(
            success=True, status_code=200, content_type="text/html", content="About page", error=None
        ),
    }

    with patch("crawler.crawler.PageFetcher.fetch", side_effect=lambda url: responses[url]) as mock_fetch:
        crawler = Crawler(config)
        result = crawler.crawl("https://example.com/")

    assert result.pages_crawled == 2
    assert len(result.pages) == 2
    assert mock_fetch.call_count == 2


def test_crawler_resolves_relative_urls_correctly():
    config = CrawlerConfig(
        max_pages=10,
        max_depth=2,
        allowed_domains=["example.com"],
        respect_robots_txt=False,
    )
    responses = {
        "https://example.com/docs/api/": Mock(
            success=True, status_code=200, content_type="text/html",
            content='<a href="../guide">Guide</a><a href="endpoints">Endpoints</a>',
            error=None,
        ),
        "https://example.com/docs/guide": Mock(
            success=True, status_code=200, content_type="text/html", content="Guide", error=None
        ),
        "https://example.com/docs/api/endpoints": Mock(
            success=True, status_code=200, content_type="text/html", content="Endpoints", error=None
        ),
    }

    with patch("crawler.crawler.PageFetcher.fetch", side_effect=lambda url: responses[url]):
        crawler = Crawler(config)
        result = crawler.crawl("https://example.com/docs/api/")

    assert result.pages_crawled == 3
    assert len(result.pages) == 3
    crawled_urls = [p.url for p in result.pages]
    assert "https://example.com/docs/api/" in crawled_urls
    assert "https://example.com/docs/guide" in crawled_urls
    assert "https://example.com/docs/api/endpoints" in crawled_urls


def test_crawler_mixed_network_and_http_errors_on_different_pages():
    config = CrawlerConfig(
        max_pages=10,
        max_depth=1,
        allowed_domains=["example.com"],
        respect_robots_txt=False,
    )
    responses = {
        "https://example.com/": Mock(
            success=True,
            status_code=200,
            content_type="text/html",
            content='<a href="/404">404</a><a href="/500">500</a><a href="/dns-err">DNS</a><a href="/ok">OK</a>',
            error=None,
        ),
        "https://example.com/404": Mock(
            success=False, status_code=404, content_type="text/html", content="Not found", error="HTTP 404"
        ),
        "https://example.com/500": Mock(
            success=False, status_code=500, content_type="text/html", content="Server error", error="HTTP 500"
        ),
        "https://example.com/dns-err": Mock(
            success=False, status_code=None, content_type="", content="", error="DNS resolution failed"
        ),
        "https://example.com/ok": Mock(
            success=True, status_code=200, content_type="text/html", content="OK page", error=None
        ),
    }

    with patch("crawler.crawler.PageFetcher.fetch", side_effect=lambda url: responses[url]):
        crawler = Crawler(config)
        result = crawler.crawl("https://example.com/")

    assert result.pages_crawled == 2
    assert result.pages_failed == 3
    assert len(result.pages) == 5

    page_map = {p.url: p for p in result.pages}
    assert page_map["https://example.com/"].status_code == 200
    assert page_map["https://example.com/404"].status_code == 404
    assert page_map["https://example.com/404"].error == "HTTP 404"
    assert page_map["https://example.com/500"].status_code == 500
    assert page_map["https://example.com/500"].error == "HTTP 500"
    assert page_map["https://example.com/dns-err"].status_code is None
    assert page_map["https://example.com/dns-err"].error == "DNS resolution failed"
    assert page_map["https://example.com/ok"].status_code == 200


def test_crawler_handles_initial_start_url_404_or_500_safely():
    config = CrawlerConfig(
        max_pages=5,
        max_depth=1,
        allowed_domains=["example.com"],
        respect_robots_txt=False,
    )
    res_404 = Mock(
        success=False,
        status_code=404,
        content_type="text/html",
        content="Not found",
        error="HTTP 404",
    )

    with patch("crawler.crawler.PageFetcher.fetch", return_value=res_404):
        crawler = Crawler(config)
        result = crawler.crawl("https://example.com/missing-start")

    assert result.pages_crawled == 0
    assert result.pages_failed == 1
    assert len(result.pages) == 1
    assert result.pages[0].url == "https://example.com/missing-start"
    assert result.pages[0].status_code == 404
    assert result.pages[0].error == "HTTP 404"


def test_crawler_handles_initial_start_url_timeout_or_dns_error_safely():
    config = CrawlerConfig(
        max_pages=5,
        max_depth=1,
        allowed_domains=["example.com"],
        respect_robots_txt=False,
    )
    res_timeout = Mock(
        success=False,
        status_code=None,
        content_type="",
        content="",
        error="Read timed out",
    )

    with patch("crawler.crawler.PageFetcher.fetch", return_value=res_timeout):
        crawler = Crawler(config)
        result = crawler.crawl("https://example.com/timeout-start")

    assert result.pages_crawled == 0
    assert result.pages_failed == 1
    assert len(result.pages) == 1
    assert result.pages[0].url == "https://example.com/timeout-start"
    assert result.pages[0].status_code is None
    assert result.pages[0].error == "Read timed out"


def test_crawler_malformed_html_does_not_crash():
    config = CrawlerConfig(
        max_pages=5,
        max_depth=1,
        allowed_domains=["example.com"],
        respect_robots_txt=False,
    )
    malformed_markup = (
        "<!DOCTYPE html><html><head><title>Malformed</title><body>"
        "<div style=broken attr unclosed>"
        "<a href='/valid-link'>Valid</a>"
        "<a href=>Empty</a><a href='http://invalid space'>Space</a>"
        "<div><p>Unclosed paragraph"
    )
    responses = {
        "https://example.com/": Mock(
            success=True,
            status_code=200,
            content_type="text/html",
            content=malformed_markup,
            error=None,
        ),
        "https://example.com/valid-link": Mock(
            success=True,
            status_code=200,
            content_type="text/html",
            content="<html><body>Valid Page</body></html>",
            error=None,
        ),
    }

    with patch("crawler.crawler.PageFetcher.fetch", side_effect=lambda url: responses[url]):
        crawler = Crawler(config)
        result = crawler.crawl("https://example.com/")

    assert result.pages_crawled == 2
    assert len(result.pages) == 2
    crawled_urls = [p.url for p in result.pages]
    assert "https://example.com/" in crawled_urls
    assert "https://example.com/valid-link" in crawled_urls


def test_crawler_handles_non_html_content_types_safely():
    config = CrawlerConfig(
        max_pages=5,
        max_depth=1,
        allowed_domains=["example.com"],
        respect_robots_txt=False,
    )
    responses = {
        "https://example.com/": Mock(
            success=True,
            status_code=200,
            content_type="text/html",
            content='<a href="/data.json">JSON</a><a href="/document.pdf">PDF</a><a href="/image.png">PNG</a>',
            error=None,
        ),
        "https://example.com/data.json": Mock(
            success=True,
            status_code=200,
            content_type="application/json",
            content='{"key": "value", "link": "/ignored"}',
            error=None,
        ),
        "https://example.com/document.pdf": Mock(
            success=True,
            status_code=200,
            content_type="application/pdf",
            content="%PDF-1.4 binary content",
            error=None,
        ),
        "https://example.com/image.png": Mock(
            success=True,
            status_code=200,
            content_type="image/png",
            content="\x89PNG binary",
            error=None,
        ),
    }

    with patch("crawler.crawler.PageFetcher.fetch", side_effect=lambda url: responses[url]):
        crawler = Crawler(config)
        result = crawler.crawl("https://example.com/")

    assert result.pages_crawled == 4
    assert len(result.pages) == 4
    # Non-HTML pages were recorded, but link discovery was skipped
    assert "/ignored" not in [u.url for u in result.urls]


def test_crawler_captures_redirect_final_url():
    config = CrawlerConfig(
        max_pages=5,
        max_depth=1,
        allowed_domains=["example.com"],
        respect_robots_txt=False,
    )
    responses = {
        "https://example.com/": Mock(
            success=True,
            status_code=200,
            content_type="text/html",
            content='<a href="/old-path">Old Path</a>',
            final_url="https://example.com/",
            error=None,
        ),
        "https://example.com/old-path": Mock(
            success=True,
            status_code=200,
            content_type="text/html",
            content="<html>Redirected</html>",
            final_url="https://example.com/new-path",
            error=None,
        ),
    }

    with patch("crawler.crawler.PageFetcher.fetch", side_effect=lambda url: responses[url]):
        crawler = Crawler(config)
        result = crawler.crawl("https://example.com/")

    assert result.pages_crawled == 2
    redirected_page = next(p for p in result.pages if p.url == "https://example.com/old-path")
    assert redirected_page.url == "https://example.com/old-path"
    assert redirected_page.final_url == "https://example.com/new-path"


def test_crawler_skips_malformed_discovered_urls_safely():
    config = CrawlerConfig(
        max_pages=5,
        max_depth=1,
        allowed_domains=["example.com"],
        respect_robots_txt=False,
    )
    markup = (
        '<a href="http://">Bad Scheme</a>'
        '<a href="javascript:void(0)">JS</a>'
        '<a href="mailto:admin@example.com">Email</a>'
        '<a href="tel:+1234567890">Phone</a>'
        '<a href="/legit-page">Legit</a>'
    )
    responses = {
        "https://example.com/": Mock(
            success=True,
            status_code=200,
            content_type="text/html",
            content=markup,
            error=None,
        ),
        "https://example.com/legit-page": Mock(
            success=True,
            status_code=200,
            content_type="text/html",
            content="<html>Legit</html>",
            error=None,
        ),
    }

    with patch("crawler.crawler.PageFetcher.fetch", side_effect=lambda url: responses[url]):
        crawler = Crawler(config)
        result = crawler.crawl("https://example.com/")

    assert result.pages_crawled == 2
    crawled_urls = [p.url for p in result.pages]
    assert "https://example.com/" in crawled_urls
    assert "https://example.com/legit-page" in crawled_urls


def test_crawler_robots_blocked_urls_skipped_and_not_fetched():
    config = CrawlerConfig(
        max_pages=5,
        max_depth=1,
        allowed_domains=["example.com"],
        respect_robots_txt=True,
    )
    responses = {
        "https://example.com/": Mock(
            success=True,
            status_code=200,
            content_type="text/html",
            content='<a href="/public">Public</a><a href="/admin">Admin</a>',
            error=None,
        ),
        "https://example.com/public": Mock(
            success=True,
            status_code=200,
            content_type="text/html",
            content="<html>Public Area</html>",
            error=None,
        ),
    }

    with patch("crawler.crawler.RobotsChecker.can_fetch", side_effect=lambda url, *args, **kwargs: "/admin" not in url), \
         patch("crawler.crawler.PageFetcher.fetch", side_effect=lambda url: responses[url]) as mock_fetch:
        crawler = Crawler(config)
        result = crawler.crawl("https://example.com/")

    assert result.pages_crawled == 2
    assert result.pages_skipped == 1
    crawled_urls = [p.url for p in result.pages]
    assert "https://example.com/" in crawled_urls
    assert "https://example.com/public" in crawled_urls
    assert "https://example.com/admin" not in crawled_urls

    # Verify fetch was never called for /admin
    fetched_urls = [call.args[0] for call in mock_fetch.call_args_list]
    assert "https://example.com/admin" not in fetched_urls


def test_crawler_mixed_counters_accuracy():
    config = CrawlerConfig(
        max_pages=10,
        max_depth=1,
        allowed_domains=["example.com"],
        respect_robots_txt=True,
    )
    markup = (
        '<a href="/page1">Page 1</a>'
        '<a href="/pdf-doc">PDF</a>'
        '<a href="/not-found">404</a>'
        '<a href="/server-err">500</a>'
        '<a href="/secret">Secret</a>'
    )
    responses = {
        "https://example.com/": Mock(
            success=True,
            status_code=200,
            content_type="text/html",
            content=markup,
            error=None,
        ),
        "https://example.com/page1": Mock(
            success=True,
            status_code=200,
            content_type="text/html",
            content="<html>Page 1</html>",
            error=None,
        ),
        "https://example.com/pdf-doc": Mock(
            success=True,
            status_code=200,
            content_type="application/pdf",
            content="%PDF...",
            error=None,
        ),
        "https://example.com/not-found": Mock(
            success=False,
            status_code=404,
            content_type="text/html",
            content="Not Found",
            error="HTTP 404",
        ),
        "https://example.com/server-err": Mock(
            success=False,
            status_code=500,
            content_type="text/html",
            content="Error",
            error="HTTP 500",
        ),
    }

    # /secret is disallowed by robots.txt
    with patch("crawler.crawler.RobotsChecker.can_fetch", side_effect=lambda url, *args, **kwargs: "/secret" not in url), \
         patch("crawler.crawler.PageFetcher.fetch", side_effect=lambda url: responses[url]):
        crawler = Crawler(config)
        result = crawler.crawl("https://example.com/")

    # 3 crawled: start, page1, pdf-doc
    assert result.pages_crawled == 3
    # 2 failed: not-found, server-err
    assert result.pages_failed == 2
    # 1 skipped: secret (robots.txt)
    assert result.pages_skipped == 1
    # Total pages array has 5 items (3 successful + 2 failed)
    assert len(result.pages) == 5






