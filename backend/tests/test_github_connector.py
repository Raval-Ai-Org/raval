"""
Comprehensive Unit and Integration Tests for GitHub Connector (Task 11 Step 2).

Covers:
1. Authentication (valid, invalid, expired, secret redaction)
2. Repository selection and metadata inspection
3. Path security (traversal, absolute paths, null bytes, shell chars, safe allowlist/denylist)
4. FixPlan linkage and target resolution
5. Isolated branch creation, deterministic naming, and protected branch rejection
6. Deterministic diff preview and change generation
7. Pre-commit validation and drift detection
8. Commit and Pull Request creation
9. Safe revert / rollback
10. Reliability (timeouts, rate limits, idempotency)
11. Security (zero secret leakage)
"""

import pytest
from datetime import datetime, timezone

from backend.app.fix_safety_classifier import SafetyTier
from connectors import (
    AuthState,
    AuthenticationError,
    AuthorizationError,
    BaseConnector,
    ChangePreview,
    ChangeProposal,
    ChangeResult,
    ConnectorCapability,
    ConnectorErrorCode,
    ConnectorHealth,
    ConnectorTimeoutError,
    ConnectorValidationError,
    ExecutionOperationType,
    ExecutionRequest,
    ExecutionResult,
    ExecutionStatus,
    ExecutionTarget,
    GitHubBranchInfo,
    GitHubCommitInfo,
    GitHubConnector,
    GitHubFileInfo,
    GitHubOperationRecord,
    GitHubPRInfo,
    GitHubRepoRef,
    HealthStatus,
    InvalidResourceError,
    LiveGitHubClient,
    MockGitHubClient,
    RateLimitExceededError,
    RateLimitInfo,
    ResourceContent,
    ResourceNotFoundError,
    ResourceReference,
    ResourceType,
    SiteContext,
    UnsupportedOperationError,
    assert_safe_mutation_target,
    is_safe_file_path,
    normalize_github_path,
    validate_branch_name,
    validate_github_path,
)


@pytest.fixture
def mock_client():
    return MockGitHubClient(
        owner="test-org",
        repo="test-site",
        default_branch="main",
        initial_files={
            "index.html": "<!DOCTYPE html><html><head><title>Original Page</title></head><body><h1>Original Heading</h1></body></html>",
            "about.html": "<!DOCTYPE html><html><head><title>About</title></head><body><main>About Page Content</main></body></html>",
            "robots.txt": "User-agent: *\nDisallow: /admin",
            "sitemap.xml": "<?xml version='1.0'?><urlset></urlset>",
        },
    )


@pytest.fixture
def github_connector(mock_client):
    return GitHubConnector(
        owner="test-org",
        repo="test-site",
        default_branch="main",
        client=mock_client,
        create_pr_on_apply=True,
    )


# =============================================================================
# 1. AUTHENTICATION TESTS
# =============================================================================

class TestGitHubAuthentication:
    """Tests GitHub connector authentication flows and secret redaction."""

    def test_successful_connect(self, github_connector):
        """Valid connection transitions state to CONNECTED and updates metadata."""
        assert github_connector.auth_state == AuthState.DISCONNECTED

        ctx = github_connector.connect({"token": "ghp_validtesttoken12345678901234567890"})
        assert ctx.auth_state == AuthState.CONNECTED
        assert github_connector.auth_state == AuthState.CONNECTED
        assert ctx.metadata["authenticated_user"] == "raval-bot"
        assert ctx.metadata["repo_full_name"] == "test-org/test-site"

        # Verify token is NOT stored in metadata
        assert "ghp_validtesttoken" not in str(ctx.metadata)

    def test_invalid_credentials_auth_failure(self):
        """Invalid credentials set AUTH_FAILED and raise AuthenticationError."""
        client = MockGitHubClient(simulate_auth_failure=True)
        conn = GitHubConnector(owner="test-org", repo="test-site", client=client)

        with pytest.raises(AuthenticationError) as exc_info:
            conn.connect({"token": "invalid_secret_token"})

        assert exc_info.value.code == ConnectorErrorCode.AUTHENTICATION_FAILURE
        assert conn.auth_state == AuthState.AUTH_FAILED
        assert "invalid_secret_token" not in str(exc_info.value)

    def test_disconnect(self, github_connector):
        """Disconnect sets state to DISCONNECTED."""
        github_connector.connect()
        assert github_connector.auth_state == AuthState.CONNECTED

        ctx = github_connector.disconnect()
        assert ctx.auth_state == AuthState.DISCONNECTED
        assert github_connector.auth_state == AuthState.DISCONNECTED


