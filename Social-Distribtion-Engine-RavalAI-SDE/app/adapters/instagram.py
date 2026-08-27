"""Instagram (Meta Graph API) adapter — production-ready for real API calls.

Implements the BaseAdapter interface using Meta's Instagram Content Publishing
API (Graph API v18.0).

Platform constraints:
- Caption/text: ≤ 2,200 characters
- Media: exactly one image OR one video per post
- Images: JPEG/PNG, public HTTPS URL
- Videos: MP4, public HTTPS URL (short form; long video needs extra permission)
- Rate limits: ~20 image posts / 24h, ~1 video post / 24h (via API)

Publishing is a two-stage flow:
1. POST /{ig-user-id}/media        → returns a creation container id
2. POST /{ig-user-id}/media_publish (with creation_id) → returns the media id
3. GET /{media_id}?fields=permalink → public URL for the post

API Reference:
https://developers.facebook.com/docs/instagram-platform/content-publishing-api
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

MAX_TEXT_LENGTH = 2200
MAX_MEDIA_COUNT = 1  # Instagram posts exactly one media item (image or video)

# Instagram Content Publishing API
API_BASE = "https://graph.facebook.com/v18.0"

# Meta error codes used for classification (mirror FacebookAdapter).
ERROR_INVALID_OAUTH = "190"  # Bad/invalid OAuth access token
ERROR_PERMISSION = "10"  # (Sometimes seen with 400) permission not granted
ERROR_RATE_LIMIT_CODES = {"18", "613"}  # Rate limit / API usage cap


class InstagramAdapter(BaseAdapter):
    """Instagram adapter using Meta Graph API Content Publishing.

    Supports:
    - Image posts (public image_url + caption)
    - Video posts (public video_url + media_type=VIDEO + caption)
    - Two-stage container creation → publish
    - Rate limit detection with Retry-After
    - Token expiry detection (400 code 190 / 401 / 403 → AuthError)

    Token format: The `account_id` parameter should be formatted as
    `{ig_user_id}|{page_access_token}` so the adapter can extract both the
    Instagram user id (endpoint path) and the token. This mirrors the
    Facebook adapter's `page_id|token` convention.

    Example:
        >>> adapter = InstagramAdapter()
        >>> result = await adapter.publish(
        ...     content=PublishContent(
        ...         text="Hello from RavalAI!", media_urls=["https://example.com/img.jpg"]
        ...     ),
        ...     account_id="1234567890|EAAx...",  # ig_user_id|access_token
        ... )
        >>> result.platform_post_id  # "1234567890123456789"

    """

    def __init__(self) -> None:
        """Initialize the Instagram adapter."""
        super().__init__(platform="instagram")

    def _parse_account(self, account_id: str) -> tuple[str, str]:
        """Parse account_id to extract ig_user_id and access_token.

        Args:
            account_id: Format "ig_user_id|access_token".

        Returns:
            Tuple of (ig_user_id, access_token).

        """
        if "|" in account_id:
            parts = account_id.split("|", 1)
            return parts[0], parts[1]
        # Fallback: treat the whole value as the token; the API will error on
        # the missing path segment, which surfaces as a content/auth failure.
        return "", account_id

    async def publish(  # noqa: C901
        self,
        content: PublishContent,
        account_id: str,
        author_urn: str | None = None,  # noqa: ARG002
    ) -> PublishResult:
        """Publish an image or video post to Instagram.

        Args:
            content: Post content (caption text + exactly one media_url)
            account_id: "ig_user_id|page_access_token"
            author_urn: Not used by Instagram (identity comes from the token).

        Returns:
            PublishResult with media ID and permalink

        Error handling:
            - 400 with code 190 / 401 / 403 → AuthError (token expired, reauth)
            - 429 / code 18 / 613 → RateLimitError (respect Retry-After)
            - 500+ → TransientError (retry with backoff)
            - Timeout / connection → TransientError

        """
        self.validate_content(content)

        ig_user_id, access_token = self._parse_account(account_id)
        if not ig_user_id:
            return PublishResult(
                status=PublishStatus.FAILED,
                error=FatalContentError(
                    message="Instagram account_id must be formatted as 'ig_user_id|access_token'",
                    field="account_id",
                ),
                retryable=False,
                attempts=1,
            )

        # validate_content guarantees exactly one media URL for Instagram.
        media_urls = content.media_urls or []
        media_url = media_urls[0]
        is_video = self._is_video(media_url)

        try:
            async with httpx.AsyncClient(timeout=60) as client:
                # Stage 1: create the media container.
                media_payload: dict[str, Any] = {"access_token": access_token}
                if content.text:
                    media_payload["caption"] = content.text
                if is_video:
                    media_payload.update({"media_type": "VIDEO", "video_url": media_url})
                else:
                    media_payload["image_url"] = media_url

                container_resp = await client.post(
                    f"{API_BASE}/{ig_user_id}/media",
                    data=media_payload,
                )

                # 400 + code 190 (invalid token) is an auth failure even though
                # it comes back as a 4xx — check before generic classification.
                container_result = self._classify_response(container_resp)
                if container_result is not None:
                    return container_result

                creation_id = container_resp.json()["id"]

                # Stage 2: publish the created container.
                publish_resp = await client.post(
                    f"{API_BASE}/{ig_user_id}/media_publish",
                    data={"creation_id": creation_id, "access_token": access_token},
                )
                publish_result = self._classify_response(publish_resp)
                if publish_result is not None:
                    return publish_result

                media_id = publish_resp.json()["id"]

                # Stage 3: fetch the public permalink.
                permalink = None
                try:
                    perm_resp = await client.get(
                        f"{API_BASE}/{media_id}",
                        params={"fields": "permalink", "access_token": access_token},
                    )
                    if perm_resp.status_code == 200:
                        permalink = perm_resp.json().get("permalink")
                except httpx.RequestError as e:
                    logger.warning("Failed to fetch Instagram permalink: %s", e)

            return PublishResult(
                status=PublishStatus.PUBLISHED,
                platform_post_id=media_id,
                platform_post_url=permalink,
                retryable=False,
                attempts=1,
            )

        except httpx.TimeoutException:
            logger.warning("Instagram API request timed out")
            return PublishResult(
                status=PublishStatus.FAILED,
                error=TransientError("Instagram API request timed out"),
                retryable=True,
                attempts=1,
            )
        except httpx.RequestError as e:
            logger.warning("Instagram API connection error: %s", e)
            return PublishResult(
                status=PublishStatus.FAILED,
                error=TransientError(f"Instagram API connection error: {e}"),
                retryable=True,
                attempts=1,
            )
        except (KeyError, json.JSONDecodeError) as e:
            logger.warning("Failed to parse Instagram response: %s", e)
            return PublishResult(
                status=PublishStatus.FAILED,
                error=TransientError(f"Failed to parse Instagram response: {e}"),
                retryable=True,
                attempts=1,
            )

    def _classify_response(self, response: httpx.Response) -> PublishResult | None:
        """Return a failed PublishResult if the response is an error, else None.

        Successful (200/201) responses return None so the caller can proceed.
        """
        if response.status_code in (200, 201):
            return None

        try:
            error_data = response.json()
            fb_error = error_data.get("error", {})
            error_msg = fb_error.get("message", f"HTTP {response.status_code}")
            platform_code = str(fb_error.get("code", ""))
            str(fb_error.get("error_subcode", ""))
        except Exception:
            error_msg = f"HTTP {response.status_code}"
            platform_code = ""

        # Auth: 401, 403, or 400 with invalid-oauth code (190).
        if response.status_code in (401, 403) or (
            response.status_code == 400 and platform_code == ERROR_INVALID_OAUTH
        ):
            return PublishResult(
                status=PublishStatus.FAILED,
                error=AuthError(message=error_msg, platform_error_code=platform_code),
                retryable=False,
                attempts=1,
            )

        # Rate limit: 429 or documented rate-limit codes.
        if response.status_code == 429 or platform_code in ERROR_RATE_LIMIT_CODES:
            retry_after = int(response.headers.get("Retry-After", "3600"))
            return PublishResult(
                status=PublishStatus.FAILED,
                error=RateLimitError(
                    message=error_msg,
                    retry_after_seconds=retry_after,
                    platform_error_code=platform_code,
                ),
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

        # Other 4xx = fatal (content/media error).
        return PublishResult(
            status=PublishStatus.FAILED,
            error=FatalContentError(
                message=error_msg, field="content", platform_error_code=platform_code
            ),
            retryable=False,
            attempts=1,
        )

    def _is_video(self, media_url: str) -> bool:
        """Heuristic: treat common video extensions as video posts."""
        lower = media_url.lower().split("?")[0]
        return (
            lower.endswith((".mp4", ".mov", ".m4v", ".webm", ".avi", ".mkv")) or "/video/" in lower
        )

    def validate_content(self, content: PublishContent) -> None:
        """Validate content against Instagram constraints.

        Raises:
            FatalContentError: If content violates Instagram rules

        """
        if content.text and len(content.text) > MAX_TEXT_LENGTH:
            raise FatalContentError(
                message=f"Instagram caption exceeds {MAX_TEXT_LENGTH} characters (got {len(content.text)})",
                field="text",
            )

        if not content.media_urls:
            raise FatalContentError(
                message="Instagram posts require exactly one image or video (media_urls is empty)",
                field="media_urls",
            )

        if len(content.media_urls) > MAX_MEDIA_COUNT:
            raise FatalContentError(
                message=f"Instagram supports exactly {MAX_MEDIA_COUNT} media item per post (got {len(content.media_urls)})",
                field="media_urls",
            )

        media_url = content.media_urls[0]
        if not media_url.startswith(("http://", "https://")):
            raise FatalContentError(
                message=f"Instagram media must be a public https URL (got: {media_url})",
                field="media_urls",
            )

    def get_capabilities(self) -> dict[str, Any]:
        return {
            "platform": "instagram",
            "max_text_length": MAX_TEXT_LENGTH,
            "max_media_count": MAX_MEDIA_COUNT,
            "supported_media_types": ["image", "video"],
            "supports_scheduling": False,
            "supports_replies": False,
            "supports_hashtags": True,
        }
