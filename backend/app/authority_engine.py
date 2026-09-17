"""
Authority Signal Engine (Day 8 - Phase B - Step 4 ONLY)

Detects and structures deterministic, evidence-based authority signals from page extraction,
content structure, and semantic intelligence data covering:
1. Topical Depth & Substantive Coverage
2. Related / Supporting Internal Content Architecture
3. Subject & Topic Focus Alignment
4. Specialized Domain Expertise & Technical Frameworks
5. Attributed Author Credentials & Professional Qualifications
6. Expert Reviewer & Editorial Attributions
7. Structured Schema Authority Validation

Core architectural principle:
EVIDENCE != CONCLUSION
This engine reports observed structural authority signals and their traceable evidence.
It does NOT claim search-engine ranking authority, AI citation guarantees, or factual veracity.
"""

from datetime import datetime, timezone
import re
from typing import Any
from urllib.parse import urlparse

from pydantic import BaseModel, ConfigDict, Field

from .authority_citation_schemas import (
    AuthoritySignalContract,
    ConfidenceLevel,
    SeverityLevel,
)
from .schemas import FindingCreate, RecommendationCreate


# Regex Patterns for Specialized Technical & Research Frameworks
METHODOLOGY_TERMS_REGEX = re.compile(
    r"\b(methodology|experimental setup|clinical trial|cohort study|benchmarking|protocol|architecture|empirical analysis|system design|data collection|statistical analysis|mechanisms?|implementation details|reproducibility)\b",
    re.I,
)

# Academic & Professional Degrees/Credentials in Author/Text
AUTHORITY_CREDENTIALS_REGEX = re.compile(
    r"\b(Ph\.?D\.?|M\.?D\.?|D\.?O\.?|Pharm\.?D\.?|M\.?S\.?|M\.?Sc\.?|MSc|MBA|B\.?S\.?|B\.?Sc\.?|BSc|B\.?A\.?|Esq\.?|CPA|P\.?E\.?)\b"
)
AUTHORITY_TITLES_REGEX = re.compile(
    r"\b(Dr\.?|Doctor|Prof\.?|Professor|Chief Medical Officer|CMO|CTO|CEO|CFO|Director|Lead Researcher|Senior Scientist|Principal Engineer|Senior Architect|Lead Scientist)\b",
    re.I,
)

# Expert Reviewer Attribution Pattern
EXPERT_REVIEW_REGEX = re.compile(
    r"\b(medically reviewed by|reviewed by|fact[- ]checked by|technically reviewed by|peer[- ]reviewed by|verified by)\s+((?:Dr\.?|Prof\.?\s+)?(?:[A-Z][a-zA-Z.'-]+\s*){1,4})\b",
    re.I,
)

# Scholarly / Authoritative Schema Types
AUTHORITATIVE_SCHEMA_TYPES = {
    "scholarlyarticle",
    "medicalscholarlyarticle",
    "medicalwebpage",
    "techarticle",
    "report",
    "newsarticle",
    "analysisnewsarticle",
    "researcharticle",
}


