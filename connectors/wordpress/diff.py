"""
WordPress Deterministic Diff and Patch Engine (Task 11 Step 3).

Generates deterministic before/after diffs, applies Task 9 FixPlan actions to
WordPress resources, and verifies pre-mutation baseline drift.
"""

from __future__ import annotations

import difflib
import json
import re
from typing import Any

from connectors.base.errors import ConnectorValidationError
from connectors.base.models import ChangeProposal
from connectors.wordpress.models import (
    WordPressMediaInfo,
    WordPressResourceInfo,
)
from connectors.wordpress.security import (
    assert_safe_wordpress_content,
    validate_wordpress_mutation_field,
)


def generate_field_diff(original: Any, proposed: Any, field_name: str = "content") -> str:
    """
    Generates a deterministic unified diff for string fields or structured representation
    for metadata dictionaries.
    """
    if isinstance(original, dict) or isinstance(proposed, dict):
        orig_str = json.dumps(original or {}, indent=2, sort_keys=True)
        prop_str = json.dumps(proposed or {}, indent=2, sort_keys=True)
    else:
        orig_str = str(original or "")
        prop_str = str(proposed or "")

    orig_lines = orig_str.splitlines(keepends=True)
    prop_lines = prop_str.splitlines(keepends=True)

    diff = list(
        difflib.unified_diff(
            orig_lines,
            prop_lines,
            fromfile=f"a/{field_name}",
            tofile=f"b/{field_name}",
            lineterm="",
        )
    )
    if not diff:
        return f"--- a/{field_name}\n+++ b/{field_name}\n (No changes)"
    return "\n".join(diff)


def validate_pre_apply_drift(
    current_value: Any,
    expected_original: Any | None,
    field_name: str,
) -> None:
    """
    Asserts that the live WordPress resource value matches the expected baseline
    captured when the fix plan was constructed. Prevents applying stale fixes.
    """
    if expected_original is None:
        return

    # For dictionary/meta comparisons
    if isinstance(expected_original, dict):
        if field_name in expected_original:
            expected_original = expected_original[field_name]
        elif "meta" in expected_original and isinstance(expected_original["meta"], dict) and field_name in expected_original["meta"]:
            expected_original = expected_original["meta"][field_name]
        elif isinstance(current_value, dict):
            for k, v in expected_original.items():
                if current_value.get(k) != v:
                    raise ConnectorValidationError(
                        f"Drift detected in WordPress meta key '{k}': expected '{v}', found '{current_value.get(k)}'",
                        details={"field": field_name, "meta_key": k, "reason": "baseline_drift"},
                    )
            return

    curr_str = str(current_value or "").strip()
    exp_str = str(expected_original or "").strip()

    if not exp_str:
        return

    # Check for exact match or snippet containment
    if curr_str != exp_str and exp_str not in curr_str:
        raise ConnectorValidationError(
            f"Pre-mutation baseline drift detected on field '{field_name}'. Remote content has been modified.",
            details={
                "field": field_name,
                "expected_preview": exp_str[:100],
                "current_preview": curr_str[:100],
                "reason": "content_drift",
            },
        )


def _extract_proposal_params(proposal: ChangeProposal) -> tuple[dict[str, Any], Any]:
    params = dict(getattr(proposal, "metadata", {}) or {})
    
    # Check if parameters dict is present in extra/metadata
    if hasattr(proposal, "parameters") and isinstance(proposal.parameters, dict):
        params.update(proposal.parameters)

    # Extract proposed content
    suggested = getattr(proposal, "suggested_content", None) or getattr(proposal, "proposed_content", None)
    if suggested is None and proposal.proposed_diff is not None:
        if isinstance(proposal.proposed_diff, str):
            suggested = proposal.proposed_diff
        elif isinstance(proposal.proposed_diff, dict):
            suggested = proposal.proposed_diff.get("after") or proposal.proposed_diff.get("value")
            params.update(proposal.proposed_diff)
    return params, suggested



