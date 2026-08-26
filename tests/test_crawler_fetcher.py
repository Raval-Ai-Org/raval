from unittest.mock import Mock, patch

import requests

from crawler.config import CrawlerConfig
from crawler.fetcher import PageFetcher, is_html_content_type



def test_html_content_type_is_supported():
    assert is_html_content_type("text/html") is True
    assert (
        is_html_content_type("text/html; charset=utf-8")
        is True
    )
    assert (
        is_html_content_type("application/xhtml+xml")
        is True
    )


def test_non_html_content_types_are_not_supported():
    assert (
        is_html_content_type("application/pdf")
        is False
    )
    assert (
        is_html_content_type("application/json")
        is False
    )
    assert (
        is_html_content_type("image/png")
        is False
    )
def test_fetcher_retries_failed_request():
    config = CrawlerConfig(
        retry_count=2,
        timeout_seconds=5,
    )

    fetcher = PageFetcher(config)

    failed_response = Mock()
    failed_response.status_code = 500
    failed_response.headers = {
        "Content-Type": "text/html"
    }
    failed_response.text = "Server error"

    successful_response = Mock()
    successful_response.status_code = 200
    successful_response.headers = {
        "Content-Type": "text/html"
    }
    successful_response.text = "<html><body>Success</body></html>"

    with patch(
        "crawler.fetcher.requests.get",
        side_effect=[
            failed_response,
            successful_response,
        ],
    ) as mock_get:
        result = fetcher.fetch(
            "https://example.com/"
        )

    assert result.success is True
    assert result.status_code == 200
    assert result.content == "<html><body>Success</body></html>"
    assert mock_get.call_count == 2
def test_fetcher_retries_request_exception():
    config = CrawlerConfig(
        retry_count=2,
        timeout_seconds=5,
    )

    fetcher = PageFetcher(config)

    successful_response = Mock()
    successful_response.status_code = 200
    successful_response.headers = {
        "Content-Type": "text/html"
    }
    successful_response.text = "<html><body>Recovered</body></html>"

    with patch(
        "crawler.fetcher.requests.get",
        side_effect=[
            requests.RequestException("Connection failed"),
            successful_response,
        ],
    ) as mock_get:
        result = fetcher.fetch(
            "https://example.com/"
        )

    assert result.success is True
    assert result.status_code == 200
    assert result.content == "<html><body>Recovered</body></html>"
    assert mock_get.call_count == 2
def test_fetcher_returns_failure_after_retries_exhausted():
    config = CrawlerConfig(
        retry_count=2,
        timeout_seconds=5,
    )

    fetcher = PageFetcher(config)

    with patch(
        "crawler.fetcher.requests.get",
        side_effect=requests.RequestException(
            "Connection failed"
        ),
    ) as mock_get:
        result = fetcher.fetch(
            "https://example.com/"
        )

    assert result.success is False
    assert result.status_code is None
    assert result.error == "Connection failed"
    assert mock_get.call_count == 3


def test_successful_request_no_unnecessary_retries():
    config = CrawlerConfig(
        retry_count=3,
        timeout_seconds=7.5,
    )
    fetcher = PageFetcher(config)

    response = Mock()
    response.status_code = 200
    response.headers = {"Content-Type": "text/html"}
    response.text = "<html>Success</html>"

    with patch(
        "crawler.fetcher.requests.get",
        return_value=response,
    ) as mock_get:
        result = fetcher.fetch("https://example.com/")

    assert result.success is True
    assert result.status_code == 200
    assert result.content == "<html>Success</html>"
    assert mock_get.call_count == 1
    mock_get.assert_called_once_with(
        "https://example.com/",
        timeout=7.5,
        headers={"User-Agent": "RavalGeoIntelligenceCrawler/1.0"},
    )


def test_fetcher_retry_count_zero_no_retry_on_failure():
    config = CrawlerConfig(
        retry_count=0,
        timeout_seconds=5.0,
    )
    fetcher = PageFetcher(config)

    with patch(
        "crawler.fetcher.requests.get",
        side_effect=requests.RequestException("Connection error"),
    ) as mock_get:
        result = fetcher.fetch("https://example.com/")

    assert result.success is False
    assert result.status_code is None
    assert result.error == "Connection error"
    assert mock_get.call_count == 1


