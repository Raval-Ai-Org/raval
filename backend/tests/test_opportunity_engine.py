import pytest
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.models import Finding, Opportunity, PageResult, Recommendation, Scan, Website
from app.opportunity_service import (
    create_opportunity,
    delete_opportunity,
    generate_opportunities_for_scan,
    generate_opportunities_for_website,
    generate_opportunity_from_finding,
    generate_opportunity_from_recommendation,
    get_finding_opportunities,
    get_opportunity,
    get_scan_opportunities,
    get_website_opportunities,
    update_opportunity,
)


def _setup_website_scan_and_finding(db: Session, prefix: str = "OpEngine"):
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
        url=f"https://{prefix.lower()}.com/products",
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
        description="FAQ content found without schema markup.",
        severity="high",
        status="open",
        evidence={"questions_found": ["What is this?", "How does it work?"]},
    )
    db.add(finding)
    db.commit()
    db.refresh(finding)

    recommendation = Recommendation(
        finding_id=finding.id,
        title="Implement FAQPage Schema",
        description="Add JSON-LD for detected questions.",
        priority="high",
        status="open",
    )
    db.add(recommendation)
    db.commit()
    db.refresh(recommendation)

    return website, scan, page, finding, recommendation


def test_generate_opportunity_from_finding_success():
    db = SessionLocal()
    try:
        website, scan, page, finding, rec = _setup_website_scan_and_finding(db, "FromFinding")

        opportunity = generate_opportunity_from_finding(db, finding.id, recommendation_id=rec.id)

        assert opportunity.id is not None
        assert opportunity.website_id == website.id
        assert opportunity.scan_id == scan.id
        assert opportunity.page_id == page.id
        assert opportunity.finding_id == finding.id
        assert opportunity.recommendation_id == rec.id
        assert opportunity.opportunity_type == "structured_data_enhancement"
        assert opportunity.category == "structured_data"
        assert "FAQPage" in opportunity.title
        assert opportunity.impact == 0.80  # high severity
        assert opportunity.effort == 0.30  # schema effort
        assert 0.0 <= opportunity.priority_score <= 1.0
        assert opportunity.priority in ("CRITICAL", "HIGH", "MEDIUM", "LOW")
        assert len(opportunity.rationale) > 0
    finally:
        db.close()


def test_generate_opportunity_idempotency():
    db = SessionLocal()
    try:
        website, scan, page, finding, rec = _setup_website_scan_and_finding(db, "Idempotent")

        # 1. First generation creates the record
        op1 = generate_opportunity_from_finding(db, finding.id)
        op1_id = op1.id

        # 2. Second generation should update existing, NOT create duplicate
        op2 = generate_opportunity_from_finding(db, finding.id)
        assert op2.id == op1_id

        # Verify only 1 opportunity exists for this finding in the DB
        all_ops = db.query(Opportunity).filter(Opportunity.finding_id == finding.id).all()
        assert len(all_ops) == 1
    finally:
        db.close()


def test_generate_opportunity_from_recommendation():
    db = SessionLocal()
    try:
        website, scan, page, finding, rec = _setup_website_scan_and_finding(db, "FromRec")

        op = generate_opportunity_from_recommendation(db, rec.id)
        assert op.id is not None
        assert op.finding_id == finding.id
        assert op.recommendation_id == rec.id
    finally:
        db.close()


def test_generate_opportunities_for_scan_batch():
    db = SessionLocal()
    try:
        website, scan, page, finding1, _ = _setup_website_scan_and_finding(db, "ScanBatch")

        # Add a second finding
        finding2 = Finding(
            website_id=website.id,
            scan_id=scan.id,
            page_id=page.id,
            finding_type="missing_title",
            category="seo",
            title="Missing Title Tag",
            description="Page is missing a title tag.",
            severity="critical",
            status="open",
        )
        db.add(finding2)
        db.commit()

        ops = generate_opportunities_for_scan(db, scan.id)
        assert len(ops) == 2
        assert {op.finding_id for op in ops} == {finding1.id, finding2.id}

        # Verify ordering by priority score descending
        assert ops[0].priority_score >= ops[1].priority_score
    finally:
        db.close()


def test_generate_opportunities_for_website():
    db = SessionLocal()
    try:
        website, scan, page, finding, _ = _setup_website_scan_and_finding(db, "WebBatch")

        ops = generate_opportunities_for_website(db, website.id)
        assert len(ops) >= 1
        for op in ops:
            assert op.website_id == website.id
    finally:
        db.close()


def test_opportunity_crud_operations():
    db = SessionLocal()
    try:
        website, scan, page, finding, _ = _setup_website_scan_and_finding(db, "CRUD")

        # Create
        created = create_opportunity(
            db,
            {
                "website_id": website.id,
                "scan_id": scan.id,
                "page_id": page.id,
                "finding_id": finding.id,
                "title": "Manual Performance Opportunity",
                "description": "Optimize critical rendering path.",
                "opportunity_type": "performance_optimization",
                "category": "technical_seo",
                "status": "identified",
                "impact": 0.85,
                "effort": 0.35,
                "confidence": 0.90,
            },
        )
        assert created.id is not None
        assert created.priority == "CRITICAL"

        # Read
        fetched = get_opportunity(db, created.id)
        assert fetched.id == created.id
        assert fetched.title == "Manual Performance Opportunity"

        # Update
        updated = update_opportunity(
            db,
            created.id,
            {
                "status": "in_progress",
                "impact": 0.30,  # lower impact should trigger recalculation
            },
        )
        assert updated.status == "in_progress"
        assert updated.impact == 0.30
        assert updated.priority in ("MEDIUM", "LOW")

        # Delete
        op_id = created.id
        assert delete_opportunity(db, op_id) is True
        with pytest.raises(ValueError, match="not found"):
            get_opportunity(db, op_id)
    finally:
        db.close()


def test_invalid_source_references_raise_error():
    db = SessionLocal()
    try:
        with pytest.raises(ValueError, match="Finding not found"):
            generate_opportunity_from_finding(db, 999999)

        with pytest.raises(ValueError, match="Recommendation not found"):
            generate_opportunity_from_recommendation(db, 999999)

        with pytest.raises(ValueError, match="Scan not found"):
            generate_opportunities_for_scan(db, 999999)

        with pytest.raises(ValueError, match="Website not found"):
            generate_opportunities_for_website(db, 999999)
    finally:
        db.close()
