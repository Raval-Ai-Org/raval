from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path


class ExifToolError(RuntimeError):
    pass


def executable() -> str:
    path = shutil.which("exiftool")
    if not path:
        raise ExifToolError(
            "ExifTool was not found. Install it from https://exiftool.org/ or with your package manager."
        )
    return path


def run(arguments: list[str], *, label: str) -> subprocess.CompletedProcess[str]:
    result = subprocess.run([executable(), *arguments], capture_output=True, text=True)
    if result.returncode:
        detail = (result.stderr or result.stdout or "unknown ExifTool error").strip()
        raise ExifToolError(f"{label}: {detail}")
    return result


def read_json(path: Path, tags: list[str] | None = None, *, grouped: bool = False) -> dict[str, object]:
    arguments = ["-j", "-s", "-api", "LargeFileSupport=1"]
    if grouped:
        arguments.extend(["-G1", "-a"])
    if tags:
        arguments.extend(tags)
    arguments.append(str(path))
    result = run(arguments, label=f"Could not inspect {path.name}")
    try:
        rows = json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise ExifToolError(f"ExifTool returned invalid JSON for {path.name}") from exc
    if len(rows) != 1 or not isinstance(rows[0], dict):
        raise ExifToolError(f"ExifTool did not return one result for {path.name}")
    return rows[0]


def write(path: Path, arguments: list[str]) -> None:
    run([*arguments, "-overwrite_original", "-P", str(path)], label=f"Could not write {path.name}")