def test_fetcher_timeout_error_handled_as_failed_request():
    config = CrawlerConfig(
        retry_count=1,
        timeout_seconds=3.0,
    )
    fetcher = PageFetcher(config)

    with patch(
        "crawler.fetcher.requests.get",
        side_effect=requests.exceptions.Timeout("Request timed out after 3.0s"),
    ) as mock_get:
        result = fetcher.fetch("https://example.com/slow")

    assert result.success is False
    assert result.status_code is None
    assert "timed out" in result.error.lower()
    assert mock_get.call_count == 2


def test_fetcher_handles_http_404_not_found():
    config = CrawlerConfig(retry_count=1, timeout_seconds=5.0)
    fetcher = PageFetcher(config)

    response = Mock()
    response.status_code = 404
    response.headers = {"Content-Type": "text/html"}
    response.text = "<html>404 Not Found</html>"

    with patch("crawler.fetcher.requests.get", return_value=response) as mock_get:
        result = fetcher.fetch("https://example.com/missing")

    assert result.success is False
    assert result.status_code == 404
    assert result.error == "HTTP 404"
    assert result.content == "<html>404 Not Found</html>"
    assert mock_get.call_count == 2


def test_fetcher_handles_http_429_rate_limited():
    config = CrawlerConfig(retry_count=0, timeout_seconds=5.0)
    fetcher = PageFetcher(config)

    response = Mock()
    response.status_code = 429
    response.headers = {"Content-Type": "text/plain"}
    response.text = "Too Many Requests"

    with patch("crawler.fetcher.requests.get", return_value=response) as mock_get:
        result = fetcher.fetch("https://example.com/rate-limited")

    assert result.success is False
    assert result.status_code == 429
    assert result.error == "HTTP 429"
    assert result.content == "Too Many Requests"
    assert mock_get.call_count == 1


def test_fetcher_handles_http_500_server_error():
    config = CrawlerConfig(retry_count=0, timeout_seconds=5.0)
    fetcher = PageFetcher(config)

    response = Mock()
    response.status_code = 500
    response.headers = {"Content-Type": "text/html"}
    response.text = "Internal Server Error"

    with patch("crawler.fetcher.requests.get", return_value=response) as mock_get:
        result = fetcher.fetch("https://example.com/error")

    assert result.success is False
    assert result.status_code == 500
    assert result.error == "HTTP 500"
    assert mock_get.call_count == 1


def test_fetcher_handles_http_502_and_503():
    config = CrawlerConfig(retry_count=0, timeout_seconds=5.0)
    fetcher = PageFetcher(config)

    response_502 = Mock(status_code=502, headers={"Content-Type": "text/html"}, text="Bad Gateway")
    with patch("crawler.fetcher.requests.get", return_value=response_502):
        result_502 = fetcher.fetch("https://example.com/502")
    assert result_502.success is False
    assert result_502.status_code == 502
    assert result_502.error == "HTTP 502"

    response_503 = Mock(status_code=503, headers={"Content-Type": "text/html"}, text="Service Unavailable")
    with patch("crawler.fetcher.requests.get", return_value=response_503):
        result_503 = fetcher.fetch("https://example.com/503")
    assert result_503.success is False
    assert result_503.status_code == 503
    assert result_503.error == "HTTP 503"


def test_fetcher_handles_connection_error():
    config = CrawlerConfig(retry_count=0, timeout_seconds=5.0)
    fetcher = PageFetcher(config)

    with patch(
        "crawler.fetcher.requests.get",
        side_effect=requests.exceptions.ConnectionError("Failed to connect to server"),
    ):
        result = fetcher.fetch("https://example.com/offline")

    assert result.success is False
    assert result.status_code is None
    assert "Failed to connect to server" in result.error


def test_fetcher_handles_dns_resolution_failure():
    config = CrawlerConfig(retry_count=0, timeout_seconds=5.0)
    fetcher = PageFetcher(config)

    with patch(
        "crawler.fetcher.requests.get",
        side_effect=requests.exceptions.ConnectionError("DNS lookup failed: Name or service not known"),
    ):
        result = fetcher.fetch("https://unknown-domain-dns.example.com/")

    assert result.success is False
    assert result.status_code is None
    assert "DNS lookup failed" in result.error


def test_fetcher_handles_ssl_tls_error():
    config = CrawlerConfig(retry_count=0, timeout_seconds=5.0)
    fetcher = PageFetcher(config)

    with patch(
        "crawler.fetcher.requests.get",
        side_effect=requests.exceptions.SSLError("SSL: CERTIFICATE_VERIFY_FAILED"),
    ):
        result = fetcher.fetch("https://bad-ssl.example.com/")

    assert result.success is False
    assert result.status_code is None
    assert "CERTIFICATE_VERIFY_FAILED" in result.error


