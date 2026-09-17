"""
GitHub Connector Subpackage (Task 11 Step 2).

Exposes GitHubConnector, security validation helpers, client interfaces, diff utilities, and metadata models.
"""

from .client import (
    GitHubClientProtocol,
    LiveGitHubClient,
    MockGitHubClient,
)
from .connector import GitHubConnector
from .diff import (
    apply_proposal_to_content,
    generate_structured_diff,
    generate_unified_diff,
    validate_pre_commit_state,
)
from .models import (
    GitHubBranchInfo,
    GitHubCommitInfo,
    GitHubFileInfo,
    GitHubOperationRecord,
    GitHubPRInfo,
    GitHubRepoRef,
)
from .security import (
    ALLOWLISTED_EXTENSIONS,
    ALLOWLISTED_NAMED_FILES,
    DENYLISTED_PATH_PATTERNS,
    PROTECTED_BRANCH_NAMES,
    assert_safe_mutation_target,
    is_safe_file_path,
    normalize_github_path,
    validate_branch_name,
    validate_github_path,
)

__all__ = [
    # Main Connector
    "GitHubConnector",
    # Client Abstractions
    "GitHubClientProtocol",
    "MockGitHubClient",
    "LiveGitHubClient",
    # Models
    "GitHubRepoRef",
    "GitHubBranchInfo",
    "GitHubFileInfo",
    "GitHubCommitInfo",
    "GitHubPRInfo",
    "GitHubOperationRecord",
    # Security
    "normalize_github_path",
    "validate_github_path",
    "is_safe_file_path",
    "assert_safe_mutation_target",
    "validate_branch_name",
    "PROTECTED_BRANCH_NAMES",
    "DENYLISTED_PATH_PATTERNS",
    "ALLOWLISTED_EXTENSIONS",
    "ALLOWLISTED_NAMED_FILES",
    # Diff & Patch
    "generate_unified_diff",
    "generate_structured_diff",
    "apply_proposal_to_content",
    "validate_pre_commit_state",
]
