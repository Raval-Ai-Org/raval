from crawler.robots import RobotsChecker
from crawler.sitemap import parse_sitemap_xml


def test_parse_sitemap_urlset():
    xml = """
    <urlset>
        <url>
            <loc>https://example.com/about</loc>
        </url>
        <url>
            <loc>https://example.com/contact</loc>
        </url>
    </urlset>
    """

    result = parse_sitemap_xml(xml)

    assert result.urls == [
        "https://example.com/about",
        "https://example.com/contact",
    ]

    assert result.sitemaps == []


def test_parse_sitemap_index():
    xml = """
    <sitemapindex>
        <sitemap>
            <loc>https://example.com/sitemap-pages.xml</loc>
        </sitemap>
        <sitemap>
            <loc>https://example.com/sitemap-products.xml</loc>
        </sitemap>
    </sitemapindex>
    """

    result = parse_sitemap_xml(xml)

    assert result.urls == []

    assert result.sitemaps == [
        "https://example.com/sitemap-pages.xml",
        "https://example.com/sitemap-products.xml",
    ]


def test_parse_sitemap_namespaces():
    xml = """
    <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
        <url>
            <loc>https://example.com/page</loc>
        </url>
    </urlset>
    """

    result = parse_sitemap_xml(xml)

    assert result.urls == [
        "https://example.com/page",
    ]


def test_parse_invalid_sitemap():
    result = parse_sitemap_xml(
        "<not-valid-xml"
    )

    assert result.urls == []
    assert result.sitemaps == []


def test_parse_empty_sitemap():
    result = parse_sitemap_xml("")

    assert result.urls == []
    assert result.sitemaps == []


def test_robots_sitemap_declarations(monkeypatch):
    checker = RobotsChecker()

    class FakeParser:
        def site_maps(self):
            return [
                "https://example.com/sitemap.xml",
                "https://example.com/sitemap-pages.xml",
            ]

    monkeypatch.setattr(
        checker,
        "_get_parser",
        lambda url: FakeParser(),
    )

    result = checker.get_sitemaps(
        "https://example.com/"
    )

    assert result == [
        "https://example.com/sitemap.xml",
        "https://example.com/sitemap-pages.xml",
    ]


from unittest.mock import Mock, patch
from crawler.config import CrawlerConfig
from crawler.crawler import Crawler
from crawler.queue import URLState


def test_crawler_discovers_and_crawls_sitemap_urls():
    config = CrawlerConfig(
        max_pages=10,
        max_depth=2,
        allowed_domains=["example.com"],
        respect_robots_txt=True,
    )
    sitemap_xml = """
    <urlset>
        <url><loc>https://example.com/about</loc></url>
        <url><loc>https://example.com/contact</loc></url>
    </urlset>
    """
    responses = {
        "https://example.com/sitemap.xml": Mock(
            success=True, status_code=200, content_type="application/xml", content=sitemap_xml, error=None
        ),
        "https://example.com/": Mock(
            success=True, status_code=200, content_type="text/html", content="<html>Home</html>", error=None
        ),
        "https://example.com/about": Mock(
            success=True, status_code=200, content_type="text/html", content="<html>About</html>", error=None
        ),
        "https://example.com/contact": Mock(
            success=True, status_code=200, content_type="text/html", content="<html>Contact</html>", error=None
        ),
    }

    with patch("crawler.robots.RobotsChecker.get_sitemaps", return_value=["https://example.com/sitemap.xml"]), \
         patch("crawler.crawler.PageFetcher.fetch", side_effect=lambda url: responses[url]):
        crawler = Crawler(config)
        result = crawler.crawl("https://example.com/")

    assert result.pages_crawled == 3
    assert len(result.pages) == 3
    crawled_urls = [p.url for p in result.pages]
    assert "https://example.com/" in crawled_urls
    assert "https://example.com/about" in crawled_urls
    assert "https://example.com/contact" in crawled_urls