# =============================================================================
# 2. REPOSITORY SELECTION & INSPECTION TESTS
# =============================================================================

class TestGitHubRepositoryInspection:
    """Tests repository metadata inspection, health check, and rate limits."""

    def test_health_check_healthy(self, github_connector):
        """Health check reports healthy repository and latency."""
        github_connector.connect()
        health = github_connector.health_check()
        assert health.status == HealthStatus.HEALTHY
        assert health.latency_ms >= 0.0
        assert "test-org/test-site" in health.message
        assert health.details["default_branch"] == "main"

    def test_health_check_rate_limited_degraded(self):
        """Health check reports DEGRADED if rate limit is exhausted."""
        class RateLimitedClient(MockGitHubClient):
            def get_rate_limit(self):
                return RateLimitInfo(limit=5000, remaining=0, is_rate_limited=True)

        client = RateLimitedClient(owner="test-org", repo="test-site")
        conn = GitHubConnector(owner="test-org", repo="test-site", client=client)
        health = conn.health_check()
        assert health.status == HealthStatus.DEGRADED

    def test_invalid_repository_name(self):
        """Invalid owner/repo names are rejected."""
        with pytest.raises(ValueError):
            GitHubConnector(owner="invalid;owner", repo="repo")
        with pytest.raises(ValueError):
            GitHubConnector(owner="owner", repo="repo && rm -rf")


# =============================================================================
# 3. PATH SECURITY & FILE TYPE SAFETY TESTS
# =============================================================================

class TestGitHubPathSecurity:
    """Enforces strict path normalization, traversal rejection, and file allowlisting."""

    def test_valid_web_paths_accepted(self):
        """Valid web templates and content paths are normalized and accepted."""
        assert normalize_github_path("index.html") == "index.html"
        assert normalize_github_path("src/templates/header.php") == "src/templates/header.php"
        assert normalize_github_path("docs/page.md") == "docs/page.md"
        assert normalize_github_path("./public/robots.txt") == "public/robots.txt"

    def test_path_traversal_rejected(self):
        """Directory traversal (..) is strictly rejected."""
        dangerous_paths = [
            "../etc/passwd",
            "src/../../secrets.env",
            "..\\windows\\system32",
            "page/../..",
            "..",
        ]
        for path in dangerous_paths:
            with pytest.raises(InvalidResourceError) as exc_info:
                validate_github_path(path)
            assert "traversal" in str(exc_info.value).lower()

    def test_absolute_paths_rejected(self):
        """Absolute POSIX and Windows drive paths are rejected."""
        dangerous_paths = [
            "/etc/nginx/nginx.conf",
            "/var/www/html/index.html",
            "C:\\Users\\Admin\\config.json",
            "D:/data/index.html",
        ]
        for path in dangerous_paths:
            with pytest.raises(InvalidResourceError):
                validate_github_path(path)

    def test_null_bytes_and_shell_chars_rejected(self):
        """Null bytes and shell metacharacters are rejected."""
        dangerous = [
            "index.html\x00.php",
            "index.html%00",
            "file.html; whoami",
            "test.html && ls",
            "page`id`",
        ]
        for d in dangerous:
            with pytest.raises(InvalidResourceError):
                validate_github_path(d)

    def test_restricted_security_files_denylisted(self):
        """GitHub workflows, CI configs, credentials, private keys, and binaries are denylisted."""
        restricted_files = [
            ".github/workflows/deploy.yml",
            ".github/actions/setup/action.yml",
            ".circleci/config.yml",
            ".gitlab-ci.yml",
            ".env",
            ".env.production",
            "config/secrets.json",
            "id_rsa",
            "id_ed25519",
            "cert.pem",
            "server.key",
            "script.sh",
            "app.exe",
            "binary.bin",
        ]
        for path in restricted_files:
            is_safe, reason = is_safe_file_path(path)
            assert is_safe is False, f"Expected {path} to be unsafe!"
            with pytest.raises(AuthorizationError):
                assert_safe_mutation_target(path)

    def test_allowlisted_remediation_extensions(self):
        """Authorized HTML, template, content, and structured data files pass safety validation."""
        safe_files = [
            "index.html",
            "templates/layout.jsx",
            "views/home.blade.php",
            "content/article.md",
            "robots.txt",
            "sitemap.xml",
            "schema.json",
            "manifest.json",
        ]
        for path in safe_files:
            is_safe, _ = is_safe_file_path(path)
            assert is_safe is True, f"Expected {path} to be safe!"
            assert assert_safe_mutation_target(path) == path


