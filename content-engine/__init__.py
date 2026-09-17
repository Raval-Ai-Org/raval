import os
import sys

_current_dir = os.path.dirname(os.path.abspath(__file__))
_project_root = os.path.dirname(_current_dir)
_backend_dir = os.path.join(_project_root, "backend")

if _project_root not in sys.path:
    sys.path.insert(0, _project_root)
if _backend_dir not in sys.path:
    sys.path.insert(0, _backend_dir)

from backend.app.answer_analyzer import (
    AnswerAnalysisEvidence,
    AnswerAnalyzer,
    analyze_answers,
)
from backend.app.content_gap_analyzer import (
    ContentGapEvidence,
    ContentGapAnalyzer,
    analyze_content_gaps,
)
from backend.app.content_intelligence_analyzer import (
    ContentIntelligenceAnalyzer,
    ContentIntelligenceSummary,
    analyze_content_intelligence,
)
from backend.app.content_quality_checks import (
    ContentQualityChecker,
    ContentQualityChecksResult,
    run_content_quality_checks,
)
from backend.app.intent_analyzer import (
    IntentAnalysisEvidence,
    IntentAnalyzer,
    analyze_intent,
)
from backend.app.quality_analyzer import (
    QualityAnalysisEvidence,
    QualityAnalyzer,
    analyze_quality,
)
from backend.app.question_analyzer import (
    QuestionAnalysisEvidence,
    QuestionAnalyzer,
    analyze_questions,
)
from backend.app.readiness_analyzer import (
    AnswerReadinessEvidence,
    ReadinessAnalyzer,
    analyze_readiness,
)
from backend.app.semantic_coverage_analyzer import (
    SemanticCoverageEvidence,
    SemanticCoverageAnalyzer,
    analyze_semantic_coverage,
)
from backend.app.content_structure_analyzer import (
    ContentStructureAnalyzer,
    ContentStructureEvidence,
    analyze_content_structure,
    evaluate_title_h1_alignment,
)
from backend.app.topic_analyzer import (
    TopicAnalysisEvidence,
    TopicSemanticAnalyzer,
    analyze_topic_semantics,
)

__all__ = [
    "ContentStructureAnalyzer",
    "ContentStructureEvidence",
    "analyze_content_structure",
    "evaluate_title_h1_alignment",
    "TopicAnalysisEvidence",
    "TopicSemanticAnalyzer",
    "analyze_topic_semantics",
    "QuestionAnalysisEvidence",
    "QuestionAnalyzer",
    "analyze_questions",
    "AnswerAnalysisEvidence",
    "AnswerAnalyzer",
    "analyze_answers",
    "AnswerReadinessEvidence",
    "ReadinessAnalyzer",
    "analyze_readiness",
    "ContentGapEvidence",
    "ContentGapAnalyzer",
    "analyze_content_gaps",
    "QualityAnalysisEvidence",
    "QualityAnalyzer",
    "analyze_quality",
    "IntentAnalysisEvidence",
    "IntentAnalyzer",
    "analyze_intent",
    "SemanticCoverageEvidence",
    "SemanticCoverageAnalyzer",
    "analyze_semantic_coverage",
    "ContentIntelligenceAnalyzer",
    "ContentIntelligenceSummary",
    "analyze_content_intelligence",
    "ContentQualityChecker",
    "ContentQualityChecksResult",
    "run_content_quality_checks",
]
