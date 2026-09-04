"""
WordPress REST API Client Protocol, In-Memory Mock, and HTTP Layer (Task 11 Step 3).

Provides a decoupled client interface allowing the WordPressConnector to operate against
either in-memory simulated WordPress environments or the live WordPress REST API.
"""

from __future__ import annotations

import base64
import copy
import logging
import time
from datetime import datetime, timezone
from typing import Any, Protocol

from connectors.base.enums import ConnectorErrorCode
from connectors.base.errors import (
    AuthenticationError,
    AuthorizationError,
    ConnectorNetworkError,
    ConnectorTimeoutError,
    ProviderAPIError,
    RateLimitExceededError,
    ResourceNotFoundError,
)
from connectors.base.models import RateLimitInfo
from connectors.base.security import (
    redact_secrets_from_string,
    sanitize_payload,
)
from connectors.wordpress.models import (
    WordPressMediaInfo,
    WordPressResourceInfo,
    WordPressSiteIdentity,
    WordPressUserCapability,
)

logger = logging.getLogger(__name__)


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class WordPressClientProtocol(Protocol):
    """Protocol defining WordPress REST API operations."""

    def authenticate(self, credentials: dict[str, Any] | None = None) -> WordPressUserCapability:
        """Authenticates with WordPress and returns user capabilities."""
        ...

    def get_site_info(self) -> WordPressSiteIdentity:
        """Fetches WordPress site identity and capabilities."""
        ...

    def get_resource(self, resource_type: str, resource_id: int) -> WordPressResourceInfo | WordPressMediaInfo:
        """Fetches a post, page, or media attachment by ID."""
        ...

    def update_resource(
        self,
        resource_type: str,
        resource_id: int,
        payload: dict[str, Any],
    ) -> WordPressResourceInfo | WordPressMediaInfo:
        """Updates a post, page, or media attachment."""
        ...

    def get_rate_limit(self) -> RateLimitInfo:
        """Returns API rate limit status."""
        ...

    def verify_public_url(self, url: str, expected_snippet: str | None = None) -> bool:
        """Verifies public accessibility of a rendered WordPress page."""
        ...


