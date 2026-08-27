"""
Analytics & Monitoring Package Façade (Task 6.10)
Re-exports monitoring models, schemas, and services from backend.app.
"""

import os
import sys

_current_dir = os.path.dirname(os.path.abspath(__file__))
_project_root = os.path.dirname(_current_dir)
_backend_dir = os.path.join(_project_root, "backend")

if _project_root not in sys.path:
    sys.path.insert(0, _project_root)
if _backend_dir not in sys.path:
    sys.path.insert(0, _backend_dir)

from backend.app.models import MonitoringRecord
from backend.app.schemas import (
    MonitoringRecordCreate,
    MonitoringRecordResponse,
    MonitoringTimelineResponse,
    WebsiteHealthSummaryResponse,
)
from backend.app.monitoring_service import (
    SUPPORTED_METRIC_CATEGORIES,
    evaluate_scan_monitoring,
    evaluate_website_monitoring,
    get_monitoring_timeline,
    get_website_health_status,
    record_metric,
)

__all__ = [
    "MonitoringRecord",
    "MonitoringRecordCreate",
    "MonitoringRecordResponse",
    "MonitoringTimelineResponse",
    "WebsiteHealthSummaryResponse",
    "SUPPORTED_METRIC_CATEGORIES",
    "record_metric",
    "evaluate_scan_monitoring",
    "evaluate_website_monitoring",
    "get_monitoring_timeline",
    "get_website_health_status",
]
