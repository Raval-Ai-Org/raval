"""
Claim-Support Engine Tests (Day 8 - Phase B - Step 6 ONLY)

Verifies deterministic, evidence-based claim support detection and source association:
1. Statistical / quantitative claim detection
2. Temporal / time-sensitive assertion detection
3. Comparative claim detection
4. Superlative and strong subjective claim detection
5. Technical / scientific mechanism claim detection
6. Direct and contextual source association
7. Unbacked claims finding and recommendation generation
8. Empty / weak input handling and safety
9. Safely bounded claim text validation (max 1000 chars)
10. Evidence traceability in all claim and association contracts
11. No false factual conclusions (Evidence != Conclusion)
12. Compatibility with Step 2 SupportNeededClaimContract & SourceAssociationContract
"""

import pytest

from app.authority_citation_schemas import (
    AuthorityCitationTrustResult,
    ConfidenceLevel,
    SourceAssociationContract,
    SupportNeededClaimContract,
)
from app.claim_support_engine import (
    ClaimSupportEngine,
    ClaimSupportResult,
    analyze_claim_support,
)
from app.page_extractor import extract_html
from app.source_engine import detect_external_sources


def test_1_statistical_and_quantitative_claim_detection():
    """Verify detection of numerical metrics, percentages, and data points as support-needed claims."""
    text = (
        "During phase 3 clinical trials, the therapy demonstrated a 94.2% recovery acceleration in patient cohorts. "
        "Overall energy yield increased by 450 kW across all 12 optimal commercial installations."
    )
    result = analyze_claim_support(text_content=text)

    assert result.total_claims_detected >= 2
    stat_claims = [c for c in result.claims if c.claim_type == "statistical"]
    assert len(stat_claims) >= 2
    assert any("94.2%" in c.claim_text for c in stat_claims)
    assert any("450 kW" in c.claim_text or "450" in c.claim_text for c in stat_claims)
    for c in stat_claims:
        assert c.confidence == ConfidenceLevel.HIGH


def test_2_temporal_and_time_sensitive_claim_detection():
    """Verify detection of historical benchmarks and forward-looking temporal assertions."""
    text = (
        "Founded in 2018, the consortium has tracked climate patterns across Europe. "
        "Market adoption is expected to expand across emerging regions."
    )
    result = analyze_claim_support(text_content=text)

    temp_claims = [c for c in result.claims if c.claim_type == "time_sensitive"]
    assert len(temp_claims) >= 1
    assert any("2018" in c.claim_text for c in temp_claims)


def test_3_comparative_claim_detection():
    """Verify detection of comparative benchmarks and relative performance statements."""
    text = (
        "Our superconducting processor is 3x faster than traditional silicon architectures. "
        "The new turbine outperformed prior generation models by 25% under high wind loads."
    )
    result = analyze_claim_support(text_content=text)

    comp_claims = [c for c in result.claims if c.claim_type in ("comparative", "statistical")]
    assert len(comp_claims) >= 2
    assert any("3x faster" in c.claim_text for c in comp_claims)


def test_4_superlative_claim_detection():
    """Verify detection of strong subjective superlative claims."""
    text = (
        "We provide the best heat pumps in the world with guaranteed perfection. "
        "Our revolutionary system offers unrivaled precision for modern manufacturing."
    )
    result = analyze_claim_support(text_content=text)

    super_claims = [c for c in result.claims if c.claim_type == "superlative"]
    assert len(super_claims) >= 2
    assert any("best" in c.claim_text for c in super_claims)
    assert any("unrivaled" in c.claim_text for c in super_claims)


def test_5_technical_assertion_detection():
    """Verify detection of technical and scientific mechanism claims."""
    text = (
        "Photonic modulation demonstrates a significant reduction in thermal decoherence across qubits. "
        "The proprietary molecule inhibits cellular degradation in clinical testing."
    )
    result = analyze_claim_support(text_content=text)

    tech_claims = [c for c in result.claims if c.claim_type == "technical_assertion"]
    assert len(tech_claims) >= 2
    assert any("decoherence" in c.claim_text for c in tech_claims)


