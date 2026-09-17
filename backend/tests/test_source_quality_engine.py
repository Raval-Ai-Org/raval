"""
Source-Quality Engine Tests (Day 8 - Phase B - Step 7 ONLY)

Verifies deterministic, evidence-based source quality evaluation:
1. Primary-source indicators detection (DOI, .gov, .edu, academic publishers, standards bodies)
2. Anchor text quality evaluation (descriptive vs weak/generic vs URL literal)
3. Broken / Inaccessible links handling (status_code >= 400, invalid schemes)
4. Rel attributes & commercial dilution evaluation (sponsored, affiliate params)
5. Quality tier classifications (high, adequate, weak, broken)
6. Actionable finding and recommendation generation for source deficiencies
7. Evidence traceability in all assessments
8. No false factual authority assumptions (Evidence != Conclusion)
9. Integration with Step 5 ExternalSourceContract objects
10. Strict compatibility with Step 2 contracts
"""

import pytest

from app.authority_citation_schemas import (
    ConfidenceLevel,
    ExternalSourceContract,
)
from app.source_engine import detect_external_sources
from app.source_quality_engine import (
    SourceQualityAssessment,
    SourceQualityEngine,
    SourceQualityResult,
    evaluate_source_quality,
)


def test_1_primary_source_indicators():
    """Verify identification of primary research, DOI, government datasets, and standards bodies."""
    sources = [
        ExternalSourceContract(
            url="https://doi.org/10.1038/s41586-024-0012",
            domain="doi.org",
            anchor_text="Nature Photonics Primary Study",
            link_type="citation",
            is_citation_candidate=True,
        ),
        ExternalSourceContract(
            url="https://www.nrel.gov/docs/solar-2024.pdf",
            domain="nrel.gov",
            anchor_text="NREL Photovoltaic Benchmark Report",
            link_type="citation",
            is_citation_candidate=True,
        ),
        ExternalSourceContract(
            url="https://www.w3.org/TR/wot-architecture/",
            domain="w3.org",
            anchor_text="W3C Web of Things Standard",
            link_type="citation",
            is_citation_candidate=True,
        ),
    ]

    result = evaluate_source_quality(sources=sources)

    assert result.total_sources_evaluated == 3
    assert result.high_quality_sources_count == 3

    doi_assess = next(a for a in result.assessments if "doi.org" in a.domain)
    assert doi_assess.is_primary_source is True
    assert doi_assess.primary_source_type == "doi"
    assert doi_assess.quality_tier == "high"

    gov_assess = next(a for a in result.assessments if "nrel.gov" in a.domain)
    assert gov_assess.is_primary_source is True
    assert gov_assess.primary_source_type == "government_repository"
    assert gov_assess.quality_tier == "high"

    std_assess = next(a for a in result.assessments if "w3.org" in a.domain)
    assert std_assess.is_primary_source is True
    assert std_assess.primary_source_type == "standards_organization"


def test_2_descriptive_vs_weak_anchor_text():
    """Verify classification of descriptive vs generic weak anchor texts."""
    sources = [
        # Weak anchor
        ExternalSourceContract(
            url="https://cdc.gov/flu/data",
            domain="cdc.gov",
            anchor_text="click here",
            link_type="citation",
        ),
        # URL literal anchor
        ExternalSourceContract(
            url="https://who.int/data/vaccines",
            domain="who.int",
            anchor_text="https://who.int/data/vaccines",
            link_type="citation",
        ),
        # Descriptive anchor
        ExternalSourceContract(
            url="https://nih.gov/research/trial",
            domain="nih.gov",
            anchor_text="NIH 2024 Clinical Evaluation Report",
            link_type="citation",
        ),
    ]

    result = evaluate_source_quality(sources=sources)

    assert result.total_sources_evaluated == 3
    assert result.assessments[0].anchor_quality == "weak"
    assert "generic_weak_anchor_phrase" in "".join(result.assessments[0].issues)

    assert result.assessments[1].anchor_quality == "url_literal"
    assert result.assessments[2].anchor_quality == "descriptive"


