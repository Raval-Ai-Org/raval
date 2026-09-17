"""
Recommendation Service (Task 6.3)
Implements deterministic Recommendation Engine that converts findings and opportunities
into actionable, explainable, prioritized recommendations with deduplication and traceability.
"""

from datetime import datetime
from typing import Any
from sqlalchemy.orm import Session

from .models import Finding, Opportunity, PageResult, Recommendation, Scan, Website
from .schemas import RecommendationCreate, RecommendationUpdate

ALLOWED_RECOMMENDATION_PRIORITIES = {"low", "medium", "high", "critical"}
ALLOWED_RECOMMENDATION_STATUSES = {"open", "in_progress", "resolved", "dismissed"}

ALLOWED_RECOMMENDATION_CATEGORIES = {
    "technical_seo",
    "content",
    "aeo",
    "geo",
    "entity",
    "structured_data",
    "internal_linking",
    "crawlability",
    "page_level",
    "seo",
    "quality",
    "citation",
    "trust",
    "authority",
}

# Finding type to action_type, category, and action details
FINDING_RECOMMENDATION_MAP: dict[str, dict[str, Any]] = {
    "missing_title": {
        "action_type": "meta_tag_fix",
        "category": "technical_seo",
        "title": "Add Descriptive Title Tag",
        "what": "Add a unique <title> tag between 50-60 characters incorporating primary keywords.",
        "expected_benefit": "Improves organic CTR, snippet display, and search indexing relevance.",
        "effort": "low",
    },
    "missing_meta_description": {
        "action_type": "meta_tag_fix",
        "category": "technical_seo",
        "title": "Add Compelling Meta Description",
        "what": "Author a high-CTR meta description between 120-160 characters summarizing the page.",
        "expected_benefit": "Increases organic click-through rates and snippet relevance.",
        "effort": "low",
    },
    "missing_h1": {
        "action_type": "heading_fix",
        "category": "content",
        "title": "Add Single Primary H1 Heading",
        "what": "Include exactly one prominent H1 element reflecting the page's primary topic.",
        "expected_benefit": "Clarifies topical hierarchy for search crawlers and AI answer extractors.",
        "effort": "low",
    },
    "multiple_h1": {
        "action_type": "heading_fix",
        "category": "content",
        "title": "Consolidate Multiple H1 Headings",
        "what": "Restructure secondary H1 headings into H2/H3 subheadings.",
        "expected_benefit": "Establishes unambiguous document structure and topical authority.",
        "effort": "low",
    },
    "heading_level_skip": {
        "action_type": "heading_fix",
        "category": "content",
        "title": "Repair Heading Hierarchy Skips",
        "what": "Ensure headings ascend without skipping levels (e.g. H2 followed directly by H4).",
        "expected_benefit": "Optimizes content parsing for LLM snippet extraction and web accessibility.",
        "effort": "low",
    },
    "missing_faq_schema": {
        "action_type": "schema_markup",
        "category": "structured_data",
        "title": "Inject FAQPage Structured Data",
        "what": "Add valid JSON-LD FAQPage markup containing questions and concise direct answers.",
        "expected_benefit": "Enables rich snippets and boosts inclusion in Google AI Overviews and Perplexity answers.",
        "effort": "medium",
    },
    "unanswered_question": {
        "action_type": "content_expansion",
        "category": "aeo",
        "title": "Provide Direct Answers to Core User Queries",
        "what": "Add concise 40-60 word answer paragraphs immediately beneath question headings.",
        "expected_benefit": "Greatly improves AEO answer-readiness and Perplexity/Gemini citation probability.",
        "effort": "medium",
    },
    "content_gap": {
        "action_type": "content_expansion",
        "category": "content",
        "title": "Bridge Content Gap on Target Topic",
        "what": "Expand thin sections with authoritative explanations, data, and relevant subtopics.",
        "expected_benefit": "Enhances semantic depth, topical authority, and organic ranking potential.",
        "effort": "medium",
    },
    "entity_missing_authority_links": {
        "action_type": "entity_linking",
        "category": "entity",
        "title": "Link Entities to Authoritative Knowledge Bases",
        "what": "Add sameAs schema links to Wikipedia, Wikidata, or industry authority entities.",
        "expected_benefit": "Disambiguates brand and entity nodes in AI knowledge graphs.",
        "effort": "low",
    },
    "missing_internal_links": {
        "action_type": "internal_link_addition",
        "category": "internal_linking",
        "title": "Add Contextual Internal Links",
        "what": "Link relevant body anchor texts to high-value internal topic pages.",
        "expected_benefit": "Distributes link equity and guides search engine crawlers to orphaned content.",
        "effort": "medium",
    },
    "missing_canonical": {
        "action_type": "canonical_fix",
        "category": "crawlability",
        "title": "Set Self-Referencing Canonical Tag",
        "what": "Add rel='canonical' pointing to the authoritative URL version.",
        "expected_benefit": "Prevents duplicate content dilution and consolidates page ranking signals.",
        "effort": "low",
    },
    # Trust Intelligence Findings
    "missing_trust_signals": {
        "action_type": "add_trust_signals",
        "category": "trust",
        "title": "Publish Verifiable Organizational & Contact Disclosures",
        "what": "Add explicit organization identity, direct contact email/phone, and about page links in the footer and schema.",
        "expected_benefit": "Establishes critical first-party trust signals and entity transparency for AI search engines.",
        "effort": "low",
    },
    "trust_missing_identity": {
        "action_type": "add_trust_signals",
        "category": "trust",
        "title": "Publish Verifiable Organizational & Contact Disclosures",
        "what": "Add explicit organization identity, direct contact email/phone, and about page links in the footer and schema.",
        "expected_benefit": "Establishes critical first-party trust signals and entity transparency for AI search engines.",
        "effort": "low",
    },
    "business_name_conflict": {
        "action_type": "resolve_business_name_conflict",
        "category": "trust",
        "title": "Standardize Business Entity Names Across DOM and Metadata",
        "what": "Resolve naming discrepancies between schema markup, page title, and footer copyright.",
        "expected_benefit": "Eliminates entity confusion and clarifies brand identity in knowledge graphs.",
        "effort": "low",
    },
    "trust_business_conflict": {
        "action_type": "resolve_business_name_conflict",
        "category": "trust",
        "title": "Standardize Business Entity Names Across DOM and Metadata",
        "what": "Resolve naming discrepancies between schema markup, page title, and footer copyright.",
        "expected_benefit": "Eliminates entity confusion and clarifies brand identity in knowledge graphs.",
        "effort": "low",
    },
    # Authority Intelligence Findings
    "shallow_topical_depth": {
        "action_type": "expand_topical_content",
        "category": "authority",
        "title": "Expand Topical Depth and Heading Architecture",
        "what": "Enrich page content with comprehensive analysis and structured H2/H3 subheadings.",
        "expected_benefit": "Demonstrates deep subject-matter authority and fulfills exhaustive search intent.",
        "effort": "medium",
    },
    "authority_shallow_depth": {
        "action_type": "expand_topical_content",
        "category": "authority",
        "title": "Expand Topical Depth and Heading Architecture",
        "what": "Enrich page content with comprehensive analysis and structured H2/H3 subheadings.",
        "expected_benefit": "Demonstrates deep subject-matter authority and fulfills exhaustive search intent.",
        "effort": "medium",
    },
    "lacks_internal_supporting_links": {
        "action_type": "add_internal_supporting_links",
        "category": "authority",
        "title": "Build Contextual Topic Cluster Internal Links",
        "what": "Connect this page to supporting topic cluster sub-guides and domain methodology pages.",
        "expected_benefit": "Reinforces site-wide topic architecture and authority distribution.",
        "effort": "low",
    },
    "authority_lacks_internal_links": {
        "action_type": "add_internal_supporting_links",
        "category": "authority",
        "title": "Build Contextual Topic Cluster Internal Links",
        "what": "Connect this page to supporting topic cluster sub-guides and domain methodology pages.",
        "expected_benefit": "Reinforces site-wide topic architecture and authority distribution.",
        "effort": "low",
    },
    "missing_author_credentials": {
        "action_type": "add_author_credentials",
        "category": "authority",
        "title": "Disclose Author Degrees & Professional Credentials",
        "what": "Specify author qualifications (e.g. PhD, MD, Lead Engineer) and link to verified profiles.",
        "expected_benefit": "Validates E-E-A-T credentials for technical and YMYL topics.",
        "effort": "low",
    },
    "authority_missing_credentials": {
        "action_type": "add_author_credentials",
        "category": "authority",
        "title": "Disclose Author Degrees & Professional Credentials",
        "what": "Specify author qualifications (e.g. PhD, MD, Lead Engineer) and link to verified profiles.",
        "expected_benefit": "Validates E-E-A-T credentials for technical and YMYL topics.",
        "effort": "low",
    },
    # External Source Findings
    "excessive_unbacked_commercial_links": {
        "action_type": "balance_outbound_links",
        "category": "citation",
        "title": "Balance Commercial Links with Authoritative References",
        "what": "Reduce density of unbacked affiliate/sponsored links and introduce reputable external source citations.",
        "expected_benefit": "Reduces commercial dilution and elevates reference credibility.",
        "effort": "medium",
    },
    "source_excessive_commercial_links": {
        "action_type": "balance_outbound_links",
        "category": "citation",
        "title": "Balance Commercial Links with Authoritative References",
        "what": "Reduce density of unbacked affiliate/sponsored links and introduce reputable external source citations.",
        "expected_benefit": "Reduces commercial dilution and elevates reference credibility.",
        "effort": "medium",
    },
    # Claim Support Findings
    "unsupported_statistical_claim": {
        "action_type": "add_source_citations",
        "category": "citation",
        "title": "Attach Verifiable Citations to Quantitative Metrics",
        "what": "Provide direct outbound reference links or DOI citations to empirical trial datasets or studies.",
        "expected_benefit": "Corroborates quantitative claims and enhances citation confidence for LLMs.",
        "effort": "low",
    },
    "claim_unsupported_statistical": {
        "action_type": "add_source_citations",
        "category": "citation",
        "title": "Attach Verifiable Citations to Quantitative Metrics",
        "what": "Provide direct outbound reference links or DOI citations to empirical trial datasets or studies.",
        "expected_benefit": "Corroborates quantitative claims and enhances citation confidence for LLMs.",
        "effort": "low",
    },
    "unsupported_superlative_claim": {
        "action_type": "tone_down_superlatives",
        "category": "citation",
        "title": "Cite Independent Benchmarks or Neutralize Superlatives",
        "what": "Cite third-party comparative research or adopt objective technical terminology.",
        "expected_benefit": "Improves factual credibility and avoids subjective marketing bias.",
        "effort": "low",
    },
    "claim_unsupported_superlative": {
        "action_type": "tone_down_superlatives",
        "category": "citation",
        "title": "Cite Independent Benchmarks or Neutralize Superlatives",
        "what": "Cite third-party comparative research or adopt objective technical terminology.",
        "expected_benefit": "Improves factual credibility and avoids subjective marketing bias.",
        "effort": "low",
    },
    # Source Quality Findings
    "broken_reference_link": {
        "action_type": "repair_broken_citations",
        "category": "citation",
        "title": "Repair Broken Outbound Reference Links",
        "what": "Replace inaccessible or 404 citation links with active permanent URLs or DOI records.",
        "expected_benefit": "Restores citation integrity and user verification accessibility.",
        "effort": "low",
    },
    "source_broken_reference_link": {
        "action_type": "repair_broken_citations",
        "category": "citation",
        "title": "Repair Broken Outbound Reference Links",
        "what": "Replace inaccessible or 404 citation links with active permanent URLs or DOI records.",
        "expected_benefit": "Restores citation integrity and user verification accessibility.",
        "effort": "low",
    },
    "generic_citation_anchor_text": {
        "action_type": "enhance_citation_anchors",
        "category": "citation",
        "title": "Adopt Descriptive Semantic Anchor Text for Citations",
        "what": "Replace generic 'click here' or URL-literal anchors with specific study or publication names.",
        "expected_benefit": "Clarifies cited source semantics for assistive technology and citation scrapers.",
        "effort": "low",
    },
    "source_generic_anchor_text": {
        "action_type": "enhance_citation_anchors",
        "category": "citation",
        "title": "Adopt Descriptive Semantic Anchor Text for Citations",
        "what": "Replace generic 'click here' or URL-literal anchors with specific study or publication names.",
        "expected_benefit": "Clarifies cited source semantics for assistive technology and citation scrapers.",
        "effort": "low",
    },
    # First-Party Transparency Findings
    "missing_first_party_transparency": {
        "action_type": "add_transparency_disclosures",
        "category": "trust",
        "title": "Complete First-Party Transparency Disclosures",
        "what": "Provide transparent organization identity, author attribution, and direct contact options.",
        "expected_benefit": "Meets modern search engine and AI transparency quality guidelines.",
        "effort": "medium",
    },
    "transparency_missing_first_party": {
        "action_type": "add_transparency_disclosures",
        "category": "trust",
        "title": "Complete First-Party Transparency Disclosures",
        "what": "Provide transparent organization identity, author attribution, and direct contact options.",
        "expected_benefit": "Meets modern search engine and AI transparency quality guidelines.",
        "effort": "medium",
    },
    "contact_identity_conflict": {
        "action_type": "align_contact_domain",
        "category": "trust",
        "title": "Adopt Official Domain-Aligned Contact Email",
        "what": "Switch public webmail addresses (e.g. Gmail/Yahoo) to official domain-branded inboxes.",
        "expected_benefit": "Enhances commercial authenticity and brand consistency.",
        "effort": "low",
    },
    "transparency_contact_conflict": {
        "action_type": "align_contact_domain",
        "category": "trust",
        "title": "Adopt Official Domain-Aligned Contact Email",
        "what": "Switch public webmail addresses (e.g. Gmail/Yahoo) to official domain-branded inboxes.",
        "expected_benefit": "Enhances commercial authenticity and brand consistency.",
        "effort": "low",
    },
    # Citation Readiness Findings
    "low_structural_citation_readiness": {
        "action_type": "enhance_citation_readiness",
        "category": "citation",
        "title": "Elevate Structural Citation Readiness",
        "what": "Integrate primary research source citations for claims and establish author/publisher transparency.",
        "expected_benefit": "Qualifies content for authoritative AI retrieval, citation, and search synthesis.",
        "effort": "medium",
    },
    "readiness_low_structural_citation": {
        "action_type": "enhance_citation_readiness",
        "category": "citation",
        "title": "Elevate Structural Citation Readiness",
        "what": "Integrate primary research source citations for claims and establish author/publisher transparency.",
        "expected_benefit": "Qualifies content for authoritative AI retrieval, citation, and search synthesis.",
        "effort": "medium",
    },
}


