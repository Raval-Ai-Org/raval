import os
import sys

_current_dir = os.path.dirname(os.path.abspath(__file__))
_project_root = os.path.dirname(_current_dir)
_backend_dir = os.path.join(_project_root, "backend")

if _project_root not in sys.path:
    sys.path.insert(0, _project_root)
if _backend_dir not in sys.path:
    sys.path.insert(0, _backend_dir)

from backend.app.opportunity_prioritization import (
    ALLOWED_OPPORTUNITY_CATEGORIES,
    ALLOWED_OPPORTUNITY_PRIORITIES,
    ALLOWED_OPPORTUNITY_STATUSES,
    PRIORITY_THRESHOLDS,
    calculate_opportunity_priority,
    category_and_type_to_effort,
    evidence_to_confidence,
    severity_to_impact,
)
from backend.app.opportunity_service import (
    create_opportunity,
    delete_opportunity,
    generate_opportunities_for_scan,
    generate_opportunities_for_website,
    generate_opportunity_from_ai_run,
    generate_opportunity_from_finding,
    generate_opportunity_from_page_intelligence,
    generate_opportunity_from_recommendation,
    get_finding_opportunities,
    get_opportunity,
    get_scan_opportunities,
    get_website_opportunities,
    list_opportunities,
    update_opportunity,
)

__all__ = [
    "ALLOWED_OPPORTUNITY_CATEGORIES",
    "ALLOWED_OPPORTUNITY_PRIORITIES",
    "ALLOWED_OPPORTUNITY_STATUSES",
    "PRIORITY_THRESHOLDS",
    "calculate_opportunity_priority",
    "category_and_type_to_effort",
    "evidence_to_confidence",
    "severity_to_impact",
    "create_opportunity",
    "delete_opportunity",
    "generate_opportunities_for_scan",
    "generate_opportunities_for_website",
    "generate_opportunity_from_finding",
    "generate_opportunity_from_recommendation",
    "generate_opportunity_from_page_intelligence",
    "generate_opportunity_from_ai_run",
    "get_finding_opportunities",
    "get_opportunity",
    "get_scan_opportunities",
    "get_website_opportunities",
    "list_opportunities",
    "update_opportunity",
]

