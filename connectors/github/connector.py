"""
GitHub Connector Implementation (Task 11 Step 2).

Implements the provider-neutral BaseConnector contract for GitHub repositories:
- Authentication & Repository Selection
- Resource reading with POSIX path safety
- Deterministic preview diff generation
- Isolated branch creation & idempotency (never mutates default branch directly)
- Pre-commit drift validation
- Commit and Pull Request creation
- Immutable operation recording & safe rollback
"""

from __future__ import annotations

import hashlib
import logging
import time
from datetime import datetime, timezone
from typing import Any

from connectors.base.capabilities import ConnectorCapabilities
from connectors.base.enums import (
    AuthState,
    ConnectorCapability,
    ExecutionOperationType,
    ExecutionStatus,
    HealthStatus,
    ResourceType,
)
from connectors.base.errors import (
    AuthenticationError,
    AuthorizationError,
    ConnectorErrorInfo,
    InvalidResourceError,
    ResourceNotFoundError,
    UnsupportedOperationError,
)
from connectors.base.interface import BaseConnector
from connectors.base.models import (
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
from connectors.base.security import (
    redact_secrets_from_string,
    sanitize_payload,
    validate_safe_identifier,
)
from connectors.github.client import (
    GitHubClientProtocol,
    LiveGitHubClient,
    MockGitHubClient,
)
from connectors.github.diff import (
    apply_proposal_to_content,
    generate_structured_diff,
    generate_unified_diff,
    validate_pre_commit_state,
)
from connectors.github.models import (
    GitHubOperationRecord,
    GitHubRepoRef,
)
from connectors.github.security import (
    assert_safe_mutation_target,
    normalize_github_path,
    validate_branch_name,
)

logger = logging.getLogger(__name__)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _generate_branch_name(proposal: ChangeProposal, base_sha: str) -> str:
    """
    Generates a deterministic, isolated Git branch name for a fix proposal.
    Format: raval-fix/{action_slug}-fp{fix_plan_id}-{hash_suffix}
    """
    action_slug = proposal.action_type.replace("_", "-").lower()[:30]
    fp_id = proposal.fix_plan_id or "adhoc"
    target_clean = normalize_github_path(proposal.target_resource.resource_id)
    
    # Hash of target + base commit to guarantee determinism & idempotency
    hash_suffix = hashlib.sha1(f"{target_clean}:{base_sha}:{fp_id}".encode("utf-8")).hexdigest()[:8]
    return f"raval-fix/{action_slug}-fp{fp_id}-{hash_suffix}"


class GitHubConnector(BaseConnector):
    """
    Production-ready, secure GitHub Connector implementing BaseConnector.
    Operates strictly via client abstraction (Live or Mock).
    """

    def __init__(
        self,
        site_context: SiteContext | None = None,
        client: GitHubClientProtocol | None = None,
        owner: str | None = None,
        repo: str | None = None,
        default_branch: str = "main",
        create_pr_on_apply: bool = True,
    ) -> None:
        # Resolve owner and repo from explicit parameters or site_context metadata
        ctx_meta = site_context.metadata if site_context else {}
        target_owner = owner or ctx_meta.get("owner") or "raval-ai-org"
        target_repo = repo or ctx_meta.get("repo") or "website-repo"
        target_default_branch = default_branch or ctx_meta.get("default_branch", "main")

        # Validate identifiers
        validate_safe_identifier(target_owner, "owner")
        validate_safe_identifier(target_repo, "repo")
        validate_safe_identifier(target_default_branch, "default_branch")

        context = site_context or SiteContext(
            site_id=1,
            site_url=f"https://github.com/{target_owner}/{target_repo}",
            provider="github",
            environment="production",
            auth_state=AuthState.DISCONNECTED,
            capabilities=ConnectorCapabilities(
                supported_capabilities={
                    ConnectorCapability.READ,
                    ConnectorCapability.PREVIEW,
                    ConnectorCapability.APPLY,
                    ConnectorCapability.ROLLBACK,
                    ConnectorCapability.STATUS,
                    ConnectorCapability.HEALTH_CHECK,
                },
                supported_resource_types={
                    ResourceType.GIT_FILE,
                    ResourceType.WEBSITE_PAGE,
                    ResourceType.ROBOTS_TXT,
                    ResourceType.SITEMAP,
                    ResourceType.STRUCTURED_DATA,
                    ResourceType.META_TAGS,
                },
                supports_preview=True,
                supports_rollback=True,
                supports_atomic_batch=False,
                supports_rate_limit_reporting=True,
            ),
            last_health_status=HealthStatus.UNKNOWN,
            metadata={
                "owner": target_owner,
                "repo": target_repo,
                "default_branch": target_default_branch,
            },
        )
        super().__init__(context)
        self.repo_ref = GitHubRepoRef(
            owner=target_owner,
            repo=target_repo,
            default_branch=target_default_branch,
        )
        self.client: GitHubClientProtocol = client or MockGitHubClient(
            owner=target_owner,
            repo=target_repo,
            default_branch=target_default_branch,
        )
        self.create_pr_on_apply = create_pr_on_apply

        # In-memory storage for operation records and change results
        self._operation_records: dict[str, GitHubOperationRecord] = {}
        self._change_results: dict[str, ChangeResult] = {}

    # =========================================================================
    # 1. Lifecycle & Authentication
    # =========================================================================

    def connect(
        self,
        credentials: dict[str, Any] | None = None,
    ) -> SiteContext:
        """
        Authenticates with GitHub API using token or provided credentials.
        Never persists or returns the raw token.
        """
        token = None
        if credentials:
            token = (
                credentials.get("token")
                or credentials.get("github_token")
                or credentials.get("personal_access_token")
                or credentials.get("api_key")
            )

        try:
            user_info = self.client.authenticate(token=token)
            repo_info = self.client.get_repository(self.repo_ref.owner, self.repo_ref.repo)
            rate_info = self.client.get_rate_limit()

            self._site_context.auth_state = AuthState.CONNECTED
            self._site_context.last_health_status = HealthStatus.HEALTHY
            self._site_context.rate_limit_info = rate_info
            self._site_context.metadata.update({
                "authenticated_user": user_info.get("login", "unknown"),
                "repo_full_name": repo_info.get("full_name"),
                "default_branch": repo_info.get("default_branch", self.repo_ref.default_branch),
                "permissions": repo_info.get("permissions", {}),
            })
            return self.get_site_context()
        except AuthenticationError:
            self._site_context.auth_state = AuthState.AUTH_FAILED
            self._site_context.last_health_status = HealthStatus.UNHEALTHY
            raise
        except Exception as exc:
            self._site_context.auth_state = AuthState.AUTH_FAILED
            self._site_context.last_health_status = HealthStatus.UNHEALTHY
            raise AuthenticationError(
                message=f"GitHub connection handshake failed: {redact_secrets_from_string(str(exc))}",
            ) from exc

    def disconnect(self) -> SiteContext:
        """Clears connection state."""
        self._site_context.auth_state = AuthState.DISCONNECTED
        return self.get_site_context()

    def health_check(self) -> ConnectorHealth:
        """Performs non-destructive ping against repository and checks rate limits."""
        start_time = time.time()
        try:
            repo_info = self.client.get_repository(self.repo_ref.owner, self.repo_ref.repo)
            rate_info = self.client.get_rate_limit()
            latency_ms = (time.time() - start_time) * 1000.0

            status = HealthStatus.HEALTHY
            if rate_info.is_rate_limited:
                status = HealthStatus.DEGRADED

            return ConnectorHealth(
                status=status,
                latency_ms=round(latency_ms, 2),
                message=f"GitHub repository '{self.repo_ref.full_name}' is accessible",
                auth_state=self._site_context.auth_state,
                details={
                    "default_branch": repo_info.get("default_branch"),
                    "rate_remaining": rate_info.remaining,
                },
            )
        except Exception as exc:
            latency_ms = (time.time() - start_time) * 1000.0
            return ConnectorHealth(
                status=HealthStatus.UNHEALTHY,
                latency_ms=round(latency_ms, 2),
                message=f"GitHub health check failed: {redact_secrets_from_string(str(exc))}",
                auth_state=self._site_context.auth_state,
            )

    def get_site_context(self) -> SiteContext:
        return self._site_context.model_copy(deep=True)

    # =========================================================================
    # 2. Read Operations
    # =========================================================================

    def read_resource(
        self,
        resource: ResourceReference,
    ) -> ResourceContent:
        """
        Reads file content from the target repository.
        """
        self._ensure_capability(ConnectorCapability.READ)
        target_path = normalize_github_path(resource.resource_id)
        ref = resource.version_or_tag or self.repo_ref.default_branch

        file_info = self.client.get_file(
            owner=self.repo_ref.owner,
            repo=self.repo_ref.repo,
            path=target_path,
            ref=ref,
        )

        content_type = "text/html" if target_path.endswith((".html", ".htm")) else "text/plain"
        if target_path.endswith(".json"):
            content_type = "application/json"
        elif target_path.endswith(".xml"):
            content_type = "application/xml"

        return ResourceContent(
            resource=resource,
            content=file_info.content or "",
            content_type=content_type,
            encoding=file_info.encoding,
            etag_or_version=file_info.sha,
            metadata={
                "size_bytes": file_info.size_bytes,
                "ref": ref,
                "owner": self.repo_ref.owner,
                "repo": self.repo_ref.repo,
            },
            fetched_at=_utc_now(),
        )

    # =========================================================================
    # 3. Mutation & Rollback Operations
    # =========================================================================

    def preview_change(
        self,
        proposal: ChangeProposal,
    ) -> ChangePreview:
        """
        Generates a deterministic unified and structured diff for the proposed fix.
        """
        self._ensure_capability(ConnectorCapability.PREVIEW)

        # 1. Validate target path and safety
        target_path = assert_safe_mutation_target(proposal.target_resource.resource_id)

        # 2. Fetch existing content from default branch
        ref = proposal.target_resource.version_or_tag or self.repo_ref.default_branch
        original_content = ""
        try:
            file_info = self.client.get_file(self.repo_ref.owner, self.repo_ref.repo, target_path, ref=ref)
            original_content = file_info.content or ""
        except ResourceNotFoundError:
            original_content = ""  # New file to be created

        # 3. Compute modified content deterministically
        after_content = apply_proposal_to_content(
            original_content=original_content,
            proposed_diff=proposal.proposed_diff,
            action_type=proposal.action_type,
        )

        # 4. Generate diffs
        unified_diff = generate_unified_diff(target_path, original_content, after_content)
        structured_diff = generate_structured_diff(target_path, original_content, after_content, proposal.action_type)

        warnings: list[str] = []
        if structured_diff["is_identical"]:
            warnings.append("Proposed fix results in no textual changes to target file.")

        return ChangePreview(
            proposal=proposal,
            diff_unified=unified_diff,
            diff_structured=structured_diff,
            estimated_impact=f"Deterministic {proposal.action_type} on {target_path}",
            can_apply=True,
            warnings=warnings,
            generated_at=_utc_now(),
        )

    def apply_change(
        self,
        proposal: ChangeProposal,
    ) -> ChangeResult:
        """
        Safely applies the change proposal on an isolated Git branch.
        Never mutates the default/protected branch directly.
        """
        self._ensure_capability(ConnectorCapability.APPLY)

        # 1. Validate target path and enforce security rules
        target_path = assert_safe_mutation_target(proposal.target_resource.resource_id)

        # 2. Inspect base branch and head commit SHA
        base_branch = self.repo_ref.default_branch
        base_branch_info = self.client.get_branch(self.repo_ref.owner, self.repo_ref.repo, base_branch)
        base_commit_sha = base_branch_info.commit_sha

        # 3. Fetch original file content and blob SHA
        original_content = ""
        original_file_sha = None
        try:
            file_info = self.client.get_file(
                self.repo_ref.owner,
                self.repo_ref.repo,
                target_path,
                ref=base_branch,
            )
            original_content = file_info.content or ""
            original_file_sha = file_info.sha
        except ResourceNotFoundError:
            original_content = ""
            original_file_sha = None

        # 4. Pre-commit state verification
        if proposal.before_summary and original_content:
            validate_pre_commit_state(
                expected_original_content=proposal.before_summary if proposal.before_summary != "<!-- Resource empty or new -->" else original_content,
                current_remote_content=original_content,
                target_path=target_path,
            )

        # 5. Determine deterministic isolated branch name & create branch
        execution_branch = _generate_branch_name(proposal, base_commit_sha)
        validate_branch_name(execution_branch)
        self.client.create_branch(self.repo_ref.owner, self.repo_ref.repo, execution_branch, base_commit_sha)

        # 6. Compute new content
        after_content = apply_proposal_to_content(
            original_content=original_content,
            proposed_diff=proposal.proposed_diff,
            action_type=proposal.action_type,
        )

        # 7. Commit changes to isolated branch
        commit_message = (
            f"fix(seo): apply {proposal.action_type} on {target_path}\n\n"
            f"Task 9 FixPlan: #{proposal.fix_plan_id or 'N/A'}\n"
            f"Automated remediation by Raval AI Safe Fix Engine."
        )
        commit_info = self.client.create_or_update_file(
            owner=self.repo_ref.owner,
            repo=self.repo_ref.repo,
            path=target_path,
            content=after_content,
            message=commit_message,
            branch=execution_branch,
            sha=original_file_sha,
        )

        # 8. Create optional Pull Request
        pr_info = None
        if self.create_pr_on_apply:
            pr_title = f"fix(seo): {proposal.action_type} for {target_path}"
            pr_body = (
                f"### Raval AI SEO/GEO Fix Proposal\n\n"
                f"- **Fix Plan ID**: #{proposal.fix_plan_id or 'N/A'}\n"
                f"- **Recommendation ID**: #{proposal.recommendation_id or 'N/A'}\n"
                f"- **Finding ID**: #{proposal.finding_id or 'N/A'}\n"
                f"- **Action Type**: `{proposal.action_type}`\n"
                f"- **Target File**: `{target_path}`\n\n"
                f"Generated automatically by Raval AI Website Connector."
            )
            pr_info = self.client.create_pull_request(
                owner=self.repo_ref.owner,
                repo=self.repo_ref.repo,
                title=pr_title,
                body=pr_body,
                head_branch=execution_branch,
                base_branch=base_branch,
            )

        # 9. Create Operation ID & Store immutable audit record
        op_id = OperationId(
            provider_operation_id=commit_info.sha,
            operation_type=ExecutionOperationType.APPLY_CHANGE,
        )

        record = GitHubOperationRecord(
            operation_id=op_id.id,
            owner=self.repo_ref.owner,
            repo=self.repo_ref.repo,
            base_branch=base_branch,
            base_commit_sha=base_commit_sha,
            execution_branch=execution_branch,
            target_path=target_path,
            original_file_sha=original_file_sha,
            original_content=original_content,
            resulting_commit_sha=commit_info.sha,
            pr_number=pr_info.number if pr_info else None,
            pr_url=pr_info.html_url if pr_info else None,
            fix_plan_id=proposal.fix_plan_id,
            action_type=proposal.action_type,
            status="applied",
            created_at=_utc_now(),
            metadata={
                "commit_sha": commit_info.sha,
                "execution_branch": execution_branch,
            },
        )
        self._operation_records[op_id.id] = record

        # 10. Construct ChangeResult
        change_result = ChangeResult(
            operation_id=op_id,
            status=ExecutionStatus.APPLIED,
            target_resource=proposal.target_resource,
            applied_at=_utc_now(),
            rollback_supported=True,
            rollback_token=op_id.id,
            message=f"Committed {proposal.action_type} to isolated branch '{execution_branch}' ({commit_info.sha[:7]})",
            resulting_version=commit_info.sha,
            metadata={
                "execution_branch": execution_branch,
                "commit_sha": commit_info.sha,
                "pr_number": pr_info.number if pr_info else None,
                "pr_url": pr_info.html_url if pr_info else None,
            },
        )
        self._change_results[op_id.id] = change_result
        return change_result

    def rollback_change(
        self,
        operation_id: OperationId | str,
        rollback_token: str | None = None,
    ) -> ChangeResult:
        """
        Safely rolls back an applied mutation by restoring the original file snapshot
        on the execution branch and closing the associated Pull Request.
        """
        self._ensure_capability(ConnectorCapability.ROLLBACK)

        op_key = operation_id.id if isinstance(operation_id, OperationId) else str(operation_id)
        token = rollback_token or op_key

        record = self._operation_records.get(token) or self._operation_records.get(op_key)
        if record is None:
            raise ResourceNotFoundError(
                message=f"Operation record '{op_key}' not found for rollback",
                resource_id=op_key,
            )

        # 1. Close PR if open
        if record.pr_number:
            try:
                self.client.close_pull_request(self.repo_ref.owner, self.repo_ref.repo, record.pr_number)
            except Exception as exc:
                logger.warning("Could not close PR #%s during rollback: %s", record.pr_number, exc)

        # 2. Restore original content snapshot to execution branch
        revert_commit_info = None
        if record.original_content is not None:
            revert_message = (
                f"revert(seo): rollback {record.action_type} on {record.target_path}\n\n"
                f"Reverts operation #{record.operation_id}"
            )
            revert_commit_info = self.client.create_or_update_file(
                owner=self.repo_ref.owner,
                repo=self.repo_ref.repo,
                path=record.target_path,
                content=record.original_content,
                message=revert_message,
                branch=record.execution_branch,
            )

        # 3. Update operation record
        record.status = "rolled_back"

        rollback_op_id = OperationId(
            provider_operation_id=revert_commit_info.sha if revert_commit_info else f"revert_{record.operation_id}",
            operation_type=ExecutionOperationType.ROLLBACK_CHANGE,
        )

        rollback_result = ChangeResult(
            operation_id=rollback_op_id,
            status=ExecutionStatus.ROLLED_BACK,
            target_resource=ResourceReference(
                resource_type=ResourceType.GIT_FILE,
                resource_id=record.target_path,
            ),
            rolled_back_at=_utc_now(),
            rollback_supported=True,
            rollback_token=token,
            message=f"Successfully rolled back operation '{op_key}' on branch '{record.execution_branch}'",
            resulting_version=revert_commit_info.sha if revert_commit_info else "restored",
            metadata={
                "rolled_back_operation_id": op_key,
                "execution_branch": record.execution_branch,
                "revert_commit_sha": revert_commit_info.sha if revert_commit_info else None,
            },
        )
        self._change_results[rollback_op_id.id] = rollback_result
        return rollback_result

    def get_change_status(
        self,
        operation_id: OperationId | str,
    ) -> ChangeResult:
        """
        Retrieves current status of a change operation.
        """
        self._ensure_capability(ConnectorCapability.STATUS)
        op_key = operation_id.id if isinstance(operation_id, OperationId) else str(operation_id)

        result = self._change_results.get(op_key)
        if result is None:
            # Check operation records
            record = self._operation_records.get(op_key)
            if record:
                return ChangeResult(
                    operation_id=OperationId(id=op_key, operation_type=ExecutionOperationType.APPLY_CHANGE),
                    status=ExecutionStatus.APPLIED if record.status == "applied" else ExecutionStatus.ROLLED_BACK,
                    target_resource=ResourceReference(
                        resource_type=ResourceType.GIT_FILE,
                        resource_id=record.target_path,
                    ),
                    applied_at=record.created_at,
                    rollback_supported=True,
                    rollback_token=op_key,
                    message=f"Operation status: {record.status}",
                    resulting_version=record.resulting_commit_sha,
                )
            raise ResourceNotFoundError(
                message=f"Operation '{op_key}' not found",
                resource_id=op_key,
            )

        return result.model_copy(deep=True)
