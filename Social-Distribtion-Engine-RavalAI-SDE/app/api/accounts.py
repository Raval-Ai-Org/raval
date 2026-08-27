"""Account management and OAuth flow API endpoints."""

from __future__ import annotations

import base64
import hashlib
import json
import os
import secrets
import uuid
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING, Any
from urllib.parse import urlencode, urlparse

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import WorkspaceContext, get_current_workspace, get_db
from app.config import Settings, get_settings
from app.models import Account
from app.schemas import AccountResponse, OAuthStartResponse
from app.security import encrypt_token

if TYPE_CHECKING:
    import redis

router = APIRouter(prefix="/api/v1", tags=["accounts"])

# In-memory fallback for OAuth state when Redis is unavailable (dev/tests).
_oauth_states: dict[str, dict[str, Any]] = {}

# OAuth state TTL (seconds) — matches the 10-minute consent window.
OAUTH_STATE_TTL = 600


def _get_redis() -> redis.Redis | None:
    """Return a connected Redis client, or None if Redis is unreachable."""
    try:
        import redis as redis_lib

        client: redis_lib.Redis = redis_lib.Redis.from_url(
            get_settings().REDIS_URL,
            socket_timeout=1,
            socket_connect_timeout=1,
        )
        client.ping()
        return client
    except Exception:
        return None


def _save_oauth_state(state_hash: str, data: dict[str, Any]) -> None:
    """Persist OAuth state durably (Redis with TTL), falling back to memory.

    Redis-backed storage means callbacks survive API restarts and work across
    multiple instances (FR-MT-05). The in-memory fallback keeps dev/test runs
    functional without a Redis server.
    """
    redis_client = _get_redis()
    if redis_client is not None:
        redis_client.setex(f"oauth:{state_hash}", OAUTH_STATE_TTL, json.dumps(data))
    else:
        _oauth_states[state_hash] = data


def _pop_oauth_state(state_hash: str) -> dict[str, Any] | None:
    """Retrieve and delete OAuth state (Redis first, then in-memory)."""
    redis_client = _get_redis()
    if redis_client is not None:
        payload = redis_client.get(f"oauth:{state_hash}")
        if payload is None:
            return None
        redis_client.delete(f"oauth:{state_hash}")
        result: dict[str, Any] = json.loads(payload)
        return result
    return _oauth_states.pop(state_hash, None)


# ─── Account Management ─────────────────────────────────────────────────


@router.get(
    "/accounts",
    response_model=list[AccountResponse],
    summary="List connected accounts",
    description="List all platform accounts connected to the current workspace.",
    responses={
        200: {"description": "Accounts listed"},
        401: {"description": "Unauthorized"},
    },
)
async def list_accounts(
    workspace: WorkspaceContext = Depends(get_current_workspace),
    db: AsyncSession = Depends(get_db),
) -> list[AccountResponse]:
    """List all accounts for the current workspace.

    Returns sensitive token fields as null (never exposed in responses).
    """
    stmt = select(Account).where(
        Account.workspace_id == workspace.workspace_id,
    )
    result = await db.execute(stmt)
    accounts = result.scalars().all()

    return [
        AccountResponse(
            account_id=acc.id,
            workspace_id=acc.workspace_id,
            platform=acc.platform,
            platform_account_id=acc.platform_account_id,
            platform_username=acc.platform_username,
            status=acc.status,
            token_expires_at=acc.token_expires_at,
            created_at=acc.created_at,
            updated_at=acc.updated_at,
        )
        for acc in accounts
    ]


