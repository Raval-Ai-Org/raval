"""
Unit and Integration Tests for Query Intelligence Engine (Task 10 - Step 1)
"""

from datetime import datetime, timezone
import pytest
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.models import (
    Entity,
    PageExtraction,
    PageResult,
    PageStructuredData,
    Query,
    QuerySet,
    Scan,
    Website,
)
from app.query_intelligence_service import (
    CandidateQuery,
    ContentIntelligenceQueryGenerator,
    EntityQueryGenerator,
    QuestionIntelligenceQueryGenerator,
    QueryGenerationSource,
    QueryIntelligenceService,
    QueryIntent,
    QueryPriority,
    QuerySetStatus,
    TopicQueryGenerator,
    calculate_query_similarity,
    classify_question_intent,
    deduplicate_candidate_queries,
    format_query_question,
    normalize_query_text,
)


@pytest.fixture
def db_session():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _create_sample_site_and_scan(db: Session, prefix: str = "QuerySite"):
    website = Website(
        name=f"{prefix} Company",
        url=f"https://{prefix.lower()}.example.com",
    )
    db.add(website)
    db.commit()
    db.refresh(website)

    scan = Scan(
        website_id=website.id,
        status="completed",
    )
    db.add(scan)
    db.commit()
    db.refresh(scan)

    page = PageResult(
        scan_id=scan.id,
        url=f"https://{prefix.lower()}.example.com/geo-optimization",
        status_code=200,
        content_type="text/html",
        content="""
        <html>
            <head><title>Generative Engine Optimization Guide - QuerySite</title></head>
            <body>
                <h1>Generative Engine Optimization Guide</h1>
                <h2>What is GEO in AI Search?</h2>
                <p>Generative Engine Optimization helps brands gain visibility in AI search answers.</p>
                <h2>How does AI citation readiness work?</h2>
                <p>Citation readiness requires structural data, clear claim support, and entity clarity.</p>
                <h2>Best solutions for AI search visibility</h2>
                <p>Compare tools like QuerySite with traditional SEO platforms.</p>
            </body>
        </html>
        """,
    )
    db.add(page)
    db.commit()
    db.refresh(page)

    extraction = PageExtraction(
        page_result_id=page.id,
        scan_id=scan.id,
        html_available=True,
        clean_text_available=True,
        word_count=250,
        title_present=True,
        title_text="Generative Engine Optimization Guide - QuerySite",
        extraction_status="success",
        extracted_at=datetime.now(timezone.utc),
    )
    db.add(extraction)
    db.commit()
    db.refresh(extraction)

    sd = PageStructuredData(
        page_extraction_id=extraction.id,
        block_position=0,
        raw_block='{"@type": "FAQPage"}',
        parsed_json={
            "@type": "FAQPage",
            "mainEntity": [
                {
                    "@type": "Question",
                    "name": "How to optimize content for AI engines?",
                    "acceptedAnswer": {
                        "@type": "Answer",
                        "text": "Structure information clearly and cite primary sources.",
                    },
                }
            ],
        },
    )
    db.add(sd)

    entity = Entity(
        website_id=website.id,
        scan_id=scan.id,
        page_id=page.id,
        name="QuerySite Platform",
        entity_type="product",
        confidence=0.95,
    )
    db.add(entity)

    db.commit()
    db.refresh(page)
    db.refresh(entity)

    return website, scan, page, entity


# ==========================================
# 1. Normalization & Deduplication Tests
# ==========================================


def test_normalize_query_text_exact_and_casing():
    assert normalize_query_text("What is Raval AI?") == "what is raval ai"
    assert normalize_query_text("what is raval ai?") == "what is raval ai"
    assert normalize_query_text("  WHAT   IS   RAVAL   AI  ? ") == "what is raval ai"


def test_normalize_query_text_contractions_and_conversational():
    assert normalize_query_text("What's Raval AI?") == "what is raval ai"
    assert normalize_query_text("Can you please tell me about GEO optimization?") == "geo optimization"
    assert normalize_query_text("Could you explain how does GEO work?") == "how does geo work"


def test_calculate_query_similarity():
    sim_exact = calculate_query_similarity("What is Raval AI?", "what is raval ai")
    assert sim_exact == 1.0

    sim_similar = calculate_query_similarity("What is Raval AI?", "What does Raval AI do?")
    assert sim_similar > 0.4

    sim_diff = calculate_query_similarity("What is technical SEO?", "Pricing for CRM platforms")
    assert sim_diff < 0.2


