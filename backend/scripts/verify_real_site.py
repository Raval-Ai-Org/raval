"""
Real-Site Verification Script for Task 4 Page Extraction Engine.

Fetches a single real web page (https://www.python.org/), extracts page intelligence,
and compares extracted values against the actual HTML document.
"""

from datetime import datetime, timezone
import gzip
import html as html_lib
import re
import sys
from urllib.parse import urlparse
import urllib.request

from app.page_extractor import extract_html


def fetch_single_page(url: str, timeout: int = 10) -> tuple[int, str]:
    headers = {
        "User-Agent": "RavalIntelligenceBot/1.0 (Verification; +https://raval.ai)",
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


def strip_html_comments(html: str) -> str:
    """Remove HTML comments so baseline regex checks match active DOM elements only."""
    return re.sub(r"<!--.*?-->", "", html, flags=re.DOTALL)


def run_verification(target_url: str = "https://www.python.org/") -> dict:
    timestamp = datetime.now(timezone.utc).isoformat()
    report_lines = []
    report_lines.append("REAL SITE VERIFICATION")
    report_lines.append("======================")
    report_lines.append(f"URL: {target_url}")
    report_lines.append(f"Timestamp (UTC): {timestamp}")
    report_lines.append("")

    all_passed = True
    results = {}

    try:
        status_code, html = fetch_single_page(target_url)
        report_lines.append(f"HTTP Status: {status_code} OK (Fetch Succeeded)")
    except Exception as exc:
        report_lines.append(f"HTTP Fetch Failed: {exc}")
        return {
            "success": False,
            "error": str(exc),
            "report": "\n".join(report_lines),
        }

    # Clean HTML of comments for raw DOM baseline matching
    clean_dom_html = strip_html_comments(html)

    # Run our extraction engine
    ext = extract_html(html, content_type="text/html", page_url=target_url)

    # 1. Title Verification
    raw_title_match = re.search(r"<title[^>]*>(.*?)</title>", clean_dom_html, re.IGNORECASE | re.DOTALL)
    raw_title = html_lib.unescape(re.sub(r"\s+", " ", raw_title_match.group(1))).strip() if raw_title_match else None
    title_match = ext.title_text == raw_title
    all_passed = all_passed and title_match
    results["title"] = {
        "actual": raw_title,
        "extracted": ext.title_text,
        "match": title_match,
    }
    report_lines.append("Title:")
    report_lines.append(f"  Actual:    {raw_title}")
    report_lines.append(f"  Extracted: {ext.title_text}")
    report_lines.append(f"  Result:    {'MATCH' if title_match else 'MISMATCH'}")
    report_lines.append("")

    # 2. Meta Description Verification
    raw_desc_match = re.search(r'<meta[^>]+name=["\']description["\'][^>]+content=["\']([^"\']*)["\']', clean_dom_html, re.IGNORECASE)
    if not raw_desc_match:
        raw_desc_match = re.search(r'<meta[^>]+content=["\']([^"\']*)["\'][^>]+name=["\']description["\']', clean_dom_html, re.IGNORECASE)
    raw_desc = html_lib.unescape(raw_desc_match.group(1)).strip() if raw_desc_match else None

    extracted_desc = ext.meta_descriptions[0].text if ext.meta_descriptions else None
    desc_match = (raw_desc == extracted_desc) if raw_desc else (extracted_desc is None)
    all_passed = all_passed and desc_match
    results["meta_description"] = {
        "actual": raw_desc or "not present",
        "extracted": extracted_desc or "not present",
        "match": desc_match,
    }
    report_lines.append("Meta Description:")
    report_lines.append(f"  Actual:    {raw_desc or 'not present'}")
    report_lines.append(f"  Extracted: {extracted_desc or 'not present'}")
    report_lines.append(f"  Result:    {'MATCH' if desc_match else 'MISMATCH'}")
    report_lines.append("")

    # 3. H1 Headings Verification
    raw_h1_matches = [
        html_lib.unescape(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", m))).strip()
        for m in re.findall(r"<h1[^>]*>(.*?)</h1>", clean_dom_html, re.IGNORECASE | re.DOTALL)
    ]
    extracted_h1s = [h.text for h in ext.headings if h.level == 1]
    h1_match = raw_h1_matches == extracted_h1s
    all_passed = all_passed and h1_match
    results["h1"] = {
        "actual": raw_h1_matches,
        "extracted": extracted_h1s,
        "match": h1_match,
    }
    report_lines.append("H1 Headings:")
    report_lines.append(f"  Actual:    {raw_h1_matches or 'not present'}")
    report_lines.append(f"  Extracted: {extracted_h1s or 'not present'}")
    report_lines.append(f"  Result:    {'MATCH' if h1_match else 'MISMATCH'}")
    report_lines.append("")

    # 4. Canonical Verification
    raw_canon_match = re.search(r'<link[^>]+rel=["\']canonical["\'][^>]+href=["\']([^"\']*)["\']', clean_dom_html, re.IGNORECASE)
    if not raw_canon_match:
        raw_canon_match = re.search(r'<link[^>]+href=["\']([^"\']*)["\'][^>]+rel=["\']canonical["\']', clean_dom_html, re.IGNORECASE)
    raw_canon = raw_canon_match.group(1).strip() if raw_canon_match else None
    extracted_canon = ext.canonicals[0].url if ext.canonicals else None
    canon_match = (raw_canon == extracted_canon) if raw_canon else (extracted_canon is None)
    all_passed = all_passed and canon_match
    results["canonical"] = {
        "actual": raw_canon or "not present",
        "extracted": extracted_canon or "not present",
        "match": canon_match,
    }
    report_lines.append("Canonical:")
    report_lines.append(f"  Actual:    {raw_canon or 'not present'}")
    report_lines.append(f"  Extracted: {extracted_canon or 'not present'}")
    report_lines.append(f"  Result:    {'MATCH' if canon_match else 'MISMATCH'}")
    report_lines.append("")

    # 5. Robots Verification
    raw_robots_match = re.search(r'<meta[^>]+name=["\']robots["\'][^>]+content=["\']([^"\']*)["\']', clean_dom_html, re.IGNORECASE)
    raw_robots = raw_robots_match.group(1).strip() if raw_robots_match else None
    extracted_robots = ext.robots.raw_content if ext.robots else None
    robots_match = (raw_robots == extracted_robots) if raw_robots else (extracted_robots is None)
    all_passed = all_passed and robots_match
    results["robots"] = {
        "actual": raw_robots or "not present",
        "extracted": extracted_robots or "not present",
        "match": robots_match,
    }
    report_lines.append("Robots Directives:")
    report_lines.append(f"  Actual:    {raw_robots or 'not present'}")
    report_lines.append(f"  Extracted: {extracted_robots or 'not present'}")
    report_lines.append(f"  Result:    {'MATCH' if robots_match else 'MISMATCH'}")
    report_lines.append("")

    # 6. Open Graph & Twitter / X Metadata Verification
    raw_og_tags = re.findall(r'<meta[^>]+(?:property|name)=["\'](og:[^"\']+)["\'][^>]+content=["\']([^"\']*)["\']', clean_dom_html, re.IGNORECASE)
    raw_tw_tags = re.findall(r'<meta[^>]+(?:name|property)=["\'](twitter:[^"\']+)["\'][^>]+content=["\']([^"\']*)["\']', clean_dom_html, re.IGNORECASE)
    expected_social_count = len(raw_og_tags) + len(raw_tw_tags)
    social_match = len(ext.social_metadata) == expected_social_count
    all_passed = all_passed and social_match
    results["social_metadata"] = {
        "actual_count": expected_social_count,
        "extracted_count": len(ext.social_metadata),
        "match": social_match,
    }
    report_lines.append("Social Metadata (Open Graph & Twitter):")
    report_lines.append(f"  Actual count:    {expected_social_count}")
    report_lines.append(f"  Extracted count: {len(ext.social_metadata)}")
    report_lines.append(f"  Result:          {'MATCH' if social_match else 'MISMATCH'}")
    report_lines.append("")

    # 7. JSON-LD Structured Data Verification
    raw_json_ld_blocks = re.findall(r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>(.*?)</script>', clean_dom_html, re.IGNORECASE | re.DOTALL)
    json_ld_match = len(raw_json_ld_blocks) == len(ext.structured_data)
    all_passed = all_passed and json_ld_match
    results["json_ld"] = {
        "actual_block_count": len(raw_json_ld_blocks),
        "extracted_block_count": len(ext.structured_data),
        "match": json_ld_match,
    }
    report_lines.append("JSON-LD Structured Data:")
    report_lines.append(f"  Actual blocks:    {len(raw_json_ld_blocks)}")
    report_lines.append(f"  Extracted blocks: {len(ext.structured_data)}")
    if ext.structured_data:
        report_lines.append(f"  Extracted types:  {ext.structured_data[0].types}")
        report_lines.append(f"  Parse error:      {ext.structured_data[0].parse_error}")
    report_lines.append(f"  Result:           {'MATCH' if json_ld_match else 'MISMATCH'}")
    report_lines.append("")

    # 8. HTML Language Verification
    raw_lang_match = re.search(r'<html[^>]+lang=["\']([^"\']+)["\']', clean_dom_html, re.IGNORECASE)
    raw_lang = raw_lang_match.group(1).strip() if raw_lang_match else None
    lang_match = ext.html_lang == raw_lang
    all_passed = all_passed and lang_match
    results["language"] = {
        "actual": raw_lang or "not present",
        "extracted": ext.html_lang or "not present",
        "match": lang_match,
    }
    report_lines.append("HTML Language:")
    report_lines.append(f"  Actual:    {raw_lang or 'not present'}")
    report_lines.append(f"  Extracted: {ext.html_lang or 'not present'}")
    report_lines.append(f"  Result:    {'MATCH' if lang_match else 'MISMATCH'}")
    report_lines.append("")

    # 9. Hreflang Verification
    raw_hreflang_tags = re.findall(r'<link[^>]+rel=["\']alternate["\'][^>]+hreflang=["\']([^"\']+)["\']', clean_dom_html, re.IGNORECASE)
    hreflang_match = len(raw_hreflang_tags) == len(ext.hreflang)
    all_passed = all_passed and hreflang_match
    results["hreflang"] = {
        "actual_count": len(raw_hreflang_tags),
        "extracted_count": len(ext.hreflang),
        "match": hreflang_match,
    }
    report_lines.append("Hreflang Declarations:")
    report_lines.append(f"  Actual count:    {len(raw_hreflang_tags)}")
    report_lines.append(f"  Extracted count: {len(ext.hreflang)}")
    report_lines.append(f"  Result:          {'MATCH' if hreflang_match else 'MISMATCH'}")
    report_lines.append("")

    # 10. Images Verification
    raw_img_tags = re.findall(r"<img\b[^>]*>", clean_dom_html, re.IGNORECASE)
    img_match = len(raw_img_tags) == ext.image_count
    all_passed = all_passed and img_match
    results["images"] = {
        "actual_count": len(raw_img_tags),
        "extracted_count": ext.image_count,
        "without_alt": ext.images_without_alt,
        "match": img_match,
    }
    report_lines.append("Images:")
    report_lines.append(f"  Actual tags:        {len(raw_img_tags)}")
    report_lines.append(f"  Extracted count:    {ext.image_count}")
    report_lines.append(f"  Images without alt: {ext.images_without_alt}")
    report_lines.append(f"  Result:             {'MATCH' if img_match else 'MISMATCH'}")
    report_lines.append("")

    # 11. Links Verification
    raw_a_tags = re.findall(r"<a\b[^>]*>", clean_dom_html, re.IGNORECASE)
    links_match = len(raw_a_tags) == len(ext.links)
    all_passed = all_passed and links_match
    internal_count = sum(1 for l in ext.links if l.link_type == "internal")
    external_count = sum(1 for l in ext.links if l.link_type == "external")
    results["links"] = {
        "actual_count": len(raw_a_tags),
        "extracted_count": len(ext.links),
        "internal_count": internal_count,
        "external_count": external_count,
        "match": links_match,
    }
    report_lines.append("Links:")
    report_lines.append(f"  Actual <a> tags:  {len(raw_a_tags)}")
    report_lines.append(f"  Extracted links:  {len(ext.links)}")
    report_lines.append(f"  Internal links:   {internal_count}")
    report_lines.append(f"  External links:   {external_count}")
    report_lines.append(f"  Result:           {'MATCH' if links_match else 'MISMATCH'}")
    report_lines.append("")

    # 12. Clean Content Verification
    clean_text_valid = ext.clean_text_available and ext.word_count > 50 and "Python" in ext.clean_text
    all_passed = all_passed and clean_text_valid
    results["clean_content"] = {
        "clean_text_available": ext.clean_text_available,
        "word_count": ext.word_count,
        "sample": ext.clean_text[:120],
        "match": clean_text_valid,
    }
    report_lines.append("Clean Content:")
    report_lines.append(f"  Clean text available: {ext.clean_text_available}")
    report_lines.append(f"  Word count:           {ext.word_count}")
    report_lines.append(f"  Sample:               {ext.clean_text[:80]}...")
    report_lines.append(f"  Result:               {'MATCH' if clean_text_valid else 'MISMATCH'}")
    report_lines.append("")

    # Final Result
    final_verdict = "PASS" if all_passed else "FAIL"
    report_lines.append("Final Result:")
    report_lines.append(f"  {final_verdict}")

    full_report = "\n".join(report_lines)
    return {
        "success": all_passed,
        "url": target_url,
        "timestamp": timestamp,
        "details": results,
        "report": full_report,
    }


if __name__ == "__main__":
    target = sys.argv[1] if len(sys.argv) > 1 else "https://www.python.org/"
    res = run_verification(target)
    print(res["report"])
    sys.exit(0 if res["success"] else 1)
