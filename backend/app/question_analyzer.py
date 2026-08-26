"""
Question Analyzer (Task 5 - Step 7)

Detects question-oriented content, question headings, FAQ structured data,
and deterministically evaluates answer-readiness and missing answers.
"""

from dataclasses import asdict, dataclass, field
import re
from typing import Any


QUESTION_WORDS = {
    "who", "what", "where", "when", "why", "how",
    "can", "is", "are", "does", "do", "should", "which",
    "will", "could", "would", "isn't", "aren't", "don't",
}


def is_question_text(text: str | None) -> bool:
    """Check if a string represents a substantive interrogative question."""
    if not text:
        return False
    stripped = text.strip()
    if not stripped:
        return False

    words = re.findall(r"\b[a-zA-Z]+\b", stripped.lower())
    if len(words) < 3:
        return False

    # Ignore UI/cookie prompts
    if any(ui in stripped.lower() for ui in ("cookie", "javascript", "log in", "sign in", "accept")):
        return False

    if stripped.endswith("?"):
        return True

    if words and words[0] in QUESTION_WORDS and len(words) >= 3:
        return True

    return False



@dataclass
class DetectedQuestionItem:
    question_text: str
    source_type: str  # "heading", "body", "faq_schema"
    position: int
    heading_level: int | None = None
    has_answer: bool = False
    answer_snippet: str | None = None
    answer_word_count: int = 0
    missing_answer_signal: bool = False


