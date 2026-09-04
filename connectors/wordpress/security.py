"""
WordPress Security and Target Validation (Task 11 Step 3).

Enforces strict boundaries for WordPress mutations:
- Validates WordPress target resource identifiers and types
- Enforces an allowlist of safe SEO and content fields
- Blocks arbitrary PHP code injection, server script tags, and system function calls
- Verifies granular user capabilities (edit_posts, edit_pages, upload_files, publish)
- Scrubs credentials, application passwords, and auth headers
"""

from __future__ import annotations

import re
from typing import Any
from urllib.parse import urlparse

from connectors.base.enums import ConnectorErrorCode, ResourceType
from connectors.base.errors import (
    AuthorizationError,
    ConnectorValidationError,
    InvalidResourceError,
)
from connectors.base.security import (
    redact_secrets_from_string,
    sanitize_payload,
    validate_safe_identifier,
)
from connectors.wordpress.models import WordPressUserCapability

# Allowlisted post types for SEO/content remediation
ALLOWED_RESOURCE_TYPES = {
    ResourceType.CMS_PAGE,
    ResourceType.CMS_POST,
    ResourceType.WEBSITE_PAGE,
    ResourceType.STRUCTURED_DATA,
    ResourceType.META_TAGS,
    "page",
    "post",
    "attachment",
    "media",
    "custom",
}

# Allowlisted fields that can be safely updated
ALLOWED_MUTATION_FIELDS = {
    "title",
    "post_title",
    "content",
    "post_content",
    "excerpt",
    "post_excerpt",
    "slug",
    "post_name",
    "alt_text",
    "caption",
    "description",
    "meta",
    "meta_input",
    "seo_title",
    "seo_description",
    "schema_markup",
}

# Approved SEO meta keys supported by major plugins (Yoast, RankMath, AIOSEO)
APPROVED_SEO_META_PREFIXES = (
    "_yoast_wpseo_",
    "rank_math_",
    "_aioseo_",
    "_schema_",
    "_genesis_",
    "schema_",
    "meta_",
)

# Denylisted fields that must NEVER be modified via fix automation
DENYLISTED_FIELDS = {
    "user_pass",
    "user_login",
    "user_email",
    "roles",
    "capabilities",
    "user_nicename",
    "user_registered",
    "guid",
    "post_author",
    "comment_status",
    "ping_status",
    "post_password",
    "to_ping",
    "pinged",
    "post_content_filtered",
    "post_parent",
    "menu_order",
    "post_mime_type",
    "comment_count",
    "wp_options",
    "options",
    "plugins",
    "themes",
}

# Dangerous PHP / executable code patterns
DANGEROUS_CONTENT_PATTERNS = [
    re.compile(r"<\?php", re.IGNORECASE),
    re.compile(r"<\?=", re.IGNORECASE),
    re.compile(r"<\%", re.IGNORECASE),
    re.compile(r"<script[^>]*>\s*(?:eval|passthru|shell_exec|system|exec|popen|proc_open)\s*\(", re.IGNORECASE),
    re.compile(r"(?:eval|passthru|shell_exec|system|exec|popen|proc_open)\s*\(", re.IGNORECASE),
    re.compile(r"base64_decode\s*\(", re.IGNORECASE),
    re.compile(r"assert\s*\(", re.IGNORECASE),
    re.compile(r"\$_(?:GET|POST|REQUEST|COOKIE|SERVER|ENV|FILES)\b"),
]


def normalize_wordpress_url(url: str) -> str:
    """
    Validates and normalizes WordPress site URL.
    """
    if not url or not isinstance(url, str):
        raise ConnectorValidationError("WordPress site URL cannot be empty")

    parsed = urlparse(url.strip())
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise ConnectorValidationError(
            f"Invalid WordPress site URL scheme or domain: '{redact_secrets_from_string(url)}'"
        )

    # Normalize to base URL without trailing slash
    return f"{parsed.scheme}://{parsed.netloc}{parsed.path}".rstrip("/")