def apply_proposal_to_resource(
    resource: WordPressResourceInfo | WordPressMediaInfo,
    proposal: ChangeProposal,
) -> tuple[dict[str, Any], str, Any, Any]:
    """
    Applies a ChangeProposal to a WordPress resource model and computes:
    1. update_payload: dict of fields to submit to the WordPress REST API
    2. field_name: primary field being mutated
    3. original_value_snapshot: preserved snapshot of the original field value
    4. proposed_value: resulting updated field value

    Raises:
        ConnectorValidationError: If inputs or operations are invalid or unsafe.
    """
    action = (proposal.action_type or "").lower().strip()
    params, suggested_content = _extract_proposal_params(proposal)

    # 1. Media Asset Alt-Text / Metadata
    if isinstance(resource, WordPressMediaInfo):
        field_name = "alt_text"
        original_snapshot = resource.alt_text
        new_val = suggested_content or params.get("alt_text") or params.get("value", "")
        validate_wordpress_mutation_field(field_name)
        assert_safe_wordpress_content(str(new_val))
        return ({"alt_text": str(new_val)}, field_name, original_snapshot, new_val)

    # 2. WordPress Page / Post / Custom Post Type
    assert isinstance(resource, WordPressResourceInfo)

    if action in ("update_title", "change_title", "add_title"):
        field_name = "title"
        validate_wordpress_mutation_field(field_name)
        original_snapshot = resource.title
        new_val = suggested_content or params.get("title") or params.get("value", "")
        assert_safe_wordpress_content(str(new_val))
        return ({"title": str(new_val)}, field_name, original_snapshot, str(new_val))

    elif action in ("update_excerpt", "add_excerpt"):
        field_name = "excerpt"
        validate_wordpress_mutation_field(field_name)
        original_snapshot = resource.excerpt
        new_val = suggested_content or params.get("excerpt") or params.get("value", "")
        assert_safe_wordpress_content(str(new_val))
        return ({"excerpt": str(new_val)}, field_name, original_snapshot, str(new_val))

    elif action in ("update_slug", "change_slug"):
        field_name = "slug"
        validate_wordpress_mutation_field(field_name)
        original_snapshot = resource.slug
        new_val = suggested_content or params.get("slug") or params.get("value", "")
        assert_safe_wordpress_content(str(new_val))
        return ({"slug": str(new_val)}, field_name, original_snapshot, str(new_val))

    elif action in ("update_meta_tag", "add_meta_tag", "set_meta", "update_meta_description", "meta_tag_improvement", "update_meta"):
        # SEO Meta fields (Yoast, RankMath, custom)
        meta_key = params.get("meta_key") or params.get("key")
        if not meta_key and isinstance(suggested_content, dict) and "meta" in suggested_content:
            meta_dict = suggested_content["meta"]
            meta_key = list(meta_dict.keys())[0]
            new_val = meta_dict[meta_key]
        elif not meta_key and isinstance(suggested_content, str):
            meta_key = "_yoast_wpseo_metadesc"
            new_val = suggested_content
        else:
            meta_key = meta_key or "_yoast_wpseo_metadesc"
            new_val = suggested_content or params.get("meta_value") or params.get("value", "")

        validate_wordpress_mutation_field(meta_key)
        original_snapshot = resource.meta.get(meta_key, "")
        assert_safe_wordpress_content(str(new_val))
        return ({"meta": {meta_key: new_val}}, meta_key, original_snapshot, new_val)

    elif action in ("add_schema_markup", "inject_schema", "structured_data"):
        # Schema injection can be placed into meta or appended to post_content
        schema_json = suggested_content or params.get("schema_json") or params.get("value", "")
        assert_safe_wordpress_content(str(schema_json))

        if params.get("as_meta"):
            meta_key = params.get("meta_key", "_schema_org_markup")
            validate_wordpress_mutation_field(meta_key)
            original_snapshot = resource.meta.get(meta_key, "")
            return ({"meta": {meta_key: schema_json}}, meta_key, original_snapshot, schema_json)
        else:
            field_name = "content"
            validate_wordpress_mutation_field(field_name)
            original_snapshot = resource.content
            script_tag = f'\n<script type="application/ld+json">\n{schema_json}\n</script>\n'
            # If schema script already exists, replace it, otherwise append
            if '<script type="application/ld+json">' in original_snapshot:
                new_content = re.sub(
                    r'<script type="application/ld\+json">.*?</script>',
                    script_tag.strip(),
                    original_snapshot,
                    flags=re.DOTALL,
                )
            else:
                new_content = original_snapshot + script_tag
            return ({"content": new_content}, field_name, original_snapshot, new_content)

    elif action in ("update_image_alt", "add_image_alt"):
        field_name = "content"
        validate_wordpress_mutation_field(field_name)
        original_snapshot = resource.content
        img_src = params.get("img_src") or params.get("src")
        alt_text = params.get("alt_text") or suggested_content or ""
        assert_safe_wordpress_content(alt_text)

        if img_src and img_src in original_snapshot:
            # Replace alt attribute for specific img tag
            img_pattern = re.compile(rf'<img([^>]*src=["\']{re.escape(img_src)}["\'][^>]*)>', re.IGNORECASE)
            match = img_pattern.search(original_snapshot)
            if match:
                img_tag = match.group(0)
                if 'alt=' in img_tag:
                    new_img_tag = re.sub(r'alt=["\'][^"\']*["\']', f'alt="{alt_text}"', img_tag)
                else:
                    new_img_tag = img_tag[:-1] + f' alt="{alt_text}">'
                new_content = original_snapshot[:match.start()] + new_img_tag + original_snapshot[match.end():]
            else:
                new_content = original_snapshot
        else:
            new_content = suggested_content or original_snapshot

        return ({"content": new_content}, field_name, original_snapshot, new_content)

    elif action in ("content_replacement", "replace_content", "text_fix"):
        field_name = "content"
        validate_wordpress_mutation_field(field_name)
        original_snapshot = resource.content
        target_text = params.get("target_text") or params.get("search")
        replacement = suggested_content or params.get("replacement") or params.get("value", "")
        assert_safe_wordpress_content(str(replacement))

        if target_text and target_text in original_snapshot:
            new_content = original_snapshot.replace(target_text, replacement, 1)
        else:
            new_content = replacement or original_snapshot

        return ({"content": new_content}, field_name, original_snapshot, new_content)

    else:
        # Generic direct field update
        field_name = params.get("field") or "content"
        validate_wordpress_mutation_field(field_name)
        original_snapshot = getattr(resource, field_name, "")
        new_val = suggested_content or params.get("value", "")
        assert_safe_wordpress_content(str(new_val))
        return ({field_name: new_val}, field_name, original_snapshot, new_val)