def test_fetcher_retries_http_5xx_and_recovers():
    config = CrawlerConfig(retry_count=2, timeout_seconds=5.0)
    fetcher = PageFetcher(config)

    res_503 = Mock(status_code=503, headers={"Content-Type": "text/html"}, text="503 Service Unavailable")
    res_502 = Mock(status_code=502, headers={"Content-Type": "text/html"}, text="502 Bad Gateway")
    res_200 = Mock(status_code=200, headers={"Content-Type": "text/html"}, text="<html>OK</html>")

    with patch("crawler.fetcher.requests.get", side_effect=[res_503, res_502, res_200]) as mock_get:
        result = fetcher.fetch("https://example.com/intermittent")

    assert result.success is True
    assert result.status_code == 200
    assert result.content == "<html>OK</html>"
    assert mock_get.call_count == 3


def test_fetcher_retries_mixed_exceptions_and_recovers():
    config = CrawlerConfig(retry_count=2, timeout_seconds=5.0)
    fetcher = PageFetcher(config)

    res_200 = Mock(status_code=200, headers={"Content-Type": "text/html"}, text="<html>Finally recovered</html>")

    with patch(
        "crawler.fetcher.requests.get",
        side_effect=[
            requests.exceptions.Timeout("Read timeout"),
            requests.exceptions.ConnectionError("Connection reset"),
            res_200,
        ],
    ) as mock_get:
        result = fetcher.fetch("https://example.com/flaky")

    assert result.success is True
    assert result.status_code == 200
    assert result.content == "<html>Finally recovered</html>"
    assert mock_get.call_count == 3


def test_fetcher_handles_http_504_gateway_timeout():
    config = CrawlerConfig(retry_count=0, timeout_seconds=5.0)
    fetcher = PageFetcher(config)

    response = Mock(status_code=504, headers={"Content-Type": "text/html"}, text="Gateway Timeout")
    with patch("crawler.fetcher.requests.get", return_value=response) as mock_get:
        result = fetcher.fetch("https://example.com/504")

    assert result.success is False
    assert result.status_code == 504
    assert result.error == "HTTP 504"
    assert mock_get.call_count == 1


def test_fetcher_handles_http_403_and_401():
    config = CrawlerConfig(retry_count=0, timeout_seconds=5.0)
    fetcher = PageFetcher(config)

    res_403 = Mock(status_code=403, headers={"Content-Type": "text/html"}, text="Forbidden")
    with patch("crawler.fetcher.requests.get", return_value=res_403):
        result_403 = fetcher.fetch("https://example.com/forbidden")
    assert result_403.success is False
    assert result_403.status_code == 403
    assert result_403.error == "HTTP 403"

    res_401 = Mock(status_code=401, headers={"Content-Type": "text/html"}, text="Unauthorized")
    with patch("crawler.fetcher.requests.get", return_value=res_401):
        result_401 = fetcher.fetch("https://example.com/unauthorized")
    assert result_401.success is False
    assert result_401.status_code == 401
    assert result_401.error == "HTTP 401"


def test_fetcher_handles_connect_and_read_timeouts():
    config = CrawlerConfig(retry_count=0, timeout_seconds=5.0)
    fetcher = PageFetcher(config)

    with patch(
        "crawler.fetcher.requests.get",
        side_effect=requests.exceptions.ConnectTimeout("Connect timeout occurred"),
    ):
        res_connect = fetcher.fetch("https://example.com/connect-timeout")
    assert res_connect.success is False
    assert res_connect.status_code is None
    assert "Connect timeout" in res_connect.error

    with patch(
        "crawler.fetcher.requests.get",
        side_effect=requests.exceptions.ReadTimeout("Read timeout occurred"),
    ):
        res_read = fetcher.fetch("https://example.com/read-timeout")
    assert res_read.success is False
    assert res_read.status_code is None
    assert "Read timeout" in res_read.error


def test_fetcher_captures_redirect_final_url():
    config = CrawlerConfig(retry_count=0, timeout_seconds=5.0)
    fetcher = PageFetcher(config)

    response = Mock(
        status_code=200,
        headers={"Content-Type": "text/html"},
        text="<html>Final Page</html>",
        url="https://example.com/final-destination",
    )
    with patch("crawler.fetcher.requests.get", return_value=response):
        result = fetcher.fetch("https://example.com/initial-redirect")

    assert result.success is True
    assert result.url == "https://example.com/initial-redirect"
    assert result.final_url == "https://example.com/final-destination"
    assert result.status_code == 200


