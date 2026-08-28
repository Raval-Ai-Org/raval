"""
Claim-Support Engine (Day 8 - Phase B - Step 6 ONLY)

Performs deterministic detection of potentially support-needed claims and associates
them with extracted external sources/citations.

Claims covered:
1. Statistical / Quantitative metrics (percentages, exact numbers, units)
2. Time-sensitive / Temporal assertions (years, projection dates)
3. Comparative assertions (relative performance, benchmarks)
4. Superlatives / Strong subjective claims (unrivaled, best in class)
5. Technical / Scientific mechanism assertions

Core architectural principles:
- NOT fact-checking: Does NOT determine whether a claim is true or false.
- Produces safely bounded claim text excerpts.
- Associates claims with nearby external sources with traceable evidence.
- Reuses Step 2 SupportNeededClaimContract and SourceAssociationContract.
"""

from datetime import datetime, timezone
import re
from typing import Any
from urllib.parse import urlparse

from pydantic import BaseModel, ConfigDict, Field

from .authority_citation_schemas import (
    ConfidenceLevel,
    SeverityLevel,
    SourceAssociationContract,
    SupportNeededClaimContract,
)
from .schemas import FindingCreate, RecommendationCreate


# Regex for Statistical & Quantitative Metrics
STATISTICAL_REGEX = re.compile(
    r"\b(?:\d+(?:\.\d+)?%|\d+(?:\.\d+)?\s*(?:kw|mw|gw|mhz|ghz|ms|ns|kb|mb|gb|tb|mph|km/h|kg|mg|g|usd|\$|€|£)|\d{1,3}(?:,\d{3})+\b)",
    re.I,
)

# Regex for Temporal & Time-Sensitive Assertions
TEMPORAL_REGEX = re.compile(
    r"\b(?:in|since|by|during|from)\s+(?:19\d{2}|20\d{2})\b|\bby\s+(?:202[5-9]|203\d)\b|\bprojected\s+to\s+reach\b",
    re.I,
)

# Regex for Comparative Claims
COMPARATIVE_REGEX = re.compile(
    r"\b(?:\d+x\s+faster|\d+%\s+more\s+efficient|outperformed?|outpaces?|compared\s+to|twice\s+as\s+fast|half\s+the\s+time|significantly\s+higher\s+than|exceeds?\s+[A-Za-z0-9]+)\b",
    re.I,
)

# Regex for Superlative & Strong Subjective Claims
SUPERLATIVE_REGEX = re.compile(
    r"\b(?:the\s+best|unrivaled|unmatched|world[- ]class|industry[- ]leading|#1\s+choice|revolutionary|guaranteed\s+perfection|flawless|unbeatable)\b",
    re.I,
)

# Regex for Technical / Scientific Mechanism Assertions
TECHNICAL_ASSERTION_REGEX = re.compile(
    r"\b(?:demonstrates?\s+(?:a\s+)?significant|causes?\s+a\s+reduction|inhibits?|stimulates?|increases?\s+cellular|achieves?\s+(?:gate\s+fidelity|coherence|efficiency))\b",
    re.I,
)

# Regex to split text into distinct sentences
SENTENCE_SPLIT_REGEX = re.compile(r"(?<=[.!?])\s+(?=[A-Z0-9])")


class ClaimSupportResult(BaseModel):
    """
    Structured result produced by the Claim-Support Engine.
    Contains detected support-needed claims, source associations, and explainable findings.
    """
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    page_id: int | None = Field(default=None, description="Page ID if analyzed from database")
    url: str | None = Field(default=None, description="URL of the analyzed page")
    total_claims_detected: int = Field(default=0, description="Total potentially support-needed claims detected")
    supported_claims_count: int = Field(default=0, description="Count of claims associated with external sources")
    unsupported_claims_count: int = Field(default=0, description="Count of claims lacking external source association")
    claims: list[SupportNeededClaimContract] = Field(default_factory=list, description="All detected support-needed claim contracts")
    source_associations: list[SourceAssociationContract] = Field(default_factory=list, description="Traceable claim-to-source relationships")
    claims_by_type: dict[str, int] = Field(default_factory=dict, description="Distribution of claims across claim types")
    findings: list[FindingCreate] = Field(default_factory=list, description="Actionable findings generated from unbacked claims")
    recommendations: list[RecommendationCreate] = Field(default_factory=list, description="Actionable recommendations for findings")
    metadata: dict[str, Any] = Field(default_factory=dict, description="Analysis execution metadata")


