from datetime import datetime, timezone
import json
import pytest
from pydantic import ValidationError

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
from app.schemas import (
    FindingCreate,
    FindingResponse,
    RecommendationCreate,
    RecommendationResponse,
)


def test_severity_and_confidence_enum_values():
    """Verify standard enum values and case-insensitive string parsing."""
    assert SeverityLevel.CRITICAL.value == "critical"
    assert SeverityLevel.HIGH.value == "high"
    assert SeverityLevel.MEDIUM.value == "medium"
    assert SeverityLevel.LOW.value == "low"
    assert SeverityLevel.INFO.value == "info"

    # Case-insensitive resolution
    assert SeverityLevel("HIGH") == SeverityLevel.HIGH
    assert SeverityLevel("critical") == SeverityLevel.CRITICAL
    assert SeverityLevel("Info") == SeverityLevel.INFO

    assert ConfidenceLevel.HIGH.value == "high"
    assert ConfidenceLevel.MEDIUM.value == "medium"
    assert ConfidenceLevel.LOW.value == "low"
    assert ConfidenceLevel("MEDIUM") == ConfidenceLevel.MEDIUM
    assert ConfidenceLevel("Low") == ConfidenceLevel.LOW

    # Invalid values should raise ValueError
    with pytest.raises(ValueError):
        SeverityLevel("extreme")

    with pytest.raises(ValueError):
        ConfidenceLevel("absolute")


def test_valid_trust_signal_creation():
    """Verify valid TrustSignalContract creation, defaults, and evidence."""
    signal = TrustSignalContract(
        signal_id="trust_author_credentials_present",
        category="authorship",
        title="Author Credentials and Byline Detected",
        status="verified",
        value=True,
        confidence=ConfidenceLevel.HIGH,
        description="Page includes author credentials with verified biographical schema.",
        evidence={"author_name": "Dr. Jane Doe", "schema_type": "Person", "has_bio": True},
    )

    assert signal.signal_id == "trust_author_credentials_present"
    assert signal.category == "authorship"
    assert signal.title == "Author Credentials and Byline Detected"
    assert signal.status == "verified"
    assert signal.value is True
    assert signal.confidence == ConfidenceLevel.HIGH
    assert signal.evidence["author_name"] == "Dr. Jane Doe"

    # Serialization test
    dumped = signal.model_dump()
    assert dumped["confidence"] == "high"
    assert dumped["evidence"]["schema_type"] == "Person"


def test_valid_authority_signal_creation():
    """Verify valid AuthoritySignalContract creation and evidence handling."""
    signal = AuthoritySignalContract(
        signal_id="authority_primary_source_linked",
        category="source_credibility",
        title="Primary Research Source Cited",
        status="detected",
        value={"doi": "10.1000/182", "peer_reviewed": True},
        confidence="high",
        description="Links directly to original scientific DOI repository.",
        evidence={"destination_url": "https://doi.org/10.1000/182", "anchor": "Original Study"},
    )

    assert signal.signal_id == "authority_primary_source_linked"
    assert signal.category == "source_credibility"
    assert signal.confidence == ConfidenceLevel.HIGH
    assert signal.value["peer_reviewed"] is True
    assert signal.evidence["anchor"] == "Original Study"


def test_valid_external_source_creation():
    """Verify ExternalSourceContract attributes and citation classification."""
    source = ExternalSourceContract(
        url="https://www.nature.com/articles/s41586-020-2649-2",
        domain="nature.com",
        anchor_text="Nature 2020 Study",
        context_text="According to recent research published in Nature, AI accuracy improved significantly.",
        link_type="citation",
        is_accessible=True,
        status_code=200,
        availability_status="valid",
        rel_attributes=["noopener", "noreferrer"],
        is_citation_candidate=True,
        evidence={"section_heading": "Methodology", "dom_position": 4},
    )

    assert source.url == "https://www.nature.com/articles/s41586-020-2649-2"
    assert source.domain == "nature.com"
    assert source.is_citation_candidate is True
    assert source.status_code == 200
    assert "noopener" in source.rel_attributes

    # Default non-citation external link
    general_link = ExternalSourceContract(
        url="https://twitter.com/mybrand",
        domain="twitter.com",
        anchor_text="Follow us on Twitter",
        link_type="social",
    )
    assert general_link.is_citation_candidate is False
    assert general_link.link_type == "social"


