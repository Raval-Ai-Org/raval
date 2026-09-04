"""
Security Subsystem for Raval AI Connectors (Task 11 Step 6).

Provides:
- Authorization context and workspace/tenant isolation
- SSRF prevention and IP range validation
- Security boundary and injection protections
- Deep recursive secret and credential scrubbing
"""

from .authz import (
    AuthorizationContext,
    AuthorizationDecision,
    AuthorizationManager,
    PermissionType,
)
from .boundaries import SecurityBoundaryValidator
from .scrubber import (
    DeepScrubber,
    redact_credentials_from_url,
    sanitize_nested_data,
)
from .ssrf import SSRFValidator, SSRFValidationError

__all__ = [
    "AuthorizationContext",
    "AuthorizationDecision",
    "AuthorizationManager",
    "PermissionType",
    "SecurityBoundaryValidator",
    "DeepScrubber",
    "redact_credentials_from_url",
    "sanitize_nested_data",
    "SSRFValidator",
    "SSRFValidationError",
]
