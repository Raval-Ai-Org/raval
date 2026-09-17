"""
Real-Site Scoring & Intelligence Pipeline Validation Tool (Task 8 - Step 8.9)

Validates the full Task 8 scoring and intelligence pipeline against diverse real-world
page types (Homepage, About/Organization, Documentation/Guide, Legal/Privacy).

Features:
- Live HTTP/HTTPS fetching with resilient headers, timeout, and gzip handling.
- Deterministic offline HTML fallback for 100% offline reliability.
- End-to-end execution of:
  Extraction -> Normalization -> Aggregation -> Applicability -> Scoring ->
  Priority & Recommendations -> Score Explanation -> Site Aggregation.
- Formatted human-readable report & JSON analytics output.
"""

from datetime import datetime, timezone
import gzip
import json
import os
import sys
import time
import urllib.request

# Ensure app package is importable
current_dir = os.path.dirname(os.path.abspath(__file__))
backend_dir = os.path.dirname(current_dir)
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from app.applicability_engine import ApplicabilityContext, evaluate_applicability
from app.page_extractor import extract_html
from app.priority_engine import generate_prioritized_recommendations
from app.score_explanation import build_page_analytics, explain_score, ScoreExplanationEngine
from app.scoring_engine import calculate_deterministic_score
from app.signal_aggregator import aggregate_signals
from app.site_aggregator import aggregate_site_scores
from app.unified_signal import normalize_signal


# =============================================================================
# Deterministic Real-World Offline HTML Fixtures
# =============================================================================

OFFLINE_PAGE_FIXTURES: dict[str, dict[str, str]] = {
    "homepage": {
        "url": "https://www.python.org/",
        "page_type": "homepage",
        "html": """<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <title>Welcome to Python.org</title>
    <meta name="description" content="The official home of the Python Programming Language, open source software and community.">
    <script type="application/ld+json">
    {
        "@context": "https://schema.org",
        "@type": "Organization",
        "name": "Python Software Foundation",
        "url": "https://www.python.org/",
        "logo": "https://www.python.org/static/img/python-logo.png"
    }
    </script>
</head>
<body>
    <header>
        <nav><a href="/">Home</a><a href="/about/">About</a><a href="/docs/">Docs</a></nav>
    </header>
    <main>
        <h1>Welcome to Python Programming</h1>
        <p>Python is a versatile programming language that lets you work quickly and integrate systems more effectively.</p>
        <h2>Why Python?</h2>
        <p>Python is powerful and fast; plays well with others; runs everywhere; is friendly and easy to learn; is Open.</p>
        <h2>Get Started</h2>
        <p>Whether you are new to programming or an experienced developer, it's easy to learn and use Python.</p>
    </main>
    <footer>
        <p>© 2001-2026 Python Software Foundation. Legal Notices and Privacy Policy available.</p>
    </footer>
</body>
</html>""",
    },
    "about": {
        "url": "https://www.python.org/about/",
        "page_type": "about",
        "html": """<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <title>About the Python Software Foundation</title>
    <meta name="description" content="About the mission, executive leadership, and community of the Python Software Foundation.">
</head>
<body>
    <main>
        <h1>About the Python Software Foundation</h1>
        <p>The mission of the Python Software Foundation is to promote, protect, and advance the Python programming language.</p>
        <h2>Executive Leadership and Board</h2>
        <p>Written by the PSF Executive Directorate. Published on January 15, 2025.</p>
        <p>The Foundation supports and facilitates the growth of a diverse and international community of Python programmers.</p>
        <h2>Contact Information</h2>
        <p>Email: psf@python.org | Address: 9450 SW Gemini Dr., Beaverton, OR 97008 USA</p>
    </main>
</body>
</html>""",
    },
    "documentation": {
        "url": "https://docs.python.org/3/",
        "page_type": "documentation",
        "html": """<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <title>3.14 Documentation - Python Documentation</title>
    <meta name="description" content="Official documentation for Python 3 standard library, tutorials, and language reference.">
</head>
<body>
    <main>
        <h1>Python 3 Documentation</h1>
        <p>Welcome to Python documentation. Browse tutorials, library references, and language specifications.</p>
        <h2>What's New in Python 3?</h2>
        <p>Detailed overview of new syntax features, performance optimizations, and standard library updates.</p>
        <h2>Tutorial & Reference Guide</h2>
        <p>Start with the official tutorial for beginners or explore standard library modules for advanced development.</p>
    </main>
</body>
</html>""",
    },
    "legal_privacy": {
        "url": "https://www.python.org/privacy/",
        "page_type": "legal_privacy",
        "html": """<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <title>Privacy Policy - Python Software Foundation</title>
    <meta name="description" content="Privacy policy and data protection practices for Python.org and PSF web properties.">
</head>
<body>
    <main>
        <h1>Privacy Policy</h1>
        <p>Last updated: January 1, 2026. This Privacy Policy describes how the Python Software Foundation collects and uses information.</p>
        <h2>Information Collection and Use</h2>
        <p>We do not sell personal information to third parties. We use server logs strictly for site reliability and telemetry.</p>
        <h2>Cookies and Analytics</h2>
        <p>Our website uses strictly necessary session cookies to maintain your preferences.</p>
    </main>
</body>
</html>""",
    },
}


