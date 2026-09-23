from __future__ import annotations

import csv
import hashlib
import json
import os
import shutil
import tempfile
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Iterable

from . import exiftool
from .config import resolved_ownership, validate_config


SUPPORTED = {".webp", ".jpg", ".jpeg", ".png"}
PRIVATE_TAG_NAMES = {
    "make",
    "model",
    "cameraserialnumber",
    "serialnumber",
    "internalserialnumber",
    "ownername",
    "artist",
    "copyright",
    "lens",
    "lensid",
    "lensmodel",
    "lensserialnumber",
    "software",
    "hostcomputer",
    "devicemanufacturer",
    "devicemodel",
    "gpslatitude",
    "gpslongitude",
    "gpsaltitude",
    "gpsposition",
    "gpscoordinates",
    "gpsdatetime",
    "gpsdatestamp",
    "gpsspeed",
    "gpsimgdirection",
    "usercomment",
    "comment",
}
PROVENANCE_TERMS = ("c2pa", "jumbf", "contentcredential", "content credential")
CONTENT_TAGS = ["-XMP-dc:Title", "-XMP-dc:Description", "-XMP-dc:Subject"]
OWNERSHIP_TAGS = [
    "-XMP-dc:Creator",
    "-XMP-dc:Publisher",
    "-XMP-dc:Rights",
    "-XMP-photoshop:Credit",
    "-XMP-iptcCore:CreatorWorkURL",
    "-XMP-xmpRights:Marked",
]


class ToolkitError(RuntimeError):
    pass


@dataclass
class Finding:
    file: str
    status: str
    format: str = ""
    creator: str = ""
    publisher: str = ""
    title: str = ""
    description: str = ""
    subjects: str = ""
    rights: str = ""
    credit: str = ""
    creator_url: str = ""
    marked: str = ""
    private_tags: str = ""
    provenance_tags: str = ""
    output: str = ""
    detail: str = ""


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def discover(raw_paths: Iterable[str]) -> list[Path]:
    files: dict[Path, None] = {}
    for raw in raw_paths:
        path = Path(raw).expanduser().resolve()
        if path.is_file():
            if path.suffix.lower() not in SUPPORTED:
                raise ToolkitError(f"Unsupported image format: {path}")
            files[path] = None
        elif path.is_dir():
            for child in path.rglob("*"):
                if child.is_file() and child.suffix.lower() in SUPPORTED:
                    files[child.resolve()] = None
        else:
            raise ToolkitError(f"Path not found: {path}")
    if not files:
        raise ToolkitError("No WebP, JPEG/JPG, or PNG files were found.")
    return sorted(files, key=lambda item: str(item).casefold())


def _bare_tag(key: str) -> str:
    return key.split("]", 1)[-1].replace(" ", "").lower()


def privacy_findings(metadata: dict[str, object]) -> list[str]:
    findings: list[str] = []
    for key, value in metadata.items():
        bare = _bare_tag(key)
        group = key[1:].split("]", 1)[0].lower() if key.startswith("[") else ""
        is_gps = group.startswith("gps") or bare.startswith("gps")
        if (is_gps or bare in PRIVATE_TAG_NAMES) and value not in (None, "", [], {}):
            findings.append(key)
    return sorted(set(findings), key=str.casefold)


def provenance_findings(metadata: dict[str, object]) -> list[str]:
    findings: list[str] = []
    for key in metadata:
        searchable = key.lower()
        group = key[1:].split("]", 1)[0].lower() if key.startswith("[") else ""
        if group == "cai" or any(term in searchable for term in PROVENANCE_TERMS):
            findings.append(key)
    return sorted(set(findings), key=str.casefold)


def rendering_signature(path: Path) -> tuple[object, object, object]:
    row = exiftool.read_json(path, ["-ImageWidth", "-ImageHeight", "-ImageDataHash"])
    signature = (row.get("ImageWidth"), row.get("ImageHeight"), row.get("ImageDataHash"))
    if any(value in (None, "") for value in signature):
        raise ToolkitError(f"Could not verify rendering data for {path.name}")
    return signature


def _display(value: object) -> str:
    if isinstance(value, list):
        return " | ".join(str(item) for item in value)
    if isinstance(value, bool):
        return "True" if value else "False"
    return "" if value is None else str(value)