def test_deduplicate_candidate_queries():
    cands = [
        CandidateQuery(
            query_text="What is Generative Engine Optimization?",
            intent=QueryIntent.INFORMATIONAL,
            generation_source=QueryGenerationSource.TOPIC_INTELLIGENCE,
            topic="GEO",
            priority=QueryPriority.HIGH,
            confidence=0.9,
        ),
        CandidateQuery(
            query_text="what is generative engine optimization?",
            intent=QueryIntent.INFORMATIONAL,
            generation_source=QueryGenerationSource.TOPIC_INTELLIGENCE,
            topic="GEO",
            priority=QueryPriority.MEDIUM,
            confidence=0.8,
        ),
        CandidateQuery(
            query_text="What is Generative Engine Optimization ?",
            intent=QueryIntent.INFORMATIONAL,
            generation_source=QueryGenerationSource.TOPIC_INTELLIGENCE,
            topic="GEO",
            priority=QueryPriority.LOW,
            confidence=0.7,
        ),
        CandidateQuery(
            query_text="Best GEO platforms and software?",
            intent=QueryIntent.COMMERCIAL,
            generation_source=QueryGenerationSource.TOPIC_INTELLIGENCE,
            topic="GEO",
            priority=QueryPriority.HIGH,
            confidence=0.88,
        ),
    ]

    deduped = deduplicate_candidate_queries(cands)
    assert len(deduped) == 2  # 1 informational, 1 commercial
    # Check that highest priority / confidence candidate was retained
    info_cand = [c for c in deduped if c.intent == QueryIntent.INFORMATIONAL][0]
    assert info_cand.priority == QueryPriority.HIGH
    assert info_cand.confidence == 0.9
    assert len(info_cand.metadata.get("variants", [])) >= 2


# ==========================================
# 2. Intent Classification Tests
# ==========================================


def test_classify_question_intent_all_four_intents():
    # 1. Informational
    assert classify_question_intent("What is Generative Engine Optimization?") == QueryIntent.INFORMATIONAL
    assert classify_question_intent("How does vector search work?") == QueryIntent.INFORMATIONAL
    assert classify_question_intent("Overview of semantic retrieval") == QueryIntent.INFORMATIONAL

    # 2. Commercial
    assert classify_question_intent("What are the best GEO tools for enterprise?") == QueryIntent.COMMERCIAL
    assert classify_question_intent("Which platform should I choose for AI visibility?") == QueryIntent.COMMERCIAL
    assert classify_question_intent("Raval AI pricing and subscription cost") == QueryIntent.COMMERCIAL

    # 3. Comparison
    assert classify_question_intent("Raval AI vs CompetitorX") == QueryIntent.COMPARISON
    assert classify_question_intent("What is the difference between GEO and traditional SEO?") == QueryIntent.COMPARISON
    assert classify_question_intent("Which is better for AI search: A or B?") == QueryIntent.COMPARISON

    # 4. Problem-Solving
    assert classify_question_intent("How to fix missing citations in AI search?") == QueryIntent.PROBLEM_SOLVING
    assert classify_question_intent("Why is my site not cited by Perplexity?") == QueryIntent.PROBLEM_SOLVING
    assert classify_question_intent("How can I solve crawl errors for LLM bots?") == QueryIntent.PROBLEM_SOLVING


# ==========================================
# 3. Source Generator Unit Tests
# ==========================================


def test_topic_query_generator_bounded_variants():
    cands = TopicQueryGenerator.generate(
        topic="AI Visibility",
        topic_confidence=0.85,
        page_id=10,
        max_variants=3,
        in_title=True,
        in_h1=True,
    )
    assert len(cands) <= 9  # 3 info + 3 comm + 3 prob
    intents = {c.intent for c in cands}
    assert QueryIntent.INFORMATIONAL in intents
    assert QueryIntent.COMMERCIAL in intents
    assert QueryIntent.PROBLEM_SOLVING in intents

    # Check bounds and provenance
    for c in cands:
        assert c.generation_source == QueryGenerationSource.TOPIC_INTELLIGENCE
        assert c.topic == "AI Visibility"
        assert c.topic_id == "ai-visibility"
        assert c.page_id == 10
        assert 0.0 <= c.confidence <= 1.0
        assert c.priority in (QueryPriority.HIGH, QueryPriority.MEDIUM, QueryPriority.LOW)