def fetch_url(url: str, timeout: int = 6) -> tuple[int, str, bool]:
    """
    Attempts to fetch a live webpage over HTTP/HTTPS.
    Returns: (status_code, html_content, is_live_fetch)
    """
    headers = {
        "User-Agent": "RavalScoringIntelligenceBot/1.0 (+https://raval.ai; Quality Verification)",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Encoding": "gzip, deflate",
    }
    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            code = resp.status
            raw = resp.read()
            if resp.info().get("Content-Encoding") == "gzip" or raw[:2] == b"\x1f\x8b":
                raw = gzip.decompress(raw)
            charset = resp.headers.get_content_charset() or "utf-8"
            html = raw.decode(charset, errors="replace")
            return code, html, True
    except Exception:
        return 0, "", False


def validate_single_page(
    target_key: str,
    target_info: dict[str, str],
    allow_live_network: bool = True,
) -> dict:
    """
    Validates end-to-end intelligence extraction, scoring, recommendations,
    and explanations for a single web page.
    """
    url = target_info["url"]
    expected_page_type = target_info.get("page_type", "general")
    fallback_html = target_info["html"]

    start_time = time.perf_counter()
    live_fetch = False
    status_code = 200
    html = fallback_html

    if allow_live_network:
        code, live_html, ok = fetch_url(url)
        if ok and len(live_html.strip()) > 100:
            html = live_html
            status_code = code
            live_fetch = True

    # 1. Page Extraction
    extraction = extract_html(html, content_type="text/html", page_url=url)

    # 2. Signal Normalization
    raw_signals = []
    if extraction:
        norm_res = normalize_signal(extraction)
        if isinstance(norm_res, list):
            raw_signals.extend(norm_res)
        elif norm_res:
            raw_signals.append(norm_res)

    # 3. Signal Aggregation & Deduplication
    aggregated_collection = aggregate_signals(raw_signals)

    # 4. Applicability Evaluation
    context = ApplicabilityContext.from_page_data(
        url=url,
        text_content=extraction.get("main_text") if isinstance(extraction, dict) else "",
        raw_html=html,
        page_type=expected_page_type,
    )
    evaluated_signals = evaluate_applicability(aggregated_collection.signals, context=context)
    if not isinstance(evaluated_signals, list) and hasattr(evaluated_signals, "signals"):
        evaluated_signals = evaluated_signals.signals

    # 5. Deterministic Scoring
    score_result = calculate_deterministic_score(evaluated_signals, context=context)

    # 6. Priority & Recommendations
    recommendations = generate_prioritized_recommendations(score_result)

    # 7. Score Explanation
    explanation = explain_score(score_result, context=context)

    # 8. Page Analytics Record
    analytics = build_page_analytics(
        score_result=score_result,
        recommendations=recommendations,
        page_id=hash(url) % 100000,
        url=url,
        scan_id=1,
        website_id=1,
    )

    elapsed_ms = round((time.perf_counter() - start_time) * 1000, 2)

    return {
        "target_key": target_key,
        "url": url,
        "inferred_page_type": context.page_type,
        "live_fetch": live_fetch,
        "status_code": status_code,
        "html_length_bytes": len(html),
        "signals_count": len(evaluated_signals),
        "overall_score": score_result.overall_score,
        "score_status": score_result.status,
        "category_scores": {k: v.score for k, v in score_result.category_scores.items()},
        "penalties_count": score_result.total_penalties_applied,
        "recommendations_count": len(recommendations),
        "quick_wins_count": sum(1 for r in recommendations if r.classification == "quick_win"),
        "deep_fixes_count": sum(1 for r in recommendations if r.classification == "deep_fix"),
        "summary": explanation.summary,
        "elapsed_ms": elapsed_ms,
        "analytics": analytics,
        "recommendations": recommendations,
    }


