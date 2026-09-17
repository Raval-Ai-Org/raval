"""
Static HTML Test Site Fixture for Controlled Site Lab (Task 12 Step 1).

Implements a realistic, deterministic multi-page static website with explicit intentional defects,
expected page states, robots.txt, sitemap.xml, and 301 redirects.
"""

from __future__ import annotations

from ..models import (
    DefectCategory,
    DefectSeverity,
    ExpectedPageState,
    IntentionalDefect,
    LabFixtureConfig,
    LabFixtureType,
)

STATIC_BASE_URL = "https://static.lab.local"

# ------------------------------------------------------------------------------
# Raw HTML Documents
# ------------------------------------------------------------------------------

INDEX_HTML = """<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <title>Apex Cloud Innovations - Enterprise Multi-Cloud Intelligence Platform</title>
    <meta name="description" content="Apex Cloud Innovations delivers enterprise multi-cloud discovery, automated governance, and generative search optimization.">
    <link rel="canonical" href="https://static.lab.local/">
    <script type="application/ld+json">
    {
        "@context": "https://schema.org",
        "@type": "Organization",
        "name": "Apex Cloud Innovations",
        "url": "https://static.lab.local/",
        "logo": "https://static.lab.local/assets/logo.png",
        "sameAs": [
            "https://twitter.com/apexcloud",
            "https://linkedin.com/company/apexcloud"
        ]
    }
    </script>
</head>
<body>
    <header>
        <nav>
            <a href="/">Home</a>
            <a href="/about.html">About</a>
            <a href="/services.html">Services</a>
            <a href="/docs.html">Docs</a>
            <a href="/contact.html">Contact</a>
            <a href="/old-services">Legacy Migration</a>
        </nav>
    </header>
    <main>
        <h1>Enterprise Multi-Cloud Intelligence Platform</h1>
        <p>Apex Cloud empowers modern engineering teams to achieve complete visibility and governance across distributed cloud infrastructure.</p>
        <h2>Unified Cloud Observability</h2>
        <p>Aggregate logs, telemetry, and security posture across AWS, Azure, and Google Cloud in a single centralized dashboard.</p>
        <h2>Autonomous Optimization</h2>
        <p>Leverage machine learning to automatically right-size workloads and prevent costly infrastructure drift.</p>
        <h2>Enterprise Security</h2>
        <p>Enforce zero-trust compliance standards with automated continuous auditing and real-time alerts.</p>
    </main>
    <footer>
        <p>&copy; 2026 Apex Cloud Innovations. All rights reserved.</p>
    </footer>
</body>
</html>"""

ABOUT_HTML = """<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <!-- INTENTIONAL DEFECT DEF-STATIC-001: Missing <title> tag -->
    <meta name="description" content="Learn about Apex Cloud Innovations, our leadership team, our company history, and our mission to modernize enterprise cloud architectures.">
    <link rel="canonical" href="https://static.lab.local/about.html">
</head>
<body>
    <header>
        <nav>
            <a href="/">Home</a>
            <a href="/about.html">About</a>
            <a href="/services.html">Services</a>
            <a href="/docs.html">Docs</a>
            <a href="/contact.html">Contact</a>
        </nav>
    </header>
    <main>
        <!-- INTENTIONAL DEFECT DEF-STATIC-002: Multiple H1 tags on the same page -->
        <h1>About Apex Cloud Innovations</h1>
        <p>Founded in 2022, Apex Cloud Innovations is dedicated to simplifying complex cloud architectures through intelligent automation.</p>
        <h1>Our Executive Leadership</h1>
        <p>Our team brings together distributed systems architects and cybersecurity pioneers with decades of combined experience.</p>
        <h2>Our Core Values</h2>
        <p>Integrity, transparency, and relentless innovation guide everything we build.</p>
    </main>
    <footer>
        <p>&copy; 2026 Apex Cloud Innovations.</p>
    </footer>
</body>
</html>"""

