"""Title rules (category ``title``).

Owns *within-page* title problems (missing / empty / short / long / multiple).
Cross-page duplicate titles are owned by ``duplicates``. Length thresholds come
from Task 4's already-computed ``title_too_short`` / ``title_too_long`` flags so
the thresholds keep a single source of truth in ``page_extractor``.
"""

from ..base import RuleFinding, register


@register(
    "SEO-TITLE-001", "title", "high",
    "Missing title",
    "Detect indexable pages with no <title> element.",
)
def missing_title(ctx):
    if not ctx.is_indexable_html:
        return []
    if ctx.ext("title_present", False) and ctx.ext("title_count", 0) > 0:
        return []
    return [
        RuleFinding(
            message="Page has no <title> element.",
            observed_value="no title element",
            expected_state="a single descriptive, unique <title>",
            reason="The title is a primary relevance and click signal for search and AI systems.",
            recommendation="Add a descriptive unique title.",
            evidence={"title_present": False},
        )
    ]


@register(
    "SEO-TITLE-002", "title", "high",
    "Empty title",
    "Detect a <title> element that contains no text.",
)
def empty_title(ctx):
    if not ctx.is_indexable_html:
        return []
    if ctx.ext("title_present", False) and ctx.ext("title_empty", False):
        return [
            RuleFinding(
                message="Page has an empty <title> element.",
                observed_value="title element present but empty",
                expected_state="a single descriptive, unique <title>",
                reason="An empty title provides no relevance or click signal.",
                recommendation="Add descriptive text to the title element.",
                evidence={"title_present": True, "title_empty": True},
            )
        ]
    return []


@register(
    "SEO-TITLE-003", "title", "low",
    "Title too short",
    "Detect very short titles.",
)
def short_title(ctx):
    if not ctx.is_indexable_html:
        return []
    if (
        ctx.ext("title_present", False)
        and not ctx.ext("title_empty", False)
        and ctx.ext("title_too_short", False)
    ):
        return [
            RuleFinding(
                message="Title is very short.",
                observed_value=f"title length {ctx.ext('title_length', 0)}",
                expected_state="a descriptive title within the configured length range",
                reason="Very short titles often miss useful context for users and engines.",
                recommendation="Expand the title so it clearly describes the page.",
                evidence={"title_length": ctx.ext("title_length", 0), "title_text": ctx.ext("title_text")},
            )
        ]
    return []


@register(
    "SEO-TITLE-004", "title", "low",
    "Title too long",
    "Detect overly long titles.",
)
def long_title(ctx):
    if not ctx.is_indexable_html:
        return []
    if ctx.ext("title_present", False) and ctx.ext("title_too_long", False):
        return [
            RuleFinding(
                message="Title is very long and may be truncated in results.",
                observed_value=f"title length {ctx.ext('title_length', 0)}",
                expected_state="a title within the configured length range",
                reason="Long titles are truncated in search results, hiding the tail of the text.",
                recommendation="Shorten the title so the important words appear first.",
                evidence={"title_length": ctx.ext("title_length", 0), "title_text": ctx.ext("title_text")},
            )
        ]
    return []


@register(
    "SEO-TITLE-005", "title", "low",
    "Multiple title elements",
    "Detect more than one <title> element on a page.",
)
def multiple_titles(ctx):
    if not ctx.is_indexable_html:
        return []
    count = ctx.ext("title_count", 0)
    if count > 1:
        return [
            RuleFinding(
                message="Page has more than one <title> element.",
                observed_value=f"{count} title elements",
                expected_state="exactly one title element",
                reason="Multiple titles are ambiguous; engines may use an unexpected one.",
                recommendation="Keep a single title element in the document head.",
                evidence={"title_count": count},
            )
        ]
    return []
