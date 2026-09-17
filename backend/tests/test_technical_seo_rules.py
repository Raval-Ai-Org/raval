"""Unit tests for the pure technical-SEO rule engine (Task 5).

These run entirely through the no-DB dataclass path: real HTML is fed through
``page_extractor.extract_html`` and wrapped in a duck-typed ``RuleContext`` with
a lightweight page stand-in. They cover per-rule detection, the ownership
matrix (no double-emission), the spec's false-positive controls, and strict
per-scan isolation.
"""

from types import SimpleNamespace

from app.page_extractor import extract_html
from app.technical_seo import (
    RULE_REGISTRY,
    RuleContext,
    ScanContext,
    build_summary,
    run_page_rules,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
GOOD_HTML = """<!DOCTYPE html>
<html lang="en">
<head>
<title>A good descriptive page title here</title>
<meta name="description" content="This is a sufficiently long and descriptive meta description written to fit inside the recommended length range for tests.">
<link rel="canonical" href="http://e.com/good">
<meta property="og:title" content="T">
<meta property="og:description" content="D">
<meta property="og:image" content="http://e.com/i.png">
<meta property="og:url" content="http://e.com/good">
<meta name="twitter:card" content="summary">
</head>
<body>
<h1>Main heading</h1>
<h2>Sub heading</h2>
<p>Some meaningful content on the page.</p>
<a href="http://e.com/a">Alpha</a>
<a href="http://e.com/b">Bravo</a>
<a href="http://e.com/c">Charlie</a>
</body>
</html>"""


def make(html, url="http://e.com/p", status=200, content_type="text/html",
         error=None, robots_ok=True, final_url=None, pid=1):
    ext = extract_html(html, content_type=content_type, page_url=url)
    page = SimpleNamespace(
        id=pid, url=url, final_url=final_url if final_url is not None else url,
        status_code=status, content_type=content_type, error=error,
        robots_txt_allowed=robots_ok,
    )
    return page, ext


def fired(pairs, target=0):
    scan = ScanContext(list(pairs))
    page, ext = pairs[target]
    findings = run_page_rules(RuleContext(page, ext, scan))
    return findings


def ids(findings):
    return sorted({f.rule_id for f in findings})


# ---------------------------------------------------------------------------
# Registry integrity
# ---------------------------------------------------------------------------
def test_registry_has_all_categories_and_unique_ids():
    rule_ids = [r.rule_id for r in RULE_REGISTRY]
    assert len(rule_ids) == len(set(rule_ids)), "rule ids must be unique"
    assert len(RULE_REGISTRY) >= 50
    categories = {r.category for r in RULE_REGISTRY}
    assert categories == {
        "indexability", "http", "canonical", "robots", "title", "meta",
        "headings", "duplicates", "links", "images", "structured_data",
        "social", "language",
    }


def test_every_rule_declares_valid_severity():
    valid = {"info", "low", "medium", "high", "critical"}
    for r in RULE_REGISTRY:
        assert r.severity in valid, f"{r.rule_id} has bad severity {r.severity}"


def test_clean_page_produces_no_findings():
    findings = fired([make(GOOD_HTML, url="http://e.com/good")])
    assert ids(findings) == [], f"clean page should be quiet, got {ids(findings)}"


# ---------------------------------------------------------------------------
# Indexability + HTTP (ownership: HTTP owns status; INDEX owns noindex/robots)
# ---------------------------------------------------------------------------
def test_noindex_fires_index_not_robots():
    html = '<html lang="en"><head><title>x title here ok</title>' \
           '<meta name="robots" content="noindex"></head><body><h1>h</h1></body></html>'
    got = ids(fired([make(html)]))
    assert "SEO-INDEX-001" in got
    # ROBOTS category must not re-emit for a bare noindex.
    assert not any(r.startswith("SEO-ROBOTS") for r in got)


def test_robots_txt_block():
    got = ids(fired([make(GOOD_HTML, url="http://e.com/good", robots_ok=False)]))
    assert "SEO-INDEX-002" in got


def test_noindex_with_canonical_conflict():
    html = '<html lang="en"><head><title>title goes here</title>' \
           '<meta name="robots" content="noindex">' \
           '<link rel="canonical" href="http://e.com/p"></head><body><h1>h</h1></body></html>'
    got = ids(fired([make(html)]))
    assert "SEO-INDEX-003" in got


def test_4xx_only_http_no_content_rules():
    got = ids(fired([make("<html><body>nope</body></html>", status=404)]))
    assert got == ["SEO-HTTP-002"], got


def test_5xx_is_critical():
    findings = fired([make("<html><body>err</body></html>", status=500)])
    assert "SEO-HTTP-001" in ids(findings)
    sev = {f.rule_id: f.severity for f in findings}
    assert sev["SEO-HTTP-001"] == "critical"


def test_crawl_failure_no_status():
    got = ids(fired([make("", status=None, error="timeout")]))
    assert "SEO-HTTP-003" in got


def test_redirect_is_info():
    findings = fired([make(GOOD_HTML, url="http://e.com/good",
                           final_url="http://e.com/elsewhere")])
    http4 = [f for f in findings if f.rule_id == "SEO-HTTP-004"]
    assert http4 and http4[0].severity == "info"


def test_unexpected_content_type():
    got = ids(fired([make("%PDF-1.4 ...", content_type="application/pdf")]))
    assert "SEO-HTTP-005" in got


# ---------------------------------------------------------------------------
# Canonical
# ---------------------------------------------------------------------------
def test_missing_canonical():
    html = '<html lang="en"><head><title>title goes here</title></head><body><h1>h</h1></body></html>'
    assert "SEO-CANON-001" in ids(fired([make(html)]))


def test_multiple_canonical():
    html = '<html lang="en"><head><title>title goes here</title>' \
           '<link rel="canonical" href="http://e.com/a">' \
           '<link rel="canonical" href="http://e.com/b"></head><body><h1>h</h1></body></html>'
    assert "SEO-CANON-002" in ids(fired([make(html)]))


def test_cross_page_canonical_is_info_when_target_ok():
    html = '<html lang="en"><head><title>title goes here</title>' \
           '<link rel="canonical" href="http://e.com/other"></head><body><h1>h</h1></body></html>'
    findings = fired([make(html, url="http://e.com/p")])
    c6 = [f for f in findings if f.rule_id == "SEO-CANON-006"]
    assert c6 and c6[0].severity == "info"


def test_cross_page_canonical_escalates_to_low_when_target_broken():
    page_a, ext_a = make(
        '<html lang="en"><head><title>title goes here</title>'
        '<link rel="canonical" href="http://e.com/dead"></head><body><h1>h</h1></body></html>',
        url="http://e.com/p", pid=1,
    )
    page_dead, ext_dead = make("<html><body>gone</body></html>",
                               url="http://e.com/dead", status=404, pid=2)
    findings = fired([(page_a, ext_a), (page_dead, ext_dead)], target=0)
    c6 = [f for f in findings if f.rule_id == "SEO-CANON-006"]
    assert c6 and c6[0].severity == "low"


# ---------------------------------------------------------------------------
# Robots directives (non-noindex)
# ---------------------------------------------------------------------------
def test_meta_nofollow_and_noarchive():
    html = '<html lang="en"><head><title>title goes here</title>' \
           '<meta name="robots" content="nofollow, noarchive"></head><body><h1>h</h1></body></html>'
    got = ids(fired([make(html)]))
    assert "SEO-ROBOTS-001" in got and "SEO-ROBOTS-002" in got


# ---------------------------------------------------------------------------
# Title & meta
# ---------------------------------------------------------------------------
def test_missing_title():
    html = '<html lang="en"><head></head><body><h1>h</h1></body></html>'
    assert "SEO-TITLE-001" in ids(fired([make(html)]))


def test_short_and_long_title():
    short = '<html lang="en"><head><title>hi</title></head><body><h1>h</h1></body></html>'
    assert "SEO-TITLE-003" in ids(fired([make(short)]))
    long_title = "x" * 80
    long_html = f'<html lang="en"><head><title>{long_title}</title></head><body><h1>h</h1></body></html>'
    assert "SEO-TITLE-004" in ids(fired([make(long_html)]))


def test_missing_meta_description():
    html = '<html lang="en"><head><title>title goes here</title></head><body><h1>h</h1></body></html>'
    assert "SEO-META-001" in ids(fired([make(html)]))


# ---------------------------------------------------------------------------
# Headings (multiple H1 = Info, structural only)
# ---------------------------------------------------------------------------
def test_multiple_h1_is_info():
    html = '<html lang="en"><head><title>title goes here</title></head>' \
           '<body><h1>one</h1><h1>two</h1></body></html>'
    findings = fired([make(html)])
    h2 = [f for f in findings if f.rule_id == "SEO-HEADING-002"]
    assert h2 and h2[0].severity == "info"


# ---------------------------------------------------------------------------
# Duplicate signals (cross-page; re-derived from scan map, not the flag)
# ---------------------------------------------------------------------------
def test_duplicate_title_across_pages():
    dup = '<html lang="en"><head><title>Shared identical title</title>' \
          '<link rel="canonical" href="{u}"></head><body><h1>h</h1>' \
          '<a href="http://e.com/a">a</a><a href="http://e.com/b">b</a>' \
          '<a href="http://e.com/c">c</a></body></html>'
    p1 = make(dup.format(u="http://e.com/1"), url="http://e.com/1", pid=1)
    p2 = make(dup.format(u="http://e.com/2"), url="http://e.com/2", pid=2)
    got = ids(fired([p1, p2], target=0))
    assert "SEO-DUP-001" in got


def test_duplicate_title_isolated_per_scan():
    """A duplicate in one scan must not surface when the page is alone."""
    dup = '<html lang="en"><head><title>Shared identical title</title></head><body><h1>h</h1></body></html>'
    p1 = make(dup, url="http://e.com/1", pid=1)
    # Alone in its own scan -> no cross-page duplicate.
    got = ids(fired([p1], target=0))
    assert "SEO-DUP-001" not in got


def test_duplicate_url_normalization():
    html = '<html lang="en"><head><title>title goes here</title></head><body><h1>h</h1></body></html>'
    # Two page rows whose URLs normalize identically (trailing slash).
    p1 = make(html, url="http://e.com/dup", pid=1)
    p2 = make(html, url="http://e.com/dup/", pid=2)
    got = ids(fired([p1, p2], target=0))
    assert "SEO-DUP-004" in got


# ---------------------------------------------------------------------------
# Internal links (FP controls: scheme guard + crawl-proven broken only)
# ---------------------------------------------------------------------------
def test_mailto_not_counted_as_internal_link():
    html = '<html lang="en"><head><title>title goes here</title>' \
           '<link rel="canonical" href="http://e.com/p"></head><body><h1>h</h1>' \
           '<a href="mailto:x@y.com">mail</a></body></html>'
    got = ids(fired([make(html)]))
    # mailto is not a real internal link -> page has zero internal links.
    assert "SEO-LINK-001" in got
    assert "SEO-LINK-004" not in got


def test_broken_internal_link_requires_crawl_evidence():
    linker = '<html lang="en"><head><title>title goes here</title>' \
             '<link rel="canonical" href="http://e.com/p"></head><body><h1>h</h1>' \
             '<a href="http://e.com/missing">x</a></body></html>'
    # Without the destination in the scan -> NO broken-link finding.
    got_alone = ids(fired([make(linker, url="http://e.com/p")]))
    assert "SEO-LINK-004" not in got_alone
    # With the destination crawled as 404 -> broken-link fires.
    p_link = make(linker, url="http://e.com/p", pid=1)
    p_dead = make("<html><body>gone</body></html>", url="http://e.com/missing", status=404, pid=2)
    got = ids(fired([p_link, p_dead], target=0))
    assert "SEO-LINK-004" in got


def test_few_internal_links():
    html = '<html lang="en"><head><title>title goes here</title>' \
           '<link rel="canonical" href="http://e.com/p"></head><body><h1>h</h1>' \
           '<a href="http://e.com/only">one</a></body></html>'
    assert "SEO-LINK-002" in ids(fired([make(html)]))


# ---------------------------------------------------------------------------
# Images (missing alt = Low; empty alt = Info, no "inaccessible" wording)
# ---------------------------------------------------------------------------
def test_missing_alt_is_low():
    html = '<html lang="en"><head><title>title goes here</title></head>' \
           '<body><h1>h</h1><img src="a.png"></body></html>'
    findings = fired([make(html)])
    img1 = [f for f in findings if f.rule_id == "SEO-IMG-001"]
    assert img1 and img1[0].severity == "low"


def test_empty_alt_is_info_and_not_called_inaccessible():
    html = '<html lang="en"><head><title>title goes here</title></head>' \
           '<body><h1>h</h1><img src="a.png" alt=""></body></html>'
    findings = fired([make(html)])
    img2 = [f for f in findings if f.rule_id == "SEO-IMG-002"]
    assert img2 and img2[0].severity == "info"
    blob = (img2[0].message + " " + (img2[0].reason or "")).lower()
    assert "inaccessible" not in blob and "slow" not in blob


# ---------------------------------------------------------------------------
# Structured data
# ---------------------------------------------------------------------------
def test_invalid_json_ld():
    html = '<html lang="en"><head><title>title goes here</title>' \
           '<script type="application/ld+json">{ not valid json </script></head>' \
           '<body><h1>h</h1></body></html>'
    assert "SEO-SD-001" in ids(fired([make(html)]))


def test_missing_context_and_type():
    html_ctx = '<html lang="en"><head><title>title goes here</title>' \
               '<script type="application/ld+json">{"@type":"Thing","name":"x"}</script></head>' \
               '<body><h1>h</h1></body></html>'
    assert "SEO-SD-002" in ids(fired([make(html_ctx)]))
    html_type = '<html lang="en"><head><title>title goes here</title>' \
                '<script type="application/ld+json">{"@context":"https://schema.org","name":"x"}</script></head>' \
                '<body><h1>h</h1></body></html>'
    assert "SEO-SD-003" in ids(fired([make(html_type)]))


def test_duplicate_structured_data_blocks():
    block = '<script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","name":"n"}</script>'
    html = f'<html lang="en"><head><title>title goes here</title>{block}{block}</head><body><h1>h</h1></body></html>'
    assert "SEO-SD-004" in ids(fired([make(html)]))


# ---------------------------------------------------------------------------
# Social (missing OG / Twitter)
# ---------------------------------------------------------------------------
def test_missing_social_metadata():
    html = '<html lang="en"><head><title>title goes here</title></head><body><h1>h</h1></body></html>'
    got = ids(fired([make(html)]))
    assert "SEO-SOCIAL-001" in got and "SEO-SOCIAL-002" in got


# ---------------------------------------------------------------------------
# Language & hreflang
# ---------------------------------------------------------------------------
def test_missing_html_lang():
    html = '<html><head><title>title goes here</title></head><body><h1>h</h1></body></html>'
    assert "SEO-LANG-001" in ids(fired([make(html)]))


def test_invalid_hreflang_code():
    html = '<html lang="en"><head><title>title goes here</title>' \
           '<link rel="alternate" hreflang="e n" href="http://e.com/x"></head>' \
           '<body><h1>h</h1></body></html>'
    assert "SEO-LANG-002" in ids(fired([make(html)]))


# ---------------------------------------------------------------------------
# Multiple findings + scoring
# ---------------------------------------------------------------------------
def test_multiple_findings_on_one_page():
    html = '<html><head></head><body><p>bare</p></body></html>'
    got = ids(fired([make(html)]))
    assert len(got) >= 4  # missing title/desc/canonical/lang/social/etc.


def test_build_summary_empty_is_full_health():
    s = build_summary([], pages_analyzed=3)
    assert s["provisional_overall_health"] == 100
    assert s["total_findings"] == 0
    assert s["scoring"]["provisional"] is True


def test_build_summary_penalizes_and_reports_worst_category():
    rows = [("http", "critical"), ("title", "high"), ("meta", "low")]
    s = build_summary(rows, pages_analyzed=2, scan_id=1, website_id=1)
    assert s["total_findings"] == 3
    assert s["worst_category"] == "http"
    assert 0 <= s["provisional_overall_health"] <= 100
    cats = {c["category"]: c for c in s["categories"]}
    assert cats["http"]["counts_by_severity"]["critical"] == 1


def test_findings_carry_full_evidence_payload():
    findings = fired([make('<html><head></head><body><p>x</p></body></html>')])
    for f in findings:
        assert f.rule_id and f.category and f.severity
        assert f.message
        # observed_value / recommendation present on every finding
        assert f.recommendation
        assert isinstance(f.evidence, dict)
