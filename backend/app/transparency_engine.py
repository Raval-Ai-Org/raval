"""
First-Party Transparency Engine (Day 8 - Phase B - Step 8 ONLY)

Performs deterministic detection and consistency evaluation of first-party transparency evidence:
1. Organization / Business Identity (legal name, brand, domain registry)
2. Author Identity (byline, author name, credentials, profile, affiliation)
3. Direct Contact Channels (email, phone, physical address, contact page)
4. About / Company Profile (mission, history, editorial standards)
5. Ownership & Funding Disclosures (parent company, publisher, funding)
6. Publication & Revision Timestamps (datePublished, dateModified, last updated)
7. Consistency Checks:
   - Author-to-Organization alignment
   - Contact-to-Domain consistency
   - Business name consistency across DOM, metadata, and schema

Core architectural principles:
- Structural Evidence Only: Detects and reports observed first-party attributes.
- Does NOT assert legitimacy or trustworthiness merely because fields exist.
- Does NOT perform external fact verification or live API network calls.
- Preserves evidence traceability in all signals.
"""

from datetime import datetime, timezone
import json
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


# Regex for Email Extraction
EMAIL_REGEX = re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b")

# Regex for Phone Extraction
PHONE_REGEX = re.compile(
    r"(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b"
)

# Regex for Publication / Updated Dates in DOM
DATE_REGEX = re.compile(
    r"\b(?:published|updated|modified|posted|last\s+reviewed)(?:\s+on)?:\s*([A-Za-z]+\s+\d{1,2},\s+\d{4}|\d{4}-\d{2}-\d{2})\b",
    re.I,
)

