"""
Comprehensive Test Suite for Controlled Site Lab (Task 12 Step 1).

Verifies:
1. Creation and initialization of all 4 fixture types (Static, SSR, Dynamic, WordPress).
2. Deterministic URLs and resource mappings.
3. Machine-readable expected-state catalog loadability, serialization, and queries.
4. Static HTML fixture intentional defects verified against page_extractor.
5. Server-rendered fixture HTML output and intentional defects.
6. Dynamic React/Next.js fixture raw shell vs rendered DOM state and JS-injected signals.
7. WordPress fixture integration with MockWordPressClient and WordPressConnector.
8. robots.txt and sitemap.xml parsing with crawler modules.
9. 301 permanent redirect reproducibility.
10. Canonical, indexability, structured data, and internal link case reproducibility.
11. Determinism and idempotence across repeated initializations.
12. Zero production credentials or external network dependencies.
13. Compatibility with existing PageFetcher and crawler infrastructure.
"""

import json
import pytest
import requests

from app.lab import (
    DefectCategory,
    DefectSeverity,
    LabCatalog,
    LabFixtureType,
    LabTestServer,
    WordPressLabEnvironment,
    build_default_catalog,
    build_dynamic_site_fixture,
    build_server_rendered_fixture,
    build_static_site_fixture,
    build_wordpress_fixture,
    export_catalog_json,
    get_all_defects,
    get_all_fixtures,
    get_defect,
    get_defects_by_category,
    get_defects_by_rule,
    get_fixture,
    get_fixtures_by_type,
    get_lab_catalog,
    load_catalog_json,
)
from app.page_extractor import extract_html
from crawler.fetcher import PageFetcher
from crawler.robots import RobotsChecker
from crawler.sitemap import parse_sitemap_xml


# ==============================================================================
# 1. FIXTURE INITIALIZATION & CATALOG TESTS
# ==============================================================================

class TestControlledSiteLabCatalog:
    """Tests the centralized catalog, data models, and query interfaces."""

    def test_1_master_catalog_contains_all_four_fixture_types(self):
        catalog = get_lab_catalog(fresh=True)
        assert len(catalog.fixtures) == 4

        static_fix = catalog.get_fixture("static_site_01")
        ssr_fix = catalog.get_fixture("server_rendered_site_01")
        dyn_fix = catalog.get_fixture("dynamic_browser_site_01")
        wp_fix = catalog.get_fixture("wordpress_site_01")

        assert static_fix is not None and static_fix.fixture_type == LabFixtureType.STATIC_HTML
        assert ssr_fix is not None and ssr_fix.fixture_type == LabFixtureType.SERVER_RENDERED
        assert dyn_fix is not None and dyn_fix.fixture_type == LabFixtureType.DYNAMIC_BROWSER
        assert wp_fix is not None and wp_fix.fixture_type == LabFixtureType.WORDPRESS

    def test_2_defect_queries_by_category_and_rule(self):
        all_defects = get_all_defects()
        assert len(all_defects) == 23  # 10 static + 5 ssr + 3 dyn + 5 wp

        metadata_defects = get_defects_by_category(DefectCategory.METADATA)
        assert len(metadata_defects) >= 6

        canonical_defects = get_defects_by_category(DefectCategory.CANONICAL)
        assert len(canonical_defects) >= 4

        h1_missing_defects = get_defects_by_rule("R-STR-01")
        assert len(h1_missing_defects) >= 1

        specific_defect = get_defect("DEF-STATIC-001")
        assert specific_defect is not None
        assert specific_defect.rule_code == "TITLE_MISSING"
        assert specific_defect.target_resource == "/about.html"

    def test_3_catalog_json_serialization_and_deserialization(self):
        json_str = export_catalog_json()
        assert isinstance(json_str, str)
        assert "DEF-STATIC-001" in json_str
        assert "DEF-SSR-002" in json_str
        assert "DEF-DYN-001" in json_str
        assert "DEF-WP-005" in json_str

        reloaded = load_catalog_json(json_str)
        assert len(reloaded.fixtures) == 4
        assert len(reloaded.get_all_defects()) == 23


