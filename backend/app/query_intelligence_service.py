"""
Query Intelligence & Reusable Query Set Engine (Task 10 - Step 1)

Generates deterministic, explainable, and reusable monitoring queries from:
- Topic Intelligence
- Entity Intelligence
- Question Intelligence
- Content Intelligence

Features:
- 4 Required Intents: INFORMATIONAL, COMMERCIAL, COMPARISON, PROBLEM_SOLVING
- 4 Generation Sources: TOPIC_INTELLIGENCE, ENTITY_INTELLIGENCE, QUESTION_INTELLIGENCE, CONTENT_INTELLIGENCE
- Bounded Wording Variants (configurable MAX_VARIANTS_PER_SOURCE)
- Multi-level Deterministic Deduplication (Exact Normalization & Semantic Similarity)
- Full Provenance & Linkage (Topic, Entity, Page)
- Deterministic Priority (HIGH, MEDIUM, LOW)
- Deterministic Generation Confidence (0.0 to 1.0)
- Persistent Versioning & Active/Inactive Lifecycle
"""

from collections import Counter
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from enum import Enum
import re
from typing import Any
from sqlalchemy import desc
from sqlalchemy.orm import Session

from .content_intelligence_analyzer import analyze_content_intelligence
from .entity_analyzer import analyze_entities
from .intent_analyzer import analyze_intent
from .models import (
    Entity,
    Finding,
    PageExtraction,
    PageResult,
    Query,
    QuerySet,
    Scan,
    Website,
)
from .question_analyzer import analyze_questions, is_question_text
from .schemas import (
    QueryCreate,
    QueryResponse,
    QuerySetCreate,
    QuerySetDetailResponse,
    QuerySetGenerateRequest,
    QuerySetResponse,
    QuerySetUpdate,
    QueryUpdate,
)
from .services import _get_page_text_and_headings
from .topic_analyzer import STOP_WORDS, analyze_topic_semantics, tokenize


# ==========================================
# Constants & Enums
# ==========================================


class QueryIntent(str, Enum):
    INFORMATIONAL = "INFORMATIONAL"
    COMMERCIAL = "COMMERCIAL"
    COMPARISON = "COMPARISON"
    PROBLEM_SOLVING = "PROBLEM_SOLVING"


class QueryGenerationSource(str, Enum):
    TOPIC_INTELLIGENCE = "TOPIC_INTELLIGENCE"
    ENTITY_INTELLIGENCE = "ENTITY_INTELLIGENCE"
    QUESTION_INTELLIGENCE = "QUESTION_INTELLIGENCE"
    CONTENT_INTELLIGENCE = "CONTENT_INTELLIGENCE"


class QueryPriority(str, Enum):
    HIGH = "HIGH"
    MEDIUM = "MEDIUM"
    LOW = "LOW"


class QuerySetStatus(str, Enum):
    ACTIVE = "active"
    ARCHIVED = "archived"
    DRAFT = "draft"


DEFAULT_MAX_VARIANTS_PER_SOURCE = 3
DEFAULT_MAX_TOTAL_QUERIES = 250
DEFAULT_SIMILARITY_THRESHOLD = 0.85

# Contraction normalization mapping for deterministic Level 1 normalization
CONTRACTIONS_MAP = {
    "what's": "what is",
    "how's": "how is",
    "who's": "who is",
    "where's": "where is",
    "when's": "when is",
    "why's": "why is",
    "it's": "it is",
    "that's": "that is",
    "there's": "there is",
    "can't": "cannot",
    "won't": "will not",
    "don't": "do not",
    "doesn't": "does not",
    "didn't": "did not",
    "isn't": "is not",
    "aren't": "are not",
    "wasn't": "was not",
    "weren't": "were not",
    "hasn't": "has not",
    "haven't": "have not",
    "hadn't": "had not",
    "shouldn't": "should not",
    "couldn't": "could not",
    "wouldn't": "would not",
}

# Conversational filler prefixes to strip during canonical normalization
CONVERSATIONAL_PREFIXES = [
    r"^(?:please\s+)?can\s+you\s+(?:please\s+)?tell\s+me\s+about\s+",
    r"^(?:please\s+)?can\s+you\s+(?:please\s+)?tell\s+me\s+",
    r"^(?:please\s+)?can\s+you\s+(?:please\s+)?explain\s+(?:to\s+me\s+)?(?:about\s+)?",
    r"^(?:please\s+)?tell\s+me\s+about\s+",
    r"^(?:please\s+)?tell\s+me\s+",
    r"^i\s+(?:would\s+like|want)\s+to\s+know\s+(?:about\s+)?",
    r"^(?:could|can)\s+you\s+(?:please\s+)?explain\s+(?:about\s+)?",
    r"^explain\s+to\s+me\s+(?:about\s+)?",
]


# ==========================================
# Candidate Query Data Structure
# ==========================================


@dataclass
class CandidateQuery:
    query_text: str
    intent: QueryIntent
    generation_source: QueryGenerationSource
    topic: str | None = None
    topic_id: str | None = None
    entity_id: int | None = None
    entity_name: str | None = None
    page_id: int | None = None
    priority: QueryPriority = QueryPriority.MEDIUM
    confidence: float = 0.8
    metadata: dict[str, Any] = field(default_factory=dict)
    raw_variants: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d["intent"] = self.intent.value if isinstance(self.intent, QueryIntent) else str(self.intent)
        d["generation_source"] = (
            self.generation_source.value
            if isinstance(self.generation_source, QueryGenerationSource)
            else str(self.generation_source)
        )
        d["priority"] = self.priority.value if isinstance(self.priority, QueryPriority) else str(self.priority)
        return d