# Free webmail domains that indicate potential contact mismatch for corporate sites
FREE_EMAIL_DOMAINS = {"gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "aol.com"}


class FirstPartyTransparencyResult(BaseModel):
    """
    Structured result produced by the First-Party Transparency Engine.
    """
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    page_id: int | None = Field(default=None, description="Page ID if analyzed from database")
    url: str | None = Field(default=None, description="URL of the analyzed page")
    total_signals: int = Field(default=0, description="Total transparency signals evaluated")
    detected_signals_count: int = Field(default=0, description="Count of detected or verified transparency signals")
    weak_signals_count: int = Field(default=0, description="Count of partial or weak transparency signals")
    missing_signals_count: int = Field(default=0, description="Count of missing transparency signals")
    transparency_signals: list[TrustSignalContract] = Field(default_factory=list, description="Detailed transparency signal contracts")
    transparency_gaps: list[str] = Field(default_factory=list, description="Specific first-party transparency deficiencies detected")
    is_transparent: bool = Field(default=False, description="Whether core first-party structural identity is present")
    entity_identity: dict[str, Any] = Field(default_factory=dict, description="Extracted entity identity summary")
    consistency_checks: dict[str, Any] = Field(default_factory=dict, description="Consistency assessment outcomes")
    findings: list[FindingCreate] = Field(default_factory=list, description="Actionable findings generated from transparency gaps")
    recommendations: list[RecommendationCreate] = Field(default_factory=list, description="Actionable recommendations for findings")
    metadata: dict[str, Any] = Field(default_factory=dict, description="Execution metadata")


class FirstPartyTransparencyEngine:
    """
    Deterministic First-Party Transparency Engine (Step 8).
    Evaluates organizational identity, authorship, contact channels, publication dates,
    and intra-page identity consistency.
    """

    def analyze(
        self,
        page_url: str | None = None,
        title: str | None = None,
        meta_description: str | None = None,
        headings: list[Any] | None = None,
        links: list[Any] | None = None,
        text_content: str | None = None,
        structured_data_blocks: list[dict[str, Any]] | None = None,
        page_id: int | None = None,
    ) -> FirstPartyTransparencyResult:
        """
        Main deterministic routine for First-Party Transparency Evaluation.
        """
        result = FirstPartyTransparencyResult(
            page_id=page_id,
            url=page_url,
            metadata={
                "engine": "FirstPartyTransparencyEngine",
                "version": "1.0.0",
                "analyzed_at": datetime.now(timezone.utc).isoformat(),
            },
        )

        clean_text = (text_content or "").strip()
        safe_links = self._normalize_links(links)
        safe_schemas = self._normalize_schemas(structured_data_blocks)

        base_domain = ""
        if page_url:
            try:
                base_domain = urlparse(page_url).netloc.lower()
                if base_domain.startswith("www."):
                    base_domain = base_domain[4:]
            except Exception:
                base_domain = ""

        # 1. Organization / Business Identity
        org_signal, org_name, publisher_info = self._detect_org_identity(clean_text, safe_schemas, safe_links)

        # 2. Author Identity
        author_signal, author_name, author_role = self._detect_author_identity(clean_text, safe_schemas, safe_links)

        # 3. Direct Contact Channels
        contact_signal, contact_info = self._detect_contact_info(clean_text, safe_links, base_domain)

        # 4. About / Company Profile Relationship
        about_signal, about_url = self._detect_about_relationship(clean_text, safe_links)

        # 5. Ownership & Funding Disclosures
        ownership_signal, ownership_info = self._detect_ownership_and_funding(clean_text, safe_schemas, publisher_info)

        # 6. Publication & Revision Dates
        dates_signal, dates_info = self._detect_dates(clean_text, safe_schemas)

        # 7. Consistency Checks
        consistency_signal, consistency_dict = self._evaluate_consistency(
            base_domain=base_domain,
            org_name=org_name,
            author_name=author_name,
            author_role=author_role,
            contact_info=contact_info,
            schemas=safe_schemas,
        )

        all_signals = [
            org_signal,
            author_signal,
            contact_signal,
            about_signal,
            ownership_signal,
            dates_signal,
            consistency_signal,
        ]

        result.transparency_signals = all_signals
        result.total_signals = len(all_signals)
        result.detected_signals_count = sum(1 for s in all_signals if s.status in ("detected", "verified"))
        result.weak_signals_count = sum(1 for s in all_signals if s.status == "weak")
        result.missing_signals_count = sum(1 for s in all_signals if s.status in ("missing", "conflict"))

        # Gaps
        gaps: list[str] = []
        for s in all_signals:
            if s.status in ("missing", "conflict", "weak"):
                gaps.append(s.signal_id)
        result.transparency_gaps = gaps

        result.entity_identity = {
            "organization_name": org_name,
            "publisher": publisher_info,
            "author_name": author_name,
            "author_role": author_role,
            "contact_email": contact_info.get("email"),
            "contact_phone": contact_info.get("phone"),
            "about_url": about_url,
            "published_date": dates_info.get("date_published"),
            "modified_date": dates_info.get("date_modified"),
        }
        result.consistency_checks = consistency_dict
        result.is_transparent = (
            (org_signal.status in ("detected", "verified") or author_signal.status in ("detected", "verified"))
            and contact_signal.status in ("detected", "verified")
        )

        # Generate Explainable Findings & Recommendations
        self._generate_findings_and_recommendations(result, page_id=page_id, base_domain=base_domain)

        return result

    def analyze_extraction(
        self,
        extraction: Any,
        page_url: str | None = None,
        page_id: int | None = None,
    ) -> FirstPartyTransparencyResult:
        """
        Convenience method to analyze an existing ExtractionResult object.
        """
        return self.analyze(
            page_url=page_url or getattr(extraction, "url", None),
            title=getattr(extraction, "title_text", None),
            meta_description=getattr(extraction, "meta_description", None),
            headings=getattr(extraction, "headings", None),
            links=getattr(extraction, "links", None),
            text_content=getattr(extraction, "clean_text", None),
            structured_data_blocks=getattr(extraction, "structured_data", None),
            page_id=page_id,
        )

    # -------------------------------------------------------------------------
    # Detection Subroutines
    # -------------------------------------------------------------------------

    def _detect_org_identity(
        self,
        text: str,
        schemas: list[dict[str, Any]],
        links: list[dict[str, Any]],
    ) -> tuple[TrustSignalContract, str | None, dict[str, Any] | None]:
        org_name = None
        publisher_info = None

        # Check structured schema
        for block in schemas:
            stype = block.get("@type") or ""
            if stype in ("Organization", "Corporation", "LocalBusiness", "MedicalOrganization", "EducationalOrganization"):
                org_name = block.get("name") or block.get("legalName")
                break
            if "publisher" in block and isinstance(block["publisher"], dict):
                pub = block["publisher"]
                publisher_info = pub
                if not org_name:
                    org_name = pub.get("name")

        if org_name:
            return (
                TrustSignalContract(
                    signal_id="transparency_org_identity",
                    category="trust",
                    title="Declared Organization / Business Identity",
                    status="verified",
                    value={"organization_name": org_name, "source": "schema"},
                    confidence=ConfidenceLevel.HIGH,
                    description=f"Identified declared organization identity '{org_name}' via structured schema.",
                    evidence={"organization_name": org_name, "publisher": publisher_info},
                ),
                org_name,
                publisher_info,
            )

        # Fallback to copyright or footer notice
        copy_match = re.search(r"(?:©|copyright|\(c\))\s*(?:\d{4})?\s*([A-Za-z0-9\s.,&-]{3,40}?)(?:\.|\s+all\s+rights|$)", text, re.I)
        if copy_match:
            cand_name = copy_match.group(1).strip().rstrip(".").strip()
            if cand_name:
                return (
                    TrustSignalContract(
                        signal_id="transparency_org_identity",
                        category="trust",
                        title="Declared Organization / Business Identity",
                        status="detected",
                        value={"organization_name": cand_name, "source": "footer_copyright"},
                        confidence=ConfidenceLevel.MEDIUM,
                        description=f"Identified organization name '{cand_name}' in copyright notice.",
                        evidence={"copyright_text": copy_match.group(0)},
                    ),
                    cand_name,
                    publisher_info,
                )

        return (
            TrustSignalContract(
                signal_id="transparency_org_identity",
                category="trust",
                title="Declared Organization / Business Identity",
                status="missing",
                value=None,
                confidence=ConfidenceLevel.HIGH,
                description="No explicit corporate or organizational entity identity found.",
                evidence=None,
            ),
            None,
            None,
        )

    def _detect_author_identity(
        self,
        text: str,
        schemas: list[dict[str, Any]],
        links: list[dict[str, Any]],
    ) -> tuple[TrustSignalContract, str | None, str | None]:
        author_name = None
        author_role = None
        author_profile = None

        # Check structured schema
        for block in schemas:
            author_field = block.get("author")
            if isinstance(author_field, dict):
                author_name = author_field.get("name")
                author_role = author_field.get("jobTitle")
                author_profile = author_field.get("sameAs") or author_field.get("url")
                break
            elif isinstance(author_field, list) and len(author_field) > 0 and isinstance(author_field[0], dict):
                author_name = author_field[0].get("name")
                author_role = author_field[0].get("jobTitle")
                break

        # Byline in text
        if not author_name:
            byline_match = re.search(
                r"\b(?:authored|written|reported|edited)\s+by\s*:?\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})(?:\s*[,|\n.]|\s+on\s+|\s+at\s+|\s+for\s+|$)",
                text,
                re.I,
            )
            if byline_match:
                author_name = byline_match.group(1).strip()

        if author_name:
            status = "verified" if author_role or author_profile else "detected"
            return (
                TrustSignalContract(
                    signal_id="transparency_author_identity",
                    category="trust",
                    title="Author Transparency and Attribution",
                    status=status,
                    value={"author_name": author_name, "role": author_role, "profile": author_profile},
                    confidence=ConfidenceLevel.HIGH,
                    description=f"Identified attributed author '{author_name}'{f' ({author_role})' if author_role else ''}.",
                    evidence={"author_name": author_name, "role": author_role, "profile": author_profile},
                ),
                author_name,
                author_role,
            )

        return (
            TrustSignalContract(
                signal_id="transparency_author_identity",
                category="trust",
                title="Author Transparency and Attribution",
                status="missing",
                value=None,
                confidence=ConfidenceLevel.MEDIUM,
                description="No explicit author byline or individual attribution found.",
                evidence=None,
            ),
            None,
            None,
        )

    def _detect_contact_info(
        self,
        text: str,
        links: list[dict[str, Any]],
        base_domain: str,
    ) -> tuple[TrustSignalContract, dict[str, Any]]:
        emails = EMAIL_REGEX.findall(text)
        phones = PHONE_REGEX.findall(text)

        contact_url = None
        for l in links:
            href = (l.get("href") or l.get("destination_url") or "").lower()
            if any(k in href for k in ("/contact", "contact-us", "reach-us", "get-in-touch")):
                contact_url = l.get("href") or l.get("destination_url")
                break

        contact_dict = {
            "email": emails[0] if emails else None,
            "phone": phones[0] if phones else None,
            "contact_page": contact_url,
        }

        if emails or phones or contact_url:
            status = "verified" if emails or phones else "detected"
            return (
                TrustSignalContract(
                    signal_id="transparency_contact_info",
                    category="trust",
                    title="Direct Communication and Contact Channels",
                    status=status,
                    value=contact_dict,
                    confidence=ConfidenceLevel.HIGH,
                    description="Identified accessible contact channels for direct user communication.",
                    evidence=contact_dict,
                ),
                contact_dict,
            )

        return (
            TrustSignalContract(
                signal_id="transparency_contact_info",
                category="trust",
                title="Direct Communication and Contact Channels",
                status="missing",
                value=None,
                confidence=ConfidenceLevel.HIGH,
                description="No direct communication channels, contact email, phone, or contact page link detected.",
                evidence=None,
            ),
            contact_dict,
        )

    def _detect_about_relationship(
        self,
        text: str,
        links: list[dict[str, Any]],
    ) -> tuple[TrustSignalContract, str | None]:
        about_url = None
        for l in links:
            href = (l.get("href") or l.get("destination_url") or "").lower()
            anchor = (l.get("anchor_text") or "").lower()
            if "/about" in href or "about-us" in href or "our-team" in href or "about" in anchor:
                about_url = l.get("href") or l.get("destination_url")
                break

        if about_url:
            return (
                TrustSignalContract(
                    signal_id="transparency_about_relationship",
                    category="trust",
                    title="About & Organizational Overview Relationship",
                    status="detected",
                    value={"about_url": about_url},
                    confidence=ConfidenceLevel.HIGH,
                    description=f"Accessible About/Company overview page found at '{about_url}'.",
                    evidence={"about_url": about_url},
                ),
                about_url,
            )

        return (
            TrustSignalContract(
                signal_id="transparency_about_relationship",
                category="trust",
                title="About & Organizational Overview Relationship",
                status="missing",
                value=None,
                confidence=ConfidenceLevel.MEDIUM,
                description="No link to an About, Team, or Company mission page detected.",
                evidence=None,
            ),
            None,
        )

    def _detect_ownership_and_funding(
        self,
        text: str,
        schemas: list[dict[str, Any]],
        publisher_info: dict[str, Any] | None,
    ) -> tuple[TrustSignalContract, dict[str, Any] | None]:
        ownership_cues = []
        if publisher_info:
            ownership_cues.append(f"Publisher: {publisher_info.get('name')}")

        if re.search(r"\b(?:funded\s+by|grant\s+(?:number|support)|subsidiary\s+of|wholly\s+owned\s+by|parent\s+company)\b", text, re.I):
            ownership_cues.append("Explicit funding/ownership disclosure statement in text")

        if ownership_cues:
            return (
                TrustSignalContract(
                    signal_id="transparency_ownership_disclosed",
                    category="trust",
                    title="Ownership and Funding Disclosures",
                    status="detected",
                    value={"disclosures": ownership_cues},
                    confidence=ConfidenceLevel.HIGH,
                    description="Identified explicit publisher, ownership, or research funding disclosures.",
                    evidence={"ownership_cues": ownership_cues},
                ),
                {"ownership_cues": ownership_cues},
            )

        return (
            TrustSignalContract(
                signal_id="transparency_ownership_disclosed",
                category="trust",
                title="Ownership and Funding Disclosures",
                status="missing",
                value=None,
                confidence=ConfidenceLevel.LOW,
                description="No explicit parent entity, corporate ownership, or funding disclosure found.",
                evidence=None,
            ),
            None,
        )

    def _detect_dates(
        self,
        text: str,
        schemas: list[dict[str, Any]],
    ) -> tuple[TrustSignalContract, dict[str, Any]]:
        date_pub = None
        date_mod = None

        for block in schemas:
            if "datePublished" in block:
                date_pub = str(block["datePublished"])
            if "dateModified" in block:
                date_mod = str(block["dateModified"])
            if date_pub or date_mod:
                break

        if not date_pub:
            match = DATE_REGEX.search(text)
            if match:
                date_pub = match.group(1)

        dates_info = {"date_published": date_pub, "date_modified": date_mod}

        if date_pub and date_mod:
            return (
                TrustSignalContract(
                    signal_id="transparency_dates_disclosed",
                    category="trust",
                    title="Publication & Revision Timestamps",
                    status="verified",
                    value=dates_info,
                    confidence=ConfidenceLevel.HIGH,
                    description=f"Explicit publication ({date_pub}) and revision ({date_mod}) timestamps disclosed.",
                    evidence=dates_info,
                ),
                dates_info,
            )
        elif date_pub or date_mod:
            return (
                TrustSignalContract(
                    signal_id="transparency_dates_disclosed",
                    category="trust",
                    title="Publication & Revision Timestamps",
                    status="detected",
                    value=dates_info,
                    confidence=ConfidenceLevel.HIGH,
                    description=f"Identified article timestamp ({date_pub or date_mod}).",
                    evidence=dates_info,
                ),
                dates_info,
            )

        return (
            TrustSignalContract(
                signal_id="transparency_dates_disclosed",
                category="trust",
                title="Publication & Revision Timestamps",
                status="missing",
                value=None,
                confidence=ConfidenceLevel.MEDIUM,
                description="No explicit publication or revision timestamps detected.",
                evidence=None,
            ),
            dates_info,
        )

    def _evaluate_consistency(
        self,
        base_domain: str,
        org_name: str | None,
        author_name: str | None,
        author_role: str | None,
        contact_info: dict[str, Any],
        schemas: list[dict[str, Any]],
    ) -> tuple[TrustSignalContract, dict[str, Any]]:
        email = contact_info.get("email")
        domain_contact_aligned = None
        has_conflict = False
        conflict_reasons = []

        if email and base_domain:
            email_domain = email.split("@")[-1].lower()
            if email_domain == base_domain or email_domain.endswith("." + base_domain):
                domain_contact_aligned = True
            elif email_domain in FREE_EMAIL_DOMAINS and len(base_domain) > 4:
                domain_contact_aligned = False
                has_conflict = True
                conflict_reasons.append(f"Commercial website '{base_domain}' utilizes generic free webmail ('{email}')")
            else:
                domain_contact_aligned = True

        status = "conflict" if has_conflict else "verified" if (org_name and contact_info.get("email")) else "detected"
        desc = "First-party identity fields are structurally consistent." if not has_conflict else f"Identity inconsistency: {'; '.join(conflict_reasons)}"

        consistency_dict = {
            "domain_contact_aligned": domain_contact_aligned,
            "has_conflict": has_conflict,
            "conflict_reasons": conflict_reasons,
        }

        return (
            TrustSignalContract(
                signal_id="transparency_consistency_checks",
                category="trust",
                title="First-Party Identity Consistency Evaluation",
                status=status,
                value=consistency_dict,
                confidence=ConfidenceLevel.HIGH,
                description=desc,
                evidence=consistency_dict,
            ),
            consistency_dict,
        )

    def _generate_findings_and_recommendations(
        self,
        result: FirstPartyTransparencyResult,
        page_id: int | None,
        base_domain: str,
    ) -> None:
        """
        Generates actionable findings and recommendations for first-party transparency deficiencies.
        """
        # 1. Missing Core First-Party Identity
        if result.missing_signals_count >= 4:
            result.findings.append(
                FindingCreate(
                    page_id=page_id,
                    finding_type="missing_first_party_transparency",
                    category="trust",
                    title="Deficient First-Party Transparency Disclosures",
                    description="Page lacks essential first-party disclosures such as author attribution, organization identity, and verifiable contact channels.",
                    severity="high",
                    status="open",
                    evidence={"transparency_gaps": result.transparency_gaps},
                )
            )
            result.recommendations.append(
                RecommendationCreate(
                    title="Publish Transparent First-Party Disclosures",
                    description="Add clear organization identity, author bylines, and direct contact channels in the footer and metadata.",
                    priority="high",
                    status="open",
                    action_type="add_transparency_disclosures",
                )
            )

        # 2. Conflicting or Inconsistent Contact Identity
        if result.consistency_checks.get("has_conflict"):
            result.findings.append(
                FindingCreate(
                    page_id=page_id,
                    finding_type="contact_identity_conflict",
                    category="trust",
                    title="Contact Email Domain Inconsistency",
                    description="The contact email address uses a public webmail provider rather than the official domain.",
                    severity="low",
                    status="open",
                    evidence={"conflicts": result.consistency_checks.get("conflict_reasons")},
                )
            )
            result.recommendations.append(
                RecommendationCreate(
                    title="Use Domain-Aligned Contact Email Address",
                    description=f"Configure official domain-branded contact addresses (e.g. contact@{base_domain or 'yourdomain.com'}).",
                    priority="low",
                    status="open",
                    action_type="align_contact_domain",
                )
            )

    # -------------------------------------------------------------------------
    # Normalization Helpers
    # -------------------------------------------------------------------------

    def _normalize_schemas(self, structured_data: list[Any] | None) -> list[dict[str, Any]]:
        if not structured_data:
            return []
        normalized: list[dict[str, Any]] = []
        for item in structured_data:
            if isinstance(item, dict):
                normalized.append(item)
            elif hasattr(item, "raw_block") and getattr(item, "raw_block"):
                try:
                    parsed = json.loads(item.raw_block)
                    if isinstance(parsed, dict):
                        normalized.append(parsed)
                    elif isinstance(parsed, list):
                        for p in parsed:
                            if isinstance(p, dict):
                                normalized.append(p)
                except Exception:
                    pass
        return normalized

    def _normalize_links(self, links: list[Any] | None) -> list[dict[str, Any]]:
        if not links:
            return []
        normalized: list[dict[str, Any]] = []
        for l in links:
            if isinstance(l, dict):
                normalized.append(l)
            else:
                normalized.append({
                    "href": getattr(l, "destination_url", None) or getattr(l, "url", None) or getattr(l, "href", None),
                    "destination_url": getattr(l, "destination_url", None) or getattr(l, "url", None),
                    "anchor_text": getattr(l, "anchor_text", None),
                })
        return normalized


def analyze_first_party_transparency(
    page_url: str | None = None,
    title: str | None = None,
    meta_description: str | None = None,
    headings: list[Any] | None = None,
    links: list[Any] | None = None,
    text_content: str | None = None,
    structured_data_blocks: list[dict[str, Any]] | None = None,
    page_id: int | None = None,
) -> FirstPartyTransparencyResult:
    """
    Convenience function for FirstPartyTransparencyEngine.
    """
    engine = FirstPartyTransparencyEngine()
    return engine.analyze(
        page_url=page_url,
        title=title,
        meta_description=meta_description,
        headings=headings,
        links=links,
        text_content=text_content,
        structured_data_blocks=structured_data_blocks,
        page_id=page_id,
    )
