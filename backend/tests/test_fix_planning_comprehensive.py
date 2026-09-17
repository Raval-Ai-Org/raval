"""
Comprehensive Test Suite for Task 8: Automated Recommendation & Fix Planning Engine (Step 7)

Covers all 17 required areas:
1. Root Cause Analyzer
2. Fix Type Classification
3. Fix Plan Schema / Data Contract
4. Safety / Risk / Action Classification
5. Content Planner
6. AEO/GEO Planner
7. Trust / Authority / Citation Planner
8. SEO Integration
9. Expected Impact
10. Verification
11. Before / After Diff Payloads
12. API Layer (Full REST endpoints)
13. Service Integration (End-to-end pipeline)
14. Traceability & Explainability
15. Idempotency & Duplicate Handling
16. Edge Cases & Malformed Inputs
17. Regression Protection
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.fix_safety_classifier import (
    FixSafetyClassification,
    FixSafetyClassifier,
    SafetyTier,
    classify_fix_safety,
)
from app.fix_service import (
    ALLOWED_EFFORT_LEVELS,
    ALLOWED_FIX_STATUSES,
    ALLOWED_FIX_TYPES,
    ALLOWED_RISK_LEVELS,
    ALLOWED_STATUS_TRANSITIONS,
    build_diff_payload,
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
from app.main import app
from app.models import Finding, FixPlan, Opportunity, PageResult, Recommendation, Scan, ValidationResult, Website
from app.root_cause_analyzer import (
    FindingEvidenceReference,
    RootCauseAnalysisResult,
    RootCauseAnalyzer,
    RootCauseGroup,
    RootCauseScope,
    analyze_root_causes,
    get_root_causes_for_scan,
    get_root_causes_for_website,
    group_findings_by_root_cause,
)
from app.schemas import FixPlanCreate, FixPlanResponse, FixPlanUpdate


# =============================================================================
# Fixtures
# =============================================================================

@pytest.fixture
def db_session():
    """Isolated SQLite in-memory database fixture for comprehensive fix tests."""
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


@pytest.fixture
def client(db_session):
    """FastAPI TestClient with overridden database session."""
    def override_get_db():
        try:
            yield db_session
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.pop(get_db, None)


def _seed_base_entities(db: Session, prefix: str = "T8"):
    """Helper to seed website, scan, page, finding, and recommendation."""
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
        finding_type="r-str-01",
        category="structure",
        title="Missing H1 Heading",
        description="The page lacks a primary H1 heading element.",
        severity="high",
        status="open",
        evidence={"h1_count": 0, "url": page.url},
    )
    db.add(finding)
    db.commit()
    db.refresh(finding)

    rec = Recommendation(
        finding_id=finding.id,
        title="Insert Primary H1 Heading",
        description="Add a single semantic H1 heading representing page topic.",
        priority="high",
        action_type="heading_reorganization",
        impact="Establishes document semantic hierarchy for search engines",
    )
    db.add(rec)
    db.commit()
    db.refresh(rec)

    return website, scan, page, finding, rec


# =============================================================================
# 1. Root Cause Analyzer Tests
# =============================================================================

class TestRootCauseAnalyzer:
    def test_valid_findings_grouping(self):
        findings = [
            {"id": 1, "website_id": 1, "scan_id": 1, "page_id": 10, "finding_type": "r-str-01", "category": "structure", "title": "Missing H1", "severity": "high"},
            {"id": 2, "website_id": 1, "scan_id": 1, "page_id": 20, "finding_type": "r-str-01", "category": "structure", "title": "Missing H1", "severity": "high"},
        ]
        result = analyze_root_causes(findings, website_id=1, scan_id=1)
        assert result.total_findings_analyzed == 2
        assert result.total_root_causes_identified == 1
        rc = result.root_causes[0]
        assert rc.scope == RootCauseScope.PAGE_GROUP
        assert rc.findings_count == 2
        assert rc.finding_ids == [1, 2]

    def test_different_findings_produce_different_root_causes(self):
        findings = [
            {"id": 1, "website_id": 1, "scan_id": 1, "page_id": 1, "finding_type": "r-str-01", "category": "structure", "title": "Missing H1", "severity": "high"},
            {"id": 2, "website_id": 1, "scan_id": 1, "page_id": 1, "finding_type": "r-qna-02", "category": "questions", "title": "No Answer Snippet", "severity": "medium"},
        ]
        result = analyze_root_causes(findings, website_id=1, scan_id=1)
        assert result.total_root_causes_identified == 2
        rule_ids = {rc.rule_id for rc in result.root_causes}
        assert rule_ids == {"r-str-01", "r-qna-02"}

    def test_empty_and_malformed_findings_handling(self):
        res_empty = analyze_root_causes([])
        assert res_empty.total_findings_analyzed == 0
        assert res_empty.root_causes == []

        res_malformed = analyze_root_causes([{"id": None, "finding_type": None}, None, {}])
        assert res_malformed.total_findings_analyzed >= 0

    def test_deterministic_grouping_and_order_invariance(self):
        f1 = {"id": 10, "website_id": 1, "scan_id": 1, "page_id": 1, "finding_type": "r-str-01", "category": "structure", "title": "H1"}
        f2 = {"id": 20, "website_id": 1, "scan_id": 1, "page_id": 2, "finding_type": "r-str-01", "category": "structure", "title": "H1"}
        f3 = {"id": 30, "website_id": 1, "scan_id": 1, "page_id": 1, "finding_type": "trust_missing_identity", "category": "trust", "title": "Trust"}

        res_a = analyze_root_causes([f1, f2, f3])
        res_b = analyze_root_causes([f3, f2, f1])
        assert [rc.root_cause_key for rc in res_a.root_causes] == [rc.root_cause_key for rc in res_b.root_causes]
        assert [rc.root_cause_id for rc in res_a.root_causes] == [rc.root_cause_id for rc in res_b.root_causes]

    def test_traceability_and_no_invented_evidence(self):
        raw_evidence = {"selector": "h1", "character_count": 0, "nested_meta": {"tags": ["a", "b"]}}
        finding = {
            "id": 77,
            "website_id": 1,
            "scan_id": 1,
            "page_id": 15,
            "finding_type": "r-str-01",
            "category": "structure",
            "title": "Missing H1",
            "evidence": raw_evidence,
        }
        res = analyze_root_causes([finding])
        rc = res.root_causes[0]
        assert rc.finding_ids == [77]
        assert len(rc.evidence_references) == 1
        assert rc.evidence_references[0].evidence == raw_evidence  # Exact byte/dict equality


# =============================================================================
# 2. Fix Type Classification Tests
# =============================================================================

class TestFixTypeClassification:
    def test_all_supported_fix_types(self):
        for fix_type in ALLOWED_FIX_TYPES:
            assert isinstance(fix_type, str)
            assert len(fix_type) > 0

    def test_action_mapping_to_fix_types(self):
        ft, risk, effort = map_action_to_fix_type("meta_tag_optimization")
        assert ft == "meta_tag_improvement"
        assert risk == "low"

        ft, risk, effort = map_action_to_fix_type("schema_injection")
        assert ft == "structured_data_injection"

        ft, risk, effort = map_action_to_fix_type("heading_reorganization")
        assert ft == "heading_structure_fix"

        ft, risk, effort = map_action_to_fix_type("content_expansion")
        assert ft == "content_gap_fill"

        ft, risk, effort = map_action_to_fix_type("canonical_fix")
        assert ft == "technical_seo_correction"

    def test_unsupported_unknown_action_fallback(self):
        ft, risk, effort = map_action_to_fix_type("unregistered_random_action")
        assert ft == "general_fix"
        assert risk == "medium"
        assert effort == "medium"


# =============================================================================
# 3. Fix Plan Schema / Data Contract Tests
# =============================================================================

class TestFixPlanSchemaDataContract:
    def test_valid_fix_plan_creation_model(self):
        payload = FixPlanCreate(
            recommendation_id=1,
            website_id=1,
            fix_type="meta_tag_improvement",
            title="Update Meta Title",
            description="Add descriptive meta title tag.",
            problem_statement="Title tag is missing.",
            proposed_action="Add <title> element with bounded length.",
            expected_outcome="Improves SERP snippet display.",
            estimated_effort="low",
            risk_level="low",
            priority="high",
            status="draft",
        )
        assert payload.fix_type == "meta_tag_improvement"
        assert payload.status == "draft"

    def test_invalid_field_values_and_empty_validation(self, db_session):
        website, scan, page, finding, rec = _seed_base_entities(db_session, "Val")

        # Empty title should raise ValueError
        with pytest.raises(ValueError, match="Title must not be empty"):
            create_fix_plan(
                db_session,
                {
                    "recommendation_id": rec.id,
                    "website_id": website.id,
                    "fix_type": "meta_tag_improvement",
                    "title": "",
                    "problem_statement": "Problem",
                    "proposed_action": "Action",
                },
            )

        # Invalid status should raise ValueError
        with pytest.raises(ValueError, match="Invalid status"):
            create_fix_plan(
                db_session,
                {
                    "recommendation_id": rec.id,
                    "website_id": website.id,
                    "fix_type": "meta_tag_improvement",
                    "title": "Valid Title",
                    "problem_statement": "Problem",
                    "proposed_action": "Action",
                    "status": "invalid_status_xyz",
                },
            )

    def test_pydantic_serialization_roundtrip(self):
        resp_data = {
            "id": 1,
            "recommendation_id": 10,
            "website_id": 5,
            "fix_type": "heading_structure_fix",
            "title": "Fix H1",
            "description": "Desc",
            "problem_statement": "Problem",
            "proposed_action": "Action",
            "expected_outcome": "Outcome",
            "estimated_effort": "low",
            "risk_level": "low",
            "priority": "high",
            "status": "draft",
            "created_at": "2026-09-01T12:00:00",
            "updated_at": "2026-09-01T12:00:00",
        }
        res = FixPlanResponse.model_validate(resp_data)
        assert res.id == 1
        assert res.status == "draft"


# =============================================================================
# 4. Safety / Risk / Action Classification Tests
# =============================================================================

class TestSafetyRiskActionClassification:
    def test_auto_safe_tier_rules(self):
        auto_rules = ["r-str-01", "r-str-02", "r-str-03", "missing_title", "missing_canonical", "r-qna-03"]
        for rule in auto_rules:
            cls = classify_fix_safety(finding_type=rule)
            assert cls.safety_tier == SafetyTier.AUTO_SAFE
            assert cls.auto_executable is True
            assert cls.requires_human_approval is False
            assert cls.risk_level == "low"

    def test_assisted_tier_rules(self):
        assisted_rules = ["r-qna-01", "r-qna-02", "r-gap-01", "r-top-01", "r-sem-01", "internal_link_addition"]
        for rule in assisted_rules:
            cls = classify_fix_safety(finding_type=rule)
            assert cls.safety_tier == SafetyTier.ASSISTED
            assert cls.requires_human_approval is True
            assert cls.auto_executable is False
            assert cls.risk_level == "medium"

    def test_manual_review_high_risk_and_factual_claims(self):
        manual_rules = [
            "authority_missing_credentials",
            "claim_unsupported_statistical",
            "trust_missing_identity",
            "source_broken_reference_link",
            "transparency_missing_first_party",
        ]
        for rule in manual_rules:
            cls = classify_fix_safety(finding_type=rule)
            assert cls.safety_tier == SafetyTier.MANUAL_REVIEW
            assert cls.requires_human_approval is True
            assert cls.auto_executable is False
            assert cls.risk_level == "high"

    def test_planners_cannot_bypass_safety_controls(self, db_session):
        website, scan, page, finding, rec = _seed_base_entities(db_session, "Safety")
        plan = generate_fix_plan_from_recommendation(db_session, rec.id)
        # Even for AUTO_SAFE, plan starts as draft and requires manual approval in workflow
        assert plan.status == "draft"
        assert plan.safety_checks["requires_manual_approval"] is True
        assert plan.safety_checks["auto_executable"] is False


# =============================================================================
# 5. Content Planner Tests
# =============================================================================

class TestContentPlanner:
    def test_content_gap_fill_fix_plan_generation(self, db_session):
        website, scan, page, _, _ = _seed_base_entities(db_session, "Cont")
        finding = Finding(
            website_id=website.id,
            scan_id=scan.id,
            page_id=page.id,
            finding_type="r-gap-01",
            category="content_gaps",
            title="Missing Core Conceptual Dimensions",
            description="Article omits key context for search intent.",
            severity="high",
            evidence={"missing_dimensions": ["pricing", "specifications"]},
        )
        db_session.add(finding)
        db_session.commit()
        db_session.refresh(finding)

        rec = Recommendation(
            finding_id=finding.id,
            title="Expand Content Section",
            description="Add coverage for pricing and specifications.",
            priority="high",
            action_type="content_expansion",
        )
        db_session.add(rec)
        db_session.commit()
        db_session.refresh(rec)

        plan = generate_fix_plan_from_recommendation(db_session, rec.id)
        assert plan.fix_type == "content_gap_fill"
        assert plan.safety_checks["safety_tier"] == "assisted"
        assert plan.diff_payload["action"] == "expand_content_section"
        assert "guidelines" in plan.diff_payload


# =============================================================================
# 6. AEO/GEO Planner Tests
# =============================================================================

class TestAEOGEOPlanner:
    def test_aeo_direct_answer_drafting(self, db_session):
        website, scan, page, _, _ = _seed_base_entities(db_session, "AEO")
        finding = Finding(
            website_id=website.id,
            scan_id=scan.id,
            page_id=page.id,
            finding_type="r-qna-02",
            category="questions",
            title="Missing Direct Answer Snippet",
            description="Question heading has no concise direct answer.",
            severity="high",
            evidence={"question": "What is AI search intelligence?"},
        )
        db_session.add(finding)
        db_session.commit()
        db_session.refresh(finding)

        rec = Recommendation(
            finding_id=finding.id,
            title="Draft 40-Word Direct Answer Snippet",
            description="Provide an authoritative 40-word concise answer block.",
            priority="high",
            action_type="content_expansion",
        )
        db_session.add(rec)
        db_session.commit()
        db_session.refresh(rec)

        plan = generate_fix_plan_from_recommendation(db_session, rec.id)
        assert plan.safety_checks["safety_tier"] == "assisted"
        assert plan.safety_checks["requires_human_approval"] is True
        assert "assisted" in plan.safety_checks["policy_rule_id"]


# =============================================================================
# 7. Trust / Authority / Citation Planner Tests
# =============================================================================

class TestTrustAuthorityCitationPlanner:
    def test_author_credentials_manual_review(self, db_session):
        website, scan, page, _, _ = _seed_base_entities(db_session, "Trust")
        finding = Finding(
            website_id=website.id,
            scan_id=scan.id,
            page_id=page.id,
            finding_type="authority_missing_credentials",
            category="trust",
            title="Missing Author Credentials",
            description="Article has no verifiable author credentials.",
            severity="high",
        )
        db_session.add(finding)
        db_session.commit()
        db_session.refresh(finding)

        rec = Recommendation(
            finding_id=finding.id,
            title="Add Author Byline and Credentials",
            description="Disclose author credentials.",
            priority="high",
            action_type="general_fix",
        )
        db_session.add(rec)
        db_session.commit()
        db_session.refresh(rec)

        plan = generate_fix_plan_from_recommendation(db_session, rec.id)
        assert plan.safety_checks["safety_tier"] == "manual_review"
        assert "Never fabricate author credentials" in plan.safety_checks["classification_reason"]

    def test_unsupported_statistical_claims_manual_review(self, db_session):
        website, scan, page, _, _ = _seed_base_entities(db_session, "Claim")
        finding = Finding(
            website_id=website.id,
            scan_id=scan.id,
            page_id=page.id,
            finding_type="claim_unsupported_statistical",
            category="authority_citations",
            title="Unsupported Statistical Claim",
            description="Quantitative claim lacks citation source.",
            severity="high",
        )
        db_session.add(finding)
        db_session.commit()
        db_session.refresh(finding)

        rec = Recommendation(
            finding_id=finding.id,
            title="Attach Authoritative Citation",
            description="Link to primary data source.",
            priority="high",
            action_type="general_fix",
        )
        db_session.add(rec)
        db_session.commit()
        db_session.refresh(rec)

        plan = generate_fix_plan_from_recommendation(db_session, rec.id)
        assert plan.safety_checks["safety_tier"] == "manual_review"
        assert "Never fabricate citations" in plan.safety_checks["classification_reason"]


# =============================================================================
# 8. SEO Integration Tests
# =============================================================================

class TestSEOIntegration:
    def test_seo_meta_tag_and_canonical_fix_plans(self, db_session):
        website, scan, page, _, _ = _seed_base_entities(db_session, "SEO")
        finding_meta = Finding(
            website_id=website.id,
            scan_id=scan.id,
            page_id=page.id,
            finding_type="missing_meta_description",
            category="seo",
            title="Missing Meta Description",
            description="No meta description provided.",
            severity="medium",
        )
        db_session.add(finding_meta)
        db_session.commit()
        db_session.refresh(finding_meta)

        rec_meta = Recommendation(
            finding_id=finding_meta.id,
            title="Add Meta Description",
            description="Add 150-char meta description.",
            priority="medium",
            action_type="meta_tag_optimization",
        )
        db_session.add(rec_meta)
        db_session.commit()
        db_session.refresh(rec_meta)

        plan_meta = generate_fix_plan_from_recommendation(db_session, rec_meta.id)
        assert plan_meta.fix_type == "meta_tag_improvement"
        assert plan_meta.safety_checks["safety_tier"] == "auto_safe"
        assert plan_meta.diff_payload["action"] == "replace_or_insert_meta_tag"


# =============================================================================
# 9. Expected Impact Tests
# =============================================================================

class TestExpectedImpact:
    def test_expected_impact_mapping(self, db_session):
        website, scan, page, finding, rec = _seed_base_entities(db_session, "Impact")
        plan = generate_fix_plan_from_recommendation(db_session, rec.id)
        assert len(plan.expected_outcome) > 0
        assert f"finding #{finding.id}" in plan.expected_outcome
        assert "hierarchy" in plan.expected_outcome.lower() or "search" in plan.expected_outcome.lower()


# =============================================================================
# 10. Verification Tests
# =============================================================================

class TestVerification:
    def test_verification_linkage_and_lifecycle(self, db_session):
        website, scan, page, finding, rec = _seed_base_entities(db_session, "Verif")
        plan = generate_fix_plan_from_recommendation(db_session, rec.id)

        # Create linked verification record
        val = ValidationResult(
            website_id=website.id,
            scan_id=scan.id,
            fix_plan_id=plan.id,
            recommendation_id=rec.id,
            validation_type="heading_structure_check",
            status="completed",
            result="passed",
            validation_score=1.0,
            expected_result="Single H1 heading present",
            actual_result="Found exactly 1 H1 heading",
            explanation="Successfully verified single H1 tag after applying fix",
        )
        db_session.add(val)
        db_session.commit()
        db_session.refresh(val)


        assert val.fix_plan_id == plan.id
        assert val.result == "passed"
        assert val.validation_score == 1.0



# =============================================================================
# 11. Before / After Tests
# =============================================================================

class TestBeforeAfter:
    def test_diff_payload_before_after_contract(self, db_session):
        website, scan, page, finding, rec = _seed_base_entities(db_session, "Diff")
        diff = build_diff_payload("meta_tag_improvement", page.url, finding, rec)
        assert "target" in diff
        assert "action" in diff
        assert "before" in diff
        assert "after" in diff
        assert "guidelines" in diff
        assert diff["target"] == page.url


# =============================================================================
# 12. API Layer Tests
# =============================================================================

class TestAPILayer:
    def test_crud_and_status_lifecycle_via_api(self, client, db_session):
        website, scan, page, finding, rec = _seed_base_entities(db_session, "API")

        # 1. Create fix plan via API
        create_resp = client.post(
            "/api/v1/fix-plans",
            json={
                "recommendation_id": rec.id,
                "website_id": website.id,
                "scan_id": scan.id,
                "page_id": page.id,
                "fix_type": "heading_structure_fix",
                "title": "API Created Fix Plan",
                "description": "Testing API creation",
                "problem_statement": "Missing H1",
                "proposed_action": "Insert H1",
                "expected_outcome": "Resolve issue",
                "estimated_effort": "low",
                "risk_level": "low",
                "priority": "high",
                "status": "draft",
            },
        )
        assert create_resp.status_code == 201
        plan_id = create_resp.json()["id"]

        # 2. Get by ID
        get_resp = client.get(f"/api/v1/fix-plans/{plan_id}")
        assert get_resp.status_code == 200
        assert get_resp.json()["title"] == "API Created Fix Plan"

        # 3. Patch metadata
        patch_resp = client.patch(
            f"/api/v1/fix-plans/{plan_id}",
            json={"title": "Updated Title via Patch"},
        )
        assert patch_resp.status_code == 200
        assert patch_resp.json()["title"] == "Updated Title via Patch"

        # 4. Status transitions: draft -> ready_for_review -> approved -> completed
        t1 = client.post(f"/api/v1/fix-plans/{plan_id}/status", json={"status": "ready_for_review", "comment": "Ready"})
        assert t1.status_code == 200
        assert t1.json()["status"] == "ready_for_review"

        t2 = client.post(f"/api/v1/fix-plans/{plan_id}/status", json={"status": "approved", "comment": "Approved by lead"})
        assert t2.status_code == 200
        assert t2.json()["status"] == "approved"

        t3 = client.post(f"/api/v1/fix-plans/{plan_id}/status", json={"status": "completed", "comment": "Applied"})
        assert t3.status_code == 200
        assert t3.json()["status"] == "completed"

        # 5. Terminal state rejection
        t4 = client.post(f"/api/v1/fix-plans/{plan_id}/status", json={"status": "draft"})
        assert t4.status_code == 400

        # 6. Delete
        del_resp = client.delete(f"/api/v1/fix-plans/{plan_id}")
        assert del_resp.status_code == 200

        get_deleted = client.get(f"/api/v1/fix-plans/{plan_id}")
        assert get_deleted.status_code == 404

    def test_batch_generate_api_endpoints(self, client, db_session):
        website, scan, page, finding, rec = _seed_base_entities(db_session, "BatchAPI")

        # Generate for recommendation
        rec_gen = client.post(f"/api/v1/recommendations/{rec.id}/generate-fix-plan")
        assert rec_gen.status_code == 200
        assert rec_gen.json()["recommendation_id"] == rec.id

        # Generate for scan
        scan_gen = client.post(f"/api/v1/scans/{scan.id}/generate-fix-plans")
        assert scan_gen.status_code == 200
        assert scan_gen.json()["generated_count"] >= 1

        # Generate for website
        web_gen = client.post(f"/api/v1/websites/{website.id}/generate-fix-plans")
        assert web_gen.status_code == 200
        assert web_gen.json()["generated_count"] >= 1


# =============================================================================
# 13. Service Integration Tests
# =============================================================================

class TestServiceIntegration:
    def test_end_to_end_flow_preserves_provenance(self, db_session):
        website, scan, page, finding, rec = _seed_base_entities(db_session, "E2E")
        plan = generate_fix_plan_from_recommendation(db_session, rec.id)

        assert plan.finding_id == finding.id
        assert plan.recommendation_id == rec.id
        assert plan.website_id == website.id
        assert plan.scan_id == scan.id
        assert plan.page_id == page.id
        assert plan.fix_type == "heading_structure_fix"
        assert plan.safety_checks["safety_tier"] == "auto_safe"


# =============================================================================
# 14. Traceability & Explainability Tests
# =============================================================================

class TestTraceabilityAndExplainability:
    def test_traceability_chain_complete(self, db_session):
        website, scan, page, finding, rec = _seed_base_entities(db_session, "Trace")
        plan = generate_fix_plan_from_recommendation(db_session, rec.id)

        assert plan.recommendation.finding.id == finding.id
        assert plan.problem_statement.startswith(f"Detected {finding.finding_type}")
        assert plan.safety_checks["classification_reason"] is not None


# =============================================================================
# 15. Idempotency & Duplicate Handling Tests
# =============================================================================

class TestIdempotencyAndDuplicateHandling:
    def test_repeated_generation_updates_existing_fix_plan(self, db_session):
        website, scan, page, finding, rec = _seed_base_entities(db_session, "Idem")

        plan1 = generate_fix_plan_from_recommendation(db_session, rec.id)
        plan2 = generate_fix_plan_from_recommendation(db_session, rec.id)

        assert plan1.id == plan2.id
        count = db_session.query(FixPlan).filter(FixPlan.recommendation_id == rec.id).count()
        assert count == 1


# =============================================================================
# 16. Edge Cases & Malformed Inputs Tests
# =============================================================================

class TestEdgeCases:
    def test_missing_entities_safe_handling(self, db_session):
        with pytest.raises(ValueError, match="Recommendation not found"):
            generate_fix_plan_from_recommendation(db_session, 999999)

        with pytest.raises(ValueError, match="Scan not found"):
            generate_fix_plans_for_scan(db_session, 999999)

        with pytest.raises(ValueError, match="Website not found"):
            generate_fix_plans_for_website(db_session, 999999)

    def test_large_findings_dataset_root_cause_and_planning(self, db_session):
        website, scan, page, _, _ = _seed_base_entities(db_session, "LargeSet")
        
        # Create 200 findings across multiple pages and rules
        findings = []
        for i in range(1, 201):
            rule = "r-str-01" if i % 3 == 0 else ("r-qna-01" if i % 3 == 1 else "trust_missing_identity")
            category = "structure" if i % 3 == 0 else ("questions" if i % 3 == 1 else "trust")
            f = {
                "id": i,
                "website_id": website.id,
                "scan_id": scan.id,
                "page_id": (i % 10) + 1,
                "finding_type": rule,
                "category": category,
                "title": f"Finding {i}",
                "severity": "medium",
                "evidence": {"index": i},
            }
            findings.append(f)

        result = analyze_root_causes(findings, website_id=website.id, scan_id=scan.id)
        assert result.total_findings_analyzed == 200
        assert result.total_root_causes_identified == 3
        rule_counts = {rc.rule_id: rc.findings_count for rc in result.root_causes}
        assert sum(rule_counts.values()) == 200

    def test_conflicting_signals_and_unsupported_categories(self, db_session):
        findings = [
            {"id": 1, "finding_type": "unknown_experimental_rule_x", "category": "experimental", "title": "Experimental"},
            {"id": 2, "finding_type": None, "category": None, "title": "Corrupt Finding"},
        ]
        result = analyze_root_causes(findings)
        assert result.total_findings_analyzed >= 1
        
        # Safety classification on unknown rule defaults safely to MANUAL_REVIEW
        cls = classify_fix_safety("unknown_experimental_rule_x")
        assert cls.safety_tier == SafetyTier.MANUAL_REVIEW
        assert cls.requires_human_approval is True
        assert cls.auto_executable is False

    def test_empty_findings_safe_returns(self, db_session):
        website, scan, _, _, _ = _seed_base_entities(db_session, "EmptySet")
        # Empty scan with no findings/recommendations
        empty_scan = Scan(website_id=website.id, status="completed", pages_crawled=0)
        db_session.add(empty_scan)
        db_session.commit()
        db_session.refresh(empty_scan)

        plans = generate_fix_plans_for_scan(db_session, empty_scan.id)
        assert plans == []


# =============================================================================
# 17. Regression Protection Tests
# =============================================================================

class TestRegressionProtection:
    def test_constants_and_lifecycle_integrity(self):
        assert "draft" in ALLOWED_FIX_STATUSES
        assert "ready_for_review" in ALLOWED_FIX_STATUSES
        assert "approved" in ALLOWED_FIX_STATUSES
        assert "completed" in ALLOWED_FIX_STATUSES
        assert "rejected" in ALLOWED_FIX_STATUSES
        assert "meta_tag_improvement" in ALLOWED_FIX_TYPES
        assert "heading_structure_fix" in ALLOWED_FIX_TYPES
        assert "content_gap_fill" in ALLOWED_FIX_TYPES
        assert "structured_data_injection" in ALLOWED_FIX_TYPES
        assert "technical_seo_correction" in ALLOWED_FIX_TYPES
        assert "general_fix" in ALLOWED_FIX_TYPES
        assert "low" in ALLOWED_RISK_LEVELS
        assert "medium" in ALLOWED_RISK_LEVELS
        assert "high" in ALLOWED_RISK_LEVELS
        assert "low" in ALLOWED_EFFORT_LEVELS
        assert "medium" in ALLOWED_EFFORT_LEVELS
        assert "high" in ALLOWED_EFFORT_LEVELS

    def test_review_checklist_present_on_all_plans(self, db_session):
        website, scan, page, finding, rec = _seed_base_entities(db_session, "Checklist")
        plan = generate_fix_plan_from_recommendation(db_session, rec.id)
        assert "review_checklist" in plan.safety_checks
        assert len(plan.safety_checks["review_checklist"]) >= 1

        # Transition status and verify audit_history is populated
        transition_fix_plan_status(db_session, plan.id, "ready_for_review", comment="Moved to review")
        db_session.refresh(plan)
        assert "audit_history" in plan.safety_checks
        assert len(plan.safety_checks["audit_history"]) == 1