class AuthoritySignalResult(BaseModel):
    """
    Structured result produced by the Authority Signal Engine.
    Contains categorized authority signals, statistics, and explainable findings.
    """
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    page_id: int | None = Field(default=None, description="Page ID if analyzed from persistence")
    url: str | None = Field(default=None, description="URL of the analyzed page")
    total_signals: int = Field(default=0, description="Total authority signals evaluated")
    detected_signals_count: int = Field(default=0, description="Count of detected or verified authority signals")
    weak_signals_count: int = Field(default=0, description="Count of weak or partial authority signals")
    missing_signals_count: int = Field(default=0, description="Count of missing authority signals")
    authority_signals: list[AuthoritySignalContract] = Field(default_factory=list, description="All evaluated authority signal contracts")
    topical_depth_signals: list[AuthoritySignalContract] = Field(default_factory=list, description="Topical depth & substance signals")
    supporting_pages_signals: list[AuthoritySignalContract] = Field(default_factory=list, description="Related internal pages and cluster signals")
    topic_focus_signals: list[AuthoritySignalContract] = Field(default_factory=list, description="Subject focus & alignment signals")
    domain_expertise_signals: list[AuthoritySignalContract] = Field(default_factory=list, description="Technical methodology & expertise signals")
    author_credentials_signals: list[AuthoritySignalContract] = Field(default_factory=list, description="Attributed author credential signals")
    expert_attribution_signals: list[AuthoritySignalContract] = Field(default_factory=list, description="Expert reviewer and editorial signals")
    schema_authority_signals: list[AuthoritySignalContract] = Field(default_factory=list, description="Structured scholarly/content schema signals")
    findings: list[FindingCreate] = Field(default_factory=list, description="Actionable findings generated from authority deficiencies")
    recommendations: list[RecommendationCreate] = Field(default_factory=list, description="Actionable recommendations for findings")
    metadata: dict[str, Any] = Field(default_factory=dict, description="Analysis execution metadata")


