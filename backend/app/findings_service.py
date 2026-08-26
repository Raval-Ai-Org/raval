"""Persistence + orchestration for Task 5 technical-SEO findings.

This module is the *only* place the pure rule engine touches the database. It
mirrors the Task 4 split (``page_extractor.extract_html`` pure vs
``services.run_scan`` stateful): the engine in ``app.technical_seo`` returns
in-memory ``RuleFinding`` DTOs, and the functions here load evidence, run the
engine, and persist ``TechnicalSeoFinding`` rows.

Key conventions carried over from the existing services:
- ``ValueError("... not found")`` for missing entities (mapped to 404 in main).
- Idempotent analysis via purge-and-reinsert per scan/page (like
  ``page_extractor.extract_page`` clearing child rows before reinsert).
- Per-page fault isolation and a single commit per analysis run (like
  ``extract_scan_pages``).
- Strict per-scan isolation: the cross-page ``ScanContext`` is built from only
  the target scan's pages (spec §22 historical-scan isolation).
"""

from __future__ import annotations

import logging
from typing import Any

from sqlalchemy.orm import Session, selectinload

from .models import (
    PageExtraction,
    PageResult,
    Scan,
    TechnicalSeoFinding,
    Website,
)
from .technical_seo import (
    RuleContext,
    ScanContext,
    build_summary,
    run_page_rules,
)

logger = logging.getLogger(__name__)

# Eager-load the extraction and every child collection the engine reads, so a
# ≤50-page scan analysis is a handful of batched queries rather than N+1 per
# page. These are the PageExtraction relationship names (see models.py).
_EXTRACTION_CHILDREN = (
    "meta_descriptions",
    "headings",
    "canonicals",
    "robots",
    "social_metadata",
    "structured_data",
    "microdata",
    "breadcrumbs",
    "images",
    "links",
    "language",
    "hreflang",
    "indexability_evidence",
)


def _load_scan_pages(db: Session, scan_id: int) -> list[PageResult]:
    """Load a scan's pages with extraction + children eagerly loaded."""
    options = [selectinload(PageResult.extraction)]
    options += [
        selectinload(PageResult.extraction).selectinload(getattr(PageExtraction, rel))
        for rel in _EXTRACTION_CHILDREN
    ]
    return (
        db.query(PageResult)
        .filter(PageResult.scan_id == scan_id)
        .order_by(PageResult.id)
        .options(*options)
        .all()
    )


def _finding_row(
    website_id: int,
    scan_id: int,
    page_result_id: int,
    rf,
) -> TechnicalSeoFinding:
    return TechnicalSeoFinding(
        website_id=website_id,
        scan_id=scan_id,
        page_result_id=page_result_id,
        rule_id=rf.rule_id,
        category=rf.category,
        severity=rf.severity,
        status="open",
        message=rf.message,
        observed_value=rf.observed_value,
        expected_state=rf.expected_state,
        reason=rf.reason,
        recommendation=rf.recommendation,
        evidence=rf.evidence or {},
    )


# ---------------------------------------------------------------------------
# Analysis (write) — purge and reinsert, single commit
# ---------------------------------------------------------------------------
def analyze_scan_findings(db: Session, scan_id: int) -> dict[str, Any]:
    """Run the rule engine over every page in a scan and persist findings.

    Idempotent: existing findings for the scan are purged first, so re-running
    yields the same set. Per-page fault isolation ensures one page's failure
    never loses the rest. Returns the provisional summary (spec §20/§21).
    """
    scan = db.get(Scan, scan_id)
    if scan is None:
        raise ValueError("Scan not found")

    pages = _load_scan_pages(db, scan_id)
    scan_ctx = ScanContext(
        [(p, p.extraction) for p in pages],
        scan_id=scan_id,
        website_id=scan.website_id,
    )

    # Purge existing findings for this scan (idempotent re-analysis).
    db.query(TechnicalSeoFinding).filter(
        TechnicalSeoFinding.scan_id == scan_id
    ).delete(synchronize_session=False)

    rows: list[tuple[str, str]] = []
    for page in pages:
        try:
            produced = run_page_rules(RuleContext(page, page.extraction, scan_ctx))
        except Exception:
            # Defensive: analysis of one page must not abort the whole scan.
            logger.warning(
                "technical-seo analysis failed for page_result_id=%s (scan_id=%s)",
                page.id,
                scan_id,
                exc_info=True,
            )
            continue
        for rf in produced:
            db.add(_finding_row(scan.website_id, scan_id, page.id, rf))
            rows.append((rf.category, rf.severity))

    db.commit()

    return build_summary(
        rows,
        pages_analyzed=len(pages),
        scan_id=scan_id,
        website_id=scan.website_id,
    )