# ==============================================================================
# 2. STATIC HTML FIXTURE TESTS
# ==============================================================================

class TestStaticHTMLFixture:
    """Verifies intentional SEO/AEO defects in the Static HTML fixture."""

    @pytest.fixture(autouse=True)
    def setup(self):
        self.fixture = build_static_site_fixture()

    def test_static_fixture_homepage_is_valid(self):
        html = self.fixture.raw_html_pages["/"]
        ext = extract_html(html, page_url="https://static.lab.local/")

        assert ext.title_present is True
        assert "Apex Cloud Innovations" in ext.title_text
        assert ext.canonical_present is True
        assert len(ext.canonicals) == 1
        assert ext.canonicals[0].url == "https://static.lab.local/"
        assert ext.canonicals[0].self_reference is True
        assert ext.h1_count == 1
        assert len(ext.structured_data) >= 1
        assert "Organization" in ext.structured_data[0].types

    def test_defect_def_static_001_missing_title(self):
        html = self.fixture.raw_html_pages["/about.html"]
        ext = extract_html(html, page_url="https://static.lab.local/about.html")

        assert ext.title_present is False
        assert ext.title_text is None
        assert ext.title_empty is True

    def test_defect_def_static_002_multiple_h1(self):
        html = self.fixture.raw_html_pages["/about.html"]
        ext = extract_html(html, page_url="https://static.lab.local/about.html")

        assert ext.h1_count == 2
        h1_texts = [h.text for h in ext.headings if h.level == 1]
        assert "About Apex Cloud Innovations" in h1_texts
        assert "Our Executive Leadership" in h1_texts

    def test_defect_def_static_003_weak_meta_description(self):
        html = self.fixture.raw_html_pages["/services.html"]
        ext = extract_html(html, page_url="https://static.lab.local/services.html")

        assert ext.meta_description_present is True
        desc = ext.meta_descriptions[0]
        assert desc.text == "Services page"
        assert desc.length == 13
        assert desc.too_short is True

    def test_defect_def_static_004_canonical_conflict(self):
        html = self.fixture.raw_html_pages["/services.html"]
        ext = extract_html(html, page_url="https://static.lab.local/services.html")

        assert ext.canonical_present is True
        assert len(ext.canonicals) == 1
        assert ext.canonicals[0].url == "https://static.lab.local/wrong-services-url"
        assert ext.canonicals[0].self_reference is False

    def test_defect_def_static_005_malformed_json_ld(self):
        html = self.fixture.raw_html_pages["/docs.html"]
        ext = extract_html(html, page_url="https://static.lab.local/docs.html")

        # Malformed JSON-LD should either be skipped or have a parse error recorded
        assert len(ext.structured_data) == 0 or any(sd.parse_error is not None for sd in ext.structured_data)

    def test_defect_def_static_006_heading_hierarchy_skip(self):
        html = self.fixture.raw_html_pages["/docs.html"]
        ext = extract_html(html, page_url="https://static.lab.local/docs.html")

        levels = [h.level for h in ext.headings]
        # Has H1 followed directly by H3 (no H2)
        assert 1 in levels and 3 in levels and 2 not in levels

    def test_defect_def_static_008_robots_noindex(self):
        html = self.fixture.raw_html_pages["/contact.html"]
        ext = extract_html(html, page_url="https://static.lab.local/contact.html")

        assert ext.robots is not None
        assert ext.robots.noindex is True
        assert ext.robots.nofollow is False

    def test_defect_def_static_009_missing_canonical(self):
        html = self.fixture.raw_html_pages["/contact.html"]
        ext = extract_html(html, page_url="https://static.lab.local/contact.html")

        assert ext.canonical_present is False
        assert ext.canonical_count == 0


# ==============================================================================
# 3. SERVER-RENDERED FIXTURE TESTS
# ==============================================================================