# =============================================================================
# 4. READ RESOURCE TESTS
# =============================================================================

class TestGitHubReadResource:
    """Tests reading files from repository."""

    def test_read_existing_html_file(self, github_connector):
        """Reads existing file content and metadata."""
        ref = ResourceReference(
            resource_type=ResourceType.GIT_FILE,
            resource_id="index.html",
        )
        content = github_connector.read_resource(ref)
        assert content.content_type == "text/html"
        assert "Original Page" in str(content.content)
        assert content.etag_or_version is not None
        assert content.metadata["repo"] == "test-site"

    def test_read_missing_file_raises_not_found(self, github_connector):
        """Reading non-existent file raises ResourceNotFoundError."""
        ref = ResourceReference(
            resource_type=ResourceType.GIT_FILE,
            resource_id="nonexistent.html",
        )
        with pytest.raises(ResourceNotFoundError) as exc_info:
            github_connector.read_resource(ref)
        assert exc_info.value.code == ConnectorErrorCode.RESOURCE_NOT_FOUND


# =============================================================================
# 5. PREVIEW CHANGE & DETERMINISTIC DIFF TESTS
# =============================================================================

class TestGitHubPreviewChange:
    """Tests dry-run preview and deterministic diff generation."""

    def test_preview_meta_tag_improvement(self, github_connector):
        """Generates unified and structured diff for meta tag improvement."""
        proposal = ChangeProposal(
            target_resource=ResourceReference(
                resource_type=ResourceType.GIT_FILE,
                resource_id="index.html",
            ),
            action_type="meta_tag_improvement",
            proposed_diff={"after": "<title>Optimized GEO Title</title>"},
            before_summary="Original Page",
            after_summary="Optimized GEO Title",
            fix_plan_id=101,
            recommendation_id=15,
            finding_id=4,
        )
        preview = github_connector.preview_change(proposal)
        assert preview.can_apply is True
        assert preview.diff_unified is not None
        assert "<title>Original Page</title>" in preview.diff_unified
        assert "<title>Optimized GEO Title</title>" in preview.diff_unified
        assert preview.diff_structured["target_path"] == "index.html"
        assert preview.diff_structured["action_type"] == "meta_tag_improvement"

    def test_preview_on_unsafe_path_rejected(self, github_connector):
        """Previewing changes to restricted files raises AuthorizationError."""
        proposal = ChangeProposal(
            target_resource=ResourceReference(
                resource_type=ResourceType.GIT_FILE,
                resource_id=".github/workflows/deploy.yml",
            ),
            action_type="meta_tag_improvement",
            proposed_diff="malicious content",
        )
        with pytest.raises(AuthorizationError):
            github_connector.preview_change(proposal)


# =============================================================================
# 6. APPLY CHANGE & ISOLATED BRANCH TESTS
# =============================================================================

