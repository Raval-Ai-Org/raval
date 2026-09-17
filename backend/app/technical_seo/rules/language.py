"""Language & hreflang rules (category ``language``).

Spec §16: missing html language, empty/invalid/duplicate hreflang, and
reliable self/return-reference issues. Per §16 we do **not** claim complete
international-SEO validation: the return-reference check only fires when the
scan actually contains the referenced pages, and "invalid" is limited to
*clearly* malformed values (no full ISO allowlist). ``x-default`` is whitelisted.
"""

from ..base import RuleFinding, register
from ...page_extractor import _normalize_url

# A language-region value is only flagged as malformed when it is clearly
# broken: empty, containing whitespace, or containing characters outside the
# BCP-47 character set. This deliberately avoids validating against a full ISO
# allowlist (which would produce false positives on valid complex tags).
_ALLOWED_CHARS = set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-")


def _is_malformed(value: str | None) -> bool:
    if value is None:
        return True
    v = value.strip()
    if not v:
        return True
    if v.lower() == "x-default":
        return False
    if any(ch.isspace() for ch in value):
        return True
    return any(ch not in _ALLOWED_CHARS for ch in v)


@register(
    "SEO-LANG-001", "language", "low",
    "Missing html language",
    "Detect indexable pages with no html lang attribute.",
)
def missing_html_lang(ctx):
    if not ctx.is_indexable_html:
        return []
    if not (ctx.html_lang or "").strip():
        return [
            RuleFinding(
                message="Page has no html lang attribute.",
                observed_value="missing <html lang>",
                expected_state="a valid html lang (e.g. lang=\"en\")",
                reason="The html lang attribute declares the page language for engines and assistive tech.",
                recommendation="Add a lang attribute to the <html> element.",
                evidence={"html_lang": ctx.html_lang},
            )
        ]
    return []


@register(
    "SEO-LANG-002", "language", "low",
    "Invalid or empty hreflang",
    "Detect hreflang entries with empty or clearly malformed language codes.",
)
def invalid_hreflang(ctx):
    if not ctx.is_indexable_html:
        return []
    bad = [
        getattr(h, "language_region", None)
        for h in ctx.hreflang
        if _is_malformed(getattr(h, "language_region", None))
    ]
    if bad:
        return [
            RuleFinding(
                message="Page has hreflang entries with empty or malformed language codes.",
                observed_value=f"invalid language codes: {bad}",
                expected_state="valid BCP-47 codes (e.g. en, en-GB, x-default)",
                reason="Malformed hreflang codes are ignored, breaking language targeting.",
                recommendation="Use valid language-region codes for each hreflang entry.",
                evidence={"invalid_codes": bad},
            )
        ]
    return []


@register(
    "SEO-LANG-003", "language", "low",
    "Duplicate hreflang declaration",
    "Detect duplicated hreflang declarations.",
)
def duplicate_hreflang(ctx):
    if not ctx.is_indexable_html:
        return []
    if any(getattr(h, "duplicate_declaration", False) for h in ctx.hreflang):
        return [
            RuleFinding(
                message="Page has duplicate hreflang declarations.",
                observed_value="duplicate hreflang entries",
                expected_state="one hreflang entry per language-region",
                reason="Duplicate hreflang declarations are ambiguous and may be ignored.",
                recommendation="Remove duplicate hreflang entries.",
                evidence={"duplicate_declaration": True},
            )
        ]
    return []


@register(
    "SEO-LANG-004", "language", "medium",
    "Conflicting hreflang declaration",
    "Detect conflicting hreflang declarations for the same language.",
)
def conflicting_hreflang(ctx):
    if not ctx.is_indexable_html:
        return []
    if any(getattr(h, "conflicting_declaration", False) for h in ctx.hreflang):
        return [
            RuleFinding(
                message="Page has conflicting hreflang declarations.",
                observed_value="same language-region pointing to different URLs",
                expected_state="one consistent target per language-region",
                reason="Conflicting hreflang targets send mixed language-targeting signals.",
                recommendation="Resolve conflicting hreflang entries to one target per language.",
                evidence={"conflicting_declaration": True},
            )
        ]
    return []


@register(
    "SEO-LANG-005", "language", "info",
    "Missing hreflang return reference",
    "Note hreflang clusters where the page does not reference itself.",
)
def missing_return_reference(ctx):
    if not ctx.is_indexable_html:
        return []
    # Normalized hreflang targets, excluding x-default.
    targets = []
    for h in ctx.hreflang:
        code = (getattr(h, "language_region", None) or "").strip().lower()
        if code == "x-default":
            continue
        norm = _normalize_url(getattr(h, "target_url", None))
        if norm:
            targets.append(norm)
    if not targets:
        return []
    # Only act when at least one target is actually present in this scan
    # (enough relationship data — spec §16).
    in_scan_targets = [t for t in targets if t in ctx.scan.urls_in_scan]
    if not in_scan_targets:
        return []
    self_norms = {n for n in (_normalize_url(ctx.url), _normalize_url(ctx.final_url)) if n}
    if self_norms and not (self_norms & set(targets)):
        return [
            RuleFinding(
                message="Page participates in an hreflang cluster but does not reference itself.",
                observed_value="no self/return hreflang entry for this page's URL",
                expected_state="each hreflang cluster member references every member, including itself",
                reason="Missing return references break bidirectional hreflang and can invalidate the cluster.",
                recommendation="Add a self-referencing hreflang entry for this page's URL.",
                evidence={"hreflang_targets": targets, "in_scan_targets": in_scan_targets},
            )
        ]
    return []
