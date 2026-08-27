"""Unit tests for Pydantic schemas and platform-specific validation."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from app.schemas import PublishContent, PublishRequest, PublishTarget


class TestPublishContent:
    """Tests for PublishContent validation."""

    def test_valid_text_only(self):
        """Text-only content is valid."""
        content = PublishContent(text="Hello world")
        assert content.text == "Hello world"
        assert content.media_urls is None
        assert content.metadata is None

    def test_valid_media_only(self):
        """Media-only content is valid."""
        content = PublishContent(media_urls=["https://example.com/image.jpg"])
        assert content.text is None
        assert content.media_urls == ["https://example.com/image.jpg"]

    def test_valid_text_and_media(self):
        """Content with text and media is valid."""
        content = PublishContent(
            text="Check this out",
            media_urls=["https://example.com/image.jpg", "https://example.com/video.mp4"],
        )
        assert content.text == "Check this out"
        assert len(content.media_urls) == 2
        assert content.metadata is None

    def test_empty_text_rejected(self):
        """Empty text string is rejected by schema."""
        with pytest.raises(ValueError, match="text must not be empty"):
            PublishContent(text="", media_urls=None)

    def test_twitter_text_limit(self):
        """Twitter has 280 character limit (tested in adapter, not schema)."""
        # Schema allows up to 63206 (Facebook limit)
        # Adapter validates platform-specific limits
        text_280 = "x" * 280
        content = PublishContent(text=text_280)
        assert len(content.text) == 280

        text_281 = "x" * 281
        content = PublishContent(text=text_281)
        assert len(content.text) == 281

    def test_linkedin_text_limit(self):
        """LinkedIn has 3000 character limit (tested in adapter)."""
        text_3000 = "x" * 3000
        content = PublishContent(text=text_3000)
        assert len(content.text) == 3000

    def test_facebook_text_limit(self):
        """Facebook has 63206 character limit (tested in adapter)."""
        text_63206 = "x" * 63206
        content = PublishContent(text=text_63206)
        assert len(content.text) == 63206

    def test_exceeding_facebook_limit_rejected(self):
        """Text exceeding Facebook limit (63206) should be rejected."""
        with pytest.raises(ValueError):
            PublishContent(text="x" * 63207)


class TestPublishTarget:
    """Tests for PublishTarget validation."""

    def test_valid_target(self):
        """Valid target with account_id and content."""
        target = PublishTarget(
            account_id="acc_123",
            content=PublishContent(text="Hello"),
        )
        assert target.account_id == "acc_123"
        assert target.content.text == "Hello"

    def test_missing_account_id(self):
        """Target without account_id is invalid."""
        with pytest.raises(ValueError):
            PublishTarget(
                account_id=None,
                content=PublishContent(text="Hello"),
            )

    def test_missing_content(self):
        """Target without content is invalid."""
        with pytest.raises(ValueError):
            PublishTarget(account_id="acc_123", content=None)


class TestPublishRequest:
    """Tests for PublishRequest validation."""

    def test_valid_immediate_publish(self):
        """Valid immediate publish request."""
        request = PublishRequest(
            idempotency_key="key_123",
            scheduled_at=None,
            targets=[
                PublishTarget(
                    account_id="acc_123",
                    content=PublishContent(text="Hello"),
                )
            ],
        )
        assert request.idempotency_key == "key_123"
        assert request.scheduled_at is None
        assert len(request.targets) == 1

    def test_valid_scheduled_publish(self):
        """Valid scheduled publish request."""
        future = datetime.now(UTC) + timedelta(hours=1)
        request = PublishRequest(
            idempotency_key="key_123",
            scheduled_at=future,
            targets=[
                PublishTarget(
                    account_id="acc_123",
                    content=PublishContent(text="Hello"),
                )
            ],
        )
        assert request.scheduled_at == future

    def test_valid_multi_target_publish(self):
        """Valid request with multiple targets."""
        request = PublishRequest(
            idempotency_key="key_123",
            targets=[
                PublishTarget(account_id="acc_1", content=PublishContent(text="Hello")),
                PublishTarget(account_id="acc_2", content=PublishContent(text="World")),
                PublishTarget(
                    account_id="acc_3",
                    content=PublishContent(media_urls=["https://example.com/img.jpg"]),
                ),
            ],
        )
        assert len(request.targets) == 3

    def test_missing_idempotency_key(self):
        """Request without idempotency_key is invalid."""
        with pytest.raises(ValueError):
            PublishRequest(
                idempotency_key=None,
                targets=[
                    PublishTarget(
                        account_id="acc_123",
                        content=PublishContent(text="Hello"),
                    )
                ],
            )

    def test_idempotency_key_too_short(self):
        """Idempotency key must be at least 1 character."""
        with pytest.raises(ValueError):
            PublishRequest(
                idempotency_key="",
                targets=[
                    PublishTarget(
                        account_id="acc_123",
                        content=PublishContent(text="Hello"),
                    )
                ],
            )

    def test_idempotency_key_too_long(self):
        """Idempotency key limited to 128 characters."""
        with pytest.raises(ValueError):
            PublishRequest(
                idempotency_key="x" * 129,
                targets=[
                    PublishTarget(
                        account_id="acc_123",
                        content=PublishContent(text="Hello"),
                    )
                ],
            )

    def test_idempotency_key_valid_max_length(self):
        """Idempotency key can be exactly 128 characters."""
        request = PublishRequest(
            idempotency_key="x" * 128,
            targets=[
                PublishTarget(
                    account_id="acc_123",
                    content=PublishContent(text="Hello"),
                )
            ],
        )
        assert len(request.idempotency_key) == 128

    def test_empty_targets_rejected(self):
        """Request with no targets is invalid."""
        with pytest.raises(ValueError):
            PublishRequest(
                idempotency_key="key_123",
                targets=[],
            )

    def test_too_many_targets(self):
        """Request with >10 targets is invalid."""
        targets = [
            PublishTarget(
                account_id=f"acc_{i}",
                content=PublishContent(text=f"Post {i}"),
            )
            for i in range(11)
        ]
        with pytest.raises(ValueError):
            PublishRequest(
                idempotency_key="key_123",
                targets=targets,
            )

    def test_naive_scheduled_at_normalized_to_utc(self):
        """Naive datetime without timezone is normalized to UTC."""
        naive_dt = datetime(2027, 1, 1, 12, 0, 0)
        request = PublishRequest(
            idempotency_key="key_123",
            scheduled_at=naive_dt,
            targets=[
                PublishTarget(
                    account_id="acc_123",
                    content=PublishContent(text="Hello"),
                )
            ],
        )
        # Should have been normalized to UTC
        assert request.scheduled_at.tzinfo is not None
        assert request.scheduled_at.hour == 12  # Same hour since we assume UTC

    def test_scheduled_at_1_year_valid(self):
        """scheduled_at exactly 1 year in future is valid."""
        one_year = datetime.now(UTC) + timedelta(days=365)
        request = PublishRequest(
            idempotency_key="key_123",
            scheduled_at=one_year,
            targets=[
                PublishTarget(
                    account_id="acc_123",
                    content=PublishContent(text="Hello"),
                )
            ],
        )
        assert request.scheduled_at == one_year


class TestPlatformSpecificValidation:
    """Tests for platform-specific content limits (schema level).

    Note: Detailed platform validation happens in adapters.
    Schema tests validate the structural requirements.
    """

    def test_media_url_format(self):
        """Media URLs must be valid HTTP(S) URLs."""
        # Valid
        content = PublishContent(media_urls=["https://example.com/img.jpg"])
        assert content.media_urls[0].startswith("https://")

        # Invalid URLs tested in adapter validation
        # Schema just stores them
        content = PublishContent(media_urls=["not-a-url"])
        assert content.media_urls[0] == "not-a-url"

    def test_metadata_flexible(self):
        """Metadata is flexible dict for platform-specific data."""
        content = PublishContent(
            text="Hello",
            metadata={
                "tags": ["tech", "ai"],
                "hashtags": ["#tech", "#ai"],
                "mentions": ["@user1", "@user2"],
                "schedule_priority": "high",
            },
        )
        assert content.metadata["tags"] == ["tech", "ai"]
        assert content.metadata["hashtags"] == ["#tech", "#ai"]
