"""
Source-Quality Engine (Day 8 - Phase B - Step 7 ONLY)

Performs deterministic evaluation of detected external sources for:
1. Primary-Source Indicators (DOI, .gov, .edu, academic archives, standards bodies)
2. Anchor Text Quality (Descriptive semantic vs weak/generic "click here" anchors)
3. Source Usability & Reachability (Valid format, observed HTTP status codes, broken links)
4. Rel Attributes & Commercial Dilution (Sponsored flags, affiliate tracking)
5. Overall Quality Tier Classification (High, Adequate, Weak, Broken)

Core architectural principles:
- Evidence != Conclusion: Evaluates structural usability and domain typology; does NOT assert global factual infallibility.
- Reuses Step 5 ExternalSourceContract objects and produces explainable SourceQualityAssessment records.
"""

from datetime import datetime, timezone
import re
from typing import Any
from urllib.parse import urlparse

from pydantic import BaseModel, ConfigDict, Field

from .authority_citation_schemas import (
    ConfidenceLevel,
    ExternalSourceContract,
    SeverityLevel,
)
from .schemas import FindingCreate, RecommendationCreate


# Recognized Primary Source Domains and TLDs
PRIMARY_TLDS = (".gov", ".mil")
PRIMARY_SCHOLARLY_DOMAINS = {
    "doi.org",
    "ncbi.nlm.nih.gov",
    "pubmed.ncbi.nlm.nih.gov",
    "nature.com",
    "sciencedirect.com",
    "cell.com",
    "thelancet.com",
    "jamanetwork.com",
    "nejm.org",
    "bmj.com",
    "ieee.org",
    "ieeexplore.ieee.org",
    "acm.org",
    "arxiv.org",
    "biorxiv.org",
    "medrxiv.org",
    "nih.gov",
    "cdc.gov",
    "who.int",
    "fda.gov",
    "epa.gov",
    "nrel.gov",
    "nist.gov",
    "nasa.gov",
}

STANDARDS_ORGANIZATION_DOMAINS = {
    "iso.org",
    "w3.org",
    "ietf.org",
    "ansi.org",
    "iec.ch",
}

# Generic / Weak Anchor Texts that lack descriptive value
WEAK_ANCHOR_TEXTS = {
    "click here",
    "here",
    "link",
    "this",
    "read more",
    "learn more",
    "website",
    "source",
    "view",
    "page",
    "details",
    "info",
    "article",
    "more",
    "check here",
}

# Commercial tracking parameters
AFFILIATE_REGEX = re.compile(
    r"(?:[?&](?:tag|ref|aff|affiliate|aff_id|track|campaign|subid)=[^&]+)",
    re.I,
)


class SourceQualityAssessment(BaseModel):
    """
    Detailed quality assessment for an individual external source link.
    """
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    url: str = Field(..., description="Target source URL evaluated")
    domain: str | None = Field(default=None, description="Normalized domain name")
    anchor_text: str | None = Field(default=None, description="Anchor text used for link")
    quality_tier: str = Field(default="adequate", description="Quality tier: high, adequate, weak, broken")
    is_primary_source: bool = Field(default=False, description="Whether source exhibits primary research or institutional repository indicators")
    primary_source_type: str | None = Field(default=None, description="Typology of primary source (e.g. doi, government_dataset, scholarly_archive, standards_body)")
    is_accessible: bool = Field(default=True, description="Whether the source URL appears valid, well-formed, and reachable")
    anchor_quality: str = Field(default="descriptive", description="Evaluation of anchor text: descriptive, weak, url_literal, empty")
    rel_assessment: str | None = Field(default=None, description="Assessment of rel attributes (e.g. standard_noopener, sponsored_commercial, nofollow_untrusted)")
    relevance_context: str | None = Field(default=None, description="Contextual topic alignment summary")
    issues: list[str] = Field(default_factory=list, description="Specific quality issues detected")
    evidence: dict[str, Any] = Field(default_factory=dict, description="Traceable evidence supporting assessment")


class SourceQualityResult(BaseModel):
    """
    Structured result produced by the Source-Quality Engine.
    Contains assessments for all evaluated sources, aggregate metrics, and explainable findings.
    """
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    page_id: int | None = Field(default=None, description="Page ID if analyzed from database")
    url: str | None = Field(default=None, description="URL of the analyzed page")
    total_sources_evaluated: int = Field(default=0, description="Total external sources evaluated")
    high_quality_sources_count: int = Field(default=0, description="Count of high-tier / primary repository sources")
    adequate_sources_count: int = Field(default=0, description="Count of adequate external reference sources")
    weak_sources_count: int = Field(default=0, description="Count of sources with weak anchors or commercial flags")
    broken_or_inaccessible_sources_count: int = Field(default=0, description="Count of broken or inaccessible sources")
    assessments: list[SourceQualityAssessment] = Field(default_factory=list, description="Per-source detailed quality assessments")
    findings: list[FindingCreate] = Field(default_factory=list, description="Actionable findings generated from source quality issues")
    recommendations: list[RecommendationCreate] = Field(default_factory=list, description="Actionable recommendations for findings")
    metadata: dict[str, Any] = Field(default_factory=dict, description="Analysis execution metadata")


