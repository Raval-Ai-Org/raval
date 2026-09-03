"""
Unit and integration tests for Step 7 Monitoring Pipeline Service.
Tests end-to-end orchestration, lifecycle states, active query filtering,
failure isolation (PARTIAL status), repeated runs historical preservation, and detailed results.
"""

from datetime import datetime, timedelta, timezone
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.app.database import Base
from backend.app.models import (
    AICitation,
    AIMention,
    AIMonitoringRun,
    AIResponse,
    AIVisibilityGap,
    AIVisibilityObservation,
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


@pytest.fixture
def db_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine)
    session = session_factory()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def sample_monitoring_setup(db_session):
    now = datetime.now(timezone.utc)
    website = Website(name="Raval AI", url="https://raval.ai", created_at=now)
    db_session.add(website)
    db_session.commit()
    db_session.refresh(website)

    scan = Scan(website_id=website.id, status="completed", created_at=now)
    db_session.add(scan)
    db_session.commit()
    db_session.refresh(scan)

    page = PageResult(scan_id=scan.id, url="https://raval.ai/docs/geo", status_code=200, created_at=now)
    db_session.add(page)
    db_session.commit()
    db_session.refresh(page)

    finding = Finding(
        scan_id=scan.id,
        website_id=website.id,
        page_id=page.id,
        finding_type="missing_citation_sources",
        category="content",
        title="What is generative engine optimization?",
        description="Missing clear definition of GEO on the target page",
        severity="high",
        status="open",
        created_at=now,
    )
    db_session.add(finding)
    db_session.commit()
    db_session.refresh(finding)


    query_set = QuerySet(website_id=website.id, name="Production Monitoring Set", created_at=now)
    db_session.add(query_set)
    db_session.commit()
    db_session.refresh(query_set)

    q1 = Query(
        query_set_id=query_set.id,
        website_id=website.id,
        page_id=page.id,
        query_text="What is generative engine optimization?",
        intent="INFORMATIONAL",
        topic="GEO",
        priority="HIGH",
        active=True,
        created_at=now,
    )
    q2 = Query(
        query_set_id=query_set.id,
        website_id=website.id,
        page_id=page.id,
        query_text="Best GEO intelligence platform for AI search",
        intent="COMMERCIAL",
        topic="Platforms",
        priority="HIGH",
        active=True,
        created_at=now,
    )

    db_session.add_all([q1, q2])
    db_session.commit()
    db_session.refresh(q1)
    db_session.refresh(q2)

    return {
        "website": website,
        "scan": scan,
        "page": page,
        "finding": finding,
        "query_set": query_set,
        "q1": q1,
        "q2": q2,
    }


def test_monitoring_pipeline_full_lifecycle_success(db_session, sample_monitoring_setup):
    query_set = sample_monitoring_setup["query_set"]

    mock_texts = [
        "Raval AI leads in generative engine optimization. See https://raval.ai/docs/geo for guide.",
        "Raval AI and SearchOptima are top platforms for AI search intelligence.",
    ]

    run = MonitoringPipelineService.start_monitoring_run(
        db=db_session,
        query_set_id=query_set.id,
        provider="mock",
        model="mock-ai-search-v1",
        mock_responses=mock_texts,
    )

    # 1. Lifecycle verification
    assert run.id is not None
    assert run.status == MonitoringRunStatus.COMPLETED.value
    assert run.started_at is not None
    assert run.completed_at is not None
    assert run.started_at <= run.completed_at

    # 2. Counts verification
    assert run.total_queries == 2
    assert run.attempted_queries == 2
    assert run.successful_responses == 2
    assert run.failed_responses == 0
    assert run.detected_mentions >= 2
    assert run.detected_citations >= 1
    assert run.mention_rate == 1.0  # 2/2 responses mentioned Raval AI

    # 3. Response and observation records persisted
    responses = db_session.query(AIResponse).filter(AIResponse.query_set_id == query_set.id).all()
    assert len(responses) == 2

    observations = db_session.query(AIVisibilityObservation).filter(AIVisibilityObservation.query_set_id == query_set.id).all()
    assert len(observations) == 2


def test_monitoring_pipeline_empty_active_queries(db_session, sample_monitoring_setup):
    website = sample_monitoring_setup["website"]
    empty_qs = QuerySet(website_id=website.id, name="Empty Set", created_at=datetime.now(timezone.utc))
    db_session.add(empty_qs)
    db_session.commit()
    db_session.refresh(empty_qs)

    run = MonitoringPipelineService.start_monitoring_run(
        db=db_session,
        query_set_id=empty_qs.id,
        provider="mock",
    )

    assert run.status == MonitoringRunStatus.COMPLETED.value
    assert run.total_queries == 0
    assert run.attempted_queries == 0
    assert run.successful_responses == 0
    assert run.failed_responses == 0


def test_monitoring_pipeline_active_query_filtering(db_session, sample_monitoring_setup):
    query_set = sample_monitoring_setup["query_set"]
    q2 = sample_monitoring_setup["q2"]

    # Mark q2 as inactive
    q2.active = False
    db_session.commit()


    run = MonitoringPipelineService.start_monitoring_run(
        db=db_session,
        query_set_id=query_set.id,
        provider="mock",
        mock_responses=["Raval AI is the leader."],
    )

    assert run.total_queries == 1  # Only q1 is active
    assert run.attempted_queries == 1
    assert run.successful_responses == 1


