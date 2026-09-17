"""
Task 6.9 Fix Engine & Validation Engine Tests
Verifies extended status lifecycle (proposed, validated, applied, failed),
transition guardrails, validation rule evaluation, and provenance.
"""

from fastapi.testclient import TestClient
import pytest
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.fix_service import (
    ALLOWED_FIX_STATUSES,
    ALLOWED_STATUS_TRANSITIONS,
    generate_fix_plan_from_recommendation,
    get_fix_plan,
    transition_fix_plan_status,
)
from app.main import app
from app.models import Finding, FixPlan, Opportunity, PageResult, Recommendation, Scan, ValidationResult, Website
from app.validation_service import (
    evaluate_validation_rule,
    validate_fix_plan,
)

client = TestClient(app)


def _setup_website_and_scan(db: Session, prefix: str = "FixVal69"):
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
        url=f"https://{prefix.lower()}.com/page",
        status_code=200,
        content_type="text/html",
    )
    db.add(page)
    db.commit()
    db.refresh(page)

    finding = Finding(
        scan_id=scan.id,
        page_id=page.id,
        website_id=website.id,
        finding_type="missing_title",
        category="seo",
        title="Missing Title",
        description="Missing title tag on page",
        severity="high",
        status="open",
    )
    db.add(finding)
    db.commit()
    db.refresh(finding)

    rec = Recommendation(
        finding_id=finding.id,
        title="Add SEO Title",
        description="Add appropriate title tag",
        action_type="meta_tag_fix",
        status="open",
    )
    db.add(rec)
    db.commit()
    db.refresh(rec)

    return website, scan, page, finding, rec


def test_fix_plan_extended_lifecycle_transitions():
    db = SessionLocal()
    try:
        website, scan, page, finding, rec = _setup_website_and_scan(db, "Lifecycle")

        # Generate plan from recommendation
        plan = generate_fix_plan_from_recommendation(db, rec.id)
        assert plan.status == "draft"

        # Transition draft -> proposed
        t_prop = transition_fix_plan_status(db, plan.id, "proposed")
        assert t_prop.status == "proposed"

        # Transition proposed -> validated
        t_val = transition_fix_plan_status(db, plan.id, "validated")
        assert t_val.status == "validated"

        # Transition validated -> applied
        t_app = transition_fix_plan_status(db, plan.id, "applied")
        assert t_app.status == "applied"

        # Transition applied -> completed
        t_comp = transition_fix_plan_status(db, plan.id, "completed")
        assert t_comp.status == "completed"
    finally:
        db.close()


def test_fix_plan_illegal_lifecycle_transitions():
    db = SessionLocal()
    try:
        website, scan, page, finding, rec = _setup_website_and_scan(db, "IllegalState")

        plan = generate_fix_plan_from_recommendation(db, rec.id)
        assert plan.status == "draft"

        # Draft cannot jump directly to completed
        with pytest.raises(ValueError, match="Cannot transition fix plan"):
            transition_fix_plan_status(db, plan.id, "completed")
    finally:
        db.close()


def test_validation_engine_rule_evaluation_and_unable_to_validate():
    # Rule evaluation with no after_state evaluates to FAIL
    result, score, actual, explanation, feedback = evaluate_validation_rule(
        validation_type="meta_tag_validation",
        before_state={"title": ""},
        after_state=None,
        expected_outcome="Non-empty title tag between 10 and 70 characters.",
    )
    assert result == "FAIL"
    assert score == 0.0

    # Rule evaluation with valid after_state evaluates to PASS
    result_p, score_p, actual_p, explanation_p, feedback_p = evaluate_validation_rule(
        validation_type="meta_tag_validation",
        before_state={"title": ""},
        after_state={
            "title": "High Quality Optimized Page Title for GEO Intelligence",
            "description": "High quality descriptive meta tag between 50 and 200 characters long.",
        },
        expected_outcome="Non-empty title tag between 10 and 70 characters.",
    )
    assert result_p == "PASS"
    assert score_p == 1.0


def test_fix_validation_api_flow():
    db = SessionLocal()
    try:
        website, scan, page, finding, rec = _setup_website_and_scan(db, "APIValFlow")

        plan = generate_fix_plan_from_recommendation(db, rec.id)
        # Set to ready_for_review
        transition_fix_plan_status(db, plan.id, "ready_for_review")

        # Trigger validation API with valid simulated state
        simulated_after = {
            "title": "SEO Optimized Page Title for Direct Verification",
            "description": "Comprehensive meta description meeting all SEO and GEO requirements.",
        }
        res = client.post(
            f"/api/v1/fix-plans/{plan.id}/validate",
            json={"simulated_after_state": simulated_after},
        )
        assert res.status_code == 200
        val_data = res.json()
        assert val_data["result"] == "PASS"
        assert val_data["validation_score"] == 1.0

        # Ensure plan was updated to completed and recommendation to resolved
        db.refresh(plan)
        db.refresh(rec)
        assert plan.status == "completed"
        assert rec.status == "resolved"
    finally:
        db.close()