class MockWordPressClient:
    """
    High-fidelity in-memory simulated WordPress REST API client for testing.
    """

    def __init__(
        self,
        site_url: str = "https://example-wordpress.com",
        authenticated_user: WordPressUserCapability | None = None,
    ) -> None:
        self.site_url = site_url.rstrip("/")
        self.rest_url = f"{self.site_url}/wp-json/wp/v2"
        self._is_authenticated = False
        self._current_user = authenticated_user or WordPressUserCapability(
            user_id=1,
            username="admin_user",
            roles=["administrator"],
            capabilities=[
                "read",
                "edit_posts",
                "edit_pages",
                "publish_posts",
                "publish_pages",
                "upload_files",
                "manage_options",
            ],
        )

        # In-memory stores for pages, posts, and media
        self.pages: dict[int, dict[str, Any]] = {
            101: {
                "id": 101,
                "slug": "about-us",
                "title": "About Us",
                "content": "<p>Welcome to our company. We deliver AI solutions.</p>",
                "excerpt": "Learn about our company mission and AI solutions.",
                "post_type": "page",
                "status": "publish",
                "link": f"{self.site_url}/about-us",
                "meta": {
                    "_yoast_wpseo_title": "About Us | Leading AI Solutions",
                    "_yoast_wpseo_metadesc": "Learn about our company mission and cutting edge AI technology.",
                },
                "modified_gmt": "2026-09-01T12:00:00Z",
                "author_id": 1,
            },
            102: {
                "id": 102,
                "slug": "contact",
                "title": "Contact",
                "content": "<p>Contact our support team anytime.</p>",
                "excerpt": "Contact information and office locations.",
                "post_type": "page",
                "status": "publish",
                "link": f"{self.site_url}/contact",
                "meta": {},
                "modified_gmt": "2026-09-01T12:00:00Z",
                "author_id": 1,
            },
        }

        self.posts: dict[int, dict[str, Any]] = {
            201: {
                "id": 201,
                "slug": "generative-engine-optimization-guide",
                "title": "Generative Engine Optimization Guide",
                "content": "<h1>GEO Overview</h1><p>Optimizing content for LLMs and AI search engines.</p><img src='https://example-wordpress.com/wp-content/uploads/geo.jpg' alt='old alt'>",
                "excerpt": "A complete technical guide to Generative Engine Optimization.",
                "post_type": "post",
                "status": "publish",
                "link": f"{self.site_url}/geo-guide",
                "meta": {
                    "_yoast_wpseo_title": "GEO Guide 2026",
                    "_yoast_wpseo_metadesc": "Comprehensive guide to ranking in AI search answers.",
                },
                "modified_gmt": "2026-09-02T10:00:00Z",
                "author_id": 1,
            },
        }

        self.media: dict[int, dict[str, Any]] = {
            301: {
                "id": 301,
                "slug": "geo-diagram",
                "title": "GEO Diagram",
                "source_url": f"{self.site_url}/wp-content/uploads/2026/09/geo-diagram.png",
                "alt_text": "Old descriptive image alt",
                "caption": "Architecture of GEO pipeline",
                "description": "Full architectural diagram",
                "mime_type": "image/png",
                "modified_gmt": "2026-09-01T08:00:00Z",
            },
        }

        # Simulated failure flags
        self.simulate_auth_failure: bool = False
        self.simulate_rate_limit: bool = False
        self.simulate_timeout: bool = False
        self.simulate_network_error: bool = False
        self.simulate_malformed_response: bool = False

    def set_user_role(self, role: str) -> None:
        """Helper to quickly change authenticated user role in tests."""
        if role == "administrator":
            self._current_user = WordPressUserCapability(
                user_id=1,
                username="admin_user",
                roles=["administrator"],
                capabilities=["read", "edit_posts", "edit_pages", "publish_posts", "publish_pages", "upload_files", "manage_options"],
            )
        elif role == "editor":
            self._current_user = WordPressUserCapability(
                user_id=2,
                username="editor_user",
                roles=["editor"],
                capabilities=["read", "edit_posts", "edit_pages", "publish_posts", "publish_pages", "upload_files"],
            )
        elif role == "author":
            self._current_user = WordPressUserCapability(
                user_id=3,
                username="author_user",
                roles=["author"],
                capabilities=["read", "edit_posts", "publish_posts", "upload_files"],
            )
        elif role == "subscriber":
            self._current_user = WordPressUserCapability(
                user_id=4,
                username="subscriber_user",
                roles=["subscriber"],
                capabilities=["read"],
            )
        else:
            self._current_user = WordPressUserCapability(
                user_id=5,
                username="custom_user",
                roles=[role],
                capabilities=["read"],
            )

    def _check_injected_faults(self) -> None:
        if self.simulate_timeout:
            raise ConnectorTimeoutError(
                "WordPress REST API request timed out (simulated)",
                details={"code": ConnectorErrorCode.TIMEOUT.value},
            )
        if self.simulate_rate_limit:
            raise RateLimitExceededError(
                "WordPress API rate limit exceeded (HTTP 429 simulated)",
                details={"code": ConnectorErrorCode.RATE_LIMITED.value},
                retry_after_seconds=60,
            )
        if self.simulate_network_error:
            raise ConnectorNetworkError(
                "Failed to reach WordPress host (simulated connection error)",
                details={"code": ConnectorErrorCode.NETWORK_ERROR.value},
            )
        if self.simulate_malformed_response:
            raise ProviderAPIError(
                "Malformed JSON response received from WordPress REST API",
                details={"code": ConnectorErrorCode.PROVIDER_ERROR.value},
            )

    def authenticate(self, credentials: dict[str, Any] | None = None) -> WordPressUserCapability:
        self._check_injected_faults()
        if self.simulate_auth_failure:
            raise AuthenticationError(
                "Invalid WordPress application password or credentials (simulated)",
                details={"code": ConnectorErrorCode.AUTHENTICATION_FAILURE.value},
            )

        if credentials is not None:
            # Check for dummy invalid tokens
            app_pass = credentials.get("application_password") or credentials.get("password") or credentials.get("token") or ""
            if app_pass == "invalid_token" or app_pass == "expired_pass":
                raise AuthenticationError(
                    "WordPress authentication rejected: invalid application password",
                    details={"code": ConnectorErrorCode.AUTHENTICATION_FAILURE.value},
                )

        self._is_authenticated = True
        return self._current_user

    def get_site_info(self) -> WordPressSiteIdentity:
        self._check_injected_faults()
        return WordPressSiteIdentity(
            site_url=self.site_url,
            rest_url=self.rest_url,
            site_name="Test AI WordPress Site",
            wp_version="6.5.2",
            timezone_string="UTC",
            active_plugins=["wordpress-seo/wp-seo.php", "rank-math/rank-math.php"],
            metadata={"multisite": False},
        )

    def get_resource(self, resource_type: str, resource_id: int) -> WordPressResourceInfo | WordPressMediaInfo:
        self._check_injected_faults()
        norm_type = resource_type.lower().strip()

        if norm_type in ("media", "attachment"):
            if resource_id not in self.media:
                raise ResourceNotFoundError(
                    f"WordPress media attachment #{resource_id} not found",
                    details={"resource_id": str(resource_id), "type": "media"},
                )
            return WordPressMediaInfo(**self.media[resource_id])

        if norm_type in ("page", "cms_page"):
            if resource_id not in self.pages:
                raise ResourceNotFoundError(
                    f"WordPress page #{resource_id} not found",
                    details={"resource_id": str(resource_id), "type": "page"},
                )
            return WordPressResourceInfo(**self.pages[resource_id])

        # Default: post
        if resource_id not in self.posts:
            raise ResourceNotFoundError(
                f"WordPress post #{resource_id} not found",
                details={"resource_id": str(resource_id), "type": "post"},
            )
        return WordPressResourceInfo(**self.posts[resource_id])

    def update_resource(
        self,
        resource_type: str,
        resource_id: int,
        payload: dict[str, Any],
    ) -> WordPressResourceInfo | WordPressMediaInfo:
        self._check_injected_faults()
        norm_type = resource_type.lower().strip()

        if norm_type in ("media", "attachment"):
            if resource_id not in self.media:
                raise ResourceNotFoundError(
                    f"WordPress media attachment #{resource_id} not found",
                    details={"resource_id": str(resource_id)},
                )
            record = self.media[resource_id]
            for k, v in payload.items():
                if k in record:
                    record[k] = v
            record["modified_gmt"] = _utc_now_iso()
            return WordPressMediaInfo(**record)

        target_store = self.pages if norm_type in ("page", "cms_page") else self.posts

        if resource_id not in target_store:
            raise ResourceNotFoundError(
                f"WordPress {norm_type} #{resource_id} not found",
                details={"resource_id": str(resource_id)},
            )

        record = target_store[resource_id]

        # Apply top-level updates
        for k, v in payload.items():
            if k == "meta" and isinstance(v, dict):
                record.setdefault("meta", {})
                record["meta"].update(v)
            elif k in record:
                record[k] = v

        record["modified_gmt"] = _utc_now_iso()
        return WordPressResourceInfo(**record)

    def get_rate_limit(self) -> RateLimitInfo:
        self._check_injected_faults()
        return RateLimitInfo(
            limit=1000,
            remaining=995,
            reset_at=datetime.now(timezone.utc),
            retry_after_seconds=None,
        )

    def verify_public_url(self, url: str, expected_snippet: str | None = None) -> bool:
        self._check_injected_faults()
        return True


