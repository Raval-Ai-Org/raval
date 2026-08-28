"""
Authority, Citation & Trust Intelligence Data Contract (Task 7 - Step 2)

Defines the minimal, production-grade canonical data contracts for:
- Trust Signals
- Authority Signals
- External Sources
- Potentially Support-Needed Claims
- Source Associations
- Structural Citation Readiness
- Top-level Authority, Citation & Trust Analysis Result

Strictly follows:
- Evidence != conclusion
- Potentially support-needed claims (not a fact checker)
- Structural citation readiness (no fake citation scores / no AI citation guarantees)
- Strict reuse of existing Finding and Recommendation schema structures
"""

from datetime import datetime
from enum import Enum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator

from .schemas import FindingCreate, FindingResponse, RecommendationCreate, RecommendationResponse


class SeverityLevel(str, Enum):
    """
    Standard severity levels compatible with Day 7 specification and existing findings.
    """
    CRITICAL = "critical"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"
    INFO = "info"

    @classmethod
    def _missing_(cls, value: object):
        if isinstance(value, str):
            for member in cls:
                if member.value == value.lower():
                    return member
        return None


class ConfidenceLevel(str, Enum):
    """
    Confidence levels for signals, claims, and associations.
    """
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"

    @classmethod
    def _missing_(cls, value: object):
        if isinstance(value, str):
            for member in cls:
                if member.value == value.lower():
                    return member
        return None


class TrustSignalContract(BaseModel):
    """
    Deterministic trust signal representation with traceable evidence.
    """
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    signal_id: str = Field(..., description="Deterministic rule or signal identifier (e.g. trust_author_credentials_present)")
    category: str = Field(default="trust", description="Signal category (e.g. authorship, transparency, policy, business_identity)")
    title: str = Field(..., description="Human-readable title describing the signal")
    status: str = Field(default="detected", description="Status of signal detection (e.g. detected, missing, partial, verified)")
    value: Any | None = Field(default=None, description="Observed status or value (boolean, numeric, string, or structured)")
    confidence: ConfidenceLevel = Field(default=ConfidenceLevel.HIGH, description="Confidence level of detection (high, medium, low)")
    description: str | None = Field(default=None, description="Detailed explanation of what the signal represents")
    evidence: dict[str, Any] | list[Any] | None = Field(default=None, description="DOM or extraction evidence supporting this signal")


class AuthoritySignalContract(BaseModel):
    """
    Deterministic authority signal representation with traceable evidence.
    """
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    signal_id: str = Field(..., description="Deterministic rule or signal identifier (e.g. authority_org_schema_verified)")
    category: str = Field(default="authority", description="Signal category (e.g. organization, domain_expertise, source_credibility)")
    title: str = Field(..., description="Human-readable title describing the signal")
    status: str = Field(default="detected", description="Status of signal detection (e.g. detected, missing, partial, verified)")
    value: Any | None = Field(default=None, description="Observed status or value")
    confidence: ConfidenceLevel = Field(default=ConfidenceLevel.HIGH, description="Confidence level of detection (high, medium, low)")
    description: str | None = Field(default=None, description="Detailed explanation of what the signal represents")
    evidence: dict[str, Any] | list[Any] | None = Field(default=None, description="DOM or extraction evidence supporting this signal")


class ExternalSourceContract(BaseModel):
    """
    External source contract.
    Represents an external link/source candidate without assuming all external links are citations.
    """
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    url: str = Field(..., description="External source URL")
    domain: str | None = Field(default=None, description="Normalized source domain name")
    anchor_text: str | None = Field(default=None, description="Clickable anchor text associated with source link")
    context_text: str | None = Field(default=None, description="Nearby surrounding text or paragraph for context")
    link_type: str = Field(default="external", description="Classification of link (e.g. external, reference, citation, social, affiliate)")
    is_accessible: bool | None = Field(default=None, description="Whether the external source URL was verified accessible")
    status_code: int | None = Field(default=None, description="HTTP status code if probed or observed")
    availability_status: str | None = Field(default=None, description="Availability status (e.g. valid, broken, redirect, unverified)")
    rel_attributes: list[str] | None = Field(default=None, description="Rel attributes present on link (e.g. nofollow, sponsored, ugc)")
    is_citation_candidate: bool = Field(default=False, description="Whether this source exhibits citation/reference characteristics")
    evidence: dict[str, Any] | None = Field(default=None, description="Extraction evidence and DOM metadata needed for source association")


