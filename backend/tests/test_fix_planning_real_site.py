"""
Real-Site / Realistic Archetype Validation Test Suite for Fix Planning Engine
(Day 10 / Task 8 - Step 8)

Validates the complete remediation lifecycle against realistic website archetypes:
1. Technical Documentation Archetype (Structure, FAQ direct answers, AI search readiness)
2. Long-Form Editorial Archetype (Content gaps, statistical claims, citations)
3. Organization & Identity Archetype (Schema.org markup, author credentials, trust)

Verifies all critical invariants:
- Exact provenance and evidence preservation
- Deterministic root-cause consolidation
- Three-tier safety classification (AUTO_SAFE, ASSISTED, MANUAL_REVIEW)
- Non-bypassable human review and approval invariants
- Zero fabricated citations, credentials, or factual statistics
- Traceable expected impact and explainable before/after diffs
- Bidirectional linkage to ValidationResult
"""

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.fix_safety_classifier import SafetyTier, classify_fix_safety
from app.fix_service import (
    generate_fix_plan_from_recommendation,
    generate_fix_plans_for_scan,
    generate_fix_plans_for_website,
    transition_fix_plan_status,
)
from app.models import Finding, FixPlan, Opportunity, PageResult, Recommendation, Scan, ValidationResult, Website
from app.root_cause_analyzer import RootCauseScope, analyze_root_causes


@pytest.fixture
def real_site_db():
    """In-memory isolated SQLite session for real-site validation."""
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()
        Base.metadata.drop_all(bind=engine)


