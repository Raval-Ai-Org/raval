"""
Authority, Citation & Trust Findings and Recommendations Tests
(Day 8 - Phase B - Step 10 ONLY)

Verifies deterministic finding creation, evidence preservation, recommendation mapping, and idempotency:
1. Deterministic rule IDs across all 7 intelligence namespaces
2. Trust finding creation and evidence preservation
3. Authority finding creation and evidence preservation
4. External Source finding creation
5. Claim-Support finding creation
6. Source-Quality finding creation
7. First-Party Transparency finding creation
8. Citation-Readiness finding creation
9. Traceable evidence in all findings
10. Severity and confidence handling
11. Actionable recommendation generation with action_type, impact, priority, payload
12. Complete finding-to-recommendation mapping
13. Database persistence idempotency and deduplication
14. No unsupported factual conclusions (Evidence != Conclusion)
"""

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.authority_citation_recommendations import (
    RULE_REGISTRY,
    create_deterministic_finding,
    get_rule_by_id,
    get_rule_by_finding_type,
    map_finding_to_recommendation,
    map_result_to_findings_and_recommendations,
    persist_authority_citation_findings_and_recommendations,
)
from app.authority_citation_schemas import (
    AuthorityCitationTrustResult,
    CitationReadinessContract,
    ConfidenceLevel,
    SeverityLevel,
)
from app.models import Base, Finding, PageResult, Recommendation, Scan, Website
from app.schemas import FindingCreate, RecommendationCreate


@pytest.fixture
def in_memory_db():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    session = Session()

    # Seed test Website, Scan, and PageResult
    website = Website(name="IQP Lab", url="https://iqp.org")
    session.add(website)
    session.commit()
    session.refresh(website)

    scan = Scan(website_id=website.id, status="completed")
    session.add(scan)
    session.commit()
    session.refresh(scan)

    page = PageResult(scan_id=scan.id, url="https://iqp.org/research/quantum")
    session.add(page)
    session.commit()
    session.refresh(page)

    yield session
    session.close()


def test_1_deterministic_rule_ids_across_all_namespaces():
    """Verify that every rule ID is unique, categorized into its proper namespace, and deterministic."""
    expected_namespaces = {
        "trust",
        "authority",
        "source",
        "claim_support",
        "source_quality",
        "transparency",
        "citation_readiness",
    }
    found_namespaces = {r["namespace"] for r in RULE_REGISTRY.values()}
    assert found_namespaces == expected_namespaces

    assert "trust_missing_identity" in RULE_REGISTRY
    assert "authority_shallow_depth" in RULE_REGISTRY
    assert "source_excessive_commercial_links" in RULE_REGISTRY
    assert "claim_unsupported_statistical" in RULE_REGISTRY
    assert "source_broken_reference_link" in RULE_REGISTRY
    assert "transparency_missing_first_party" in RULE_REGISTRY
    assert "readiness_low_structural_citation" in RULE_REGISTRY


def test_2_trust_finding_creation_and_evidence():
    """Verify creation of trust namespace findings with traceable evidence."""
    finding = create_deterministic_finding(
        rule_id="trust_missing_identity",
        evidence={"missing_signals": ["about_page", "contact_email"]},
        page_id=10,
    )

    assert finding.finding_type == "missing_trust_signals"
    assert finding.category == "trust"
    assert finding.severity == "high"
    assert finding.page_id == 10
    assert finding.evidence == {"missing_signals": ["about_page", "contact_email"]}


def test_3_authority_finding_creation_and_evidence():
    """Verify creation of authority namespace findings with traceable evidence."""
    finding = create_deterministic_finding(
        rule_id="authority_shallow_depth",
        evidence={"word_count": 85, "subheadings_count": 0, "depth_level": "thin"},
        page_id=12,
    )

    assert finding.finding_type == "shallow_topical_depth"
    assert finding.category == "authority"
    assert finding.severity == "medium"
    assert finding.evidence["word_count"] == 85


def test_4_source_finding_creation():
    """Verify creation of external source findings."""
    finding = create_deterministic_finding(
        rule_id="source_excessive_commercial_links",
        evidence={"affiliate_links_count": 5, "citation_candidates_count": 0},
    )

    assert finding.finding_type == "excessive_unbacked_commercial_links"
    assert finding.category == "citation"
    assert finding.evidence["affiliate_links_count"] == 5


def test_5_claim_support_finding_creation():
    """Verify creation of claim-support findings."""
    finding = create_deterministic_finding(
        rule_id="claim_unsupported_statistical",
        evidence={"claims_sample": ["Efficiency reached 99.4% in testing."]},
    )

    assert finding.finding_type == "unsupported_statistical_claim"
    assert finding.category == "citation"
    assert finding.severity == "medium"


def test_6_source_quality_finding_creation():
    """Verify creation of source-quality findings."""
    finding = create_deterministic_finding(
        rule_id="source_broken_reference_link",
        evidence={"broken_urls": ["https://doi.org/10.1000/404-study"]},
    )

    assert finding.finding_type == "broken_reference_link"
    assert finding.severity == "high"


def test_7_transparency_finding_creation():
    """Verify creation of first-party transparency findings."""
    finding = create_deterministic_finding(
        rule_id="transparency_missing_first_party",
        evidence={"transparency_gaps": ["author_identity", "contact_channels"]},
    )

    assert finding.finding_type == "missing_first_party_transparency"
    assert finding.category == "trust"
    assert finding.severity == "high"


