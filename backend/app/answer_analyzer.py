"""
Answer Analyzer (Task 5 - Step 8)

Evaluates answer presence, directness, snippet quality, and evidence
for detected questions on a page.
Adheres strictly to the principle: Evidence != conclusion.
"""

from dataclasses import asdict, dataclass, field
import re
from typing import Any

from .question_analyzer import QuestionAnalyzer, is_question_text


DIRECT_ANSWER_STARTERS = (
    "yes", "no", "is ", "are ", "refers to", "means ", "defined as",
    "typically", "generally", "consists of", "includes ", "designed to",
    "works by", "allows ", "provides ", "primarily", "first", "mainly",
)


def evaluate_answer_directness(text: str | None) -> tuple[str, float]:
    """
    Determine if text opens with a direct assertion or explanation.
    Returns (directness_category, directness_score):
    - ("direct", 1.0)
    - ("indirect", 0.5)
    - ("none", 0.0)
    """
    if not text or not text.strip():
        return "none", 0.0

    clean = text.strip().lower()
    first_sentence = re.split(r"[.?!]\s+", clean)[0]

    # Check for direct assertion starter patterns
    if any(first_sentence.startswith(starter) for starter in DIRECT_ANSWER_STARTERS):
        return "direct", 1.0

    # If first sentence contains definition or causal connector
    if any(k in first_sentence for k in (" because ", " due to ", " in order to ", " such as ")):
        return "direct", 1.0

    # Check if first sentence contains direct definitional or operational verb
    DEFINITION_VERBS = (
        " is ", " are ", " was ", " were ", " refers to ", " defined as ",
        " means ", " consists of ", " includes ", " provides ",
        " work by ", " works by ", " operate by ", " operates by ", " functions by ",
    )
    if any(verb in first_sentence for verb in DEFINITION_VERBS):
        return "direct", 0.9

    return "indirect", 0.5




@dataclass
class AnswerItem:
    question_text: str
    question_source: str  # "heading", "body", "faq_schema"
    question_position: int
    has_answer: bool
    answer_presence: str  # "confirmed", "partial", "absent"
    answer_text: str | None = None
    answer_location: str | None = None  # "adjacent_section", "same_paragraph", "faq_schema", "none"
    answer_word_count: int = 0
    directness: str = "none"  # "direct", "indirect", "none"
    directness_score: float = 0.0
    snippet_optimal_length: bool = False  # 20 to 80 words (Google/AEO snippet sweet spot)
    answer_quality_score: float = 0.0
    reason: str = ""


