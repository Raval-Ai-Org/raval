"""Unit tests for all platform adapters with respx HTTP mocking.

Tests verify:
1. Content validation per platform rules
2. Successful publish responses
3. Error handling (429, 401, 404, 500)
4. Rate limit detection and retry-after
5. Auth error detection (no retry)
6. Fatal content errors (no retry)
7. Connection timeouts (retryable)
8. Media validation rules
"""

from __future__ import annotations

import httpx
import pytest
import respx

from app.adapters.base import PublishContent, PublishStatus
from app.adapters.errors import (
    ErrorCategory,
    FatalContentError,
)
from app.adapters.instagram import MAX_TEXT_LENGTH as INSTAGRAM_MAX
from app.adapters.instagram import InstagramAdapter
from app.adapters.linkedin import MAX_TEXT_LENGTH as LINKEDIN_MAX
from app.adapters.linkedin import LinkedInAdapter
from app.adapters.meta import MAX_TEXT_LENGTH as FACEBOOK_MAX
from app.adapters.meta import FacebookAdapter
from app.adapters.twitter import MAX_TEXT_LENGTH as TWITTER_MAX
from app.adapters.twitter import TwitterAdapter

# ─── Twitter Adapter Tests ──────────────────────────────────────────────


class TestTwitterAdapter:
    """Tests for Twitter/X adapter."""

    @pytest.fixture
    def adapter(self):
        return TwitterAdapter()

    # Content Validation

    def test_valid_text_tweet(self, adapter):
        content = PublishContent(text="Hello world!")
        adapter.validate_content(content)  # Should not raise

    def test_max_length_tweet(self, adapter):
        content = PublishContent(text="x" * TWITTER_MAX)
        adapter.validate_content(content)  # Should not raise

    def test_text_too_long(self, adapter):
        with pytest.raises(FatalContentError, match="280 characters"):
            adapter.validate_content(PublishContent(text="x" * (TWITTER_MAX + 1)))

    def test_empty_content_rejected(self, adapter):  # noqa: ARG002
        with pytest.raises(ValueError, match="Content must have either"):
            PublishContent()

    def test_too_many_media(self, adapter):
        content = PublishContent(
            text="Post",
            media_urls=["https://example.com/img.jpg"] * 5,
        )
        with pytest.raises(FatalContentError, match="max 4 media"):
            adapter.validate_content(content)

    def test_4_media_allowed(self, adapter):
        content = PublishContent(
            text="Post",
            media_urls=["https://example.com/img.jpg"] * 4,
        )
        adapter.validate_content(content)  # Should not raise

    # Successful Publish

    @respx.mock
    @pytest.mark.asyncio
    async def test_successful_tweet(self, adapter):
        respx.post("https://api.twitter.com/2/tweets").mock(
            return_value=httpx.Response(201, json={"data": {"id": "1234567890"}})
        )
        result = await adapter.publish(
            content=PublishContent(text="Hello Twitter!"),
            account_id="test_token",
        )
        assert result.status == PublishStatus.PUBLISHED
        assert result.platform_post_id == "1234567890"
        assert "1234567890" in result.platform_post_url

    # Error Handling

    @respx.mock
    @pytest.mark.asyncio
    async def test_rate_limit_429(self, adapter):
        respx.post("https://api.twitter.com/2/tweets").mock(
            return_value=httpx.Response(
                429,
                json={"title": "Too Many Requests", "errors": [{"code": 99}]},
                headers={"Retry-After": "300"},
            )
        )
        result = await adapter.publish(
            content=PublishContent(text="Test tweet"),
            account_id="test_token",
        )
        assert result.status == PublishStatus.FAILED
        assert result.error.category == ErrorCategory.RATE_LIMIT
        assert result.retryable is True
        assert result.error.retry_after_seconds == 300

    @respx.mock
    @pytest.mark.asyncio
    async def test_unauthorized_401(self, adapter):
        respx.post("https://api.twitter.com/2/tweets").mock(
            return_value=httpx.Response(
                401,
                json={"title": "Unauthorized", "detail": "Invalid token"},
            )
        )
        result = await adapter.publish(
            content=PublishContent(text="Test tweet"),
            account_id="bad_token",
        )
        assert result.status == PublishStatus.FAILED
        assert result.error.category == ErrorCategory.AUTH
        assert result.retryable is False

    @respx.mock
    @pytest.mark.asyncio
    async def test_forbidden_403(self, adapter):
        respx.post("https://api.twitter.com/2/tweets").mock(
            return_value=httpx.Response(
                403,
                json={"title": "Forbidden"},
            )
        )
        result = await adapter.publish(
            content=PublishContent(text="Test tweet"),
            account_id="test_token",
        )
        assert result.status == PublishStatus.FAILED
        assert result.error.category == ErrorCategory.AUTH
        assert result.retryable is False

    @respx.mock
    @pytest.mark.asyncio
    async def test_server_error_500(self, adapter):
        respx.post("https://api.twitter.com/2/tweets").mock(
            return_value=httpx.Response(500, json={"title": "Internal Server Error"})
        )
        result = await adapter.publish(
            content=PublishContent(text="Test tweet"),
            account_id="test_token",
        )
        assert result.status == PublishStatus.FAILED
        assert result.error.category == ErrorCategory.TRANSIENT
        assert result.retryable is True

    @respx.mock
    @pytest.mark.asyncio
    async def test_timeout_retryable(self, adapter):
        respx.post("https://api.twitter.com/2/tweets").mock(
            side_effect=httpx.ConnectTimeout("Connection timed out")
        )
        result = await adapter.publish(
            content=PublishContent(text="Test tweet"),
            account_id="test_token",
        )
        assert result.status == PublishStatus.FAILED
        assert result.retryable is True

    # Capabilities

    def test_capabilities(self, adapter):
        caps = adapter.get_capabilities()
        assert caps["platform"] == "twitter"
        assert caps["max_text_length"] == 280
        assert "image" in caps["supported_media_types"]


