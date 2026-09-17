"""
Phase A Baseline Verification Test (Day 8 - Phase A)

Verifies that existing Day 4–7 page extraction, content intelligence,
and quality evidence structures are cleanly consumable and representable
by the Day 7 Step 2 Authority, Citation & Trust Intelligence data contracts
WITHOUT introducing new production architecture, fact-checking mechanisms,
or synthetic AI citation scores.
"""

from datetime import datetime, timezone
from urllib.parse import urlparse
import pytest

from app.authority_citation_schemas import (
    AuthorityCitationTrustResult,
    AuthoritySignalContract,
    CitationReadinessContract,
    ConfidenceLevel,
    ExternalSourceContract,
    PotentiallySupportNeededClaimContract,
    SeverityLevel,
    SourceAssociationContract,
    SupportNeededClaimContract,
    TrustSignalContract,
)
from app.page_extractor import extract_html
from app.quality_analyzer import analyze_quality
from app.schemas import (
    FindingCreate,
    FindingResponse,
    RecommendationCreate,
    RecommendationResponse,
)


# Real existing HTML fixture representing a multi-dimensional content page
# with author credentials, external research citation, statistical assertion, and navigation links.
BASELINE_HTML_FIXTURE = """
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <title>Clinical Efficacy of Advanced Photonic Therapy</title>
    <meta name="description" content="Peer-reviewed analysis of photonic therapy efficacy in randomized clinical trials.">
    <script type="application/ld+json">
    {
        "@context": "https://schema.org",
        "@type": "MedicalWebPage",
        "headline": "Clinical Efficacy of Advanced Photonic Therapy",
        "author": {
            "@type": "Person",
            "name": "Dr. Aris Thorne",
            "jobTitle": "Chief Medical Researcher",
            "sameAs": "https://orcid.org/0000-0002-1825-0097"
        },
        "publisher": {
            "@type": "Organization",
            "name": "Global Photonic Institute",
            "url": "https://photonic-institute.org"
        }
    }
    </script>
</head>
<body>
    <header>
        <nav>
            <a href="https://photonic-institute.org/">Home</a>
            <a href="https://twitter.com/photonic_inst" rel="nofollow">Twitter</a>
        </nav>
    </header>
    <main>
        <h1>Clinical Efficacy of Advanced Photonic Therapy</h1>
        <p class="byline">Authored by Dr. Aris Thorne | Published 2024</p>
        
        <section id="results">
            <h2>Trial Outcomes and Quantitative Data</h2>
            <p>According to research published by the National Institutes of Health, photonic therapy demonstrated a 94.2% recovery acceleration in clinical cohorts.</p>
            <p>Full dataset available at the <a href="https://www.nih.gov/research/photonic-trial-2024" rel="noopener">NIH Clinical Study Repository</a>.</p>
        </section>

        <section id="superlative-claims">
            <h2>Market Comparison</h2>
            <p>Our treatment delivers unrivaled precision and is recognized as the best in the world for cellular regeneration.</p>
        </section>
    </main>
</body>
</html>
"""


