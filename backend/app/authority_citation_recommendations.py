"""
Findings and Recommendations Engine for Authority, Citation & Trust Intelligence
(Day 8 - Phase B - Step 10 ONLY)

Establishes deterministic, traceable finding creation and recommendation generation for:
1. Trust Intelligence
2. Authority Signals
3. External Source Detection
4. Claim Support & Associations
5. Source Quality & Usability
6. First-Party Transparency
7. Structural Citation Readiness

Strict architectural rules:
- Evidence != Conclusion: Findings record observed structural gaps without fake scores or ungrounded claims.
- Reuses existing Finding (FindingCreate/FindingResponse) and Recommendation (RecommendationCreate/RecommendationResponse) architecture.
- Full idempotency and deduplication across repeated runs.
"""

from datetime import datetime, timezone
from typing import Any
from sqlalchemy.orm import Session

from .models import Finding, PageResult, Recommendation, Scan, Website
from .schemas import FindingCreate, FindingResponse, RecommendationCreate, RecommendationResponse
from .recommendation_service import FINDING_RECOMMENDATION_MAP, normalize_priority, build_explainable_rationale
from .authority_citation_schemas import (
    AuthorityCitationTrustResult,
    ConfidenceLevel,
    SeverityLevel,
)


# =============================================================================
# Canonical Deterministic Rule-ID Registry
# =============================================================================