def test_crawler_sitemap_duplicate_urls_not_added_twice():
    config = CrawlerConfig(
        max_pages=10,
        max_depth=2,
        allowed_domains=["example.com"],
        respect_robots_txt=True,
    )
    sitemap_xml = """
    <urlset>
        <url><loc>https://example.com/</loc></url>
        <url><loc>https://example.com/about</loc></url>
        <url><loc>https://example.com/about/</loc></url>
    </urlset>
    """
    responses = {
        "https://example.com/sitemap.xml": Mock(
            success=True, status_code=200, content_type="application/xml", content=sitemap_xml, error=None
        ),
        "https://example.com/": Mock(
            success=True, status_code=200, content_type="text/html", content="<html>Home</html>", error=None
        ),
        "https://example.com/about": Mock(
            success=True, status_code=200, content_type="text/html", content="<html>About</html>", error=None
        ),
    }

    with patch("crawler.robots.RobotsChecker.get_sitemaps", return_value=["https://example.com/sitemap.xml"]), \
         patch("crawler.crawler.PageFetcher.fetch", side_effect=lambda url: responses[url]) as mock_fetch:
        crawler = Crawler(config)
        result = crawler.crawl("https://example.com/")

    assert result.pages_crawled == 2
    assert len(result.pages) == 2


def test_crawler_sitemap_external_urls_filtered_out():
    config = CrawlerConfig(
        max_pages=10,
        max_depth=2,
        allowed_domains=["example.com"],
        respect_robots_txt=True,
    )
    sitemap_xml = """
    <urlset>
        <url><loc>https://malicious-external.com/hack</loc></url>
        <url><loc>https://example.com/valid</loc></url>
    </urlset>
    """
    responses = {
        "https://example.com/sitemap.xml": Mock(
            success=True, status_code=200, content_type="application/xml", content=sitemap_xml, error=None
        ),
        "https://example.com/": Mock(
            success=True, status_code=200, content_type="text/html", content="<html>Home</html>", error=None
        ),
        "https://example.com/valid": Mock(
            success=True, status_code=200, content_type="text/html", content="<html>Valid</html>", error=None
        ),
    }

    with patch("crawler.robots.RobotsChecker.get_sitemaps", return_value=["https://example.com/sitemap.xml"]), \
         patch("crawler.crawler.PageFetcher.fetch", side_effect=lambda url: responses[url]):
        crawler = Crawler(config)
        result = crawler.crawl("https://example.com/")

    assert result.pages_crawled == 2
    crawled_urls = [p.url for p in result.pages]
    assert "https://example.com/" in crawled_urls
    assert "https://example.com/valid" in crawled_urls
    assert "https://malicious-external.com/hack" not in crawled_urls


def test_crawler_sitemap_robots_disallowed_url_is_skipped():
    config = CrawlerConfig(
        max_pages=10,
        max_depth=2,
        allowed_domains=["example.com"],
        respect_robots_txt=True,
    )
    sitemap_xml = """
    <urlset>
        <url><loc>https://example.com/public</loc></url>
        <url><loc>https://example.com/secret</loc></url>
    </urlset>
    """
    responses = {
        "https://example.com/sitemap.xml": Mock(
            success=True, status_code=200, content_type="application/xml", content=sitemap_xml, error=None
        ),
        "https://example.com/": Mock(
            success=True, status_code=200, content_type="text/html", content="<html>Home</html>", error=None
        ),
        "https://example.com/public": Mock(
            success=True, status_code=200, content_type="text/html", content="<html>Public</html>", error=None
        ),
    }

    with patch("crawler.robots.RobotsChecker.get_sitemaps", return_value=["https://example.com/sitemap.xml"]), \
         patch("crawler.robots.RobotsChecker.can_fetch", side_effect=lambda url, *args, **kwargs: "/secret" not in url), \
         patch("crawler.crawler.PageFetcher.fetch", side_effect=lambda url: responses[url]) as mock_fetch:
        crawler = Crawler(config)
        result = crawler.crawl("https://example.com/")

    assert result.pages_crawled == 2
    assert result.pages_skipped == 1
    crawled_urls = [p.url for p in result.pages]
    assert "https://example.com/" in crawled_urls
    assert "https://example.com/public" in crawled_urls
    assert "https://example.com/secret" not in crawled_urls
    assert "https://example.com/secret" not in [call.args[0] for call in mock_fetch.call_args_list]


