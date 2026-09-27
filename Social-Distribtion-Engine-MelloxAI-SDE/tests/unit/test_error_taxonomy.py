"""Unit tests for error classification and taxonomy."""

from __future__ import annotations

from app.adapters.errors import (
    AccountDisconnectedError,
    AuthError,
    ErrorCategory,
    FatalContentError,
    MediaError,
    RateLimitError,
    TransientError,
    classify_http_error,
)


class TestErrorCategoryEnum:
    """Tests for ErrorCategory enum values."""

    def test_transient_is_retryable(self):
        """Transient errors should be retryable."""
        assert ErrorCategory.TRANSIENT.value == "transient"

    def test_auth_is_not_retryable(self):
        """Auth errors should not be retryable."""
        assert ErrorCategory.AUTH.value == "auth"

    def test_rate_limit_value(self):
        assert ErrorCategory.RATE_LIMIT.value == "rate_limit"

    def test_fatal_value(self):
        assert ErrorCategory.FATAL.value == "fatal"

    def test_media_value(self):
        assert ErrorCategory.MEDIA.value == "media"


class TestTransientError:
    """Tests for TransientError - server errors, timeouts."""

    def test_transient_is_retryable(self):
        error = TransientError("Server error")
        assert error.retryable is True
        assert error.category == ErrorCategory.TRANSIENT

    def test_transient_with_http_status(self):
        error = TransientError("500 error", http_status=500)
        assert error.http_status == 500

    def test_transient_with_platform_code(self):
        error = TransientError("error", platform_error_code="E500")
        assert error.platform_error_code == "E500"


class TestAuthError:
    """Tests for AuthError - token issues, unauthorized."""

    def test_auth_not_retryable(self):
        error = AuthError("Token expired")
        assert error.retryable is False
        assert error.category == ErrorCategory.AUTH

    def test_auth_with_http_status(self):
        error = AuthError("Unauthorized", http_status=401)
        assert error.http_status == 401


class TestRateLimitError:
    """Tests for RateLimitError - 429 Too Many Requests."""

    def test_rate_limit_retryable(self):
        error = RateLimitError("Rate limited")
        assert error.retryable is True
        assert error.category == ErrorCategory.RATE_LIMIT

    def test_rate_limit_has_status_429(self):
        error = RateLimitError("Rate limited")
        assert error.http_status == 429

    def test_rate_limit_with_retry_after(self):
        error = RateLimitError("Rate limited", retry_after_seconds=120)
        assert error.retry_after_seconds == 120


class TestFatalContentError:
    """Tests for FatalContentError - validation failures."""

    def test_fatal_not_retryable(self):
        error = FatalContentError("Text too long")
        assert error.retryable is False
        assert error.category == ErrorCategory.FATAL

    def test_fatal_with_field(self):
        error = FatalContentError("Invalid", field="text")
        assert error.field == "text"


class TestMediaError:
    """Tests for MediaError - media processing issues."""

    def test_media_not_retryable_by_default(self):
        error = MediaError("Media too large")
        assert error.retryable is False
        assert error.category == ErrorCategory.MEDIA

    def test_media_retryable_when_specified(self):
        error = MediaError("Transient issue", retryable=True)
        assert error.retryable is True

    def test_media_with_url(self):
        error = MediaError("Invalid", media_url="https://example.com/img.jpg")
        assert error.media_url == "https://example.com/img.jpg"


class TestAccountDisconnectedError:
    """Tests for AccountDisconnectedError."""

    def test_disconnected_not_retryable(self):
        error = AccountDisconnectedError("Account revoked")
        assert error.retryable is False
        assert error.category == ErrorCategory.AUTH


class TestClassifyHttpError:
    """Tests for HTTP status code classification."""

    def test_401_is_auth(self):
        cat = classify_http_error(401)
        assert cat == ErrorCategory.AUTH

    def test_403_is_auth(self):
        cat = classify_http_error(403)
        assert cat == ErrorCategory.AUTH

    def test_429_is_rate_limit(self):
        cat = classify_http_error(429)
        assert cat == ErrorCategory.RATE_LIMIT

    def test_404_is_fatal(self):
        cat = classify_http_error(404)
        assert cat == ErrorCategory.FATAL

    def test_422_is_fatal(self):
        cat = classify_http_error(422)
        assert cat == ErrorCategory.FATAL

    def test_500_is_transient(self):
        cat = classify_http_error(500)
        assert cat == ErrorCategory.TRANSIENT

    def test_502_is_transient(self):
        cat = classify_http_error(502)
        assert cat == ErrorCategory.TRANSIENT

    def test_503_is_transient(self):
        cat = classify_http_error(503)
        assert cat == ErrorCategory.TRANSIENT

    def test_504_is_transient(self):
        cat = classify_http_error(504)
        assert cat == ErrorCategory.TRANSIENT

    def test_200_is_unknown(self):
        """2xx responses are not errors - returns UNKNOWN."""
        cat = classify_http_error(200)
        assert cat == ErrorCategory.UNKNOWN

    def test_201_is_unknown(self):
        cat = classify_http_error(201)
        assert cat == ErrorCategory.UNKNOWN

    def test_unknown_code_returns_unknown(self):
        cat = classify_http_error(999)
        assert cat == ErrorCategory.UNKNOWN
