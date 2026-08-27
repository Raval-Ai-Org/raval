import os
import sys

_current_dir = os.path.dirname(os.path.abspath(__file__))
_project_root = os.path.dirname(_current_dir)
_backend_dir = os.path.join(_project_root, "backend")

if _project_root not in sys.path:
    sys.path.insert(0, _project_root)
if _backend_dir not in sys.path:
    sys.path.insert(0, _backend_dir)

from backend.app.models import FixPlan
from backend.app.fix_service import (
    ALLOWED_EFFORT_LEVELS,
    ALLOWED_FIX_STATUSES,
    ALLOWED_FIX_TYPES,
    ALLOWED_RISK_LEVELS,
    ALLOWED_STATUS_TRANSITIONS,
    create_fix_plan,
    delete_fix_plan,
    generate_fix_plan_from_recommendation,
    generate_fix_plans_for_scan,
    generate_fix_plans_for_website,
    get_fix_plan,
    list_fix_plans,
    transition_fix_plan_status,
    update_fix_plan,
)

__all__ = [
    "FixPlan",
    "ALLOWED_EFFORT_LEVELS",
    "ALLOWED_FIX_STATUSES",
    "ALLOWED_FIX_TYPES",
    "ALLOWED_RISK_LEVELS",
    "ALLOWED_STATUS_TRANSITIONS",
    "create_fix_plan",
    "delete_fix_plan",
    "generate_fix_plan_from_recommendation",
    "generate_fix_plans_for_scan",
    "generate_fix_plans_for_website",
    "get_fix_plan",
    "list_fix_plans",
    "transition_fix_plan_status",
    "update_fix_plan",
]
