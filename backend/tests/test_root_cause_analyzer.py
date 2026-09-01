"""
Unit Tests for Root-Cause Analysis & Finding Grouping Engine (Day 10 - Step 2)
"""

import copy
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.app.database import Base
from backend.app.models import Finding, PageResult, Scan, Website
from backend.app.root_cause_analyzer import (
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


def test_1_identical_findings_group_together():
    """
    Test 1: Identical findings across multiple pages consolidate into one root-cause group.
    """
    findings = [
        {
            "id": 101,
            "website_id": 1,
            "scan_id": 10,
            "page_id": 1,
            "finding_type": "R-STR-01",
            "category": "structure",
            "title": "Missing H1 Heading",
            "description": "Page lacks an H1 heading.",
            "severity": "high",
            "evidence": {"h1_count": 0, "url": "https://example.com/page-1"},
        },
        {
            "id": 102,
            "website_id": 1,
            "scan_id": 10,
            "page_id": 2,
            "finding_type": "R-STR-01",
            "category": "structure",
            "title": "Missing H1 Heading",
            "description": "Page lacks an H1 heading.",
            "severity": "high",
            "evidence": {"h1_count": 0, "url": "https://example.com/page-2"},
        },
        {
            "id": 103,
            "website_id": 1,
            "scan_id": 10,
            "page_id": 3,
            "finding_type": "R-STR-01",
            "category": "structure",
            "title": "Missing H1 Heading",
            "description": "Page lacks an H1 heading.",
            "severity": "high",
            "evidence": {"h1_count": 0, "url": "https://example.com/page-3"},
        },
    ]

    result = analyze_root_causes(findings, website_id=1, scan_id=10)

    assert result.total_findings_analyzed == 3
    assert result.total_root_causes_identified == 1
    assert result.consolidation_ratio == 3.0

    rc = result.root_causes[0]
    assert rc.rule_id == "r-str-01"
    assert rc.category == "structure"
    assert rc.scope == RootCauseScope.PAGE_GROUP
    assert rc.findings_count == 3
    assert rc.pages_count == 3
    assert rc.finding_ids == [101, 102, 103]
    assert rc.affected_page_ids == [1, 2, 3]
    assert rc.affected_urls == ["https://example.com/page-1", "https://example.com/page-2", "https://example.com/page-3"]
    assert "[Multi-Page (3 pages)]" in rc.title


def test_2_different_rule_ids_do_not_group_together():
    """
    Test 2: Findings with different rule IDs remain distinct root causes.
    """
    findings = [
        {
            "id": 1,
            "website_id": 1,
            "scan_id": 5,
            "page_id": 1,
            "finding_type": "R-STR-01",
            "category": "structure",
            "title": "Missing H1",
            "description": "No H1 tag.",
            "severity": "high",
        },
        {
            "id": 2,
            "website_id": 1,
            "scan_id": 5,
            "page_id": 1,
            "finding_type": "R-QNA-02",
            "category": "questions",
            "title": "Missing Direct Answer",
            "description": "No answer snippet.",
            "severity": "medium",
        },
        {
            "id": 3,
            "website_id": 1,
            "scan_id": 5,
            "page_id": 1,
            "finding_type": "trust_missing_identity",
            "category": "trust",
            "title": "Missing Business Identity",
            "description": "No organization contact details.",
            "severity": "high",
        },
    ]

    result = analyze_root_causes(findings, website_id=1, scan_id=5)

    assert result.total_findings_analyzed == 3
    assert result.total_root_causes_identified == 3
    assert result.consolidation_ratio == 1.0

    rule_ids = {rc.rule_id for rc in result.root_causes}
    assert rule_ids == {"r-str-01", "r-qna-02", "trust_missing_identity"}


def test_3_different_websites_never_group_together():
    """
    Test 3: Findings from different website tenants remain strictly partitioned.
    """
    findings = [
        {
            "id": 1,
            "website_id": 100,
            "scan_id": 1,
            "page_id": 1,
            "finding_type": "R-STR-01",
            "category": "structure",
            "title": "Missing H1",
            "severity": "high",
        },
        {
            "id": 2,
            "website_id": 200,
            "scan_id": 1,
            "page_id": 1,
            "finding_type": "R-STR-01",
            "category": "structure",
            "title": "Missing H1",
            "severity": "high",
        },
    ]

    result = analyze_root_causes(findings)

    assert result.total_findings_analyzed == 2
    assert result.total_root_causes_identified == 2

    web_ids = {rc.website_id for rc in result.root_causes}
    assert web_ids == {100, 200}


def test_4_unrelated_scans_do_not_group_together():
    """
    Test 4: Findings from different scan runs remain isolated.
    """
    findings = [
        {
            "id": 1,
            "website_id": 1,
            "scan_id": 10,
            "page_id": 1,
            "finding_type": "R-STR-01",
            "category": "structure",
            "title": "Missing H1",
            "severity": "high",
        },
        {
            "id": 2,
            "website_id": 1,
            "scan_id": 20,
            "page_id": 1,
            "finding_type": "R-STR-01",
            "category": "structure",
            "title": "Missing H1",
            "severity": "high",
        },
    ]

    result = analyze_root_causes(findings)

    assert result.total_findings_analyzed == 2
    assert result.total_root_causes_identified == 2

    scan_ids = {rc.scan_id for rc in result.root_causes}
    assert scan_ids == {10, 20}


def test_5_input_order_invariance():
    """
    Test 5: Permuting input findings produces identical grouping output and root_cause_ids.
    """
    f1 = {
        "id": 1,
        "website_id": 1,
        "scan_id": 1,
        "page_id": 1,
        "finding_type": "R-STR-01",
        "category": "structure",
        "title": "Missing H1",
        "severity": "high",
    }
    f2 = {
        "id": 2,
        "website_id": 1,
        "scan_id": 1,
        "page_id": 2,
        "finding_type": "R-STR-01",
        "category": "structure",
        "title": "Missing H1",
        "severity": "high",
    }
    f3 = {
        "id": 3,
        "website_id": 1,
        "scan_id": 1,
        "page_id": 1,
        "finding_type": "trust_missing_identity",
        "category": "trust",
        "title": "Missing Identity",
        "severity": "high",
    }

    order_a = [f1, f2, f3]
    order_b = [f3, f1, f2]
    order_c = [f2, f3, f1]

    res_a = analyze_root_causes(order_a, website_id=1, scan_id=1)
    res_b = analyze_root_causes(order_b, website_id=1, scan_id=1)
    res_c = analyze_root_causes(order_c, website_id=1, scan_id=1)

    assert res_a.total_root_causes_identified == res_b.total_root_causes_identified == res_c.total_root_causes_identified == 2

    # Check identical root cause IDs and keys
    keys_a = [rc.root_cause_key for rc in res_a.root_causes]
    keys_b = [rc.root_cause_key for rc in res_b.root_causes]
    keys_c = [rc.root_cause_key for rc in res_c.root_causes]
    assert keys_a == keys_b == keys_c

    ids_a = [rc.root_cause_id for rc in res_a.root_causes]
    ids_b = [rc.root_cause_id for rc in res_b.root_causes]
    ids_c = [rc.root_cause_id for rc in res_c.root_causes]
    assert ids_a == ids_b == ids_c


def test_6_pure_determinism_and_idempotency():
    """
    Test 6: Multiple executions produce identical results without state leakage.
    """
    findings = [
        {
            "id": i,
            "website_id": 1,
            "scan_id": 1,
            "page_id": i % 3 + 1,
            "finding_type": f"rule_{i % 2}",
            "category": "seo",
            "title": f"Issue {i % 2}",
            "severity": "medium",
            "evidence": {"detail": f"info_{i}"},
        }
        for i in range(1, 11)
    ]

    res1 = analyze_root_causes(findings, website_id=1, scan_id=1)
    res2 = analyze_root_causes(findings, website_id=1, scan_id=1)

    assert res1.model_dump(exclude={"metadata"}) == res2.model_dump(exclude={"metadata"})


def test_7_and_8_provenance_and_evidence_preservation():
    """
    Tests 7 & 8: All original finding IDs and unaltered evidence payloads are preserved.
    """
    raw_evidence_1 = {"missing_tag": "h1", "character_count": 0, "dom_path": "/html/body"}
    raw_evidence_2 = {"missing_tag": "h1", "character_count": 0, "dom_path": "/html/body/div"}

    findings = [
        {
            "id": 501,
            "website_id": 1,
            "scan_id": 2,
            "page_id": 10,
            "finding_type": "R-STR-01",
            "category": "structure",
            "title": "Missing H1 Heading",
            "description": "Page lacks an H1.",
            "severity": "high",
            "evidence": raw_evidence_1,
        },
        {
            "id": 502,
            "website_id": 1,
            "scan_id": 2,
            "page_id": 20,
            "finding_type": "R-STR-01",
            "category": "structure",
            "title": "Missing H1 Heading",
            "description": "Page lacks an H1.",
            "severity": "medium",
            "evidence": raw_evidence_2,
        },
    ]

    result = analyze_root_causes(findings, website_id=1, scan_id=2)
    rc = result.root_causes[0]

    assert rc.finding_ids == [501, 502]
    assert len(rc.evidence_references) == 2

    ref1 = rc.evidence_references[0]
    assert ref1.finding_id == 501
    assert ref1.page_id == 10
    assert ref1.evidence == raw_evidence_1

    ref2 = rc.evidence_references[1]
    assert ref2.finding_id == 502
    assert ref2.page_id == 20
    assert ref2.evidence == raw_evidence_2


def test_9_page_specific_findings_remain_distinguishable():
    """
    Test 9: Isolated page-specific findings get scope=PAGE and distinct page bindings.
    """
    findings = [
        {
            "id": 1,
            "website_id": 1,
            "scan_id": 1,
            "page_id": 101,
            "finding_type": "R-TOP-02",
            "category": "topic",
            "title": "Potential Keyword Stuffing",
            "description": "Keyword stuffing detected.",
            "severity": "high",
        },
        {
            "id": 2,
            "website_id": 1,
            "scan_id": 1,
            "page_id": 102,
            "finding_type": "R-TOP-02",
            "category": "topic",
            "title": "Potential Keyword Stuffing",
            "description": "Keyword stuffing detected.",
            "severity": "high",
        },
    ]

    # Two pages with keyword stuffing will form a PAGE_GROUP since 2 pages are affected
    result_multi = analyze_root_causes(findings, website_id=1, scan_id=1)
    assert result_multi.root_causes[0].scope == RootCauseScope.PAGE_GROUP

    # Single isolated page finding receives scope=PAGE
    result_single = analyze_root_causes([findings[0]], website_id=1, scan_id=1)
    rc_single = result_single.root_causes[0]
    assert rc_single.scope == RootCauseScope.PAGE
    assert rc_single.affected_page_ids == [101]
    assert rc_single.pages_count == 1
    assert "page #101" in rc_single.grouping_rationale


def test_10_site_level_scope_classification():
    """
    Test 10: Findings with page_id=None or explicit site-level rule get scope=SITE.
    """
    findings = [
        {
            "id": 1,
            "website_id": 1,
            "scan_id": 1,
            "page_id": None,
            "finding_type": "site_robots_txt",
            "category": "seo",
            "title": "Missing Robots.txt",
            "severity": "medium",
        },
        {
            "id": 2,
            "website_id": 1,
            "scan_id": 1,
            "page_id": 1,
            "finding_type": "trust_missing_identity",
            "category": "trust",
            "title": "Missing Core Identity",
            "severity": "high",
        },
    ]

    result = analyze_root_causes(findings, website_id=1, scan_id=1)

    for rc in result.root_causes:
        assert rc.scope == RootCauseScope.SITE
        assert "[Site-Wide]" in rc.title


def test_11_template_scope_classification_when_evidence_present():
    """
    Test 11: Findings sharing explicit template/layout signature get scope=TEMPLATE.
    """
    findings = [
        {
            "id": 1,
            "website_id": 1,
            "scan_id": 1,
            "page_id": 1,
            "finding_type": "content_heading_structure",
            "category": "structure",
            "title": "Header Nav Heading Issue",
            "severity": "medium",
            "evidence": {"is_template": True, "template_signature": "global_header_v2"},
        },
        {
            "id": 2,
            "website_id": 1,
            "scan_id": 1,
            "page_id": 2,
            "finding_type": "content_heading_structure",
            "category": "structure",
            "title": "Header Nav Heading Issue",
            "severity": "medium",
            "evidence": {"is_template": True, "template_signature": "global_header_v2"},
        },
    ]

    result = analyze_root_causes(findings, website_id=1, scan_id=1)
    rc = result.root_causes[0]

    assert rc.scope == RootCauseScope.TEMPLATE
    assert "[Template: global_header_v2]" in rc.title
    assert rc.metadata["template_signature"] == "global_header_v2"


def test_12_empty_and_edge_case_inputs():
    """
    Test 12: Empty inputs and None values handle gracefully without crashing.
    """
    res_empty = analyze_root_causes([])
    assert res_empty.total_findings_analyzed == 0
    assert res_empty.total_root_causes_identified == 0
    assert res_empty.root_causes == []

    # None / malformed finding entries
    findings = [
        {"id": 1, "finding_type": "", "category": None},
        {"id": 2, "finding_type": None, "category": ""},
    ]
    res_malformed = analyze_root_causes(findings)
    assert res_malformed.total_findings_analyzed == 2
    assert res_malformed.total_root_causes_identified >= 1


def test_13_database_integration_helpers(db_session):
    """
    Test 13: get_root_causes_for_scan and get_root_causes_for_website with SQLAlchemy session.
    """
    # Seed website & scan
    web = Website(name="Test Site", url="https://test.com")
    db_session.add(web)
    db_session.commit()
    db_session.refresh(web)

    scan = Scan(website_id=web.id, status="completed")
    db_session.add(scan)
    db_session.commit()
    db_session.refresh(scan)

    p1 = PageResult(scan_id=scan.id, url="https://test.com/p1")
    p2 = PageResult(scan_id=scan.id, url="https://test.com/p2")
    db_session.add_all([p1, p2])
    db_session.commit()
    db_session.refresh(p1)
    db_session.refresh(p2)

    # Seed findings
    f1 = Finding(
        website_id=web.id,
        scan_id=scan.id,
        page_id=p1.id,
        finding_type="R-STR-01",
        category="structure",
        title="Missing H1",
        description="Missing H1 tag.",
        severity="high",
    )
    f2 = Finding(
        website_id=web.id,
        scan_id=scan.id,
        page_id=p2.id,
        finding_type="R-STR-01",
        category="structure",
        title="Missing H1",
        description="Missing H1 tag.",
        severity="high",
    )
    f3 = Finding(
        website_id=web.id,
        scan_id=scan.id,
        page_id=None,
        finding_type="trust_missing_identity",
        category="trust",
        title="Missing Core Identity",
        description="Missing address/contact.",
        severity="high",
    )
    db_session.add_all([f1, f2, f3])
    db_session.commit()

    # Test scan root causes
    scan_result = get_root_causes_for_scan(db_session, scan.id)
    assert scan_result.total_findings_analyzed == 3
    assert scan_result.total_root_causes_identified == 2
    assert scan_result.consolidation_ratio == 1.5

    # Test website root causes
    web_result = get_root_causes_for_website(db_session, web.id)
    assert web_result.total_findings_analyzed == 3
    assert web_result.total_root_causes_identified == 2


def test_14_highest_severity_resolution():
    """
    Test 14: RootCauseGroup correctly resolves to the highest severity among grouped findings.
    """
    findings = [
        {
            "id": 1,
            "website_id": 1,
            "scan_id": 1,
            "page_id": 1,
            "finding_type": "R-STR-01",
            "category": "structure",
            "title": "Missing H1",
            "severity": "low",
        },
        {
            "id": 2,
            "website_id": 1,
            "scan_id": 1,
            "page_id": 2,
            "finding_type": "R-STR-01",
            "category": "structure",
            "title": "Missing H1",
            "severity": "critical",
        },
        {
            "id": 3,
            "website_id": 1,
            "scan_id": 1,
            "page_id": 3,
            "finding_type": "R-STR-01",
            "category": "structure",
            "title": "Missing H1",
            "severity": "medium",
        },
    ]

    result = analyze_root_causes(findings, website_id=1, scan_id=1)
    rc = result.root_causes[0]
    assert rc.severity == "critical"
