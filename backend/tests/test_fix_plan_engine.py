import pytest
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.fix_service import (
    ALLOWED_FIX_STATUSES,
    ALLOWED_FIX_TYPES,
    ALLOWED_RISK_LEVELS,
    ALLOWED_STATUS_TRANSITIONS,
    create_fix_plan,
    delete_fix_plan,
    generate_fix_plan_from_recommendation,
    generate_fix_plans_for_scan,
    generate_fix_plans_for_website,
    get_fix_plan,
    list_fix_plans,
    map_action_to_fix_type,
    transition_fix_plan_status,
    update_fix_plan,
)
from app.models import Finding, FixPlan, Opportunity, PageResult, Recommendation, Scan, Website


def _setup_entities(db: Session, prefix: str = "FpEng"):
    website = Website(name=f"{prefix} Site", url=f"https://{prefix.lower()}.com")
    db.add(website)
    db.commit()
    db.refresh(website)

    scan = Scan(website_id=website.id, status="completed", pages_crawled=1)
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
        description="Questions found without JSON-LD schema.",
        severity="high",
        status="open",
    )
    db.add(finding)
    db.commit()
    db.refresh(finding)

    rec = Recommendation(
        finding_id=finding.id,
        title="Inject FAQPage Structured Data",
        description="Add FAQPage schema to page header.",
        priority="high",
        status="open",
        action_type="schema_markup",
        payload={"effort": "medium", "category": "structured_data"},
    )
    db.add(rec)
    db.commit()
    db.refresh(rec)

    return website, scan, page, finding, rec


def test_action_to_fix_type_mapping():
    fix_type, risk, effort = map_action_to_fix_type("meta_tag_fix")
    assert fix_type == "meta_tag_improvement"
    assert risk == "low"
    assert effort == "low"

    fix_type, risk, effort = map_action_to_fix_type("schema_markup")
    assert fix_type == "structured_data_injection"
    assert risk == "low"
    assert effort == "medium"

    fix_type, risk, effort = map_action_to_fix_type("heading_fix")
    assert fix_type == "heading_structure_fix"
    assert risk == "medium"

    fix_type, risk, effort = map_action_to_fix_type("canonical_fix")
    assert fix_type == "technical_seo_correction"
    assert risk == "high"


def test_generate_fix_plan_from_recommendation():
    db = SessionLocal()
    try:
        website, scan, page, finding, rec = _setup_entities(db, "GenPlan")

        plan = generate_fix_plan_from_recommendation(db, rec.id)

        assert plan.id is not None
        assert plan.recommendation_id == rec.id
        assert plan.finding_id == finding.id
        assert plan.website_id == website.id
        assert plan.scan_id == scan.id
        assert plan.page_id == page.id
        assert plan.fix_type == "structured_data_injection"
        assert plan.risk_level == "low"
        assert plan.estimated_effort == "medium"
        assert plan.priority == "high"
        assert plan.status == "draft"

        # Verify structured diff payload
        assert isinstance(plan.diff_payload, dict)
        assert "target" in plan.diff_payload
        assert "action" in plan.diff_payload
        assert plan.diff_payload["action"] == "insert_json_ld_script"

        # Verify safety checks
        assert isinstance(plan.safety_checks, dict)
        assert plan.safety_checks["requires_manual_approval"] is True
        assert plan.safety_checks["auto_executable"] is False
    finally:
        db.close()


def test_fix_plan_deduplication():
    db = SessionLocal()
    try:
        website, scan, page, finding, rec = _setup_entities(db, "DedupePlan")

        # 1. First generation creates plan
        plan1 = generate_fix_plan_from_recommendation(db, rec.id)
        plan1_id = plan1.id

        # 2. Second generation updates existing plan
        plan2 = generate_fix_plan_from_recommendation(db, rec.id)
        assert plan2.id == plan1_id

        # Verify only 1 fix plan exists for (recommendation_id, fix_type)
        count = (
            db.query(FixPlan)
            .filter(
                FixPlan.recommendation_id == rec.id,
                FixPlan.fix_type == "structured_data_injection",
            )
            .count()
        )
        assert count == 1
    finally:
        db.close()


def test_fix_plan_status_lifecycle_transitions():
    db = SessionLocal()
    try:
        website, scan, page, finding, rec = _setup_entities(db, "Lifecycle")
        plan = generate_fix_plan_from_recommendation(db, rec.id)
        assert plan.status == "draft"

        # 1. draft -> ready_for_review
        transition_fix_plan_status(db, plan.id, "ready_for_review", comment="Ready for QA review")
        assert plan.status == "ready_for_review"

        # 2. ready_for_review -> approved
        transition_fix_plan_status(db, plan.id, "approved", comment="Approved by SEO Lead")
        assert plan.status == "approved"

        # 3. approved -> completed
        transition_fix_plan_status(db, plan.id, "completed", comment="Fix deployed to staging")
        assert plan.status == "completed"

        # 4. Attempting to transition from terminal completed state must fail
        with pytest.raises(ValueError, match="Cannot transition fix plan from 'completed'"):
            transition_fix_plan_status(db, plan.id, "draft")

        # Verify transition audit history
        assert "audit_history" in plan.safety_checks
        assert len(plan.safety_checks["audit_history"]) == 3
    finally:
        db.close()


def test_safety_enforcement_cannot_complete_unapproved_plan():
    db = SessionLocal()
    try:
        website, scan, page, finding, rec = _setup_entities(db, "Safety")
        plan = generate_fix_plan_from_recommendation(db, rec.id)
        assert plan.status == "draft"

        # Direct transition from draft to completed must fail
        with pytest.raises(ValueError, match="Cannot transition fix plan from 'draft' to 'completed'"):
            transition_fix_plan_status(db, plan.id, "completed")
    finally:
        db.close()


def test_batch_generate_fix_plans():
    db = SessionLocal()
    try:
        website, scan, page, finding, rec = _setup_entities(db, "BatchPlan")

        scan_plans = generate_fix_plans_for_scan(db, scan.id)
        assert len(scan_plans) >= 1
        assert scan_plans[0].recommendation_id == rec.id

        web_plans = generate_fix_plans_for_website(db, website.id)
        assert len(web_plans) >= 1
    finally:
        db.close()


def test_manual_create_and_delete_fix_plan():
    db = SessionLocal()
    try:
        website, scan, page, finding, rec = _setup_entities(db, "ManualPlan")

        created = create_fix_plan(
            db,
            {
                "recommendation_id": rec.id,
                "website_id": website.id,
                "scan_id": scan.id,
                "fix_type": "content_gap_fill",
                "title": "Manual Fix Plan",
                "description": "Manual remediation plan",
                "problem_statement": "Identified gap",
                "proposed_action": "Add 2 paragraphs",
                "expected_outcome": "Better coverage",
                "estimated_effort": "medium",
                "risk_level": "medium",
                "priority": "high",
                "status": "draft",
            },
        )
        assert created.id is not None
        assert created.title == "Manual Fix Plan"

        # List
        plans = list_fix_plans(db, recommendation_id=rec.id)
        assert len(plans) >= 1

        # Delete
        pid = created.id
        assert delete_fix_plan(db, pid) is True
        with pytest.raises(ValueError, match="FixPlan not found"):
            get_fix_plan(db, pid)
    finally:
        db.close()
