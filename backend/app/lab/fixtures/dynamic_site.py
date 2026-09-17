"""
Dynamic React/Next.js-Style Site Fixture for Controlled Site Lab (Task 12 Step 1).

Represents a modern client-rendered single page application / hydrated frontend.
Provides both raw pre-hydration HTML shell and rendered DOM HTML snapshot to allow
objective validation of browser rendering and client-side SEO/AEO extraction.
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

DYNAMIC_BASE_URL = "https://dynamic.lab.local"

# ------------------------------------------------------------------------------
# Raw (Pre-Hydration) HTML Shell
# ------------------------------------------------------------------------------

RAW_SPA_SHELL_HTML = """<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <title>Loading Application...</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <link rel="stylesheet" href="/static/bundle.css">
    <script defer src="/static/app.bundle.js"></script>
</head>
<body>
    <div id="root">
        <div class="loading-state">
            <span class="spinner"></span>
            <p>Initializing interactive application...</p>
        </div>
    </div>
    <noscript>
        <p>JavaScript is required to run this application.</p>
    </noscript>
</body>
</html>"""


# ------------------------------------------------------------------------------
# Rendered (Post-Hydration / DOM Snapshot) HTML
# ------------------------------------------------------------------------------

RENDERED_DASHBOARD_HTML = """<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <!-- Dynamic Title injected by React Helmet / Head manager -->
    <title>QuantumAI Search Intelligence - Modern Generative Discovery Platform</title>
    <meta name="description" content="QuantumAI powers modern search intelligence, generative AI visibility monitoring, and automated SEO discovery.">
    <!-- Dynamic Canonical injected post-render -->
    <link rel="canonical" href="https://dynamic.lab.local/dashboard">
    <!-- Dynamic JSON-LD injected post-render -->
    <script type="application/ld+json">
    {
        "@context": "https://schema.org",
        "@type": "SoftwareApplication",
        "name": "QuantumAI Platform",
        "applicationCategory": "BusinessApplication",
        "operatingSystem": "Cloud",
        "offers": {
            "@type": "Offer",
            "price": "0",
            "priceCurrency": "USD"
        }
    }
    </script>
</head>
<body>
    <div id="root">
        <header class="app-header">
            <nav class="app-nav">
                <a href="/dashboard" class="nav-link active">Dashboard</a>
                <a href="/analytics" class="nav-link">Analytics</a>
                <a href="/settings" class="nav-link">Settings</a>
            </nav>
        </header>
        <main class="app-main">
            <h1>Real-Time AI Search Analytics and Visibility</h1>
            <p>Monitor generative engine visibility across Perplexity, ChatGPT, and Google Gemini in real time.</p>
            
            <!-- Rendered Direct AEO Answer Block -->
            <section class="aeo-answer-box" data-engine="quantum-aeo">
                <h2>What is generative search visibility?</h2>
                <p>Generative search visibility measures how frequently, accurately, and prominently a brand or domain is cited as an authoritative source in AI-generated direct answers across conversational search engines.</p>
            </section>

            <section class="metrics-grid">
                <div class="metric-card">
                    <h3>Visibility Index</h3>
                    <span class="metric-value">94.2%</span>
                </div>
                <div class="metric-card">
                    <h3>Citation Share</h3>
                    <span class="metric-value">78.5%</span>
                </div>
            </section>
        </main>
        <footer class="app-footer">
            <p>&copy; 2026 QuantumAI Technologies Inc.</p>
        </footer>
    </div>
</body>
</html>"""

RENDERED_ANALYTICS_HTML = """<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <title>Generative Engine Citation Analytics | QuantumAI</title>
    <meta name="description" content="Deep dive citation trends, keyword coverage, and source reliability scoring.">
    <link rel="canonical" href="https://dynamic.lab.local/analytics">