def test_8_citation_readiness_finding_creation():
    """Verify creation of citation-readiness findings."""
    finding = create_deterministic_finding(
        rule_id="readiness_low_structural_citation",
        evidence={"negative_signals": ["0 external citations", "unbacked empirical claims"]},
    )

    assert finding.finding_type == "low_structural_citation_readiness"
    assert finding.category == "citation"
    assert finding.severity == "high"


def test_9_evidence_preservation():
    """Verify that complex structural evidence is completely preserved in FindingCreate."""
    ev = {
        "detected_cues": ["experimental setup", "benchmarking protocol"],
        "word_count": 120,
        "sample_links": [{"url": "https://doi.org/10.1038", "anchor": "Study"}],
    }
    finding = create_deterministic_finding(
        rule_id="authority_missing_credentials",
        evidence=ev,
        page_id=55,
    )

    assert finding.evidence == ev
    assert finding.evidence["detected_cues"] == ["experimental setup", "benchmarking protocol"]


def test_10_severity_and_confidence_handling():
    """Verify that rule severity defaults are respected and confidence metadata is intact."""
    rule_stat = get_rule_by_id("claim_unsupported_statistical")
    assert rule_stat["default_severity"] == "medium"
    assert rule_stat["default_confidence"] == ConfidenceLevel.HIGH

    rule_broken = get_rule_by_id("source_broken_reference_link")
    assert rule_broken["default_severity"] == "high"

    rule_super = get_rule_by_id("claim_unsupported_superlative")
    assert rule_super["default_severity"] == "low"
    assert rule_super["default_confidence"] == ConfidenceLevel.MEDIUM


def test_11_recommendation_creation_and_fields():
    """Verify that generated recommendations contain all required actionable fields."""
    finding = create_deterministic_finding(
        rule_id="claim_unsupported_statistical",
        evidence={"claims": ["99.9% recovery"]},
        page_id=200,
    )

    rec = map_finding_to_recommendation(finding, page_url="https://iqp.org/trial")

    assert isinstance(rec, RecommendationCreate)
    assert rec.action_type == "add_source_citations"
    assert rec.priority == "medium"
    assert rec.status == "open"
    assert rec.impact is not None
    assert rec.payload is not None
    assert "WHY:" in rec.payload["rationale"]
    assert "WHAT:" in rec.payload["rationale"]
    assert "WHERE:" in rec.payload["rationale"]
    assert "EXPECTED BENEFIT:" in rec.payload["rationale"]


def test_12_finding_to_recommendation_mapping_for_all_rules():
    """Verify that every canonical rule in RULE_REGISTRY maps cleanly to an actionable recommendation."""
    for rule_id, rule_info in RULE_REGISTRY.items():
        finding = create_deterministic_finding(rule_id=rule_id)
        rec = map_finding_to_recommendation(finding)

        assert rec.title is not None and len(rec.title) > 5
        assert rec.description is not None and len(rec.description) > 10
        assert rec.action_type == rule_info["action_type"]
        assert rec.priority in ("critical", "high", "medium", "low")


def test_13_database_persistence_idempotency_and_deduplication(in_memory_db):
    """Verify repeated execution does not create duplicate findings or recommendations in the database."""
    session = in_memory_db
    scan = session.query(Scan).first()
    page = session.query(PageResult).first()

    findings_to_persist = [
        create_deterministic_finding(
            rule_id="authority_shallow_depth",
            evidence={"word_count": 80},
            page_id=page.id,
        ),
        create_deterministic_finding(
            rule_id="claim_unsupported_statistical",
            evidence={"metrics": ["95%"]},
            page_id=page.id,
        ),
    ]

    # Run 1
    persisted_f1, persisted_r1 = persist_authority_citation_findings_and_recommendations(
        db=session,
        scan_id=scan.id,
        page_id=page.id,
        findings=findings_to_persist,
    )
    assert len(persisted_f1) == 2
    assert len(persisted_r1) == 2
    assert session.query(Finding).count() == 2
    assert session.query(Recommendation).count() == 2

    # Run 2 (Repeated execution with updated evidence)
    updated_findings = [
        create_deterministic_finding(
            rule_id="authority_shallow_depth",
            evidence={"word_count": 95, "updated": True},
            page_id=page.id,
        ),
        create_deterministic_finding(
            rule_id="claim_unsupported_statistical",
            evidence={"metrics": ["95%"], "updated": True},
            page_id=page.id,
        ),
    ]
    persisted_f2, persisted_r2 = persist_authority_citation_findings_and_recommendations(
        db=session,
        scan_id=scan.id,
        page_id=page.id,
        findings=updated_findings,
    )

    # Count must remain exactly 2, and evidence updated
    assert session.query(Finding).count() == 2
    assert session.query(Recommendation).count() == 2
    assert persisted_f2[0].evidence["updated"] is True


def test_14_no_unsupported_factual_conclusions():
    """Verify core rule: Evidence != Conclusion. Recommendations and rationales avoid unsubstantiated claims."""
    finding = create_deterministic_finding(rule_id="readiness_low_structural_citation")
    rec = map_finding_to_recommendation(finding)

    dumped = rec.model_dump()
    dumped_str = str(dumped).lower()

    assert "guaranteed" not in dumped_str
    assert "fake_score" not in dumped_str
    assert "fact_check_veracity" not in dumped_str
