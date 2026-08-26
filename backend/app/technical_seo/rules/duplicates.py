"""Duplicate-signal rules (category ``duplicates``).

Owns *cross-page* duplicate titles/descriptions, shared canonicals, and
duplicate URLs — all derived from the ``ScanContext`` maps built over a single
scan (strict isolation). This is deliberately **not** semantic duplicate-content
analysis (spec §11). Cross-page duplicate titles are re-derived from the scan
``title_map`` rather than the ``title_duplicate`` flag, which conflates
within-page multiples with cross-scan duplicates (see page_extractor.py).
"""

from ..base import RuleFinding, normalize_text, register
from ..config import SHARED_CANONICAL_MIN
from ...page_extractor import _normalize_url


@register(
    "SEO-DUP-001", "duplicates", "medium",
    "Duplicate title across pages",
    "Detect the same title used on more than one page in the scan.",
)
def duplicate_title(ctx):
    if not ctx.is_indexable_html:
        return []
    if not (ctx.ext("title_present", False) and not ctx.ext("title_empty", False)):
        return []
    nt = normalize_text(ctx.ext("title_text"))
    if not nt:
        return []
    pages = ctx.scan.title_map.get(nt, [])
    if len(pages) > 1:
        others = [p for p in pages if p != ctx.page_result_id]
        return [
            RuleFinding(
                message="Title is identical to other page(s) in this scan.",
                observed_value=f"shared title: {ctx.ext('title_text')!r}",
                expected_state="a unique title per page",
                reason="Duplicate titles make pages hard to tell apart in search results.",
                recommendation="Give each page a unique, descriptive title.",
                evidence={"shared_by_page_ids": others, "occurrences": len(pages)},
            )
        ]
    return []


@register(
    "SEO-DUP-002", "duplicates", "low",
    "Duplicate meta description across pages",
    "Detect the same meta description used on more than one page in the scan.",
)
def duplicate_description(ctx):
    if not ctx.is_indexable_html:
        return []
    nd = None
    for m in ctx.meta_descriptions:
        if not getattr(m, "empty", False):
            nd = normalize_text(getattr(m, "text", None))
            if nd:
                break
    if not nd:
        return []
    pages = ctx.scan.meta_desc_map.get(nd, [])
    if len(pages) > 1:
        others = [p for p in pages if p != ctx.page_result_id]
        return [
            RuleFinding(
                message="Meta description is identical to other page(s) in this scan.",
                observed_value="shared meta description",
                expected_state="a unique meta description per page",
                reason="Duplicate descriptions produce repetitive, less useful snippets.",
                recommendation="Write a unique meta description for each page.",
                evidence={"shared_by_page_ids": others, "occurrences": len(pages)},
            )
        ]
    return []


@register(
    "SEO-DUP-003", "duplicates", "info",
    "Shared canonical target",
    "Note canonical targets shared by many pages in the scan.",
)
def shared_canonical(ctx):
    if not ctx.is_indexable_html:
        return []
    seen_targets = set()
    findings = []
    for can in ctx.canonicals:
        target = _normalize_url(getattr(can, "url", None))
        if not target or target in seen_targets:
            continue
        seen_targets.add(target)
        sharers = ctx.scan.canonical_targets.get(target, [])
        unique_sharers = sorted(set(sharers))
        if len(unique_sharers) >= SHARED_CANONICAL_MIN:
            findings.append(
                RuleFinding(
                    message="Many pages declare the same canonical target.",
                    observed_value=f"{len(unique_sharers)} pages share canonical {getattr(can, 'url', None)!r}",
                    expected_state="an intentional consolidation cluster",
                    reason=(
                        "Many pages sharing one canonical is legitimate for "
                        "consolidation/pagination, but worth confirming it is intended."
                    ),
                    recommendation="Confirm this consolidation is intentional and the target is correct.",
                    evidence={"canonical_target": getattr(can, "url", None), "page_count": len(unique_sharers)},
                )
            )
    return findings


@register(
    "SEO-DUP-004", "duplicates", "info",
    "Duplicate URL via normalization",
    "Note distinct crawled URLs that normalize to the same address.",
)
def duplicate_url(ctx):
    norm = _normalize_url(ctx.url)
    if not norm:
        return []
    pages = ctx.scan.url_pages.get(norm, [])
    unique_pages = sorted(set(pages))
    if len(unique_pages) > 1:
        others = [p for p in unique_pages if p != ctx.page_result_id]
        return [
            RuleFinding(
                message="Multiple crawled URLs normalize to the same address.",
                observed_value=f"normalized URL: {norm}",
                expected_state="one canonical URL per unique page",
                reason="URLs that differ only cosmetically can split signals across duplicates.",
                recommendation="Consolidate duplicate URLs (redirect or canonicalise to one).",
                evidence={"normalized_url": norm, "other_page_ids": others},
            )
        ]
    return []
