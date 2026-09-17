"""
Server-Rendered Site Fixture for Controlled Site Lab (Task 12 Step 1).

Implements a realistic, deterministic server-rendered site returning dynamic HTML responses
with SSR metadata headers, dynamic catalog rendering, and intentional technical/AEO defects.
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

SSR_BASE_URL = "https://ssr.lab.local"

# ------------------------------------------------------------------------------
# Raw HTML Documents for Server-Rendered Pages
# ------------------------------------------------------------------------------

SSR_HOME_HTML = """<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <!-- INTENTIONAL DEFECT DEF-SSR-001: Excessively long title (95 characters) -->
    <title>Nexus Distributed Systems & Autonomous Cloud Infrastructure Observability Suite Platform 2026</title>
    <meta name="description" content="Nexus delivers server-rendered high throughput cloud orchestration and unified observability for enterprise architectures.">
    <link rel="canonical" href="https://ssr.lab.local/">
    <script type="application/ld+json">
    {
        "@context": "https://schema.org",
        "@type": "WebSite",
        "name": "Nexus Infrastructure",
        "url": "https://ssr.lab.local/"
    }
    </script>
</head>
<body>
    <header>
        <nav>
            <a href="/">Home</a>
            <a href="/products/ai-analytics">AI Analytics</a>
            <a href="/faq">FAQ</a>
            <a href="/legacy-catalog">Legacy Catalog</a>
        </nav>
    </header>
    <main>
        <h1>Nexus Distributed Cloud Intelligence</h1>
        <p>Real-time distributed infrastructure tracking with zero client overhead and sub-millisecond query latency.</p>
        <!-- INTENTIONAL DEFECT DEF-SSR-002: Question without direct answer block (conversational fluff) -->
        <section class="faq-section">
            <h2>What is autonomous cloud observability?</h2>
            <p>Well, when people think about cloud observability, they often wonder about many different things and ask questions regarding how telemetry data is gathered, processed, and visualized over time across various enterprise cloud environments without immediate clarity.</p>
        </section>
        <h2>Architecture Highlights</h2>
        <ul>
            <li>High throughput event ingestion engine</li>
            <li>Sub-second anomaly detection algorithms</li>
            <li>Direct eBPF kernel instrumentation</li>
        </ul>
    </main>
    <footer>
        <p>&copy; 2026 Nexus Infrastructure. Rendered by SSR Engine v4.2.</p>
    </footer>
</body>
</html>"""

SSR_PRODUCTS_HTML = """<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <title>AI Analytics & Observability Modules | Nexus</title>
    <meta name="description" content="Explore Nexus AI-powered infrastructure observability, log indexing, and distributed tracing modules.">
    <link rel="canonical" href="https://ssr.lab.local/products/ai-analytics">
    <script type="application/ld+json">
    {
        "@context": "https://schema.org",
        "@type": "ItemList",
        "itemListElement": [
            {
                "@type": "Product",
                "position": 1,
                "name": "Nexus Trace Agent",
                "description": "Distributed tracing kernel probe"
            },
            {
                "@type": "Product",
                "position": 2,
                "name": "Nexus Metrics Ingestor",
                "description": "High-velocity time-series database"
            }
        ]
    }
    </script>
</head>
<body>
    <header>
        <nav>
            <a href="/">Home</a>
            <a href="/products/ai-analytics">AI Analytics</a>
            <a href="/faq">FAQ</a>
        </nav>
    </header>
    <main>
        <h1>AI Analytics & Observability Modules</h1>
        <p>Explore our suite of server-rendered observability components engineered for high-scale enterprise workloads.</p>
        <div class="product-grid">
            <article class="product-card">
                <h2>Nexus Trace Agent</h2>
                <!-- INTENTIONAL DEFECT DEF-SSR-003: Product images missing alt text attribute -->
                <img src="/assets/trace-agent.png" class="prod-img">
                <p>Distributed tracing agent providing automatic kernel-level telemetry capture.</p>
            </article>
            <article class="product-card">
                <h2>Nexus Metrics Ingestor</h2>
                <img src="/assets/metrics-ingestor.png" class="prod-img">
                <p>Time-series metrics engine processing over 10 million events per second.</p>
            </article>
        </div>
    </main>
    <footer>
        <p>&copy; 2026 Nexus Infrastructure.</p>
    </footer>
</body>
</html>"""

SSR_FAQ_HTML = """<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <title>Frequently Asked Questions | Nexus Infrastructure</title>
    <meta name="description" content="Common questions and answers regarding Nexus deployment, agent configuration, and pricing tiers.">
    <!-- INTENTIONAL DEFECT DEF-SSR-004: Missing canonical link tag entirely -->
    <script type="application/ld+json">
    {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        "mainEntity": [
            {
                "@type": "Question",
                "name": "How does Nexus integrate with existing Kubernetes clusters?",
                "acceptedAnswer": {
                    "@type": "Answer",
                    "text": "Nexus installs via an official Helm chart as a DaemonSet with minimal memory footprint."
                }
            }
        ]
    }
    </script>
