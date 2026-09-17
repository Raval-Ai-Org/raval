"""
Readiness Analyzer Engine (Content Engine)
"""

import os
import sys

current_dir = os.path.dirname(os.path.abspath(__file__))
project_root = os.path.dirname(current_dir)
backend_dir = os.path.join(project_root, "backend")

if project_root not in sys.path:
    sys.path.insert(0, project_root)
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from backend.app.readiness_analyzer import (
    AnswerReadinessEvidence,
    ReadinessAnalyzer,
    analyze_readiness,
)

__all__ = [
    "AnswerReadinessEvidence",
    "ReadinessAnalyzer",
    "analyze_readiness",
]