RULE_REGISTRY: dict[str, dict[str, Any]] = {
    # 1. Trust Namespace
    "trust_missing_identity": {
        "namespace": "trust",
        "finding_type": "missing_trust_signals",
        "category": "trust",
        "title": "Missing Core Business Identity Disclosures",
        "description": "Page lacks essential first-party trust disclosures such as organization name, physical/contact channels, or about page.",
        "default_severity": "high",
        "default_confidence": ConfidenceLevel.HIGH,
        "action_type": "add_trust_signals",
    },
    "trust_business_conflict": {
        "namespace": "trust",
        "finding_type": "business_name_conflict",
        "category": "trust",
        "title": "Inconsistent Business Entity Identity Across DOM and Schema",
        "description": "Discrepancy detected between organizational name in schema markup, page title, and copyright notices.",
        "default_severity": "medium",
        "default_confidence": ConfidenceLevel.HIGH,
        "action_type": "resolve_business_name_conflict",
    },

    # 2. Authority Namespace
    "authority_shallow_depth": {
        "namespace": "authority",
        "finding_type": "shallow_topical_depth",
        "category": "authority",
        "title": "Shallow Topical Depth and Subheading Structure",
        "description": "The content lacks comprehensive length and structural subheadings required for authoritative topic coverage.",
        "default_severity": "medium",
        "default_confidence": ConfidenceLevel.HIGH,
        "action_type": "expand_topical_content",
    },
    "authority_lacks_internal_links": {
        "namespace": "authority",
        "finding_type": "lacks_internal_supporting_links",
        "category": "authority",
        "title": "Missing Supporting Topic Cluster Internal Links",
        "description": "Content lacks contextual internal links connecting this page to broader topic clusters.",
        "default_severity": "low",
        "default_confidence": ConfidenceLevel.MEDIUM,
        "action_type": "add_internal_supporting_links",
    },
    "authority_missing_credentials": {
        "namespace": "authority",
        "finding_type": "missing_author_credentials",
        "category": "authority",
        "title": "Missing Author Credentials & Expertise Disclosures",
        "description": "Substantive technical content is published without attributed author academic or clinical credentials.",
        "default_severity": "medium",
        "default_confidence": ConfidenceLevel.HIGH,
        "action_type": "add_author_credentials",
    },

    # 3. Source Namespace
    "source_excessive_commercial_links": {
        "namespace": "source",
        "finding_type": "excessive_unbacked_commercial_links",
        "category": "citation",
        "title": "Excessive Commercial / Affiliate Outbound Links",
        "description": "Outbound links are heavily skewed toward commercial affiliate or sponsored links without reference citations.",
        "default_severity": "medium",
        "default_confidence": ConfidenceLevel.HIGH,
        "action_type": "balance_outbound_links",
    },

    # 4. Claim Support Namespace
    "claim_unsupported_statistical": {
        "namespace": "claim_support",
        "finding_type": "unsupported_statistical_claim",
        "category": "citation",
        "title": "Unreferenced Quantitative & Statistical Claims",
        "description": "High-impact empirical percentages or exact metrics are presented without verifiable source citations.",
        "default_severity": "medium",
        "default_confidence": ConfidenceLevel.HIGH,
        "action_type": "add_source_citations",
    },
    "claim_unsupported_superlative": {
        "namespace": "claim_support",
        "finding_type": "unsupported_superlative_claim",
        "category": "citation",
        "title": "Unbacked Superlative Assertions",
        "description": "Strong subjective assertions ('the best', 'unrivaled') lack third-party comparative study citations.",
        "default_severity": "low",
        "default_confidence": ConfidenceLevel.MEDIUM,
        "action_type": "tone_down_superlatives",
    },

    # 5. Source Quality Namespace
    "source_broken_reference_link": {
        "namespace": "source_quality",
        "finding_type": "broken_reference_link",
        "category": "citation",
        "title": "Inaccessible or Broken Outbound Reference Links",
        "description": "Outbound reference citations return error status codes or have invalid destination URLs.",
        "default_severity": "high",
        "default_confidence": ConfidenceLevel.HIGH,
        "action_type": "repair_broken_citations",
    },
    "source_generic_anchor_text": {
        "namespace": "source_quality",
        "finding_type": "generic_citation_anchor_text",
        "category": "citation",
        "title": "Source Links Using Generic Non-Descriptive Anchor Text",
        "description": "Citation links use generic phrases ('click here', 'link') instead of descriptive study or dataset titles.",
        "default_severity": "low",
        "default_confidence": ConfidenceLevel.HIGH,
        "action_type": "enhance_citation_anchors",
    },

    # 6. First-Party Transparency Namespace
    "transparency_missing_first_party": {
        "namespace": "transparency",
        "finding_type": "missing_first_party_transparency",
        "category": "trust",
        "title": "Deficient First-Party Transparency Disclosures",
        "description": "Page lacks essential first-party disclosures such as author attribution, organization identity, and verifiable contact channels.",
        "default_severity": "high",
        "default_confidence": ConfidenceLevel.HIGH,
        "action_type": "add_transparency_disclosures",
    },
    "transparency_contact_conflict": {
        "namespace": "transparency",
        "finding_type": "contact_identity_conflict",
        "category": "trust",
        "title": "Contact Email Domain Inconsistency",
        "description": "The contact email address uses a public webmail provider rather than the official domain.",
        "default_severity": "low",
        "default_confidence": ConfidenceLevel.HIGH,
        "action_type": "align_contact_domain",
    },

    # 7. Citation Readiness Namespace
    "readiness_low_structural_citation": {
        "namespace": "citation_readiness",
        "finding_type": "low_structural_citation_readiness",
        "category": "citation",
        "title": "Low Structural Citation Readiness",
        "description": "The content lacks verifiable external reference citations for empirical claims and exhibits transparency gaps.",
        "default_severity": "high",
        "default_confidence": ConfidenceLevel.HIGH,
        "action_type": "enhance_citation_readiness",
    },
}

# Reverse lookup from finding_type to rule_id
FINDING_TYPE_TO_RULE_ID: dict[str, str] = {
    v["finding_type"]: k for k, v in RULE_REGISTRY.items()
}


# =============================================================================
# Helper Functions
# =============================================================================

def get_rule_by_id(rule_id: str) -> dict[str, Any] | None:
    """
    Retrieves the canonical rule definition by rule ID.
    """
    return RULE_REGISTRY.get(rule_id)


def get_rule_by_finding_type(finding_type: str) -> tuple[str, dict[str, Any]] | None:
    """
    Retrieves the rule ID and rule definition by finding_type.
    """
    if finding_type in RULE_REGISTRY:
        return (finding_type, RULE_REGISTRY[finding_type])
    rule_id = FINDING_TYPE_TO_RULE_ID.get(finding_type)
    if rule_id:
        return (rule_id, RULE_REGISTRY[rule_id])
    return None


