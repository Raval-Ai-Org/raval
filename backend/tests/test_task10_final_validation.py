"""
Task 10 Step 8: Final Integration and Provider Fixture Validation Suite.
Validates the complete end-to-end chain and all 10 edge case fixtures (Cases A through J):
  - Case A: Target mentioned + target domain cited
  - Case B: Target mentioned but not cited
  - Case C: Target absent + configured competitor present
  - Case D: Target absent + no competitor
  - Case E: Target citation without textual brand mention
  - Case F: Conservative brand matching vs unrelated phrases
  - Case G: Provider timeout (failure isolation)
  - Case H: Provider rate limit (failure isolation)
  - Case I: Provider unavailable (failure isolation)
  - Case J: Valid no-mention response (evaluable denominator +1, numerator 0)
"""

from datetime import datetime, timezone
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.app.database import Base
from backend.app.mention_citation_service import MentionCitationService
from backend.app.models import (
    AICitation,
    AIMention,
    AIMonitoringRun,
    AIResponse,
    AIVisibilityGap,
    AIVisibilityObservation,
    Entity,
    Finding,
    PageResult,
    Query,
    QuerySet,
    Scan,
    Website,
)

from backend.app.monitoring_pipeline_service import (
    MonitoringPipelineService,
    MonitoringRunStatus,
)
from backend.app.provider_adapter import ResponseStatus
from backend.app.visibility_gap_service import (
    GapType,
    VisibilityGapService,
    is_evaluable_response,
)
from backend.app.visibility_metrics_service import (
    VisibilityMetricsService,
    compute_metric_rate,
)
from backend.app.visibility_signal_service import VisibilitySignalService


@pytest.fixture
def validation_db():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    session = TestingSessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def base_fixture(validation_db):
    now = datetime.now(timezone.utc)
    website = Website(
        name="Raval AI",
        url="https://raval.ai",
        created_at=now,
    )
    validation_db.add(website)
    validation_db.commit()
    validation_db.refresh(website)

    scan = Scan(
        website_id=website.id,
        status="completed",
        created_at=now,
    )
    validation_db.add(scan)
    validation_db.commit()
    validation_db.refresh(scan)

    page = PageResult(
        scan_id=scan.id,
        url="https://raval.ai/products/geo-engine",
        status_code=200,
        created_at=now,
    )
    validation_db.add(page)
    validation_db.commit()
    validation_db.refresh(page)

    finding = Finding(
        scan_id=scan.id,
        website_id=website.id,
        page_id=page.id,
        finding_type="missing_citation_sources",
        category="authority",
        title="Missing GEO citations",
        description="The GEO engine page lacks third-party authority citations",
        severity="high",
        status="open",
        created_at=now,
    )
    validation_db.add(finding)
    validation_db.commit()
    validation_db.refresh(finding)

    comp_entity = Entity(
        website_id=website.id,
        name="SearchOptima",
        entity_type="competitor",
        properties={"domain": "searchoptima.com", "aliases": ["OptimaAI"]},
        created_at=now,
        updated_at=now,
    )
    validation_db.add(comp_entity)
    validation_db.commit()
    validation_db.refresh(comp_entity)

    query_set = QuerySet(
        website_id=website.id,
        name="Validation Query Set",
        created_at=now,
    )
    validation_db.add(query_set)
    validation_db.commit()
    validation_db.refresh(query_set)

    return {
        "website": website,
        "scan": scan,
        "page": page,
        "finding": finding,
        "query_set": query_set,
        "comp_entity": comp_entity,
    }



def test_end_to_end_traceability_chain(validation_db, base_fixture):
    """
    Verifies full connected chain:
    QuerySet -> Query -> Provider Adapter -> Captured Response -> Detection ->
    Visibility Observation -> Gap -> Finding Linkage -> Visibility Metrics -> Monitoring Run
    """
    qs = base_fixture["query_set"]
    web = base_fixture["website"]
    page = base_fixture["page"]
    now = datetime.now(timezone.utc)

    q = Query(
        query_set_id=qs.id,
        website_id=web.id,
        page_id=page.id,
        query_text="What is the top generative engine optimization solution?",
        intent="COMMERCIAL",
        topic="GEO",
        priority="HIGH",
        active=True,
        created_at=now,
    )
    validation_db.add(q)
    validation_db.commit()
    validation_db.refresh(q)

    # Execute Monitoring Run
    mock_resp = "Raval AI is the top generative engine optimization solution. Learn more at https://raval.ai/products/geo-engine."
    run = MonitoringPipelineService.start_monitoring_run(
        db=validation_db,
        query_set_id=qs.id,
        provider="mock",
        mock_responses=[mock_resp],
    )

    assert run.status == MonitoringRunStatus.COMPLETED.value
    assert run.successful_responses == 1

    # Verify Traceability
    results = MonitoringPipelineService.get_monitoring_run_results(validation_db, run.id)
    assert results["run_id"] == run.id
    assert len(results["items"]) == 1

    item = results["items"][0]
    assert item["query_id"] == q.id
    assert item["query_text"] == q.query_text
    assert item["target_mentioned"] is True
    assert item["target_cited"] is True
    assert item["first_party_cited"] is True