def normalize_priority(pri: str | None) -> str:
    """
    Normalizes priority string into allowed set ('critical', 'high', 'medium', 'low').
    """
    p = str(pri or "").strip().lower()
    if p in ("critical", "severe"):
        return "critical"
    if p in ("high", "urgent"):
        return "high"
    if p in ("medium", "moderate"):
        return "medium"
    if p in ("low", "info"):
        return "low"
    return "medium"


def build_explainable_rationale(
    why: str,
    what: str,
    where: str,
    benefit: str,
    effort: str,
) -> str:
    """
    Constructs a human-readable, deterministic explanation of WHY, WHAT, WHERE, BENEFIT, and EFFORT.
    """
    return (
        f"WHY: {why} | "
        f"WHAT: {what} | "
        f"WHERE: {where} | "
        f"EXPECTED BENEFIT: {benefit} | "
        f"ESTIMATED EFFORT: {effort.capitalize()}."
    )


def generate_recommendation_from_finding(
    db: Session,
    finding_id: int,
    opportunity_id: int | None = None,
) -> Recommendation:
    """
    Deterministically generates an actionable Recommendation from a Finding.
    Applies deduplication: updates existing recommendation with matching (finding_id, action_type).
    """
    finding = db.get(Finding, finding_id)
    if finding is None:
        raise ValueError("Finding not found")

    finding_type = finding.finding_type or "general_finding"
    mapping = FINDING_RECOMMENDATION_MAP.get(
        finding_type,
        {
            "action_type": f"remediate_{finding_type}",
            "category": finding.category or "seo",
            "title": f"Resolve {finding.title}",
            "what": f"Take corrective action to resolve {finding.description}",
            "expected_benefit": "Improves site quality and search intelligence signals.",
            "effort": "medium",
        },
    )

    action_type = mapping["action_type"]
    category = mapping.get("category", finding.category or "seo")
    effort = mapping.get("effort", "medium")
    priority = normalize_priority(finding.severity)

    # Affected URL / location
    affected_url = finding.page_result.url if finding.page_result else f"Website #{finding.website_id}"
    where_desc = f"Page {affected_url}" if finding.page_result else f"Domain-wide for website #{finding.website_id}"
    why_desc = f"Identified issue '{finding.title}': {finding.description}"
    what_desc = mapping["what"]
    benefit_desc = mapping["expected_benefit"]

    rationale = build_explainable_rationale(
        why=why_desc,
        what=what_desc,
        where=where_desc,
        benefit=benefit_desc,
        effort=effort,
    )

    payload = {
        "finding_id": finding.id,
        "opportunity_id": opportunity_id,
        "category": category,
        "effort": effort,
        "why": why_desc,
        "what": what_desc,
        "where": where_desc,
        "expected_benefit": benefit_desc,
        "recommended_action": what_desc,
        "rationale": rationale,
        "page_id": finding.page_id,
        "scan_id": finding.scan_id,
        "website_id": finding.website_id,
        "evidence": finding.evidence,
    }

    # Deduplication check
    existing = (
        db.query(Recommendation)
        .filter(
            Recommendation.finding_id == finding.id,
            Recommendation.action_type == action_type,
        )
        .first()
    )

    if existing is not None:
        existing.title = mapping["title"]
        existing.description = f"{what_desc} ({benefit_desc})"
        existing.priority = priority
        existing.impact = benefit_desc
        existing.payload = payload
        db.commit()
        db.refresh(existing)
        return existing

    recommendation = Recommendation(
        finding_id=finding.id,
        title=mapping["title"],
        description=f"{what_desc} ({benefit_desc})",
        priority=priority,
        status="open",
        impact=benefit_desc,
        action_type=action_type,
        payload=payload,
    )

    db.add(recommendation)
    db.commit()
    db.refresh(recommendation)

    # Link back to Opportunity if specified
    if opportunity_id:
        op = db.get(Opportunity, opportunity_id)
        if op and op.recommendation_id is None:
            op.recommendation_id = recommendation.id
            db.commit()

    return recommendation


