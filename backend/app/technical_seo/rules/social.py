"""Open Graph & Twitter/X rules (category ``social``).

Spec §15: check for missing og:title, og:description, og:image, og:url,
twitter:card and the relevant Twitter title/description/image. Findings are
aggregated per page (one OG finding, one Twitter finding) and gated to
successfully-fetched HTML pages to avoid noise.
"""

from ..base import RuleFinding, register

OG_REQUIRED = ["og:title", "og:description", "og:image", "og:url"]
TWITTER_RELEVANT = ["twitter:card", "twitter:title", "twitter:description", "twitter:image"]


def _present_properties(ctx, platform):
    present = set()
    for item in ctx.social_metadata:
        if getattr(item, "platform", None) != platform:
            continue
        if getattr(item, "empty", False):
            continue
        name = getattr(item, "property_name", None)
        if name:
            present.add(name.lower())
    return present


@register(
    "SEO-SOCIAL-001", "social", "low",
    "Missing Open Graph tags",
    "Detect missing core Open Graph tags on an indexable page.",
)
def missing_open_graph(ctx):
    if not ctx.is_indexable_html:
        return []
    present = _present_properties(ctx, "open_graph")
    missing = [p for p in OG_REQUIRED if p not in present]
    if missing:
        return [
            RuleFinding(
                message="Page is missing core Open Graph tags.",
                observed_value=f"missing: {missing}",
                expected_state=f"all core OG tags present: {OG_REQUIRED}",
                reason="Open Graph tags control how the page previews when shared on social platforms.",
                recommendation="Add the missing Open Graph tags for reliable social previews.",
                evidence={"missing_og": missing, "present_og": sorted(present)},
            )
        ]
    return []


@register(
    "SEO-SOCIAL-002", "social", "low",
    "Missing Twitter/X card tags",
    "Detect a missing twitter:card (and related tags) on an indexable page.",
)
def missing_twitter_card(ctx):
    if not ctx.is_indexable_html:
        return []
    present = _present_properties(ctx, "twitter")
    # Only flag when the primary twitter:card is absent; report the full gap.
    if "twitter:card" in present:
        return []
    missing = [p for p in TWITTER_RELEVANT if p not in present]
    return [
        RuleFinding(
            message="Page has no twitter:card tag.",
            observed_value=f"missing: {missing}",
            expected_state="a twitter:card (and relevant title/description/image)",
            reason="Twitter/X card tags control the rich preview when the page is shared there.",
            recommendation="Add a twitter:card tag and the relevant Twitter metadata.",
            evidence={"missing_twitter": missing, "present_twitter": sorted(present)},
        )
    ]