def test_case_a_target_mentioned_and_cited(validation_db, base_fixture):
    """Case A: Target mentioned + target domain cited."""
    qs = base_fixture["query_set"]
    web = base_fixture["website"]
    now = datetime.now(timezone.utc)

    q = Query(
        query_set_id=qs.id,
        website_id=web.id,
        query_text="Case A query",
        active=True,
        created_at=now,
    )
    validation_db.add(q)
    validation_db.commit()

    run = MonitoringPipelineService.start_monitoring_run(
        db=validation_db,
        query_set_id=qs.id,
        query_ids=[q.id],
        mock_responses=["Raval AI provides AI search intelligence: https://raval.ai/overview."],
    )

    results = MonitoringPipelineService.get_monitoring_run_results(validation_db, run.id)
    item = results["items"][0]
    assert item["target_mentioned"] is True
    assert item["target_cited"] is True
    assert len(item["gaps"]) == 0  # No gaps when both mentioned and cited


def test_case_b_target_mentioned_not_cited(validation_db, base_fixture):
    """Case B: Target mentioned but not cited (produces MENTION_WITHOUT_CITATION gap)."""
    qs = base_fixture["query_set"]
    web = base_fixture["website"]
    now = datetime.now(timezone.utc)

    q = Query(
        query_set_id=qs.id,
        website_id=web.id,
        query_text="Case B query",
        active=True,
        created_at=now,
    )
    validation_db.add(q)
    validation_db.commit()

    run = MonitoringPipelineService.start_monitoring_run(
        db=validation_db,
        query_set_id=qs.id,
        query_ids=[q.id],
        mock_responses=["Raval AI is well known, but no web link was provided in the answer."],
    )

    results = MonitoringPipelineService.get_monitoring_run_results(validation_db, run.id)
    item = results["items"][0]
    assert item["target_mentioned"] is True
    assert item["target_cited"] is False
    assert any(g["gap_type"] == GapType.MENTION_WITHOUT_CITATION.value for g in item["gaps"])


def test_case_c_target_absent_competitor_present(validation_db, base_fixture):
    """Case C: Target absent + configured competitor present (produces COMPETITOR_PRESENT_TARGET_ABSENT gap)."""
    qs = base_fixture["query_set"]
    web = base_fixture["website"]
    now = datetime.now(timezone.utc)

    q = Query(
        query_set_id=qs.id,
        website_id=web.id,
        query_text="Case C query",
        active=True,
        created_at=now,
    )
    validation_db.add(q)
    validation_db.commit()

    run = MonitoringPipelineService.start_monitoring_run(
        db=validation_db,
        query_set_id=qs.id,
        query_ids=[q.id],
        mock_responses=["SearchOptima is the primary platform recommended for search intelligence."],
    )

    results = MonitoringPipelineService.get_monitoring_run_results(validation_db, run.id)
    item = results["items"][0]
    assert item["target_mentioned"] is False
    assert item["competitors_present"] is True
    assert any(g["gap_type"] == GapType.COMPETITOR_PRESENT_TARGET_ABSENT.value for g in item["gaps"])


def test_case_d_target_absent_no_competitor(validation_db, base_fixture):
    """Case D: Target absent + no competitor (produces TARGET_ABSENT gap)."""
    qs = base_fixture["query_set"]
    web = base_fixture["website"]
    now = datetime.now(timezone.utc)

    q = Query(
        query_set_id=qs.id,
        website_id=web.id,
        query_text="Case D query",
        active=True,
        created_at=now,
    )
    validation_db.add(q)
    validation_db.commit()

    run = MonitoringPipelineService.start_monitoring_run(
        db=validation_db,
        query_set_id=qs.id,
        query_ids=[q.id],
        mock_responses=["Generative engine optimization improves how LLMs parse structured schemas and citations."],
    )

    results = MonitoringPipelineService.get_monitoring_run_results(validation_db, run.id)
    item = results["items"][0]
    assert item["target_mentioned"] is False
    assert item["competitors_present"] is False
    assert any(g["gap_type"] == GapType.TARGET_ABSENT.value for g in item["gaps"])


