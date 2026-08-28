"""
Citation-Readiness Engine Tests (Day 8 - Phase B - Step 9 ONLY)

Verifies multi-engine synthesis and structural citation-readiness evaluation:
1. High structural citation readiness (verifiable primary sources, supported claims, transparency)
2. Moderate structural citation readiness (partial source coverage, adequate quality)
3. Low structural citation readiness (zero sources, unbacked claims, broken links)
4. Actionable finding and recommendation generation for low readiness
5. Master envelope aggregation via build_unified_result (AuthorityCitationTrustResult)
6. Synthesis integrating outputs from Steps 3, 4, 5, 6, 7, and 8
7. No fake citation scores or AI ranking guarantees (Evidence != Conclusion)
8. Empty / weak input safety
9. Full JSON serialization roundtrip with Step 2 contracts
"""

import types
import pytest

from app.authority_citation_schemas import (
    AuthorityCitationTrustResult,
    CitationReadinessContract,
    ConfidenceLevel,
    ExternalSourceContract,
    SupportNeededClaimContract,
    TrustSignalContract,
)
from app.authority_engine import analyze_authority_signals
from app.citation_readiness_engine import (
    CitationReadinessEngine,
    CitationReadinessResult,
    evaluate_citation_readiness,
)
from app.claim_support_engine import analyze_claim_support
from app.source_engine import detect_external_sources
from app.source_quality_engine import evaluate_source_quality
from app.transparency_engine import analyze_first_party_transparency
from app.trust_engine import analyze_trust_signals


def test_1_high_structural_citation_readiness():
    """Verify high readiness when primary sources, full claim associations, and transparency are present."""
    sources = [
        ExternalSourceContract(
            url="https://doi.org/10.1038/s41586-024-001",
            domain="doi.org",
            anchor_text="Nature Photonics Primary Study",
            is_citation_candidate=True,
            link_type="citation",
        )
    ]
    source_quality = evaluate_source_quality(sources=sources)

    claims = [
        SupportNeededClaimContract(
            claim_text="Quantum fidelity reached 99.94% in controlled laboratory testing.",
            claim_type="statistical",
            reason="Exact percentage metric",
            has_associated_source=True,
            associated_source_urls=["https://doi.org/10.1038/s41586-024-001"],
        )
    ]

    mock_source = types.SimpleNamespace(sources=sources)
    mock_claim = types.SimpleNamespace(claims=claims, supported_claims_count=1, unsupported_claims_count=0)
    mock_transparency = types.SimpleNamespace(is_transparent=True)

    result = evaluate_citation_readiness(
        source_result=mock_source,
        source_quality_result=source_quality,
        claim_support_result=mock_claim,
        transparency_result=mock_transparency,
        page_url="https://iqp.org/research",
    )

    contract = result.citation_readiness
    assert contract.readiness_level == "high"
    assert contract.has_verifiable_sources is True
    assert contract.supported_claims_count == 1
    assert contract.unsupported_claims_count == 0
    assert len(contract.positive_signals) >= 3
    assert len(contract.negative_signals) == 0


def test_2_moderate_structural_citation_readiness():
    """Verify moderate readiness when external sources exist but some claims are unbacked."""
    sources = [
        ExternalSourceContract(
            url="https://tech-news.com/article",
            domain="tech-news.com",
            anchor_text="Tech News Overview",
            is_citation_candidate=True,
            link_type="reference",
        )
    ]
    source_quality = evaluate_source_quality(sources=sources)

    mock_source = types.SimpleNamespace(sources=sources)
    mock_claim = types.SimpleNamespace(
        claims=[
            SupportNeededClaimContract(
                claim_text="Battery longevity increased by 200% under rapid cycling.",
                claim_type="statistical",
                reason="Statistical percentage",
                has_associated_source=False,
            )
        ],
        supported_claims_count=0,
        unsupported_claims_count=1,
    )
    mock_transparency = types.SimpleNamespace(is_transparent=False)

    result = evaluate_citation_readiness(
        source_result=mock_source,
        source_quality_result=source_quality,
        claim_support_result=mock_claim,
        transparency_result=mock_transparency,
    )

    contract = result.citation_readiness
    assert contract.readiness_level == "moderate"
    assert contract.has_verifiable_sources is True
    assert contract.unsupported_claims_count == 1


def test_3_low_structural_citation_readiness_and_findings():
    """Verify low readiness and actionable findings when zero sources are provided for empirical claims."""
    mock_claim = types.SimpleNamespace(
        claims=[
            SupportNeededClaimContract(
                claim_text="Our platform reduces operational latency by 85%.",
                claim_type="statistical",
                reason="Empirical metric",
                has_associated_source=False,
            )
        ],
        supported_claims_count=0,
        unsupported_claims_count=1,
    )
    mock_source = types.SimpleNamespace(sources=[])
    mock_transparency = types.SimpleNamespace(is_transparent=False)

    result = evaluate_citation_readiness(
        source_result=mock_source,
        claim_support_result=mock_claim,
        transparency_result=mock_transparency,
        page_id=707,
    )

    contract = result.citation_readiness
    assert contract.readiness_level == "low"
    assert contract.has_verifiable_sources is False
    assert len(result.findings) >= 1
    assert result.findings[0].finding_type == "low_structural_citation_readiness"
    assert result.findings[0].severity == "high"
    assert len(result.recommendations) >= 1


