"""
Content Engine (Raval AI GEO / AEO / SEO Intelligence)
"""

import os
import sys

# Ensure backend directory is discoverable
current_dir = os.path.dirname(os.path.abspath(__file__))
backend_dir = os.path.join(os.path.dirname(current_dir), "backend")
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from app.content_structure_analyzer import (
    ContentStructureAnalyzer,
    ContentStructureEvidence,
    analyze_content_structure,
    evaluate_title_h1_alignment,
)

__all__ = [
    "ContentStructureAnalyzer",
    "ContentStructureEvidence",
    "analyze_content_structure",
    "evaluate_title_h1_alignment",
]
