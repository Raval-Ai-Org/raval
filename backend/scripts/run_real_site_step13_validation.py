"""
Step 13 Real-Site Verification and Diagnostics Runner for Authority, Citation & Trust Intelligence
(Day 8 - Phase B - Step 13 ONLY)

Executes the unified Authority, Citation & Trust Intelligence pipeline across 5 diverse real-world web pages:
1. Strong organization / about page (https://www.python.org/psf/)
2. Article / blog page with author & byline (https://martinfowler.com/articles/microservices.html)
3. Technical informational page with factual assertions (https://docs.python.org/3/whatsnew/3.13.html)
4. Page containing external references & academic citations (https://www.w3.org/TR/wot-architecture/)
5. Page with weak or minimal trust / authority signals (http://example.com/)

Performs manual & automated inspection of:
- Trust signals
- Authority signals
- External sources
- Support-needed claims
- Source quality
- First-party transparency
- Citation readiness
- Actionable findings & recommendations
"""

import gzip
import json
import os
import sys
import urllib.request
from typing import Any

current_dir = os.path.dirname(os.path.abspath(__file__))
backend_dir = os.path.dirname(current_dir)
repo_root = os.path.dirname(backend_dir)
if repo_root not in sys.path:
    sys.path.insert(0, repo_root)
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from app.authority_citation_recommendations import (
    analyze_direct_authority_citation_trust,
    map_result_to_findings_and_recommendations,
)
from app.authority_citation_schemas import AuthorityCitationTrustResult
from app.authority_engine import analyze_authority_signals
from app.citation_readiness_engine import CitationReadinessEngine
from app.claim_support_engine import analyze_claim_support
from app.page_extractor import extract_html
from app.schemas import DirectAuthorityCitationAnalysisRequest
from app.source_engine import detect_external_sources
from app.source_quality_engine import evaluate_source_quality
from app.transparency_engine import analyze_first_party_transparency
from app.trust_engine import analyze_trust_signals


TARGET_REAL_PAGES = [
    {
        "url": "https://www.python.org/psf/",
        "page_type": "1_strong_organization_about_page",
        "description": "Python Software Foundation (PSF) official organization and mission page",
    },
    {
        "url": "https://martinfowler.com/articles/microservices.html",
        "page_type": "2_article_with_author_byline",
        "description": "Foundational engineering essay authored by Martin Fowler and James Lewis",
    },
    {
        "url": "https://docs.python.org/3/whatsnew/3.13.html",
        "page_type": "3_technical_informational_page",
        "description": "Python 3.13 technical release documentation with factual assertions and performance data",
    },
    {
        "url": "https://www.w3.org/TR/wot-architecture/",
        "page_type": "4_page_with_external_references_and_citations",
        "description": "W3C Web of Things Architecture Standard with bibliography and normative references",
    },
    {
        "url": "http://example.com/",
        "page_type": "5_weak_minimal_trust_authority_page",
        "description": "IANA Example domain with minimal content, no author, and basic informational layout",
    },
]


def fetch_html(url: str, timeout: int = 15) -> tuple[int, str]:
    """Fetch live HTML content with standard browser user agent headers."""
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 RavalGeoBot/1.0",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Encoding": "gzip, deflate",
    }
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            status_code = response.status
            raw = response.read()
            if response.info().get("Content-Encoding") == "gzip" or raw[:2] == b"\x1f\x8b":
                raw = gzip.decompress(raw)
            charset = response.headers.get_content_charset() or "utf-8"
            html = raw.decode(charset, errors="replace")
            return status_code, html
    except Exception as exc:
        print(f"Warning: Fetch failed for {url} ({exc}). Using offline fallback if available.")
        return 0, ""


def evaluate_single_page(url: str, page_type: str, description: str, html: str) -> dict[str, Any]:
    """Run full intelligence pipeline on page HTML and return structured evaluation diagnostics."""
    extraction = extract_html(html, page_url=url)

    req = DirectAuthorityCitationAnalysisRequest(
        url=url,
        html=html,
    )
    result = analyze_direct_authority_citation_trust(req)

    return {
        "url": url,
        "page_type": page_type,
        "description": description,
        "word_count": extraction.word_count,
        "title": extraction.title_text,
        "headings_count": len(extraction.headings),
        "links_count": len(extraction.links),
        "structured_data_types": [b.get("schema_type") for b in extraction.structured_data if isinstance(b, dict)],
        "trust_signals_count": len(result.trust_signals),
        "authority_signals_count": len(result.authority_signals),
        "external_sources_count": len(result.external_sources),
        "claims_detected_count": len(result.support_needed_claims),
        "readiness_level": result.citation_readiness.readiness_level,
        "has_verifiable_sources": result.citation_readiness.has_verifiable_sources,
        "positive_signals": result.citation_readiness.positive_signals,
        "negative_signals": result.citation_readiness.negative_signals,
        "findings_count": len(result.findings),
        "recommendations_count": len(result.recommendations),
        "finding_types": [f.finding_type for f in result.findings],
    }


def run_all_real_site_validations():
    """Iterates through target real-world pages, runs diagnostics, and prints summary."""
    print("=" * 80)
    print("STEP 13: REAL-SITE VALIDATION RUNNER")
    print("=" * 80)

    reports = []
    for item in TARGET_REAL_PAGES:
        url = item["url"]
        ptype = item["page_type"]
        desc = item["description"]
        print(f"\n[Fetching & Evaluating] {ptype} -> {url}")

        status_code, html = fetch_html(url)
        if not html:
            print(f"Skipping live fetch for {url} (status: {status_code})")
            continue

        report = evaluate_single_page(url=url, page_type=ptype, description=desc, html=html)
        reports.append(report)

        print(f"  - Title: {report['title']}")
        print(f"  - Words: {report['word_count']} | Headings: {report['headings_count']} | Links: {report['links_count']}")
        print(f"  - Trust Signals: {report['trust_signals_count']} | Authority Signals: {report['authority_signals_count']}")
        print(f"  - External Sources: {report['external_sources_count']} | Claims Detected: {report['claims_detected_count']}")
        print(f"  - Citation Readiness Level: {report['readiness_level'].upper()} (Has Sources: {report['has_verifiable_sources']})")
        print(f"  - Findings ({report['findings_count']}): {report['finding_types']}")

    return reports


if __name__ == "__main__":
    run_all_real_site_validations()
