"""Image technical rules (category ``images``).

Spec §13: missing alt, empty alt (decorative — handled carefully), missing
dimensions where detectable, and a configurable image-count notice. Per §13 we
**never** claim an image is slow or inaccessible — only what the evidence
proves (a missing/empty attribute, an absent dimension).
"""

from ..base import RuleFinding, register
from ..config import IMAGE_COUNT_THRESHOLD


@register(
    "SEO-IMG-001", "images", "low",
    "Images missing alt",
    "Detect images with no alt attribute.",
)
def images_missing_alt(ctx):
    if not ctx.is_indexable_html:
        return []
    missing = [i for i in ctx.images if getattr(i, "alt_missing", False)]
    if missing:
        return [
            RuleFinding(
                message=f"Page has {len(missing)} image(s) with no alt attribute.",
                observed_value=f"{len(missing)} images missing alt",
                expected_state="informative images carry descriptive alt text",
                reason="Missing alt attributes remove text context for non-visual consumers of the page.",
                recommendation="Add descriptive alt text to informative images.",
                evidence={
                    "images_missing_alt": len(missing),
                    "sample_urls": [getattr(i, "url", None) for i in missing[:5]],
                },
            )
        ]
    return []


@register(
    "SEO-IMG-002", "images", "info",
    "Images with empty alt",
    "Note images with an explicit empty alt (typically decorative).",
)
def images_empty_alt(ctx):
    if not ctx.is_indexable_html:
        return []
    empty = [i for i in ctx.images if getattr(i, "alt_empty", False)]
    if empty:
        return [
            RuleFinding(
                message=f"Page has {len(empty)} image(s) with an explicit empty alt.",
                observed_value=f"{len(empty)} images with alt=\"\"",
                expected_state="empty alt is correct for decorative images only",
                reason="An explicit empty alt marks an image decorative; confirm these are indeed decorative.",
                recommendation="Confirm empty-alt images are decorative; add alt text if they are informative.",
                evidence={
                    "images_empty_alt": len(empty),
                    "sample_urls": [getattr(i, "url", None) for i in empty[:5]],
                },
            )
        ]
    return []


@register(
    "SEO-IMG-003", "images", "info",
    "Images missing dimensions",
    "Note images with no detectable width/height.",
)
def images_missing_dimensions(ctx):
    if not ctx.is_indexable_html:
        return []
    missing_dims = [
        i
        for i in ctx.images
        if getattr(i, "width", None) is None or getattr(i, "height", None) is None
    ]
    if missing_dims:
        return [
            RuleFinding(
                message=f"Page has {len(missing_dims)} image(s) without explicit dimensions.",
                observed_value=f"{len(missing_dims)} images missing width/height",
                expected_state="explicit width/height where known",
                reason="Explicit dimensions help the browser reserve layout space; only a hint, not a defect.",
                recommendation="Add width/height attributes where the intrinsic size is known.",
                evidence={"images_missing_dimensions": len(missing_dims)},
            )
        ]
    return []


@register(
    "SEO-IMG-004", "images", "info",
    "High image count",
    "Note pages with a very large number of images.",
)
def high_image_count(ctx):
    if not ctx.is_indexable_html:
        return []
    count = ctx.ext("image_count", 0)
    if count > IMAGE_COUNT_THRESHOLD:
        return [
            RuleFinding(
                message="Page has a very large number of images.",
                observed_value=f"{count} images",
                expected_state=f"a manageable number of images (threshold {IMAGE_COUNT_THRESHOLD})",
                reason="A very high image count is worth reviewing for relevance; this is a count signal only.",
                recommendation="Review whether all images are necessary for this page.",
                evidence={"image_count": count, "threshold": IMAGE_COUNT_THRESHOLD},
            )
        ]
    return []
