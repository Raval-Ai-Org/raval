"""
Baseline & Before-After Evidence Models and Immutable Store (Task 12 Step 3).

Defines machine-readable, auditable evidence models for capturing immutable baseline (BEFORE)
and post-remediation (AFTER) snapshots with full provenance tracking:
resource -> observation -> rule/finding -> execution -> timestamp
"""

from __future__ import annotations

import hashlib
import logging
import threading
from datetime import datetime, timezone
from enum import Enum
from typing import Any
from pydantic import BaseModel, ConfigDict, Field

from app.page_extractor import ExtractionResult
from connectors.base.security import redact_secrets_from_string

logger = logging.getLogger(__name__)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _compute_hash(text: str | bytes | None) -> str:
    if not text:
        return "none"
    b = text.encode("utf-8") if isinstance(text, str) else text
    return hashlib.sha256(b).hexdigest()[:16]


class EvidenceState(str, Enum):
    """Lifecycle state of measurement evidence."""

    BEFORE = "BEFORE"
    AFTER = "AFTER"


class ResourceObservation(BaseModel):
    """
    Normalized, compact observation of an individual resource or page.
    Captures technical, structural, and semantic signals without duplicating massive payloads.
    """

    model_config = ConfigDict(extra="ignore")

    http_status: int = Field(default=200, description="HTTP status code")
    title: str | None = Field(default=None, description="Document title tag content")
    title_length: int = Field(default=0, description="Title character length")
    meta_description: str | None = Field(default=None, description="Meta description content")
    meta_description_length: int = Field(default=0, description="Meta description character length")
    canonical_url: str | None = Field(default=None, description="Canonical link href target")
    canonical_self_referencing: bool = Field(default=True, description="True if canonical matches resource URL")
    robots_directives: list[str] = Field(default_factory=list, description="Meta robots or X-Robots-Tag directives")
    is_indexable: bool = Field(default=True, description="True if noindex directive is absent")
    h1_count: int = Field(default=1, description="Count of H1 tags on page")
    h1_tags: list[str] = Field(default_factory=list, description="Extracted H1 tag text contents")
    heading_hierarchy_valid: bool = Field(default=True, description="True if no heading levels were skipped")
    structured_data_types: list[str] = Field(default_factory=list, description="Schema.org @type values detected")
    structured_data_valid: bool = Field(default=True, description="True if structured data parsed without error")
    missing_image_alts_count: int = Field(default=0, description="Count of images missing alt attributes")
    broken_links_count: int = Field(default=0, description="Count of broken/404 internal link targets")
    aeo_direct_answer_present: bool = Field(default=False, description="True if concise direct answer block is detected")
    content_hash: str = Field(default="none", description="SHA-256 compact hash of text/DOM content")
    content_word_count: int = Field(default=0, description="Extracted visible body word count")
    raw_summary: dict[str, Any] = Field(default_factory=dict, description="Compact summary of raw metadata")


def capture_observation_from_extraction(
    extracted: ExtractionResult | None,
    page_url: str,
    status_code: int = 200,
    raw_html: str | None = None,
) -> ResourceObservation:
    """
    Constructs a deterministic ResourceObservation from an ExtractionResult and optional raw HTML.
    """
    if extracted is None:
        return ResourceObservation(
            http_status=status_code,
            title=None,
            title_length=0,
            meta_description=None,
            meta_description_length=0,
            canonical_url=None,
            canonical_self_referencing=False,
            robots_directives=[],
            is_indexable=False,
            h1_count=0,
            h1_tags=[],
            heading_hierarchy_valid=False,
            structured_data_types=[],
            structured_data_valid=False,
            missing_image_alts_count=0,
            broken_links_count=0,
            aeo_direct_answer_present=False,
            content_hash=_compute_hash(raw_html),
            content_word_count=0,
            raw_summary={"error": "extraction_unavailable"},
        )

    # Resolve Title
    title_text = extracted.title_text or None
    if title_text:
        title_text = redact_secrets_from_string(title_text)
    title_len = len(title_text) if title_text else 0

    # Resolve Meta Description
    meta_desc = None
    if extracted.meta_descriptions and extracted.meta_descriptions[0].text:
        meta_desc = redact_secrets_from_string(extracted.meta_descriptions[0].text)
    desc_len = len(meta_desc) if meta_desc else 0

    # Resolve Canonical
    canon_url = None
    self_ref = True
    if extracted.canonicals:
        primary_canon = extracted.canonicals[0]
        canon_url = primary_canon.url
        self_ref = primary_canon.self_reference

    # Resolve Robots & Indexability
    robots = []
    is_index = True
    if extracted.robots:
        if extracted.robots.noindex:
            robots.append("noindex")
            is_index = False
        elif extracted.robots.index:
            robots.append("index")
        if extracted.robots.nofollow:
            robots.append("nofollow")
        elif extracted.robots.follow:
            robots.append("follow")
        if extracted.robots.other_directives:
            robots.extend(extracted.robots.other_directives)

    # Resolve Headings
    h1_list = [h.text for h in extracted.headings if h.level == 1 and h.text]
    h1_cnt = extracted.h1_count
    hierarchy_ok = not extracted.heading_hierarchy_issue

    # Resolve Structured Data
    sd_types = []
    sd_valid = True
    if extracted.structured_data:
        for sd in extracted.structured_data:
            if sd.types:
                sd_types.extend(sd.types)
            if sd.parse_error:
                sd_valid = False

    # Resolve Images & Links
    missing_alts = 0
    if extracted.images:
        missing_alts = extracted.images_without_alt or sum(
            1 for img in extracted.images if img.alt_missing or img.alt_empty or not img.alt
        )

    broken_links = 0
    if extracted.links:
        broken_links = sum(1 for link in extracted.links if "404" in (link.destination_url or ""))

    # Resolve AEO Direct Answer Block
    aeo_present = False
    if raw_html and ("data-aeo-answer" in raw_html or 'class="direct-answer' in raw_html):
        aeo_present = True

    # Word count & hash
    word_count = extracted.word_count or (len(extracted.clean_text.split()) if extracted.clean_text else 0)
    c_hash = _compute_hash(raw_html or extracted.clean_text)

    return ResourceObservation(
        http_status=status_code,
        title=title_text,
        title_length=title_len,
        meta_description=meta_desc,
        meta_description_length=desc_len,
        canonical_url=canon_url,
        canonical_self_referencing=self_ref,
        robots_directives=robots,
        is_indexable=is_index,
        h1_count=h1_cnt,
        h1_tags=h1_list,
        heading_hierarchy_valid=hierarchy_ok,
        structured_data_types=sd_types,
        structured_data_valid=sd_valid,
        missing_image_alts_count=missing_alts,
        broken_links_count=broken_links,
        aeo_direct_answer_present=aeo_present,
        content_hash=c_hash,
        content_word_count=word_count,
        raw_summary={
            "page_url": page_url,
            "title_present": extracted.title_present,
            "canonical_present": extracted.canonical_present,
            "h1_count": h1_cnt,
            "structured_data_count": len(extracted.structured_data),
        },
    )