SERVICES_HTML = """<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <title>Cloud Migration and Optimization Services | Apex Cloud</title>
    <!-- INTENTIONAL DEFECT DEF-STATIC-003: Extremely weak/short meta description (13 chars) -->
    <meta name="description" content="Services page">
    <!-- INTENTIONAL DEFECT DEF-STATIC-004: Incorrect canonical pointing to wrong URL -->
    <link rel="canonical" href="https://static.lab.local/wrong-services-url">
    <script type="application/ld+json">
    {
        "@context": "https://schema.org",
        "@type": "Service",
        "name": "Enterprise Cloud Migration",
        "provider": {
            "@type": "Organization",
            "name": "Apex Cloud Innovations"
        },
        "description": "Full-lifecycle cloud architecture transformation and zero-downtime migration."
    }
    </script>
</head>
<body>
    <header>
        <nav>
            <a href="/">Home</a>
            <a href="/about.html">About</a>
            <a href="/services.html">Services</a>
            <a href="/docs.html">Docs</a>
            <a href="/contact.html">Contact</a>
        </nav>
    </header>
    <main>
        <h1>Cloud Migration and Optimization Services</h1>
        <p>We provide specialized end-to-end cloud consulting, architecture modernization, and automated FinOps management.</p>
        <h2>Workload Modernization</h2>
        <p>Re-architect monolithic applications into cloud-native microservices with automated scaling.</p>
        <h2>FinOps Cost Management</h2>
        <p>Identify underutilized resources and reduce cloud expenditure by up to 40%.</p>
    </main>
    <footer>
        <p>&copy; 2026 Apex Cloud Innovations.</p>
    </footer>
</body>
</html>"""

DOCS_HTML = """<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <title>Multi-Cloud Governance Documentation & Architecture Guide</title>
    <meta name="description" content="Comprehensive technical documentation for deploying, configuring, and maintaining Apex Cloud multi-cloud intelligence agents.">
    <link rel="canonical" href="https://static.lab.local/docs.html">
    <!-- INTENTIONAL DEFECT DEF-STATIC-005: Malformed JSON-LD (unclosed string / bad syntax) -->
    <script type="application/ld+json">
    {
        "@context": "https://schema.org",
        "@type": "TechArticle",
        "headline": "Multi-Cloud Governance Guide
        "description": "Malformed unclosed string
    }
    </script>
</head>
<body>
    <header>
        <nav>
            <a href="/">Home</a>
            <a href="/about.html">About</a>
            <a href="/services.html">Services</a>
            <a href="/docs.html">Docs</a>
            <a href="/contact.html">Contact</a>
        </nav>
    </header>
    <main>
        <h1>Multi-Cloud Governance Architecture Guide</h1>
        <!-- INTENTIONAL DEFECT DEF-STATIC-006: Heading hierarchy skip (H1 jumps directly to H3 without H2) -->
        <h3>Quickstart Agent Installation</h3>
        <p>Deploy the lightweight collector daemon using our verified Helm chart or standalone container image.</p>
        <h3>Configuration Reference</h3>
        <p>Specify environment variables in your Kubernetes manifest to authenticate with your central tenant.</p>
        <p>For troubleshooting, check our <a href="/broken-resource-target">troubleshooting runbook</a> (broken internal link) or <a href="/contact.html">contact support</a>.</p>
    </main>
    <footer>
        <p>&copy; 2026 Apex Cloud Innovations.</p>
    </footer>
</body>
</html>"""

CONTACT_HTML = """<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <title>Contact Apex Cloud Innovations</title>
    <meta name="description" content="Get in touch with the Apex Cloud engineering and sales teams for custom enterprise deployment inquiries.">
    <!-- INTENTIONAL DEFECT DEF-STATIC-008: Meta robots set to noindex -->
    <meta name="robots" content="noindex, follow">
    <!-- INTENTIONAL DEFECT DEF-STATIC-009: Missing canonical tag entirely -->
</head>
<body>
    <header>
        <nav>
            <a href="/">Home</a>
            <a href="/about.html">About</a>
            <a href="/services.html">Services</a>
            <a href="/docs.html">Docs</a>
            <a href="/contact.html">Contact</a>
        </nav>
    </header>
    <main>
        <h1>Contact Our Enterprise Team</h1>
        <p>Our solution architects are available around the clock to support your cloud migration roadmap.</p>
        <h2>Global Offices</h2>
        <p>San Francisco &bull; London &bull; Singapore</p>
        <h2>Direct Email</h2>
        <p>Inquiries: <a href="mailto:support@apexcloud.local">support@apexcloud.local</a></p>
    </main>
    <footer>
        <p>&copy; 2026 Apex Cloud Innovations.</p>
    </footer>
</body>
</html>"""

ROBOTS_TXT = """User-agent: *
Allow: /
Disallow: /admin/
Disallow: /private/
Sitemap: https://static.lab.local/sitemap.xml
"""

SITEMAP_XML = """<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://static.lab.local/</loc>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>https://static.lab.local/about.html</loc>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>
  <url>
    <loc>https://static.lab.local/services.html</loc>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>
  <url>
    <loc>https://static.lab.local/docs.html</loc>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>
  <url>
    <loc>https://static.lab.local/contact.html</loc>
    <changefreq>monthly</changefreq>
    <priority>0.5</priority>
  </url>
</urlset>"""


