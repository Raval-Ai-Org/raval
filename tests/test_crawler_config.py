import pytest

from crawler.config import CrawlerConfig


def test_default_configuration():
    config = CrawlerConfig()

    assert config.max_pages == 50
    assert config.max_depth == 3
    assert config.timeout_seconds == 10.0
    assert config.retry_count == 2
    assert config.request_delay_seconds == 0.5
    assert config.max_concurrency == 2
    assert config.respect_robots_txt is True


def test_invalid_max_pages():
    with pytest.raises(ValueError, match="max_pages"):
        CrawlerConfig(max_pages=0)
    with pytest.raises(ValueError, match="max_pages"):
        CrawlerConfig(max_pages=-5)


def test_invalid_max_depth():
    with pytest.raises(ValueError, match="max_depth"):
        CrawlerConfig(max_depth=-1)
    with pytest.raises(ValueError, match="max_depth"):
        CrawlerConfig(max_depth=-10)


def test_invalid_timeout():
    with pytest.raises(ValueError, match="timeout_seconds"):
        CrawlerConfig(timeout_seconds=0)
    with pytest.raises(ValueError, match="timeout_seconds"):
        CrawlerConfig(timeout_seconds=-2.5)


def test_invalid_retry_count():
    with pytest.raises(ValueError, match="retry_count"):
        CrawlerConfig(retry_count=-1)
    with pytest.raises(ValueError, match="retry_count"):
        CrawlerConfig(retry_count=-5)


def test_invalid_request_delay():
    with pytest.raises(ValueError, match="request_delay_seconds"):
        CrawlerConfig(request_delay_seconds=-0.5)


def test_invalid_concurrency():
    with pytest.raises(ValueError, match="max_concurrency"):
        CrawlerConfig(max_concurrency=0)
    with pytest.raises(ValueError, match="max_concurrency"):
        CrawlerConfig(max_concurrency=-2)

def test_extract_links():
    html = """
    <html>
        <body>
            <a href="/about">About</a>
            <a href="https://example.com/contact">Contact</a>
            <a href="/services">Services</a>
        </body>
    </html>
    """

    result = extract_links(html)

    assert result == [
        "/about",
        "https://example.com/contact",
        "/services",
    ]


def test_extract_links_ignores_non_anchor_elements():
    html = """
    <html>
        <body>
            <img src="/image.jpg">
            <script src="/app.js"></script>
            <a href="/about">About</a>
        </body>
    </html>
    """

    result = extract_links(html)

    assert result == ["/about"]


def test_extract_links_ignores_empty_href():
    html = """
    <a href="">Empty</a>
    <a href="/about">About</a>
    """

    result = extract_links(html)

    assert result == ["/about"]
from crawler.discovery import (
    classify_url,
    is_internal_url,
    normalize_url,
    extract_links,
)