# ─── LinkedIn Adapter Tests ──────────────────────────────────────────────


class TestLinkedInAdapter:
    """Tests for LinkedIn adapter."""

    @pytest.fixture
    def adapter(self):
        return LinkedInAdapter()

    # Content Validation

    def test_valid_post(self, adapter):
        content = PublishContent(text="Professional update!")
        adapter.validate_content(content)

    def test_max_length_post(self, adapter):
        content = PublishContent(text="x" * LINKEDIN_MAX)
        adapter.validate_content(content)

    def test_text_too_long(self, adapter):
        with pytest.raises(FatalContentError, match="3000 characters"):
            adapter.validate_content(PublishContent(text="x" * (LINKEDIN_MAX + 1)))

    def test_empty_content_rejected(self, adapter):  # noqa: ARG002
        with pytest.raises(ValueError, match="Content must have either"):
            PublishContent()

    def test_too_many_media(self, adapter):
        content = PublishContent(
            text="Post",
            media_urls=["https://example.com/img.jpg"] * 2,
        )
        with pytest.raises(FatalContentError, match="max 1 media"):
            adapter.validate_content(content)

    # Successful Publish

    @respx.mock
    @pytest.mark.asyncio
    async def test_successful_post(self, adapter):
        respx.post("https://api.linkedin.com/v2/ugcPosts").mock(
            return_value=httpx.Response(201, json={"id": "urn:li:share:123456"})
        )
        result = await adapter.publish(
            content=PublishContent(text="Hello LinkedIn!"),
            account_id="test_token",
            author_urn="urn:li:person:test",
        )
        assert result.status == PublishStatus.PUBLISHED
        assert "123456" in result.platform_post_id

    # Error Handling

    @respx.mock
    @pytest.mark.asyncio
    async def test_rate_limit_429(self, adapter):
        respx.post("https://api.linkedin.com/v2/ugcPosts").mock(
            return_value=httpx.Response(
                429,
                json={"message": "Rate limit exceeded"},
                headers={"Retry-After": "120"},
            )
        )
        result = await adapter.publish(
            content=PublishContent(text="Test"),
            account_id="test_token",
            author_urn="urn:li:person:test",
        )
        assert result.status == PublishStatus.FAILED
        assert result.error.category == ErrorCategory.RATE_LIMIT
        assert result.error.retry_after_seconds == 120

    @respx.mock
    @pytest.mark.asyncio
    async def test_unauthorized_401(self, adapter):
        respx.post("https://api.linkedin.com/v2/ugcPosts").mock(
            return_value=httpx.Response(
                401,
                json={"message": "Expired access token"},
            )
        )
        result = await adapter.publish(
            content=PublishContent(text="Test"),
            account_id="expired_token",
            author_urn="urn:li:person:test",
        )
        assert result.status == PublishStatus.FAILED
        assert result.error.category == ErrorCategory.AUTH
        assert result.retryable is False

    @respx.mock
    @pytest.mark.asyncio
    async def test_server_error_503(self, adapter):
        respx.post("https://api.linkedin.com/v2/ugcPosts").mock(
            return_value=httpx.Response(503, json={"message": "Service Unavailable"})
        )
        result = await adapter.publish(
            content=PublishContent(text="Test"),
            account_id="test_token",
            author_urn="urn:li:person:test",
        )
        assert result.status == PublishStatus.FAILED
        assert result.error.category == ErrorCategory.TRANSIENT
        assert result.retryable is True

    # Capabilities

    def test_capabilities(self, adapter):
        caps = adapter.get_capabilities()
        assert caps["platform"] == "linkedin"
        assert caps["max_text_length"] == 3000


