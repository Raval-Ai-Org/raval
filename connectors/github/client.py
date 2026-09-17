"""
GitHub API Client Protocol, In-Memory Mock, and HTTP Client Layer (Task 11 Step 2).

Provides a decoupled client interface allowing the GitHubConnector to operate against
either in-memory test fixtures or the live GitHub REST API.
"""

from __future__ import annotations

import base64
import hashlib
import time
from datetime import datetime, timezone
from typing import Any, Protocol

from connectors.base.enums import ConnectorErrorCode
from connectors.base.errors import (
    AuthenticationError,
    AuthorizationError,
    ConnectorNetworkError,
    ConnectorTimeoutError,
    InvalidResourceError,
    ProviderAPIError,
    RateLimitExceededError,
    ResourceNotFoundError,
)
from connectors.base.models import RateLimitInfo
from connectors.base.security import redact_secrets_from_string, sanitize_payload
from connectors.github.models import (
    GitHubBranchInfo,
    GitHubCommitInfo,
    GitHubFileInfo,
    GitHubPRInfo,
    GitHubRepoRef,
)


def _compute_blob_sha(content: str) -> str:
    """Computes standard Git blob SHA-1: sha1("blob " + size + "\0" + content)."""
    data = content.encode("utf-8")
    header = f"blob {len(data)}\0".encode("utf-8")
    return hashlib.sha1(header + data).hexdigest()


class GitHubClientProtocol(Protocol):
    """Protocol defining required GitHub REST API operations."""

    def authenticate(self, token: str | None = None) -> dict[str, Any]:
        """Validates token and returns authenticated user or app identity."""
        ...

    def get_repository(self, owner: str, repo: str) -> dict[str, Any]:
        """Fetches repository metadata."""
        ...

    def get_branch(self, owner: str, repo: str, branch: str) -> GitHubBranchInfo:
        """Fetches branch details and head commit SHA."""
        ...

    def get_file(self, owner: str, repo: str, path: str, ref: str | None = None) -> GitHubFileInfo:
        """Fetches file contents and blob SHA from repository."""
        ...

    def create_branch(self, owner: str, repo: str, new_branch: str, base_sha: str) -> GitHubBranchInfo:
        """Creates a new branch pointer from a base commit SHA."""
        ...

    def create_or_update_file(
        self,
        owner: str,
        repo: str,
        path: str,
        content: str,
        message: str,
        branch: str,
        sha: str | None = None,
    ) -> GitHubCommitInfo:
        """Commits file changes to the specified branch."""
        ...

    def create_pull_request(
        self,
        owner: str,
        repo: str,
        title: str,
        body: str,
        head_branch: str,
        base_branch: str,
    ) -> GitHubPRInfo:
        """Creates a pull request."""
        ...

    def close_pull_request(self, owner: str, repo: str, pr_number: int) -> GitHubPRInfo:
        """Closes a pull request."""
        ...

    def get_rate_limit(self) -> RateLimitInfo:
        """Fetches current API rate-limit state."""
        ...


