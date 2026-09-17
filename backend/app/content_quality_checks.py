"""
Content Quality & Intelligence Checks (Task 5 - Step 18)

Runs defensive, deterministic quality verification on page content:
validates against empty, malformed, thin, or low-density content.
Guaranteed safe execution on corrupted or partial HTML.
"""

from dataclasses import asdict, dataclass, field
import re
from typing import Any


@dataclass
class QualityCheckItem:
    check_name: str
    status: str  # "pass", "fail", "warn"
    title: str
    description: str
    evidence: dict[str, Any] = field(default_factory=dict)


@dataclass
class ContentQualityChecksResult:
    is_valid_content: bool = True
    total_checks: int = 0
    passed_checks: int = 0
    failed_checks: int = 0
    warning_checks: int = 0
    checks: list[dict[str, Any]] = field(default_factory=list)
    findings: list[dict[str, Any]] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class ContentQualityChecker:
    """
    Performs safety, parsing integrity, and quality checks across extracted
    page text, HTML markup, and structural metadata.
    """

    def run_checks(
        self,
        raw_html: str | None = None,
        text_content: str | None = None,
        title: str | None = None,
        headings: list[Any] | None = None,
    ) -> ContentQualityChecksResult:
        result = ContentQualityChecksResult()
        evaluated_checks: list[QualityCheckItem] = []

        # Safe normalizations
        safe_html = raw_html or ""
        safe_text = (text_content or "").strip()
        safe_title = (title or "").strip()

        # Check 1: Empty or Missing Content
        if not safe_text and not safe_html:
            evaluated_checks.append(QualityCheckItem(
                check_name="empty_content",
                status="fail",
                title="Page Content Missing or Empty",
                description="The page returned completely empty or null content.",
                evidence={"text_length": 0, "html_length": 0},
            ))
            result.is_valid_content = False
        else:
            evaluated_checks.append(QualityCheckItem(
                check_name="empty_content",
                status="pass",
                title="Content Present",
                description=f"Page provides extractable text ({len(safe_text)} chars).",
                evidence={"text_length": len(safe_text), "html_length": len(safe_html)},
            ))

        # Check 2: Malformed or Incomplete HTML
        if safe_html:
            has_body = bool(re.search(r"<body[\s>]", safe_html, re.I))
            has_html_tag = bool(re.search(r"<html[\s>]", safe_html, re.I))
            truncated_end = not bool(re.search(r"</html>", safe_html, re.I))

            if not has_body or truncated_end:
                evaluated_checks.append(QualityCheckItem(
                    check_name="html_integrity",
                    status="warn" if safe_text else "fail",
                    title="Incomplete or Malformed HTML Document",
                    description="The HTML payload lacks standard document structures (missing <body> or unclosed </html>).",
                    evidence={"has_body_tag": has_body, "unclosed_html": truncated_end},
                ))
            else:
                evaluated_checks.append(QualityCheckItem(
                    check_name="html_integrity",
                    status="pass",
                    title="Valid HTML Structure",
                    description="HTML markup contains valid standard document structure.",
                    evidence={"has_body_tag": True, "unclosed_html": False},
                ))
        else:
            evaluated_checks.append(QualityCheckItem(
                check_name="html_integrity",
                status="warn",
                title="No HTML Markup Provided",
                description="Analysis evaluated on plain text without raw HTML markup.",
                evidence={"has_html": False},
            ))

        # Check 3: Thin Content Volume Check
        word_count = len(safe_text.split()) if safe_text else 0
        if word_count == 0:
            evaluated_checks.append(QualityCheckItem(
                check_name="thin_content",
                status="fail",
                title="Zero Content Words",
                description="No readable natural language words detected.",
                evidence={"word_count": 0},
            ))
        elif word_count < 35:
            evaluated_checks.append(QualityCheckItem(
                check_name="thin_content",
                status="warn",
                title="Thin Content Volume",
                description=f"Page body has only {word_count} words (below the 35-word baseline for meaningful content).",
                evidence={"word_count": word_count},
            ))
        else:
            evaluated_checks.append(QualityCheckItem(
                check_name="thin_content",
                status="pass",
                title="Adequate Content Volume",
                description=f"Page provides {word_count} words of substantive content.",
                evidence={"word_count": word_count},
            ))

        # Check 4: Title & Heading Anchor Integrity
        has_title = bool(safe_title)
        has_h1 = False
        if headings:
            for h in headings:
                lvl = h.get("level") if isinstance(h, dict) else getattr(h, "level", None)
                if lvl == 1:
                    has_h1 = True
                    break

        if not has_title and not has_h1:
            evaluated_checks.append(QualityCheckItem(
                check_name="title_heading_anchors",
                status="fail",
                title="Missing Document Title and H1 Heading",
                description="The page lacks both an HTML <title> tag and an <h1> heading anchor.",
                evidence={"has_title": has_title, "has_h1": has_h1},
            ))
        elif not has_h1:
            evaluated_checks.append(QualityCheckItem(
                check_name="title_heading_anchors",
                status="warn",
                title="Missing Primary H1 Heading",
                description="The page has a title but lacks a primary <h1> heading to anchor its content.",
                evidence={"has_title": has_title, "has_h1": False},
            ))
        else:
            evaluated_checks.append(QualityCheckItem(
                check_name="title_heading_anchors",
                status="pass",
                title="Title and H1 Anchors Present",
                description="Page includes both document title and primary H1 heading.",
                evidence={"has_title": has_title, "has_h1": True},
            ))

        # Check 5: Information-to-Markup Density Check
        if safe_html and safe_text:
            text_len = len(safe_text)
            html_len = len(safe_html)
            ratio = round(text_len / max(1, html_len), 3)

            if ratio < 0.03 and html_len > 3000:
                evaluated_checks.append(QualityCheckItem(
                    check_name="information_density",
                    status="warn",
                    title="Low Information-to-Markup Ratio",
                    description=f"Visible text represents only {round(ratio * 100, 1)}% of total HTML payload, indicating heavy script or boilerplate overhead.",
                    evidence={"text_length": text_len, "html_length": html_len, "ratio": ratio},
                ))
            else:
                evaluated_checks.append(QualityCheckItem(
                    check_name="information_density",
                    status="pass",
                    title="Healthy Information Density",
                    description=f"Text-to-HTML ratio of {round(ratio * 100, 1)}% satisfies content-to-code benchmarks.",
                    evidence={"ratio": ratio},
                ))
        else:
            evaluated_checks.append(QualityCheckItem(
                check_name="information_density",
                status="pass",
                title="Density Check Satisfied",
                description="No excessive HTML overhead detected.",
                evidence={},
            ))

        # Check 6: Text Readability and Encoding Check
        corrupted_chars = len(re.findall(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", safe_text))
        if corrupted_chars > 0:
            evaluated_checks.append(QualityCheckItem(
                check_name="text_encoding",
                status="fail",
                title="Corrupted or Binary Control Characters Detected",
                description=f"Detected {corrupted_chars} non-printable control characters in extracted text.",
                evidence={"corrupted_char_count": corrupted_chars},
            ))
        else:
            evaluated_checks.append(QualityCheckItem(
                check_name="text_encoding",
                status="pass",
                title="Clean Text Encoding",
                description="All text characters conform to clean printable UTF-8 encoding.",
                evidence={"corrupted_char_count": 0},
            ))

        # Aggregate summary statistics
        result.total_checks = len(evaluated_checks)
        result.passed_checks = sum(1 for c in evaluated_checks if c.status == "pass")
        result.failed_checks = sum(1 for c in evaluated_checks if c.status == "fail")
        result.warning_checks = sum(1 for c in evaluated_checks if c.status == "warn")
        result.checks = [asdict(c) for c in evaluated_checks]

        if result.failed_checks > 0:
            result.is_valid_content = False

        # Generate Explainable Findings for Fails and Warnings
        for c in evaluated_checks:
            if c.status == "fail":
                result.findings.append({
                    "type": f"content_check_failed_{c.check_name}",
                    "severity": "high",
                    "title": f"Quality Check Failed: {c.title}",
                    "description": c.description,
                    "evidence": c.evidence,
                })
            elif c.status == "warn":
                result.findings.append({
                    "type": f"content_check_warning_{c.check_name}",
                    "severity": "medium",
                    "title": f"Quality Check Warning: {c.title}",
                    "description": c.description,
                    "evidence": c.evidence,
                })

        return result


def run_content_quality_checks(
    raw_html: str | None = None,
    text_content: str | None = None,
    title: str | None = None,
    headings: list[Any] | None = None,
) -> ContentQualityChecksResult:
    """Convenience function to run content quality checks."""
    checker = ContentQualityChecker()
    return checker.run_checks(
        raw_html=raw_html,
        text_content=text_content,
        title=title,
        headings=headings,
    )