# ==========================================
# Normalization & Deduplication Functions
# ==========================================


def normalize_query_text(text: str | None) -> str:
    """
    Level 1 Exact Normalization:
    - Strips whitespace
    - Lowercases text
    - Replaces contractions with full forms
    - Removes conversational filler prefixes
    - Removes punctuation and standardizes spacing
    """
    if not text:
        return ""

    cleaned = text.strip().lower()

    # Expand contractions
    for cont, expanded in CONTRACTIONS_MAP.items():
        cleaned = re.sub(rf"\b{re.escape(cont)}\b", expanded, cleaned)

    # Remove conversational filler prefixes
    for prefix in CONVERSATIONAL_PREFIXES:
        cleaned = re.sub(prefix, "", cleaned, flags=re.IGNORECASE)

    # Remove non-alphanumeric except spaces
    cleaned = re.sub(r"[^\w\s]", " ", cleaned)
    # Collapse multiple spaces
    cleaned = re.sub(r"\s+", " ", cleaned).strip()

    return cleaned


def get_canonical_tokens(text: str) -> list[str]:
    """Extract filtered, sorted alphanumeric tokens excluding stop words."""
    norm = normalize_query_text(text)
    tokens = [t for t in norm.split() if t not in STOP_WORDS and len(t) > 1]
    return sorted(list(set(tokens)))


def calculate_query_similarity(q1: str, q2: str) -> float:
    """
    Deterministic semantic similarity between two query strings based on:
    1. Exact normalized match = 1.0
    2. Token-set Jaccard overlap
    3. Sequence token overlap
    """
    norm1 = normalize_query_text(q1)
    norm2 = normalize_query_text(q2)

    if not norm1 or not norm2:
        return 0.0

    if norm1 == norm2:
        return 1.0

    tokens1 = set(get_canonical_tokens(q1))
    tokens2 = set(get_canonical_tokens(q2))

    if not tokens1 or not tokens2:
        # Fall back to word tokens if all were stop words
        tokens1 = set(norm1.split())
        tokens2 = set(norm2.split())

    intersection = tokens1.intersection(tokens2)
    union = tokens1.union(tokens2)

    if not union:
        return 0.0

    jaccard = len(intersection) / len(union)

    # If the smaller set of tokens is a complete subset of the larger set
    # and sizes are close, treat as high similarity
    smaller_len = min(len(tokens1), len(tokens2))
    larger_len = max(len(tokens1), len(tokens2))
    subset_ratio = len(intersection) / smaller_len if smaller_len > 0 else 0.0

    if subset_ratio >= 0.9 and (larger_len - smaller_len) <= 1:
        return max(jaccard, 0.9)

    return jaccard


def deduplicate_candidate_queries(
    candidates: list[CandidateQuery],
    similarity_threshold: float = DEFAULT_SIMILARITY_THRESHOLD,
    max_total_queries: int = DEFAULT_MAX_TOTAL_QUERIES,
) -> list[CandidateQuery]:
    """
    Deterministic multi-level deduplication:
    1. Exact normalized signature deduplication
    2. Semantic token set similarity clustering
    Keeps the candidate with the highest (priority_weight, confidence) and collects
    deduplicated alternate phrasings into metadata['variants'].
    """
    if not candidates:
        return []

    priority_weights = {
        QueryPriority.HIGH: 3,
        QueryPriority.MEDIUM: 2,
        QueryPriority.LOW: 1,
    }

    # Helper score for ranking candidates within the same cluster
    def candidate_score(c: CandidateQuery) -> tuple[int, float, int]:
        p_weight = priority_weights.get(c.priority, 1)
        # Prefer questions that end with '?' and have good length
        has_qmark = 1 if c.query_text.strip().endswith("?") else 0
        return (p_weight, c.confidence, has_qmark)

    unique_candidates: list[CandidateQuery] = []

    for cand in candidates:
        cand_norm = normalize_query_text(cand.query_text)
        if not cand_norm or len(cand_norm) < 3:
            continue

        # Check against already accepted candidates
        matched_idx = -1
        highest_sim = 0.0

        for idx, existing in enumerate(unique_candidates):
            # If same intent, check similarity
            if existing.intent == cand.intent:
                sim = calculate_query_similarity(existing.query_text, cand.query_text)
                if sim >= similarity_threshold and sim > highest_sim:
                    highest_sim = sim
                    matched_idx = idx

        if matched_idx >= 0:
            existing = unique_candidates[matched_idx]
            # Record variant in existing metadata
            existing_variants = existing.metadata.setdefault("variants", [])
            if cand.query_text not in existing_variants and cand.query_text != existing.query_text:
                existing_variants.append(cand.query_text)

            # If current candidate has higher score, replace primary query text with it
            if candidate_score(cand) > candidate_score(existing):
                old_text = existing.query_text
                if old_text not in existing_variants:
                    existing_variants.append(old_text)
                existing.query_text = cand.query_text
                existing.priority = cand.priority
                existing.confidence = cand.confidence
                # Merge linkages if existing was missing them
                if not existing.topic and cand.topic:
                    existing.topic = cand.topic
                    existing.topic_id = cand.topic_id
                if not existing.entity_id and cand.entity_id:
                    existing.entity_id = cand.entity_id
                    existing.entity_name = cand.entity_name
                if not existing.page_id and cand.page_id:
                    existing.page_id = cand.page_id
        else:
            cand.metadata.setdefault("variants", []).extend(cand.raw_variants)
            unique_candidates.append(cand)

        if len(unique_candidates) >= max_total_queries:
            break

    return unique_candidates


