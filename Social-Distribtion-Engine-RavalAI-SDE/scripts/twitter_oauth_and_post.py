"""One-shot script: OAuth PKCE flow for Twitter/X + post a tweet."""

from __future__ import annotations

import hashlib
import hmac
import os
import secrets
import sys
import threading
import time
import urllib.parse
import base64
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

import httpx

from _env_utils import update_env_file

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENV_PATH = os.path.join(BASE_DIR, ".env")

AUTH_URL = "https://twitter.com/i/oauth2/authorize"
TOKEN_URL = "https://api.twitter.com/2/oauth2/token"
CALLBACK_URI = "http://localhost:3000/callback"


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


def generate_pkce_pair():
    code_verifier = secrets.token_urlsafe(32)
    digest = hashlib.sha256(code_verifier.encode("ascii")).digest()
    code_challenge = base64.urlsafe_b64encode(digest).decode("ascii").rstrip("=")
    return code_verifier, code_challenge


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
                b"<html><body><h1>Authorization successful!</h1>"
                b"<p>You may close this window and return to the terminal.</p></body></html>"
            )
        elif "error" in params:
            CallbackHandler.captured_code = None
            CallbackHandler.done = True
            self.send_response(400)
            self.send_header("Content-Type", "text/html")
            self.end_headers()
            self.wfile.write(
                b"<html><body><h1>Authorization failed or was denied.</h1></body></html>"
            )
        else:
            self.send_response(400)
            self.end_headers()

    def log_message(self, format, *args):
        pass


def start_callback_server():
    server = HTTPServer(("127.0.0.1", 3000), CallbackHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server


def main():
    client_id = load_env_key("TWITTER_CLIENT_ID")
    client_secret = load_env_key("TWITTER_CLIENT_SECRET")

    code_verifier, code_challenge = generate_pkce_pair()
    state_token = secrets.token_urlsafe(32)

    auth_params = {
        "response_type": "code",
        "client_id": client_id,
        "redirect_uri": CALLBACK_URI,
        "scope": "tweet.read tweet.write users.read offline.access",
        "state": state_token,
        "code_challenge": code_challenge,
        "code_challenge_method": "S256",
    }
    auth_url = f"{AUTH_URL}?{urllib.parse.urlencode(auth_params)}"

    print("=" * 60)
    print("Twitter/X OAuth 2.0 PKCE Authorization")
    print("=" * 60)
    print()
    print("Step 1: Open this URL in your browser and approve the app:")
    print()
    print(auth_url)
    print()
    print("Step 2: After approving, X will redirect to localhost:3000/callback")
    print("        A local server is already listening on port 3000.")
    print()
    print("Waiting for authorization callback...", flush=True)

    server = start_callback_server()
    timeout = 120
    start_time = time.time()
    while not CallbackHandler.done and (time.time() - start_time) < timeout:
        time.sleep(1)

    if not CallbackHandler.done:
        print("ERROR: Timed out waiting for authorization callback.")
        sys.exit(1)

    if CallbackHandler.captured_code is None:
        print("ERROR: No authorization code received.")
        sys.exit(1)

    print("Authorization code received. Exchanging for access token...")

    token_data = {
        "grant_type": "authorization_code",
        "code": CallbackHandler.captured_code,
        "client_id": client_id,
        "redirect_uri": CALLBACK_URI,
        "code_verifier": code_verifier,
    }

    resp = httpx.post(
        TOKEN_URL,
        data=token_data,
        auth=(client_id, client_secret),
        timeout=30,
    )
    resp.raise_for_status()
    token_json = resp.json()

    access_token = token_json["access_token"]
    refresh_token = token_json.get("refresh_token")
    expires_in = token_json.get("expires_in", 7200)

    print(f"Access token obtained ({len(access_token)} chars)")
    if refresh_token:
        print(f"Refresh token obtained ({len(refresh_token)} chars)")

    # Save tokens to .env WITHOUT clobbering unrelated configuration
    # (the old implementation rewrote .env keeping only TWITTER_* keys,
    # which wiped POSTGRES_*, SDE_API_TOKEN, FERNET_KEY, etc.)
    updates = {"TWITTER_ACCESS_TOKEN": access_token}
    if refresh_token:
        updates["TWITTER_REFRESH_TOKEN"] = refresh_token
    update_env_file(ENV_PATH, updates)

    print(f"Tokens saved to {ENV_PATH}")

    # Now post the tweet
    tweet_text = "Hi, this is my first post here!"
    print(f'Posting tweet: "{tweet_text}"')

    post_resp = httpx.post(
        "https://api.twitter.com/2/tweets",
        json={"text": tweet_text},
        headers={"Authorization": f"Bearer {access_token}"},
        timeout=30,
    )

    if post_resp.status_code in (200, 201):
        data = post_resp.json()
        tweet_id = data["data"]["id"]
        tweet_url = f"https://x.com/i/status/{tweet_id}"
        print()
        print("=" * 60)
        print("SUCCESS! Tweet posted!")
        print(f"  Tweet ID: {tweet_id}")
        print(f"  URL: {tweet_url}")
        print("=" * 60)
    else:
        print(f"ERROR posting tweet: HTTP {post_resp.status_code}")
        print(post_resp.text)
        sys.exit(1)

    server.shutdown()


if __name__ == "__main__":
    main()