# ------------------------------------------------------------------------------
# Intentional Defects Catalog
# ------------------------------------------------------------------------------

STATIC_DEFECTS: list[IntentionalDefect] = [
    IntentionalDefect(
        defect_id="DEF-STATIC-001",
        fixture_id="static_site_01",
        category=DefectCategory.METADATA,
        severity=DefectSeverity.HIGH,
        target_resource="/about.html",
        rule_code="TITLE_MISSING",
        title="Missing Title Tag",
        description="The about page completely lacks a <title> element in the document head.",
        raw_state={"title": None, "title_present": False},
        expected_fix={"action": "insert_title", "title": "About Us | Apex Cloud Innovations"},
        expected_post_fix_state={"title": "About Us | Apex Cloud Innovations", "title_present": True},
    ),
    IntentionalDefect(
        defect_id="DEF-STATIC-002",
        fixture_id="static_site_01",
        category=DefectCategory.HEADINGS,
        severity=DefectSeverity.MEDIUM,
        target_resource="/about.html",
        rule_code="R-STR-02",
        title="Multiple H1 Headings",
        description="The about page contains multiple <h1> tags, creating primary topic ambiguity.",
        raw_state={"h1_count": 2, "h1_texts": ["About Apex Cloud Innovations", "Our Executive Leadership"]},
        expected_fix={"action": "consolidate_h1", "primary_h1": "About Apex Cloud Innovations", "demote_to_h2": ["Our Executive Leadership"]},
        expected_post_fix_state={"h1_count": 1, "h1_texts": ["About Apex Cloud Innovations"]},
    ),
    IntentionalDefect(
        defect_id="DEF-STATIC-003",
        fixture_id="static_site_01",
        category=DefectCategory.METADATA,
        severity=DefectSeverity.MEDIUM,
        target_resource="/services.html",
        rule_code="META_DESC_WEAK",
        title="Weak Meta Description",
        description="The services page meta description is excessively short (13 characters: 'Services page').",
        raw_state={"meta_description": "Services page", "length": 13, "too_short": True},
        expected_fix={"action": "update_meta_description", "description": "Explore Apex Cloud end-to-end cloud migration, workload modernization, and FinOps cost optimization services."},
        expected_post_fix_state={"meta_description": "Explore Apex Cloud end-to-end cloud migration, workload modernization, and FinOps cost optimization services.", "too_short": False},
    ),
    IntentionalDefect(
        defect_id="DEF-STATIC-004",
        fixture_id="static_site_01",
        category=DefectCategory.CANONICAL,
        severity=DefectSeverity.HIGH,
        target_resource="/services.html",
        rule_code="CANONICAL_CONFLICT",
        title="Incorrect Canonical Target",
        description="The canonical link tag references a non-existent URL (https://static.lab.local/wrong-services-url).",
        raw_state={"canonical_url": "https://static.lab.local/wrong-services-url", "is_correct": False},
        expected_fix={"action": "set_canonical", "canonical_url": "https://static.lab.local/services.html"},
        expected_post_fix_state={"canonical_url": "https://static.lab.local/services.html", "is_correct": True},
    ),
    IntentionalDefect(
        defect_id="DEF-STATIC-005",
        fixture_id="static_site_01",
        category=DefectCategory.STRUCTURED_DATA,
        severity=DefectSeverity.HIGH,
        target_resource="/docs.html",
        rule_code="SCHEMA_MALFORMED",
        title="Malformed JSON-LD Schema",
        description="The docs page contains unparseable, malformed JSON-LD structured data with syntax errors.",
        raw_state={"structured_data_valid": False, "parse_error": "Unclosed string in JSON-LD"},
        expected_fix={"action": "repair_json_ld", "schema_type": "TechArticle"},
        expected_post_fix_state={"structured_data_valid": True, "structured_data_types": ["TechArticle"]},
    ),
    IntentionalDefect(
        defect_id="DEF-STATIC-006",
        fixture_id="static_site_01",
        category=DefectCategory.HEADINGS,
        severity=DefectSeverity.MEDIUM,
        target_resource="/docs.html",
        rule_code="R-STR-03",
        title="Heading Hierarchy Skip",
        description="The docs page skips heading hierarchy level from H1 directly to H3 without an intermediate H2.",
        raw_state={"hierarchy_skips": [("h1", "h3")]},
        expected_fix={"action": "normalize_headings", "replace": {"h3": "h2"}},
        expected_post_fix_state={"hierarchy_skips": []},
    ),
    IntentionalDefect(
        defect_id="DEF-STATIC-007",
        fixture_id="static_site_01",
        category=DefectCategory.LINKS,
        severity=DefectSeverity.MEDIUM,
        target_resource="/docs.html",
        rule_code="HTTP_404_DEAD_LINK",
        title="Broken Internal Link (404)",
        description="The docs page links to /broken-resource-target which returns HTTP 404.",
        raw_state={"broken_link_url": "/broken-resource-target", "status_code": 404},
        expected_fix={"action": "update_link_target", "target": "/docs.html#troubleshooting"},
        expected_post_fix_state={"broken_link_count": 0},
    ),
    IntentionalDefect(
        defect_id="DEF-STATIC-008",
        fixture_id="static_site_01",
        category=DefectCategory.INDEXABILITY,
        severity=DefectSeverity.HIGH,
        target_resource="/contact.html",
        rule_code="ROBOTS_NOINDEX",
        title="Unintended Noindex Directive",
        description="The contact page includes <meta name='robots' content='noindex, follow'> blocking search indexation.",
        raw_state={"robots_noindex": True, "directives": ["noindex", "follow"]},
        expected_fix={"action": "remove_noindex", "directives": ["index", "follow"]},
        expected_post_fix_state={"robots_noindex": False, "directives": ["index", "follow"]},
    ),
    IntentionalDefect(
        defect_id="DEF-STATIC-009",
        fixture_id="static_site_01",
        category=DefectCategory.CANONICAL,
        severity=DefectSeverity.MEDIUM,
        target_resource="/contact.html",
        rule_code="CANONICAL_MISSING",
        title="Missing Canonical Tag",
        description="The contact page is completely missing a canonical link element.",
        raw_state={"canonical_present": False, "canonical_url": None},
        expected_fix={"action": "insert_canonical", "canonical_url": "https://static.lab.local/contact.html"},
        expected_post_fix_state={"canonical_present": True, "canonical_url": "https://static.lab.local/contact.html"},
    ),
    IntentionalDefect(
        defect_id="DEF-STATIC-010",
        fixture_id="static_site_01",
        category=DefectCategory.REDIRECTS,
        severity=DefectSeverity.INFO,
        target_resource="/old-services",
        rule_code="REDIRECT_301",
        title="Permanent 301 Redirect Route",
        description="Legacy service migration route that permanently redirects to /services.html.",
        raw_state={"status_code": 301, "location": "/services.html"},
        expected_fix={"action": "verify_redirect", "expected_status": 301},
        expected_post_fix_state={"final_url": "https://static.lab.local/services.html"},
    ),
]


