"""
Raval GEO Intelligence — Opportunity Engine & Service (Task 6.1)

Handles generation, persistence, deduplication, and lifecycle of Opportunities
derived from Findings, Recommendations, and Page Intelligence signals.
"""

from datetime import datetime
from typing import Any
from sqlalchemy.orm import Session

from .models import Finding, Opportunity, PageResult, Recommendation, Scan, Website
from .opportunity_prioritization import (
    ALLOWED_OPPORTUNITY_CATEGORIES,
    ALLOWED_OPPORTUNITY_PRIORITIES,
    ALLOWED_OPPORTUNITY_STATUSES,
    calculate_opportunity_priority,
    category_and_type_to_effort,
    evidence_to_confidence,
    severity_to_impact,
)
from .schemas import OpportunityCreate, OpportunityUpdate


# Mapping finding types to standardized actionable opportunity profiles
FINDING_TYPE_TO_OPPORTUNITY_MAP: dict[str, dict[str, str]] = {
    "missing_title": {
        "opportunity_type": "title_tag_optimization",
        "category": "technical_seo",
        "title_prefix": "Optimize Missing Title Tag",
        "description_template": "Add a unique, keyword-rich title tag (30-60 characters) to establish primary topic relevance.",
    },
    "title_too_short": {
        "opportunity_type": "title_tag_optimization",
        "category": "technical_seo",
        "title_prefix": "Expand Concise Title Tag",
        "description_template": "Expand title tag to thoroughly communicate topic intent and boost search CTR.",
    },
    "title_too_long": {
        "opportunity_type": "title_tag_optimization",
        "category": "technical_seo",
        "title_prefix": "Shorten Truncated Title Tag",
        "description_template": "Shorten title tag under 60 characters to prevent truncation in search and AI snippet previews.",
    },
    "missing_meta_description": {
        "opportunity_type": "meta_description_optimization",
        "category": "technical_seo",
        "title_prefix": "Implement High-CTR Meta Description",
        "description_template": "Add an engaging, descriptive meta description (120-160 characters) with direct value proposition.",
    },
    "missing_h1": {
        "opportunity_type": "heading_hierarchy_optimization",
        "category": "content",
        "title_prefix": "Add Primary H1 Heading",
        "description_template": "Implement exactly one clear H1 heading to anchor the document's topical hierarchy.",
    },
    "multiple_h1": {
        "opportunity_type": "heading_hierarchy_optimization",
        "category": "content",
        "title_prefix": "Consolidate Multiple H1 Headings",
        "description_template": "Reduce multiple H1 headings to a single primary H1 and demote secondary headings to H2.",
    },
    "heading_hierarchy_issue": {
        "opportunity_type": "heading_hierarchy_optimization",
        "category": "content",
        "title_prefix": "Fix Heading Level Skips",
        "description_template": "Repair skipped heading levels (e.g. H1 to H3) to restore clear logical section nesting for search crawlers.",
    },
    "missing_faq_schema": {
        "opportunity_type": "structured_data_enhancement",
        "category": "structured_data",
        "title_prefix": "Implement FAQPage Schema Markup",
        "description_template": "Mark up detected question-and-answer pairs with FAQPage JSON-LD to unlock rich snippets and AI Overviews.",
    },
    "unanswered_question": {
        "opportunity_type": "answer_readiness_enhancement",
        "category": "aeo",
        "title_prefix": "Provide Direct Answer for Unanswered Question",
        "description_template": "Add an immediate, 40-60 word authoritative answer block directly following the question heading.",
    },
    "indirect_answer": {
        "opportunity_type": "answer_readiness_enhancement",
        "category": "aeo",
        "title_prefix": "Improve Answer Directness",
        "description_template": "Restructure indirect answer text to begin with a definitive definition or answer statement.",
    },
    "content_gap": {
        "opportunity_type": "content_gap_remediation",
        "category": "content",
        "title_prefix": "Address Topical Content Gap",
        "description_template": "Expand thin or missing thematic subtopics to provide exhaustive domain coverage.",
    },
    "entity_missing_authority_links": {
        "opportunity_type": "entity_authority_enhancement",
        "category": "entity",
        "title_prefix": "Anchor Entity Authority with sameAs Links",
        "description_template": "Add authoritative sameAs references (Wikidata, Wikipedia, official registry) to entity structured data.",
    },
    "keyword_stuffing": {
        "opportunity_type": "content_quality_improvement",
        "category": "quality",
        "title_prefix": "Remediate Keyword Density",
        "description_template": "Reduce excessive keyword repetition and replace with natural semantic synonyms to avoid search penalties.",
    },
    "unsupported_superlative": {
        "opportunity_type": "content_quality_improvement",
        "category": "quality",
        "title_prefix": "Support Superlative Claims with Evidence",
        "description_template": "Provide citations, independent studies, or statistical proof for superlative claims.",
    },
    "weak_semantic_coverage": {
        "opportunity_type": "semantic_coverage_expansion",
        "category": "content",
        "title_prefix": "Expand Semantic Concept Coverage",
        "description_template": "Cover missing related conceptual entities to reinforce overall topical authority.",
    },
    "missing_alt_text": {
        "opportunity_type": "image_accessibility_optimization",
        "category": "technical_seo",
        "title_prefix": "Add Descriptive Image Alt Text",
        "description_template": "Add informative alt attributes to images describing visual content for accessibility and image search.",
    },
}


