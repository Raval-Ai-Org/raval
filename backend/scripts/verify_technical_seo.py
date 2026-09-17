"""Real-Site Verification Script for the Task 5 Technical-SEO rule engine.

Fetches a single real web page (default https://www.python.org/), runs the
Task 4 extraction, then runs the *pure* Task 5 rule engine over that evidence
with NO database (the duck-typed dataclass path documented in
``app.technical_seo.base``). It reports every finding — rule id, severity,
page, evidence, recommendation — and applies the spec §23 false-positive
controls so the run proves the engine does not fabricate findings:

* No broken-internal-link finding may fire without crawl evidence. A single
  fetched page has no crawled link targets, so ``SEO-LINK-004`` must NOT fire
  ("never claim a link is broken without status evidence").
* External links must never be treated as internal/broken.
* Every finding must be explainable: known rule id, valid severity, a
  recommendation, and an evidence dict.
* Findings must be deterministic — re-running the engine on the same evidence
  yields the identical (rule_id, page) multiset.

``success`` is True only when the page was fetched live AND no false positive
was detected (mirrors the Task 4 verifier's all-passed semantics). When the
network is unreachable the caller falls back to the deterministic offline
snapshot in ``tests/test_technical_seo_real_site.py``.
"""

from datetime import datetime, timezone
import sys
from types import SimpleNamespace
from urllib.parse import urlparse

from app.page_extractor import _normalize_url, extract_html
from app.technical_seo import RuleContext, ScanContext, build_summary, run_page_rules

# Reuse the Task 4 verifier's fetch so the two scripts never drift.
from backend.scripts.verify_real_site import fetch_single_page

VALID_SEVERITIES = {"info", "low", "medium", "high", "critical"}


def _page_from_fetch(url: str, status_code: int) -> SimpleNamespace:
    """A minimal PageResult stand-in for the no-DB engine path.

    Exposes exactly the attributes ``ScanContext``/``RuleContext`` read via
    ``getattr`` (id/url/final_url/status_code/content_type/error/
    robots_txt_allowed). A verifier fetch that returns 2xx HTML with no
    redirect uses ``final_url == url``.
    """
    return SimpleNamespace(
        id=1,
        url=url,
        final_url=url,
        status_code=status_code,
        content_type="text/html",
        error=None,
        robots_txt_allowed=True,
    )


def analyze_single_page(url: str, status_code: int, html: str):
    """Run extraction + the full rule engine on one page (no database).

    Returns ``(findings, summary, extraction)`` where ``findings`` is the list
    of ``RuleFinding`` DTOs. The ``ScanContext`` holds only this page, exactly
    as a one-page scan would, which is what makes the broken-link control
    meaningful: no link target is present in ``url_status``.
    """
    ext = extract_html(html, content_type="text/html", page_url=url)
    page = _page_from_fetch(url, status_code)
    scan_ctx = ScanContext([(page, ext)], scan_id=None, website_id=None)
    rule_ctx = RuleContext(page, ext, scan_ctx)
    findings = run_page_rules(rule_ctx)
    summary = build_summary(
        [(f.category, f.severity) for f in findings],
        pages_analyzed=1,
    )
    return findings, summary, ext


def _detect_false_positives(findings, ext) -> list[str]:
    """Apply the spec §23 mechanical false-positive controls.

    Returns a list of human-readable FP descriptions; an empty list means the
    run is clean. These are deliberately conservative — they flag only the
    two failure modes the plan calls out, never a legitimate finding.
    """
    problems: list[str] = []

    # 1. Broken-internal-link must not fire without crawl evidence. On a single
    #    fetched page every link target is uncrawled, so the rule must be silent.
    broken = [f for f in findings if f.rule_id == "SEO-LINK-004"]
    if broken:
        problems.append(
            f"SEO-LINK-004 fired {len(broken)}x without scan crawl evidence "
            "(single-page context has no crawled link targets)."
        )

    # 2. External links must never be reported as broken/internal. Collect the
    #    external destinations, then ensure no finding's evidence references one.
    external_urls = {
        _normalize_url(getattr(l, "destination_url", None))
        for l in (getattr(ext, "links", []) or [])
        if getattr(l, "link_type", None) == "external"
    }
    external_urls.discard(None)
    for f in findings:
        blob = repr(getattr(f, "evidence", {}) or {})
        for ex_url in external_urls:
            if ex_url and ex_url in blob:
                problems.append(
                    f"{f.rule_id} evidence references external URL {ex_url} "
                    "— externals must not be flagged."
                )
                break

    return problems