def test_entity_query_generator():
    cands = EntityQueryGenerator.generate(
        entity_name="Raval Intelligence",
        entity_id=42,
        entity_type="organization",
        entity_confidence=0.9,
        page_id=10,
        topic="Search AI",
        max_variants=3,
        in_title=True,
    )
    assert len(cands) <= 9
    intents = {c.intent for c in cands}
    assert QueryIntent.INFORMATIONAL in intents
    assert QueryIntent.COMPARISON in intents
    assert QueryIntent.COMMERCIAL in intents

    for c in cands:
        assert c.generation_source == QueryGenerationSource.ENTITY_INTELLIGENCE
        assert c.entity_id == 42
        assert c.entity_name == "Raval Intelligence"
        assert c.page_id == 10
        assert 0.0 <= c.confidence <= 1.0


def test_question_intelligence_query_generator():
    cands = QuestionIntelligenceQueryGenerator.generate(
        question_text="How to improve AI citation rate?",
        source_type="faq_schema",
        has_answer=True,
        page_id=15,
        topic="AI Citations",
        max_variants=3,
    )
    assert len(cands) >= 1
    primary = cands[0]
    assert primary.intent == QueryIntent.PROBLEM_SOLVING
    assert primary.generation_source == QueryGenerationSource.QUESTION_INTELLIGENCE
    assert primary.confidence >= 0.9  # High for FAQ schema
    assert primary.priority == QueryPriority.HIGH
    assert primary.topic == "AI Citations"


def test_content_intelligence_query_generator():
    content_summary = {
        "primary_topic": "Technical SEO",
        "primary_intent": "informational",
        "findings": [
            {"type": "content_gap", "title": "Missing Schema Markup"},
            {"type": "unanswered_question", "title": "Crawl Budget Allocation"},
        ],
        "key_strengths": ["Clear Heading Structure"],
    }
    cands = ContentIntelligenceQueryGenerator.generate(content_summary, page_id=20, max_variants=2)
    assert len(cands) >= 2
    for c in cands:
        assert c.generation_source == QueryGenerationSource.CONTENT_INTELLIGENCE
        assert c.topic == "Technical SEO"
        assert c.page_id == 20


# ==========================================
# 4. Service End-to-End Generation & Persistence Tests
# ==========================================


def test_generate_and_persist_query_set_end_to_end(db_session: Session):
    website, scan, page, entity = _create_sample_site_and_scan(db_session, prefix="E2ESite")

    query_set = QueryIntelligenceService.generate_and_persist_query_set(
        db=db_session,
        website_id=website.id,
        scan_id=scan.id,
        name="Comprehensive Monitoring Set v1.0",
        description="Initial automated query set",
        version="1.0",
        max_variants_per_source=3,
        max_total_queries=100,
    )

    assert query_set.id is not None
    assert query_set.website_id == website.id
    assert query_set.scan_id == scan.id
    assert query_set.version == "1.0"
    assert query_set.status == QuerySetStatus.ACTIVE.value

    # Verify persistent queries
    queries = QueryIntelligenceService.get_query_set_queries(db_session, query_set.id)
    assert len(queries) > 0

    # Verify intent coverage
    intents = {q.intent for q in queries}
    assert QueryIntent.INFORMATIONAL.value in intents
    assert QueryIntent.COMMERCIAL.value in intents or QueryIntent.COMPARISON.value in intents

    # Verify provenance linkage
    has_topic_linkage = any(q.topic is not None for q in queries)
    has_entity_linkage = any(q.entity_id == entity.id for q in queries)
    has_page_linkage = any(q.page_id == page.id for q in queries)

    assert has_topic_linkage
    assert has_entity_linkage
    assert has_page_linkage

    # Verify unlinked remain None rather than fabricated
    fallback_unlinked = [q for q in queries if q.entity_id is None]
    assert len(fallback_unlinked) > 0  # Topic-only queries should not have fake entity IDs

    for q in queries:
        assert q.query_set_id == query_set.id
        assert q.website_id == website.id
        assert q.active is True
        assert 0.0 <= q.confidence <= 1.0
        assert q.priority in ("HIGH", "MEDIUM", "LOW")
        assert q.generation_source in (
            "TOPIC_INTELLIGENCE",
            "ENTITY_INTELLIGENCE",
            "QUESTION_INTELLIGENCE",
            "CONTENT_INTELLIGENCE",
        )


# ==========================================
# 5. Versioning & Active/Inactive State Tests
# ==========================================


