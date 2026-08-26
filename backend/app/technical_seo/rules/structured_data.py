"""Structured-data checks (category ``structured_data``).

Spec §14: use the Task 4 JSON-LD evidence to detect invalid JSON-LD, missing
``@context`` / ``@type`` where applicable, and duplicate/conflicting blocks.
This is **not** a full Schema.org validator.

The ``@context`` / ``@type`` checks inspect the *top-level* ``parsed_json`` dict
directly and skip lists and ``@graph`` containers — the extractor's ``context``
and ``types`` fields are populated by recursive traversal, so relying on them
would miss the top-level-only requirement and produce false positives.
"""

from ..base import RuleFinding, register


@register(
    "SEO-SD-001", "structured_data", "medium",
    "Invalid JSON-LD",
    "Detect JSON-LD blocks that failed to parse.",
)
def invalid_json_ld(ctx):
    if not ctx.is_indexable_html:
        return []
    findings = []
    for block in ctx.structured_data:
        err = getattr(block, "parse_error", None)
        if err:
            findings.append(
                RuleFinding(
                    message="Structured-data block is not valid JSON-LD.",
                    observed_value=f"parse error: {err}",
                    expected_state="valid, parseable JSON-LD",
                    reason="Invalid JSON-LD is ignored, so its structured data is lost.",
                    recommendation="Fix the JSON-LD syntax so the block parses.",
                    evidence={
                        "block_position": getattr(block, "block_position", None),
                        "parse_error": err,
                    },
                )
            )
    return findings


def _top_level_dict(block):
    """Return the parsed_json only when it is a plain top-level object.

    Skips parse-error blocks (None), lists, and ``@graph`` containers where the
    entity-level keys live one level down.
    """
    parsed = getattr(block, "parsed_json", None)
    if isinstance(parsed, dict) and "@graph" not in parsed:
        return parsed
    return None


@register(
    "SEO-SD-002", "structured_data", "low",
    "Missing @context",
    "Detect top-level JSON-LD objects without an @context.",
)
def missing_context(ctx):
    if not ctx.is_indexable_html:
        return []
    findings = []
    for block in ctx.structured_data:
        parsed = _top_level_dict(block)
        if parsed is not None and "@context" not in parsed:
            findings.append(
                RuleFinding(
                    message="JSON-LD block is missing an @context.",
                    observed_value="top-level JSON-LD object without @context",
                    expected_state='an @context (e.g. "https://schema.org")',
                    reason="Without @context the vocabulary is undefined and the block may be ignored.",
                    recommendation='Add an @context such as "https://schema.org".',
                    evidence={"block_position": getattr(block, "block_position", None)},
                )
            )
    return findings


@register(
    "SEO-SD-003", "structured_data", "low",
    "Missing @type",
    "Detect top-level JSON-LD objects without an @type.",
)
def missing_type(ctx):
    if not ctx.is_indexable_html:
        return []
    findings = []
    for block in ctx.structured_data:
        parsed = _top_level_dict(block)
        if parsed is not None and "@type" not in parsed:
            findings.append(
                RuleFinding(
                    message="JSON-LD block is missing an @type.",
                    observed_value="top-level JSON-LD object without @type",
                    expected_state="an @type naming the entity (e.g. Organization, Article)",
                    reason="Without @type the entity is untyped and cannot be interpreted.",
                    recommendation="Add an @type describing the entity.",
                    evidence={"block_position": getattr(block, "block_position", None)},
                )
            )
    return findings


@register(
    "SEO-SD-004", "structured_data", "info",
    "Duplicate structured-data blocks",
    "Note multiple JSON-LD blocks declaring the same set of types.",
)
def duplicate_blocks(ctx):
    if not ctx.is_indexable_html:
        return []
    seen: dict[tuple, int] = {}
    for block in ctx.structured_data:
        types = getattr(block, "types", None)
        if not types:
            continue
        key = tuple(sorted(types))
        seen[key] = seen.get(key, 0) + 1
    # JSON-serializable: a list of {types, count} entries (a list is unhashable
    # and cannot be used as a dict key).
    dups = [{"types": list(k), "count": c} for k, c in seen.items() if c > 1]
    if dups:
        return [
            RuleFinding(
                message="Page has multiple structured-data blocks with the same type set.",
                observed_value=f"duplicate type sets: {dups}",
                expected_state="one block per entity type unless intentionally repeated",
                reason="Duplicate blocks for the same type set can conflict or be redundant.",
                recommendation="Confirm the repeated structured-data blocks are intentional.",
                evidence={"duplicate_type_sets": dups},
            )
        ]
    return []
