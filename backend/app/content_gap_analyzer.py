"""
Content Gap Analyzer (Task 5 - Step 10)

Detects objective, evidence-based content gaps:
unanswered questions, empty/thin sections, missing topic aspects,
missing entity context, and missing structured data opportunities.
"""

from dataclasses import asdict, dataclass, field
from typing import Any

from .answer_analyzer import AnswerAnalysisEvidence
from .content_structure_analyzer import ContentStructureEvidence
from .entity_analyzer import EntityAnalysisEvidence
from .question_analyzer import QuestionAnalysisEvidence
from .topic_analyzer import TopicAnalysisEvidence


@dataclass
class ContentGapItem:
    gap_type: str  # "unanswered_question", "empty_section", "thin_section", "topic_coverage", "entity_context", "schema_opportunity"
    title: str
    missing_element: str
    why_it_matters: str
    severity: str  # "low", "medium", "high"
    recommended_action: str
    evidence: dict[str, Any] = field(default_factory=dict)


@dataclass
class ContentGapEvidence:
    total_gaps: int = 0
    unanswered_question_gaps_count: int = 0
    structural_gaps_count: int = 0
    topical_gaps_count: int = 0
    entity_gaps_count: int = 0
    schema_gaps_count: int = 0
    gaps: list[dict[str, Any]] = field(default_factory=list)
    findings: list[dict[str, Any]] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class ContentGapAnalyzer:
    """
    Evaluates evidence across content structure, topics, entities, questions, and answers
    to identify deterministic, evidence-grounded content gaps.
    """

    def analyze(
        self,
        content_structure: ContentStructureEvidence | dict[str, Any] | None = None,
        topic_semantics: TopicAnalysisEvidence | dict[str, Any] | None = None,
        entity_evidence: EntityAnalysisEvidence | dict[str, Any] | None = None,
        question_evidence: QuestionAnalysisEvidence | dict[str, Any] | None = None,
        answer_evidence: AnswerAnalysisEvidence | dict[str, Any] | None = None,
    ) -> ContentGapEvidence:
        evidence = ContentGapEvidence()
        detected_gaps: list[ContentGapItem] = []
        seen_gap_keys: set[str] = set()

        def add_gap(gap: ContentGapItem) -> None:
            key = f"{gap.gap_type}:{gap.missing_element.lower().strip()}"
            if key not in seen_gap_keys:
                seen_gap_keys.add(key)
                detected_gaps.append(gap)

        # 1. Unanswered Questions Gap Detection
        if answer_evidence:
            a_data = answer_evidence.to_dict() if hasattr(answer_evidence, "to_dict") else answer_evidence
            for ans in a_data.get("answers", []):
                if not ans.get("has_answer"):
                    q_text = ans.get("question_text", "Unknown question")
                    add_gap(ContentGapItem(
                        gap_type="unanswered_question",
                        title=f"Unanswered Query: '{q_text}'",
                        missing_element=q_text,
                        why_it_matters="Search engines and AI answer engines penalize pages that pose user questions without providing direct, authoritative answers.",
                        severity="medium",
                        recommended_action="Draft a 30-60 word direct explanatory answer paragraph immediately following this question.",
                        evidence={
                            "question": q_text,
                            "source": ans.get("question_source"),
                            "reason": ans.get("reason"),
                        },
                    ))
        elif question_evidence:
            q_data = question_evidence.to_dict() if hasattr(question_evidence, "to_dict") else question_evidence
            for q in q_data.get("questions", []):
                if not q.get("has_answer"):
                    q_text = q.get("question_text", "Unknown question")
                    add_gap(ContentGapItem(
                        gap_type="unanswered_question",
                        title=f"Unanswered Query: '{q_text}'",
                        missing_element=q_text,
                        why_it_matters="Users landing on this question will not find an answer, leading to high bounce rates.",
                        severity="medium",
                        recommended_action="Add an immediate answer passage or list under this question heading.",
                        evidence={"question": q_text, "source": q.get("source_type")},
                    ))

        # 2. Structural Gaps (Empty and Thin Sections)
        if content_structure:
            s_data = content_structure.to_dict() if hasattr(content_structure, "to_dict") else content_structure
            for es in s_data.get("empty_sections", []):
                htxt = es.get("heading_text")
                if htxt:
                    add_gap(ContentGapItem(
                        gap_type="empty_section",
                        title=f"Empty Section Under '{htxt}'",
                        missing_element=f"Section content for '{htxt}'",
                        why_it_matters="An empty heading creates a broken outline that degrades user experience and search indexing.",
                        severity="medium",
                        recommended_action=f"Provide explanatory content under heading '{htxt}' or remove the redundant heading.",
                        evidence={"heading": htxt, "level": es.get("heading_level"), "position": es.get("position")},
                    ))

            for ts in s_data.get("thin_sections", []):
                htxt = ts.get("heading_text")
                if htxt:
                    add_gap(ContentGapItem(
                        gap_type="thin_section",
                        title=f"Thin Section Under '{htxt}'",
                        missing_element=f"Substantive content for '{htxt}'",
                        why_it_matters="Sections with fewer than 5 words fail to provide sufficient context or value for readers.",
                        severity="low",
                        recommended_action=f"Expand the content in section '{htxt}' to thoroughly cover the subtopic.",
                        evidence={"heading": htxt, "word_count": ts.get("word_count")},
                    ))

        # 3. Topical Coverage Gaps
        if topic_semantics:
            t_data = topic_semantics.to_dict() if hasattr(topic_semantics, "to_dict") else topic_semantics
            primary_topic = t_data.get("primary_topic")
            in_h1 = t_data.get("primary_topic_in_h1", False)
            depth = t_data.get("semantic_depth", "moderate")

            if primary_topic and not in_h1:
                add_gap(ContentGapItem(
                    gap_type="topic_coverage",
                    title=f"Primary Topic '{primary_topic}' Missing From Main Heading",
                    missing_element=f"H1 inclusion of '{primary_topic}'",
                    why_it_matters="The primary topic is not declared in the document's main H1 heading, weakening topical authority signals.",
                    severity="medium",
                    recommended_action=f"Revise the primary <h1> to explicitly include the main topic '{primary_topic}'.",
                    evidence={"primary_topic": primary_topic},
                ))

            if depth == "thin":
                add_gap(ContentGapItem(
                    gap_type="topic_coverage",
                    title="Thin Content Depth Across Topic",
                    missing_element="Comprehensive topic coverage",
                    why_it_matters="With fewer than 50 total words, the page does not provide sufficient depth for competitive topical ranking.",
                    severity="high",
                    recommended_action="Expand content with key definitions, practical examples, and supporting subsections.",
                    evidence={"total_words": t_data.get("total_words", 0)},
                ))

        # 4. Entity Context Gaps
        if entity_evidence:
            e_data = entity_evidence.to_dict() if hasattr(entity_evidence, "to_dict") else entity_evidence
            ent_count = e_data.get("entity_count", 0)
            has_org = e_data.get("has_organization_entity", False)
            entities = e_data.get("entities", [])

            if ent_count == 0:
                add_gap(ContentGapItem(
                    gap_type="entity_context",
                    title="Missing Entity Anchor Information",
                    missing_element="Brand / Organization entity declaration",
                    why_it_matters="Search engines rely on knowledge graph entities to connect pages with verified organizations and brands.",
                    severity="medium",
                    recommended_action="Incorporate clear organizational/brand naming and declare Organization Schema.org markup.",
                    evidence={"entity_count": 0},
                ))
            elif has_org:
                # Check for sameAs authority link gaps
                for ent in entities:
                    if ent.get("entity_type") == "organization" and not ent.get("same_as"):
                        add_gap(ContentGapItem(
                            gap_type="entity_context",
                            title=f"Missing Authority Links for '{ent.get('name')}'",
                            missing_element=f"sameAs links for '{ent.get('name')}'",
                            why_it_matters="Without sameAs links to authoritative sources (Wikidata, Wikipedia, social profiles), entity resolution is weaker.",
                            severity="low",
                            recommended_action="Add sameAs URLs in Schema.org Organization markup pointing to official entity profiles.",
                            evidence={"organization": ent.get("name")},
                        ))

        # 5. Schema Structured Data Gaps
        if question_evidence:
            q_data = question_evidence.to_dict() if hasattr(question_evidence, "to_dict") else question_evidence
            q_count = q_data.get("question_count", 0)
            faq_schema = q_data.get("faq_schema_present", False)

            if q_count >= 3 and not faq_schema:
                add_gap(ContentGapItem(
                    gap_type="schema_opportunity",
                    title="Missing FAQPage Schema for Question-Rich Content",
                    missing_element="FAQPage Schema.org structured data",
                    why_it_matters="The page includes multiple question-and-answer pairs but lacks the Schema.org markup needed for search rich snippets.",
                    severity="low",
                    recommended_action="Deploy FAQPage JSON-LD markup containing the questions and answers from this page.",
                    evidence={"question_count": q_count},
                ))

        # Compile summaries
        evidence.gaps = [asdict(g) for g in detected_gaps]
        evidence.total_gaps = len(detected_gaps)
        evidence.unanswered_question_gaps_count = sum(1 for g in detected_gaps if g.gap_type == "unanswered_question")
        evidence.structural_gaps_count = sum(1 for g in detected_gaps if g.gap_type in ("empty_section", "thin_section"))
        evidence.topical_gaps_count = sum(1 for g in detected_gaps if g.gap_type == "topic_coverage")
        evidence.entity_gaps_count = sum(1 for g in detected_gaps if g.gap_type == "entity_context")
        evidence.schema_gaps_count = sum(1 for g in detected_gaps if g.gap_type == "schema_opportunity")

        # Convert gaps to explainable findings
        for g in detected_gaps:
            evidence.findings.append({
                "type": f"content_gap_{g.gap_type}",
                "severity": g.severity,
                "title": g.title,
                "description": f"{g.why_it_matters} Action: {g.recommended_action}",
                "evidence": g.evidence,
            })

        return evidence


def analyze_content_gaps(
    content_structure: ContentStructureEvidence | dict[str, Any] | None = None,
    topic_semantics: TopicAnalysisEvidence | dict[str, Any] | None = None,
    entity_evidence: EntityAnalysisEvidence | dict[str, Any] | None = None,
    question_evidence: QuestionAnalysisEvidence | dict[str, Any] | None = None,
    answer_evidence: AnswerAnalysisEvidence | dict[str, Any] | None = None,
) -> ContentGapEvidence:
    """Convenience function to analyze content gaps."""
    analyzer = ContentGapAnalyzer()
    return analyzer.analyze(
        content_structure=content_structure,
        topic_semantics=topic_semantics,
        entity_evidence=entity_evidence,
        question_evidence=question_evidence,
        answer_evidence=answer_evidence,
    )