def test_query_set_versioning_and_isolation(db_session: Session):
    website, scan, _, _ = _create_sample_site_and_scan(db_session, prefix="VersSite")

    # Version 1.0
    qs_v1 = QueryIntelligenceService.generate_and_persist_query_set(
        db=db_session,
        website_id=website.id,
        scan_id=scan.id,
        name="Monitoring Set v1",
        version="1.0",
    )

    # Version 2.0
    qs_v2 = QueryIntelligenceService.generate_and_persist_query_set(
        db=db_session,
        website_id=website.id,
        scan_id=scan.id,
        name="Monitoring Set v2",
        version="2.0",
    )

    assert qs_v1.id != qs_v2.id
    assert qs_v1.version == "1.0"
    assert qs_v2.version == "2.0"

    v1_queries = QueryIntelligenceService.get_query_set_queries(db_session, qs_v1.id)
    v2_queries = QueryIntelligenceService.get_query_set_queries(db_session, qs_v2.id)

    assert len(v1_queries) > 0
    assert len(v2_queries) > 0
    # Both sets remain intact and independent
    for q in v1_queries:
        assert q.query_set_id == qs_v1.id
    for q in v2_queries:
        assert q.query_set_id == qs_v2.id


def test_query_active_state_toggle_and_retention(db_session: Session):
    website, scan, _, _ = _create_sample_site_and_scan(db_session, prefix="ToggleSite")

    qs = QueryIntelligenceService.generate_and_persist_query_set(
        db=db_session,
        website_id=website.id,
        scan_id=scan.id,
    )
    queries = QueryIntelligenceService.get_query_set_queries(db_session, qs.id)
    target_q = queries[0]

    # Deactivate
    updated = QueryIntelligenceService.update_query_status(db_session, target_q.id, active=False)
    assert updated is not None
    assert updated.active is False

    # Check that inactive query is still persisted in DB
    all_queries = QueryIntelligenceService.get_query_set_queries(db_session, qs.id, active_only=False)
    assert any(q.id == target_q.id and not q.active for q in all_queries)

    # Check filtering by active_only
    active_queries = QueryIntelligenceService.get_query_set_queries(db_session, qs.id, active_only=True)
    assert all(q.id != target_q.id for q in active_queries)
    assert len(active_queries) == len(all_queries) - 1

    # Reactivate
    reactivated = QueryIntelligenceService.update_query_status(db_session, target_q.id, active=True)
    assert reactivated.active is True


def test_multi_source_combination_and_deduplication(db_session: Session):
    website, scan, page, entity = _create_sample_site_and_scan(db_session, prefix="MultiSource")

    # Collect and generate with all sources enabled
    intel = QueryIntelligenceService.collect_intelligence_for_page(db_session, page)
    cands = QueryIntelligenceService.generate_candidate_queries(
        intelligence_data=intel,
        max_variants_per_source=3,
        include_topics=True,
        include_entities=True,
        include_questions=True,
        include_content=True,
    )

    sources = {c.generation_source for c in cands}
    assert QueryGenerationSource.TOPIC_INTELLIGENCE in sources
    assert QueryGenerationSource.ENTITY_INTELLIGENCE in sources
    assert QueryGenerationSource.QUESTION_INTELLIGENCE in sources

    deduped = deduplicate_candidate_queries(cands, similarity_threshold=0.85)
    # Ensure no exact duplicate query strings exist
    seen_normalized = set()
    for d in deduped:
        norm = normalize_query_text(d.query_text)
        assert norm not in seen_normalized, f"Duplicate query detected: {d.query_text}"
        seen_normalized.add(norm)


def test_site_isolation_query_sets(db_session: Session):
    site_a, scan_a, _, _ = _create_sample_site_and_scan(db_session, prefix="SiteA")
    site_b, scan_b, _, _ = _create_sample_site_and_scan(db_session, prefix="SiteB")

    qs_a = QueryIntelligenceService.generate_and_persist_query_set(db=db_session, website_id=site_a.id, scan_id=scan_a.id)
    qs_b = QueryIntelligenceService.generate_and_persist_query_set(db=db_session, website_id=site_b.id, scan_id=scan_b.id)

    sets_a = QueryIntelligenceService.list_query_sets(db=db_session, website_id=site_a.id)
    sets_b = QueryIntelligenceService.list_query_sets(db=db_session, website_id=site_b.id)

    assert all(s.website_id == site_a.id for s in sets_a)
    assert all(s.website_id == site_b.id for s in sets_b)
    assert not any(s.id == qs_b.id for s in sets_a)
    assert not any(s.id == qs_a.id for s in sets_b)

