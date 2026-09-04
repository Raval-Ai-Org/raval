"""
Security & Credential Redaction Subsystem for Website Connectors (Task 11 Step 1 & Step 6).

Enforces strict safety invariants:
1. Zero credential or secret exposure in public models, logs, exception strings, or telemetry.
2. Protection against arbitrary command injection and unauthorized filesystem mutation.
3. Deep recursive sanitization of input payloads and metadata.
"""

from __future__ import annotations

import re
from typing import Any

# Sensitive dictionary keys to redact
SENSITIVE_KEY_PATTERNS: tuple[str, ...] = (
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
    "phpsessid",
    "credential",
    "credentials",
    "app_password",
    "application_password",
    "x-api-key",
    "x-auth-token",
)

# Common secret regex patterns (API keys, bearer tokens, private keys)
SECRET_REGEXES: tuple[re.Pattern[str], ...] = (
    re.compile(r"Bearer\s+([A-Za-z0-9_\-\.]{8,})", re.IGNORECASE),
    re.compile(r"Basic\s+([A-Za-z0-9+/=]{8,})", re.IGNORECASE),
    re.compile(r"gh[pousr]_[A-Za-z0-9]{36,}", re.IGNORECASE),
    re.compile(r"github_pat_[A-Za-z0-9_]{60,}", re.IGNORECASE),
    re.compile(r"sk-[A-Za-z0-9_-]{20,}", re.IGNORECASE),
    re.compile(r"AIzaSy[A-Za-z0-9_-]{33}", re.IGNORECASE),
    re.compile(r"(?:AKIA|ASIA)[0-9A-Z]{16}", re.IGNORECASE),
    re.compile(r"-----BEGIN [A-Z ]+ PRIVATE KEY-----[\s\S]*?-----END [A-Z ]+ PRIVATE KEY-----"),
    re.compile(r"\b[A-Za-z0-9]{4}\s+[A-Za-z0-9]{4}\s+[A-Za-z0-9]{4}\s+[A-Za-z0-9]{4}\b"),
    re.compile(
        r"(?:password|passwd|pwd|secret|api_key|token|auth_token|access_token|client_secret)\s*[:=]\s*['\"]?([^\s,;'\"]{3,})['\"]?",
        re.IGNORECASE,
    ),
    re.compile(r"(?:PHPSESSID|session_id|wordpress_logged_in_[a-f0-9]+)=([^;\s]+)", re.IGNORECASE),
    re.compile(r"([a-zA-Z][a-zA-Z0-9+\-.]*://)(?:[^:\s]+):(?:[^@\s]+)@([^\s/]+)", re.IGNORECASE),
)

# Suspicious / dangerous shell command tokens
DANGEROUS_SHELL_PATTERNS: tuple[str, ...] = (
    ";",
    "&&",
    "||",
    "|",
    "`",
    "$(",
    "<script",
    "rm -rf",
    "sudo",
    "chmod",
    "eval(",
    "exec(",
    "__import__",
)


def redact_sensitive_value(key: str, value: Any) -> Any:
    """
    Redacts a dictionary value if the key is recognized as sensitive.
    """
    key_lower = str(key).lower()
    for sensitive_key in SENSITIVE_KEY_PATTERNS:
        if sensitive_key in key_lower:
            return "[REDACTED]"
    return value


def sanitize_payload(obj: Any) -> Any:
    """
    Recursively redacts sensitive keys and values from dictionaries, lists, and strings.
    Safe for serializing into logs, errors, and metadata.
    """
    if isinstance(obj, dict):
        sanitized_dict: dict[str, Any] = {}
        for k, v in obj.items():
            k_str = str(k)
            k_lower = k_str.lower()
            if any(s_key in k_lower for s_key in SENSITIVE_KEY_PATTERNS):
                sanitized_dict[k_str] = "[REDACTED]"
            else:
                sanitized_dict[k_str] = sanitize_payload(v)
        return sanitized_dict
    elif isinstance(obj, (list, tuple, set)):
        items = [sanitize_payload(item) for item in obj]
        if isinstance(obj, tuple):
            return tuple(items)
        elif isinstance(obj, set):
            return set(items)
        return items
    elif isinstance(obj, str):
        return redact_secrets_from_string(obj)
    return obj


def redact_secrets_from_string(text: str) -> str:
    """
    Scans a string for known token/secret patterns and replaces them with [REDACTED].
    """
    if not text:
        return text
    sanitized = text

    for pattern in SECRET_REGEXES:
        if pattern.pattern.startswith("([a-zA-Z]"):
            sanitized = pattern.sub(r"\1[REDACTED]:[REDACTED]@\2", sanitized)
        elif pattern.groups > 0:
            def _replacer(match: re.Match[str]) -> str:
                full = match.group(0)
                secret_val = match.group(1)
                return full.replace(secret_val, "[REDACTED]")
            sanitized = pattern.sub(_replacer, sanitized)
        else:
            sanitized = pattern.sub("[REDACTED]", sanitized)
    return sanitized


def validate_safe_identifier(identifier: str, field_name: str = "identifier") -> str:
    """
    Ensures an identifier, path, or key does not contain arbitrary shell or injection tokens.
    """
    if not isinstance(identifier, str):
        raise ValueError(f"{field_name} must be a string")
    
    clean_id = identifier.strip()
    if not clean_id:
        raise ValueError(f"{field_name} cannot be empty")

    for dangerous in DANGEROUS_SHELL_PATTERNS:
        if dangerous in clean_id:
            raise ValueError(
                f"Security check failed: {field_name} contains prohibited character or sequence '{dangerous}'"
            )
    return clean_id
