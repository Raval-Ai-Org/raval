"""
Entity Engine (Raval AI GEO / AEO / SEO Intelligence)
"""

import os
import sys

current_dir = os.path.dirname(os.path.abspath(__file__))
backend_dir = os.path.join(os.path.dirname(current_dir), "backend")
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from app.entity_analyzer import (
    EntityAnalysisEvidence,
    EntityAnalyzer,
    analyze_entities,
)

__all__ = [
    "EntityAnalysisEvidence",
    "EntityAnalyzer",
    "analyze_entities",
]