def create_deterministic_finding(
    rule_id: str,
    evidence: dict[str, Any] | list[Any] | None = None,
    page_id: int | None = None,
    custom_description: str | None = None,
    severity: str | None = None,
    status: str = "open",
) -> FindingCreate:
    """
    Factory function to create a validated FindingCreate object from a deterministic rule ID.
    """
    rule = get_rule_by_id(rule_id)
    if not rule:
        # Fallback to finding_type lookup
        matched = get_rule_by_finding_type(rule_id)
        if matched:
            rule_id, rule = matched
        else:
            raise ValueError(f"Unknown rule ID or finding type: '{rule_id}'")

    return FindingCreate(
        page_id=page_id,
        finding_type=rule["finding_type"],
        category=rule["category"],
        title=rule["title"],
        description=custom_description or rule["description"],
        severity=severity or rule["default_severity"],
        status=status,
        evidence=evidence,
    )


def map_finding_to_recommendation(
    finding: FindingCreate | FindingResponse | Finding,
    page_url: str | None = None,
) -> RecommendationCreate:
    """
    Deterministically maps any Finding into an actionable RecommendationCreate object.
    """
    ftype = getattr(finding, "finding_type", None) or getattr(finding, "type", "general_finding")
    mapping = FINDING_RECOMMENDATION_MAP.get(
        ftype,
        {
            "action_type": f"remediate_{ftype}",
            "category": getattr(finding, "category", "seo"),
            "title": f"Resolve {getattr(finding, 'title', ftype)}",
            "what": f"Take corrective action to resolve {getattr(finding, 'description', '')}",
            "expected_benefit": "Improves authority, citation readiness, and search intelligence signals.",
            "effort": "medium",
        },
    )

    action_type = mapping["action_type"]
    category = mapping.get("category", getattr(finding, "category", "citation"))
    effort = mapping.get("effort", "medium")
    severity = getattr(finding, "severity", "medium")
    priority = normalize_priority(severity)

    why_desc = f"Identified issue '{getattr(finding, 'title', '')}': {getattr(finding, 'description', '')}"
    what_desc = mapping["what"]
    benefit_desc = mapping["expected_benefit"]
    where_desc = f"Page {page_url}" if page_url else f"Page ID #{getattr(finding, 'page_id', 'N/A')}"

    rationale = build_explainable_rationale(
        why=why_desc,
        what=what_desc,
        where=where_desc,
        benefit=benefit_desc,
        effort=effort,
    )

    payload = {
        "finding_type": ftype,
        "category": category,
        "effort": effort,
        "why": why_desc,
        "what": what_desc,
        "where": where_desc,
        "expected_benefit": benefit_desc,
        "recommended_action": what_desc,
        "rationale": rationale,
        "page_id": getattr(finding, "page_id", None),
        "evidence": getattr(finding, "evidence", None),
    }

    return RecommendationCreate(
        title=mapping["title"],
        description=f"{what_desc} ({benefit_desc})",
        priority=priority,
        status="open",
        impact=benefit_desc,
        action_type=action_type,
        payload=payload,
    )


def map_result_to_findings_and_recommendations(
    result: AuthorityCitationTrustResult,
    page_id: int | None = None,
    page_url: str | None = None,
) -> tuple[list[FindingCreate], list[RecommendationCreate]]:
    """
    Extracts, normalizes, and generates actionable RecommendationCreate items for all findings in an AuthorityCitationTrustResult.
    """
    effective_page_id = page_id or result.page_id
    effective_url = page_url or result.url

    findings_out: list[FindingCreate] = []
    recommendations_out: list[RecommendationCreate] = []
    seen_types: set[str] = set()

    for f in result.findings:
        ftype = getattr(f, "finding_type", None) or getattr(f, "type", None)
        if not ftype or ftype in seen_types:
            continue

        fc = FindingCreate(
            page_id=effective_page_id,
            finding_type=ftype,
            category=getattr(f, "category", "authority"),
            title=getattr(f, "title", "Authority/Citation Finding"),
            description=getattr(f, "description", ""),
            severity=getattr(f, "severity", "medium"),
            status=getattr(f, "status", "open"),
            evidence=getattr(f, "evidence", None),
        )
        findings_out.append(fc)
        seen_types.add(ftype)

        rec = map_finding_to_recommendation(fc, page_url=effective_url)
        recommendations_out.append(rec)

    return (findings_out, recommendations_out)