class MeasurementSnapshot(BaseModel):
    """
    Immutable measurement snapshot representing baseline (BEFORE) or post-remediation (AFTER) state.
    """

    model_config = ConfigDict(extra="ignore", frozen=True)

    evidence_id: str = Field(..., description="Unique deterministic identifier (e.g. ev_before_1234abcd)")
    execution_id: str = Field(..., description="Pipeline execution trace ID")
    stage_execution_id: str | None = Field(default=None, description="Stage trace ID where captured")
    site_id: str = Field(default="default_site", description="Website or site identity")
    resource_url: str = Field(..., description="Full canonical URL of the resource")
    target_resource: str = Field(..., description="Target slug or relative path (e.g. /about.html, page:101)")
    captured_at: datetime = Field(default_factory=_utc_now, description="UTC timestamp of capture")
    evidence_state: EvidenceState = Field(..., description="BEFORE or AFTER")
    observation: ResourceObservation = Field(..., description="Structured resource observation")
    applicable_finding_ids: list[str] = Field(default_factory=list, description="IDs of findings applicable to resource")
    applicable_rule_ids: list[str] = Field(default_factory=list, description="Rule codes triggered on resource")
    overall_score: float = Field(default=100.0, description="Overall model score at capture time")
    category_scores: dict[str, float] = Field(default_factory=dict, description="Category-level scores at capture time")
    fix_plan_id: str | None = Field(default=None, description="Associated fix-plan ID if available")
    provenance_ref: dict[str, Any] = Field(default_factory=dict, description="Traceable provenance lineage")


class EvidenceStore:
    """
    Thread-safe in-memory store for immutable MeasurementSnapshots.
    Enforces that historical baseline and after records cannot be overwritten.
    """

    def __init__(self) -> None:
        self._snapshots: dict[str, MeasurementSnapshot] = {}
        self._lock = threading.Lock()

    def record_snapshot(self, snapshot: MeasurementSnapshot) -> None:
        """
        Records a snapshot. Raises ValueError if the evidence_id already exists to enforce immutability.
        """
        with self._lock:
            if snapshot.evidence_id in self._snapshots:
                raise ValueError(
                    f"Immutability violation: evidence snapshot with ID '{snapshot.evidence_id}' already exists and cannot be overwritten."
                )
            self._snapshots[snapshot.evidence_id] = snapshot

    def get_snapshot(self, evidence_id: str) -> MeasurementSnapshot | None:
        with self._lock:
            return self._snapshots.get(evidence_id)

    def get_baseline(self, execution_id: str, resource_url: str) -> MeasurementSnapshot | None:
        with self._lock:
            for s in self._snapshots.values():
                if (
                    s.execution_id == execution_id
                    and s.resource_url == resource_url
                    and s.evidence_state == EvidenceState.BEFORE
                ):
                    return s
            return None

    def get_after(self, execution_id: str, resource_url: str) -> MeasurementSnapshot | None:
        with self._lock:
            for s in self._snapshots.values():
                if (
                    s.execution_id == execution_id
                    and s.resource_url == resource_url
                    and s.evidence_state == EvidenceState.AFTER
                ):
                    return s
            return None

    def list_snapshots(self, execution_id: str | None = None) -> list[MeasurementSnapshot]:
        with self._lock:
            if execution_id:
                return [s for s in self._snapshots.values() if s.execution_id == execution_id]
            return list(self._snapshots.values())

    def clear(self) -> None:
        with self._lock:
            self._snapshots.clear()


# Global Singleton Evidence Store
_GLOBAL_EVIDENCE_STORE = EvidenceStore()


def get_evidence_store() -> EvidenceStore:
    """Returns the singleton master EvidenceStore."""
    return _GLOBAL_EVIDENCE_STORE
