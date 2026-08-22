from crawler.models import CrawledPage


def test_successful_crawled_page():
    page = CrawledPage(
        url="https://example.com/",
        depth=0,
        status_code=200,
        content_type="text/html",
        content="<html></html>",
    )

    assert page.url == "https://example.com/"
    assert page.depth == 0
    assert page.status_code == 200
    assert page.content_type == "text/html"
    assert page.content == "<html></html>"
    assert page.error is None
    assert page.success is True


def test_failed_crawled_page():
    page = CrawledPage(
        url="https://example.com/",
        depth=1,
        status_code=None,
        content_type="",
        error="connection failed",
    )

    assert page.success is False
    assert page.error == "connection failed"


def test_http_error_page_is_not_successful():
    page = CrawledPage(
        url="https://example.com/missing",
        depth=1,
        status_code=404,
        content_type="text/html",
        content="Not Found",
        error="HTTP 404",
    )

    assert page.success is False