def _derive_opportunity_profile(finding: Finding) -> dict[str, str]:
    """
    Derives opportunity type, category, title, and description based on finding data.
    """
    f_type = (finding.finding_type or "").lower().strip()
    profile = FINDING_TYPE_TO_OPPORTUNITY_MAP.get(f_type)

    if profile:
        title = f"{profile['title_prefix']}: {finding.title}"
        description = f"{profile['description_template']} Context: {finding.description}"
        return {
            "opportunity_type": profile["opportunity_type"],
            "category": profile["category"],
            "title": title[:255],
            "description": description,
        }

    # Fallback to finding category & attributes
    cat = (finding.category or "seo").lower()
    if cat not in ALLOWED_OPPORTUNITY_CATEGORIES:
        cat = "seo"

    op_type = f"{f_type}_opportunity" if f_type else "general_optimization"
    title = f"Resolve {finding.title}"
    description = f"Actionable opportunity to address {finding.title}. {finding.description}"

    return {
        "opportunity_type": op_type[:100],
        "category": cat,
        "title": title[:255],
        "description": description,
    }


def generate_opportunity_from_finding(
    db: Session,
    finding_id: int,
    recommendation_id: int | None = None,
) -> Opportunity:
    """
    Generates a prioritized Opportunity from an existing Finding.
    Maintains complete traceability and idempotency (prevents duplicate records).
    """
    finding = db.get(Finding, finding_id)
    if finding is None:
        raise ValueError("Finding not found")

    rec = None
    if recommendation_id is not None:
        rec = db.get(Recommendation, recommendation_id)
        if rec is None or rec.finding_id != finding.id:
            raise ValueError("Recommendation does not match finding")
    elif finding.recommendations:
        rec = finding.recommendations[0]

    profile = _derive_opportunity_profile(finding)
    opportunity_type = profile["opportunity_type"]
    category = profile["category"]
    title = profile["title"]
    description = profile["description"]

    # Calculate deterministic prioritization inputs
    impact = severity_to_impact(finding.severity)
    effort = category_and_type_to_effort(category, opportunity_type)
    confidence = evidence_to_confidence(finding.evidence)

    score, priority, rationale = calculate_opportunity_priority(
        impact=impact,
        effort=effort,
        confidence=confidence,
    )

    # Idempotency / Deduplication Check:
    # Check if an opportunity already exists for this finding and opportunity type
    existing = (
        db.query(Opportunity)
        .filter(
            Opportunity.finding_id == finding.id,
            Opportunity.opportunity_type == opportunity_type,
        )
        .first()
    )

    if existing:
        # Refresh existing opportunity attributes with latest scoring
        existing.title = title
        existing.description = description
        existing.category = category
        existing.impact = impact
        existing.effort = effort
        existing.confidence = confidence
        existing.priority_score = score
        existing.priority = priority
        existing.rationale = rationale
        existing.evidence = finding.evidence
        if rec and not existing.recommendation_id:
            existing.recommendation_id = rec.id
        existing.updated_at = datetime.utcnow()

        db.commit()
        db.refresh(existing)
        return existing

    # Create new Opportunity
    opportunity = Opportunity(
        website_id=finding.website_id,
        scan_id=finding.scan_id,
        page_id=finding.page_id,
        finding_id=finding.id,
        recommendation_id=rec.id if rec else None,
        title=title,
        description=description,
        opportunity_type=opportunity_type,
        category=category,
        status="identified",
        impact=impact,
        effort=effort,
        confidence=confidence,
        priority_score=score,
        priority=priority,
        rationale=rationale,
        evidence=finding.evidence,
    )

    db.add(opportunity)
    db.commit()
    db.refresh(opportunity)

    return opportunity