def test_monitoring_pipeline_failure_isolation_partial(db_session, sample_monitoring_setup):
    query_set = sample_monitoring_setup["query_set"]

    # Provide 1 valid mock response and 1 failure mode (e.g. empty mock text triggering failure)
    mock_texts = [
        "Raval AI provides cutting edge GEO intelligence.",
        "",  # Empty response -> Provider failure
    ]

    run = MonitoringPipelineService.start_monitoring_run(
        db=db_session,
        query_set_id=query_set.id,
        provider="mock",
        mock_responses=mock_texts,
    )

    # Status should be PARTIAL because 1 succeeded and 1 failed
    assert run.status == MonitoringRunStatus.PARTIAL.value
    assert run.total_queries == 2
    assert run.attempted_queries == 2
    assert run.successful_responses == 1
    assert run.failed_responses == 1
    assert run.mention_rate == 1.0  # 1/1 evaluable response (failure excluded from denominator)


def test_repeated_runs_preserve_history(db_session, sample_monitoring_setup):
    query_set = sample_monitoring_setup["query_set"]
    website = sample_monitoring_setup["website"]

    run1 = MonitoringPipelineService.start_monitoring_run(
        db=db_session,
        query_set_id=query_set.id,
        provider="mock",
        mock_responses=["Raval AI answer run 1."],
    )

    run2 = MonitoringPipelineService.start_monitoring_run(
        db=db_session,
        query_set_id=query_set.id,
        provider="mock",
        mock_responses=["Raval AI answer run 2."],
    )

    assert run1.id != run2.id

    runs = MonitoringPipelineService.list_monitoring_runs(
        db=db_session,
        website_id=website.id,
    )
    assert len(runs) == 2
    assert runs[0].id == run2.id  # Latest first
    assert runs[1].id == run1.id


def test_get_monitoring_run_results(db_session, sample_monitoring_setup):
    query_set = sample_monitoring_setup["query_set"]

    mock_texts = [
        "Raval AI leads in GEO. Source: https://raval.ai/docs/geo",
        "SearchOptima is a competitor platform without target presence.",
    ]

    run = MonitoringPipelineService.start_monitoring_run(
        db=db_session,
        query_set_id=query_set.id,
        provider="mock",
        mock_responses=mock_texts,
    )

    results = MonitoringPipelineService.get_monitoring_run_results(
        db=db_session,
        run_id=run.id,
    )

    assert results["run_id"] == run.id
    assert results["status"] == MonitoringRunStatus.COMPLETED.value
    assert len(results["items"]) == 2

    item1 = results["items"][0]
    assert item1["target_mentioned"] is True
    assert item1["target_cited"] is True

    item2 = results["items"][1]
    assert item2["target_mentioned"] is False
    assert item2["target_cited"] is False
    assert len(item2["gaps"]) >= 1  # TARGET_ABSENT or COMPETITOR gap detected


def test_monitoring_pipeline_all_queries_failed(db_session, sample_monitoring_setup):
    query_set = sample_monitoring_setup["query_set"]

    run = MonitoringPipelineService.start_monitoring_run(
        db=db_session,
        query_set_id=query_set.id,
        provider="mock",
        mock_responses=["__FAIL_TIMEOUT__", "__FAIL_ERROR__"],
    )

    assert run.status == MonitoringRunStatus.FAILED.value
    assert run.total_queries == 2
    assert run.attempted_queries == 2
    assert run.successful_responses == 0
    assert run.failed_responses == 2
    assert run.mention_rate is None  # Denominator is 0 -> None
    assert run.citation_rate is None


def test_monitoring_pipeline_query_subset_selection(db_session, sample_monitoring_setup):
    query_set = sample_monitoring_setup["query_set"]
    q1 = sample_monitoring_setup["q1"]

    run = MonitoringPipelineService.start_monitoring_run(
        db=db_session,
        query_set_id=query_set.id,
        provider="mock",
        query_ids=[q1.id],
        mock_responses=["Raval AI single query response."],
    )

    assert run.total_queries == 1
    assert run.attempted_queries == 1
    assert run.successful_responses == 1
    assert run.status == MonitoringRunStatus.COMPLETED.value


def test_monitoring_pipeline_gap_linkage_to_findings(db_session, sample_monitoring_setup):
    query_set = sample_monitoring_setup["query_set"]

    # Target absent response triggers gap and finding linkage
    run = MonitoringPipelineService.start_monitoring_run(
        db=db_session,
        query_set_id=query_set.id,
        provider="mock",
        mock_responses=["Generic answer without target mention or citation."],
    )

    results = MonitoringPipelineService.get_monitoring_run_results(
        db=db_session,
        run_id=run.id,
    )

    assert run.detected_gaps > 0
    first_item = results["items"][0]
    assert len(first_item["gaps"]) > 0
    gap = first_item["gaps"][0]
    assert "linked_findings" in gap
    assert len(gap["linked_findings"]) > 0


def test_monitoring_pipeline_list_runs_with_status_filter(db_session, sample_monitoring_setup):
    query_set = sample_monitoring_setup["query_set"]
    website = sample_monitoring_setup["website"]

    # Create 1 successful run and 1 failed run
    MonitoringPipelineService.start_monitoring_run(
        db=db_session,
        query_set_id=query_set.id,
        provider="mock",
        mock_responses=["Raval AI response."],
    )
    MonitoringPipelineService.start_monitoring_run(
        db=db_session,
        query_set_id=query_set.id,
        provider="mock",
        mock_responses=["__FAIL_TIMEOUT__"],
    )

    completed_runs = MonitoringPipelineService.list_monitoring_runs(
        db=db_session,
        website_id=website.id,
        status="COMPLETED",
    )
    failed_runs = MonitoringPipelineService.list_monitoring_runs(
        db=db_session,
        website_id=website.id,
        status="FAILED",
    )

    assert len(completed_runs) >= 1
    assert len(failed_runs) >= 1
    assert all(r.status == "COMPLETED" for r in completed_runs)
    assert all(r.status == "FAILED" for r in failed_runs)

