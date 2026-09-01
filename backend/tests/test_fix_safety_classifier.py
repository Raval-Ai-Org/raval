"""
Comprehensive Unit Tests for Three-Tier Safety Classification Engine (Day 10 - Step 3)
"""

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.app.database import Base
from backend.app.fix_safety_classifier import (
    FixSafetyClassification,
    FixSafetyClassifier,
    SafetyTier,
    classify_fix_safety,
)
from backend.app.fix_service import (
    create_fix_plan,
    generate_fix_plan_from_recommendation,
)
from backend.app.models import Finding, PageResult, Recommendation, Scan, Website


@pytest.fixture
def db_session():
    """In-memory SQLite database session fixture."""
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    try:
        yield session
    finally:
        session.close()


# =============================================================================
# 1. AUTO_SAFE Tier Tests
# =============================================================================

def test_auto_safe_meta_tag_and_title():
    """
    Test AUTO_SAFE: Missing/empty meta tags and title length fixes are AUTO_SAFE.
    """
    res = classify_fix_safety(
        finding_type="missing_title",
        category="seo",
        fix_type="meta_tag_improvement",
        severity="medium",
    )
    assert res.safety_tier == SafetyTier.AUTO_SAFE
    assert res.requires_human_approval is False
    assert res.auto_executable is True
    assert res.risk_level == "low"
    assert "policy-auto-safe" in res.policy_rule_id


def test_auto_safe_single_h1_and_heading_hierarchy():
    """
    Test AUTO_SAFE: Heading structure reorganization and missing H1 are AUTO_SAFE.
    """
    res_h1 = classify_fix_safety(
        finding_type="r-str-01",
        category="structure",
        fix_type="heading_structure_fix",
        severity="high",
    )
    assert res_h1.safety_tier == SafetyTier.AUTO_SAFE
    assert res_h1.requires_human_approval is False
    assert res_h1.auto_executable is True
    assert "heading" in res_h1.policy_rule_id

    res_hier = classify_fix_safety(
        finding_type="content_heading_structure",
        category="structure",
        fix_type="heading_structure_fix",
        severity="medium",
    )
    assert res_hier.safety_tier == SafetyTier.AUTO_SAFE
    assert res_hier.auto_executable is True


def test_auto_safe_canonical_and_robots():
    """
    Test AUTO_SAFE: Canonical URL tag and robots.txt fixes are AUTO_SAFE.
    """
    res = classify_fix_safety(
        finding_type="missing_canonical",
        category="seo",
        fix_type="technical_seo_correction",
        severity="medium",
    )
    assert res.safety_tier == SafetyTier.AUTO_SAFE
    assert res.auto_executable is True
    assert "canonical" in res.policy_rule_id


def test_auto_safe_structured_data_syntax():
    """
    Test AUTO_SAFE: JSON-LD structured data syntax fixes are AUTO_SAFE.
    """
    res = classify_fix_safety(
        finding_type="r-qna-03",
        category="questions",
        fix_type="structured_data_injection",
        severity="medium",
    )
    assert res.safety_tier == SafetyTier.AUTO_SAFE
    assert res.auto_executable is True
    assert "structured-data" in res.policy_rule_id


# =============================================================================
# 2. ASSISTED Tier Tests
# =============================================================================

def test_assisted_faq_and_aeo_answer_drafting():
    """
    Test ASSISTED: Direct answer snippet drafting requires human review.
    """
    res = classify_fix_safety(
        finding_type="r-qna-02",
        category="questions",
        fix_type="content_gap_fill",
        severity="high",
    )
    assert res.safety_tier == SafetyTier.ASSISTED
    assert res.requires_human_approval is True
    assert res.auto_executable is False
    assert res.risk_level == "medium"
    assert "assisted" in res.policy_rule_id


def test_assisted_content_gap_fill():
    """
    Test ASSISTED: Substantive content expansion requires human editorial review.
    """
    res = classify_fix_safety(
        finding_type="r-gap-01",
        category="content_gaps",
        fix_type="content_gap_fill",
        severity="high",
    )
    assert res.safety_tier == SafetyTier.ASSISTED
    assert res.requires_human_approval is True
    assert res.auto_executable is False
    assert "gap" in res.policy_rule_id