@dataclass
class QuestionAnalysisEvidence:
    question_count: int = 0
    answered_question_count: int = 0
    unanswered_question_count: int = 0
    faq_schema_present: bool = False
    answer_readiness_score: float = 0.0
    questions: list[dict[str, Any]] = field(default_factory=list)
    findings: list[dict[str, Any]] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class QuestionAnalyzer:
    """
    Analyzes page content, headings, and structured data to detect questions
    and evaluate their answer presence.
    """

    def analyze(
        self,
        text_content: str | None = None,
        headings: list[Any] | None = None,
        structured_data_blocks: list[Any] | None = None,
        sections: list[Any] | None = None,
    ) -> QuestionAnalysisEvidence:
        evidence = QuestionAnalysisEvidence()
        detected_questions: list[DetectedQuestionItem] = []
        q_pos = 0

        # 1. Detect Questions from Headings
        if headings:
            # Map headings to their following sections if available
            sections_by_heading: dict[str, Any] = {}
            if sections:
                for s in sections:
                    htxt = s.get("heading_text") if isinstance(s, dict) else getattr(s, "heading_text", None)
                    if htxt:
                        sections_by_heading[htxt.strip().lower()] = s

            for idx, h in enumerate(headings):
                lvl = h.get("level", 1) if isinstance(h, dict) else getattr(h, "level", 1)
                txt = h.get("text", "") if isinstance(h, dict) else getattr(h, "text", "")
                if not txt or not str(txt).strip():
                    continue

                clean_txt = str(txt).strip()
                if is_question_text(clean_txt):
                    q_pos += 1
                    # Check for answer in following section
                    norm_key = clean_txt.lower()
                    sec = sections_by_heading.get(norm_key)

                    has_ans = False
                    ans_snip = None
                    ans_words = 0
                    missing_ans = False

                    if sec:
                        sec_wc = sec.get("word_count", 0) if isinstance(sec, dict) else getattr(sec, "word_count", 0)
                        sec_empty = sec.get("is_empty", False) if isinstance(sec, dict) else getattr(sec, "is_empty", False)
                        sec_thin = sec.get("is_thin", False) if isinstance(sec, dict) else getattr(sec, "is_thin", False)
                        sec_lists = sec.get("has_lists", False) if isinstance(sec, dict) else getattr(sec, "has_lists", False)

                        if sec_empty or (sec_wc < 5 and not sec_lists):
                            missing_ans = True
                        elif sec_wc >= 5 or sec_lists:
                            has_ans = True
                            ans_words = sec_wc
                            ans_snip = f"Answer provided in {sec_wc} words."
                    else:
                        # If sections weren't pre-computed, check if there's following body text
                        # Conservative fallback: if there is text in the page, check for direct proximity
                        has_ans = False

                    detected_questions.append(DetectedQuestionItem(
                        question_text=clean_txt,
                        source_type="heading",
                        position=q_pos,
                        heading_level=lvl,
                        has_answer=has_ans,
                        answer_snippet=ans_snip,
                        answer_word_count=ans_words,
                        missing_answer_signal=missing_ans,
                    ))

        # 2. Detect FAQPage / QAPage in Structured Data
        if structured_data_blocks:
            for block in structured_data_blocks:
                parsed = None
                if isinstance(block, dict):
                    parsed = block.get("parsed_json") or block
                elif hasattr(block, "parsed_json") and block.parsed_json:
                    parsed = block.parsed_json

                if parsed:
                    self._extract_faq_schema(parsed, detected_questions)

        evidence.faq_schema_present = any(q.source_type == "faq_schema" for q in detected_questions)

        # 3. Detect In-Content Questions
        if text_content and text_content.strip():
            # Split text by sentence terminators
            sentences = re.split(r"(?<=[.?!])\s+", text_content.strip())
            for idx, sent in enumerate(sentences):
                clean_sent = sent.strip()
                if clean_sent.endswith("?") and len(clean_sent.split()) >= 4:
                    # Check that this wasn't already captured as a heading
                    if not any(clean_sent.lower() in q.question_text.lower() for q in detected_questions):
                        q_pos += 1
                        # Check following sentence for answer candidate
                        has_ans = False
                        ans_snip = None
                        ans_words = 0
                        if idx + 1 < len(sentences):
                            next_sent = sentences[idx + 1].strip()
                            if next_sent and not next_sent.endswith("?") and len(next_sent.split()) >= 5:
                                has_ans = True
                                ans_words = len(next_sent.split())
                                ans_snip = next_sent[:150]

                        detected_questions.append(DetectedQuestionItem(
                            question_text=clean_sent,
                            source_type="body",
                            position=q_pos,
                            has_answer=has_ans,
                            answer_snippet=ans_snip,
                            answer_word_count=ans_words,
                            missing_answer_signal=not has_ans,
                        ))

        # Compile summaries
        evidence.question_count = len(detected_questions)
        evidence.answered_question_count = sum(1 for q in detected_questions if q.has_answer)
        evidence.unanswered_question_count = sum(1 for q in detected_questions if not q.has_answer)
        evidence.questions = [asdict(q) for q in detected_questions]

        if evidence.question_count > 0:
            evidence.answer_readiness_score = round(
                evidence.answered_question_count / evidence.question_count, 2
            )
        else:
            evidence.answer_readiness_score = 0.0

        # Generate Explainable Findings
        unanswered_headings = [
            q for q in detected_questions if q.source_type == "heading" and q.missing_answer_signal
        ]
        if unanswered_headings:
            evidence.findings.append({
                "type": "unanswered_question_heading",
                "severity": "medium",
                "title": f"Question heading '{unanswered_headings[0].question_text}' lacks immediate answer",
                "description": f"Detected {len(unanswered_headings)} question heading(s) followed by empty or thin content without a direct answer passage.",
                "evidence": {
                    "unanswered_questions": [q.question_text for q in unanswered_headings],
                },
            })

        if evidence.question_count >= 3 and not evidence.faq_schema_present:
            evidence.findings.append({
                "type": "faq_schema_opportunity",
                "severity": "low",
                "title": "Opportunity to implement FAQPage structured data",
                "description": f"Page contains {evidence.question_count} questions but does not declare FAQPage Schema.org markup to qualify for rich search snippets.",
                "evidence": {"question_count": evidence.question_count},
            })

        if evidence.answered_question_count >= 1:
            evidence.findings.append({
                "type": "answer_ready_content",
                "severity": "info",
                "title": "Answer-ready content detected",
                "description": f"Identified {evidence.answered_question_count} question(s) with directly adjacent explanatory answer content.",
                "evidence": {
                    "answered_count": evidence.answered_question_count,
                    "readiness_score": evidence.answer_readiness_score,
                },
            })

        return evidence

    def _extract_faq_schema(
        self,
        data: Any,
        questions: list[DetectedQuestionItem],
    ) -> None:
        if isinstance(data, list):
            for item in data:
                self._extract_faq_schema(item, questions)
            return

        if not isinstance(data, dict):
            return

        raw_type = str(data.get("@type", "")).lower()
        if "faqpage" in raw_type or "qapage" in raw_type:
            main_entity = data.get("mainEntity")
            if isinstance(main_entity, list):
                for q_obj in main_entity:
                    if isinstance(q_obj, dict):
                        self._parse_single_question_object(q_obj, questions)
            elif isinstance(main_entity, dict):
                self._parse_single_question_object(main_entity, questions)

        # Also check direct Question objects
        if raw_type == "question":
            self._parse_single_question_object(data, questions)

    def _parse_single_question_object(
        self,
        q_obj: dict,
        questions: list[DetectedQuestionItem],
    ) -> None:
        q_name = q_obj.get("name")
        if q_name and isinstance(q_name, str) and str(q_name).strip():
            clean_q = str(q_name).strip()

            accepted_ans = q_obj.get("acceptedAnswer") or q_obj.get("suggestedAnswer")
            ans_text = None
            if isinstance(accepted_ans, dict):
                ans_text = accepted_ans.get("text")
            elif isinstance(accepted_ans, str):
                ans_text = accepted_ans

            has_ans = bool(ans_text and str(ans_text).strip())
            words = len(str(ans_text).split()) if has_ans else 0
            snippet = str(ans_text)[:150] if has_ans else None

            questions.append(DetectedQuestionItem(
                question_text=clean_q,
                source_type="faq_schema",
                position=len(questions) + 1,
                has_answer=has_ans,
                answer_snippet=snippet,
                answer_word_count=words,
                missing_answer_signal=not has_ans,
            ))


def analyze_questions(
    text_content: str | None = None,
    headings: list[Any] | None = None,
    structured_data_blocks: list[Any] | None = None,
    sections: list[Any] | None = None,
) -> QuestionAnalysisEvidence:
    """Convenience function to analyze questions."""
    analyzer = QuestionAnalyzer()
    return analyzer.analyze(
        text_content=text_content,
        headings=headings,
        structured_data_blocks=structured_data_blocks,
        sections=sections,
    )