def generate_opportunities_for_scan(
    db: Session,
    scan_id: int,
) -> list[Opportunity]:
    """
    Batch-generates prioritized opportunities for all findings in a scan.
    """
    scan = db.get(Scan, scan_id)
    if scan is None:
        raise ValueError("Scan not found")

    findings = (
        db.query(Finding)
        .filter(Finding.scan_id == scan_id)
        .order_by(Finding.id)
        .all()
    )

    generated = []
    for finding in findings:
        rec = finding.recommendations[0] if finding.recommendations else None
        op = generate_opportunity_from_finding(
            db,
            finding.id,
            recommendation_id=rec.id if rec else None,
        )
        generated.append(op)

    generated.sort(key=lambda x: (x.priority_score, -(x.id or 0)), reverse=True)
    return generated


def generate_opportunities_for_website(
    db: Session,
    website_id: int,
) -> list[Opportunity]:
    """
    Batch-generates prioritized opportunities across all findings for a website.
    """
    website = db.get(Website, website_id)
    if website is None:
        raise ValueError("Website not found")

    findings = (
        db.query(Finding)
        .filter(Finding.website_id == website_id)
        .order_by(Finding.id)
        .all()
    )

    generated = []
    for finding in findings:
        rec = finding.recommendations[0] if finding.recommendations else None
        op = generate_opportunity_from_finding(
            db,
            finding.id,
            recommendation_id=rec.id if rec else None,
        )
        generated.append(op)

    generated.sort(key=lambda x: (x.priority_score, -(x.id or 0)), reverse=True)
    return generated


def generate_opportunity_from_recommendation(
    db: Session,
    recommendation_id: int,
) -> Opportunity:
    """
    Generates a prioritized Opportunity from an existing Recommendation and its source Finding.
    """
    rec = db.get(Recommendation, recommendation_id)
    if rec is None:
        raise ValueError("Recommendation not found")

    return generate_opportunity_from_finding(
        db,
        finding_id=rec.finding_id,
        recommendation_id=rec.id,
    )


