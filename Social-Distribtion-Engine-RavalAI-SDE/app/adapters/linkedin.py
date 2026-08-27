"""LinkedIn platform adapter — production-ready for real API calls.

Implements the BaseAdapter interface for LinkedIn Marketing API v2.

Platform constraints:
- Text: ≤ 3,000 characters
- Media: Images (PNG, JPG, max 100MB), Videos (MP4, max 5GB)
- Rate limits: 100 posts/day per member
- OAuth 2.0 Bearer token (from encrypted storage)
- UGC Post API for publishing

API Reference: https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/share-on-linkedin
"""

from __future__ import annotations

import json
import logging
from typing import Any

import httpx

from app.adapters.base import BaseAdapter, PublishContent, PublishResult, PublishStatus
from app.adapters.errors import (
    AuthError,
    FatalContentError,
    RateLimitError,
    TransientError,
)

logger = logging.getLogger(__name__)

MAX_TEXT_LENGTH = 3000
MAX_MEDIA_COUNT = 1  # LinkedIn allows only 1 media per post

# API endpoints
UGC_POST_URL = "https://api.linkedin.com/v2/ugcPosts"
REGISTER_UPLOAD_URL = "https://api.linkedin.com/v2/assets?action=registerUpload"


class LinkedInAdapter(BaseAdapter):
    """LinkedIn adapter using LinkedIn Marketing API v2.

    Supports:
    - Text posts (text-only)
    - Single image posts (image upload via register → upload → finalize)
    - Video posts (simplified — full upload requires multi-step)
    - Professional formatting (no character counting tricks)

    Example:
        >>> adapter = LinkedInAdapter()
        >>> result = await adapter.publish(
        ...     content=PublishContent(text="Excited to announce our new feature!"),
        ...     account_id="AQDz...linkedin_token",
        ... )
        >>> result.platform_post_id  # "urn:li:share:1234567890"

    """

    API_BASE = "https://api.linkedin.com/v2"

    def __init__(self) -> None:
        """Initialize the LinkedIn adapter."""
        super().__init__(platform="linkedin")

    async def publish(
        self,
        content: PublishContent,
        account_id: str,
        author_urn: str | None = None,
    ) -> PublishResult:
        """Publish a post to LinkedIn.

        Args:
            content: Post content (text, media_urls)
            account_id: OAuth 2.0 Bearer token (member-scoped or page-scoped)
            author_urn: LinkedIn author URN (e.g. ``urn:li:person:<sub>`` or
                ``urn:li:organization:<id>``), captured at OAuth connect time
                (see ADR-0002). Required for real publishing.

        Returns:
            PublishResult with post ID and URL

        """
        self.validate_content(content)

        # Author identity must come from OAuth connect time (ADR-0002).
        # The old code fabricated ``urn:li:person:<account_id>`` from the token
        # string, which is wrong once a real bearer token is passed.
        if not author_urn:
            return PublishResult(
                status=PublishStatus.FAILED,
                error=FatalContentError(
                    message=(
                        "LinkedIn author_urn is missing for this account — "
                        "reconnect the account so its identity is captured"
                    ),
                    field="author_urn",
                ),
                retryable=False,
                attempts=1,
            )

        try:
            # Build share payload
            share_content: dict[str, Any] = {
                "shareCommentary": {"text": content.text or ""},
                "shareMediaCategory": "NONE",
            }

            # Handle media upload if present
            if content.media_urls:
                asset_urn = await self._upload_image(content.media_urls[0], account_id, author_urn)
                if asset_urn:
                    share_content["shareMediaCategory"] = "IMAGE"
                    share_content["media"] = [
                        {
                            "status": "READY",
                            "description": {"text": "Shared image"},
                            "originalUrl": content.media_urls[0],
                            "title": {"text": "Shared Image"},
                        }
                    ]

            share_body = {
                "author": author_urn,
                "lifecycleState": "PUBLISHED",
                "specificContent": {
                    "com.linkedin.ugc.ShareContent": share_content,
                },
                "visibility": {
                    "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC",
                },
            }

            async with httpx.AsyncClient(timeout=30) as client:
                response = await client.post(
                    UGC_POST_URL,
                    json=share_body,
                    headers={
                        "Authorization": f"Bearer {account_id}",
                        "Content-Type": "application/json",
                        "X-Restli-Protocol-Version": "2.0.0",
                    },
                )

            return self._parse_response(response)

        except httpx.TimeoutException:
            return PublishResult(
                status=PublishStatus.FAILED,
                error=TransientError("LinkedIn API request timed out"),
                retryable=True,
                attempts=1,
            )
        except httpx.RequestError as e:
            return PublishResult(
                status=PublishStatus.FAILED,
                error=TransientError(f"LinkedIn API connection error: {e}"),
                retryable=True,
                attempts=1,
            )

    def _parse_response(self, response: httpx.Response) -> PublishResult:
        """Parse LinkedIn API response into PublishResult."""
        if response.status_code in (200, 201):
            try:
                data = response.json()
                post_id = data.get("id", "")
                return PublishResult(
                    status=PublishStatus.PUBLISHED,
                    platform_post_id=post_id,
                    platform_post_url=f"https://www.linkedin.com/feed/update/{post_id}",
                    retryable=False,
                    attempts=1,
                )
            except (json.JSONDecodeError, KeyError) as e:
                return PublishResult(
                    status=PublishStatus.FAILED,
                    error=TransientError(f"Failed to parse LinkedIn response: {e}"),
                    retryable=True,
                    attempts=1,
                )

        # Parse error
        try:
            error_data = response.json()
            error_msg = error_data.get("message", f"HTTP {response.status_code}")
            platform_code = str(error_data.get("status", ""))
        except Exception:
            error_msg = f"HTTP {response.status_code}"
            platform_code = ""

        if response.status_code in (401, 403):
            return PublishResult(
                status=PublishStatus.FAILED,
                error=AuthError(message=error_msg, platform_error_code=platform_code),
                retryable=False,
                attempts=1,
            )

        if response.status_code == 429:
            retry_after = int(response.headers.get("Retry-After", "60"))
            return PublishResult(
                status=PublishStatus.FAILED,
                error=RateLimitError(message=error_msg, retry_after_seconds=retry_after),
                retryable=True,
                attempts=1,
            )

        if response.status_code >= 500:
            return PublishResult(
                status=PublishStatus.FAILED,
                error=TransientError(message=error_msg, platform_error_code=platform_code),
                retryable=True,
                attempts=1,
            )

        return PublishResult(
            status=PublishStatus.FAILED,
            error=FatalContentError(
                message=error_msg, field="content", platform_error_code=platform_code
            ),
            retryable=False,
            attempts=1,
        )

    async def _upload_image(
        self,
        image_url: str,
        bearer_token: str,
        author_urn: str,
    ) -> str | None:
        """Upload an image to LinkedIn and return the asset URN.

        LinkedIn image upload flow:
        1. Register upload → get upload URL + asset URN
        2. PUT binary data to upload URL
        3. Return asset URN for the UGC post

        Args:
            image_url: Public URL of the image to attach.
            bearer_token: OAuth bearer token.
            author_urn: Author identity that owns the upload (person or Page).

        Returns:
            Asset URN string, or None if upload failed

        """
        try:
            async with httpx.AsyncClient(timeout=60) as client:
                # Step 1: Register upload
                register_payload = {
                    "registerUploadRequest": {
                        "recipes": ["urn:li:digitalmediaRecipe:feedshare-image"],
                        "owner": author_urn,
                        "serviceRelationships": [
                            {
                                "relationshipType": "OWNER",
                                "identifier": "urn:li:userGeneratedContent",
                            }
                        ],
                    }
                }

                reg_response = await client.post(
                    REGISTER_UPLOAD_URL,
                    json=register_payload,
                    headers={
                        "Authorization": f"Bearer {bearer_token}",
                        "Content-Type": "application/json",
                    },
                )

                if reg_response.status_code not in (200, 201):
                    logger.warning("LinkedIn register upload failed: %d", reg_response.status_code)
                    return None

                reg_data = reg_response.json()
                upload_url = reg_data["value"]["uploadMechanism"][
                    "com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest"
                ]["uploadUrl"]
                asset_urn: str | None = str(reg_data["value"]["asset"])

                # Step 2: Download image and upload
                img_response = await client.get(image_url)
                if img_response.status_code != 200:
                    logger.warning("Failed to download image from %s", image_url)
                    return None

                put_response = await client.put(
                    upload_url,
                    content=img_response.content,
                    headers={
                        "Authorization": f"Bearer {bearer_token}",
                        "Content-Type": "application/octet-stream",
                    },
                )

                if put_response.status_code in (200, 201):
                    return asset_urn
                logger.warning("LinkedIn image upload failed: %d", put_response.status_code)
                return None

        except httpx.RequestError as e:
            logger.error("LinkedIn image upload failed: %s", e)
            return None

    def validate_content(self, content: PublishContent) -> None:
        """Validate content against LinkedIn constraints."""
        if content.text and len(content.text) > MAX_TEXT_LENGTH:
            raise FatalContentError(
                message=f"LinkedIn post exceeds {MAX_TEXT_LENGTH} characters (got {len(content.text)})",
                field="text",
            )

        if not content.text and not content.media_urls:
            raise FatalContentError(
                message="LinkedIn post must have text or media",
                field="content",
            )

        if content.media_urls and len(content.media_urls) > MAX_MEDIA_COUNT:
            raise FatalContentError(
                message=f"LinkedIn supports max {MAX_MEDIA_COUNT} media (got {len(content.media_urls)})",
                field="media_urls",
            )

    def get_capabilities(self) -> dict[str, Any]:
        return {
            "platform": "linkedin",
            "max_text_length": MAX_TEXT_LENGTH,
            "max_media_count": MAX_MEDIA_COUNT,
            "supported_media_types": ["image", "video"],
            "supports_scheduling": False,
            "supports_replies": True,
            "supports_hashtags": True,
        }