def _explainability_gaps(findings) -> list[str]:
    """Every finding must be page-anchored and fully explainable (spec §19)."""
    gaps: list[str] = []
    for f in findings:
        if not f.rule_id:
            gaps.append("finding with empty rule_id")
        if f.severity not in VALID_SEVERITIES:
            gaps.append(f"{f.rule_id}: invalid severity {f.severity!r}")
        if not f.recommendation:
            gaps.append(f"{f.rule_id}: missing recommendation")
        if not isinstance(f.evidence, dict):
            gaps.append(f"{f.rule_id}: evidence is not a dict")
    return gaps


def run_verification(target_url: str = "https://www.python.org/") -> dict:
    timestamp = datetime.now(timezone.utc).isoformat()
    lines = [
        "TECHNICAL-SEO REAL SITE VERIFICATION",
        "====================================",
        f"URL: {target_url}",
        f"Timestamp (UTC): {timestamp}",
        "",
    ]

    try:
        status_code, html = fetch_single_page(target_url)
        lines.append(f"HTTP Status: {status_code} (Fetch Succeeded)")
    except Exception as exc:
        lines.append(f"HTTP Fetch Failed: {exc}")
        return {
            "success": False,
            "live": False,
            "error": str(exc),
            "report": "\n".join(lines),
        }

    findings, summary, ext = analyze_single_page(target_url, status_code, html)

    # Re-run to confirm determinism (same evidence -> same findings multiset).
    findings2, _, _ = analyze_single_page(target_url, status_code, html)
    sig1 = sorted((f.rule_id, target_url) for f in findings)
    sig2 = sorted((f.rule_id, target_url) for f in findings2)
    deterministic = sig1 == sig2

    false_positives = _detect_false_positives(findings, ext)
    gaps = _explainability_gaps(findings)

    lines.append("")
    lines.append(f"Findings: {len(findings)}  "
                 f"(provisional overall health: {summary['provisional_overall_health']})")
    lines.append(f"Worst category: {summary['worst_category']}")
    lines.append("")
    for f in sorted(findings, key=lambda x: (x.category or "", x.rule_id or "")):
        lines.append(f"  [{(f.severity or '').upper():<8}] {f.rule_id}  ({f.category})")
        lines.append(f"      what:  {f.message}")
        if f.recommendation:
            lines.append(f"      next:  {f.recommendation}")
        if f.evidence:
            ev = ", ".join(f"{k}={v!r}" for k, v in list(f.evidence.items())[:4])
            lines.append(f"      evid:  {ev}")
    lines.append("")

    lines.append("False-positive controls (spec sec.23):")
    lines.append(f"  broken-link without crawl evidence: "
                 f"{'FALSE POSITIVE' if any('SEO-LINK-004' in p for p in false_positives) else 'clean'}")
    lines.append(f"  external links not flagged:          "
                 f"{'FALSE POSITIVE' if any('external' in p for p in false_positives) else 'clean'}")
    lines.append(f"  all findings explainable:            {'yes' if not gaps else 'NO'}")
    lines.append(f"  deterministic re-run:                {'yes' if deterministic else 'NO'}")
    lines.append("")

    success = not false_positives and not gaps and deterministic
    lines.append("Final Result:")
    lines.append(f"  {'PASS' if success else 'FAIL'}")

    return {
        "success": success,
        "live": True,
        "url": target_url,
        "timestamp": timestamp,
        "status_code": status_code,
        "findings": [
            {
                "rule_id": f.rule_id,
                "category": f.category,
                "severity": f.severity,
                "message": f.message,
                "recommendation": f.recommendation,
                "evidence": f.evidence,
                "page_url": target_url,
            }
            for f in findings
        ],
        "summary": summary,
        "false_positives": false_positives,
        "explainability_gaps": gaps,
        "deterministic": deterministic,
        "report": "\n".join(lines),
    }


if __name__ == "__main__":
    target = sys.argv[1] if len(sys.argv) > 1 else "https://www.python.org/"
    res = run_verification(target)
    print(res["report"])
    sys.exit(0 if res["success"] else 1)