def test_baseline_page_extraction_evidence_consumed_by_authority_citation_contracts():
    """
    Verify that existing Task 4 extraction evidence (DOM, JSON-LD, links)
    can directly populate TrustSignalContract, AuthoritySignalContract,
    and ExternalSourceContract with complete traceability.
    """
    page_url = "https://photonic-institute.org/clinical-efficacy"
    extraction = extract_html(BASELINE_HTML_FIXTURE, page_url=page_url)

    assert extraction.html_available is True
    assert extraction.title_present is True
    assert len(extraction.structured_data) >= 1
    assert len(extraction.links) >= 3

    # 1. Populate TrustSignalContract from existing structured data extraction
    json_ld_block = extraction.structured_data[0]
    author_info = json_ld_block.parsed_json.get("author", {}) if json_ld_block.parsed_json else {}

    trust_signal = TrustSignalContract(
        signal_id="trust_author_identity_verified",
        category="authorship",
        title="Author Identity and Credentials Verified via JSON-LD",
        status="verified",
        value=True,
        confidence=ConfidenceLevel.HIGH,
        description="Author entity declared with ORCID sameAs biographical URI.",
        evidence={
            "author_name": author_info.get("name"),
            "author_title": author_info.get("jobTitle"),
            "same_as": author_info.get("sameAs"),
            "block_position": json_ld_block.block_position,
        },
    )

    assert trust_signal.confidence == ConfidenceLevel.HIGH
    assert trust_signal.evidence["author_name"] == "Dr. Aris Thorne"
    assert trust_signal.evidence["same_as"] == "https://orcid.org/0000-0002-1825-0097"

    # 2. Populate ExternalSourceContracts from existing LinkItem extraction
    external_sources: list[ExternalSourceContract] = []
    for link in extraction.links:
        if link.link_type == "external":
            domain = urlparse(link.destination_url).netloc if link.destination_url else None
            is_citation = "nih.gov" in (domain or "")
            source = ExternalSourceContract(
                url=link.destination_url or "",
                domain=domain,
                anchor_text=link.anchor_text,
                link_type="citation" if is_citation else "social",
                is_citation_candidate=is_citation,
                rel_attributes=link.rel_raw.split() if link.rel_raw else [],
                evidence={"source_page": page_url, "position": link.position},
            )
            external_sources.append(source)

    assert len(external_sources) >= 2
    # Verify distinction: NIH study is citation candidate; Twitter is not
    nih_source = next((s for s in external_sources if s.domain == "www.nih.gov"), None)
    twitter_source = next((s for s in external_sources if s.domain == "twitter.com"), None)

    assert nih_source is not None
    assert nih_source.is_citation_candidate is True
    assert nih_source.anchor_text == "NIH Clinical Study Repository"

    assert twitter_source is not None
    assert twitter_source.is_citation_candidate is False
    assert "nofollow" in (twitter_source.rel_attributes or [])

    # 3. Populate AuthoritySignalContract from primary source link evidence
    authority_signal = AuthoritySignalContract(
        signal_id="authority_primary_institutional_citation",
        category="source_credibility",
        title="Primary Research Citation to Recognized Institutional Repository",
        status="detected",
        value={"domain": nih_source.domain, "verified_institution": True},
        confidence=ConfidenceLevel.HIGH,
        evidence={"destination_url": nih_source.url, "anchor_text": nih_source.anchor_text},
    )

    assert authority_signal.category == "source_credibility"
    assert authority_signal.confidence == ConfidenceLevel.HIGH
    assert authority_signal.evidence["destination_url"] == "https://www.nih.gov/research/photonic-trial-2024"