def test_assisted_topical_and_semantic_expansion():
    """
    Test ASSISTED: Topic depth, semantic coverage, and entity optimization are ASSISTED.
    """
    res_topic = classify_fix_safety(
        finding_type="r-top-03",
        category="topic",
        fix_type="content_gap_fill",
        severity="medium",
    )
    assert res_topic.safety_tier == SafetyTier.ASSISTED
    assert res_topic.requires_human_approval is True

    res_sem = classify_fix_safety(
        finding_type="r-sem-01",
        category="semantic_coverage",
        fix_type="entity_optimization",
        severity="medium",
    )
    assert res_sem.safety_tier == SafetyTier.ASSISTED
    assert res_sem.requires_human_approval is True


def test_assisted_internal_link_addition():
    """
    Test ASSISTED: Internal link recommendations requiring editorial judgment.
    """
    res = classify_fix_safety(
        finding_type="internal_link_addition",
        category="authority_citations",
        fix_type="internal_link_addition",
        severity="medium",
    )
    assert res.safety_tier == SafetyTier.ASSISTED
    assert res.requires_human_approval is True
    assert res.auto_executable is False


# =============================================================================
# 3. MANUAL_REVIEW Tier Tests
# =============================================================================

def test_manual_review_author_credentials():
    """
    Test MANUAL_REVIEW: Author credentials and expertise disclosures require manual review.
    """
    res = classify_fix_safety(
        finding_type="authority_missing_credentials",
        category="trust",
        fix_type="general_fix",
        severity="high",
    )
    assert res.safety_tier == SafetyTier.MANUAL_REVIEW
    assert res.requires_human_approval is True
    assert res.auto_executable is False
    assert res.risk_level == "high"
    assert "credentials" in res.policy_rule_id
    assert "Never fabricate author credentials" in res.reason


def test_manual_review_unsupported_statistical_claims():
    """
    Test MANUAL_REVIEW: Unsupported statistical, superlative, or factual claims require manual review.
    """
    res_stat = classify_fix_safety(
        finding_type="claim_unsupported_statistical",
        category="authority_citations",
        fix_type="general_fix",
        severity="high",
    )
    assert res_stat.safety_tier == SafetyTier.MANUAL_REVIEW
    assert res_stat.requires_human_approval is True
    assert res_stat.auto_executable is False
    assert "unsupported-claims" in res_stat.policy_rule_id
    assert "Never fabricate citations" in res_stat.reason

    res_super = classify_fix_safety(
        finding_type="r-ev-01",
        category="citation",
        fix_type="general_fix",
        severity="high",
    )
    assert res_super.safety_tier == SafetyTier.MANUAL_REVIEW
    assert res_super.requires_human_approval is True


def test_manual_review_business_identity_and_transparency():
    """
    Test MANUAL_REVIEW: Business identity, corporate registration, and contact conflicts.
    """
    res_id = classify_fix_safety(
        finding_type="trust_missing_identity",
        category="trust",
        fix_type="general_fix",
        severity="high",
    )
    assert res_id.safety_tier == SafetyTier.MANUAL_REVIEW
    assert res_id.requires_human_approval is True
    assert "business-identity" in res_id.policy_rule_id


def test_manual_review_broken_external_sources():
    """
    Test MANUAL_REVIEW: Broken external citation links and third-party references.
    """
    res_src = classify_fix_safety(
        finding_type="source_broken_reference_link",
        category="authority_citations",
        fix_type="general_fix",
        severity="high",
    )
    assert res_src.safety_tier == SafetyTier.MANUAL_REVIEW
    assert res_src.requires_human_approval is True
    assert "external-sources" in res_src.policy_rule_id


