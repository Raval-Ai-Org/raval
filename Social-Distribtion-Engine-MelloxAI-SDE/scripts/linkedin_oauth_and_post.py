"""One-shot script: OAuth 2.0 authorization-code flow for LinkedIn + post a test text post."""

from __future__ import annotations

import os
import secrets
import sys
import threading
import time
import urllib.parse
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

import httpx

from _env_utils import update_env_file

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENV_PATH = os.path.join(BASE_DIR, ".env")

AUTH_URL = "https://www.linkedin.com/oauth/v2/authorization"
TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken"
CALLBACK_URI = "http://localhost:8000/api/v1/oauth/linkedin/callback"


def load_env_key(name: str) -> str:
    value = os.environ.get(name, "")
    if not value and os.path.isfile(ENV_PATH):
        with open(ENV_PATH) as f:
            for line in f:
                line = line.strip()
                if line.startswith(f"{name}="):
                    value = line.split("=", 1)[1].strip()
                    break
    if not value:
        print(f"ERROR: {name} is not set in .env or environment")
        sys.exit(1)
    return value


class CallbackHandler(BaseHTTPRequestHandler):
    captured_code: str | None = None
    captured_state: str | None = None
    done = False

    def do_GET(self):
        parsed = urlparse(self.path)
        params = parse_qs(parsed.query)
        if "code" in params:
            CallbackHandler.captured_code = params["code"][0]
            CallbackHandler.captured_state = params.get("state", [None])[0]
            CallbackHandler.done = True
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            self.end_headers()
            self.wfile.write(
                b"<html><body><h1>LinkedIn Authorization successful!</h1>"
                b"<p>You may close this window and return to the terminal.</p></body></html>"
            )
        elif "error" in params:
            CallbackHandler.captured_code = None
            CallbackHandler.captured_state = params.get("state", [None])[0]
            CallbackHandler.done = True
            error_detail = params.get("error", [""])[0]
            error_desc = params.get("error_description", [""])[0]
            with open("/tmp/linkedin_oauth_error.txt", "w") as f:
                f.write(f"error={error_detail}\nerror_description={error_desc}\nfull_path={self.path}\n")
            self.send_response(400)
            self.send_header("Content-Type", "text/html")
            self.end_headers()
            self.wfile.write(
                f"<html><body><h1>Authorization failed: {error_detail}</h1>"
                f"<p>{error_desc}</p></body></html>".encode()
            )
        else:
            self.send_response(400)
            self.end_headers()

    def log_message(self, format, *args):
        pass


def start_callback_server():
    server = HTTPServer(("0.0.0.0", 8000), CallbackHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server


def main():
    client_id = load_env_key("LINKEDIN_CLIENT_ID")
    client_secret = load_env_key("LINKEDIN_CLIENT_SECRET")

    state_token = secrets.token_urlsafe(32)

    auth_params = {
        "response_type": "code",
        "client_id": client_id,
        "redirect_uri": CALLBACK_URI,
        "scope": "openid profile email w_member_social",
        "state": state_token,
    }
    auth_url = f"{AUTH_URL}?{urllib.parse.urlencode(auth_params)}"

    print("=" * 60)
    print("LinkedIn OAuth 2.0 Authorization (standard code flow)")
    print("=" * 60)
    print()
    print("Step 1: Open this URL in your browser and approve the app:")
    print()
    print(auth_url)
    print()
    print("Step 2: After approving, LinkedIn will redirect to localhost:8000/api/v1/oauth/linkedin/callback")
    print("        A local server is already listening on port 8000.")
    print()
    print("Waiting for authorization callback...", flush=True)

    server = start_callback_server()
    timeout = 300
    start_time = time.time()
    while not CallbackHandler.done and (time.time() - start_time) < timeout:
        time.sleep(1)

    if not CallbackHandler.done:
        print("ERROR: Timed out waiting for authorization callback.")
        server.shutdown()
        sys.exit(1)

    if CallbackHandler.captured_code is None:
        print("ERROR: No authorization code received.")
        server.shutdown()
        sys.exit(1)

    print("Authorization code received. Exchanging for access token...")

    token_data = {
        "grant_type": "authorization_code",
        "code": CallbackHandler.captured_code,
        "client_id": client_id,
        "redirect_uri": CALLBACK_URI,
        "client_secret": client_secret,
    }

    resp = httpx.post(
        TOKEN_URL,
        data=token_data,
        timeout=30,
    )
    if resp.status_code != 200:
        print(f"ERROR: Token exchange failed with HTTP {resp.status_code}")
        print(f"Response body: {resp.text}")
        with open("/tmp/linkedin_oauth_token_error.txt", "w") as f:
            f.write(f"status={resp.status_code}\nbody={resp.text}\n")
        server.shutdown()
        sys.exit(1)
    token_json = resp.json()

    access_token = token_json["access_token"]
    refresh_token = token_json.get("refresh_token")
    expires_in = token_json.get("expires_in", 600)

    print(f"Access token obtained ({len(access_token)} chars)")
    if refresh_token:
        print(f"Refresh token obtained ({len(refresh_token)} chars)")

    # Save tokens to .env WITHOUT clobbering unrelated configuration
    # (the old implementation rewrote .env keeping only LINKEDIN_* keys,
    # which wiped POSTGRES_*, SDE_API_TOKEN, FERNET_KEY, etc.)
    updates = {"LINKEDIN_ACCESS_TOKEN": access_token}
    if refresh_token:
        updates["LINKEDIN_REFRESH_TOKEN"] = refresh_token
    update_env_file(ENV_PATH, updates)

    print(f"Tokens saved to {ENV_PATH}")

    # Now post the LinkedIn post
    post_text = "hi this is test post happy to see you here"
    print(f'Posting LinkedIn post: "{post_text}"')

    # Get user info first to determine the author URN
    user_resp = httpx.get(
        "https://api.linkedin.com/v2/userinfo",
        headers={"Authorization": f"Bearer {access_token}"},
        timeout=30,
    )
    print(f"User info status: {user_resp.status_code}")
    user_data = user_resp.json()
    print(f"User info: {user_data}")

    # LinkedIn UGC post requires an author URN like "urn:li:person:<person_id>"
    # or for company pages "urn:li:organization:<company_id>"
    person_urn = user_data.get("sub", "")
    author_urn = f"urn:li:person:{person_urn}"

    share_body = {
        "author": author_urn,
        "lifecycleState": "PUBLISHED",
        "specificContent": {
            "com.linkedin.ugc.ShareContent": {
                "shareCommentary": {"text": post_text},
                "shareMediaCategory": "NONE",
            }
        },
        "visibility": {
            "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC",
        },
    }

    post_resp = httpx.post(
        "https://api.linkedin.com/v2/ugcPosts",
        json=share_body,
        headers={
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json",
            "X-Restli-Protocol-Version": "2.0.0",
        },
        timeout=30,
    )

    print(f"Post status: {post_resp.status_code}")
    print(f"Post response: {post_resp.text[:300]}")

    if post_resp.status_code in (200, 201):
        data = post_resp.json()
        post_id = data.get("id", "")
        post_url = f"https://www.linkedin.com/feed/update/{post_id}"
        print()
        print("=" * 60)
        print("SUCCESS! LinkedIn post published!")
        print(f"  Post ID: {post_id}")
        print(f"  URL: {post_url}")
        print("=" * 60)
    else:
        print("FAILED to post to LinkedIn")

    server.shutdown()


if __name__ == "__main__":
    main()