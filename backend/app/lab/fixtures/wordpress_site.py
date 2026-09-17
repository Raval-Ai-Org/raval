"""
WordPress Lab Fixture and Controlled Environment (Task 12 Step 1).

Integrates with the existing MockWordPressClient and WordPressConnector from Task 11,
pre-seeding deterministic WordPress pages, posts, and media attachments with known
SEO/GEO defects for closed-loop remediation validation.
"""

from __future__ import annotations

from typing import Any

from ..models import (
    DefectCategory,
    DefectSeverity,
    ExpectedPageState,
    IntentionalDefect,
    LabFixtureConfig,
    LabFixtureType,
)
from connectors.wordpress.client import MockWordPressClient
from connectors.wordpress.connector import WordPressConnector
from connectors.wordpress.models import (
    WordPressSiteIdentity,
    WordPressUserCapability,
)

WP_BASE_URL = "https://wp.lab.local"

# ------------------------------------------------------------------------------
# WordPress Lab Initial Data Seed
# ------------------------------------------------------------------------------

WP_SEED_PAGES: dict[int, dict[str, Any]] = {
    101: {
        "id": 101,
        "slug": "about-us",
        "title": "About Apex Enterprise",
        "content": "<h1>About Apex Enterprise</h1><p>We build enterprise cloud and generative AI search intelligence systems.</p><h2>Our Mission</h2><p>Deliver deterministic visibility across modern answer engines.</p>",
        "excerpt": "Learn about Apex Enterprise.",
        "post_type": "page",
        "status": "publish",
        "link": f"{WP_BASE_URL}/about-us",
        "meta": {
            # INTENTIONAL DEFECT DEF-WP-001: Missing _yoast_wpseo_title (empty string/None)
            "_yoast_wpseo_title": "",
            # INTENTIONAL DEFECT DEF-WP-002: Weak meta description (too brief: 22 chars)
            "_yoast_wpseo_metadesc": "Learn about our team.",
        },
        "modified_gmt": "2026-09-01T12:00:00Z",
        "author_id": 1,
    },
}

WP_SEED_POSTS: dict[int, dict[str, Any]] = {
    201: {
        "id": 201,
        "slug": "geo-guide",
        "title": "Generative Engine Optimization Guide 2026",
        # INTENTIONAL DEFECT DEF-WP-003: Embedded media image missing alt attribute
        # INTENTIONAL DEFECT DEF-WP-004: Missing structured direct answer definition block
        "content": """<h1>Generative Engine Optimization Guide 2026</h1>
<p>Generative search engines are changing how users discover online products and services.</p>
<img src='https://wp.lab.local/wp-content/uploads/2026/09/geo-diagram.png' alt='' />
<h2>Key Insights</h2>
<p>To rank in LLM search results, maintain verified facts, direct answer blocks, and high authority citations.</p>""",
        "excerpt": "A technical overview of Generative Engine Optimization.",
        "post_type": "post",
        "status": "publish",
        "link": f"{WP_BASE_URL}/geo-guide",
        "meta": {
            "_yoast_wpseo_title": "GEO Guide 2026 | Apex Enterprise",
            "_yoast_wpseo_metadesc": "Comprehensive guide to Generative Engine Optimization and AI search ranking.",
        },
        "modified_gmt": "2026-09-02T10:00:00Z",
        "author_id": 1,
    },
    202: {
        "id": 202,
        "slug": "ai-search-ranking",
        "title": "AI Search Ranking Factors",
        "content": "<h1>AI Search Ranking Factors</h1><p>Understanding authority, citation density, and first-party verification signals.</p>",
        "excerpt": "Analysis of AI search ranking algorithms.",
        "post_type": "post",
        "status": "publish",
        "link": f"{WP_BASE_URL}/ai-search-ranking",
        "meta": {
            "_yoast_wpseo_title": "AI Search Ranking Factors 2026",
            "_yoast_wpseo_metadesc": "Learn the core signals driving Perplexity and ChatGPT search citations.",
            # INTENTIONAL DEFECT DEF-WP-005: Yoast canonical misconfigured to invalid external domain
            "_yoast_wpseo_canonical": "https://wrong-external-domain.com/ai-search",
        },
        "modified_gmt": "2026-09-03T09:00:00Z",
        "author_id": 1,
    },
}

WP_SEED_MEDIA: dict[int, dict[str, Any]] = {
    301: {
        "id": 301,
        "slug": "geo-diagram",
        "title": "GEO Architectural Diagram",
        "source_url": f"{WP_BASE_URL}/wp-content/uploads/2026/09/geo-diagram.png",
        # INTENTIONAL DEFECT DEF-WP-003: Empty alt_text on media asset
        "alt_text": "",
        "caption": "Generative Engine Optimization pipeline architecture",
        "description": "Full architectural blueprint",
        "mime_type": "image/png",
        "modified_gmt": "2026-09-01T08:00:00Z",
    },
}


