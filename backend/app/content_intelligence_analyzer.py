"""
Content Intelligence Analyzer (Task 5 - Step 17)

Synthesizes full page content intelligence across structure, topics,
entities, questions, answers, readiness, content gaps, quality evidence,
search intent, and semantic coverage.
Adheres strictly to: Evidence != conclusion.
"""

from dataclasses import asdict, dataclass, field
from typing import Any

from .answer_analyzer import analyze_answers
from .content_gap_analyzer import analyze_content_gaps
from .content_structure_analyzer import analyze_content_structure
from .entity_analyzer import analyze_entities
from .intent_analyzer import analyze_intent
from .quality_analyzer import analyze_quality
from .question_analyzer import analyze_questions
from .readiness_analyzer import analyze_readiness
from .semantic_coverage_analyzer import analyze_semantic_coverage
from .topic_analyzer import analyze_topic_semantics


@dataclass
class ContentIntelligenceSummary:
    page_id: int | None = None
    url: str | None = None
    title: str | None = None
    overall_content_score: float = 0.0
    content_status: str = "deficient"  # "optimal", "needs_improvement", "deficient"
    word_count: int = 0
    reading_time_minutes: float = 0.0
    primary_topic: str | None = None
    primary_intent: str = "informational"
    intent_confidence: float = 0.0
    answer_readiness_score: float = 0.0
    answer_readiness_level: str = "low"
    semantic_coverage_score: float = 0.0
    semantic_breadth_level: str = "narrow"
    evidence_quality_score: float = 0.0
    evidence_strength: str = "weak"
    total_questions: int = 0
    answered_questions: int = 0
    unanswered_questions: int = 0
    total_gaps: int = 0
    entity_count: int = 0
    key_strengths: list[str] = field(default_factory=list)
    critical_issues: list[str] = field(default_factory=list)
    component_summaries: dict[str, Any] = field(default_factory=dict)
    findings: list[dict[str, Any]] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class ContentIntelligenceAnalyzer:
    """
    Combines all content intelligence signals into an explainable,
    deterministic profile of a page's content quality and AEO/SEO readiness.
    """

    def analyze(
        self,
        text_content: str | None = None,
        raw_html: str | None = None,
        title: str | None = None,
        headings: list[Any] | None = None,
        structured_data_blocks: list[Any] | None = None,
        microdata_items: list[Any] | None = None,
        links: list[Any] | None = None,
        page_id: int | None = None,
        url: str | None = None,
    ) -> ContentIntelligenceSummary:
        summary = ContentIntelligenceSummary(page_id=page_id, url=url, title=title)

        # Handle missing or empty content safely
        safe_text = (text_content or "").strip()
        safe_html = raw_html or ""

        # 1. Structure Analysis
        struct_res = analyze_content_structure(safe_html if safe_html else f"<html><body><p>{safe_text}</p></body></html>")
        total_words = len(safe_text.split()) if safe_text else sum(s.get("word_count", 0) for s in struct_res.sections)
        summary.word_count = total_words
        summary.reading_time_minutes = round(total_words / 200.0, 2)


        # 2. Topic & Semantic Analysis
        topic_res = analyze_topic_semantics(
            text_content=safe_text,
            title=title,
            headings=headings,
        )
        summary.primary_topic = topic_res.primary_topic

        # 3. Entity Analysis
        entity_res = analyze_entities(
            structured_data_blocks=structured_data_blocks,
            microdata_items=microdata_items,
            text_content=safe_text,
            title=title,
            headings=headings,
        )
        summary.entity_count = entity_res.entity_count

        # 4. Question & Interrogative Analysis
        question_res = analyze_questions(
            text_content=safe_text,
            headings=headings,
            structured_data_blocks=structured_data_blocks,
            sections=struct_res.sections,
        )

        # 5. Answer Analysis
        answer_res = analyze_answers(
            questions_evidence=question_res.questions,
            headings=headings,
            sections=struct_res.sections,
            structured_data_blocks=structured_data_blocks,
            text_content=safe_text,
        )
        summary.total_questions = answer_res.total_questions
        summary.answered_questions = answer_res.answered_questions
        summary.unanswered_questions = answer_res.unanswered_questions

        # 6. Answer Readiness Analysis
        readiness_res = analyze_readiness(
            content_structure=struct_res,
            topic_semantics=topic_res,
            entity_evidence=entity_res,
            question_evidence=question_res,
            answer_evidence=answer_res,
        )
        summary.answer_readiness_score = readiness_res.readiness_score
        summary.answer_readiness_level = readiness_res.readiness_level

        # 7. Content Gap Analysis
        gap_res = analyze_content_gaps(
            content_structure=struct_res,
            topic_semantics=topic_res,
            entity_evidence=entity_res,
            question_evidence=question_res,
            answer_evidence=answer_res,
        )
        summary.total_gaps = gap_res.total_gaps

        # 8. Quality & Evidence Analysis
        quality_res = analyze_quality(
            text_content=safe_text,
            headings=headings,
            sections=struct_res.sections,
            links=links,
        )
        summary.evidence_quality_score = quality_res.quality_score
        summary.evidence_strength = quality_res.evidence_strength

        # 9. Search Intent Analysis
        intent_res = analyze_intent(
            text_content=safe_text,
            title=title,
            headings=headings,
            question_count=question_res.question_count,
            faq_schema_present=question_res.faq_schema_present,
        )
        summary.primary_intent = intent_res.primary_intent
        summary.intent_confidence = intent_res.confidence

        # 10. Semantic Coverage Analysis
        coverage_res = analyze_semantic_coverage(
            topic_evidence=topic_res,
            entity_evidence=entity_res,
            question_evidence=question_res,
            answer_evidence=answer_res,
            intent_evidence=intent_res,
            content_structure=struct_res,
            headings=headings,
            text_content=safe_text,
        )
        summary.semantic_coverage_score = coverage_res.semantic_coverage_score
        summary.semantic_breadth_level = coverage_res.breadth_level

        # Compute Overall Composite Score
        # Weights: Readiness (25%), Quality (25%), Coverage (25%), Structure & Topics (25%)
        struct_component = 0.50
        if struct_res.has_h1 and struct_res.heading_hierarchy_valid and not struct_res.empty_sections:
            struct_component = 1.0
        elif struct_res.has_h1 or struct_res.heading_hierarchy_valid:
            struct_component = 0.70

        composite = round(
            (0.25 * summary.answer_readiness_score) +
            (0.25 * summary.evidence_quality_score) +
            (0.25 * summary.semantic_coverage_score) +
            (0.25 * struct_component),
            2,
        )
        summary.overall_content_score = composite

        if composite >= 0.75:
            summary.content_status = "optimal"
        elif composite >= 0.45:
            summary.content_status = "needs_improvement"
        else:
            summary.content_status = "deficient"

        # Identify Key Strengths
        strengths: list[str] = []
        if summary.answer_readiness_score >= 0.70:
            strengths.append(f"Strong answer readiness ({int(summary.answer_readiness_score * 100)}%) primed for search snippets.")
        if summary.evidence_quality_score >= 0.70:
            strengths.append("High empirical evidence density with verifiable data points/sources.")
        if summary.semantic_coverage_score >= 0.70:
            strengths.append("Comprehensive semantic coverage of primary and supporting domain concepts.")
        if struct_res.heading_hierarchy_valid and struct_res.has_h1:
            strengths.append("Clean outline hierarchy anchored by a primary H1 heading.")
        if summary.entity_count > 0:
            strengths.append(f"Grounding entity references recognized ({summary.entity_count} entities).")
        summary.key_strengths = strengths

        # Identify Critical Issues
        issues: list[str] = []
        if summary.word_count < 50:
            issues.append("Thin content volume (under 50 words) limits semantic indexing depth.")
        if summary.unanswered_questions > 0:
            issues.append(f"{summary.unanswered_questions} unanswered question heading(s) present on page.")
        if quality_res.unsupported_claims_count > 0:
            issues.append(f"{quality_res.unsupported_claims_count} unsupported superlative claim(s) detected.")
        if summary.total_gaps > 0:
            issues.append(f"{summary.total_gaps} actionable content gap(s) identified.")
        if not struct_res.has_h1:
            issues.append("Document lacks a primary H1 heading.")
        summary.critical_issues = issues

        # Component summaries dictionary
        summary.component_summaries = {
            "structure": {
                "word_count": summary.word_count,
                "sections_count": struct_res.section_count,
                "hierarchy_valid": struct_res.heading_hierarchy_valid,
                "has_h1": struct_res.has_h1,
            },
            "topics": {
                "primary_topic": summary.primary_topic,
                "supporting_topics": topic_res.supporting_topics,
                "lexical_diversity": topic_res.lexical_diversity,
            },
            "entities": {
                "count": summary.entity_count,
                "has_org": entity_res.has_organization_entity,
            },
            "questions_and_answers": {
                "total_questions": summary.total_questions,
                "answered_questions": summary.answered_questions,
                "unanswered_questions": summary.unanswered_questions,
            },
            "intent": {
                "primary": summary.primary_intent,
                "confidence": summary.intent_confidence,
            },
            "readiness": {
                "score": summary.answer_readiness_score,
                "level": summary.answer_readiness_level,
            },
            "quality": {
                "score": summary.evidence_quality_score,
                "strength": summary.evidence_strength,
                "unsupported_claims": quality_res.unsupported_claims_count,
            },
            "semantic_coverage": {
                "score": summary.semantic_coverage_score,
                "breadth_level": summary.semantic_breadth_level,
            },
        }

        # Collect and deduplicate top findings
        all_findings = (
            readiness_res.findings +
            gap_res.findings +
            quality_res.findings +
            intent_res.findings +
            coverage_res.findings
        )
        seen_types: set[str] = set()
        deduped_findings: list[dict[str, Any]] = []
        for f in all_findings:
            ftype = f.get("type", "")
            if ftype not in seen_types:
                seen_types.add(ftype)
                deduped_findings.append(f)
        summary.findings = deduped_findings

        return summary


def analyze_content_intelligence(
    text_content: str | None = None,
    raw_html: str | None = None,
    title: str | None = None,
    headings: list[Any] | None = None,
    structured_data_blocks: list[Any] | None = None,
    microdata_items: list[Any] | None = None,
    links: list[Any] | None = None,
    page_id: int | None = None,
    url: str | None = None,
) -> ContentIntelligenceSummary:
    """Convenience function to run complete content intelligence analysis."""
    analyzer = ContentIntelligenceAnalyzer()
    return analyzer.analyze(
        text_content=text_content,
        raw_html=raw_html,
        title=title,
        headings=headings,
        structured_data_blocks=structured_data_blocks,
        microdata_items=microdata_items,
        links=links,
        page_id=page_id,
        url=url,
    )
