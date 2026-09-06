"""
Controlled Site Lab - Models and Schemas (Task 12 Step 1).

Defines machine-readable data models for intentional defects, expected page states,
lab fixtures, and the centralized catalog for reproducible evaluation.
"""

from __future__ import annotations

from enum import Enum
from typing import Any
from pydantic import BaseModel, ConfigDict, Field


class DefectCategory(str, Enum):
    """Categorization of intentional SEO/AEO/GEO defects in test fixtures."""

    METADATA = "metadata"
    CANONICAL = "canonical"
    INDEXABILITY = "indexability"
    HEADINGS = "headings"
    STRUCTURED_DATA = "structured_data"
    LINKS = "links"
    REDIRECTS = "redirects"
    AEO_GEO = "aeo_geo"
    ACCESSIBILITY = "accessibility"
    PERFORMANCE = "performance"
    CONTENT = "content"


class DefectSeverity(str, Enum):
    """Severity tier for intentional defects."""

    CRITICAL = "critical"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"
    INFO = "info"


class IntentionalDefect(BaseModel):
    """
    Represents an explicitly engineered defect in a test fixture with known pre- and post-fix states.
    """

    model_config = ConfigDict(extra="ignore")

    defect_id: str = Field(..., description="Unique deterministic identifier (e.g. DEF-STATIC-001)")
    fixture_id: str = Field(..., description="ID of the parent lab fixture")
    category: DefectCategory = Field(..., description="Category of defect")
    severity: DefectSeverity = Field(..., description="Severity level")
    target_resource: str = Field(..., description="Target URL path, slug, or resource reference")
    rule_code: str = Field(..., description="Associated engine rule code (e.g. R-STR-01, TITLE_MISSING)")
    title: str = Field(..., description="Short descriptive title of the defect")
    description: str = Field(..., description="Detailed description of the engineered issue")
    raw_state: dict[str, Any] = Field(default_factory=dict, description="Observed defective state before fix")
    expected_fix: dict[str, Any] = Field(default_factory=dict, description="Expected remediation or mutation payload")
    expected_post_fix_state: dict[str, Any] = Field(
        default_factory=dict, description="Expected state after successful remediation"
    )
    is_browser_render_dependent: bool = Field(
        default=False, description="True if this defect/signal is only detectable after JS execution"
    )


class ExpectedPageState(BaseModel):
    """
    Ground-truth expected state for an individual page or resource within a lab fixture.
    """

    model_config = ConfigDict(extra="ignore")

    url_path: str = Field(..., description="Relative path or absolute URL of the resource")
    status_code: int = Field(default=200, description="Expected HTTP response status code")
    content_type: str = Field(default="text/html; charset=utf-8", description="Expected Content-Type header")
    title: str | None = Field(default=None, description="Expected page title (None if intentionally missing)")
    meta_description: str | None = Field(default=None, description="Expected meta description")
    canonical_url: str | None = Field(default=None, description="Expected canonical URL")
    robots_directives: list[str] = Field(default_factory=list, description="Expected meta robots directives")
    h1_headings: list[str] = Field(default_factory=list, description="Expected H1 heading texts")
    headings_hierarchy_valid: bool = Field(default=True, description="Whether heading hierarchy is strictly valid")
    structured_data_types: list[str] = Field(default_factory=list, description="Expected Schema.org types")
    structured_data_valid: bool = Field(default=True, description="Whether JSON-LD structured data is syntactically valid")
    internal_link_targets: list[str] = Field(default_factory=list, description="Expected internal link target URLs/paths")
    external_link_targets: list[str] = Field(default_factory=list, description="Expected external link target URLs")
    aeo_answer_blocks: list[str] = Field(default_factory=list, description="Expected direct answer snippets")
    intentional_defect_ids: list[str] = Field(default_factory=list, description="Defect IDs present on this page")
    is_client_rendered: bool = Field(default=False, description="True if content requires client-side JS rendering")


class LabFixtureType(str, Enum):
    """Supported lab fixture archetypes."""

    STATIC_HTML = "static_html"
    SERVER_RENDERED = "server_rendered"
    DYNAMIC_BROWSER = "dynamic_browser"
    WORDPRESS = "wordpress"


class LabFixtureConfig(BaseModel):
    """
    Configuration and content bundle for a complete test website fixture.
    """

    model_config = ConfigDict(extra="ignore")

    fixture_id: str = Field(..., description="Unique slug for the fixture (e.g. static_site_01)")
    name: str = Field(..., description="Human-readable name")
    fixture_type: LabFixtureType = Field(..., description="Fixture archetype")
    base_url: str = Field(..., description="Simulated or canonical base URL")
    description: str = Field(..., description="Summary of the fixture and its test purpose")
    resources: dict[str, ExpectedPageState] = Field(
        default_factory=dict, description="Mapping of path -> ExpectedPageState"
    )
    raw_html_pages: dict[str, str] = Field(
        default_factory=dict, description="Raw HTML string contents keyed by path"
    )
    rendered_html_pages: dict[str, str] = Field(
        default_factory=dict, description="Rendered DOM HTML string contents keyed by path (for dynamic fixtures)"
    )
    defects: list[IntentionalDefect] = Field(
        default_factory=list, description="List of all intentional defects in this fixture"
    )
    robots_txt: str | None = Field(default=None, description="robots.txt content")
    sitemap_xml: str | None = Field(default=None, description="sitemap.xml content")
    redirects: dict[str, tuple[int, str]] = Field(
        default_factory=dict, description="Mapping of path -> (status_code, target_path)"
    )


class LabCatalog(BaseModel):
    """
    Centralized catalog aggregating all test fixtures and intentional defects across the Controlled Site Lab.
    """

    model_config = ConfigDict(extra="ignore")

    version: str = Field(default="1.0.0", description="Lab catalog schema version")
    fixtures: dict[str, LabFixtureConfig] = Field(
        default_factory=dict, description="Mapping of fixture_id -> LabFixtureConfig"
    )

    def get_fixture(self, fixture_id: str) -> LabFixtureConfig | None:
        """Retrieves a fixture configuration by ID."""
        return self.fixtures.get(fixture_id)

    def get_all_defects(self) -> list[IntentionalDefect]:
        """Retrieves a flattened list of all intentional defects across all fixtures."""
        defects: list[IntentionalDefect] = []
        for fixture in self.fixtures.values():
            defects.extend(fixture.defects)
        return defects

    def get_defect(self, defect_id: str) -> IntentionalDefect | None:
        """Finds a specific defect by its unique defect_id."""
        for defect in self.get_all_defects():
            if defect.defect_id == defect_id:
                return defect
        return None

    def get_defects_by_category(self, category: DefectCategory) -> list[IntentionalDefect]:
        """Filters defects by category."""
        return [d for d in self.get_all_defects() if d.category == category]

    def get_defects_by_rule(self, rule_code: str) -> list[IntentionalDefect]:
        """Filters defects by associated engine rule code."""
        return [d for d in self.get_all_defects() if d.rule_code == rule_code]
