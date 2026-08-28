"""
External Source Detection Engine Tests (Day 8 - Phase B - Step 5 ONLY)

Verifies deterministic, evidence-based external source and citation detection:
1. External URL detection and domain normalization
2. Internal vs External classification
3. Anchor text and surrounding context extraction
4. Dedicated reference / bibliography / sources sections detection
5. Citation-like patterns and notation ([1], Author 2024, DOI, scholarly domains)
6. Rel attributes handling (noopener, nofollow, sponsored, ugc)
7. Citation candidate vs non-citation (social, affiliate, generic) classification
8. Excessive unbacked commercial/affiliate links finding generation
9. Traceable evidence for all external source contracts
10. Strict compatibility with ExternalSourceContract and AuthorityCitationTrustResult
"""

import pytest

from app.authority_citation_schemas import (
    AuthorityCitationTrustResult,
    ConfidenceLevel,
    ExternalSourceContract,
)
from app.page_extractor import extract_html
from app.source_engine import (
    ExternalSourceEngine,
    ExternalSourceResult,
    detect_external_sources,
)


def test_1_external_url_detection_and_domain_normalization():
    """Verify external URL detection and domain normalization (lowercase, stripping www.)."""
    links = [
        {"destination_url": "https://www.nih.gov/research/trial-2024", "anchor_text": "NIH Clinical Study", "link_type": "external"},
        {"destination_url": "https://STANFORD.EDU/dept/physics", "anchor_text": "Stanford Physics Department", "link_type": "external"},
        {"destination_url": "https://subdomain.nature.com/articles/s41586", "anchor_text": "Nature Article", "link_type": "external"},
    ]
    result = detect_external_sources(
        page_url="https://mysite.com/article",
        links=links,
    )

    assert result.total_external_sources == 3
    domains = [s.domain for s in result.sources]
    assert "nih.gov" in domains
    assert "stanford.edu" in domains
    assert "subdomain.nature.com" in domains


def test_2_internal_vs_external_classification():
    """Verify clean separation between internal site links and external source candidates."""
    links = [
        {"destination_url": "https://mysite.com/about", "anchor_text": "About Us", "link_type": "internal"},
        {"destination_url": "https://mysite.com/products/tool", "anchor_text": "Our Tool", "link_type": "internal"},
        {"destination_url": "https://doi.org/10.1038/s41586-024-0012", "anchor_text": "Primary DOI Reference", "link_type": "external"},
        {"destination_url": "https://cdc.gov/data/report-2024", "anchor_text": "CDC Health Statistics", "link_type": "external"},
    ]
    result = detect_external_sources(
        page_url="https://mysite.com/home",
        links=links,
    )

    # Internal links should be excluded from external sources
    assert result.total_external_sources == 2
    urls = [s.url for s in result.sources]
    assert "https://doi.org/10.1038/s41586-024-0012" in urls
    assert "https://cdc.gov/data/report-2024" in urls
    assert all("mysite.com" not in s.url for s in result.sources)


def test_3_anchor_and_nearby_context_extraction():
    """Verify extraction of anchor text and surrounding sentence context."""
    text_content = (
        "In our recent clinical trial, patients exhibited a 40% reduction in symptoms. "
        "Full dataset and statistical protocol are available at the NIH Clinical Repository for review. "
        "Further testing is currently underway."
    )
    links = [
        {
            "destination_url": "https://www.nih.gov/clinical-data-2024",
            "anchor_text": "NIH Clinical Repository",
            "link_type": "external",
        }
    ]
    result = detect_external_sources(
        page_url="https://medicaltrials.org/report",
        links=links,
        text_content=text_content,
    )

    assert result.total_external_sources == 1
    src = result.sources[0]
    assert src.anchor_text == "NIH Clinical Repository"
    assert src.context_text is not None
    assert "Full dataset and statistical protocol" in src.context_text


def test_4_dedicated_reference_sections_detection():
    """Verify detection of dedicated References / Sources / Bibliography headings."""
    html = """
    <html>
    <body>
        <h1>Genetic Sequencing Protocols</h1>
        <p>Overview of modern CRISPR workflows.</p>
        
        <h2>Methodology</h2>
        <p>Protocols followed established guidelines.</p>
        
        <h2>References & Data Sources</h2>
        <ul>
            <li><a href="https://nature.com/articles/crispr-2024">Nature Biotechnology Report</a></li>
            <li><a href="https://ncbi.nlm.nih.gov/gene/402">NCBI Gene Database</a></li>
        </ul>
    </body>
    </html>
    """
    extraction = extract_html(html, page_url="https://genomics.org/crispr-guide")
    result = detect_external_sources(
        page_url="https://genomics.org/crispr-guide",
        links=extraction.links,
        headings=extraction.headings,
        text_content=extraction.clean_text,
        raw_html=html,
    )

    assert len(result.reference_sections_detected) >= 1
    assert any("references" in sec.lower() for sec in result.reference_sections_detected)
    assert result.citation_candidates_count == 2