def generate_recommendation_from_opportunity(
    db: Session,
    opportunity_id: int,
) -> Recommendation:
    """
    Deterministically generates an actionable Recommendation from an Opportunity.
    Preserves priority, impact, effort, and source finding relationships.
    """
    opportunity = db.get(Opportunity, opportunity_id)
    if opportunity is None:
        raise ValueError("Opportunity not found")

    finding_id = opportunity.finding_id
    if not finding_id:
        # If opportunity has no direct finding, check website findings or create default finding
        findings = db.query(Finding).filter(Finding.website_id == opportunity.website_id).all()
        if findings:
            finding_id = findings[0].id
        else:
            # Create synthetic foundation finding for orphan opportunity
            synthetic = Finding(
                website_id=opportunity.website_id,
                scan_id=opportunity.scan_id,
                page_id=opportunity.page_id,
                finding_type=opportunity.opportunity_type,
                category=opportunity.category,
                title=f"Source finding for {opportunity.title}",
                description=opportunity.description,
                severity=opportunity.priority.lower(),
                status="open",
            )
            db.add(synthetic)
            db.commit()
            db.refresh(synthetic)
            finding_id = synthetic.id
            opportunity.finding_id = finding_id
            db.commit()

    priority = normalize_priority(opportunity.priority)
    effort_str = "low" if opportunity.effort <= 0.35 else "high" if opportunity.effort >= 0.70 else "medium"

    action_type = f"execute_{opportunity.opportunity_type}"
    category = opportunity.category or "seo"
    affected_url = opportunity.page_result.url if opportunity.page_result else f"Website #{opportunity.website_id}"
    where_desc = f"Page {affected_url}" if opportunity.page_result else f"Website #{opportunity.website_id}"
    why_desc = f"High ROI opportunity '{opportunity.title}' (Priority Score: {opportunity.priority_score:.2f}): {opportunity.rationale}"
    what_desc = f"Implement optimization for {opportunity.title}: {opportunity.description}"
    benefit_desc = f"Normalized expected impact: {opportunity.impact:.2f}. Boosts search and AI answer readiness."

    rationale = build_explainable_rationale(
        why=why_desc,
        what=what_desc,
        where=where_desc,
        benefit=benefit_desc,
        effort=effort_str,
    )

    payload = {
        "finding_id": finding_id,
        "opportunity_id": opportunity.id,
        "category": category,
        "effort": effort_str,
        "why": why_desc,
        "what": what_desc,
        "where": where_desc,
        "expected_benefit": benefit_desc,
        "recommended_action": what_desc,
        "rationale": rationale,
        "priority_score": opportunity.priority_score,
        "page_id": opportunity.page_id,
        "scan_id": opportunity.scan_id,
        "website_id": opportunity.website_id,
        "evidence": opportunity.evidence,
    }

    # Deduplication check
    existing = (
        db.query(Recommendation)
        .filter(
            Recommendation.finding_id == finding_id,
            Recommendation.action_type == action_type,
        )
        .first()
    )

    if existing is not None:
        existing.title = f"Implement {opportunity.title}"
        existing.description = what_desc
        existing.priority = priority
        existing.impact = benefit_desc
        existing.payload = payload
        db.commit()
        db.refresh(existing)
        if opportunity.recommendation_id != existing.id:
            opportunity.recommendation_id = existing.id
            db.commit()
        return existing

    recommendation = Recommendation(
        finding_id=finding_id,
        title=f"Implement {opportunity.title}",
        description=what_desc,
        priority=priority,
        status="open",
        impact=benefit_desc,
        action_type=action_type,
        payload=payload,
    )

    db.add(recommendation)
    db.commit()
    db.refresh(recommendation)

    opportunity.recommendation_id = recommendation.id
    db.commit()

    return recommendation


