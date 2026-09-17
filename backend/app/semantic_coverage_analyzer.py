"""
Semantic Coverage Analyzer (Task 5 - Step 13)

Synthesizes identified topics, supporting topics, entities, questions,
and structural sections to evaluate how comprehensively the page covers
its core semantic domain. Adheres to: Evidence != conclusion.
"""

from dataclasses import asdict, dataclass, field
from typing import Any

from .answer_analyzer import AnswerAnalysisEvidence
from .content_structure_analyzer import ContentStructureEvidence
from .entity_analyzer import EntityAnalysisEvidence
from .intent_analyzer import IntentAnalysisEvidence
from .question_analyzer import QuestionAnalysisEvidence
from .topic_analyzer import TopicAnalysisEvidence


@dataclass
class SemanticCoverageEvidence:
    semantic_coverage_score: float = 0.0
    breadth_level: str = "narrow"  # "comprehensive", "moderate", "narrow"
    covered_concepts: list[str] = field(default_factory=list)
    weakly_covered_concepts: list[str] = field(default_factory=list)
    missing_concepts: list[str] = field(default_factory=list)
    component_scores: dict[str, float] = field(default_factory=dict)
    findings: list[dict[str, Any]] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class SemanticCoverageAnalyzer:
    """
    Measures semantic concept coverage deterministically across
    topics, supporting concepts, entity context, and structural breadth.
    """

    def analyze(
        self,
        topic_evidence: TopicAnalysisEvidence | dict[str, Any] | None = None,
        entity_evidence: EntityAnalysisEvidence | dict[str, Any] | None = None,
        question_evidence: QuestionAnalysisEvidence | dict[str, Any] | None = None,
        answer_evidence: AnswerAnalysisEvidence | dict[str, Any] | None = None,
        intent_evidence: IntentAnalysisEvidence | dict[str, Any] | None = None,
        content_structure: ContentStructureEvidence | dict[str, Any] | None = None,
        headings: list[Any] | None = None,
        text_content: str | None = None,
    ) -> SemanticCoverageEvidence:
        evidence = SemanticCoverageEvidence()

        covered: list[str] = []
        weak: list[str] = []
        missing: list[str] = []

        # 1. Topic Concepts Pillar (Weight 35%)
        # Check coverage of primary and supporting topics
        topic_score = 0.0
        primary_topic = None
        supporting_topics: list[str] = []

        if topic_evidence:
            t_data = topic_evidence.to_dict() if hasattr(topic_evidence, "to_dict") else topic_evidence
            primary_topic = t_data.get("primary_topic")
            supporting_topics = t_data.get("supporting_topics", [])
            depth = t_data.get("semantic_depth", "thin")

            if primary_topic:
                covered.append(f"Primary Topic: '{primary_topic}'")
                topic_score += 0.50

                # Check supporting topics
                if supporting_topics:
                    for st in supporting_topics:
                        covered.append(f"Supporting Concept: '{st}'")
                    topic_score += 0.30
                else:
                    weak.append("No supporting sub-topics detected to enrich main topic.")

                if depth == "deep":
                    topic_score += 0.20
                elif depth == "moderate":
                    topic_score += 0.10
                else:
                    weak.append(f"Topic '{primary_topic}' has shallow semantic depth (< 50 words).")
            else:
                missing.append("No identifiable primary topic detected.")
        else:
            missing.append("Topic semantics unanalyzed or absent.")

        topic_score = round(min(1.0, topic_score), 2)

        # 2. Question & Answer Coverage Pillar (Weight 25%)
        qa_score = 0.0
        q_count = 0
        ans_count = 0

        if answer_evidence:
            a_data = answer_evidence.to_dict() if hasattr(answer_evidence, "to_dict") else answer_evidence
            q_count = a_data.get("total_questions", 0)
            ans_count = a_data.get("answered_questions", 0)
        elif question_evidence:
            q_data = question_evidence.to_dict() if hasattr(question_evidence, "to_dict") else question_evidence
            q_count = q_data.get("question_count", 0)
            ans_count = q_data.get("answered_question_count", 0)

        if q_count > 0:
            ans_ratio = ans_count / q_count
            qa_score = round(ans_ratio, 2)
            if ans_ratio >= 0.8:
                covered.append(f"Q&A Resolution: {ans_count}/{q_count} questions answered.")
            elif ans_ratio >= 0.4:
                weak.append(f"Partial Q&A Resolution: {ans_count}/{q_count} questions answered.")
            else:
                missing.append(f"Unanswered queries: {q_count - ans_count} questions lack answer passages.")
        else:
            # Neutral baseline
            qa_score = 0.50

        # 3. Entity & Authority Coverage Pillar (Weight 20%)
        ent_score = 0.0
        if entity_evidence:
            e_data = entity_evidence.to_dict() if hasattr(entity_evidence, "to_dict") else entity_evidence
            entities = e_data.get("entities", [])
            ent_count = e_data.get("entity_count", 0)
            has_org = e_data.get("has_organization_entity", False)

            if ent_count > 0:
                ent_score += 0.50
                for ent in entities[:4]:
                    ename = ent.get("name", "")
                    etype = ent.get("entity_type", "entity")
                    covered.append(f"Entity: {ename} ({etype})")

                if has_org:
                    ent_score += 0.30
                if e_data.get("entity_consistency_valid", True):
                    ent_score += 0.20
                else:
                    weak.append("Entity declarations inconsistent with visible headings.")
            else:
                missing.append("Named entity context (organization/brand) missing.")
        else:
            ent_score = 0.40

        ent_score = round(min(1.0, ent_score), 2)

        # 4. Structural Breadth Pillar (Weight 20%)
        struct_score = 0.50
        if content_structure:
            s_data = content_structure.to_dict() if hasattr(content_structure, "to_dict") else content_structure
            sec_count = s_data.get("section_count", 0)
            has_h1 = s_data.get("has_h1", False)
            empty_secs = s_data.get("empty_sections", [])
            thin_secs = s_data.get("thin_sections", [])

            sub_score = 0.0
            if has_h1:
                sub_score += 0.30
            if sec_count >= 3:
                sub_score += 0.40
                covered.append(f"Structural Breadth: {sec_count} distinct content sections.")
            elif sec_count >= 1:
                sub_score += 0.20
            else:
                weak.append("Single undivided content block limits structural readability.")

            if not empty_secs and not thin_secs:
                sub_score += 0.30
            else:
                weak.append(f"{len(empty_secs) + len(thin_secs)} empty/thin section(s) weaken outline.")

            struct_score = round(min(1.0, sub_score), 2)

        # Total Semantic Coverage Calculation
        total_score = round(
            (0.35 * topic_score) +
            (0.25 * qa_score) +
            (0.20 * ent_score) +
            (0.20 * struct_score),
            2,
        )

        evidence.semantic_coverage_score = total_score
        evidence.component_scores = {
            "topic_concept_score": topic_score,
            "question_coverage_score": qa_score,
            "entity_coverage_score": ent_score,
            "structural_breadth_score": struct_score,
        }

        if total_score >= 0.75:
            evidence.breadth_level = "comprehensive"
        elif total_score >= 0.45:
            evidence.breadth_level = "moderate"
        else:
            evidence.breadth_level = "narrow"

        evidence.covered_concepts = covered
        evidence.weakly_covered_concepts = weak
        evidence.missing_concepts = missing

        # Generate Explainable Findings
        if evidence.breadth_level == "comprehensive":
            evidence.findings.append({
                "type": "comprehensive_semantic_coverage",
                "severity": "info",
                "title": "Comprehensive semantic domain coverage",
                "description": f"Content achieves a semantic coverage score of {int(total_score * 100)}% (Level: Comprehensive). It thoroughly covers core topics, supporting concepts, entity context, and structural sections.",
                "evidence": evidence.component_scores,
            })
        elif evidence.breadth_level == "moderate":
            evidence.findings.append({
                "type": "moderate_semantic_coverage",
                "severity": "low",
                "title": "Moderate semantic coverage with potential expansion areas",
                "description": f"Content achieves a semantic coverage score of {int(total_score * 100)}% (Level: Moderate). Addressing weak or missing concepts will improve search authority.",
                "evidence": {
                    "component_scores": evidence.component_scores,
                    "weak_concepts": evidence.weakly_covered_concepts[:3],
                    "missing_concepts": evidence.missing_concepts[:3],
                },
            })
        else:
            evidence.findings.append({
                "type": "narrow_semantic_coverage",
                "severity": "medium",
                "title": "Narrow semantic coverage: Key domain concepts missing",
                "description": f"Semantic coverage is low at {int(total_score * 100)}% (Level: Narrow). The page lacks supporting concepts, entity context, or detailed outline sections.",
                "evidence": {
                    "component_scores": evidence.component_scores,
                    "missing_concepts": evidence.missing_concepts,
                },
            })

        return evidence


def analyze_semantic_coverage(
    topic_evidence: TopicAnalysisEvidence | dict[str, Any] | None = None,
    entity_evidence: EntityAnalysisEvidence | dict[str, Any] | None = None,
    question_evidence: QuestionAnalysisEvidence | dict[str, Any] | None = None,
    answer_evidence: AnswerAnalysisEvidence | dict[str, Any] | None = None,
    intent_evidence: IntentAnalysisEvidence | dict[str, Any] | None = None,
    content_structure: ContentStructureEvidence | dict[str, Any] | None = None,
    headings: list[Any] | None = None,
    text_content: str | None = None,
) -> SemanticCoverageEvidence:
    """Convenience function to analyze semantic coverage."""
    analyzer = SemanticCoverageAnalyzer()
    return analyzer.analyze(
        topic_evidence=topic_evidence,
        entity_evidence=entity_evidence,
        question_evidence=question_evidence,
        answer_evidence=answer_evidence,
        intent_evidence=intent_evidence,
        content_structure=content_structure,
        headings=headings,
        text_content=text_content,
    )