def persist_authority_citation_findings_and_recommendations(
    db: Session,
    scan_id: int,
    page_id: int | None,
    findings: list[FindingCreate],
    website_id: int | None = None,
) -> tuple[list[Finding], list[Recommendation]]:
    """
    Persists findings and generates actionable recommendations into the database
    with complete idempotency and deduplication.
    """
    scan = db.get(Scan, scan_id)
    if not scan:
        raise ValueError(f"Scan #{scan_id} not found")

    target_website_id = website_id or scan.website_id

    persisted_findings: list[Finding] = []
    persisted_recommendations: list[Recommendation] = []

    for fc in findings:
        # Check existing finding for idempotency
        query = db.query(Finding).filter(
            Finding.scan_id == scan_id,
            Finding.finding_type == fc.finding_type,
        )
        if page_id is not None:
            query = query.filter(Finding.page_id == page_id)
        else:
            query = query.filter(Finding.page_id.is_(None))

        existing_finding = query.first()

        if existing_finding:
            existing_finding.title = fc.title
            existing_finding.description = fc.description
            existing_finding.severity = fc.severity
            existing_finding.status = fc.status
            existing_finding.evidence = fc.evidence
            db.commit()
            db.refresh(existing_finding)
            finding_obj = existing_finding
        else:
            finding_obj = Finding(
                website_id=target_website_id,
                scan_id=scan_id,
                page_id=page_id,
                finding_type=fc.finding_type,
                category=fc.category,
                title=fc.title,
                description=fc.description,
                severity=fc.severity,
                status=fc.status,
                evidence=fc.evidence,
            )
            db.add(finding_obj)
            db.commit()
            db.refresh(finding_obj)

        persisted_findings.append(finding_obj)

        # Generate / Update Recommendation for this finding
        page_res = db.get(PageResult, page_id) if page_id else None
        page_url = page_res.url if page_res else None

        rec_create = map_finding_to_recommendation(finding_obj, page_url=page_url)
        action_type = rec_create.action_type or f"remediate_{finding_obj.finding_type}"

        # Deduplication check for recommendation
        existing_rec = (
            db.query(Recommendation)
            .filter(
                Recommendation.finding_id == finding_obj.id,
                Recommendation.action_type == action_type,
            )
            .first()
        )

        if existing_rec:
            existing_rec.title = rec_create.title
            existing_rec.description = rec_create.description
            existing_rec.priority = rec_create.priority
            existing_rec.impact = rec_create.impact
            existing_rec.payload = rec_create.payload
            db.commit()
            db.refresh(existing_rec)
            persisted_recommendations.append(existing_rec)
        else:
            rec_obj = Recommendation(
                finding_id=finding_obj.id,
                title=rec_create.title,
                description=rec_create.description,
                priority=rec_create.priority,
                status=rec_create.status,
                impact=rec_create.impact,
                action_type=action_type,
                payload=rec_create.payload,
            )
            db.add(rec_obj)
            db.commit()
            db.refresh(rec_obj)
            persisted_recommendations.append(rec_obj)

    return (persisted_findings, persisted_recommendations)


def _extract_page_details(page: PageResult) -> dict[str, Any]:
    """
    Extracts raw or structured page properties for authority/citation/trust signal analysis.
    """
    title = None
    headings: list[dict[str, Any]] = []
    links: list[dict[str, Any]] = []
    structured_data: list[Any] = []
    meta_description = None
    text_content = None

    if page.extraction:
        title = page.extraction.title_text
        if page.extraction.headings:
            headings = [{"level": h.level, "text": h.text} for h in page.extraction.headings]
        if page.extraction.links:
            links = [
                {
                    "url": getattr(l, "destination_url", None) or getattr(l, "url", None),
                    "anchor_text": getattr(l, "anchor_text", None),
                    "rel": getattr(l, "rel_raw", None) or getattr(l, "rel", None),
                    "is_internal": (getattr(l, "link_type", "") == "internal") if getattr(l, "link_type", None) else getattr(l, "is_internal", False),
                    "is_external": (getattr(l, "link_type", "") == "external") if getattr(l, "link_type", None) else getattr(l, "is_external", False),
                }
                for l in page.extraction.links
            ]
        if page.extraction.structured_data:
            structured_data = [
                s.raw_json or s.parsed_json or s.schema_type
                for s in page.extraction.structured_data
            ]
        if page.extraction.meta_descriptions:
            meta_description = page.extraction.meta_descriptions[0].content
        text_content = page.extraction.main_content_candidate

    if (not text_content or not links) and page.content:
        try:
            from .page_extractor import extract_html
            ext = extract_html(page.content, page_url=page.url)
            text_content = text_content or ext.clean_text
            title = title or ext.title_text
            headings = headings or ext.headings
            links = links or ext.links
            structured_data = structured_data or ext.structured_data
            meta_description = meta_description or ext.meta_description
        except Exception:
            import re
            clean_html = re.sub(r"(?is)<(script|style|svg|noscript).*?>.*?</\1>", " ", page.content)
            text_content = text_content or re.sub(r"<[^>]+>", " ", clean_html).strip()

    return {
        "text_content": text_content or "",
        "title": title,
        "headings": headings,
        "links": links,
        "structured_data": structured_data,
        "meta_description": meta_description,
        "page_url": page.url,
        "page_id": page.id,
        "scan_id": page.scan_id,
    }