def test_baseline_quality_and_semantic_claims_consumed_by_support_needed_contracts():
    """
    Verify that existing Task 5 quality analysis evidence (data points, attributions,
    unsupported superlatives) directly populates SupportNeededClaimContract
    and SourceAssociationContract without acting as a fact-checker.
    """
    page_url = "https://photonic-institute.org/clinical-efficacy"
    extraction = extract_html(BASELINE_HTML_FIXTURE, page_url=page_url)
    quality_evidence = analyze_quality(
        text_content=extraction.clean_text,
        links=[{"destination_url": l.destination_url} for l in extraction.links],
    )

    assert quality_evidence.has_quantitative_evidence is True
    assert quality_evidence.data_points_count >= 1
    assert quality_evidence.attributions_count >= 1
    assert quality_evidence.unsupported_claims_count >= 1

    # 1. Map empirical statistical metric to a Potentially Support-Needed Claim with associated source
    statistical_claim = SupportNeededClaimContract(
        claim_id="claim_stat_001",
        claim_text="According to research published by the National Institutes of Health, photonic therapy demonstrated a 94.2% recovery acceleration in clinical cohorts.",
        claim_type="statistical",
        location="Section: Trial Outcomes and Quantitative Data",
        reason="High-impact empirical percentage metric (94.2%) requiring verifiable primary source reference.",
        confidence=ConfidenceLevel.HIGH,
        has_associated_source=True,
        associated_source_urls=["https://www.nih.gov/research/photonic-trial-2024"],
        evidence={"data_points": quality_evidence.data_points, "attributions": quality_evidence.attributions},
    )

    assert statistical_claim.claim_type == "statistical"
    assert statistical_claim.has_associated_source is True
    assert "94.2%" in statistical_claim.evidence["data_points"]

    # 2. Map superlative statement to an Unsupported Claim (requires external support)
    superlative_claim = PotentiallySupportNeededClaimContract(
        claim_id="claim_super_001",
        claim_text="Our treatment delivers unrivaled precision and is recognized as the best in the world for cellular regeneration.",
        claim_type="superlative",
        location="Section: Market Comparison",
        reason="Unbacked superlative assertion ('best in the world', 'unrivaled') without third-party comparative study citation.",
        confidence=ConfidenceLevel.MEDIUM,
        has_associated_source=False,
        associated_source_urls=[],
        evidence={"detected_superlatives": ["unrivaled", "best in the world"]},
    )

    assert superlative_claim.claim_type == "superlative"
    assert superlative_claim.has_associated_source is False

    # 3. Associate the statistical claim with the external NIH source
    association = SourceAssociationContract(
        association_id="assoc_stat_001",
        claim_id=statistical_claim.claim_id,
        claim_text=statistical_claim.claim_text,
        content_region="section#results",
        source_url="https://www.nih.gov/research/photonic-trial-2024",
        source_domain="www.nih.gov",
        association_type="direct_link",
        confidence=ConfidenceLevel.HIGH,
        explanation="The statistical claim is directly followed by a link to the NIH repository.",
        evidence={"section_id": "results", "link_present_in_section": True},
    )

    assert association.source_url == "https://www.nih.gov/research/photonic-trial-2024"
    assert association.confidence == ConfidenceLevel.HIGH


def test_baseline_citation_readiness_structural_representation():
    """
    Verify that CitationReadinessContract cleanly summarizes structural readiness
    without fabricating a synthetic citation score or claiming AI search citation guarantees.
    """
    readiness = CitationReadinessContract(
        readiness_level="high",
        has_verifiable_sources=True,
        total_external_sources=2,
        total_claims_detected=2,
        supported_claims_count=1,
        unsupported_claims_count=1,
        positive_signals=[
            "Primary institutional reference linked (nih.gov) for quantitative trial outcome.",
            "Structured MedicalWebPage schema with verified author ORCID identity.",
        ],
        negative_signals=[
            "Superlative market comparison claim lacks third-party verification citation.",
        ],
        structural_indicators={
            "has_author_byline": True,
            "has_primary_institutional_source": True,
            "has_unbacked_superlatives": True,
        },
        evidence={"evaluated_url": "https://photonic-institute.org/clinical-efficacy"},
    )

    assert readiness.readiness_level == "high"
    assert readiness.has_verifiable_sources is True
    assert readiness.total_claims_detected == 2
    assert len(readiness.positive_signals) == 2
    assert len(readiness.negative_signals) == 1
    # Verify no fake citation score or engine promises are present
    dumped = readiness.model_dump()
    assert "fake_score" not in dumped
    assert "ai_overview_guarantee" not in dumped