class AuthoritySignalEngine:
    """
    Deterministic Authority Signal Engine (Step 4).
    Analyzes page content, headings, structured data, links, and semantic metadata
    to detect verifiable indicators of domain authority and topical expertise.
    """

    def analyze(
        self,
        page_url: str | None = None,
        text_content: str | None = None,
        title: str | None = None,
        headings: list[Any] | None = None,
        links: list[Any] | None = None,
        structured_data_blocks: list[Any] | None = None,
        topic_evidence: Any | None = None,
        semantic_coverage_evidence: Any | None = None,
        quality_evidence: Any | None = None,
        page_id: int | None = None,
    ) -> AuthoritySignalResult:
        """
        Main deterministic analysis routine for Authority Signals.
        """
        result = AuthoritySignalResult(
            page_id=page_id,
            url=page_url,
            metadata={
                "engine": "AuthoritySignalEngine",
                "version": "1.0.0",
                "analyzed_at": datetime.now(timezone.utc).isoformat(),
            },
        )

        clean_text = (text_content or "").strip()
        safe_links = self._normalize_links(links)
        safe_headings = self._normalize_headings(headings)
        safe_json_ld = self._normalize_json_ld(structured_data_blocks)

        # 1. Topical Depth
        depth_sigs = self._detect_topical_depth(
            text_content=clean_text,
            headings=safe_headings,
            semantic_coverage_evidence=semantic_coverage_evidence,
        )
        result.topical_depth_signals.extend(depth_sigs)

        # 2. Supporting & Related Pages
        supporting_sigs = self._detect_supporting_pages(
            page_url=page_url,
            links=safe_links,
            headings=safe_headings,
        )
        result.supporting_pages_signals.extend(supporting_sigs)

        # 3. Subject / Topic Focus
        focus_sigs = self._detect_topic_focus(
            title=title,
            headings=safe_headings,
            text_content=clean_text,
            topic_evidence=topic_evidence,
        )
        result.topic_focus_signals.extend(focus_sigs)

        # 4. Domain Expertise & Technical Frameworks
        expertise_sigs = self._detect_domain_expertise(
            text_content=clean_text,
            headings=safe_headings,
            quality_evidence=quality_evidence,
        )
        result.domain_expertise_signals.extend(expertise_sigs)

        # 5. Attributed Author Credentials
        author_cred_sigs = self._detect_author_credentials(
            text_content=clean_text,
            json_ld_blocks=safe_json_ld,
        )
        result.author_credentials_signals.extend(author_cred_sigs)

        # 6. Expert Reviewer & Editorial Oversight
        expert_sigs = self._detect_expert_attribution(
            text_content=clean_text,
            json_ld_blocks=safe_json_ld,
        )
        result.expert_attribution_signals.extend(expert_sigs)

        # 7. Schema Authority Validation
        schema_sigs = self._detect_schema_authority(
            json_ld_blocks=safe_json_ld,
        )
        result.schema_authority_signals.extend(schema_sigs)

        # Aggregate All Signals
        all_signals = (
            depth_sigs
            + supporting_sigs
            + focus_sigs
            + expertise_sigs
            + author_cred_sigs
            + expert_sigs
            + schema_sigs
        )
        result.authority_signals = all_signals
        result.total_signals = len(all_signals)
        result.detected_signals_count = sum(1 for s in all_signals if s.status in ("detected", "verified"))
        result.weak_signals_count = sum(1 for s in all_signals if s.status == "weak")
        result.missing_signals_count = sum(1 for s in all_signals if s.status == "missing")

        # Generate Explainable Findings & Recommendations
        self._generate_findings_and_recommendations(result, page_id=page_id)

        return result

    def analyze_extraction(
        self,
        extraction: Any,
        page_url: str | None = None,
        page_id: int | None = None,
        topic_evidence: Any | None = None,
        semantic_coverage_evidence: Any | None = None,
        quality_evidence: Any | None = None,
    ) -> AuthoritySignalResult:
        """
        Convenience method to analyze an existing ExtractionResult object from Task 4.
        """
        return self.analyze(
            page_url=page_url or getattr(extraction, "url", None),
            text_content=getattr(extraction, "clean_text", None),
            title=getattr(extraction, "title_text", None),
            headings=getattr(extraction, "headings", None),
            links=getattr(extraction, "links", None),
            structured_data_blocks=getattr(extraction, "structured_data", None),
            topic_evidence=topic_evidence,
            semantic_coverage_evidence=semantic_coverage_evidence,
            quality_evidence=quality_evidence,
            page_id=page_id,
        )

    # -------------------------------------------------------------------------
    # Detection Subroutines
    # -------------------------------------------------------------------------

    def _detect_topical_depth(
        self,
        text_content: str,
        headings: list[dict[str, Any]],
        semantic_coverage_evidence: Any | None,
    ) -> list[AuthoritySignalContract]:
        signals: list[AuthoritySignalContract] = []

        words = text_content.split()
        word_count = len(words)

        h2_count = sum(1 for h in headings if h.get("level") == 2)
        h3_count = sum(1 for h in headings if h.get("level") == 3)
        total_subheadings = h2_count + h3_count

        if word_count >= 1000 and total_subheadings >= 4:
            status = "verified"
            depth_level = "comprehensive"
            confidence = ConfidenceLevel.HIGH
            desc = f"Content exhibits comprehensive topical depth ({word_count} words across {total_subheadings} subheadings)."
        elif (word_count >= 400 and total_subheadings >= 2) or (word_count >= 100 and total_subheadings >= 4):
            status = "detected"
            depth_level = "moderate"
            confidence = ConfidenceLevel.HIGH
            desc = f"Content provides structured topical coverage ({word_count} words with {total_subheadings} subheadings)."
        elif word_count >= 150 or total_subheadings >= 2:
            status = "weak"
            depth_level = "shallow"
            confidence = ConfidenceLevel.MEDIUM
            desc = f"Content is relatively shallow ({word_count} words, {total_subheadings} subheadings)."
        else:
            status = "missing"
            depth_level = "thin"
            confidence = ConfidenceLevel.HIGH
            desc = "Page content is thin or insufficient for authoritative topical evaluation."

        evidence = {
            "word_count": word_count,
            "h2_count": h2_count,
            "h3_count": h3_count,
            "total_subheadings": total_subheadings,
            "depth_level": depth_level,
        }
        if semantic_coverage_evidence:
            evidence["breadth_level"] = getattr(semantic_coverage_evidence, "breadth_level", None)
            evidence["semantic_coverage_score"] = getattr(semantic_coverage_evidence, "semantic_coverage_score", None)

        signals.append(
            AuthoritySignalContract(
                signal_id="authority_topical_depth",
                category="authority",
                title="Substantive Topical Depth and Structure",
                status=status,
                value={"word_count": word_count, "depth_level": depth_level},
                confidence=confidence,
                description=desc,
                evidence=evidence,
            )
        )

        return signals

    def _detect_supporting_pages(
        self,
        page_url: str | None,
        links: list[dict[str, Any]],
        headings: list[dict[str, Any]],
    ) -> list[AuthoritySignalContract]:
        signals: list[AuthoritySignalContract] = []

        base_domain = urlparse(page_url).netloc if page_url else ""
        internal_topical_links: list[dict[str, Any]] = []

        for link in links:
            dest = link.get("destination_url") or ""
            anchor = (link.get("anchor_text") or "").strip()
            link_type = link.get("link_type", "internal")

            # Check if internal link with meaningful non-navigational anchor text
            is_internal = (link_type == "internal") or (base_domain and base_domain in dest)
            if is_internal and len(anchor.split()) >= 2:
                if not any(nav in anchor.lower() for nav in ("home", "about us", "contact", "privacy", "terms", "menu", "sign in", "login")):
                    internal_topical_links.append({"url": dest, "anchor_text": anchor})

        count = len(internal_topical_links)
        if count >= 3:
            status = "detected"
            confidence = ConfidenceLevel.HIGH
            desc = f"Identified {count} internal supporting links connecting this page to broader topic clusters."
        elif count >= 1:
            status = "weak"
            confidence = ConfidenceLevel.MEDIUM
            desc = f"Limited internal supporting architecture ({count} contextual topic link)."
        else:
            status = "missing"
            confidence = ConfidenceLevel.MEDIUM
            desc = "Page lacks internal contextual links to related guides or cluster articles."

        signals.append(
            AuthoritySignalContract(
                signal_id="authority_supporting_pages",
                category="authority",
                title="Internal Supporting Content and Topic Cluster Links",
                status=status,
                value={"internal_topical_links_count": count},
                confidence=confidence,
                description=desc,
                evidence={"links_count": count, "sample_links": internal_topical_links[:5]},
            )
        )

        return signals

    def _detect_topic_focus(
        self,
        title: str | None,
        headings: list[dict[str, Any]],
        text_content: str,
        topic_evidence: Any | None,
    ) -> list[AuthoritySignalContract]:
        signals: list[AuthoritySignalContract] = []

        h1_text = next((h.get("text", "") for h in headings if h.get("level") == 1), "")
        title_text = title or ""

        # Extract title/h1 tokens
        title_tokens = set(re.findall(r"\b[a-zA-Z]{3,}\b", title_text.lower()))
        h1_tokens = set(re.findall(r"\b[a-zA-Z]{3,}\b", h1_text.lower()))

        overlap = title_tokens & h1_tokens
        is_aligned = bool(overlap or (title_text and not h1_text))

        primary_topic = None
        if topic_evidence:
            primary_topic = getattr(topic_evidence, "primary_topic", None)

        if is_aligned and (title_text or h1_text):
            status = "verified" if overlap else "detected"
            confidence = ConfidenceLevel.HIGH
            desc = "Title tag and primary heading (H1) are strongly aligned on the core subject."
        else:
            status = "weak"
            confidence = ConfidenceLevel.MEDIUM
            desc = "Title tag and heading structure show semantic divergence or missing H1."

        signals.append(
            AuthoritySignalContract(
                signal_id="authority_topic_focus",
                category="authority",
                title="Subject and Topic Focus Alignment",
                status=status,
                value={"is_aligned": is_aligned, "primary_topic": primary_topic},
                confidence=confidence,
                description=desc,
                evidence={
                    "title": title_text,
                    "h1": h1_text,
                    "overlap_tokens": list(overlap)[:5],
                    "primary_topic": primary_topic,
                },
            )
        )

        return signals

    def _detect_domain_expertise(
        self,
        text_content: str,
        headings: list[dict[str, Any]],
        quality_evidence: Any | None,
    ) -> list[AuthoritySignalContract]:
        signals: list[AuthoritySignalContract] = []

        matched_methodology_terms: list[str] = []
        if text_content:
            found = METHODOLOGY_TERMS_REGEX.findall(text_content)
            matched_methodology_terms = list(set(m.lower() for m in found))

        data_points_count = 0
        if quality_evidence:
            data_points_count = getattr(quality_evidence, "data_points_count", 0)

        has_framework = len(matched_methodology_terms) >= 2 or (len(matched_methodology_terms) >= 1 and data_points_count >= 2)

        if has_framework:
            status = "detected"
            confidence = ConfidenceLevel.HIGH
            desc = f"Content utilizes specialized domain/methodology frameworks ({', '.join(matched_methodology_terms[:3])}) and quantitative precision."
        elif len(matched_methodology_terms) >= 1:
            status = "weak"
            confidence = ConfidenceLevel.MEDIUM
            desc = "Content includes basic technical terms without deep methodology framing."
        else:
            status = "missing"
            confidence = ConfidenceLevel.MEDIUM
            desc = "Content lacks explicit technical, methodology, or scientific framework terminology."

        signals.append(
            AuthoritySignalContract(
                signal_id="authority_domain_expertise",
                category="authority",
                title="Domain Expertise and Methodology Framework",
                status=status,
                value={
                    "methodology_terms_count": len(matched_methodology_terms),
                    "data_points_count": data_points_count,
                },
                confidence=confidence,
                description=desc,
                evidence={
                    "methodology_terms": matched_methodology_terms[:5],
                    "data_points_count": data_points_count,
                },
            )
        )

        return signals

    def _detect_author_credentials(
        self,
        text_content: str,
        json_ld_blocks: list[dict[str, Any]],
    ) -> list[AuthoritySignalContract]:
        signals: list[AuthoritySignalContract] = []

        author_name = None
        credentials: list[str] = []
        titles: list[str] = []
        profile_url = None

        # 1. JSON-LD author analysis
        for block in json_ld_blocks:
            parsed = block.get("parsed_json")
            if isinstance(parsed, dict) and "author" in parsed:
                auth = parsed["author"]
                if isinstance(auth, dict):
                    author_name = auth.get("name")
                    jt = auth.get("jobTitle")
                    if jt and jt not in titles:
                        titles.append(jt)
                    profile_url = auth.get("url") or auth.get("sameAs")

                    aname = auth.get("name", "")
                    for cred in AUTHORITY_CREDENTIALS_REGEX.findall(aname):
                        if cred not in credentials:
                            credentials.append(cred)
                    for t in AUTHORITY_TITLES_REGEX.findall(aname):
                        if t not in titles:
                            titles.append(t)

        # 2. Text fallback for credentials and titles
        if text_content:
            for cred in AUTHORITY_CREDENTIALS_REGEX.findall(text_content[:2000]):
                if cred not in credentials:
                    credentials.append(cred)
            for t in AUTHORITY_TITLES_REGEX.findall(text_content[:2000]):
                if t not in titles:
                    titles.append(t)

        has_creds = bool(credentials or titles)
        if has_creds:
            status = "verified" if author_name and profile_url else "detected"
            confidence = ConfidenceLevel.HIGH
            desc = f"Attributed author '{author_name or 'Contributor'}' holds verifiable qualifications ({', '.join(credentials[:2] + titles[:2])})."
        else:
            status = "missing"
            confidence = ConfidenceLevel.MEDIUM
            desc = "Content is not explicitly attributed to an author with declared professional or academic credentials."

        signals.append(
            AuthoritySignalContract(
                signal_id="authority_author_credentials",
                category="authority",
                title="Attributed Author Qualifications and Credentials",
                status=status,
                value={
                    "author_name": author_name,
                    "credentials": credentials,
                    "titles": titles,
                    "profile_url": profile_url,
                },
                confidence=confidence,
                description=desc,
                evidence={
                    "author_name": author_name,
                    "credentials": credentials,
                    "titles": titles,
                    "profile_url": profile_url,
                },
            )
        )

        return signals

    def _detect_expert_attribution(
        self,
        text_content: str,
        json_ld_blocks: list[dict[str, Any]],
    ) -> list[AuthoritySignalContract]:
        signals: list[AuthoritySignalContract] = []

        reviewer_name = None
        review_phrase = None

        if text_content:
            m = EXPERT_REVIEW_REGEX.search(text_content)
            if m:
                review_phrase = m.group(1).strip()
                reviewer_name = m.group(2).strip()

        if reviewer_name:
            status = "detected"
            confidence = ConfidenceLevel.HIGH
            desc = f"Content carries explicit expert review oversight ({review_phrase}) by '{reviewer_name}'."
        else:
            status = "missing"
            confidence = ConfidenceLevel.LOW
            desc = "No formal expert review or independent verification oversight was declared."

        signals.append(
            AuthoritySignalContract(
                signal_id="authority_expert_attribution",
                category="authority",
                title="Formal Expert Review and Editorial Oversight",
                status=status,
                value={"reviewer_name": reviewer_name, "review_phrase": review_phrase},
                confidence=confidence,
                description=desc,
                evidence={"reviewer_name": reviewer_name, "review_phrase": review_phrase},
            )
        )

        return signals

    def _detect_schema_authority(
        self,
        json_ld_blocks: list[dict[str, Any]],
    ) -> list[AuthoritySignalContract]:
        signals: list[AuthoritySignalContract] = []

        matched_scholarly_types: list[str] = []
        has_publisher = False
        has_author = False

        for block in json_ld_blocks:
            parsed = block.get("parsed_json")
            if isinstance(parsed, dict):
                stype = str(parsed.get("@type", "")).lower()
                if stype in AUTHORITATIVE_SCHEMA_TYPES:
                    matched_scholarly_types.append(parsed.get("@type"))
                if "publisher" in parsed:
                    has_publisher = True
                if "author" in parsed:
                    has_author = True

        if matched_scholarly_types:
            status = "verified" if has_publisher and has_author else "detected"
            confidence = ConfidenceLevel.HIGH
            desc = f"Page declares authoritative structured schema ({', '.join(matched_scholarly_types)})."
        else:
            status = "missing"
            confidence = ConfidenceLevel.MEDIUM
            desc = "Page does not implement formal scholarly, medical, or technical article schema types."

        signals.append(
            AuthoritySignalContract(
                signal_id="authority_schema_validation",
                category="authority",
                title="Authoritative Content Schema Implementation",
                status=status,
                value={
                    "schema_types": matched_scholarly_types,
                    "has_publisher": has_publisher,
                    "has_author": has_author,
                },
                confidence=confidence,
                description=desc,
                evidence={
                    "matched_types": matched_scholarly_types,
                    "has_publisher": has_publisher,
                    "has_author": has_author,
                },
            )
        )

        return signals

    def _generate_findings_and_recommendations(
        self,
        result: AuthoritySignalResult,
        page_id: int | None,
    ) -> None:
        """
        Generates actionable findings and recommendations for authority deficiencies.
        """
        # 1. Missing Topical Depth
        depth_sig = next((s for s in result.topical_depth_signals if s.signal_id == "authority_topical_depth"), None)
        if depth_sig and depth_sig.status in ("weak", "missing"):
            result.findings.append(
                FindingCreate(
                    page_id=page_id,
                    finding_type="shallow_topical_depth",
                    category="authority",
                    title="Shallow Topical Depth and Subheading Structure",
                    description="The content lacks comprehensive length and structural subheadings required for authoritative topic coverage.",
                    severity="medium",
                    status="open",
                    evidence=depth_sig.evidence,
                )
            )
            result.recommendations.append(
                RecommendationCreate(
                    title="Expand Topical Substance and Structured Subsections",
                    description="Add comprehensive analytical subsections and detailed explanations to provide authoritative coverage.",
                    priority="medium",
                    status="open",
                    action_type="expand_topical_content",
                )
            )

        # 2. Missing Supporting Links
        support_sig = next((s for s in result.supporting_pages_signals if s.signal_id == "authority_supporting_pages"), None)
        if support_sig and support_sig.status == "missing":
            result.findings.append(
                FindingCreate(
                    page_id=page_id,
                    finding_type="lacks_internal_supporting_links",
                    category="authority",
                    title="No Internal Supporting Topic Links Detected",
                    description="Page is isolated from broader internal topic clusters and lacks contextual links to supporting guides.",
                    severity="low",
                    status="open",
                    evidence=support_sig.evidence,
                )
            )
            result.recommendations.append(
                RecommendationCreate(
                    title="Connect Page to Internal Topic Clusters",
                    description="Include contextual internal links to related topic guides, documentation, or case studies.",
                    priority="low",
                    status="open",
                    action_type="add_internal_links",
                )
            )

        # 3. Missing Author Credentials
        creds_sig = next((s for s in result.author_credentials_signals if s.signal_id == "authority_author_credentials"), None)
        if creds_sig and creds_sig.status == "missing":
            result.findings.append(
                FindingCreate(
                    page_id=page_id,
                    finding_type="missing_author_credentials",
                    category="authority",
                    title="Author Lacks Declared Qualifications or Credentials",
                    description="Content is published without explicit author qualifications, academic credentials, or professional designations.",
                    severity="low",
                    status="open",
                    evidence=creds_sig.evidence,
                )
            )
            result.recommendations.append(
                RecommendationCreate(
                    title="Highlight Author Credentials and Professional Background",
                    description="Add author qualifications, job title, and link to biographical profile to establish domain authority.",
                    priority="low",
                    status="open",
                    action_type="add_author_credentials",
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
                normalized.append(l)
            else:
                normalized.append({
                    "destination_url": getattr(l, "destination_url", None) or getattr(l, "url", None),
                    "anchor_text": getattr(l, "anchor_text", None) or getattr(l, "text", None),
                    "link_type": getattr(l, "link_type", "internal"),
                    "rel_raw": getattr(l, "rel_raw", None),
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

    def _normalize_json_ld(self, blocks: list[Any] | None) -> list[dict[str, Any]]:
        if not blocks:
            return []
        normalized: list[dict[str, Any]] = []
        for b in blocks:
            if isinstance(b, dict):
                normalized.append(b)
            else:
                normalized.append({
                    "parsed_json": getattr(b, "parsed_json", None),
                    "types": getattr(b, "types", None),
                    "entity_names": getattr(b, "entity_names", None),
                    "block_position": getattr(b, "block_position", 0),
                })
        return normalized


def analyze_authority_signals(
    page_url: str | None = None,
    text_content: str | None = None,
    title: str | None = None,
    headings: list[Any] | None = None,
    links: list[Any] | None = None,
    structured_data_blocks: list[Any] | None = None,
    topic_evidence: Any | None = None,
    semantic_coverage_evidence: Any | None = None,
    quality_evidence: Any | None = None,
    page_id: int | None = None,
) -> AuthoritySignalResult:
    """
    Convenience function for AuthoritySignalEngine.
    """
    engine = AuthoritySignalEngine()
    return engine.analyze(
        page_url=page_url,
        text_content=text_content,
        title=title,
        headings=headings,
        links=links,
        structured_data_blocks=structured_data_blocks,
        topic_evidence=topic_evidence,
        semantic_coverage_evidence=semantic_coverage_evidence,
        quality_evidence=quality_evidence,
        page_id=page_id,
    )
