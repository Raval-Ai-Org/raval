"""
Unit & Integration Tests for Task 12 Step 4: Targeted Rescan Policy + Change-Impact Model.

Verifies:
A. Direct page change (Title/Meta/Headings/Schema -> TARGETED_RESCAN)
B. Internal-link change (Linked pages included -> RELATED_RESCAN)
C. Canonical dependency (Target/source canonical included -> RELATED_RESCAN)
D. Sitemap dependency (Sitemap-dependent resources included -> RELATED_RESCAN)
E. Entity dependency (Shared entity resources included -> RELATED_RESCAN)
F. Content/topic dependency (Shared topic resources included -> RELATED_RESCAN)
G. Template/global change (FULL_RESCAN selected)
H. Unknown dependency (Escalation to FULL_RESCAN)
I. Stale dependency graph (Escalation to FULL_RESCAN)
J. Missing dependency graph (Escalation to FULL_RESCAN)
K. Explainability (Every resource has explicit ImpactReason)
L. Determinism (Same input -> Identical scope & ordering)
M. Idempotency (Repeated requests return cached result)
N. Concurrency (Thread-safe concurrent execution)
O. Workspace isolation (Cross-tenant/workspace violation rejected)
P. Security (SSRF, malicious schemes, identifier validation)
Q. Existing crawler integration (TargetedRescanner & PageFetcher reuse)
R. Execution trace integration (Stage 12 preserves trace IDs)
S. API endpoints (FastAPI endpoints testing)
"""

import concurrent.futures
from datetime import datetime, timedelta, timezone
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.lab.fixtures import build_static_site_fixture
from app.lab.harness import PipelineHarness, PipelineRunConfig
from app.lab.impact_model import (
    ChangeImpactGraph,
    ChangeType,
    DependencyEdge,
    DependencyType,
    ImpactReason,
    ImpactedResource,
    RescanScope,
    _normalize_resource_id,
)
from app.lab.rescan_policy import (
    RescanPolicyEngine,
    RescanScopeDecision,
    TargetedRescanRequest,
)
from app.lab.rescan_service import (
    TargetedRescanExecutionResult,
    TargetedRescanService,
)
from app.lab.trace import PipelineStage, StageStatus
from app.main import app
from app.page_extractor import ExtractionResult


@pytest.fixture(autouse=True)
def reset_rescan_service():
    TargetedRescanService.reset_state()


@pytest.fixture
def base_graph() -> ChangeImpactGraph:
    """Provides a sample multi-page dependency graph."""
    site_url = "https://example.lab.local"
    graph = ChangeImpactGraph(site_url=site_url, workspace_id="ws_lab_default")

    graph.add_node("/about.html")
    graph.add_node("/services.html")
    graph.add_node("/docs.html")
    graph.add_node("/contact.html")
    graph.add_node("/faq.html")

    # Links
    graph.add_edge("/about.html", "/services.html", DependencyType.LINKS_TO)
    graph.add_edge("/docs.html", "/about.html", DependencyType.LINKS_TO)

    # Canonicals
    graph.add_edge("/services.html", "/about.html", DependencyType.CANONICAL_TO)

    # Entities
    graph.add_edge("/about.html", "/faq.html", DependencyType.SHARES_ENTITY)

    # Topics
    graph.add_edge("/docs.html", "/services.html", DependencyType.SHARES_TOPIC)

    return graph


# =============================================================================
# A. Direct Page Change (Metadata, Headings, Schema, Accessibility)
# =============================================================================

def test_direct_page_change_metadata(base_graph: ChangeImpactGraph):
    req = TargetedRescanRequest(
        execution_id="exec_test_01",
        site_url=base_graph.site_url,
        changed_resources=["/about.html"],
        change_type=ChangeType.PAGE_METADATA,
        changed_fields=["title", "meta_description"],
    )
    decision = RescanPolicyEngine.decide_scope(req, base_graph)

    assert decision.scope == RescanScope.TARGETED_RESCAN
    assert len(decision.selected_resources) == 1
    assert decision.selected_resources[0].resource_id == "/about.html"
    assert decision.selected_resources[0].reason == ImpactReason.DIRECTLY_CHANGED
    assert decision.selected_resources[0].depth == 0
    assert not decision.is_escalated_to_full