def test_valid_support_needed_claim_creation():
    """Verify PotentiallySupportNeededClaimContract creation, text bounding, and source linkage."""
    claim = SupportNeededClaimContract(
        claim_id="claim_001",
        claim_text="Our platform reduces operational costs by 87% within 30 days.",
        claim_type="statistical",
        location="Section: ROI / Paragraph 1",
        reason="Specific quantifiable metric '87%' without cited data source or methodology.",
        confidence=ConfidenceLevel.HIGH,
        has_associated_source=False,
        associated_source_urls=[],
        evidence={"numerical_values": ["87%", "30 days"], "surrounding_sentence": "Our platform reduces operational costs by 87% within 30 days."},
    )

    assert claim.claim_id == "claim_001"
    assert claim.claim_type == "statistical"
    assert claim.has_associated_source is False
    assert claim.confidence == ConfidenceLevel.HIGH

    # Verify alias works identically
    alias_claim = PotentiallySupportNeededClaimContract(
        claim_text="The world's leading solution for enterprise search.",
        reason="Superlative assertion lacking independent industry recognition citation.",
        claim_type="superlative",
    )
    assert alias_claim.claim_type == "superlative"
    assert alias_claim.confidence == ConfidenceLevel.MEDIUM


def test_support_needed_claim_text_validation():
    """Verify empty claim text is rejected and overly long text is safely bounded."""
    with pytest.raises(ValidationError):
        SupportNeededClaimContract(
            claim_text="   ",
            reason="Empty claim",
        )

    # Very long text should be safely bounded
    long_text = "A" * 1500
    bounded_claim = SupportNeededClaimContract(
        claim_text=long_text,
        reason="Long text claim",
    )
    assert len(bounded_claim.claim_text) <= 1000
    assert bounded_claim.claim_text.endswith("...")


def test_valid_source_association_creation():
    """Verify SourceAssociationContract representing relationship between claim and source."""
    association = SourceAssociationContract(
        association_id="assoc_101",
        claim_id="claim_001",
        claim_text="Global temperature rose by 1.1 degrees Celsius.",
        content_region="Climate Overview / Section 2",
        source_url="https://climate.nasa.gov/evidence/",
        source_domain="climate.nasa.gov",
        association_type="in_text_link",
        confidence=ConfidenceLevel.HIGH,
        explanation="The sentence links directly to NASA's global temperature evidence repository.",
        context_text="Global temperature rose by 1.1 degrees Celsius [NASA].",
        evidence={"link_distance_characters": 0, "exact_match": True},
    )

    assert association.association_id == "assoc_101"
    assert association.source_url == "https://climate.nasa.gov/evidence/"
    assert association.source_domain == "climate.nasa.gov"
    assert association.association_type == "in_text_link"
    assert association.confidence == ConfidenceLevel.HIGH


def test_valid_citation_readiness_contract():
    """Verify structural citation readiness signals (without fake scores)."""
    readiness = CitationReadinessContract(
        readiness_level="medium",
        has_verifiable_sources=True,
        total_external_sources=4,
        total_claims_detected=6,
        supported_claims_count=3,
        unsupported_claims_count=3,
        positive_signals=[
            "Direct external citations present for key benchmarks",
            "Structured author and organization schema detected",
        ],
        negative_signals=[
            "3 specific statistical claims lack verifiable external references",
            "2 external references lack explicit anchor text context",
        ],
        structural_indicators={
            "has_bibliography_section": False,
            "has_doi_or_academic_links": True,
            "has_author_byline": True,
            "has_editorial_disclosure": False,
        },
        evidence={"evaluated_paragraphs": 12, "citation_density": 0.33},
    )

    assert readiness.readiness_level == "medium"
    assert readiness.has_verifiable_sources is True
    assert readiness.total_external_sources == 4
    assert len(readiness.positive_signals) == 2
    assert len(readiness.negative_signals) == 2
    assert readiness.structural_indicators["has_doi_or_academic_links"] is True