def run_real_site_validation(
    allow_live_network: bool = True,
    targets: dict[str, dict[str, str]] | None = None,
) -> dict:
    """
    Executes real-site scoring validation across multiple distinct page types
    and produces a site-level aggregation report.
    """
    pages_to_test = targets or OFFLINE_PAGE_FIXTURES
    page_results = []
    all_analytics = []
    all_recommendations = []

    for key, info in pages_to_test.items():
        res = validate_single_page(key, info, allow_live_network=allow_live_network)
        page_results.append(res)
        all_analytics.append(res["analytics"])
        all_recommendations.extend(res["recommendations"])

    # Site-Level Aggregation
    site_summary = aggregate_site_scores(
        pages_analytics=all_analytics,
        website_id=1,
        scan_id=1,
        all_recommendations=all_recommendations,
    )

    return {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "total_pages_evaluated": len(page_results),
        "pages": page_results,
        "site_summary": site_summary.model_dump(),
    }


def print_validation_report(report: dict):
    """Prints a clean CLI validation summary."""
    print("=" * 80)
    print("RAVAL AI SEARCH INTELLIGENCE — REAL-SITE SCORING & PIPELINE VALIDATION (8.9)")
    print("=" * 80)
    print(f"Timestamp: {report['timestamp']}")
    print(f"Pages Evaluated: {report['total_pages_evaluated']}")
    print("-" * 80)

    for p in report["pages"]:
        mode_str = "LIVE NETWORK" if p["live_fetch"] else "OFFLINE FIXTURE"
        print(f"• [{p['inferred_page_type'].upper()}] {p['url']} ({mode_str})")
        print(f"  Score: {p['overall_score']:.1f}/100 ({p['score_status']}) | Time: {p['elapsed_ms']}ms")
        print(f"  Categories: {p['category_scores']}")
        print(f"  Recommendations: Total={p['recommendations_count']} (Quick Wins={p['quick_wins_count']}, Deep Fixes={p['deep_fixes_count']})")
        print(f"  Summary: {p['summary']}")
        print()

    site = report["site_summary"]
    page_scores = [p["overall_score"] for p in site.get("page_scores", [])]
    avg_score = sum(page_scores) / len(page_scores) if page_scores else site["overall_site_score"]
    min_score = min(page_scores) if page_scores else site["overall_site_score"]
    max_score = max(page_scores) if page_scores else site["overall_site_score"]

    print("=" * 80)
    print("SITE-LEVEL AGGREGATION SUMMARY")
    print("=" * 80)
    print(f"Overall Site Score: {site['overall_site_score']:.1f}/100 ({site['site_status']})")
    print(f"Average Page Score: {avg_score:.1f}/100 (Range: {min_score:.1f} - {max_score:.1f})")
    print(f"Total Pages Analyzed: {site['total_pages_analyzed']} (Applicable: {site['applicable_pages_count']})")
    print(f"Total Recommendations: {site['recommendations_summary'].get('total_recommendations', 0)}")
    print(f"Top Issues Count: {len(site.get('top_issues', []))}")
    for idx, issue in enumerate(site.get("top_issues", [])[:3], 1):
        print(f"  #{idx} [{issue['priority'].upper()}] {issue['title']} (Impact: {issue['total_score_impact']} pts across {issue['affected_pages_count']} pages)")
    print("=" * 80)


if __name__ == "__main__":
    report = run_real_site_validation(allow_live_network=True)
    print_validation_report(report)
