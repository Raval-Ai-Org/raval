import pytest
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.models import Finding, Opportunity, PageResult, Recommendation, Scan, Website


def _setup_website_scan_and_finding(db: Session, prefix: str = "OpModel"):
    website = Website(name=f"{prefix} Site", url=f"https://{prefix.lower()}.com")
    db.add(website)
    db.commit()
    db.refresh(website)

    scan = Scan(website_id=website.id, status="completed")
    db.add(scan)
    db.commit()
    db.refresh(scan)

    page = PageResult(
        scan_id=scan.id,
        url=f"https://{prefix.lower()}.com/article",
        status_code=200,
        content_type="text/html",
    )
    db.add(page)
    db.commit()
    db.refresh(page)

    finding = Finding(
        website_id=website.id,
        scan_id=scan.id,
        page_id=page.id,
        finding_type="missing_faq_schema",
        category="structured_data",
        title="Missing FAQ Schema",
        description="Questions detected without FAQPage schema.",
        severity="high",
        status="open",
        evidence={"questions_found": 3},
    )
    db.add(finding)
    db.commit()
    db.refresh(finding)

    recommendation = Recommendation(
        finding_id=finding.id,
        title="Add FAQPage schema markup",
        description="Inject JSON-LD FAQPage markup.",
        priority="high",
        status="open",
    )
    db.add(recommendation)
    db.commit()
    db.refresh(recommendation)

    return website, scan, page, finding, recommendation


def test_opportunity_model_creation_and_persistence():
    db = SessionLocal()
    try:
        website, scan, page, finding, rec = _setup_website_scan_and_finding(db, "Persist")

        opportunity = Opportunity(
            website_id=website.id,
            scan_id=scan.id,
            page_id=page.id,
            finding_id=finding.id,
            recommendation_id=rec.id,
            title="Implement FAQPage Structured Data",
            description="Add FAQPage JSON-LD to enhance AI Overviews visibility.",
            opportunity_type="structured_data_enhancement",
            category="structured_data",
            status="identified",
            impact=0.80,
            effort=0.30,
            confidence=0.90,
            priority_score=0.80,
            priority="CRITICAL",
            rationale="Critical priority due to high impact and low effort.",
            evidence={"questions": ["Q1", "Q2"]},
        )
        db.add(opportunity)
        db.commit()
        db.refresh(opportunity)

        assert opportunity.id is not None
        assert opportunity.website_id == website.id
        assert opportunity.scan_id == scan.id
        assert opportunity.page_id == page.id
        assert opportunity.finding_id == finding.id
        assert opportunity.recommendation_id == rec.id
        assert opportunity.priority == "CRITICAL"
        assert opportunity.status == "identified"
        assert opportunity.created_at is not None
        assert opportunity.updated_at is not None
    finally:
        db.close()


def test_opportunity_model_relationships():
    db = SessionLocal()
    try:
        website, scan, page, finding, rec = _setup_website_scan_and_finding(db, "Rel")

        opportunity = Opportunity(
            website_id=website.id,
            scan_id=scan.id,
            page_id=page.id,
            finding_id=finding.id,
            recommendation_id=rec.id,
            title="Relationship Test Opportunity",
            description="Testing bidirectional ORM relationships.",
            opportunity_type="test_opportunity",
            category="seo",
            priority="HIGH",
            rationale="Test rationale",
        )
        db.add(opportunity)
        db.commit()
        db.refresh(opportunity)

        # Verify forward relationships
        assert opportunity.website.id == website.id
        assert opportunity.scan.id == scan.id
        assert opportunity.page_result.id == page.id
        assert opportunity.finding.id == finding.id
        assert opportunity.recommendation.id == rec.id

        # Verify back_populates on parent models
        db.refresh(website)
        assert any(op.id == opportunity.id for op in website.opportunities)

        db.refresh(scan)
        assert any(op.id == opportunity.id for op in scan.opportunities)

        db.refresh(page)
        assert any(op.id == opportunity.id for op in page.opportunities)

        db.refresh(finding)
        assert any(op.id == opportunity.id for op in finding.opportunities)

        db.refresh(rec)
        assert any(op.id == opportunity.id for op in rec.opportunities)
    finally:
        db.close()


def test_opportunity_cascade_delete_with_website():
    db = SessionLocal()
    try:
        website, scan, page, finding, rec = _setup_website_scan_and_finding(db, "Cascade")

        opportunity = Opportunity(
            website_id=website.id,
            scan_id=scan.id,
            page_id=page.id,
            finding_id=finding.id,
            title="Cascade Opportunity",
            description="Should be deleted when website is deleted.",
            opportunity_type="cascade_test",
            category="seo",
            priority="LOW",
            rationale="Cascade check",
        )
        db.add(opportunity)
        db.commit()
        op_id = opportunity.id

        # Delete website
        db.delete(website)
        db.commit()

        # Opportunity must be deleted by cascade
        deleted_op = db.get(Opportunity, op_id)
        assert deleted_op is None
    finally:
        db.close()
