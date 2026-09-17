"""
Normalized Enums for Raval AI Website Connector Subsystem (Task 11 Step 1).

Defines provider-neutral enums for authentication states, connector capabilities,
standardized error codes, health ratings, execution lifecycle statuses, and resource categories.
"""

from enum import Enum


class AuthState(str, Enum):
    """Normalized authentication states for external website/CMS/Git connectors."""
    DISCONNECTED = "DISCONNECTED"
    CONNECTING = "CONNECTING"
    CONNECTED = "CONNECTED"
    AUTH_FAILED = "AUTH_FAILED"
    EXPIRED = "EXPIRED"
    REVOKED = "REVOKED"


class ConnectorCapability(str, Enum):
    """
    Normalized operational capabilities supported by connectors.
    Connectors must explicitly declare their supported capability set.
    """
    READ = "READ"
    PREVIEW = "PREVIEW"
    APPLY = "APPLY"
    ROLLBACK = "ROLLBACK"
    STATUS = "STATUS"
    HEALTH_CHECK = "HEALTH_CHECK"
    BATCH_READ = "BATCH_READ"


class ConnectorErrorCode(str, Enum):
    """Normalized error classification codes across all connector providers."""
    AUTHENTICATION_FAILURE = "AUTHENTICATION_FAILURE"
    AUTHENTICATION_FAILED = "AUTHENTICATION_FAILED"
    AUTHORIZATION_FAILURE = "AUTHORIZATION_FAILURE"
    AUTHORIZATION_DENIED = "AUTHORIZATION_DENIED"
    UNSUPPORTED_OPERATION = "UNSUPPORTED_OPERATION"
    INVALID_RESOURCE = "INVALID_RESOURCE"
    INVALID_TARGET = "INVALID_TARGET"
    UNSAFE_OPERATION = "UNSAFE_OPERATION"
    RESOURCE_NOT_FOUND = "RESOURCE_NOT_FOUND"
    VALIDATION_FAILURE = "VALIDATION_FAILURE"
    VALIDATION_FAILED = "VALIDATION_FAILED"
    REGRESSION = "REGRESSION"
    ROLLBACK_FAILED = "ROLLBACK_FAILED"
    MANUAL_REVIEW_REQUIRED = "MANUAL_REVIEW_REQUIRED"
    RATE_LIMITED = "RATE_LIMITED"
    TIMEOUT = "TIMEOUT"
    PROVIDER_ERROR = "PROVIDER_ERROR"
    CONNECTOR_UNAVAILABLE = "CONNECTOR_UNAVAILABLE"
    NETWORK_ERROR = "NETWORK_ERROR"
    CONFLICT = "CONFLICT"
    UNKNOWN_ERROR = "UNKNOWN_ERROR"
    UNKNOWN = "UNKNOWN"


class HealthStatus(str, Enum):
    """Normalized health status classification for connector targets."""
    HEALTHY = "HEALTHY"
    DEGRADED = "DEGRADED"
    UNHEALTHY = "UNHEALTHY"
    UNKNOWN = "UNKNOWN"


class ExecutionStatus(str, Enum):
    """Lifecycle statuses for safe fix execution and change application."""
    PENDING = "PENDING"
    PREVIEWED = "PREVIEWED"
    IN_PROGRESS = "IN_PROGRESS"
    APPLIED = "APPLIED"
    ROLLED_BACK = "ROLLED_BACK"
    FAILED = "FAILED"
    REJECTED = "REJECTED"
    CANCELLED = "CANCELLED"


class ResourceType(str, Enum):
    """Normalized resource classification across CMS, Git, and direct web targets."""
    WEBSITE_PAGE = "website_page"
    CMS_POST = "cms_post"
    CMS_PAGE = "cms_page"
    GIT_FILE = "git_file"
    GIT_REPOSITORY = "git_repository"
    ROBOTS_TXT = "robots_txt"
    SITEMAP = "sitemap"
    STRUCTURED_DATA = "structured_data"
    META_TAGS = "meta_tags"
    GENERIC_RESOURCE = "generic_resource"


class ExecutionOperationType(str, Enum):
    """Standardized connector operation types."""
    CONNECT = "connect"
    DISCONNECT = "disconnect"
    HEALTH_CHECK = "health_check"
    GET_SITE_CONTEXT = "get_site_context"
    READ_RESOURCE = "read_resource"
    PREVIEW_CHANGE = "preview_change"
    APPLY_CHANGE = "apply_change"
    ROLLBACK_CHANGE = "rollback_change"
    GET_CHANGE_STATUS = "get_change_status"