class SourceQualityEngine:
    """
    Deterministic Source-Quality Engine (Step 7).
    Evaluates detected external sources from Step 5 for primary-source indicators,
    anchor descriptiveness, reachability, and commercial dilution.
    """

    def analyze(
        self,
        sources: list[ExternalSourceContract | dict[str, Any]] | None = None,
        page_url: str | None = None,
        page_id: int | None = None,
    ) -> SourceQualityResult:
        """
        Main deterministic routine for External Source Quality Evaluation.
        """
        result = SourceQualityResult(
            page_id=page_id,
            url=page_url,
            metadata={
                "engine": "SourceQualityEngine",
                "version": "1.0.0",
                "evaluated_at": datetime.now(timezone.utc).isoformat(),
            },
        )

        if not sources:
            return result

        assessments: list[SourceQualityAssessment] = []
        high_count = 0
        adequate_count = 0
        weak_count = 0
        broken_count = 0

        for src in sources:
            assessment = self._evaluate_single_source(src)
            assessments.append(assessment)

            tier = assessment.quality_tier
            if tier == "high":
                high_count += 1
            elif tier == "adequate":
                adequate_count += 1
            elif tier == "weak":
                weak_count += 1
            elif tier == "broken":
                broken_count += 1

        result.assessments = assessments
        result.total_sources_evaluated = len(assessments)
        result.high_quality_sources_count = high_count
        result.adequate_sources_count = adequate_count
        result.weak_sources_count = weak_count
        result.broken_or_inaccessible_sources_count = broken_count

        # Generate Explainable Findings & Recommendations
        self._generate_findings_and_recommendations(result, page_id=page_id)

        return result

    def evaluate_external_source_result(
        self,
        external_source_result: Any,
        page_id: int | None = None,
    ) -> SourceQualityResult:
        """
        Convenience method to evaluate sources directly from an ExternalSourceResult object.
        """
        sources = getattr(external_source_result, "sources", [])
        page_url = getattr(external_source_result, "url", None)
        return self.analyze(sources=sources, page_url=page_url, page_id=page_id)

    # -------------------------------------------------------------------------
    # Evaluation Subroutines
    # -------------------------------------------------------------------------

    def _evaluate_single_source(
        self,
        src: ExternalSourceContract | dict[str, Any],
    ) -> SourceQualityAssessment:
        if isinstance(src, dict):
            url = src.get("url") or src.get("destination_url") or ""
            domain = src.get("domain") or ""
            anchor = src.get("anchor_text") or ""
            rel_attrs = src.get("rel_attributes") or []
            status_code = src.get("status_code")
            avail_status = src.get("availability_status")
            link_type = src.get("link_type", "external")
        else:
            url = src.url
            domain = src.domain or ""
            anchor = src.anchor_text or ""
            rel_attrs = src.rel_attributes or []
            status_code = src.status_code
            avail_status = src.availability_status
            link_type = src.link_type

        norm_domain = domain.lower() if domain else ""
        if not norm_domain and url:
            try:
                norm_domain = urlparse(url).netloc.lower()
                if norm_domain.startswith("www."):
                    norm_domain = norm_domain[4:]
            except Exception:
                norm_domain = ""

        issues: list[str] = []
        evidence: dict[str, Any] = {"url": url, "domain": norm_domain}

        # 1. Reachability and Usability Assessment
        is_accessible = True
        if not url or not url.startswith(("http://", "https://")):
            is_accessible = False
            issues.append("invalid_url_scheme")
        elif status_code is not None and status_code >= 400:
            is_accessible = False
            issues.append(f"http_error_status_{status_code}")
        elif avail_status == "broken":
            is_accessible = False
            issues.append("broken_link_flagged")

        # 2. Primary Source Indicators
        is_primary = False
        primary_type = None

        if "doi.org" in norm_domain:
            is_primary = True
            primary_type = "doi"
        elif any(norm_domain.endswith(tld) for tld in PRIMARY_TLDS):
            is_primary = True
            primary_type = "government_repository"
        elif norm_domain.endswith(".edu") or any(norm_domain == rd or norm_domain.endswith("." + rd) for rd in PRIMARY_SCHOLARLY_DOMAINS):
            is_primary = True
            primary_type = "scholarly_archive"
        elif any(norm_domain == st or norm_domain.endswith("." + st) for st in STANDARDS_ORGANIZATION_DOMAINS):
            is_primary = True
            primary_type = "standards_organization"

        evidence["is_primary_source"] = is_primary
        evidence["primary_source_type"] = primary_type

        # 3. Anchor Text Quality Assessment
        clean_anchor = anchor.strip()
        anchor_lower = clean_anchor.lower()

        if not clean_anchor:
            anchor_quality = "empty"
            issues.append("empty_anchor_text")
        elif anchor_lower in WEAK_ANCHOR_TEXTS:
            anchor_quality = "weak"
            issues.append(f"generic_weak_anchor_phrase: '{anchor_lower}'")
        elif clean_anchor.startswith(("http://", "https://", "www.")) or clean_anchor == norm_domain:
            anchor_quality = "url_literal"
            issues.append("raw_url_literal_anchor")
        else:
            anchor_quality = "descriptive"

        evidence["anchor_quality"] = anchor_quality

        # 4. Rel & Commercial Dilution Assessment
        rel_assessment = "standard"
        if "sponsored" in rel_attrs or bool(AFFILIATE_REGEX.search(url)):
            rel_assessment = "sponsored_commercial"
            issues.append("commercial_affiliate_citation")
        elif "nofollow" in rel_attrs:
            rel_assessment = "nofollow"

        evidence["rel_assessment"] = rel_assessment

        # 5. Determine Overall Quality Tier
        if not is_accessible:
            quality_tier = "broken"
        elif is_primary and anchor_quality == "descriptive" and rel_assessment != "sponsored_commercial":
            quality_tier = "high"
        elif rel_assessment == "sponsored_commercial" or anchor_quality in ("weak", "empty"):
            quality_tier = "weak"
        else:
            quality_tier = "adequate"

        return SourceQualityAssessment(
            url=url,
            domain=norm_domain,
            anchor_text=clean_anchor,
            quality_tier=quality_tier,
            is_primary_source=is_primary,
            primary_source_type=primary_type,
            is_accessible=is_accessible,
            anchor_quality=anchor_quality,
            rel_assessment=rel_assessment,
            relevance_context=f"Domain {norm_domain} classified as {primary_type or 'general_reference'}",
            issues=issues,
            evidence=evidence,
        )

    def _generate_findings_and_recommendations(
        self,
        result: SourceQualityResult,
        page_id: int | None,
    ) -> None:
        """
        Generates actionable findings and recommendations for source quality issues.
        """
        # 1. Broken / Inaccessible Sources Finding
        broken_sources = [a for a in result.assessments if a.quality_tier == "broken"]
        if broken_sources:
            result.findings.append(
                FindingCreate(
                    page_id=page_id,
                    finding_type="broken_reference_link",
                    category="authority",
                    title=f"Detected {len(broken_sources)} Inaccessible or Broken External Source Link(s)",
                    description="Outbound reference citations return error status codes or have invalid destination URLs.",
                    severity="high",
                    status="open",
                    evidence={"broken_urls": [b.url for b in broken_sources[:3]]},
                )
            )
            result.recommendations.append(
                RecommendationCreate(
                    title="Repair or Replace Inaccessible Citation Links",
                    description="Update broken external citation URLs to live, accessible permanent records or DOI identifiers.",
                    priority="high",
                    status="open",
                    action_type="repair_broken_citations",
                )
            )

        # 2. Weak Generic Anchor Texts Finding
        weak_anchors = [a for a in result.assessments if a.anchor_quality == "weak"]
        if len(weak_anchors) >= 2:
            result.findings.append(
                FindingCreate(
                    page_id=page_id,
                    finding_type="generic_citation_anchor_text",
                    category="authority",
                    title=f"Identified {len(weak_anchors)} Source Links Using Non-Descriptive Anchor Text",
                    description="Citation links use generic phrases (e.g. 'click here', 'link') instead of descriptive study or dataset titles.",
                    severity="low",
                    status="open",
                    evidence={"sample_generic_anchors": [a.anchor_text for a in weak_anchors[:3]]},
                )
            )
            result.recommendations.append(
                RecommendationCreate(
                    title="Use Descriptive Anchor Text for External References",
                    description="Replace generic 'click here' anchor text with specific names of cited publications, trials, or institutions.",
                    priority="low",
                    status="open",
                    action_type="enhance_citation_anchors",
                )
            )


def evaluate_source_quality(
    sources: list[ExternalSourceContract | dict[str, Any]] | None = None,
    page_url: str | None = None,
    page_id: int | None = None,
) -> SourceQualityResult:
    """
    Convenience function for SourceQualityEngine.
    """
    engine = SourceQualityEngine()
    return engine.analyze(sources=sources, page_url=page_url, page_id=page_id)
