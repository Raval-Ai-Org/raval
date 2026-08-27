"""Shared helpers for the one-shot OAuth scripts.

The scripts store OAuth tokens into ``.env``. These helpers guarantee that
writing tokens NEVER destroys unrelated configuration. The earlier
implementations rewrote ``.env`` keeping only the script's own platform keys,
which silently wiped POSTGRES_*, SDE_API_TOKEN, FERNET_KEY, etc. and left the
app unable to boot.
"""

from __future__ import annotations

import os


def update_env_file(env_path: str, updates: dict[str, str]) -> None:
    """Update ``key=value`` pairs in a ``.env`` file, preserving all other lines.

    - Existing keys are replaced in place (preserving line order).
    - New keys are appended at the end of the file.
    - Comments and blank lines are preserved.
    - Values are written raw (no quoting), matching the rest of the file.

    Args:
        env_path: Path to the ``.env`` file (created if missing).
        updates: Mapping of variable name to new value.
    """
    lines: list[str] = []
    if os.path.isfile(env_path):
        with open(env_path) as f:
            lines = f.readlines()

    # Index existing assignment keys -> position (first occurrence wins).
    # Commented-out keys are intentionally not updated; a new active line
    # will be appended for them instead.
    key_index: dict[str, int] = {}
    for i, line in enumerate(lines):
        stripped = line.strip()
        if stripped and not stripped.startswith("#") and "=" in stripped:
            key = stripped.split("=", 1)[0].strip()
            if key and key not in key_index:
                key_index[key] = i

    for key, value in updates.items():
        if key in key_index:
            lines[key_index[key]] = f"{key}={value}\n"
        else:
            lines.append(f"{key}={value}\n")

    with open(env_path, "w") as f:
        f.writelines(lines)