def generate_recommendations_for_scan(
    db: Session,
    scan_id: int,
) -> list[Recommendation]:
    """
    Batch-generates recommendations for all findings and opportunities in a scan.
    """
    scan = db.get(Scan, scan_id)
    if scan is None:
        raise ValueError("Scan not found")

    findings = db.query(Finding).filter(Finding.scan_id == scan_id).order_by(Finding.id).all()
    opportunities = db.query(Opportunity).filter(Opportunity.scan_id == scan_id).all()

    generated: list[Recommendation] = []
    # 1. Opportunities first (carry priority scores)
    for op in opportunities:
        rec = generate_recommendation_from_opportunity(db, op.id)
        if rec not in generated:
            generated.append(rec)

    # 2. Remaining findings without recommendation
    for f in findings:
        existing_recs = db.query(Recommendation).filter(Recommendation.finding_id == f.id).all()
        if not existing_recs:
            rec = generate_recommendation_from_finding(db, f.id)
            if rec not in generated:
                generated.append(rec)

    # Sort descending by priority: critical -> high -> medium -> low
    priority_order = {"critical": 4, "high": 3, "medium": 2, "low": 1}
    generated.sort(key=lambda r: priority_order.get(r.priority.lower(), 0), reverse=True)
    return generated


def generate_recommendations_for_website(
    db: Session,
    website_id: int,
) -> list[Recommendation]:
    """
    Batch-generates recommendations across all findings/opportunities for a website.
    """
    website = db.get(Website, website_id)
    if website is None:
        raise ValueError("Website not found")

    findings = db.query(Finding).filter(Finding.website_id == website_id).order_by(Finding.id).all()
    opportunities = db.query(Opportunity).filter(Opportunity.website_id == website_id).all()

    generated: list[Recommendation] = []
    for op in opportunities:
        rec = generate_recommendation_from_opportunity(db, op.id)
        if rec not in generated:
            generated.append(rec)

    for f in findings:
        existing_recs = db.query(Recommendation).filter(Recommendation.finding_id == f.id).all()
        if not existing_recs:
            rec = generate_recommendation_from_finding(db, f.id)
            if rec not in generated:
                generated.append(rec)

    priority_order = {"critical": 4, "high": 3, "medium": 2, "low": 1}
    generated.sort(key=lambda r: priority_order.get(r.priority.lower(), 0), reverse=True)
    return generated