# ------------------------------------------------------------------------------
# Intentional Defects Catalog for WordPress Fixture
# ------------------------------------------------------------------------------

WP_DEFECTS: list[IntentionalDefect] = [
    IntentionalDefect(
        defect_id="DEF-WP-001",
        fixture_id="wordpress_site_01",
        category=DefectCategory.METADATA,
        severity=DefectSeverity.HIGH,
        target_resource="page:101",
        rule_code="WP_YOAST_TITLE_MISSING",
        title="Missing Yoast SEO Title on About Page",
        description="Page ID 101 has an empty _yoast_wpseo_title meta field.",
        raw_state={"resource_id": 101, "resource_type": "page", "yoast_title": ""},
        expected_fix={"field": "meta._yoast_wpseo_title", "value": "About Apex Enterprise | Cloud AI Solutions"},
        expected_post_fix_state={"yoast_title": "About Apex Enterprise | Cloud AI Solutions"},
    ),
    IntentionalDefect(
        defect_id="DEF-WP-002",
        fixture_id="wordpress_site_01",
        category=DefectCategory.METADATA,
        severity=DefectSeverity.MEDIUM,
        target_resource="page:101",
        rule_code="WP_YOAST_DESC_WEAK",
        title="Weak Yoast Meta Description",
        description="Page ID 101 has an overly short meta description ('Learn about our team.').",
        raw_state={"resource_id": 101, "resource_type": "page", "yoast_metadesc": "Learn about our team.", "length": 22},
        expected_fix={"field": "meta._yoast_wpseo_metadesc", "value": "Discover how Apex Enterprise delivers AI-driven search intelligence and enterprise cloud governance solutions."},
        expected_post_fix_state={"yoast_metadesc": "Discover how Apex Enterprise delivers AI-driven search intelligence and enterprise cloud governance solutions."},
    ),
    IntentionalDefect(
        defect_id="DEF-WP-003",
        fixture_id="wordpress_site_01",
        category=DefectCategory.ACCESSIBILITY,
        severity=DefectSeverity.MEDIUM,
        target_resource="media:301",
        rule_code="WP_MEDIA_ALT_MISSING",
        title="Missing Media Alt Text in Attachment and Post Content",
        description="Media attachment ID 301 and its embedded occurrence in post 201 have empty alt text.",
        raw_state={"media_id": 301, "alt_text": ""},
        expected_fix={"field": "alt_text", "value": "Generative Engine Optimization AI Pipeline Architecture Diagram"},
        expected_post_fix_state={"alt_text": "Generative Engine Optimization AI Pipeline Architecture Diagram"},
    ),
    IntentionalDefect(
        defect_id="DEF-WP-004",
        fixture_id="wordpress_site_01",
        category=DefectCategory.AEO_GEO,
        severity=DefectSeverity.HIGH,
        target_resource="post:201",
        rule_code="WP_AEO_ANSWER_MISSING",
        title="Post Content Missing Structured Direct Answer Block",
        description="Post ID 201 lacks a concise 30-50 word definitional answer paragraph required for answer engine citations.",
        raw_state={"has_direct_answer": False},
        expected_fix={"action": "insert_answer_block", "snippet": "<div class='aeo-direct-answer'><p><strong>Generative Engine Optimization (GEO)</strong> is the practice of optimizing digital content and entity signals to maximize visibility and citations in generative AI search responses.</p></div>"},
        expected_post_fix_state={"has_direct_answer": True},
    ),
    IntentionalDefect(
        defect_id="DEF-WP-005",
        fixture_id="wordpress_site_01",
        category=DefectCategory.CANONICAL,
        severity=DefectSeverity.HIGH,
        target_resource="post:202",
        rule_code="WP_CANONICAL_MISCONFIGURED",
        title="Yoast Canonical Points to Wrong External Domain",
        description="Post ID 202 has _yoast_wpseo_canonical explicitly set to 'https://wrong-external-domain.com/ai-search'.",
        raw_state={"canonical_url": "https://wrong-external-domain.com/ai-search", "is_correct": False},
        expected_fix={"field": "meta._yoast_wpseo_canonical", "value": "https://wp.lab.local/ai-search-ranking"},
        expected_post_fix_state={"canonical_url": "https://wp.lab.local/ai-search-ranking", "is_correct": True},
    ),
]


# ------------------------------------------------------------------------------
# Expected Page States for WordPress Fixture
# ------------------------------------------------------------------------------