def test_top_level_envelope_serialization_and_roundtrip():
    """Verify AuthorityCitationTrustResult serialization and complete roundtrip with typed Finding and Recommendation schemas."""
    trust_sig = TrustSignalContract(
        signal_id="trust_contact_info",
        title="Physical Contact Information Verified",
        status="detected",
        confidence=ConfidenceLevel.HIGH,
    )
    auth_sig = AuthoritySignalContract(
        signal_id="authority_expert_author",
        title="Author Recognized Domain Authority",
        status="detected",
        confidence=ConfidenceLevel.HIGH,
    )
    source = ExternalSourceContract(
        url="https://nih.gov/study/123",
        domain="nih.gov",
        anchor_text="NIH Clinical Trial Results",
        is_citation_candidate=True,
    )
    claim = SupportNeededClaimContract(
        claim_text="Treatment efficacy reached 94.2% in randomized double-blind trials.",
        claim_type="statistical",
        reason="High-impact clinical efficacy statistic requiring verifiable primary source.",
        confidence=ConfidenceLevel.HIGH,
        has_associated_source=True,
        associated_source_urls=["https://nih.gov/study/123"],
    )
    assoc = SourceAssociationContract(
        source_url="https://nih.gov/study/123",
        claim_text=claim.claim_text,
        association_type="footnote_citation",
        confidence=ConfidenceLevel.HIGH,
    )
    readiness = CitationReadinessContract(
        readiness_level="high",
        has_verifiable_sources=True,
        total_external_sources=1,
        total_claims_detected=1,
        supported_claims_count=1,
        unsupported_claims_count=0,
        positive_signals=["Clinical claim supported by primary NIH trial reference."],
    )

    # Reusing existing Finding & Recommendation schema structures
    finding = FindingResponse(
        id=101,
        website_id=1,
        scan_id=2,
        page_id=5,
        finding_type="missing_citation_for_statistical_claim",
        type="missing_citation_for_statistical_claim",
        category="authority",
        title="Unsupported Statistical Efficacy Claim",
        description="A major numerical efficacy claim is stated without a traceable citation.",
        severity="high",
        status="open",
        evidence={"claim_text": claim.claim_text, "rule_id": "RULE_AUTH_001"},
        created_at=datetime.now(timezone.utc),
    )

    rec = RecommendationResponse(
        id=201,
        finding_id=101,
        title="Add Primary Study Citation to Statistical Claim",
        description="Link the 94.2% efficacy statement directly to the published trial DOI or NIH report.",
        priority="high",
        status="open",
        impact="high",
        action_type="add_citation",
        created_at=datetime.now(timezone.utc),
    )

    # Also test with pre-persisted FindingCreate and RecommendationCreate
    new_finding = FindingCreate(
        page_id=5,
        finding_type="unsupported_superlative",
        category="authority",
        title="Unsupported Superlative Assertion",
        description="Page claims #1 market position without third-party proof.",
        severity="medium",
        status="open",
        evidence={"claim": "World's #1 platform"},
    )

    new_rec = RecommendationCreate(
        title="Cite Independent Industry Audit",
        description="Attach credible audit reference to #1 assertion.",
        priority="medium",
        status="open",
    )

    result = AuthorityCitationTrustResult(
        page_id=5,
        url="https://example.com/medical-study",
        scan_id=2,
        website_id=1,
        trust_signals=[trust_sig],
        authority_signals=[auth_sig],
        external_sources=[source],
        support_needed_claims=[claim],
        source_associations=[assoc],
        citation_readiness=readiness,
        findings=[finding, new_finding],
        recommendations=[rec, new_rec],
        metadata={"engine_version": "1.0.0", "task": "day_7_step_2"},
    )

    # 1. Pydantic dump
    data = result.model_dump()
    assert data["page_id"] == 5
    assert len(data["trust_signals"]) == 1
    assert len(data["authority_signals"]) == 1
    assert len(data["external_sources"]) == 1
    assert len(data["support_needed_claims"]) == 1
    assert len(data["source_associations"]) == 1
    assert data["citation_readiness"]["readiness_level"] == "high"
    assert len(data["findings"]) == 2
    assert len(data["recommendations"]) == 2
    assert data["findings"][0]["finding_type"] == "missing_citation_for_statistical_claim"
    assert data["findings"][1]["finding_type"] == "unsupported_superlative"
    assert data["recommendations"][0]["action_type"] == "add_citation"

    # 2. JSON serialization
    json_str = result.model_dump_json()
    assert "https://nih.gov/study/123" in json_str

    # 3. Round-trip rebuild
    parsed = AuthorityCitationTrustResult.model_validate_json(json_str)
    assert parsed.page_id == 5
    assert parsed.trust_signals[0].signal_id == "trust_contact_info"
    assert parsed.citation_readiness.supported_claims_count == 1
    assert len(parsed.findings) == 2


def test_canonical_contract_module_imports():
    """Verify that all Step 2 contracts are cleanly importable from app.authority_citation_schemas."""
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

    assert SeverityLevel.CRITICAL.value == "critical"
    assert ConfidenceLevel.HIGH.value == "high"
    assert TrustSignalContract is not None
    assert AuthoritySignalContract is not None
    assert ExternalSourceContract is not None
    assert SupportNeededClaimContract is not None
    assert PotentiallySupportNeededClaimContract is SupportNeededClaimContract
    assert SourceAssociationContract is not None
    assert CitationReadinessContract is not None
    assert AuthorityCitationTrustResult is not None