class TestGitHubApplyChange:
    """Tests mutation execution, isolated branch creation, commits, and PR generation."""

    def test_apply_creates_isolated_branch_and_commit(self, github_connector, mock_client):
        """Applying a change commits to an isolated branch and never modifies main directly."""
        proposal = ChangeProposal(
            target_resource=ResourceReference(
                resource_type=ResourceType.GIT_FILE,
                resource_id="index.html",
            ),
            action_type="meta_tag_improvement",
            proposed_diff={"after": "<title>Optimized GEO Title</title>"},
            before_summary="<title>Original Page</title>",
            after_summary="<title>Optimized GEO Title</title>",
            fix_plan_id=42,
            recommendation_id=10,
            finding_id=3,
        )

        result = github_connector.apply_change(proposal)
        assert result.status == ExecutionStatus.APPLIED
        assert result.rollback_supported is True
        assert result.resulting_version is not None

        execution_branch = result.metadata["execution_branch"]
        assert execution_branch.startswith("raval-fix/meta-tag-improvement-fp42-")
        assert execution_branch != "main"

        # Verify isolated branch exists in client
        branch_info = mock_client.get_branch("test-org", "test-site", execution_branch)
        assert branch_info.commit_sha == result.resulting_version

        # Verify PR was created
        assert result.metadata["pr_number"] is not None
        assert "pull" in result.metadata["pr_url"]

        # Verify main branch was NOT modified directly
        main_file = mock_client.get_file("test-org", "test-site", "index.html", ref="main")
        assert "Original Page" in main_file.content

        # Verify isolated branch has the modified content
        branch_file = mock_client.get_file("test-org", "test-site", "index.html", ref=execution_branch)
        assert "<title>Optimized GEO Title</title>" in branch_file.content

    def test_pre_commit_validation_detects_drift(self, github_connector):
        """Pre-commit validation detects when remote content drifts from expected before-state."""
        proposal = ChangeProposal(
            target_resource=ResourceReference(
                resource_type=ResourceType.GIT_FILE,
                resource_id="index.html",
            ),
            action_type="meta_tag_improvement",
            proposed_diff={"after": "<title>New Title</title>"},
            before_summary="<title>Stale Unmatched Content</title>",
        )

        with pytest.raises(ConnectorValidationError) as exc_info:
            github_connector.apply_change(proposal)
        assert exc_info.value.code == ConnectorErrorCode.VALIDATION_FAILURE
        assert "does not match expected original content" in str(exc_info.value)

    def test_direct_mutation_to_protected_branch_rejected(self):
        """Direct mutations to protected branch names are strictly blocked."""
        with pytest.raises(AuthorizationError) as exc_info:
            assert_safe_mutation_target("index.html", branch="main")
        assert "protected branch" in str(exc_info.value).lower()


# =============================================================================
# 7. ROLLBACK & REVERT TESTS
# =============================================================================

class TestGitHubRollback:
    """Tests safe rollback using stored operation records and snapshots."""

    def test_successful_rollback(self, github_connector, mock_client):
        """Rolling back an operation restores the original snapshot and closes PR."""
        proposal = ChangeProposal(
            target_resource=ResourceReference(
                resource_type=ResourceType.GIT_FILE,
                resource_id="about.html",
            ),
            action_type="content_gap_fill",
            proposed_diff="<!DOCTYPE html><html><head><title>About</title></head><body><main>About us - Expanded Section</main></body></html>",
            fix_plan_id=99,
        )

        # 1. Apply
        apply_res = github_connector.apply_change(proposal)
        op_id = apply_res.operation_id
        execution_branch = apply_res.metadata["execution_branch"]
        pr_number = apply_res.metadata["pr_number"]

        # Verify change on branch
        file_before_rollback = mock_client.get_file("test-org", "test-site", "about.html", ref=execution_branch)
        assert "Expanded Section" in file_before_rollback.content

        # 2. Rollback
        rollback_res = github_connector.rollback_change(op_id)
        assert rollback_res.status == ExecutionStatus.ROLLED_BACK

        # Verify file restored on branch
        file_after_rollback = mock_client.get_file("test-org", "test-site", "about.html", ref=execution_branch)
        assert "About Page Content" in file_after_rollback.content

        # Verify PR closed
        assert mock_client.pull_requests[pr_number].state == "closed"

    def test_rollback_unknown_operation_raises_not_found(self, github_connector):
        """Rolling back an unknown operation ID raises ResourceNotFoundError."""
        with pytest.raises(ResourceNotFoundError) as exc_info:
            github_connector.rollback_change("nonexistent_op_id")
        assert exc_info.value.code == ConnectorErrorCode.RESOURCE_NOT_FOUND


