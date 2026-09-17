"""Internal-link technical rules (category ``links``).

Spec §12: detect weak internal linking, empty anchor text, potentially
excessive repeated links, and broken internal destinations **only when crawl
evidence proves them**. This is not the full internal-link recommendation
engine.

Two false-positive controls are essential here:
- The extractor labels ``mailto:`` / ``tel:`` / ``javascript:`` and scheme-less
  anchors as ``internal``; :func:`is_http_url` filters those out so they are
  never counted as page links or checked for "broken" status.
- A link is "broken" only if its normalized destination was actually crawled in
  this scan and returned 4xx/5xx (evidence in ``ScanContext.url_status``).
  Uncrawled / out-of-budget destinations produce **no** finding.
"""

from ..base import RuleFinding, is_http_url, register
from ..config import EXCESSIVE_REPEAT_LINK_THRESHOLD, FEW_INTERNAL_LINKS_THRESHOLD
from ...page_extractor import _normalize_url


def _internal_http_links(ctx):
    return [
        l
        for l in ctx.links
        if getattr(l, "link_type", "internal") == "internal"
        and is_http_url(getattr(l, "destination_url", None))
    ]


@register(
    "SEO-LINK-001", "links", "medium",
    "No internal links",
    "Detect indexable pages with no outgoing internal links.",
)
def no_internal_links(ctx):
    if not ctx.is_indexable_html:
        return []
    if len(_internal_http_links(ctx)) == 0:
        return [
            RuleFinding(
                message="Page has no outgoing internal links.",
                observed_value="0 internal links",
                expected_state="at least a few internal links to related pages",
                reason="Pages with no internal links are poorly connected and harder to discover.",
                recommendation="Add internal links to related pages.",
                evidence={"internal_link_count": 0},
            )
        ]
    return []


@register(
    "SEO-LINK-002", "links", "low",
    "Very few internal links",
    "Detect indexable pages with only a handful of internal links.",
)
def few_internal_links(ctx):
    if not ctx.is_indexable_html:
        return []
    n = len(_internal_http_links(ctx))
    if 0 < n < FEW_INTERNAL_LINKS_THRESHOLD:
        return [
            RuleFinding(
                message="Page has very few outgoing internal links.",
                observed_value=f"{n} internal links",
                expected_state=f"at least {FEW_INTERNAL_LINKS_THRESHOLD} internal links",
                reason="Sparse internal linking limits crawl paths and topical connections.",
                recommendation="Add more internal links to related pages where relevant.",
                evidence={"internal_link_count": n, "threshold": FEW_INTERNAL_LINKS_THRESHOLD},
            )
        ]
    return []


@register(
    "SEO-LINK-003", "links", "info",
    "Empty anchor text",
    "Detect internal links whose anchor text is empty.",
)
def empty_anchor_text(ctx):
    if not ctx.is_indexable_html:
        return []
    empties = [
        l
        for l in _internal_http_links(ctx)
        if not (getattr(l, "anchor_text", None) or "").strip()
    ]
    if empties:
        return [
            RuleFinding(
                message=f"Page has {len(empties)} internal link(s) with empty anchor text.",
                observed_value=f"{len(empties)} links with no anchor text",
                expected_state="descriptive anchor text (or an accessible label for image-only links)",
                reason="Empty anchor text conveys no context; verify these are not image-only links.",
                recommendation="Add descriptive anchor text, or ensure image links carry alt text.",
                evidence={
                    "empty_anchor_count": len(empties),
                    "sample_destinations": [getattr(l, "destination_url", None) for l in empties[:5]],
                },
            )
        ]
    return []


@register(
    "SEO-LINK-004", "links", "high",
    "Broken internal link",
    "Detect internal links whose crawled destination returned 4xx/5xx.",
)
def broken_internal_link(ctx):
    if not ctx.is_indexable_html:
        return []
    findings = []
    seen = set()
    for l in _internal_http_links(ctx):
        dest = getattr(l, "destination_url", None)
        norm = _normalize_url(dest)
        if not norm or norm in seen:
            continue
        status = ctx.scan.status_for(dest)
        if status and status[0] is not None and 400 <= status[0] <= 599:
            seen.add(norm)
            findings.append(
                RuleFinding(
                    message=f"Internal link points to a broken destination (HTTP {status[0]}).",
                    observed_value=f"{dest} -> HTTP {status[0]}",
                    expected_state="internal links that resolve to 2xx pages",
                    reason="Broken internal links waste crawl budget and hurt user navigation.",
                    recommendation="Fix or remove the link, or restore the destination page.",
                    evidence={"destination_url": dest, "destination_status": status[0]},
                )
            )
    return findings


@register(
    "SEO-LINK-005", "links", "info",
    "Excessively repeated link",
    "Note the same internal destination repeated many times on one page.",
)
def excessive_repeated_link(ctx):
    if not ctx.is_indexable_html:
        return []
    counts: dict[str, int] = {}
    for l in _internal_http_links(ctx):
        norm = _normalize_url(getattr(l, "destination_url", None))
        if norm:
            counts[norm] = counts.get(norm, 0) + 1
    repeated = {u: c for u, c in counts.items() if c > EXCESSIVE_REPEAT_LINK_THRESHOLD}
    if repeated:
        return [
            RuleFinding(
                message="Page repeats the same internal link many times.",
                observed_value=f"repeated destinations: {repeated}",
                expected_state="a reasonable number of links per destination",
                reason="Excessive repeated links can dilute link context; usually harmless but worth a look.",
                recommendation="Confirm the repetition is intentional (e.g. navigation vs. accidental duplication).",
                evidence={"repeated_destinations": repeated, "threshold": EXCESSIVE_REPEAT_LINK_THRESHOLD},
            )
        ]
    return []
