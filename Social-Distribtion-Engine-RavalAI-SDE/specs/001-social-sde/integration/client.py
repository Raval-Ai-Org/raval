"""RavalAI SDE Python SDK Client.

A simple Python client for the Social Distribution Engine API.
Provides type-safe methods for all API endpoints.

Usage:
    from sde_client import SDEClient

    client = SDEClient(base_url="http://localhost:8000", api_token="your-token")

    # Publish immediately
    result = client.publish(
        idempotency_key="my-key-1",
        targets=[{"account_id": "acc_1", "content": {"text": "Hello!"}}]
    )

    # Schedule for later
    result = client.schedule(
        idempotency_key="my-key-2",
        scheduled_at="2026-07-28T10:00:00Z",
        targets=[{"account_id": "acc_1", "content": {"text": "Future post!"}}]
    )

    # Check status
    job = client.get_job(result["job_id"])

    # Cancel
    client.cancel_job(result["job_id"])
"""

from __future__ import annotations

import sys
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

try:
    import httpx
except ImportError:
    print("Install httpx: pip install httpx")
    sys.exit(1)


class SDEClientError(Exception):
    """Base error for SDE client operations."""

    def __init__(self, status_code: int, error_code: str, detail: str, request_id: Optional[str] = None):
        self.status_code = status_code
        self.error_code = error_code
        self.detail = detail
        self.request_id = request_id
        super().__init__(f"[{status_code}] {error_code}: {detail}")