def update_recommendation(
    db: Session,
    recommendation_id: int,
    payload: RecommendationUpdate | dict[str, Any],
) -> Recommendation:
    """
    Updates an existing recommendation with validation.
    """
    rec = db.get(Recommendation, recommendation_id)
    if rec is None:
        raise ValueError("Recommendation not found")

    data = payload.model_dump(exclude_unset=True) if isinstance(payload, RecommendationUpdate) else payload

    if "priority" in data and data["priority"]:
        norm_pri = normalize_priority(data["priority"])
        rec.priority = norm_pri

    if "status" in data and data["status"]:
        st = str(data["status"]).lower()
        if st not in ALLOWED_RECOMMENDATION_STATUSES:
            raise ValueError(f"Invalid status: '{st}'. Allowed values: {sorted(ALLOWED_RECOMMENDATION_STATUSES)}")
        rec.status = st

    if "title" in data and data["title"]:
        rec.title = str(data["title"]).strip()

    if "description" in data and data["description"]:
        rec.description = str(data["description"]).strip()

    if "impact" in data:
        rec.impact = str(data["impact"]).strip() if data["impact"] else None

    if "action_type" in data:
        rec.action_type = str(data["action_type"]).strip() if data["action_type"] else None

    if "payload" in data and data["payload"] is not None:
        if isinstance(rec.payload, dict) and isinstance(data["payload"], dict):
            updated_payload = dict(rec.payload)
            updated_payload.update(data["payload"])
            rec.payload = updated_payload
        else:
            rec.payload = data["payload"]

    db.commit()
    db.refresh(rec)
    return rec