# ==========================================
# Query Intent Classifier & Helpers
# ==========================================


def classify_question_intent(text: str) -> QueryIntent:
    """
    Deterministically categorizes an arbitrary search question or phrase
    into one of the 4 required intent categories.
    """
    lower = text.lower().strip()

    # 1. Comparison Intent
    comparison_markers = [
        " vs ", " versus ", "difference between", "differ from",
        "compared to", "comparing", "which is better", "alternatives to",
        "better than", "or should i choose", "pros and cons",
    ]
    if any(m in lower for m in comparison_markers):
        return QueryIntent.COMPARISON

    # 2. Problem-Solving Intent
    problem_markers = [
        "how to fix", "how can i solve", "how do i fix", "how to resolve",
        "how to improve", "how to optimize", "how to prevent", "how to avoid",
        "why is my", "why is", "troubleshoot", "fix error", "issue with",
        "problem with", "not working", "fails to", "debug", "what causes",
    ]
    if any(m in lower for m in problem_markers):
        return QueryIntent.PROBLEM_SOLVING

    # 3. Commercial Intent
    commercial_markers = [
        "best", "top", "pricing", "price", "cost", "how much", "review",
        "reviews", "buyer's guide", "worth it", "buy", "purchase",
        "cheap", "affordable", "top rated", "recommended", "tool options",
        "services", "software options", "platform options", "solutions",
        "should i choose", "which option", "which platform", "which tool",
        "which software", "which solution", "which provider", "hire",
    ]
    if any(m in lower for m in commercial_markers):
        return QueryIntent.COMMERCIAL

    # 4. Informational (Default)
    return QueryIntent.INFORMATIONAL


def format_query_question(text: str) -> str:
    """Ensure natural query capitalization and trailing question mark if interrogative."""
    stripped = text.strip()
    if not stripped:
        return ""
    # Capitalize first letter
    formatted = stripped[0].upper() + stripped[1:]
    # Add question mark if it starts with an interrogative word and lacks terminal punctuation
    first_word = formatted.split()[0].lower() if formatted.split() else ""
    interrogative_words = {
        "what", "how", "why", "when", "where", "who", "which",
        "is", "are", "does", "do", "can", "should", "will", "could", "would"
    }
    if first_word in interrogative_words and not formatted.endswith(("?", ".", "!")):
        formatted += "?"
    return formatted


# ==========================================
# Query Generation Engines
# ==========================================


class TopicQueryGenerator:
    """
    Generates bounded query candidates from topic analysis evidence.
    Covers Informational, Commercial, Problem-Solving, and Comparison intents.
    """

    @staticmethod
    def generate(
        topic: str,
        topic_confidence: float = 0.8,
        page_id: int | None = None,
        max_variants: int = DEFAULT_MAX_VARIANTS_PER_SOURCE,
        in_title: bool = False,
        in_h1: bool = False,
    ) -> list[CandidateQuery]:
        if not topic or len(topic.strip()) < 2:
            return []

        clean_topic = topic.strip()
        topic_slug = re.sub(r"[^\w\s-]", "", clean_topic).strip().lower().replace(" ", "-")

        # Base confidence calculation
        grounding_boost = 0.1 if (in_title or in_h1) else 0.0
        confidence = round(min(1.0, max(0.4, topic_confidence + grounding_boost)), 2)

        # Base priority
        priority = QueryPriority.HIGH if (in_title and in_h1 and confidence >= 0.7) else (
            QueryPriority.MEDIUM if confidence >= 0.5 else QueryPriority.LOW
        )

        candidates: list[CandidateQuery] = []

        # 1. Informational Queries
        info_templates = [
            f"What is {clean_topic}?",
            f"How does {clean_topic} work?",
            f"What are the key benefits of {clean_topic}?",
        ][:max_variants]

        for idx, t_text in enumerate(info_templates):
            candidates.append(
                CandidateQuery(
                    query_text=t_text,
                    intent=QueryIntent.INFORMATIONAL,
                    generation_source=QueryGenerationSource.TOPIC_INTELLIGENCE,
                    topic=clean_topic,
                    topic_id=topic_slug,
                    page_id=page_id,
                    priority=priority,
                    confidence=confidence,
                    metadata={
                        "source_type": "primary_topic" if idx == 0 else "supporting_topic_variant",
                        "template_index": idx,
                        "in_title": in_title,
                        "in_h1": in_h1,
                    },
                    raw_variants=[t_text],
                )
            )

        # 2. Commercial Queries
        commercial_templates = [
            f"What are the best {clean_topic} solutions?",
            f"Which {clean_topic} option should I choose?",
            f"Top recommended tools and services for {clean_topic}",
        ][:max_variants]

        for idx, t_text in enumerate(commercial_templates):
            candidates.append(
                CandidateQuery(
                    query_text=t_text,
                    intent=QueryIntent.COMMERCIAL,
                    generation_source=QueryGenerationSource.TOPIC_INTELLIGENCE,
                    topic=clean_topic,
                    topic_id=topic_slug,
                    page_id=page_id,
                    priority=priority,
                    confidence=round(confidence * 0.95, 2),
                    metadata={
                        "source_type": "commercial_topic_variant",
                        "template_index": idx,
                    },
                    raw_variants=[t_text],
                )
            )

        # 3. Problem-Solving Queries
        problem_templates = [
            f"How to solve common {clean_topic} challenges?",
            f"What is the best way to optimize {clean_topic}?",
            f"Why do issues occur with {clean_topic} and how to fix them?",
        ][:max_variants]

        for idx, t_text in enumerate(problem_templates):
            candidates.append(
                CandidateQuery(
                    query_text=t_text,
                    intent=QueryIntent.PROBLEM_SOLVING,
                    generation_source=QueryGenerationSource.TOPIC_INTELLIGENCE,
                    topic=clean_topic,
                    topic_id=topic_slug,
                    page_id=page_id,
                    priority=priority,
                    confidence=round(confidence * 0.9, 2),
                    metadata={
                        "source_type": "problem_solving_topic_variant",
                        "template_index": idx,
                    },
                    raw_variants=[t_text],
                )
            )

        return candidates


