"""
Content Quality Checks Engine (Content Engine)
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

from backend.app.content_quality_checks import (
    ContentQualityChecker,
    ContentQualityChecksResult,
    run_content_quality_checks,
)

__all__ = [
    "ContentQualityChecker",
    "ContentQualityChecksResult",
    "run_content_quality_checks",
]