def test_6_direct_and_contextual_source_association():
    """Verify that claims near external sources establish traceable SourceAssociationContracts."""
    text = (
        "According to research published by the National Institutes of Health, photonic therapy demonstrated a 94.2% recovery rate. "
        "Full dataset available at the NIH Clinical Study Repository."
    )
    sources = [
        {
            "destination_url": "https://www.nih.gov/research/photonic-trial-2024",
            "domain": "nih.gov",
            "anchor_text": "NIH Clinical Study Repository",
            "is_citation_candidate": True,
        }
    ]
    result = analyze_claim_support(
        text_content=text,
        external_sources=sources,
        headings=[{"level": 2, "text": "Clinical Trial Results"}],
    )

    assert result.supported_claims_count >= 1
    assert len(result.source_associations) >= 1

    assoc = result.source_associations[0]
    assert assoc.source_url == "https://www.nih.gov/research/photonic-trial-2024"
    assert assoc.source_domain == "nih.gov"
    assert assoc.confidence in (ConfidenceLevel.HIGH, ConfidenceLevel.MEDIUM)
    assert assoc.evidence is not None


def test_7_unbacked_claims_generate_findings():
    """Verify that unreferenced statistical and superlative claims produce actionable findings."""
    text = (
        "Our device delivers 99.99% purity in laboratory testing. "
        "We offer the best heating system in the world with unrivaled reliability. "
        "No sources or links are provided anywhere in this article."
    )
    result = analyze_claim_support(
        text_content=text,
        external_sources=[],
        page_id=33,
    )

    assert result.unsupported_claims_count >= 2
    assert len(result.findings) >= 2
    assert any(f.finding_type == "unsupported_statistical_claim" for f in result.findings)
    assert any(f.finding_type == "unsupported_superlative_claim" for f in result.findings)
    assert len(result.recommendations) >= 2


def test_8_empty_and_weak_input_safety():
    """Verify that empty, minimal, or non-claim text executes safely without crashing."""
    res_empty = analyze_claim_support(text_content="")
    assert res_empty.total_claims_detected == 0
    assert len(res_empty.claims) == 0

    res_none = analyze_claim_support(text_content=None)
    assert res_none.total_claims_detected == 0

    res_simple = analyze_claim_support(text_content="Hello world. Welcome to our website.")
    assert res_simple.total_claims_detected == 0


def test_9_bounded_claim_text_validation():
    """Verify that claims exceeding 1000 characters are safely bounded."""
    huge_sentence = "According to our analysis, solar efficiency reached 85.5% " + ("with advanced mirrors " * 80)
    claim = SupportNeededClaimContract(
        claim_text=huge_sentence,
        claim_type="statistical",
        reason="Long quantitative metric assertion",
    )
    assert len(claim.claim_text) <= 1000
    assert claim.claim_text.endswith("...")


def test_10_evidence_is_traceable():
    """Verify that every detected claim and source association provides traceable evidence."""
    text = "Battery lifespan increased by 200% under rapid charging cycles."
    result = analyze_claim_support(text_content=text)

    for c in result.claims:
        assert isinstance(c, SupportNeededClaimContract)
        assert c.evidence is not None


def test_11_no_false_factual_conclusions():
    """Verify core rule: Evidence != Conclusion. The engine does NOT evaluate factual veracity."""
    text = "Our perpetual motion machine produces 1,000,000 kW of free energy."
    result = analyze_claim_support(text_content=text)

    dumped = result.model_dump()
    assert "fact_check_result" not in dumped
    assert "is_true" not in dumped
    assert "is_false" not in dumped


def test_12_compatibility_with_step2_contracts():
    """Verify integration of ClaimSupportResult into top-level AuthorityCitationTrustResult."""
    result = analyze_claim_support(
        text_content="Quantum gate fidelity reached 99.9% according to the study.",
        external_sources=[{"url": "https://doi.org/10.1038/s41586", "domain": "doi.org", "anchor_text": "the study", "is_citation_candidate": True}],
    )

    top_level = AuthorityCitationTrustResult(
        page_id=500,
        url="https://example.com/quantum",
        support_needed_claims=result.claims,
        source_associations=result.source_associations,
        findings=result.findings,
        recommendations=result.recommendations,
    )

    assert len(top_level.support_needed_claims) == len(result.claims)
    assert len(top_level.source_associations) == len(result.source_associations)

    json_bytes = top_level.model_dump_json()
    reconstructed = AuthorityCitationTrustResult.model_validate_json(json_bytes)
    assert len(reconstructed.support_needed_claims) == len(result.claims)