def create_opportunity(
    db: Session,
    op_data: OpportunityCreate | dict,
) -> Opportunity:
    """
    Manually creates a new Opportunity record with validation and deterministic scoring.
    """
    if isinstance(op_data, dict):
        website_id = op_data.get("website_id")
        scan_id = op_data.get("scan_id")
        page_id = op_data.get("page_id")
        finding_id = op_data.get("finding_id")
        recommendation_id = op_data.get("recommendation_id")
        title = op_data.get("title")
        description = op_data.get("description")
        opportunity_type = op_data.get("opportunity_type")
        category = op_data.get("category", "seo")
        status = op_data.get("status", "identified")
        impact = op_data.get("impact", 0.5)
        effort = op_data.get("effort", 0.5)
        confidence = op_data.get("confidence", 0.8)
        priority_score = op_data.get("priority_score")
        priority = op_data.get("priority")
        rationale = op_data.get("rationale")
        evidence = op_data.get("evidence")
    else:
        website_id = op_data.website_id
        scan_id = op_data.scan_id
        page_id = op_data.page_id
        finding_id = op_data.finding_id
        recommendation_id = op_data.recommendation_id
        title = op_data.title
        description = op_data.description
        opportunity_type = op_data.opportunity_type
        category = op_data.category
        status = op_data.status
        impact = op_data.impact
        effort = op_data.effort
        confidence = op_data.confidence
        priority_score = op_data.priority_score
        priority = op_data.priority
        rationale = op_data.rationale
        evidence = op_data.evidence

    if not website_id:
        raise ValueError("Website ID is required")
    website = db.get(Website, website_id)
    if website is None:
        raise ValueError("Website not found")

    if scan_id is not None:
        scan = db.get(Scan, scan_id)
        if scan is None:
            raise ValueError("Scan not found")
        if scan.website_id != website_id:
            raise ValueError("Scan does not belong to the specified website")

    if page_id is not None:
        page = db.get(PageResult, page_id)
        if page is None:
            raise ValueError("Page not found")
        if scan_id is not None and page.scan_id != scan_id:
            raise ValueError("Page does not belong to the specified scan")

    if finding_id is not None:
        finding = db.get(Finding, finding_id)
        if finding is None:
            raise ValueError("Finding not found")
        if finding.website_id != website_id:
            raise ValueError("Finding does not belong to the specified website")

    if recommendation_id is not None:
        rec = db.get(Recommendation, recommendation_id)
        if rec is None:
            raise ValueError("Recommendation not found")
        if finding_id is not None and rec.finding_id != finding_id:
            raise ValueError("Recommendation does not belong to the specified finding")

    if not title or not str(title).strip():
        raise ValueError("Title must not be empty")

    if not description or not str(description).strip():
        raise ValueError("Description must not be empty")

    if not opportunity_type or not str(opportunity_type).strip():
        raise ValueError("Opportunity type must not be empty")

    category = str(category).lower().strip()
    if category not in ALLOWED_OPPORTUNITY_CATEGORIES:
        category = "seo"

    status = str(status).lower().strip()
    if status not in ALLOWED_OPPORTUNITY_STATUSES:
        raise ValueError(
            f"Invalid status: '{status}'. Allowed values: {sorted(ALLOWED_OPPORTUNITY_STATUSES)}"
        )

    # Compute deterministic priority if not explicitly provided
    if priority_score is None or priority is None or rationale is None:
        calc_score, calc_pri, calc_rat = calculate_opportunity_priority(
            impact=impact,
            effort=effort,
            confidence=confidence,
        )
        priority_score = calc_score if priority_score is None else priority_score
        priority = calc_pri if priority is None else priority
        rationale = calc_rat if rationale is None else rationale

    opportunity = Opportunity(
        website_id=website_id,
        scan_id=scan_id,
        page_id=page_id,
        finding_id=finding_id,
        recommendation_id=recommendation_id,
        title=str(title).strip(),
        description=str(description).strip(),
        opportunity_type=str(opportunity_type).strip(),
        category=category,
        status=status,
        impact=float(impact),
        effort=float(effort),
        confidence=float(confidence),
        priority_score=float(priority_score),
        priority=str(priority).upper(),
        rationale=str(rationale).strip(),
        evidence=evidence,
    )

    db.add(opportunity)
    db.commit()
    db.refresh(opportunity)

    return opportunity


def get_opportunity(
    db: Session,
    opportunity_id: int,
) -> Opportunity:
    """
    Fetches an opportunity by primary key ID.
    """
    opportunity = db.get(Opportunity, opportunity_id)
    if opportunity is None:
        raise ValueError("Opportunity not found")
    return opportunity


def get_website_opportunities(
    db: Session,
    website_id: int,
    scan_id: int | None = None,
    category: str | None = None,
    status: str | None = None,
    priority: str | None = None,
    opportunity_type: str | None = None,
) -> list[Opportunity]:
    """
    Queries opportunities for a website with optional filters, sorted by priority_score descending.
    """
    website = db.get(Website, website_id)
    if website is None:
        raise ValueError("Website not found")

    query = db.query(Opportunity).filter(Opportunity.website_id == website_id)

    if scan_id is not None:
        query = query.filter(Opportunity.scan_id == scan_id)
    if category:
        query = query.filter(Opportunity.category == category.lower())
    if status:
        query = query.filter(Opportunity.status == status.lower())
    if priority:
        query = query.filter(Opportunity.priority == priority.upper())
    if opportunity_type:
        query = query.filter(Opportunity.opportunity_type == opportunity_type)

    return query.order_by(Opportunity.priority_score.desc(), Opportunity.id.asc()).all()


def get_scan_opportunities(
    db: Session,
    scan_id: int,
    category: str | None = None,
    status: str | None = None,
    priority: str | None = None,
) -> list[Opportunity]:
    """
    Queries opportunities for a scan with optional filters.
    """
    scan = db.get(Scan, scan_id)
    if scan is None:
        raise ValueError("Scan not found")

    query = db.query(Opportunity).filter(Opportunity.scan_id == scan_id)

    if category:
        query = query.filter(Opportunity.category == category.lower())
    if status:
        query = query.filter(Opportunity.status == status.lower())
    if priority:
        query = query.filter(Opportunity.priority == priority.upper())

    return query.order_by(Opportunity.priority_score.desc(), Opportunity.id.asc()).all()