class EntityQueryGenerator:
    """
    Generates bounded query candidates from entity intelligence.
    Covers Informational, Commercial, Comparison, and Problem-Solving intents.
    """

    @staticmethod
    def generate(
        entity_name: str,
        entity_id: int | None = None,
        entity_type: str = "organization",
        entity_confidence: float = 1.0,
        page_id: int | None = None,
        topic: str | None = None,
        max_variants: int = DEFAULT_MAX_VARIANTS_PER_SOURCE,
        in_title: bool = False,
        in_h1: bool = False,
    ) -> list[CandidateQuery]:
        if not entity_name or len(entity_name.strip()) < 2:
            return []

        clean_name = entity_name.strip()
        etype = (entity_type or "organization").lower()

        confidence = round(min(1.0, max(0.5, entity_confidence)), 2)
        priority = QueryPriority.HIGH if (etype in ("organization", "brand", "product") and in_title) else QueryPriority.MEDIUM

        candidates: list[CandidateQuery] = []

        # 1. Informational Query
        info_templates = [
            f"What is {clean_name}?",
            f"How does {clean_name} work?",
            f"What are the main features of {clean_name}?",
        ][:max_variants]

        for idx, t_text in enumerate(info_templates):
            candidates.append(
                CandidateQuery(
                    query_text=t_text,
                    intent=QueryIntent.INFORMATIONAL,
                    generation_source=QueryGenerationSource.ENTITY_INTELLIGENCE,
                    entity_id=entity_id,
                    entity_name=clean_name,
                    topic=topic,
                    page_id=page_id,
                    priority=priority,
                    confidence=confidence,
                    metadata={
                        "entity_type": etype,
                        "template_index": idx,
                        "source_type": "entity_overview",
                    },
                    raw_variants=[t_text],
                )
            )

        # 2. Comparison Queries (Brand vs Competitors)
        comparison_templates = [
            f"{clean_name} vs top alternatives",
            f"What is the difference between {clean_name} and competing solutions?",
            f"Which is better for {topic or 'business'}: {clean_name} or competitors?",
        ][:max_variants]

        for idx, t_text in enumerate(comparison_templates):
            candidates.append(
                CandidateQuery(
                    query_text=t_text,
                    intent=QueryIntent.COMPARISON,
                    generation_source=QueryGenerationSource.ENTITY_INTELLIGENCE,
                    entity_id=entity_id,
                    entity_name=clean_name,
                    topic=topic,
                    page_id=page_id,
                    priority=QueryPriority.HIGH if etype in ("brand", "organization", "product") else QueryPriority.MEDIUM,
                    confidence=round(confidence * 0.95, 2),
                    metadata={
                        "entity_type": etype,
                        "template_index": idx,
                        "source_type": "entity_comparison",
                    },
                    raw_variants=[t_text],
                )
            )

        # 3. Commercial Queries
        commercial_templates = [
            f"Is {clean_name} the best option for {topic or 'search intelligence'}?",
            f"What are the pricing and reviews for {clean_name}?",
            f"Should I choose {clean_name} for my workflow?",
        ][:max_variants]

        for idx, t_text in enumerate(commercial_templates):
            candidates.append(
                CandidateQuery(
                    query_text=t_text,
                    intent=QueryIntent.COMMERCIAL,
                    generation_source=QueryGenerationSource.ENTITY_INTELLIGENCE,
                    entity_id=entity_id,
                    entity_name=clean_name,
                    topic=topic,
                    page_id=page_id,
                    priority=priority,
                    confidence=round(confidence * 0.9, 2),
                    metadata={
                        "entity_type": etype,
                        "template_index": idx,
                        "source_type": "entity_commercial",
                    },
                    raw_variants=[t_text],
                )
            )

        return candidates


