"""One-shot: seed a LinkedIn account row into the SDE database.

Used by the engine dogfood gate and for onboarding a brand's LinkedIn account
without a browser when tokens are already present in ``.env``.

Flow:
1. Refresh the LinkedIn access token (validates ADR-0003 refresh path).
2. Fetch OpenID userinfo to capture the stable ``sub`` → author URN (ADR-0002).
3. Encrypt both tokens (Fernet) and upsert the ``accounts`` row.

Output: prints ACCOUNT_ID / AUTHOR_URN / SUB for use in publish requests.
"""

from __future__ import annotations

import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

import httpx

from app.config import get_settings
from app.database import get_sync_session_maker
from app.models import Account
from app.security import encrypt_token

_ENV_PATH = Path(__file__).resolve().parent.parent / ".env"


def _env_value(name: str) -> str:
    """Read a value from the environment or ``.env`` (for vars not on Settings)."""
    value = os.environ.get(name, "")
    if not value and _ENV_PATH.is_file():
        for line in _ENV_PATH.read_text().splitlines():
            line = line.strip()
            if line.startswith(f"{name}="):
                value = line.split("=", 1)[1].strip()
                break
    if not value:
        print(f"ERROR: {name} is not set in .env or environment")
        sys.exit(1)
    return value


def _refresh_linkedin(settings, refresh_token: str) -> dict:
    resp = httpx.post(
        "https://www.linkedin.com/oauth/v2/accessToken",
        data={
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
            "client_id": settings.LINKEDIN_CLIENT_ID,
            "client_secret": settings.LINKEDIN_CLIENT_SECRET,
        },
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()


def main() -> None:
    settings = get_settings()

    access_token = _env_value("LINKEDIN_ACCESS_TOKEN")
    refresh_token = _env_value("LINKEDIN_REFRESH_TOKEN")
    expires_at = datetime.now(timezone.utc) + timedelta(days=60)

    # Refresh the access token first (best-effort; falls back to .env token).
    try:
        print("Refreshing LinkedIn access token...", flush=True)
        data = _refresh_linkedin(settings, refresh_token)
        access_token = data["access_token"]
        refresh_token = data.get("refresh_token") or refresh_token
        expires_at = datetime.now(timezone.utc) + timedelta(
            seconds=data.get("expires_in", 60 * 60 * 24 * 60)
        )
        print("Refresh OK.", flush=True)
    except Exception as e:  # noqa: BLE001 - fall back to stored token
        print(f"Refresh failed ({e}); using stored access token.", flush=True)

    print("Fetching OpenID userinfo...", flush=True)
    user_resp = httpx.get(
        "https://api.linkedin.com/v2/userinfo",
        headers={"Authorization": f"Bearer {access_token}"},
        timeout=30,
    )
    user_resp.raise_for_status()
    info = user_resp.json()
    sub = info["sub"]
    name = info.get("name", "")
    author_urn = f"urn:li:person:{sub}"

    now = datetime.now(timezone.utc)
    maker = get_sync_session_maker()
    with maker() as session:
        existing = session.query(Account).filter_by(
            workspace_id=settings.DEFAULT_WORKSPACE_ID,
            platform="linkedin",
            platform_account_id=sub,
        ).first()

        if existing:
            existing.encrypted_access_token = encrypt_token(access_token)
            existing.encrypted_refresh_token = encrypt_token(refresh_token)
            existing.token_expires_at = expires_at
            existing.status = "active"
            existing.metadata_fields = {"author_urn": author_urn, "persona": "person"}
            existing.updated_at = now
            account_id = existing.id
        else:
            acc = Account(
                id=str(uuid4()),
                workspace_id=settings.DEFAULT_WORKSPACE_ID,
                brand_id=settings.DEFAULT_BRAND_ID,
                platform="linkedin",
                platform_account_id=sub,
                platform_username=name.lower().replace(" ", "_") if name else "user",
                encrypted_access_token=encrypt_token(access_token),
                encrypted_refresh_token=encrypt_token(refresh_token),
                token_expires_at=expires_at,
                status="active",
                metadata_fields={"author_urn": author_urn, "persona": "person"},
                created_at=now,
                updated_at=now,
            )
            session.add(acc)
            session.commit()
            account_id = acc.id

    print(f"ACCOUNT_ID={account_id}")
    print(f"AUTHOR_URN={author_urn}")
    print(f"SUB={sub}")


if __name__ == "__main__":
    sys.exit(main())