class MockGitHubClient:
    """
    In-memory mock GitHub API client for deterministic testing.
    Maintains a simulated repository file tree and branch references.
    """

    def __init__(
        self,
        owner: str = "raval-ai-org",
        repo: str = "raval-website",
        default_branch: str = "main",
        initial_files: dict[str, str] | None = None,
        simulate_auth_failure: bool = False,
        simulate_rate_limit: bool = False,
        simulate_timeout: bool = False,
        simulate_404: bool = False,
        simulate_unauthorized_mutation: bool = False,
    ) -> None:
        self.owner = owner
        self.repo = repo
        self.default_branch = default_branch
        self.simulate_auth_failure = simulate_auth_failure
        self.simulate_rate_limit = simulate_rate_limit
        self.simulate_timeout = simulate_timeout
        self.simulate_404 = simulate_404
        self.simulate_unauthorized_mutation = simulate_unauthorized_mutation

        # In-memory branch heads: branch_name -> commit_sha
        self.initial_commit_sha = "a1b2c3d4e5f6789012345678901234567890abcd"
        self.branches: dict[str, str] = {
            default_branch: self.initial_commit_sha,
        }

        # In-memory file storage: (branch, normalized_path) -> content_str
        self.files: dict[tuple[str, str], str] = {}
        defaults = initial_files or {
            "index.html": "<!DOCTYPE html><html><head><title>Test Home</title></head><body><h1>Welcome</h1></body></html>",
            "about.html": "<!DOCTYPE html><html><head><title>About</title></head><body><main>About us</main></body></html>",
            "robots.txt": "User-agent: *\nAllow: /",
            "sitemap.xml": "<?xml version='1.0' encoding='UTF-8'?><urlset></urlset>",
        }
        for path, content in defaults.items():
            self.files[(default_branch, path)] = content

        self.pull_requests: dict[int, GitHubPRInfo] = {}
        self.commits_log: list[GitHubCommitInfo] = []

    def _check_simulation_hazards(self, op: str) -> None:
        if self.simulate_timeout:
            raise ConnectorTimeoutError(f"GitHub API timed out during '{op}'", timeout_seconds=10.0)
        if self.simulate_rate_limit:
            raise RateLimitExceededError("GitHub API rate limit exceeded (429)", retry_after_seconds=60.0, provider_code="429")
        if self.simulate_auth_failure:
            raise AuthenticationError("Bad credentials", provider_code="401")
        if self.simulate_404:
            raise ResourceNotFoundError(f"GitHub resource not found during '{op}'", provider_code="404")

    def authenticate(self, token: str | None = None) -> dict[str, Any]:
        self._check_simulation_hazards("authenticate")
        if token == "invalid_token":
            raise AuthenticationError("Bad credentials: token is invalid", provider_code="401")
        return {
            "login": "raval-bot",
            "id": 12345678,
            "type": "User",
            "site_admin": False,
        }

    def get_repository(self, owner: str, repo: str) -> dict[str, Any]:
        self._check_simulation_hazards("get_repository")
        if owner != self.owner or repo != self.repo:
            raise ResourceNotFoundError(f"Repository '{owner}/{repo}' not found", provider_code="404")
        return {
            "name": self.repo,
            "full_name": f"{self.owner}/{self.repo}",
            "owner": {"login": self.owner},
            "default_branch": self.default_branch,
            "private": False,
            "permissions": {"push": True, "pull": True, "admin": False},
        }

    def get_branch(self, owner: str, repo: str, branch: str) -> GitHubBranchInfo:
        self._check_simulation_hazards("get_branch")
        if branch not in self.branches:
            raise ResourceNotFoundError(f"Branch '{branch}' not found in '{owner}/{repo}'", provider_code="404")
        return GitHubBranchInfo(
            name=branch,
            commit_sha=self.branches[branch],
            is_default=(branch == self.default_branch),
            is_protected=(branch == self.default_branch),
        )

    def get_file(self, owner: str, repo: str, path: str, ref: str | None = None) -> GitHubFileInfo:
        self._check_simulation_hazards("get_file")
        target_ref = ref or self.default_branch
        key = (target_ref, path)

        # Fallback to default branch if branch exists but file was unchanged from base
        if key not in self.files and target_ref in self.branches:
            key = (self.default_branch, path)

        if key not in self.files:
            raise ResourceNotFoundError(f"File '{path}' not found at ref '{target_ref}'", resource_id=path, provider_code="404")

        content = self.files[key]
        return GitHubFileInfo(
            path=path,
            sha=_compute_blob_sha(content),
            size_bytes=len(content.encode("utf-8")),
            content=content,
        )

    def create_branch(self, owner: str, repo: str, new_branch: str, base_sha: str) -> GitHubBranchInfo:
        self._check_simulation_hazards("create_branch")
        if new_branch in self.branches:
            # Idempotent branch reuse
            return self.get_branch(owner, repo, new_branch)

        self.branches[new_branch] = base_sha
        # Copy existing files from default branch to new branch
        for (b, p), content in list(self.files.items()):
            if b == self.default_branch:
                self.files[(new_branch, p)] = content

        return GitHubBranchInfo(
            name=new_branch,
            commit_sha=base_sha,
            is_default=False,
            is_protected=False,
        )

    def create_or_update_file(
        self,
        owner: str,
        repo: str,
        path: str,
        content: str,
        message: str,
        branch: str,
        sha: str | None = None,
    ) -> GitHubCommitInfo:
        self._check_simulation_hazards("create_or_update_file")
        if self.simulate_unauthorized_mutation:
            raise AuthorizationError("Write permission denied for repository", provider_code="403")

        if branch not in self.branches:
            raise ResourceNotFoundError(f"Target branch '{branch}' does not exist", provider_code="404")

        # Update in-memory file
        self.files[(branch, path)] = content

        # Produce new deterministic commit SHA
        new_commit_sha = hashlib.sha1(f"{branch}:{path}:{time.time()}".encode("utf-8")).hexdigest()
        self.branches[branch] = new_commit_sha

        commit_info = GitHubCommitInfo(
            sha=new_commit_sha,
            branch=branch,
            message=message,
            committed_at=datetime.now(timezone.utc),
        )
        self.commits_log.append(commit_info)
        return commit_info

    def create_pull_request(
        self,
        owner: str,
        repo: str,
        title: str,
        body: str,
        head_branch: str,
        base_branch: str,
    ) -> GitHubPRInfo:
        self._check_simulation_hazards("create_pull_request")
        pr_number = len(self.pull_requests) + 101
        pr = GitHubPRInfo(
            number=pr_number,
            html_url=f"https://github.com/{owner}/{repo}/pull/{pr_number}",
            title=title,
            head_branch=head_branch,
            base_branch=base_branch,
            state="open",
            created_at=datetime.now(timezone.utc),
        )
        self.pull_requests[pr_number] = pr
        return pr

    def close_pull_request(self, owner: str, repo: str, pr_number: int) -> GitHubPRInfo:
        self._check_simulation_hazards("close_pull_request")
        if pr_number not in self.pull_requests:
            raise ResourceNotFoundError(f"PR #{pr_number} not found", provider_code="404")
        pr = self.pull_requests[pr_number]
        pr.state = "closed"
        return pr

    def get_rate_limit(self) -> RateLimitInfo:
        return RateLimitInfo(
            limit=5000,
            remaining=4980,
            reset_seconds=3500.0,
            is_rate_limited=False,
        )