class QuestionIntelligenceQueryGenerator:
    """
    Generates bounded query candidates from detected questions and FAQ schema.
    Classifies intent and creates natural wording variants.
    """

    @staticmethod
    def generate(
        question_text: str,
        source_type: str = "heading",
        has_answer: bool = True,
        page_id: int | None = None,
        topic: str | None = None,
        entity_id: int | None = None,
        entity_name: str | None = None,
        max_variants: int = DEFAULT_MAX_VARIANTS_PER_SOURCE,
    ) -> list[CandidateQuery]:
        if not is_question_text(question_text):
            return []

        formatted_q = format_query_question(question_text)
        if not formatted_q:
            return []

        intent = classify_question_intent(formatted_q)

        # Priority calculation
        priority = QueryPriority.HIGH if (source_type in ("faq_schema", "h1") or has_answer) else QueryPriority.MEDIUM
        confidence = 0.95 if source_type == "faq_schema" else (0.85 if has_answer else 0.75)

        candidates: list[CandidateQuery] = []

        # Primary question candidate
        primary_cand = CandidateQuery(
            query_text=formatted_q,
            intent=intent,
            generation_source=QueryGenerationSource.QUESTION_INTELLIGENCE,
            topic=topic,
            entity_id=entity_id,
            entity_name=entity_name,
            page_id=page_id,
            priority=priority,
            confidence=confidence,
            metadata={
                "source_type": source_type,
                "has_answer": has_answer,
                "original_question": question_text,
            },
            raw_variants=[formatted_q],
        )
        candidates.append(primary_cand)

        # Generate natural wording variants (up to max_variants - 1)
        if max_variants > 1:
            variants = QuestionIntelligenceQueryGenerator._generate_wording_variants(formatted_q, intent)
            for v_text in variants[: max_variants - 1]:
                candidates.append(
                    CandidateQuery(
                        query_text=v_text,
                        intent=intent,
                        generation_source=QueryGenerationSource.QUESTION_INTELLIGENCE,
                        topic=topic,
                        entity_id=entity_id,
                        entity_name=entity_name,
                        page_id=page_id,
                        priority=priority,
                        confidence=round(confidence * 0.95, 2),
                        metadata={
                            "source_type": f"{source_type}_variant",
                            "has_answer": has_answer,
                            "parent_question": formatted_q,
                        },
                        raw_variants=[v_text],
                    )
                )

        return candidates

    @staticmethod
    def _generate_wording_variants(question: str, intent: QueryIntent) -> list[str]:
        """Produce deterministic natural reformulations of a question."""
        q = question.strip().rstrip("?.!")
        lower = q.lower()

        variants: list[str] = []

        if lower.startswith("what is"):
            core = q[7:].strip()
            variants.append(f"Can you explain what {core} is?")
            variants.append(f"How does {core} work?")
        elif lower.startswith("how does") or lower.startswith("how do"):
            core = re.sub(r"^how\s+(?:does|do)\s+", "", q, flags=re.IGNORECASE).strip()
            variants.append(f"What is the process for {core}?")
            variants.append(f"Explain how {core}?")
        elif lower.startswith("why is") or lower.startswith("why does"):
            core = re.sub(r"^why\s+(?:is|does)\s+", "", q, flags=re.IGNORECASE).strip()
            variants.append(f"What causes {core}?")
            variants.append(f"Reason behind {core}?")
        elif " vs " in lower or "versus" in lower:
            variants.append(f"What is the difference between {q}?")
            variants.append(f"Compare {q}?")
        else:
            if intent == QueryIntent.COMMERCIAL:
                variants.append(f"Which is recommended: {q}?")
            elif intent == QueryIntent.PROBLEM_SOLVING:
                variants.append(f"How to fix {q}?")
            else:
                variants.append(f"Overview of {q}?")

        return [format_query_question(v) for v in variants if v]


class ContentIntelligenceQueryGenerator:
    """
    Generates bounded query candidates from content gaps, quality findings,
    and page structure.
    """

    @staticmethod
    def generate(
        content_summary: dict[str, Any],
        page_id: int | None = None,
        max_variants: int = DEFAULT_MAX_VARIANTS_PER_SOURCE,
    ) -> list[CandidateQuery]:
        candidates: list[CandidateQuery] = []
        if not content_summary:
            return candidates

        primary_topic = content_summary.get("primary_topic")
        primary_intent_str = content_summary.get("primary_intent", "informational").lower()

        # Map to QueryIntent
        intent_mapping = {
            "informational": QueryIntent.INFORMATIONAL,
            "commercial_investigation": QueryIntent.COMMERCIAL,
            "commercial": QueryIntent.COMMERCIAL,
            "transactional": QueryIntent.COMMERCIAL,
            "navigational": QueryIntent.INFORMATIONAL,
        }
        mapped_intent = intent_mapping.get(primary_intent_str, QueryIntent.INFORMATIONAL)

        # 1. Content Gaps to Problem-Solving queries
        findings = content_summary.get("findings", [])
        for f in findings:
            f_type = f.get("type", "")
            f_title = f.get("title", "")
            if "gap" in f_type.lower() or "missing" in f_type.lower() or "unanswered" in f_type.lower():
                if primary_topic:
                    gap_query = f"How to address missing {f_title.lower()} in {primary_topic}?"
                    candidates.append(
                        CandidateQuery(
                            query_text=format_query_question(gap_query),
                            intent=QueryIntent.PROBLEM_SOLVING,
                            generation_source=QueryGenerationSource.CONTENT_INTELLIGENCE,
                            topic=primary_topic,
                            page_id=page_id,
                            priority=QueryPriority.MEDIUM,
                            confidence=0.8,
                            metadata={"finding_type": f_type, "source_type": "content_gap"},
                            raw_variants=[gap_query],
                        )
                    )

        # 2. High-value key strengths
        strengths = content_summary.get("key_strengths", [])
        for s in strengths[:max_variants]:
            if primary_topic:
                q_text = f"Why is {primary_topic} considered effective for {s.lower()}?"
                candidates.append(
                    CandidateQuery(
                        query_text=format_query_question(q_text),
                        intent=mapped_intent,
                        generation_source=QueryGenerationSource.CONTENT_INTELLIGENCE,
                        topic=primary_topic,
                        page_id=page_id,
                        priority=QueryPriority.LOW,
                        confidence=0.7,
                        metadata={"strength": s, "source_type": "content_strength"},
                        raw_variants=[q_text],
                    )
                )

        return candidates


# ==========================================
# Query Intelligence Core Service
# ==========================================


