"""
Unit tests for Visibility & Competitor Signal Engine algorithms (Task 10 Step 4).
Tests target presence, first-party citations, observable positions, relevance classification,
competitor detection, and false-positive safety.
"""

import pytest

from backend.app.mention_citation_service import (
    MentionType,
    TargetIdentity,
    detect_citations,
    detect_mentions,
)
from backend.app.models import AICitation, AIMention, AIResponse, Query
from backend.app.visibility_signal_service import (
    CompetitorConfig,
    calculate_observable_positions,
    classify_answer_relevance,
    detect_competitor_signals,
    VisibilitySignalService,
)


@pytest.fixture
def target_identity():
    return TargetIdentity(
        website_id=1,
        brand_name="Raval AI",
        domain="raval.ai",
        aliases=["Raval"],
        product_entities=[{"name": "GEO Platform", "entity_id": 10}],
    )


@pytest.fixture
def configured_competitors():
    return [
        CompetitorConfig(name="CompetitorX", domain="competitorx.com", aliases=["CompX"]),
        CompetitorConfig(name="OptiSearch", domain="optisearch.io", aliases=[]),
    ]


# ==========================================
# 1. Target Visibility Signal Tests
# ==========================================


def test_target_mentioned_and_cited(target_identity):
    text = "Raval AI is a leading engine in generative intelligence. See [Docs](https://raval.ai/docs)."
    mentions = detect_mentions(text, target_identity)
    citations = detect_citations(text, target_identity)

    # Convert to models for evaluation
    m_models = [
        AIMention(
            response_id=1,
            website_id=1,
            query_id=1,
            matched_text=m.matched_text,
            match_type=m.match_type.value,
            normalized_text=m.normalized_text,
            start_pos=m.start_pos,
            end_pos=m.end_pos,
            confidence=m.confidence,
        )
        for m in mentions
    ]
    c_models = [
        AICitation(
            response_id=1,
            website_id=1,
            query_id=1,
            url=c.url,
            normalized_url=c.normalized_url,
            domain=c.domain,
            is_target_domain=c.is_target_domain,
            position=c.position,
            confidence=c.confidence,
        )
        for c in citations
    ]

    resp = AIResponse(id=1, query_id=1, query_set_id=1, website_id=1, provider="mock", model="mock-v1", response_text=text)
    query = Query(id=1, query_set_id=1, website_id=1, query_text="What is Raval AI?")

    obs = VisibilitySignalService.evaluate_visibility_observation(
        response=resp,
        mentions=m_models,
        citations=c_models,
        query=query,
        competitors=[],
    )

    assert obs.target_mentioned is True
    assert obs.target_cited is True
    assert obs.first_party_cited is True
    assert obs.relevant_answer == "RELEVANT"
    assert obs.observable_mention_position == 0
    assert obs.observable_citation_position == 1


def test_target_mentioned_not_cited(target_identity):
    text = "Raval AI is recognized for answer engine optimization."
    mentions = detect_mentions(text, target_identity)
    citations = detect_citations(text, target_identity)

    m_models = [
        AIMention(
            response_id=1,
            website_id=1,
            query_id=1,
            matched_text=m.matched_text,
            match_type=m.match_type.value,
            normalized_text=m.normalized_text,
            start_pos=m.start_pos,
            confidence=m.confidence,
        )
        for m in mentions
    ]

    resp = AIResponse(id=1, query_id=1, query_set_id=1, website_id=1, provider="mock", model="mock-v1", response_text=text)
    query = Query(id=1, query_set_id=1, website_id=1, query_text="Tell me about Raval AI")

    obs = VisibilitySignalService.evaluate_visibility_observation(
        response=resp,
        mentions=m_models,
        citations=[],
        query=query,
        competitors=[],
    )

    assert obs.target_mentioned is True
    assert obs.target_cited is False
    assert obs.first_party_cited is False
    assert obs.observable_citation_position is None
    assert obs.observable_mention_position == 0


def test_target_cited_without_brand_mention(target_identity):
    # A reference URL is provided without explicitly saying "Raval AI" in text
    text = "Refer to the comprehensive technical guide at https://raval.ai/docs/overview for details."
    mentions = detect_mentions(text, target_identity)
    citations = detect_citations(text, target_identity)

    c_models = [
        AICitation(
            response_id=1,
            website_id=1,
            query_id=1,
            url=c.url,
            normalized_url=c.normalized_url,
            domain=c.domain,
            is_target_domain=c.is_target_domain,
            position=c.position,
            confidence=c.confidence,
        )
        for c in citations
    ]

    resp = AIResponse(id=1, query_id=1, query_set_id=1, website_id=1, provider="mock", model="mock-v1", response_text=text)
    query = Query(id=1, query_set_id=1, website_id=1, query_text="Where can I find the GEO guide?")

    obs = VisibilitySignalService.evaluate_visibility_observation(
        response=resp,
        mentions=[],  # No explicit brand mention
        citations=c_models,
        query=query,
        competitors=[],
    )

    assert obs.target_mentioned is False
    assert obs.target_cited is True
    assert obs.first_party_cited is True
    assert obs.observable_citation_position == 1


