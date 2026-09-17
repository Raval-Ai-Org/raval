import pytest
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.fix_service import generate_fix_plan_from_recommendation
from app.models import Finding, FixPlan, Opportunity, PageResult, Recommendation, Scan, ValidationResult, Website
from app.recommendation_service import generate_recommendation_from_finding
from app.validation_service import (
    batch_validate_scan,
    batch_validate_website,
    create_validation,
    evaluate_validation_rule,
    get_validation,
    list_validations,
    validate_fix_plan,
    validate_recommendation,
)


def _setup_entities(db: Session, prefix: str = "ValEng"):
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

    rec = generate_recommendation_from_finding(db, finding.id)
    plan = generate_fix_plan_from_recommendation(db, rec.id)

    return website, scan, page, finding, rec, plan


def test_evaluate_meta_tag_rule():
    # PASS
    res, score, act, exp, fb = evaluate_validation_rule(
        "meta_tag_validation",
        before_state={"title": None},
        after_state={"title": "Acme Software - Enterprise Intelligence Platform"},
        expected_outcome="Add descriptive title tag 10-70 chars.",
    )
    assert res == "PASS"
    assert score == 1.0
    assert 0.0 <= score <= 1.0

    # PARTIAL (too short)
    res_p, score_p, _, _, _ = evaluate_validation_rule(
        "meta_tag_validation",
        before_state={"title": None},
        after_state={"title": "Short"},
        expected_outcome="Add descriptive title tag 10-70 chars.",
    )
    assert res_p == "PARTIAL"
    assert score_p == 0.5

    # FAIL (missing)
    res_f, score_f, _, _, _ = evaluate_validation_rule(
        "meta_tag_validation",
        before_state={"title": None},
        after_state=None,
        expected_outcome="Add title tag",
    )
    assert res_f == "FAIL"
    assert score_f == 0.0


def test_evaluate_structured_data_rule():
    # PASS
    valid_schema = {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        "mainEntity": [],
    }
    res, score, _, _, _ = evaluate_validation_rule(
        "structured_data_validation",
        before_state=None,
        after_state=valid_schema,
        expected_outcome="Inject valid FAQPage schema",
    )
    assert res == "PASS"
    assert score == 1.0

    # PARTIAL (missing @context)
    missing_ctx = {"@type": "FAQPage"}
    res_p, score_p, _, _, _ = evaluate_validation_rule(
        "structured_data_validation",
        before_state=None,
        after_state=missing_ctx,
        expected_outcome="Inject valid schema",
    )
    assert res_p == "PARTIAL"
    assert score_p == 0.5

    # FAIL
    res_f, score_f, _, _, _ = evaluate_validation_rule(
        "structured_data_validation",
        before_state=None,
        after_state={},
        expected_outcome="Inject schema",
    )
    assert res_f == "FAIL"
    assert score_f == 0.0


def test_evaluate_heading_and_content_rules():
    # Heading PASS
    res_h, score_h, _, _, _ = evaluate_validation_rule(
        "heading_structure_validation",
        before_state={"h1_count": 0},
        after_state={"h1_count": 1},
        expected_outcome="Ensure exactly 1 H1 heading",
    )
    assert res_h == "PASS"
    assert score_h == 1.0

    # Heading FAIL
    res_h_fail, score_h_fail, _, _, _ = evaluate_validation_rule(
        "heading_structure_validation",
        before_state={"h1_count": 0},
        after_state={"h1_count": 3},
        expected_outcome="Ensure exactly 1 H1 heading",
    )
    assert res_h_fail == "FAIL"
    assert score_h_fail == 0.0

    # Content gap PASS
    res_c, score_c, _, _, _ = evaluate_validation_rule(
        "content_gap_validation",
        before_state={"word_count": 150},
        after_state={"word_count": 400},
        expected_outcome="Expand content by at least 50 words",
    )
    assert res_c == "PASS"
    assert score_c == 1.0


def test_evaluate_aeo_and_entity_rules():
    # AEO PASS (direct concise answer 15-85 words)
    good_answer = "Raval GEO Intelligence provides deterministic search visibility analysis and AI citation monitoring for enterprise brands across global search engines."
    res_a, score_a, _, _, _ = evaluate_validation_rule(
        "aeo_validation",
        before_state=None,
        after_state={"direct_answer": good_answer},
        expected_outcome="Provide direct answer block",
    )
    assert res_a == "PASS"
    assert score_a == 1.0

    # Entity PASS
    res_e, score_e, _, _, _ = evaluate_validation_rule(
        "entity_validation",
        before_state=None,
        after_state={"name": "Acme Corp", "same_as": "https://www.wikidata.org/wiki/Q1234"},
        expected_outcome="Add sameAs authority link",
    )
    assert res_e == "PASS"
    assert score_e == 1.0


def test_validate_fix_plan_service_and_persistence():
    db = SessionLocal()
    try:
        website, scan, page, finding, rec, plan = _setup_entities(db, "ValPersist")

        # Run validation with simulated valid after-state
        val = validate_fix_plan(
            db,
            plan.id,
            simulated_after_state={"title": "Optimized Landing Page Title | Acme Solutions"},
        )

        assert val.id is not None
        assert val.fix_plan_id == plan.id
        assert val.recommendation_id == rec.id
        assert val.website_id == website.id
        assert val.scan_id == scan.id
        assert val.result == "PASS"
        assert val.validation_score == 1.0
        assert val.status == "completed"

        # Relationships
        assert val.fix_plan.id == plan.id
        assert val.recommendation.id == rec.id
        assert val.website.id == website.id

        # Bidirectional
        db.refresh(plan)
        assert any(v.id == val.id for v in plan.validations)
    finally:
        db.close()


def test_validate_recommendation_service():
    db = SessionLocal()
    try:
        website, scan, page, finding, rec, _ = _setup_entities(db, "ValRec")

        val = validate_recommendation(
            db,
            rec.id,
            simulated_after_state={"title": "Valid 45 Character Title For Page Header"},
        )

        assert val.id is not None
        assert val.recommendation_id == rec.id
        assert val.result == "PASS"
    finally:
        db.close()


def test_batch_validation_for_scan_and_website():
    db = SessionLocal()
    try:
        website, scan, page, finding, rec, plan = _setup_entities(db, "BatchVal")

        scan_vals = batch_validate_scan(db, scan.id)
        assert len(scan_vals) >= 1

        web_vals = batch_validate_website(db, website.id)
        assert len(web_vals) >= 1

        # List validations with filter
        filtered = list_validations(db, website_id=website.id)
        assert len(filtered) >= 1
    finally:
        db.close()


def test_manual_create_and_get_validation():
    db = SessionLocal()
    try:
        website, scan, page, finding, rec, plan = _setup_entities(db, "ManualVal")

        created = create_validation(
            db,
            {
                "website_id": website.id,
                "fix_plan_id": plan.id,
                "validation_type": "meta_tag_validation",
                "expected_result": "Title tag 10-70 chars",
                "after_state": {"title": "Brand New Title Tag For The Page"},
            },
        )
        assert created.id is not None
        assert created.result == "PASS"

        fetched = get_validation(db, created.id)
        assert fetched.id == created.id
    finally:
        db.close()