def get_finding_opportunities(
    db: Session,
    finding_id: int,
) -> list[Opportunity]:
    """
    Queries opportunities associated with a specific finding.
    """
    finding = db.get(Finding, finding_id)
    if finding is None:
        raise ValueError("Finding not found")

    return (
        db.query(Opportunity)
        .filter(Opportunity.finding_id == finding_id)
        .order_by(Opportunity.priority_score.desc(), Opportunity.id.asc())
        .all()
    )


def update_opportunity(
    db: Session,
    opportunity_id: int,
    op_update: OpportunityUpdate | dict,
) -> Opportunity:
    """
    Updates an Opportunity's editable fields and recalculates priority score if scoring factors change.
    """
    opportunity = db.get(Opportunity, opportunity_id)
    if opportunity is None:
        raise ValueError("Opportunity not found")

    if isinstance(op_update, dict):
        data = op_update
    else:
        data = op_update.model_dump(exclude_unset=True)

    recalculate_needed = False

    if "title" in data and data["title"] is not None:
        title = str(data["title"]).strip()
        if not title:
            raise ValueError("Title must not be empty")
        opportunity.title = title

    if "description" in data and data["description"] is not None:
        desc = str(data["description"]).strip()
        if not desc:
            raise ValueError("Description must not be empty")
        opportunity.description = desc

    if "category" in data and data["category"] is not None:
        cat = str(data["category"]).lower().strip()
        if cat in ALLOWED_OPPORTUNITY_CATEGORIES:
            opportunity.category = cat

    if "status" in data and data["status"] is not None:
        st = str(data["status"]).lower().strip()
        if st not in ALLOWED_OPPORTUNITY_STATUSES:
            raise ValueError(
                f"Invalid status: '{st}'. Allowed values: {sorted(ALLOWED_OPPORTUNITY_STATUSES)}"
            )
        opportunity.status = st

    if "impact" in data and data["impact"] is not None:
        opportunity.impact = max(0.0, min(1.0, float(data["impact"])))
        recalculate_needed = True

    if "effort" in data and data["effort"] is not None:
        opportunity.effort = max(0.0, min(1.0, float(data["effort"])))
        recalculate_needed = True

    if "confidence" in data and data["confidence"] is not None:
        opportunity.confidence = max(0.0, min(1.0, float(data["confidence"])))
        recalculate_needed = True

    if "evidence" in data:
        opportunity.evidence = data["evidence"]

    # If explicit priority/score provided, use it; otherwise recalculate if factors changed
    if "priority_score" in data and data["priority_score"] is not None:
        opportunity.priority_score = float(data["priority_score"])
        recalculate_needed = False

    if "priority" in data and data["priority"] is not None:
        pri = str(data["priority"]).upper().strip()
        if pri in ALLOWED_OPPORTUNITY_PRIORITIES:
            opportunity.priority = pri

    if "rationale" in data and data["rationale"] is not None:
        opportunity.rationale = str(data["rationale"]).strip()

    if recalculate_needed and "priority_score" not in data:
        score, pri, rat = calculate_opportunity_priority(
            impact=opportunity.impact,
            effort=opportunity.effort,
            confidence=opportunity.confidence,
        )
        opportunity.priority_score = score
        if "priority" not in data:
            opportunity.priority = pri
        if "rationale" not in data:
            opportunity.rationale = rat

    opportunity.updated_at = datetime.utcnow()

    db.commit()
    db.refresh(opportunity)

    return opportunity


def delete_opportunity(
    db: Session,
    opportunity_id: int,
) -> bool:
    """
    Deletes an Opportunity by ID.
    """
    opportunity = db.get(Opportunity, opportunity_id)
    if opportunity is None:
        raise ValueError("Opportunity not found")

    db.delete(opportunity)
    db.commit()
    return True