class SDEClient:
    """Client for the RavalAI Social Distribution Engine API.

    Args:
        base_url: API base URL (default: http://localhost:8000)
        api_token: Bearer API token
        timeout: Request timeout in seconds (default: 30)
    """

    def __init__(
        self,
        base_url: str = "http://localhost:8000",
        api_token: str = "",
        timeout: float = 30.0,
    ):
        self.base_url = base_url.rstrip("/")
        self.api_token = api_token
        self.timeout = timeout
        self._client = httpx.Client(
            base_url=self.base_url,
            timeout=self.timeout,
            headers={
                "Authorization": f"Bearer {api_token}",
                "Content-Type": "application/json",
            },
        )

    def close(self):
        """Close the underlying HTTP client."""
        self._client.close()

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()

    def _handle_response(self, response: httpx.Response) -> dict:
        """Handle API response and raise errors."""
        if response.status_code in (200, 201):
            return response.json()
        elif response.status_code == 204:
            return {}
        else:
            try:
                error = response.json()
                raise SDEClientError(
                    status_code=response.status_code,
                    error_code=error.get("error_code", "UNKNOWN"),
                    detail=error.get("detail", str(error)),
                    request_id=error.get("request_id"),
                )
            except (ValueError, KeyError):
                raise SDEClientError(
                    status_code=response.status_code,
                    error_code="UNKNOWN",
                    detail=f"HTTP {response.status_code}: {response.text[:200]}",
                )

    # ─── Publish ─────────────────────────────────────────────────────

    def publish(
        self,
        idempotency_key: str,
        targets: List[Dict[str, Any]],
        **kwargs,
    ) -> dict:
        """Publish content immediately.

        Args:
            idempotency_key: Unique key for deduplication
            targets: List of targets with account_id and content

        Returns:
            Job response dict with job_id, status, targets

        Example:
            result = client.publish(
                idempotency_key="post-001",
                targets=[{
                    "account_id": "acc_123",
                    "content": {"text": "Hello!"}
                }]
            )
        """
        payload = {
            "idempotency_key": idempotency_key,
            "targets": targets,
            **kwargs,
        }
        response = self._client.post("/api/v1/publish", json=payload)
        return self._handle_response(response)

    def schedule(
        self,
        idempotency_key: str,
        scheduled_at: str,
        targets: List[Dict[str, Any]],
        **kwargs,
    ) -> dict:
        """Schedule content for future publishing.

        Args:
            idempotency_key: Unique key for deduplication
            scheduled_at: ISO 8601 UTC datetime string
            targets: List of targets with account_id and content

        Returns:
            Job response dict

        Example:
            result = client.schedule(
                idempotency_key="post-002",
                scheduled_at="2026-07-28T10:00:00Z",
                targets=[{
                    "account_id": "acc_123",
                    "content": {"text": "Future post!"}
                }]
            )
        """
        payload = {
            "idempotency_key": idempotency_key,
            "scheduled_at": scheduled_at,
            "targets": targets,
            **kwargs,
        }
        response = self._client.post("/api/v1/schedule", json=payload)
        return self._handle_response(response)

    # ─── Jobs ────────────────────────────────────────────────────────

    def get_job(self, job_id: str) -> dict:
        """Get job details with full timeline.

        Args:
            job_id: UUID of the job

        Returns:
            Job response with targets and timeline
        """
        response = self._client.get(f"/api/v1/jobs/{job_id}")
        return self._handle_response(response)

    def list_jobs(
        self,
        status: Optional[str] = None,
        limit: int = 20,
        offset: int = 0,
    ) -> list:
        """List jobs with optional filters.

        Args:
            status: Filter by status (published, pending, failed)
            limit: Max results (default 20)
            offset: Pagination offset

        Returns:
            List of job response dicts
        """
        params = {"limit": limit, "offset": offset}
        if status:
            params["status"] = status
        response = self._client.get("/api/v1/jobs", params=params)
        return self._handle_response(response)

    def cancel_job(self, job_id: str) -> None:
        """Cancel a pending job.

        Args:
            job_id: UUID of the job to cancel

        Raises:
            SDEClientError: If job cannot be cancelled (already published)
        """
        response = self._client.delete(f"/api/v1/jobs/{job_id}")
        self._handle_response(response)

    # ─── Accounts ────────────────────────────────────────────────────

    def list_accounts(self) -> list:
        """List all connected platform accounts.

        Returns:
            List of account response dicts
        """
        response = self._client.get("/api/v1/accounts")
        return self._handle_response(response)

    def get_account(self, account_id: str) -> dict:
        """Get account details.

        Args:
            account_id: Account UUID

        Returns:
            Account response dict
        """
        response = self._client.get(f"/api/v1/accounts/{account_id}")
        return self._handle_response(response)

    def disconnect_account(self, account_id: str) -> None:
        """Disconnect a platform account.

        Args:
            account_id: Account UUID
        """
        response = self._client.delete(f"/api/v1/accounts/{account_id}")
        self._handle_response(response)

    # ─── OAuth ───────────────────────────────────────────────────────

    def oauth_start(self, platform: str) -> dict:
        """Start OAuth flow for a platform.

        Args:
            platform: "twitter", "linkedin", or "facebook"

        Returns:
            Dict with authorization_url and state_token
        """
        response = self._client.get(f"/api/v1/oauth/{platform}/start")
        return self._handle_response(response)

    # ─── Webhooks ────────────────────────────────────────────────────

    def register_webhook(self, url: str, secret: Optional[str] = None) -> dict:
        """Register a webhook endpoint.

        Args:
            url: HTTPS URL to receive webhook events
            secret: Optional HMAC signing secret

        Returns:
            Webhook endpoint response dict
        """
        payload = {"url": url}
        if secret:
            payload["secret"] = secret
        response = self._client.post("/api/v1/webhooks/config", json=payload)
        return self._handle_response(response)

    def list_webhooks(self) -> list:
        """List registered webhook endpoints.

        Returns:
            List of webhook endpoint response dicts
        """
        response = self._client.get("/api/v1/webhooks/config")
        return self._handle_response(response)

    def disable_webhook(self, webhook_id: str) -> None:
        """Disable a webhook endpoint.

        Args:
            webhook_id: Webhook UUID
        """
        response = self._client.delete(f"/api/v1/webhooks/config/{webhook_id}")
        self._handle_response(response)

    # ─── Health ──────────────────────────────────────────────────────

    def health(self) -> dict:
        """Check API health status.

        Returns:
            Health response with database, redis, workers status
        """
        response = self._client.get("/healthz")
        return self._handle_response(response)


# ─── CLI Usage ────────────────────────────────────────────────────────

if __name__ == "__main__":
    import argparse
    import json

    parser = argparse.ArgumentParser(description="RavalAI SDE CLI Client")
    parser.add_argument("--url", default="http://localhost:8000")
    parser.add_argument("--token", required=True)
    parser.add_argument("command", choices=["health", "publish", "jobs", "accounts"])
    parser.add_argument("--text", default="")
    parser.add_argument("--account", default="")

    args = parser.parse_args()

    with SDEClient(base_url=args.url, api_token=args.token) as client:
        if args.command == "health":
            print(json.dumps(client.health(), indent=2))

        elif args.command == "publish":
            result = client.publish(
                idempotency_key=f"cli-{datetime.now(timezone.utc).isoformat()}",
                targets=[{
                    "account_id": args.account,
                    "content": {"text": args.text},
                }],
            )
            print(json.dumps(result, indent=2))

        elif args.command == "jobs":
            jobs = client.list_jobs()
            print(json.dumps(jobs, indent=2))

        elif args.command == "accounts":
            accounts = client.list_accounts()
            print(json.dumps(accounts, indent=2))