@router.get(
    "/accounts/{account_id}",
    response_model=AccountResponse,
    summary="Get account details",
    responses={
        200: {"description": "Account details"},
        404: {"description": "Account not found"},
    },
)
async def get_account(
    account_id: str,
    workspace: WorkspaceContext = Depends(get_current_workspace),
    db: AsyncSession = Depends(get_db),
) -> AccountResponse:
    """Get details for a specific account."""
    stmt = select(Account).where(
        Account.id == account_id,
        Account.workspace_id == workspace.workspace_id,
    )
    result = await db.execute(stmt)
    acc = result.scalar_one_or_none()

    if not acc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Account not found: {account_id}",
        )

    return AccountResponse(
        account_id=acc.id,
        workspace_id=acc.workspace_id,
        platform=acc.platform,
        platform_account_id=acc.platform_account_id,
        platform_username=acc.platform_username,
        status=acc.status,
        token_expires_at=acc.token_expires_at,
        created_at=acc.created_at,
        updated_at=acc.updated_at,
    )


@router.delete(
    "/accounts/{account_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Disconnect an account",
    description=(
        "Disconnect a platform account. Existing published posts are preserved, "
        "but no new posts can be published to this account."
    ),
    responses={
        204: {"description": "Account disconnected"},
        404: {"description": "Account not found"},
    },
)
async def disconnect_account(
    account_id: str,
    workspace: WorkspaceContext = Depends(get_current_workspace),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Disconnect a platform account (soft-delete)."""
    stmt = select(Account).where(
        Account.id == account_id,
        Account.workspace_id == workspace.workspace_id,
    )
    result = await db.execute(stmt)
    acc = result.scalar_one_or_none()

    if not acc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Account not found: {account_id}",
        )

    acc.status = "disconnected"
    acc.updated_at = datetime.now(UTC)
    await db.commit()


# ─── OAuth Flow ──────────────────────────────────────────────────────────


def _is_allowed_redirect(url: str) -> bool:
    """Only allow the post-connect browser redirect to a TRUSTED origin (reuse
    the CORS allowlist). Prevents an open-redirect vector through OAuth."""
    try:
        parsed = urlparse(url)
    except ValueError:
        return False
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        return False
    allowed = {
        o.strip().rstrip("/")
        for o in os.getenv("CORS_ORIGINS", "https://raval.it.com,http://localhost:3000").split(",")
        if o.strip()
    }
    origin = f"{parsed.scheme}://{parsed.netloc}".rstrip("/")
    return origin in allowed


@router.get(
    "/oauth/{platform}/start",
    summary="Start OAuth flow",
    description=(
        "Redirect to the platform's OAuth authorization page. "
        "After user authorizes, they are redirected to the callback endpoint."
    ),
    response_model=OAuthStartResponse,
    responses={
        302: {"description": "Redirect to platform authorization"},
        400: {"description": "Unsupported platform"},
    },
)
async def oauth_start(
    platform: str,
    request: Request,  # noqa: ARG001
    redirect_after: str | None = Query(default=None),
    workspace: WorkspaceContext = Depends(get_current_workspace),
) -> OAuthStartResponse:
    """Start OAuth flow for a platform.

    Generates a state token, stores it, and returns the authorization URL.
    The frontend should redirect the user to this URL.

    `redirect_after`: optional trusted origin to bounce the browser back to
    after the callback stores the account (T068). Defaults to returning JSON.
    """
    settings = get_settings()
    platform = platform.lower()

    if platform not in ("twitter", "linkedin", "facebook", "instagram"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported platform: {platform}. Use: twitter, linkedin, facebook, instagram",
        )

    # Generate state token for CSRF protection
    state_token = secrets.token_urlsafe(32)
    state_hash = hashlib.sha256(state_token.encode()).hexdigest()

    state_data = {
        "platform": platform,
        "workspace_id": workspace.workspace_id,
        "brand_id": workspace.brand_id,
        "created_at": datetime.now(UTC).isoformat(),
        "expires_at": (datetime.now(UTC) + timedelta(minutes=10)).isoformat(),
    }
    if redirect_after is not None:
        if not _is_allowed_redirect(redirect_after):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="redirect_after must be a trusted origin",
            )
        state_data["redirect_after"] = redirect_after

    # Build authorization URL per platform
    if platform == "twitter":
        # PKCE (S256). The old code sent a hardcoded code_verifier="challenge"
        # with no matching code_challenge in the authorize URL, so X rejected
        # the token exchange. Generate a real verifier, store it with the
        # state, and send the matching challenge now / verifier at exchange.
        code_verifier = secrets.token_urlsafe(32)
        code_challenge = (
            base64.urlsafe_b64encode(hashlib.sha256(code_verifier.encode("ascii")).digest())
            .decode("ascii")
            .rstrip("=")
        )
        state_data["code_verifier"] = code_verifier

        auth_url = "https://twitter.com/i/oauth2/authorize"
        params = {
            "response_type": "code",
            "client_id": settings.TWITTER_CLIENT_ID,
            "redirect_uri": settings.TWITTER_CALLBACK_URL,
            "scope": "tweet.read tweet.write users.read offline.access",
            "state": state_token,
            "code_challenge": code_challenge,
            "code_challenge_method": "S256",
        }
    elif platform == "linkedin":
        # Verified live scopes (PHR 0005): OpenID profile/email + w_member_social.
        # r_liteprofile is deprecated and caused openid_insufficient_scope_error.
        auth_url = "https://www.linkedin.com/oauth/v2/authorization"
        params = {
            "response_type": "code",
            "client_id": settings.LINKEDIN_CLIENT_ID,
            "redirect_uri": settings.LINKEDIN_CALLBACK_URL,
            "scope": "openid profile email w_member_social",
            "state": state_token,
        }
    elif platform in ("facebook", "instagram"):
        # Meta shares one OAuth dialog for Facebook Pages and Instagram.
        # facebook scope covers Page management; instagram adds the IG
        # publishing scopes (IG resolves from the linked Page, so the dialog
        # must also grant the Page permissions to discover it).
        auth_url = "https://www.facebook.com/v18.0/dialog/oauth"
        scope = "pages_manage_posts,pages_read_engagement,pages_show_list"
        if platform == "instagram":
            scope += ",instagram_basic,instagram_content_publish"
        params = {
            "client_id": settings.FACEBOOK_CLIENT_ID,
            "redirect_uri": settings.FACEBOOK_CALLBACK_URL,
            "scope": scope,
            "state": state_token,
        }

    _save_oauth_state(state_hash, state_data)

    return OAuthStartResponse(
        authorization_url=f"{auth_url}?{urlencode(params)}",
        state_token=state_token,
        expires_in=OAUTH_STATE_TTL,
    )


@router.get(
    "/oauth/{platform}/callback",
    summary="OAuth callback",
    description="Handles the OAuth callback after user authorization.",
    # The handler returns either AccountResponse (JSON) or a 302 RedirectResponse
    # (when redirect_after was set) — that union is not a Pydantic field, so
    # disable auto response-model generation (T068).
    response_model=None,
    responses={
        200: {"description": "Account connected successfully"},
        302: {"description": "Redirect back to the host platform after connect"},
        400: {"description": "Invalid state or token exchange failed"},
    },
)
async def oauth_callback(
    platform: str,
    code: str = Query(description="Authorization code from platform"),
    state: str = Query(description="State token for CSRF verification"),
    workspace: WorkspaceContext = Depends(get_current_workspace),
    db: AsyncSession = Depends(get_db),
) -> AccountResponse | RedirectResponse:
    """Handle OAuth callback after user authorization.

    1. Verifies state token (CSRF protection)
    2. Exchanges authorization code for access token
    3. Fetches user profile from platform
    4. Stores encrypted tokens and account details
    5. If `redirect_after` was set at start, bounces the browser back there
       (T068); otherwise returns the AccountResponse JSON (backward-compatible).
    """
    settings = get_settings()
    platform = platform.lower()

    # Verify state (durable store — survives restarts / multi-instance)
    state_hash = hashlib.sha256(state.encode()).hexdigest()
    state_data = _pop_oauth_state(state_hash)

    if not state_data:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired OAuth state",
        )

    if state_data["workspace_id"] != workspace.workspace_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="State mismatch: workspace does not match",
        )

    # Exchange code for token (state carries the PKCE verifier for Twitter)
    try:
        token_data = await _exchange_code_for_token(platform, code, settings, state_data)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Token exchange failed: {e}",
        ) from e

    # Fetch user profile / resolve publishing identity. For Meta the
    # publishing identity is a Page (or linked Instagram account), not the
    # authorizing user — resolve the durable Page token + identity here
    # (T009/T015; FR-MT-07).
    try:
        if platform in ("facebook", "instagram"):
            profile, access_token, account_metadata = await _resolve_meta_identity(
                platform, token_data["access_token"], settings
            )
        else:
            profile = await _fetch_user_profile(platform, token_data["access_token"])
            access_token = token_data["access_token"]
            account_metadata = None
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Failed to fetch profile: {e}",
        ) from e

    # Store account
    now = datetime.now(UTC)
    account_id = str(uuid.uuid4())

    encrypted_access = encrypt_token(access_token)
    encrypted_refresh = (
        encrypt_token(token_data["refresh_token"]) if token_data.get("refresh_token") else None
    )

    # Capture the posting identity at connect time (ADR-0002). LinkedIn's
    # person URN comes from OpenID userinfo "sub"; storing it here lets the
    # worker publish with the correct author without guessing (FR-MT-07).
    if platform == "linkedin":
        account_metadata = {
            "author_urn": f"urn:li:person:{profile['id']}",
            "persona": "person",
        }

    account = Account(
        id=account_id,
        workspace_id=workspace.workspace_id,
        brand_id=workspace.brand_id,
        platform=platform,
        platform_account_id=profile["id"],
        platform_username=profile["username"],
        encrypted_access_token=encrypted_access,
        encrypted_refresh_token=encrypted_refresh,
        token_expires_at=token_data.get("expires_at"),
        status="active",
        metadata_fields=account_metadata,
        created_at=now,
        updated_at=now,
    )
    db.add(account)
    await db.commit()
    await db.refresh(account)

    redirect_after = state_data.get("redirect_after")
    if redirect_after:
        sep = "&" if "?" in redirect_after else "?"
        return RedirectResponse(
            url=f"{redirect_after}{sep}platform={platform}&account_id={account.id}&status=connected",
            status_code=status.HTTP_302_FOUND,
        )

    return AccountResponse(
        account_id=account.id,
        workspace_id=account.workspace_id,
        platform=account.platform,
        platform_account_id=account.platform_account_id,
        platform_username=account.platform_username,
        status=account.status,
        token_expires_at=account.token_expires_at,
        created_at=account.created_at,
        updated_at=account.updated_at,
    )


# ─── Token Exchange Helpers ──────────────────────────────────────────────


async def _exchange_code_for_token(
    platform: str,
    code: str,
    settings: Settings,
    state_data: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Exchange authorization code for access token.

    Args:
        platform: Platform name.
        code: Authorization code.
        settings: App settings.
        state_data: OAuth state from the /start flow — carries the PKCE
            verifier for Twitter (must match the challenge sent at /start).

    Returns dict with: access_token, refresh_token (optional), expires_at.

    """
    async with httpx.AsyncClient(timeout=30) as client:
        if platform == "twitter":
            code_verifier = (state_data or {}).get("code_verifier")
            if not code_verifier:
                raise ValueError("Missing PKCE code_verifier for Twitter OAuth")
            token_url = "https://api.twitter.com/2/oauth2/token"
            resp = await client.post(
                token_url,
                data={
                    "grant_type": "authorization_code",
                    "code": code,
                    "client_id": settings.TWITTER_CLIENT_ID,
                    "redirect_uri": settings.TWITTER_CALLBACK_URL,
                    "code_verifier": code_verifier,
                },
                auth=(settings.TWITTER_CLIENT_ID, settings.TWITTER_CLIENT_SECRET),
            )
            resp.raise_for_status()
            data = resp.json()
            return {
                "access_token": data["access_token"],
                "refresh_token": data.get("refresh_token"),
                "expires_at": datetime.now(UTC) + timedelta(seconds=data.get("expires_in", 7200)),
            }

        if platform == "linkedin":
            token_url = "https://www.linkedin.com/oauth/v2/accessToken"
            resp = await client.post(
                token_url,
                data={
                    "grant_type": "authorization_code",
                    "code": code,
                    "redirect_uri": settings.LINKEDIN_CALLBACK_URL,
                    "client_id": settings.LINKEDIN_CLIENT_ID,
                    "client_secret": settings.LINKEDIN_CLIENT_SECRET,
                },
            )
            resp.raise_for_status()
            data = resp.json()
            return {
                "access_token": data["access_token"],
                "refresh_token": data.get("refresh_token"),
                "expires_at": datetime.now(UTC) + timedelta(seconds=data.get("expires_in", 600)),
            }

        if platform in ("facebook", "instagram"):
            # Instagram shares Meta's OAuth: same app, same token endpoint,
            # same redirect URI. The IG identity is resolved later from the
            # linked Facebook Page (see _resolve_meta_identity).
            token_url = "https://graph.facebook.com/v18.0/oauth/access_token"
            resp = await client.get(
                token_url,
                params={
                    "client_id": settings.FACEBOOK_CLIENT_ID,
                    "client_secret": settings.FACEBOOK_CLIENT_SECRET,
                    "redirect_uri": settings.FACEBOOK_CALLBACK_URL,
                    "code": code,
                },
            )
            resp.raise_for_status()
            data = resp.json()
            return {
                "access_token": data["access_token"],
                "refresh_token": None,
                "expires_at": datetime.now(UTC) + timedelta(seconds=data.get("expires_in", 600)),
            }

    raise ValueError(f"Unknown platform: {platform}")


async def _exchange_long_lived_token(
    short_token: str,
    settings: Settings,
) -> str:
    """Exchange a short-lived Meta user token for a long-lived one.

    Meta's OAuth user tokens expire in ~2 hours. Exchanging via the
    ``fb_exchange_token`` grant yields a token valid ~60 days, which we store
    as the account's access token so the first publish is not already expired.
    """
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(
            "https://graph.facebook.com/v18.0/oauth/access_token",
            params={
                "grant_type": "fb_exchange_token",
                "client_id": settings.FACEBOOK_CLIENT_ID,
                "client_secret": settings.FACEBOOK_CLIENT_SECRET,
                "fb_exchange_token": short_token,
            },
        )
        resp.raise_for_status()
        token: str = resp.json()["access_token"]
        return token


async def _resolve_primary_page(
    user_token: str,
) -> tuple[str, str, str]:
    """Resolve the first Facebook Page the user manages.

    Args:
        user_token: Long-lived user access token with ``pages_show_list``.

    Returns:
        Tuple of (page_id, page_name, page_access_token) for the first Page
        the user can manage. The Page token is what we store so publishes hit
        the Page, not the user's personal timeline.

    """
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(
            "https://graph.facebook.com/v18.0/me/accounts",
            params={"fields": "id,name,access_token", "access_token": user_token},
        )
        resp.raise_for_status()
        data = resp.json()
        pages = data.get("data") or []
        if not pages:
            raise ValueError(
                "No Facebook Page found for this account. "
                "The user must manage at least one Page to connect Facebook."
            )
        page = pages[0]
        return page["id"], page["name"], page["access_token"]


async def _resolve_instagram_account(
    page_id: str,
    page_token: str,
) -> tuple[str, str]:
    """Resolve the Instagram Business account linked to a Facebook Page.

    Returns:
        Tuple of (ig_user_id, ig_username). Raises if the Page has no linked
        Instagram Professional (Business/Creator) account — the spec's US3-AC3
        requirement, surfaced as a clear connect error.

    """
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(
            f"https://graph.facebook.com/v18.0/{page_id}",
            params={
                "fields": "instagram_business_account",
                "access_token": page_token,
            },
        )
        resp.raise_for_status()
        data = resp.json()
        ig_account = data.get("instagram_business_account")
        if not ig_account:
            raise ValueError(
                "Instagram account must be a Professional account linked to a "
                "Facebook Page before it can be connected."
            )
        ig_user_id = ig_account["id"]

        # Fetch the IG username for display.
        profile_resp = await client.get(
            f"https://graph.facebook.com/v18.0/{ig_user_id}",
            params={"fields": "username", "access_token": page_token},
        )
        profile_resp.raise_for_status()
        ig_username = profile_resp.json().get("username", ig_user_id)

        return ig_user_id, ig_username


async def _resolve_meta_identity(
    platform: str,
    short_token: str,
    settings: Settings,
) -> tuple[dict[str, Any], str, dict[str, Any]]:
    """Resolve the durable Meta publishing identity for a connect.

    Meta user tokens are short-lived, and the publishing identity is a Page
    (Facebook) or the linked Instagram account — not the user. This upgrades
    the token, resolves the Page, and (for Instagram) the linked IG account.

    Returns:
        Tuple of (profile, access_token_to_store, metadata):
          - facebook: profile = Page, token = Page token, metadata {page_id, persona}
          - instagram: profile = IG account, token = Page token,
            metadata {ig_user_id, page_id, persona}

    """
    long_token = await _exchange_long_lived_token(short_token, settings)
    page_id, page_name, page_token = await _resolve_primary_page(long_token)

    if platform == "facebook":
        profile = {
            "id": page_id,
            "username": page_name.lower().replace(" ", "_"),
            "name": page_name,
        }
        metadata = {"page_id": page_id, "persona": "page"}
        return profile, page_token, metadata

    # instagram
    ig_user_id, ig_username = await _resolve_instagram_account(page_id, page_token)
    profile = {"id": ig_user_id, "username": ig_username, "name": ig_username}
    metadata = {"ig_user_id": ig_user_id, "page_id": page_id, "persona": "page"}
    return profile, page_token, metadata


async def _fetch_user_profile(
    platform: str,
    access_token: str,
) -> dict[str, Any]:
    """Fetch user profile from platform API.

    Returns dict with: id, username, name.
    """
    async with httpx.AsyncClient(timeout=10) as client:
        if platform == "twitter":
            resp = await client.get(
                "https://api.twitter.com/2/users/me",
                headers={"Authorization": f"Bearer {access_token}"},
            )
            resp.raise_for_status()
            data = resp.json()["data"]
            return {
                "id": data["id"],
                "username": data["username"],
                "name": data.get("name", data["username"]),
            }

        if platform == "linkedin":
            # OpenID userinfo — works with the "openid profile email"
            # scopes and returns the stable "sub" used for author URNs.
            resp = await client.get(
                "https://api.linkedin.com/v2/userinfo",
                headers={"Authorization": f"Bearer {access_token}"},
            )
            resp.raise_for_status()
            data = resp.json()
            name = data.get("name", "")
            return {
                "id": data["sub"],
                "username": name.lower().replace(" ", "_") if name else "user",
                "name": name,
            }

        if platform == "facebook":
            resp = await client.get(
                "https://graph.facebook.com/v18.0/me",
                params={"fields": "id,name", "access_token": access_token},
            )
            resp.raise_for_status()
            data = resp.json()
            return {
                "id": data["id"],
                "username": data["name"].lower().replace(" ", "_"),
                "name": data["name"],
            }

    raise ValueError(f"Unknown platform: {platform}")