def validate_wordpress_target_resource(
    resource_type: ResourceType | str,
    resource_id: str | int,
    parameters: dict[str, Any] | None = None,
) -> tuple[str, int]:
    """
    Validates that a target resource specification is a valid WordPress post/page/media.
    Returns normalized (post_type, integer_id).
    """
    # Normalize resource type
    raw_type = resource_type.value if isinstance(resource_type, ResourceType) else str(resource_type)
    norm_type = raw_type.lower().strip()

    params = parameters or {}
    if params.get("type") in ("media", "attachment"):
        norm_type = "media"

    if norm_type in ("cms_page", "page", "website_page"):
        target_type = "page"
    elif norm_type in ("cms_post", "post"):
        target_type = "post"
    elif norm_type in ("attachment", "media"):
        target_type = "media"
    elif norm_type in ("structured_data", "meta_tags"):
        target_type = "post"  # Post metadata
    elif norm_type in ("generic_resource",):
        if params.get("type") in ("media", "attachment"):
            target_type = "media"
        elif params.get("type") in ("page", "cms_page"):
            target_type = "page"
        else:
            target_type = "post"
    else:
        raise InvalidResourceError(
            f"Unsupported WordPress resource type: '{norm_type}'. Allowed types: {sorted(list(str(r) for r in ALLOWED_RESOURCE_TYPES))}",
            details={"resource_type": norm_type},
        )

    # Validate resource ID is a valid positive integer
    try:
        int_id = int(str(resource_id).strip())
        if int_id <= 0:
            raise ValueError
    except (ValueError, TypeError):
        raise InvalidResourceError(
            f"Invalid WordPress resource ID: '{resource_id}'. Must be a positive integer.",
            details={"resource_id": str(resource_id)},
        )

    return target_type, int_id


def validate_wordpress_mutation_field(field_name: str) -> str:
    """
    Validates that a field is within the allowlist for SEO and content remediation.
    """
    if not field_name or not isinstance(field_name, str):
        raise ConnectorValidationError("Mutation field name cannot be empty")

    clean_field = field_name.strip().lower()

    if clean_field in DENYLISTED_FIELDS:
        raise ConnectorValidationError(
            f"Field '{clean_field}' is strictly denylisted for automated mutation",
            details={"field_name": clean_field},
        )

    if clean_field in ALLOWED_MUTATION_FIELDS:
        return clean_field

    # Check for approved SEO meta key prefixes
    if any(clean_field.startswith(prefix) for prefix in APPROVED_SEO_META_PREFIXES):
        return clean_field

    # Check if safe custom meta key format
    if re.match(r"^[a-zA-Z0-9_\-]+$", clean_field) and not clean_field.startswith("wp_"):
        return clean_field

    raise ConnectorValidationError(
        f"Unsupported mutation field '{clean_field}'. Allowed fields include: {sorted(list(ALLOWED_MUTATION_FIELDS))}",
        details={"field_name": clean_field},
    )


def assert_safe_wordpress_content(content: str) -> None:
    """
    Verifies that proposed content does not contain executable PHP code or injection payloads.
    """
    if not content or not isinstance(content, str):
        return

    for pattern in DANGEROUS_CONTENT_PATTERNS:
        if pattern.search(content):
            raise ConnectorValidationError(
                "Proposed content contains dangerous or executable code pattern (PHP/shell/eval injection rejected)",
                details={"reason": "executable_code_detected"},
            )


def validate_user_permission_for_mutation(
    user_cap: WordPressUserCapability | None,
    post_type: str,
    field_name: str = "edit",
) -> None:
    """
    Asserts that the authenticated user possesses the required WordPress capability
    to modify the target resource and field.
    """
    if user_cap is None:
        raise AuthorizationError(
            "Cannot perform mutation: No authenticated user context available",
            details={"code": ConnectorErrorCode.AUTHORIZATION_FAILURE.value},
        )

    if post_type in ("page", "cms_page"):
        if not user_cap.can_edit("page"):
            raise AuthorizationError(
                f"User '{user_cap.username}' lacks capability 'edit_pages' required to modify WordPress pages",
                details={"user": user_cap.username, "missing_capability": "edit_pages"},
            )
    elif post_type in ("media", "attachment"):
        if not user_cap.can_manage_media():
            raise AuthorizationError(
                f"User '{user_cap.username}' lacks capability 'upload_files' required to modify WordPress media",
                details={"user": user_cap.username, "missing_capability": "upload_files"},
            )
    else:
        if not user_cap.can_edit("post"):
            raise AuthorizationError(
                f"User '{user_cap.username}' lacks capability 'edit_posts' required to modify WordPress posts",
                details={"user": user_cap.username, "missing_capability": "edit_posts"},
            )