def test_5_citation_like_patterns_and_labels():
    """Verify detection of in-text notation ([1], Author 2024), DOI URLs, and institutional domains."""
    links = [
        # In-text notation [1]
        {"destination_url": "https://arxiv.org/abs/2401.00192", "anchor_text": "[1] ArXiv Preprint 2024", "link_type": "external"},
        # Citation label prefix
        {"destination_url": "https://who.int/reports/global-health-2024", "anchor_text": "Source: WHO Global Health Report", "link_type": "external"},
        # DOI link
        {"destination_url": "https://doi.org/10.1103/PhysRevLett.130.010401", "anchor_text": "Physical Review Letters", "link_type": "external"},
    ]
    result = detect_external_sources(
        page_url="https://quantumresearch.org/paper",
        links=links,
    )

    assert result.total_external_sources == 3
    assert result.citation_candidates_count == 3
    for s in result.sources:
        assert s.is_citation_candidate is True
        assert s.link_type == "citation"


def test_6_rel_attributes_and_social_affiliate_classification():
    """Verify that social and affiliate links are NOT classified as citation candidates."""
    links = [
        # Social link
        {"destination_url": "https://twitter.com/myaccount", "anchor_text": "Follow us on Twitter", "rel_raw": "nofollow", "link_type": "external"},
        # Sponsored affiliate link
        {"destination_url": "https://affiliate-store.com/buy?tag=mypartner-20", "anchor_text": "Buy on Amazon", "rel_raw": "sponsored nofollow", "link_type": "external"},
        # General outbound link
        {"destination_url": "https://somerandomsite.net/cool-gadget", "anchor_text": "Random Cool Gadget", "link_type": "external"},
        # Verified institutional citation
        {"destination_url": "https://www.nrel.gov/research/clean-energy.html", "anchor_text": "NREL Clean Energy Report", "rel_raw": "noopener", "link_type": "external"},
    ]
    result = detect_external_sources(
        page_url="https://reviewsite.com/solar-panels",
        links=links,
    )

    assert result.total_external_sources == 4

    social_src = next(s for s in result.sources if s.domain == "twitter.com")
    assert social_src.link_type == "social"
    assert social_src.is_citation_candidate is False
    assert "nofollow" in (social_src.rel_attributes or [])

    aff_src = next(s for s in result.sources if s.domain == "affiliate-store.com")
    assert aff_src.link_type == "affiliate"
    assert aff_src.is_citation_candidate is False
    assert "sponsored" in (aff_src.rel_attributes or [])

    general_src = next(s for s in result.sources if s.domain == "somerandomsite.net")
    assert general_src.link_type == "external"
    assert general_src.is_citation_candidate is False

    inst_src = next(s for s in result.sources if s.domain == "nrel.gov")
    assert inst_src.link_type == "citation"
    assert inst_src.is_citation_candidate is True


def test_7_excessive_affiliate_links_finding():
    """Verify that pages with commercial/affiliate links but 0 citations generate explainable findings."""
    links = [
        {"destination_url": "https://store.com/product1?tag=aff-1", "anchor_text": "Buy Product 1", "rel_raw": "sponsored", "link_type": "external"},
        {"destination_url": "https://store.com/product2?tag=aff-2", "anchor_text": "Buy Product 2", "rel_raw": "sponsored", "link_type": "external"},
        {"destination_url": "https://store.com/product3?tag=aff-3", "anchor_text": "Buy Product 3", "rel_raw": "sponsored", "link_type": "external"},
    ]
    result = detect_external_sources(
        page_url="https://shoppingreview.com/best-products",
        links=links,
        page_id=88,
    )

    assert result.citation_candidates_count == 0
    assert len(result.findings) >= 1
    assert result.findings[0].finding_type == "excessive_unbacked_commercial_links"
    assert len(result.recommendations) >= 1


def test_8_evidence_traceability():
    """Verify that every detected external source contains traceable evidence metadata."""
    links = [
        {"destination_url": "https://www.nih.gov/research/trial-2024", "anchor_text": "NIH Trial 2024", "link_type": "external", "position": 12},
    ]
    result = detect_external_sources(
        page_url="https://health.org/article",
        links=links,
    )

    src = result.sources[0]
    assert src.evidence is not None
    assert "classification_reason" in src.evidence
    assert src.evidence["position"] == 12


def test_9_compatibility_with_step2_contracts():
    """Verify that ExternalSourceResult integrates seamlessly into AuthorityCitationTrustResult."""
    result = detect_external_sources(
        page_url="https://mysite.com/report",
        links=[
            {"destination_url": "https://doi.org/10.1038/nature123", "anchor_text": "Nature Study", "link_type": "external"},
            {"destination_url": "https://twitter.com/myteam", "anchor_text": "Twitter", "link_type": "external"},
        ],
    )

    top_level = AuthorityCitationTrustResult(
        page_id=400,
        url="https://mysite.com/report",
        external_sources=result.sources,
        findings=result.findings,
        recommendations=result.recommendations,
    )

    assert len(top_level.external_sources) == 2
    json_bytes = top_level.model_dump_json()
    reconstructed = AuthorityCitationTrustResult.model_validate_json(json_bytes)
    assert len(reconstructed.external_sources) == 2
    assert reconstructed.external_sources[0].domain == "doi.org"
    assert reconstructed.external_sources[0].is_citation_candidate is True
    assert reconstructed.external_sources[1].domain == "twitter.com"
    assert reconstructed.external_sources[1].is_citation_candidate is False
