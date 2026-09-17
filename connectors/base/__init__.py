"""
Base Connector Package (Task 11 Step 1).
Exposes the core connector interfaces, models, capabilities, enums, errors, and security utilities.
"""

from .capabilities import ConnectorCapabilities
from .enums import (
    AuthState,
    ConnectorCapability,
    ConnectorErrorCode,
    ExecutionOperationType,
    ExecutionStatus,
    HealthStatus,
    ResourceType,
)
from .errors import (
    AuthenticationError,
    AuthorizationError,
    ConnectorErrorInfo,
    ConnectorException,
    ConnectorNetworkError,
    ConnectorTimeoutError,
    ConnectorValidationError,
    InvalidResourceError,
    ProviderAPIError,
    RateLimitExceededError,
    ResourceNotFoundError,
    UnsupportedOperationError,
)
from .interface import BaseConnector
from .models import (
    ChangePreview,
    ChangeProposal,
    ChangeResult,
    ConnectorHealth,
    OperationId,
    RateLimitInfo,
    ResourceContent,
    ResourceReference,
    SiteContext,
)
from .security import (
    redact_secrets_from_string,
    redact_sensitive_value,
    sanitize_payload,
    validate_safe_identifier,
)

__all__ = [
    # Interface
    "BaseConnector",
    # Enums
    "AuthState",
    "ConnectorCapability",
    "ConnectorErrorCode",
    "HealthStatus",
    "ExecutionStatus",
    "ResourceType",
    "ExecutionOperationType",
    # Capabilities
    "ConnectorCapabilities",
    # Errors & Exceptions
    "ConnectorErrorInfo",
    "ConnectorException",
    "AuthenticationError",
    "AuthorizationError",
    "UnsupportedOperationError",
    "ResourceNotFoundError",
    "InvalidResourceError",
    "RateLimitExceededError",
    "ConnectorTimeoutError",
    "ProviderAPIError",
    "ConnectorNetworkError",
    "ConnectorValidationError",
    # Models
    "RateLimitInfo",
    "ResourceReference",
    "OperationId",
    "ConnectorHealth",
    "SiteContext",
    "ResourceContent",
    "ChangeProposal",
    "ChangePreview",
    "ChangeResult",
    # Security
    "redact_secrets_from_string",
    "redact_sensitive_value",
    "sanitize_payload",
    "validate_safe_identifier",
]
