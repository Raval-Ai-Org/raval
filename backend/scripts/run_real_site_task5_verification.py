"""
Task 5 Real-Site Verification & Diagnostics Runner

Runs a conservative crawl and full Content Intelligence analysis against
https://www.python.org/, capturing detailed outputs across:
- Topics & Subtopics
- Entities
- Questions & Answers
- Answer Readiness
- Content Gaps
- Search Intent
- Semantic Coverage
- Quality Evidence
- Structured Data Parity
- Explainable Findings
"""

import json
import os
import sys

current_dir = os.path.dirname(os.path.abspath(__file__))
backend_dir = os.path.dirname(current_dir)
repo_root = os.path.dirname(backend_dir)
if repo_root not in sys.path:
    sys.path.insert(0, repo_root)
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)


from app.content_intelligence_analyzer import analyze_content_intelligence
from app.content_quality_checks import run_content_quality_checks
from app.database import SessionLocal
from app.models import Finding, PageExtraction, PageResult, Scan, Website
from app.page_extractor import extract_html
from app.services import run_full_page_content_pipeline
import urllib.request
import gzip


SAMPLE_URLS = [
    "https://www.python.org/",
    "https://www.python.org/about/",
    "https://www.python.org/about/help/",
    "https://www.python.org/about/gettingstarted/",
]


def fetch_page_content(url: str, timeout: int = 10) -> tuple[int, str]:
    headers = {
        "User-Agent": "RavalContentIntelligenceBot/1.0 (Verification; +https://raval.ai)",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Encoding": "gzip, deflate",
    }
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=timeout) as response:
        status_code = response.status
        raw = response.read()
        if response.info().get("Content-Encoding") == "gzip" or raw[:2] == b"\x1f\x8b":
            raw = gzip.decompress(raw)
        charset = response.headers.get_content_charset() or "utf-8"
        html = raw.decode(charset, errors="replace")
        return status_code, html


def run_diagnostics():
    db = SessionLocal()
    try:
        website = Website(name="Python.org Real-Site Verification", url="https://www.python.org/")
        db.add(website)
        db.commit()
        db.refresh(website)

        scan = Scan(website_id=website.id, status="running")
        db.add(scan)
        db.commit()
        db.refresh(scan)

        reports = []

        for url in SAMPLE_URLS:
            try:
                status, html = fetch_page_content(url)
            except Exception as exc:
                print(f"Failed to fetch {url}: {exc}")
                continue

            page = PageResult(
                scan_id=scan.id,
                url=url,
                status_code=status,
                content=html,
            )
            db.add(page)
            db.commit()
            db.refresh(page)

            # Run extraction
            ext = extract_html(html, content_type="text/html", page_url=url)
            extraction_rec = PageExtraction(
                page_result_id=page.id,
                scan_id=scan.id,
                title_text=ext.title_text,
                h1_count=ext.h1_count,
            )
            db.add(extraction_rec)
            db.commit()

            # Run full content pipeline
            result = run_full_page_content_pipeline(db, page.id, persist_all=True)
            ci = result["content_intelligence"]
            qc = result["quality_checks"]

            report_entry = {
                "page_id": page.id,
                "url": url,
                "title": ext.title_text,
                "word_count": ci["word_count"],
                "overall_score": ci["overall_content_score"],
                "content_status": ci["content_status"],
                "primary_topic": ci["primary_topic"],
                "primary_intent": ci["primary_intent"],
                "intent_confidence": ci["intent_confidence"],
                "total_questions": ci["total_questions"],
                "answered_questions": ci["answered_questions"],
                "unanswered_questions": ci["unanswered_questions"],
                "answer_readiness_score": ci["answer_readiness_score"],
                "answer_readiness_level": ci["answer_readiness_level"],
                "total_gaps": ci["total_gaps"],
                "entity_count": ci["entity_count"],
                "evidence_quality_score": ci["evidence_quality_score"],
                "semantic_coverage_score": ci["semantic_coverage_score"],
                "is_valid_content": qc["is_valid_content"],
                "failed_checks_count": qc["failed_checks"],
                "passed_checks_count": qc["passed_checks"],
                "key_strengths": ci["key_strengths"],
                "critical_issues": ci["critical_issues"],
                "findings_count": len(ci["findings"]),
                "findings": ci["findings"],
                "components": ci["component_summaries"],
            }
            reports.append(report_entry)

        scan.status = "completed"
        db.commit()

        print(json.dumps(reports, indent=2))
        return reports
    finally:
        db.close()


if __name__ == "__main__":
    run_diagnostics()
