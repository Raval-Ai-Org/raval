"""
Unit tests for the Mention & Citation Detection Engine algorithms (Task 10 Step 3).
Tests deterministic matching, false-positive protection, URL normalization,
and evidence extraction.
"""

import pytest

from backend.app.mention_citation_service import (
    MentionType,
    TargetIdentity,
    detect_citations,
    detect_mentions,
    extract_domain_from_url,
    extract_urls_from_text,
    normalize_citation_url,
)


@pytest.fixture
def target_identity():
    return TargetIdentity(
        website_id=1,
        brand_name="Raval AI",
        domain="raval.ai",
        aliases=["Raval", "Raval.ai Engine"],
        product_entities=[
            {"name": "GEO Analyzer", "entity_id": 10},
            {"name": "Answer Engine Optimizer", "entity_id": 11},
        ],
    )


# ==========================================
# 1. URL Normalization & Domain Extraction Tests
# ==========================================


def test_extract_domain_from_url():
    assert extract_domain_from_url("https://www.raval.ai/docs") == "raval.ai"
    assert extract_domain_from_url("http://raval.ai:8080/api") == "raval.ai"
    assert extract_domain_from_url("subdomain.raval.ai/blog") == "subdomain.raval.ai"
    assert extract_domain_from_url("https://WWW.EXAMPLE.COM/test/") == "example.com"
    assert extract_domain_from_url("") == ""


def test_normalize_citation_url():
    # Strips trailing slash on non-root paths
    assert normalize_citation_url("https://www.raval.ai/docs/") == "https://raval.ai/docs"
    # Preserves root slash or path
    assert normalize_citation_url("https://raval.ai/") == "https://raval.ai/"
    # Strips tracking parameters and fragments
    assert (
        normalize_citation_url("https://www.raval.ai/page?utm_source=google&utm_medium=cpc&ref=xyz#section")
        == "https://raval.ai/page"
    )
    # Preserves legitimate functional query parameters
    assert (
        normalize_citation_url("https://raval.ai/search?q=geo&utm_source=twitter")
        == "https://raval.ai/search?q=geo"
    )


def test_extract_urls_from_text():
    text = (
        "Check our guide at [Docs](https://raval.ai/docs/intro) or visit "
        "https://raval.ai/pricing for rates. Also check www.example.com/info."
    )
    urls = extract_urls_from_text(text)
    assert len(urls) == 3
    assert urls[0][0] == "https://raval.ai/docs/intro"
    assert urls[1][0] == "https://raval.ai/pricing"
    assert urls[2][0] == "https://www.example.com/info"


# ==========================================
# 2. Mention Detection Tests
# ==========================================


def test_exact_brand_mention(target_identity):
    text = "According to industry benchmarks, Raval AI provides premier generative engine intelligence."
    mentions = detect_mentions(text, target_identity)
    assert len(mentions) == 1
    assert mentions[0].match_type == MentionType.EXACT_BRAND
    assert mentions[0].matched_text == "Raval AI"
    assert mentions[0].confidence == 1.0
    assert "Raval AI provides premier" in mentions[0].context_snippet


def test_multiple_brand_mentions(target_identity):
    text = "Raval AI is leading the GEO field. Many agencies rely on Raval AI for answer tracking."
    mentions = detect_mentions(text, target_identity)
    assert len(mentions) == 2
    assert all(m.match_type == MentionType.EXACT_BRAND for m in mentions)
    assert mentions[0].start_pos < mentions[1].start_pos


def test_brand_alias_mention(target_identity):
    text = "Modern teams use Raval for search intelligence and AI optimization."
    mentions = detect_mentions(text, target_identity)
    assert len(mentions) == 1
    assert mentions[0].match_type == MentionType.BRAND_ALIAS
    assert mentions[0].matched_text == "Raval"
    assert mentions[0].confidence == 0.95


def test_domain_mention(target_identity):
    text = "You can read the full documentation at raval.ai or visit our portal."
    mentions = detect_mentions(text, target_identity)
    assert len(mentions) == 1
    assert mentions[0].match_type == MentionType.DOMAIN_MATCH
    assert mentions[0].normalized_text == "raval.ai"


