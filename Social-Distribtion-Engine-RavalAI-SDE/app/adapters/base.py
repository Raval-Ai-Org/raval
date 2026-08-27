"""Base adapter interface and registry for platform-specific adapters.

All platform adapters (Twitter, LinkedIn, Facebook, DryRun) implement this interface.
This enables plug-and-play platform support without coupling to specific implementations.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from enum import StrEnum
from typing import Any

from app.adapters.errors import PublishError


class PublishStatus(StrEnum):
    """Status of a publish attempt."""

    PENDING = "pending"
    PUBLISHING = "publishing"
    PUBLISHED = "published"
    FAILED = "failed"
    RETRYING = "retrying"


@dataclass
class PublishContent:
    """Content to publish across all platforms.

    Attributes:
        text: Post text content (platform-specific length limits apply)
        media_urls: List of media URLs to attach (images, videos, etc.)
        metadata: Additional platform-specific metadata (hashtags, mentions, etc.)

    Example:
        >>> content = PublishContent(
        ...     text="Hello world!",
        ...     media_urls=["https://example.com/image.jpg"],
        ...     metadata={"tags": ["tech", "ai"]},
        ... )

    """

    text: str | None = None
    media_urls: list[str] | None = None
    metadata: dict[str, Any] | None = None

    def __post_init__(self) -> None:
        """Validate content structure."""
        if not self.text and not self.media_urls:
            raise ValueError("Content must have either text or media_urls (or both)")

        if self.media_urls is None:
            self.media_urls = []

        if self.metadata is None:
            self.metadata = {}


@dataclass
class PublishResult:
    """Result of a publish attempt.

    Attributes:
        status: Success or failure status
        platform_post_id: ID of post on platform (if published)
        platform_post_url: Direct URL to published post (if available)
        error: PublishError if failed, None if succeeded
        retryable: Whether this error should be retried
        attempts: Number of attempts made (for retry tracking)

    Example:
        >>> result = PublishResult(
        ...     status=PublishStatus.PUBLISHED,
        ...     platform_post_id="tweet_123456",
        ...     platform_post_url="https://twitter.com/user/status/123456",
        ...     error=None,
        ...     retryable=False,
        ...     attempts=1,
        ... )

    """

    status: PublishStatus
    platform_post_id: str | None = None
    platform_post_url: str | None = None
    error: PublishError | None = None
    retryable: bool = False
    attempts: int = 1

    def is_success(self) -> bool:
        """Check if publish succeeded."""
        return self.status == PublishStatus.PUBLISHED and self.error is None

    def is_retriable(self) -> bool:
        """Check if this failure should be retried."""
        return self.retryable and self.error is not None

    def __repr__(self) -> str:
        if self.is_success():
            return f"PublishResult(status=PUBLISHED, platform_post_id={self.platform_post_id!r})"
        return (
            f"PublishResult(status={self.status.value}, "
            f"error={self.error!r}, retryable={self.retryable})"
        )


class BaseAdapter(ABC):
    """Abstract base class for all platform adapters.

    All platform-specific adapters (Twitter, LinkedIn, Facebook, DryRun)
    must implement this interface. This enables:
    - Plug-and-play platform support
    - Consistent error handling and retry logic
    - Easy testing with mock adapters

    Example:
        >>> class TwitterAdapter(BaseAdapter):
        ...     async def publish(self, content: PublishContent, account_id: str) -> PublishResult:
        ...         # Twitter-specific implementation
        ...         pass
        ...
        ...     def validate_content(self, content: PublishContent) -> None:
        ...         # Twitter text limit: 280 chars
        ...         if content.text and len(content.text) > 280:
        ...             raise ValueError("Twitter text limit: 280 characters")

    """

    def __init__(self, platform: str | None = None):
        """Initialize adapter.

        Concrete adapters self-identify their platform (``super().__init__(
        platform="twitter")``) and are constructed with no arguments by the
        registry, so the platform parameter is optional here.

        Args:
            platform: Platform name (e.g., "twitter", "linkedin", "facebook")

        """
        self.platform = platform

    @abstractmethod
    async def publish(
        self,
        content: PublishContent,
        account_id: str,
        author_urn: str | None = None,
    ) -> PublishResult:
        """Publish content to platform.

        Must be implemented by all subclasses.

        Args:
            content: Content to publish (text, media, metadata)
            account_id: OAuth bearer token to publish with (decrypted, per account)
            author_urn: Platform author identity (e.g. LinkedIn person/Page URN);
                platform-specific — only used by platforms that require an
                explicit author identity (see ADR-0002).

        Returns:
            PublishResult with status, platform_post_id, errors, etc.

        Raises:
            PublishError: For validation or unexpected failures

        """
        pass

    @abstractmethod
    def validate_content(self, content: PublishContent) -> None:
        """Validate content against platform-specific rules.

        Called before publish to fail fast on invalid content.

        Args:
            content: Content to validate

        Raises:
            ValueError: If content violates platform rules
                (e.g., text too long, unsupported media type)

        Example:
            def validate_content(self, content: PublishContent) -> None:
                if content.text and len(content.text) > 280:
                    raise ValueError("Twitter: text must be ≤280 characters")
                if len(content.media_urls) > 4:
                    raise ValueError("Twitter: max 4 media attachments")

        """
        pass

    def get_capabilities(self) -> dict[str, Any]:
        """Return platform capabilities.

        Used by the system to understand what features this platform supports.
        Enables smart content adaptation without hardcoding platform knowledge.

        Returns:
            Dict with capability information

        Example:
            {
                "platform": "twitter",
                "max_text_length": 280,
                "max_media_count": 4,
                "supported_media_types": ["image", "video", "gif"],
                "supports_scheduling": False,
                "supports_replies": True,
                "supports_hashtags": True,
            }

        """
        return {
            "platform": self.platform,
            "max_text_length": None,
            "max_media_count": None,
            "supported_media_types": [],
        }


class AdapterRegistry:
    """Registry of all available platform adapters.

    Enables dynamic adapter selection by platform name.
    Centralizes adapter management in one place.

    Example:
        >>> registry = AdapterRegistry()
        >>> registry.register("twitter", TwitterAdapter)
        >>> registry.register("linkedin", LinkedInAdapter)
        >>> adapter_class = registry.get("twitter")
        >>> adapter = adapter_class()

    """

    def __init__(self) -> None:
        """Initialize empty registry."""
        self._adapters: dict[str, type[BaseAdapter]] = {}

    def register(self, platform: str, adapter_class: type[BaseAdapter]) -> None:
        """Register an adapter for a platform.

        Args:
            platform: Platform name (e.g., "twitter")
            adapter_class: Adapter class (must extend BaseAdapter)

        Raises:
            ValueError: If adapter_class doesn't extend BaseAdapter

        """
        if not issubclass(adapter_class, BaseAdapter):
            raise ValueError(f"Adapter {adapter_class.__name__} must extend BaseAdapter")

        self._adapters[platform] = adapter_class

    def get(self, platform: str) -> type[BaseAdapter]:
        """Get adapter class for platform.

        Args:
            platform: Platform name

        Returns:
            Adapter class

        Raises:
            KeyError: If platform is not registered

        """
        if platform not in self._adapters:
            raise KeyError(
                f"Unknown platform: {platform}. Available: {list(self._adapters.keys())}"
            )

        return self._adapters[platform]

    def list_platforms(self) -> list[str]:
        """Get list of all registered platforms.

        Returns:
            List of platform names

        """
        return list(self._adapters.keys())

    def is_registered(self, platform: str) -> bool:
        """Check if platform is registered.

        Args:
            platform: Platform name

        Returns:
            True if registered, False otherwise

        """
        return platform in self._adapters


# Global adapter registry instance
ADAPTER_REGISTRY = AdapterRegistry()
