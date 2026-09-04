"""
WordPress Connector Subsystem for Raval AI (Task 11 Step 3).

Exposes WordPressConnector, REST client protocols, mocks, and models.
"""

from connectors.wordpress.client import (
    LiveWordPressClient,
    MockWordPressClient,
    WordPressClientProtocol,
)
from connectors.wordpress.connector import WordPressConnector
from connectors.wordpress.diff import (
    apply_proposal_to_resource,
    generate_field_diff,
    validate_pre_apply_drift,
)
from connectors.wordpress.models import (
    WordPressMediaInfo,
    WordPressOperationRecord,
    WordPressResourceInfo,
    WordPressSiteIdentity,
    WordPressUserCapability,
)
from connectors.wordpress.security import (
    assert_safe_wordpress_content,
    normalize_wordpress_url,
    validate_user_permission_for_mutation,
    validate_wordpress_mutation_field,
    validate_wordpress_target_resource,
)

__all__ = [
    "WordPressConnector",
    "WordPressClientProtocol",
    "MockWordPressClient",
    "LiveWordPressClient",
    "WordPressSiteIdentity",
    "WordPressUserCapability",
    "WordPressResourceInfo",
    "WordPressMediaInfo",
    "WordPressOperationRecord",
    "normalize_wordpress_url",
    "validate_wordpress_target_resource",
    "validate_wordpress_mutation_field",
    "assert_safe_wordpress_content",
    "validate_user_permission_for_mutation",
    "generate_field_diff",
    "apply_proposal_to_resource",
    "validate_pre_apply_drift",
]