class QueryIntelligenceService:
    """
    Centralized service coordinating query generation, normalization,
    deduplication, linkage, and persistence.
    """

    @classmethod
    def collect_intelligence_for_page(
        cls,
        db: Session,
        page: PageResult,
    ) -> dict[str, Any]:
        """Extracts structured intelligence (topics, entities, questions, content) for a single page."""
        text_content, title, headings = _get_page_text_and_headings(page)

        structured_data_blocks: list[Any] = []
        microdata_items: list[Any] = []
        links: list[Any] = []

        if page.extraction:
            if page.extraction.structured_data:
                for sd in page.extraction.structured_data:
                    if isinstance(sd, dict):
                        structured_data_blocks.append(sd)
                    elif hasattr(sd, "parsed_json") and sd.parsed_json:
                        structured_data_blocks.append(sd.parsed_json)
            if page.extraction.microdata:
                for m in page.extraction.microdata:
                    if isinstance(m, dict):
                        microdata_items.append(m)
                    elif hasattr(m, "parsed_json") and m.parsed_json:
                        microdata_items.append(m.parsed_json)
            if page.extraction.links:
                links = page.extraction.links


        # 1. Topic Intelligence
        topic_res = analyze_topic_semantics(
            text_content=text_content,
            title=title,
            headings=headings,
        )

        # 2. Entity Intelligence
        entity_res = analyze_entities(
            structured_data_blocks=structured_data_blocks,
            microdata_items=microdata_items,
            text_content=text_content,
            title=title,
            headings=headings,
        )

        # 3. Question Intelligence
        question_res = analyze_questions(
            text_content=text_content,
            headings=headings,
            structured_data_blocks=structured_data_blocks,
        )

        # 4. Content Intelligence Summary
        content_res = analyze_content_intelligence(
            text_content=text_content,
            raw_html=page.content,
            title=title,
            headings=headings,
            structured_data_blocks=structured_data_blocks,
            microdata_items=microdata_items,
            links=links,
            page_id=page.id,
            url=page.url,
        )

        # Also fetch existing persistent Entity records for this website
        db_entities = db.query(Entity).filter(Entity.website_id == page.scan.website_id if page.scan else True).all()

        return {
            "page_id": page.id,
            "url": page.url,
            "title": title,
            "headings": headings,
            "topic_analysis": topic_res,
            "entity_analysis": entity_res,
            "question_analysis": question_res,
            "content_intelligence": content_res,
            "db_entities": db_entities,
        }

    @classmethod
    def generate_candidate_queries(
        cls,
        intelligence_data: dict[str, Any],
        max_variants_per_source: int = DEFAULT_MAX_VARIANTS_PER_SOURCE,
        include_topics: bool = True,
        include_entities: bool = True,
        include_questions: bool = True,
        include_content: bool = True,
        target_intents: list[str] | None = None,
    ) -> list[CandidateQuery]:
        """Generates all raw candidate queries from collected intelligence."""
        candidates: list[CandidateQuery] = []
        page_id = intelligence_data.get("page_id")
        title = intelligence_data.get("title")

        # 1. Topics
        if include_topics and "topic_analysis" in intelligence_data:
            topic_res = intelligence_data["topic_analysis"]
            if topic_res.primary_topic:
                t_cands = TopicQueryGenerator.generate(
                    topic=topic_res.primary_topic,
                    topic_confidence=topic_res.primary_topic_confidence,
                    page_id=page_id,
                    max_variants=max_variants_per_source,
                    in_title=topic_res.primary_topic_in_title,
                    in_h1=topic_res.primary_topic_in_h1,
                )
                candidates.extend(t_cands)

            for st in topic_res.supporting_topics[:2]:
                st_cands = TopicQueryGenerator.generate(
                    topic=st,
                    topic_confidence=max(0.4, topic_res.primary_topic_confidence * 0.7),
                    page_id=page_id,
                    max_variants=max(1, max_variants_per_source - 1),
                )
                candidates.extend(st_cands)

        # 2. Entities
        if include_entities:
            # From Entity Analysis Evidence
            if "entity_analysis" in intelligence_data:
                entity_res = intelligence_data["entity_analysis"]
                for ent in entity_res.entities[:4]:
                    e_name = ent.get("name") if isinstance(ent, dict) else getattr(ent, "name", None)
                    e_type = ent.get("entity_type", "organization") if isinstance(ent, dict) else getattr(ent, "entity_type", "organization")
                    e_conf = ent.get("confidence", 1.0) if isinstance(ent, dict) else getattr(ent, "confidence", 1.0)
                    e_in_title = ent.get("in_title", False) if isinstance(ent, dict) else getattr(ent, "in_title", False)
                    e_in_h1 = ent.get("in_h1", False) if isinstance(ent, dict) else getattr(ent, "in_h1", False)

                    if e_name:
                        # Find matching DB entity if available
                        matched_db_id = None
                        for dbe in intelligence_data.get("db_entities", []):
                            if dbe.name.strip().lower() == e_name.strip().lower():
                                matched_db_id = dbe.id
                                break

                        e_cands = EntityQueryGenerator.generate(
                            entity_name=e_name,
                            entity_id=matched_db_id,
                            entity_type=e_type,
                            entity_confidence=e_conf,
                            page_id=page_id,
                            topic=intelligence_data.get("topic_analysis", {}).primary_topic
                            if hasattr(intelligence_data.get("topic_analysis", {}), "primary_topic")
                            else None,
                            max_variants=max_variants_per_source,
                            in_title=e_in_title,
                            in_h1=e_in_h1,
                        )
                        candidates.extend(e_cands)

            # Also from DB entities if not covered
            for dbe in intelligence_data.get("db_entities", [])[:3]:
                if not any(c.entity_name and c.entity_name.lower() == dbe.name.lower() for c in candidates):
                    e_cands = EntityQueryGenerator.generate(
                        entity_name=dbe.name,
                        entity_id=dbe.id,
                        entity_type=dbe.entity_type,
                        entity_confidence=dbe.confidence,
                        page_id=page_id,
                        max_variants=max_variants_per_source,
                    )
                    candidates.extend(e_cands)

        # 3. Questions
        if include_questions and "question_analysis" in intelligence_data:
            q_res = intelligence_data["question_analysis"]
            for q_item in q_res.questions[:8]:
                q_text = q_item.get("question_text") if isinstance(q_item, dict) else getattr(q_item, "question_text", None)
                q_source = q_item.get("source_type", "heading") if isinstance(q_item, dict) else getattr(q_item, "source_type", "heading")
                q_has_ans = q_item.get("has_answer", True) if isinstance(q_item, dict) else getattr(q_item, "has_answer", True)

                if q_text:
                    q_cands = QuestionIntelligenceQueryGenerator.generate(
                        question_text=q_text,
                        source_type=q_source,
                        has_answer=q_has_ans,
                        page_id=page_id,
                        topic=intelligence_data.get("topic_analysis", {}).primary_topic
                        if hasattr(intelligence_data.get("topic_analysis", {}), "primary_topic")
                        else None,
                        max_variants=max_variants_per_source,
                    )
                    candidates.extend(q_cands)

        # 4. Content Intelligence
        if include_content and "content_intelligence" in intelligence_data:
            c_summary = intelligence_data["content_intelligence"]
            c_dict = c_summary.to_dict() if hasattr(c_summary, "to_dict") else (c_summary if isinstance(c_summary, dict) else {})
            c_cands = ContentIntelligenceQueryGenerator.generate(
                content_summary=c_dict,
                page_id=page_id,
                max_variants=max_variants_per_source,
            )
            candidates.extend(c_cands)

        # Filter by target intents if specified
        if target_intents:
            normalized_target_intents = {str(ti).upper() for ti in target_intents}
            candidates = [
                c for c in candidates
                if (c.intent.value if isinstance(c.intent, QueryIntent) else str(c.intent)).upper() in normalized_target_intents
            ]

        return candidates

    @classmethod
    def generate_and_persist_query_set(
        cls,
        db: Session,
        website_id: int,
        scan_id: int | None = None,
        name: str | None = None,
        description: str | None = None,
        version: str = "1.0",
        max_variants_per_source: int = DEFAULT_MAX_VARIANTS_PER_SOURCE,
        max_total_queries: int = DEFAULT_MAX_TOTAL_QUERIES,
        include_topics: bool = True,
        include_entities: bool = True,
        include_questions: bool = True,
        include_content: bool = True,
        target_intents: list[str] | None = None,
    ) -> QuerySet:
        """
        End-to-end generator:
        1. Verifies website existence
        2. Gathers pages from scan or website
        3. Collects intelligence across all pages
        4. Generates candidates from topics, entities, questions, and content
        5. Normalizes and deduplicates candidates
        6. Persists QuerySet and Query records
        7. Returns the QuerySet
        """
        website = db.get(Website, website_id)
        if not website:
            raise ValueError(f"Website with id {website_id} not found")

        # Determine target scan
        target_scan: Scan | None = None
        if scan_id:
            target_scan = db.get(Scan, scan_id)
            if not target_scan or target_scan.website_id != website_id:
                raise ValueError(f"Scan with id {scan_id} not found for website {website_id}")
        else:
            # Use latest completed scan if available
            target_scan = (
                db.query(Scan)
                .filter(Scan.website_id == website_id)
                .order_by(desc(Scan.id))
                .first()
            )

        # Determine pages to analyze
        pages: list[PageResult] = []
        if target_scan:
            pages = (
                db.query(PageResult)
                .filter(PageResult.scan_id == target_scan.id)
                .all()
            )
        else:
            # If no scan exists, find any page associated with scans of this website
            pages = (
                db.query(PageResult)
                .join(Scan, PageResult.scan_id == Scan.id)
                .filter(Scan.website_id == website_id)
                .all()
            )

        # Collect raw candidate queries
        raw_candidates: list[CandidateQuery] = []

        if pages:
            for p in pages:
                intel = cls.collect_intelligence_for_page(db, p)
                cands = cls.generate_candidate_queries(
                    intelligence_data=intel,
                    max_variants_per_source=max_variants_per_source,
                    include_topics=include_topics,
                    include_entities=include_entities,
                    include_questions=include_questions,
                    include_content=include_content,
                    target_intents=target_intents,
                )
                raw_candidates.extend(cands)
        else:
            # Fallback: if no pages crawled yet, generate from website name and existing DB entities
            db_entities = db.query(Entity).filter(Entity.website_id == website_id).all()
            dummy_intel = {
                "page_id": None,
                "title": website.name,
                "db_entities": db_entities,
            }
            # Entity queries
            for dbe in db_entities:
                e_cands = EntityQueryGenerator.generate(
                    entity_name=dbe.name,
                    entity_id=dbe.id,
                    entity_type=dbe.entity_type,
                    entity_confidence=dbe.confidence,
                    max_variants=max_variants_per_source,
                )
                raw_candidates.extend(e_cands)

            # Website name as topic/entity
            fallback_cands = TopicQueryGenerator.generate(
                topic=website.name,
                topic_confidence=0.8,
                max_variants=max_variants_per_source,
                in_title=True,
            )
            raw_candidates.extend(fallback_cands)

        # Deduplicate candidates deterministically
        deduped = deduplicate_candidate_queries(
            raw_candidates,
            similarity_threshold=DEFAULT_SIMILARITY_THRESHOLD,
            max_total_queries=max_total_queries,
        )

        # Determine QuerySet Name & Version
        set_name = name or f"{website.name} Monitoring Query Set"
        set_desc = description or f"Auto-generated reusable query set derived from site intelligence for {website.url}."

        # Create QuerySet model
        query_set = QuerySet(
            website_id=website_id,
            scan_id=target_scan.id if target_scan else None,
            name=set_name,
            description=set_desc,
            version=version,
            status=QuerySetStatus.ACTIVE.value,
            created_at=datetime.now(timezone.utc),
            updated_at=datetime.now(timezone.utc),
        )
        db.add(query_set)
        db.commit()
        db.refresh(query_set)

        # Persist Query records
        for cand in deduped:
            intent_val = cand.intent.value if isinstance(cand.intent, QueryIntent) else str(cand.intent)
            source_val = (
                cand.generation_source.value
                if isinstance(cand.generation_source, QueryGenerationSource)
                else str(cand.generation_source)
            )
            priority_val = cand.priority.value if isinstance(cand.priority, QueryPriority) else str(cand.priority)

            query_record = Query(
                query_set_id=query_set.id,
                website_id=website_id,
                query_text=cand.query_text,
                intent=intent_val,
                topic_id=cand.topic_id,
                topic=cand.topic,
                entity_id=cand.entity_id,
                entity_name=cand.entity_name,
                page_id=cand.page_id,
                generation_source=source_val,
                priority=priority_val,
                confidence=cand.confidence,
                version=version,
                active=True,
                metadata_json=cand.metadata,
                created_at=datetime.now(timezone.utc),
                updated_at=datetime.now(timezone.utc),
            )
            db.add(query_record)

        db.commit()
        db.refresh(query_set)

        return query_set

    # ==========================================
    # CRUD & Management Methods
    # ==========================================

    @classmethod
    def get_query_set(cls, db: Session, query_set_id: int) -> QuerySet | None:
        return db.get(QuerySet, query_set_id)

    @classmethod
    def list_query_sets(
        cls,
        db: Session,
        website_id: int | None = None,
        status: str | None = None,
        version: str | None = None,
        limit: int = 100,
        offset: int = 0,
    ) -> list[QuerySet]:
        q = db.query(QuerySet)
        if website_id:
            q = q.filter(QuerySet.website_id == website_id)
        if status:
            q = q.filter(QuerySet.status == status)
        if version:
            q = q.filter(QuerySet.version == version)
        return q.order_by(desc(QuerySet.id)).offset(offset).limit(limit).all()

    @classmethod
    def get_query_set_queries(
        cls,
        db: Session,
        query_set_id: int,
        active_only: bool = False,
        intent: str | None = None,
        priority: str | None = None,
        source: str | None = None,
        limit: int = 500,
        offset: int = 0,
    ) -> list[Query]:
        q = db.query(Query).filter(Query.query_set_id == query_set_id)
        if active_only:
            q = q.filter(Query.active == True)
        if intent:
            q = q.filter(Query.intent == intent.upper())
        if priority:
            q = q.filter(Query.priority == priority.upper())
        if source:
            q = q.filter(Query.generation_source == source.upper())
        return q.order_by(desc(Query.id)).offset(offset).limit(limit).all()

    @classmethod
    def get_query(cls, db: Session, query_id: int) -> Query | None:
        return db.get(Query, query_id)

    @classmethod
    def create_query(
        cls,
        db: Session,
        query_set_id: int,
        query_data: QueryCreate,
    ) -> Query:
        query_set = db.get(QuerySet, query_set_id)
        if not query_set:
            raise ValueError(f"QuerySet with id {query_set_id} not found")

        # Validate intent
        intent_val = query_data.intent.upper()
        if intent_val not in [i.value for i in QueryIntent]:
            intent_val = QueryIntent.INFORMATIONAL.value

        # Validate priority
        prio_val = query_data.priority.upper()
        if prio_val not in [p.value for p in QueryPriority]:
            prio_val = QueryPriority.MEDIUM.value

        query = Query(
            query_set_id=query_set_id,
            website_id=query_set.website_id,
            query_text=query_data.query_text,
            intent=intent_val,
            topic_id=query_data.topic_id,
            topic=query_data.topic,
            entity_id=query_data.entity_id,
            entity_name=query_data.entity_name,
            page_id=query_data.page_id,
            generation_source=query_data.generation_source.upper(),
            priority=prio_val,
            confidence=query_data.confidence,
            version=query_data.version or query_set.version,
            active=query_data.active,
            metadata_json=query_data.metadata_json,
            created_at=datetime.now(timezone.utc),
            updated_at=datetime.now(timezone.utc),
        )
        db.add(query)
        db.commit()
        db.refresh(query)
        return query

    @classmethod
    def update_query(
        cls,
        db: Session,
        query_id: int,
        update_data: QueryUpdate,
    ) -> Query | None:
        query = db.get(Query, query_id)
        if not query:
            return None

        if update_data.query_text is not None:
            query.query_text = update_data.query_text
        if update_data.intent is not None:
            query.intent = update_data.intent.upper()
        if update_data.priority is not None:
            query.priority = update_data.priority.upper()
        if update_data.confidence is not None:
            query.confidence = update_data.confidence
        if update_data.active is not None:
            query.active = update_data.active
        if update_data.metadata_json is not None:
            query.metadata_json = update_data.metadata_json

        query.updated_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(query)
        return query

    @classmethod
    def update_query_status(
        cls,
        db: Session,
        query_id: int,
        active: bool,
    ) -> Query | None:
        query = db.get(Query, query_id)
        if not query:
            return None

        query.active = active
        query.updated_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(query)
        return query

    @classmethod
    def delete_query(cls, db: Session, query_id: int) -> bool:
        query = db.get(Query, query_id)
        if not query:
            return False
        db.delete(query)
        db.commit()
        return True