</head>
<body>
    <header>
        <nav>
            <a href="/">Home</a>
            <a href="/products/ai-analytics">AI Analytics</a>
            <a href="/faq">FAQ</a>
        </nav>
    </header>
    <main>
        <!-- INTENTIONAL DEFECT DEF-SSR-005: Missing H1 heading, starts with H2 -->
        <h2>Frequently Asked Questions</h2>
        <section>
            <h3>How does Nexus integrate with existing Kubernetes clusters?</h3>
            <p>Nexus installs via an official Helm chart as a DaemonSet with minimal memory footprint.</p>
            <h3>What is the data retention policy?</h3>
            <p>Standard enterprise telemetry is retained for 90 days with warm storage replication.</p>
        </section>
    </main>
    <footer>
        <p>&copy; 2026 Nexus Infrastructure.</p>
    </footer>
</body>
</html>"""

SSR_ROBOTS_TXT = """User-agent: *
Allow: /
Disallow: /api/internal/
Sitemap: https://ssr.lab.local/sitemap.xml
"""

SSR_SITEMAP_XML = """<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://ssr.lab.local/</loc>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>https://ssr.lab.local/products/ai-analytics</loc>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>
  <url>
    <loc>https://ssr.lab.local/faq</loc>
    <changefreq>weekly</changefreq>
    <priority>0.7</priority>
  </url>