def delete_recommendation(
    db: Session,
    recommendation_id: int,
) -> bool:
    """
    Deletes a recommendation. Cascades to associated fix_plans.
    """
    rec = db.get(Recommendation, recommendation_id)
    if rec is None:
        raise ValueError("Recommendation not found")

    db.delete(rec)
    db.commit()
    return True


def list_recommendations(
    db: Session,
    website_id: int | None = None,
    scan_id: int | None = None,
    finding_id: int | None = None,
    opportunity_id: int | None = None,
    status: str | None = None,
    priority: str | None = None,
    action_type: str | None = None,
) -> list[Recommendation]:
    """
    Lists recommendations with optional filtering.
    """
    query = db.query(Recommendation)

    if finding_id is not None:
        query = query.filter(Recommendation.finding_id == finding_id)

    if scan_id is not None:
        query = query.join(Finding, Recommendation.finding_id == Finding.id).filter(Finding.scan_id == scan_id)

    if website_id is not None:
        if scan_id is None:
            query = query.join(Finding, Recommendation.finding_id == Finding.id)
        query = query.filter(Finding.website_id == website_id)

    if status:
        query = query.filter(Recommendation.status == status.lower())

    if priority:
        norm_pri = normalize_priority(priority)
        query = query.filter(Recommendation.priority == norm_pri)

    if action_type:
        query = query.filter(Recommendation.action_type == action_type)

    results = query.order_by(Recommendation.id.asc()).all()

    # If opportunity_id filter is specified, filter in memory or via payload/relation
    if opportunity_id is not None:
        filtered = []
        for r in results:
            if isinstance(r.payload, dict) and r.payload.get("opportunity_id") == opportunity_id:
                filtered.append(r)
            elif any(op.id == opportunity_id for op in r.opportunities):
                filtered.append(r)
        return filtered

    return results
