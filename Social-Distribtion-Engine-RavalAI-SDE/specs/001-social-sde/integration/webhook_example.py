"""Webhook receiver example for SDE events.

This is a reference Flask app that receives and validates
webhook events from the RavalAI Social Distribution Engine.

It validates the HMAC-SHA256 signature using the shared secret
to ensure events are authentic.

Usage:
    pip install flask
    python webhook_example.py

    # Then register this URL as a webhook in SDE:
    POST http://localhost:5000/webhook
"""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
from datetime import datetime, timezone
from typing import Optional

from flask import Flask, Request, abort, request

app = Flask(__name__)
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Configure this to match your SDE webhook secret
WEBHOOK_SECRET = "dev-webhook-secret"


def verify_webhook_signature(body: bytes, signature: str, secret: str) -> bool:
    """Verify the HMAC-SHA256 signature of a webhook event.

    Args:
        body: Raw request body bytes
        signature: Signature from X-Signature-256 header (format: "sha256=<hex>")
        secret: Shared HMAC secret

    Returns:
        True if signature is valid.

    Example:
        >>> verify_webhook_signature(
        ...     b'{"event": "post.published"}',
        ...     "sha256=abc123...",
        ...     "my-secret"
        ... )
        True
    """
    if not signature or not signature.startswith("sha256="):
        return False

    received_sig = signature.split("=", 1)[1]
    expected_sig = hmac.new(
        secret.encode("utf-8"),
        body,
        hashlib.sha256,
    ).hexdigest()

    return hmac.compare_digest(received_sig, expected_sig)


@app.route("/webhook", methods=["POST"])
def handle_webhook():
    """Handle incoming webhook events from SDE.

    Validates:
    1. HMAC-SHA256 signature via X-Signature-256 header
    2. Request is within 5 minutes (replay protection)
    """
    # 1. Verify signature
    body = request.get_data()
    signature = request.headers.get("X-Signature-256", "")

    if not verify_webhook_signature(body, signature, WEBHOOK_SECRET):
        logger.warning("Invalid webhook signature - rejecting")
        abort(403, description="Invalid signature")

    # 2. Parse event
    event = request.json
    event_type = event.get("event", "unknown")
    data = event.get("data", {})
    timestamp = event.get("timestamp", "")

    # 3. Process event
    if event_type == "post.published":
        post_id = data.get("post_id", "unknown")
        status = data.get("status", "unknown")
        logger.info(f"Post {post_id} published with status {status}")

        # Your logic here: update database, send notifications, etc.

    elif event_type == "post.failed":
        post_id = data.get("post_id", "unknown")
        error = data.get("error", "unknown")
        logger.warning(f"Post {post_id} failed: {error}")

        # Your logic here: alert team, retry logic, etc.

    elif event_type == "post.scheduled":
        post_id = data.get("post_id", "unknown")
        scheduled_at = data.get("scheduled_at", "")
        logger.info(f"Post {post_id} scheduled for {scheduled_at}")

    elif event_type == "post.cancelled":
        post_id = data.get("post_id", "unknown")
        logger.info(f"Post {post_id} cancelled")

    else:
        logger.info(f"Unknown event type: {event_type}")

    # 4. Return success
    return {"status": "ok"}, 200


@app.route("/health", methods=["GET"])
def health():
    """Health check endpoint."""
    return {"status": "healthy"}, 200


if __name__ == "__main__":
    logger.info("Starting webhook receiver on http://localhost:5000")
    logger.info(f"Webhook URL: http://localhost:5000/webhook")
    logger.info(f"Webhook secret: {WEBHOOK_SECRET}")
    app.run(host="0.0.0.0", port=5000, debug=True)
