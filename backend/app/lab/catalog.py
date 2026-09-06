"""
Centralized Defect Catalog & Expected State Manager (Task 12 Step 1).

Provides machine-readable access, filtering, serialization, and verification utilities
for all test fixtures and intentional defects across the Controlled Site Lab.
"""

from __future__ import annotations

import json
from typing import Any

from .fixtures.dynamic_site import build_dynamic_site_fixture
from .fixtures.server_rendered_site import build_server_rendered_fixture
from .fixtures.static_site import build_static_site_fixture
from .fixtures.wordpress_site import build_wordpress_fixture
from .models import (
    DefectCategory,
    IntentionalDefect,
    LabCatalog,
    LabFixtureConfig,
    LabFixtureType,
)


def build_default_catalog() -> LabCatalog:
    """Constructs and returns the master LabCatalog containing all 4 registered lab fixtures."""
    fixtures: dict[str, LabFixtureConfig] = {
        "static_site_01": build_static_site_fixture(),
        "server_rendered_site_01": build_server_rendered_fixture(),
        "dynamic_browser_site_01": build_dynamic_site_fixture(),
        "wordpress_site_01": build_wordpress_fixture(),
    }
    return LabCatalog(version="1.0.0", fixtures=fixtures)


# Module-level cached master catalog
_MASTER_CATALOG: LabCatalog | None = None


def get_lab_catalog(fresh: bool = False) -> LabCatalog:
    """Returns the master LabCatalog instance."""
    global _MASTER_CATALOG
    if fresh or _MASTER_CATALOG is None:
        _MASTER_CATALOG = build_default_catalog()
    return _MASTER_CATALOG


def get_fixture(fixture_id: str) -> LabFixtureConfig | None:
    """Retrieves a specific fixture configuration by its fixture_id."""
    return get_lab_catalog().get_fixture(fixture_id)


def get_all_fixtures() -> list[LabFixtureConfig]:
    """Retrieves all registered fixtures."""
    return list(get_lab_catalog().fixtures.values())


def get_fixtures_by_type(fixture_type: LabFixtureType) -> list[LabFixtureConfig]:
    """Filters fixtures by their archetype."""
    return [f for f in get_all_fixtures() if f.fixture_type == fixture_type]


def get_all_defects() -> list[IntentionalDefect]:
    """Retrieves all intentional defects across all fixtures."""
    return get_lab_catalog().get_all_defects()


def get_defect(defect_id: str) -> IntentionalDefect | None:
    """Finds a specific intentional defect by defect_id."""
    return get_lab_catalog().get_defect(defect_id)


def get_defects_by_category(category: DefectCategory) -> list[IntentionalDefect]:
    """Filters intentional defects by DefectCategory."""
    return get_lab_catalog().get_defects_by_category(category)


def get_defects_by_rule(rule_code: str) -> list[IntentionalDefect]:
    """Filters intentional defects by associated engine rule code."""
    return get_lab_catalog().get_defects_by_rule(rule_code)


def export_catalog_dict() -> dict[str, Any]:
    """Exports the entire master catalog as a clean dictionary."""
    return get_lab_catalog().model_dump()


def export_catalog_json(indent: int = 2) -> str:
    """Exports the master catalog as a machine-readable JSON string."""
    return json.dumps(export_catalog_dict(), indent=indent, default=str)


def load_catalog_json(json_data: str) -> LabCatalog:
    """Parses and validates a JSON string into a verified LabCatalog instance."""
    raw_dict = json.loads(json_data)
    return LabCatalog.model_validate(raw_dict)
