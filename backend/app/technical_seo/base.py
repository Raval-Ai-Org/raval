"""Core primitives for the technical-SEO rule engine.

Defines the finding DTO, the per-page and per-scan evidence contexts, the rule
metadata wrapper, and the registry/decorator used to declare rules.

Design note — **duck typing**: ``RuleContext`` and ``ScanContext`` accept both
the SQLAlchemy ORM objects (``PageResult`` + ``PageExtraction`` + child rows,
the production path) and the plain dataclasses returned by
``page_extractor.extract_html`` (``ExtractionResult`` + ``*Item``, the no-DB
verification path). The two shapes share field names, so every accessor here
uses ``getattr`` with safe defaults rather than importing either concrete type.
This lets the real-site verification script run the full engine on a freshly
fetched page without a database.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable, Iterable
from urllib.parse import urlparse

from ..page_extractor import _normalize_url
from .config import SEVERITY_OVERRIDES


# ---------------------------------------------------------------------------
# Finding DTO
# ---------------------------------------------------------------------------
@dataclass
class RuleFinding:
    """An in-memory finding produced by a rule.

    ``rule_id``/``category`` are stamped by the engine from the owning rule's
    metadata, so rule bodies don't repeat them. ``severity`` may be left None to
    inherit the rule's default, or set explicitly by a rule that escalates
    (e.g. a cross-page canonical that points at a broken target).
    """

    message: str
    observed_value: str | None = None
    expected_state: str | None = None
    reason: str | None = None
    recommendation: str | None = None
    evidence: dict[str, Any] = field(default_factory=dict)
    severity: str | None = None
    rule_id: str | None = None
    category: str | None = None


# ---------------------------------------------------------------------------
# Rule metadata + registry
# ---------------------------------------------------------------------------
CheckFn = Callable[["RuleContext"], Iterable[RuleFinding] | None]


@dataclass
class Rule:
    rule_id: str
    category: str
    severity: str
    name: str
    purpose: str
    check: CheckFn


RULE_REGISTRY: list[Rule] = []


def register(rule_id: str, category: str, severity: str, name: str, purpose: str):
    """Decorator that registers a rule function.

    The declared severity can be overridden centrally via
    ``config.SEVERITY_OVERRIDES`` without editing rule code.
    """

    def deco(fn: CheckFn) -> CheckFn:
        effective = SEVERITY_OVERRIDES.get(rule_id, severity)
        RULE_REGISTRY.append(
            Rule(
                rule_id=rule_id,
                category=category,
                severity=effective,
                name=name,
                purpose=purpose,
                check=fn,
            )
        )
        return fn

    return deco


# ---------------------------------------------------------------------------
# Text / URL helpers
# ---------------------------------------------------------------------------
def normalize_text(value: str | None) -> str | None:
    """Whitespace-collapse + lowercase for cross-page text comparison.

    Used only for duplicate title/description detection; URL comparison uses
    ``page_extractor._normalize_url`` instead.
    """
    if value is None:
        return None
    collapsed = " ".join(value.split()).lower()
    return collapsed or None


def is_http_url(value: str | None) -> bool:
    """True only for real http(s) URLs.

    Guards against the extractor labelling ``mailto:``/``tel:``/``javascript:``
    and scheme-less anchors as ``internal`` links — a broken-link rule must not
    treat those as fetchable destinations.
    """
    if not value:
        return False
    try:
        scheme = urlparse(value).scheme.lower()
    except Exception:
        return False
    return scheme in {"http", "https"}


# ---------------------------------------------------------------------------
# Scan-level context (built once per scan, strict isolation to that scan)
# ---------------------------------------------------------------------------
class ScanContext:
    """Cross-page evidence for a single scan.

    Built from *only* the given scan's pages (spec §22 historical-scan
    isolation). Powers the cross-page rules: broken internal links, duplicate
    titles/descriptions, shared canonicals, duplicate URLs, and hreflang
    return-reference checks.
    """

    def __init__(self, pairs: list[tuple[Any, Any]], scan_id: int | None = None,
                 website_id: int | None = None):
        # pairs: list of (page, extraction|None)
        self.scan_id = scan_id
        self.website_id = website_id
        self.page_count = len(pairs)

        # normalized url/final_url -> (status_code, error)
        self.url_status: dict[str, tuple[int | None, str | None]] = {}
        # normalized page url -> [page_result_id]
        self.url_pages: dict[str, list[int]] = {}
        # normalized title text -> [page_result_id]
        self.title_map: dict[str, list[int]] = {}
        # normalized meta description text -> [page_result_id]
        self.meta_desc_map: dict[str, list[int]] = {}
        # normalized canonical target -> [page_result_id]
        self.canonical_targets: dict[str, list[int]] = {}
        # every normalized url + final_url present in the scan
        self.urls_in_scan: set[str] = set()

        for page, ext in pairs:
            pid = getattr(page, "id", None)
            raw_url = getattr(page, "url", None)
            final_url = getattr(page, "final_url", None)
            status = getattr(page, "status_code", None)
            err = getattr(page, "error", None)

            norm_url = _normalize_url(raw_url)
            if norm_url:
                self.url_status.setdefault(norm_url, (status, err))
                self.url_pages.setdefault(norm_url, [])
                if pid is not None:
                    self.url_pages[norm_url].append(pid)
                self.urls_in_scan.add(norm_url)

            norm_final = _normalize_url(final_url)
            if norm_final:
                # final URL carries the authoritative status for that location
                self.url_status[norm_final] = (status, err)
                self.urls_in_scan.add(norm_final)

            if ext is None:
                continue

            # Titles (cross-page duplicate detection re-derived from evidence,
            # NOT from the conflated title_duplicate flag).
            if getattr(ext, "title_present", False) and not getattr(ext, "title_empty", False):
                nt = normalize_text(getattr(ext, "title_text", None))
                if nt and pid is not None:
                    self.title_map.setdefault(nt, []).append(pid)

            # Meta descriptions (first non-empty per page is enough for dup).
            for md in getattr(ext, "meta_descriptions", []) or []:
                if getattr(md, "empty", False):
                    continue
                nd = normalize_text(getattr(md, "text", None))
                if nd and pid is not None:
                    self.meta_desc_map.setdefault(nd, []).append(pid)
                    break

            # Canonical targets.
            for can in getattr(ext, "canonicals", []) or []:
                ct = _normalize_url(getattr(can, "url", None))
                if ct and pid is not None:
                    self.canonical_targets.setdefault(ct, []).append(pid)

    def status_for(self, url: str | None) -> tuple[int | None, str | None] | None:
        norm = _normalize_url(url)
        if norm is None:
            return None
        return self.url_status.get(norm)

    def is_in_scan(self, url: str | None) -> bool:
        norm = _normalize_url(url)
        return norm is not None and norm in self.urls_in_scan


# ---------------------------------------------------------------------------
# Page-level context (one per page)
# ---------------------------------------------------------------------------
class RuleContext:
    """Per-page evidence handed to every rule.

    ``page`` is always present (a ``PageResult`` ORM row or any object exposing
    ``url``/``final_url``/``status_code``/``content_type``/``error``/
    ``robots_txt_allowed``). ``extraction`` may be None (failed crawl / non-HTML)
    — content rules must guard on :pyattr:`is_indexable_html`. Child accessors
    normalise the two supported shapes (ORM relationships vs dataclass fields).
    """

    def __init__(self, page: Any, extraction: Any, scan: ScanContext):
        self.page = page
        self.extraction = extraction
        self.scan = scan

    # -- page identity / response ------------------------------------------
    @property
    def page_result_id(self) -> int | None:
        return getattr(self.page, "id", None)

    @property
    def url(self) -> str | None:
        return getattr(self.page, "url", None)

    @property
    def final_url(self) -> str | None:
        return getattr(self.page, "final_url", None)

    @property
    def status_code(self) -> int | None:
        return getattr(self.page, "status_code", None)

    @property
    def content_type(self) -> str | None:
        return getattr(self.page, "content_type", None)

    @property
    def error(self) -> str | None:
        return getattr(self.page, "error", None)

    @property
    def robots_txt_allowed(self):
        return getattr(self.page, "robots_txt_allowed", None)

    # -- gating helpers ----------------------------------------------------
    @property
    def has_extraction(self) -> bool:
        return self.extraction is not None

    @property
    def looks_html(self) -> bool:
        ct = (self.content_type or "").lower()
        if ct:
            return "html" in ct
        # No content-type header: trust extraction's html_available if present.
        return bool(self.ext("html_available", False)) or self.extraction is not None

    @property
    def is_success(self) -> bool:
        sc = self.status_code
        return sc is not None and 200 <= sc < 300

    @property
    def is_indexable_html(self) -> bool:
        """Content rules run only on successfully-fetched HTML pages."""
        return self.is_success and self.looks_html and self.has_extraction

    # -- scalar extraction accessor ----------------------------------------
    def ext(self, name: str, default: Any = None) -> Any:
        if self.extraction is None:
            return default
        return getattr(self.extraction, name, default)

    # -- child collections (always a list) ---------------------------------
    def _children(self, name: str) -> list[Any]:
        return list(self.ext(name, []) or [])

    @property
    def headings(self) -> list[Any]:
        return self._children("headings")

    @property
    def meta_descriptions(self) -> list[Any]:
        return self._children("meta_descriptions")

    @property
    def canonicals(self) -> list[Any]:
        return self._children("canonicals")

    @property
    def social_metadata(self) -> list[Any]:
        return self._children("social_metadata")

    @property
    def structured_data(self) -> list[Any]:
        return self._children("structured_data")

    @property
    def microdata(self) -> list[Any]:
        return self._children("microdata")

    @property
    def breadcrumbs(self) -> list[Any]:
        return self._children("breadcrumbs")

    @property
    def images(self) -> list[Any]:
        return self._children("images")

    @property
    def links(self) -> list[Any]:
        return self._children("links")

    @property
    def hreflang(self) -> list[Any]:
        return self._children("hreflang")

    # -- single-valued children --------------------------------------------
    @property
    def robots(self) -> Any:
        # ORM: uselist=False relationship; dataclass: single RobotsItem|None.
        return self.ext("robots", None)

    @property
    def indexability(self) -> Any:
        # ORM only (PageIndexabilityEvidence); dataclass path returns None.
        return self.ext("indexability_evidence", None)

    @property
    def html_lang(self) -> str | None:
        # Dataclass exposes a scalar html_lang; ORM stores it on the language child.
        v = self.ext("html_lang", None)
        if v:
            return v
        lang_obj = self.ext("language", None)
        if lang_obj is not None:
            return getattr(lang_obj, "html_lang", None)
        return None

    # -- derived indexability signals --------------------------------------
    @property
    def noindex(self) -> bool:
        r = self.robots
        if r is not None and getattr(r, "noindex", False):
            return True
        idx = self.indexability
        if idx is not None and getattr(idx, "page_noindex", False):
            return True
        return False

    @property
    def redirected(self) -> bool:
        idx = self.indexability
        if idx is not None:
            return bool(getattr(idx, "redirected", False))
        # Fall back to normalized url vs final_url comparison.
        if not self.final_url:
            return False
        return _normalize_url(self.url) != _normalize_url(self.final_url)