def analyze_page_findings(db: Session, page_result_id: int) -> dict[str, Any]:
    """Re-run analysis for a single page (still using full scan context).

    Cross-page rules (duplicate title, broken internal link, ...) need the
    whole scan, so the ``ScanContext`` is built from all sibling pages even
    though only this page's findings are purged and re-inserted.
    """
    page = db.get(PageResult, page_result_id)
    if page is None:
        raise ValueError("Page not found")

    scan = db.get(Scan, page.scan_id)
    if scan is None:
        raise ValueError("Scan not found")

    pages = _load_scan_pages(db, page.scan_id)
    scan_ctx = ScanContext(
        [(p, p.extraction) for p in pages],
        scan_id=page.scan_id,
        website_id=scan.website_id,
    )
    target = next((p for p in pages if p.id == page_result_id), page)

    db.query(TechnicalSeoFinding).filter(
        TechnicalSeoFinding.page_result_id == page_result_id
    ).delete(synchronize_session=False)

    rows: list[tuple[str, str]] = []
    try:
        produced = run_page_rules(RuleContext(target, target.extraction, scan_ctx))
    except Exception:
        logger.warning(
            "technical-seo analysis failed for page_result_id=%s",
            page_result_id,
            exc_info=True,
        )
        produced = []
    for rf in produced:
        db.add(_finding_row(scan.website_id, page.scan_id, page_result_id, rf))
        rows.append((rf.category, rf.severity))

    db.commit()

    return build_summary(
        rows,
        pages_analyzed=1,
        scan_id=page.scan_id,
        website_id=scan.website_id,
    )


# ---------------------------------------------------------------------------
# Retrieval (read) — with optional filters
# ---------------------------------------------------------------------------
def _filtered(
    query,
    severity: str | None = None,
    category: str | None = None,
    rule_id: str | None = None,
    status: str | None = None,
):
    if severity is not None:
        query = query.filter(TechnicalSeoFinding.severity == severity)
    if category is not None:
        query = query.filter(TechnicalSeoFinding.category == category)
    if rule_id is not None:
        query = query.filter(TechnicalSeoFinding.rule_id == rule_id)
    if status is not None:
        query = query.filter(TechnicalSeoFinding.status == status)
    return query


def get_scan_findings(
    db: Session,
    scan_id: int,
    severity: str | None = None,
    category: str | None = None,
    rule_id: str | None = None,
    status: str | None = None,
) -> list[TechnicalSeoFinding]:
    scan = db.get(Scan, scan_id)
    if scan is None:
        raise ValueError("Scan not found")

    query = db.query(TechnicalSeoFinding).filter(
        TechnicalSeoFinding.scan_id == scan_id
    )
    query = _filtered(query, severity, category, rule_id, status)
    return query.order_by(TechnicalSeoFinding.id).all()


def get_page_findings(
    db: Session,
    page_result_id: int,
    severity: str | None = None,
    category: str | None = None,
    rule_id: str | None = None,
    status: str | None = None,
) -> list[TechnicalSeoFinding]:
    page = db.get(PageResult, page_result_id)
    if page is None:
        raise ValueError("Page not found")

    query = db.query(TechnicalSeoFinding).filter(
        TechnicalSeoFinding.page_result_id == page_result_id
    )
    query = _filtered(query, severity, category, rule_id, status)
    return query.order_by(TechnicalSeoFinding.id).all()


def get_website_findings(
    db: Session,
    website_id: int,
    severity: str | None = None,
    category: str | None = None,
    rule_id: str | None = None,
    status: str | None = None,
) -> list[TechnicalSeoFinding]:
    website = db.get(Website, website_id)
    if website is None:
        raise ValueError("Website not found")

    query = db.query(TechnicalSeoFinding).filter(
        TechnicalSeoFinding.website_id == website_id
    )
    query = _filtered(query, severity, category, rule_id, status)
    return query.order_by(TechnicalSeoFinding.id).all()


def get_finding(db: Session, finding_id: int) -> TechnicalSeoFinding:
    finding = db.get(TechnicalSeoFinding, finding_id)
    if finding is None:
        raise ValueError("Finding not found")
    return finding


def get_scan_findings_summary(db: Session, scan_id: int) -> dict[str, Any]:
    """Summary + provisional health computed from *persisted* findings.

    Mirrors what :func:`analyze_scan_findings` returns, but reads whatever is
    currently stored (so it reflects the last analysis without re-running it).
    """
    scan = db.get(Scan, scan_id)
    if scan is None:
        raise ValueError("Scan not found")

    pages_analyzed = (
        db.query(PageResult).filter(PageResult.scan_id == scan_id).count()
    )
    findings = (
        db.query(TechnicalSeoFinding)
        .filter(TechnicalSeoFinding.scan_id == scan_id)
        .all()
    )
    rows = [(f.category, f.severity) for f in findings]
    return build_summary(
        rows,
        pages_analyzed=pages_analyzed,
        scan_id=scan_id,
        website_id=scan.website_id,
    )