def inspect_file(path: Path) -> Finding:
    all_metadata = exiftool.read_json(path, grouped=True)
    selected = exiftool.read_json(path, [*OWNERSHIP_TAGS, *CONTENT_TAGS, "-FileType"])
    return Finding(
        file=str(path),
        status="AUDITED",
        format=_display(selected.get("FileType")),
        creator=_display(selected.get("Creator")),
        publisher=_display(selected.get("Publisher")),
        title=_display(selected.get("Title")),
        description=_display(selected.get("Description")),
        subjects=_display(selected.get("Subject")),
        rights=_display(selected.get("Rights")),
        credit=_display(selected.get("Credit")),
        creator_url=_display(selected.get("CreatorWorkURL")),
        marked=_display(selected.get("Marked")),
        private_tags=" | ".join(privacy_findings(all_metadata)),
        provenance_tags=" | ".join(provenance_findings(all_metadata)),
    )


def _content_values(path: Path, config: dict[str, object]) -> tuple[str, str, list[str]]:
    existing = exiftool.read_json(path, CONTENT_TAGS)
    section = config["content"]
    assert isinstance(section, dict)
    preserve = bool(section["preserve_existing_when_blank"])
    title = str(section["title"]).strip()
    description = str(section["description"]).strip()
    subjects = [str(item).strip() for item in section["subjects"] if str(item).strip()]
    if preserve:
        title = title or _display(existing.get("Title"))
        description = description or _display(existing.get("Description"))
        if not subjects:
            value = existing.get("Subject")
            subjects = [str(item) for item in value] if isinstance(value, list) else ([str(value)] if value else [])
    return title, description, subjects


def _write_arguments(path: Path, config: dict[str, object]) -> tuple[list[str], dict[str, object]]:
    ownership = resolved_ownership(config)
    title, description, subjects = _content_values(path, config)
    privacy = config["privacy_cleanup"]
    rendering = config["rendering_preservation"]
    assert isinstance(privacy, dict) and isinstance(rendering, dict)

    arguments: list[str] = []
    if privacy["enabled"]:
        arguments.append("-all=")
        if rendering["enabled"]:
            arguments.extend(["-tagsfromfile", "@", "-ColorSpaceTags", "-Orientation"])

    arguments.extend(
        [
            f"-XMP-dc:Creator={ownership['creator']}",
            f"-XMP-dc:Publisher={ownership['publisher']}",
            f"-XMP-dc:Rights={ownership['rights_notice']}",
            f"-XMP-photoshop:Credit={ownership['credit']}",
            f"-XMP-iptcCore:CreatorWorkURL={ownership['website_url']}",
            f"-XMP-xmpRights:Marked={'True' if ownership['marked'] else 'False'}",
        ]
    )
    if title:
        arguments.append(f"-XMP-dc:Title={title}")
    if description:
        arguments.append(f"-XMP-dc:Description={description}")
    if subjects:
        arguments.append("-XMP-dc:Subject=")
        arguments.extend(f"-XMP-dc:Subject+={subject}" for subject in subjects)
    expected = {
        "Creator": ownership["creator"],
        "Publisher": ownership["publisher"],
        "Rights": ownership["rights_notice"],
        "Credit": ownership["credit"],
        "CreatorWorkURL": ownership["website_url"],
        "Marked": bool(ownership["marked"]),
        "Title": title,
        "Description": description,
        "Subject": subjects,
    }
    return arguments, expected


def _verify_output(
    path: Path,
    config: dict[str, object],
    expected: dict[str, object],
    original_signature: tuple[object, object, object],
) -> Finding:
    selected = exiftool.read_json(path, [*OWNERSHIP_TAGS, *CONTENT_TAGS, "-FileType"])
    mismatches: list[str] = []
    for key in ("Creator", "Publisher", "Rights", "Credit", "CreatorWorkURL", "Marked"):
        if selected.get(key) != expected[key]:
            mismatches.append(key)
    for key in ("Title", "Description"):
        if expected[key] and selected.get(key) != expected[key]:
            mismatches.append(key)
    if expected["Subject"]:
        actual = selected.get("Subject")
        actual_list = actual if isinstance(actual, list) else ([actual] if actual else [])
        if actual_list != expected["Subject"]:
            mismatches.append("Subject")

    rendering = config["rendering_preservation"]
    privacy = config["privacy_cleanup"]
    assert isinstance(rendering, dict) and isinstance(privacy, dict)
    if rendering["enabled"] and rendering_signature(path) != original_signature:
        mismatches.append("rendering-signature")
    private = privacy_findings(exiftool.read_json(path, grouped=True))
    if privacy["enabled"] and private:
        mismatches.append("private-metadata")
    status = "PASS" if not mismatches else "FAIL"
    return Finding(
        file=str(path),
        status=status,
        format=_display(selected.get("FileType")),
        creator=_display(selected.get("Creator")),
        publisher=_display(selected.get("Publisher")),
        title=_display(selected.get("Title")),
        description=_display(selected.get("Description")),
        subjects=_display(selected.get("Subject")),
        rights=_display(selected.get("Rights")),
        credit=_display(selected.get("Credit")),
        creator_url=_display(selected.get("CreatorWorkURL")),
        marked=_display(selected.get("Marked")),
        private_tags=" | ".join(private),
        detail="" if not mismatches else f"Verification mismatches: {', '.join(mismatches)}",
    )