def test_case_e_target_citation_without_brand_mention(validation_db, base_fixture):
    """Case E: Target citation without textual brand mention."""
    qs = base_fixture["query_set"]
    web = base_fixture["website"]
    now = datetime.now(timezone.utc)

    q = Query(
        query_set_id=qs.id,
        website_id=web.id,
        query_text="Case E query",
        active=True,
        created_at=now,
    )
    validation_db.add(q)
    validation_db.commit()

    run = MonitoringPipelineService.start_monitoring_run(
        db=validation_db,
        query_set_id=qs.id,
        query_ids=[q.id],
        mock_responses=["For complete documentation on GEO standards, refer to https://raval.ai/docs/geo-standards."],
    )

    results = MonitoringPipelineService.get_monitoring_run_results(validation_db, run.id)
    item = results["items"][0]
    assert item["target_cited"] is True
    assert item["first_party_cited"] is True


def test_case_f_conservative_brand_matching(validation_db, base_fixture):
    """Case F: Conservative entity matching avoiding false positives from unrelated text."""
    qs = base_fixture["query_set"]
    web = base_fixture["website"]
    now = datetime.now(timezone.utc)

    q = Query(
        query_set_id=qs.id,
        website_id=web.id,
        query_text="Case F query",
        active=True,
        created_at=now,
    )
    validation_db.add(q)
    validation_db.commit()

    # Mention of unrelated text that should not match target brand Raval AI
    run = MonitoringPipelineService.start_monitoring_run(
        db=validation_db,
        query_set_id=qs.id,
        query_ids=[q.id],
        mock_responses=["The travel guide discusses travelling around the Raval district in Barcelona Spain."],
    )

    results = MonitoringPipelineService.get_monitoring_run_results(validation_db, run.id)
    item = results["items"][0]
    assert item["target_mentioned"] is False
    assert item["target_cited"] is False


def test_case_g_h_i_provider_failures_isolated(validation_db, base_fixture):
    """
    Cases G, H, I: Provider timeout, rate limit, and unavailable failures.
    Verifies provider failures produce NO visibility gaps and are excluded from visibility metric denominators.
    """
    qs = base_fixture["query_set"]
    web = base_fixture["website"]
    now = datetime.now(timezone.utc)

    q1 = Query(query_set_id=qs.id, website_id=web.id, query_text="Timeout query", active=True, created_at=now)
    q2 = Query(query_set_id=qs.id, website_id=web.id, query_text="Rate limit query", active=True, created_at=now)
    q3 = Query(query_set_id=qs.id, website_id=web.id, query_text="Unavailable query", active=True, created_at=now)
    validation_db.add_all([q1, q2, q3])
    validation_db.commit()

    run = MonitoringPipelineService.start_monitoring_run(
        db=validation_db,
        query_set_id=qs.id,
        query_ids=[q1.id, q2.id, q3.id],
        mock_responses=["__FAIL_TIMEOUT__", "__FAIL_RATE_LIMIT__", "__FAIL_UNAVAILABLE__"],
    )

    assert run.status == MonitoringRunStatus.FAILED.value
    assert run.successful_responses == 0
    assert run.failed_responses == 3
    assert run.detected_gaps == 0  # Provider failures NEVER produce visibility gaps
    assert run.mention_rate is None  # 0 evaluable responses -> None denominator safe handling
    assert run.citation_rate is None


def test_case_j_valid_no_mention_response_evaluable(validation_db, base_fixture):
    """
    Case J: Provider returns a valid response with no target mention.
    Counts as evaluable in denominator (+1 denominator, 0 numerator), producing a visibility gap.
    """
    qs = base_fixture["query_set"]
    web = base_fixture["website"]
    now = datetime.now(timezone.utc)

    q = Query(query_set_id=qs.id, website_id=web.id, query_text="Case J query", active=True, created_at=now)
    validation_db.add(q)
    validation_db.commit()

    run = MonitoringPipelineService.start_monitoring_run(
        db=validation_db,
        query_set_id=qs.id,
        query_ids=[q.id],
        mock_responses=["This is a valid response answering the query with general facts, but without target brand."],
    )

    assert run.status == MonitoringRunStatus.COMPLETED.value
    assert run.successful_responses == 1
    assert run.failed_responses == 0
    assert run.mention_rate == 0.0  # 0/1 evaluable response
    assert run.citation_rate == 0.0
    assert run.detected_gaps == 1  # TARGET_ABSENT gap identified