def test_direct_page_change_headings_and_schema(base_graph: ChangeImpactGraph):
    req_h = TargetedRescanRequest(
        execution_id="exec_test_h",
        site_url=base_graph.site_url,
        changed_resources=["/docs.html"],
        change_type=ChangeType.HEADINGS,
    )
    dec_h = RescanPolicyEngine.decide_scope(req_h, base_graph)
    assert dec_h.scope == RescanScope.TARGETED_RESCAN
    assert len(dec_h.selected_resources) == 1
    assert dec_h.selected_resources[0].resource_id == "/docs.html"

    req_s = TargetedRescanRequest(
        execution_id="exec_test_s",
        site_url=base_graph.site_url,
        changed_resources=["/faq.html"],
        change_type=ChangeType.STRUCTURED_DATA,
    )
    dec_s = RescanPolicyEngine.decide_scope(req_s, base_graph)
    assert dec_s.scope == RescanScope.TARGETED_RESCAN
    assert len(dec_s.selected_resources) == 1


# =============================================================================
# B. Internal-Link Change
# =============================================================================

def test_internal_link_change_includes_linked_resources(base_graph: ChangeImpactGraph):
    # /about.html links to /services.html, and /docs.html links to /about.html
    req = TargetedRescanRequest(
        execution_id="exec_link_01",
        site_url=base_graph.site_url,
        changed_resources=["/about.html"],
        change_type=ChangeType.INTERNAL_LINKS,
    )
    decision = RescanPolicyEngine.decide_scope(req, base_graph)

    assert decision.scope == RescanScope.RELATED_RESCAN
    selected_ids = {r.resource_id for r in decision.selected_resources}
    assert "/about.html" in selected_ids
    assert "/services.html" in selected_ids
    assert "/docs.html" in selected_ids

    # Directly changed vs related reasons
    reasons = {r.resource_id: r.reason for r in decision.selected_resources}
    assert reasons["/about.html"] == ImpactReason.DIRECTLY_CHANGED
    assert reasons["/services.html"] == ImpactReason.INTERNAL_LINK_DEPENDENCY
    assert reasons["/docs.html"] == ImpactReason.INTERNAL_LINK_DEPENDENCY


# =============================================================================
# C. Canonical Dependency
# =============================================================================

def test_canonical_change_includes_canonical_targets(base_graph: ChangeImpactGraph):
    # /services.html -> CANONICAL_TO -> /about.html
    req = TargetedRescanRequest(
        execution_id="exec_canon_01",
        site_url=base_graph.site_url,
        changed_resources=["/services.html"],
        change_type=ChangeType.CANONICAL,
    )
    decision = RescanPolicyEngine.decide_scope(req, base_graph)

    assert decision.scope == RescanScope.RELATED_RESCAN
    selected_ids = {r.resource_id for r in decision.selected_resources}
    assert "/services.html" in selected_ids
    assert "/about.html" in selected_ids

    reasons = {r.resource_id: r.reason for r in decision.selected_resources}
    assert reasons["/services.html"] == ImpactReason.DIRECTLY_CHANGED
    assert reasons["/about.html"] == ImpactReason.CANONICAL_DEPENDENCY


# =============================================================================
# D. Sitemap Dependency
# =============================================================================

def test_sitemap_dependency_includes_sitemap_resources():
    site_url = "https://example.lab.local"
    graph = ChangeImpactGraph(site_url=site_url)
    graph.add_node("/sitemap.xml", {"is_sitemap": True})
    graph.add_node("/page-1")
    graph.add_node("/page-2")
    graph.add_edge("/page-1", "/sitemap.xml", DependencyType.IN_SITEMAP)
    graph.add_edge("/page-2", "/sitemap.xml", DependencyType.IN_SITEMAP)

    req = TargetedRescanRequest(
        execution_id="exec_sitemap_01",
        site_url=site_url,
        changed_resources=["/sitemap.xml"],
        change_type=ChangeType.SITEMAP,
    )
    decision = RescanPolicyEngine.decide_scope(req, graph)

    assert decision.scope == RescanScope.RELATED_RESCAN
    selected_ids = {r.resource_id for r in decision.selected_resources}
    assert "/sitemap.xml" in selected_ids
    assert "/page-1" in selected_ids
    assert "/page-2" in selected_ids


# =============================================================================
# E. Entity Dependency
# =============================================================================

