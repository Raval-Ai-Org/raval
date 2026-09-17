"""Indexability rules (category ``indexability``).

Owns the *indexing-authorization* signals: page-level ``noindex`` and
robots.txt disallow, plus noindex/canonical conflicts. HTTP status-based
indexability blocking is owned by ``http`` (see the ownership matrix in
docs/TECHNICAL_SEO_RULES.md) to avoid double-emission.
"""

from ..base import RuleFinding, register


@register(
    "SEO-INDEX-001", "indexability", "high",
    "Page marked noindex",
    "Detect pages that instruct search engines not to index them.",
)
def noindex_page(ctx):
    if not ctx.noindex:
        return []
    source = "meta robots" if (ctx.robots and getattr(ctx.robots, "noindex", False)) else "indexability evidence"
    return [
        RuleFinding(
            message="Page is marked noindex and will be excluded from search indexes.",
            observed_value="robots noindex directive present",
            expected_state="index allowed (no noindex) if the page should be discoverable",
            reason=(
                "A noindex directive removes the page from search and AI answer "
                "indexes regardless of its content quality."
            ),
            recommendation="Remove the noindex directive if this page should be indexable.",
            evidence={"noindex": True, "source": source},
        )
    ]


@register(
    "SEO-INDEX-002", "indexability", "high",
    "Blocked by robots.txt",
    "Detect pages whose crawl was disallowed by robots.txt.",
)
def robots_txt_blocked(ctx):
    # robots_txt_allowed is True by default; only an explicit False is evidence.
    if ctx.robots_txt_allowed is False:
        return [
            RuleFinding(
                message="Page is disallowed by robots.txt.",
                observed_value="robots_txt_allowed = False",
                expected_state="crawl allowed if the page should be indexed",
                reason=(
                    "A robots.txt disallow prevents crawling, so the page's "
                    "content cannot be evaluated or indexed."
                ),
                recommendation="Allow this path in robots.txt if the page should be indexable.",
                evidence={"robots_txt_allowed": False},
            )
        ]
    return []


@register(
    "SEO-INDEX-003", "indexability", "medium",
    "Noindex with canonical",
    "Detect the mixed signal of a noindex page that also declares a canonical.",
)
def noindex_with_canonical(ctx):
    if ctx.noindex and ctx.ext("canonical_present", False):
        return [
            RuleFinding(
                message="Page is noindex but also declares a canonical URL (mixed signals).",
                observed_value="noindex + canonical present",
                expected_state="a single consistent indexing signal",
                reason=(
                    "noindex asks engines to drop the page while a canonical "
                    "asks them to consolidate it; the combination is ambiguous."
                ),
                recommendation="Keep either noindex or the canonical, not both, depending on intent.",
                evidence={"noindex": True, "canonical_present": True},
            )
        ]
    return []
