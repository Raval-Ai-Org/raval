"""
GitHub Specific Models and Metadata Structures (Task 11 Step 2).

Defines strongly-typed models for GitHub repository metadata, branches, commits,
pull requests, and operation state tracking.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from pydantic import BaseModel, ConfigDict, Field

from connectors.base.security import sanitize_payload, validate_safe_identifier


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


class GitHubRepoRef(BaseModel):
    """Normalized reference identifying a target GitHub repository."""
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    owner: str = Field(..., description="Repository owner or organization name")
    repo: str = Field(..., description="Repository name")
    default_branch: str = Field(default="main", description="Default branch name (e.g. main, master)")

    def model_post_init(self, __context: Any) -> None:
        validate_safe_identifier(self.owner, "owner")
        validate_safe_identifier(self.repo, "repo")
        validate_safe_identifier(self.default_branch, "default_branch")

    @property
    def full_name(self) -> str:
        return f"{self.owner}/{self.repo}"


class GitHubBranchInfo(BaseModel):
    """Metadata describing a Git branch on GitHub."""
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    name: str = Field(..., description="Branch name")
    commit_sha: str = Field(..., description="Latest commit SHA on this branch")
    is_protected: bool = Field(default=False, description="Whether branch has protection rules enabled")
    is_default: bool = Field(default=False, description="Whether this is the repository's default branch")


class GitHubFileInfo(BaseModel):
    """Metadata describing a file inside a GitHub repository."""
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    path: str = Field(..., description="Normalized repository-relative path")
    sha: str = Field(..., description="Git blob SHA")
    size_bytes: int = Field(default=0, description="File size in bytes")
    encoding: str = Field(default="utf-8", description="File text encoding")
    content: str | None = Field(default=None, description="Decoded file content string")


class GitHubCommitInfo(BaseModel):
    """Metadata describing a Git commit created on GitHub."""
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    sha: str = Field(..., description="Git commit SHA")
    branch: str = Field(..., description="Branch where commit was created")
    message: str = Field(..., description="Commit message")
    author_name: str = Field(default="Raval AI Auto-Fix Engine", description="Author name")
    author_email: str = Field(default="bot@raval.ai", description="Author email")
    committed_at: datetime = Field(default_factory=_utc_now, description="Commit timestamp (UTC)")


class GitHubPRInfo(BaseModel):
    """Metadata describing a GitHub Pull Request."""
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    number: int = Field(..., description="Pull request number")
    html_url: str = Field(..., description="Web URL to view the Pull Request")
    title: str = Field(..., description="Pull request title")
    head_branch: str = Field(..., description="Source / feature branch name")
    base_branch: str = Field(..., description="Target / base branch name")
    state: str = Field(default="open", description="PR state (open, closed, merged)")
    created_at: datetime = Field(default_factory=_utc_now, description="PR creation timestamp (UTC)")


class GitHubOperationRecord(BaseModel):
    """
    Immutable audit record stored for each GitHub mutation operation.
    Guarantees that safe rollback and inspection are always possible.
    """
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    operation_id: str = Field(..., description="Internal normalized operation ID")
    owner: str = Field(..., description="Repository owner")
    repo: str = Field(..., description="Repository name")
    base_branch: str = Field(..., description="Base branch mutated from")
    base_commit_sha: str = Field(..., description="Base commit SHA prior to mutation")
    execution_branch: str = Field(..., description="Isolated branch where fix was committed")
    target_path: str = Field(..., description="Repository-relative target file path")
    original_file_sha: str | None = Field(default=None, description="Original blob SHA prior to mutation")
    original_content: str | None = Field(default=None, description="Original file content snapshot")
    resulting_commit_sha: str | None = Field(default=None, description="Commit SHA produced by this mutation")
    pr_number: int | None = Field(default=None, description="PR number if created")
    pr_url: str | None = Field(default=None, description="PR URL if created")
    fix_plan_id: int | None = Field(default=None, description="Task 9 FixPlan ID")
    action_type: str = Field(..., description="Remediation action type")
    status: str = Field(default="applied", description="Execution status")
    created_at: datetime = Field(default_factory=_utc_now, description="Record creation timestamp (UTC)")
    metadata: dict[str, Any] = Field(default_factory=dict, description="Sanitized diagnostic metadata")

    def model_post_init(self, __context: Any) -> None:
        if self.metadata:
            object.__setattr__(self, "metadata", sanitize_payload(self.metadata))