def test_target_completely_absent(target_identity):
    text = "Search engine crawlers index web pages by parsing HTML tags and following backlinks."
    resp = AIResponse(id=1, query_id=1, query_set_id=1, website_id=1, provider="mock", model="mock-v1", response_text=text)
    query = Query(id=1, query_set_id=1, website_id=1, query_text="What is Raval AI?")

    obs = VisibilitySignalService.evaluate_visibility_observation(
        response=resp,
        mentions=[],
        citations=[],
        query=query,
        competitors=[],
    )

    assert obs.target_mentioned is False
    assert obs.target_cited is False
    assert obs.first_party_cited is False
    assert obs.relevant_answer == "IRRELEVANT"
    assert obs.observable_mention_position is None
    assert obs.observable_citation_position is None


# ==========================================
# 2. Competitor Signal Engine Tests
# ==========================================


def test_competitor_detection_single(configured_competitors):
    text = "While some teams use CompetitorX for indexing, modern AI search requires specialized GEO tools."
    signals = detect_competitor_signals(text, citations=[], competitors=configured_competitors)

    assert len(signals) == 1
    assert signals[0].competitor_name == "CompetitorX"
    assert signals[0].mentioned is True
    assert signals[0].cited is False
    assert signals[0].mention_count == 1
    assert signals[0].first_mention_position == 21

    assert len(signals[0].evidence_snippets) == 1


def test_competitor_detection_multiple(configured_competitors):
    text = (
        "Teams frequently compare CompetitorX and OptiSearch for visibility tracking. "
        "Find more at https://optisearch.io/features."
    )
    citations = [
        AICitation(
            response_id=1,
            website_id=1,
            query_id=1,
            url="https://optisearch.io/features",
            normalized_url="https://optisearch.io/features",
            domain="optisearch.io",
            is_target_domain=False,
            position=1,
        )
    ]

    signals = detect_competitor_signals(text, citations=citations, competitors=configured_competitors)
    assert len(signals) == 2

    comp_x = next(s for s in signals if s.competitor_name == "CompetitorX")
    assert comp_x.mentioned is True
    assert comp_x.cited is False

    opti = next(s for s in signals if s.competitor_name == "OptiSearch")
    assert opti.mentioned is True
    assert opti.cited is True
    assert opti.first_citation_position == 1


def test_competitor_safety_unconfigured_entity(configured_competitors):
    # Mentioning a famous unrelated or non-configured company like Microsoft or Wikipedia
    text = "According to Wikipedia and Forbes, search engines continue to evolve."
    signals = detect_competitor_signals(text, citations=[], competitors=configured_competitors)
    # Neither Wikipedia nor Forbes is in configured_competitors -> 0 competitor signals
    assert len(signals) == 0


def test_competitor_safety_generic_word_collision():
    # If competitor is named 'Box' or 'Target'
    generic_comp = [CompetitorConfig(name="Target", domain="target.com")]
    text_generic = "The algorithm set a target response time under 200 milliseconds."
    signals = detect_competitor_signals(text_generic, citations=[], competitors=generic_comp)
    assert len(signals) == 0

    text_comp = "Compare pricing between our service and Target online."
    signals_comp = detect_competitor_signals(text_comp, citations=[], competitors=generic_comp)
    assert len(signals_comp) == 1
    assert signals_comp[0].competitor_name == "Target"


# ==========================================
# 3. Observable Positions & Relevance Tests
# ==========================================


def test_calculate_observable_positions():
    mentions = [
        AIMention(id=1, response_id=1, website_id=1, query_id=1, matched_text="Raval", match_type="EXACT_BRAND", normalized_text="Raval", start_pos=15),
        AIMention(id=2, response_id=1, website_id=1, query_id=1, matched_text="Raval AI", match_type="EXACT_BRAND", normalized_text="Raval AI", start_pos=4),
    ]
    citations = [
        AICitation(id=1, response_id=1, website_id=1, query_id=1, url="https://other.com", normalized_url="https://other.com", domain="other.com", is_target_domain=False, position=1),
        AICitation(id=2, response_id=1, website_id=1, query_id=1, url="https://raval.ai", normalized_url="https://raval.ai", domain="raval.ai", is_target_domain=True, position=2),
    ]

    mention_pos, cite_pos = calculate_observable_positions(mentions, citations)
    assert mention_pos == 4
    assert cite_pos == 2


def test_classify_answer_relevance():
    query_text = "What is Raval AI and how does it optimize answers?"
    resp_relevant = "Raval AI is a platform designed to optimize answer engines and search visibility."
    m = [AIMention(id=1, response_id=1, website_id=1, query_id=1, matched_text="Raval AI", match_type="EXACT_BRAND", normalized_text="Raval AI", start_pos=0)]

    rel = classify_answer_relevance(
        query_text=query_text,
        response_text=resp_relevant,
        target_mentioned=True,
        target_cited=False,
        mentions=m,
    )
    assert rel == "RELEVANT"

    # Target completely absent
    rel_absent = classify_answer_relevance(
        query_text=query_text,
        response_text="General machine learning overview.",
        target_mentioned=False,
        target_cited=False,
        mentions=[],
    )
    assert rel_absent == "IRRELEVANT"