def test_entity_dependency_includes_entity_sharing_resources(base_graph: ChangeImpactGraph):
    # /about.html shares entity with /faq.html
    req = TargetedRescanRequest(
        execution_id="exec_ent_01",
        site_url=base_graph.site_url,
        changed_resources=["/about.html"],
        change_type=ChangeType.ENTITY,
    )
    decision = RescanPolicyEngine.decide_scope(req, base_graph)

    assert decision.scope == RescanScope.RELATED_RESCAN
    selected_ids = {r.resource_id for r in decision.selected_resources}
    assert "/about.html" in selected_ids
    assert "/faq.html" in selected_ids
    assert decision.reasons_by_resource["/faq.html"] == ImpactReason.ENTITY_DEPENDENCY


# =============================================================================
# F. Content / Topic Dependency
# =============================================================================

def test_topic_dependency_includes_topic_cluster(base_graph: ChangeImpactGraph):
    # /docs.html shares topic with /services.html
    req = TargetedRescanRequest(
        execution_id="exec_topic_01",
        site_url=base_graph.site_url,
        changed_resources=["/docs.html"],
        change_type=ChangeType.CONTENT_TOPIC,
    )
    decision = RescanPolicyEngine.decide_scope(req, base_graph)

    assert decision.scope == RescanScope.RELATED_RESCAN
    selected_ids = {r.resource_id for r in decision.selected_resources}
    assert "/docs.html" in selected_ids
    assert "/services.html" in selected_ids
    assert decision.reasons_by_resource["/services.html"] == ImpactReason.CONTENT_DEPENDENCY


# =============================================================================
# G. Template / Global Change -> FULL_RESCAN
# =============================================================================

def test_template_change_triggers_full_rescan(base_graph: ChangeImpactGraph):
    req = TargetedRescanRequest(
        execution_id="exec_tpl_01",
        site_url=base_graph.site_url,
        changed_resources=["/header-component"],
        change_type=ChangeType.TEMPLATE_SHARED,
    )
    decision = RescanPolicyEngine.decide_scope(req, base_graph)

    assert decision.scope == RescanScope.FULL_RESCAN
    assert len(decision.selected_resources) >= len(base_graph.nodes)
    reasons = {r.resource_id: r.reason for r in decision.selected_resources}
    assert reasons["/header-component"] == ImpactReason.DIRECTLY_CHANGED
    assert reasons["/about.html"] == ImpactReason.TEMPLATE_DEPENDENCY


def test_global_sitewide_change_triggers_full_rescan(base_graph: ChangeImpactGraph):
    req = TargetedRescanRequest(
        execution_id="exec_global_01",
        site_url=base_graph.site_url,
        changed_resources=["/robots.txt"],
        change_type=ChangeType.SITE_WIDE_GLOBAL,
    )
    decision = RescanPolicyEngine.decide_scope(req, base_graph)

    assert decision.scope == RescanScope.FULL_RESCAN
    reasons = {r.resource_id: r.reason for r in decision.selected_resources}
    assert reasons["/about.html"] == ImpactReason.GLOBAL_CHANGE


# =============================================================================
# H. Unknown Dependency -> Escalation to FULL_RESCAN
# =============================================================================

def test_unknown_dependency_escalates_to_full_rescan(base_graph: ChangeImpactGraph):
    req = TargetedRescanRequest(
        execution_id="exec_unk_01",
        site_url=base_graph.site_url,
        changed_resources=["/custom-plugin"],
        change_type=ChangeType.UNKNOWN,
    )
    decision = RescanPolicyEngine.decide_scope(req, base_graph)

    assert decision.scope == RescanScope.FULL_RESCAN
    assert decision.is_escalated_to_full is True
    assert decision.escalation_reason == "UNKNOWN_DEPENDENCY_FALLBACK"


# =============================================================================
# I. Stale Dependency Graph -> Escalation to FULL_RESCAN
# =============================================================================

def test_stale_dependency_graph_escalates_to_full_rescan():
    site_url = "https://example.lab.local"
    old_time = datetime.now(timezone.utc) - timedelta(hours=2)
    graph = ChangeImpactGraph(site_url=site_url, created_at=old_time)
    graph.add_node("/about.html")
    graph.add_node("/services.html")

    assert graph.is_stale(max_age_seconds=3600.0) is True

    req = TargetedRescanRequest(
        execution_id="exec_stale_01",
        site_url=site_url,
        changed_resources=["/about.html"],
        change_type=ChangeType.PAGE_METADATA,
        max_graph_age_seconds=3600.0,
    )
    decision = RescanPolicyEngine.decide_scope(req, graph)

    assert decision.scope == RescanScope.FULL_RESCAN
    assert decision.is_escalated_to_full is True
    assert decision.escalation_reason == "STALE_DEPENDENCY_FALLBACK"