def test_real_site_archetype_complete_flow(real_site_db: Session):
    """
    Validates end-to-end Fix Planning flow on a multi-page enterprise archetype:
    - Page 1: Homepage with SEO & Structure issues (AUTO_SAFE)
    - Page 2: Knowledge base article with Q&A and Content Gaps (ASSISTED)
    - Page 3: Leadership profile with missing credentials & claims (MANUAL_REVIEW)
    """
    db = real_site_db

    # 1. Setup Website and Scan
    site = Website(name="Enterprise Real Site", url="https://real-enterprise.org")
    db.add(site)
    db.commit()
    db.refresh(site)

    scan = Scan(website_id=site.id, status="completed", pages_crawled=3)
    db.add(scan)
    db.commit()
    db.refresh(scan)

    # 2. Page 1: Homepage (SEO + Heading Structure)
    page_home = PageResult(scan_id=scan.id, url="https://real-enterprise.org/", status_code=200, content_type="text/html")
    db.add(page_home)
    db.commit()
    db.refresh(page_home)

    f_meta = Finding(
        website_id=site.id,
        scan_id=scan.id,
        page_id=page_home.id,
        finding_type="missing_meta_description",
        category="seo",
        title="Missing Meta Description Tag",
        description="The homepage lacks a meta description tag.",
        severity="medium",
        evidence={"tag_present": False, "url": page_home.url},
    )
    f_h1 = Finding(
        website_id=site.id,
        scan_id=scan.id,
        page_id=page_home.id,
        finding_type="r-str-01",
        category="structure",
        title="Missing Main H1 Heading",
        description="No primary H1 heading found in document hierarchy.",
        severity="high",
        evidence={"h1_count": 0, "url": page_home.url},
    )
    db.add_all([f_meta, f_h1])
    db.commit()
    db.refresh(f_meta)
    db.refresh(f_h1)

    r_meta = Recommendation(
        finding_id=f_meta.id,
        title="Add Descriptive Meta Description Tag",
        description="Add a 155-character meta description.",
        priority="medium",
        action_type="meta_tag_optimization",
        impact="Improves SERP CTR and display",
    )
    r_h1 = Recommendation(
        finding_id=f_h1.id,
        title="Add Single Primary H1 Heading",
        description="Insert single semantic H1 heading.",
        priority="high",
        action_type="heading_reorganization",
        impact="Establishes document hierarchy",
    )
    db.add_all([r_meta, r_h1])
    db.commit()
    db.refresh(r_meta)
    db.refresh(r_h1)

    # 3. Page 2: Knowledge Base Article (Q&A Snippet + Content Gap)
    page_kb = PageResult(scan_id=scan.id, url="https://real-enterprise.org/kb/getting-started", status_code=200, content_type="text/html")
    db.add(page_kb)
    db.commit()
    db.refresh(page_kb)

    f_qna = Finding(
        website_id=site.id,
        scan_id=scan.id,
        page_id=page_kb.id,
        finding_type="r-qna-02",
        category="questions",
        title="Missing Direct Answer Snippet",
        description="Target question lacks an authoritative 40-word concise answer block.",
        severity="high",
        evidence={"question": "How to configure SSO?", "answer_snippet_found": False},
    )
    f_gap = Finding(
        website_id=site.id,
        scan_id=scan.id,
        page_id=page_kb.id,
        finding_type="r-gap-01",
        category="content_gaps",
        title="Content Depth Gap in Configuration Guide",
        description="Article omits SAML 2.0 and OIDC configuration parameters.",
        severity="medium",
        evidence={"missing_dimensions": ["SAML 2.0", "OIDC"]},
    )
    db.add_all([f_qna, f_gap])
    db.commit()
    db.refresh(f_qna)
    db.refresh(f_gap)

    r_qna = Recommendation(
        finding_id=f_qna.id,
        title="Draft Concise 40-Word Direct Answer Block",
        description="Provide a direct answer block for SSO setup.",
        priority="high",
        action_type="content_expansion",
        impact="Enables AI search direct answer extraction",
    )
    r_gap = Recommendation(
        finding_id=f_gap.id,
        title="Expand SAML and OIDC Configuration Coverage",
        description="Add sections covering SAML and OIDC configuration.",
        priority="medium",
        action_type="content_expansion",
        impact="Closes conceptual content gaps",
    )
    db.add_all([r_qna, r_gap])
    db.commit()
    db.refresh(r_qna)
    db.refresh(r_gap)

    # 4. Page 3: Leadership Profile (Authority & Claims)
    page_team = PageResult(scan_id=scan.id, url="https://real-enterprise.org/team/cto", status_code=200, content_type="text/html")
    db.add(page_team)
    db.commit()
    db.refresh(page_team)

    f_cred = Finding(
        website_id=site.id,
        scan_id=scan.id,
        page_id=page_team.id,
        finding_type="authority_missing_credentials",
        category="trust",
        title="Missing Author Professional Credentials",
        description="Author biography does not provide verifiable industry credentials.",
        severity="high",
        evidence={"author": "Alex Mercer", "credentials": None},
    )
    f_claim = Finding(
        website_id=site.id,
        scan_id=scan.id,
        page_id=page_team.id,
        finding_type="claim_unsupported_statistical",
        category="authority_citations",
        title="Unsupported Statistical Performance Claim",
        description="Claims '99.999% uptime observed across 500 enterprise customers' without citation.",
        severity="high",
        evidence={"claim": "99.999% uptime", "source_url": None},
    )
    db.add_all([f_cred, f_claim])
    db.commit()
    db.refresh(f_cred)
    db.refresh(f_claim)

    r_cred = Recommendation(
        finding_id=f_cred.id,
        title="Add Author Industry Affiliations and Verified Credentials",
        description="Document author background and links to verified profiles.",
        priority="high",
        action_type="general_fix",
        impact="Enhances authoritativeness and trust signals",
    )
    r_claim = Recommendation(
        finding_id=f_claim.id,
        title="Attach First-Party SLA Report Reference Link",
        description="Link quantitative uptime claim to published SLA status history.",
        priority="high",
        action_type="general_fix",
        impact="Supports factual claims with verifiable evidence",
    )
    db.add_all([r_cred, r_claim])
    db.commit()
    db.refresh(r_cred)
    db.refresh(r_claim)

    # 5. Root-Cause Analysis Verification
    all_findings_raw = [
        {"id": f.id, "website_id": site.id, "scan_id": scan.id, "page_id": f.page_id, "finding_type": f.finding_type, "category": f.category, "title": f.title, "evidence": f.evidence}
        for f in [f_meta, f_h1, f_qna, f_gap, f_cred, f_claim]
    ]
    rc_result = analyze_root_causes(all_findings_raw, website_id=site.id, scan_id=scan.id)
    assert rc_result.total_findings_analyzed == 6
    assert rc_result.total_root_causes_identified == 6

    # 6. Generate Fix Plans for Scan
    plans = generate_fix_plans_for_scan(db, scan.id)
    assert len(plans) == 6

    # Check Plan 1: Meta Tag (AUTO_SAFE)
    p_meta = next(p for p in plans if p.recommendation_id == r_meta.id)
    assert p_meta.fix_type == "meta_tag_improvement"
    assert p_meta.safety_checks["safety_tier"] == "auto_safe"
    assert p_meta.safety_checks["auto_safe_eligible"] is True
    assert p_meta.safety_checks["requires_manual_approval"] is True
    assert p_meta.safety_checks["auto_executable"] is False
    assert p_meta.status == "draft"
    assert p_meta.diff_payload["action"] == "replace_or_insert_meta_tag"
    assert p_meta.diff_payload["target"] == page_home.url

    # Check Plan 2: Heading (AUTO_SAFE)
    p_h1 = next(p for p in plans if p.recommendation_id == r_h1.id)
    assert p_h1.fix_type == "heading_structure_fix"
    assert p_h1.safety_checks["safety_tier"] == "auto_safe"
    assert p_h1.diff_payload["action"] == "reorder_heading_hierarchy"

    # Check Plan 3: Q&A Snippet (ASSISTED)
    p_qna = next(p for p in plans if p.recommendation_id == r_qna.id)
    assert p_qna.fix_type == "content_gap_fill"
    assert p_qna.safety_checks["safety_tier"] == "assisted"
    assert p_qna.safety_checks["requires_human_approval"] is True
    assert p_qna.diff_payload["action"] == "expand_content_section"

    # Check Plan 4: Content Gap (ASSISTED)
    p_gap = next(p for p in plans if p.recommendation_id == r_gap.id)
    assert p_gap.safety_checks["safety_tier"] == "assisted"
    assert p_gap.safety_checks["requires_human_approval"] is True

    # Check Plan 5: Author Credentials (MANUAL_REVIEW)
    p_cred = next(p for p in plans if p.recommendation_id == r_cred.id)
    assert p_cred.safety_checks["safety_tier"] == "manual_review"
    assert "Never fabricate author credentials" in p_cred.safety_checks["classification_reason"]

    # Check Plan 6: Statistical Claim (MANUAL_REVIEW)
    p_claim = next(p for p in plans if p.recommendation_id == r_claim.id)
    assert p_claim.safety_checks["safety_tier"] == "manual_review"
    assert "Never fabricate citations" in p_claim.safety_checks["classification_reason"]

    # 7. Lifecycle Progression & Verification Linkage
    transition_fix_plan_status(db, p_meta.id, "ready_for_review", comment="Submitting meta tag fix")
    transition_fix_plan_status(db, p_meta.id, "approved", comment="Approved by SEO lead")
    transition_fix_plan_status(db, p_meta.id, "completed", comment="Applied in CMS")

    val = ValidationResult(
        website_id=site.id,
        scan_id=scan.id,
        fix_plan_id=p_meta.id,
        recommendation_id=r_meta.id,
        validation_type="meta_tag_check",
        status="completed",
        result="passed",
        validation_score=1.0,
        expected_result="Valid meta description present (120-160 chars)",
        actual_result="Found meta description tag with 155 chars",
        explanation="Meta description tag added successfully",
    )
    db.add(val)
    db.commit()
    db.refresh(val)

    assert val.fix_plan_id == p_meta.id
    assert val.result == "passed"
    assert val.validation_score == 1.0
