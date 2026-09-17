import pytest
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.models import Finding, FixPlan, Opportunity, PageResult, Recommendation, Scan, Website


def _setup_entities(db: Session, prefix: str = "FpModel"):
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
        url=f"https://{prefix.lower()}.com/landing",
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
        finding_type="missing_title",
        category="seo",
        title="Missing Title Tag",
        description="Landing page lacks a title tag.",
        severity="high",
        status="open",
    )
    db.add(finding)
    db.commit()
    db.refresh(finding)

    rec = Recommendation(
        finding_id=finding.id,
        title="Add Descriptive Title Tag",
        description="Insert 55-character title tag.",
        priority="high",
        status="open",
        action_type="meta_tag_fix",
    )
    db.add(rec)
    db.commit()
    db.refresh(rec)

    op = Opportunity(
        website_id=website.id,
        scan_id=scan.id,
        page_id=page.id,
        finding_id=finding.id,
        recommendation_id=rec.id,
        title="Optimize Title Tag",
        description="High ROI title tag optimization.",
        opportunity_type="title_optimization",
        category="seo",
        priority="HIGH",
        priority_score=0.75,
        rationale="High impact, low effort.",
    )
    db.add(op)
    db.commit()
    db.refresh(op)

    return website, scan, page, finding, rec, op


def test_fix_plan_model_creation_and_persistence():
    db = SessionLocal()
    try:
        website, scan, page, finding, rec, op = _setup_entities(db, "Persist")

        plan = FixPlan(
            recommendation_id=rec.id,
            finding_id=finding.id,
            opportunity_id=op.id,
            website_id=website.id,
            scan_id=scan.id,
            page_id=page.id,
            fix_type="meta_tag_improvement",
            title="Fix Plan: Add Title Tag to Landing Page",
            description="Detailed remediation proposal for title tag.",
            problem_statement="Landing page currently has no <title> tag.",
            proposed_action="Insert <title>Landing Page | Acme Brand</title> in head.",
            expected_outcome="Resolves missing title issue and restores CTR.",
            estimated_effort="low",
            risk_level="low",
            priority="high",
            status="draft",
            diff_payload={"before": "None", "after": "<title>Acme</title>"},
            safety_checks={"requires_manual_approval": True, "auto_executable": False},
        )
        db.add(plan)
        db.commit()
        db.refresh(plan)

        assert plan.id is not None
        assert plan.recommendation_id == rec.id
        assert plan.finding_id == finding.id
        assert plan.opportunity_id == op.id
        assert plan.website_id == website.id
        assert plan.fix_type == "meta_tag_improvement"
        assert plan.status == "draft"
        assert plan.created_at is not None
        assert plan.updated_at is not None
    finally:
        db.close()


def test_fix_plan_relationships():
    db = SessionLocal()
    try:
        website, scan, page, finding, rec, op = _setup_entities(db, "Rels")

        plan = FixPlan(
            recommendation_id=rec.id,
            finding_id=finding.id,
            opportunity_id=op.id,
            website_id=website.id,
            scan_id=scan.id,
            page_id=page.id,
            fix_type="meta_tag_improvement",
            title="Relationship Test Plan",
            description="Testing bidirectional ORM relationships.",
            problem_statement="Problem",
            proposed_action="Action",
            expected_outcome="Outcome",
        )
        db.add(plan)
        db.commit()
        db.refresh(plan)

        # Forward relationships
        assert plan.recommendation.id == rec.id
        assert plan.finding.id == finding.id
        assert plan.opportunity.id == op.id
        assert plan.website.id == website.id
        assert plan.scan.id == scan.id
        assert plan.page_result.id == page.id

        # Bidirectional back_populates
        db.refresh(rec)
        assert any(p.id == plan.id for p in rec.fix_plans)

        db.refresh(website)
        assert any(p.id == plan.id for p in website.fix_plans)

        db.refresh(scan)
        assert any(p.id == plan.id for p in scan.fix_plans)

        db.refresh(finding)
        assert any(p.id == plan.id for p in finding.fix_plans)

        db.refresh(op)
        assert any(p.id == plan.id for p in op.fix_plans)
    finally:
        db.close()


def test_fix_plan_cascade_delete_with_recommendation():
    db = SessionLocal()
    try:
        website, scan, page, finding, rec, _ = _setup_entities(db, "Cascade")

        plan = FixPlan(
            recommendation_id=rec.id,
            website_id=website.id,
            fix_type="general_fix",
            title="Cascade Plan",
            description="Should be removed when recommendation is deleted.",
            problem_statement="Problem",
            proposed_action="Action",
            expected_outcome="Outcome",
        )
        db.add(plan)
        db.commit()
        plan_id = plan.id

        # Delete recommendation
        db.delete(rec)
        db.commit()

        # FixPlan must be cascade-deleted
        assert db.get(FixPlan, plan_id) is None
    finally:
        db.close()
