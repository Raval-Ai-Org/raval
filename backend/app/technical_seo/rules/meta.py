"""Meta-description rules (category ``meta``).

Owns *within-page* description problems (missing / empty / short / long /
multiple / duplicate-within-page). Cross-page duplicate descriptions are owned
by ``duplicates``. Length thresholds reuse Task 4's ``too_short`` / ``too_long``
flags on each ``MetaDescriptionItem``.
"""

from ..base import RuleFinding, register


@register(
    "SEO-META-001", "meta", "medium",
    "Missing meta description",
    "Detect indexable pages with no meta description.",
)
def missing_description(ctx):
    if not ctx.is_indexable_html:
        return []
    if ctx.ext("meta_description_present", False) and ctx.ext("meta_description_count", 0) > 0:
        return []
    return [
        RuleFinding(
            message="Page has no meta description.",
            observed_value="no meta description",
            expected_state="a single descriptive meta description",
            reason="Without a meta description engines synthesise the snippet, which may be less compelling.",
            recommendation="Add a concise, descriptive meta description.",
            evidence={"meta_description_present": False},
        )
    ]


@register(
    "SEO-META-002", "meta", "medium",
    "Empty meta description",
    "Detect a meta description tag with empty content.",
)
def empty_description(ctx):
    if not ctx.is_indexable_html:
        return []
    if any(getattr(m, "empty", False) for m in ctx.meta_descriptions):
        return [
            RuleFinding(
                message="Page has an empty meta description.",
                observed_value="meta description tag present but empty",
                expected_state="a non-empty descriptive meta description",
                reason="An empty description provides no snippet signal.",
                recommendation="Add descriptive content to the meta description.",
                evidence={"empty_description": True},
            )
        ]
    return []


@register(
    "SEO-META-003", "meta", "low",
    "Meta description too short",
    "Detect very short meta descriptions.",
)
def short_description(ctx):
    if not ctx.is_indexable_html:
        return []
    if any(
        getattr(m, "too_short", False) and not getattr(m, "empty", False)
        for m in ctx.meta_descriptions
    ):
        return [
            RuleFinding(
                message="Meta description is very short.",
                observed_value="meta description below the configured minimum length",
                expected_state="a description within the configured length range",
                reason="Very short descriptions often under-use the available snippet space.",
                recommendation="Expand the meta description to better summarise the page.",
                evidence={"too_short": True},
            )
        ]
    return []


@register(
    "SEO-META-004", "meta", "low",
    "Meta description too long",
    "Detect overly long meta descriptions.",
)
def long_description(ctx):
    if not ctx.is_indexable_html:
        return []
    if any(getattr(m, "too_long", False) for m in ctx.meta_descriptions):
        return [
            RuleFinding(
                message="Meta description is very long and may be truncated.",
                observed_value="meta description above the configured maximum length",
                expected_state="a description within the configured length range",
                reason="Long descriptions are truncated in results, hiding the tail of the text.",
                recommendation="Shorten the meta description so the key message appears first.",
                evidence={"too_long": True},
            )
        ]
    return []


@register(
    "SEO-META-005", "meta", "low",
    "Multiple meta descriptions",
    "Detect more than one meta description on a page.",
)
def multiple_descriptions(ctx):
    if not ctx.is_indexable_html:
        return []
    count = ctx.ext("meta_description_count", 0)
    if count > 1:
        return [
            RuleFinding(
                message="Page has more than one meta description.",
                observed_value=f"{count} meta description tags",
                expected_state="exactly one meta description",
                reason="Multiple descriptions are ambiguous; engines may use an unexpected one.",
                recommendation="Keep a single meta description in the document head.",
                evidence={"meta_description_count": count},
            )
        ]
    return []


@register(
    "SEO-META-006", "meta", "low",
    "Duplicate meta description within page",
    "Detect identical meta descriptions repeated on the same page.",
)
def duplicate_description_within_page(ctx):
    if not ctx.is_indexable_html:
        return []
    if any(getattr(m, "duplicate_within_page", False) for m in ctx.meta_descriptions):
        return [
            RuleFinding(
                message="Page repeats the same meta description more than once.",
                observed_value="duplicate meta description within the page",
                expected_state="a single meta description",
                reason="Repeated description tags are redundant and ambiguous.",
                recommendation="Remove the duplicate meta description tags.",
                evidence={"duplicate_within_page": True},
            )
        ]
    return []
