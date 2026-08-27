"""One-shot: seed a Meta (Facebook Page or Instagram) account row for dev/test.

**DEV/TEST ONLY — NOT the production path.**

The production connect flow is the OAuth authorize flow (spec FR-001): clients
click Authorize through the ONE RavalAI Meta app and the engine stores their
token. This script exists only to let an owner/tester verify publishing without
a browser by pointing at a long-lived Page access token already available.

Flow:
1. Take a Page access token from ``.env`` (``META_PAGE_ACCESS_TOKEN``) or a
   token argument.
2. Resolve the Page identity (and, for Instagram, the linked IG account).
3. Encrypt the token (Fernet) and upsert the ``accounts`` row for the default
   workspace.

Output: prints ACCOUNT_ID for use in publish requests.
"""

from __future__ import annotations

import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

import httpx

from app.config import get_settings
from app.database import get_sync_session_maker
from app.models import Account
from app.security import encrypt_token

_ENV_PATH = Path(__file__).resolve().parent.parent / ".env"

GRAPH_BASE = "https://graph.facebook.com/v18.0"


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


def _resolve_page(page_token: str) -> tuple[str, str]:
    """Return (page_id, page_name) for the first Page the token can manage."""
    resp = httpx.get(
        f"{GRAPH_BASE}/me/accounts",
        params={"fields": "id,name", "access_token": page_token},
        timeout=30,
    )
    resp.raise_for_status()
    pages = resp.json().get("data") or []
    if not pages:
        print("ERROR: token manages no Pages")
        sys.exit(1)
    page = pages[0]
    return page["id"], page.get("name", page["id"])


def _resolve_ig_account(page_id: str, page_token: str) -> str:
    """Return the IG user id linked to the Page, or None if not linked."""
    resp = httpx.get(
        f"{GRAPH_BASE}/{page_id}",
        params={"fields": "instagram_business_account", "access_token": page_token},
        timeout=30,
    )
    resp.raise_for_status()
    ig = resp.json().get("instagram_business_account")
    return ig["id"] if ig else ""


def main() -> None:
    settings = get_settings()
    platform = (sys.argv[1] if len(sys.argv) > 1 else "facebook").lower()
    if platform not in ("facebook", "instagram"):
        print("Usage: seed_meta_account.py [facebook|instagram]")
        sys.exit(1)

    page_token = _env_value("META_PAGE_ACCESS_TOKEN")
    page_id, page_name = _resolve_page(page_token)
    print(f"Page resolved: {page_name} ({page_id})", flush=True)

    if platform == "instagram":
        ig_id = _resolve_ig_account(page_id, page_token)
        if not ig_id:
            print(
                "ERROR: no Instagram Business account linked to this Page. "
                "Link it in Meta's settings first, then re-run."
            )
            sys.exit(1)
        platform_account_id = ig_id
        username = f"ig_{ig_id}"
        metadata = {"ig_user_id": ig_id, "page_id": page_id, "persona": "page"}
    else:
        platform_account_id = page_id
        username = page_name.lower().replace(" ", "_")
        metadata = {"page_id": page_id, "persona": "page"}

    now = datetime.now(timezone.utc)
    maker = get_sync_session_maker()
    with maker() as session:
        existing = session.query(Account).filter_by(
            workspace_id=settings.DEFAULT_WORKSPACE_ID,
            platform=platform,
            platform_account_id=platform_account_id,
        ).first()

        if existing:
            existing.encrypted_access_token = encrypt_token(page_token)
            existing.token_expires_at = None
            existing.status = "active"
            existing.metadata_fields = metadata
            existing.updated_at = now
            account_id = existing.id
        else:
            acc = Account(
                id=str(uuid4()),
                workspace_id=settings.DEFAULT_WORKSPACE_ID,
                brand_id=settings.DEFAULT_BRAND_ID,
                platform=platform,
                platform_account_id=platform_account_id,
                platform_username=username,
                encrypted_access_token=encrypt_token(page_token),
                token_expires_at=None,
                status="active",
                metadata_fields=metadata,
                created_at=now,
                updated_at=now,
            )
            session.add(acc)
            session.commit()
            account_id = acc.id

    print(f"ACCOUNT_ID={account_id}")
    print(f"PLATFORM={platform}")
    print(f"PLATFORM_ACCOUNT_ID={platform_account_id}")


if __name__ == "__main__":
    sys.exit(main())
