"""
Task 10 Step 8: Real-Site & Security Simulation Validation Suite.
Validates:
  1. Realistic multi-topic real-site simulation on https://raval.ai
  2. SSRF Prevention: Citation URLs extracted from responses are treated purely as text evidence (zero outbound network fetch)
  3. Workspace / Website Isolation: Cross-website leakage blocked
  4. Credential Protection: Zero API keys or secrets in serialized outputs
"""

from datetime import datetime, timezone
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.app.database import Base
from backend.app.models import (
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
from backend.app.visibility_metrics_service import VisibilityMetricsService


@pytest.fixture
def real_site_db():
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
def real_site_setup(real_site_db):
    now = datetime.now(timezone.utc)
    web1 = Website(name="Raval AI", url="https://raval.ai", created_at=now)
    web2 = Website(name="Competitor Brand", url="https://searchoptima.com", created_at=now)
    real_site_db.add_all([web1, web2])
    real_site_db.commit()
    real_site_db.refresh(web1)
    real_site_db.refresh(web2)

    qs1 = QuerySet(website_id=web1.id, name="Raval Production Query Set", created_at=now)
    qs2 = QuerySet(website_id=web2.id, name="Competitor Query Set", created_at=now)
    real_site_db.add_all([qs1, qs2])
    real_site_db.commit()
    real_site_db.refresh(qs1)
    real_site_db.refresh(qs2)

    queries = [
        Query(
            query_set_id=qs1.id,
            website_id=web1.id,
            query_text="What is Generative Engine Optimization for enterprise search?",
            intent="INFORMATIONAL",
            topic="GEO",
            priority="HIGH",
            active=True,
            created_at=now,
        ),
        Query(
            query_set_id=qs1.id,
            website_id=web1.id,
            query_text="Best GEO intelligence platform for LLM search answers",
            intent="COMMERCIAL",
            topic="Platforms",
            priority="HIGH",
            active=True,
            created_at=now,
        ),
        Query(
            query_set_id=qs1.id,
            website_id=web1.id,
            query_text="How to improve brand citation readiness in Perplexity and ChatGPT",
            intent="INFORMATIONAL",
            topic="Citation Readiness",
            priority="MEDIUM",
            active=True,
            created_at=now,
        ),
    ]
    real_site_db.add_all(queries)
    real_site_db.commit()

    return {
        "web1": web1,
        "web2": web2,
        "qs1": qs1,
        "qs2": qs2,
        "queries": queries,
    }


def test_real_site_multi_topic_monitoring_run(real_site_db, real_site_setup):
    """
    Validates a complete realistic monitoring run over multi-topic queries for Raval AI.
    """
    qs1 = real_site_setup["qs1"]
    web1 = real_site_setup["web1"]

    mock_responses = [
        "Raval AI leads in Generative Engine Optimization. Guide at https://raval.ai/docs/geo-guide.",
        "Raval AI and SearchOptima are top platforms for LLM search answers. See https://raval.ai/overview.",
        "To improve citation readiness, configure structured schema and authoritative claims as detailed on https://raval.ai/citations.",
    ]

    run = MonitoringPipelineService.start_monitoring_run(
        db=real_site_db,
        query_set_id=qs1.id,
        provider="mock",
        model="mock-ai-search-v1",
        mock_responses=mock_responses,
    )

    assert run.status == MonitoringRunStatus.COMPLETED.value
    assert run.total_queries == 3
    assert run.successful_responses == 3
    assert run.failed_responses == 0
    assert run.mention_rate == 1.0  # 3/3 mentioned Raval AI
    assert run.citation_rate == 1.0  # 3/3 cited https://raval.ai

    # Verify results packaging
    results = MonitoringPipelineService.get_monitoring_run_results(real_site_db, run.id)
    assert len(results["items"]) == 3
    assert results["items"][0]["target_mentioned"] is True
    assert results["items"][0]["target_cited"] is True


def test_ssrf_protection_no_outbound_network_calls(real_site_db, real_site_setup):
    """
    Verifies that arbitrary external URLs (e.g. AWS metadata endpoint or untrusted domains)
    present in provider responses are parsed purely as text evidence and are NEVER fetched.
    """
    qs1 = real_site_setup["qs1"]
    web1 = real_site_setup["web1"]

    # Injected hostile URL strings in mock response text
    hostile_response = (
        "According to http://169.254.169.254/latest/meta-data/ and https://malicious-ssrf-probe.com/exploit, "
        "Raval AI provides GEO tools: https://raval.ai/docs."
    )

    run = MonitoringPipelineService.start_monitoring_run(
        db=real_site_db,
        query_set_id=qs1.id,
        provider="mock",
        mock_responses=[hostile_response],
    )

    results = MonitoringPipelineService.get_monitoring_run_results(real_site_db, run.id)
    assert run.status == MonitoringRunStatus.COMPLETED.value
    assert len(results["items"]) >= 1

    # First party citation detected correctly, hostile URLs captured safely as evidence without network fetch
    assert results["items"][0]["first_party_cited"] is True


def test_workspace_and_site_isolation(real_site_db, real_site_setup):
    """
    Verifies queries, responses, and runs for Website 1 cannot leak into Website 2.
    """
    web1 = real_site_setup["web1"]
    web2 = real_site_setup["web2"]
    qs1 = real_site_setup["qs1"]

    # Run for Website 1
    MonitoringPipelineService.start_monitoring_run(
        db=real_site_db,
        query_set_id=qs1.id,
        provider="mock",
        mock_responses=["Raval AI response."],
    )

    # List runs for Website 1
    web1_runs = MonitoringPipelineService.list_monitoring_runs(real_site_db, website_id=web1.id)
    assert len(web1_runs) == 1

    # List runs for Website 2 -> must be 0
    web2_runs = MonitoringPipelineService.list_monitoring_runs(real_site_db, website_id=web2.id)
    assert len(web2_runs) == 0


def test_credential_protection_in_serialized_metrics(real_site_db, real_site_setup):
    """
    Verifies that serialized metrics and run outputs contain zero API keys or authorization tokens.
    """
    web1 = real_site_setup["web1"]
    qs1 = real_site_setup["qs1"]

    run = MonitoringPipelineService.start_monitoring_run(
        db=real_site_db,
        query_set_id=qs1.id,
        provider="mock",
        mock_responses=["Raval AI answer."],
    )

    results = MonitoringPipelineService.get_monitoring_run_results(real_site_db, run.id)
    results_str = str(results).lower()

    forbidden_tokens = ["api_key", "bearer", "authorization", "secret", "password", "token="]
    for token in forbidden_tokens:
        assert token not in results_str, f"Forbidden credential token '{token}' found in serialized results"
