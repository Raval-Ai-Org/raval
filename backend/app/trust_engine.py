"""
Trust Signal Engine (Day 8 - Phase B - Step 3 ONLY)

Detects and structures deterministic, evidence-based trust signals from page extraction
and content intelligence data covering:
1. Organization & Business Identity
2. About & Company Information
3. Contact Information & Observable Communication Channels
4. Author Information & Profile Linkage
5. Explicit Credentials, Qualifications, and Expert Reviewer Attributions
6. Business Identity Consistency Across Metadata, Schema, and Text
7. Policies, Disclosures, and Transparency Signals
8. Claim Context Relevant to Trust (Attribution Context)

Core architectural principle:
EVIDENCE != CONCLUSION
This engine reports observed structural signals and their traceable evidence.
It does NOT claim that a business or person is actually trustworthy in reality.
"""

from datetime import datetime, timezone
import re
from typing import Any
from urllib.parse import urlparse

from pydantic import BaseModel, ConfigDict, Field

from .authority_citation_schemas import (
    ConfidenceLevel,
    SeverityLevel,
    TrustSignalContract,
)
from .schemas import FindingCreate, RecommendationCreate


# Regex Patterns for Contact Information
EMAIL_REGEX = re.compile(
    r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b"
)
PHONE_REGEX = re.compile(
    r"(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b"
)
ADDRESS_INDICATOR_REGEX = re.compile(
    r"\b(?:Street|St\.?|Avenue|Ave\.?|Boulevard|Blvd\.?|Road|Rd\.?|Suite|Ste\.?|Floor|Building|Bldg\.?|Postal Code|Zip Code)\b",
    re.I,
)

# Regex Patterns for Author Bylines
BYLINE_REGEX = re.compile(
    r"\b(?:by|authored by|written by|author:)\s+((?:Dr\.?|Prof\.?\s+)?(?:[A-Z][a-zA-Z.'-]+\s*){1,4})\b",
    re.I,
)

# Regex Patterns for Academic & Professional Credentials
CREDENTIALS_REGEX = re.compile(
    r"\b(Ph\.?D\.?|M\.?D\.?|D\.?O\.?|Pharm\.?D\.?|M\.?S\.?|M\.?Sc\.?|MSc|MBA|B\.?S\.?|B\.?Sc\.?|BSc|B\.?A\.?|Esq\.?|CPA|P\.?E\.?)\b"
)
PROFESSIONAL_TITLES_REGEX = re.compile(
    r"\b(Dr\.?|Doctor|Prof\.?|Professor|Chief Medical Officer|CMO|CTO|CEO|CFO|Director|Lead Researcher|Senior Scientist|Principal Engineer|Senior Architect)\b",
    re.I,
)

# Regex Patterns for Expert / Medical Review Attribution
EXPERT_REVIEW_REGEX = re.compile(
    r"\b(medically reviewed by|reviewed by|fact[- ]checked by|technically reviewed by|peer[- ]reviewed by|verified by)\s+((?:Dr\.?|Prof\.?\s+)?(?:[A-Z][a-zA-Z.'-]+\s*){1,4})\b",
    re.I,
)

# Regex Patterns for Copyright and Ownership Statements
COPYRIGHT_REGEX = re.compile(
    r"(?:copyright|©|\(c\))\s*(?:\d{4})?\s*([A-Za-z0-9\s.,&-]+?)(?:\.|\n|all rights|rights reserved|$)",
    re.I,
)
OWNERSHIP_DISCLOSURE_REGEX = re.compile(
    r"\b(owned and operated by|published by|funding provided by|parent company:?|a subsidiary of)\s+([A-Za-z0-9\s.,&-]+)",
    re.I,
)

# Regex Patterns for Editorial & Disclosure Statements
EDITORIAL_DISCLOSURE_REGEX = re.compile(
    r"\b(editorial policy|corrections policy|ethics statement|affiliate disclosure|sponsored content|conflict of interest)\b",
    re.I,
)

# Known Organization Suffixes
ORG_NAME_SUFFIXES = (
    "Inc", "Inc.", "LLC", "LLC.", "Corp", "Corp.", "Corporation", "Ltd", "Ltd.",
    "Technologies", "Labs", "Laboratories", "Foundation", "Group", "Institute", "Enterprises",
)


class TrustSignalResult(BaseModel):
    """
    Structured result produced by the Trust Signal Engine.
    Contains categorized trust signals, statistics, and explainable findings.
    """
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    page_id: int | None = Field(default=None, description="Page ID if analyzed from persistence")
    url: str | None = Field(default=None, description="URL of the analyzed page")
    total_signals: int = Field(default=0, description="Total trust signals evaluated")
    detected_signals_count: int = Field(default=0, description="Count of detected or verified trust signals")
    missing_signals_count: int = Field(default=0, description="Count of missing trust signals")
    trust_signals: list[TrustSignalContract] = Field(default_factory=list, description="All evaluated trust signal contracts")
    identity_signals: list[TrustSignalContract] = Field(default_factory=list, description="Identity and business presence signals")
    about_signals: list[TrustSignalContract] = Field(default_factory=list, description="About and company profile signals")
    contact_signals: list[TrustSignalContract] = Field(default_factory=list, description="Contact information and channel signals")
    author_signals: list[TrustSignalContract] = Field(default_factory=list, description="Author byline and profile linkage signals")
    expertise_signals: list[TrustSignalContract] = Field(default_factory=list, description="Credentials and expert review signals")
    consistency_signals: list[TrustSignalContract] = Field(default_factory=list, description="Business identity consistency signals")
    policy_signals: list[TrustSignalContract] = Field(default_factory=list, description="Policy, terms, and transparency signals")
    claim_context_signals: list[TrustSignalContract] = Field(default_factory=list, description="Attribution context for claims")
    findings: list[FindingCreate] = Field(default_factory=list, description="Actionable findings generated from trust deficiencies")
    recommendations: list[RecommendationCreate] = Field(default_factory=list, description="Actionable recommendations for findings")
    metadata: dict[str, Any] = Field(default_factory=dict, description="Analysis execution metadata")