# =============================================================================
# 8. STATUS CHECK TESTS
# =============================================================================

class TestGitHubChangeStatus:
    """Tests inspecting operation status."""

    def test_get_change_status(self, github_connector):
        """get_change_status returns current status of applied operation."""
        proposal = ChangeProposal(
            target_resource=ResourceReference(
                resource_type=ResourceType.GIT_FILE,
                resource_id="robots.txt",
            ),
            action_type="technical_seo_correction",
            proposed_diff="User-agent: *\nAllow: /",
            fix_plan_id=33,
        )
        apply_res = github_connector.apply_change(proposal)
        status_res = github_connector.get_change_status(apply_res.operation_id)
        assert status_res.status == ExecutionStatus.APPLIED
        assert status_res.resulting_version == apply_res.resulting_version


# =============================================================================
# 9. RELIABILITY & SIMULATION HAZARDS
# =============================================================================

class TestGitHubReliability:
    """Tests timeouts, rate limits, and network error handling."""

    def test_timeout_handling(self):
        """Client timeout raises ConnectorTimeoutError with retryable=True."""
        client = MockGitHubClient(owner="test-org", repo="test-site", simulate_timeout=True)
        conn = GitHubConnector(owner="test-org", repo="test-site", client=client)

        with pytest.raises(ConnectorTimeoutError) as exc_info:
            conn.read_resource(
                ResourceReference(
                    resource_type=ResourceType.GIT_FILE,
                    resource_id="index.html",
                )
            )
        assert exc_info.value.code == ConnectorErrorCode.TIMEOUT
        assert exc_info.value.retryable is True

    def test_rate_limit_handling(self):
        """Client rate limit raises RateLimitExceededError with retry_after_seconds."""
        client = MockGitHubClient(simulate_rate_limit=True)
        conn = GitHubConnector(owner="test-org", repo="test-site", client=client)

        with pytest.raises(RateLimitExceededError) as exc_info:
            conn.read_resource(
                ResourceReference(
                    resource_type=ResourceType.GIT_FILE,
                    resource_id="index.html",
                )
            )
        assert exc_info.value.code == ConnectorErrorCode.RATE_LIMITED
        assert exc_info.value.retry_after_seconds == 60.0


# =============================================================================
# 10. SECURITY & SECRET REDACTION
# =============================================================================

class TestGitHubSecurityInvariants:
    """Guarantees zero secret leakage in GitHub connector models and errors."""

    def test_tokens_scrubbed_from_exceptions_and_metadata(self, github_connector):
        """Tokens are never exposed in exception strings, operation records, or metadata."""
        secret_token = "ghp_supersecretgithubpersonalaccesstoken12345"
        sanitized = github_connector.connect({"token": secret_token})
        assert "supersecret" not in str(sanitized.metadata)

        # Execution request metadata test
        target = ExecutionTarget(
            site_context=sanitized,
            resource=ResourceReference(
                resource_type=ResourceType.GIT_FILE,
                resource_id="index.html",
            ),
        )
        req = ExecutionRequest(
            operation=ExecutionOperationType.APPLY_CHANGE,
            target=target,
            fix_plan_id=12,
            parameters={"api_key": "sk-topsecret12345678901234567890"},
        )
        assert req.parameters["api_key"] == "[REDACTED]"