# ─── Facebook Adapter Tests ──────────────────────────────────────────────


class TestFacebookAdapter:
    """Tests for Facebook/Meta Pages adapter."""

    @pytest.fixture
    def adapter(self):
        return FacebookAdapter()

    # Content Validation

    def test_valid_post(self, adapter):
        content = PublishContent(text="Check out our product!")
        adapter.validate_content(content)

    def test_max_length_post(self, adapter):
        content = PublishContent(text="x" * FACEBOOK_MAX)
        adapter.validate_content(content)

    def test_text_too_long(self, adapter):
        with pytest.raises(FatalContentError, match="63206 characters"):
            adapter.validate_content(PublishContent(text="x" * (FACEBOOK_MAX + 1)))

    def test_empty_content_rejected(self, adapter):  # noqa: ARG002
        with pytest.raises(ValueError, match="Content must have either"):
            PublishContent()

    def test_too_many_media(self, adapter):
        content = PublishContent(
            media_urls=["https://example.com/img.jpg"] * 21,
        )
        with pytest.raises(FatalContentError, match="max 20 media"):
            adapter.validate_content(content)

    def test_20_media_allowed(self, adapter):
        content = PublishContent(
            media_urls=["https://example.com/img.jpg"] * 20,
        )
        adapter.validate_content(content)

    def test_invalid_media_url(self, adapter):
        content = PublishContent(
            media_urls=["not-a-url"],
        )
        with pytest.raises(FatalContentError, match="Invalid media URL"):
            adapter.validate_content(content)

    # Successful Publish — use regex pattern to match dynamic URL

    @respx.mock
    @pytest.mark.asyncio
    async def test_successful_post(self, adapter):
        respx.post(url__regex=r"https://graph\.facebook\.com/v18\.0/.+/feed").mock(
            return_value=httpx.Response(200, json={"id": "page123_456"})
        )
        result = await adapter.publish(
            content=PublishContent(text="Hello Facebook!"),
            account_id="page123|access_token_abc",
        )
        assert result.status == PublishStatus.PUBLISHED
        assert "page123_456" in result.platform_post_id

    @respx.mock
    @pytest.mark.asyncio
    async def test_successful_photo_post(self, adapter):
        # Mock: download image from URL
        respx.get("https://example.com/photo.jpg").mock(
            return_value=httpx.Response(200, content=b"fake-image-data")
        )
        # Mock: upload to Facebook
        respx.post(url__regex=r"https://graph\.facebook\.com/v18\.0/.+/photos").mock(
            return_value=httpx.Response(200, json={"id": "photo_789"})
        )
        result = await adapter.publish(
            content=PublishContent(media_urls=["https://example.com/photo.jpg"]),
            account_id="page_id|token",
        )
        assert result.status == PublishStatus.PUBLISHED

    # Error Handling — use regex patterns

    @respx.mock
    @pytest.mark.asyncio
    async def test_rate_limit_429(self, adapter):
        respx.post(url__regex=r"https://graph\.facebook\.com/v18\.0/.+/feed").mock(
            return_value=httpx.Response(
                429,
                json={"error": {"message": "Rate limit", "code": 32}},
                headers={"Retry-After": "60"},
            )
        )
        result = await adapter.publish(
            content=PublishContent(text="Test"),
            account_id="page_id|token",
        )
        assert result.status == PublishStatus.FAILED
        assert result.error.category == ErrorCategory.RATE_LIMIT

    @respx.mock
    @pytest.mark.asyncio
    async def test_auth_error_401(self, adapter):
        respx.post(url__regex=r"https://graph\.facebook\.com/v18\.0/.+/feed").mock(
            return_value=httpx.Response(
                401,
                json={"error": {"message": "Invalid OAuth access token", "code": 190}},
            )
        )
        result = await adapter.publish(
            content=PublishContent(text="Test"),
            account_id="page_id|bad_token",
        )
        assert result.status == PublishStatus.FAILED
        assert result.error.category == ErrorCategory.AUTH
        assert result.retryable is False

    @respx.mock
    @pytest.mark.asyncio
    async def test_server_error_500(self, adapter):
        respx.post(url__regex=r"https://graph\.facebook\.com/v18\.0/.+/feed").mock(
            return_value=httpx.Response(500, json={"error": {"message": "Server error"}})
        )
        result = await adapter.publish(
            content=PublishContent(text="Test"),
            account_id="page_id|token",
        )
        assert result.status == PublishStatus.FAILED
        assert result.error.category == ErrorCategory.TRANSIENT
        assert result.retryable is True

    # Capabilities

    def test_capabilities(self, adapter):
        caps = adapter.get_capabilities()
        assert caps["platform"] == "facebook"
        assert caps["max_text_length"] == 63206
        assert caps["max_media_count"] == 20