@dataclass
class AnswerAnalysisEvidence:
    total_questions: int = 0
    answered_questions: int = 0
    unanswered_questions: int = 0
    direct_answers_count: int = 0
    optimal_length_answers_count: int = 0
    overall_answer_rate: float = 0.0
    answers: list[dict[str, Any]] = field(default_factory=list)
    findings: list[dict[str, Any]] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class AnswerAnalyzer:
    """
    Analyzes questions to identify concrete answers, directness,
    location, snippet readiness, and quality metrics.
    """

    def analyze(
        self,
        questions_evidence: list[dict[str, Any]] | None = None,
        headings: list[Any] | None = None,
        sections: list[Any] | None = None,
        structured_data_blocks: list[Any] | None = None,
        text_content: str | None = None,
    ) -> AnswerAnalysisEvidence:
        evidence = AnswerAnalysisEvidence()

        # If questions weren't passed directly, extract them first
        if questions_evidence is None:
            q_analyzer = QuestionAnalyzer()
            q_res = q_analyzer.analyze(
                text_content=text_content,
                headings=headings,
                structured_data_blocks=structured_data_blocks,
                sections=sections,
            )
            questions_list = q_res.questions
        else:
            questions_list = questions_evidence

        evidence.total_questions = len(questions_list)
        evaluated_answers: list[AnswerItem] = []

        # Build lookup for sections by heading text
        section_lookup: dict[str, Any] = {}
        if sections:
            for s in sections:
                htxt = s.get("heading_text") if isinstance(s, dict) else getattr(s, "heading_text", None)
                if htxt:
                    section_lookup[str(htxt).strip().lower()] = s

        for q in questions_list:
            q_text = q.get("question_text", "")
            q_src = q.get("source_type", "heading")
            q_pos = q.get("position", 1)

            ans_item: AnswerItem | None = None

            # Case A: FAQ Schema
            if q_src == "faq_schema":
                has_ans = q.get("has_answer", False)
                ans_text = q.get("answer_snippet")
                wc = q.get("answer_word_count", 0)

                if has_ans and ans_text:
                    directness, d_score = evaluate_answer_directness(ans_text)
                    opt_len = 15 <= wc <= 90
                    q_score = round(0.4 * d_score + 0.3 * (1.0 if opt_len else 0.5) + 0.3, 2)
                    ans_item = AnswerItem(
                        question_text=q_text,
                        question_source=q_src,
                        question_position=q_pos,
                        has_answer=True,
                        answer_presence="confirmed",
                        answer_text=ans_text,
                        answer_location="faq_schema",
                        answer_word_count=wc,
                        directness=directness,
                        directness_score=d_score,
                        snippet_optimal_length=opt_len,
                        answer_quality_score=q_score,
                        reason="Verified structured answer declared in FAQPage Schema.",
                    )
                else:
                    ans_item = AnswerItem(
                        question_text=q_text,
                        question_source=q_src,
                        question_position=q_pos,
                        has_answer=False,
                        answer_presence="absent",
                        answer_location="none",
                        reason="FAQ Schema Question declared without acceptedAnswer text.",
                    )

            # Case B: Heading Question
            elif q_src == "heading":
                norm_q = q_text.strip().lower()
                sec = section_lookup.get(norm_q)

                if sec:
                    sec_wc = sec.get("word_count", 0) if isinstance(sec, dict) else getattr(sec, "word_count", 0)
                    sec_empty = sec.get("is_empty", False) if isinstance(sec, dict) else getattr(sec, "is_empty", False)
                    sec_lists = sec.get("has_lists", False) if isinstance(sec, dict) else getattr(sec, "has_lists", False)
                    sec_paragraphs = sec.get("paragraphs") if isinstance(sec, dict) else getattr(sec, "paragraphs", [])

                    if sec_empty or (sec_wc < 5 and not sec_lists):
                        ans_item = AnswerItem(
                            question_text=q_text,
                            question_source=q_src,
                            question_position=q_pos,
                            has_answer=False,
                            answer_presence="absent",
                            answer_location="none",
                            reason="Section following heading is empty or thinner than 5 words without lists.",
                        )
                    else:
                        snippet = ""
                        if sec_paragraphs:
                            snippet = str(sec_paragraphs[0])
                        else:
                            snippet = f"Content provided in adjacent section ({sec_wc} words)."

                        directness, d_score = evaluate_answer_directness(snippet)
                        opt_len = 20 <= sec_wc <= 85
                        q_score = round(0.4 * d_score + 0.3 * (1.0 if opt_len else 0.5) + 0.3, 2)

                        presence = "confirmed" if sec_wc >= 10 or sec_lists else "partial"

                        ans_item = AnswerItem(
                            question_text=q_text,
                            question_source=q_src,
                            question_position=q_pos,
                            has_answer=True,
                            answer_presence=presence,
                            answer_text=snippet[:200],
                            answer_location="adjacent_section",
                            answer_word_count=sec_wc,
                            directness=directness,
                            directness_score=d_score,
                            snippet_optimal_length=opt_len,
                            answer_quality_score=q_score,
                            reason="Adjacent section directly answers the heading query.",
                        )
                else:
                    # Fallback check on question evidence
                    if q.get("has_answer"):
                        ans_item = AnswerItem(
                            question_text=q_text,
                            question_source=q_src,
                            question_position=q_pos,
                            has_answer=True,
                            answer_presence="confirmed",
                            answer_text=q.get("answer_snippet"),
                            answer_location="adjacent_section",
                            answer_word_count=q.get("answer_word_count", 0),
                            directness="direct",
                            directness_score=0.8,
                            answer_quality_score=0.8,
                            reason="Answer detected in following section passage.",
                        )
                    else:
                        ans_item = AnswerItem(
                            question_text=q_text,
                            question_source=q_src,
                            question_position=q_pos,
                            has_answer=False,
                            answer_presence="absent",
                            answer_location="none",
                            reason="No following section or passage detected.",
                        )

            # Case C: Body Question
            else:
                has_ans = q.get("has_answer", False)
                ans_text = q.get("answer_snippet")
                wc = q.get("answer_word_count", 0)

                if has_ans and ans_text:
                    directness, d_score = evaluate_answer_directness(ans_text)
                    opt_len = 15 <= wc <= 80
                    q_score = round(0.4 * d_score + 0.3 * (1.0 if opt_len else 0.5) + 0.3, 2)
                    ans_item = AnswerItem(
                        question_text=q_text,
                        question_source=q_src,
                        question_position=q_pos,
                        has_answer=True,
                        answer_presence="confirmed",
                        answer_text=ans_text,
                        answer_location="same_paragraph",
                        answer_word_count=wc,
                        directness=directness,
                        directness_score=d_score,
                        snippet_optimal_length=opt_len,
                        answer_quality_score=q_score,
                        reason="Adjacent sentence in body paragraph provides explanation.",
                    )
                else:
                    ans_item = AnswerItem(
                        question_text=q_text,
                        question_source=q_src,
                        question_position=q_pos,
                        has_answer=False,
                        answer_presence="absent",
                        answer_location="none",
                        reason="In-text question followed by non-answer sentence or end of text.",
                    )

            if ans_item:
                evaluated_answers.append(ans_item)

        # Aggregate metrics
        evidence.answers = [asdict(a) for a in evaluated_answers]
        evidence.answered_questions = sum(1 for a in evaluated_answers if a.has_answer)
        evidence.unanswered_questions = sum(1 for a in evaluated_answers if not a.has_answer)
        evidence.direct_answers_count = sum(1 for a in evaluated_answers if a.directness == "direct")
        evidence.optimal_length_answers_count = sum(1 for a in evaluated_answers if a.snippet_optimal_length)

        if evidence.total_questions > 0:
            evidence.overall_answer_rate = round(evidence.answered_questions / evidence.total_questions, 2)

        # Generate Explainable Findings
        for a in evaluated_answers:
            if not a.has_answer:
                evidence.findings.append({
                    "type": "unanswered_question_detected",
                    "severity": "medium",
                    "title": f"Question '{a.question_text}' lacks an identifiable answer",
                    "description": f"The query '{a.question_text}' ({a.question_source}) has no accompanying explanatory response. Reason: {a.reason}",
                    "evidence": {
                        "question": a.question_text,
                        "source": a.question_source,
                        "position": a.question_position,
                    },
                })
            elif a.has_answer and a.directness == "direct" and a.snippet_optimal_length:
                evidence.findings.append({
                    "type": "snippet_optimized_answer",
                    "severity": "info",
                    "title": f"Snippet-ready answer for '{a.question_text}'",
                    "description": f"Found direct answer of optimal length ({a.answer_word_count} words) located in {a.answer_location}.",
                    "evidence": {
                        "question": a.question_text,
                        "answer_snippet": a.answer_text,
                        "word_count": a.answer_word_count,
                        "quality_score": a.answer_quality_score,
                    },
                })

        return evidence


def analyze_answers(
    questions_evidence: list[dict[str, Any]] | None = None,
    headings: list[Any] | None = None,
    sections: list[Any] | None = None,
    structured_data_blocks: list[Any] | None = None,
    text_content: str | None = None,
) -> AnswerAnalysisEvidence:
    """Convenience function to analyze answers."""
    analyzer = AnswerAnalyzer()
    return analyzer.analyze(
        questions_evidence=questions_evidence,
        headings=headings,
        sections=sections,
        structured_data_blocks=structured_data_blocks,
        text_content=text_content,
    )
