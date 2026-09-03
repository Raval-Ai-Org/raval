"""
Unit tests for Visibility Gap Analysis Engine (Task 10 Step 5).
Tests gap evaluation rules, provider failure safeguards, and deterministic severity calculations.
"""

from datetime import datetime, timezone
import pytest

from backend.app.models import AIResponse, AIVisibilityObservation, Query
from backend.app.visibility_gap_service import (
    GapSeverity,
    GapType,
    calculate_gap_severity,
    evaluate_response_gaps,
    is_evaluable_response,
)


@pytest.fixture
def base_query():
    return Query(
        id=1,
        query_set_id=1,
        website_id=1,
        query_text="What are the best GEO intelligence solutions?",
        intent="COMMERCIAL",
        priority="HIGH",
    )


# ==========================================
# 1. Provider Failure Safeguards
# ==========================================


@pytest.mark.parametrize(
    "status,text,expected_evaluable",
    [
        ("SUCCESS", "Valid response answer text here.", True),
        ("TIMEOUT", "", False),
        ("TIMEOUT", "Partial timeout snippet", False),
        ("RATE_LIMITED", "HTTP 429 Too Many Requests", False),
        ("UNAVAILABLE", "Missing credentials", False),
        ("ERROR", "Internal Server Error", False),
        ("SUCCESS", "", False),
    ],
)
def test_is_evaluable_response(status, text, expected_evaluable):
    resp = AIResponse(
        id=1,
        query_id=1,
        query_set_id=1,
        website_id=1,
        provider="mock",
        model="mock-v1",
        status=status,
        response_text=text,
    )
    assert is_evaluable_response(resp) is expected_evaluable


def test_provider_failure_produces_no_gaps(base_query):
    resp_timeout = AIResponse(
        id=1,
        query_id=1,
        query_set_id=1,
        website_id=1,
        provider="mock",
        model="mock-v1",
        status="TIMEOUT",
        response_text="",
    )
    obs = AIVisibilityObservation(
        id=1,
        response_id=1,
        query_id=1,
        query_set_id=1,
        website_id=1,
        provider="mock",
        model="mock-v1",
        target_mentioned=False,
        target_cited=False,
        competitors_present=False,
    )
    gaps = evaluate_response_gaps(obs, resp_timeout, base_query)
    assert len(gaps) == 0


# ==========================================
# 2. Gap Evaluation Rules
# ==========================================


def test_gap_competitor_present_target_absent(base_query):
    resp = AIResponse(
        id=1,
        query_id=1,
        query_set_id=1,
        website_id=1,
        provider="mock",
        model="mock-v1",
        status="SUCCESS",
        response_text="Top solutions include CompetitorX and OptiSearch.",
    )
    obs = AIVisibilityObservation(
        id=1,
        response_id=1,
        query_id=1,
        query_set_id=1,
        website_id=1,
        provider="mock",
        model="mock-v1",
        target_mentioned=False,
        target_cited=False,
        competitors_present=True,
        competitor_count=2,
        competitor_signals_json=[{"competitor_name": "CompetitorX"}, {"competitor_name": "OptiSearch"}],
    )

    gaps = evaluate_response_gaps(obs, resp, base_query)
    assert len(gaps) == 1
    assert gaps[0].gap_type == GapType.COMPETITOR_PRESENT_TARGET_ABSENT
    assert gaps[0].severity == GapSeverity.HIGH
    assert "CompetitorX" in str(gaps[0].evidence)


def test_gap_target_absent_without_competitor(base_query):
    resp = AIResponse(
        id=1,
        query_id=1,
        query_set_id=1,
        website_id=1,
        provider="mock",
        model="mock-v1",
        status="SUCCESS",
        response_text="General overview of search engine optimization techniques.",
    )
    obs = AIVisibilityObservation(
        id=1,
        response_id=1,
        query_id=1,
        query_set_id=1,
        website_id=1,
        provider="mock",
        model="mock-v1",
        target_mentioned=False,
        target_cited=False,
        competitors_present=False,
        competitor_count=0,
    )

    gaps = evaluate_response_gaps(obs, resp, base_query)
    assert len(gaps) == 1
    assert gaps[0].gap_type == GapType.TARGET_ABSENT
    assert gaps[0].severity == GapSeverity.HIGH  # base_query is HIGH priority


def test_gap_mention_without_citation(base_query):
    resp = AIResponse(
        id=1,
        query_id=1,
        query_set_id=1,
        website_id=1,
        provider="mock",
        model="mock-v1",
        status="SUCCESS",
        response_text="Raval AI provides specialized answer optimization algorithms.",
    )
    obs = AIVisibilityObservation(
        id=1,
        response_id=1,
        query_id=1,
        query_set_id=1,
        website_id=1,
        provider="mock",
        model="mock-v1",
        target_mentioned=True,
        target_cited=False,
        first_party_cited=False,
        observable_mention_position=0,
    )

    gaps = evaluate_response_gaps(obs, resp, base_query)
    assert len(gaps) == 1
    assert gaps[0].gap_type == GapType.MENTION_WITHOUT_CITATION
    assert gaps[0].severity == GapSeverity.HIGH  # Commercial intent + High priority


def test_gap_target_cited_not_relevant(base_query):
    resp = AIResponse(
        id=1,
        query_id=1,
        query_set_id=1,
        website_id=1,
        provider="mock",
        model="mock-v1",
        status="SUCCESS",
        response_text="Irrelevant text citing https://raval.ai/random.",
    )
    obs = AIVisibilityObservation(
        id=1,
        response_id=1,
        query_id=1,
        query_set_id=1,
        website_id=1,
        provider="mock",
        model="mock-v1",
        target_mentioned=False,
        target_cited=True,
        relevant_answer="IRRELEVANT",
    )

    gaps = evaluate_response_gaps(obs, resp, base_query)
    assert len(gaps) == 1
    assert gaps[0].gap_type == GapType.TARGET_CITED_NOT_RELEVANT
    assert gaps[0].severity == GapSeverity.LOW


def test_valid_response_no_gaps(base_query):
    resp = AIResponse(
        id=1,
        query_id=1,
        query_set_id=1,
        website_id=1,
        provider="mock",
        model="mock-v1",
        status="SUCCESS",
        response_text="Raval AI is leading in GEO. See [Docs](https://raval.ai/docs).",
    )
    obs = AIVisibilityObservation(
        id=1,
        response_id=1,
        query_id=1,
        query_set_id=1,
        website_id=1,
        provider="mock",
        model="mock-v1",
        target_mentioned=True,
        target_cited=True,
        first_party_cited=True,
        relevant_answer="RELEVANT",
        competitors_present=False,
    )

    gaps = evaluate_response_gaps(obs, resp, base_query)
    assert len(gaps) == 0


# ==========================================
# 3. Deterministic Severity Calculations
# ==========================================


def test_calculate_gap_severity_low_priority():
    q_low = Query(id=2, query_set_id=1, website_id=1, query_text="What is search?", intent="INFORMATIONAL", priority="LOW")
    obs = AIVisibilityObservation(id=1, response_id=1, query_id=2, query_set_id=1, website_id=1, provider="mock", model="v1")

    sev = calculate_gap_severity(GapType.TARGET_ABSENT, q_low, obs)
    assert sev == GapSeverity.LOW
