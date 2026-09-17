"""
External Source Detection Engine (Day 8 - Phase B - Step 5 ONLY)

Performs deterministic detection, normalization, context extraction, and citation-candidate
classification for external sources, references, and citations from page extraction evidence.

Core architectural principles:
- External links are NOT automatically citations. They are classified as source candidates.
- Evidence != Conclusion: Structural detection only, no web-wide fact-checking or live network dependencies.
- Produces canonical ExternalSourceContract objects conforming strictly to Step 2 schemas.
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


# Recognized Scholarly, Institutional, and High-Trust Knowledge Domains
INSTITUTIONAL_TLDS = (".edu", ".gov", ".mil")

RECOGNIZED_RESEARCH_DOMAINS = {
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
    "springer.com",
    "wiley.com",
    "oxfordacademic.com",
    "cambridge.org",
    "nih.gov",
    "cdc.gov",
    "who.int",
    "fda.gov",
    "epa.gov",
    "nrel.gov",
    "nist.gov",
    "nasa.gov",
    "worldbank.org",
    "imf.org",
    "oecd.org",
    "reuters.com",
    "bloomberg.com",
}

# Major Social Media & Platform Domains
SOCIAL_DOMAINS = {
    "twitter.com",
    "x.com",
    "facebook.com",
    "instagram.com",
    "linkedin.com",
    "youtube.com",
    "tiktok.com",
    "pinterest.com",
    "reddit.com",
    "t.me",
    "whatsapp.com",
}

# Regex Patterns for Reference and Citation Sections in Headings or IDs
REFERENCE_SECTION_REGEX = re.compile(
    r"\b(references|sources|bibliography|works cited|citations|literature cited|further reading|data sources)\b",
    re.I,
)

# Regex Patterns for In-Text Citation Formats
CITATION_NOTATION_REGEX = re.compile(
    r"(\[\d{1,3}\]|\([A-Z][a-zA-Z]+(?:\s+et\s+al\.?)?,\s*(?:19|20)\d{2}\))"
)

# Regex Patterns for Explicit Citation Labels Preceding Links
CITATION_LABEL_REGEX = re.compile(
    r"\b(source:|reference:|data from:|according to:|study:|dataset:|full study:|doi:|pmid:|issn:)\b",
    re.I,
)

# Regex Patterns for Commercial / Affiliate Tracking Parameters
AFFILIATE_PARAM_REGEX = re.compile(
    r"(?:[?&](?:tag|ref|aff|affiliate|aff_id|track|campaign|subid)=[^&]+)",
    re.I,
)


class ExternalSourceResult(BaseModel):
    """
    Structured result produced by the External Source Detection Engine.
    Contains classified external sources, statistics, reference sections, and explainable findings.
    """
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    page_id: int | None = Field(default=None, description="Page ID if analyzed from database")
    url: str | None = Field(default=None, description="URL of the analyzed page")
    total_external_sources: int = Field(default=0, description="Total external source links detected")
    citation_candidates_count: int = Field(default=0, description="Count of sources exhibiting citation/reference characteristics")
    non_citation_sources_count: int = Field(default=0, description="Count of external sources classified as social, affiliate, or general")
    reference_sections_detected: list[str] = Field(default_factory=list, description="Reference or bibliography section headings found")
    sources: list[ExternalSourceContract] = Field(default_factory=list, description="All classified external source contracts")
    domains_summary: dict[str, int] = Field(default_factory=dict, description="Count of occurrences by normalized domain")
    findings: list[FindingCreate] = Field(default_factory=list, description="Actionable findings generated from source evaluation")
    recommendations: list[RecommendationCreate] = Field(default_factory=list, description="Actionable recommendations for findings")
    metadata: dict[str, Any] = Field(default_factory=dict, description="Analysis execution metadata")


class ExternalSourceEngine:
    """
    Deterministic External Source Detection Engine (Step 5).
    Identifies external links, normalizes domains, extracts surrounding context,
    detects dedicated reference sections, and classifies citation candidates without web-wide fact checking.
    """

    def analyze(
        self,
        page_url: str | None = None,
        links: list[Any] | None = None,
        headings: list[Any] | None = None,
        text_content: str | None = None,
        raw_html: str | None = None,
        page_id: int | None = None,
    ) -> ExternalSourceResult:
        """
        Main deterministic analysis routine for External Source Detection.
        """
        result = ExternalSourceResult(
            page_id=page_id,
            url=page_url,
            metadata={
                "engine": "ExternalSourceEngine",
                "version": "1.0.0",
                "analyzed_at": datetime.now(timezone.utc).isoformat(),
            },
        )

        base_domain = self._extract_normalized_domain(page_url) if page_url else ""
        safe_links = self._normalize_links(links)
        safe_headings = self._normalize_headings(headings)

        # 1. Detect Reference / Bibliography Sections
        ref_sections = self._detect_reference_sections(safe_headings, raw_html)
        result.reference_sections_detected = ref_sections

        # 2. Process and Classify Links
        classified_sources: list[ExternalSourceContract] = []
        domain_counts: dict[str, int] = {}

        for link in safe_links:
            dest = link.get("destination_url") or ""
            if not dest or dest.startswith(("javascript:", "mailto:", "tel:", "#")):
                continue

            # Determine internal vs external
            link_domain = self._extract_normalized_domain(dest)
            is_external = bool(link_domain and (not base_domain or link_domain != base_domain))

            # If link_type was explicitly marked external, or domain differs
            if link.get("link_type") == "external" or is_external:
                if link_domain:
                    domain_counts[link_domain] = domain_counts.get(link_domain, 0) + 1

                source_contract = self._classify_source(
                    dest_url=dest,
                    domain=link_domain,
                    anchor_text=link.get("anchor_text"),
                    rel_raw=link.get("rel_raw"),
                    position=link.get("position", 0),
                    ref_sections=ref_sections,
                    page_url=page_url,
                    text_content=text_content,
                )
                classified_sources.append(source_contract)

        result.sources = classified_sources
        result.total_external_sources = len(classified_sources)
        result.citation_candidates_count = sum(1 for s in classified_sources if s.is_citation_candidate)
        result.non_citation_sources_count = len(classified_sources) - result.citation_candidates_count
        result.domains_summary = domain_counts

        # Generate Explainable Findings & Recommendations
        self._generate_findings_and_recommendations(result, page_id=page_id)

        return result

    def analyze_extraction(
        self,
        extraction: Any,
        page_url: str | None = None,
        page_id: int | None = None,
    ) -> ExternalSourceResult:
        """
        Convenience method to analyze an existing ExtractionResult object from Task 4.
        """
        return self.analyze(
            page_url=page_url or getattr(extraction, "url", None),
            links=getattr(extraction, "links", None),
            headings=getattr(extraction, "headings", None),
            text_content=getattr(extraction, "clean_text", None),
            raw_html=getattr(extraction, "raw_html", None),
            page_id=page_id,
        )

    # -------------------------------------------------------------------------
    # Classification Subroutines
    # -------------------------------------------------------------------------

    def _classify_source(
        self,
        dest_url: str,
        domain: str | None,
        anchor_text: str | None,
        rel_raw: str | None,
        position: int,
        ref_sections: list[str],
        page_url: str | None,
        text_content: str | None,
    ) -> ExternalSourceContract:
        """
        Classifies an external link into citation, reference, social, affiliate, or general external link.
        """
        rel_list = rel_raw.split() if rel_raw else []
        clean_anchor = (anchor_text or "").strip()
        anchor_lower = clean_anchor.lower()
        norm_domain = domain or ""

        # Extract Nearby Context from text_content if possible
        context_text = self._extract_nearby_context(dest_url, clean_anchor, text_content)

        # 1. Social Link Check
        if any(s in norm_domain for s in SOCIAL_DOMAINS):
            return ExternalSourceContract(
                url=dest_url,
                domain=domain,
                anchor_text=clean_anchor,
                context_text=context_text,
                link_type="social",
                rel_attributes=rel_list,
                is_citation_candidate=False,
                evidence={
                    "classification_reason": "Domain recognized as a social media platform.",
                    "platform": norm_domain,
                    "position": position,
                },
            )

        # 2. Affiliate / Sponsored Commercial Link Check
        is_affiliate = (
            "sponsored" in rel_list
            or bool(AFFILIATE_PARAM_REGEX.search(dest_url))
            or any(w in anchor_lower for w in ("buy on amazon", "affiliate link", "check price on"))
        )
        if is_affiliate:
            return ExternalSourceContract(
                url=dest_url,
                domain=domain,
                anchor_text=clean_anchor,
                context_text=context_text,
                link_type="affiliate",
                rel_attributes=rel_list,
                is_citation_candidate=False,
                evidence={
                    "classification_reason": "Link carries commercial sponsorship or affiliate tracking parameters.",
                    "rel_attributes": rel_list,
                    "position": position,
                },
            )

        # 3. Citation Candidate Check
        is_citation = False
        reasons: list[str] = []

        # Check Institutional or Academic Domain
        if any(norm_domain.endswith(tld) for tld in INSTITUTIONAL_TLDS):
            is_citation = True
            reasons.append("Institutional domain (.edu, .gov, .mil)")

        if any(norm_domain == rd or norm_domain.endswith("." + rd) for rd in RECOGNIZED_RESEARCH_DOMAINS):
            is_citation = True
            reasons.append("Recognized scientific, medical, or research repository domain")

        # Check Citation Labels or Notations in Anchor or Context
        if bool(CITATION_LABEL_REGEX.search(anchor_lower)) or (context_text and bool(CITATION_LABEL_REGEX.search(context_text))):
            is_citation = True
            reasons.append("Preceded by explicit citation/source label")

        if bool(CITATION_NOTATION_REGEX.search(anchor_lower)) or (context_text and bool(CITATION_NOTATION_REGEX.search(context_text))):
            is_citation = True
            reasons.append("Associated with formal in-text citation notation (e.g. [1] or Author, Year)")

        # Check if page has reference section and link anchor appears scholarly
        if ref_sections and (any(w in anchor_lower for w in ("study", "trial", "report", "dataset", "journal", "proceedings", "doi", "paper"))):
            is_citation = True
            reasons.append("Scholarly reference anchor located on page with formal reference section")

        if is_citation:
            return ExternalSourceContract(
                url=dest_url,
                domain=domain,
                anchor_text=clean_anchor,
                context_text=context_text,
                link_type="citation",
                rel_attributes=rel_list,
                is_citation_candidate=True,
                evidence={
                    "classification_reason": "; ".join(reasons),
                    "is_citation_candidate": True,
                    "position": position,
                },
            )

        # 4. Informational Reference Link Check
        is_reference = any(w in anchor_lower for w in ("learn more at", "read more on", "documentation", "guide", "whitepaper", "full article"))
        if is_reference:
            return ExternalSourceContract(
                url=dest_url,
                domain=domain,
                anchor_text=clean_anchor,
                context_text=context_text,
                link_type="reference",
                rel_attributes=rel_list,
                is_citation_candidate=True,
                evidence={
                    "classification_reason": "Informational reference or documentation link.",
                    "position": position,
                },
            )

        # 5. General Outbound Link
        return ExternalSourceContract(
            url=dest_url,
            domain=domain,
            anchor_text=clean_anchor,
            context_text=context_text,
            link_type="external",
            rel_attributes=rel_list,
            is_citation_candidate=False,
            evidence={
                "classification_reason": "General outbound web link without explicit citation indicators.",
                "position": position,
            },
        )

    def _detect_reference_sections(
        self,
        headings: list[dict[str, Any]],
        raw_html: str | None,
    ) -> list[str]:
        """
        Detects dedicated reference, source, or bibliography sections.
        """
        sections: list[str] = []

        for h in headings:
            txt = (h.get("text") or "").strip()
            if bool(REFERENCE_SECTION_REGEX.search(txt)):
                sections.append(txt)

        if raw_html and not sections:
            # Check for section or div id/class
            m = re.findall(r'<(?:section|div)[^>]*(?:id|class)=["\']([^"\']*(?:references|sources|bibliography|citations)[^"\']*)["\']', raw_html, re.I)
            if m:
                sections.extend(m[:3])

        return list(set(sections))

    def _extract_nearby_context(
        self,
        dest_url: str,
        anchor_text: str,
        text_content: str | None,
    ) -> str | None:
        """
        Extracts the sentence or paragraph surrounding the anchor text within the clean text.
        """
        if not text_content or not anchor_text or len(anchor_text) < 3:
            return None

        pos = text_content.find(anchor_text)
        if pos == -1:
            return None

        # Extract +/- 120 chars around anchor
        start = max(0, pos - 120)
        end = min(len(text_content), pos + len(anchor_text) + 120)
        snippet = text_content[start:end].strip()

        # Clean up snippet edges to nearest sentence boundary if clean
        return f"...{snippet}..." if (start > 0 or end < len(text_content)) else snippet

    def _extract_normalized_domain(self, url: str | None) -> str | None:
        """
        Extracts and normalizes a domain from URL (lowercases and strips www.).
        """
        if not url:
            return None
        try:
            parsed = urlparse(url)
            host = parsed.netloc or parsed.path.split("/")[0]
            host = host.split(":")[0].lower()
            if host.startswith("www."):
                host = host[4:]
            return host if host else None
        except Exception:
            return None

    def _generate_findings_and_recommendations(
        self,
        result: ExternalSourceResult,
        page_id: int | None,
    ) -> None:
        """
        Generates actionable findings and recommendations for external source balance.
        """
        # Excessive affiliate without citations
        affiliate_count = sum(1 for s in result.sources if s.link_type == "affiliate")
        if affiliate_count >= 3 and result.citation_candidates_count == 0:
            result.findings.append(
                FindingCreate(
                    page_id=page_id,
                    finding_type="excessive_unbacked_commercial_links",
                    category="authority",
                    title="High Ratio of Commercial Links Without Authoritative Citations",
                    description=f"Identified {affiliate_count} sponsored/affiliate links while page contains 0 verifiable research or institutional references.",
                    severity="medium",
                    status="open",
                    evidence={"affiliate_count": affiliate_count, "citation_candidates_count": 0},
                )
            )
            result.recommendations.append(
                RecommendationCreate(
                    title="Balance Commercial Links with Authoritative Citations",
                    description="Provide primary research or institutional source citations alongside commercial product recommendations.",
                    priority="medium",
                    status="open",
                    action_type="balance_citations",
                )
            )

    # -------------------------------------------------------------------------
    # Normalization Helpers
    # -------------------------------------------------------------------------

    def _normalize_links(self, links: list[Any] | None) -> list[dict[str, Any]]:
        if not links:
            return []
        normalized: list[dict[str, Any]] = []
        for l in links:
            if isinstance(l, dict):
                normalized.append({
                    "destination_url": l.get("destination_url") or l.get("url"),
                    "anchor_text": l.get("anchor_text") or l.get("text"),
                    "link_type": l.get("link_type", "internal"),
                    "rel_raw": l.get("rel_raw") or l.get("rel"),
                    "position": l.get("position", 0),
                })
            else:
                normalized.append({
                    "destination_url": getattr(l, "destination_url", None) or getattr(l, "url", None),
                    "anchor_text": getattr(l, "anchor_text", None) or getattr(l, "text", None),
                    "link_type": getattr(l, "link_type", "internal"),
                    "rel_raw": getattr(l, "rel_raw", None) or getattr(l, "rel", None),
                    "position": getattr(l, "position", 0),
                })
        return normalized

    def _normalize_headings(self, headings: list[Any] | None) -> list[dict[str, Any]]:
        if not headings:
            return []
        normalized: list[dict[str, Any]] = []
        for h in headings:
            if isinstance(h, dict):
                normalized.append(h)
            else:
                normalized.append({
                    "level": getattr(h, "level", 1),
                    "text": getattr(h, "text", ""),
                    "position": getattr(h, "position", 0),
                })
        return normalized


def detect_external_sources(
    page_url: str | None = None,
    links: list[Any] | None = None,
    headings: list[Any] | None = None,
    text_content: str | None = None,
    raw_html: str | None = None,
    page_id: int | None = None,
) -> ExternalSourceResult:
    """
    Convenience function for ExternalSourceEngine.
    """
    engine = ExternalSourceEngine()
    return engine.analyze(
        page_url=page_url,
        links=links,
        headings=headings,
        text_content=text_content,
        raw_html=raw_html,
        page_id=page_id,
    )
