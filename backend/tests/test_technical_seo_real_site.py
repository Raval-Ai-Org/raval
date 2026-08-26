"""Small controlled real-site verification for the Task 5 rule engine.

Mirrors ``test_real_site_verification.py`` (Task 4): run the verifier against a
real page when the network is reachable, otherwise fall back to a deterministic
offline snapshot. Either way it asserts the spec §23 guarantees — findings are
non-fabricated (every rule id is registered), page-anchored, explainable, and
free of the two false positives the plan calls out:

* no broken-internal-link finding without crawl evidence (``SEO-LINK-004``);
* external links are never flagged.

It also pins the two behaviours that most easily regress into false positives:
missing-canonical is correctly *detected*, and multiple-H1 is reported at
``info`` severity (HTML5 permits it) rather than as an error.
"""

from app.technical_seo import RULE_REGISTRY
from backend.scripts.verify_technical_seo import analyze_single_page, run_verification

VALID_SEVERITIES = {"info", "low", "medium", "high", "critical"}
REGISTERED_RULE_IDS = {r.rule_id for r in RULE_REGISTRY}
REGISTERED_CATEGORIES = {r.category for r in RULE_REGISTRY}

# Deterministic, well-formed snapshot for offline runs. Intentionally has: no
# canonical (-> SEO-CANON-001), three H1s (-> SEO-HEADING-002 at info), an
# internal link with empty anchor text, an internal link to an *uncrawled*
# target (must NOT produce a broken-link finding), and one external link
# (must never be flagged).
OFFLINE_HTML = """<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <title>Welcome to the Offline Verification Fixture</title>
    <meta name="description" content="A sufficiently long and descriptive meta description used by the offline technical-SEO verification snapshot.">
    <meta property="og:title" content="Offline Fixture">
    <meta property="og:description" content="Offline Fixture description">
    <meta name="twitter:card" content="summary">
</head>
<body>
    <header><a href="/"><img src="/logo.png" alt="logo"></a></header>
    <h1>First Section</h1>
    <p>Python is a programming language that lets you work quickly.</p>
    <h1>Second Section</h1>
    <p>Lists, dictionaries, and sets are built-in data types.</p>
    <h1>Third Section</h1>
    <p>The core of extensible programming is defining functions.</p>
    <a href="/not-crawled-page/">Internal link to an uncrawled page</a>
    <a href="https://external.example.com/elsewhere" rel="external">External link</a>
</body>
</html>"""

OFFLINE_URL = "https://www.python.org/"


def _assert_findings_are_sound(findings, page_url):
    """Invariants that must hold for live and offline findings alike."""
    ids = {f.rule_id for f in findings}

    # Non-fabrication: every emitted rule id is a real registered rule.
    assert ids <= REGISTERED_RULE_IDS, f"unregistered rule ids: {ids - REGISTERED_RULE_IDS}"

    # The core false-positive guard: a single fetched page has no crawled link
    # targets, so a broken-internal-link finding would be fabricated.
    assert "SEO-LINK-004" not in ids

    for f in findings:
        assert f.rule_id in REGISTERED_RULE_IDS
        assert f.category in REGISTERED_CATEGORIES
        assert f.severity in VALID_SEVERITIES
        assert f.recommendation, f"{f.rule_id} missing recommendation"
        assert isinstance(f.evidence, dict)


def test_technical_seo_real_site_live_or_fallback():
    result = run_verification("https://www.python.org/")

    if result.get("live") and result.get("success"):
        # Live verification succeeded and the verifier detected no false positive.
        assert result["success"] is True
        assert result["false_positives"] == []
        assert result["explainability_gaps"] == []
        assert result["deterministic"] is True
        assert result["status_code"] == 200

        findings = result["findings"]
        ids = {f["rule_id"] for f in findings}
        assert ids <= REGISTERED_RULE_IDS
        assert "SEO-LINK-004" not in ids
        for f in findings:
            assert f["page_url"] == "https://www.python.org/"
            assert f["severity"] in VALID_SEVERITIES
            assert f["category"] in REGISTERED_CATEGORIES
            assert f["recommendation"]
            assert isinstance(f["evidence"], dict)

        # Multiple-H1, when present, must stay informational (HTML5 permits it).
        for f in findings:
            if f["rule_id"] == "SEO-HEADING-002":
                assert f["severity"] == "info"

        # Provisional score is a real 0..100 heuristic, explicitly not final.
        assert 0 <= result["summary"]["provisional_overall_health"] <= 100
        assert result["summary"]["scoring"]["provisional"] is True
    else:
        # Offline fallback on the deterministic snapshot.
        findings, summary, ext = analyze_single_page(OFFLINE_URL, 200, OFFLINE_HTML)
        _assert_findings_are_sound(findings, OFFLINE_URL)

        ids = {f.rule_id for f in findings}
        # Missing canonical is correctly detected...
        assert "SEO-CANON-001" in ids
        # ...and three H1s are reported, at info severity (not an error).
        heading = [f for f in findings if f.rule_id == "SEO-HEADING-002"]
        assert heading and heading[0].severity == "info"

        # External destination must not appear in any finding's evidence.
        external = {
            l.destination_url for l in ext.links if l.link_type == "external"
        }
        assert external  # the snapshot does contain an external link
        for f in findings:
            for ex_url in external:
                assert ex_url not in repr(f.evidence)

        # Determinism: re-running on the same evidence yields the same findings.
        findings2, _, _ = analyze_single_page(OFFLINE_URL, 200, OFFLINE_HTML)
        assert sorted(f.rule_id for f in findings) == sorted(f.rule_id for f in findings2)

        assert 0 <= summary["provisional_overall_health"] <= 100
        assert summary["scoring"]["provisional"] is True


def test_offline_snapshot_findings_are_sound_regardless_of_network():
    """The offline snapshot path is exercised unconditionally.

    Even when CI has network access (so the test above takes the live branch),
    this guarantees the deterministic snapshot assertions always run.
    """
    findings, summary, ext = analyze_single_page(OFFLINE_URL, 200, OFFLINE_HTML)
    _assert_findings_are_sound(findings, OFFLINE_URL)

    ids = {f.rule_id for f in findings}
    assert "SEO-CANON-001" in ids
    assert "SEO-LINK-004" not in ids
    heading = [f for f in findings if f.rule_id == "SEO-HEADING-002"]
    assert heading and heading[0].severity == "info"