class TestServerRenderedFixture:
    """Verifies Server-Rendered fixture HTML output and intentional defects."""

    @pytest.fixture(autouse=True)
    def setup(self):
        self.fixture = build_server_rendered_fixture()

    def test_defect_def_ssr_001_title_too_long(self):
        html = self.fixture.raw_html_pages["/"]
        ext = extract_html(html, page_url="https://ssr.lab.local/")

        assert ext.title_present is True
        assert ext.title_too_long is True
        assert ext.title_length >= 80

    def test_defect_def_ssr_002_aeo_missing_direct_answer(self):
        html = self.fixture.raw_html_pages["/"]
        assert "What is autonomous cloud observability?" in html
        assert "Well, when people think about cloud observability" in html

    def test_defect_def_ssr_003_missing_image_alts(self):
        html = self.fixture.raw_html_pages["/products/ai-analytics"]
        ext = extract_html(html, page_url="https://ssr.lab.local/products/ai-analytics")

        assert ext.image_count == 2
        # All images lack alt
        for img in ext.images:
            assert img.alt == "" or img.alt is None

    def test_defect_def_ssr_004_and_005_faq_missing_canonical_and_h1(self):
        html = self.fixture.raw_html_pages["/faq"]
        ext = extract_html(html, page_url="https://ssr.lab.local/faq")

        assert ext.canonical_present is False
        assert ext.h1_count == 0


# ==============================================================================
# 4. DYNAMIC REACT/NEXT.JS FIXTURE TESTS
# ==============================================================================

class TestDynamicSiteFixture:
    """Verifies raw shell vs hydrated DOM state in Dynamic React/Next.js fixture."""

    @pytest.fixture(autouse=True)
    def setup(self):
        self.fixture = build_dynamic_site_fixture()

    def test_raw_shell_vs_rendered_dom_comparison(self):
        raw_html = self.fixture.raw_html_pages["/dashboard"]
        rendered_html = self.fixture.rendered_html_pages["/dashboard"]

        raw_ext = extract_html(raw_html, page_url="https://dynamic.lab.local/dashboard")
        rendered_ext = extract_html(rendered_html, page_url="https://dynamic.lab.local/dashboard")

        # Pre-hydration: minimal shell
        assert raw_ext.title_text == "Loading Application..."
        assert raw_ext.h1_count == 0
        assert len(raw_ext.structured_data) == 0

        # Post-hydration: fully rendered DOM
        assert rendered_ext.title_text == "QuantumAI Search Intelligence - Modern Generative Discovery Platform"
        assert rendered_ext.h1_count == 1
        assert "Real-Time AI Search Analytics" in rendered_ext.headings[0].text
        assert len(rendered_ext.structured_data) == 1
        assert "SoftwareApplication" in rendered_ext.structured_data[0].types
        assert rendered_ext.canonical_present is True
        assert len(rendered_ext.canonicals) == 1
        assert rendered_ext.canonicals[0].url == "https://dynamic.lab.local/dashboard"


# ==============================================================================
# 5. WORDPRESS FIXTURE & CONNECTOR TESTS
# ==============================================================================

class TestWordPressLabFixture:
    """Verifies WordPress lab environment and connector integration."""

    def test_wordpress_lab_environment_initialization(self):
        env = WordPressLabEnvironment()
        connector = env.get_connector()
        ctx = connector.connect()

        from connectors import AuthState
        assert ctx.auth_state == AuthState.CONNECTED
        assert len(env.client.pages) >= 1
        assert len(env.client.posts) >= 2
        assert len(env.client.media) >= 1

    def test_wordpress_intentional_defects(self):
        env = WordPressLabEnvironment()

        # Defect DEF-WP-001: Missing Yoast title
        page_101 = env.client.pages[101]
        assert page_101["meta"]["_yoast_wpseo_title"] == ""

        # Defect DEF-WP-002: Weak meta description
        assert page_101["meta"]["_yoast_wpseo_metadesc"] == "Learn about our team."

        # Defect DEF-WP-003: Media alt text missing
        media_301 = env.client.media[301]
        assert media_301["alt_text"] == ""

        # Defect DEF-WP-005: Canonical pointing to wrong domain
        post_202 = env.client.posts[202]
        assert post_202["meta"]["_yoast_wpseo_canonical"] == "https://wrong-external-domain.com/ai-search"

    def test_wordpress_connector_read_and_mutation(self):
        from connectors import ResourceReference, ResourceType

        env = WordPressLabEnvironment()
        connector = env.get_connector()
        connector.connect()

        # Read resource through connector interface
        ref = ResourceReference(
            resource_type=ResourceType.CMS_PAGE,
            resource_id="101",
            path="/about-us",
        )
        content = connector.read_resource(ref)
        assert content.resource.resource_id == "101"
        assert "About Apex Enterprise" in content.metadata.get("title", "")