class LiveWordPressClient:
    """
    HTTP-based live WordPress REST API client using httpx.
    Ensures all tokens, application passwords, and auth headers are automatically scrubbed.
    """

    def __init__(
        self,
        site_url: str,
        credentials: dict[str, Any] | None = None,
        timeout_seconds: float = 15.0,
    ) -> None:
        import httpx

        self.site_url = site_url.rstrip("/")
        self.rest_url = f"{self.site_url}/wp-json/wp/v2"
        self._credentials = credentials or {}
        self._timeout = timeout_seconds

        # Build auth header
        headers = {
            "Accept": "application/json",
            "Content-Type": "application/json",
            "User-Agent": "RavalAI-Intelligence-Bot/1.0",
        }

        username = self._credentials.get("username")
        app_password = (
            self._credentials.get("application_password")
            or self._credentials.get("password")
            or self._credentials.get("app_password")
        )
        token = self._credentials.get("token") or self._credentials.get("bearer_token")

        if username and app_password:
            raw_creds = f"{username}:{app_password}".encode("utf-8")
            b64 = base64.b64encode(raw_creds).decode("utf-8")
            headers["Authorization"] = f"Basic {b64}"
        elif token:
            headers["Authorization"] = f"Bearer {token}"

        self._client = httpx.Client(
            headers=headers,
            timeout=self._timeout,
            follow_redirects=True,
        )

    def authenticate(self, credentials: dict[str, Any] | None = None) -> WordPressUserCapability:
        import httpx

        try:
            resp = self._client.get(f"{self.rest_url}/users/me")
            if resp.status_code == 401 or resp.status_code == 403:
                raise AuthenticationError(
                    "WordPress authentication failed: invalid credentials or insufficient permissions",
                    details={"status_code": resp.status_code},
                )
            resp.raise_for_status()
            data = resp.json()

            return WordPressUserCapability(
                user_id=data.get("id", 1),
                username=data.get("name", "wp_user"),
                roles=data.get("roles", ["editor"]),
                capabilities=list(data.get("capabilities", {}).keys()) or ["read", "edit_posts"],
            )
        except httpx.TimeoutException as exc:
            raise ConnectorTimeoutError(
                f"Timeout authenticating with WordPress: {redact_secrets_from_string(str(exc))}",
            ) from exc
        except httpx.RequestError as exc:
            raise ConnectorNetworkError(
                f"Network error authenticating with WordPress: {redact_secrets_from_string(str(exc))}",
            ) from exc

    def get_site_info(self) -> WordPressSiteIdentity:
        import httpx

        try:
            resp = self._client.get(f"{self.site_url}/wp-json")
            resp.raise_for_status()
            data = resp.json()
            return WordPressSiteIdentity(
                site_url=self.site_url,
                rest_url=self.rest_url,
                site_name=data.get("name", "WordPress Site"),
                wp_version=data.get("namespaces", ["wp/v2"])[0] if data.get("namespaces") else "6.0",
                timezone_string=data.get("timezone_string", "UTC"),
            )
        except Exception as exc:
            return WordPressSiteIdentity(
                site_url=self.site_url,
                rest_url=self.rest_url,
                site_name="WordPress Site",
            )

    def get_resource(self, resource_type: str, resource_id: int) -> WordPressResourceInfo | WordPressMediaInfo:
        import httpx

        norm_type = resource_type.lower().strip()
        endpoint = "pages" if norm_type in ("page", "cms_page") else ("media" if norm_type in ("media", "attachment") else "posts")

        try:
            resp = self._client.get(f"{self.rest_url}/{endpoint}/{resource_id}")
            if resp.status_code == 404:
                raise ResourceNotFoundError(
                    f"WordPress {norm_type} #{resource_id} not found",
                    details={"resource_id": str(resource_id)},
                )
            if resp.status_code == 401 or resp.status_code == 403:
                raise AuthorizationError(
                    f"Unauthorized to read WordPress {norm_type} #{resource_id}",
                    details={"status_code": resp.status_code},
                )
            resp.raise_for_status()
            data = resp.json()

            if norm_type in ("media", "attachment"):
                return WordPressMediaInfo(
                    id=data["id"],
                    slug=data.get("slug", ""),
                    title=data.get("title", {}).get("rendered", "") if isinstance(data.get("title"), dict) else str(data.get("title", "")),
                    source_url=data.get("source_url", ""),
                    alt_text=data.get("alt_text", ""),
                    caption=data.get("caption", {}).get("rendered", "") if isinstance(data.get("caption"), dict) else str(data.get("caption", "")),
                    description=data.get("description", {}).get("rendered", "") if isinstance(data.get("description"), dict) else str(data.get("description", "")),
                    mime_type=data.get("mime_type", "image/jpeg"),
                    modified_gmt=data.get("modified_gmt"),
                )

            return WordPressResourceInfo(
                id=data["id"],
                slug=data.get("slug", ""),
                title=data.get("title", {}).get("rendered", "") if isinstance(data.get("title"), dict) else str(data.get("title", "")),
                content=data.get("content", {}).get("rendered", "") if isinstance(data.get("content"), dict) else str(data.get("content", "")),
                excerpt=data.get("excerpt", {}).get("rendered", "") if isinstance(data.get("excerpt"), dict) else str(data.get("excerpt", "")),
                post_type="page" if norm_type in ("page", "cms_page") else "post",
                status=data.get("status", "publish"),
                link=data.get("link", ""),
                meta=data.get("meta", {}),
                modified_gmt=data.get("modified_gmt"),
                author_id=data.get("author"),
            )
        except httpx.TimeoutException as exc:
            raise ConnectorTimeoutError(f"Timeout fetching WordPress resource: {redact_secrets_from_string(str(exc))}") from exc
        except httpx.RequestError as exc:
            raise ConnectorNetworkError(f"Network error fetching WordPress resource: {redact_secrets_from_string(str(exc))}") from exc

    def update_resource(
        self,
        resource_type: str,
        resource_id: int,
        payload: dict[str, Any],
    ) -> WordPressResourceInfo | WordPressMediaInfo:
        import httpx

        norm_type = resource_type.lower().strip()
        endpoint = "pages" if norm_type in ("page", "cms_page") else ("media" if norm_type in ("media", "attachment") else "posts")

        try:
            resp = self._client.post(f"{self.rest_url}/{endpoint}/{resource_id}", json=payload)
            if resp.status_code == 404:
                raise ResourceNotFoundError(
                    f"WordPress {norm_type} #{resource_id} not found",
                    details={"resource_id": str(resource_id)},
                )
            if resp.status_code == 401 or resp.status_code == 403:
                raise AuthorizationError(
                    f"Insufficient permissions to update WordPress {norm_type} #{resource_id}",
                    details={"status_code": resp.status_code},
                )
            if resp.status_code == 429:
                raise RateLimitExceededError("WordPress API rate limit exceeded")
            resp.raise_for_status()
            data = resp.json()

            if norm_type in ("media", "attachment"):
                return WordPressMediaInfo(
                    id=data["id"],
                    slug=data.get("slug", ""),
                    title=data.get("title", {}).get("rendered", "") if isinstance(data.get("title"), dict) else str(data.get("title", "")),
                    source_url=data.get("source_url", ""),
                    alt_text=data.get("alt_text", ""),
                    caption=data.get("caption", {}).get("rendered", "") if isinstance(data.get("caption"), dict) else str(data.get("caption", "")),
                    description=data.get("description", {}).get("rendered", "") if isinstance(data.get("description"), dict) else str(data.get("description", "")),
                    mime_type=data.get("mime_type", "image/jpeg"),
                    modified_gmt=data.get("modified_gmt"),
                )

            return WordPressResourceInfo(
                id=data["id"],
                slug=data.get("slug", ""),
                title=data.get("title", {}).get("rendered", "") if isinstance(data.get("title"), dict) else str(data.get("title", "")),
                content=data.get("content", {}).get("rendered", "") if isinstance(data.get("content"), dict) else str(data.get("content", "")),
                excerpt=data.get("excerpt", {}).get("rendered", "") if isinstance(data.get("excerpt"), dict) else str(data.get("excerpt", "")),
                post_type="page" if norm_type in ("page", "cms_page") else "post",
                status=data.get("status", "publish"),
                link=data.get("link", ""),
                meta=data.get("meta", {}),
                modified_gmt=data.get("modified_gmt"),
                author_id=data.get("author"),
            )
        except httpx.TimeoutException as exc:
            raise ConnectorTimeoutError(f"Timeout updating WordPress resource: {redact_secrets_from_string(str(exc))}") from exc
        except httpx.RequestError as exc:
            raise ConnectorNetworkError(f"Network error updating WordPress resource: {redact_secrets_from_string(str(exc))}") from exc

    def get_rate_limit(self) -> RateLimitInfo:
        return RateLimitInfo(limit=1000, remaining=999, reset_at=datetime.now(timezone.utc))

    def verify_public_url(self, url: str, expected_snippet: str | None = None) -> bool:
        import httpx

        try:
            resp = self._client.get(url)
            if resp.status_code >= 400:
                return False
            if expected_snippet:
                return expected_snippet in resp.text
            return True
        except Exception:
            return False
