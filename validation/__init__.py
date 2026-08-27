"""
Validation Engine Package Façade
Re-exports Validation models, schemas, and services from backend.app.
"""

from backend.app.models import ValidationResult
from backend.app.schemas import (
    ValidationBatchResponse,
    ValidationCreate,
    ValidationResponse,
    ValidationRunRequest,
)
from backend.app.validation_service import (
    SUPPORTED_VALIDATION_TYPES,
    VALIDATION_RESULTS,
    VALIDATION_STATUSES,
    apply_validation_feedback,
    batch_validate_scan,
    batch_validate_website,
    create_validation,
    evaluate_validation_rule,
    get_validation,
    list_validations,
    validate_fix_plan,
    validate_recommendation,
)

__all__ = [
    "ValidationResult",
    "ValidationCreate",
    "ValidationResponse",
    "ValidationRunRequest",
    "ValidationBatchResponse",
    "SUPPORTED_VALIDATION_TYPES",
    "VALIDATION_RESULTS",
    "VALIDATION_STATUSES",
    "evaluate_validation_rule",
    "validate_fix_plan",
    "validate_recommendation",
    "create_validation",
    "get_validation",
    "list_validations",
    "batch_validate_scan",
    "batch_validate_website",
    "apply_validation_feedback",
]