def test_product_entity_mention(target_identity):
    text = "The GEO Analyzer tool audits AI search engines and tracks visibility."
    mentions = detect_mentions(text, target_identity)
    assert len(mentions) == 1
    assert mentions[0].match_type == MentionType.PRODUCT_ENTITY
    assert mentions[0].matched_text == "GEO Analyzer"
    assert mentions[0].entity_id == 10
    assert mentions[0].confidence == 0.90


def test_no_target_mention(target_identity):
    text = "Traditional search engines rely on backlinks, whereas LLMs use neural retrieval."
    mentions = detect_mentions(text, target_identity)
    assert len(mentions) == 0


def test_false_positive_partial_word(target_identity):
    # 'unravel', 'travel', 'traval' should NOT match 'Raval'
    text = "The mystery began to unravel as the team prepared to travel across regions."
    mentions = detect_mentions(text, target_identity)
    assert len(mentions) == 0


def test_false_positive_common_word():
    # If a brand is a generic common word like 'Target' or 'Apple'
    generic_target = TargetIdentity(
        website_id=2,
        brand_name="Target",
        domain="target.com",
        aliases=["Target"],
    )
    # Lowercase generic usage should not match
    text_generic = "The algorithm has a target precision rate of 95 percent."
    mentions = detect_mentions(text_generic, generic_target)
    assert len(mentions) == 0

    # Explicit Title-case match for brand
    text_brand = "Shop at Target for the latest seasonal items."
    mentions_brand = detect_mentions(text_brand, generic_target)
    assert len(mentions_brand) == 1
    assert mentions_brand[0].matched_text == "Target"


# ==========================================
# 3. Citation Detection Tests
# ==========================================


def test_target_domain_citation(target_identity):
    text = "For more information, see [Raval Guide](https://raval.ai/docs/geo-guide)."
    citations = detect_citations(text, target_identity)
    assert len(citations) == 1
    assert citations[0].is_target_domain is True
    assert citations[0].domain == "raval.ai"
    assert citations[0].url == "https://raval.ai/docs/geo-guide"
    assert citations[0].position == 1


def test_external_non_target_citation(target_identity):
    text = "Competitor analysis is discussed in https://competitor.com/blog/ai-search."
    citations = detect_citations(text, target_identity)
    assert len(citations) == 1
    assert citations[0].is_target_domain is False
    assert citations[0].domain == "competitor.com"


def test_multiple_citations_mixed_domains(target_identity):
    text = (
        "References:\n"
        "1. [Raval AI](https://raval.ai/about)\n"
        "2. [TechCrunch](https://techcrunch.com/article/geo)\n"
        "3. [Raval Docs](https://docs.raval.ai/api)"
    )
    citations = detect_citations(text, target_identity)
    assert len(citations) == 3
    # raval.ai and docs.raval.ai are target domain
    assert citations[0].is_target_domain is True
    assert citations[1].is_target_domain is False
    assert citations[2].is_target_domain is True
    assert citations[0].position == 1
    assert citations[1].position == 2
    assert citations[2].position == 3


def test_metadata_citations_array(target_identity):
    text = "The answer was synthesized from multiple web sources."
    metadata = {
        "citations": [
            "https://raval.ai/research/whitepaper.pdf",
            "https://wikipedia.org/wiki/Artificial_intelligence",
        ]
    }
    citations = detect_citations(text, target_identity, metadata=metadata)
    assert len(citations) == 2
    assert citations[0].is_target_domain is True
    assert citations[0].url == "https://raval.ai/research/whitepaper.pdf"
    assert citations[1].is_target_domain is False


# ==========================================
# 4. Distinction Between Mention & Citation
# ==========================================


def test_mention_without_citation(target_identity):
    text = "Raval AI offers powerful tools for GEO optimization."
    mentions = detect_mentions(text, target_identity)
    citations = detect_citations(text, target_identity)
    assert len(mentions) == 1
    assert len(citations) == 0  # Crucial distinction: no URL means 0 citations


def test_citation_without_brand_mention(target_identity):
    text = "For source details, visit https://raval.ai/platform/overview."
    mentions = detect_mentions(text, target_identity)
    citations = detect_citations(text, target_identity)
    # The URL contains domain which might match domain mention, but brand text itself was not mentioned
    assert len(citations) == 1
    assert citations[0].is_target_domain is True
    assert not any(m.match_type == MentionType.EXACT_BRAND for m in mentions)