# ─── Instagram Adapter Tests ─────────────────────────────────────────────


class TestInstagramAdapter:
    """Tests for the Instagram (Meta Graph API) adapter."""

    @pytest.fixture
    def adapter(self):
        return InstagramAdapter()

    # Content Validation

    def test_valid_image_post(self, adapter):
        content = PublishContent(
            text="Hello Instagram!", media_urls=["https://example.com/img.jpg"]
        )
        adapter.validate_content(content)

    def test_max_length_caption(self, adapter):
        content = PublishContent(
            text="x" * INSTAGRAM_MAX,
            media_urls=["https://example.com/img.jpg"],
        )
        adapter.validate_content(content)

    def test_caption_too_long(self, adapter):
        content = PublishContent(
            text="x" * (INSTAGRAM_MAX + 1),
            media_urls=["https://example.com/img.jpg"],
        )
        with pytest.raises(FatalContentError, match="2200 characters"):
            adapter.validate_content(content)

    def test_empty_content_rejected(self, adapter):  # noqa: ARG002
        with pytest.raises(ValueError, match="Content must have either"):
            PublishContent()

    def test_requires_media(self, adapter):
        content = PublishContent(text="No media here")
        with pytest.raises(FatalContentError, match="require exactly one image or video"):
            adapter.validate_content(content)

    def test_too_many_media(self, adapter):
        content = PublishContent(
            media_urls=["https://example.com/1.jpg", "https://example.com/2.jpg"],
        )
        with pytest.raises(FatalContentError, match="exactly 1 media item"):
            adapter.validate_content(content)

    def test_invalid_media_url(self, adapter):
        content = PublishContent(media_urls=["not-a-url"])
        with pytest.raises(FatalContentError, match="public https URL"):
            adapter.validate_content(content)

    def test_missing_ig_user_id_in_account(self):
        adapter = InstagramAdapter()
        # account_id without the composite → fatal, not a network call
        # use a sync path: _parse_account gives empty ig_user_id; publish would
        # short-circuit. We test the parse directly:
        ig_id, token = adapter._parse_account("only_token")
        assert ig_id == ""

    # Successful image publish (two-stage flow)

    @respx.mock
    @pytest.mark.asyncio
    async def test_successful_image_post(self, adapter):
        # Stage 1: create container (anchored so it does not also match media_publish)
        respx.post(
            url__regex=r"https://graph\.facebook\.com/v18\.0/123/media\?|https://graph\.facebook\.com/v18\.0/123/media$"
        ).mock(return_value=httpx.Response(200, json={"id": "creation_abc"}))
        # Stage 2: publish container
        respx.post(url__regex=r"https://graph\.facebook\.com/v18\.0/123/media_publish").mock(
            return_value=httpx.Response(200, json={"id": "media_789"})
        )
        # Stage 3: permalink
        respx.get(url__regex=r"https://graph\.facebook\.com/v18\.0/media_789").mock(
            return_value=httpx.Response(
                200, json={"permalink": "https://www.instagram.com/p/ABC123/"}
            )
        )
        result = await adapter.publish(
            content=PublishContent(
                text="Hello Instagram!",
                media_urls=["https://example.com/img.jpg"],
            ),
            account_id="123|page_token",
        )
        assert result.status == PublishStatus.PUBLISHED
        assert result.platform_post_id == "media_789"
        assert result.platform_post_url == "https://www.instagram.com/p/ABC123/"

    # Successful video publish

    @respx.mock
    @pytest.mark.asyncio
    async def test_successful_video_post(self, adapter):
        respx.post(
            url__regex=r"https://graph\.facebook\.com/v18\.0/123/media\?|https://graph\.facebook\.com/v18\.0/123/media$"
        ).mock(return_value=httpx.Response(200, json={"id": "creation_vid"}))
        respx.post(url__regex=r"https://graph\.facebook\.com/v18\.0/123/media_publish").mock(
            return_value=httpx.Response(200, json={"id": "media_vid_1"})
        )
        respx.get(url__regex=r"https://graph\.facebook\.com/v18\.0/media_vid_1").mock(
            return_value=httpx.Response(
                200, json={"permalink": "https://www.instagram.com/p/VID999/"}
            )
        )
        result = await adapter.publish(
            content=PublishContent(
                text="Check out this video!",
                media_urls=["https://example.com/clip.mp4"],
            ),
            account_id="123|page_token",
        )
        assert result.status == PublishStatus.PUBLISHED
        assert result.platform_post_id == "media_vid_1"
        assert result.platform_post_url == "https://www.instagram.com/p/VID999/"

    # Error taxonomy

    @respx.mock
    @pytest.mark.asyncio
    async def test_auth_error_invalid_oauth_code_190(self, adapter):
        respx.post(url__regex=r"https://graph\.facebook\.com/v18\.0/123/media").mock(
            return_value=httpx.Response(
                400, json={"error": {"message": "Invalid OAuth token", "code": 190}}
            )
        )
        result = await adapter.publish(
            content=PublishContent(text="Test", media_urls=["https://example.com/img.jpg"]),
            account_id="123|expired_token",
        )
        assert result.status == PublishStatus.FAILED
        assert result.error.category == ErrorCategory.AUTH
        assert result.retryable is False

    @respx.mock
    @pytest.mark.asyncio
    async def test_auth_error_403(self, adapter):
        respx.post(url__regex=r"https://graph\.facebook\.com/v18\.0/123/media").mock(
            return_value=httpx.Response(
                403, json={"error": {"message": "Permission denied", "code": 10}}
            )
        )
        result = await adapter.publish(
            content=PublishContent(text="Test", media_urls=["https://example.com/img.jpg"]),
            account_id="123|token",
        )
        assert result.status == PublishStatus.FAILED
        assert result.error.category == ErrorCategory.AUTH
        assert result.retryable is False

    @respx.mock
    @pytest.mark.asyncio
    async def test_rate_limit_429(self, adapter):
        respx.post(url__regex=r"https://graph\.facebook\.com/v18\.0/123/media").mock(
            return_value=httpx.Response(
                429,
                json={"error": {"message": "Rate limit", "code": 4}},
                headers={"Retry-After": "3600"},
            )
        )
        result = await adapter.publish(
            content=PublishContent(text="Test", media_urls=["https://example.com/img.jpg"]),
            account_id="123|token",
        )
        assert result.status == PublishStatus.FAILED
        assert result.error.category == ErrorCategory.RATE_LIMIT
        assert result.retryable is True

    @respx.mock
    @pytest.mark.asyncio
    async def test_server_error_500(self, adapter):
        respx.post(url__regex=r"https://graph\.facebook\.com/v18\.0/123/media").mock(
            return_value=httpx.Response(500, json={"error": {"message": "Server error"}})
        )
        result = await adapter.publish(
            content=PublishContent(text="Test", media_urls=["https://example.com/img.jpg"]),
            account_id="123|token",
        )
        assert result.status == PublishStatus.FAILED
        assert result.error.category == ErrorCategory.TRANSIENT
        assert result.retryable is True

    @respx.mock
    @pytest.mark.asyncio
    async def test_content_error_other_4xx(self, adapter):
        respx.post(url__regex=r"https://graph\.facebook\.com/v18\.0/123/media").mock(
            return_value=httpx.Response(
                400, json={"error": {"message": "Invalid parameter", "code": 100}}
            )
        )
        result = await adapter.publish(
            content=PublishContent(text="Test", media_urls=["https://example.com/img.jpg"]),
            account_id="123|token",
        )
        assert result.status == PublishStatus.FAILED
        assert result.error.category == ErrorCategory.FATAL
        assert result.retryable is False

    # Capabilities

    def test_capabilities(self, adapter):
        caps = adapter.get_capabilities()
        assert caps["platform"] == "instagram"
        assert caps["max_text_length"] == 2200
        assert caps["max_media_count"] == 1