def test_3_broken_and_inaccessible_source_handling():
    """Verify detection of broken URLs and HTTP error codes."""
    sources = [
        ExternalSourceContract(
            url="https://deadlink-repository.org/missing-paper",
            domain="deadlink-repository.org",
            anchor_text="Missing Research Study",
            status_code=404,
            availability_status="broken",
            link_type="citation",
        ),
        ExternalSourceContract(
            url="invalid://broken-scheme",
            domain="broken-scheme",
            anchor_text="Invalid Link",
            link_type="external",
        ),
    ]

    result = evaluate_source_quality(sources=sources, page_id=99)

    assert result.broken_or_inaccessible_sources_count == 2
    assert all(a.quality_tier == "broken" for a in result.assessments)
    assert all(a.is_accessible is False for a in result.assessments)

    # Check actionable findings
    assert len(result.findings) >= 1
    assert result.findings[0].finding_type == "broken_reference_link"
    assert result.findings[0].severity == "high"


def test_4_rel_attributes_and_commercial_dilution():
    """Verify detection of sponsored or affiliate tracking in citation links."""
    sources = [
        ExternalSourceContract(
            url="https://affiliate-store.com/buy-sensor?tag=affiliate-partner",
            domain="affiliate-store.com",
            anchor_text="Sensor Specs",
            rel_attributes=["sponsored", "nofollow"],
            link_type="affiliate",
        )
    ]

    result = evaluate_source_quality(sources=sources)

    assess = result.assessments[0]
    assert assess.rel_assessment == "sponsored_commercial"
    assert assess.quality_tier == "weak"
    assert "commercial_affiliate_citation" in assess.issues


def test_5_generic_anchors_generate_findings():
    """Verify that multiple weak generic anchor texts generate an actionable finding."""
    sources = [
        {"url": "https://source1.org/data", "anchor_text": "click here", "link_type": "citation"},
        {"url": "https://source2.org/data", "anchor_text": "read more", "link_type": "citation"},
        {"url": "https://source3.org/data", "anchor_text": "link", "link_type": "citation"},
    ]

    result = evaluate_source_quality(sources=sources, page_id=12)

    assert result.weak_sources_count == 3
    assert len(result.findings) >= 1
    assert any(f.finding_type == "generic_citation_anchor_text" for f in result.findings)


def test_6_evidence_traceability():
    """Verify that every source quality assessment provides traceable evidence metadata."""
    sources = [
        ExternalSourceContract(
            url="https://doi.org/10.1016/j.cell.2024",
            domain="doi.org",
            anchor_text="Cell Stem Cell Protocol 2024",
            link_type="citation",
        )
    ]

    result = evaluate_source_quality(sources=sources)

    assess = result.assessments[0]
    assert isinstance(assess, SourceQualityAssessment)
    assert assess.evidence is not None
    assert assess.evidence["is_primary_source"] is True
    assert assess.evidence["anchor_quality"] == "descriptive"


def test_7_no_false_factual_authority_claims():
    """Verify core rule: Evidence != Conclusion. The engine evaluates structural source characteristics without certifying truth."""
    sources = [
        {"url": "https://reputable-university.edu/speculative-theory", "anchor_text": "Speculative Theory Paper"}
    ]

    result = evaluate_source_quality(sources=sources)

    dumped = result.model_dump()
    assert "factual_certification" not in dumped
    assert "truth_guarantee" not in dumped


def test_8_integration_with_step5_external_source_result():
    """Verify seamless integration evaluating sources extracted from Step 5."""
    step5_result = detect_external_sources(
        page_url="https://iqp.org/research",
        links=[
            {"destination_url": "https://doi.org/10.1103/PhysRevLett.130", "anchor_text": "Physical Review Letters 2024", "link_type": "external"},
            {"destination_url": "https://twitter.com/iqp_lab", "anchor_text": "Twitter", "link_type": "external"},
        ],
    )

    engine = SourceQualityEngine()
    result = engine.evaluate_external_source_result(step5_result, page_id=77)

    assert result.page_id == 77
    assert result.total_sources_evaluated == 2
    assert result.high_quality_sources_count == 1
    assert result.assessments[0].primary_source_type == "doi"