class ClaimSupportEngine:
    """
    Deterministic Claim-Support Engine (Step 6).
    Extracts potentially support-needed claims from text content and establishes
    traceable associations with candidate external sources without fact-checking veracity.
    """

    def analyze(
        self,
        page_url: str | None = None,
        text_content: str | None = None,
        headings: list[Any] | None = None,
        links: list[Any] | None = None,
        external_sources: list[Any] | None = None,
        quality_evidence: Any | None = None,
        page_id: int | None = None,
    ) -> ClaimSupportResult:
        """
        Main deterministic routine for Claim-Support Detection and Association.
        """
        result = ClaimSupportResult(
            page_id=page_id,
            url=page_url,
            metadata={
                "engine": "ClaimSupportEngine",
                "version": "1.0.0",
                "analyzed_at": datetime.now(timezone.utc).isoformat(),
            },
        )

        clean_text = (text_content or "").strip()
        if not clean_text:
            return result

        safe_sources = self._normalize_sources(external_sources or links)
        safe_headings = self._normalize_headings(headings)

        # 1. Segment Text and Detect Claims
        detected_claims = self._detect_claims(clean_text, safe_headings, quality_evidence)

        # 2. Associate Claims with External Sources
        supported_count = 0
        unsupported_count = 0
        type_counts: dict[str, int] = {}
        all_associations: list[SourceAssociationContract] = []

        for idx, claim in enumerate(detected_claims):
            ctype = claim.claim_type
            type_counts[ctype] = type_counts.get(ctype, 0) + 1

            assoc = self._find_source_association(claim, safe_sources, clean_text, idx)
            if assoc:
                claim.has_associated_source = True
                claim.associated_source_urls = [assoc.source_url]
                all_associations.append(assoc)
                supported_count += 1
            else:
                claim.has_associated_source = False
                claim.associated_source_urls = []
                unsupported_count += 1

        result.claims = detected_claims
        result.source_associations = all_associations
        result.total_claims_detected = len(detected_claims)
        result.supported_claims_count = supported_count
        result.unsupported_claims_count = unsupported_count
        result.claims_by_type = type_counts

        # 3. Generate Explainable Findings & Recommendations
        self._generate_findings_and_recommendations(result, page_id=page_id)

        return result

    def analyze_extraction(
        self,
        extraction: Any,
        external_source_result: Any | None = None,
        quality_evidence: Any | None = None,
        page_url: str | None = None,
        page_id: int | None = None,
    ) -> ClaimSupportResult:
        """
        Convenience method to analyze an existing ExtractionResult object from Task 4.
        """
        sources = None
        if external_source_result:
            sources = getattr(external_source_result, "sources", None)
        elif hasattr(extraction, "links"):
            sources = getattr(extraction, "links", None)

        return self.analyze(
            page_url=page_url or getattr(extraction, "url", None),
            text_content=getattr(extraction, "clean_text", None),
            headings=getattr(extraction, "headings", None),
            links=getattr(extraction, "links", None),
            external_sources=sources,
            quality_evidence=quality_evidence,
            page_id=page_id,
        )

    # -------------------------------------------------------------------------
    # Claim Detection Subroutines
    # -------------------------------------------------------------------------

    def _detect_claims(
        self,
        text_content: str,
        headings: list[dict[str, Any]],
        quality_evidence: Any | None,
    ) -> list[SupportNeededClaimContract]:
        claims: list[SupportNeededClaimContract] = []
        seen_texts: set[str] = set()

        sentences = SENTENCE_SPLIT_REGEX.split(text_content)
        claim_counter = 1

        for sent in sentences:
            sent_clean = sent.strip()
            if len(sent_clean) < 15 or sent_clean in seen_texts:
                continue

            claim_info = self._classify_claim_sentence(sent_clean)
            if claim_info:
                claim_type, reason, confidence, ev = claim_info
                claim_id = f"claim_{claim_type[:4]}_{claim_counter:03d}"
                claim_counter += 1

                location = self._locate_sentence_heading(sent_clean, text_content, headings)

                claim_obj = SupportNeededClaimContract(
                    claim_id=claim_id,
                    claim_text=sent_clean,
                    claim_type=claim_type,
                    location=location,
                    reason=reason,
                    confidence=confidence,
                    evidence=ev,
                )
                claims.append(claim_obj)
                seen_texts.add(sent_clean)

        return claims

    def _classify_claim_sentence(self, sentence: str) -> tuple[str, str, ConfidenceLevel, dict[str, Any]] | None:
        """
        Deterministically evaluates if a sentence represents a potentially support-needed claim.
        """
        # 1. Statistical & Quantitative Claim
        stat_matches = STATISTICAL_REGEX.findall(sentence)
        if stat_matches:
            return (
                "statistical",
                f"Contains specific quantitative metric or percentage assertion ({', '.join(stat_matches[:3])}).",
                ConfidenceLevel.HIGH,
                {"metrics_found": stat_matches},
            )

        # 2. Comparative Claim
        comp_matches = COMPARATIVE_REGEX.findall(sentence)
        if comp_matches:
            return (
                "comparative",
                f"Asserts comparative performance or relative benchmark ({', '.join(comp_matches[:2])}).",
                ConfidenceLevel.HIGH,
                {"comparisons_found": comp_matches},
            )

        # 3. Superlative Claim
        super_matches = SUPERLATIVE_REGEX.findall(sentence)
        if super_matches:
            return (
                "superlative",
                f"Presents strong superlative assertion ({', '.join(super_matches[:2])}) that benefits from third-party verification.",
                ConfidenceLevel.MEDIUM,
                {"superlatives_found": super_matches},
            )

        # 4. Technical / Scientific Mechanism Claim
        tech_matches = TECHNICAL_ASSERTION_REGEX.findall(sentence)
        if tech_matches:
            return (
                "technical_assertion",
                f"Asserts specific technical or scientific causal mechanism ({', '.join(tech_matches[:2])}).",
                ConfidenceLevel.MEDIUM,
                {"mechanisms_found": tech_matches},
            )

        # 5. Temporal / Time-Sensitive Claim
        temp_matches = TEMPORAL_REGEX.findall(sentence)
        if temp_matches:
            return (
                "time_sensitive",
                f"Contains temporal data or future projection ({', '.join(temp_matches[:2])}).",
                ConfidenceLevel.MEDIUM,
                {"temporal_cues": temp_matches},
            )

        return None

    def _find_source_association(
        self,
        claim: SupportNeededClaimContract,
        sources: list[dict[str, Any]],
        text_content: str,
        index: int,
    ) -> SourceAssociationContract | None:
        """
        Attempts to associate a claim with an external source based on proximity or direct anchor matching.
        """
        if not sources:
            return None

        claim_text = claim.claim_text
        claim_pos = text_content.find(claim_text)

        # 1. Direct Anchor Match inside claim sentence
        for src in sources:
            anchor = (src.get("anchor_text") or "").strip()
            dest_url = src.get("url") or src.get("destination_url") or ""
            if not dest_url:
                continue

            if anchor and len(anchor) > 3 and anchor in claim_text:
                return SourceAssociationContract(
                    association_id=f"assoc_{index:03d}",
                    claim_id=claim.claim_id,
                    claim_text=claim.claim_text,
                    content_region=claim.location,
                    source_url=dest_url,
                    source_domain=src.get("domain") or urlparse(dest_url).netloc,
                    association_type="direct_link",
                    confidence=ConfidenceLevel.HIGH,
                    explanation=f"The claim sentence directly contains anchor text '{anchor}' linking to external source.",
                    context_text=claim.claim_text,
                    evidence={"anchor_text": anchor, "matched_in_sentence": True},
                )

        # 2. Nearby Context Match (+/- 300 characters in text)
        if claim_pos != -1:
            window_start = max(0, claim_pos - 150)
            window_end = min(len(text_content), claim_pos + len(claim_text) + 250)
            nearby_window = text_content[window_start:window_end]

            for src in sources:
                anchor = (src.get("anchor_text") or "").strip()
                dest_url = src.get("url") or src.get("destination_url") or ""
                if not dest_url:
                    continue

                if anchor and len(anchor) > 3 and anchor in nearby_window:
                    return SourceAssociationContract(
                        association_id=f"assoc_{index:03d}",
                        claim_id=claim.claim_id,
                        claim_text=claim.claim_text,
                        content_region=claim.location,
                        source_url=dest_url,
                        source_domain=src.get("domain") or urlparse(dest_url).netloc,
                        association_type="same_section_attribution",
                        confidence=ConfidenceLevel.HIGH if src.get("is_citation_candidate") else ConfidenceLevel.MEDIUM,
                        explanation="Supporting external reference link located in immediate vicinity of claim.",
                        context_text=nearby_window.strip(),
                        evidence={"anchor_text": anchor, "proximity_window": True},
                    )

        # 3. If there is a single citation candidate on page and claim is statistical
        citation_candidates = [s for s in sources if s.get("is_citation_candidate")]
        if len(citation_candidates) == 1 and claim.claim_type == "statistical":
            cand = citation_candidates[0]
            cand_url = cand.get("url") or cand.get("destination_url") or ""
            return SourceAssociationContract(
                association_id=f"assoc_{index:03d}",
                claim_id=claim.claim_id,
                claim_text=claim.claim_text,
                content_region=claim.location,
                source_url=cand_url,
                source_domain=cand.get("domain") or urlparse(cand_url).netloc,
                association_type="in_text_link",
                confidence=ConfidenceLevel.MEDIUM,
                explanation="Page provides a primary reference link that corroborates quantitative trial metrics.",
                context_text=claim.claim_text,
                evidence={"single_citation_candidate": True},
            )

        return None

    def _locate_sentence_heading(
        self,
        sentence: str,
        full_text: str,
        headings: list[dict[str, Any]],
    ) -> str | None:
        """
        Determines the preceding heading for a claim sentence.
        """
        if not headings:
            return None

        # Return most relevant heading if present
        pos = full_text.find(sentence)
        if pos != -1:
            for h in reversed(headings):
                htext = h.get("text", "")
                hpos = full_text.find(htext)
                if hpos != -1 and hpos < pos:
                    return f"Section: {htext}"

        return f"Section: {headings[0].get('text')}" if headings else None

    def _generate_findings_and_recommendations(
        self,
        result: ClaimSupportResult,
        page_id: int | None,
    ) -> None:
        """
        Generates actionable findings and recommendations for unbacked claims.
        """
        unbacked_stats = [c for c in result.claims if c.claim_type == "statistical" and not c.has_associated_source]
        if len(unbacked_stats) >= 1:
            result.findings.append(
                FindingCreate(
                    page_id=page_id,
                    finding_type="unsupported_statistical_claim",
                    category="authority",
                    title=f"Detected {len(unbacked_stats)} Unreferenced Statistical Claim(s)",
                    description="High-impact empirical percentages or exact metrics are presented without verifiable source citations.",
                    severity="medium",
                    status="open",
                    evidence={"claims_sample": [c.claim_text for c in unbacked_stats[:3]]},
                )
            )
            result.recommendations.append(
                RecommendationCreate(
                    title="Add Verifiable Source Citations for Quantitative Claims",
                    description="Attach direct reference links or DOI citations to specific statistical data points.",
                    priority="medium",
                    status="open",
                    action_type="add_source_citations",
                )
            )

        unbacked_superlatives = [c for c in result.claims if c.claim_type == "superlative" and not c.has_associated_source]
        if len(unbacked_superlatives) >= 1:
            result.findings.append(
                FindingCreate(
                    page_id=page_id,
                    finding_type="unsupported_superlative_claim",
                    category="authority",
                    title=f"Detected {len(unbacked_superlatives)} Unbacked Superlative Assertion(s)",
                    description="Strong subjective assertions ('the best', 'unrivaled') lack third-party comparative study citations.",
                    severity="low",
                    status="open",
                    evidence={"claims_sample": [c.claim_text for c in unbacked_superlatives[:3]]},
                )
            )
            result.recommendations.append(
                RecommendationCreate(
                    title="Provide Third-Party Verification or Tone Down Superlatives",
                    description="Cite an independent benchmark study or adjust promotional language to objective phrasing.",
                    priority="low",
                    status="open",
                    action_type="tone_down_superlatives",
                )
            )

    # -------------------------------------------------------------------------
    # Normalization Helpers
    # -------------------------------------------------------------------------

    def _normalize_sources(self, sources: list[Any] | None) -> list[dict[str, Any]]:
        if not sources:
            return []
        normalized: list[dict[str, Any]] = []
        for s in sources:
            if isinstance(s, dict):
                normalized.append(s)
            else:
                normalized.append({
                    "url": getattr(s, "url", None) or getattr(s, "destination_url", None),
                    "destination_url": getattr(s, "destination_url", None) or getattr(s, "url", None),
                    "domain": getattr(s, "domain", None),
                    "anchor_text": getattr(s, "anchor_text", None),
                    "is_citation_candidate": getattr(s, "is_citation_candidate", False),
                    "link_type": getattr(s, "link_type", "external"),
                    "position": getattr(s, "position", 0),
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


def analyze_claim_support(
    page_url: str | None = None,
    text_content: str | None = None,
    headings: list[Any] | None = None,
    links: list[Any] | None = None,
    external_sources: list[Any] | None = None,
    quality_evidence: Any | None = None,
    page_id: int | None = None,
) -> ClaimSupportResult:
    """
    Convenience function for ClaimSupportEngine.
    """
    engine = ClaimSupportEngine()
    return engine.analyze(
        page_url=page_url,
        text_content=text_content,
        headings=headings,
        links=links,
        external_sources=external_sources,
        quality_evidence=quality_evidence,
        page_id=page_id,
    )
