"""Heading rules (category ``headings``).

Spec §10 is explicit: one H1 is a *structural* signal, not a universal ranking
rule. So multiple-H1 is Info with neutral wording, and missing-H1 is Medium
framed structurally rather than as a ranking penalty.
"""

from ..base import RuleFinding, register


@register(
    "SEO-HEADING-001", "headings", "medium",
    "Missing H1",
    "Detect pages with headings but no H1.",
)
def missing_h1(ctx):
    if not ctx.is_indexable_html:
        return []
    # A page with no headings at all is covered by SEO-HEADING-005 instead.
    if ctx.ext("missing_h1", False) and len(ctx.headings) > 0:
        return [
            RuleFinding(
                message="Page has headings but no H1.",
                observed_value=f"h1_count = {ctx.ext('h1_count', 0)}",
                expected_state="a top-level H1 describing the page (structural signal)",
                reason="An H1 gives the page a clear top-level topic for users and parsers.",
                recommendation="Add a single descriptive H1 as the page's main heading.",
                evidence={"h1_count": ctx.ext("h1_count", 0)},
            )
        ]
    return []


@register(
    "SEO-HEADING-002", "headings", "info",
    "Multiple H1",
    "Note pages with more than one H1 (HTML5 permits this).",
)
def multiple_h1(ctx):
    if not ctx.is_indexable_html:
        return []
    if ctx.ext("multiple_h1", False):
        return [
            RuleFinding(
                message="Page has more than one H1.",
                observed_value=f"h1_count = {ctx.ext('h1_count', 0)}",
                expected_state="an intentional heading structure",
                reason=(
                    "HTML5 allows multiple H1s within sectioning elements; this "
                    "is only worth confirming, not fixing by default."
                ),
                recommendation="Confirm the multiple H1s are intentional for the page structure.",
                evidence={"h1_count": ctx.ext("h1_count", 0)},
            )
        ]
    return []


@register(
    "SEO-HEADING-003", "headings", "low",
    "Empty headings",
    "Detect heading elements with no text.",
)
def empty_headings(ctx):
    if not ctx.is_indexable_html:
        return []
    empties = [h for h in ctx.headings if getattr(h, "empty", False)]
    if empties:
        levels = [getattr(h, "level", None) for h in empties]
        return [
            RuleFinding(
                message=f"Page has {len(empties)} empty heading element(s).",
                observed_value=f"empty heading levels: {levels}",
                expected_state="headings that contain descriptive text",
                reason="Empty headings add no structure and can confuse assistive technology and parsers.",
                recommendation="Remove empty headings or add descriptive text.",
                evidence={"empty_heading_count": len(empties), "levels": levels},
            )
        ]
    return []


@register(
    "SEO-HEADING-004", "headings", "low",
    "Heading hierarchy issue",
    "Detect basic heading-hierarchy problems (e.g. skipped levels).",
)
def heading_hierarchy(ctx):
    if not ctx.is_indexable_html:
        return []
    if not ctx.ext("heading_hierarchy_issue", False):
        return []
    details = ctx.ext("heading_hierarchy_details", None) or []
    # The "missing an H1" detail overlaps with SEO-HEADING-001/005; this rule
    # is only about genuine ordering problems (wrong start level / skipped
    # levels), so filter the missing-H1 note out to avoid double-emission.
    ordering_issues = [
        d
        for d in details
        if not (d.get("issue", "").startswith("Document is missing an H1"))
    ]
    if not ordering_issues:
        return []
    return [
        RuleFinding(
            message="Page has a heading-hierarchy issue (levels skipped or out of order).",
            observed_value="heading levels not in a clean nesting order",
            expected_state="headings that nest without skipping levels",
            reason="A clean heading outline helps users and parsers follow the page structure.",
            recommendation="Adjust heading levels so they nest without skipping.",
            evidence={"heading_hierarchy_details": ordering_issues},
        )
    ]


@register(
    "SEO-HEADING-005", "headings", "low",
    "No heading structure",
    "Detect indexable pages with no headings at all.",
)
def no_headings(ctx):
    if not ctx.is_indexable_html:
        return []
    if len(ctx.headings) == 0:
        return [
            RuleFinding(
                message="Page has no heading elements at all.",
                observed_value="0 headings",
                expected_state="at least a top-level heading describing the page",
                reason="A page with no headings offers no structural outline for users or parsers.",
                recommendation="Add a meaningful heading structure starting with an H1.",
                evidence={"heading_count": 0},
            )
        ]
    return []
