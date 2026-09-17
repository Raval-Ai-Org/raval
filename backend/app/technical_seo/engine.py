"""Rule execution + provisional scoring aggregation.

``run_page_rules`` executes every registered rule against one page's context
with per-rule fault isolation (a single broken rule must never suppress the
other findings on that page). ``build_summary`` turns a scan's findings into
category health + a provisional overall health score (spec §20 scoring
foundation — explicitly *not* the final GEO/AEO score).
"""

from __future__ import annotations

import logging
from typing import Any

# Importing the rules package populates RULE_REGISTRY via each module's
# @register decorators. Without this import the engine would find zero rules.
from . import rules as _rules  # noqa: F401
from .base import RULE_REGISTRY, RuleContext, RuleFinding
from .config import (
    SCORING_VERSION,
    SEVERITY_ORDER,
    SEVERITY_WEIGHTS,
)

logger = logging.getLogger(__name__)


def run_page_rules(ctx: RuleContext) -> list[RuleFinding]:
    """Run all registered rules on a single page context.

    Each rule is isolated: an exception in one rule is swallowed so the rest
    still run. Rule metadata (id/category/default severity) is stamped onto
    every finding here so rule bodies stay concise.
    """
    findings: list[RuleFinding] = []
    for rule in RULE_REGISTRY:
        try:
            produced = rule.check(ctx) or []
        except Exception:
            # Defensive: a buggy rule must not lose the page's other findings.
            # It is still logged (never silently dropped) so rule bugs surface.
            logger.warning(
                "technical-seo rule %s failed on page_result_id=%s",
                rule.rule_id,
                getattr(ctx, "page_result_id", None),
                exc_info=True,
            )
            continue
        for rf in produced:
            rf.rule_id = rf.rule_id or rule.rule_id
            rf.category = rf.category or rule.category
            if rf.severity is None:
                rf.severity = rule.severity
            findings.append(rf)
    return findings


def _empty_severity_counts() -> dict[str, int]:
    return {s: 0 for s in SEVERITY_ORDER}


def build_summary(
    rows: list[tuple[str, str]],
    pages_analyzed: int,
    scan_id: int | None = None,
    website_id: int | None = None,
) -> dict[str, Any]:
    """Aggregate (category, severity) rows into a summary + provisional score.

    ``rows`` is a list of ``(category, severity)`` pairs — one per finding —
    which works equally for in-memory ``RuleFinding`` objects and persisted
    rows, keeping this function free of any ORM dependency.

    Category health: ``max(0, round(100 - penalty / max(1, pages_analyzed)))``
    where ``penalty = Σ severity_weight``. Overall health is the mean of the
    per-category health values (100 when there are no findings).
    """
    counts_by_severity = _empty_severity_counts()
    per_category: dict[str, dict[str, int]] = {}

    for category, severity in rows:
        if severity not in counts_by_severity:
            # Unknown severity is tolerated but ignored in weighting.
            counts_by_severity[severity] = 0
        counts_by_severity[severity] += 1
        cat_counts = per_category.setdefault(category, _empty_severity_counts())
        cat_counts[severity] = cat_counts.get(severity, 0) + 1

    denom = max(1, pages_analyzed)
    categories: list[dict[str, Any]] = []
    for category in sorted(per_category):
        cat_counts = per_category[category]
        penalty = sum(SEVERITY_WEIGHTS.get(s, 0) * n for s, n in cat_counts.items())
        health = max(0, round(100 - penalty / denom))
        categories.append(
            {
                "category": category,
                "total": sum(cat_counts.values()),
                "counts_by_severity": cat_counts,
                "health": health,
            }
        )

    if categories:
        provisional_overall_health = round(
            sum(c["health"] for c in categories) / len(categories)
        )
        worst_category = min(categories, key=lambda c: c["health"])["category"]
    else:
        provisional_overall_health = 100
        worst_category = None

    return {
        "scan_id": scan_id,
        "website_id": website_id,
        "pages_analyzed": pages_analyzed,
        "total_findings": len(rows),
        "counts_by_severity": counts_by_severity,
        "categories": categories,
        "provisional_overall_health": provisional_overall_health,
        "worst_category": worst_category,
        "scoring": {
            "provisional": True,
            "version": SCORING_VERSION,
            "weights": SEVERITY_WEIGHTS,
            "note": (
                "Provisional technical-health heuristic derived from real "
                "findings. This is NOT the final GEO/AEO score (spec §20); the "
                "future Score -> Category -> Rule -> Evidence -> Page chain may "
                "replace these numbers without changing the finding evidence."
            ),
        },
    }