</head>
<body>
    <div id="root">
        <header class="app-header">
            <nav class="app-nav">
                <a href="/dashboard" class="nav-link">Dashboard</a>
                <a href="/analytics" class="nav-link active">Analytics</a>
            </nav>
        </header>
        <main class="app-main">
            <h1>Citation Trends and Source Analysis</h1>
            <p>Comprehensive attribution analytics across synthetic search engines.</p>
        </main>
        <footer class="app-footer">
            <p>&copy; 2026 QuantumAI Technologies Inc.</p>
        </footer>
    </div>
</body>
</html>"""

DYNAMIC_ROBOTS_TXT = """User-agent: *
Allow: /
Disallow: /settings/
Sitemap: https://dynamic.lab.local/sitemap.xml
"""

DYNAMIC_SITEMAP_XML = """<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://dynamic.lab.local/dashboard</loc>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>https://dynamic.lab.local/analytics</loc>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>
</urlset>"""


# ------------------------------------------------------------------------------
# Intentional Defects Catalog for Dynamic SPA Fixture
# ------------------------------------------------------------------------------

DYNAMIC_DEFECTS: list[IntentionalDefect] = [
    IntentionalDefect(
        defect_id="DEF-DYN-001",
        fixture_id="dynamic_browser_site_01",
        category=DefectCategory.AEO_GEO,
        severity=DefectSeverity.HIGH,
        target_resource="/dashboard",
        rule_code="CLIENT_SIDE_ONLY_CONTENT",
        title="Content Invisible on Raw HTTP GET",
        description="The primary body content and AEO direct answer block are absent from initial raw HTML and require client-side JavaScript execution/hydration.",
        raw_state={"raw_has_main_content": False, "rendered_has_main_content": True},
        expected_fix={"action": "enable_ssr_or_prerender", "prerender_path": "/dashboard"},
        expected_post_fix_state={"raw_has_main_content": True},
        is_browser_render_dependent=True,
    ),
    IntentionalDefect(
        defect_id="DEF-DYN-002",
        fixture_id="dynamic_browser_site_01",
        category=DefectCategory.METADATA,
        severity=DefectSeverity.MEDIUM,
        target_resource="/dashboard",
        rule_code="DYNAMIC_TITLE_MISMATCH",
        title="Initial Raw Title Differs From Rendered Title",
        description="Initial raw HTML presents a placeholder title ('Loading Application...') until JavaScript hydration updates the DOM title.",
        raw_state={"raw_title": "Loading Application...", "rendered_title": "QuantumAI Search Intelligence - Modern Generative Discovery Platform"},
        expected_fix={"action": "server_inject_document_title", "title": "QuantumAI Search Intelligence - Modern Generative Discovery Platform"},
        expected_post_fix_state={"raw_title": "QuantumAI Search Intelligence - Modern Generative Discovery Platform"},
        is_browser_render_dependent=True,
    ),
    IntentionalDefect(
        defect_id="DEF-DYN-003",
        fixture_id="dynamic_browser_site_01",
        category=DefectCategory.STRUCTURED_DATA,
        severity=DefectSeverity.LOW,
        target_resource="/dashboard",
        rule_code="SCHEMA_INJECTED_POST_RENDER",
        title="Structured Data Injected Exclusively via Client Script",
        description="Schema.org JSON-LD structured data is injected dynamically via client-side DOM manipulation rather than being delivered in initial server response.",
        raw_state={"raw_has_schema": False, "rendered_has_schema": True, "schema_type": "SoftwareApplication"},
        expected_fix={"action": "server_embed_schema", "schema_type": "SoftwareApplication"},
        expected_post_fix_state={"raw_has_schema": True},
        is_browser_render_dependent=True,
    ),
]


# ------------------------------------------------------------------------------
# Expected Page States for Dynamic SPA Fixture
# ------------------------------------------------------------------------------

DYNAMIC_RESOURCES: dict[str, ExpectedPageState] = {
    "/": ExpectedPageState(
        url_path="/",
        status_code=200,
        title="QuantumAI Search Intelligence - Modern Generative Discovery Platform",
        meta_description="QuantumAI powers modern search intelligence, generative AI visibility monitoring, and automated SEO discovery.",
        canonical_url="https://dynamic.lab.local/dashboard",
        h1_headings=["Real-Time AI Search Analytics and Visibility"],
        headings_hierarchy_valid=True,
        structured_data_types=["SoftwareApplication"],
        structured_data_valid=True,
        internal_link_targets=["/dashboard", "/analytics", "/settings"],
        aeo_answer_blocks=["Generative search visibility measures how frequently, accurately, and prominently a brand or domain is cited as an authoritative source in AI-generated direct answers across conversational search engines."],
        intentional_defect_ids=["DEF-DYN-001", "DEF-DYN-002", "DEF-DYN-003"],
        is_client_rendered=True,
    ),
    "/dashboard": ExpectedPageState(
        url_path="/dashboard",
        status_code=200,
        title="QuantumAI Search Intelligence - Modern Generative Discovery Platform",
        meta_description="QuantumAI powers modern search intelligence, generative AI visibility monitoring, and automated SEO discovery.",
        canonical_url="https://dynamic.lab.local/dashboard",
        h1_headings=["Real-Time AI Search Analytics and Visibility"],
        headings_hierarchy_valid=True,
        structured_data_types=["SoftwareApplication"],
        structured_data_valid=True,
        internal_link_targets=["/dashboard", "/analytics", "/settings"],
        aeo_answer_blocks=["Generative search visibility measures how frequently, accurately, and prominently a brand or domain is cited as an authoritative source in AI-generated direct answers across conversational search engines."],
        intentional_defect_ids=["DEF-DYN-001", "DEF-DYN-002", "DEF-DYN-003"],
        is_client_rendered=True,
    ),
    "/analytics": ExpectedPageState(
        url_path="/analytics",
        status_code=200,
        title="Generative Engine Citation Analytics | QuantumAI",
        meta_description="Deep dive citation trends, keyword coverage, and source reliability scoring.",
        canonical_url="https://dynamic.lab.local/analytics",
        h1_headings=["Citation Trends and Source Analysis"],
        headings_hierarchy_valid=True,
        structured_data_types=[],
        structured_data_valid=True,
        internal_link_targets=["/dashboard", "/analytics"],
        intentional_defect_ids=[],
        is_client_rendered=True,
    ),
}

RAW_DYNAMIC_PAGES: dict[str, str] = {
    "/": RAW_SPA_SHELL_HTML,
    "/dashboard": RAW_SPA_SHELL_HTML,
    "/analytics": RAW_SPA_SHELL_HTML,
}

RENDERED_DYNAMIC_PAGES: dict[str, str] = {
    "/": RENDERED_DASHBOARD_HTML,
    "/dashboard": RENDERED_DASHBOARD_HTML,
    "/analytics": RENDERED_ANALYTICS_HTML,
}


def build_dynamic_site_fixture() -> LabFixtureConfig:
    """Builds and returns the deterministic Dynamic Browser-rendered site fixture configuration."""
    return LabFixtureConfig(
        fixture_id="dynamic_browser_site_01",
        name="QuantumAI Platform (Dynamic React/Next.js SPA)",
        fixture_type=LabFixtureType.DYNAMIC_BROWSER,
        base_url=DYNAMIC_BASE_URL,
        description="Controlled dynamic SPA fixture exposing raw shell vs rendered DOM snapshots to objectively prove browser rendering discovery and client-side signal extraction.",
        resources=DYNAMIC_RESOURCES,
        raw_html_pages=RAW_DYNAMIC_PAGES,
        rendered_html_pages=RENDERED_DYNAMIC_PAGES,
        defects=DYNAMIC_DEFECTS,
        robots_txt=DYNAMIC_ROBOTS_TXT,
        sitemap_xml=DYNAMIC_SITEMAP_XML,
        redirects={},
    )