def clean_file(
    source: Path,
    destination: Path,
    config: dict[str, object],
    *,
    dry_run: bool,
    overwrite: bool,
) -> Finding:
    validate_config(config, require_ownership=True)
    source_hash = sha256(source)
    source_stat = source.stat()
    audit = inspect_file(source)
    if audit.provenance_tags and config["provenance_policy"] == "preserve":
        audit.status = "SKIPPED_PROVENANCE"
        audit.detail = (
            "Signed provenance or Content Credentials were detected. The default preserve policy "
            "refuses metadata changes because they may invalidate the credential."
        )
        return audit
    if dry_run:
        audit.status = "DRY_RUN"
        audit.output = str(destination)
        return audit
    if destination.exists() and not overwrite:
        audit.status = "FAIL"
        audit.output = str(destination)
        audit.detail = "Destination exists; rerun with --overwrite to replace it atomically."
        return audit
    if source == destination.resolve(strict=False):
        raise ToolkitError("Output must differ from the source; in-place writes are intentionally unsupported.")

    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="imt-lite-") as directory:
        candidate = Path(directory) / source.name
        shutil.copy2(source, candidate)
        signature = rendering_signature(source)
        arguments, expected = _write_arguments(candidate, config)
        exiftool.write(candidate, arguments)
        result = _verify_output(candidate, config, expected, signature)
        result.file = str(source)
        result.output = str(destination)
        if result.status != "PASS":
            return result
        descriptor, temporary_name = tempfile.mkstemp(prefix=f".{destination.name}.imt-", dir=destination.parent)
        os.close(descriptor)
        temporary = Path(temporary_name)
        try:
            shutil.copy2(candidate, temporary)
            if sha256(temporary) != sha256(candidate):
                raise ToolkitError(f"Atomic output copy verification failed for {source.name}")
            os.replace(temporary, destination)
        finally:
            temporary.unlink(missing_ok=True)

    after = source.stat()
    if (
        after.st_size != source_stat.st_size
        or after.st_mtime_ns != source_stat.st_mtime_ns
        or sha256(source) != source_hash
    ):
        raise ToolkitError(f"Source changed unexpectedly: {source}")
    return result


def verify_file(path: Path, config: dict[str, object]) -> Finding:
    validate_config(config, require_ownership=True)
    ownership = resolved_ownership(config)
    selected = exiftool.read_json(path, [*OWNERSHIP_TAGS, *CONTENT_TAGS, "-FileType"])
    expected = {
        "Creator": ownership["creator"],
        "Publisher": ownership["publisher"],
        "Rights": ownership["rights_notice"],
        "Credit": ownership["credit"],
        "CreatorWorkURL": ownership["website_url"],
        "Marked": bool(ownership["marked"]),
    }
    mismatches = [key for key, value in expected.items() if selected.get(key) != value]
    privacy = config["privacy_cleanup"]
    assert isinstance(privacy, dict)
    private = privacy_findings(exiftool.read_json(path, grouped=True))
    if privacy["enabled"] and private:
        mismatches.append("private-metadata")
    return Finding(
        file=str(path),
        status="PASS" if not mismatches else "FAIL",
        format=_display(selected.get("FileType")),
        creator=_display(selected.get("Creator")),
        publisher=_display(selected.get("Publisher")),
        title=_display(selected.get("Title")),
        description=_display(selected.get("Description")),
        subjects=_display(selected.get("Subject")),
        rights=_display(selected.get("Rights")),
        credit=_display(selected.get("Credit")),
        creator_url=_display(selected.get("CreatorWorkURL")),
        marked=_display(selected.get("Marked")),
        private_tags=" | ".join(private),
        provenance_tags=" | ".join(provenance_findings(exiftool.read_json(path, grouped=True))),
        detail="" if not mismatches else f"Verification mismatches: {', '.join(mismatches)}",
    )


def write_report(findings: list[Finding], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    rows = [asdict(finding) for finding in findings]
    if path.suffix.lower() == ".csv":
        with path.open("w", newline="", encoding="utf-8") as handle:
            writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
            writer.writeheader()
            writer.writerows(rows)
    else:
        path.write_text(json.dumps(rows, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
