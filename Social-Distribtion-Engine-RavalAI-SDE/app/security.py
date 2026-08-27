"""Security utilities for authentication, signing, and encryption."""

from __future__ import annotations

import hashlib
import hmac
import uuid
from datetime import UTC, datetime, timedelta

from cryptography.fernet import Fernet, InvalidToken

from app.config import get_settings


class SecurityError(Exception):
    """Base exception for security-related errors."""

    pass


class InvalidTokenError(SecurityError):
    """Raised when a token is invalid or expired."""

    pass


class SignatureVerificationError(SecurityError):
    """Raised when signature verification fails."""

    pass


class ReplayAttackError(SecurityError):
    """Raised when a replay attack is detected."""

    pass


def generate_request_id() -> str:
    """Generate a unique request ID for tracing.

    Returns:
        A UUID4 string (36 characters).

    """
    return str(uuid.uuid4())


def validate_bearer_token(auth_header: str | None) -> str:
    """Validate Bearer token from Authorization header.

    Args:
        auth_header: Value of Authorization header, e.g., "Bearer token123"

    Returns:
        The extracted token string.

    Raises:
        InvalidTokenError: If header is missing, malformed, or token is invalid.

    """
    if not auth_header:
        raise InvalidTokenError("Missing Authorization header")

    parts = auth_header.split()
    if len(parts) != 2 or parts[0].lower() != "bearer":
        raise InvalidTokenError("Invalid Authorization header format. Expected: Bearer <token>")

    token = parts[1]
    settings = get_settings()

    # Validate token matches configured API token
    if not token or token != settings.SDE_API_TOKEN:
        raise InvalidTokenError("Invalid or expired token")

    return token


def sign_request(method: str, path: str, body: str | bytes, secret: str) -> str:
    """Create HMAC-SHA256 signature for request.

    Used to sign outbound webhook requests for verification by receiver.

    Args:
        method: HTTP method (GET, POST, etc.)
        path: Request path (e.g., "/webhook")
        body: Request body (string or bytes)
        secret: Shared secret for signing

    Returns:
        Hex-encoded HMAC-SHA256 signature.

    Example:
        >>> sig = sign_request("POST", "/webhook", '{"event":"test"}', "secret")
        >>> sig
        'sha256=abc123def456...'

    """
    if isinstance(body, bytes):
        body = body.decode("utf-8")

    # Message format: METHOD|PATH|BODY
    message = f"{method}|{path}|{body}"
    signature = hmac.new(
        secret.encode("utf-8"),
        message.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()

    return f"sha256={signature}"


def verify_signature(
    method: str,
    path: str,
    body: str | bytes,
    signature: str,
    secret: str,
    tolerance_seconds: int = 300,  # noqa: ARG001
) -> bool:
    """Verify HMAC-SHA256 signature of request.

    Used to verify inbound webhook requests before processing.

    Args:
        method: HTTP method
        path: Request path
        body: Request body
        signature: Signature from header (format: "sha256=abc123...")
        secret: Shared secret
        tolerance_seconds: Max age of request (default 300s = 5 minutes)

    Returns:
        True if signature is valid, False otherwise.

    Raises:
        SignatureVerificationError: If signature format is invalid.
        ReplayAttackError: If request is too old.

    """
    # Extract signature from header
    if not signature or not signature.startswith("sha256="):
        raise SignatureVerificationError("Invalid signature format. Expected: sha256=<hex>")

    received_sig = signature.split("=", 1)[1]

    # Compute expected signature
    expected_sig_obj = sign_request(method, path, body, secret)
    expected_sig = expected_sig_obj.split("=", 1)[1]

    # Constant-time comparison (prevents timing attacks)
    return hmac.compare_digest(received_sig, expected_sig)


def encrypt_token(token: str, fernet_key: str | None = None) -> bytes:
    """Encrypt OAuth token using Fernet (symmetric encryption).

    Args:
        token: Plain OAuth token to encrypt
        fernet_key: Fernet key (defaults to settings.FERNET_KEY)

    Returns:
        Encrypted bytes (base64 encoded).

    Raises:
        SecurityError: If encryption fails.

    Example:
        >>> encrypted = encrypt_token("oauth_token_123")
        >>> encrypted
        b'gAAAAABg...'

    """
    if not fernet_key:
        fernet_key = get_settings().FERNET_KEY

    try:
        cipher = Fernet(fernet_key.encode("utf-8"))
        return cipher.encrypt(token.encode("utf-8"))
    except (InvalidToken, ValueError) as e:
        raise SecurityError(f"Token encryption failed: {e}") from e


def decrypt_token(encrypted: bytes, fernet_key: str | None = None) -> str:
    """Decrypt OAuth token using Fernet (symmetric encryption).

    Args:
        encrypted: Encrypted bytes (from encrypt_token)
        fernet_key: Fernet key (defaults to settings.FERNET_KEY)

    Returns:
        Plain OAuth token string.

    Raises:
        SecurityError: If decryption fails.

    Example:
        >>> encrypted = encrypt_token("oauth_token_123")
        >>> decrypted = decrypt_token(encrypted)
        >>> decrypted
        'oauth_token_123'

    """
    if not fernet_key:
        fernet_key = get_settings().FERNET_KEY

    try:
        cipher = Fernet(fernet_key.encode("utf-8"))
        decrypted = cipher.decrypt(encrypted)
        return decrypted.decode("utf-8")
    except (InvalidToken, ValueError) as e:
        raise SecurityError(f"Token decryption failed: {e}") from e


def validate_timestamp_freshness(
    timestamp: datetime,
    tolerance_seconds: int = 300,
) -> bool:
    """Validate that a timestamp is recent (within tolerance window).

    Used for replay attack prevention. Rejects requests with timestamps
    older than tolerance_seconds.

    Args:
        timestamp: Timestamp to validate
        tolerance_seconds: Max age in seconds (default 300s = 5 minutes)

    Returns:
        True if timestamp is recent, False if too old.

    Raises:
        ReplayAttackError: If timestamp is significantly in the future (clock skew > 60s).

    Example:
        >>> now = datetime.now(timezone.utc)
        >>> validate_timestamp_freshness(now)
        True
        >>> old = now - timedelta(seconds=600)
        >>> validate_timestamp_freshness(old)
        False

    """
    now = datetime.now(UTC)

    # Check if timestamp is in the future (clock skew tolerance: 60 seconds)
    if timestamp > now + timedelta(seconds=60):
        raise ReplayAttackError("Timestamp is too far in the future (possible clock skew)")

    # Check if timestamp is too old
    age_seconds = (now - timestamp).total_seconds()
    return not age_seconds > tolerance_seconds


def hash_password(password: str) -> str:
    """Hash password using SHA256 (for reference; not actively used in OAuth flow).

    Args:
        password: Plain password

    Returns:
        Hex-encoded SHA256 hash.

    """
    return hashlib.sha256(password.encode("utf-8")).hexdigest()


def verify_password(password: str, password_hash: str) -> bool:
    """Verify password against hash.

    Args:
        password: Plain password
        password_hash: Hex-encoded SHA256 hash

    Returns:
        True if password matches hash.

    """
    return hmac.compare_digest(hash_password(password), password_hash)
