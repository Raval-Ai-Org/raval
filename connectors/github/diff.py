"""
Deterministic Diff Generation and Pre-Commit Validation (Task 11 Step 2).

Provides inspectable, reproducible unified and structured diffs for Fix Plan execution,
and ensures that proposed modifications only touch intended files without side-effects.
"""

from __future__ import annotations

import difflib
import re
from typing import Any

from connectors.base.errors import ConnectorValidationError
from connectors.github.security import normalize_github_path


def generate_unified_diff(
    file_path: str,
    before_content: str,
    after_content: str,
) -> str:
    """
    Produces a standard Git-style unified diff string between before and after contents.
    """
    clean_path = normalize_github_path(file_path)
    before_lines = before_content.splitlines(keepends=True)
    after_lines = after_content.splitlines(keepends=True)

    diff = difflib.unified_diff(
        before_lines,
        after_lines,
        fromfile=f"a/{clean_path}",
        tofile=f"b/{clean_path}",
        lineterm="",
    )
    return "".join(diff)


def generate_structured_diff(
    file_path: str,
    before_content: str,
    after_content: str,
    action_type: str = "general_fix",
) -> dict[str, Any]:
    """
    Produces a machine-readable structured diff summary.
    """
    clean_path = normalize_github_path(file_path)
    before_lines = before_content.splitlines()
    after_lines = after_content.splitlines()

    matcher = difflib.SequenceMatcher(None, before_lines, after_lines)
    additions = 0
    deletions = 0
    modifications = 0

    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == "insert":
            additions += (j2 - j1)
        elif tag == "delete":
            deletions += (i2 - i1)
        elif tag == "replace":
            modifications += max(i2 - i1, j2 - j1)

    return {
        "target_path": clean_path,
        "action_type": action_type,
        "additions_count": additions,
        "deletions_count": deletions,
        "modifications_count": modifications,
        "before_length_bytes": len(before_content.encode("utf-8")),
        "after_length_bytes": len(after_content.encode("utf-8")),
        "is_identical": before_content == after_content,
    }


def apply_proposal_to_content(
    original_content: str | None,
    proposed_diff: dict[str, Any] | str | None,
    action_type: str = "general_fix",
) -> str:
    """
    Deterministically computes the new file content from the proposal.
    """
    orig = original_content or ""

    if proposed_diff is None:
        return orig

    # If proposed_diff is a direct string replacement/content
    if isinstance(proposed_diff, str):
        # If it's a full replacement or raw string
        return proposed_diff

    if isinstance(proposed_diff, dict):
        # If explicit 'after' is provided
        if "after" in proposed_diff:
            after_val = proposed_diff["after"]
            if isinstance(after_val, (dict, list)):
                import json
                script_tag = f"\n<script type=\"application/ld+json\">\n{json.dumps(after_val, indent=2)}\n</script>\n"
                if "</head>" in orig:
                    return orig.replace("</head>", f"{script_tag}</head>", 1)
                elif "</body>" in orig:
                    return orig.replace("</body>", f"{script_tag}</body>", 1)
                else:
                    return f"{orig}\n{script_tag}"
            
            # If string 'after' replacement
            after_str = str(after_val)
            # Check if before snippet exists for targeted in-place replacement
            if "before" in proposed_diff and proposed_diff["before"] and str(proposed_diff["before"]) in orig:
                return orig.replace(str(proposed_diff["before"]), after_str, 1)

            # Otherwise, if meta tag fix
            if "meta_tag" in action_type or "title" in action_type.lower():
                if "<title>" in orig and "</title>" in orig and "<title>" in after_str:
                    return re.sub(r"<title>.*?</title>", after_str, orig, flags=re.DOTALL | re.IGNORECASE)
                elif "</head>" in orig:
                    return orig.replace("</head>", f"  {after_str}\n</head>", 1)

            # If heading fix
            if "heading" in action_type:
                if "<h1>" in orig and "</h1>" in orig and "<h1>" in after_str:
                    return re.sub(r"<h1>.*?</h1>", after_str, orig, flags=re.DOTALL | re.IGNORECASE)
                elif "<body>" in orig:
                    return orig.replace("<body>", f"<body>\n  {after_str}", 1)

            # If content gap fill or expansion
            if "content_gap" in action_type:
                if "</main>" in orig:
                    return orig.replace("</main>", f"\n<section class=\"content-expansion\">\n{after_str}\n</section>\n</main>", 1)
                elif "</body>" in orig:
                    return orig.replace("</body>", f"\n<section class=\"content-expansion\">\n{after_str}\n</section>\n</body>", 1)
                else:
                    return f"{orig}\n\n{after_str}"

            # Fallback to direct replacement if original was empty or new file
            if not orig:
                return after_str

            return f"{orig}\n{after_str}"

    return orig


def validate_pre_commit_state(
    expected_original_content: str | None,
    current_remote_content: str | None,
    target_path: str,
) -> None:
    """
    Validates that the remote file has not drifted before applying the commit.
    Raises ConnectorValidationError if race-condition or state mismatch is detected.
    """
    if not expected_original_content:
        return

    exp = expected_original_content.strip()
    curr = (current_remote_content or "").strip()

    # Match if identical or if snippet exists within remote content
    if exp == curr or exp in curr:
        return

    raise ConnectorValidationError(
        message=f"Pre-commit validation failed: Remote file '{target_path}' state does not match expected original content",
        details={
            "target_path": target_path,
            "expected_snippet_or_length": exp[:80],
            "current_remote_length": len(curr),
        },
    )