def test_crawler_sitemap_respects_max_pages_and_max_depth():
    config = CrawlerConfig(
        max_pages=2,
        max_depth=1,
        allowed_domains=["example.com"],
        respect_robots_txt=True,
    )
    sitemap_xml = """
    <urlset>
        <url><loc>https://example.com/p1</loc></url>
        <url><loc>https://example.com/p2</loc></url>
        <url><loc>https://example.com/p3</loc></url>
    </urlset>
    """
    responses = {
        "https://example.com/sitemap.xml": Mock(
            success=True, status_code=200, content_type="application/xml", content=sitemap_xml, error=None
        ),
        "https://example.com/": Mock(
            success=True, status_code=200, content_type="text/html", content="<html>Home</html>", error=None
        ),
        "https://example.com/p1": Mock(
            success=True, status_code=200, content_type="text/html", content="<html>P1</html>", error=None
        ),
        "https://example.com/p2": Mock(
            success=True, status_code=200, content_type="text/html", content="<html>P2</html>", error=None
        ),
    }

    with patch("crawler.robots.RobotsChecker.get_sitemaps", return_value=["https://example.com/sitemap.xml"]), \
         patch("crawler.crawler.PageFetcher.fetch", side_effect=lambda url: responses[url]):
        crawler = Crawler(config)
        result = crawler.crawl("https://example.com/")

    assert result.pages_crawled == 2
    assert len(result.pages) == 2


def test_crawler_sitemap_failure_continues_normal_html_crawling():
    config = CrawlerConfig(
        max_pages=5,
        max_depth=1,
        allowed_domains=["example.com"],
        respect_robots_txt=True,
    )
    responses = {
        "https://example.com/sitemap.xml": Mock(
            success=False, status_code=404, content_type="text/html", content="404", error="HTTP 404"
        ),
        "https://example.com/": Mock(
            success=True, status_code=200, content_type="text/html",
            content='<html><a href="/discovered">Discovered Page</a></html>', error=None
        ),
        "https://example.com/discovered": Mock(
            success=True, status_code=200, content_type="text/html", content="<html>Discovered</html>", error=None
        ),
    }

    with patch("crawler.robots.RobotsChecker.get_sitemaps", return_value=["https://example.com/sitemap.xml"]), \
         patch("crawler.crawler.PageFetcher.fetch", side_effect=lambda url: responses[url]):
        crawler = Crawler(config)
        result = crawler.crawl("https://example.com/")

    assert result.pages_crawled == 2
    assert len(result.pages) == 2
    crawled_urls = [p.url for p in result.pages]
    assert "https://example.com/" in crawled_urls
    assert "https://example.com/discovered" in crawled_urls


def test_crawler_sitemap_recursive_index_discovery():
    config = CrawlerConfig(
        max_pages=5,
        max_depth=2,
        allowed_domains=["example.com"],
        respect_robots_txt=True,
    )
    sitemap_index_xml = """
    <sitemapindex>
        <sitemap><loc>https://example.com/child-sitemap.xml</loc></sitemap>
    </sitemapindex>
    """
    child_sitemap_xml = """
    <urlset>
        <url><loc>https://example.com/nested-page</loc></url>
    </urlset>
    """
    responses = {
        "https://example.com/sitemap-index.xml": Mock(
            success=True, status_code=200, content_type="application/xml", content=sitemap_index_xml, error=None
        ),
        "https://example.com/child-sitemap.xml": Mock(
            success=True, status_code=200, content_type="application/xml", content=child_sitemap_xml, error=None
        ),
        "https://example.com/": Mock(
            success=True, status_code=200, content_type="text/html", content="<html>Home</html>", error=None
        ),
        "https://example.com/nested-page": Mock(
            success=True, status_code=200, content_type="text/html", content="<html>Nested</html>", error=None
        ),
    }

    with patch("crawler.robots.RobotsChecker.get_sitemaps", return_value=["https://example.com/sitemap-index.xml"]), \
         patch("crawler.crawler.PageFetcher.fetch", side_effect=lambda url: responses[url]):
        crawler = Crawler(config)
        result = crawler.crawl("https://example.com/")

    assert result.pages_crawled == 2
    crawled_urls = [p.url for p in result.pages]
    assert "https://example.com/" in crawled_urls
    assert "https://example.com/nested-page" in crawled_urls