def test_4_full_pipeline_synthesis_and_master_envelope():
    """Verify end-to-end multi-engine synthesis into unified AuthorityCitationTrustResult envelope."""
    page_url = "https://iqp.org/research/quantum-fidelity"
    text = (
        "Authored by Dr. Alexei Vane, PhD. Published on: March 12, 2025. Contact: research@iqp.org. "
        "In 2024, our dilution refrigerator achieved gate fidelity of 99.94% across 10,000 runs. "
        "Full benchmark data published in Nature Physics."
    )
    headings = [
        {"level": 1, "text": "Quantum Gate Fidelity Benchmarks"},
        {"level": 2, "text": "Experimental Setup and Methodology"},
        {"level": 2, "text": "Statistical Analysis"},
    ]
    links = [
        {"destination_url": "https://doi.org/10.1038/s41567-024-001", "anchor_text": "Nature Physics Benchmark", "link_type": "citation"},
        {"destination_url": "https://iqp.org/about", "anchor_text": "About IQP"},
        {"destination_url": "https://iqp.org/contact", "anchor_text": "Contact Us"},
    ]
    schemas = [
        {
            "@context": "https://schema.org",
            "@type": "ScholarlyArticle",
            "headline": "Quantum Gate Fidelity Benchmarks",
            "author": {"@type": "Person", "name": "Dr. Alexei Vane", "jobTitle": "Principal Physicist"},
            "publisher": {"@type": "Organization", "name": "Institute for Quantum Physics"},
        }
    ]

    # Run All Engines (Steps 3 through 8)
    trust_res = analyze_trust_signals(text_content=text, links=links, structured_data_blocks=schemas, page_url=page_url)
    auth_res = analyze_authority_signals(text_content=text, headings=headings, links=links, structured_data_blocks=schemas, page_url=page_url)
    source_res = detect_external_sources(links=links, page_url=page_url)
    quality_res = evaluate_source_quality(sources=source_res.sources, page_url=page_url)
    claim_res = analyze_claim_support(text_content=text, external_sources=source_res.sources, headings=headings, page_url=page_url)
    transp_res = analyze_first_party_transparency(text_content=text, links=links, structured_data_blocks=schemas, page_url=page_url)

    # Master Step 9 Aggregation
    engine = CitationReadinessEngine()
    unified_result = engine.build_unified_result(
        page_url=page_url,
        page_id=901,
        scan_id=5,
        website_id=1,
        trust_result=trust_res,
        authority_result=auth_res,
        source_result=source_res,
        claim_support_result=claim_res,
        source_quality_result=quality_res,
        transparency_result=transp_res,
    )

    assert isinstance(unified_result, AuthorityCitationTrustResult)
    assert unified_result.page_id == 901
    assert len(unified_result.trust_signals) >= 6
    assert len(unified_result.authority_signals) >= 5
    assert len(unified_result.external_sources) >= 1
    assert len(unified_result.support_needed_claims) >= 1
    assert len(unified_result.source_associations) >= 1
    assert unified_result.citation_readiness.readiness_level in ("high", "moderate")
    assert unified_result.citation_readiness.has_verifiable_sources is True


def test_5_no_fake_scores_or_ai_ranking_guarantees():
    """Verify core rule: Structural indicators only. No artificial visibility scores or ranking promises."""
    engine = CitationReadinessEngine()
    result = engine.evaluate()

    dumped = result.model_dump()
    assert "score" not in dumped["citation_readiness"]
    assert "numeric_score" not in dumped["citation_readiness"]
    assert "ai_ranking_guarantee" not in dumped["citation_readiness"]
    assert "seo_rank" not in dumped["citation_readiness"]


def test_6_empty_and_weak_input_safety():
    """Verify safe evaluation when all engine inputs are None or empty."""
    engine = CitationReadinessEngine()
    result = engine.evaluate()

    assert result.citation_readiness.readiness_level == "low"
    assert result.citation_readiness.total_external_sources == 0
    assert result.citation_readiness.total_claims_detected == 0


def test_7_serialization_and_step2_compatibility():
    """Verify JSON roundtrip serialization of AuthorityCitationTrustResult with CitationReadiness."""
    engine = CitationReadinessEngine()
    result = engine.evaluate()

    envelope = AuthorityCitationTrustResult(
        page_id=123,
        url="https://test.com",
        citation_readiness=result.citation_readiness,
        findings=result.findings,
        recommendations=result.recommendations,
    )

    json_data = envelope.model_dump_json()
    reconstructed = AuthorityCitationTrustResult.model_validate_json(json_data)
    assert reconstructed.citation_readiness.readiness_level == envelope.citation_readiness.readiness_level