def analyze_page_authority_citation_trust(
    db: Session,
    page_id: int,
    persist_findings: bool = False,
) -> AuthorityCitationTrustResult:
    """
    Executes the unified Authority, Citation & Trust Intelligence analysis pipeline on a PageResult.
    """
    page = db.get(PageResult, page_id)
    if page is None:
        raise ValueError(f"Page #{page_id} not found")

    details = _extract_page_details(page)

    from .trust_engine import analyze_trust_signals
    from .authority_engine import analyze_authority_signals
    from .source_engine import detect_external_sources
    from .source_quality_engine import evaluate_source_quality
    from .claim_support_engine import analyze_claim_support
    from .transparency_engine import analyze_first_party_transparency
    from .citation_readiness_engine import CitationReadinessEngine

    trust_res = analyze_trust_signals(
        text_content=details["text_content"],
        links=details["links"],
        structured_data_blocks=details["structured_data"],
        page_url=details["page_url"],
        page_id=page.id,
    )
    auth_res = analyze_authority_signals(
        text_content=details["text_content"],
        headings=details["headings"],
        links=details["links"],
        structured_data_blocks=details["structured_data"],
        title=details["title"],
        page_url=details["page_url"],
        page_id=page.id,
    )
    source_res = detect_external_sources(
        links=details["links"],
        text_content=details["text_content"],
        page_url=details["page_url"],
        page_id=page.id,
    )
    quality_res = evaluate_source_quality(
        sources=source_res.sources,
        page_url=details["page_url"],
        page_id=page.id,
    )
    claim_res = analyze_claim_support(
        text_content=details["text_content"],
        headings=details["headings"],
        external_sources=source_res.sources,
        page_url=details["page_url"],
        page_id=page.id,
    )
    transp_res = analyze_first_party_transparency(
        text_content=details["text_content"],
        title=details["title"],
        meta_description=details["meta_description"],
        headings=details["headings"],
        links=details["links"],
        structured_data_blocks=details["structured_data"],
        page_url=details["page_url"],
        page_id=page.id,
    )

    scan = db.get(Scan, page.scan_id)
    website_id = scan.website_id if scan else None

    engine = CitationReadinessEngine()
    unified_result = engine.build_unified_result(
        page_url=details["page_url"],
        page_id=page.id,
        scan_id=page.scan_id,
        website_id=website_id,
        trust_result=trust_res,
        authority_result=auth_res,
        source_result=source_res,
        claim_support_result=claim_res,
        source_quality_result=quality_res,
        transparency_result=transp_res,
    )

    findings_create, recommendations_create = map_result_to_findings_and_recommendations(
        result=unified_result,
        page_id=page.id,
        page_url=page.url,
    )
    unified_result.findings = findings_create
    unified_result.recommendations = recommendations_create

    if persist_findings and findings_create:
        persist_authority_citation_findings_and_recommendations(
            db=db,
            scan_id=page.scan_id,
            page_id=page.id,
            findings=findings_create,
            website_id=website_id,
        )

    return unified_result


def analyze_scan_authority_citation_trust(
    db: Session,
    scan_id: int,
    persist_findings: bool = False,
) -> list[AuthorityCitationTrustResult]:
    """
    Executes the unified Authority, Citation & Trust Intelligence analysis pipeline across all pages of a Scan.
    """
    scan = db.get(Scan, scan_id)
    if scan is None:
        raise ValueError(f"Scan #{scan_id} not found")

    pages = (
        db.query(PageResult)
        .filter(PageResult.scan_id == scan_id)
        .order_by(PageResult.id)
        .all()
    )

    results: list[AuthorityCitationTrustResult] = []
    for page in pages:
        res = analyze_page_authority_citation_trust(
            db=db,
            page_id=page.id,
            persist_findings=persist_findings,
        )
        results.append(res)

    return results