def test_baseline_top_level_envelope_integrates_existing_findings_and_recommendations():
    """
    Verify that AuthorityCitationTrustResult seamlessly aggregates all signals
    and preserves existing FindingResponse/Create and RecommendationResponse/Create models.
    """
    page_url = "https://photonic-institute.org/clinical-efficacy"

    # Step 2 Contracts
    trust_sig = TrustSignalContract(
        signal_id="trust_author_identity_verified",
        title="Author Identity and Credentials Verified",
        status="verified",
        confidence=ConfidenceLevel.HIGH,
        evidence={"author": "Dr. Aris Thorne"},
    )

    auth_sig = AuthoritySignalContract(
        signal_id="authority_primary_institutional_citation",
        title="Primary Research Citation",
        status="detected",
        confidence=ConfidenceLevel.HIGH,
        evidence={"destination_url": "https://www.nih.gov/research/photonic-trial-2024"},
    )

    source = ExternalSourceContract(
        url="https://www.nih.gov/research/photonic-trial-2024",
        domain="www.nih.gov",
        anchor_text="NIH Clinical Study Repository",
        is_citation_candidate=True,
    )

    claim = SupportNeededClaimContract(
        claim_text="Our treatment delivers unrivaled precision and is recognized as the best in the world for cellular regeneration.",
        claim_type="superlative",
        reason="Superlative market assertion without independent comparative study citation.",
        confidence=ConfidenceLevel.MEDIUM,
        has_associated_source=False,
    )

    assoc = SourceAssociationContract(
        source_url="https://www.nih.gov/research/photonic-trial-2024",
        claim_text="Photonic therapy demonstrated a 94.2% recovery acceleration in clinical cohorts.",
        association_type="direct_link",
        confidence=ConfidenceLevel.HIGH,
    )

    readiness = CitationReadinessContract(
        readiness_level="high",
        has_verifiable_sources=True,
        total_external_sources=1,
        total_claims_detected=2,
        supported_claims_count=1,
        unsupported_claims_count=1,
    )

    # Reusing existing Task 6 Finding & Recommendation structures
    finding = FindingResponse(
        id=501,
        website_id=10,
        scan_id=20,
        page_id=30,
        finding_type="unsupported_superlative_claim",
        type="unsupported_superlative_claim",
        category="authority",
        title="Unbacked Superlative Assertion in Market Comparison",
        description="The claim 'best in the world' lacks supporting third-party citation.",
        severity="medium",
        status="open",
        evidence={"claim": claim.claim_text, "rule_id": "RULE_AUTH_SUPERLATIVE_001"},
        created_at=datetime.now(timezone.utc),
    )

    rec = RecommendationResponse(
        id=601,
        finding_id=501,
        title="Add Independent Clinical Benchmark or Remove Superlative",
        description="Cite an independent third-party comparative study or tone down superlative phrasing.",
        priority="medium",
        status="open",
        impact="medium",
        action_type="add_citation_or_tone_down",
        created_at=datetime.now(timezone.utc),
    )

    # Also test with pre-persisted FindingCreate and RecommendationCreate
    new_finding = FindingCreate(
        page_id=30,
        finding_type="missing_methodology_link",
        category="authority",
        title="Missing Methodology Reference",
        description="The trial report lacks a link to full clinical methodology.",
        severity="low",
        status="open",
        evidence={"section": "results"},
    )

    new_rec = RecommendationCreate(
        title="Link Clinical Protocol DOI",
        description="Attach clinical protocol DOI link to results section.",
        priority="low",
        status="open",
    )

    # Top-level analysis envelope
    result = AuthorityCitationTrustResult(
        page_id=30,
        url=page_url,
        scan_id=20,
        website_id=10,
        trust_signals=[trust_sig],
        authority_signals=[auth_sig],
        external_sources=[source],
        support_needed_claims=[claim],
        source_associations=[assoc],
        citation_readiness=readiness,
        findings=[finding, new_finding],
        recommendations=[rec, new_rec],
        metadata={"phase": "phase_a_baseline_verification", "version": "1.0.0"},
    )

    # Verify model dump and serialization
    dumped = result.model_dump()
    assert dumped["page_id"] == 30
    assert dumped["url"] == page_url
    assert len(dumped["trust_signals"]) == 1
    assert len(dumped["authority_signals"]) == 1
    assert len(dumped["external_sources"]) == 1
    assert len(dumped["support_needed_claims"]) == 1
    assert len(dumped["source_associations"]) == 1
    assert len(dumped["findings"]) == 2
    assert len(dumped["recommendations"]) == 2
    assert dumped["findings"][0]["finding_type"] == "unsupported_superlative_claim"
    assert dumped["findings"][1]["finding_type"] == "missing_methodology_link"

    # Verify JSON serialization round-trip
    json_output = result.model_dump_json()
    reconstructed = AuthorityCitationTrustResult.model_validate_json(json_output)
    assert reconstructed.page_id == 30
    assert reconstructed.trust_signals[0].signal_id == "trust_author_identity_verified"
    assert reconstructed.citation_readiness.supported_claims_count == 1
    assert len(reconstructed.findings) == 2
