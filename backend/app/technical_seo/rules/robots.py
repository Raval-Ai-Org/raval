"""Robots / indexing directive rules (category ``robots``).

Owns the meta-robots directives *other than* ``noindex`` (which is owned by
``indexability``): nofollow, noarchive, nosnippet, and any other restrictive
directives (spec §8). These are page-level directives parsed from the HTML.
"""

from ..base import RuleFinding, register


@register(
    "SEO-ROBOTS-001", "robots", "low",
    "Meta nofollow",
    "Detect a page-level nofollow directive.",
)
def meta_nofollow(ctx):
    r = ctx.robots
    if r is not None and getattr(r, "nofollow", False):
        return [
            RuleFinding(
                message="Page declares a nofollow directive; its links will not pass authority.",
                observed_value="robots nofollow directive present",
                expected_state="follow (default) unless links are intentionally not endorsed",
                reason="A page-level nofollow stops engines following any link on the page.",
                recommendation="Remove nofollow if the page's links should be followed.",
                evidence={"nofollow": True},
            )
        ]
    return []


@register(
    "SEO-ROBOTS-002", "robots", "info",
    "Noarchive directive",
    "Note a noarchive directive.",
)
def meta_noarchive(ctx):
    r = ctx.robots
    if r is not None and getattr(r, "noarchive", False):
        return [
            RuleFinding(
                message="Page declares noarchive; engines will not store a cached copy.",
                observed_value="robots noarchive directive present",
                expected_state="archive allowed unless caching is intentionally disabled",
                reason="noarchive prevents a cached copy but does not affect indexing.",
                recommendation="Keep noarchive only if cached copies are intentionally disabled.",
                evidence={"noarchive": True},
            )
        ]
    return []


@register(
    "SEO-ROBOTS-003", "robots", "info",
    "Nosnippet directive",
    "Note a nosnippet directive.",
)
def meta_nosnippet(ctx):
    r = ctx.robots
    if r is not None and getattr(r, "nosnippet", False):
        return [
            RuleFinding(
                message="Page declares nosnippet; engines will not show a text snippet.",
                observed_value="robots nosnippet directive present",
                expected_state="snippet allowed unless intentionally suppressed",
                reason="nosnippet suppresses result snippets, which can reduce click-through.",
                recommendation="Keep nosnippet only if snippets are intentionally suppressed.",
                evidence={"nosnippet": True},
            )
        ]
    return []


@register(
    "SEO-ROBOTS-004", "robots", "info",
    "Other robots directives",
    "Note additional restrictive robots directives.",
)
def meta_other_directives(ctx):
    r = ctx.robots
    directives = list(getattr(r, "other_directives", None) or []) if r is not None else []
    if directives:
        return [
            RuleFinding(
                message="Page declares additional robots directives.",
                observed_value=f"other directives: {directives}",
                expected_state="only the directives you intend to apply",
                reason="Extra directives (max-snippet, unavailable_after, etc.) can restrict how the page appears.",
                recommendation="Review these directives and confirm each is intentional.",
                evidence={"other_directives": directives},
            )
        ]
    return []
