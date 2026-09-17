"""
Answer-Readiness Analyzer (Task 5 - Step 9)

Synthesizes structural, topic, entity, question, and answer evidence
to produce a deterministic, explainable readiness assessment for AI and search answer extraction.
"""

from dataclasses import asdict, dataclass, field
from typing import Any

from .answer_analyzer import AnswerAnalysisEvidence, AnswerAnalyzer
from .content_structure_analyzer import ContentStructureAnalyzer, ContentStructureEvidence
from .entity_analyzer import EntityAnalysisEvidence, EntityAnalyzer
from .question_analyzer import QuestionAnalysisEvidence, QuestionAnalyzer
from .topic_analyzer import TopicAnalysisEvidence, TopicSemanticAnalyzer


@dataclass
class AnswerReadinessEvidence:
    readiness_score: float = 0.0
    readiness_level: str = "low"  # "high", "moderate", "low"
    component_scores: dict[str, float] = field(default_factory=dict)
    positive_signals: list[str] = field(default_factory=list)
    negative_signals: list[str] = field(default_factory=list)
    total_questions: int = 0
    answered_questions: int = 0
    direct_answers_count: int = 0
    has_structured_data_qa: bool = False
    findings: list[dict[str, Any]] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class ReadinessAnalyzer:
    """
    Computes explainable readiness metrics by evaluating question coverage,
    answer directness, structural layout, semantic depth, and entity validation.
    """

    def analyze(
        self,
        content_structure: ContentStructureEvidence | dict[str, Any] | None = None,
        topic_semantics: TopicAnalysisEvidence | dict[str, Any] | None = None,
        entity_evidence: EntityAnalysisEvidence | dict[str, Any] | None = None,
        question_evidence: QuestionAnalysisEvidence | dict[str, Any] | None = None,
        answer_evidence: AnswerAnalysisEvidence | dict[str, Any] | None = None,
    ) -> AnswerReadinessEvidence:
        evidence = AnswerReadinessEvidence()

        positive_signals: list[str] = []
        negative_signals: list[str] = []

        # 1. Answer & Question Component (Weight 40%)
        # Extract question & answer data
        q_count = 0
        ans_count = 0
        direct_count = 0
        faq_schema = False

        if answer_evidence:
            data = answer_evidence.to_dict() if hasattr(answer_evidence, "to_dict") else answer_evidence
            q_count = data.get("total_questions", 0)
            ans_count = data.get("answered_questions", 0)
            direct_count = data.get("direct_answers_count", 0)
        elif question_evidence:
            data = question_evidence.to_dict() if hasattr(question_evidence, "to_dict") else question_evidence
            q_count = data.get("question_count", 0)
            ans_count = data.get("answered_question_count", 0)
            faq_schema = data.get("faq_schema_present", False)

        if question_evidence:
            q_data = question_evidence.to_dict() if hasattr(question_evidence, "to_dict") else question_evidence
            faq_schema = q_data.get("faq_schema_present", False)

        evidence.total_questions = q_count
        evidence.answered_questions = ans_count
        evidence.direct_answers_count = direct_count
        evidence.has_structured_data_qa = faq_schema

        qa_score = 0.0
        if q_count > 0:
            answered_ratio = ans_count / q_count
            direct_ratio = (direct_count / max(1, ans_count)) if ans_count > 0 else 0.0
            qa_score = (0.6 * answered_ratio) + (0.3 * direct_ratio) + (0.1 if faq_schema else 0.0)

            if answered_ratio >= 0.75:
                positive_signals.append(f"High answer coverage: {ans_count}/{q_count} detected questions answered.")
            else:
                negative_signals.append(f"Unanswered questions: {q_count - ans_count}/{q_count} questions lack answers.")

            if direct_count >= 1:
                positive_signals.append(f"Direct, concise answer phrasing detected ({direct_count} direct answers).")

            if faq_schema:
                positive_signals.append("FAQPage / QAPage Schema.org structured data provides machine-readable answers.")
            elif q_count >= 3:
                negative_signals.append("Missing FAQPage Schema markup for question-rich content.")
        else:
            # When no questions exist, baseline score is based on direct explanatory content
            qa_score = 0.50
            negative_signals.append("No explicit interrogatives or question headings to trigger answer snippets.")

        # 2. Structural Component (Weight 25%)
        struct_score = 0.5
        if content_structure:
            s_data = content_structure.to_dict() if hasattr(content_structure, "to_dict") else content_structure
            hierarchy_valid = s_data.get("heading_hierarchy_valid", True)
            has_h1 = s_data.get("has_h1", False)
            list_present = s_data.get("list_present", False)
            thin_sections = s_data.get("thin_sections", [])
            empty_sections = s_data.get("empty_sections", [])

            sub_score = 0.0
            if has_h1:
                sub_score += 0.3
                positive_signals.append("Clear primary H1 heading anchors content structure.")
            else:
                negative_signals.append("Missing primary H1 heading reduces outline clarity.")

            if hierarchy_valid:
                sub_score += 0.3
                positive_signals.append("Heading hierarchy follows valid outline nesting without level skips.")
            else:
                negative_signals.append("Heading hierarchy skips detected, degrading logical content flow.")

            if list_present:
                sub_score += 0.2
                positive_signals.append("Structured lists present, supporting concise snippet extraction.")

            if not thin_sections and not empty_sections:
                sub_score += 0.2
            else:
                total_problem_sections = len(thin_sections) + len(empty_sections)
                negative_signals.append(f"Detected {total_problem_sections} empty or thin section(s) under headings.")

            struct_score = round(sub_score, 2)

        # 3. Topic & Semantic Component (Weight 20%)
        semantic_score = 0.5
        if topic_semantics:
            t_data = topic_semantics.to_dict() if hasattr(topic_semantics, "to_dict") else topic_semantics
            primary_topic = t_data.get("primary_topic")
            depth = t_data.get("semantic_depth", "thin")
            in_title = t_data.get("primary_topic_in_title", False)
            in_h1 = t_data.get("primary_topic_in_h1", False)

            sem_sub = 0.0
            if primary_topic:
                sem_sub += 0.3
                if in_title and in_h1:
                    sem_sub += 0.3
                    positive_signals.append(f"Strong topic alignment: '{primary_topic}' present in both title and H1.")
                elif in_title or in_h1:
                    sem_sub += 0.2
                    positive_signals.append(f"Moderate topic alignment: '{primary_topic}' present in title or H1.")
                else:
                    negative_signals.append(f"Topic misalignment: '{primary_topic}' missing from title and primary heading.")

            if depth == "deep":
                sem_sub += 0.4
                positive_signals.append("Deep textual context supports comprehensive answer evaluation.")
            elif depth == "moderate":
                sem_sub += 0.3
                positive_signals.append("Moderate textual context provides adequate answer background.")
            else:
                sem_sub += 0.1
                negative_signals.append("Thin content depth provides minimal context for AI search extraction.")

            semantic_score = round(sem_sub, 2)

        # 4. Entity Component (Weight 15%)
        entity_score = 0.5
        if entity_evidence:
            e_data = entity_evidence.to_dict() if hasattr(entity_evidence, "to_dict") else entity_evidence
            ent_count = e_data.get("entity_count", 0)
            has_org = e_data.get("has_organization_entity", False)
            consistency = e_data.get("entity_consistency_valid", True)

            ent_sub = 0.0
            if ent_count > 0:
                ent_sub += 0.4
                positive_signals.append(f"Recognized {ent_count} concrete entity/brand reference(s).")
            else:
                negative_signals.append("No recognizable brand or organization entities detected.")

            if has_org:
                ent_sub += 0.3
                positive_signals.append("Verified organization entity anchors authoritativeness.")

            if consistency:
                ent_sub += 0.3
            else:
                negative_signals.append("Inconsistency between Schema entity declarations and visible headings.")

            entity_score = round(ent_sub, 2)

        # Weighted Total Score
        total_score = round(
            (0.40 * qa_score) +
            (0.25 * struct_score) +
            (0.20 * semantic_score) +
            (0.15 * entity_score),
            2,
        )

        evidence.readiness_score = total_score
        evidence.component_scores = {
            "qa_readiness": round(qa_score, 2),
            "structural_clarity": round(struct_score, 2),
            "semantic_depth": round(semantic_score, 2),
            "entity_authority": round(entity_score, 2),
        }

        if total_score >= 0.75:
            evidence.readiness_level = "high"
        elif total_score >= 0.45:
            evidence.readiness_level = "moderate"
        else:
            evidence.readiness_level = "low"

        evidence.positive_signals = positive_signals
        evidence.negative_signals = negative_signals

        # Generate Explainable Findings
        if evidence.readiness_level == "high":
            evidence.findings.append({
                "type": "high_answer_readiness",
                "severity": "info",
                "title": "High answer readiness for search & AI extraction",
                "description": f"Overall answer readiness score of {int(total_score * 100)}% (Level: High). Content exhibits direct answers, structured layout, and clear topical focus.",
                "evidence": evidence.component_scores,
            })
        elif evidence.readiness_level == "moderate":
            evidence.findings.append({
                "type": "moderate_answer_readiness",
                "severity": "low",
                "title": "Moderate answer readiness with actionable optimization opportunities",
                "description": f"Answer readiness score of {int(total_score * 100)}% (Level: Moderate). Has adequate foundation but would benefit from addressing unanswered queries or adding FAQ Schema.",
                "evidence": evidence.component_scores,
            })
        else:
            evidence.findings.append({
                "type": "low_answer_readiness",
                "severity": "medium",
                "title": "Low answer readiness: Content requires structural & answer optimization",
                "description": f"Answer readiness score of {int(total_score * 100)}% (Level: Low). Content lacks direct answer statements, structured question formatting, or sufficient semantic depth.",
                "evidence": evidence.component_scores,
            })

        return evidence


def analyze_readiness(
    content_structure: ContentStructureEvidence | dict[str, Any] | None = None,
    topic_semantics: TopicAnalysisEvidence | dict[str, Any] | None = None,
    entity_evidence: EntityAnalysisEvidence | dict[str, Any] | None = None,
    question_evidence: QuestionAnalysisEvidence | dict[str, Any] | None = None,
    answer_evidence: AnswerAnalysisEvidence | dict[str, Any] | None = None,
) -> AnswerReadinessEvidence:
    """Convenience function to analyze answer readiness."""
    analyzer = ReadinessAnalyzer()
    return analyzer.analyze(
        content_structure=content_structure,
        topic_semantics=topic_semantics,
        entity_evidence=entity_evidence,
        question_evidence=question_evidence,
        answer_evidence=answer_evidence,
    )
