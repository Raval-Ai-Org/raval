"""
Readiness Analyzer Engine (Content Engine)
"""

import os
import sys

current_dir = os.path.dirname(os.path.abspath(__file__))
backend_dir = os.path.join(os.path.dirname(current_dir), "backend")
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from app.readiness_analyzer import (
    AnswerReadinessEvidence,
    ReadinessAnalyzer,
    analyze_readiness,
)

__all__ = [
    "AnswerReadinessEvidence",
    "ReadinessAnalyzer",
    "analyze_readiness",
]
