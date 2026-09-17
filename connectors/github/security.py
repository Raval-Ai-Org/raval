"""
GitHub Path, File Type, and Security Validation Subsystem (Task 11 Step 2).

Enforces strict security boundaries for GitHub repository operations:
1. Rejects path traversal, absolute paths, null bytes, and shell injection characters.
2. Protects sensitive files (CI/CD workflows, credentials, secrets, binary executables).
3. Protects default/production branches from direct mutation.
"""

from __future__ import annotations

import os
import posixpath
import re
from typing import Set

from connectors.base.errors import (
    AuthorizationError,
    InvalidResourceError,
)
from connectors.base.security import DANGEROUS_SHELL_PATTERNS

# Protected default branch names that may NEVER be targeted for direct write mutation
PROTECTED_BRANCH_NAMES: Set[str] = {
    "main",
    "master",
    "prod",
    "production",
    "release",
    "staging",
    "develop",
    "live",
}

# Denylisted file patterns & paths that may NEVER be modified by automated fixes
DENYLISTED_PATH_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"^\.github/(workflows|actions)/", re.IGNORECASE),
    re.compile(r"^\.circleci/", re.IGNORECASE),
    re.compile(r"^\.gitlab-ci\.ya?ml$", re.IGNORECASE),
    re.compile(r"^azure-pipelines\.ya?ml$", re.IGNORECASE),
    re.compile(r"^jenkinsfile.*$", re.IGNORECASE),
    re.compile(r"^\.git(/|$)", re.IGNORECASE),
    re.compile(r"(^|/)\.env(\..+)?$", re.IGNORECASE),
    re.compile(r"(^|/)(secrets?|credentials?)\.(ya?ml|json|toml|ini|env)$", re.IGNORECASE),
    re.compile(r"(^|/)(id_rsa|id_ed25519|id_ecdsa)(\..+)?$", re.IGNORECASE),
    re.compile(r"\.(pem|key|pkcs12|pfx|p12|p8|cer|crt)$", re.IGNORECASE),
    re.compile(r"\.(exe|dll|so|dylib|bin|sh|bash|zsh|bat|cmd|ps1|vbs|jar|class)$", re.IGNORECASE),
)

# Allowlisted extensions for SEO/AEO/GEO content & structure remediation
ALLOWLISTED_EXTENSIONS: Set[str] = {
    # Web & templates
    ".html",
    ".htm",
    ".php",
    ".jsx",
    ".tsx",
    ".vue",
    ".svelte",
    ".astro",
    ".liquid",
    ".twig",
    ".blade.php",
    ".ejs",
    ".hbs",
    # Content & metadata
    ".md",
    ".mdx",
    ".txt",
    ".json",
    ".xml",
    ".yaml",
    ".yml",
    ".rst",
    ".csv",
}

# Explicitly allowed root files without extensions or specific names
ALLOWLISTED_NAMED_FILES: Set[str] = {
    "robots.txt",
    "sitemap.xml",
    "schema.json",
    "manifest.json",
    "_redirects",
    "_headers",
}


def normalize_github_path(path: str) -> str:
    """
    Normalizes a repository-relative path to standard POSIX style without leading/trailing slashes.
    """
    if not path or not isinstance(path, str):
        raise InvalidResourceError("Repository path must be a non-empty string")

    # Replace backslashes with forward slashes
    clean = path.replace("\\", "/").strip()

    # Reject null bytes and encoded null bytes
    if "\x00" in clean or "%00" in clean.lower():
        raise InvalidResourceError("Path contains prohibited null byte character", details={"path": path})

    # Reject absolute paths (POSIX / or Windows drive C:)
    if clean.startswith("/") or re.match(r"^[A-Za-z]:", clean):
        raise InvalidResourceError("Absolute filesystem paths are prohibited", details={"path": path})

    # Reject shell metacharacters
    for dangerous in DANGEROUS_SHELL_PATTERNS:
        if dangerous in clean:
            raise InvalidResourceError(
                f"Path contains prohibited shell character sequence '{dangerous}'",
                details={"path": path},
            )

    # Normalize POSIX path
    normalized = posixpath.normpath(clean)

    # Check for path traversal attempts
    if normalized == ".." or normalized.startswith("../") or "/../" in f"/{normalized}/":
        raise InvalidResourceError(
            "Directory traversal (..) is prohibited",
            details={"path": path, "normalized": normalized},
        )

    # Remove leading ./ or / prefixes without stripping dot from dotfiles
    while normalized.startswith("./"):
        normalized = normalized[2:]
    while normalized.startswith("/"):
        normalized = normalized[1:]
    normalized = normalized.strip()

    if not normalized or normalized == ".":
        raise InvalidResourceError("Path resolves to repository root", details={"path": path})

    return normalized


def validate_github_path(path: str) -> str:
    """
    Validates that a path is syntactically safe and does not violate traversal or shell rules.
    Returns normalized path.
    """
    return normalize_github_path(path)


def is_safe_file_path(path: str) -> tuple[bool, str]:
    """
    Evaluates whether a target file path is safe for automated fix proposals.
    Returns (is_safe, reason).
    """
    norm_path = normalize_github_path(path)
    norm_lower = norm_path.lower()
    base_name = posixpath.basename(norm_lower)

    # 1. Check Denylist Patterns
    for pattern in DENYLISTED_PATH_PATTERNS:
        if pattern.search(norm_path):
            return False, f"Target path matches restricted security/infrastructure pattern: '{norm_path}'"

    # 2. Check Allowed Named Files
    if base_name in ALLOWLISTED_NAMED_FILES:
        return True, "File matches allowlisted web configuration asset"

    # 3. Check Allowed Extensions
    _, ext = posixpath.splitext(base_name)
    if ext in ALLOWLISTED_EXTENSIONS:
        return True, f"File extension '{ext}' is authorized for automated content remediation"

    # Compound extensions like .blade.php
    if norm_lower.endswith(".blade.php"):
        return True, "Compound extension '.blade.php' is authorized"

    return False, f"File type/extension '{ext or base_name}' is not in the authorized remediation allowlist"


def assert_safe_mutation_target(path: str, branch: str | None = None) -> str:
    """
    Enforces all safety checks on a target path and target branch before mutation.
    Raises InvalidResourceError or AuthorizationError if unsafe.
    """
    norm_path = validate_github_path(path)
    is_safe, reason = is_safe_file_path(norm_path)
    if not is_safe:
        raise AuthorizationError(
            message=f"Target file path is not authorized for automated mutation: {reason}",
            details={"path": norm_path, "reason": reason},
        )

    if branch:
        clean_branch = branch.strip().lower()
        if clean_branch in PROTECTED_BRANCH_NAMES:
            raise AuthorizationError(
                message=f"Direct mutations to protected branch '{branch}' are strictly prohibited",
                details={"branch": branch},
            )

    return norm_path


def validate_branch_name(branch: str) -> str:
    """
    Validates a Git branch name for invalid characters and security hazards.
    """
    if not branch or not isinstance(branch, str):
        raise InvalidResourceError("Branch name must be a non-empty string")

    clean_branch = branch.strip()

    # Git branch naming restrictions
    if (
        clean_branch.startswith("/")
        or clean_branch.endswith("/")
        or clean_branch.startswith(".")
        or clean_branch.endswith(".lock")
        or ".." in clean_branch
        or any(c in clean_branch for c in (" ", "~", "^", ":", "?", "*", "[", "\\", "@{"))
    ):
        raise InvalidResourceError(
            f"Invalid Git branch identifier: '{branch}'",
            details={"branch": branch},
        )

    return clean_branch
