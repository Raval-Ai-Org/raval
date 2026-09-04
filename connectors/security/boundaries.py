"""
Security Boundary Enforcement Subsystem (Task 11 Step 6).

Rejects dangerous operations, injection attempts, and unauthorized targets:
1. Path traversal attacks (../, ..\\, /etc/passwd, C:\\Windows).
2. Shell injection and code execution (eval, exec, __import__, PHP/JS injections).
3. Dangerous file extensions and prohibited binary / script files.
4. Protected workflow and system configuration files.
"""

from __future__ import annotations

import os
import re
from typing import Any

from connectors.base.errors import ConnectorValidationError, UnsupportedOperationError


# Prohibited shell command sequences and execution tokens
DANGEROUS_COMMAND_TOKENS: tuple[str, ...] = (
    ";",
    "&&",
    "||",
    "|",
    "`",
    "$(",
    "<script",
    "</script>",
    "<?php",
    "<?=",
    "eval(",
    "exec(",
    "system(",
    "passthru(",
    "shell_exec(",
    "popen(",
    "proc_open(",
    "__import__",
    "os.system",
    "subprocess.",
    "rm -rf",
    "sudo",
    "chmod",
    "chown",
    "drop table",
    "drop database",
    "truncate table",
)

# Prohibited file extensions for content / meta fix proposals
DISALLOWED_FILE_EXTENSIONS: tuple[str, ...] = (
    ".exe",
    ".dll",
    ".so",
    ".bin",
    ".sh",
    ".bash",
    ".bat",
    ".cmd",
    ".ps1",
    ".vbs",
    ".php",
    ".phtml",
    ".php3",
    ".php4",
    ".php5",
    ".phar",
    ".py",
    ".rb",
    ".pl",
    ".cgi",
)

# Protected files and paths requiring strict elevation
PROTECTED_PATHS: tuple[str, ...] = (
    ".github/workflows",
    ".gitlab-ci.yml",
    ".circleci",
    "wp-config.php",
    "wp-settings.php",
    ".env",
    ".htaccess",
    "web.config",
    "/etc/",
    "/var/",
    "/usr/",
    "/bin/",
    "/sbin/",
    "C:\\Windows",
    "C:\\Program Files",
)


class SecurityBoundaryValidator:
    """
    Validates resource paths, filenames, and change payloads against injection and traversal attacks.
    """

    @classmethod
    def validate_resource_path(cls, path: str, allow_workflows: bool = False) -> str:
        """
        Validates that a resource path does not contain path traversal,
        absolute system paths, dangerous characters, or prohibited extensions.
        """
        if not path or not isinstance(path, str):
            raise ConnectorValidationError("Resource path cannot be empty")

        clean_path = path.strip()

        # 1. Path traversal check
        if ".." in clean_path or clean_path.startswith("/") or clean_path.startswith("\\"):
            # If path starts with / but is a standard URL path like /about or /contact, normalize it
            if not clean_path.startswith("//") and not ".." in clean_path:
                pass
            else:
                raise ConnectorValidationError(
                    message=f"Path traversal detected in resource path: '{path}'",
                    details={"path": path},
                )

        if ".." in clean_path.replace("\\", "/"):
            raise ConnectorValidationError(
                message=f"Path traversal sequence '..' prohibited in resource path: '{path}'",
                details={"path": path},
            )

        # 2. Dangerous shell / injection tokens
        path_lower = clean_path.lower()
        for token in DANGEROUS_COMMAND_TOKENS:
            if token in path_lower:
                raise ConnectorValidationError(
                    message=f"Dangerous token '{token}' prohibited in resource path: '{path}'",
                    details={"path": path, "token": token},
                )

        # 3. Protected system and CI/CD configuration paths
        for protected in PROTECTED_PATHS:
            if protected.lower() in path_lower:
                if protected == ".github/workflows" and allow_workflows:
                    continue
                raise ConnectorValidationError(
                    message=f"Target path '{path}' touches protected system file or path '{protected}'",
                    details={"path": path, "protected_path": protected},
                )

        # 4. Prohibited file extensions
        _, ext = os.path.splitext(clean_path)
        if ext and ext.lower() in DISALLOWED_FILE_EXTENSIONS:
            raise UnsupportedOperationError(
                message=f"Prohibited file extension '{ext}' for safe fix execution",
                details={"path": path, "extension": ext},
            )

        return clean_path

    @classmethod
    def validate_content_payload(cls, content: str | None, resource_type: str = "website_page") -> str | None:
        """
        Validates that injected content does not contain dangerous PHP/shell execution payloads.
        """
        if content is None:
            return None

        content_lower = content.lower()

        # Check for PHP code tags if target is not explicitly raw code
        if "<?php" in content_lower or "<%=" in content_lower or "<?" in content_lower:
            # Check for executable php opening tag
            if re.search(r"<\?(php|=)", content_lower):
                raise ConnectorValidationError(
                    message="Prohibited executable PHP code payload in content mutation",
                    details={"resource_type": resource_type},
                )

        # Check for arbitrary command execution tokens in text
        for token in ("eval(", "exec(", "system(", "passthru(", "shell_exec("):
            if token in content_lower:
                raise ConnectorValidationError(
                    message=f"Prohibited executable function call '{token}' in content mutation",
                    details={"token": token},
                )

        return content
