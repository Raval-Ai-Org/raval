from __future__ import annotations

import copy
import datetime as dt
import json
from pathlib import Path
from urllib.parse import urlparse


DEFAULT_CONFIG: dict[str, object] = {
    "ownership": {
        "creator": "",
        "publisher": "",
        "website_url": "",
        "rights_notice": "© {year} {creator}. All rights reserved.",
        "credit": "",
        "marked": True,
    },
    "content": {
        "title": "",
        "description": "",
        "subjects": [],
        "preserve_existing_when_blank": True,
    },
    "privacy_cleanup": {"enabled": True},
    "rendering_preservation": {"enabled": True},
    "provenance_policy": "preserve",
}


class ConfigError(ValueError):
    pass


def _merge(target: dict[str, object], source: dict[str, object]) -> dict[str, object]:
    for key, value in source.items():
        if isinstance(value, dict) and isinstance(target.get(key), dict):
            _merge(target[key], value)  # type: ignore[index]
        else:
            target[key] = value
    return target


def load_config(path: str | Path | None) -> dict[str, object]:
    config = copy.deepcopy(DEFAULT_CONFIG)
    if path is None:
        return config
    config_path = Path(path).expanduser()
    if not config_path.is_file():
        raise ConfigError(f"Configuration file not found: {config_path}")
    try:
        supplied = json.loads(config_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ConfigError(f"Invalid JSON configuration: {config_path}: {exc}") from exc
    if not isinstance(supplied, dict):
        raise ConfigError("Configuration root must be a JSON object.")
    return validate_config(_merge(config, supplied))


def validate_config(config: dict[str, object], *, require_ownership: bool = False) -> dict[str, object]:
    ownership = config.get("ownership")
    content = config.get("content")
    if not isinstance(ownership, dict) or not isinstance(content, dict):
        raise ConfigError("ownership and content must be JSON objects.")

    for key in ("creator", "publisher", "website_url", "rights_notice", "credit"):
        if not isinstance(ownership.get(key), str):
            raise ConfigError(f"ownership.{key} must be a string.")
    if not isinstance(ownership.get("marked"), bool):
        raise ConfigError("ownership.marked must be true or false.")
    if require_ownership:
        missing = [
            key
            for key in ("creator", "publisher", "website_url", "rights_notice", "credit")
            if not str(ownership.get(key, "")).strip()
        ]
        if missing:
            raise ConfigError(f"Required ownership settings are blank: {', '.join(missing)}")

    website = str(ownership.get("website_url", "")).strip()
    if website:
        parsed = urlparse(website)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            raise ConfigError("ownership.website_url must be an absolute HTTP(S) URL.")

    for key in ("title", "description"):
        if not isinstance(content.get(key), str):
            raise ConfigError(f"content.{key} must be a string.")
    subjects = content.get("subjects")
    if not isinstance(subjects, list) or not all(isinstance(item, str) for item in subjects):
        raise ConfigError("content.subjects must be an array of strings.")
    if not isinstance(content.get("preserve_existing_when_blank"), bool):
        raise ConfigError("content.preserve_existing_when_blank must be true or false.")

    for section in ("privacy_cleanup", "rendering_preservation"):
        value = config.get(section)
        if not isinstance(value, dict) or not isinstance(value.get("enabled"), bool):
            raise ConfigError(f"{section}.enabled must be true or false.")

    policy = config.get("provenance_policy")
    if policy not in {"preserve", "allow-metadata-change"}:
        raise ConfigError(
            "provenance_policy must be 'preserve' or 'allow-metadata-change'."
        )
    return config


def resolved_ownership(config: dict[str, object]) -> dict[str, object]:
    ownership = dict(config["ownership"])  # type: ignore[arg-type]
    creator = str(ownership["creator"]).strip()
    ownership["creator"] = creator
    ownership["publisher"] = str(ownership["publisher"]).strip()
    ownership["website_url"] = str(ownership["website_url"]).strip()
    ownership["credit"] = str(ownership["credit"]).strip()
    ownership["rights_notice"] = str(ownership["rights_notice"]).format(
        year=dt.datetime.now().year,
        creator=creator,
        publisher=ownership["publisher"],
        website_url=ownership["website_url"],
    )
    return ownership