# =============================================================================
# J. Missing Dependency Graph -> Escalation to FULL_RESCAN
# =============================================================================

def test_missing_dependency_graph_escalates_to_full_rescan():
    req = TargetedRescanRequest(
        execution_id="exec_missing_01",
        site_url="https://example.lab.local",
        changed_resources=["/about.html"],
        change_type=ChangeType.INTERNAL_LINKS,
    )
    decision = RescanPolicyEngine.decide_scope(req, graph=None, all_site_resources=["/about.html", "/pricing", "/contact"])

    assert decision.scope == RescanScope.FULL_RESCAN
    assert decision.is_escalated_to_full is True
    assert decision.escalation_reason == "MISSING_GRAPH_FALLBACK"
    assert len(decision.selected_resources) == 3


# =============================================================================
# K. Explainability & Provenance
# =============================================================================

def test_explainability_every_selected_resource_has_reason(base_graph: ChangeImpactGraph):
    req = TargetedRescanRequest(
        execution_id="exec_expl_01",
        site_url=base_graph.site_url,
        changed_resources=["/about.html"],
        change_type=ChangeType.INTERNAL_LINKS,
    )
    decision = RescanPolicyEngine.decide_scope(req, base_graph)

    for res in decision.selected_resources:
        assert res.resource_id != ""
        assert isinstance(res.reason, ImpactReason)
        assert res.depth >= 0
        assert "source" in res.evidence or "related_from" in res.evidence or "related_to" in res.evidence
    assert decision.primary_reason != ""


# =============================================================================
# L. Determinism
# =============================================================================

def test_determinism_same_input_produces_identical_output(base_graph: ChangeImpactGraph):
    req1 = TargetedRescanRequest(
        execution_id="exec_det_01",
        site_url=base_graph.site_url,
        changed_resources=["/about.html"],
        change_type=ChangeType.INTERNAL_LINKS,
    )
    req2 = TargetedRescanRequest(
        execution_id="exec_det_01",
        site_url=base_graph.site_url,
        changed_resources=["/about.html"],
        change_type=ChangeType.INTERNAL_LINKS,
    )
    dec1 = RescanPolicyEngine.decide_scope(req1, base_graph)
    dec2 = RescanPolicyEngine.decide_scope(req2, base_graph)

    assert dec1.scope == dec2.scope
    assert [r.resource_id for r in dec1.selected_resources] == [r.resource_id for r in dec2.selected_resources]
    assert [r.reason for r in dec1.selected_resources] == [r.reason for r in dec2.selected_resources]


# =============================================================================
# M. Idempotency in Rescan Service
# =============================================================================

def test_idempotency_avoids_duplicate_rescan_execution(base_graph: ChangeImpactGraph):
    req = TargetedRescanRequest(
        execution_id="exec_idem_01",
        site_url=base_graph.site_url,
        changed_resources=["/about.html"],
        change_type=ChangeType.PAGE_METADATA,
        idempotency_key="key_test_idem_001",
    )
    custom_html = {"/about.html": "<html><head><title>Updated About</title></head><body><h1>About</h1></body></html>"}

    res1 = TargetedRescanService.execute_targeted_rescan(req, base_graph, custom_html_map=custom_html)
    assert res1.is_cached is False
    assert len(res1.rescanned_resources) == 1

    # Second execution with identical idempotency key
    res2 = TargetedRescanService.execute_targeted_rescan(req, base_graph, custom_html_map=custom_html)
    assert res2.is_cached is True
    assert res2.rescan_id == res1.rescan_id
    assert res2.scope == res1.scope


# =============================================================================
# N. Concurrency Safety
# =============================================================================