def analyze_website_authority_citation_trust(
    db: Session,
    website_id: int,
    persist_findings: bool = False,
) -> list[AuthorityCitationTrustResult]:
    """
    Executes the unified Authority, Citation & Trust Intelligence analysis pipeline across the latest scan of a Website.
    """
    website = db.get(Website, website_id)
    if website is None:
        raise ValueError(f"Website #{website_id} not found")

    latest_scan = (
        db.query(Scan)
        .filter(Scan.website_id == website_id)
        .order_by(Scan.id.desc())
        .first()
    )
    if not latest_scan:
        return []

    return analyze_scan_authority_citation_trust(
        db=db,
        scan_id=latest_scan.id,
        persist_findings=persist_findings,
    )


def analyze_direct_authority_citation_trust(
    payload: Any,
) -> AuthorityCitationTrustResult:
    """
    Analyzes an ad-hoc / direct payload for Authority, Citation & Trust signals without requiring DB records.
    """
    page_url = getattr(payload, "url", None)
    text_content = getattr(payload, "text_content", None)
    title = getattr(payload, "title", None)
    headings = getattr(payload, "headings", None) or []
    links = getattr(payload, "links", None) or []
    structured_data = getattr(payload, "structured_data", None) or []
    meta_description = getattr(payload, "meta_description", None)
    page_id = getattr(payload, "page_id", None)
    html = getattr(payload, "html", None)

    if html:
        try:
            from .page_extractor import extract_html
            ext = extract_html(html, page_url=page_url)
            text_content = text_content or ext.clean_text
            title = title or ext.title_text
            headings = headings or ext.headings
            links = links or ext.links
            structured_data = structured_data or ext.structured_data
            meta_description = meta_description or ext.meta_description
        except Exception:
            import re
            clean_html = re.sub(r"(?is)<(script|style|svg|noscript).*?>.*?</\1>", " ", html)
            text_content = text_content or re.sub(r"<[^>]+>", " ", clean_html).strip()

    from .trust_engine import analyze_trust_signals
    from .authority_engine import analyze_authority_signals
    from .source_engine import detect_external_sources
    from .source_quality_engine import evaluate_source_quality
    from .claim_support_engine import analyze_claim_support
    from .transparency_engine import analyze_first_party_transparency
    from .citation_readiness_engine import CitationReadinessEngine

    trust_res = analyze_trust_signals(
        text_content=text_content,
        links=links,
        structured_data_blocks=structured_data,
        page_url=page_url,
        page_id=page_id,
    )
    auth_res = analyze_authority_signals(
        text_content=text_content,
        headings=headings,
        links=links,
        structured_data_blocks=structured_data,
        title=title,
        page_url=page_url,
        page_id=page_id,
    )
    source_res = detect_external_sources(
        links=links,
        text_content=text_content,
        page_url=page_url,
        page_id=page_id,
    )
    quality_res = evaluate_source_quality(
        sources=source_res.sources,
        page_url=page_url,
        page_id=page_id,
    )
    claim_res = analyze_claim_support(
        text_content=text_content,
        headings=headings,
        external_sources=source_res.sources,
        page_url=page_url,
        page_id=page_id,
    )
    transp_res = analyze_first_party_transparency(
        text_content=text_content,
        title=title,
        meta_description=meta_description,
        headings=headings,
        links=links,
        structured_data_blocks=structured_data,
        page_url=page_url,
        page_id=page_id,
    )

    engine = CitationReadinessEngine()
    unified_result = engine.build_unified_result(
        page_url=page_url,
        page_id=page_id,
        trust_result=trust_res,
        authority_result=auth_res,
        source_result=source_res,
        claim_support_result=claim_res,
        source_quality_result=quality_res,
        transparency_result=transp_res,
    )

    findings_create, recommendations_create = map_result_to_findings_and_recommendations(
        result=unified_result,
        page_id=page_id,
        page_url=page_url,
    )
    unified_result.findings = findings_create
    unified_result.recommendations = recommendations_create

    return unified_result