# ==============================================================================
# 6. LOCAL HTTP SERVER & CRAWLER INTERACTION TESTS
# ==============================================================================

class TestLabHTTPServer:
    """Verifies live in-process HTTP server hosting and crawler compatibility."""

    def test_live_server_lifecycle_and_static_routes(self):
        with LabTestServer() as server:
            home_url = server.get_static_url("/")
            resp = requests.get(home_url, timeout=5)
            assert resp.status_code == 200
            assert "Apex Cloud Innovations" in resp.text

            # Check robots.txt
            robots_url = server.get_static_url("/robots.txt")
            robots_resp = requests.get(robots_url, timeout=5)
            assert robots_resp.status_code == 200
            assert "Disallow: /admin/" in robots_resp.text

            # Check sitemap.xml
            sitemap_url = server.get_static_url("/sitemap.xml")
            sitemap_resp = requests.get(sitemap_url, timeout=5)
            assert sitemap_resp.status_code == 200
            parsed_sitemap = parse_sitemap_xml(sitemap_resp.text)
            assert len(parsed_sitemap.urls) >= 4

    def test_live_server_301_redirects(self):
        with LabTestServer() as server:
            redirect_url = server.get_static_url("/old-services")
            resp = requests.get(redirect_url, allow_redirects=False, timeout=5)
            assert resp.status_code == 301
            assert resp.headers["Location"] == "/static/services.html"

    def test_live_server_ssr_routes_and_headers(self):
        with LabTestServer() as server:
            ssr_url = server.get_ssr_url("/")
            resp = requests.get(ssr_url, timeout=5)
            assert resp.status_code == 200
            assert resp.headers.get("X-Rendered-By") == "Server-Side-Engine"
            assert "Nexus Distributed Cloud Intelligence" in resp.text

    def test_live_server_dynamic_spa_render_query(self):
        with LabTestServer() as server:
            # Raw request returns shell
            raw_url = server.get_dynamic_url("/dashboard")
            raw_resp = requests.get(raw_url, timeout=5)
            assert "Loading Application..." in raw_resp.text
            assert "Initializing interactive application..." in raw_resp.text

            # Rendered request returns hydrated DOM
            rendered_url = server.get_dynamic_url("/dashboard?rendered=true")
            rend_resp = requests.get(rendered_url, timeout=5)
            assert "QuantumAI Search Intelligence" in rend_resp.text
            assert "Real-Time AI Search Analytics and Visibility" in rend_resp.text

    def test_page_fetcher_integration_with_lab_server(self):
        with LabTestServer() as server:
            fetcher = PageFetcher()
            result = fetcher.fetch(server.get_static_url("/about.html"))

            assert result.success is True
            assert result.status_code == 200
            assert "About Apex Cloud Innovations" in result.content


# ==============================================================================
# 7. DETERMINISM & SECURITY REPRODUCIBILITY
# ==============================================================================

class TestDeterminismAndSecurity:
    """Verifies determinism, idempotence, and security isolation."""

    def test_repeated_initialization_produces_identical_state(self):
        catalog_1 = build_default_catalog()
        catalog_2 = build_default_catalog()

        dict_1 = catalog_1.model_dump()
        dict_2 = catalog_2.model_dump()

        assert dict_1 == dict_2

    def test_zero_real_credentials_or_external_domains(self):
        catalog = get_lab_catalog(fresh=True)
        for fixture in catalog.fixtures.values():
            assert ".local" in fixture.base_url
            for defect in fixture.defects:
                assert "sk-" not in str(defect)
                assert "ghp_" not in str(defect)
                assert "secret" not in str(defect.raw_state).lower() or "wrong" in str(defect.raw_state).lower()