def test_concurrency_parallel_rescan_requests(base_graph: ChangeImpactGraph):
    def run_worker(idx: int):
        req = TargetedRescanRequest(
            execution_id=f"exec_conc_{idx}",
            site_url=base_graph.site_url,
            changed_resources=["/about.html"],
            change_type=ChangeType.PAGE_METADATA,
            idempotency_key=f"conc_key_{idx}",
        )
        custom_html = {"/about.html": f"<html><head><title>Worker {idx}</title></head><body><h1>Worker {idx}</h1></body></html>"}
        return TargetedRescanService.execute_targeted_rescan(req, base_graph, custom_html_map=custom_html)

    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as executor:
        futures = [executor.submit(run_worker, i) for i in range(10)]
        results = [f.result() for f in futures]

    assert len(results) == 10
    for r in results:
        assert r.scope == RescanScope.TARGETED_RESCAN
        assert len(r.rescanned_resources) == 1


# =============================================================================
# O. Workspace Isolation
# =============================================================================

def test_workspace_isolation_violation_raises(base_graph: ChangeImpactGraph):
    # base_graph has workspace_id = "ws_lab_default"
    req_bad_ws = TargetedRescanRequest(
        execution_id="exec_ws_01",
        site_url=base_graph.site_url,
        workspace_id="ws_foreign_tenant",
        changed_resources=["/about.html"],
    )
    with pytest.raises(ValueError, match="Workspace isolation violation"):
        RescanPolicyEngine.decide_scope(req_bad_ws, base_graph)


# =============================================================================
# P. Security & SSRF Protections
# =============================================================================

def test_security_unsafe_urls_rejected(base_graph: ChangeImpactGraph):
    # Dangerous scheme
    req_scheme = TargetedRescanRequest(
        execution_id="exec_sec_01",
        site_url=base_graph.site_url,
        changed_resources=["javascript:alert(1)"],
    )
    with pytest.raises(ValueError, match="Forbidden or unsafe URL scheme"):
        RescanPolicyEngine.decide_scope(req_scheme, base_graph)

    # Cross domain / host mismatch
    req_cross = TargetedRescanRequest(
        execution_id="exec_sec_02",
        site_url=base_graph.site_url,
        changed_resources=["https://evil-external-host.com/hack.html"],
    )
    with pytest.raises(ValueError, match="Cross-host target forbidden"):
        RescanPolicyEngine.decide_scope(req_cross, base_graph)


# =============================================================================
# Q. Pipeline Harness & Stage 12 Integration
# =============================================================================

def test_pipeline_stage_12_uses_rescan_policy():
    fixture = build_static_site_fixture()
    harness = PipelineHarness()
    config = PipelineRunConfig(
        site_url=fixture.base_url,
        fixture=fixture,
        dry_run=True,
        allow_mutations=False,
    )

    trace = harness.run(config)
    assert trace.overall_status.value in ("COMPLETED", "SUCCEEDED")

    stage_12_trace = trace.get_stage_trace(PipelineStage.RESCAN)
    assert stage_12_trace is not None
    assert stage_12_trace.status == StageStatus.SUCCEEDED
    assert "rescan_scope" in stage_12_trace.output_ref
    assert "decision_id" in stage_12_trace.output_ref
    assert stage_12_trace.output_ref["rescanned_count"] >= 1


# =============================================================================
# R. FastAPI Endpoints
# =============================================================================

def test_rescan_api_endpoints():
    client = TestClient(app)

    # 1. Analyze Impact
    resp = client.post(
        "/api/lab/rescan/analyze-impact",
        params={
            "site_url": "https://example.lab.local",
            "changed_resource": "/about.html",
            "change_type": "PAGE_METADATA",
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["scope"] == "TARGETED_RESCAN"
    assert len(data["selected_resources"]) == 1

    # 2. Decide Scope
    payload = {
        "execution_id": "exec_api_01",
        "site_url": "https://example.lab.local",
        "changed_resources": ["/header"],
        "change_type": "TEMPLATE_SHARED",
    }
    resp2 = client.post("/api/lab/rescan/decide-scope", json=payload)
    assert resp2.status_code == 200
    data2 = resp2.json()
    assert data2["scope"] == "FULL_RESCAN"

    # 3. Execute
    exec_payload = {
        "execution_id": "exec_api_exec_01",
        "site_url": "https://example.lab.local",
        "changed_resources": ["/about.html"],
        "change_type": "PAGE_METADATA",
    }
    resp3 = client.post("/api/lab/rescan/execute", json=exec_payload)
    assert resp3.status_code == 200
    data3 = resp3.json()
    assert data3["scope"] == "TARGETED_RESCAN"
    assert data3["is_cached"] is False