WP_RESOURCES: dict[str, ExpectedPageState] = {
    "/about-us": ExpectedPageState(
        url_path="/about-us",
        status_code=200,
        title="About Apex Enterprise",
        meta_description="Learn about our team.",
        canonical_url=f"{WP_BASE_URL}/about-us",
        h1_headings=["About Apex Enterprise"],
        headings_hierarchy_valid=True,
        structured_data_types=[],
        structured_data_valid=True,
        internal_link_targets=[],
        intentional_defect_ids=["DEF-WP-001", "DEF-WP-002"],
    ),
    "/geo-guide": ExpectedPageState(
        url_path="/geo-guide",
        status_code=200,
        title="GEO Guide 2026 | Apex Enterprise",
        meta_description="Comprehensive guide to Generative Engine Optimization and AI search ranking.",
        canonical_url=f"{WP_BASE_URL}/geo-guide",
        h1_headings=["Generative Engine Optimization Guide 2026"],
        headings_hierarchy_valid=True,
        structured_data_types=[],
        structured_data_valid=True,
        internal_link_targets=[],
        intentional_defect_ids=["DEF-WP-003", "DEF-WP-004"],
    ),
    "/ai-search-ranking": ExpectedPageState(
        url_path="/ai-search-ranking",
        status_code=200,
        title="AI Search Ranking Factors 2026",
        meta_description="Learn the core signals driving Perplexity and ChatGPT search citations.",
        canonical_url="https://wrong-external-domain.com/ai-search",  # Misconfigured
        h1_headings=["AI Search Ranking Factors"],
        headings_hierarchy_valid=True,
        structured_data_types=[],
        structured_data_valid=True,
        internal_link_targets=[],
        intentional_defect_ids=["DEF-WP-005"],
    ),
}

WP_RAW_PAGES: dict[str, str] = {
    "/about-us": f"""<!doctype html><html><head><title>About Apex Enterprise</title><meta name="description" content="Learn about our team."><link rel="canonical" href="{WP_BASE_URL}/about-us"></head><body><h1>About Apex Enterprise</h1><p>We build enterprise cloud and generative AI search intelligence systems.</p><h2>Our Mission</h2><p>Deliver deterministic visibility across modern answer engines.</p></body></html>""",
    "/geo-guide": f"""<!doctype html><html><head><title>GEO Guide 2026 | Apex Enterprise</title><meta name="description" content="Comprehensive guide to Generative Engine Optimization and AI search ranking."><link rel="canonical" href="{WP_BASE_URL}/geo-guide"></head><body><h1>Generative Engine Optimization Guide 2026</h1><p>Generative search engines are changing how users discover online products and services.</p><img src='https://wp.lab.local/wp-content/uploads/2026/09/geo-diagram.png' alt='' /><h2>Key Insights</h2><p>To rank in LLM search results, maintain verified facts, direct answer blocks, and high authority citations.</p></body></html>""",
    "/ai-search-ranking": f"""<!doctype html><html><head><title>AI Search Ranking Factors 2026</title><meta name="description" content="Learn the core signals driving Perplexity and ChatGPT search citations."><link rel="canonical" href="https://wrong-external-domain.com/ai-search"></head><body><h1>AI Search Ranking Factors</h1><p>Understanding authority, citation density, and first-party verification signals.</p></body></html>""",
}


class WordPressLabEnvironment:
    """
    Manages an isolated WordPress test environment pre-configured with lab seed data and defects.
    """

    def __init__(self, site_url: str = WP_BASE_URL) -> None:
        self.site_url = site_url
        self.client = self._create_seeded_client()

    def _create_seeded_client(self) -> MockWordPressClient:
        client = MockWordPressClient(
            site_url=self.site_url,
            authenticated_user=WordPressUserCapability(
                user_id=1,
                username="lab_admin",
                roles=["administrator"],
                capabilities=[
                    "read",
                    "edit_posts",
                    "edit_pages",
                    "publish_posts",
                    "publish_pages",
                    "upload_files",
                    "manage_options",
                ],
            ),
        )
        # Seed deterministic lab pages, posts, and media
        client.pages = {k: dict(v) for k, v in WP_SEED_PAGES.items()}
        client.posts = {k: dict(v) for k, v in WP_SEED_POSTS.items()}
        client.media = {k: dict(v) for k, v in WP_SEED_MEDIA.items()}
        return client

    def get_connector(self) -> WordPressConnector:
        """Returns a configured WordPressConnector linked to this lab client."""
        ctx = WordPressConnector.create_default_context(
            site_url=self.site_url,
            site_id="site_wp_lab",
        )
        ctx.metadata["environment"] = "controlled_lab"
        return WordPressConnector(site_context=ctx, client=self.client)


def build_wordpress_fixture() -> LabFixtureConfig:
    """Builds and returns the deterministic WordPress site fixture configuration."""
    return LabFixtureConfig(
        fixture_id="wordpress_site_01",
        name="Apex Enterprise (WordPress Mock & Connector Fixture)",
        fixture_type=LabFixtureType.WORDPRESS,
        base_url=WP_BASE_URL,
        description="Controlled WordPress fixture providing realistic pages, posts, media assets, and Yoast SEO metadata with intentional metadata, accessibility, AEO, and canonical defects.",
        resources=WP_RESOURCES,
        raw_html_pages=WP_RAW_PAGES,
        defects=WP_DEFECTS,
        robots_txt="User-agent: *\nDisallow: /wp-admin/\nAllow: /wp-admin/admin-ajax.php\n",
        sitemap_xml=None,
        redirects={},
    )