def test_manual_review_fallback_for_unknown_or_ambiguous():
    """
    Test MANUAL_REVIEW Fallback: Unknown or ambiguous proposals default safely to MANUAL_REVIEW.
    """
    res_unknown = classify_fix_safety(
        finding_type="unregistered_custom_rule_xyz",
        category="custom",
        fix_type="custom_fix",
    )
    assert res_unknown.safety_tier == SafetyTier.MANUAL_REVIEW
    assert res_unknown.requires_human_approval is True
    assert res_unknown.auto_executable is False
    assert "ambiguous-fallback" in res_unknown.policy_rule_id


# =============================================================================
# 4. Invariants, Determinism & Integration Tests
# =============================================================================

def test_deterministic_repeated_classification():
    """
    Test Determinism: Repeated calls with identical inputs produce identical results.
    """
    res1 = classify_fix_safety(finding_type="r-str-01", category="structure", fix_type="heading_structure_fix")
    res2 = classify_fix_safety(finding_type="r-str-01", category="structure", fix_type="heading_structure_fix")
    assert res1.model_dump() == res2.model_dump()


def test_fix_service_integration_with_safety_classification(db_session):
    """
    Test Integration: FixPlan generation populates safety_checks with 3-tier classification
    and does NOT auto-complete or bypass the draft lifecycle.
    """
    web = Website(name="Test Site", url="https://example.com")
    db_session.add(web)
    db_session.commit()
    db_session.refresh(web)

    scan = Scan(website_id=web.id, status="completed")
    db_session.add(scan)
    db_session.commit()
    db_session.refresh(scan)

    page = PageResult(scan_id=scan.id, url="https://example.com/blog")
    db_session.add(page)
    db_session.commit()
    db_session.refresh(page)

    # 1. Test AUTO_SAFE generation
    f_safe = Finding(
        website_id=web.id,
        scan_id=scan.id,
        page_id=page.id,
        finding_type="r-str-01",
        category="structure",
        title="Missing H1",
        description="Page lacks H1.",
        severity="high",
    )
    db_session.add(f_safe)
    db_session.commit()
    db_session.refresh(f_safe)

    rec_safe = Recommendation(
        finding_id=f_safe.id,
        title="Add Single H1",
        description="Insert primary H1.",
        priority="high",
        action_type="heading_reorganization",
        impact="Improves semantic hierarchy",
    )
    db_session.add(rec_safe)
    db_session.commit()
    db_session.refresh(rec_safe)

    plan_safe = generate_fix_plan_from_recommendation(db_session, rec_safe.id)
    assert plan_safe.status == "draft"  # AUTO_SAFE does NOT auto-approve!
    assert plan_safe.safety_checks["safety_tier"] == "auto_safe"
    assert plan_safe.safety_checks["auto_safe_eligible"] is True
    assert plan_safe.safety_checks["auto_executable"] is False
    assert plan_safe.safety_checks["requires_manual_approval"] is True
    assert "heading" in plan_safe.safety_checks["policy_rule_id"]


    # 2. Test MANUAL_REVIEW generation
    f_manual = Finding(
        website_id=web.id,
        scan_id=scan.id,
        page_id=page.id,
        finding_type="authority_missing_credentials",
        category="trust",
        title="Missing Author Credentials",
        description="No author bio or credentials.",
        severity="high",
    )
    db_session.add(f_manual)
    db_session.commit()
    db_session.refresh(f_manual)

    rec_manual = Recommendation(
        finding_id=f_manual.id,
        title="Add Author Byline & Bio",
        description="Disclose author credentials.",
        priority="high",
        action_type="general_fix",
    )
    db_session.add(rec_manual)
    db_session.commit()
    db_session.refresh(rec_manual)

    plan_manual = generate_fix_plan_from_recommendation(db_session, rec_manual.id)
    assert plan_manual.status == "draft"
    assert plan_manual.safety_checks["safety_tier"] == "manual_review"
    assert plan_manual.safety_checks["requires_human_approval"] is True
    assert plan_manual.safety_checks["auto_executable"] is False
    assert "credentials" in plan_manual.safety_checks["policy_rule_id"]