class LiveGitHubClient:
    """
    Live GitHub REST API Client backed by httpx.
    Enforces secret scrubbing on all logs, errors, and responses.
    """

    BASE_URL = "https://api.github.com"

    def __init__(
        self,
        token: str | None = None,
        timeout_seconds: float = 30.0,
    ) -> None:
        self._token = token
        self._timeout = timeout_seconds

    def _get_headers(self) -> dict[str, str]:
        headers = {
            "Accept": "application/vnd.github.v3+json",
            "User-Agent": "Raval-AI-Fix-Engine/1.0",
        }
        if self._token:
            headers["Authorization"] = f"Bearer {self._token}"
        return headers

    def authenticate(self, token: str | None = None) -> dict[str, Any]:
        import httpx
        tok = token or self._token
        if not tok:
            raise AuthenticationError("No GitHub authentication token provided")
        
        headers = self._get_headers()
        headers["Authorization"] = f"Bearer {tok}"

        try:
            with httpx.Client(timeout=self._timeout) as client:
                res = client.get(f"{self.BASE_URL}/user", headers=headers)
                if res.status_code == 401:
                    raise AuthenticationError("Invalid or expired GitHub token", provider_code="401")
                elif res.status_code == 403:
                    raise AuthorizationError("GitHub authorization failure / rate limited", provider_code="403")
                elif res.is_error:
                    raise ProviderAPIError(f"GitHub user API returned status {res.status_code}", provider_code=str(res.status_code))
                return sanitize_payload(res.json())
        except httpx.TimeoutException as exc:
            raise ConnectorTimeoutError("GitHub authentication request timed out") from exc
        except httpx.RequestError as exc:
            raise ConnectorNetworkError(f"Network error connecting to GitHub: {redact_secrets_from_string(str(exc))}") from exc

    def get_repository(self, owner: str, repo: str) -> dict[str, Any]:
        import httpx
        try:
            with httpx.Client(timeout=self._timeout) as client:
                res = client.get(f"{self.BASE_URL}/repos/{owner}/{repo}", headers=self._get_headers())
                if res.status_code == 404:
                    raise ResourceNotFoundError(f"Repository '{owner}/{repo}' not found", provider_code="404")
                elif res.status_code == 401:
                    raise AuthenticationError("Unauthorized to access repository", provider_code="401")
                elif res.is_error:
                    raise ProviderAPIError(f"GitHub repo API error: {res.status_code}", provider_code=str(res.status_code))
                return sanitize_payload(res.json())
        except httpx.TimeoutException as exc:
            raise ConnectorTimeoutError(f"GitHub repository request timed out for '{owner}/{repo}'") from exc
        except httpx.RequestError as exc:
            raise ConnectorNetworkError(f"Network error accessing GitHub repository: {redact_secrets_from_string(str(exc))}") from exc

    def get_branch(self, owner: str, repo: str, branch: str) -> GitHubBranchInfo:
        import httpx
        try:
            with httpx.Client(timeout=self._timeout) as client:
                res = client.get(f"{self.BASE_URL}/repos/{owner}/{repo}/branches/{branch}", headers=self._get_headers())
                if res.status_code == 404:
                    raise ResourceNotFoundError(f"Branch '{branch}' not found in '{owner}/{repo}'", provider_code="404")
                elif res.is_error:
                    raise ProviderAPIError(f"GitHub branch API error: {res.status_code}", provider_code=str(res.status_code))
                data = res.json()
                return GitHubBranchInfo(
                    name=branch,
                    commit_sha=data["commit"]["sha"],
                    is_protected=data.get("protected", False),
                )
        except httpx.TimeoutException as exc:
            raise ConnectorTimeoutError(f"GitHub branch request timed out for '{branch}'") from exc
        except httpx.RequestError as exc:
            raise ConnectorNetworkError(f"Network error accessing branch: {redact_secrets_from_string(str(exc))}") from exc

    def get_file(self, owner: str, repo: str, path: str, ref: str | None = None) -> GitHubFileInfo:
        import httpx
        params = {"ref": ref} if ref else {}
        try:
            with httpx.Client(timeout=self._timeout) as client:
                res = client.get(f"{self.BASE_URL}/repos/{owner}/{repo}/contents/{path}", headers=self._get_headers(), params=params)
                if res.status_code == 404:
                    raise ResourceNotFoundError(f"File '{path}' not found at ref '{ref}'", resource_id=path, provider_code="404")
                elif res.is_error:
                    raise ProviderAPIError(f"GitHub contents API error: {res.status_code}", provider_code=str(res.status_code))
                data = res.json()
                encoded_content = data.get("content", "")
                decoded = base64.b64decode(encoded_content).decode("utf-8") if encoded_content else ""
                return GitHubFileInfo(
                    path=path,
                    sha=data["sha"],
                    size_bytes=data.get("size", len(decoded)),
                    content=decoded,
                )
        except httpx.TimeoutException as exc:
            raise ConnectorTimeoutError(f"GitHub file content request timed out for '{path}'") from exc
        except httpx.RequestError as exc:
            raise ConnectorNetworkError(f"Network error accessing file: {redact_secrets_from_string(str(exc))}") from exc

    def create_branch(self, owner: str, repo: str, new_branch: str, base_sha: str) -> GitHubBranchInfo:
        import httpx
        payload = {"ref": f"refs/heads/{new_branch}", "sha": base_sha}
        try:
            with httpx.Client(timeout=self._timeout) as client:
                res = client.post(f"{self.BASE_URL}/repos/{owner}/{repo}/git/refs", headers=self._get_headers(), json=payload)
                if res.status_code == 422:
                    # Branch already exists -> fetch branch info
                    return self.get_branch(owner, repo, new_branch)
                elif res.is_error:
                    raise ProviderAPIError(f"Failed to create branch '{new_branch}': {res.status_code}", provider_code=str(res.status_code))
                return GitHubBranchInfo(name=new_branch, commit_sha=base_sha, is_protected=False)
        except httpx.TimeoutException as exc:
            raise ConnectorTimeoutError(f"Branch creation request timed out for '{new_branch}'") from exc
        except httpx.RequestError as exc:
            raise ConnectorNetworkError(f"Network error creating branch: {redact_secrets_from_string(str(exc))}") from exc

    def create_or_update_file(
        self,
        owner: str,
        repo: str,
        path: str,
        content: str,
        message: str,
        branch: str,
        sha: str | None = None,
    ) -> GitHubCommitInfo:
        import httpx
        encoded = base64.b64encode(content.encode("utf-8")).decode("utf-8")
        payload: dict[str, Any] = {
            "message": message,
            "content": encoded,
            "branch": branch,
        }
        if sha:
            payload["sha"] = sha

        try:
            with httpx.Client(timeout=self._timeout) as client:
                res = client.put(f"{self.BASE_URL}/repos/{owner}/{repo}/contents/{path}", headers=self._get_headers(), json=payload)
                if res.is_error:
                    raise ProviderAPIError(f"GitHub commit API error: {res.status_code}", provider_code=str(res.status_code))
                data = res.json()
                commit_sha = data["commit"]["sha"]
                return GitHubCommitInfo(sha=commit_sha, branch=branch, message=message)
        except httpx.TimeoutException as exc:
            raise ConnectorTimeoutError(f"Commit request timed out for '{path}'") from exc
        except httpx.RequestError as exc:
            raise ConnectorNetworkError(f"Network error committing file: {redact_secrets_from_string(str(exc))}") from exc

    def create_pull_request(
        self,
        owner: str,
        repo: str,
        title: str,
        body: str,
        head_branch: str,
        base_branch: str,
    ) -> GitHubPRInfo:
        import httpx
        payload = {
            "title": title,
            "body": body,
            "head": head_branch,
            "base": base_branch,
        }
        try:
            with httpx.Client(timeout=self._timeout) as client:
                res = client.post(f"{self.BASE_URL}/repos/{owner}/{repo}/pulls", headers=self._get_headers(), json=payload)
                if res.is_error:
                    raise ProviderAPIError(f"Failed to create PR: {res.status_code}", provider_code=str(res.status_code))
                data = res.json()
                return GitHubPRInfo(
                    number=data["number"],
                    html_url=data["html_url"],
                    title=data["title"],
                    head_branch=head_branch,
                    base_branch=base_branch,
                    state=data.get("state", "open"),
                )
        except httpx.TimeoutException as exc:
            raise ConnectorTimeoutError("Pull request creation timed out") from exc
        except httpx.RequestError as exc:
            raise ConnectorNetworkError(f"Network error creating PR: {redact_secrets_from_string(str(exc))}") from exc

    def close_pull_request(self, owner: str, repo: str, pr_number: int) -> GitHubPRInfo:
        import httpx
        try:
            with httpx.Client(timeout=self._timeout) as client:
                res = client.patch(f"{self.BASE_URL}/repos/{owner}/{repo}/pulls/{pr_number}", headers=self._get_headers(), json={"state": "closed"})
                if res.is_error:
                    raise ProviderAPIError(f"Failed to close PR #{pr_number}: {res.status_code}", provider_code=str(res.status_code))
                data = res.json()
                return GitHubPRInfo(
                    number=pr_number,
                    html_url=data["html_url"],
                    title=data["title"],
                    head_branch=data["head"]["ref"],
                    base_branch=data["base"]["ref"],
                    state="closed",
                )
        except httpx.TimeoutException as exc:
            raise ConnectorTimeoutError(f"PR close request timed out for #{pr_number}") from exc
        except httpx.RequestError as exc:
            raise ConnectorNetworkError(f"Network error closing PR: {redact_secrets_from_string(str(exc))}") from exc

    def get_rate_limit(self) -> RateLimitInfo:
        import httpx
        try:
            with httpx.Client(timeout=self._timeout) as client:
                res = client.get(f"{self.BASE_URL}/rate_limit", headers=self._get_headers())
                if res.is_error:
                    return RateLimitInfo(is_rate_limited=False)
                data = res.json().get("rate", {})
                return RateLimitInfo(
                    limit=data.get("limit"),
                    remaining=data.get("remaining"),
                    reset_seconds=float(data.get("reset", 0) - time.time()) if data.get("reset") else None,
                    is_rate_limited=(data.get("remaining", 1) == 0),
                )
        except Exception:
            return RateLimitInfo(is_rate_limited=False)
