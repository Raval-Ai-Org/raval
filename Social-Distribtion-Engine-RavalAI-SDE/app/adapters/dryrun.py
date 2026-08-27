"""DryRun adapter - mock adapter for testing without real API calls.

The DryRun adapter behaves exactly like real adapters but:
- Never calls external APIs
- Accepts magic strings to simulate failures
- Returns deterministic fake responses
- Allows full integration testing locally

Magic strings for failure injection:
- "FORCE_429" → Simulate rate limit (429 Too Many Requests)
- "FORCE_401" → Simulate auth error (401 Unauthorized)
- "FORCE_500" → Simulate server error (500 Internal Server Error)
- "FORCE_FATAL" → Simulate validation error (400 Bad Request / FATAL)
"""

from __future__ import annotations

import hashlib
from typing import Any

from app.adapters.base import (
    BaseAdapter,
    PublishContent,
    PublishResult,
    PublishStatus,
)
from app.adapters.errors import (
    AuthError,
    FatalContentError,
    PublishError,
    RateLimitError,
    TransientError,
)


class DryRunAdapter(BaseAdapter):
    """Mock adapter for development and testing.

    Simulates publishing without calling real APIs.
    Supports magic strings in content to simulate different failure modes.

    Example:
        >>> adapter = DryRunAdapter()
        >>> content = PublishContent(text="Hello world")
        >>> result = await adapter.publish(content, "account_123")
        >>> result.status
        <PublishStatus.PUBLISHED: 'published'>
        >>> result.platform_post_id
        'dryrun_abc123...'

    """

    def __init__(self) -> None:
        """Initialize DryRun adapter."""
        super().__init__(platform="dryrun")

    async def publish(
        self,
        content: PublishContent,
        account_id: str,
        author_urn: str | None = None,  # noqa: ARG002
    ) -> PublishResult:
        """Simulate publishing to DryRun.

        Args:
            content: Content to publish
            account_id: Account ID (not used, but required by interface)
            author_urn: Not used by DryRun (interface uniformity).

        Returns:
            PublishResult with simulated response

        Examples:
            # Success
            >>> content = PublishContent(text="Hello")
            >>> result = await adapter.publish(content, "account_1")
            >>> result.is_success()
            True

            # Rate limit (inject FORCE_429)
            >>> content = PublishContent(text="Hello FORCE_429")
            >>> result = await adapter.publish(content, "account_1")
            >>> result.error.category
            <ErrorCategory.RATE_LIMIT: 'rate_limit'>
            >>> result.retryable
            True

            # Auth error (inject FORCE_401)
            >>> content = PublishContent(text="Hello FORCE_401")
            >>> result = await adapter.publish(content, "account_1")
            >>> result.error.category
            <ErrorCategory.AUTH: 'auth'>
            >>> result.retryable
            False

            # Server error (inject FORCE_500)
            >>> content = PublishContent(text="Hello FORCE_500")
            >>> result = await adapter.publish(content, "account_1")
            >>> result.error.category
            <ErrorCategory.TRANSIENT: 'transient'>
            >>> result.retryable
            True

            # Validation error (inject FORCE_FATAL)
            >>> content = PublishContent(text="Hello FORCE_FATAL")
            >>> result = await adapter.publish(content, "account_1")
            >>> result.error.category
            <ErrorCategory.FATAL: 'fatal'>
            >>> result.retryable
            False

        """
        # Validate content first (catches issues like text too long)
        try:
            self.validate_content(content)
        except ValueError as e:
            # Validation failed - return fatal error
            error: PublishError = FatalContentError(
                message=str(e),
                field="content",
            )
            return PublishResult(
                status=PublishStatus.FAILED,
                error=error,
                retryable=False,
                attempts=1,
            )

        # Check for magic strings in content to simulate failures
        text = content.text or ""

        if "FORCE_429" in text:
            error = RateLimitError(
                message="Rate limited by DryRun (simulated)",
                retry_after_seconds=60,
            )
            return PublishResult(
                status=PublishStatus.FAILED,
                error=error,
                retryable=True,
                attempts=1,
            )

        if "FORCE_401" in text:
            error = AuthError(
                message="Authentication failed (DryRun simulation)",
            )
            return PublishResult(
                status=PublishStatus.FAILED,
                error=error,
                retryable=False,
                attempts=1,
            )

        if "FORCE_500" in text:
            error = TransientError(
                message="Server error (DryRun simulation)",
            )
            return PublishResult(
                status=PublishStatus.FAILED,
                error=error,
                retryable=True,
                attempts=1,
            )

        if "FORCE_FATAL" in text:
            error = FatalContentError(
                message="Fatal validation error (DryRun simulation)",
                field="content",
            )
            return PublishResult(
                status=PublishStatus.FAILED,
                error=error,
                retryable=False,
                attempts=1,
            )

        # Success: generate deterministic fake platform_post_id
        platform_post_id = self._generate_fake_post_id(content, account_id)

        return PublishResult(
            status=PublishStatus.PUBLISHED,
            platform_post_id=platform_post_id,
            platform_post_url=None,  # DryRun doesn't have real URLs
            error=None,
            retryable=False,
            attempts=1,
        )

    def validate_content(self, content: PublishContent) -> None:
        """Validate content against DryRun rules.

        DryRun is permissive but enforces basic limits:
        - Text must be ≤ 63206 chars (Facebook limit, most permissive)
        - At least one of text or media must be present
        - Media URLs must be valid URLs

        Args:
            content: Content to validate

        Raises:
            ValueError: If content violates rules

        """
        # At least one of text or media must be present
        if not content.text and not content.media_urls:
            raise ValueError("Content must have text or media_urls (or both)")

        # Text length check (use Facebook's limit as most permissive)
        if content.text and len(content.text) > 63206:
            raise ValueError("Text exceeds maximum length (63206 characters)")

        # Media URL validation (basic format check)
        if content.media_urls:
            for url in content.media_urls:
                if not isinstance(url, str) or not url.startswith(("http://", "https://")):
                    raise ValueError(f"Invalid media URL: {url}")

            # Limit number of media attachments
            if len(content.media_urls) > 20:
                raise ValueError("Too many media attachments (max 20)")

    def get_capabilities(self) -> dict[str, Any]:
        """Return DryRun adapter capabilities.

        Returns:
            Dict with capabilities info

        """
        return {
            "platform": "dryrun",
            "max_text_length": 63206,
            "max_media_count": 20,
            "supported_media_types": ["image", "video", "gif"],
            "supports_scheduling": False,
            "supports_replies": True,
            "supports_hashtags": True,
            "is_test_adapter": True,
        }

    @staticmethod
    def _generate_fake_post_id(content: PublishContent, account_id: str) -> str:
        """Generate deterministic fake platform post ID.

        Same input → same output, so tests can be predictable.

        Args:
            content: Content that was published
            account_id: Account ID

        Returns:
            Fake post ID (deterministic for same inputs)

        Example:
            >>> id1 = DryRunAdapter._generate_fake_post_id(PublishContent(text="test"), "acc_1")
            >>> id2 = DryRunAdapter._generate_fake_post_id(PublishContent(text="test"), "acc_1")
            >>> id1 == id2
            True

        """
        # Create input for hashing
        text = content.text or ""
        media_str = ",".join(content.media_urls or [])
        input_str = f"{text}|{media_str}|{account_id}"

        # Generate hash (first 12 chars of SHA256)
        hash_obj = hashlib.sha256(input_str.encode("utf-8"))
        hash_hex = hash_obj.hexdigest()[:12]

        return f"dryrun_{hash_hex}"