# ─── Cross-Platform Tests ───────────────────────────────────────────────


class TestAdaptersCrossPlatform:
    """Tests that verify adapters share consistent behavior."""

    @pytest.mark.asyncio
    @respx.mock
    async def test_all_adapters_handle_timeout(self):
        """All adapters should handle connection timeouts as retryable."""
        for adapter_cls in [TwitterAdapter, LinkedInAdapter, FacebookAdapter, InstagramAdapter]:
            adapter = adapter_cls()
            platform = adapter.get_capabilities()["platform"]
            account = "test_token"
            if platform in ("facebook", "instagram"):
                account = "page_id|token"
            # LinkedIn requires an author identity (ADR-0002).
            author = "urn:li:person:test" if isinstance(adapter, LinkedInAdapter) else None
            # Instagram requires media, so include a media URL in the content.
            content = PublishContent(
                text="test",
                media_urls=["https://example.com/img.jpg"]
                if isinstance(adapter, InstagramAdapter)
                else None,
            )
            # Mock at the specific end URL the adapter will call
            pattern = respx_pattern_for(adapter)
            respx.post(pattern).mock(side_effect=httpx.ConnectTimeout("timeout"))
            result = await adapter.publish(
                content=content,
                account_id=account,
                author_urn=author,
            )
            assert result.retryable is True, (
                f"{platform} should retry on timeout, got {result.error}"
            )

    def test_all_adapters_reject_empty_content(self):
        """All adapters should reject empty content (via PublishContent constructor)."""
        for _adapter_cls in [TwitterAdapter, LinkedInAdapter, FacebookAdapter, InstagramAdapter]:
            with pytest.raises(ValueError, match="Content must have either"):
                PublishContent()

    def test_all_adapters_have_platform_name(self):
        """All adapters should have a valid platform name."""
        for adapter_cls in [TwitterAdapter, LinkedInAdapter, FacebookAdapter, InstagramAdapter]:
            adapter = adapter_cls()
            caps = adapter.get_capabilities()
            assert caps["platform"] in ("twitter", "linkedin", "facebook", "instagram")


def respx_pattern_for(adapter) -> str:
    """Get the API base URL for an adapter (for respx mocking).

    For Facebook, account_id format is 'page_id|token' so URL becomes
    https://graph.facebook.com/v18.0/page_id/feed
    """
    if isinstance(adapter, TwitterAdapter):
        return "https://api.twitter.com/2/tweets"
    if isinstance(adapter, LinkedInAdapter):
        return "https://api.linkedin.com/v2/ugcPosts"
    if isinstance(adapter, FacebookAdapter):
        # Will be called with account_id='page_id|token' → URL: /page_id/feed
        return "https://graph.facebook.com/v18.0/page_id/feed"
    if isinstance(adapter, InstagramAdapter):
        # Will be called with account_id='page_id|token' → URL: /page_id/media
        return "https://graph.facebook.com/v18.0/page_id/media"
    return "https://example.com/api"