</urlset>"""


# ------------------------------------------------------------------------------
# Intentional Defects Catalog for SSR Fixture
# ------------------------------------------------------------------------------

SSR_DEFECTS: list[IntentionalDefect] = [
    IntentionalDefect(
        defect_id="DEF-SSR-001",
        fixture_id="server_rendered_site_01",
        category=DefectCategory.METADATA,
        severity=DefectSeverity.MEDIUM,
        target_resource="/",
        rule_code="TITLE_TOO_LONG",
        title="Excessively Long Page Title",
        description="The homepage title length is 95 characters, exceeding the recommended 60-70 character ceiling.",
        raw_state={"title_length": 95, "too_long": True},
        expected_fix={"action": "shorten_title", "title": "Nexus Infrastructure - Distributed Observability Suite"},
        expected_post_fix_state={"title_length": 55, "too_long": False},
    ),
    IntentionalDefect(
        defect_id="DEF-SSR-002",
        fixture_id="server_rendered_site_01",
        category=DefectCategory.AEO_GEO,
        severity=DefectSeverity.HIGH,
        target_resource="/",
        rule_code="R-QNA-02",
        title="Missing Direct Answer Block in FAQ Section",
        description="The FAQ question opens with conversational filler rather than providing a concise 30-50 word direct definition.",
        raw_state={"has_direct_answer": False, "starts_with_fluff": True},
        expected_fix={"action": "rewrite_answer_block", "answer": "Autonomous cloud observability is the continuous, automated collection and real-time analysis of system metrics, logs, and distributed traces to detect and resolve infrastructure anomalies without manual human intervention."},
        expected_post_fix_state={"has_direct_answer": True, "starts_with_fluff": False},
    ),
    IntentionalDefect(
        defect_id="DEF-SSR-003",
        fixture_id="server_rendered_site_01",
        category=DefectCategory.ACCESSIBILITY,
        severity=DefectSeverity.MEDIUM,
        target_resource="/products/ai-analytics",
        rule_code="IMAGE_ALT_MISSING",
        title="Missing Image Alt Attributes",
        description="Product catalog images on the AI analytics page lack alt text attributes.",
        raw_state={"images_without_alt_count": 2},
        expected_fix={"action": "add_image_alts", "alts": {"trace-agent.png": "Nexus Trace Agent Kernel Telemetry Probe", "metrics-ingestor.png": "Nexus High-Velocity Time-Series Metrics Ingestor"}},
        expected_post_fix_state={"images_without_alt_count": 0},
    ),
    IntentionalDefect(
        defect_id="DEF-SSR-004",
        fixture_id="server_rendered_site_01",
        category=DefectCategory.CANONICAL,
        severity=DefectSeverity.MEDIUM,
        target_resource="/faq",
        rule_code="CANONICAL_MISSING",
        title="Missing Canonical Tag on FAQ Page",
        description="The server-rendered FAQ page lacks a canonical link element.",
        raw_state={"canonical_present": False},
        expected_fix={"action": "insert_canonical", "canonical_url": "https://ssr.lab.local/faq"},
        expected_post_fix_state={"canonical_present": True, "canonical_url": "https://ssr.lab.local/faq"},
    ),
    IntentionalDefect(
        defect_id="DEF-SSR-005",
        fixture_id="server_rendered_site_01",
        category=DefectCategory.HEADINGS,
        severity=DefectSeverity.HIGH,
        target_resource="/faq",
        rule_code="R-STR-01",
        title="Missing H1 Heading on FAQ Page",
        description="The FAQ page opens with an H2 tag and completely lacks a primary H1 heading.",
        raw_state={"h1_count": 0},
        expected_fix={"action": "insert_h1", "h1": "Frequently Asked Questions"},
        expected_post_fix_state={"h1_count": 1, "h1_texts": ["Frequently Asked Questions"]},
    ),
]


# ------------------------------------------------------------------------------
# Expected Page States for SSR Fixture
# ------------------------------------------------------------------------------

SSR_RESOURCES: dict[str, ExpectedPageState] = {
    "/": ExpectedPageState(
        url_path="/",
        status_code=200,
        title="Nexus Distributed Systems & Autonomous Cloud Infrastructure Observability Suite Platform 2026",
        meta_description="Nexus delivers server-rendered high throughput cloud orchestration and unified observability for enterprise architectures.",
        canonical_url="https://ssr.lab.local/",
        h1_headings=["Nexus Distributed Cloud Intelligence"],
        headings_hierarchy_valid=True,
        structured_data_types=["WebSite"],
        structured_data_valid=True,
        internal_link_targets=["/", "/products/ai-analytics", "/faq", "/legacy-catalog"],
        intentional_defect_ids=["DEF-SSR-001", "DEF-SSR-002"],
    ),
    "/products/ai-analytics": ExpectedPageState(
        url_path="/products/ai-analytics",
        status_code=200,
        title="AI Analytics & Observability Modules | Nexus",
        meta_description="Explore Nexus AI-powered infrastructure observability, log indexing, and distributed tracing modules.",
        canonical_url="https://ssr.lab.local/products/ai-analytics",
        h1_headings=["AI Analytics & Observability Modules"],
        headings_hierarchy_valid=True,
        structured_data_types=["ItemList"],
        structured_data_valid=True,
        internal_link_targets=["/", "/products/ai-analytics", "/faq"],
        intentional_defect_ids=["DEF-SSR-003"],
    ),
    "/faq": ExpectedPageState(
        url_path="/faq",
        status_code=200,
        title="Frequently Asked Questions | Nexus Infrastructure",
        meta_description="Common questions and answers regarding Nexus deployment, agent configuration, and pricing tiers.",
        canonical_url=None,  # Missing intentionally
        h1_headings=[],  # Missing H1 intentionally
        headings_hierarchy_valid=False,
        structured_data_types=["FAQPage"],
        structured_data_valid=True,
        internal_link_targets=["/", "/products/ai-analytics", "/faq"],
        intentional_defect_ids=["DEF-SSR-004", "DEF-SSR-005"],
    ),
    "/server-error-demo": ExpectedPageState(
        url_path="/server-error-demo",
        status_code=500,
        title="500 Internal Server Error",
        meta_description=None,
        canonical_url=None,
        h1_headings=["Server Error"],
        headings_hierarchy_valid=True,
        structured_data_types=[],
        structured_data_valid=True,
        internal_link_targets=[],
        intentional_defect_ids=[],
    ),
}

RAW_SSR_PAGES: dict[str, str] = {
    "/": SSR_HOME_HTML,
    "/products/ai-analytics": SSR_PRODUCTS_HTML,
    "/faq": SSR_FAQ_HTML,
    "/server-error-demo": "<html><head><title>500 Internal Server Error</title></head><body><h1>Server Error</h1></body></html>",
}

SSR_REDIRECTS: dict[str, tuple[int, str]] = {
    "/legacy-catalog": (301, "/products/ai-analytics"),
}


def build_server_rendered_fixture() -> LabFixtureConfig:
    """Builds and returns the deterministic Server-Rendered site fixture configuration."""
    return LabFixtureConfig(
        fixture_id="server_rendered_site_01",
        name="Nexus Infrastructure (Server-Rendered HTML)",
        fixture_type=LabFixtureType.SERVER_RENDERED,
        base_url=SSR_BASE_URL,
        description="Dynamic server-rendered site returning fully populated HTML on HTTP GET with SSR headers and intentional title length, AEO answer, image alt, and heading defects.",
        resources=SSR_RESOURCES,
        raw_html_pages=RAW_SSR_PAGES,
        defects=SSR_DEFECTS,
        robots_txt=SSR_ROBOTS_TXT,
        sitemap_xml=SSR_SITEMAP_XML,
        redirects=SSR_REDIRECTS,
    )
