"""Canonical rules (category ``canonical``).

Owns missing / multiple / empty / invalid / conflicting / cross-page canonical
signals (spec §7). A canonical pointing to another URL is **not** automatically
wrong (pagination, parameter consolidation), so cross-page canonicals are Info
and only escalate when the target is a crawled error page.
"""

from ..base import RuleFinding, register


@register(
    "SEO-CANON-001", "canonical", "low",
    "Missing canonical",
    "Detect indexable HTML pages with no canonical link.",
)
def missing_canonical(ctx):
    if not ctx.is_indexable_html:
        return []
    if ctx.ext("canonical_present", False):
        return []
    return [
        RuleFinding(
            message="Page has no canonical link.",
            observed_value="no <link rel=canonical>",
            expected_state="a self-referencing canonical (or an intentional cross-page canonical)",
            reason="A canonical helps engines consolidate duplicate URLs and pick the preferred one.",
            recommendation="Add a canonical link, usually self-referencing, unless duplication is intended.",
            evidence={"canonical_present": False},
        )
    ]


@register(
    "SEO-CANON-002", "canonical", "medium",
    "Multiple canonicals",
    "Detect pages declaring more than one canonical URL.",
)
def multiple_canonicals(ctx):
    if not ctx.is_indexable_html:
        return []
    count = ctx.ext("canonical_count", 0)
    if ctx.ext("canonical_multiple", False) or count > 1:
        urls = [getattr(c, "url", None) for c in ctx.canonicals]
        return [
            RuleFinding(
                message="Page declares multiple canonical URLs.",
                observed_value=f"{count} canonical links",
                expected_state="exactly one canonical link",
                reason="Multiple canonicals conflict and let the engine choose arbitrarily.",
                recommendation="Keep a single canonical link and remove the others.",
                evidence={"canonical_count": count, "urls": urls},
            )
        ]
    return []


@register(
    "SEO-CANON-003", "canonical", "medium",
    "Empty canonical",
    "Detect canonical links with an empty href.",
)
def empty_canonical(ctx):
    if not ctx.is_indexable_html:
        return []
    if any(getattr(c, "empty", False) for c in ctx.canonicals):
        return [
            RuleFinding(
                message="Page has a canonical link with an empty href.",
                observed_value="canonical href is empty",
                expected_state="a canonical pointing to a valid absolute URL",
                reason="An empty canonical is ignored and provides no consolidation signal.",
                recommendation="Set the canonical href to the preferred absolute URL.",
                evidence={"empty_canonical": True},
            )
        ]
    return []


@register(
    "SEO-CANON-004", "canonical", "medium",
    "Invalid canonical URL",
    "Detect canonical links whose URL is not valid.",
)
def invalid_canonical(ctx):
    if not ctx.is_indexable_html:
        return []
    bad = [
        getattr(c, "url", None)
        for c in ctx.canonicals
        if not getattr(c, "empty", False) and not getattr(c, "valid", False)
    ]
    if bad:
        return [
            RuleFinding(
                message="Page has a canonical link with an invalid URL.",
                observed_value=f"invalid canonical URL(s): {bad}",
                expected_state="a canonical pointing to a valid absolute http(s) URL",
                reason="An invalid canonical cannot be resolved and is ignored by engines.",
                recommendation="Use a valid absolute URL for the canonical link.",
                evidence={"invalid_urls": bad},
            )
        ]
    return []


@register(
    "SEO-CANON-005", "canonical", "medium",
    "Conflicting canonicals",
    "Detect pages with conflicting canonical declarations.",
)
def conflicting_canonical(ctx):
    if not ctx.is_indexable_html:
        return []
    if ctx.ext("canonical_conflict", False):
        urls = [getattr(c, "url", None) for c in ctx.canonicals]
        return [
            RuleFinding(
                message="Page has conflicting canonical declarations.",
                observed_value=f"canonical targets: {urls}",
                expected_state="a single consistent canonical target",
                reason="Conflicting canonicals send mixed consolidation signals to engines.",
                recommendation="Resolve the canonical declarations to one consistent target.",
                evidence={"canonical_conflict": True, "urls": urls},
            )
        ]
    return []


@register(
    "SEO-CANON-006", "canonical", "info",
    "Cross-page canonical",
    "Note canonicals that point to a different URL (not automatically wrong).",
)
def cross_page_canonical(ctx):
    if not ctx.is_indexable_html:
        return []
    targets = [
        getattr(c, "url", None)
        for c in ctx.canonicals
        if getattr(c, "cross_page", False)
    ]
    if not targets:
        return []
    # Escalate only if a target is a crawled 4xx/5xx page (evidence-backed).
    broken = []
    for t in targets:
        status = ctx.scan.status_for(t)
        if status and status[0] is not None and 400 <= status[0] <= 599:
            broken.append({"url": t, "status": status[0]})
    severity = "low" if broken else None  # None -> rule default (info)
    msg = "Canonical points to a different URL."
    if broken:
        msg = "Canonical points to a different URL that returns an error."
    return [
        RuleFinding(
            message=msg,
            observed_value=f"cross-page canonical target(s): {targets}",
            expected_state="an intentional canonical target that resolves to a live page",
            reason=(
                "Pointing the canonical to another URL is legitimate for "
                "consolidation, but only if the target is the intended, live page."
            ),
            recommendation="Confirm the cross-page canonical target is intentional and returns 2xx.",
            evidence={"cross_page_targets": targets, "broken_targets": broken},
            severity=severity,
        )
    ]