def generate_opportunity_from_page_intelligence(
    db: Session,
    page_id: int,
) -> list[Opportunity]:
    """
    Derives strategic opportunities from page-level content intelligence signals.
    """
    page = db.get(PageResult, page_id)
    if page is None:
        raise ValueError(f"PageResult with id {page_id} not found")

    scan = db.get(Scan, page.scan_id)
    website_id = scan.website_id if scan else 1

    generated: list[Opportunity] = []

    # Check page findings
    for finding in page.findings:
        op = generate_opportunity_from_finding(db, finding.id)
        generated.append(op)

    # Check page entities without sameAs
    for entity in page.entities:
        if not entity.same_as:
            # Check for existing
            existing = (
                db.query(Opportunity)
                .filter(
                    Opportunity.page_id == page.id,
                    Opportunity.opportunity_type == "entity_authority_enhancement",
                )
                .first()
            )
            if not existing:
                score, pri, rat = calculate_opportunity_priority(
                    impact=0.75,
                    effort=0.25,
                    confidence=0.85,
                )
                op = Opportunity(
                    website_id=website_id,
                    scan_id=page.scan_id,
                    page_id=page.id,
                    title=f"Disambiguate Entity '{entity.name}' with sameAs Authority",
                    description=f"Entity '{entity.name}' on {page.url} lacks authoritative sameAs linking.",
                    opportunity_type="entity_authority_enhancement",
                    category="entity",
                    impact=0.75,
                    effort=0.25,
                    confidence=0.85,
                    priority_score=score,
                    priority=pri,
                    rationale=rat,
                    status="identified",
                )
                db.add(op)
                db.commit()
                db.refresh(op)
                generated.append(op)

    return generated


def generate_opportunity_from_ai_run(
    db: Session,
    ai_run_id: int,
) -> Opportunity:
    """
    Derives AEO/GEO engine citation visibility opportunities from AI run results.
    """
    from .models import AIRun
    ai_run = db.get(AIRun, ai_run_id)
    if ai_run is None:
        raise ValueError(f"AIRun with id {ai_run_id} not found")

    existing = (
        db.query(Opportunity)
        .filter(
            Opportunity.website_id == ai_run.website_id,
            Opportunity.opportunity_type == "ai_engine_citation_optimization",
            Opportunity.title.like(f"%{ai_run.provider}%"),
        )
        .first()
    )

    citation_count = len(ai_run.result.citations) if ai_run.result and ai_run.result.citations else 0
    impact = 0.90 if citation_count == 0 else 0.70
    effort = 0.35
    confidence = 0.85

    score, pri, rat = calculate_opportunity_priority(
        impact=impact,
        effort=effort,
        confidence=confidence,
    )

    if existing:
        existing.impact = impact
        existing.effort = effort
        existing.confidence = confidence
        existing.priority_score = score
        existing.priority = pri
        existing.rationale = rat
        existing.updated_at = datetime.utcnow()
        db.commit()
        db.refresh(existing)
        return existing

    op = Opportunity(
        website_id=ai_run.website_id,
        title=f"Boost AI Citation Visibility for {ai_run.provider.capitalize()} Search",
        description=f"Identified citation visibility opportunity on {ai_run.provider} for query evaluation.",
        opportunity_type="ai_engine_citation_optimization",
        category="geo",
        impact=impact,
        effort=effort,
        confidence=confidence,
        priority_score=score,
        priority=pri,
        rationale=rat,
        status="identified",
        evidence={"ai_run_id": ai_run.id, "provider": ai_run.provider, "model": ai_run.model},
    )
    db.add(op)
    db.commit()
    db.refresh(op)
    return op


def list_opportunities(
    db: Session,
    website_id: int | None = None,
    scan_id: int | None = None,
    page_id: int | None = None,
    finding_id: int | None = None,
    category: str | None = None,
    status: str | None = None,
    priority: str | None = None,
    opportunity_type: str | None = None,
    limit: int = 100,
    offset: int = 0,
) -> list[Opportunity]:
    """
    Lists Opportunity records with comprehensive query filtering.
    """
    query = db.query(Opportunity)

    if website_id is not None:
        query = query.filter(Opportunity.website_id == website_id)
    if scan_id is not None:
        query = query.filter(Opportunity.scan_id == scan_id)
    if page_id is not None:
        query = query.filter(Opportunity.page_id == page_id)
    if finding_id is not None:
        query = query.filter(Opportunity.finding_id == finding_id)
    if category is not None:
        query = query.filter(Opportunity.category == category.strip().lower())
    if status is not None:
        query = query.filter(Opportunity.status == status.strip().lower())
    if priority is not None:
        query = query.filter(Opportunity.priority == priority.strip().upper())
    if opportunity_type is not None:
        query = query.filter(Opportunity.opportunity_type == opportunity_type.strip())

    return query.order_by(Opportunity.priority_score.desc(), Opportunity.id.asc()).offset(offset).limit(limit).all()

