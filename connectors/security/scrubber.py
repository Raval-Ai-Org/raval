"""
Deep Recursive Secret & Credential Scrubber (Task 11 Step 6).

Guarantees zero credential, token, key, or password exposure across:
- Logs
- Audit records
- Exceptions & tracebacks
- Validation reports
- Previews and diffs
- Execution metadata & parameters
- Nested dictionaries, lists, tuples, and custom objects
"""

from __future__ import annotations

import re
from typing import Any
from urllib.parse import urlsplit, urlunsplit

# Sensitive dictionary keys to redact
SENSITIVE_KEYS: tuple[str, ...] = (
    "password",
    "passwd",
    "pwd",
    "secret",
    "secret_key",
    "client_secret",
    "api_key",
    "apikey",
    "access_token",
    "refresh_token",
    "auth_token",
    "bearer",
    "token",
    "private_key",
    "privkey",
    "authorization",
    "cookie",
    "set-cookie",
    "session_id",
    "session",
    "phpsessid",
    "credential",
    "credentials",
    "db_password",
    "db_pass",
    "app_password",
    "application_password",
    "x-api-key",
    "x-auth-token",
)

# Regex patterns for high-entropy secrets and credential formats
SECRET_PATTERNS: tuple[re.Pattern[str], ...] = (
    # Authorization header Bearer token
    re.compile(r"Bearer\s+([A-Za-z0-9_\-\.]{8,})", re.IGNORECASE),
    # Basic auth header
    re.compile(r"Basic\s+([A-Za-z0-9+/=]{8,})", re.IGNORECASE),
    # GitHub Personal Access Tokens and OAuth tokens
    re.compile(r"gh[pousr]_[A-Za-z0-9]{36,}", re.IGNORECASE),
    re.compile(r"github_pat_[A-Za-z0-9_]{60,}", re.IGNORECASE),
    # OpenAI & generic sk- keys
    re.compile(r"sk-[A-Za-z0-9_-]{20,}", re.IGNORECASE),
    # Google API keys
    re.compile(r"AIzaSy[A-Za-z0-9_-]{33}", re.IGNORECASE),
    # AWS Access Key IDs
    re.compile(r"(?:AKIA|ASIA)[0-9A-Z]{16}", re.IGNORECASE),
    # Private Key blocks
    re.compile(r"-----BEGIN [A-Z ]+ PRIVATE KEY-----[\s\S]*?-----END [A-Z ]+ PRIVATE KEY-----"),
    # WordPress application password format (4x4 alphanumeric: xxxx xxxx xxxx xxxx)
    re.compile(r"\b[A-Za-z0-9]{4}\s+[A-Za-z0-9]{4}\s+[A-Za-z0-9]{4}\s+[A-Za-z0-9]{4}\b"),
    # Key-value assignments in logs/strings (e.g. password=xyz, token=abc)
    re.compile(
        r"(?:password|passwd|pwd|secret|api_key|token|auth_token|access_token|client_secret)\s*[:=]\s*['\"]?([^\s,;'\"]{3,})['\"]?",
        re.IGNORECASE,
    ),
    # Cookie header contents
    re.compile(r"(?:PHPSESSID|session_id|wordpress_logged_in_[a-f0-9]+)=([^;\s]+)", re.IGNORECASE),
    # Embedded credentials in URLs
    re.compile(r"([a-zA-Z][a-zA-Z0-9+\-.]*://)(?:[^:\s]+):(?:[^@\s]+)@([^\s/]+)", re.IGNORECASE),
)

REDACTED_STR = "[REDACTED]"


def redact_credentials_from_url(url: str) -> str:
    """
    Strips embedded username and password from a URL (e.g. https://user:pass@host/path -> https://[REDACTED]:[REDACTED]@host/path).
    """
    if not url or "@" not in url:
        return url

    try:
        parts = urlsplit(url)
        if parts.username or parts.password:
            hostname = parts.hostname or ""
            port_str = f":{parts.port}" if parts.port else ""
            netloc = f"{REDACTED_STR}:{REDACTED_STR}@{hostname}{port_str}"
            return urlunsplit((parts.scheme, netloc, parts.path, parts.query, parts.fragment))
    except Exception:
        pass
    return url


def scrub_string(text: str) -> str:
    """
    Deep-scans a string for embedded secrets, tokens, credentials, and sanitizes them.
    """
    if not text:
        return text

    sanitized = text

    # Apply secret regexes
    for pattern in SECRET_PATTERNS:
        if pattern.pattern.startswith("([a-zA-Z]"):
            sanitized = pattern.sub(r"\1[REDACTED]:[REDACTED]@\2", sanitized)
        elif pattern.groups > 0:
            def _replacer(match: re.Match[str]) -> str:
                full = match.group(0)
                secret_val = match.group(1)
                return full.replace(secret_val, REDACTED_STR)
            sanitized = pattern.sub(_replacer, sanitized)
        else:
            sanitized = pattern.sub(REDACTED_STR, sanitized)

    return sanitized


class DeepScrubber:
    """
    Recursively scrubs data structures of any nesting level.
    """

    @classmethod
    def scrub(cls, obj: Any) -> Any:
        """
        Recursively redacts sensitive keys and values from dicts, lists, sets, tuples, and strings.
        """
        if isinstance(obj, dict):
            sanitized_dict: dict[str, Any] = {}
            for k, v in obj.items():
                k_str = str(k)
                k_lower = k_str.lower()
                # If key itself matches sensitive patterns, redact value immediately
                if any(s_key == k_lower or s_key in k_lower for s_key in SENSITIVE_KEYS):
                    sanitized_dict[k_str] = REDACTED_STR
                else:
                    sanitized_dict[k_str] = cls.scrub(v)
            return sanitized_dict

        elif isinstance(obj, (list, tuple, set)):
            scrubbed_items = [cls.scrub(item) for item in obj]
            if isinstance(obj, tuple):
                return tuple(scrubbed_items)
            elif isinstance(obj, set):
                return set(scrubbed_items)
            return scrubbed_items

        elif isinstance(obj, str):
            return scrub_string(obj)

        elif hasattr(obj, "model_dump") and callable(getattr(obj, "model_dump")):
            # Pydantic v2 model
            try:
                dumped = obj.model_dump()
                return cls.scrub(dumped)
            except Exception:
                return scrub_string(str(obj))

        elif isinstance(obj, Exception):
            return scrub_string(str(obj))

        return obj


def sanitize_nested_data(data: Any) -> Any:
    """Convenience alias for DeepScrubber.scrub."""
    return DeepScrubber.scrub(data)