class TrustSignalEngine:
    """
    Deterministic Trust Signal Engine (Step 3).
    Analyzes page structured data, microdata, links, headings, metadata, and text content
    to detect verifiable trust and transparency signals.
    """

    def analyze(
        self,
        page_url: str | None = None,
        text_content: str | None = None,
        html_content: str | None = None,
        title: str | None = None,
        meta_descriptions: list[Any] | None = None,
        headings: list[Any] | None = None,
        links: list[Any] | None = None,
        structured_data_blocks: list[Any] | None = None,
        social_metadata: list[Any] | None = None,
        known_entities: list[Any] | None = None,
        quality_evidence: Any | None = None,
        page_id: int | None = None,
    ) -> TrustSignalResult:
        """
        Main deterministic analysis routine for Trust Signals.
        """
        result = TrustSignalResult(
            page_id=page_id,
            url=page_url,
            metadata={"engine": "TrustSignalEngine", "version": "1.0.0", "analyzed_at": datetime.now(timezone.utc).isoformat()},
        )

        clean_text = (text_content or "").strip()
        safe_links = self._normalize_links(links)
        safe_headings = self._normalize_headings(headings)
        safe_json_ld = self._normalize_json_ld(structured_data_blocks)
        safe_social = self._normalize_social(social_metadata)

        # 1. Identity Signals
        identity_sigs = self._detect_identity_signals(
            page_url=page_url,
            title=title,
            json_ld_blocks=safe_json_ld,
            social_metadata=safe_social,
            text_content=clean_text,
            known_entities=known_entities,
        )
        result.identity_signals.extend(identity_sigs)

        # 2. About Signals
        about_sigs = self._detect_about_signals(
            links=safe_links,
            headings=safe_headings,
            json_ld_blocks=safe_json_ld,
            text_content=clean_text,
        )
        result.about_signals.extend(about_sigs)

        # 3. Contact Signals
        contact_sigs = self._detect_contact_signals(
            links=safe_links,
            headings=safe_headings,
            json_ld_blocks=safe_json_ld,
            text_content=clean_text,
        )
        result.contact_signals.extend(contact_sigs)

        # 4. Author Signals
        author_sigs = self._detect_author_signals(
            text_content=clean_text,
            json_ld_blocks=safe_json_ld,
            social_metadata=safe_social,
            links=safe_links,
        )
        result.author_signals.extend(author_sigs)

        # 5. Expertise & Credentials Signals
        expertise_sigs = self._detect_expertise_signals(
            text_content=clean_text,
            json_ld_blocks=safe_json_ld,
            author_signals=author_sigs,
        )
        result.expertise_signals.extend(expertise_sigs)

        # 6. Business Identity Consistency
        consistency_sigs = self._detect_business_consistency(
            title=title,
            json_ld_blocks=safe_json_ld,
            social_metadata=safe_social,
            text_content=clean_text,
            known_entities=known_entities,
        )
        result.consistency_signals.extend(consistency_sigs)

        # 7. Policy & Transparency Signals
        policy_sigs = self._detect_policy_signals(
            links=safe_links,
            headings=safe_headings,
            text_content=clean_text,
            json_ld_blocks=safe_json_ld,
        )
        result.policy_signals.extend(policy_sigs)

        # 8. Claim Context Relevant to Trust
        claim_context_sigs = self._detect_claim_context_signals(
            text_content=clean_text,
            quality_evidence=quality_evidence,
            author_signals=author_sigs,
            identity_signals=identity_sigs,
        )
        result.claim_context_signals.extend(claim_context_sigs)

        # Aggregate All Signals
        all_signals = (
            identity_sigs
            + about_sigs
            + contact_sigs
            + author_sigs
            + expertise_sigs
            + consistency_sigs
            + policy_sigs
            + claim_context_sigs
        )
        result.trust_signals = all_signals
        result.total_signals = len(all_signals)
        result.detected_signals_count = sum(1 for s in all_signals if s.status in ("detected", "verified"))
        result.missing_signals_count = sum(1 for s in all_signals if s.status == "missing")

        # Generate Explainable Findings & Recommendations
        self._generate_findings_and_recommendations(result, page_id=page_id)

        return result

    def analyze_extraction(
        self,
        extraction: Any,
        page_url: str | None = None,
        page_id: int | None = None,
        known_entities: list[Any] | None = None,
        quality_evidence: Any | None = None,
    ) -> TrustSignalResult:
        """
        Convenience method to analyze an existing ExtractionResult object from Task 4.
        """
        return self.analyze(
            page_url=page_url or getattr(extraction, "url", None),
            text_content=getattr(extraction, "clean_text", None),
            html_content=getattr(extraction, "raw_html", None),
            title=getattr(extraction, "title_text", None),
            headings=getattr(extraction, "headings", None),
            links=getattr(extraction, "links", None),
            structured_data_blocks=getattr(extraction, "structured_data", None),
            social_metadata=getattr(extraction, "social_metadata", None),
            known_entities=known_entities,
            quality_evidence=quality_evidence,
            page_id=page_id,
        )

    # -------------------------------------------------------------------------
    # Detection Subroutines
    # -------------------------------------------------------------------------

    def _detect_identity_signals(
        self,
        page_url: str | None,
        title: str | None,
        json_ld_blocks: list[dict[str, Any]],
        social_metadata: list[dict[str, Any]],
        text_content: str,
        known_entities: list[Any] | None,
    ) -> list[TrustSignalContract]:
        signals: list[TrustSignalContract] = []

        org_name = None
        schema_type = None
        same_as = []
        found_in = []

        # 1. Structured Data Check
        for block in json_ld_blocks:
            parsed = block.get("parsed_json")
            if isinstance(parsed, dict):
                stype = str(parsed.get("@type", "")).lower()
                if (
                    stype.endswith("organization")
                    or stype in (
                        "organization",
                        "localbusiness",
                        "corporation",
                        "medicalwebpage",
                        "medicalorganization",
                        "newsmediaorganization",
                        "educationalorganization",
                        "nonprofitorganization",
                        "governmentorganization",
                        "ngo",
                    )
                ):
                    schema_type = parsed.get("@type")
                    if "name" in parsed:
                        org_name = parsed["name"]
                        found_in.append("structured_data")
                    elif "publisher" in parsed and isinstance(parsed["publisher"], dict):
                        org_name = parsed["publisher"].get("name")
                        found_in.append("structured_data.publisher")

                    if "sameAs" in parsed:
                        sa = parsed["sameAs"]
                        same_as = [sa] if isinstance(sa, str) else list(sa)

        # 2. Social Metadata Check
        for soc in social_metadata:
            prop = soc.get("property_name", "")
            val = soc.get("content", "")
            if prop in ("og:site_name", "twitter:site") and val:
                if not org_name:
                    org_name = val
                found_in.append(f"social_metadata:{prop}")

        # 3. Known Entities Check
        if not org_name and known_entities:
            for ent in known_entities:
                if isinstance(ent, dict) and ent.get("entity_type") in ("organization", "brand", "business"):
                    org_name = ent.get("name")
                    found_in.append("known_entities")
                    break

        if org_name:
            signals.append(
                TrustSignalContract(
                    signal_id="trust_org_identity_present",
                    category="business_identity",
                    title="Business or Organization Identity Declared",
                    status="verified" if "structured_data" in "".join(found_in) else "detected",
                    value={"organization_name": org_name, "schema_type": schema_type, "same_as": same_as},
                    confidence=ConfidenceLevel.HIGH,
                    description=f"Identified declared organization identity '{org_name}'.",
                    evidence={"organization_name": org_name, "schema_type": schema_type, "same_as": same_as, "found_in": found_in},
                )
            )
        else:
            signals.append(
                TrustSignalContract(
                    signal_id="trust_org_identity_present",
                    category="business_identity",
                    title="Business or Organization Identity Not Declared",
                    status="missing",
                    value=None,
                    confidence=ConfidenceLevel.MEDIUM,
                    description="No explicit organization or business entity declaration was found in page schema or metadata.",
                    evidence={"evaluated_blocks": len(json_ld_blocks)},
                )
            )

        return signals

    def _detect_about_signals(
        self,
        links: list[dict[str, Any]],
        headings: list[dict[str, Any]],
        json_ld_blocks: list[dict[str, Any]],
        text_content: str,
    ) -> list[TrustSignalContract]:
        signals: list[TrustSignalContract] = []

        about_link = None
        about_heading = None
        found_in = []

        # Link check
        for link in links:
            dest = (link.get("destination_url") or "").lower()
            anchor = (link.get("anchor_text") or "").strip().lower()
            if any(p in dest for p in ("/about", "/about-us", "/who-we-are", "/our-story", "/our-company", "/company")) or anchor in ("about", "about us", "who we are", "our story", "our company", "company overview", "about our company"):
                about_link = link.get("destination_url")
                found_in.append("links")
                break

        # Heading check
        for h in headings:
            txt = (h.get("text") or "").lower()
            if any(k in txt for k in ("about us", "who we are", "our mission", "company overview", "about the company")):
                about_heading = h.get("text")
                found_in.append("headings")
                break

        # Schema check
        for block in json_ld_blocks:
            parsed = block.get("parsed_json")
            if isinstance(parsed, dict) and parsed.get("@type") == "AboutPage":
                found_in.append("structured_data:AboutPage")

        if about_link or about_heading or "structured_data:AboutPage" in found_in:
            signals.append(
                TrustSignalContract(
                    signal_id="trust_about_info_present",
                    category="transparency",
                    title="About or Company Profile Information Detected",
                    status="detected",
                    value={"about_url": about_link, "about_heading": about_heading},
                    confidence=ConfidenceLevel.HIGH,
                    description="Detected accessible company background, mission, or about-us section.",
                    evidence={"about_url": about_link, "about_heading": about_heading, "found_in": found_in},
                )
            )
        else:
            signals.append(
                TrustSignalContract(
                    signal_id="trust_about_info_present",
                    category="transparency",
                    title="About or Company Profile Information Missing",
                    status="missing",
                    value=None,
                    confidence=ConfidenceLevel.MEDIUM,
                    description="No About page link or company background section was observed.",
                    evidence={"checked_links_count": len(links), "checked_headings_count": len(headings)},
                )
            )

        return signals

    def _detect_contact_signals(
        self,
        links: list[dict[str, Any]],
        headings: list[dict[str, Any]],
        json_ld_blocks: list[dict[str, Any]],
        text_content: str,
    ) -> list[TrustSignalContract]:
        signals: list[TrustSignalContract] = []

        contact_link = None
        contact_heading = None
        emails: list[str] = []
        phones: list[str] = []
        has_address = False
        address_details = None
        found_in = []

        # 1. Contact page link check
        for link in links:
            dest = (link.get("destination_url") or "").lower()
            anchor = (link.get("anchor_text") or "").strip().lower()
            if any(p in dest for p in ("/contact", "/contact-us", "/get-in-touch", "/support", "/help")) or anchor in ("contact", "contact us", "get in touch", "reach us", "customer support", "contact support"):
                if not contact_link:
                    contact_link = link.get("destination_url")
                    found_in.append("links")
            if dest.startswith("mailto:"):
                e = dest.replace("mailto:", "").split("?")[0].strip()
                if e and e not in emails:
                    emails.append(e)
            if dest.startswith("tel:"):
                p = dest.replace("tel:", "").strip()
                if p and p not in phones:
                    phones.append(p)

        # 2. Heading check
        for h in headings:
            txt = (h.get("text") or "").lower()
            if any(k in txt for k in ("contact us", "get in touch", "contact information", "reach out")):
                contact_heading = h.get("text")
                found_in.append("headings")
                break

        # 3. Schema check
        for block in json_ld_blocks:
            parsed = block.get("parsed_json")
            if isinstance(parsed, dict):
                if parsed.get("@type") in ("ContactPage", "ContactPoint"):
                    found_in.append("structured_data")
                if "contactPoint" in parsed:
                    cp = parsed["contactPoint"]
                    if isinstance(cp, dict):
                        if cp.get("telephone"):
                            phones.append(cp["telephone"])
                        if cp.get("email"):
                            emails.append(cp["email"])
                if "address" in parsed:
                    has_address = True
                    address_details = parsed["address"]
                    found_in.append("structured_data:address")

        # 4. Text regex fallback for email / phone / address
        if text_content:
            text_emails = [e for e in EMAIL_REGEX.findall(text_content) if not any(d in e for d in ("example.com", "domain.com", "yoursite.com"))]
            for e in text_emails:
                if e not in emails:
                    emails.append(e)

            text_phones = PHONE_REGEX.findall(text_content)
            for p in text_phones:
                if p not in phones:
                    phones.append(p)

            if not has_address and ADDRESS_INDICATOR_REGEX.search(text_content):
                has_address = True
                found_in.append("text:address_indicators")

        # Contact Page Signal
        if contact_link or contact_heading or "structured_data" in "".join(found_in):
            signals.append(
                TrustSignalContract(
                    signal_id="trust_contact_page_present",
                    category="contact",
                    title="Contact Page or Section Present",
                    status="detected",
                    value={"contact_url": contact_link, "contact_heading": contact_heading},
                    confidence=ConfidenceLevel.HIGH,
                    description="Identified accessible contact page or direct customer support section.",
                    evidence={"contact_url": contact_link, "contact_heading": contact_heading, "found_in": found_in},
                )
            )
        else:
            signals.append(
                TrustSignalContract(
                    signal_id="trust_contact_page_present",
                    category="contact",
                    title="Contact Page or Section Missing",
                    status="missing",
                    value=None,
                    confidence=ConfidenceLevel.MEDIUM,
                    description="No direct Contact Us link or support section was identified.",
                    evidence={"checked_links_count": len(links)},
                )
            )

        # Contact Channels Signal
        has_channels = bool(emails or phones or has_address)
        signals.append(
            TrustSignalContract(
                signal_id="trust_contact_channels_present",
                category="contact",
                title="Direct Contact Channels Available" if has_channels else "No Direct Contact Channels Found",
                status="detected" if has_channels else "missing",
                value={
                    "has_email": bool(emails),
                    "has_phone": bool(phones),
                    "has_address": has_address,
                    "emails_count": len(emails),
                    "phones_count": len(phones),
                },
                confidence=ConfidenceLevel.HIGH if has_channels else ConfidenceLevel.MEDIUM,
                description=f"Identified {len(emails)} email(s), {len(phones)} phone(s), physical address: {has_address}.",
                evidence={"emails": emails[:3], "phones": phones[:3], "has_address": has_address, "address_details": address_details},
            )
        )

        return signals

    def _detect_author_signals(
        self,
        text_content: str,
        json_ld_blocks: list[dict[str, Any]],
        social_metadata: list[dict[str, Any]],
        links: list[dict[str, Any]],
    ) -> list[TrustSignalContract]:
        signals: list[TrustSignalContract] = []

        author_name = None
        author_title = None
        author_url = None
        same_as = None
        found_in = []

        # 1. JSON-LD check
        for block in json_ld_blocks:
            parsed = block.get("parsed_json")
            if isinstance(parsed, dict) and "author" in parsed:
                auth = parsed["author"]
                if isinstance(auth, dict):
                    author_name = auth.get("name")
                    author_title = auth.get("jobTitle")
                    author_url = auth.get("url")
                    same_as = auth.get("sameAs")
                    found_in.append("structured_data:author")
                elif isinstance(auth, str):
                    author_name = auth
                    found_in.append("structured_data:author_string")

        # 2. Text Byline check
        if not author_name and text_content:
            m = BYLINE_REGEX.search(text_content[:1500])
            if m:
                author_name = m.group(1).strip()
                found_in.append("text:byline")

        # 3. Author Bio / Profile Link Check
        if not author_url:
            for link in links:
                dest = (link.get("destination_url") or "").lower()
                anchor = (link.get("anchor_text") or "").strip().lower()
                if any(p in dest for p in ("/author/", "/team/", "/bio/", "/profile/", "/contributors/", "orcid.org", "linkedin.com/in/")):
                    author_url = link.get("destination_url")
                    found_in.append("links:author_profile")
                    break

        if author_name:
            signals.append(
                TrustSignalContract(
                    signal_id="trust_author_byline_present",
                    category="authorship",
                    title="Author Byline and Identity Present",
                    status="verified" if "structured_data" in "".join(found_in) else "detected",
                    value={"author_name": author_name, "author_title": author_title},
                    confidence=ConfidenceLevel.HIGH,
                    description=f"Identified author attribution for '{author_name}'.",
                    evidence={"author_name": author_name, "author_title": author_title, "found_in": found_in},
                )
            )

            # Profile linkage
            if author_url or same_as:
                signals.append(
                    TrustSignalContract(
                        signal_id="trust_author_profile_linked",
                        category="authorship",
                        title="Author Profile or Bio Reference Linked",
                        status="verified" if same_as else "detected",
                        value={"author_url": author_url, "same_as": same_as},
                        confidence=ConfidenceLevel.HIGH,
                        description="Author byline connects to verified external profile or biography reference.",
                        evidence={"author_url": author_url, "same_as": same_as},
                    )
                )
        else:
            signals.append(
                TrustSignalContract(
                    signal_id="trust_author_byline_present",
                    category="authorship",
                    title="Author Byline Not Present",
                    status="missing",
                    value=None,
                    confidence=ConfidenceLevel.MEDIUM,
                    description="No explicit author byline or individual creator attribution was detected.",
                    evidence={"checked_text_length": len(text_content)},
                )
            )

        return signals

    def _detect_expertise_signals(
        self,
        text_content: str,
        json_ld_blocks: list[dict[str, Any]],
        author_signals: list[TrustSignalContract],
    ) -> list[TrustSignalContract]:
        signals: list[TrustSignalContract] = []

        credentials: list[str] = []
        titles: list[str] = []
        reviewer_name = None
        review_phrase = None

        # 1. Author schema credentials/titles
        for block in json_ld_blocks:
            parsed = block.get("parsed_json")
            if isinstance(parsed, dict) and "author" in parsed:
                auth = parsed["author"]
                if isinstance(auth, dict):
                    jt = auth.get("jobTitle")
                    if jt and jt not in titles:
                        titles.append(jt)
                    # Check name for Dr. / MD
                    aname = auth.get("name", "")
                    for cred in CREDENTIALS_REGEX.findall(aname):
                        if cred not in credentials:
                            credentials.append(cred)
                    for pt in PROFESSIONAL_TITLES_REGEX.findall(aname):
                        if pt not in titles:
                            titles.append(pt)

        # 2. Text scan for credentials and professional titles
        if text_content:
            text_head = text_content[:2500]
            for cred in CREDENTIALS_REGEX.findall(text_head):
                if cred not in credentials:
                    credentials.append(cred)
            for pt in PROFESSIONAL_TITLES_REGEX.findall(text_head):
                if pt not in titles:
                    titles.append(pt)

            # Reviewer match
            rev_match = EXPERT_REVIEW_REGEX.search(text_content)
            if rev_match:
                review_phrase = rev_match.group(1).strip()
                reviewer_name = rev_match.group(2).strip()

        # Credentials Signal
        has_credentials = bool(credentials or titles)
        if has_credentials:
            signals.append(
                TrustSignalContract(
                    signal_id="trust_author_credentials_present",
                    category="expertise",
                    title="Author Credentials and Professional Qualifications Detected",
                    status="detected",
                    value={"credentials": credentials, "titles": titles},
                    confidence=ConfidenceLevel.HIGH,
                    description=f"Identified verified professional credentials ({', '.join(credentials[:3])}) or titles ({', '.join(titles[:3])}).",
                    evidence={"credentials": credentials, "titles": titles},
                )
            )

        # Expert Review Attribution Signal
        if reviewer_name:
            signals.append(
                TrustSignalContract(
                    signal_id="trust_expert_review_attribution",
                    category="expertise",
                    title="Expert or Medical Reviewer Attribution Present",
                    status="detected",
                    value={"reviewer_name": reviewer_name, "review_phrase": review_phrase},
                    confidence=ConfidenceLevel.HIGH,
                    description=f"Content indicates formal verification ({review_phrase}) by '{reviewer_name}'.",
                    evidence={"reviewer_name": reviewer_name, "review_phrase": review_phrase},
                )
            )

        return signals

    def _detect_business_consistency(
        self,
        title: str | None,
        json_ld_blocks: list[dict[str, Any]],
        social_metadata: list[dict[str, Any]],
        text_content: str,
        known_entities: list[Any] | None,
    ) -> list[TrustSignalContract]:
        signals: list[TrustSignalContract] = []

        names: dict[str, str] = {}

        # 1. JSON-LD name
        for block in json_ld_blocks:
            parsed = block.get("parsed_json")
            if isinstance(parsed, dict):
                if parsed.get("name") and parsed.get("@type") in ("Organization", "LocalBusiness", "Corporation"):
                    names["schema_organization"] = parsed["name"].strip()
                elif parsed.get("publisher") and isinstance(parsed["publisher"], dict) and parsed["publisher"].get("name"):
                    names["schema_publisher"] = parsed["publisher"]["name"].strip()

        # 2. Social metadata site_name
        for soc in social_metadata:
            prop = soc.get("property_name", "")
            val = (soc.get("content") or "").strip()
            if prop == "og:site_name" and val:
                names["og_site_name"] = val

        # 3. Copyright declaration
        if text_content:
            m = COPYRIGHT_REGEX.search(text_content[-2000:])
            if m:
                cname = m.group(1).strip()
                # Exclude trivial dates/years
                if len(cname) > 3 and not cname.isdigit():
                    names["copyright"] = cname

        # 4. Known entity
        if known_entities:
            for ent in known_entities:
                if isinstance(ent, dict) and ent.get("entity_type") in ("organization", "brand"):
                    names["registered_entity"] = ent.get("name", "").strip()

        if len(names) >= 2:
            unique_names = list(set(names.values()))
            norm_tokens = [set(re.findall(r"\w+", n.lower())) for n in unique_names]
            is_consistent = True
            for i in range(len(norm_tokens)):
                for j in range(i + 1, len(norm_tokens)):
                    if not (norm_tokens[i] & norm_tokens[j]):
                        is_consistent = False
                        break

            signals.append(
                TrustSignalContract(
                    signal_id="trust_business_identity_consistency",
                    category="business_identity",
                    title="Business Identity Consistent Across DOM and Schema" if is_consistent else "Conflicting Business Identity Information Detected",
                    status="verified" if is_consistent else "detected",
                    value={"is_consistent": is_consistent, "declared_names": names},
                    confidence=ConfidenceLevel.HIGH if is_consistent else ConfidenceLevel.MEDIUM,
                    description="Organization name is aligned across schema, metadata, and copyright." if is_consistent else "Discrepancy observed between declared publisher, organization schema, and copyright entity.",
                    evidence={"observed_identities": names, "is_consistent": is_consistent},
                )
            )
        elif len(names) == 1:
            signals.append(
                TrustSignalContract(
                    signal_id="trust_business_identity_consistency",
                    category="business_identity",
                    title="Single Business Identity Source Observed",
                    status="detected",
                    value={"is_consistent": True, "declared_names": names},
                    confidence=ConfidenceLevel.MEDIUM,
                    description="Single organization identity observed without conflicting secondary declarations.",
                    evidence={"observed_identities": names},
                )
            )

        return signals

    def _detect_policy_signals(
        self,
        links: list[dict[str, Any]],
        headings: list[dict[str, Any]],
        text_content: str,
        json_ld_blocks: list[dict[str, Any]],
    ) -> list[TrustSignalContract]:
        signals: list[TrustSignalContract] = []

        privacy_url = None
        terms_url = None
        editorial_url = None
        editorial_text_cues = []
        ownership_statement = None

        # 1. Link scan
        for link in links:
            dest = (link.get("destination_url") or "").lower()
            anchor = (link.get("anchor_text") or "").strip().lower()

            # Privacy Policy check
            if any(p in dest for p in ("/privacy", "/privacy-policy", "/data-protection")) or "privacy policy" in anchor or "privacy notice" in anchor:
                if not privacy_url:
                    privacy_url = link.get("destination_url")

            # Terms of Service check
            is_terms = (
                any(p in dest for p in ("/terms", "/terms-of-service", "/terms-and-conditions", "/tos", "/legal-notice", "/user-agreement"))
                or (("/legal" in dest or "/legal/" in dest) and not any(priv in dest for priv in ("privacy", "data-protection", "cookie")))
                or any(t in anchor for t in ("terms of service", "terms of use", "terms & conditions", "terms and conditions", "legal notice", "user agreement"))
            )
            if is_terms and not terms_url:
                terms_url = link.get("destination_url")

            if any(p in dest for p in ("/editorial-policy", "/corrections", "/ethics", "/disclosures", "/affiliate-disclosure")) or any(d in anchor for d in ("editorial policy", "corrections policy", "affiliate disclosure", "ethics statement")):
                if not editorial_url:
                    editorial_url = link.get("destination_url")

        # 2. Text scan for editorial disclosures & ownership
        if text_content:
            m_edit = EDITORIAL_DISCLOSURE_REGEX.findall(text_content)
            if m_edit:
                editorial_text_cues = list(set(m_edit))

            m_owner = OWNERSHIP_DISCLOSURE_REGEX.search(text_content)
            if m_owner:
                ownership_statement = f"{m_owner.group(1)} {m_owner.group(2).strip()}"

        # Privacy Policy Signal
        signals.append(
            TrustSignalContract(
                signal_id="trust_privacy_policy_present",
                category="transparency",
                title="Privacy Policy Link Present" if privacy_url else "Privacy Policy Missing",
                status="detected" if privacy_url else "missing",
                value={"privacy_url": privacy_url},
                confidence=ConfidenceLevel.HIGH if privacy_url else ConfidenceLevel.MEDIUM,
                description="Verifiable privacy policy reference is present." if privacy_url else "No privacy policy link was detected.",
                evidence={"privacy_url": privacy_url},
            )
        )

        # Terms of Service Signal
        signals.append(
            TrustSignalContract(
                signal_id="trust_terms_of_service_present",
                category="transparency",
                title="Terms of Service Link Present" if terms_url else "Terms of Service Missing",
                status="detected" if terms_url else "missing",
                value={"terms_url": terms_url},
                confidence=ConfidenceLevel.HIGH if terms_url else ConfidenceLevel.MEDIUM,
                description="Terms of service or legal agreement is accessible." if terms_url else "No terms of service link was detected.",
                evidence={"terms_url": terms_url},
            )
        )

        # Editorial / Disclosure Transparency Signal
        has_editorial = bool(editorial_url or editorial_text_cues)
        if has_editorial:
            signals.append(
                TrustSignalContract(
                    signal_id="trust_editorial_disclosure_present",
                    category="transparency",
                    title="Editorial Policy or Disclosure Statement Present",
                    status="detected",
                    value={"editorial_url": editorial_url, "text_cues": editorial_text_cues},
                    confidence=ConfidenceLevel.HIGH,
                    description="Page includes explicit editorial policies, corrections guidelines, or commercial disclosures.",
                    evidence={"editorial_url": editorial_url, "text_cues": editorial_text_cues},
                )
            )

        # Ownership Transparency Signal
        if ownership_statement:
            signals.append(
                TrustSignalContract(
                    signal_id="trust_ownership_transparency_present",
                    category="transparency",
                    title="Ownership and Funding Transparency Declared",
                    status="detected",
                    value={"statement": ownership_statement},
                    confidence=ConfidenceLevel.HIGH,
                    description=f"Declared ownership statement: '{ownership_statement}'.",
                    evidence={"ownership_statement": ownership_statement},
                )
            )

        return signals

    def _detect_claim_context_signals(
        self,
        text_content: str,
        quality_evidence: Any | None,
        author_signals: list[TrustSignalContract],
        identity_signals: list[TrustSignalContract],
    ) -> list[TrustSignalContract]:
        signals: list[TrustSignalContract] = []

        # Check if author or organization attribution exists
        has_author = any(s.status in ("detected", "verified") for s in author_signals if s.signal_id == "trust_author_byline_present")
        has_org = any(s.status in ("detected", "verified") for s in identity_signals if s.signal_id == "trust_org_identity_present")

        has_claims = False
        data_points_count = 0
        if quality_evidence:
            data_points_count = getattr(quality_evidence, "data_points_count", 0)
            unsupported_claims_count = getattr(quality_evidence, "unsupported_claims_count", 0)
            has_claims = (data_points_count > 0 or unsupported_claims_count > 0)
        elif text_content:
            has_claims = bool(re.search(r"\b\d+(?:\.\d+)?%", text_content))

        if has_claims:
            has_contextual_attribution = has_author or has_org
            signals.append(
                TrustSignalContract(
                    signal_id="trust_claim_context_attribution",
                    category="claim_context",
                    title="Claims Contextualized with Clear Entity Responsibility" if has_contextual_attribution else "Claims Stated Without Clear Author or Organization Attribution",
                    status="detected" if has_contextual_attribution else "missing",
                    value={
                        "has_contextual_attribution": has_contextual_attribution,
                        "has_author_byline": has_author,
                        "has_organization_identity": has_org,
                        "data_points_count": data_points_count,
                    },
                    confidence=ConfidenceLevel.HIGH if has_contextual_attribution else ConfidenceLevel.MEDIUM,
                    description="Factual/technical statements are backed by clear creator or organizational responsibility." if has_contextual_attribution else "Factual assertions are published anonymously without clear author or publisher attribution.",
                    evidence={"has_author": has_author, "has_org": has_org, "data_points_count": data_points_count},
                )
            )

        return signals

    def _generate_findings_and_recommendations(
        self,
        result: TrustSignalResult,
        page_id: int | None,
    ) -> None:
        """
        Generates actionable findings and recommendations for missing or conflicting trust signals.
        """
        # 1. Missing Privacy Policy Finding
        privacy_sig = next((s for s in result.policy_signals if s.signal_id == "trust_privacy_policy_present"), None)
        if privacy_sig and privacy_sig.status == "missing":
            result.findings.append(
                FindingCreate(
                    page_id=page_id,
                    finding_type="missing_privacy_policy",
                    category="trust",
                    title="Missing Privacy Policy Link",
                    description="The page does not provide an observable link to a privacy policy or data protection statement.",
                    severity="medium",
                    status="open",
                    evidence={"signal_id": privacy_sig.signal_id},
                )
            )
            result.recommendations.append(
                RecommendationCreate(
                    title="Add Traceable Privacy Policy Link to Footer",
                    description="Ensure a clear, crawlable link to the privacy policy is accessible across all page templates.",
                    priority="medium",
                    status="open",
                    action_type="add_privacy_policy_link",
                )
            )

        # 2. Missing Contact Information Finding
        contact_sig = next((s for s in result.contact_signals if s.signal_id == "trust_contact_page_present"), None)
        channels_sig = next((s for s in result.contact_signals if s.signal_id == "trust_contact_channels_present"), None)
        if contact_sig and contact_sig.status == "missing" and channels_sig and channels_sig.status == "missing":
            result.findings.append(
                FindingCreate(
                    page_id=page_id,
                    finding_type="missing_contact_information",
                    category="trust",
                    title="No Direct Contact Information or Support Link Detected",
                    description="Page lacks direct contact channels (email, phone, physical address, or Contact Us link).",
                    severity="medium",
                    status="open",
                    evidence={"signal_id": "trust_contact_channels_present"},
                )
            )
            result.recommendations.append(
                RecommendationCreate(
                    title="Provide Visible Contact Information or Support Link",
                    description="Add direct contact channels (email, phone, physical location, or contact form link) to establish transparency.",
                    priority="medium",
                    status="open",
                    action_type="add_contact_channels",
                )
            )

        # 3. Conflicting Business Identity Finding
        consistency_sig = next((s for s in result.consistency_signals if s.signal_id == "trust_business_identity_consistency"), None)
        if consistency_sig and consistency_sig.value and isinstance(consistency_sig.value, dict) and not consistency_sig.value.get("is_consistent"):
            result.findings.append(
                FindingCreate(
                    page_id=page_id,
                    finding_type="conflicting_business_identity",
                    category="trust",
                    title="Conflicting Business Identity Declarations",
                    description="Discrepancies detected between organization names declared in schema, OpenGraph metadata, and copyright notice.",
                    severity="medium",
                    status="open",
                    evidence=consistency_sig.evidence,
                )
            )
            result.recommendations.append(
                RecommendationCreate(
                    title="Standardize Business Identity Across Structured Data and DOM",
                    description="Align the official organization name across JSON-LD, OpenGraph site_name, and footer copyright declarations.",
                    priority="medium",
                    status="open",
                    action_type="standardize_business_identity",
                )
            )

        # 4. Anonymous Claims Finding
        claim_sig = next((s for s in result.claim_context_signals if s.signal_id == "trust_claim_context_attribution"), None)
        if claim_sig and claim_sig.status == "missing":
            result.findings.append(
                FindingCreate(
                    page_id=page_id,
                    finding_type="anonymous_claims_lacking_attribution",
                    category="trust",
                    title="Factual Claims Published Without Creator or Entity Attribution",
                    description="Page presents technical or quantitative assertions without an identifiable author byline or publisher responsibility declaration.",
                    severity="low",
                    status="open",
                    evidence=claim_sig.evidence,
                )
            )
            result.recommendations.append(
                RecommendationCreate(
                    title="Attribute Content to Verified Author or Organization",
                    description="Add an author byline or explicit organization publisher statement to contextualize factual claims.",
                    priority="low",
                    status="open",
                    action_type="add_author_byline",
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

    def _normalize_social(self, social: list[Any] | None) -> list[dict[str, Any]]:
        if not social:
            return []
        normalized: list[dict[str, Any]] = []
        for s in social:
            if isinstance(s, dict):
                normalized.append(s)
            else:
                normalized.append({
                    "platform": getattr(s, "platform", ""),
                    "property_name": getattr(s, "property_name", ""),
                    "content": getattr(s, "content", ""),
                })
        return normalized


def analyze_trust_signals(
    page_url: str | None = None,
    text_content: str | None = None,
    html_content: str | None = None,
    title: str | None = None,
    meta_descriptions: list[Any] | None = None,
    headings: list[Any] | None = None,
    links: list[Any] | None = None,
    structured_data_blocks: list[Any] | None = None,
    social_metadata: list[Any] | None = None,
    known_entities: list[Any] | None = None,
    quality_evidence: Any | None = None,
    page_id: int | None = None,
) -> TrustSignalResult:
    """
    Convenience function for TrustSignalEngine.
    """
    engine = TrustSignalEngine()
    return engine.analyze(
        page_url=page_url,
        text_content=text_content,
        html_content=html_content,
        title=title,
        meta_descriptions=meta_descriptions,
        headings=headings,
        links=links,
        structured_data_blocks=structured_data_blocks,
        social_metadata=social_metadata,
        known_entities=known_entities,
        quality_evidence=quality_evidence,
        page_id=page_id,
    )