# ------------------------------------------------------------------------------
# Expected Page States
# ------------------------------------------------------------------------------

STATIC_RESOURCES: dict[str, ExpectedPageState] = {
    "/": ExpectedPageState(
        url_path="/",
        status_code=200,
        title="Apex Cloud Innovations - Enterprise Multi-Cloud Intelligence Platform",
        meta_description="Apex Cloud Innovations delivers enterprise multi-cloud discovery, automated governance, and generative search optimization.",
        canonical_url="https://static.lab.local/",
        h1_headings=["Enterprise Multi-Cloud Intelligence Platform"],
        headings_hierarchy_valid=True,
        structured_data_types=["Organization"],
        structured_data_valid=True,
        internal_link_targets=["/", "/about.html", "/services.html", "/docs.html", "/contact.html", "/old-services"],
        intentional_defect_ids=[],
    ),
    "/index.html": ExpectedPageState(
        url_path="/index.html",
        status_code=200,
        title="Apex Cloud Innovations - Enterprise Multi-Cloud Intelligence Platform",
        meta_description="Apex Cloud Innovations delivers enterprise multi-cloud discovery, automated governance, and generative search optimization.",
        canonical_url="https://static.lab.local/",
        h1_headings=["Enterprise Multi-Cloud Intelligence Platform"],
        headings_hierarchy_valid=True,
        structured_data_types=["Organization"],
        structured_data_valid=True,
        internal_link_targets=["/", "/about.html", "/services.html", "/docs.html", "/contact.html", "/old-services"],
        intentional_defect_ids=[],
    ),
    "/about.html": ExpectedPageState(
        url_path="/about.html",
        status_code=200,
        title=None,  # Missing intentionally
        meta_description="Learn about Apex Cloud Innovations, our leadership team, our company history, and our mission to modernize enterprise cloud architectures.",
        canonical_url="https://static.lab.local/about.html",
        h1_headings=["About Apex Cloud Innovations", "Our Executive Leadership"],
        headings_hierarchy_valid=True,
        structured_data_types=[],
        structured_data_valid=True,
        internal_link_targets=["/", "/about.html", "/services.html", "/docs.html", "/contact.html"],
        intentional_defect_ids=["DEF-STATIC-001", "DEF-STATIC-002"],
    ),
    "/services.html": ExpectedPageState(
        url_path="/services.html",
        status_code=200,
        title="Cloud Migration and Optimization Services | Apex Cloud",
        meta_description="Services page",  # Weak intentionally
        canonical_url="https://static.lab.local/wrong-services-url",  # Incorrect intentionally
        h1_headings=["Cloud Migration and Optimization Services"],
        headings_hierarchy_valid=True,
        structured_data_types=["Service"],
        structured_data_valid=True,
        internal_link_targets=["/", "/about.html", "/services.html", "/docs.html", "/contact.html"],
        intentional_defect_ids=["DEF-STATIC-003", "DEF-STATIC-004"],
    ),
    "/docs.html": ExpectedPageState(
        url_path="/docs.html",
        status_code=200,
        title="Multi-Cloud Governance Documentation & Architecture Guide",
        meta_description="Comprehensive technical documentation for deploying, configuring, and maintaining Apex Cloud multi-cloud intelligence agents.",
        canonical_url="https://static.lab.local/docs.html",
        h1_headings=["Multi-Cloud Governance Architecture Guide"],
        headings_hierarchy_valid=False,  # Skip H1 -> H3
        structured_data_types=[],
        structured_data_valid=False,  # Malformed JSON-LD
        internal_link_targets=["/", "/about.html", "/services.html", "/docs.html", "/contact.html", "/broken-resource-target"],
        intentional_defect_ids=["DEF-STATIC-005", "DEF-STATIC-006", "DEF-STATIC-007"],
    ),
    "/contact.html": ExpectedPageState(
        url_path="/contact.html",
        status_code=200,
        title="Contact Apex Cloud Innovations",
        meta_description="Get in touch with the Apex Cloud engineering and sales teams for custom enterprise deployment inquiries.",
        canonical_url=None,  # Missing intentionally
        robots_directives=["noindex", "follow"],  # Noindex intentionally
        h1_headings=["Contact Our Enterprise Team"],
        headings_hierarchy_valid=True,
        structured_data_types=[],
        structured_data_valid=True,
        internal_link_targets=["/", "/about.html", "/services.html", "/docs.html", "/contact.html"],
        intentional_defect_ids=["DEF-STATIC-008", "DEF-STATIC-009"],
    ),
    "/broken-resource-target": ExpectedPageState(
        url_path="/broken-resource-target",
        status_code=404,
        title="404 Not Found",
        meta_description=None,
        canonical_url=None,
        h1_headings=["Page Not Found"],
        headings_hierarchy_valid=True,
        structured_data_types=[],
        structured_data_valid=True,
        internal_link_targets=[],
        intentional_defect_ids=["DEF-STATIC-007"],
    ),
}