class SupportNeededClaimContract(BaseModel):
    """
    Potentially support-needed claim contract.
    NOT a fact checker. Represents factual assertions, statistical metrics, superlatives,
    or comparative claims that may benefit from external source citation.
    """
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    claim_id: str | None = Field(default=None, description="Optional stable identifier for the claim")
    claim_text: str = Field(..., description="Safely bounded text excerpt of the claim")
    claim_type: str = Field(default="factual_assertion", description="Category of claim (e.g. statistical, factual_assertion, comparative, superlative, testimonial)")
    location: str | None = Field(default=None, description="Location within the page (heading, section, paragraph, or DOM selector)")
    reason: str = Field(..., description="Reason why the claim may benefit from external source support/citation")
    confidence: ConfidenceLevel = Field(default=ConfidenceLevel.MEDIUM, description="Confidence in claim detection (high, medium, low)")
    has_associated_source: bool = Field(default=False, description="Whether a supporting external source has been associated with this claim")
    associated_source_urls: list[str] = Field(default_factory=list, description="URLs of external sources associated with this claim")
    evidence: dict[str, Any] | None = Field(default=None, description="Contextual extraction evidence for the claim")

    @field_validator("claim_text")
    @classmethod
    def validate_claim_text_bounded(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("claim_text cannot be empty")
        # Ensure safely bounded claim excerpt (max 1000 characters)
        if len(v) > 1000:
            return v[:997] + "..."
        return v


# Canonical alias for explicit naming
PotentiallySupportNeededClaimContract = SupportNeededClaimContract


class SourceAssociationContract(BaseModel):
    """
    Contract representing the relationship between a claim/content region and an external source.
    """
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    association_id: str | None = Field(default=None, description="Optional stable identifier for this association")
    claim_id: str | None = Field(default=None, description="Identifier of the claim being supported")
    claim_text: str | None = Field(default=None, description="Excerpt of the claim text being supported")
    content_region: str | None = Field(default=None, description="Section, heading, or block containing the claim/source")
    source_url: str = Field(..., description="URL of the associated external source")
    source_domain: str | None = Field(default=None, description="Domain of the associated external source")
    association_type: str = Field(default="in_text_link", description="Mechanism of association (e.g. direct_link, footnote_citation, same_sentence_reference, same_section_attribution, in_text_mention)")
    confidence: ConfidenceLevel = Field(default=ConfidenceLevel.MEDIUM, description="Confidence in source association (high, medium, low)")
    explanation: str | None = Field(default=None, description="Explanation for why this source is associated with the content")
    context_text: str | None = Field(default=None, description="Surrounding contextual text spanning claim and source")
    evidence: dict[str, Any] | None = Field(default=None, description="Traceable evidence supporting the association")


class CitationReadinessContract(BaseModel):
    """
    Contract representing structural citation readiness signals.
    Does NOT contain a fake citation score or make claims about AI system citation guarantees.
    """
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    readiness_level: str = Field(default="low", description="Structural citation readiness level (e.g. high, medium, low)")
    has_verifiable_sources: bool = Field(default=False, description="Whether verifiable external sources/citations are present")
    total_external_sources: int = Field(default=0, description="Total count of external sources extracted from page")
    total_claims_detected: int = Field(default=0, description="Total count of potentially support-needed claims detected")
    supported_claims_count: int = Field(default=0, description="Count of claims associated with external sources")
    unsupported_claims_count: int = Field(default=0, description="Count of claims lacking external source support")
    positive_signals: list[str] = Field(default_factory=list, description="Structural citation-readiness positive signals")
    negative_signals: list[str] = Field(default_factory=list, description="Structural citation gaps and missing evidence signals")
    structural_indicators: dict[str, Any] = Field(default_factory=dict, description="Detailed boolean and categorical structural indicators")
    evidence: dict[str, Any] | None = Field(default=None, description="Supporting evidence for citation readiness assessment")


class AuthorityCitationTrustResult(BaseModel):
    """
    Top-level envelope for Authority, Citation & Trust Intelligence analysis output.
    Reuses existing Finding and Recommendation structures.
    """
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    page_id: int | None = Field(default=None, description="Database ID of the associated page")
    url: str | None = Field(default=None, description="URL of the analyzed page")
    scan_id: int | None = Field(default=None, description="Database ID of the scan")
    website_id: int | None = Field(default=None, description="Database ID of the website")
    trust_signals: list[TrustSignalContract] = Field(default_factory=list, description="List of detected trust signals")
    authority_signals: list[AuthoritySignalContract] = Field(default_factory=list, description="List of detected authority signals")
    external_sources: list[ExternalSourceContract] = Field(default_factory=list, description="List of external sources extracted from page")
    support_needed_claims: list[SupportNeededClaimContract] = Field(default_factory=list, description="List of detected potentially support-needed claims")
    source_associations: list[SourceAssociationContract] = Field(default_factory=list, description="List of claim-to-source associations")
    citation_readiness: CitationReadinessContract = Field(default_factory=CitationReadinessContract, description="Structural citation readiness summary")
    findings: list[FindingResponse | FindingCreate] = Field(default_factory=list, description="Findings generated from trust, authority, and citation analysis")
    recommendations: list[RecommendationResponse | RecommendationCreate] = Field(default_factory=list, description="Actionable recommendations generated for findings")
    metadata: dict[str, Any] = Field(default_factory=dict, description="Execution metadata such as timestamps, engine versions, and status")
