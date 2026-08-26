"""Technical SEO & Indexability Intelligence engine (Task 5).

Pure-logic layer that turns the Task 4 structured extraction evidence into
page-specific, evidence-backed, severity-classified findings. This package must
stay free of database sessions, FastAPI, and model writes — it consumes a
``RuleContext`` (built by the persistence/service layer) and returns in-memory
``RuleFinding`` DTOs, mirroring how ``page_extractor.extract_html`` is a pure
function while ``services.run_scan`` owns persistence.
"""

from .base import (
    RULE_REGISTRY,
    RuleContext,
    RuleFinding,
    ScanContext,
    register,
)
from .engine import build_summary, run_page_rules

__all__ = [
    "RULE_REGISTRY",
    "RuleContext",
    "RuleFinding",
    "ScanContext",
    "register",
    "run_page_rules",
    "build_summary",
]