RAW_STATIC_PAGES: dict[str, str] = {
    "/": INDEX_HTML,
    "/index.html": INDEX_HTML,
    "/about.html": ABOUT_HTML,
    "/services.html": SERVICES_HTML,
    "/docs.html": DOCS_HTML,
    "/contact.html": CONTACT_HTML,
    "/broken-resource-target": "<html><head><title>404 Not Found</title></head><body><h1>Page Not Found</h1></body></html>",
}

STATIC_REDIRECTS: dict[str, tuple[int, str]] = {
    "/old-services": (301, "/services.html"),
    "/legacy-docs": (301, "/docs.html"),
}


def build_static_site_fixture() -> LabFixtureConfig:
    """Builds and returns the deterministic Static HTML site fixture configuration."""
    return LabFixtureConfig(
        fixture_id="static_site_01",
        name="Apex Cloud Innovations (Static HTML)",
        fixture_type=LabFixtureType.STATIC_HTML,
        base_url=STATIC_BASE_URL,
        description="Realistic multi-page static website with intentional metadata, canonical, heading, structured data, indexability, and redirect defects.",
        resources=STATIC_RESOURCES,
        raw_html_pages=RAW_STATIC_PAGES,
        defects=STATIC_DEFECTS,
        robots_txt=ROBOTS_TXT,
        sitemap_xml=SITEMAP_XML,
        redirects=STATIC_REDIRECTS,
    )
